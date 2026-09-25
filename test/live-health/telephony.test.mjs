import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTwilioSignature, createTelephony, hangup } from '../../lib/live-health/telephony.mjs';

const accountSid = `AC${'1'.repeat(32)}`;
const config = { enabled: true, accountSid, authToken: 'test-token', fromNumber: '+12025550100', voiceApiKey: 'test-voice-key', voiceAgentId: 'test-voice-agent', allowedNumbers: ['+12025550123'] };
const origin = 'https://care.example';

test('Twilio signatures bind the public URL and all form parameters', () => {
  const url = `${origin}/live-health/webhooks/twilio/status?alert_id=test`;
  const params = { CallSid: `CA${'2'.repeat(32)}`, AccountSid: accountSid, CallStatus: 'completed', SequenceNumber: '3' };
  const signature = createHmac('sha1', config.authToken).update(url + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64');
  assert.equal(verifyTwilioSignature(url, params, signature, config.authToken), true);
  assert.equal(verifyTwilioSignature(url.replace('https:', 'http:'), params, signature, config.authToken), false);
  assert.equal(verifyTwilioSignature(url, { ...params, CallStatus: 'ringing' }, signature, config.authToken), false);
  assert.equal(verifyTwilioSignature(url, params, signature, 'wrong'), false);
  assert.equal(verifyTwilioSignature(url, { ...params, Digits: ['1', '2'] }, signature, config.authToken), false);
  assert.equal(verifyTwilioSignature(url, params, '', config.authToken), false);
});

test('Twilio creates a private recipient gate without disclosing health data or recording', async () => {
  let sent;
  const phone = createTelephony({ origin, twilio: config, fetchImpl: async (url, init) => { sent = { url, init, form: new URLSearchParams(init.body) }; return new Response(JSON.stringify({ sid: `CA${'2'.repeat(32)}` }), { status: 201 }); } });
  assert.equal(phone.ready, true);
  await phone.call({ id: 'alert-1', contactName: 'Sam & Jo', to: '+12025550123' });
  assert.equal(sent.form.get('To'), '+12025550123');
  assert.equal(sent.form.get('From'), config.fromNumber);
  assert.equal(sent.form.get('Record'), 'false');
  assert.match(sent.form.get('Twiml'), /Sam &amp; Jo/);
  assert.match(sent.form.get('Twiml'), /Press 1/);
  assert.doesNotMatch(sent.form.get('Twiml'), /heart rate|oxygen|patient_name|alert_summary/);
  assert.equal(sent.form.get('StatusCallback'), `${origin}/live-health/webhooks/twilio/status?alert_id=alert-1`);
  assert.deepEqual(sent.form.getAll('StatusCallbackEvent'), ['initiated', 'ringing', 'answered', 'completed']);
  assert.match(sent.url, /\/Calls.json$/);
});

test('the two-way voice bridge uses a dedicated ElevenLabs agent with bounded context', async () => {
  let sent;
  const xml = '<Response><Connect><Stream url="wss://api.elevenlabs.io/test" /></Connect></Response>';
  const phone = createTelephony({ origin, twilio: config, fetchImpl: async (url, init) => { sent = { url, init, body: JSON.parse(init.body) }; return new Response(xml); } });
  assert.equal(await phone.connect({ to: '+12025550123', patientName: 'Alex', contactName: 'Sam', summary: 'Resting heart rate 95 bpm.' }), xml);
  assert.equal(sent.body.agent_id, 'test-voice-agent');
  assert.equal(sent.body.direction, 'outbound');
  assert.equal(sent.body.conversation_initiation_client_data.dynamic_variables.patient_name, 'Alex');
  assert.match(sent.body.conversation_initiation_client_data.conversation_config_override.agent.prompt.prompt, /not.*diagnosis/);
  assert.equal(sent.init.headers['xi-api-key'], config.voiceApiKey);
});

test('missing voice configuration or HTTPS origin never marks calling ready', () => {
  assert.equal(createTelephony({ origin, twilio: { ...config, voiceApiKey: '' } }).ready, false);
  assert.equal(createTelephony({ origin: 'http://localhost:3000', twilio: config }).ready, false);
  assert.equal(createTelephony({ origin, twilio: { ...config, enabled: false } }).ready, false);
  assert.doesNotMatch(hangup(), /Alex|Sam|reading/);
});
