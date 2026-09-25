import { handledRef } from './record.js';

export default function Findings({ data, onAsk }) {
  if (!data) return <div></div>;
  if (!data.findings.length) return <div><div className="empty">No missed findings.</div></div>;
  return (
    <div>
      {data.findings.map((f) => {
        const done = handledRef(f, data);
        return (
          <div className={`finding ${f.severity}`} key={f.id}>
            <div className="top"><span className={`sev ${f.severity}`}>{f.severity}</span><span className="small muted">{f.category}</span></div>
            <h3>{f.title}</h3>
            <p>{f.plain}</p>
            <details><summary>Evidence</summary><ul>{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></details>
            <div className="foot">
              {done
                ? <span className="done">✓ Handled · <b>{done}</b></span>
                : <button className="btn sm primary" onClick={() => onAsk(f)}>Ask Rafeeq to handle</button>}
              {f.preauth ? <span className="tag">Needs pre-auth: {f.preauth}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
