// Inline-SVG 0–100 score dial. Colour tracks the health bands used elsewhere
// (≥80 green, ≥50 amber, else red). Null → dashed grey ring with an em dash.
export function ScoreRing({ score, size = 44 }: { score: number | null; size?: number }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))
  const offset = c - (pct / 100) * c
  const color =
    score == null ? '#9ca3af' : pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={score == null ? 'no score' : `score ${pct}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="stroke-gray-200 dark:stroke-white/10" />
      {score != null && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} stroke={color}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-navy dark:fill-white font-display font-bold" fontSize={size * 0.3}>
        {score == null ? '—' : pct}
      </text>
    </svg>
  )
}
