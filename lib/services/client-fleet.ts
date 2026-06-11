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
import { collapseTypeGroups, newCriticalTypes, selectRuns, type TypeAggregate } from './findings-shared'

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
  /** Distinct open critical/warning issue types across both tools' current
   *  runs; null when the client has no current findings-bearing runs. */
  openCritical: number | null
  openWarning: number | null
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
    prisma.client.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, domains: true } }),
    prisma.session.findMany({
      where: { clientId: { not: null } },
      select: { id: true, clientId: true, status: true, workflow: true, createdAt: true },
    }),
    prisma.crawlRun.findMany({
      where: { clientId: { not: null } },
      select: {
        id: true, clientId: true, tool: true, source: true, domain: true, score: true,
        completedAt: true, createdAt: true, sessionId: true, siteAuditId: true, adaAuditId: true,
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

  // B2: current+previous run selection per client, then type-level aggregates
  // for Issues counts and regression alerts. Type-level only — no URLs.
  const selByClient = new Map(
    clients.map((c) => [
      c.id,
      selectRuns(crawlRuns.filter((r) => r.clientId === c.id), keywordSessionIds),
    ]),
  )
  const seoRunIds: string[] = []
  const adaRunIds: string[] = []
  for (const sel of selByClient.values()) {
    for (const r of [sel.seo.current, sel.seo.previous]) if (r) seoRunIds.push(r.id)
    for (const r of [sel.ada.current, sel.ada.previous]) if (r) adaRunIds.push(r.id)
  }
  const [seoTypeRows, adaTypeGroups] = await Promise.all([
    seoRunIds.length
      ? prisma.finding.findMany({
          where: { runId: { in: seoRunIds }, scope: 'run' },
          select: { runId: true, type: true, severity: true, count: true },
        })
      : Promise.resolve([]),
    adaRunIds.length
      ? prisma.finding.groupBy({
          by: ['runId', 'type', 'severity'],
          // scope guard (Codex plan-fix #1): see client-findings.ts.
          where: { runId: { in: adaRunIds }, scope: 'page' },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ])
  // Collapse ADA to ONE aggregate per (runId, type), max severity (Codex fix #3).
  const aggByRun = new Map<string, TypeAggregate[]>()
  for (const id of seoRunIds) {
    aggByRun.set(id, collapseTypeGroups(seoTypeRows.filter((f) => f.runId === id)))
  }
  for (const id of adaRunIds) {
    aggByRun.set(
      id,
      collapseTypeGroups(
        adaTypeGroups.filter((g) => g.runId === id).map((g) => ({ type: g.type, severity: g.severity, count: g._count._all })),
      ),
    )
  }

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

    const sel = selByClient.get(c.id)!
    const currentAggs = [
      ...(sel.seo.current ? aggByRun.get(sel.seo.current.id) ?? [] : []),
      ...(sel.ada.current ? aggByRun.get(sel.ada.current.id) ?? [] : []),
    ]
    const hasFindingsRuns = sel.seo.current !== null || sel.ada.current !== null
    const openCritical = hasFindingsRuns ? currentAggs.filter((a) => a.severity === 'critical').length : null
    const openWarning = hasFindingsRuns ? currentAggs.filter((a) => a.severity === 'warning').length : null
    const regressionTypes = [
      ...newCriticalTypes(
        sel.seo.current ? aggByRun.get(sel.seo.current.id) ?? [] : [],
        sel.seo.previous ? new Set((aggByRun.get(sel.seo.previous.id) ?? []).map((a) => a.type)) : null,
      ),
      ...newCriticalTypes(
        sel.ada.current ? aggByRun.get(sel.ada.current.id) ?? [] : [],
        sel.ada.previous ? new Set((aggByRun.get(sel.ada.previous.id) ?? []).map((a) => a.type)) : null,
      ),
    ]

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
      alerts: computeAlerts({ seo, ada, erroredTools, newCriticalTypes: regressionTypes, lastActivityAt, now }),
      openCritical,
      openWarning,
    }
  })
}
