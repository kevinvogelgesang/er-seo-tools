import type { AuditScorecard } from '@/lib/ada-audit/types'

interface Props {
  scorecard: AuditScorecard
  score?: number
  compliant?: boolean
  wcagLevel?: string
}

interface StatBox {
  label: string
  count: number
  bg: string
  text: string
  border: string
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 50) return 'text-amber-500'
  return 'text-red-600'
}

export default function AuditScorecard({ scorecard, score, compliant, wcagLevel }: Props) {
  const boxes: StatBox[] = [
    { label: 'Critical',  count: scorecard.critical,  bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
    { label: 'Serious',   count: scorecard.serious,   bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
    { label: 'Moderate',  count: scorecard.moderate,  bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
    { label: 'Minor',     count: scorecard.minor,     bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  ]

  return (
    <div className="space-y-3">
      {score != null && (
        <div className="flex items-center gap-3 mb-1">
          <span className={`text-5xl font-display font-bold leading-none ${scoreColor(score)}`}>
            {score}
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-body font-semibold text-navy/40 uppercase tracking-wider">Score</span>
            {compliant != null && (
              <span className={`inline-flex items-center gap-1 text-[11px] font-body font-semibold px-2 py-0.5 rounded border ${
                compliant
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}>
                {wcagLevel === 'wcag22aa' ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'}
                {compliant ? ': Compliant ✓' : ': Non-compliant ✗'}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {boxes.map((b) => (
          <div key={b.label} className={`${b.bg} border ${b.border} rounded-xl px-4 py-3 text-center`}>
            <div className={`text-3xl font-display font-bold ${b.text}`}>{b.count}</div>
            <div className={`text-[11px] font-body font-semibold uppercase tracking-wider mt-0.5 ${b.text} opacity-80`}>
              {b.label}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-[12px] font-body text-navy/60">
        <span><strong className="text-navy/80">{scorecard.passed}</strong> rules passed</span>
        {scorecard.incomplete > 0 && (
          <span><strong className="text-navy/80">{scorecard.incomplete}</strong> need review</span>
        )}
        <span><strong className="text-navy/80">{scorecard.total}</strong> total violations</span>
      </div>
    </div>
  )
}
