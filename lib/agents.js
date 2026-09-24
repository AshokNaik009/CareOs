// Provisions the ElevenLabs Conversational AI agents (and their client tools) this demo uses.
// Idempotent: ids are cached in .agents.json and the remote config is re-synced on every start.

const fs = require('fs');
const path = require('path');

const API = 'https://api.elevenlabs.io';
const CACHE = path.join(__dirname, '..', '.agents.json');

const VOICES = {
  companion: 'EXAVITQu4vr4xnSDxMaL', // Sarah — warm, reassuring
  outreach: 'Xb7hH8MSUJpSbSDYk0k2',  // Alice — clear, professional
};
// ElevenLabs requires flash/turbo v2 for English agents and a v2.5 multilingual model otherwise.
const TTS_MODEL = { en: 'eleven_flash_v2', ar: 'eleven_flash_v2_5' };

const str = (description) => ({ type: 'string', description });
const enumStr = (description, values) => ({ type: 'string', description, enum: values });

const TOOLS = {
  book_appointment: {
    description: 'Book an appointment for the patient. Only call after the patient agreed. Returns the confirmed date, time, place and reference.',
    params: { specialty: str('Specialty or service, e.g. Cardiology, Radiology, Endocrinology, Ophthalmology'), reason: str('Short reason for the visit'), urgency: enumStr('How soon', ['urgent', 'soon', 'routine']) },
    required: ['specialty', 'reason', 'urgency'],
  },
  submit_preauthorization: {
    description: 'Submit an insurance pre-authorization request for a procedure on behalf of the patient. Only call after the patient agreed. Returns the reference number and status.',
    params: { procedure: str('Procedure, e.g. CT chest or Holter monitor'), justification: str('Clinical justification from the record') },
    required: ['procedure', 'justification'],
  },
  notify_care_team: {
    description: "Send an alert to the patient's care team (doctors and nurses) about an issue that needs clinical review, e.g. a gene–drug interaction or heart rhythm alerts. Returns confirmation.",
    params: { summary: str('One or two sentence clinical summary for the doctor'), priority: enumStr('Priority', ['high', 'medium', 'low']) },
    required: ['summary', 'priority'],
  },
  prepare_visit_summary: {
    description: 'Prepare a one-page visit preparation sheet (relevant results, medicines, questions to ask) for an upcoming visit. It appears on the patient screen.',
    params: { specialty: str('Specialty of the visit') },
    required: ['specialty'],
  },
  schedule_visit: {
    description: 'Book a visit for the member you are calling. Only call after they agreed. Returns the confirmed slot.',
    params: { visit_type: str('What the visit is for, e.g. diabetes review, heart failure check, eye screening, CT scan'), preferred_time: str('Preference the member gave, e.g. evening, Saturday, next week') },
    required: ['visit_type', 'preferred_time'],
  },
  log_call_outcome: {
    description: 'Record the outcome of this outreach call. Call exactly once, before saying goodbye.',
    params: { outcome: enumStr('Outcome', ['booked', 'callback_requested', 'declined', 'escalated', 'unreachable']), notes: str('Brief notes: barriers mentioned, what was agreed') },
    required: ['outcome', 'notes'],
  },
  escalate_to_nurse: {
    description: 'Escalate to a human nurse right away when the member reports worrying symptoms or asks for a clinician.',
    params: { reason: str('What the member reported') },
    required: ['reason'],
  },
};

const LANG_RULE = {
  en: 'Speak English. If the person switches to Arabic, reply in simple English and tell them they can pick Arabic on the screen.',
  ar: 'Always speak Arabic: clear, simple Modern Standard Arabic that Gulf speakers find natural. Say numbers clearly. Keep medical terms simple; you may add the English term in brackets once if helpful.',
};

const FIRST_MESSAGE = {
  companion: {
    en: "Hi {{patient_first_name}}, it's Rafeeq, your health agent. I've gone through your latest records and found a few things worth sorting out. Shall I start with the most important one?",
    ar: 'مرحباً {{patient_first_name}}، معك رفيق، مساعدك الصحي. راجعتُ سجلك الطبي الأخير ووجدتُ بعض الأمور التي تستحق المتابعة. هل أبدأ بالأهم؟',
  },
  outreach: {
    en: "Hello, this is Noor calling from Rafeeq Care, your diabetes and heart care team. Am I speaking with {{patient_first_name}}?",
    ar: 'السلام عليكم، معك نور من فريق رفيق للرعاية الصحية، فريق رعاية السكري والقلب. هل أتحدث مع {{patient_first_name}}؟',
  },
};

const PROMPT = {
  companion: (lang) => `# Identity
You are Rafeeq, a personal health agent working for one person: {{patient_name}}, a resident of Abu Dhabi. You work for the patient, not for a hospital. You can see their Malaffi health record, their genome report and their wearable data (below), and you can act for them with your tools.

# Language
${LANG_RULE[lang]}

# Voice style
This is a spoken conversation. Keep each turn to 1–3 short sentences, then let the person talk. No lists, markdown or emojis. Explain medical words in everyday language. Be warm, calm and direct.

# What you do
1. Explain results: compare with earlier values and the reference range, say what it means in plain words and what usually happens next.
2. Catch what fell through the cracks: the AGENT FINDINGS below were produced by a safety-net engine that checks the record. Unless the person raises something else, start with finding number 1 and work down.
3. Act for them:
   - book_appointment to book visits and scans.
   - submit_preauthorization when a finding says a procedure needs insurance pre-authorization. Do this before or together with booking that procedure.
   - notify_care_team for anything a doctor must review, especially gene–medication interactions and heart rhythm alerts.
   - prepare_visit_summary when they have a visit coming, or after you book one.
   Always get a clear yes before any action. After a tool returns, tell them the result using the exact date, time and reference number it gave.

# Safety rules
- You are not a doctor. Never diagnose. Never tell the person to start, stop or change a medicine; explain the issue and route it to their doctor. If medication comes up, say not to stop anything without their doctor.
- Emergencies: chest pain, trouble breathing, signs of stroke, fainting, or thoughts of self-harm → tell them to call 998 for an ambulance now, and stop other topics.
- Use only facts from the record below. If something isn't there, say so. Never invent results, dates, names or doctors.

# Today
{{today}}

# Record
{{patient_context}}`,

  outreach: (lang) => `# Identity
You are Noor, an AI care coordinator calling on behalf of Rafeeq Care, the medical group responsible for {{patient_name}}'s diabetes and heart care under their health plan. You placed this call.

# Language
${LANG_RULE[lang]}

# Goal
Close the member's open care gaps (below), most important first, ideally by booking one visit that covers them.

# Call flow
1. Confirm you are speaking with {{patient_first_name}}. Say in one sentence why you're calling and ask if now is a good time.
2. Explain the most important gap simply and why it matters for them personally.
3. Offer to book it and use schedule_visit once they agree. Mention the program benefits when they help: {{program_benefits}}
4. Handle barriers (time, transport, cost, worry) with empathy and practical options.
5. If they describe worrying symptoms, use escalate_to_nurse. For emergencies tell them to call 998 now.
6. Before goodbye, call log_call_outcome exactly once, then thank them and end warmly.

# Rules
- Spoken call: 1–2 short sentences per turn. No lists or markdown.
- Never diagnose or change medicines. Use only the facts below; never invent anything.
- If they decline, respect it, offer a callback, and log it.

# Today
{{today}}

# Member record
{{patient_context}}`,
};

const AGENT_SPECS = [
  { key: 'companion_en', role: 'companion', lang: 'en', tools: ['book_appointment', 'submit_preauthorization', 'notify_care_team', 'prepare_visit_summary'] },
  { key: 'companion_ar', role: 'companion', lang: 'ar', tools: ['book_appointment', 'submit_preauthorization', 'notify_care_team', 'prepare_visit_summary'] },
  { key: 'outreach_en', role: 'outreach', lang: 'en', tools: ['schedule_visit', 'log_call_outcome', 'escalate_to_nurse'] },
  { key: 'outreach_ar', role: 'outreach', lang: 'ar', tools: ['schedule_visit', 'log_call_outcome', 'escalate_to_nurse'] },
];

function makeClient(apiKey) {
  return async function call(method, url, body) {
    const res = await fetch(API + url, {
      method,
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!res.ok) {
      const err = new Error(`ElevenLabs ${method} ${url} → ${res.status}: ${json && json.detail ? JSON.stringify(json.detail) : text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  };
}

function toolConfig(name) {
  const t = TOOLS[name];
  return {
    type: 'client',
    name,
    description: t.description,
    expects_response: true,
    response_timeout_secs: 20,
    parameters: { type: 'object', required: t.required, properties: t.params },
  };
}

function agentConfig(spec, toolIds, llm) {
  return {
    name: `Rafeeq ${spec.role === 'companion' ? 'Health Agent' : 'Care Outreach'} (${spec.lang.toUpperCase()})`,
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE[spec.role][spec.lang],
        language: spec.lang,
        prompt: { prompt: PROMPT[spec.role](spec.lang), llm, temperature: 0.3, tool_ids: toolIds },
      },
      tts: { voice_id: VOICES[spec.role], model_id: TTS_MODEL[spec.lang] },
    },
  };
}

const loadCache = () => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return { tools: {}, agents: {} }; } };
const saveCache = (c) => fs.writeFileSync(CACHE, JSON.stringify(c, null, 2));

async function ensureAgents(apiKey, llm, log = console.log) {
  const call = makeClient(apiKey);
  const cache = loadCache();
  cache.tools = cache.tools || {};
  cache.agents = cache.agents || {};

  for (const name of Object.keys(TOOLS)) {
    const id = cache.tools[name];
    if (id) {
      try { await call('PATCH', `/v1/convai/tools/${id}`, { tool_config: toolConfig(name) }); continue; }
      catch (e) { if (e.status !== 404) throw e; }
    }
    const created = await call('POST', '/v1/convai/tools', { tool_config: toolConfig(name) });
    cache.tools[name] = created.id;
    log(`  created tool ${name}`);
    saveCache(cache);
  }

  for (const spec of AGENT_SPECS) {
    const cfg = agentConfig(spec, spec.tools.map((t) => cache.tools[t]), llm);
    const id = cache.agents[spec.key];
    if (id) {
      try { await call('PATCH', `/v1/convai/agents/${id}`, cfg); continue; }
      catch (e) { if (e.status !== 404) throw e; }
    }
    const created = await call('POST', '/v1/convai/agents/create', cfg);
    cache.agents[spec.key] = created.agent_id;
    log(`  created agent ${cfg.name}`);
    saveCache(cache);
  }
  saveCache(cache);
  return cache.agents;
}

async function signedUrl(apiKey, agentId) {
  const call = makeClient(apiKey);
  const r = await call('GET', `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`);
  return r.signed_url;
}

module.exports = { ensureAgents, signedUrl, makeClient, loadCache, saveCache, CACHE };
