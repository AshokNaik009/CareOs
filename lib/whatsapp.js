// WhatsApp messages through Twilio: the shared WhatsApp Sandbox on trial accounts (the recipient must
// first send the sandbox "join …" code), or an approved WhatsApp sender in production.

const E164 = /^\+[1-9]\d{7,14}$/;
const SANDBOX_FROM = '+14155238886';
const FAILED = ['failed', 'undelivered'];

async function twilio(accountSid, authToken, method, url, form) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}${url}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(json && json.message) || res.statusText}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends `body` to `to` and waits briefly for Twilio's delivery verdict, so a recipient who hasn't
// joined the sandbox shows up as an error instead of a silent "queued".
async function sendWhatsApp({ accountSid, authToken, from = SANDBOX_FROM, to, body }) {
  if (!accountSid || !authToken) throw new Error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env.');
  if (!E164.test(to || '')) throw new Error(`"${to}" is not an E.164 phone number (e.g. +971501234567).`);
  let msg = await twilio(accountSid, authToken, 'POST', '/Messages.json', { From: `whatsapp:${from}`, To: `whatsapp:${to}`, Body: body });
  for (let i = 0; i < 5 && ['accepted', 'queued', 'sending'].includes(msg.status); i++) {
    await sleep(1000);
    msg = await twilio(accountSid, authToken, 'GET', `/Messages/${msg.sid}.json`);
  }
  if (FAILED.includes(msg.status)) {
    const hint = msg.error_code === 63015 ? ' The recipient has not joined the WhatsApp Sandbox yet: send the "join …" code to the sandbox number first.' : '';
    throw new Error(`WhatsApp message ${msg.status} (Twilio error ${msg.error_code}).${hint}`);
  }
  return { sid: msg.sid, status: msg.status };
}

module.exports = { sendWhatsApp, SANDBOX_FROM };
