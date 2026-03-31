import type { StoredAxeResults, AuditScorecard } from '@/lib/ada-audit/types'
import AuditScorecardComponent from './AuditScorecard'
import AuditIssueTabs from './AuditIssueTabs'
import ComplianceBanner from './ComplianceBanner'
import ShareAuditButton from './ShareAuditButton'

interface Props {
  results: StoredAxeResults
  url: string
  clientName: string | null
  createdAt: string
  auditId?: string
  wcagLevel?: string
  score?: number
  compliant?: boolean
}

function buildScorecard(results: StoredAxeResults): AuditScorecard {
  const v = results.violations
  return {
    critical:   v.filter((x) => x.impact === 'critical').length,
    serious:    v.filter((x) => x.impact === 'serious').length,
    moderate:   v.filter((x) => x.impact === 'moderate').length,
    minor:      v.filter((x) => x.impact === 'minor').length,
    total:      v.length,
    passed:     results.passes?.length ?? 0,
    incomplete: results.incomplete?.length ?? 0,
  }
}

export default function AuditResultsView({ results, url, clientName, createdAt, auditId, wcagLevel, score, compliant }: Props) {
  const scorecard = buildScorecard(results)
  const wcagLabel = wcagLevel === 'wcag22aa' ? 'WCAG 2.2 AA' : 'WCAG 2.1 AA'

  return (
    <div className="space-y-6">
      <ComplianceBanner />

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-bold text-[17px] text-navy truncate">Audit Results</h2>
              <span className="text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-navy/10 text-navy/50">
                {wcagLabel}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-body text-navy/50 hover:text-orange truncate transition-colors"
              >
                {url} ↗
              </a>
              {clientName && (
                <span className="text-[12px] font-body text-navy/40">{clientName}</span>
              )}
              <span className="text-[12px] font-body text-navy/40">
                {new Date(createdAt).toLocaleString()}
              </span>
            </div>
          </div>
          {auditId && (
            <div className="flex-shrink-0">
              <ShareAuditButton auditId={auditId} />
            </div>
          )}
        </div>
        <div className="p-6">
          <AuditScorecardComponent scorecard={scorecard} score={score} compliant={compliant} wcagLevel={wcagLevel} />
        </div>
      </div>

      {/* Known limitations notice */}
      <div className="flex gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-[12px] font-body text-amber-800 leading-relaxed">
        <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          <strong>Known limitations:</strong> This audit analyzes the static HTML snapshot only.
          External stylesheets are not loaded, so color-contrast results may not reflect the
          rendered page. Client-rendered content (React/Angular SPAs), lazy-loaded sections,
          and content inside modals will not be included. Treat results as a starting point,
          not a certification.
        </span>
      </div>

      {/* Issues */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-[17px] text-navy">Violations</h2>
        </div>
        <div className="p-6">
          <AuditIssueTabs violations={results.violations} incomplete={results.incomplete ?? []} />
        </div>
      </div>
    </div>
  )
}
