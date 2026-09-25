import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { evaluateAlerts, validatePreferences, verifyWhoopSignature, createAlertService } from '../../lib/live-health/alerts.mjs';

const accountSid = `AC${'1'.repeat(32)}`;
const callSid = `CA${'2'.repeat(32)}`;
const callbackParams = (extra = {}) => ({ AccountSid: accountSid, CallSid: callSid, From: '+12025550100', To: '+12025550123', SequenceNumber: '0', ...extra });

const clock = Date.parse('2026-09-25T10:00:00Z');
const preferences = () => ({ enabled: true, consent: true, patientName: 'Alex', contact: { name: 'Sam', relationship: 'Sibling', phone: '+12025550123' }, rules: { high_resting_hr: 90, low_spo2: 94 } });
const fixture = () => ({ sleeps: [{ id: 'sleep-1', user_id: 42, nap: false, end: new Date(clock - 60000).toISOString(), score_state: 'SCORED', score: { respiratory_rate: 22 } }], recoveries: [{ sleep_id: 'sleep-1', user_id: 42, updated_at: new Date(clock).toISOString(), score_state: 'SCORED', score: { resting_heart_rate: 95, spo2_percentage: 92, user_calibrating: false } }] });

function serviceHarness(options = {}) {
  const session = { tokens: {}, expiresAt: clock + 86400000, whoopUserId: 42 };
  const sessions = new Map([['session', session]]);
  const calls = [];
  let data = fixture();
  const service = createAlertService({ sessions, origin: 'https://care.example', whoop: { data: async () => data, userId: async () => 42 }, now: () => clock, twilio: { enabled: true, accountSid, authToken: 'test-only-key', voiceApiKey: 'voice-test-only-key', voiceAgentId: 'test-agent', fromNumber: '+12025550100', allowedNumbers: ['+12025550123'] }, fetchImpl: async (url, init) => {
    const voice = url.includes('elevenlabs');
    calls.push({ url, body: voice ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body)) });
    return voice ? new Response('<Response><Connect><Stream url="wss://api.elevenlabs.io/test" /></Connect></Response>') : new Response(JSON.stringify({ sid: callSid }), { status: 201 });
  }, ...options });
  return { service, session, sessions, calls, setData: value => { data = value; } };
}

test('preferences require supported rules, explicit consent and valid contacts', () => {
  assert.deepEqual(validatePreferences(preferences()), preferences());
  for (const change of [{ rules: { high_blood_pressure: 140 } }, { rules: { high_resting_hr: '90' } }, { rules: { low_spo2: 101 } }, { rules: {} }, { consent: false }, { contact: { name: 'Sam', phone: '911' } }, { patientName: '' }, { enabled: 'yes' }]) {
    assert.throws(() => validatePreferences({ ...preferences(), ...change }), error => error.status === 400);
  }
  assert.throws(() => validatePreferences({ ...preferences(), rules: { high_resting_hr: 60, low_resting_hr: 70 } }), /lower/);
});

test('only fresh, scored, same-user WHOOP readings cross inclusive thresholds', () => {
  const matches = evaluateAlerts(fixture(), preferences().rules, { now: clock, armedAt: clock - 120000, userId: 42 });
  assert.deepEqual(matches.map(m => m.ruleId), ['high_resting_hr', 'low_spo2']);
  assert.equal(matches[0].value, 95);
  assert.equal(evaluateAlerts(fixture(), { high_resting_hr: 95 }, { now: clock, armedAt: clock - 120000, userId: 42 }).length, 1);
  for (const mutate of [data => { data.recoveries[0].score_state = 'PENDING_SCORE'; }, data => { data.recoveries[0].score.user_calibrating = true; }, data => { data.recoveries[0].score = {}; }, data => { data.sleeps[0].nap = true; }, data => { data.sleeps[0].end = new Date(clock - 86400001).toISOString(); }, data => { data.sleeps[0].end = new Date(clock + 1000).toISOString(); }, data => { data.recoveries[0].user_id = 43; }]) {
    const data = fixture();
    mutate(data);
    assert.deepEqual(evaluateAlerts(data, preferences().rules, { now: clock, armedAt: clock - 172800000, userId: 42 }), []);
  }
  assert.deepEqual(evaluateAlerts(fixture(), preferences().rules, { now: clock, armedAt: clock, userId: 42 }), []);
});

test('WHOOP webhooks validate raw body, timestamp, signature and secret', () => {
  const body = '{ "user_id": 42 }';
  const stamp = String(clock);
  const whoop = createHmac('sha256', 'secret').update(stamp + body).digest('base64');
  assert.equal(verifyWhoopSignature(body, stamp, whoop, 'secret', clock), true);
  for (const [value, secret, time] of [[body + ' ', 'secret', clock], [body, 'wrong', clock], [body, 'secret', clock + 300001], [body, '', clock]]) assert.equal(verifyWhoopSignature(value, stamp, whoop, secret, time), false);
});

test('arming never calls on historical readings; new readings produce one combined Twilio call', async () => {
  const h = serviceHarness();
  await h.service.save(h.session, preferences());
  await h.service.check(h.session);
  assert.equal(h.calls.length, 0);
  h.session.alerts.armedAt = clock - 120000;
  await Promise.all([h.service.check(h.session), h.service.check(h.session)]);
  await h.service.check(h.session);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.To, '+12025550123');
  const event = h.service.view(h.session).events[0];
  assert.equal(event.status, 'submitted');
  assert.doesNotMatch(h.calls[0].body.Twiml, /95 bpm|Alex/);
  assert.match(await h.service.handleVoice(event.id, callbackParams({ Digits: '1' })), /<Connect>/);
  assert.equal(h.calls[1].body.agent_id, 'test-agent');
  assert.match(h.calls[1].body.conversation_initiation_client_data.dynamic_variables.alert_summary, /95 bpm/);
  assert.match(h.calls[1].body.conversation_initiation_client_data.dynamic_variables.alert_summary, /92 %/);
  assert.match(await h.service.handleVoice(event.id, callbackParams({ Digits: '1' })), /<Hangup\/>/);
  assert.equal(h.calls.length, 2);
});

test('disabled calling, unapproved destinations and missing consent cannot arm calls', async () => {
  const h = serviceHarness({ twilio: {} });
  await assert.rejects(h.service.save(h.session, preferences()), error => error.status === 503);
  const ready = serviceHarness();
  await assert.rejects(ready.service.save(ready.session, { ...preferences(), contact: { name: 'Other', phone: '+12025550199', relationship: '' } }), error => error.status === 400);
  assert.equal(ready.calls.length, 0);
});

test('logout during a WHOOP fetch prevents a call', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const h = serviceHarness({ whoop: { userId: async () => 42, data: async () => { await waiting; return fixture(); } } });
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  const pending = h.service.check(h.session);
  h.sessions.clear();
  release();
  await pending;
  assert.equal(h.calls.length, 0);
});

test('pausing and expiry during a WHOOP fetch prevent a call', async () => {
  for (const action of ['pause', 'expire', 'save']) {
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    const h = serviceHarness({ whoop: { data: async () => { await waiting; return fixture(); } } });
    await h.service.save(h.session, preferences());
    h.session.alerts.armedAt = clock - 120000;
    const pending = h.service.check(h.session);
    if (action === 'pause') h.service.pause(h.session);
    if (action === 'expire') h.session.expiresAt = clock;
    if (action === 'save') await h.service.save(h.session, { ...preferences(), enabled: false });
    release();
    await pending;
    assert.equal(h.calls.length, 0);
  }
});

test('pause cannot be overwritten by an earlier in-flight enable request', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const h = serviceHarness({ whoop: { userId: async () => { await waiting; return 42; } } });
  delete h.session.whoopUserId;
  const pending = h.service.save(h.session, preferences());
  h.service.pause(h.session);
  release();
  await assert.rejects(pending, error => error.status === 409);
  assert.equal(h.service.view(h.session).preferences.enabled, false);
});

test('new matching readings respect the cooldown even across sign-out and reconnection', async () => {
  const h = serviceHarness();
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  await h.service.check(h.session);
  const second = { tokens: {}, expiresAt: clock + 86400000, whoopUserId: 42 };
  h.sessions.set('second', second);
  await assert.rejects(h.service.save(second, preferences()), error => error.status === 409);
  h.sessions.delete('session');
  await h.service.save(second, preferences());
  second.alerts.armedAt = clock - 120000;
  await h.service.check(second);
  assert.equal(h.calls.length, 1);
  const data = fixture();
  data.sleeps[0].id = 'sleep-2';
  data.recoveries[0].sleep_id = 'sleep-2';
  h.setData(data);
  await h.service.check(second);
  assert.equal(h.calls.length, 1);
  assert.equal(h.service.view(second).events[0].status, 'cooldown');
});

test('WHOOP events match only the authenticated account and dedupe delivery retries', async () => {
  const h = serviceHarness();
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  h.service.handleWhoop({ user_id: 43, type: 'recovery.updated', id: 'sleep-1', trace_id: 'other' });
  assert.equal(h.session.alertChecking, undefined);
  const event = { user_id: 42, type: 'recovery.updated', id: 'sleep-1', trace_id: 'trace-1' };
  h.service.handleWhoop(event);
  await h.session.alertChecking;
  assert.equal(h.calls.length, 1);
  h.service.handleWhoop(event);
  assert.equal(h.session.alertChecking, null);
  h.service.handleWhoop({ ...event, type: 'recovery.deleted', trace_id: 'delete-1' });
  assert.equal(h.session.alertChecking, null);
});

test('Twilio callbacks are scoped to submitted alert IDs and do not regress terminal status', async () => {
  const h = serviceHarness();
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  await h.service.check(h.session);
  const alert = h.service.view(h.session).events[0];
  const params = callbackParams({ CallStatus: 'no-answer', SequenceNumber: '3' });
  h.service.handleTwilio(alert.id, { ...params, AccountSid: 'wrong' });
  assert.equal(alert.status, 'submitted');
  h.service.handleTwilio(alert.id, params);
  assert.equal(alert.status, 'not_reached');
  h.service.handleTwilio(alert.id, callbackParams({ CallStatus: 'in-progress', SequenceNumber: '2' }));
  assert.equal(alert.status, 'not_reached');
});

test('all available rule types use their scored sources without inventing missing values', () => {
  const data = fixture();
  data.recoveries[0].score.resting_heart_rate = 40;
  data.recoveries[0].score.recovery_score = 0;
  const rules = { low_resting_hr: 40, high_respiratory_rate: 22, low_recovery: 10 };
  assert.deepEqual(evaluateAlerts(data, rules, { now: clock, armedAt: clock - 120000, userId: 42 }).map(m => m.ruleId), ['low_resting_hr', 'high_respiratory_rate', 'low_recovery']);
  data.recoveries[0].score.resting_heart_rate = 0;
  data.sleeps[0].score_state = 'PENDING_SCORE';
  assert.deepEqual(evaluateAlerts(data, rules, { now: clock, armedAt: clock - 120000, userId: 42 }).map(m => m.ruleId), ['low_recovery']);
});

test('a Twilio callback arriving before an API timeout retains its confirmed status', async () => {
  const h = serviceHarness({ fetchImpl: async (url, init) => {
    const body = new URLSearchParams(init.body);
    const id = new URL(body.get('StatusCallback')).searchParams.get('alert_id');
    h.service.handleTwilio(id, callbackParams({ CallStatus: 'completed', SequenceNumber: '3' }));
    throw new Error('Response lost');
  } });
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  await h.service.check(h.session);
  assert.equal(h.service.view(h.session).events[0].status, 'ended');
});

test('voice handoff rejects wrong recipients, call SIDs, unknown alerts and declined consent', async () => {
  const h = serviceHarness();
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  await h.service.check(h.session);
  const id = h.service.view(h.session).events[0].id;
  for (const params of [callbackParams({ Digits: '1', To: '+12025550999' }), callbackParams({ Digits: '1', AccountSid: 'wrong' }), callbackParams({ Digits: '1', CallSid: `CA${'3'.repeat(32)}` })]) {
    assert.match(await h.service.handleVoice(id, params), /<Hangup\/>/);
  }
  assert.match(await h.service.handleVoice('unknown', callbackParams({ Digits: '1' })), /<Hangup\/>/);
  assert.match(await h.service.handleVoice(id, callbackParams({ Digits: '2' })), /<Hangup\/>/);
  assert.match(await h.service.handleVoice(id, callbackParams({ Digits: '1' })), /<Hangup\/>/);
  assert.equal(h.calls.length, 1);
});

test('paused, signed-out and expired sessions never release voice-agent context', async () => {
  for (const action of ['pause', 'logout', 'expire']) {
    let time = clock;
    const h = serviceHarness({ now: () => time });
    await h.service.save(h.session, preferences());
    h.session.alerts.armedAt = clock - 120000;
    await h.service.check(h.session);
    const id = h.service.view(h.session).events[0].id;
    if (action === 'pause') h.service.pause(h.session);
    if (action === 'logout') h.sessions.clear();
    if (action === 'expire') time += 600001;
    assert.match(await h.service.handleVoice(id, callbackParams({ Digits: '1' })), /<Hangup\/>/);
    assert.equal(h.calls.length, 1);
  }
});

test('pausing during voice registration prevents a late bridge and duplicate registration', async () => {
  let release;
  let registrations = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const h = serviceHarness({ fetchImpl: async url => {
    if (url.includes('twilio.com')) return new Response(JSON.stringify({ sid: callSid }), { status: 201 });
    registrations++;
    await waiting;
    return new Response('<Response><Connect><Stream url="wss://api.elevenlabs.io/test" /></Connect></Response>');
  } });
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  await h.service.check(h.session);
  const id = h.service.view(h.session).events[0].id;
  const pending = h.service.handleVoice(id, callbackParams({ Digits: '1' }));
  assert.match(await h.service.handleVoice(id, callbackParams({ Digits: '1' })), /<Hangup\/>/);
  h.service.pause(h.session);
  release();
  assert.match(await pending, /<Hangup\/>/);
  assert.equal(registrations, 1);
});

test('voice provider failures hang up without reading health details or retrying', async () => {
  let attempts = 0;
  const h = serviceHarness({ fetchImpl: async url => {
    if (url.includes('twilio.com')) return new Response(JSON.stringify({ sid: callSid }), { status: 201 });
    attempts++;
    throw new Error('provider secret failure');
  } });
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  await h.service.check(h.session);
  const event = h.service.view(h.session).events[0];
  const response = await h.service.handleVoice(event.id, callbackParams({ Digits: '1' }));
  assert.match(response, /<Hangup\/>/);
  assert.doesNotMatch(response, /Alex|95|secret/);
  assert.equal(event.voiceStatus, 'failed');
  await h.service.handleVoice(event.id, callbackParams({ Digits: '1' }));
  assert.equal(attempts, 1);
});

test('ambiguous Twilio failures are visible and never automatically redialed', async () => {
  let attempts = 0;
  const h = serviceHarness({ fetchImpl: async () => { attempts++; throw new Error('timeout with secret'); } });
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  await h.service.check(h.session);
  await h.service.check(h.session);
  assert.equal(attempts, 1);
  assert.equal(h.service.view(h.session).events[0].status, 'delivery_unknown');
  assert.doesNotMatch(JSON.stringify(h.service.view(h.session)), /timeout with secret|test-only-key/);
});
