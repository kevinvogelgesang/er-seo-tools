// components/scoring/ScoreExplanation.tsx — read-only breakdown panel (C8).
// Reads ONLY the persisted `scoreBreakdown` string; never recomputes.
import type { PersistedBreakdown } from '@/lib/scoring/weights'

export function ScoreExplanation({ breakdown }: { breakdown: string | null }) {
  let parsed: PersistedBreakdown | null = null
  if (breakdown) {
    try {
      parsed = JSON.parse(breakdown) as PersistedBreakdown
    } catch {
      parsed = null
    }
  }
  if (!parsed || !Array.isArray(parsed.factors)) {
    return (
      <p className="text-[12px] font-body text-navy/45 dark:text-white/45">
        Score breakdown unavailable (scored before breakdowns were recorded).
      </p>
    )
  }
  if (parsed.factors.length === 0) return null // live null-score: ScoreLine already explains it
  const totalPossible = parsed.factors.reduce((a, x) => a + x.possible, 0)
  return (
    <details className="mt-2">
      <summary className="text-[12px] font-body text-navy/60 dark:text-white/60 cursor-pointer">
        How this score was calculated
      </summary>
      <table className="mt-2 w-full text-[12px] font-body text-navy dark:text-white">
        <thead>
          <tr className="text-navy/45 dark:text-white/45 text-left">
            <th className="py-1">Factor</th>
            <th>Weight</th>
            <th>Earned</th>
            <th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {parsed.factors.map((f) => (
            <tr key={f.key} className="border-t border-gray-100 dark:border-navy-border/50">
              <td className="py-1">{f.label}</td>
              <td>{f.weight}</td>
              <td>{Math.round(f.earned * 10) / 10}/{f.possible}</td>
              <td>{totalPossible > 0 ? Math.round((f.earned / totalPossible) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] font-body text-navy/40 dark:text-white/40">
        Weights as scored; current weights may differ.
      </p>
    </details>
  )
}
