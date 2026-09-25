import { initials } from '../shared/format.js';
import Transcript from '../shared/components/Transcript.jsx';
import Composer from '../shared/components/Composer.jsx';
import NoteCard from '../shared/components/NoteCard.jsx';
import { STATUS_LABEL, langLabel, riskClass } from './labels.js';

function Brief({ brief }) {
  if (!brief) return <span className="muted">Writing AI pre-call brief…</span>;
  if (brief.error) return <span className="muted">{brief.error}</span>;
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span className="label" style={{ color: 'var(--ink)' }}>AI pre-call brief</span><span className="provider-tag">{brief.provider}</span></div>
      <div className="headline">{brief.headline}</div>
      <div className="muted">{brief.whyNow}</div>
      <div className="small muted" style={{ marginTop: 6 }}>Talking points</div><ul>{(brief.talkingPoints || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
      <div className="small muted">Likely barriers</div><ul>{(brief.likelyBarriers || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
    </>
  );
}

// Selected member: profile, gaps, AI brief and the outreach call.
export default function MemberPanel({ member: m, brief, agent, status, note, onCall, phoneTo, phoneBusy, onPhoneCall, whatsappTo, waBusy, onWhatsApp }) {
  if (!m) return <div className="card"><div className="empty">Select a member to see their brief and start an AI outreach call.</div></div>;
  const other = m.lang === 'ar' ? 'en' : 'ar';
  const running = agent.running;
  return (
    <div className="card">
      <h2>Member</h2>
      <div className="profile">
        <div className="avatar">{initials(m.name)}</div>
        <div><h1 style={{ fontSize: 18 }}>{m.name}</h1><div className="muted">{m.age} · {m.cohort} · prefers {langLabel(m.lang)} · last contact {m.lastContactDays} days ago</div></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <span className={`risk ${riskClass(m.riskScore)}`}>{m.riskScore}</span> <span className="muted small">risk score · {Math.round(m.pAdmit90 * 100)}% predicted 90-day admission</span>
        <span className={`status ${m.status}`} style={{ marginLeft: 6 }}>{STATUS_LABEL[m.status] || m.status}</span>
      </div>
      {m.outcome ? <div className="small muted" style={{ marginTop: 6 }}>Last outcome: {m.outcome}</div> : null}
      <div className="small muted" style={{ marginTop: 12 }}>Open care gaps</div>
      <ol className="gaps">{m.gaps.map((g, i) => <li key={i}>{g}</li>)}</ol>
      <div className="brief" style={{ marginTop: 12 }}><Brief brief={brief} /></div>
      <div className="agent" style={{ marginTop: 14 }}>
        <div className="orb-wrap" style={{ padding: '6px 0' }}><div className={`orb ${agent.orb}`} style={{ width: 72, height: 72 }}></div></div>
        <div className="agent-status">{status || `AI outreach agent "Noor" is ready. You play ${m.firstName}.`}</div>
        {running ? null : (
          <div className="btns">
            <button className="btn primary" onClick={() => onCall(m.lang, false)}>Call in {langLabel(m.lang)}</button>
            <button className="btn" onClick={() => onCall(other, false)}>Call in {langLabel(other)}</button>
            <button className="btn" onClick={() => onCall(m.lang, true)}>Simulate by text</button>
            {phoneTo ? (
              <button className="btn" disabled={phoneBusy} title={`Real phone call to ${phoneTo}`} onClick={() => onPhoneCall(m.lang)}>
                {phoneBusy ? 'Dialling…' : `Call phone ${phoneTo}`}
              </button>
            ) : null}
            {whatsappTo ? (
              <button className="btn" disabled={waBusy} title={`WhatsApp message to ${whatsappTo}`} onClick={() => onWhatsApp(m.lang)}>
                {waBusy ? 'Sending…' : `WhatsApp ${whatsappTo}`}
              </button>
            ) : null}
          </div>
        )}
        {running ? <div className="btns"><button className="btn danger" onClick={() => agent.end()}>Hang up</button></div> : null}
        <Transcript messages={agent.messages} />
        {running && running.textOnly ? <Composer placeholder={`Reply as ${m.firstName}…`} onSend={agent.sendText} /> : null}
        <div>{note ? <NoteCard note={note} title="AI clinical note" who="Member" /> : null}</div>
      </div>
    </div>
  );
}
