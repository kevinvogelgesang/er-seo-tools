'use client'

import type {
  LighthouseSummary,
  LighthouseAccessibility,
  CwvStatus,
} from '@/lib/ada-audit/lighthouse-types'

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
}

export default function LighthouseSection({ summary, error }: Props) {
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
      <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Lighthouse</h2>

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

      {/* Top failures — performance + best-practices only; accessibility has its own section below */}
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

      {s.accessibility && <AccessibilityBreakdown accessibility={s.accessibility} />}
    </div>
  )
}

function AccessibilityBreakdown({ accessibility }: { accessibility: LighthouseAccessibility }) {
  const hasIssues = accessibility.groups.some((g) => g.audits.length > 0)
  return (
    <div className="pt-4 border-t border-gray-100 dark:border-navy-border">
      <div className="flex items-center gap-3 mb-3">
        <div className={`rounded-full w-10 h-10 flex items-center justify-center font-display font-bold text-[15px] ${scoreColor(accessibility.score)}`}>
          {accessibility.score}
        </div>
        <div>
          <div className="font-display font-bold text-[15px] text-navy dark:text-white">Accessibility</div>
          <div className="text-[12px] font-body text-navy/50 dark:text-white/50">
            {hasIssues ? 'Failing audits grouped by category' : 'No failing audits 🎉'}
          </div>
        </div>
      </div>

      {accessibility.groups.map((group) => (
        <section key={group.id} className="mt-4">
          <div className="text-[11px] uppercase tracking-wider font-body font-semibold text-navy/60 dark:text-white/60 mb-1">
            {group.title}
          </div>
          {group.description && (
            <div className="text-[12px] font-body text-navy/50 dark:text-white/50 mb-2">{group.description}</div>
          )}
          <ul className="space-y-1">
            {group.audits.map((audit) => (
              <li key={audit.id} className="border-t border-gray-100 dark:border-navy-border">
                <details className="group">
                  <summary className="flex items-start gap-2 py-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <span className="text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true">▲</span>
                    <span className="text-[13px] font-body text-navy dark:text-white flex-1">{audit.title}</span>
                    <span className="text-navy/40 dark:text-white/40 transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
                  </summary>
                  <div className="pl-6 pb-3 space-y-2">
                    {audit.description && (
                      <p className="text-[12px] font-body text-navy/60 dark:text-white/60">{audit.description}</p>
                    )}
                    {audit.failingElements.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider font-body text-navy/40 dark:text-white/40 mb-1">
                          Failing elements
                        </div>
                        <ul className="space-y-1">
                          {audit.failingElements.map((el, i) => (
                            <li key={i} className="bg-gray-50 dark:bg-navy-deep border border-gray-100 dark:border-navy-border rounded px-2 py-1.5 text-[11px] font-mono text-navy/70 dark:text-white/70 overflow-x-auto">
                              <code className="whitespace-pre-wrap break-all">{el.snippet}</code>
                              {el.selector && (
                                <div className="text-navy/40 dark:text-white/40 text-[10px] mt-1">{el.selector}</div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
