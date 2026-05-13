'use client'

import type { LighthouseSummary, CwvStatus } from '@/lib/ada-audit/lighthouse-types'

function scoreColor(score: number): string {
  if (score >= 90) return 'text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-500/15'
  if (score >= 50) return 'text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/15'
  return 'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-500/15'
}

function cwvColor(status: CwvStatus): string {
  if (status === 'pass') return 'text-green-700 dark:text-green-400'
  if (status === 'needs-improvement') return 'text-amber-700 dark:text-amber-400'
  return 'text-red-700 dark:text-red-400'
}

function fmtMs(v: number) { return `${Math.round(v)} ms` }
function fmtCls(v: number) { return v.toFixed(2) }

interface Props {
  summary: LighthouseSummary | null
  error?: string | null
  auditId: string
}

export default function LighthouseSection({ summary, error, auditId }: Props) {
  if (!summary && !error) return null

  if (error && !summary) {
    return (
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl p-6">
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white mb-2">Lighthouse</h2>
        <p className="text-[13px] text-amber-700 dark:text-amber-400">Lighthouse failed: {error}</p>
      </div>
    )
  }

  const s = summary!
  return (
    <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Lighthouse</h2>
        <a
          href={`/api/ada-audit/${auditId}/lighthouse-report`}
          className="text-[12px] text-orange hover:underline"
        >
          Download full report
        </a>
      </div>

      {/* Scores */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Performance', value: s.scores.performance },
          { label: 'Accessibility', value: s.scores.accessibility },
          { label: 'Best Practices', value: s.scores.bestPractices },
        ].map((c) => (
          <div key={c.label} className={`rounded-xl p-4 text-center ${scoreColor(c.value)}`}>
            <div className="font-display font-bold text-2xl">{c.value}</div>
            <div className="text-[11px] uppercase tracking-wider font-body">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Core Web Vitals */}
      <div className="grid grid-cols-3 gap-3 text-[13px] font-body">
        <div><span className="text-navy/50 dark:text-white/50">LCP </span><span className={cwvColor(s.cwv.lcpStatus)}>{fmtMs(s.cwv.lcp)}</span></div>
        <div><span className="text-navy/50 dark:text-white/50">CLS </span><span className={cwvColor(s.cwv.clsStatus)}>{fmtCls(s.cwv.cls)}</span></div>
        <div><span className="text-navy/50 dark:text-white/50">TBT </span><span className={cwvColor(s.cwv.tbtStatus)}>{fmtMs(s.cwv.tbt)}</span></div>
      </div>

      {/* Top failures */}
      {s.topFailures.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider font-body text-navy/50 dark:text-white/50 mb-2">Top failing audits</div>
          <ul className="space-y-1">
            {s.topFailures.map((f) => (
              <li key={f.id} className="text-[13px] font-body text-navy dark:text-white flex justify-between">
                <span>{f.title}</span>
                {f.displayValue && <span className="text-navy/50 dark:text-white/50">{f.displayValue}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
