// Patient agent page (idea 1).

const params = new URLSearchParams(location.search);
const ui = {
  lang: params.get('lang') === 'ar' ? 'ar' : 'en',
  patientId: params.get('p') || 'P-1001',
  data: null,
  session: null,
  starting: false,
};

const CHIPS = {
  en: ['What did you find in my record?', 'Explain my HbA1c trend', 'Why does my genome matter for my medicines?', 'Prepare me for my cardiology visit'],
  ar: ['ماذا وجدت في سجلي؟', 'اشرح لي نتيجة السكر التراكمي', 'لماذا تهم جيناتي لأدويتي؟', 'جهّزني لموعد طبيب القلب'],
};

// Words that show a finding has been acted on (matched against booking/pre-auth/alert text).
const HANDLED_BY = {
  'pgx-clopidogrel': ['clopidogrel', 'cyp2c19', 'antiplatelet'],
  rhythm: ['rhythm', 'ecg', 'holter', 'atrial', 'palpitation'],
  kidney: ['kidney', 'egfr', 'uacr', 'renal', 'albumin', 'nephro'],
  a1c: ['hba1c', 'a1c', 'glucose', 'glycemic', 'glycaemic', 'endocrin', 'diabetes'],
  ldl: ['ldl', 'cholesterol', 'lipid', 'statin'],
  'fh-untreated': ['lipid', 'cholesterol', 'ldlr', 'hypercholesterol'],
  img: ['ct', 'nodule', 'radiology', 'chest'],
  ref: ['ophthalm', 'eye', 'retina', 'retinal'],
};

// ---------- rendering: record ----------
function renderRecord() {
  const { patient: p, findings } = ui.data;
  const initials = p.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  $('#profile').innerHTML = `
    <div class="profile"><div class="avatar">${esc(initials)}</div>
      <div><h1>${esc(p.name)}</h1><div class="muted">${p.age} · ${p.sex === 'F' ? 'Female' : 'Male'} · prefers ${p.preferredLang === 'ar' ? 'Arabic' : 'English'}</div></div></div>
    <dl class="kv">
      <dt>Emirates ID</dt><dd class="num">${esc(p.emiratesId)}</dd>
      <dt>Insurance</dt><dd>${esc(p.insurance.plan)}</dd>
      <dt>Conditions</dt><dd>${p.conditions.map((c) => `<span class="tag">${esc(c.name)}</span>`).join('')}</dd>
    </dl>`;

  const badLab = (l) => {
    const v = l.results[l.results.length - 1][1];
    const ref = l.ref.match(/([<>])\s*([\d.]+)/);
    if (ref) return ref[1] === '<' ? v >= Number(ref[2]) : v <= Number(ref[2]);
    const range = l.ref.match(/([\d.]+)\s*–\s*([\d.]+)/);
    return range ? v < Number(range[1]) || v > Number(range[2]) : false;
  };
  $('#labs').innerHTML = p.labs.map((l) => {
    const last = l.results[l.results.length - 1];
    const bad = badLab(l);
    return `<div class="lab"><div><div>${esc(l.name)}</div><div class="small muted">ref ${esc(l.ref)} · ${esc(last[0])}</div></div>
      <span style="color:${bad ? 'var(--red)' : 'var(--ink)'}">${sparkline(l.results.map((r) => r[1]), { w: 80, h: 28 })}</span>
      <div class="v ${bad ? 'bad' : ''} num">${last[1]}${l.unit === '%' ? '<span class="small muted">%</span>' : ''}</div></div>`;
  }).join('');

  $('#genomeSrc').textContent = p.genome.source.replace(/\s*\(.*\)/, '');
  $('#genome').innerHTML = p.genome.variants.map((v) => `<div class="variant"><b>${esc(v.gene)} ${esc(v.genotype)}</b><div class="muted">${esc(v.phenotype)}</div></div>`).join('');

  const w = p.wearable;
  $('#wearSrc').textContent = w.device;
  $('#wearable').innerHTML = `
    <div class="lab"><div><div>Resting heart rate</div><div class="small muted">last 30 days</div></div>
      <span style="color:var(--red)">${sparkline(w.restingHr.map((r) => r[1]), { w: 80, h: 28 })}</span>
      <div class="v num">${w.restingHr[w.restingHr.length - 1][1]}<span class="small muted"> bpm</span></div></div>
    <div class="lab"><div>Steps / day</div><span></span><div class="v num">${w.stepsAvg7d.toLocaleString()}</div></div>
    <div class="lab"><div>Sleep</div><span></span><div class="v num" style="font-size:13px">${esc(w.sleepAvg7d)}</div></div>
    ${w.irregularRhythmAlerts.length ? `<div class="small" style="margin-top:6px"><span class="alert-title">Irregular rhythm alerts</span><div class="alert-dots">${w.irregularRhythmAlerts.map((d) => `<span>${esc(d)}</span>`).join('')}</div></div>` : ''}`;

  $('#meds').innerHTML = p.medications.length
    ? p.medications.map((m) => `<div class="variant"><span style="font-weight:600">${esc(m.name)}</span> <span class="muted">${esc(m.dose)}</span></div>`).join('')
    : '<div class="empty">No medications.</div>';

  $('#findCount').textContent = `${findings.length} found`;
  renderFindings();
  renderActions();
}

function handledRef(f) {
  const key = f.id.startsWith('img') ? 'img' : f.id.startsWith('ref') ? 'ref' : f.id;
  const words = HANDLED_BY[key] || [];
  const items = [
    ...ui.data.bookings.map((b) => ({ ref: b.ref, text: `${b.specialty} ${b.reason}` })),
    ...ui.data.preauths.map((a) => ({ ref: a.ref, text: `${a.procedure} ${a.justification}` })),
    ...ui.data.alerts.map((a) => ({ ref: a.ref, text: a.summary })),
  ];
  const hit = items.find((it) => words.some((w) => new RegExp(`\\b${w}`, 'i').test(it.text)));
  return hit && hit.ref;
}

function renderFindings() {
  $('#findings').innerHTML = ui.data.findings.map((f) => {
    const done = handledRef(f);
    return `<div class="finding ${f.severity}">
      <div class="top"><span class="sev ${f.severity}">${f.severity}</span><span class="small muted">${esc(f.category)}</span></div>
      <h3>${esc(f.title)}</h3>
      <p>${esc(f.plain)}</p>
      <details><summary>Evidence</summary><ul>${f.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>
      <div class="foot">
        ${done ? `<span class="done">✓ Handled · <b>${esc(done)}</b></span>` : `<button class="btn sm primary" data-ask="${esc(f.id)}">Ask Rafeeq to handle</button>`}
        ${f.preauth ? `<span class="tag">Needs pre-auth: ${esc(f.preauth)}</span>` : ''}
      </div></div>`;
  }).join('') || '<div class="empty">No missed findings.</div>';
}

function renderActions() {
  const { bookings, preauths, alerts, visitPrep } = ui.data;
  const cards = [];
  for (const a of alerts) cards.push(`<div class="action alert"><b>Care team alerted · ${esc(a.priority)} priority</b>${esc(a.summary)}<div class="ref">${esc(a.ref)}</div></div>`);
  for (const pa of preauths) cards.push(`<div class="action pa"><b>Pre-authorization · ${esc(pa.procedure)}</b>${esc(pa.payer)}: ${esc(pa.status)}, decision in ${esc(pa.eta)}<div class="ref">${esc(pa.ref)}</div></div>`);
  for (const b of bookings) cards.push(`<div class="action"><b>Booked · ${esc(b.specialty)}</b>${esc(b.dateLabel)}, ${esc(b.time)} · ${esc(b.location)}<div class="ref">${esc(b.ref)}</div></div>`);
  if (visitPrep) {
    cards.push(`<div class="action prep"><b>Visit sheet · ${esc(visitPrep.specialty)}</b>
      <div class="small muted">Questions to ask</div><ol>${visitPrep.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>
      <div class="small muted">Latest results</div><ul>${visitPrep.labs.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="small muted">Current medicines</div><ul>${visitPrep.medications.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`);
  }
  $('#actions').innerHTML = cards.length ? cards.reverse().join('') : '<div class="empty">Nothing yet. Ask Rafeeq to act.</div>';
}

async function load() {
  ui.data = await api.get(`/api/patients/${ui.patientId}`);
  renderRecord();
}

// ---------- agent ----------
function addMsg(cls, text) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.dir = 'auto';
  div.textContent = text;
  $('#transcript').appendChild(div);
  $('#transcript').scrollTop = $('#transcript').scrollHeight;
}

const TOOL_LABEL = {
  book_appointment: (p) => `Booking ${p.specialty}…`,
  submit_preauthorization: (p) => `Filing insurance pre-auth: ${p.procedure}…`,
  notify_care_team: (p) => `Alerting care team (${p.priority})…`,
  prepare_visit_summary: (p) => `Preparing visit sheet: ${p.specialty}…`,
};

function setOrb(mode) {
  $('#orb').className = `orb ${mode}`;
}

function setRunning(running, textOnly) {
  $('#talkBtn').hidden = running;
  $('#typeBtn').hidden = running;
  $('#endBtn').hidden = !running;
  $('#composer').hidden = !running;
  if (!running) setOrb('idle');
  if (running && textOnly) setOrb('listening');
}

async function start(textOnly, firstText) {
  if (ui.session || ui.starting) { if (firstText && ui.session) ui.session.sendText(firstText); return; }
  ui.starting = true;
  $('#noteBox').innerHTML = '';
  $('#transcript').innerHTML = '';
  $('#agentStatus').textContent = textOnly ? 'Connecting…' : 'Connecting… allow the microphone if asked.';
  try {
    ui.session = await startAgent({ role: 'companion', lang: ui.lang, id: ui.patientId, textOnly }, {
      onMessage: (role, text) => addMsg(role, text),
      onMode: (mode) => { if (!textOnly) { setOrb(mode); $('#agentStatus').textContent = mode === 'speaking' ? 'Rafeeq is speaking. Talk anytime to interrupt.' : 'Listening…'; } },
      onStatus: (s) => { if (s === 'connected') $('#agentStatus').textContent = textOnly ? 'Connected (text mode).' : 'Connected. Just talk.'; },
      onTool: (name, p) => { addMsg('tool', (TOOL_LABEL[name] || ((x) => name))(p)); load(); },
      onError: (m) => addMsg('err', m),
      onEnd: (transcript) => onEnded(transcript),
    });
    setRunning(true, textOnly);
    if (firstText) setTimeout(() => ui.session && ui.session.sendText(firstText), 400);
  } catch (e) {
    $('#agentStatus').textContent = micHint(e);
    ui.session = null;
  } finally {
    ui.starting = false;
  }
}

async function onEnded(transcript) {
  ui.session = null;
  setRunning(false);
  if (ui.resetting) return;
  $('#agentStatus').textContent = 'Session ended. Writing the care-team note…';
  try {
    const note = await api.post('/api/note', { role: 'companion', id: ui.patientId, transcript });
    $('#noteBox').innerHTML = noteHtml(note, 'Note sent to care team');
    $('#agentStatus').textContent = 'Session ended.';
  } catch (e) {
    $('#agentStatus').textContent = `Session ended. (Note failed: ${e.message})`;
  }
}

function noteHtml(n, title) {
  const list = (label, arr) => (arr && arr.length ? `<div class="small muted">${label}</div><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  return `<div class="note"><h4><span>${esc(title)}</span><span class="provider-tag">${esc(n.provider)}</span></h4>
    <div>${esc(n.summary)}</div>${list('Actions taken', n.actionsTaken)}${list('Follow-ups', n.followUps)}${list('Risk flags', n.riskFlags)}
    ${n.sentiment ? `<div class="small muted">Patient sentiment: ${esc(n.sentiment)}</div>` : ''}</div>`;
}

async function end() { if (ui.session) await ui.session.end(); }

function renderChips() {
  $('#chips').innerHTML = CHIPS[ui.lang].map((c) => `<button class="chip" dir="auto">${esc(c)}</button>`).join('');
}

// ---------- wiring ----------
$('#talkBtn').onclick = () => start(false);
$('#typeBtn').onclick = () => start(true);
$('#endBtn').onclick = end;
$('#composer').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#msgInput').value.trim();
  if (!v || !ui.session) return;
  ui.session.sendText(v);
  $('#msgInput').value = '';
};
$('#chips').onclick = (e) => { const b = e.target.closest('.chip'); if (b) start(ui.session ? ui.session.textOnly : true, b.textContent); };
$('#findings').onclick = (e) => {
  const b = e.target.closest('[data-ask]');
  if (!b) return;
  const f = ui.data.findings.find((x) => x.id === b.dataset.ask);
  const text = ui.lang === 'ar' ? `ساعدني في هذا الأمر: ${f.title}` : `Please help me with this: ${f.title}`;
  start(ui.session ? ui.session.textOnly : true, text);
};

async function switchTo({ lang, patientId }) {
  await end();
  if (lang) ui.lang = lang;
  if (patientId) ui.patientId = patientId;
  const q = new URLSearchParams({ p: ui.patientId, lang: ui.lang });
  history.replaceState(null, '', `?${q}`);
  document.querySelectorAll('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.lang === ui.lang));
  $('#msgInput').placeholder = ui.lang === 'ar' ? 'اكتب رسالة…' : 'Type a message…';
  renderChips();
  $('#transcript').innerHTML = '';
  $('#noteBox').innerHTML = '';
  $('#agentStatus').textContent = 'Ready when you are.';
  await load();
}
$('#langSeg').onclick = (e) => { const b = e.target.closest('button'); if (b && b.dataset.lang !== ui.lang) switchTo({ lang: b.dataset.lang }); };
$('#patientSel').onchange = (e) => switchTo({ patientId: e.target.value });

onServerEvents(async (ev) => {
  if (ev.type === 'reset') {
    if (ui.session) { ui.resetting = true; await end(); ui.resetting = false; }
    $('#transcript').innerHTML = '';
    $('#noteBox').innerHTML = '';
    $('#agentStatus').textContent = 'Demo data reset. Ready when you are.';
    return load();
  }
  if (ev.patientId === ui.patientId && ['booking', 'preauth', 'alert', 'visitprep'].includes(ev.type)) load();
});
wireResetButton($('#resetBtn'));

(async function init() {
  checkStatus($('#banner'));
  const patients = await api.get('/api/patients');
  if (!patients.some((p) => p.id === ui.patientId)) ui.patientId = patients[0].id;
  $('#patientSel').innerHTML = patients.map((p) => `<option value="${esc(p.id)}" ${p.id === ui.patientId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  await switchTo({});
})();
