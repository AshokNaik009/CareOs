// Side-by-side LLM comparison for the agent prompts (npm run compare → http://localhost:3100).
// Sends the same patient message to two models (OpenAI, Groq, or OpenRouter for the rest), using the exact prompts, first
// messages and tools the ElevenLabs agents use. Tool calls get canned results; nothing touches
// the live demo, its state or the ElevenLabs agents. Optional: plays replies with the agent's voice.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
(function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})();

const { PROMPT, FIRST_MESSAGE, TOOLS, AGENT_SPECS, VOICES, AR_VOICE, TTS_MODEL, AR_SPEED, arabicPrompt, arabicFirstMessage, arabicAddressRule } = require('../lib/agents');
const { PATIENTS, PROGRAM_BENEFITS, NOW, namesFor } = require('../lib/data');
const { contextFor } = require('../lib/findings');

const PORT = Number(process.env.COMPARE_PORT || 3100);
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
// Bare OpenAI ids (gpt-6-luna) go straight to OpenAI.
const OPENAI_MODELS = ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-5.6-luna', 'gpt-5.5'];
// Models Groq serves go to Groq; anything else with a vendor prefix (e.g. Claude) goes to OpenRouter.
const GROQ_MODELS = ['qwen/qwen3.8-27b', 'allam-2-7b'];
const DEFAULT_MODELS = ['gpt-6-luna', 'gpt-6-luna'];
const DEFAULT_VARIANTS = ['selective', 'plain'];
const MODEL_CHOICES = [
  ...OPENAI_MODELS,
  ...GROQ_MODELS,
  'anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-sonnet-5', 'anthropic/claude-opus-5.5',
];

const todayLong = () => NOW.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function vars(pt, lang) {
  const { name, firstName } = namesFor(pt, lang);
  return { patient_name: name, patient_first_name: firstName, patient_context: contextFor(pt), today: todayLong(), program_benefits: PROGRAM_BENEFITS, patient_address_rule: arabicAddressRule(pt.sex) };
}
const fill = (tpl, v) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? v[k] : m));

const promptFor = (lang, role, variant) => (lang === 'ar' ? arabicPrompt(role, variant) : PROMPT.en[role]);
const firstFor = (role, lang, variant) => (lang === 'ar' ? arabicFirstMessage(role, variant) : FIRST_MESSAGE[role].en);

function toolsFor(role) {
  const spec = AGENT_SPECS.find((s) => s.role === role);
  return spec.tools.map((name) => ({
    type: 'function',
    function: { name, description: TOOLS[name].description, parameters: { type: 'object', required: TOOLS[name].required, properties: TOOLS[name].params } },
  }));
}

// Same canned result for both models, so replies differ only because of the model.
function fakeToolResult(name, args) {
  const slot = { date: 'Wednesday 1 October 2026', time: '10:00', place: 'Sheikh Shakhbout Medical City, Abu Dhabi' };
  switch (name) {
    case 'book_appointment': return { status: 'confirmed', specialty: args.specialty, ...slot, reference: 'BK-48213' };
    case 'schedule_visit': return { status: 'confirmed', visit_type: args.visit_type, ...slot, reference: 'SV-30517' };
    case 'submit_preauthorization': return { status: 'submitted', procedure: args.procedure, reference: 'PA-77120', expected_decision: 'within 48 hours' };
    case 'notify_care_team': return { status: 'sent', to: 'Dr. Aisha Al Hammadi and the care team', reference: 'CT-5521' };
    case 'prepare_visit_summary': return { status: 'ready', note: 'Visit preparation sheet is now on the patient screen.' };
    case 'escalate_to_nurse': return { status: 'escalated', note: 'A nurse will call back within 15 minutes.' };
    case 'log_call_outcome': return { status: 'logged' };
    default: return { status: 'ok' };
  }
}

function provider(model) {
  if (!model.includes('/')) {
    // Chat completions only allow function tools on GPT-6 with reasoning off; that also suits voice latency.
    return { name: 'openai', url: 'https://api.openai.com/v1/chat/completions', key: OPENAI_KEY, extra: { max_completion_tokens: 1500, reasoning_effort: 'none' }, noTemperature: true };
  }
  if (GROQ_MODELS.includes(model)) {
    // Reasoning models think before answering: keep it low so spoken replies stay fast.
    const extra = model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : model.startsWith('qwen/') ? { reasoning_effort: 'none' } : {};
    return { name: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_KEY, extra: { max_completion_tokens: 1500, ...extra } };
  }
  const extra = /^openai\/gpt-5/.test(model) ? { reasoning: { effort: 'low' } } : {};
  return { name: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions', key: OPENROUTER_KEY, extra: { max_tokens: 1500, ...extra } };
}

async function complete(model, messages, tools) {
  const p = provider(model);
  if (!p.key) throw new Error(`${{ groq: 'GROQ_API_KEY', openai: 'OPENAI_KEY', openrouter: 'OPENROUTER_API_KEY' }[p.name]} is missing in .env`);
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, tools, ...(p.noTemperature ? {} : { temperature: 0.3 }), ...p.extra }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${p.name} ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// One turn: call the model, answer any tool calls with canned results, repeat until it speaks.
async function turn({ model, variant, role, lang, patientId, history }) {
  const pt = PATIENTS[patientId];
  if (!pt) throw new Error('unknown patient');
  const system = fill(promptFor(lang, role, variant), vars(pt, lang));
  const tools = toolsFor(role);
  const added = [];
  const toolCalls = [];
  const started = Date.now();
  let firstMs = null;
  for (let i = 0; i < 4; i++) {
    const json = await complete(model, [{ role: 'system', content: system }, ...history, ...added], tools);
    if (firstMs === null) firstMs = Date.now() - started;
    const msg = json.choices && json.choices[0] && json.choices[0].message;
    if (!msg) throw new Error('empty response');
    const calls = msg.tool_calls || [];
    added.push({ role: 'assistant', content: msg.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) return { added, reply: msg.content || '', toolCalls, firstMs, totalMs: Date.now() - started, provider: provider(model).name };
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* keep {} */ }
      const result = fakeToolResult(c.function.name, args);
      toolCalls.push({ name: c.function.name, args, result });
      added.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
  return { added, reply: '(stopped after 4 tool rounds)', toolCalls, firstMs, totalMs: Date.now() - started };
}

async function tts(text, lang, role) {
  const voice = lang === 'ar' ? AR_VOICE : VOICES[role];
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: TTS_MODEL[lang], ...(lang === 'ar' ? { voice_settings: { speed: AR_SPEED } } : {}) }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status} ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const readBody = (req) => new Promise((resolve, reject) => {
  let d = '';
  req.on('data', (c) => { d += c; });
  req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  try {
    if (req.method === 'GET' && p === '/') return send(res, 200, fs.readFileSync(path.join(__dirname, 'compare.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && p === '/api/config') {
      const patients = Object.values(PATIENTS).map((x) => ({ id: x.id, name: x.name, lang: x.preferredLang }));
      const first = {};
      for (const role of Object.keys(FIRST_MESSAGE)) for (const lang of ['en', 'ar']) for (const x of Object.values(PATIENTS)) {
        for (const variant of ['harakat', 'selective', 'plain']) first[`${role}|${lang}|${x.id}|${variant}`] = fill(firstFor(role, lang, variant), vars(x, lang));
      }
      return send(res, 200, { patients, models: DEFAULT_MODELS, variants: DEFAULT_VARIANTS, choices: MODEL_CHOICES, first, ready: !!(OPENAI_KEY || GROQ_KEY || OPENROUTER_KEY), tts: !!process.env.ELEVENLABS_API_KEY });
    }
    if (req.method === 'POST' && p === '/api/turn') return send(res, 200, await turn(await readBody(req)));
    if (req.method === 'POST' && p === '/api/tts') {
      const { text, lang, role } = await readBody(req);
      return send(res, 200, await tts(text, lang, role), 'audio/mpeg');
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e.message);
    return send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Model comparison on http://localhost:${PORT}`);
  if (!GROQ_KEY) console.warn('GROQ_API_KEY missing — add it to .env');
});
