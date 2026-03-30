import type { AuditScorecard } from '@/lib/ada-audit/types'

interface Props {
  scorecard: AuditScorecard
}

interface StatBox {
  label: string
  count: number
  bg: string
  text: string
  border: string
}

export default function AuditScorecard({ scorecard }: Props) {
  const boxes: StatBox[] = [
    { label: 'Critical',  count: scorecard.critical,  bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200' },
    { label: 'Serious',   count: scorecard.serious,   bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
    { label: 'Moderate',  count: scorecard.moderate,  bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
    { label: 'Minor',     count: scorecard.minor,     bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200' },
  ]

  return (
    <div className="space-y-3">
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
