// Rafeeq — demo server. Plain Node (no framework). The ElevenLabs key never leaves this process:
// browsers only ever receive short-lived signed conversation URLs.

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- env ----
(function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})();

const API_KEY = process.env.ELEVENLABS_API_KEY;
const LLM = process.env.AGENT_LLM || 'claude-haiku-4-5';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const { PATIENTS, CONTRACT, PROGRAM_BENEFITS, namesFor, buildPopulation, costSeries, NOW, DAY } = require('./lib/data');
const { findingsFor, contextFor } = require('./lib/findings');
const { ensureAgents, signedUrl, arabicAddressRule } = require('./lib/agents');
const { createBookingFlow, BookingError } = require('./lib/booking');
const { completeJson } = require('./lib/llm');
const phone = require('./lib/phone');

// Real phone calls from the Care OS: number to dial, and optionally which imported ElevenLabs number to call from.
const OUTBOUND_CALL_TO = (process.env.OUTBOUND_CALL_TO || '').trim();
const PHONE_NUMBER_ID = (process.env.ELEVENLABS_PHONE_NUMBER_ID || '').trim();
const { sendWhatsApp, SANDBOX_FROM } = require('./lib/whatsapp');
// WhatsApp messages from the Care OS: recipient, and the Twilio sender (defaults to the WhatsApp Sandbox).
const OUTBOUND_WHATSAPP_TO = (process.env.OUTBOUND_WHATSAPP_TO || '').trim();
const WHATSAPP_FROM = (process.env.TWILIO_WHATSAPP_FROM || SANDBOX_FROM).trim();
const whoop = require('./lib/whoop');

// ---- in-memory state ----
const state = {
  agents: null,
  agentError: null,
  members: buildPopulation(),
  events: [],
  bookings: [],      // { patientId, ... }
  preauths: [],
  visitPreps: {},    // patientId -> prep
  savings: 0,        // AED, expected avoided admission cost from gaps closed this session
  gapsClosed: 0,
};
const costs = costSeries();
const bookingFlow = createBookingFlow({ slot });

// Restore the synthetic data to its initial state and tell every open page to reload.
function resetDemo() {
  bookingFlow.clear();
  Object.assign(state, { members: buildPopulation(), events: [], bookings: [], preauths: [], visitPreps: {}, savings: 0, gapsClosed: 0 });
  const payload = `data: ${JSON.stringify({ id: 0, at: new Date().toISOString(), type: 'reset' })}\n\n`;
  for (const res of sseClients) res.write(payload);
}

// ---- helpers ----
const sseClients = new Set();
function emit(type, data) {
  const ev = { id: state.events.length + 1, at: new Date().toISOString(), type, ...data };
  state.events.push(ev);
  const payload = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of sseClients) res.write(payload);
  return ev;
}

const ref = (prefix) => `${prefix}-${Math.floor(10000 + Math.random() * 90000)}`;
const todayLong = () => NOW.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function slot(urgencyOrPref = '') {
  const pref = String(urgencyOrPref).toLowerCase();
  let offset = /urgent/.test(pref) ? 1 : /soon|next week/.test(pref) ? 5 : /routine/.test(pref) ? 12 : 3;
  const d = new Date(Date.now() + offset * DAY);
  if (/saturday|سبت/.test(pref)) while (d.getDay() !== 6) d.setTime(d.getTime() + DAY);
  if (d.getDay() === 0) d.setTime(d.getTime() + DAY); // clinics closed Sunday in this demo
  const time = /evening|مساء/.test(pref) ? '18:30' : /morning|صباح/.test(pref) ? '09:30' : '10:30';
  return {
    date: d.toISOString().slice(0, 10),
    dateLabel: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    time,
  };
}

function memberById(id) { return state.members.find((m) => m.id === id); }

function markMember(id, status, outcome) {
  const m = memberById(id);
  if (!m) return null;
  const wasOpen = m.status === 'open' || m.status === 'callback';
  m.status = status;
  if (outcome) m.outcome = outcome;
  m.lastContactDays = 0;
  if (wasOpen && (status === 'booked' || status === 'engaged')) {
    const avoided = Math.round(m.pAdmit90 * CONTRACT.outreachRiskReduction * CONTRACT.avgAdmissionCost);
    state.savings += avoided;
    state.gapsClosed += 1;
    emit('savings', { memberId: id, avoided, total: state.savings });
  }
  emit('member', { member: m });
  return m;
}

function visitPrep(p, specialty) {
  const f = findingsFor(p);
  const rel = f.filter((x) => !specialty || x.action.specialty.toLowerCase().includes(specialty.toLowerCase().split(' ')[0]));
  const focus = rel.length ? rel : f;
  const questions = {
    'pgx-clopidogrel': 'My genome report says I am a CYP2C19 poor metabolizer. Is clopidogrel still the right blood thinner for my stent?',
    rhythm: 'My watch flagged an irregular rhythm several times. Do I need an ECG or Holter monitor?',
    kidney: 'My kidney numbers are dropping and there is protein in my urine. Should I be on a kidney-protective medicine?',
    a1c: 'My HbA1c keeps rising. What should we change?',
    ldl: 'My LDL is above target after my stent. What are the options?',
    'fh-untreated': 'My genome shows familial hypercholesterolemia. Should I start treatment and should my family be tested?',
  };
  return {
    patient: p.name,
    specialty,
    date: new Date().toISOString().slice(0, 10),
    bringUp: focus.map((x) => x.title),
    questions: focus.map((x) => questions[x.id] || (x.id.startsWith('img') ? 'The CT found a small lung nodule. When should the follow-up scan be done?' : x.id.startsWith('ref') ? `Can we book the ${x.action.specialty} check that was referred earlier?` : null)).filter(Boolean),
    labs: p.labs.map((l) => `${l.name}: ${l.results[l.results.length - 1][1]} ${l.unit} (ref ${l.ref})`),
    medications: p.medications.map((m) => `${m.name} ${m.dose}`),
  };
}

// ---- tool/action handlers (called by the browser when the agent invokes a client tool) ----
const ACTIONS = {
  propose_visit(id, a, context) {
    const proposal = bookingFlow.propose(context.sessionId, id, a, context.transcript);
    return { ui: proposal, say: `Proposed only, NOT booked: ${JSON.stringify(proposal)}. This demo offers the returned clinic and slot only; do not claim it meets every preference. If it differs from the requested time or location, explain the alternative. Read back the visit, exact date, time, clinic, cost and transport choice, ask whether to book this appointment, then STOP and wait for a new patient reply. Use proposal_id ${proposal.proposalId} once their reply indicates agreement to this proposal in context; natural or implied acceptance is enough and no literal yes or نعم is required. No transport or other extras have been arranged.` };
  },
  async book_appointment(pid, a, context) {
    const p = PATIENTS[pid];
    const confirmed = await bookingFlow.confirm(context.sessionId, pid, 'book_appointment', a, context.transcript);
    const b = { ...confirmed, ref: ref('APT'), patientId: pid, sessionId: context.sessionId };
    state.bookings.push(b);
    emit('booking', { patientId: pid, patient: p.name, source: 'patient-agent', booking: b });
    markMember(pid, 'engaged', `Patient agent booked ${b.specialty}`);
    return { ui: b, say: `Booked: ${b.specialty} on ${b.dateLabel} at ${b.time}, at ${b.location}. Reference ${b.ref}. ${b.cost} ${b.transportDetails}` };
  },
  submit_preauthorization(pid, a) {
    const p = PATIENTS[pid];
    const pa = { ref: ref('PA'), patientId: pid, procedure: a.procedure, justification: a.justification, payer: p.insurance.payer, status: 'Submitted — pending review', eta: '24–48 hours' };
    state.preauths.push(pa);
    emit('preauth', { patientId: pid, patient: p.name, preauth: pa });
    return { ui: pa, say: `Pre-authorization for ${a.procedure} submitted to ${p.insurance.payer}. Reference ${pa.ref}. Status pending, usual decision within 24 to 48 hours.` };
  },
  notify_care_team(pid, a) {
    const p = PATIENTS[pid];
    const n = { ref: ref('ALR'), summary: a.summary, priority: a.priority };
    emit('alert', { patientId: pid, patient: p.name, source: 'patient-agent', alert: n });
    markMember(pid, 'engaged', 'Patient agent raised a clinical alert');
    return { ui: n, say: `Care team alerted with ${a.priority} priority. Reference ${n.ref}. A clinician will review it.` };
  },
  prepare_visit_summary(pid, a) {
    const prep = visitPrep(PATIENTS[pid], a.specialty);
    state.visitPreps[pid] = prep;
    emit('visitprep', { patientId: pid, patient: PATIENTS[pid].name, prep });
    return { ui: prep, say: `Visit sheet for ${a.specialty} is ready on screen with ${prep.questions.length} questions to ask and the latest results.` };
  },
  async schedule_visit(mid, a, context) {
    const m = memberById(mid);
    const confirmed = await bookingFlow.confirm(context.sessionId, mid, 'schedule_visit', a, context.transcript);
    const b = { ...confirmed, ref: ref('APT'), patientId: mid, sessionId: context.sessionId };
    state.bookings.push(b);
    emit('booking', { patientId: mid, patient: m.name, source: 'outreach', booking: b });
    markMember(mid, 'booked', `Booked ${b.specialty}`);
    return { ui: b, say: `Booked ${b.specialty} on ${b.dateLabel} at ${b.time} at ${b.location}. Reference ${b.ref}. ${b.cost} ${b.transportDetails}` };
  },
  log_call_outcome(mid, a, context) {
    const m = memberById(mid);
    if (a.outcome === 'booked' && !state.bookings.some((b) => b.patientId === mid && b.sessionId === context.sessionId)) {
      throw new BookingError('Cannot log booked: no appointment was confirmed in this conversation. Continue collecting preferences and confirmation, or log the actual outcome.');
    }
    const statusMap = { booked: 'booked', callback_requested: 'callback', declined: 'declined', escalated: 'escalated', unreachable: 'open' };
    const status = m.status === 'booked' && a.outcome !== 'escalated' ? 'booked' : statusMap[a.outcome] || 'open';
    markMember(mid, status, `${a.outcome}: ${a.notes}`);
    emit('outcome', { patientId: mid, patient: m.name, outcome: a.outcome, notes: a.notes });
    return { ui: { outcome: a.outcome, notes: a.notes }, say: 'Outcome logged.' };
  },
  escalate_to_nurse(mid, a) {
    const m = memberById(mid);
    const n = { ref: ref('ESC'), summary: a.reason, priority: 'high' };
    emit('alert', { patientId: mid, patient: m.name, source: 'outreach', alert: n });
    markMember(mid, 'escalated', `Escalated: ${a.reason}`);
    return { ui: n, say: `Escalated to the on-call nurse, reference ${n.ref}. A nurse will call within 15 minutes.` };
  },
};

function memberContext(m) {
  if (PATIENTS[m.id]) return contextFor(PATIENTS[m.id]);
  return [
    `MEMBER: ${m.name}, ${m.age}, ${m.sex === 'F' ? 'female' : 'male'}. Program cohort: ${m.cohort}.`,
    `OPEN CARE GAPS (most important first): ${m.gaps.map((g, i) => `${i + 1}. ${g}`).join(' ')}`,
    `Last contact with the care team: ${m.lastContactDays} days ago.`,
    `Internal (do not read out): predicted 90-day admission risk ${Math.round(m.pAdmit90 * 100)}%.`,
  ].join('\n');
}

// ---- text AI: pre-call brief and post-call note (Groq → OpenRouter → offline) ----
// LLMs sometimes return a string where a list was asked for; the UI always gets arrays of strings.
function asList(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(/\s*[;\n•]\s*|\s*,\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean);
  return [];
}
function normalize(data, offline, listKeys) {
  const out = { ...offline };
  for (const [k, v] of Object.entries(data || {})) {
    if (!(k in offline)) continue;
    out[k] = listKeys.includes(k) ? asList(v) : typeof v === 'string' && v.trim() ? v : offline[k];
  }
  return out;
}

async function precallBrief(m) {
  const offline = {
    headline: `${m.gaps.length} open gap${m.gaps.length > 1 ? 's' : ''}, ${Math.round(m.pAdmit90 * 100)}% 90-day admission risk`,
    whyNow: m.gaps[0],
    talkingPoints: m.gaps.slice(0, 3),
    likelyBarriers: ['Time off work', 'Transport'],
    opening: `Hi ${m.firstName}, it's your care team. We noticed ${m.gaps[0].toLowerCase()} and want to help sort it this week.`,
  };
  const r = await completeJson(
    'You are a clinical operations assistant at a value-based care provider in Abu Dhabi. Write concise, practical pre-call briefs for care coordinators. Use only the facts given. Output JSON only.',
    `Member record:\n${memberContext(m)}\nPreferred language: ${m.lang === 'ar' ? 'Arabic' : 'English'} (the outreach agent speaks it fluently, so language is never a barrier).\n\nReturn JSON: {"headline": string (max 12 words), "whyNow": string (1 sentence: why call this member today), "talkingPoints": string[3] (plain-language points for the call), "likelyBarriers": string[2-3], "opening": string (first sentence the coordinator should say, in English)}`,
  );
  return r ? { ...normalize(r.data, offline, ['talkingPoints', 'likelyBarriers']), provider: r.provider } : { ...offline, provider: 'offline' };
}

// WhatsApp outreach text in the member's language. The template is used when no text AI is available.
async function whatsappText(m, lang) {
  const { firstName } = namesFor(m, lang);
  const offline = lang === 'ar'
    ? `مرحباً ${firstName}، معك فريق رفيق للرعاية. لاحظنا أنك بحاجة إلى متابعة: ${m.gaps[0]}. نقدر نحجز لك موعداً هذا الأسبوع بدون أي رسوم ومع مواصلات مجانية. رد بـ "نعم" ونرتب لك الموعد.`
    : `Hi ${firstName}, it's your Rafeeq Care team. We noticed you're due for: ${m.gaps[0].toLowerCase()}. We can book it this week with no copay and free transport. Reply YES and we'll arrange it.`;
  const r = await completeJson(
    'You write short, warm WhatsApp messages from a care team in Abu Dhabi to a member of their diabetes and heart-failure program. Use only the facts given. Never diagnose or mention medicines. Output JSON only.',
    `Member first name: ${firstName}\nLanguage: ${lang === 'ar' ? 'Arabic (simple Gulf/Emirati style, no English)' : 'English'}\nOpen care gaps, most important first: ${m.gaps.join('; ')}\nProgram benefits: ${PROGRAM_BENEFITS}\n\nReturn JSON: {"message": string (max 60 words, from "Rafeeq Care", about the most important gap, offer to book it this week, end by asking them to reply YES)}`,
  );
  const message = r && r.data && typeof r.data.message === 'string' && r.data.message.trim();
  return message ? { message, provider: r.provider } : { message: offline, provider: 'offline' };
}

async function callNote(role, id, transcript) {
  const who = PATIENTS[id] ? PATIENTS[id].name : (memberById(id) || {}).name || id;
  const text = transcript.slice(-60).map((t) => `${t.role === 'user' ? 'PATIENT' : 'AGENT'}: ${String(t.message).slice(0, 600)}`).join('\n');
  const actions = state.events.filter((e) => e.patientId === id && ['booking', 'preauth', 'alert', 'outcome', 'visitprep'].includes(e.type));
  const offline = {
    summary: `${role === 'outreach' ? 'Outreach call' : 'Patient-agent session'} with ${who}: ${transcript.length} turns, ${actions.length} actions taken.`,
    actionsTaken: actions.map((e) => e.type),
    followUps: [],
    riskFlags: [],
    sentiment: 'unknown',
  };
  if (!transcript.length) return { ...offline, provider: 'offline' };
  const r = await completeJson(
    'You are a clinical documentation assistant. Turn an AI voice conversation (English or Arabic) into a short English note for the care team. Use only what the transcript and action log say. The action log is authoritative for completed actions: a proposed visit or general agreement is not a booking. Distinguish patient preferences, proposed options, agreement expressed naturally or inferred from context, and successful booking. Do not claim the patient said an explicit yes if they accepted in other words. Transport requested_pending_confirmation means requested, NOT arranged; put the outstanding transport confirmation in followUps. Do not turn available benefits into completed actions. Output JSON only.',
    `Conversation type: ${role === 'outreach' ? 'outbound care-gap outreach call' : "patient's personal health agent session"}\nPatient: ${who}\n\nTranscript:\n${text}\n\nActions logged by the system: ${JSON.stringify(actions.map((e) => ({ type: e.type, booking: e.booking, preauth: e.preauth, alert: e.alert, outcome: e.outcome, notes: e.notes })))}\n\nReturn JSON: {"summary": string (2-3 sentences), "actionsTaken": string[], "followUps": string[] (open items the team must do), "riskFlags": string[] (clinical concerns mentioned, empty if none), "sentiment": "positive"|"neutral"|"hesitant"|"distressed"}`,
  );
  return r ? { ...normalize(r.data, offline, ['actionsTaken', 'followUps', 'riskFlags']), provider: r.provider } : { ...offline, provider: 'offline' };
}

// ---- http ----
// The React frontend is built by Vite into dist/ (npm run build). In dev, Vite serves it instead.
const PUBLIC = path.join(__dirname, 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

function serveStatic(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'not found' });
    send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}

let liveHealthApp;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === '/live-health' || p.startsWith('/live-health/') || p === '/retell/webhook' || p === '/retell/webhook/') return liveHealthApp(req, res);
    if (req.method === 'GET' && p === '/api/status') {
      return send(res, 200, { ready: !!state.agents, error: state.agentError, llm: LLM, phoneCallTo: OUTBOUND_CALL_TO ? phone.maskNumber(OUTBOUND_CALL_TO) : null, whatsappTo: OUTBOUND_WHATSAPP_TO ? phone.maskNumber(OUTBOUND_WHATSAPP_TO) : null });
    }
    if (req.method === 'GET' && p === '/api/patients') {
      return send(res, 200, Object.values(PATIENTS).map((x) => ({ id: x.id, name: x.name, preferredLang: x.preferredLang })));
    }
    if (req.method === 'GET' && p.startsWith('/api/patients/')) {
      const pt = PATIENTS[decodeURIComponent(p.split('/')[3])];
      if (!pt) return send(res, 404, { error: 'unknown patient' });
      return send(res, 200, {
        patient: pt, findings: findingsFor(pt), today: NOW.toISOString().slice(0, 10),
        bookings: state.bookings.filter((b) => b.patientId === pt.id),
        preauths: state.preauths.filter((b) => b.patientId === pt.id),
        alerts: state.events.filter((e) => e.type === 'alert' && e.patientId === pt.id).map((e) => e.alert),
        visitPrep: state.visitPreps[pt.id] || null,
      });
    }
    if (req.method === 'GET' && p === '/api/population') {
      const revenue = CONTRACT.members * CONTRACT.capitationPmpm;
      const recent = costs.slice(-3).reduce((s, c) => s + c.cost, 0) / 3;
      return send(res, 200, {
        contract: CONTRACT, costs, members: state.members,
        kpis: {
          monthlyRevenue: revenue,
          currentCostPmpm: Math.round(recent),
          mlr: Math.round((recent / CONTRACT.capitationPmpm) * 1000) / 10,
          annualizedSavings: Math.round((CONTRACT.baselineCostPmpm - recent) * CONTRACT.members * 12),
          sessionSavings: state.savings,
          gapsClosed: state.gapsClosed,
          openGaps: state.members.filter((m) => m.status === 'open').reduce((s, m) => s + m.gaps.length, 0),
        },
        events: state.events.slice(-40),
      });
    }
    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      sseClients.add(res);
      const hb = setInterval(() => res.write(': hb\n\n'), 20000);
      req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
      return;
    }
    if (req.method === 'POST' && p === '/api/session') {
      const { role, lang, id } = await readBody(req);
      if (!['companion', 'outreach'].includes(role) || !['en', 'ar'].includes(lang)) return send(res, 400, { error: 'bad role or lang' });
      if (!state.agents) return send(res, 503, { error: state.agentError || 'Voice agents are still being set up, try again in a few seconds.' });
      let name, firstName, context, sex;
      if (role === 'companion') {
        const pt = PATIENTS[id];
        if (!pt) return send(res, 404, { error: 'unknown patient' });
        ({ name, firstName } = namesFor(pt, lang)); context = contextFor(pt); sex = pt.sex;
      } else {
        const m = memberById(id);
        if (!m) return send(res, 404, { error: 'unknown member' });
        ({ name, firstName } = namesFor(m, lang)); context = memberContext(m); sex = m.sex;
        emit('call', { patientId: m.id, patient: m.name, lang });
      }
      const url = await signedUrl(API_KEY, state.agents[`${role}_${lang}`]);
      return send(res, 200, {
        signedUrl: url,
        sessionId: bookingFlow.createSession(id, role),
        dynamicVariables: { patient_name: name, patient_first_name: firstName, patient_context: context, today: todayLong(), program_benefits: PROGRAM_BENEFITS, patient_address_rule: arabicAddressRule(sex) },
      });
    }
    // Real outbound phone call: the outreach agent rings OUTBOUND_CALL_TO with this member's context.
    if (req.method === 'POST' && p === '/api/phone-call') {
      const { id, lang } = await readBody(req);
      if (!['en', 'ar'].includes(lang)) return send(res, 400, { error: 'bad lang' });
      const m = memberById(id);
      if (!m) return send(res, 404, { error: 'unknown member' });
      if (!OUTBOUND_CALL_TO) return send(res, 400, { error: 'Set OUTBOUND_CALL_TO in .env to the number to call (e.g. +971501234567).' });
      if (!state.agents) return send(res, 503, { error: state.agentError || 'Voice agents are still being set up, try again in a few seconds.' });
      const { name, firstName } = namesFor(m, lang);
      // The outreach tools are browser (client) tools, so they cannot run on a phone call yet.
      const context = `${memberContext(m)}\nTHIS IS A REAL PHONE CALL: your tools are unavailable, so do not call them. Ask for preferred day/time, clinic or area, and whether transport help is wanted, one question at a time. Read back their preferences and ask whether to pass this request to the care team, then wait. Infer permission from their reply in context; do not require a literal yes or نعم. Only after they indicate agreement say the team needs to confirm availability, the appointment and any transport separately. Never invent a slot or claim anything is booked, arranged or sent.`;
      try {
        const r = await phone.outboundCall(API_KEY, {
          agentId: state.agents[`outreach_${lang}`],
          phoneNumberId: PHONE_NUMBER_ID,
          toNumber: OUTBOUND_CALL_TO,
          dynamicVariables: { patient_name: name, patient_first_name: firstName, patient_context: context, today: todayLong(), program_benefits: PROGRAM_BENEFITS, patient_address_rule: arabicAddressRule(m.sex) },
        });
        emit('call', { patientId: m.id, patient: m.name, lang, channel: 'phone', to: phone.maskNumber(OUTBOUND_CALL_TO), conversationId: r.conversationId });
        return send(res, 200, { ok: true, to: phone.maskNumber(OUTBOUND_CALL_TO), from: r.from, conversationId: r.conversationId });
      } catch (e) {
        console.error('Phone call failed:', e.message);
        return send(res, 502, { error: e.message });
      }
    }
    // WhatsApp outreach: a short message about the member's top care gap, sent to OUTBOUND_WHATSAPP_TO.
    if (req.method === 'POST' && p === '/api/whatsapp') {
      const { id, lang } = await readBody(req);
      if (!['en', 'ar'].includes(lang)) return send(res, 400, { error: 'bad lang' });
      const m = memberById(id);
      if (!m) return send(res, 404, { error: 'unknown member' });
      if (!OUTBOUND_WHATSAPP_TO) return send(res, 400, { error: 'Set OUTBOUND_WHATSAPP_TO in .env to the WhatsApp number to message (e.g. +971501234567).' });
      const text = await whatsappText(m, lang);
      try {
        const r = await sendWhatsApp({ accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN, from: WHATSAPP_FROM, to: OUTBOUND_WHATSAPP_TO, body: text.message });
        const to = phone.maskNumber(OUTBOUND_WHATSAPP_TO);
        emit('whatsapp', { patientId: m.id, patient: m.name, source: 'outreach', lang, to, text: text.message });
        return send(res, 200, { ok: true, to, status: r.status, message: text.message, provider: text.provider });
      } catch (e) {
        console.error('WhatsApp failed:', e.message);
        return send(res, 502, { error: e.message });
      }
    }
    if (req.method === 'POST' && p === '/api/reset') {
      resetDemo();
      console.log('Demo data reset.');
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/brief') {
      const { id } = await readBody(req);
      const m = memberById(id);
      if (!m) return send(res, 404, { error: 'unknown member' });
      return send(res, 200, await precallBrief(m));
    }
    if (req.method === 'POST' && p === '/api/note') {
      const { role, id, transcript } = await readBody(req);
      if (!PATIENTS[id] && !memberById(id)) return send(res, 404, { error: 'unknown patient/member' });
      const note = await callNote(role, id, Array.isArray(transcript) ? transcript : []);
      const who = PATIENTS[id] ? PATIENTS[id].name : memberById(id).name;
      emit('note', { patientId: id, patient: who, source: role === 'outreach' ? 'outreach' : 'patient-agent', note });
      return send(res, 200, note);
    }
    if (req.method === 'POST' && p === '/api/action') {
      const { tool, id, params, sessionId, transcript } = await readBody(req);
      const fn = Object.hasOwn(ACTIONS, tool) && ACTIONS[tool];
      if (!fn) return send(res, 400, { error: `unknown tool ${tool}` });
      if (!PATIENTS[id] && !memberById(id)) return send(res, 404, { error: 'unknown patient/member' });
      if (['book_appointment', 'submit_preauthorization', 'notify_care_team', 'prepare_visit_summary'].includes(tool) && !PATIENTS[id]) {
        return send(res, 400, { error: 'patient-agent tool needs a patient id' });
      }
      try {
        return send(res, 200, await fn(id, params || {}, { sessionId, transcript }));
      } catch (e) {
        if (e instanceof BookingError) return send(res, 200, { blocked: true, say: e.message });
        throw e;
      }
    }

    if (req.method === 'GET' && p === '/privacy') return serveStatic(res, path.join(PUBLIC, 'privacy.html'));
    if (req.method === 'GET' && p === '/api/whoop/status') return send(res, 200, whoop.status());
    if (req.method === 'GET' && p === '/whoop/connect') {
      const to = whoop.connectUrl(req);
      if (!to) return send(res, 500, { error: 'WHOOP_CLIENT_ID is not set' });
      res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (req.method === 'GET' && p === '/whoop/callback') {
      const r = await whoop.handleCallback(req, url);
      return send(res, r.status, r.html, TYPES['.html']);
    }

    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'forbidden' });
    return serveStatic(res, file);
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: e.message });
  }
});

async function provision() {
  if (!API_KEY) { state.agentError = 'ELEVENLABS_API_KEY missing — add it to .env'; console.error(state.agentError); return; }
  console.log(`Syncing ElevenLabs agents (LLM: ${LLM})…`);
  try {
    state.agents = await ensureAgents(API_KEY, LLM);
    state.agentError = null;
    console.log('Voice agents ready.');
  } catch (e) {
    state.agentError = e.message;
    console.error('Agent setup failed:', e.message);
  }
}

async function startServer() {
  const { createApp } = await import('./lib/live-health/app.mjs');
  liveHealthApp = createApp({
    origin: process.env.APP_ORIGIN || `http://localhost:${PORT}`,
    clientId: process.env.WHOOP_CLIENT_ID,
    clientSecret: process.env.WHOOP_CLIENT_SECRET,
    production: process.env.NODE_ENV === 'production',
    pageFile: path.join(PUBLIC, 'live-health/index.html'),
    retell: {
      enabled: process.env.RETELL_CALLS_ENABLED === 'true',
      apiKey: process.env.RETELL_API_KEY,
      webhookKey: process.env.RETELL_WEBHOOK_KEY,
      agentId: process.env.RETELL_AGENT_ID,
      fromNumber: process.env.RETELL_FROM_NUMBER,
      allowedNumbers: (process.env.RETELL_ALLOWED_NUMBERS || '').split(',').map(value => value.trim()).filter(Boolean),
    },
  });
  server.once('close', () => liveHealthApp.locals.dispose());
  server.listen(PORT, HOST, () => {
    console.log(`Rafeeq demo on http://localhost:${PORT}`);
    if (!fs.existsSync(path.join(PUBLIC, 'index.html'))) console.warn('Frontend not built: run `npm run build` (or `npm run dev` for the Vite dev server).');
    provision();
  });
}

if (require.main === module) {
  startServer().catch(() => {
    console.error('Server setup failed. Check dependencies and APP_ORIGIN (HTTPS is required in production).');
    process.exitCode = 1;
  });
}

module.exports = { server, state };
