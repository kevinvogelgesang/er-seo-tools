'use client'

// KS-1 Task 7 — dashboard card for the GSC query×page keyword snapshot
// (design spec §5.5). Seeded with server-loaded `initial`; Refresh POSTs the
// cookie-gated route and replaces state on success. Refresh failures are
// EPHEMERAL (component state only, never persisted) and NEVER clear the
// prior summary — a reload always shows the last good snapshot.
//
// `GscSnapshotSummary` is imported as a type-only import from
// '@/lib/keywords/gsc-snapshot', which re-exports it from the client-safe
// './types' — that module's own import chain never touches the (server-only)
// GSC provider or prisma at runtime.

import { useState } from 'react'
import type { GscSnapshotSummary } from '@/lib/keywords/gsc-snapshot'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'

interface Props {
  clientId: number
  initial: { gscMapped: boolean; summary: GscSnapshotSummary | null }
}

// Human copy per route error code (spec §5.4). gsc_access_denied and
// gsc_not_mapped are DELIBERATELY distinct (Codex #5/#6) — a configured
// property that 403s is a different operator action (grant SA access) than
// an unconfigured one (map a property).
const ERROR_COPY: Record<string, string> = {
  gsc_not_mapped: 'No GSC property is mapped for this client. Configure one in the Analytics IDs panel above.',
  gsc_access_denied:
    'The service account does not have access to this GSC property yet. Grant it access in Search Console, then refresh again.',
  gsc_quota: 'Google Search Console API quota was exceeded. Try refreshing again in a few minutes.',
  gsc_auth: 'Could not authenticate with Google Search Console. Check the service-account configuration.',
  gsc_error: 'Search Console returned an error while refreshing this snapshot.',
}

const DEFAULT_ERROR_COPY = 'Refresh failed. Try again.'

const CANNIBALIZATION_DISPLAY_CAP = 5

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function GscKeywordCard({ clientId, initial }: Props) {
  const [summary, setSummary] = useState<GscSnapshotSummary | null>(initial.summary)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/gsc-snapshot`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = typeof body?.error === 'string' ? body.error : undefined
        setError((code && ERROR_COPY[code]) ?? DEFAULT_ERROR_COPY)
        return
      }
      setSummary(body.summary as GscSnapshotSummary)
    } catch {
      setError(DEFAULT_ERROR_COPY)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">GSC keyword snapshot</h2>
        {initial.gscMapped && (
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

      <Explainer label="What is this?" className="mb-3">
        <ExplainerSummary>
          Ranking signals pulled from Google Search Console over a trailing 91-day window ending
          three days back: wins (average position in the top 10), opportunities (positions 11–30),
          quick wins (positions 11–20), and queries where two or more pages split the same
          query&apos;s impressions (cannibalization). A keyword that does not appear was simply not
          reported by GSC in the window — never proof the site isn&apos;t ranking for it.
        </ExplainerSummary>
      </Explainer>

      {!initial.gscMapped && (
        <p className="text-xs text-gray-500 dark:text-white/50">
          Map a GSC property in the Analytics IDs panel above to see keyword wins, opportunities, and
          cannibalization data.
        </p>
      )}

      {initial.gscMapped && error && (
        <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>
      )}

      {initial.gscMapped && !summary && (
        <p className="text-xs text-gray-400 dark:text-white/40">
          No keyword snapshot yet. Click Refresh to fetch one from Search Console.
        </p>
      )}

      {initial.gscMapped && summary && (
        <div>
          <p className="text-xs text-gray-500 dark:text-white/50 mb-3">
            Fetched {formatDate(summary.fetchedAt)} · window {formatDate(summary.window.start)}–
            {formatDate(summary.window.end)}
          </p>

          <div className="flex flex-wrap gap-1.5 mb-3 tabular-nums">
            <SeverityBadge tone="blue" label={`${summary.counts.wins} wins`} />
            <SeverityBadge tone="purple" label={`${summary.counts.opportunities} opportunities`} />
            <SeverityBadge tone="orange" label={`${summary.counts.quickWins} quick wins`} />
            <SeverityBadge tone="red" label={`${summary.counts.cannibalizedQueries} cannibalized`} />
          </div>

          {(summary.queryAtLimit || summary.queryPageAtLimit) && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
              Query data hit the Search Console API row limit for this window — results may be truncated.
            </p>
          )}

          {summary.cannibalization.length > 0 ? (
            <div>
              <h3 className="text-xs font-semibold text-gray-600 dark:text-white/70 mb-1">
                Top cannibalized queries
              </h3>
              <p className="text-[11px] text-gray-400 dark:text-white/40 mb-2">
                Impressions observed in this GSC window — a query not listed here was not observed splitting
                impressions across pages, not proof it isn&apos;t.
              </p>
              <ul className="divide-y divide-gray-100 dark:divide-navy-border">
                {summary.cannibalization.slice(0, CANNIBALIZATION_DISPLAY_CAP).map((c) => (
                  <li
                    key={c.query}
                    className="py-1.5 text-xs flex items-center justify-between gap-2"
                  >
                    <span className="text-gray-800 dark:text-white/90 truncate">{c.query}</span>
                    <span className="text-gray-500 dark:text-white/50 shrink-0 tabular-nums">
                      {c.pages.length} pages · {c.observedPageImpressions.toLocaleString()} impr.
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-white/40">
              No cannibalization observed in this GSC window.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
