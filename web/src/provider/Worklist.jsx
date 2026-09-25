import { STATUS_LABEL, riskClass } from './labels.js';

export default function Worklist({ members, selected, onSelect }) {
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>#</th><th>Member</th><th>Cohort</th><th>Risk</th><th>Open gaps</th><th>Lang</th><th>Status</th></tr></thead>
      <tbody>
        {members.map((m, i) => (
          <tr key={m.id} className={selected === m.id ? 'sel' : ''} onClick={() => onSelect(m.id)}>
            <td className="muted num">{i + 1}</td>
            <td><b>{m.name}</b>{m.linkedPatientAgent ? <span className="link-badge">has Rafeeq</span> : null}<div className="small muted">{m.age} · {m.sex}</div></td>
            <td>{m.cohort}</td>
            <td><span className={`risk ${riskClass(m.riskScore)} num`}>{m.riskScore}</span><div className="small muted">{Math.round(m.pAdmit90 * 100)}% adm.</div></td>
            <td>{m.gaps.length} <span className="small muted">· {m.gaps[0]}</span></td>
            <td>{m.lang === 'ar' ? 'عربي' : 'EN'}</td>
            <td><span className={`status ${m.status}`}>{STATUS_LABEL[m.status] || m.status}</span></td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}
