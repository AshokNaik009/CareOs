function List({ label, items }) {
  if (!items || !items.length) return null;
  return (
    <>
      <div className="small muted">{label}</div>
      <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </>
  );
}

// AI-written note shown after a session ends. `who` is "Patient" or "Member".
export default function NoteCard({ note, title, who }) {
  return (
    <div className="note">
      <h4><span>{title}</span><span className="provider-tag">{note.provider}</span></h4>
      <div>{note.summary}</div>
      <List label="Actions taken" items={note.actionsTaken} />
      <List label="Follow-ups" items={note.followUps} />
      <List label="Risk flags" items={note.riskFlags} />
      {note.sentiment ? <div className="small muted">{who} sentiment: {note.sentiment}</div> : null}
    </div>
  );
}
