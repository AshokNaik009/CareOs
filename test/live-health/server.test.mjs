import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
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
  return { request, login, calls };
}

test('session endpoint exposes no secrets and disables caching', async t => {
  const { request } = await harness(t);
  const res = await request('/api/session');
  assert.deepEqual(await res.json(), { configured: true, connected: false });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('unconfigured app does not attempt authorization', async t => {
  const { request } = await harness(t, { clientId: '', clientSecret: '' });
  assert.deepEqual(await (await request('/api/session')).json(), { configured: false, connected: false });
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
