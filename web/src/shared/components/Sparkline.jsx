export default function Sparkline({ values, w = 120, h = 32, color = 'currentColor' }) {
  if (!values.length) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 6) + 3, h - 4 - ((v - min) / span) * (h - 8)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  );
}
