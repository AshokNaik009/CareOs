import Sparkline from '../shared/components/Sparkline.jsx';
import { initials } from '../shared/format.js';
import { badLab } from './record.js';

// Left column: profile, labs, genome, wearable, medications.
export default function Record({ patient: p }) {
  if (!p) {
    return (
      <section>
        <div className="card"></div>
        <div className="card"><h2>Lab results <span className="source">Malaffi</span></h2></div>
        <div className="card"><h2>Genome <span className="source">Genome report</span></h2></div>
        <div className="card"><h2>Wearable <span className="source">Device</span></h2></div>
        <div className="card"><h2>Medications</h2></div>
      </section>
    );
  }
  const w = p.wearable;
  return (
    <section>
      <div className="card">
        <div className="profile">
          <div className="avatar">{initials(p.name)}</div>
          <div>
            <h1>{p.name}</h1>
            <div className="muted">{p.age} · {p.sex === 'F' ? 'Female' : 'Male'} · prefers {p.preferredLang === 'ar' ? 'Arabic' : 'English'}</div>
          </div>
        </div>
        <dl className="kv">
          <dt>Emirates ID</dt><dd className="num">{p.emiratesId}</dd>
          <dt>Insurance</dt><dd>{p.insurance.plan}</dd>
          <dt>Conditions</dt><dd>{p.conditions.map((c, i) => <span key={i} className="tag">{c.name}</span>)}</dd>
        </dl>
      </div>

      <div className="card">
        <h2>Lab results <span className="source">Malaffi</span></h2>
        <div>
          {p.labs.map((l, i) => {
            const last = l.results[l.results.length - 1];
            const bad = badLab(l);
            return (
              <div className="lab" key={i}>
                <div><div>{l.name}</div><div className="small muted">ref {l.ref} · {last[0]}</div></div>
                <span style={{ color: bad ? 'var(--red)' : 'var(--ink)' }}><Sparkline values={l.results.map((r) => r[1])} w={80} h={28} /></span>
                <div className={`v ${bad ? 'bad' : ''} num`}>{last[1]}{l.unit === '%' ? <span className="small muted">%</span> : null}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Genome <span className="source">{p.genome.source.replace(/\s*\(.*\)/, '')}</span></h2>
        <div>
          {p.genome.variants.map((v, i) => (
            <div className="variant" key={i}><b>{v.gene} {v.genotype}</b><div className="muted">{v.phenotype}</div></div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Wearable <span className="source">{w.device}</span></h2>
        <div>
          <div className="lab">
            <div><div>Resting heart rate</div><div className="small muted">last 30 days</div></div>
            <span style={{ color: 'var(--red)' }}><Sparkline values={w.restingHr.map((r) => r[1])} w={80} h={28} /></span>
            <div className="v num">{w.restingHr[w.restingHr.length - 1][1]}<span className="small muted"> bpm</span></div>
          </div>
          <div className="lab"><div>Steps / day</div><span></span><div className="v num">{w.stepsAvg7d.toLocaleString()}</div></div>
          <div className="lab"><div>Sleep</div><span></span><div className="v num" style={{ fontSize: 13 }}>{w.sleepAvg7d}</div></div>
          {w.irregularRhythmAlerts.length ? (
            <div className="small" style={{ marginTop: 6 }}>
              <span className="alert-title">Irregular rhythm alerts</span>
              <div className="alert-dots">{w.irregularRhythmAlerts.map((d, i) => <span key={i}>{d}</span>)}</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <h2>Medications</h2>
        <div>
          {p.medications.length
            ? p.medications.map((m, i) => <div className="variant" key={i}><span style={{ fontWeight: 600 }}>{m.name}</span> <span className="muted">{m.dose}</span></div>)
            : <div className="empty">No medications.</div>}
        </div>
      </div>
    </section>
  );
}
