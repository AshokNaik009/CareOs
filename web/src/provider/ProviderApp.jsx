// Care OS page (idea 2): risk-bearing provider running on the same agents.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../shared/api.js';
import { aed, micHint } from '../shared/format.js';
import { useAgentSession, useAgentStatus, useLatest, useServerEvents } from '../shared/hooks.js';
import TopBar from '../shared/components/TopBar.jsx';
import Banner from '../shared/components/Banner.jsx';
import ResetButton from '../shared/components/ResetButton.jsx';
import Kpis from './Kpis.jsx';
import Worklist from './Worklist.jsx';
import CostChart from './CostChart.jsx';
import Feed from './Feed.jsx';
import MemberPanel from './MemberPanel.jsx';

const TOOL_LABEL = {
  schedule_visit: (p) => `Scheduling ${p.visit_type}…`,
  log_call_outcome: (p) => `Logging outcome: ${p.outcome}`,
  escalate_to_nurse: () => 'Escalating to on-call nurse…',
};

export default function ProviderApp() {
  const banner = useAgentStatus();
  const [pop, setPop] = useState(null);
  const [selected, setSelected] = useState(null);
  const [briefs, setBriefs] = useState({});
  const [status, setStatus] = useState(null); // null → the panel's default "ready" line
  const [note, setNote] = useState(null);

  const selectedRef = useLatest(selected);
  const refreshSeq = useRef(0);
  const refreshTimer = useRef(null);
  const requested = useRef(new Set()); // member ids whose brief was already requested
  const briefEpoch = useRef(0); // bumped on demo reset: briefs requested before it are discarded
  const seen = useRef(new Set()); // feed event ids already shown (only new ones animate)
  // Bumped on member switch and demo reset, so late briefs/notes for an old view are dropped.
  const gen = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const p = await api.get('/api/population');
    if (seq === refreshSeq.current) setPop(p);
    return p;
  }, []);

  const agent = useAgentSession({
    onMode: (mode) => setStatus(mode === 'speaking' ? 'Noor is speaking…' : 'Listening to member…'),
    onStatus: (s, opts) => { if (s === 'connected') setStatus(opts.textOnly ? 'Connected (text simulation). Reply as the member.' : 'Connected. Answer as the member.'); },
    onTool: (name, p) => agent.addMsg('tool', (TOOL_LABEL[name] || (() => name))(p)),
    onEnd: async (transcript, opts) => {
      if (selectedRef.current !== opts.id || opts.gen !== gen.current) return;
      setStatus('Call ended. Writing clinical note…');
      try {
        const n = await api.post('/api/note', { role: 'outreach', id: opts.id, transcript });
        if (opts.gen !== gen.current) return;
        setNote(n);
        setStatus('Call ended.');
      } catch (e) {
        if (opts.gen === gen.current) setStatus(`Call ended. (Note failed: ${e.message})`);
      }
    },
  });

  const fetchBrief = useCallback(async (id) => {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    const epoch = briefEpoch.current;
    let brief;
    try { brief = await api.post('/api/brief', { id }); } catch (e) { brief = { error: `Brief unavailable: ${e.message}` }; }
    if (epoch === briefEpoch.current) setBriefs((b) => ({ ...b, [id]: brief }));
  }, []);

  function select(id) {
    if (agent.busy()) return; // keep the call focused
    gen.current++;
    setSelected(id);
    agent.clear();
    setNote(null);
    setStatus(null);
    fetchBrief(id);
  }

  async function call(lang, textOnly) {
    if (agent.busy()) return;
    agent.clear();
    setNote(null);
    setStatus(textOnly ? 'Connecting…' : 'Dialling… allow the microphone. You are the member.');
    try {
      await agent.start({ role: 'outreach', lang, id: selected, textOnly, gen: gen.current });
    } catch (e) {
      setStatus(micHint(e));
    }
  }

  const selectRef = useLatest(select);
  useEffect(() => {
    refresh().then((p) => {
      const pre = new URLSearchParams(location.search).get('m');
      if (pre && p.members.some((m) => m.id === pre)) selectRef.current(pre);
    }).catch((e) => console.error(e));
    return () => clearTimeout(refreshTimer.current);
  }, [refresh, selectRef]);

  useServerEvents(async (ev) => {
    if (ev.type === 'reset') {
      await agent.endSilently();
      clearTimeout(refreshTimer.current);
      briefEpoch.current++;
      requested.current = new Set();
      seen.current = new Set();
      setBriefs({});
      await refresh();
      if (selectedRef.current) selectRef.current(selectedRef.current);
      else gen.current++;
      return;
    }
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => refresh().catch((e) => console.error(e)), 250);
  });

  // Newest first; an event animates in only the first time it is shown.
  const feed = useMemo(() => {
    if (!pop) return [];
    return pop.events.filter((e) => e.type !== 'member').slice().reverse().map((e) => ({ event: e, isNew: !seen.current.has(e.id) }));
  }, [pop]);
  useEffect(() => { for (const { event } of feed) seen.current.add(event.id); }, [feed]);

  const c = pop && pop.contract;
  const member = pop && selected ? pop.members.find((m) => m.id === selected) : null;
  return (
    <>
      <TopBar active="provider" brand={<>Rafeeq <span className="mark">Care</span> <small>Risk-bearing care OS</small></>}>
        <span className="demo-note">{c ? `${c.payer} · ${c.cohort} · ${c.label}` : ''}</span>
        <ResetButton />
      </TopBar>
      <Banner text={banner} />

      <main className="page">
        {pop ? <Kpis contract={pop.contract} kpis={pop.kpis} /> : <div className="kpis"></div>}

        <div className="grid-2">
          <section>
            <div className="card">
              <h2>Outreach worklist <span className="source">ranked by 90-day admission risk</span></h2>
              <Worklist members={pop ? pop.members : []} selected={selected} onSelect={select} />
            </div>
            <div className="card">
              <h2>Medical cost vs. capitation <span className="source">AED per member per month</span></h2>
              {pop ? <CostChart costs={pop.costs} contract={pop.contract} /> : <div></div>}
            </div>
          </section>

          <section>
            <MemberPanel member={member} brief={member && briefs[member.id]} agent={agent} status={status} note={note} onCall={call} />
            <div className="card">
              <h2>Live signals <span className="source">patient agents + outreach</span></h2>
              <Feed items={feed} />
            </div>
          </section>
        </div>
        <p className="foot-note">
          {c ? `Illustrative economics on synthetic data. Expected avoided cost per closed member = 90-day admission risk × ${Math.round(c.outreachRiskReduction * 100)}% assumed risk reduction × ${aed(c.avgAdmissionCost)} average admission.` : ''}
        </p>
      </main>
    </>
  );
}
