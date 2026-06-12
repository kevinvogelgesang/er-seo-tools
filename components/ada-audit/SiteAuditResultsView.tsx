'use client'

import { useState, useEffect, useRef } from 'react'
import { Spinner } from '@/components/Spinner'
import type { SiteAuditSummary, SitePageResult, AuditPdfRow } from '@/lib/ada-audit/types'
import type { StoredAxeResults } from '@/lib/ada-audit/types'
import AuditScorecardComponent from './AuditScorecard'
import AuditIssueTabs from './AuditIssueTabs'
import ComplianceBanner from './ComplianceBanner'
import { KnownLimitationsNotice } from './KnownLimitationsNotice'
import SiteAuditToolbar from './SiteAuditToolbar'
import CleanPagesSection from './CleanPagesSection'
import PdfIssuesSection from './PdfIssuesSection'
import { useSiteAuditPages, type SortKey, type ImpactFilter } from './useSiteAuditPages'
import { useGroupedViolations } from './useGroupedViolations'
import GroupedViolationsView from './GroupedViolationsView'
import CommonIssueCallout from './CommonIssueCallout'
import { safeExternalHref } from '@/lib/safe-external-href'
import { useChecks, type UseChecksReturn } from './useChecks'
import { keyForPage, keyForPageViolation } from '@/lib/ada-audit/checks-keys-browser'
import { ClientDate } from '@/components/ClientDate'

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
}

function ImpactCount({ n, color }: { n: number; color: string }) {
  if (n === 0) return <span className="text-navy/20 dark:text-white/20">—</span>
  return <span className={`font-semibold ${color}`}>{n}</span>
}

interface PageRowProps {
  page: SitePageResult
  triageMode: boolean
  readOnly: boolean
  checks: UseChecksReturn
  shareMode: boolean
}

function PageRow({ page, triageMode, readOnly, checks, shareMode }: PageRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [violations, setViolations] = useState<StoredAxeResults['violations'] | null>(null)
  const [loading, setLoading] = useState(false)

  // Pre-compute page + per-violation keys for this page.
  const [pageKey, setPageKey] = useState<string>('')
  const [violationKeyMap, setViolationKeyMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (shareMode) return // triage keys are an internal-only affordance
    let cancelled = false
    ;(async () => {
      const pk = await keyForPage({ pageUrl: page.url })
      const vks: Record<string, string> = {}
      for (const ruleId of page.violationIds ?? []) {
        vks[ruleId] = await keyForPageViolation({ pageUrl: page.url, ruleId })
      }
      if (!cancelled) {
        setPageKey(pk)
        setViolationKeyMap(vks)
      }
    })()
    return () => { cancelled = true }
  }, [page.url, page.violationIds, shareMode])

  const violationKeys = Object.values(violationKeyMap)
  const allViolationsChecked =
    violationKeys.length > 0 &&
    violationKeys.every((k) => checks.has('page-violation', k))
  const pageChecked = !!pageKey && checks.has('page', pageKey)
  const pageStruck = pageChecked || allViolationsChecked

  async function handleExpand() {
    if (shareMode) return // public view: expansion fetches a cookie-gated API
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (violations !== null) return
    setLoading(true)
    try {
      const res = await fetch(`/api/ada-audit/${page.adaAuditId}`)
      if (res.ok) {
        const data = await res.json()
        setViolations(data.results?.violations ?? [])
      }
    } catch { /* leave null */ } finally {
      setLoading(false)
    }
  }

  const urlDisplay = page.url.replace(/^https?:\/\//, '')
  const sc = page.scorecard
  const pageHref = safeExternalHref(page.url)

  const colSpan = triageMode ? 7 : 6

  return (
    <>
      <tr
        className={`border-b border-gray-100 dark:border-navy-border transition-colors ${shareMode ? '' : 'hover:bg-gray-50 dark:hover:bg-navy-light cursor-pointer'} ${expanded ? 'bg-gray-50 dark:bg-navy-light' : ''}`}
        onClick={shareMode ? undefined : handleExpand}
      >
        {triageMode && (
          <td className="py-2.5 pl-4 pr-2 w-8" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className="accent-orange"
              checked={pageStruck}
              disabled={readOnly || !checks.loaded || !pageKey || checks.pending}
              onChange={(e) => void checks.setCheck('page', pageKey, e.currentTarget.checked)}
              aria-label={`Mark page ${page.url} as handled`}
            />
          </td>
        )}
        <td className={`py-2.5 pr-3 ${triageMode ? 'pl-2' : 'pl-4'}`}>
          <div className="flex items-center gap-2">
            {!shareMode && (
              <svg
                className={`w-3 h-3 flex-shrink-0 text-navy/30 dark:text-white/30 transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`text-[12px] font-body truncate max-w-xs ${pageStruck ? 'line-through text-navy/40 dark:text-white/30' : 'text-navy/80 dark:text-white/80'}`}
                title={page.url}
              >
                {urlDisplay}
              </span>
              {pageHref && (
                <a
                  href={pageHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-navy/40 dark:text-white/30 hover:text-orange dark:hover:text-orange transition-colors"
                  title={`Open ${page.url}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        </td>
        <td className="py-2.5 pr-3 text-[12px] font-body text-center">
          {page.status === 'error'
            ? <span className="text-[10px] font-body bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 px-2 py-0.5 rounded" title={page.error ?? ''}>error</span>
            : <ImpactCount n={sc?.critical ?? 0} color="text-red-600" />}
        </td>
        <td className="py-2.5 pr-3 text-[12px] font-body text-center">
          {page.status !== 'error' && <ImpactCount n={sc?.serious ?? 0} color="text-orange-600" />}
        </td>
        <td className="py-2.5 pr-3 text-[12px] font-body text-center">
          {page.status !== 'error' && <ImpactCount n={sc?.moderate ?? 0} color="text-yellow-600" />}
        </td>
        <td className="py-2.5 pr-3 text-[12px] font-body text-center">
          {page.status !== 'error' && <ImpactCount n={sc?.minor ?? 0} color="text-blue-600" />}
        </td>
        <td className="py-2.5 pr-4 text-[12px] font-body font-semibold text-navy/70 dark:text-white/70 text-center">
          {page.status !== 'error' && (sc?.total ?? 0)}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-navy-deep border-b border-gray-100 dark:border-navy-border">
          <td colSpan={colSpan} className="px-8 py-4">
            {loading ? (
              <div className="flex items-center gap-2 text-[12px] font-body text-navy/40 dark:text-white/40 py-2">
                <Spinner />
                Loading violations…
              </div>
            ) : page.status === 'error' ? (
              <p className="text-[12px] font-body text-red-600 dark:text-red-400 py-2">{page.error}</p>
            ) : violations !== null ? (
              <div className="space-y-3">
                <AuditIssueTabs
                  violations={violations}
                  siteCheckContext={{
                    pageUrl: page.url,
                    triageMode,
                    readOnly,
                    checks,
                  }}
                />
                <a
                  href={`/ada-audit/${page.adaAuditId}`}
                  className="inline-block text-[12px] font-body font-semibold text-orange hover:text-orange-light transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  View full audit ↗
                </a>
              </div>
            ) : (
              <p className="text-[12px] font-body text-navy/40 dark:text-white/40 py-2">Could not load violations.</p>
            )}
          </td>
        </tr>
      )}
    </>
  )
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
  shareMode = false,
}: Props) {
  const wcagLabel = wcagLevel === 'wcag22aa' ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'

  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [filterImpact, setFilterImpact] = useState<ImpactFilter>('all')
  const [viewMode, setViewMode] = useState<'table' | 'by-violation'>('table')
  const [currentPage, setCurrentPage] = useState(1)

  const [triageMode, setTriageMode] = useState(false)

  useEffect(() => {
    if (shareMode) return // public view: triage is internal-only; never touch localStorage
    const stored = localStorage.getItem(`er-triage-mode:${siteAuditId}`)
    if (stored === '1') setTriageMode(true)
  }, [siteAuditId, shareMode])

  const onToggleTriage = () => {
    setTriageMode((prev) => {
      const next = !prev
      localStorage.setItem(`er-triage-mode:${siteAuditId}`, next ? '1' : '0')
      return next
    })
  }

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
      {summary.archived && (
        <div className="flex gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-[12px] font-body text-amber-800 dark:text-amber-400 leading-relaxed">
          <span>
            <strong>Archived audit:</strong> full per-page detail was pruned after 90 days.
            Violations shown are exact; node samples are capped at 5 per rule.
          </span>
        </div>
      )}
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
                onClick={onToggleTriage}
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
