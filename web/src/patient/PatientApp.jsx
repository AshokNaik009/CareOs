// Patient agent page (idea 1).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../shared/api.js';
import { micHint } from '../shared/format.js';
import { useAgentSession, useAgentStatus, useLatest, useServerEvents } from '../shared/hooks.js';
import TopBar from '../shared/components/TopBar.jsx';
import Banner from '../shared/components/Banner.jsx';
import ResetButton from '../shared/components/ResetButton.jsx';
import Transcript from '../shared/components/Transcript.jsx';
import Composer from '../shared/components/Composer.jsx';
import NoteCard from '../shared/components/NoteCard.jsx';
import Record from './Record.jsx';
import Findings from './Findings.jsx';
import ActionsDone from './ActionsDone.jsx';

const CHIPS = {
  en: ['What did you find in my record?', 'Explain my HbA1c trend', 'Why does my genome matter for my medicines?', 'Prepare me for my cardiology visit'],
  ar: ['ماذا وجدت في سجلي؟', 'اشرح لي نتيجة السكر التراكمي', 'لماذا تهم جيناتي لأدويتي؟', 'جهّزني لموعد طبيب القلب'],
};

const TOOL_LABEL = {
  book_appointment: (p) => `Booking ${p.specialty}…`,
  submit_preauthorization: (p) => `Filing insurance pre-auth: ${p.procedure}…`,
  notify_care_team: (p) => `Alerting care team (${p.priority})…`,
  prepare_visit_summary: (p) => `Preparing visit sheet: ${p.specialty}…`,
};

const READY = 'Ready when you are.';
const initialParams = new URLSearchParams(location.search);

export default function PatientApp() {
  const banner = useAgentStatus();
  const [lang, setLang] = useState(initialParams.get('lang') === 'ar' ? 'ar' : 'en');
  const [patientId, setPatientId] = useState(initialParams.get('p') || 'P-1001');
  const [patients, setPatients] = useState(null);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(READY);
  const [note, setNote] = useState(null);

  const patientIdRef = useLatest(patientId);
  const loadSeq = useRef(0);
  // Bumped whenever the view is switched or reset, so a note from an older session is not shown.
  const gen = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const d = await api.get(`/api/patients/${encodeURIComponent(patientIdRef.current)}`);
      if (seq === loadSeq.current) setData(d);
    } catch (e) {
      console.error(e);
    }
  }, [patientIdRef]);

  const agent = useAgentSession({
    onMode: (mode) => setStatus(mode === 'speaking' ? 'Rafeeq is speaking. Talk anytime to interrupt.' : 'Listening…'),
    onStatus: (s, opts) => { if (s === 'connected') setStatus(opts.textOnly ? 'Connected (text mode).' : 'Connected. Just talk.'); },
    onTool: (name, p) => { agent.addMsg('tool', (TOOL_LABEL[name] || (() => name))(p)); load(); },
    onEnd: async (transcript, opts) => {
      if (opts.gen !== gen.current) return;
      setStatus('Session ended. Writing the care-team note…');
      try {
        const n = await api.post('/api/note', { role: 'companion', id: opts.id, transcript });
        if (opts.gen !== gen.current) return;
        setNote(n);
        setStatus('Session ended.');
      } catch (e) {
        if (opts.gen === gen.current) setStatus(`Session ended. (Note failed: ${e.message})`);
      }
    },
  });

  // Patient list first, so an unknown ?p= falls back to the first patient.
  useEffect(() => {
    let alive = true;
    api.get('/api/patients').then((list) => {
      if (!alive) return;
      setPatientId((id) => (list.some((p) => p.id === id) ? id : list[0].id));
      setPatients(list);
    }).catch((e) => console.error(e));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!patients) return;
    history.replaceState(null, '', `?${new URLSearchParams({ p: patientId, lang })}`);
    load();
  }, [patients, patientId, lang, load]);

  async function start(textOnly, firstText) {
    if (agent.busy()) { if (firstText) agent.sendText(firstText); return; }
    setNote(null);
    agent.clear();
    setStatus(textOnly ? 'Connecting…' : 'Connecting… allow the microphone if asked.');
    try {
      await agent.start({ role: 'companion', lang, id: patientId, textOnly, gen: gen.current });
      if (firstText) setTimeout(() => agent.sendText(firstText), 400);
    } catch (e) {
      setStatus(micHint(e));
    }
  }

  const startForText = (text) => {
    const s = agent.session();
    start(s ? s.textOnly : true, text);
  };

  async function switchTo(next) {
    await agent.end();
    gen.current++;
    if (next.lang) setLang(next.lang);
    if (next.patientId) setPatientId(next.patientId);
    agent.clear();
    setNote(null);
    setStatus(READY);
  }

  useServerEvents(async (ev) => {
    if (ev.type === 'reset') {
      await agent.endSilently();
      gen.current++;
      agent.clear();
      setNote(null);
      setStatus('Demo data reset. Ready when you are.');
      return load();
    }
    if (ev.patientId === patientIdRef.current && ['booking', 'preauth', 'alert', 'visitprep'].includes(ev.type)) load();
  });

  const running = agent.running;
  return (
    <>
      <TopBar active="patient" brand={<>Rafeeq <span className="ar">رفيق</span> <small>Personal health agent</small></>}>
        <select aria-label="Patient" value={patients ? patientId : ''} onChange={(e) => switchTo({ patientId: e.target.value })}>
          {(patients || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <ResetButton />
        <div className="seg">
          {['en', 'ar'].map((l) => (
            <button key={l} data-lang={l} className={lang === l ? 'on' : undefined} onClick={() => { if (l !== lang) switchTo({ lang: l }); }}>
              {l === 'en' ? 'English' : 'عربي'}
            </button>
          ))}
        </div>
      </TopBar>
      <Banner text={banner} />

      <main className="page grid-3">
        <Record patient={data && data.patient} />

        <section>
          <div className="card agent">
            <h2 style={{ justifyContent: 'center' }}>Talk to Rafeeq</h2>
            <div className="orb-wrap"><div className={`orb ${agent.orb}`}></div></div>
            <div className="agent-status">{status}</div>
            <div className="btns">
              {running ? (
                <button className="btn danger" onClick={() => agent.end()}>End</button>
              ) : (
                <>
                  <button className="btn primary" onClick={() => start(false)}>Start voice</button>
                  <button className="btn" onClick={() => start(true)}>Type instead</button>
                </>
              )}
            </div>
            <div className="chips">
              {CHIPS[lang].map((c) => <button key={c} className="chip" dir="auto" onClick={() => startForText(c)}>{c}</button>)}
            </div>
            <Transcript messages={agent.messages} />
            {running ? <Composer placeholder={lang === 'ar' ? 'اكتب رسالة…' : 'Type a message…'} onSend={agent.sendText} /> : null}
            <div>{note ? <NoteCard note={note} title="Note sent to care team" who="Patient" /> : null}</div>
          </div>
        </section>

        <section>
          <div className="card">
            <h2>Safety net: missed findings <span className="source">{data ? `${data.findings.length} found` : ''}</span></h2>
            <Findings data={data} onAsk={(f) => startForText(lang === 'ar' ? `ساعدني في هذا الأمر: ${f.title}` : `Please help me with this: ${f.title}`)} />
          </div>
          <div className="card">
            <h2>Done on your behalf</h2>
            <ActionsDone data={data} />
          </div>
        </section>
      </main>
    </>
  );
}
