// lib/services/client-dashboard.ts
//
// One client's dashboard: header info, three scorecards (scalar-only score
// series + deep link to the latest source run), schedules, and a reverse-chron
// activity timeline built from ORIGIN rows (deep links never dangle; orphaned
// CrawlRuns contribute score points but no timeline rows).

import { prisma } from '@/lib/db'
import {
  buildAdaSeries, buildSeries, buildSeoSeries,
  type AdaSeriesSource, type ScoreSeries,
} from './scorecard-shared'
import { pickCanonicalSeo, type SeoRunRef } from './seo-canonical'

export const TIMELINE_CAP = 50

export type TimelineType =
  | 'seo-parse' | 'keyword-research' | 'site-audit' | 'ada-audit' | 'pillar-analysis' | 'seo-roadmap'

export interface TimelineItem {
  type: TimelineType
  id: string
  title: string
  status: string
  date: string // ISO
  href: string
  stat: string | null
}

export interface ScorecardData {
  series: ScoreSeries
  latestHref: string | null
}

export interface ClientDashboard {
  client: {
    id: number
    name: string
    domains: string[]
    seedUrls: string[]
    teamworkTasklistId: string | null
    archivedAt: string | null
    createdAt: string
  } | null
  seo: ScorecardData
  seoCounts: { totalUrls: number | null; criticalCount: number; warningCount: number; noticeCount: number; at: string } | null
  ada: ScorecardData
  adaSource: AdaSeriesSource
  pillar: ScorecardData
  schedules: { jobType: string; cadence: string; nextRunAt: string }[]
  timeline: TimelineItem[]
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const EMPTY: Omit<ClientDashboard, 'client'> = {
  seo: { series: buildSeries([]), latestHref: null },
  seoCounts: null,
  ada: { series: buildSeries([]), latestHref: null },
  adaSource: null,
  pillar: { series: buildSeries([]), latestHref: null },
  schedules: [],
  timeline: [],
}

// `_now` keeps signature symmetry with getClientFleet; alerts are fleet-only.
export async function getClientDashboard(clientId: number, _now: Date = new Date()): Promise<ClientDashboard> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, domains: true, seedUrls: true, teamworkTasklistId: true, archivedAt: true, createdAt: true },
  })
  if (!client) return { client: null, ...EMPTY }

  const [sessions, siteAudits, standaloneAda, crawlRuns, schedules] = await Promise.all([
    prisma.session.findMany({
      where: { clientId },
      select: {
        id: true, status: true, workflow: true, createdAt: true, siteName: true,
        totalUrls: true, criticalCount: true, warningCount: true, noticeCount: true,
        pillarAnalyses: { select: { id: true, status: true, score: true, createdAt: true } },
        seoRoadmap: { select: { id: true, status: true, createdAt: true } },
      },
    }),
    prisma.siteAudit.findMany({
      where: { clientId },
      select: { id: true, domain: true, status: true, pagesTotal: true, createdAt: true, completedAt: true, scheduleId: true },
    }),
    prisma.adaAudit.findMany({
      where: { clientId, siteAuditId: null },
      select: { id: true, url: true, status: true, score: true, createdAt: true, completedAt: true },
    }),
    prisma.crawlRun.findMany({
      where: { clientId },
      select: {
        id: true, tool: true, source: true, seoIntent: true, score: true, scoreBreakdown: true,
        completedAt: true, createdAt: true, sessionId: true, siteAuditId: true, adaAuditId: true,
      },
    }),
    prisma.schedule.findMany({
      where: { clientId, enabled: true },
      select: { jobType: true, cadence: true, nextRunAt: true },
    }),
  ])

  const keywordSessionIds = new Set(sessions.filter((s) => s.workflow === 'keyword-research').map((s) => s.id))
  // Task 9: Use the canonical selector to include seoIntent live-scan runs when
  // SF is absent/stale; exclude keyword-research sessions (their runs have scores
  // but represent research, not health).
  const seoParserRuns = crawlRuns.filter(
    (r) => r.tool === 'seo-parser' && !(r.sessionId && keywordSessionIds.has(r.sessionId)),
  )
  const canonical = pickCanonicalSeo(seoParserRuns as unknown as SeoRunRef[], _now.getTime())
  const seoSeriesRuns = canonical
    ? seoParserRuns.filter((r) => {
        // Include the canonical run + all sf-upload runs for the full sparkline.
        // A seoIntent live-scan that IS the canonical gets included; non-canonical
        // live-scans (broken-link/on-page) are excluded from the score series.
        if (r.id === canonical.run.id) return true
        return r.source === 'sf-upload'
      })
    : seoParserRuns.filter((r) => r.source === 'sf-upload')
  const seo = buildSeoSeries(
    seoSeriesRuns.map((r) => ({
      score: r.score,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
      sessionId: r.sessionId,
      crawlRunId: r.id,
      source: r.source,
    })),
  )
  const adaResult = buildAdaSeries(crawlRuns.filter((r) => r.tool === 'ada-audit'), standaloneAda)

  const completePillars = sessions
    .flatMap((s) => s.pillarAnalyses)
    .filter((p) => p.status === 'complete' && p.score !== null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const pillar: ScorecardData = {
    series: buildSeries(completePillars.map((p) => ({ date: p.createdAt.toISOString(), score: p.score as number }))),
    latestHref: completePillars.length ? `/pillar-analysis/${completePillars[completePillars.length - 1].id}` : null,
  }

  const latestTechWithCounts = sessions
    .filter((s) => s.workflow === 'technical' && s.status === 'complete' && s.criticalCount !== null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .pop()
  const seoCounts = latestTechWithCounts
    ? {
        totalUrls: latestTechWithCounts.totalUrls,
        criticalCount: latestTechWithCounts.criticalCount as number,
        warningCount: latestTechWithCounts.warningCount ?? 0,
        noticeCount: latestTechWithCounts.noticeCount ?? 0,
        at: latestTechWithCounts.createdAt.toISOString(),
      }
    : null

  const timeline: TimelineItem[] = []
  for (const s of sessions) {
    if (s.workflow === 'keyword-research') {
      timeline.push({
        type: 'keyword-research', id: s.id, title: s.siteName ?? s.id, status: s.status,
        date: s.createdAt.toISOString(), href: `/keyword-research/${s.id}`,
        stat: s.totalUrls !== null ? `${s.totalUrls} URLs` : null,
      })
    } else {
      timeline.push({
        type: 'seo-parse', id: s.id, title: s.siteName ?? s.id, status: s.status,
        date: s.createdAt.toISOString(), href: `/seo-parser/results/${s.id}`,
        stat: s.totalUrls !== null ? `${s.totalUrls} URLs · ${s.criticalCount ?? 0} critical` : null,
      })
    }
    for (const p of s.pillarAnalyses) {
      timeline.push({
        type: 'pillar-analysis', id: p.id, title: s.siteName ?? s.id, status: p.status,
        date: p.createdAt.toISOString(), href: `/pillar-analysis/${p.id}`,
        stat: p.score !== null ? `Score ${p.score}/10` : null,
      })
    }
    if (s.seoRoadmap) {
      timeline.push({
        type: 'seo-roadmap', id: s.seoRoadmap.id, title: s.siteName ?? s.id, status: s.seoRoadmap.status,
        date: s.seoRoadmap.createdAt.toISOString(), href: `/seo-parser/results/${s.id}`, stat: null,
      })
    }
  }
  for (const a of siteAudits) {
    timeline.push({
      // C2: schedule-originated audits are tagged in the timeline title.
      type: 'site-audit', id: a.id, title: a.scheduleId ? `${a.domain} · scheduled` : a.domain, status: a.status,
      date: a.createdAt.toISOString(), href: `/ada-audit/site/${a.id}`,
      stat: a.pagesTotal > 0 ? `${a.pagesTotal} pages` : null,
    })
  }
  // Standalone AdaAudit.score is rarely persisted (the completion path doesn't
  // set it) — prefer the A2 CrawlRun score, fall back to the legacy column.
  const pageRunScores = new Map(
    crawlRuns
      .filter((r) => r.tool === 'ada-audit' && r.source === 'page-audit' && r.adaAuditId && r.score !== null)
      .map((r) => [r.adaAuditId as string, r.score as number]),
  )
  for (const a of standaloneAda) {
    const score = pageRunScores.get(a.id) ?? a.score
    timeline.push({
      type: 'ada-audit', id: a.id, title: a.url, status: a.status,
      date: a.createdAt.toISOString(), href: `/ada-audit/${a.id}`,
      stat: score !== null ? `Score ${score}` : null,
    })
  }
  timeline.sort((a, b) => b.date.localeCompare(a.date))

  return {
    client: {
      id: client.id,
      name: client.name,
      domains: parseJsonArray(client.domains),
      seedUrls: parseJsonArray(client.seedUrls),
      teamworkTasklistId: client.teamworkTasklistId,
      archivedAt: client.archivedAt?.toISOString() ?? null,
      createdAt: client.createdAt.toISOString(),
    },
    seo,
    seoCounts,
    ada: { series: adaResult.series, latestHref: adaResult.latestHref },
    adaSource: adaResult.source,
    pillar,
    schedules: schedules.map((s) => ({ jobType: s.jobType, cadence: s.cadence, nextRunAt: s.nextRunAt.toISOString() })),
    timeline: timeline.slice(0, TIMELINE_CAP),
  }
}
