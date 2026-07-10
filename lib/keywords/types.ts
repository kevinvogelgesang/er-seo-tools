/**
 * Pure types + constants for the KS-1 GSC query-snapshot keyword signals.
 * No I/O. Re-exports the row shapes owned by the GSC provider (Task 2)
 * so `lib/keywords/` has a single import surface for consumers.
 */

export type { GscQueryPageResult } from '@/lib/analytics/google/gsc-provider'
export type { GscQueryRow, GscQueryPageRow } from '@/lib/analytics/google/gsc-provider'

import type { GscQueryRow } from '@/lib/analytics/google/gsc-provider'

/** Row limit for the `['query']`-dimensioned searchanalytics.query call. */
export const GSC_QUERY_ROW_LIMIT = 2500

/** Row limit for the `['query', 'page']`-dimensioned searchanalytics.query call. */
export const GSC_QUERY_PAGE_ROW_LIMIT = 5000

/** Minimum in-window impressions for a query to participate in any derivation (D4). */
export const GSC_MIN_IMPRESSIONS = 10

/** Trailing window length in days (13 weeks), inclusive of both endpoints. */
export const GSC_WINDOW_DAYS = 91

/** Days of lag before the fetch date the window's end is anchored to, sidestepping GSC's fresh-data lag. */
export const GSC_WINDOW_LAG_DAYS = 3

/** Minimum per-page impression share of a query's observed page-impression sum to count toward cannibalization. */
export const CANNIBALIZATION_MIN_SHARE = 0.2

/** Minimum per-page impressions (in addition to share) to count toward cannibalization. */
export const CANNIBALIZATION_MIN_PAGE_IMPRESSIONS = 10

/** A query-row entry that made a band (wins / opportunities / quickWins). */
export type KeywordBandEntry = GscQueryRow

/** A single competing page for a cannibalized query. */
export type CannibalizationPageEntry = {
  page: string
  impressions: number
  clicks: number
  share: number
}

/** A cannibalized query: >=2 competing pages each holding a qualifying share. */
export type CannibalizationEntry = {
  query: string
  /** The query-row impressions for this query, or null when the query is absent from query-only rows. */
  queryImpressions: number | null
  /** Sum of this query's query×page-row impressions (the share denominator). */
  observedPageImpressions: number
  /**
   * observedPageImpressions / queryImpressions. Null when queryImpressions is null.
   * NOT clamped to <= 1 — GSC aggregation/privacy filtering can put page sums above the query total.
   */
  observedPageCoverage: number | null
  pages: CannibalizationPageEntry[]
}

/** Thresholds echoed back on every derived result, for UI/export transparency. */
export type KeywordSignalThresholds = {
  minImpressions: number
  cannibalizationMinShare: number
  cannibalizationMinPageImpressions: number
}

/** Full counts for the four derived lists. */
export type KeywordSignalCounts = {
  wins: number
  opportunities: number
  quickWins: number
  cannibalizedQueries: number
}

/** The pure output of `deriveKeywordSignals`. */
export type KeywordSignals = {
  wins: KeywordBandEntry[]
  opportunities: KeywordBandEntry[]
  quickWins: KeywordBandEntry[]
  cannibalization: CannibalizationEntry[]
  counts: KeywordSignalCounts
  thresholds: KeywordSignalThresholds
}
