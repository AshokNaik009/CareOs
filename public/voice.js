// Shared helpers: API calls, live event stream, and the ElevenLabs voice session wrapper.

const api = {
  async get(url) {
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  },
  async post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  },
};

function onServerEvents(handler) {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => { try { handler(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  return es;
}

const TOOL_NAMES = ['book_appointment', 'submit_preauthorization', 'notify_care_team', 'prepare_visit_summary', 'schedule_visit', 'log_call_outcome', 'escalate_to_nurse'];

// Starts a conversation with one of the Rafeeq agents.
// h: { onMessage(role, text), onMode(mode), onStatus(status), onTool(name, params, result), onEnd(transcript), onError(msg) }
async function startAgent({ role, lang, id, textOnly }, h) {
  if (!window.ElevenLabsClient) throw new Error('ElevenLabs client failed to load');
  const session = await api.post('/api/session', { role, lang, id });
  const transcript = [];
  let ended = false;

  const clientTools = {};
  for (const name of TOOL_NAMES) {
    clientTools[name] = async (params) => {
      const r = await api.post('/api/action', { tool: name, id, params });
      h.onTool && h.onTool(name, params, r);
      return r.say;
    };
  }

  const finish = () => {
    if (ended) return;
    ended = true;
    h.onEnd && h.onEnd(transcript);
  };

  const conv = await window.ElevenLabsClient.Conversation.startSession({
    signedUrl: session.signedUrl,
    dynamicVariables: session.dynamicVariables,
    textOnly: !!textOnly,
    clientTools,
    onMessage: ({ source, message }) => {
      const r = source === 'user' ? 'user' : 'agent';
      transcript.push({ role: r, message });
      h.onMessage && h.onMessage(r, message);
    },
    onModeChange: ({ mode }) => h.onMode && h.onMode(mode),
    onStatusChange: ({ status }) => h.onStatus && h.onStatus(status),
    onError: (msg) => h.onError && h.onError(typeof msg === 'string' ? msg : (msg && msg.message) || 'Voice error'),
    onDisconnect: finish,
  });

  return {
    textOnly: !!textOnly,
    transcript,
    sendText(text) {
      transcript.push({ role: 'user', message: text });
      h.onMessage && h.onMessage('user', text);
      conv.sendUserMessage(text);
    },
    async end() { try { await conv.endSession(); } finally { finish(); } },
  };
}

// Two-step reset button: first click arms it, second click within 4s resets the demo data.
function wireResetButton(btn) {
  let armed = null;
  btn.onclick = async () => {
    if (!armed) {
      btn.textContent = 'Confirm reset?';
      btn.classList.add('armed');
      armed = setTimeout(() => { armed = null; btn.textContent = 'Reset demo'; btn.classList.remove('armed'); }, 4000);
      return;
    }
    clearTimeout(armed); armed = null;
    btn.disabled = true; btn.textContent = 'Resetting…';
    try { await api.post('/api/reset', {}); } catch (e) { alert(`Reset failed: ${e.message}`); }
    btn.disabled = false; btn.textContent = 'Reset demo'; btn.classList.remove('armed');
  };
}

// ---- tiny DOM + format helpers ----
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const aed = (n) => `AED ${Math.round(n).toLocaleString('en-US')}`;
const aedShort = (n) => (n >= 1e6 ? `AED ${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `AED ${(n / 1e3).toFixed(0)}K` : aed(n));

function sparkline(values, { w = 120, h = 32, color = 'currentColor' } = {}) {
  if (!values.length) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 6) + 3, h - 4 - ((v - min) / span) * (h - 8)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="3" fill="${color}"/></svg>`;
}

async function checkStatus(banner) {
  try {
    const s = await api.get('/api/status');
    if (s.ready) { banner.hidden = true; return true; }
    banner.hidden = false;
    banner.textContent = s.error ? `Voice agents unavailable: ${s.error}` : 'Setting up voice agents…';
    if (!s.error) setTimeout(() => checkStatus(banner), 1500);
    return false;
  } catch {
    banner.hidden = false; banner.textContent = 'Server unreachable.';
    return false;
  }
}

function micHint(err) {
  const m = String((err && err.message) || err);
  if (/Permission|NotAllowed|denied/i.test(m)) return 'Microphone blocked. Allow mic access in the browser, or use "Type instead".';
  if (/NotFound|device/i.test(m)) return 'No microphone found. Use "Type instead".';
  return m;
}
