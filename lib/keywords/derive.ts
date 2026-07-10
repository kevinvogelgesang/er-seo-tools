/**
 * Pure derivations over a GSC query snapshot (KS-1, D4 + spec §5.3).
 * No I/O, no Date.now — deterministic given its inputs.
 */

import {
  CANNIBALIZATION_MIN_PAGE_IMPRESSIONS,
  CANNIBALIZATION_MIN_SHARE,
  type CannibalizationEntry,
  type CannibalizationPageEntry,
  type GscQueryPageRow,
  type GscQueryRow,
  type KeywordSignals,
} from './types'

/** A position is usable for band classification only if finite and strictly positive. */
function isUsablePosition(position: number): boolean {
  return Number.isFinite(position) && position > 0
}

/** Treat non-finite/negative impressions as 0 (never lets bad data inflate a sum or a share). */
function safeImpressions(impressions: number): number {
  return Number.isFinite(impressions) && impressions >= 0 ? impressions : 0
}

function byClicksThenImpressionsDesc(a: GscQueryRow, b: GscQueryRow): number {
  if (b.clicks !== a.clicks) return b.clicks - a.clicks
  return b.impressions - a.impressions
}

export function deriveKeywordSignals(
  queryRows: GscQueryRow[],
  queryPageRows: GscQueryPageRow[],
  opts: { minImpressions: number },
): KeywordSignals {
  const { minImpressions } = opts

  // ── Bands ────────────────────────────────────────────────────────────────
  const wins: GscQueryRow[] = []
  const opportunities: GscQueryRow[] = []
  const quickWins: GscQueryRow[] = []

  for (const row of queryRows) {
    if (row.impressions < minImpressions) continue
    if (!isUsablePosition(row.position)) continue

    if (row.position <= 10) {
      wins.push(row)
    } else if (row.position <= 30) {
      opportunities.push(row)
      if (row.position <= 20) {
        quickWins.push(row)
      }
    }
  }

  wins.sort(byClicksThenImpressionsDesc)
  opportunities.sort(byClicksThenImpressionsDesc)
  quickWins.sort(byClicksThenImpressionsDesc)

  // ── Cannibalization ──────────────────────────────────────────────────────
  const queryImpressionsByQuery = new Map<string, number>()
  for (const row of queryRows) {
    queryImpressionsByQuery.set(row.query, row.impressions)
  }

  const pageRowsByQuery = new Map<string, GscQueryPageRow[]>()
  for (const row of queryPageRows) {
    const list = pageRowsByQuery.get(row.query)
    if (list) {
      list.push(row)
    } else {
      pageRowsByQuery.set(row.query, [row])
    }
  }

  const cannibalization: CannibalizationEntry[] = []

  for (const [query, pageRows] of pageRowsByQuery) {
    const hasQueryRow = queryImpressionsByQuery.has(query)
    const queryImpressions = hasQueryRow ? queryImpressionsByQuery.get(query)! : null

    const observedPageImpressions = pageRows.reduce(
      (sum, r) => sum + safeImpressions(r.impressions),
      0,
    )

    // Eligibility: query-row impressions >= threshold when known; otherwise
    // judged on the observed page-row sum (D4 / brief).
    const eligible =
      queryImpressions !== null
        ? queryImpressions >= minImpressions
        : observedPageImpressions >= minImpressions

    if (!eligible) continue

    const pages: CannibalizationPageEntry[] = pageRows
      .map((r) => {
        const impressions = safeImpressions(r.impressions)
        const share = observedPageImpressions > 0 ? impressions / observedPageImpressions : 0
        return { page: r.page, impressions, clicks: r.clicks, share }
      })
      .sort((a, b) => b.impressions - a.impressions)

    const qualifyingPageCount = pages.filter(
      (p) => p.share >= CANNIBALIZATION_MIN_SHARE && p.impressions >= CANNIBALIZATION_MIN_PAGE_IMPRESSIONS,
    ).length

    if (qualifyingPageCount < 2) continue

    const observedPageCoverage = queryImpressions !== null ? observedPageImpressions / queryImpressions : null

    cannibalization.push({
      query,
      queryImpressions,
      observedPageImpressions,
      observedPageCoverage,
      pages,
    })
  }

  cannibalization.sort((a, b) => b.observedPageImpressions - a.observedPageImpressions)

  return {
    wins,
    opportunities,
    quickWins,
    cannibalization,
    counts: {
      wins: wins.length,
      opportunities: opportunities.length,
      quickWins: quickWins.length,
      cannibalizedQueries: cannibalization.length,
    },
    thresholds: {
      minImpressions,
      cannibalizationMinShare: CANNIBALIZATION_MIN_SHARE,
      cannibalizationMinPageImpressions: CANNIBALIZATION_MIN_PAGE_IMPRESSIONS,
    },
  }
}
