// lib/services/scorecard-shared.ts
//
// Pure helpers shared by the client fleet and client dashboard services.
// Everything here is scalar-sourced (CrawlRun.score, legacy AdaAudit.score,
// PillarAnalysis.score, Session issue counts) — NEVER blob-derived. Adding a
// blob reader here would block the A2 PRUNE_ACTIVATED flips.

export const SPARKLINE_POINTS = 12
export const SCORE_DROP_THRESHOLD = 10
export const STALE_DAYS = 30

export interface ScorePoint {
  date: string // ISO
  score: number
}

export interface ScoreSeries {
  latest: number | null
  previous: number | null
  /** latest - previous; null when fewer than 2 points. */
  delta: number | null
  latestAt: string | null
  /** Ascending by date, capped at SPARKLINE_POINTS (most recent kept). */
  points: ScorePoint[]
}

export const EMPTY_SERIES: ScoreSeries = { latest: null, previous: null, delta: null, latestAt: null, points: [] }

export function buildSeries(points: ScorePoint[]): ScoreSeries {
  if (points.length === 0) return EMPTY_SERIES
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted[sorted.length - 1]
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : null
  return {
    latest: latest.score,
    previous: previous ? previous.score : null,
    delta: previous ? latest.score - previous.score : null,
    latestAt: latest.date,
    points: sorted.slice(-SPARKLINE_POINTS),
  }
}

function pointDate(completedAt: Date | null, createdAt: Date): string {
  return (completedAt ?? createdAt).toISOString()
}

export interface SeoRunRow {
  score: number | null
  completedAt: Date | null
  createdAt: Date
  sessionId: string | null
  /** Present for runs that come from a CrawlRun (as opposed to a legacy Session row). */
  crawlRunId?: string | null
  /** 'sf-upload' | 'live-scan' | undefined — used to build the correct href. */
  source?: string | null
}

/** Resolve the deep-link href for a SEO sparkline / scorecard point.
 *  Live-scan runs link to /seo-parser/results/run/<crawlRunId>;
 *  sf-upload runs link to /seo-parser/results/<sessionId> (or null if orphaned). */
function seoHref(r: SeoRunRow): string | null {
  if (r.source === 'live-scan' && r.crawlRunId) return `/seo-parser/results/run/${r.crawlRunId}`
  return r.sessionId ? `/seo-parser/results/${r.sessionId}` : null
}

export function buildSeoSeries(runs: SeoRunRow[]): { series: ScoreSeries; latestHref: string | null } {
  const scored = runs
    .filter((r): r is SeoRunRow & { score: number } => r.score !== null)
    .map((r) => ({ date: pointDate(r.completedAt, r.createdAt), score: r.score, href: seoHref(r) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return {
    series: buildSeries(scored),
    latestHref: scored.length ? scored[scored.length - 1].href : null,
  }
}

export interface AdaRunRow {
  source: string // 'site-audit' | 'page-audit'
  score: number | null
  completedAt: Date | null
  createdAt: Date
  siteAuditId: string | null
  adaAuditId: string | null
}

export interface LegacyAdaRow {
  id: string
  status: string
  score: number | null
  completedAt: Date | null
  createdAt: Date
}

export type AdaSeriesSource = 'site' | 'page' | null

/**
 * ADA series rule (spec): site-audit CrawlRuns when any SCORED site point
 * exists; otherwise page-audit CrawlRuns merged with non-null legacy
 * AdaAudit.score points, deduped by origin id (CrawlRun point wins).
 * Never mixed.
 */
export function buildAdaSeries(
  runs: AdaRunRow[],
  legacy: LegacyAdaRow[],
): { series: ScoreSeries; source: AdaSeriesSource; latestHref: string | null } {
  const sitePoints = runs
    .filter((r): r is AdaRunRow & { score: number } => r.source === 'site-audit' && r.score !== null)
    .map((r) => ({ date: pointDate(r.completedAt, r.createdAt), score: r.score, href: r.siteAuditId ? `/ada-audit/site/${r.siteAuditId}` : null }))
  if (sitePoints.length) {
    const sorted = sitePoints.sort((a, b) => a.date.localeCompare(b.date))
    return { series: buildSeries(sorted), source: 'site', latestHref: sorted[sorted.length - 1].href }
  }

  const pageRuns = runs.filter((r): r is AdaRunRow & { score: number } => r.source === 'page-audit' && r.score !== null)
  const covered = new Set(pageRuns.map((r) => r.adaAuditId).filter(Boolean))
  const pagePoints = [
    ...pageRuns.map((r) => ({ date: pointDate(r.completedAt, r.createdAt), score: r.score, href: r.adaAuditId ? `/ada-audit/${r.adaAuditId}` : null })),
    ...legacy
      .filter((l): l is LegacyAdaRow & { score: number } => l.status === 'complete' && l.score !== null && !covered.has(l.id))
      .map((l) => ({ date: pointDate(l.completedAt, l.createdAt), score: l.score, href: `/ada-audit/${l.id}` })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  if (pagePoints.length) {
    return { series: buildSeries(pagePoints), source: 'page', latestHref: pagePoints[pagePoints.length - 1].href }
  }
  return { series: EMPTY_SERIES, source: null, latestHref: null }
}

export function latestRunStatus(rows: { createdAt: Date; status: string }[]): string | null {
  if (rows.length === 0) return null
  let latest = rows[0]
  for (const r of rows) if (r.createdAt.getTime() > latest.createdAt.getTime()) latest = r
  return latest.status
}

export function maxIso(dates: (string | null)[]): string | null {
  let max: string | null = null
  for (const d of dates) if (d !== null && (max === null || d > max)) max = d
  return max
}

export type AlertKind = 'score-drop' | 'error' | 'stale' | 'regression'
export interface ClientAlert { kind: AlertKind; detail: string }

export function computeAlerts(args: {
  seo: ScoreSeries
  ada: ScoreSeries
  /** Tools whose most recent run (any status, from ORIGIN rows — never CrawlRun) errored. */
  erroredTools: string[]
  /** Critical issue types present in a current run but absent from that
   *  tool's previous comparable run (B2). Empty when no previous run. */
  newCriticalTypes: string[]
  /** ISO date of the most recent completed run / pillar analysis. */
  lastActivityAt: string | null
  now: Date
}): ClientAlert[] {
  const alerts: ClientAlert[] = []
  for (const tool of args.erroredTools) alerts.push({ kind: 'error', detail: `${tool}: latest run failed` })
  if (args.newCriticalTypes.length > 0) {
    const n = args.newCriticalTypes.length
    alerts.push({ kind: 'regression', detail: `${n} new critical issue type${n === 1 ? '' : 's'}` })
  }
  if (args.seo.delta !== null && args.seo.delta <= -SCORE_DROP_THRESHOLD) {
    alerts.push({ kind: 'score-drop', detail: `SEO score dropped ${Math.abs(args.seo.delta)}` })
  }
  if (args.ada.delta !== null && args.ada.delta <= -SCORE_DROP_THRESHOLD) {
    alerts.push({ kind: 'score-drop', detail: `ADA score dropped ${Math.abs(args.ada.delta)}` })
  }
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000
  if (args.lastActivityAt === null || args.now.getTime() - new Date(args.lastActivityAt).getTime() > staleMs) {
    alerts.push({ kind: 'stale', detail: `no completed activity in ${STALE_DAYS}+ days` })
  }
  return alerts
}
