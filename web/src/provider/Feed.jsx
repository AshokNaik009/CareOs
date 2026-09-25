import { aed } from '../shared/format.js';

function Source({ source }) {
  if (source === 'patient-agent') return <span className="src pa">Patient agent</span>;
  return <span className="src">{source === 'outreach' ? 'AI outreach' : 'System'}</span>;
}

function body(e) {
  const who = <b>{e.patient}</b>;
  switch (e.type) {
    case 'alert': return <>{who}: {e.alert.priority}-priority alert. {e.alert.summary} <span className="muted">{e.alert.ref}</span></>;
    case 'booking': return <>{who}: booked {e.booking.specialty}, {e.booking.dateLabel} {e.booking.time} <span className="muted">{e.booking.ref}</span></>;
    case 'preauth': return <>{who}: pre-auth filed for {e.preauth.procedure} with {e.preauth.payer} <span className="muted">{e.preauth.ref}</span></>;
    case 'visitprep': return <>{who}: visit sheet prepared for {e.prep.specialty}</>;
    case 'call': return <>{who}: outreach call started ({e.lang === 'ar' ? 'Arabic' : 'English'})</>;
    case 'outcome': return <>{who}: call outcome <b>{e.outcome.replace('_', ' ')}</b>. {e.notes}</>;
    case 'savings': return <>Expected avoided cost <b>+{aed(e.avoided)}</b></>;
    case 'note': return <>{who}: AI clinical note. {e.note.summary}</>;
    default: return null;
  }
}

// items: [{ event, isNew }] newest first.
export default function Feed({ items }) {
  const rows = items.map(({ event: e, isNew }) => {
    const b = body(e);
    if (!b) return null;
    const t = new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return (
      <div key={e.id} className={`ev ${isNew ? 'new' : ''}`}>
        <time>{t}</time>
        <div><Source source={e.source} /><div>{b}</div></div>
      </div>
    );
  });
  return <div className="feed">{items.length ? rows : <div className="empty">Waiting for activity…</div>}</div>;
}
