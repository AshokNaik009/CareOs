const MONO = 'Martian Mono, monospace';

// Monthly medical cost per member vs. the capitation line.
export default function CostChart({ costs, contract: c }) {
  const W = 640, H = 220, padL = 44, padB = 26, padT = 12;
  const min = 800, max = 1250;
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const bw = (W - padL - 10) / costs.length;
  const liveIdx = costs.findIndex((x) => x.live);
  const lx = padL + liveIdx * bw;
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly medical cost per member versus capitation">
        {[900, 1000, 1100, 1200].map((v) => (
          <g key={v}>
            <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fontFamily={MONO} fill="rgba(23,23,23,.56)">{v}</text>
            <line x1={padL} x2={W - 6} y1={y(v)} y2={y(v)} stroke="rgba(23,23,23,.08)" />
          </g>
        ))}
        {costs.map((m, i) => {
          const x = padL + i * bw + 5;
          return (
            <g key={i}>
              <rect x={x} y={y(m.cost)} width={bw - 10} height={H - padB - y(m.cost)} rx="4" fill={m.live ? 'var(--ink)' : 'rgba(23,23,23,.16)'}><title>{`${m.month}: AED ${m.cost}`}</title></rect>
              <text x={x + (bw - 10) / 2} y={H - 8} textAnchor="middle" fontSize="10" fontFamily={MONO} letterSpacing="1" fill="rgba(23,23,23,.56)">{m.month.toUpperCase()}</text>
            </g>
          );
        })}
        <line x1={padL} x2={W - 6} y1={y(c.capitationPmpm)} y2={y(c.capitationPmpm)} stroke="var(--red)" strokeWidth="2" />
        <text x={W - 8} y={y(c.capitationPmpm) - 7} textAnchor="end" fontSize="10" fontFamily={MONO} letterSpacing="1.5" fill="var(--red)">CAPITATION {c.capitationPmpm}</text>
        <line x1={lx} x2={lx} y1={padT} y2={H - padB} stroke="var(--ink)" strokeWidth="2" strokeDasharray="6 4" />
        <text x={lx + 8} y={padT + 10} fontSize="10" fontFamily={MONO} letterSpacing="1.5" fill="var(--ink)">AI CARE OS LIVE</text>
      </svg>
      <div className="chart-note">Gap between red line and bars = our margin · grey before program · ink after</div>
    </div>
  );
}
