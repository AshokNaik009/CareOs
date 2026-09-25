import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { emptyPreferences } from '../../lib/live-health/alert-rules.mjs';
import { createApp } from '../../lib/live-health/app.mjs';
import { createWhoopClient } from '../../lib/live-health/whoop.mjs';

const origin = 'http://localhost:3000';
const basePath = '/live-health';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const token = { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 };

async function harness(t, options = {}) {
  const calls = [];
  const app = createApp({ origin, clientId: 'test-client', clientSecret: 'test-secret', fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return String(url).includes('/token') ? json(token) : json({ records: [] }); }, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { app.locals.dispose(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}${basePath}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...options });
  async function login() {
    const start = await request('/auth/whoop');
    const location = new URL(start.headers.get('location'));
    const pendingCookie = start.headers.get('set-cookie').split(';')[0];
    const finish = await request(`/auth/whoop/callback?state=${location.searchParams.get('state')}&code=test-code`, { headers: { Cookie: pendingCookie } });
    assert.equal(finish.headers.get('location'), basePath);
    return { cookie: finish.headers.get('set-cookie').split(';')[0], pendingCookie, state: location.searchParams.get('state') };
  }
  const requestRoot = (path, options = {}) => fetch(new URL(path, base), { redirect: 'manual', ...options });
  return { request, requestRoot, login, calls };
}

test('session endpoint exposes no secrets and disables caching', async t => {
  const { request } = await harness(t);
  const res = await request('/api/session');
  assert.deepEqual(await res.json(), { configured: true, connected: false, sample: false, sampleAvailable: false });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('unconfigured app does not attempt authorization', async t => {
  const { request } = await harness(t, { clientId: '', clientSecret: '' });
  assert.deepEqual(await (await request('/api/session')).json(), { configured: false, connected: false, sample: false, sampleAvailable: false });
  assert.equal((await request('/auth/whoop')).headers.get('location'), `${basePath}?connection=not_configured`);
});

test('OAuth uses documented scopes, module callback, safe cookies, and session rotation', async t => {
  const { request, login, calls } = await harness(t);
  const start = await request('/auth/whoop');
  const url = new URL(start.headers.get('location'));
  assert.equal(url.origin, 'https://api.prod.whoop.com');
  assert.equal(url.searchParams.get('state').length, 8);
  assert.match(url.searchParams.get('scope'), /offline/);
  assert.equal(url.searchParams.get('redirect_uri'), `${origin}${basePath}/auth/whoop/callback`);
  assert.doesNotMatch(url.search, /secret/);
  assert.match(start.headers.get('set-cookie'), /HttpOnly/);
  assert.match(start.headers.get('set-cookie'), /SameSite=Lax/);
  assert.match(start.headers.get('set-cookie'), /Path=\/live-health/);
  const { cookie, pendingCookie } = await login();
  assert.notEqual(cookie, pendingCookie);
  assert.equal((await (await request('/api/session', { headers: { Cookie: cookie } })).json()).connected, true);
  assert.equal((await (await request('/api/session', { headers: { Cookie: pendingCookie } })).json()).connected, false);
  const exchange = calls.find(c => c.url.includes('/token'));
  assert.equal(exchange.init.body.get('redirect_uri'), `${origin}${basePath}/auth/whoop/callback`);
});

test('callback rejects absent, mismatched, and multibyte state without token exchange', async t => {
  const { request, calls } = await harness(t);
  const start = await request('/auth/whoop');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  for (const state of ['', 'wrong123', 'éééééééé']) {
    const response = await request(`/auth/whoop/callback?state=${encodeURIComponent(state)}&code=test`, { headers: { Cookie: cookie } });
    assert.equal(response.headers.get('location'), `${basePath}?connection=invalid_state`);
  }
  assert.equal(calls.length, 0);
});

test('sample mode is off by default', async t => {
  const { request } = await harness(t);
  assert.equal((await request('/auth/sample')).status, 404);
  assert.equal((await (await request('/api/session')).json()).sampleAvailable, false);
});

test('opt-in sample mode serves labelled analysis without WHOOP or alerts', async t => {
  const { request, calls } = await harness(t, { sampleData: true });
  const start = await request('/auth/sample');
  assert.equal(start.headers.get('location'), basePath);
  const cookie = start.headers.get('set-cookie').split(';')[0];
  assert.deepEqual(await (await request('/api/session', { headers: { Cookie: cookie } })).json(), { configured: true, connected: true, sample: true, sampleAvailable: true });
  const report = await request('/api/report', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ timeZone: 'Asia/Dubai' }) });
  assert.equal(report.status, 200);
  const body = await report.json();
  assert.equal(body.sample, true);
  assert.equal(typeof body.current.recovery, 'number');
  assert.equal((await request('/api/alerts', { headers: { Cookie: cookie } })).status, 401);
  assert.equal(calls.length, 0);
});

test('WHOOP scope errors report the cause without token exchange', async t => {
  const { request, calls } = await harness(t);
  const start = await request('/auth/whoop');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const response = await request('/auth/whoop/callback?error=invalid_scope&state=', { headers: { Cookie: cookie } });
  assert.equal(response.headers.get('location'), `${basePath}?connection=invalid_scope`);
  assert.equal(calls.length, 0);
});

test('state is single use and authorization cancellation is handled', async t => {
  const { request, login, calls } = await harness(t);
  const { state, pendingCookie } = await login();
  const replay = await request(`/auth/whoop/callback?state=${state}&code=test`, { headers: { Cookie: pendingCookie } });
  assert.equal(replay.headers.get('location'), `${basePath}?connection=invalid_state`);
  assert.equal(calls.length, 1);
  const start = await request('/auth/whoop');
  const newState = new URL(start.headers.get('location')).searchParams.get('state');
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const denied = await request(`/auth/whoop/callback?state=${newState}&error=access_denied`, { headers: { Cookie: cookie } });
  assert.equal(denied.headers.get('location'), `${basePath}?connection=denied`);
});

test('API requires authentication and a same-origin POST', async t => {
  const { request } = await harness(t);
  assert.equal((await request('/api/report', { method: 'POST' })).status, 403);
  assert.equal((await request('/api/report', { method: 'POST', headers: { Origin: origin } })).status, 401);
  assert.equal((await request('/api/logout', { method: 'POST', headers: { Origin: 'https://example.org' } })).status, 403);
});

test('analysis endpoint returns exact JSON schema with missing data as null', async t => {
  const { request, login } = await harness(t);
  const { cookie } = await login();
  const response = await request('/api/analysis', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ timeZone: 'UTC' }) });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.recovery_status, null);
  assert.deepEqual(data.trends, { hrv: null, resting_hr: null, sleep: null });
  assert.equal(Object.keys(data).length, 6);
  assert.doesNotMatch(JSON.stringify(data), /test-access|test-refresh|test-secret/);
});

test('invalid timezones, profiles and JSON receive clean errors', async t => {
  const { request, login } = await harness(t);
  const { cookie } = await login();
  for (const body of ['{bad', JSON.stringify({ timeZone: 'Invalid/Zone' }), JSON.stringify({ timeZone: 'UTC', profile: { age: 'thirty' } }), JSON.stringify({ timeZone: 'UTC', profile: null })]) {
    const res = await request('/api/report', { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
  }
});

test('disconnect revokes only on explicit POST and clears the session', async t => {
  const { request, login, calls } = await harness(t);
  const { cookie } = await login();
  const headers = { Origin: origin, Cookie: cookie };
  assert.equal((await request('/api/disconnect', { headers })).status, 404);
  assert.equal((await request('/api/disconnect', { method: 'POST', headers })).status, 200);
  assert.equal(calls.at(-1).init.method, 'DELETE');
  assert.equal((await (await request('/api/session', { headers })).json()).connected, false);
});

test('logout clears the session without revoking WHOOP access', async t => {
  const { request, login, calls } = await harness(t);
  const { cookie } = await login();
  const headers = { Origin: origin, Cookie: cookie };
  assert.equal((await request('/api/logout', { method: 'POST', headers })).status, 200);
  assert.equal(calls.filter(c => c.init.method === 'DELETE').length, 0);
  assert.equal((await (await request('/api/session', { headers })).json()).connected, false);
});

test('sessions expire instead of retaining health data indefinitely', async t => {
  let clock = Date.now();
  const { request, login } = await harness(t, { now: () => clock });
  const { cookie } = await login();
  clock += 86400001;
  assert.equal((await (await request('/api/session', { headers: { Cookie: cookie } })).json()).connected, false);
});

test('production refuses an insecure public origin', () => {
  assert.throws(() => createApp({ production: true, origin }), /HTTPS/);
});

test('production uses secure module-scoped cookies', async t => {
  const { request } = await harness(t, { production: true, origin: 'https://care.example' });
  assert.match((await request('/auth/whoop')).headers.get('set-cookie'), /Secure/);
});

test('concurrent collections share one refresh and retain rotated tokens', async () => {
  let refreshes = 0;
  const client = createWhoopClient({ clientId: 'test', clientSecret: 'test', now: () => 100000, fetchImpl: async (url, init) => {
    if (String(url).includes('/token')) {
      refreshes++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return json({ ...token, refresh_token: 'rotated' });
    }
    assert.equal(init.headers.Authorization, 'Bearer test-access');
    return json({ records: [] });
  } });
  const session = { tokens: { accessToken: 'expired', refreshToken: 'old', expiresAt: 0 } };
  await Promise.all([client.data(session), client.data(session)]);
  assert.equal(refreshes, 1);
  assert.equal(session.tokens.refreshToken, 'rotated');
});

test('pagination uses nextToken and does not drop later pages', async () => {
  const client = createWhoopClient({ now: () => 100000, fetchImpl: async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/cycle')) return json(parsed.searchParams.has('nextToken') ? { records: [{ id: 2 }] } : { records: [{ id: 1 }], next_token: 'page-two' });
    return json({ records: [] });
  } });
  const data = await client.data({ tokens: { accessToken: 'test', expiresAt: Infinity } });
  assert.deepEqual(data.cycles, [{ id: 1 }, { id: 2 }]);
});

test('rate limits, missing pages and revoked access are not converted into empty health data', async () => {
  for (const [response, status] of [[json({}, 429), 429], [json({ wrong: [] }), 502], [json({}, 401), 401]]) {
    const client = createWhoopClient({ fetchImpl: async () => response.clone() });
    await assert.rejects(client.data({ tokens: { accessToken: 'test', expiresAt: Infinity } }), error => error.status === status);
  }
});

test('repeated pagination cursors fail explicitly', async () => {
  const client = createWhoopClient({ fetchImpl: async () => json({ records: [], next_token: 'same' }) });
  await assert.rejects(client.data({ tokens: { accessToken: 'test', expiresAt: Infinity } }), /incomplete data history/);
});

test('independent browser sessions are not affected by another user signing out', async t => {
  const { request, login } = await harness(t);
  const first = await login();
  const second = await login();
  await request('/api/logout', { method: 'POST', headers: { Origin: origin, Cookie: first.cookie } });
  assert.equal((await (await request('/api/session', { headers: { Cookie: first.cookie } })).json()).connected, false);
  assert.equal((await (await request('/api/session', { headers: { Cookie: second.cookie } })).json()).connected, true);
});

test('a report finishing after logout cannot return health data', async t => {
  let release;
  let started;
  const waiting = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { started = resolve; });
  const { request, login } = await harness(t, { fetchImpl: async url => {
    if (String(url).includes('/token')) return json(token);
    started();
    await waiting;
    return json({ records: [] });
  } });
  const { cookie } = await login();
  const headers = { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' };
  const pending = request('/api/report', { method: 'POST', headers, body: JSON.stringify({ timeZone: 'UTC' }) });
  await ready;
  await request('/api/logout', { method: 'POST', headers });
  release();
  const result = await pending;
  assert.equal(result.status, 401);
  assert.match((await result.json()).error, /session ended/);
});

test('the module does not expose demo action or reset endpoints', async t => {
  const { request } = await harness(t);
  for (const path of ['/api/action', '/api/reset']) {
    assert.equal((await request(path, { method: 'POST', headers: { Origin: origin } })).status, 404);
  }
});

const publicOrigin = 'https://care.example';
const accountSid = `AC${'1'.repeat(32)}`;
const callSid = `CA${'2'.repeat(32)}`;
const twilioConfig = { enabled: true, accountSid, authToken: 'test-auth-token', voiceApiKey: 'voice-test-key', voiceAgentId: 'voice-test-agent', fromNumber: '+12025550100', allowedNumbers: ['+12025550123'] };
const signedForm = (path, params) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': createHmac('sha1', twilioConfig.authToken).update(publicOrigin + path + Object.keys(params).sort().map(key => key + params[key]).join('')).digest('base64') }, body: new URLSearchParams(params).toString() });

test('Twilio webhooks verify the public URL and form without browser cookies or Origin', async t => {
  const { requestRoot } = await harness(t, { origin: publicOrigin, twilio: twilioConfig });
  const params = { AccountSid: accountSid, CallSid: callSid, CallStatus: 'completed', SequenceNumber: '3' };
  for (const kind of ['status', 'voice']) {
    const path = `/live-health/webhooks/twilio/${kind}?alert_id=unknown`;
    const options = signedForm(path, params);
    const response = await requestRoot(path, options);
    assert.equal(response.status, kind === 'status' ? 204 : 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (kind === 'voice') assert.match(await response.text(), /<Hangup\/>/);
    assert.equal((await requestRoot(path, { ...options, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 401);
    assert.equal((await requestRoot(path, { ...options, body: options.body + '&Digits=1' })).status, 401);
    assert.equal((await requestRoot(path + 'changed', options)).status, 401);
    assert.equal((await requestRoot(path, signedForm(path, { ...params, AccountSid: 'wrong-account' }))).status, 401);
    assert.equal((await requestRoot(path, { ...options, body: options.body + '&AccountSid=another' })).status, 401);
    assert.equal((await requestRoot(path)).status, 404);
  }
  assert.equal((await requestRoot('/retell/webhook', { method: 'POST' })).status, 404);
});

test('alert preferences are private, authenticated, same-origin and session-scoped', async t => {
  const { request, login } = await harness(t);
  assert.equal((await request('/api/alerts')).status, 401);
  const first = await login();
  const second = await login();
  const headers = { Origin: origin, Cookie: first.cookie, 'Content-Type': 'application/json' };
  const preferences = { ...emptyPreferences(), patientName: 'Private name', contact: { name: 'Private contact', phone: '+12025550123', relationship: 'Sibling' }, rules: { low_spo2: 93 } };
  assert.equal((await request('/api/alerts', { method: 'PUT', headers: { ...headers, Origin: 'https://other.example' }, body: JSON.stringify(preferences) })).status, 403);
  const saved = await request('/api/alerts', { method: 'PUT', headers, body: JSON.stringify(preferences) });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await saved.json()).preferences, preferences);
  assert.deepEqual((await (await request('/api/alerts', { headers: { Cookie: second.cookie } })).json()).preferences, emptyPreferences());
  assert.equal((await request('/api/alerts', { method: 'PUT', headers, body: JSON.stringify({ ...preferences, enabled: true, consent: true }) })).status, 503);
  await request('/api/logout', { method: 'POST', headers });
  assert.equal((await request('/api/alerts', { headers })).status, 401);
});

test('signed WHOOP updates call through Twilio and connect the voice agent only after confirmation', { timeout: 5000 }, async t => {
  let clock = Date.parse('2026-09-25T10:00:00Z');
  let notify;
  const called = new Promise(resolve => { notify = resolve; });
  const outbound = [];
  const voiceCalls = [];
  const { request, requestRoot, login } = await harness(t, { origin: publicOrigin, now: () => clock, twilio: twilioConfig, fetchImpl: async (url, init) => {
    if (String(url).includes('/token')) return json(token);
    if (String(url).includes('/user/profile/basic')) return json({ user_id: 42 });
    if (String(url).includes('api.twilio.com')) { outbound.push(new URLSearchParams(init.body)); notify(); return json({ sid: callSid }, 201); }
    if (String(url).includes('api.elevenlabs.io')) { voiceCalls.push(JSON.parse(init.body)); return new Response('<Response><Connect><Stream url="wss://api.elevenlabs.io/test" /></Connect></Response>'); }
    const path = new URL(url).pathname;
    if (path.endsWith('/activity/sleep')) return json({ records: [{ id: 'sleep-1', user_id: 42, nap: false, end: new Date(clock - 1000).toISOString(), score_state: 'SCORED', score: { respiratory_rate: 15 } }] });
    if (path.endsWith('/recovery')) return json({ records: [{ sleep_id: 'sleep-1', user_id: 42, score_state: 'SCORED', score: { resting_heart_rate: 99, user_calibrating: false } }] });
    return json({ records: [] });
  } });
  const { cookie } = await login();
  const headers = { Origin: publicOrigin, Cookie: cookie, 'Content-Type': 'application/json' };
  const preferences = { enabled: true, consent: true, patientName: 'Alex', contact: { name: 'Sam', phone: '+12025550123', relationship: '' }, rules: { high_resting_hr: 90 } };
  assert.equal((await request('/api/alerts', { method: 'PUT', headers, body: JSON.stringify(preferences) })).status, 200);
  assert.equal(outbound.length, 0);
  clock += 120000;
  const body = JSON.stringify({ user_id: 42, type: 'recovery.updated', id: 'sleep-1', trace_id: 'trace-1', resting_heart_rate: 200 });
  const timestamp = String(clock);
  const signature = createHmac('sha256', 'test-secret').update(timestamp + body).digest('base64');
  assert.equal((await request('/webhooks/whoop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
  const webhookHeaders = { 'Content-Type': 'application/json', 'X-WHOOP-Signature': signature, 'X-WHOOP-Signature-Timestamp': timestamp };
  assert.equal((await request('/webhooks/whoop', { method: 'POST', headers: webhookHeaders, body: body + ' ' })).status, 401);
  assert.equal((await request('/webhooks/whoop', { method: 'POST', headers: webhookHeaders, body })).status, 204);
  await called;
  assert.equal(outbound.length, 1);
  assert.equal(voiceCalls.length, 0);
  assert.doesNotMatch(outbound[0].get('Twiml'), /Alex|99 bpm/);
  await request('/webhooks/whoop', { method: 'POST', headers: webhookHeaders, body });
  assert.equal(outbound.length, 1);
  const statusUrl = new URL(outbound[0].get('StatusCallback'));
  const statusPath = statusUrl.pathname + statusUrl.search;
  const voicePath = statusPath.replace('/status?', '/voice?');
  const params = { AccountSid: accountSid, CallSid: callSid, From: '+12025550100', To: '+12025550123', CallStatus: 'in-progress', SequenceNumber: '2' };
  assert.equal((await requestRoot(voicePath, { method: 'POST', body: new URLSearchParams({ ...params, Digits: '1' }) })).status, 401);
  assert.equal(voiceCalls.length, 0);
  const connected = await requestRoot(voicePath, signedForm(voicePath, { ...params, Digits: '1' }));
  assert.equal(connected.status, 200);
  assert.match(connected.headers.get('content-type'), /text\/xml/);
  assert.match(await connected.text(), /<Connect>/);
  assert.match(voiceCalls[0].conversation_initiation_client_data.dynamic_variables.alert_summary, /99 bpm/);
  assert.doesNotMatch(voiceCalls[0].conversation_initiation_client_data.dynamic_variables.alert_summary, /200 bpm/);
  assert.match(await (await requestRoot(voicePath, signedForm(voicePath, { ...params, Digits: '1' }))).text(), /<Hangup\/>/);
  assert.equal(voiceCalls.length, 1);
  assert.equal((await requestRoot(statusPath, signedForm(statusPath, { ...params, CallStatus: 'completed', SequenceNumber: '3' }))).status, 204);
  assert.equal((await (await request('/api/alerts', { headers })).json()).events[0].status, 'ended');
  assert.equal((await request('/api/alerts/pause', { method: 'POST', headers })).status, 200);
  assert.equal((await (await request('/api/alerts', { headers })).json()).preferences.enabled, false);
});

test('the short-lived API cache expires and concurrent readers share one load', async () => {
  let clock = 100000;
  let requests = 0;
  const client = createWhoopClient({ now: () => clock, fetchImpl: async () => { requests++; return json({ records: [] }); } });
  const session = { tokens: { accessToken: 'test', expiresAt: Infinity } };
  await Promise.all([client.data(session), client.data(session)]);
  assert.equal(requests, 4);
  await client.data(session);
  assert.equal(requests, 4);
  clock += 60001;
  await client.data(session);
  assert.equal(requests, 8);
});
