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

const { PATIENTS, CONTRACT, PROGRAM_BENEFITS, buildPopulation, costSeries, NOW, DAY } = require('./lib/data');
const { findingsFor, contextFor } = require('./lib/findings');
const { ensureAgents, signedUrl } = require('./lib/agents');
const { completeJson } = require('./lib/llm');

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

// Restore the synthetic data to its initial state and tell every open page to reload.
function resetDemo() {
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
  book_appointment(pid, a) {
    const p = PATIENTS[pid];
    const s = slot(a.urgency);
    const b = { ref: ref('APT'), patientId: pid, specialty: a.specialty, reason: a.reason, ...s, location: `${a.specialty}, partner clinic, Al Khalidiyah, Abu Dhabi` };
    state.bookings.push(b);
    emit('booking', { patientId: pid, patient: p.name, source: 'patient-agent', booking: b });
    markMember(pid, 'engaged', `Patient agent booked ${a.specialty}`);
    return { ui: b, say: `Booked: ${a.specialty} on ${s.dateLabel} at ${s.time}, at ${b.location}. Reference ${b.ref}.` };
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
  schedule_visit(mid, a) {
    const m = memberById(mid);
    const s = slot(a.preferred_time);
    const b = { ref: ref('APT'), patientId: mid, specialty: a.visit_type, ...s, location: 'Rafeeq Care clinic, Al Khalidiyah (free transport available)' };
    state.bookings.push(b);
    emit('booking', { patientId: mid, patient: m.name, source: 'outreach', booking: b });
    markMember(mid, 'booked', `Booked ${a.visit_type}`);
    return { ui: b, say: `Booked ${a.visit_type} on ${s.dateLabel} at ${s.time} at ${b.location}. Reference ${b.ref}. No copay.` };
  },
  log_call_outcome(mid, a) {
    const m = memberById(mid);
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
    'You are a clinical documentation assistant. Turn an AI voice conversation (English or Arabic) into a short English note for the care team. Use only what the transcript and action log say. Output JSON only.',
    `Conversation type: ${role === 'outreach' ? 'outbound care-gap outreach call' : "patient's personal health agent session"}\nPatient: ${who}\n\nTranscript:\n${text}\n\nActions logged by the system: ${JSON.stringify(actions.map((e) => ({ type: e.type, booking: e.booking, preauth: e.preauth, alert: e.alert, outcome: e.outcome, notes: e.notes })))}\n\nReturn JSON: {"summary": string (2-3 sentences), "actionsTaken": string[], "followUps": string[] (open items the team must do), "riskFlags": string[] (clinical concerns mentioned, empty if none), "sentiment": "positive"|"neutral"|"hesitant"|"distressed"}`,
  );
  return r ? { ...normalize(r.data, offline, ['actionsTaken', 'followUps', 'riskFlags']), provider: r.provider } : { ...offline, provider: 'offline' };
}

// ---- http ----
const PUBLIC = path.join(__dirname, 'public');
const VENDOR = path.join(__dirname, 'node_modules', '@elevenlabs', 'client', 'dist', 'lib.iife.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/api/status') {
      return send(res, 200, { ready: !!state.agents, error: state.agentError, llm: LLM });
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
      let name, firstName, context;
      if (role === 'companion') {
        const pt = PATIENTS[id];
        if (!pt) return send(res, 404, { error: 'unknown patient' });
        ({ name, firstName } = pt); context = contextFor(pt);
      } else {
        const m = memberById(id);
        if (!m) return send(res, 404, { error: 'unknown member' });
        ({ name, firstName } = m); context = memberContext(m);
        emit('call', { patientId: m.id, patient: m.name, lang });
      }
      const url = await signedUrl(API_KEY, state.agents[`${role}_${lang}`]);
      return send(res, 200, {
        signedUrl: url,
        dynamicVariables: { patient_name: name, patient_first_name: firstName, patient_context: context, today: todayLong(), program_benefits: PROGRAM_BENEFITS },
      });
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
      const { tool, id, params } = await readBody(req);
      const fn = ACTIONS[tool];
      if (!fn) return send(res, 400, { error: `unknown tool ${tool}` });
      if (!PATIENTS[id] && !memberById(id)) return send(res, 404, { error: 'unknown patient/member' });
      if (['book_appointment', 'submit_preauthorization', 'notify_care_team', 'prepare_visit_summary'].includes(tool) && !PATIENTS[id]) {
        return send(res, 400, { error: 'patient-agent tool needs a patient id' });
      }
      return send(res, 200, fn(id, params || {}));
    }

    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    if (p === '/vendor/elevenlabs-client.js') return serveStatic(res, VENDOR);
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

server.listen(PORT, HOST, () => {
  console.log(`Rafeeq demo on http://localhost:${PORT}`);
  provision();
});
