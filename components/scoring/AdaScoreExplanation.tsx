// components/scoring/AdaScoreExplanation.tsx — ADA v4 deduction-invoice panel (C19 PR1 Task 5).
// Reads ONLY the persisted `scoreBreakdown` string; never recomputes. Renders
// nothing unless the run was scored by ada-v4 — older/malformed breakdowns
// (v1/v2/v3, or blobs that predate this scorer) fall through to `null` so
// this component is a strict no-op on legacy runs.
import type { AdaV4Breakdown, AdaV4Category, AdaV4Contribution, AdaV4DeductionLine } from '@/lib/scoring/ada-v4'
import { Explainer, ExplainerSummary, ExplainerNote } from '@/components/ui/Explainer'

const CATEGORY_LABEL: Record<AdaV4Category, string> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
  needsReview: 'Needs review',
}

// Mirrors the impact palette in AuditScorecard.tsx; needsReview gets the
// neutral gray/slate tones (it has no axe "impact" equivalent).
const CATEGORY_CLASS: Record<AdaV4Category, string> = {
  critical: 'text-red-700 dark:text-red-400',
  serious: 'text-orange-700 dark:text-orange-400',
  moderate: 'text-yellow-700 dark:text-yellow-400',
  minor: 'text-blue-700 dark:text-blue-400',
  needsReview: 'text-gray-600 dark:text-white/50',
}

function isAdaV4DeductionLine(v: unknown): v is AdaV4DeductionLine {
  if (!v || typeof v !== 'object') return false
  const d = v as Record<string, unknown>
  return (
    typeof d.points === 'number' &&
    typeof d.cap === 'number' &&
    Array.isArray(d.contributions)
  )
}

function isAdaV4Breakdown(v: unknown): v is AdaV4Breakdown {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  if (b.version !== 4 || b.scorer !== 'ada-v4' || !Array.isArray(b.deductions)) return false
  if (!b.deductions.every(isAdaV4DeductionLine)) return false
  const inputsSummary = b.inputsSummary as Record<string, unknown> | undefined
  if (!inputsSummary || typeof inputsSummary !== 'object') return false
  return typeof inputsSummary.pagesAudited === 'number'
}

function contributionLine(c: AdaV4Contribution, pagesAudited: number): string {
  if (c.ruleId === 'other') {
    const count = c.ruleCount ?? 0
    return `+${count} more rule${count === 1 ? '' : 's'}`
  }
  const base = `${c.ruleId} — ${c.pagesAffected} of ${pagesAudited} pages`
  return c.advisory ? `${base} (best practice, discounted)` : base
}

export function AdaScoreExplanation({ breakdown }: { breakdown: string | null }) {
  let parsed: unknown = null
  if (breakdown) {
    try {
      parsed = JSON.parse(breakdown)
    } catch {
      parsed = null
    }
  }
  if (!isAdaV4Breakdown(parsed)) return null

  const { deductions, inputsSummary, weightsHash, lowCoverage } = parsed
  const lines = deductions.filter((d) => d.points > 0)

  return (
    <div className="mt-2 space-y-1">
      {/* Run-specific coverage warning — stays OUTSIDE the card (always visible). */}
      {lowCoverage && (
        <p className="text-[11px] font-body text-navy/50 dark:text-white/50">
          Partial coverage — {inputsSummary.pagesAudited} of {inputsSummary.pagesTotal} pages scored.
        </p>
      )}
      <div className="flex items-center gap-1">
        <span className="text-[12px] font-body text-navy/50 dark:text-white/50">
          How this score is calculated
        </span>
        <Explainer label="How this score is calculated" title="Accessibility Score">
          <ExplainerSummary>
            The accessibility score starts at 100 and subtracts severity-weighted
            deductions. Each severity tier (critical through needs-review) has a capped
            contribution; the invoice below lists what was deducted on this run.
          </ExplainerSummary>
          <div className="space-y-2 text-[12px] font-body text-navy dark:text-white">
            {lines.length === 0 ? (
              <p className="text-navy/60 dark:text-white/60">No deductions — clean run.</p>
            ) : (
              <ul className="space-y-1.5">
                {lines.map((d) => (
                  <li key={d.category}>
                    <span className={`font-semibold ${CATEGORY_CLASS[d.category]}`}>
                      {CATEGORY_LABEL[d.category]} −{d.points}
                    </span>
                    {d.contributions.length > 0 && (
                      <ul className="mt-0.5 ml-4 list-disc space-y-0.5 text-navy/60 dark:text-white/60">
                        {d.contributions.map((c, i) => (
                          <li key={`${c.ruleId}-${i}`}>{contributionLine(c, inputsSummary.pagesAudited)}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ExplainerNote>
            Density-based: severity-weighted violations per element, saturating. Weights as
            scored ({weightsHash ?? 'unhashed'}); current weights may differ.
          </ExplainerNote>
        </Explainer>
      </div>
    </div>
  )
}
