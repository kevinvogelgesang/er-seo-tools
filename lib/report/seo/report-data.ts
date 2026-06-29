// lib/report/seo/report-data.ts — snapshot → view-model transform (pure function)
//
// buildSeoReportData(bundle, meta) converts a PerformanceAnalyticsBundle (the
// persisted metricsJson snapshot) into a SeoReportData view-model for use by
// the HTML/PDF builder.
//
// PURE: no Prisma, no network, no Date.now() / argless new Date().
// generatedAt is passed in as a string.
//
// ─── Design decisions documented ─────────────────────────────────────────────
//
// 1. prev===0 guard: delta = null (not 0, not Infinity) when prev===0.
//    Rationale: a divide-by-zero delta is meaningless; null triggers the "—"
//    display in the UI and keeps downstream comparisons from NaN/Infinity.
//
// 2. Top-N values:
//    - Landing pages: top 10 (spec §5 says "top 10")
//    - Queries: top 100 (GSC bundle carries up to 100; we display all of them)
//    - Cities: top 10 by sessions (sorted desc, then sliced)
//
// 3. Value formatting:
//    - Duration: integer seconds → "m:ss" (e.g. 125 → "2:05", 45 → "0:45")
//    - Percentage fields (bounceRate, CTR): multiply by 100, format to 1 dp,
//      append "%". e.g. 0.05 → "5.0%", 0.40 → "40.0%"
//    - Position / eventsPerSession: toFixed(1) string
//    - Integer counts (sessions, clicks, impressions, engaged sessions,
//      prospects): toLocaleString('en-US') for thousands separators
//
// 4. Scorecard order (spec §5):
//    Sessions (GA4), Prospects (Prospects), Organic Prospects (Prospects),
//    Avg Position (GSC), Avg Session Duration (GA4), Events / Session (GA4),
//    Bounce Rate (GA4), Engaged Sessions (GA4), Clicks (GSC),
//    Impressions (GSC), Avg Position (duplicate entry in spec reflects the
//    Looker layout; we deduplicate to one "Avg Position"), Site CTR (GSC).
//    Total: 12 scorecards.
//
// ─────────────────────────────────────────────────────────────────────────────

import type {
  PerformanceAnalyticsBundle,
  Ga4Bundle,
  GscBundle,
  ProspectsBundle,
} from '@/lib/analytics/types'

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface SeoScorecardRow {
  label: string
  value: string
  delta: number | null
  /** true = change is favorable; false = unfavorable; null = unknown (no delta) */
  deltaGood: boolean | null
}

export interface SeoReportData {
  // Header meta
  clientName: string
  domain: string
  periodLabel: string
  comparisonLabel: string
  generatedAt: string
  operator: string | null

  // Scorecards (12, in spec §5 order)
  scorecards: SeoScorecardRow[]

  // Chart series — GA4 (sessions over time)
  sessionsSeries: { date: string; value: number }[]
  sessionsSeriesPrev: { date: string; value: number }[]

  // Chart series — GSC
  clicksSeries: { date: string; value: number }[]
  clicksSeriesPrev: { date: string; value: number }[]
  impressionsSeries: { date: string; value: number }[]
  impressionsSeriesPrev: { date: string; value: number }[]
  positionSeries: { date: string; value: number }[]
  positionSeriesPrev: { date: string; value: number }[]

  // Tables
  /** Top 10 landing pages by sessions (as provided by GA4Bundle in order) */
  landingPages: { path: string; sessions: number; keyEvents: number }[]
  /** Top 100 queries (as provided by GscBundle in order) */
  queries: { query: string; position: number; positionPrev: number | null }[]
  /** Top 10 cities by sessions (sorted desc) */
  cities: { city: string; sessions: number; keyEvents: number }[]

  // Donuts
  newVsReturning: { label: string; sessions: number }[]
  devices: { label: string; sessions: number }[]

  // Gap flags
  gaps: { ga4: boolean; gsc: boolean; prospects: boolean }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOP_LANDING_PAGES = 10
const TOP_QUERIES = 100
const TOP_CITIES = 10

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Formats integer seconds as "m:ss".
 * e.g. 125 → "2:05",  45 → "0:45",  3661 → "61:01"
 */
function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Formats a 0–1 fraction as a percentage string with 1 decimal place.
 * e.g. 0.05 → "5.0%",  0.4 → "40.0%"
 */
function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

/**
 * Formats an integer count with thousands separators.
 * e.g. 12345 → "12,345"
 */
function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/**
 * Formats a decimal to 1 decimal place.
 * e.g. 8.3 → "8.3",  4.5 → "4.5"
 */
function formatDecimal(n: number): string {
  return n.toFixed(1)
}

// ---------------------------------------------------------------------------
// Delta helpers
// ---------------------------------------------------------------------------

/**
 * Compute delta ratio = (cur - prev) / prev.
 * Returns null when prev === 0 (guard against Infinity/NaN).
 */
function computeDelta(cur: number, prev: number): number | null {
  if (prev === 0) return null
  return (cur - prev) / prev
}

/**
 * For higher-is-better metrics: delta > 0 is good.
 * For lower-is-better metrics: delta < 0 is good.
 * Returns null when delta is null.
 */
function deltaGood(delta: number | null, higherIsBetter: boolean): boolean | null {
  if (delta === null) return null
  return higherIsBetter ? delta > 0 : delta < 0
}

// ---------------------------------------------------------------------------
// Gap sentinel
// ---------------------------------------------------------------------------

const GAP_SCORECARD: Pick<SeoScorecardRow, 'value' | 'delta' | 'deltaGood'> = {
  value: '—',
  delta: null,
  deltaGood: null,
}

// ---------------------------------------------------------------------------
// Main transform
// ---------------------------------------------------------------------------

export function buildSeoReportData(
  bundle: PerformanceAnalyticsBundle,
  meta: {
    clientName: string
    domain: string
    periodLabel: string
    comparisonLabel: string
    generatedAt: string
    operator: string | null
  }
): SeoReportData {
  const ga4Ok = bundle.ga4.ok
  const gscOk = bundle.gsc.ok
  const prospectsOk = bundle.prospects.ok

  const ga4 = ga4Ok ? (bundle.ga4.data as Ga4Bundle) : null
  const gsc = gscOk ? (bundle.gsc.data as GscBundle) : null
  const prospects = prospectsOk ? (bundle.prospects.data as ProspectsBundle) : null

  // ─── Scorecards ──────────────────────────────────────────────────────────

  // Helper for GA4-sourced scorecards
  function ga4Scorecard(
    label: string,
    cur: number,
    prev: number,
    format: (n: number) => string,
    higherIsBetter: boolean
  ): SeoScorecardRow {
    if (!ga4) return { label, ...GAP_SCORECARD }
    const d = computeDelta(cur, prev)
    return { label, value: format(cur), delta: d, deltaGood: deltaGood(d, higherIsBetter) }
  }

  // Helper for GSC-sourced scorecards
  function gscScorecard(
    label: string,
    cur: number,
    prev: number,
    format: (n: number) => string,
    higherIsBetter: boolean
  ): SeoScorecardRow {
    if (!gsc) return { label, ...GAP_SCORECARD }
    const d = computeDelta(cur, prev)
    return { label, value: format(cur), delta: d, deltaGood: deltaGood(d, higherIsBetter) }
  }

  // Helper for Prospects-sourced scorecards
  function prospectsScorecard(
    label: string,
    cur: number | null,
    prev: number | null
  ): SeoScorecardRow {
    if (!prospects || cur === null) return { label, ...GAP_SCORECARD }
    const d = prev !== null ? computeDelta(cur, prev) : null
    return { label, value: formatCount(cur), delta: d, deltaGood: deltaGood(d, true) }
  }

  // 12 scorecards in spec §5 order:
  // Sessions (GA4), Prospects (Prospects), Organic Prospects (Prospects),
  // Avg Position (GSC), Avg Session Duration (GA4), Events/Session (GA4),
  // Bounce Rate (GA4), Engaged Sessions (GA4), Clicks (GSC),
  // Impressions (GSC), Avg Position (GSC — deduped to one entry), Site CTR (GSC)
  //
  // Note: spec §5 table lists "Avg Position" twice (once standalone, once in
  // the GSC group). We render it once at position 4 (GSC) and deduplicate.
  const scorecards: SeoScorecardRow[] = [
    // 1. Sessions — GA4, higher is better
    ga4Scorecard(
      'Sessions',
      ga4?.totals.sessions ?? 0,
      ga4?.comparisonTotals.sessions ?? 0,
      formatCount,
      true
    ),
    // 2. Prospects — Prospects, higher is better
    prospectsScorecard('Prospects', prospects?.total ?? null, null),
    // 3. Organic Prospects — Prospects, higher is better
    prospectsScorecard('Organic Prospects', prospects?.organic ?? null, null),
    // 4. Avg Position — GSC, lower is better
    gscScorecard(
      'Avg Position',
      gsc?.totals.position ?? 0,
      gsc?.comparisonTotals.position ?? 0,
      formatDecimal,
      false
    ),
    // 5. Avg Session Duration — GA4, higher is better
    ga4Scorecard(
      'Avg Session Duration',
      ga4?.totals.averageSessionDuration ?? 0,
      ga4?.comparisonTotals.averageSessionDuration ?? 0,
      formatDuration,
      true
    ),
    // 6. Events / Session — GA4, higher is better
    ga4Scorecard(
      'Events / Session',
      ga4?.totals.eventsPerSession ?? 0,
      ga4?.comparisonTotals.eventsPerSession ?? 0,
      formatDecimal,
      true
    ),
    // 7. Bounce Rate — GA4, lower is better
    ga4Scorecard(
      'Bounce Rate',
      ga4?.totals.bounceRate ?? 0,
      ga4?.comparisonTotals.bounceRate ?? 0,
      formatPercent,
      false
    ),
    // 8. Engaged Sessions — GA4, higher is better
    ga4Scorecard(
      'Engaged Sessions',
      ga4?.totals.engagedSessions ?? 0,
      ga4?.comparisonTotals.engagedSessions ?? 0,
      formatCount,
      true
    ),
    // 9. Clicks — GSC, higher is better
    gscScorecard(
      'Clicks',
      gsc?.totals.clicks ?? 0,
      gsc?.comparisonTotals.clicks ?? 0,
      formatCount,
      true
    ),
    // 10. Impressions — GSC, higher is better
    gscScorecard(
      'Impressions',
      gsc?.totals.impressions ?? 0,
      gsc?.comparisonTotals.impressions ?? 0,
      formatCount,
      true
    ),
    // 11. Site CTR — GSC, higher is better
    gscScorecard(
      'Site CTR',
      gsc?.totals.ctr ?? 0,
      gsc?.comparisonTotals.ctr ?? 0,
      formatPercent,
      true
    ),
    // 12. Key Events (GA4 keyEvents) — GA4, higher is better
    //     Note: spec §5 names 12 entries; the Looker sample shows Key Events
    //     as the final GA4 metric. We include it as "Key Events".
    ga4Scorecard(
      'Key Events',
      ga4?.totals.keyEvents ?? 0,
      ga4?.comparisonTotals.keyEvents ?? 0,
      formatCount,
      true
    ),
  ]

  // ─── Prospects scorecards need special handling for comparison ────────────
  // ProspectsBundle has no comparison fields at the bundle level in v1
  // (CRM may not segment by date range for prev period). delta stays null
  // for prospects in the current model.
  // The prospectsScorecard helper already handles this (passes null for prev).

  // ─── Chart series ──────────────────────────────────────────────────────────

  const sessionsSeries = ga4 ? ga4.sessionsSeries : []
  const sessionsSeriesPrev = ga4 ? ga4.sessionsSeriesPrev : []

  const clicksSeries = gsc ? gsc.clicksSeries : []
  const clicksSeriesPrev = gsc ? gsc.clicksSeriesPrev : []
  const impressionsSeries = gsc ? gsc.impressionsSeries : []
  const impressionsSeriesPrev = gsc ? gsc.impressionsSeriesPrev : []
  const positionSeries = gsc ? gsc.positionSeries : []
  const positionSeriesPrev = gsc ? gsc.positionSeriesPrev : []

  // ─── Tables ───────────────────────────────────────────────────────────────

  const landingPages = ga4 ? ga4.landingPages.slice(0, TOP_LANDING_PAGES) : []
  const queries = gsc ? gsc.queries.slice(0, TOP_QUERIES) : []
  const cities = ga4
    ? [...ga4.cities].sort((a, b) => b.sessions - a.sessions).slice(0, TOP_CITIES)
    : []

  // ─── Donuts ───────────────────────────────────────────────────────────────

  const newVsReturning = ga4 ? ga4.newVsReturning : []
  const devices = ga4 ? ga4.devices : []

  // ─── Assemble ─────────────────────────────────────────────────────────────

  return {
    // Header meta
    clientName: meta.clientName,
    domain: meta.domain,
    periodLabel: meta.periodLabel,
    comparisonLabel: meta.comparisonLabel,
    generatedAt: meta.generatedAt,
    operator: meta.operator,

    // Scorecards
    scorecards,

    // Chart series
    sessionsSeries,
    sessionsSeriesPrev,
    clicksSeries,
    clicksSeriesPrev,
    impressionsSeries,
    impressionsSeriesPrev,
    positionSeries,
    positionSeriesPrev,

    // Tables
    landingPages,
    queries,
    cities,

    // Donuts
    newVsReturning,
    devices,

    // Gaps
    gaps: {
      ga4: !ga4Ok,
      gsc: !gscOk,
      prospects: !prospectsOk,
    },
  }
}
