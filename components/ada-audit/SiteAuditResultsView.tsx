'use client'

import { useState, useEffect, useRef } from 'react'
import type { SiteAuditSummary, SitePageResult, AuditPdfRow } from '@/lib/ada-audit/types'
import AuditScorecardComponent from './AuditScorecard'
import ComplianceBanner from './ComplianceBanner'
import { KnownLimitationsNotice } from './KnownLimitationsNotice'
import SiteAuditToolbar from './SiteAuditToolbar'
import CleanPagesSection from './CleanPagesSection'
import PdfIssuesSection from './PdfIssuesSection'
import { useSiteAuditPages, type SortKey, type ImpactFilter } from './useSiteAuditPages'
import { useGroupedViolations } from './useGroupedViolations'
import GroupedViolationsView from './GroupedViolationsView'
import CommonIssueCallout from './CommonIssueCallout'
import { useChecks } from './useChecks'
import { ClientDate } from '@/components/ClientDate'
import PageRow from './PageRow'
import { useTriageMode } from './useTriageMode'
import { ArchivedAuditBanner } from './ArchivedAuditBanner'

interface Props {
  domain: string
  clientName: string | null
  createdAt: string
  pagesTotal: number
  pagesError: number
  summary: SiteAuditSummary
  wcagLevel?: string
  score?: number
  compliant?: boolean
  pdfs?: AuditPdfRow[]
  siteAuditId: string
  /** Public share view: suppresses every cookie-gated or internal affordance
   *  (triage, checks, by-violation view, row expansion, common-issue CTA). */
  shareMode?: boolean
  /** Optional. Threaded into the scorecard's v1/v2 badge (C9-A). Omitted =
   *  no badge, identical render to before this prop existed. */
  scoreMeta?: { version: number; fromFallback: boolean; passCount: number | null; incompleteCount: number | null }
}

const PAGE_SIZE = 50

function paginationRange(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '...')[] = [1]
  const left = Math.max(2, current - 1)
  const right = Math.min(total - 1, current + 1)
  if (left > 2) pages.push('...')
  for (let i = left; i <= right; i++) pages.push(i)
  if (right < total - 1) pages.push('...')
  pages.push(total)
  return pages
}

export default function SiteAuditResultsView({
  domain, clientName, createdAt, pagesTotal, pagesError, summary, wcagLevel, score, compliant, pdfs = [], siteAuditId,
  shareMode = false, scoreMeta,
}: Props) {
  const wcagLabel = wcagLevel === 'wcag22aa' ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'

  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [filterImpact, setFilterImpact] = useState<ImpactFilter>('all')
  const [viewMode, setViewMode] = useState<'table' | 'by-violation'>('table')
  const [currentPage, setCurrentPage] = useState(1)

  const { triageMode, toggleTriage } = useTriageMode(siteAuditId, { enabled: !shareMode })

  const checks = useChecks({
    endpoint: `/api/site-audit/${siteAuditId}/checks`,
    enabled: triageMode && !shareMode,
  })
  /** Rule id to auto-expand/scroll-to inside the by-violation view.
   *  Set by the CommonIssueCallout's "View affected pages" CTA. */
  const [selectedViolationId, setSelectedViolationId] = useState<string | undefined>(undefined)

  const commonIssues = summary.commonIssues ?? []

  const handleViewAffectedPages = (ruleId: string) => {
    setSelectedViolationId(ruleId)
    setViewMode('by-violation')
  }

  const { issuePages, cleanPages, redirectedPages, counts } = useSiteAuditPages(summary.pages, {
    sortKey,
    filterImpact,
    filterStatus: 'all',
  })

  const { groupedViolations, loading: groupedLoading, loaded: groupedLoaded, error: groupedError } = useGroupedViolations(
    summary.pages,
    viewMode === 'by-violation' && !shareMode
  )

  // Reset pagination when sort/filter changes
  useEffect(() => { setCurrentPage(1) }, [sortKey, filterImpact])

  // Ref for scroll-to behavior when a scorecard tile is clicked
  const pagesWithIssuesRef = useRef<HTMLDivElement>(null)

  // Scorecard impact tile click: filter + jump to Pages-with-Issues.
  // Per spec section 6g: re-clicking the active tile clears the filter and
  // does NOT scroll again (the user is already at the section).
  const handleScorecardImpactClick = (
    impact: 'critical' | 'serious' | 'moderate' | 'minor',
  ) => {
    // Decide toggle state from the *current* render's filterImpact, then
    // perform setters + the scroll side effect outside any state-updater
    // callback. React state updaters must be pure (Strict Mode may run them
    // twice, which would double-fire the scroll).
    const isToggleOff = filterImpact === impact
    setFilterImpact(isToggleOff ? 'all' : impact)
    setViewMode('table')
    setCurrentPage(1)
    if (!isToggleOff) {
      pagesWithIssuesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const totalTablePages = Math.ceil(issuePages.length / PAGE_SIZE)
  const start = (currentPage - 1) * PAGE_SIZE
  const visiblePages = issuePages.slice(start, start + PAGE_SIZE)

  return (
    <div className="space-y-6">
      {summary.archived && <ArchivedAuditBanner variant="site" />}
      <ComplianceBanner />

      {/* Header */}
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-start gap-3 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">Site Audit — {domain}</h2>
              <span className="text-[10px] font-body font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-navy/10 dark:bg-white/10 text-navy/50 dark:text-white/50">
                {wcagLabel}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {clientName && <span className="text-[12px] font-body text-navy/40 dark:text-white/40">{clientName}</span>}
              <span className="text-[12px] font-body text-navy/40 dark:text-white/40"><ClientDate iso={createdAt} variant="dateTime" /></span>
              <span className="text-[12px] font-body text-navy/40 dark:text-white/40">
                {pagesTotal} pages
                {pagesError > 0 && ` · ${pagesError} error${pagesError !== 1 ? 's' : ''}`}
              </span>
            </div>
          </div>
          {!shareMode && (
            <div className="flex-shrink-0">
              <button
                type="button"
                onClick={toggleTriage}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body font-semibold border rounded-lg transition-colors ${triageMode ? 'bg-orange/10 border-orange text-orange' : 'border-gray-300 dark:border-navy-border text-navy/60 dark:text-white/60 hover:border-orange hover:text-orange'}`}
              >
                {triageMode ? 'Triage on' : 'Triage off'}
              </button>
            </div>
          )}
        </div>
        <div className="p-6">
          <AuditScorecardComponent
            scorecard={summary.aggregate}
            score={score}
            compliant={compliant}
            wcagLevel={wcagLevel}
            archivedCounts={summary.archived ? summary.archivedCounts ?? { passed: null, incomplete: null } : undefined}
            onImpactClick={handleScorecardImpactClick}
            activeImpact={filterImpact}
            scoreMeta={scoreMeta}
          />
        </div>
      </div>

      <KnownLimitationsNotice variant="site" />

      {/* Pages section */}
      <div ref={pagesWithIssuesRef} className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl overflow-hidden shadow-sm">
        {/* Section header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep">
          <div className="w-8 h-8 rounded-lg bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-[17px] text-navy dark:text-white">
            Pages with Issues
            <span className="text-navy/40 dark:text-white/40 font-normal text-[14px] ml-2">{issuePages.length}</span>
          </h2>
        </div>

        {/* Site-wide common issues — renders only when at least one rule hits the threshold */}
        {commonIssues.length > 0 && (
          <CommonIssueCallout
            issues={commonIssues}
            onViewAffectedPages={shareMode ? undefined : handleViewAffectedPages}
          />
        )}

        {/* Toolbar */}
        <SiteAuditToolbar
          sortKey={sortKey}
          onSortChange={setSortKey}
          filterImpact={filterImpact}
          onFilterImpactChange={setFilterImpact}
          viewMode={viewMode}
          onViewModeChange={(mode) => { if (!shareMode) setViewMode(mode) }}
          counts={counts}
          violationsCount={groupedLoaded ? groupedViolations.length : undefined}
          hideViewToggle={shareMode}
        />

        {/* Table view */}
        {viewMode === 'table' && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-navy-border bg-gray-50/50 dark:bg-navy-deep/50">
                    {triageMode && (
                      <th className="text-left pl-4 pr-2 py-2 w-8 text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40 dark:text-white/40">✓</th>
                    )}
                    <th className={`text-left py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40 dark:text-white/40 ${triageMode ? 'pl-2 pr-3' : 'px-4'}`}>Page</th>
                    <th className="text-center pr-3 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-red-400">Crit</th>
                    <th className="text-center pr-3 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-orange-400">Ser</th>
                    <th className="text-center pr-3 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-yellow-500">Mod</th>
                    <th className="text-center pr-3 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-blue-400">Min</th>
                    <th className="text-center pr-4 py-2 text-[10px] font-body font-semibold uppercase tracking-wider text-navy/40 dark:text-white/40">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePages.length === 0 ? (
                    <tr>
                      <td colSpan={triageMode ? 7 : 6} className="px-6 py-8 text-center text-[13px] font-body text-navy/40 dark:text-white/40">
                        No pages match the current filters.
                      </td>
                    </tr>
                  ) : (
                    visiblePages.map((page) => (
                      <PageRow
                        key={page.adaAuditId}
                        page={page}
                        triageMode={triageMode}
                        readOnly={false}
                        checks={checks}
                        shareMode={shareMode}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalTablePages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 dark:border-navy-border bg-gray-50/50 dark:bg-navy-deep/50">
                <span className="text-[12px] font-body text-navy/40 dark:text-white/40">
                  Showing {start + 1}–{Math.min(start + PAGE_SIZE, issuePages.length)} of {issuePages.length} pages
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-2.5 py-1 text-[12px] font-body rounded border border-gray-300 dark:border-navy-border text-navy dark:text-white hover:bg-gray-100 dark:hover:bg-navy-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Prev
                  </button>
                  {paginationRange(currentPage, totalTablePages).map((p, i) =>
                    p === '...' ? (
                      <span key={`ellipsis-${i}`} className="px-1.5 py-1 text-[12px] font-body text-navy/30 dark:text-white/30">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p as number)}
                        className={`px-2.5 py-1 text-[12px] font-body rounded border transition-colors ${
                          p === currentPage
                            ? 'border-orange bg-orange/10 text-orange font-semibold'
                            : 'border-gray-300 dark:border-navy-border text-navy dark:text-white hover:bg-gray-100 dark:hover:bg-navy-light'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalTablePages, p + 1))}
                    disabled={currentPage === totalTablePages}
                    className="px-2.5 py-1 text-[12px] font-body rounded border border-gray-300 dark:border-navy-border text-navy dark:text-white hover:bg-gray-100 dark:hover:bg-navy-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* By-violation view */}
        {viewMode === 'by-violation' && (
          <GroupedViolationsView
            groupedViolations={groupedViolations}
            loading={groupedLoading}
            error={groupedError}
            selectedViolationId={selectedViolationId}
          />
        )}
      </div>

      {/* Redirected pages */}
      {redirectedPages.length > 0 && (
        <section className="rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-6">
          <details>
            <summary className="cursor-pointer font-display font-bold text-[17px] text-navy dark:text-white">
              Redirects <span className="text-navy/40 dark:text-white/40 font-normal text-[14px] ml-2">{redirectedPages.length}</span>
            </summary>
            <div className="mt-4 space-y-2">
              {redirectedPages.map((p) => (
                <div key={p.url} className="flex items-center gap-2 text-[13px] font-body">
                  <span className="text-navy/60 dark:text-white/60 truncate">{p.url}</span>
                  <span className="text-navy/30 dark:text-white/30">→</span>
                  <a
                    href={p.finalUrl ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-orange hover:underline truncate"
                  >
                    {p.finalUrl}
                  </a>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}

      {/* Clean pages */}
      <CleanPagesSection pages={cleanPages} />

      {/* PDF accessibility issues — supplementary artifact list at the bottom */}
      <PdfIssuesSection pdfs={pdfs} domain={domain} />
    </div>
  )
}
