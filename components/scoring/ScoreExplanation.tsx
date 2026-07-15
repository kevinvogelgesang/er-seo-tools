// components/scoring/ScoreExplanation.tsx — read-only breakdown panel (C8).
// Reads ONLY the persisted `scoreBreakdown` string; never recomputes.
import type { PersistedBreakdown } from '@/lib/scoring/weights'
import { Explainer, ExplainerSummary, ExplainerNote } from '@/components/ui/Explainer'

export function ScoreExplanation({ breakdown }: { breakdown: string | null }) {
  let parsed: PersistedBreakdown | null = null
  if (breakdown) {
    try {
      parsed = JSON.parse(breakdown) as PersistedBreakdown
    } catch {
      parsed = null
    }
  }
  // Run-specific fallback — stays OUTSIDE the Explainer (always visible, never
  // hidden behind a hover card).
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
    <div className="mt-2 flex items-center gap-1">
      <span className="text-[12px] font-body text-navy/50 dark:text-white/50">
        How this score is calculated
      </span>
      <Explainer label="How this score is calculated" title="SEO Health Score">
        <ExplainerSummary>
          The SEO health score is a weighted blend of on-page factors. Each factor earns a
          share of its weight, and the contributions sum to a score out of 100. The table
          shows how this run scored on each factor.
        </ExplainerSummary>
        <table className="w-full text-[12px] font-body text-navy dark:text-white">
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
        <ExplainerNote>Weights as scored; current weights may differ.</ExplainerNote>
      </Explainer>
    </div>
  )
}
