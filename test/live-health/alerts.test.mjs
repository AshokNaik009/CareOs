import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { evaluateAlerts, validatePreferences, verifyWhoopSignature, verifyRetellSignature, createAlertService } from '../../lib/live-health/alerts.mjs';

const clock = Date.parse('2026-09-25T10:00:00Z');
const preferences = () => ({ enabled: true, consent: true, patientName: 'Alex', contact: { name: 'Sam', relationship: 'Sibling', phone: '+12025550123' }, rules: { high_resting_hr: 90, low_spo2: 94 } });
const fixture = () => ({ sleeps: [{ id: 'sleep-1', user_id: 42, nap: false, end: new Date(clock - 60000).toISOString(), score_state: 'SCORED', score: { respiratory_rate: 22 } }], recoveries: [{ sleep_id: 'sleep-1', user_id: 42, updated_at: new Date(clock).toISOString(), score_state: 'SCORED', score: { resting_heart_rate: 95, spo2_percentage: 92, user_calibrating: false } }] });

function serviceHarness(options = {}) {
  const session = { tokens: {}, expiresAt: clock + 86400000, whoopUserId: 42 };
  const sessions = new Map([['session', session]]);
  const calls = [];
  let data = fixture();
  const service = createAlertService({ sessions, whoop: { data: async () => data, userId: async () => 42 }, now: () => clock, retell: { enabled: true, apiKey: 'test-only-key', agentId: 'test-agent', fromNumber: '+12025550100', allowedNumbers: ['+12025550123'] }, fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ call_id: 'call-1' }), { status: 201 }); }, ...options });
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

test('webhooks validate raw body, timestamp, signature and secret', () => {
  const body = '{ "user_id": 42 }';
  const stamp = String(clock);
  const whoop = createHmac('sha256', 'secret').update(stamp + body).digest('base64');
  const retell = `v=${stamp},d=${createHmac('sha256', 'secret').update(body + stamp).digest('hex')}`;
  assert.equal(verifyWhoopSignature(body, stamp, whoop, 'secret', clock), true);
  assert.equal(verifyRetellSignature(body, retell, 'secret', clock), true);
  for (const [value, secret, time] of [[body + ' ', 'secret', clock], [body, 'wrong', clock], [body, 'secret', clock + 300001], [body, '', clock]]) {
    assert.equal(verifyWhoopSignature(value, stamp, whoop, secret, time), false);
    assert.equal(verifyRetellSignature(value, retell, secret, time), false);
  }
  assert.equal(verifyRetellSignature(body, 'v=no,d=bad', 'secret', clock), false);
});

test('arming never calls on historical readings; new readings produce one combined Retell call', async () => {
  const h = serviceHarness();
  await h.service.save(h.session, preferences());
  await h.service.check(h.session);
  assert.equal(h.calls.length, 0);
  h.session.alerts.armedAt = clock - 120000;
  await Promise.all([h.service.check(h.session), h.service.check(h.session)]);
  await h.service.check(h.session);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.to_number, '+12025550123');
  assert.equal(h.calls[0].body.override_agent_id, 'test-agent');
  assert.match(h.calls[0].body.retell_llm_dynamic_variables.alert_summary, /95 bpm/);
  assert.match(h.calls[0].body.retell_llm_dynamic_variables.alert_summary, /92 %/);
  assert.equal(h.service.view(h.session).events[0].status, 'submitted');
});

test('disabled calling, unapproved destinations and missing consent cannot arm calls', async () => {
  const h = serviceHarness({ retell: {} });
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

test('Retell callbacks are scoped to submitted alert IDs and do not regress terminal status', async () => {
  const h = serviceHarness();
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  await h.service.check(h.session);
  const alert = h.service.view(h.session).events[0];
  const call = { call_id: 'call-1', agent_id: 'test-agent', metadata: { alert_id: alert.id }, call_status: 'ended', disconnection_reason: 'dial_no_answer' };
  h.service.handleRetell({ event: 'call_ended', call: { ...call, agent_id: 'wrong' } });
  assert.equal(alert.status, 'submitted');
  h.service.handleRetell({ event: 'call_ended', call });
  assert.equal(alert.status, 'not_reached');
  h.service.handleRetell({ event: 'call_started', call });
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

test('a Retell callback arriving before an API timeout retains its confirmed status', async () => {
  const h = serviceHarness({ fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body);
    h.service.handleRetell({ event: 'call_ended', call: { call_id: 'call-1', agent_id: 'test-agent', metadata: body.metadata, call_status: 'ended' } });
    throw new Error('Response lost');
  } });
  await h.service.save(h.session, preferences());
  h.session.alerts.armedAt = clock - 120000;
  await h.service.check(h.session);
  assert.equal(h.service.view(h.session).events[0].status, 'ended');
});

test('ambiguous Retell failures are visible and never automatically redialed', async () => {
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
