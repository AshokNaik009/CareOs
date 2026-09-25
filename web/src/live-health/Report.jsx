import { useState } from 'react';

export const metricInfo = {
  recovery: ['Recovery', '%'], hrv: ['Heart rate variability', 'ms'], resting_hr: ['Resting heart rate', 'bpm'],
  sleep_hours: ['Sleep duration', 'h'], sleep_performance: ['Sleep performance', '%'], sleep_efficiency: ['Sleep efficiency', '%'],
  strain: ['Day strain', ''], spo2: ['Blood oxygen', '%'], respiratory_rate: ['Breathing rate', '/min'],
  skin_temp: ['Skin temperature', '°C'], kilojoule: ['Energy expenditure', 'kJ'], average_hr: ['Average heart rate', 'bpm'],
};
export const fmt = value => value == null ? '—' : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
const duration = value => value == null ? 'Not available' : `${Math.floor(Math.round(value * 60) / 60)}h ${Math.round(value * 60) % 60}m`;
const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' });

export function MetricCards({ report }) {
  return <div className="lh-metrics">{['hrv', 'resting_hr', 'sleep_hours', 'strain'].map(metric => {
    const [label, unit] = metricInfo[metric];
    const current = report?.current?.[metric];
    const baselines = report?.baselines?.[metric];
    const trendKey = { hrv: 'hrv', resting_hr: 'resting_hr', sleep_hours: 'sleep' }[metric];
    const trend = report?.analysis.trends[trendKey];
    return <article className="card lh-metric" key={metric}>
      <h2>{label}</h2>
      <div className="lh-metric-value">{fmt(current)} <span>{current != null ? unit : ''}</span></div>
      <p className="small muted">{trend ? `Recent trend: ${trend}` : current == null ? 'Awaiting your data' : !trendKey ? 'Current cycle; may be in progress' : 'More history needed for a trend'}</p>
      <div className="lh-averages">{[['week', '7d'], ['month', '30d']].map(([key, title]) => <span key={key} title={`${baselines?.[key].count ?? 0} recorded days; today excluded`}>{title} avg <strong>{fmt(baselines?.[key].average)}</strong></span>)}</div>
    </article>;
  })}</div>;
}

export function HistoryChart({ report }) {
  const [metric, setMetric] = useState('hrv');
  const [window, setWindow] = useState(30);
  const [name, unit] = metricInfo[metric];
  const days = Array.from({ length: window }, (_, index) => {
    const date = new Date(`${report.date}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - window + index + 1);
    const key = date.toISOString().slice(0, 10);
    return { date: key, value: report.history.find(d => d.date === key)?.[metric] ?? null };
  });
  const valid = days.filter(d => d.value != null);
  const low = valid.length ? Math.floor(Math.min(...valid.map(d => d.value))) : 0;
  const high = valid.length ? Math.max(low + 1, Math.ceil(Math.max(...valid.map(d => d.value)))) : 1;
  const x = i => 50 + i * 650 / (window - 1);
  const y = value => 160 - (value - low) / (high - low) * 125;
  const segments = [];
  let segment = [];
  days.forEach((d, i) => {
    if (d.value == null) { if (segment.length) segments.push(segment); segment = []; }
    else segment.push(`${x(i)},${y(d.value)}`);
  });
  if (segment.length) segments.push(segment);
  return <section className="card" id="history">
    <h2>Your personal rhythm <span className="source">The bigger picture</span></h2>
    <div className="lh-chart-controls">
      <label>Metric <select value={metric} onChange={event => setMetric(event.target.value)}><option value="hrv">Heart rate variability</option><option value="resting_hr">Resting heart rate</option><option value="sleep_hours">Sleep duration</option><option value="recovery">Recovery</option></select></label>
      <div className="lh-actions" aria-label="Chart period">{[7, 30].map(value => <button className={`btn sm${window === value ? ' primary' : ''}`} key={value} aria-pressed={window === value} onClick={() => setWindow(value)}>{value} days</button>)}</div>
      <span className="small muted">Gaps mean missing data</span>
    </div>
    {valid.length ? <svg className="lh-history-chart" viewBox="0 0 740 205" role="img" aria-label={`${name} over the last ${window} days. Exact readings in the table below.`}>
      {[low, (low + high) / 2, high].map((tick, i) => <g key={i}><line x1="50" x2="700" y1={y(tick)} y2={y(tick)} className="lh-chart-grid" /><text x="0" y={y(tick) + 4}>{fmt(tick)}</text></g>)}
      {segments.map((points, i) => <polyline key={i} points={points.join(' ')} fill="none" className="lh-chart-line" />)}
      {days.map((d, i) => d.value != null && <circle key={d.date} cx={x(i)} cy={y(d.value)} r="3.5" className="lh-chart-point"><title>{dateLabel(d.date)}: {fmt(d.value)} {unit}</title></circle>)}
      <text x="50" y="194">{dateLabel(days[0].date)}</text><text x="700" y="194" textAnchor="end">{dateLabel(days.at(-1).date)}</text>
    </svg> : <p className="empty">No recorded {name.toLowerCase()} in this period.</p>}
    <details className="lh-help"><summary>View exact readings</summary><div className="lh-table-scroll"><table><thead><tr><th>Date</th><th>{name}</th></tr></thead><tbody>{days.slice().reverse().map(d => <tr key={d.date}><td>{dateLabel(d.date)}</td><td>{fmt(d.value)} {d.value != null ? unit : ''}</td></tr>)}</tbody></table></div></details>
  </section>;
}

export function Baselines({ report }) {
  return <section className="card" id="baseline">
    <h2>Your baseline <span className="source">You, compared with you</span></h2>
    <p className="muted">Averages use recorded days before today. Partial windows show their actual coverage; missing readings are never zeroes.</p>
    <div className="lh-table-scroll"><table><thead><tr><th>Metric</th><th>Today</th><th>7-day average</th><th>30-day average</th></tr></thead><tbody>{Object.entries(metricInfo).map(([key, [label, unit]]) => <tr key={key}>
      <th scope="row">{label}{key === 'strain' && <small>Current cycle may still be in progress</small>}</th>
      <td>{fmt(report.current?.[key])}<small>{unit}</small></td>
      {['week', 'month'].map(window => <td key={window}>{fmt(report.baselines[key][window].average)}<small>{report.baselines[key][window].count}/{window === 'week' ? 7 : 30} days</small></td>)}
    </tr>)}</tbody></table></div>
  </section>;
}

export function SleepAndWorkouts({ report }) {
  const stages = report.current?.stages;
  const total = stages && Object.values(stages).every(v => v != null) ? Object.values(stages).reduce((a, b) => a + b, 0) : null;
  let offset = 0;
  const workouts = report.current?.workouts ?? [];
  return <div className="lh-columns"><section className="card">
    <h2>The shape of your sleep <span className="source">Last night</span></h2>
    <p className="lh-sleep-total">{duration(report.current?.sleep_hours)} <span className="small muted">asleep, excluding awake time</span></p>
    {total > 0 && <svg className="lh-sleep-bar" viewBox="0 0 400 16" role="img" aria-label="Sleep stages; durations listed below">{Object.entries(stages).map(([key, value]) => { const start = offset; offset += value / total * 400; return <rect key={key} className={`lh-stage-${key}`} x={start} y="0" height="16" width={value / total * 400} />; })}</svg>}
    <div className="lh-stage-legend">{[['light', 'Light'], ['deep', 'Deep'], ['rem', 'REM (dream sleep)'], ['awake', 'Awake']].map(([key, label]) => <div key={key}><span className={`lh-stage-dot lh-stage-${key}`} /><span>{label}</span><strong>{duration(stages?.[key])}</strong></div>)}</div>
  </section><section className="card">
    <h2>Your activity <span className="source">Today’s movement</span></h2>
    {workouts.length ? <div>{workouts.map(workout => <article className="lh-workout" key={workout.id}><div className="lh-workout-heading"><h3>{workout.sport}</h3><span>{fmt(workout.duration_minutes)} min</span></div><p>Workout strain: {fmt(workout.strain)}</p><details><summary>Heart-rate zones</summary><p className="muted">Time in the intensity zones reported by WHOOP. Higher zones mean higher heart rate.</p><ul>{Object.entries(workout.zones).map(([zone, hours]) => <li key={zone}>Zone {zone}: {duration(hours)}</li>)}</ul></details></article>)}</div> : <p className="muted">No workouts available for today. This does not necessarily mean you were inactive.</p>}
  </section></div>;
}
