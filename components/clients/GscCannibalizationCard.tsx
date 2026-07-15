'use client'

// KS-1 Task 8 — dashboard card for the full GSC query×page cannibalization
// report (design spec §5.5, Increment A). Seeded with server-loaded
// `initial`; Refresh POSTs the cookie-gated gsc-snapshot route (same as
// GscKeywordCard) then re-GETs this card's own gsc-cannibalization route.
// Refresh failures are EPHEMERAL (component state only) and NEVER clear the
// prior report — a reload always shows the last good report. This card is
// an INDEPENDENT control from GscKeywordCard — refreshing one does not
// imply the other updates (Codex #6).

import { useState } from 'react'
import type { CannibalizationReport } from '@/lib/keywords/types'
import { Explainer, ExplainerSummary, ExplainerTags, ExplainerNote } from '@/components/ui/Explainer'

type Report = CannibalizationReport['report']

interface Props {
  clientId: number
  initial: { gscMapped: boolean; report: Report }
}

const DEFAULT_ERROR_COPY = 'Refresh failed. Try again.'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function GscCannibalizationCard({ clientId, initial }: Props) {
  const gscMapped = initial.gscMapped
  const [report, setReport] = useState<Report>(initial.report)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      const snapshotRes = await fetch(`/api/clients/${clientId}/gsc-snapshot`, { method: 'POST' })
      if (!snapshotRes.ok) {
        setError(DEFAULT_ERROR_COPY)
        return
      }
      const reportRes = await fetch(`/api/clients/${clientId}/gsc-cannibalization`)
      const body = await reportRes.json().catch(() => ({}))
      if (!reportRes.ok) {
        setError(DEFAULT_ERROR_COPY)
        return
      }
      setReport(body.report as Report)
    } catch {
      setError(DEFAULT_ERROR_COPY)
    } finally {
      setRefreshing(false)
    }
  }

  const showTruncationNotice =
    !!report && (report.queryAtLimit || report.queryPageAtLimit || report.capped)

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">GSC cannibalization report</h2>
          <Explainer label="What is the cannibalization report?" title="GSC Cannibalization Report">
            <ExplainerSummary>
              The full keyword-cannibalization list from the latest Search Console snapshot: queries
              where two or more pages each captured at least 20% of the query&apos;s impressions,
              splitting click potential between them.
            </ExplainerSummary>
            <ExplainerTags tags={['Google Search Console', '≥20% impression share']} />
            <ExplainerNote>
              A query missing from this list wasn&apos;t seen splitting impressions across pages in
              this window — not proof it can&apos;t be.
            </ExplainerNote>
          </Explainer>
        </div>
        {gscMapped && (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {!gscMapped && (
        <p className="text-xs text-gray-500 dark:text-white/50">
          No GSC property is mapped for this client. Map one in the Analytics IDs panel above to see
          cannibalization data.
        </p>
      )}

      {gscMapped && error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}

      {gscMapped && !report && (
        <p className="text-xs text-gray-400 dark:text-white/40">
          No cannibalization report yet. Click Refresh to fetch one from Search Console. This control is
          independent of the keyword snapshot card above.
        </p>
      )}

      {gscMapped && report && (
        <div>
          <p className="text-xs text-gray-500 dark:text-white/50 mb-3">
            Fetched {formatDate(report.fetchedAt)} · window {formatDate(report.windowStart)}–
            {formatDate(report.windowEnd)}
          </p>

          {showTruncationNotice && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
              Results may be truncated — GSC returned the maximum rows for this window.
            </p>
          )}

          {report.entries.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-white/40">
              No cannibalized queries observed in this GSC window.
            </p>
          ) : (
            <div>
              <p className="text-[11px] text-gray-400 dark:text-white/40 mb-2">
                {report.totalCannibalizedQueries.toLocaleString()} cannibalized{' '}
                {report.totalCannibalizedQueries === 1 ? 'query' : 'queries'} observed in this GSC window — a
                query not listed here was not observed splitting impressions across pages, not proof it
                isn&apos;t.
              </p>
              <ul className="divide-y divide-gray-100 dark:divide-navy-border">
                {report.entries.map((entry) => (
                  <li key={entry.query} className="py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-800 dark:text-white/90 font-medium truncate">
                        {entry.query}
                      </span>
                      <span className="text-gray-500 dark:text-white/50 shrink-0 tabular-nums">
                        {entry.observedPageImpressions.toLocaleString()} impr.
                      </span>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-gray-500 dark:text-white/50 text-[11px]">
                        {entry.pages.length} competing pages
                      </summary>
                      <ul className="mt-1.5 space-y-1.5">
                        {entry.pages.map((page) => (
                          <li key={page.page} className="text-[11px]">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <span className="text-gray-700 dark:text-white/70 truncate">{page.page}</span>
                              <span className="text-gray-500 dark:text-white/50 shrink-0 tabular-nums">
                                {page.impressions.toLocaleString()} impr. · {page.clicks.toLocaleString()}{' '}
                                clicks
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-blue-500 dark:bg-blue-400"
                                style={{ width: `${Math.round(page.share * 100)}%` }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
