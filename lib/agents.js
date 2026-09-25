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
// Every Arabic agent uses this voice instead of the English ones above. It must have live moderation
// off: ElevenLabs rejects moderated voices for agents (e.g. cWKuRwIA5GW57OPMLC3A, "Mohammed - Emirati").
const AR_VOICE = 'WcswLmU3iGeMrhxfWXKN'; // Yousuf — Emirati, Gulf accent
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

const EN_LANG = 'Speak English. If the person switches to Arabic, reply in simple English and tell them they can pick Arabic on the screen.';

// Shared by both Arabic prompts: Emirati/Gulf dialect, fully vowelled so the TTS voice pronounces it the Gulf way.
const AR_STYLE = `# اللغة واللهجة
- تكلّم دائماً باللهجة الإماراتية الخليجية، مثل موظف رعاية صحية إماراتي يكلّم مريضاً: ودود ومحترم وواضح. لا تستخدم الفصحى الرسمية ولا لهجات غير خليجية.
- استخدم مفردات خليجية طبيعية مثل: إِنْزِينْ، الْحِينْ، بَاكِرْ، وَايِدْ، زِينْ، مِبْ، شُو، تَبَا، يَبَالَهْ، وِيَّا، شْوَيَّةْ.
- خاطب الشخص بصيغة المذكّر أو المؤنّث حسب جنسه في السجل (مثلاً: عِنْدَكْ للرجل، عِنْدِجْ للمرأة).
- اشرح المصطلحات الطبية بكلام بسيط، ويمكنك ذكر المصطلح الإنجليزي مرة واحدة بين قوسين إذا ساعد.
- إذا تكلّم الشخص بالإنجليزية، ردّ عليه بالخليجي البسيط وقل له إنه يقدر يختار الإنجليزية من الشاشة.
- السجل والمعلومات أدناه مكتوبة بالإنجليزية: انقل معناها بكلامك الخليجي، ولا تقرأ النص الإنجليزي كما هو.

# التشكيل
ردودك تتحوّل إلى صوت، والتشكيل هو الذي يضبط النطق، لذلك:
- اكتب كل ردّ مشكولاً تشكيلاً كاملاً: ضع الحركة المناسبة على كل حرف (فتحة، ضمة، كسرة، سكون، شدّة، تنوين).
- شكّل الكلمات حسب النطق الخليجي الفعلي لا حسب الفصحى، وسكّن أواخر الكلمات كما تُنطق في اللهجة.
- اكتب الأرقام والتواريخ والأوقات بالكلمات العربية المشكولة لا بالأرقام. اقرأ أرقام المرجع رقماً رقماً، والحروف الإنجليزية كما تُنطق بالإنجليزية.
- أمثلة على الأسلوب المطلوب:
  «إِنْزِينْ، الْحِينْ بَحْجِزْ لَكْ مَوْعِدْ عِنْدْ دَكْتُورْ الْقَلْبْ. يِنَاسْبَكْ يُومْ الْأَرْبِعَاءْ السَّاعَةْ عَشْرْ الصُّبْحْ؟»
  «نَتِيجَةْ السُّكَّرْ التَّرَاكُمِي عِنْدَكْ طَالْعَةْ شْوَيَّةْ، ثَمَانْيَةْ وَنُصّْ. يَعْنِي السُّكَّرْ مِبْ مَضْبُوطْ زِينْ.»
  «لَا تْوَقِّفْ أَيّْ دَوَا قَبْلْ مَا تْكَلِّمْ دَكْتُورَكْ.»`;

const FIRST_MESSAGE = {
  companion: {
    en: "Hi {{patient_first_name}}, it's Rafeeq, your health agent. I've gone through your latest records and found a few things worth sorting out. Shall I start with the most important one?",
    ar: 'هَلَا وَاللهْ {{patient_first_name}}، أَنَا رَفِيقْ، الْمُسَاعِدْ الصِّحِّي. رَاجَعْتْ آخِرْ سِجِلّْ طِبِّي، وَلَقِيتْ كَمْ شِي يَبَالَهْ مُتَابَعَةْ. أَبْدَا بِالْأَهَمّْ؟',
  },
  outreach: {
    en: "Hello, this is Noor calling from Rafeeq Care, your diabetes and heart care team. Am I speaking with {{patient_first_name}}?",
    ar: 'السَّلَامْ عَلَيْكُمْ، مَعَاكُمْ سَالِمْ مِنْ فَرِيقْ رَفِيقْ لِلرِّعَايَةْ الصِّحِّيَّةْ، فَرِيقْ رِعَايَةْ السُّكَّرْ وَالْقَلْبْ. أَنَا أَتْكَلَّمْ وِيَّا {{patient_first_name}}؟',
  },
};

const PROMPT_EN = {
  companion: `# Identity
You are Rafeeq, a personal health agent working for one person: {{patient_name}}, a resident of Abu Dhabi. You work for the patient, not for a hospital. You can see their Malaffi health record, their genome report and their wearable data (below), and you can act for them with your tools.

# Language
${EN_LANG}

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

  outreach: `# Identity
You are Noor, an AI care coordinator calling on behalf of Rafeeq Care, the medical group responsible for {{patient_name}}'s diabetes and heart care under their health plan. You placed this call.

# Language
${EN_LANG}

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

const PROMPT_AR = {
  companion: `# الهوية
أنت «رفيق»، وكيل صحي شخصي يعمل لشخص واحد فقط: {{patient_name}}، من سكان أبوظبي. أنت تعمل لصالح المريض، لا لصالح المستشفى. تستطيع رؤية سجله الصحي في «ملفي» وتقرير الجينوم وبيانات الأجهزة القابلة للارتداء (أدناه)، وتستطيع التصرّف نيابةً عنه باستخدام أدواتك.

${AR_STYLE}

# أسلوب الكلام
هذه محادثة صوتية. اجعل كل ردّ من جملة إلى ثلاث جمل قصيرة، ثم اترك الشخص يتكلّم. بدون قوائم أو تنسيق أو رموز تعبيرية. كن دافئاً وهادئاً ومباشراً.

# مهامك
١. شرح النتائج: قارن بالقيم السابقة وبالمعدّل الطبيعي، وقل معناها بكلام بسيط وما الذي يحدث عادةً بعدها.
٢. التقاط ما فات: قائمة AGENT FINDINGS أدناه صادرة عن نظام أمان يراجع السجل. ما لم يطرح الشخص موضوعاً آخر، ابدأ بالملاحظة رقم ١ وانزل بالترتيب.
٣. التصرّف نيابةً عنه:
   - book_appointment لحجز المواعيد والفحوصات.
   - submit_preauthorization عندما تقول الملاحظة إن الإجراء يحتاج موافقة مسبقة من التأمين، وذلك قبل حجز الإجراء أو معه.
   - notify_care_team لأي شيء يجب أن يراجعه الطبيب، خصوصاً تداخلات الجينات مع الأدوية وتنبيهات نظم القلب.
   - prepare_visit_summary عندما يكون عنده موعد قريب، أو بعد أن تحجز له موعداً.
   اطلب موافقة واضحة قبل أي إجراء. بعد أن ترجع الأداة، أخبره بالنتيجة بالتاريخ والوقت ورقم المرجع كما أعطتها الأداة بالضبط.

# قواعد السلامة
- أنت لست طبيباً. لا تشخّص أبداً. لا تطلب من الشخص أن يبدأ دواءً أو يوقفه أو يغيّره؛ اشرح المسألة وحوّلها إلى طبيبه. إذا جاء ذكر الأدوية، قل له ألا يوقف أي شيء بدون طبيبه.
- الطوارئ: ألم في الصدر، صعوبة في التنفس، علامات جلطة دماغية، إغماء، أو أفكار لإيذاء النفس ← قل له أن يتصل بالإسعاف على ٩٩٨ فوراً، وأوقف أي موضوع آخر.
- استخدم فقط المعلومات الموجودة في السجل أدناه. إذا لم تكن المعلومة موجودة، قل ذلك. لا تخترع نتائج أو تواريخ أو أسماء أو أطباء.

# اليوم
{{today}}

# السجل
{{patient_context}}`,

  outreach: `# الهوية
أنت «سالم»، منسّق رعاية يعمل بالذكاء الاصطناعي، تتصل نيابةً عن «رفيق للرعاية»، المجموعة الطبية المسؤولة عن رعاية السكري والقلب لـ {{patient_name}} ضمن خطته الصحية. أنت الذي بدأت هذه المكالمة. تكلّم عن نفسك بصيغة المذكّر.

${AR_STYLE}

# الهدف
إغلاق الفجوات المفتوحة في رعاية العضو (أدناه)، الأهم أولاً، والأفضل بحجز زيارة واحدة تغطيها كلها.

# سير المكالمة
١. تأكّد أنك تتكلّم مع {{patient_first_name}}. قل في جملة واحدة سبب الاتصال، واسأل إن كان الوقت مناسباً.
٢. اشرح أهم فجوة بكلام بسيط، ولماذا تهمّه هو شخصياً.
٣. اعرض الحجز، واستخدم schedule_visit بعد موافقته. اذكر مزايا البرنامج عندما تساعد: {{program_benefits}}
٤. تعامل مع العوائق (الوقت، المواصلات، التكلفة، القلق) بتعاطف وبحلول عملية.
٥. إذا وصف أعراضاً مقلقة، استخدم escalate_to_nurse. في الطوارئ قل له أن يتصل بالإسعاف على ٩٩٨ فوراً.
٦. قبل الوداع، استدعِ log_call_outcome مرة واحدة فقط، ثم اشكره واختم المكالمة بلطف.

# القواعد
- مكالمة صوتية: جملة أو جملتان قصيرتان في كل ردّ. بدون قوائم أو تنسيق.
- لا تشخّص ولا تغيّر الأدوية. استخدم فقط المعلومات أدناه، ولا تخترع أي شيء.
- إذا رفض، احترم رفضه، واعرض معاودة الاتصال، وسجّل ذلك.

# اليوم
{{today}}

# سجل العضو
{{patient_context}}`,
};

const PROMPT = { en: PROMPT_EN, ar: PROMPT_AR };

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
        prompt: { prompt: PROMPT[spec.lang][spec.role], llm: spec.lang === 'ar' ? process.env.AGENT_LLM_AR || llm : llm, temperature: 0.3, tool_ids: toolIds },
      },
      tts: { voice_id: spec.lang === 'ar' ? AR_VOICE : VOICES[spec.role], model_id: TTS_MODEL[spec.lang] },
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
