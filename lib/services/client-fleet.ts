// lib/services/client-fleet.ts
//
// Fleet view: every client × latest scores × alerts, from scalar columns only.
// Fixed query count (6 findMany, batched) — aggregation happens in JS.
// ~30 clients × a few hundred rows total; well inside SQLite comfort.

import { prisma } from '@/lib/db'
import {
  buildAdaSeries, buildSeoSeries, computeAlerts, latestRunStatus, maxIso,
  type AdaSeriesSource, type ClientAlert, type ScoreSeries,
} from './scorecard-shared'

export interface FleetRow {
  id: number
  name: string
  firstDomain: string | null
  seo: ScoreSeries
  ada: ScoreSeries
  adaSource: AdaSeriesSource
  pillarScore: number | null
  pillarAt: string | null
  lastActivityAt: string | null
  alerts: ClientAlert[]
}

function parseFirstDomain(domains: string): string | null {
  try {
    const arr = JSON.parse(domains)
    return Array.isArray(arr) && typeof arr[0] === 'string' ? arr[0] : null
  } catch {
    return null
  }
}

export async function getClientFleet(now: Date = new Date()): Promise<FleetRow[]> {
  const [clients, sessions, crawlRuns, standaloneAda, siteAudits, pillars] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, domains: true } }),
    prisma.session.findMany({
      where: { clientId: { not: null } },
      select: { id: true, clientId: true, status: true, workflow: true, createdAt: true },
    }),
    prisma.crawlRun.findMany({
      where: { clientId: { not: null } },
      select: {
        clientId: true, tool: true, source: true, score: true, completedAt: true,
        createdAt: true, sessionId: true, siteAuditId: true, adaAuditId: true,
      },
    }),
    prisma.adaAudit.findMany({
      where: { clientId: { not: null }, siteAuditId: null },
      select: { id: true, clientId: true, status: true, score: true, completedAt: true, createdAt: true },
    }),
    prisma.siteAudit.findMany({
      where: { clientId: { not: null } },
      select: { clientId: true, status: true, completedAt: true, createdAt: true },
    }),
    prisma.pillarAnalysis.findMany({
      where: { session: { clientId: { not: null } } },
      select: { score: true, status: true, createdAt: true, session: { select: { clientId: true } } },
    }),
  ])

  // Keyword-research sessions get CrawlRuns too (the dual-write runs for all
  // workflows) — they must not pollute the SEO health series. Accepted gap
  // (spec): once a keyword session EXPIRES, its orphaned run (sessionId null)
  // is indistinguishable from an orphaned technical run and joins the series;
  // CrawlRun has no workflow column and orphan technical points matter more.
  const keywordSessionIds = new Set(sessions.filter((s) => s.workflow === 'keyword-research').map((s) => s.id))

  return clients.map((c) => {
    const mySessions = sessions.filter((s) => s.clientId === c.id)
    const myRuns = crawlRuns.filter((r) => r.clientId === c.id)
    const myAda = standaloneAda.filter((a) => a.clientId === c.id)
    const mySiteAudits = siteAudits.filter((a) => a.clientId === c.id)
    const myPillars = pillars.filter((p) => p.session?.clientId === c.id)

    const { series: seo } = buildSeoSeries(
      myRuns.filter((r) => r.tool === 'seo-parser' && !(r.sessionId && keywordSessionIds.has(r.sessionId))),
    )
    const { series: ada, source: adaSource } = buildAdaSeries(
      myRuns.filter((r) => r.tool === 'ada-audit'),
      myAda,
    )

    const completePillars = myPillars
      .filter((p) => p.status === 'complete' && p.score !== null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const latestPillar = completePillars.length ? completePillars[completePillars.length - 1] : null

    // Staleness = completed runs + pillar analyses (spec: memo/roadmap
    // generation is session-attached; sessions are the activity proxy).
    const lastActivityAt = maxIso([
      ...mySessions.filter((s) => s.status === 'complete').map((s) => s.createdAt.toISOString()),
      ...mySiteAudits.filter((a) => a.status === 'complete').map((a) => (a.completedAt ?? a.createdAt).toISOString()),
      ...myAda.filter((a) => a.status === 'complete').map((a) => (a.completedAt ?? a.createdAt).toISOString()),
      ...completePillars.map((p) => p.createdAt.toISOString()),
    ])

    const erroredTools: string[] = []
    if (latestRunStatus(mySessions.filter((s) => s.workflow === 'technical')) === 'error') erroredTools.push('SEO parse')
    if (latestRunStatus(mySessions.filter((s) => s.workflow === 'keyword-research')) === 'error') erroredTools.push('keyword research')
    if (latestRunStatus(mySiteAudits) === 'error') erroredTools.push('site audit')
    if (latestRunStatus(myAda) === 'error') erroredTools.push('ADA audit')
    if (latestRunStatus(myPillars) === 'error') erroredTools.push('pillar analysis')

    return {
      id: c.id,
      name: c.name,
      firstDomain: parseFirstDomain(c.domains),
      seo,
      ada,
      adaSource,
      pillarScore: latestPillar ? latestPillar.score : null,
      pillarAt: latestPillar ? latestPillar.createdAt.toISOString() : null,
      lastActivityAt,
      alerts: computeAlerts({ seo, ada, erroredTools, lastActivityAt, now }),
    }
  })
}
