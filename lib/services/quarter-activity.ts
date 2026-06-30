// lib/services/quarter-activity.ts — derived read-time activity for the quarter grid (B5).
// NO writes anywhere: grid persistence is full-state delete-and-recreate, so any
// server-written assignment column would be clobbered by the next browser PUT.
// Scalar/normalized-table reads only (dashboard read-service invariant).
import { prisma } from '@/lib/db'

export type ActivityKind = 'seo-parse' | 'ada-audit' | 'seo-roadmap' | 'keyword-memo' | 'pillar-analysis'
export type ClientActivity = { latest: { kind: ActivityKind; at: Date }; kinds: Partial<Record<ActivityKind, Date>> }

export async function getQuarterActivity(clientIds: number[], since: Date): Promise<Map<number, ClientActivity>> {
  if (clientIds.length === 0) return new Map()
  const kindsByClient = new Map<number, Partial<Record<ActivityKind, Date>>>()
  const record = (clientId: number | null, kind: ActivityKind, at: Date | null) => {
    if (clientId == null || !at || at < since) return
    const kinds = kindsByClient.get(clientId) ?? {}
    const prev = kinds[kind]
    if (!prev || at > prev) kinds[kind] = at
    kindsByClient.set(clientId, kinds)
  }

  const [runs, roadmaps, memos, pillars] = await Promise.all([
    prisma.crawlRun.findMany({
      where: { clientId: { in: clientIds }, completedAt: { gte: since }, status: { in: ['complete', 'partial'] } },
      select: { clientId: true, tool: true, completedAt: true, session: { select: { workflow: true } } },
    }),
    prisma.seoRoadmap.findMany({
      where: { status: 'complete', roadmapUpdatedAt: { gte: since }, session: { clientId: { in: clientIds } } },
      select: { roadmapUpdatedAt: true, session: { select: { clientId: true } } },
    }),
    prisma.keywordResearchSession.findMany({
      where: { status: 'complete', memoUpdatedAt: { gte: since }, clientId: { in: clientIds } },
      select: { clientId: true, memoUpdatedAt: true },
    }),
    prisma.pillarAnalysis.findMany({
      where: { status: 'complete', session: { clientId: { in: clientIds } } },
      select: { createdAt: true, narrativeUpdatedAt: true, session: { select: { clientId: true } } },
    }),
  ])

  for (const r of runs) {
    // A keyword-research upload produces a seo-parser CrawlRun, but calling it a
    // technical SEO parse would misrepresent the work — the keyword-memo kind
    // covers that work product.
    if (r.tool === 'seo-parser' && r.session?.workflow === 'keyword-research') continue
    record(r.clientId, r.tool === 'ada-audit' ? 'ada-audit' : 'seo-parse', r.completedAt)
  }
  for (const r of roadmaps) record(r.session.clientId, 'seo-roadmap', r.roadmapUpdatedAt)
  for (const m of memos) record(m.clientId, 'keyword-memo', m.memoUpdatedAt)
  for (const p of pillars) record(p.session?.clientId ?? null, 'pillar-analysis', p.narrativeUpdatedAt ?? p.createdAt)

  // Derive latest from kinds at the end — single source of truth.
  const map = new Map<number, ClientActivity>()
  for (const [clientId, kinds] of kindsByClient) {
    let latest: { kind: ActivityKind; at: Date } | null = null
    for (const [kind, at] of Object.entries(kinds) as [ActivityKind, Date][]) {
      if (!latest || at > latest.at) latest = { kind, at }
    }
    if (latest) map.set(clientId, { latest, kinds })
  }
  return map
}

/** Cycle window start for a plan: parsed startDate (local midnight) else createdAt. */
export function activityWindowStart(plan: { startDate: string | null; createdAt: Date }): Date {
  if (plan.startDate) {
    const d = new Date(plan.startDate + 'T00:00:00')
    if (!isNaN(d.getTime())) return d
  }
  return plan.createdAt
}
