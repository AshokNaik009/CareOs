import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { ALERT_RULES, emptyPreferences } from './alert-rules.mjs';
import { AppError } from './whoop.mjs';
import { createTelephony, phonePattern, callSidPattern, hangup } from './telephony.mjs';

const DAY = 86400000;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const cleanText = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f<>]/u.test(value);

export function validatePreferences(input) {
  if (!object(input) || typeof input.enabled !== 'boolean' || typeof input.consent !== 'boolean' || !cleanText(input.patientName, 80) || !object(input.contact) || !cleanText(input.contact.name, 80) || !cleanText(input.contact.relationship ?? '', 60) || !cleanText(input.contact.phone, 20) || !object(input.rules)) throw new AppError(400, 'Provide valid alert preferences and contact details.');
  const rules = {};
  for (const [id, threshold] of Object.entries(input.rules)) {
    const rule = ALERT_RULES.find(rule => rule.id === id && !rule.unavailable);
    if (!rule || !Number.isFinite(threshold) || threshold < rule.min || threshold > rule.max) throw new AppError(400, 'Select supported alerts and enter thresholds within the displayed ranges.');
    rules[id] = threshold;
  }
  if (rules.low_resting_hr != null && rules.high_resting_hr != null && rules.low_resting_hr >= rules.high_resting_hr) throw new AppError(400, 'The low heart-rate threshold must be lower than the high threshold.');
  const result = { enabled: input.enabled, consent: input.consent, patientName: input.patientName.trim(), contact: { name: input.contact.name.trim(), relationship: (input.contact.relationship ?? '').trim(), phone: input.contact.phone.trim() }, rules };
  if (result.contact.phone && !phonePattern.test(result.contact.phone)) throw new AppError(400, 'Use an international phone number beginning with + and the country code.');
  if (result.enabled && (!result.consent || !result.patientName || !result.contact.name || !phonePattern.test(result.contact.phone) || !Object.keys(rules).length)) throw new AppError(400, 'To enable calls, add your name, an emergency contact, at least one alert, and consent.');
  return result;
}

export function evaluateAlerts(data, rules, { now, armedAt, userId }) {
  const latest = records => [...new Map([...records].sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? '')).map(r => [r.id ?? r.sleep_id, r])).values()];
  const sleeps = latest(data.sleeps ?? []).filter(s => s.user_id === userId && s.nap === false).sort((a, b) => Date.parse(b.end) - Date.parse(a.end));
  const sleep = sleeps[0];
  const measuredAt = Date.parse(sleep?.end);
  if (!Number.isFinite(measuredAt) || measuredAt < armedAt || measuredAt > now || now - measuredAt > DAY) return [];
  const recovery = latest(data.recoveries ?? []).find(r => r.sleep_id === sleep.id && r.user_id === userId);
  return ALERT_RULES.flatMap(rule => {
    if (rule.unavailable || !Object.hasOwn(rules, rule.id)) return [];
    const record = rule.source === 'sleep' ? sleep : recovery;
    if (record?.score_state !== 'SCORED' || record.score?.user_calibrating === true) return [];
    const value = record.score?.[rule.field];
    if (!Number.isFinite(value) || value < 0 || (rule.field !== 'recovery_score' && value === 0) || (rule.unit === '%' && value > 100) || (rule.unit === 'bpm' && value > 300) || (rule.unit === 'breaths/min' && value > 100)) return [];
    const threshold = rules[rule.id];
    if (rule.direction === 'above' ? value < threshold : value > threshold) return [];
    return [{ ruleId: rule.id, title: rule.title, value, threshold, unit: rule.unit, direction: rule.direction, measuredAt: sleep.end, key: `${sleep.id}:${rule.id}` }];
  });
}

function matchesSignature(expected, supplied, encoding) {
  if (typeof supplied !== 'string') return false;
  const received = Buffer.from(supplied, encoding);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
const fresh = (timestamp, now) => /^\d{13}$/.test(timestamp ?? '') && Math.abs(now - Number(timestamp)) <= 300000;

export function verifyWhoopSignature(body, timestamp, signature, secret, now = Date.now()) {
  return Boolean(secret && fresh(timestamp, now) && matchesSignature(createHmac('sha256', secret).update(timestamp + body).digest(), signature, 'base64'));
}

export function createAlertService({ sessions, whoop, origin, twilio = {}, fetchImpl = fetch, now = Date.now }) {
  const approved = new Set((twilio.allowedNumbers ?? []).filter(n => phonePattern.test(n)));
  const phone = createTelephony({ origin, twilio, fetchImpl });
  const ready = phone.ready && approved.size > 0;
  const ledger = new Map();
  const webhooks = new Map();
  const calls = new Map();
  function cleanup() {
    for (const [id, entry] of ledger) {
      if (entry.expiresAt <= now()) ledger.delete(id);
      else for (const [key, expiresAt] of entry.seen) if (expiresAt <= now()) entry.seen.delete(key);
    }
    for (const [id, expiresAt] of webhooks) if (expiresAt <= now()) webhooks.delete(id);
    for (const [id, call] of calls) if (call.expiresAt <= now() || !active(call.session) || call.session.alerts !== call.state) calls.delete(id);
  }
  const active = session => !session.sample && session.expiresAt > now() && [...sessions.values()].includes(session);
  const view = session => ({ ready, preferences: session.alerts?.preferences ?? emptyPreferences(), armedAt: session.alerts?.armedAt ? new Date(session.alerts.armedAt).toISOString() : null, expiresAt: new Date(session.expiresAt).toISOString(), lastCheckedAt: session.alerts?.lastCheckedAt ?? null, issue: session.alerts?.issue ?? null, events: session.alerts?.events ?? [] });

  async function save(session, input) {
    if (session.sample) throw new AppError(403, 'Emergency calls are disabled for mock REST data.');
    const preferences = validatePreferences(input);
    if (preferences.enabled && !ready) throw new AppError(503, 'Twilio and the voice agent are not configured. Save with automatic calls switched off.');
    if (preferences.enabled && !approved.has(preferences.contact.phone)) throw new AppError(400, 'This contact number must first be approved in the server’s TWILIO_ALLOWED_NUMBERS setting.');
    const revision = Symbol();
    session.alertRevision = revision;
    if (preferences.enabled && !session.whoopUserId) session.whoopUserId = await whoop.userId(session);
    if (!active(session)) throw new AppError(401, 'Your session ended. Reconnect WHOOP before saving alerts.');
    if (session.alertRevision !== revision) throw new AppError(409, 'Alert settings changed while saving. Please reload them.');
    if (preferences.enabled && [...sessions.values()].some(other => other !== session && active(other) && other.whoopUserId === session.whoopUserId && other.alerts?.preferences.enabled)) throw new AppError(409, 'Alerts are already enabled for this WHOOP account in another session. Turn them off there first.');
    session.alerts = { preferences, armedAt: preferences.enabled ? now() : null, events: session.alerts?.events ?? [], lastCheckedAt: null, issue: null };
    return view(session);
  }

  function pause(session) {
    session.alertRevision = Symbol();
    if (session.alerts) session.alerts = { ...session.alerts, preferences: { ...session.alerts.preferences, enabled: false }, armedAt: null };
    return view(session);
  }

  async function evaluate(session, state) {
    try {
      const data = await whoop.data(session);
      if (!active(session) || session.alerts !== state || !state.preferences.enabled) return;
      state.lastCheckedAt = new Date(now()).toISOString();
      state.issue = null;
      const matches = evaluateAlerts(data, state.preferences.rules, { now: now(), armedAt: state.armedAt, userId: session.whoopUserId });
      cleanup();
      if (!matches.length) return;
      let entry = ledger.get(session.whoopUserId);
      if (!entry) {
        if (ledger.size >= 1000) { state.issue = 'Alert capacity reached. No call was placed.'; return; }
        entry = { seen: new Map(), lastAttemptAt: null, expiresAt: now() + 2 * DAY };
        ledger.set(session.whoopUserId, entry);
      }
      const unseen = matches.filter(match => !entry.seen.has(match.key));
      if (!unseen.length) return;
      for (const match of unseen) entry.seen.set(match.key, now() + 2 * DAY);
      const event = { id: randomUUID(), at: new Date(now()).toISOString(), readings: unseen, status: 'submitting' };
      const failed = status => { if (event.status === 'submitting') event.status = status; };
      state.events.unshift(event);
      state.events = state.events.slice(0, 20);
      if (entry.lastAttemptAt !== null && now() - entry.lastAttemptAt < DAY) { event.status = 'cooldown'; return; }
      entry.lastAttemptAt = now();
      entry.expiresAt = now() + 2 * DAY;
      const summary = unseen.map(m => `${m.title}: ${m.value} ${m.unit}, ${m.direction === 'above' ? 'at or above' : 'at or below'} the chosen threshold of ${m.threshold} ${m.unit}; measured at ${m.measuredAt}`).join('. ');
      const context = { session, state, event, summary, expiresAt: now() + 600000, voiceStarted: false, sequence: -1 };
      calls.set(event.id, context);
      try {
        const response = await phone.call({ id: event.id, contactName: state.preferences.contact.name, to: state.preferences.contact.phone });
        if (!response.ok) { failed(response.status >= 500 ? 'delivery_unknown' : 'failed'); return; }
        const call = await response.json();
        if (!callSidPattern.test(call.sid ?? '') || (event.callId && event.callId !== call.sid)) { failed('delivery_unknown'); return; }
        event.callId = call.sid;
        if (event.status === 'submitting') event.status = 'submitted';
      } catch { failed('delivery_unknown'); }
    } catch {
      if (active(session) && session.alerts === state) state.issue = 'WHOOP could not be checked. Monitoring is delayed; reconnect or sync WHOOP. No call was placed for this check.';
    }
  }

  function check(session) {
    if (!ready || !active(session) || !session.alerts?.preferences.enabled) return Promise.resolve();
    if (session.alertChecking) { session.alertCheckAgain = true; return session.alertChecking; }
    session.alertChecking = (async () => {
      do {
        session.alertCheckAgain = false;
        await evaluate(session, session.alerts);
      } while (session.alertCheckAgain && ready && active(session) && session.alerts?.preferences.enabled);
    })().finally(() => { session.alertChecking = null; });
    return session.alertChecking;
  }

  function handleWhoop(event) {
    if (!Number.isSafeInteger(event?.user_id) || typeof event.id !== 'string' || event.id.length > 100 || !['recovery.updated', 'sleep.updated', 'workout.updated', 'recovery.deleted', 'sleep.deleted', 'workout.deleted'].includes(event.type)) throw new AppError(400, 'Invalid WHOOP webhook event.');
    cleanup();
    if (typeof event.trace_id === 'string' && event.trace_id.length <= 100) {
      const key = `${event.user_id}:${event.type}:${event.trace_id}`;
      if (webhooks.has(key)) return;
      if (webhooks.size >= 5000) throw new AppError(503, 'Webhook capacity reached. Please retry later.');
      webhooks.set(key, now() + 300000);
    }
    for (const session of sessions.values()) {
      if (session.whoopUserId !== event.user_id || !active(session)) continue;
      const refresh = () => {
        session.cache = null;
        if (['recovery.updated', 'sleep.updated'].includes(event.type)) return check(session);
      };
      if (session.loading) void session.loading.then(refresh, refresh);
      else void refresh();
    }
  }

  function callContext(id, params) {
    cleanup();
    const context = calls.get(id);
    if (!context || params.AccountSid !== twilio.accountSid || !callSidPattern.test(params.CallSid ?? '') || params.From !== twilio.fromNumber || params.To !== context.state.preferences.contact.phone || (context.event.callId && context.event.callId !== params.CallSid)) return null;
    context.event.callId = params.CallSid;
    return context;
  }

  function handleTwilio(id, params) {
    const context = callContext(id, params);
    const statuses = { queued: 'submitted', initiated: 'submitted', ringing: 'ringing', 'in-progress': 'in_progress', completed: 'ended', busy: 'not_reached', 'no-answer': 'not_reached', canceled: 'not_reached', failed: 'failed' };
    if (!context || !Object.hasOwn(statuses, params.CallStatus) || ['ended', 'not_reached', 'failed'].includes(context.event.status)) return;
    const sequence = /^\d+$/.test(params.SequenceNumber ?? '') ? Number(params.SequenceNumber) : null;
    if (sequence === null || !Number.isSafeInteger(sequence) || sequence <= context.sequence) return;
    context.sequence = sequence;
    context.event.status = statuses[params.CallStatus];
  }

  async function handleVoice(id, params) {
    const context = callContext(id, params);
    if (!context || !ready || !context.state.preferences.enabled || context.voiceStarted || ['ended', 'not_reached', 'failed'].includes(context.event.status)) return hangup();
    context.voiceStarted = true;
    if (params.Digits !== '1') { context.event.voiceStatus = 'declined'; return hangup(); }
    const preferences = context.state.preferences;
    context.event.voiceStatus = 'connecting';
    try {
      const twiml = await phone.connect({ to: preferences.contact.phone, patientName: preferences.patientName, contactName: preferences.contact.name, summary: context.summary });
      if (!callContext(id, params) || ['ended', 'not_reached', 'failed'].includes(context.event.status)) return hangup();
      context.event.voiceStatus = 'connected';
      return twiml;
    } catch {
      context.event.voiceStatus = 'failed';
      return hangup();
    }
  }

  return { save, pause, view, check, handleWhoop, handleTwilio, handleVoice, cleanup, dispose: () => { ledger.clear(); webhooks.clear(); calls.clear(); } };
}
