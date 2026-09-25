// "Done on your behalf": newest first (visit sheet, then bookings, pre-auths, alerts).
export default function ActionsDone({ data }) {
  const empty = <div><div className="empty">Nothing yet. Ask Rafeeq to act.</div></div>;
  if (!data) return empty;
  const { bookings, preauths, alerts, visitPrep } = data;
  const cards = [];
  alerts.forEach((a, i) => cards.push(<div className="action alert" key={`alert-${i}`}><b>Care team alerted · {a.priority} priority</b>{a.summary}<div className="ref">{a.ref}</div></div>));
  preauths.forEach((pa, i) => cards.push(<div className="action pa" key={`pa-${i}`}><b>Pre-authorization · {pa.procedure}</b>{pa.payer}: {pa.status}, decision in {pa.eta}<div className="ref">{pa.ref}</div></div>));
  bookings.forEach((b, i) => cards.push(<div className="action" key={`booking-${i}`}><b>Booked · {b.specialty}</b>{b.dateLabel}, {b.time} · {b.location}<div className="ref">{b.ref}</div></div>));
  if (visitPrep) {
    cards.push(
      <div className="action prep" key="visit-prep">
        <b>Visit sheet · {visitPrep.specialty}</b>
        <div className="small muted">Questions to ask</div><ol>{visitPrep.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
        <div className="small muted">Latest results</div><ul>{visitPrep.labs.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <div className="small muted">Current medicines</div><ul>{visitPrep.medications.map((m, i) => <li key={i}>{m}</li>)}</ul>
      </div>,
    );
  }
  return cards.length ? <div>{cards.reverse()}</div> : empty;
}
