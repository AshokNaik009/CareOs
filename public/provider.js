// Care OS page (idea 2): risk-bearing provider running on the same agents.

const ui = { pop: null, selected: null, session: null, starting: false, briefs: {}, seen: new Set() };

const STATUS_LABEL = { open: 'Open', booked: 'Booked', engaged: 'Engaged by agent', escalated: 'Escalated', callback: 'Callback', declined: 'Declined' };

function riskClass(r) { return r >= 70 ? 'h' : r >= 45 ? 'm' : 'l'; }

function renderKpis() {
  const { contract: c, kpis: k } = ui.pop;
  $('#contractLabel').textContent = `${c.payer} · ${c.cohort} · ${c.label}`;
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="l">Members under contract</div><div class="v">${c.members.toLocaleString()}</div><div class="s">${esc(c.cohort)}</div></div>
    <div class="kpi"><div class="l">Capitation</div><div class="v">${aed(c.capitationPmpm)}</div><div class="s">per member per month · ${aedShort(k.monthlyRevenue)}/mo</div></div>
    <div class="kpi"><div class="l">Medical cost PMPM</div><div class="v good">${aed(k.currentCostPmpm)}</div><div class="s">down from ${aed(c.baselineCostPmpm)} before program</div></div>
    <div class="kpi"><div class="l">Medical loss ratio</div><div class="v">${k.mlr}%</div><div class="s">last 3 months</div></div>
    <div class="kpi"><div class="l">Annualized savings</div><div class="v good">${aedShort(k.annualizedSavings)}</div><div class="s">we keep the margin</div></div>
    <div class="kpi live"><div class="l">This session · AI outreach</div><div class="v">${aed(k.sessionSavings)}</div><div class="s">${k.gapsClosed} member${k.gapsClosed === 1 ? '' : 's'} closed · expected admissions avoided</div></div>`;
  $('#assumptions').textContent = `Illustrative economics on synthetic data. Expected avoided cost per closed member = 90-day admission risk × ${Math.round(c.outreachRiskReduction * 100)}% assumed risk reduction × ${aed(c.avgAdmissionCost)} average admission.`;
}

function renderRows() {
  $('#rows').innerHTML = ui.pop.members.map((m, i) => `
    <tr data-id="${esc(m.id)}" class="${ui.selected === m.id ? 'sel' : ''}">
      <td class="muted num">${i + 1}</td>
      <td><b>${esc(m.name)}</b>${m.linkedPatientAgent ? '<span class="link-badge">has Rafeeq</span>' : ''}<div class="small muted">${m.age} · ${m.sex}</div></td>
      <td>${esc(m.cohort)}</td>
      <td><span class="risk ${riskClass(m.riskScore)} num">${m.riskScore}</span><div class="small muted">${Math.round(m.pAdmit90 * 100)}% adm.</div></td>
      <td>${m.gaps.length} <span class="small muted">· ${esc(m.gaps[0])}</span></td>
      <td>${m.lang === 'ar' ? 'عربي' : 'EN'}</td>
      <td><span class="status ${esc(m.status)}">${esc(STATUS_LABEL[m.status] || m.status)}</span></td>
    </tr>`).join('');
}

function renderChart() {
  const { costs, contract: c } = ui.pop;
  const W = 640, H = 220, padL = 44, padB = 26, padT = 12;
  const min = 800, max = 1250;
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const bw = (W - padL - 10) / costs.length;
  const liveIdx = costs.findIndex((x) => x.live);
  const bars = costs.map((m, i) => {
    const x = padL + i * bw + 5;
    return `<rect x="${x}" y="${y(m.cost)}" width="${bw - 10}" height="${H - padB - y(m.cost)}" rx="4" fill="${m.live ? 'var(--ink)' : 'rgba(23,23,23,.16)'}"><title>${m.month}: AED ${m.cost}</title></rect>
      <text x="${x + (bw - 10) / 2}" y="${H - 8}" text-anchor="middle" font-size="10" font-family="Martian Mono, monospace" letter-spacing="1" fill="rgba(23,23,23,.56)">${m.month.toUpperCase()}</text>`;
  }).join('');
  const ticks = [900, 1000, 1100, 1200].map((v) => `<text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" font-family="Martian Mono, monospace" fill="rgba(23,23,23,.56)">${v}</text><line x1="${padL}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(23,23,23,.08)"/>`).join('');
  const lx = padL + liveIdx * bw;
  $('#chart').innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly medical cost per member versus capitation">
    ${ticks}${bars}
    <line x1="${padL}" x2="${W - 6}" y1="${y(c.capitationPmpm)}" y2="${y(c.capitationPmpm)}" stroke="var(--red)" stroke-width="2"/>
    <text x="${W - 8}" y="${y(c.capitationPmpm) - 7}" text-anchor="end" font-size="10" font-family="Martian Mono, monospace" letter-spacing="1.5" fill="var(--red)">CAPITATION ${c.capitationPmpm}</text>
    <line x1="${lx}" x2="${lx}" y1="${padT}" y2="${H - padB}" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 4"/>
    <text x="${lx + 8}" y="${padT + 10}" font-size="10" font-family="Martian Mono, monospace" letter-spacing="1.5" fill="var(--ink)">AI CARE OS LIVE</text>
  </svg>
  <div class="chart-note">Gap between red line and bars = our margin · grey before program · ink after</div>`;
}

// ---------- feed ----------
function evHtml(e) {
  const t = new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const src = e.source === 'patient-agent' ? '<span class="src pa">Patient agent</span>' : e.source === 'outreach' ? '<span class="src">AI outreach</span>' : '<span class="src">System</span>';
  let body;
  switch (e.type) {
    case 'alert': body = `<b>${esc(e.patient)}</b>: ${esc(e.alert.priority)}-priority alert. ${esc(e.alert.summary)} <span class="muted">${esc(e.alert.ref)}</span>`; break;
    case 'booking': body = `<b>${esc(e.patient)}</b>: booked ${esc(e.booking.specialty)}, ${esc(e.booking.dateLabel)} ${esc(e.booking.time)} <span class="muted">${esc(e.booking.ref)}</span>`; break;
    case 'preauth': body = `<b>${esc(e.patient)}</b>: pre-auth filed for ${esc(e.preauth.procedure)} with ${esc(e.preauth.payer)} <span class="muted">${esc(e.preauth.ref)}</span>`; break;
    case 'visitprep': body = `<b>${esc(e.patient)}</b>: visit sheet prepared for ${esc(e.prep.specialty)}`; break;
    case 'call': body = `<b>${esc(e.patient)}</b>: outreach call started (${e.lang === 'ar' ? 'Arabic' : 'English'})`; break;
    case 'outcome': body = `<b>${esc(e.patient)}</b>: call outcome <b>${esc(e.outcome.replace('_', ' '))}</b>. ${esc(e.notes)}`; break;
    case 'savings': body = `Expected avoided cost <b>+${aed(e.avoided)}</b>`; break;
    case 'note': body = `<b>${esc(e.patient)}</b>: AI clinical note. ${esc(e.note.summary)}`; break;
    default: return '';
  }
  return `<div class="ev ${ui.seen.has(e.id) ? '' : 'new'}"><time>${t}</time><div>${src}<div>${body}</div></div></div>`;
}

function renderFeed() {
  const evs = ui.pop.events.filter((e) => e.type !== 'member').slice().reverse();
  $('#feed').innerHTML = evs.length ? evs.map(evHtml).join('') : '<div class="empty">Waiting for activity…</div>';
  evs.forEach((e) => ui.seen.add(e.id));
}

// ---------- member panel ----------
function memberById(id) { return ui.pop.members.find((m) => m.id === id); }

function renderMember() {
  const m = memberById(ui.selected);
  if (!m) return;
  const brief = ui.briefs[m.id];
  const other = m.lang === 'ar' ? 'en' : 'ar';
  const label = (l) => (l === 'ar' ? 'Arabic' : 'English');
  $('#member').innerHTML = `
    <h2>Member</h2>
    <div class="profile"><div class="avatar">${esc(m.name.split(' ').map((w) => w[0]).slice(0, 2).join(''))}</div>
      <div><h1 style="font-size:18px">${esc(m.name)}</h1><div class="muted">${m.age} · ${esc(m.cohort)} · prefers ${label(m.lang)} · last contact ${m.lastContactDays} days ago</div></div></div>
    <div style="margin-top:10px"><span class="risk ${riskClass(m.riskScore)}">${m.riskScore}</span> <span class="muted small">risk score · ${Math.round(m.pAdmit90 * 100)}% predicted 90-day admission</span>
      <span class="status ${esc(m.status)}" style="margin-left:6px">${esc(STATUS_LABEL[m.status] || m.status)}</span></div>
    ${m.outcome ? `<div class="small muted" style="margin-top:6px">Last outcome: ${esc(m.outcome)}</div>` : ''}
    <div class="small muted" style="margin-top:12px">Open care gaps</div>
    <ol class="gaps">${m.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ol>
    <div class="brief" style="margin-top:12px">${brief ? (brief.error ? `<span class="muted">${esc(brief.error)}</span>` : `
      <div style="display:flex;justify-content:space-between;gap:8px"><span class="label" style="color:var(--ink)">AI pre-call brief</span><span class="provider-tag">${esc(brief.provider)}</span></div>
      <div class="headline">${esc(brief.headline)}</div>
      <div class="muted">${esc(brief.whyNow)}</div>
      <div class="small muted" style="margin-top:6px">Talking points</div><ul>${(brief.talkingPoints || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="small muted">Likely barriers</div><ul>${(brief.likelyBarriers || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`) : '<span class="muted">Writing AI pre-call brief…</span>'}</div>
    <div class="agent" style="margin-top:14px">
      <div class="orb-wrap" style="padding:6px 0"><div class="orb idle" id="orb" style="width:72px;height:72px"></div></div>
      <div class="agent-status" id="agentStatus">AI outreach agent "Noor" is ready. You play ${esc(m.firstName)}.</div>
      <div class="btns" id="callBtns">
        <button class="btn primary" data-call="${m.lang}">Call in ${label(m.lang)}</button>
        <button class="btn" data-call="${other}">Call in ${label(other)}</button>
        <button class="btn" data-type="${m.lang}">Simulate by text</button>
      </div>
      <div class="btns"><button class="btn danger" id="endBtn" hidden>Hang up</button></div>
      <div class="transcript" id="transcript"></div>
      <form class="composer" id="composer" hidden><input id="msgInput" autocomplete="off" placeholder="Reply as ${esc(m.firstName)}…" dir="auto"><button class="btn primary sm" type="submit">Send</button></form>
      <div id="noteBox"></div>
    </div>`;
  if (ui.session) setCallUi(true, ui.session.textOnly);
}

async function select(id) {
  if (ui.session) return; // keep the call focused
  ui.selected = id;
  renderRows();
  renderMember();
  if (!ui.briefs[id]) {
    try { ui.briefs[id] = await api.post('/api/brief', { id }); } catch (e) { ui.briefs[id] = { error: `Brief unavailable: ${e.message}` }; }
    if (ui.selected === id) renderMember();
  }
}

function addMsg(cls, text) {
  const box = $('#transcript');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.dir = 'auto';
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function setCallUi(running, textOnly) {
  $('#callBtns').hidden = running;
  $('#endBtn').hidden = !running;
  $('#composer').hidden = !(running && textOnly);
  if (!running) $('#orb').className = 'orb idle';
  else if (textOnly) $('#orb').className = 'orb listening';
}

const TOOL_LABEL = {
  schedule_visit: (p) => `Scheduling ${p.visit_type}…`,
  log_call_outcome: (p) => `Logging outcome: ${p.outcome}`,
  escalate_to_nurse: () => 'Escalating to on-call nurse…',
};

async function call(lang, textOnly) {
  if (ui.session || ui.starting) return;
  ui.starting = true;
  const id = ui.selected;
  $('#transcript').innerHTML = '';
  $('#noteBox').innerHTML = '';
  $('#agentStatus').textContent = textOnly ? 'Connecting…' : 'Dialling… allow the microphone. You are the member.';
  try {
    ui.session = await startAgent({ role: 'outreach', lang, id, textOnly }, {
      onMessage: (role, text) => addMsg(role, text),
      onMode: (mode) => { if (!textOnly && $('#orb')) { $('#orb').className = `orb ${mode}`; $('#agentStatus').textContent = mode === 'speaking' ? 'Noor is speaking…' : 'Listening to member…'; } },
      onStatus: (s) => { if (s === 'connected' && $('#agentStatus')) $('#agentStatus').textContent = textOnly ? 'Connected (text simulation). Reply as the member.' : 'Connected. Answer as the member.'; },
      onTool: (name, p) => addMsg('tool', (TOOL_LABEL[name] || (() => name))(p)),
      onError: (m) => addMsg('err', m),
      onEnd: (transcript) => ended(id, transcript),
    });
    setCallUi(true, textOnly);
  } catch (e) {
    $('#agentStatus').textContent = micHint(e);
    ui.session = null;
  } finally {
    ui.starting = false;
  }
}

async function ended(id, transcript) {
  ui.session = null;
  if (ui.resetting) return;
  if (ui.selected !== id) return;
  setCallUi(false);
  $('#agentStatus').textContent = 'Call ended. Writing clinical note…';
  try {
    const n = await api.post('/api/note', { role: 'outreach', id, transcript });
    const list = (label, arr) => (arr && arr.length ? `<div class="small muted">${label}</div><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    if ($('#noteBox')) $('#noteBox').innerHTML = `<div class="note"><h4><span>AI clinical note</span><span class="provider-tag">${esc(n.provider)}</span></h4><div>${esc(n.summary)}</div>${list('Actions taken', n.actionsTaken)}${list('Follow-ups', n.followUps)}${list('Risk flags', n.riskFlags)}${n.sentiment ? `<div class="small muted">Member sentiment: ${esc(n.sentiment)}</div>` : ''}</div>`;
    if ($('#agentStatus')) $('#agentStatus').textContent = 'Call ended.';
  } catch (e) {
    if ($('#agentStatus')) $('#agentStatus').textContent = `Call ended. (Note failed: ${e.message})`;
  }
}

// ---------- wiring ----------
$('#rows').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) select(tr.dataset.id); };
$('#member').addEventListener('click', (e) => {
  const c = e.target.closest('[data-call]');
  if (c) return call(c.dataset.call, false);
  const t = e.target.closest('[data-type]');
  if (t) return call(t.dataset.type, true);
  if (e.target.id === 'endBtn' && ui.session) ui.session.end();
});
$('#member').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#msgInput');
  const v = input.value.trim();
  if (v && ui.session) { ui.session.sendText(v); input.value = ''; }
});

let refreshTimer;
async function refresh() {
  ui.pop = await api.get('/api/population');
  renderKpis();
  renderRows();
  renderFeed();
  // Update the member header without wiping an in-progress call transcript.
  if (ui.selected && !ui.session) renderMember();
}
onServerEvents(async (ev) => {
  if (ev.type === 'reset') {
    if (ui.session) { ui.resetting = true; await ui.session.end().catch(() => {}); ui.resetting = false; }
    ui.session = null;
    ui.briefs = {};
    ui.seen = new Set();
    await refresh();
    if (ui.selected) { renderMember(); select(ui.selected); }
    return;
  }
  clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250);
});
wireResetButton($('#resetBtn'));

(async function init() {
  checkStatus($('#banner'));
  await refresh();
  renderChart();
  const pre = new URLSearchParams(location.search).get('m');
  if (pre && memberById(pre)) select(pre);
})();
