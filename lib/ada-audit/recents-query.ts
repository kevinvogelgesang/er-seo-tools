import { prisma } from '@/lib/db'
import { computeScore, computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import type { AxeViolation } from '@/lib/ada-audit/types'

export type RecentItem =
  | {
      type: 'page'
      id: string
      createdAt: string
      url: string
      status: string
      score: number | null
      startedAt: string | null
      completedAt: string | null
      clientName: string | null
      requestedBy: string | null
    }
  | {
      type: 'site'
      id: string
      createdAt: string
      domain: string
      status: string
      score: number | null
      startedAt: string | null
      completedAt: string | null
      clientName: string | null
      requestedBy: string | null
    }

function pageScore(status: string, result: string | null, wcagLevel: string): number | null {
  if (status !== 'complete' || !result) return null
  try {
    const parsed = JSON.parse(result) as { violations?: AxeViolation[] }
    const { score } = computeScore(parsed.violations ?? [], wcagLevel)
    return Number.isFinite(score) ? score : null
  } catch { return null }
}

function siteScore(status: string, summary: string | null, wcagLevel: string): number | null {
  if (status !== 'complete' || !summary) return null
  try {
    const parsed = JSON.parse(summary) as { aggregate?: unknown } | null
    if (!parsed?.aggregate) return null
    const { score } = computeScoreFromCounts(parsed.aggregate as never, wcagLevel)
    return Number.isFinite(score) ? score : null
  } catch { return null }
}

export async function fetchAllRecents(limit = 100, operator?: string): Promise<RecentItem[]> {
  const pageWhere = operator ? { requestedBy: operator, siteAuditId: null } : { siteAuditId: null }
  const siteWhere = operator ? { requestedBy: operator } : {}
  const [pages, sites] = await Promise.all([
    prisma.adaAudit.findMany({
      where: pageWhere, orderBy: { createdAt: 'desc' }, take: limit,
      select: {
        id: true, createdAt: true, url: true, status: true, wcagLevel: true,
        result: true, startedAt: true, completedAt: true, requestedBy: true,
        client: { select: { name: true } },
      },
    }),
    prisma.siteAudit.findMany({
      where: siteWhere, orderBy: { createdAt: 'desc' }, take: limit,
      select: {
        id: true, createdAt: true, domain: true, status: true, wcagLevel: true,
        summary: true, startedAt: true, completedAt: true, requestedBy: true,
        client: { select: { name: true } },
      },
    }),
  ])

  const items: RecentItem[] = [
    ...pages.map((p): RecentItem => ({
      type: 'page', id: p.id, createdAt: p.createdAt.toISOString(), url: p.url,
      status: p.status, score: pageScore(p.status, p.result, p.wcagLevel),
      startedAt: p.startedAt?.toISOString() ?? null,
      completedAt: p.completedAt?.toISOString() ?? null,
      clientName: p.client?.name ?? null, requestedBy: p.requestedBy,
    })),
    ...sites.map((s): RecentItem => ({
      type: 'site', id: s.id, createdAt: s.createdAt.toISOString(), domain: s.domain,
      status: s.status, score: siteScore(s.status, s.summary, s.wcagLevel),
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      clientName: s.client?.name ?? null, requestedBy: s.requestedBy,
    })),
  ]
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return items.slice(0, limit)
}

export async function fetchRecentsForOperator(
  operator: string,
  limit: number = 100,
): Promise<RecentItem[]> {
  return fetchAllRecents(limit, operator)
}
