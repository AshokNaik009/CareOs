// Real outbound phone calls: ElevenLabs dials through a Twilio number imported into the ElevenLabs
// account (Agents → Phone numbers) and runs the given agent on the call.

const API = 'https://api.elevenlabs.io';
const E164 = /^\+[1-9]\d{7,14}$/;

async function call(apiKey, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const detail = json && json.detail ? (typeof json.detail === 'string' ? json.detail : json.detail.message || JSON.stringify(json.detail)) : text.slice(0, 300);
    throw new Error(`ElevenLabs ${res.status}: ${detail}`);
  }
  return json;
}

// The Twilio number to call from: ELEVENLABS_PHONE_NUMBER_ID if set, otherwise the first Twilio number.
async function fromNumber(apiKey, phoneNumberId) {
  const list = await call(apiKey, 'GET', '/v1/convai/phone-numbers');
  const n = phoneNumberId ? list.find((x) => x.phone_number_id === phoneNumberId) : list.find((x) => x.provider === 'twilio');
  if (!n) throw new Error(phoneNumberId ? `Phone number ${phoneNumberId} not found in ElevenLabs.` : 'No Twilio number imported into ElevenLabs (Agents → Phone numbers).');
  if (n.provider !== 'twilio') throw new Error(`Phone number ${n.phone_number} uses ${n.provider}; only Twilio numbers are supported.`);
  return n;
}

// Rings `toNumber` and runs `agentId` on the call. Resolves once the call is placed, not when answered.
async function outboundCall(apiKey, { agentId, phoneNumberId, toNumber, dynamicVariables }) {
  if (!E164.test(toNumber || '')) throw new Error(`"${toNumber}" is not an E.164 phone number (e.g. +971501234567).`);
  const from = await fromNumber(apiKey, phoneNumberId);
  const r = await call(apiKey, 'POST', '/v1/convai/twilio/outbound-call', {
    agent_id: agentId,
    agent_phone_number_id: from.phone_number_id,
    to_number: toNumber,
    conversation_initiation_client_data: { dynamic_variables: dynamicVariables },
  });
  if (!r || r.success === false) throw new Error((r && r.message) || 'Call was not placed.');
  return { conversationId: r.conversation_id, callSid: r.callSid, from: from.phone_number };
}

// "+971501234567" → "+971 ••• 4567", for showing the target number in the UI.
const maskNumber = (n) => (n && n.length > 8 ? `${n.slice(0, 4)} ••• ${n.slice(-4)}` : n || '');

module.exports = { outboundCall, maskNumber, E164 };
