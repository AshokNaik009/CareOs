import { createHmac, timingSafeEqual } from 'node:crypto';
import { ALERT_AGENT_PROMPT } from './alert-rules.mjs';
import { AppError } from './whoop.mjs';

export const phonePattern = /^\+[1-9]\d{7,14}$/;
export const callSidPattern = /^CA[a-fA-F0-9]{32}$/;
const accountPattern = /^AC[a-fA-F0-9]{32}$/;
const xml = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);
export const hangup = () => '<Response><Say>This call cannot continue. Please contact the person directly if you are concerned. Goodbye.</Say><Hangup/></Response>';

export function verifyTwilioSignature(url, params, signature, token) {
  if (!token || typeof signature !== 'string' || !params || typeof params !== 'object' || Array.isArray(params) || Object.values(params).some(value => typeof value !== 'string')) return false;
  const message = url + Object.keys(params).sort().map(key => key + params[key]).join('');
  const expected = createHmac('sha1', token).update(message).digest();
  const received = Buffer.from(signature, 'base64');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function createTelephony({ origin, twilio = {}, fetchImpl = fetch }) {
  const ready = Boolean(twilio.enabled === true && accountPattern.test(twilio.accountSid ?? '') && twilio.authToken && phonePattern.test(twilio.fromNumber ?? '') && twilio.voiceApiKey && twilio.voiceAgentId && origin?.startsWith('https://'));
  const callback = (kind, id) => `${origin}/live-health/webhooks/twilio/${kind}?alert_id=${encodeURIComponent(id)}`;
  return {
    ready,
    async call({ id, contactName, to }) {
      if (!ready || !phonePattern.test(to)) throw new AppError(503, 'Twilio voice calling is not configured.');
      const twiml = `<Response><Gather input="dtmf" numDigits="1" timeout="6" action="${xml(callback('voice', id))}" method="POST"><Say>This is Rafeeq, an automated AI check-in call for ${xml(contactName)}. Press 1 if you are this person and agree to speak with our AI assistant. Otherwise, please hang up.</Say></Gather><Hangup/></Response>`;
      const form = new URLSearchParams({ To: to, From: twilio.fromNumber, Twiml: twiml, Record: 'false', Timeout: '20', TimeLimit: '180', StatusCallback: callback('status', id), StatusCallbackMethod: 'POST' });
      for (const event of ['initiated', 'ringing', 'answered', 'completed']) form.append('StatusCallbackEvent', event);
      return fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Calls.json`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    },
    async connect({ to, patientName, contactName, summary }) {
      const response = await fetchImpl('https://api.elevenlabs.io/v1/convai/twilio/register-call', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { 'xi-api-key': twilio.voiceApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: twilio.voiceAgentId, from_number: twilio.fromNumber, to_number: to, direction: 'outbound', conversation_initiation_client_data: {
          dynamic_variables: { patient_name: patientName, contact_name: contactName, alert_summary: summary },
          conversation_config_override: { agent: { prompt: { prompt: ALERT_AGENT_PROMPT }, first_message: 'Hello, I am Rafeeq, an AI wellness assistant. Before we discuss the check-in, could you confirm your name?' } },
        } }),
      });
      if (!response.ok) throw new AppError(502, 'The voice agent could not be connected.');
      const twiml = await response.text();
      if (twiml.length > 65536 || !/<Response[\s>]/.test(twiml) || !twiml.includes('<Connect>') || !twiml.includes('<Stream')) throw new AppError(502, 'The voice agent returned an invalid call response.');
      return twiml;
    },
  };
}
