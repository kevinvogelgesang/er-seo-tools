import { prisma } from '@/lib/db'

export type RecentItem =
  | {
      type: 'page'
      id: string
      createdAt: Date
      url: string
      status: string
      score: number | null
      startedAt: Date | null
      completedAt: Date | null
      clientName: string | null
      requestedBy: string | null
    }
  | {
      type: 'site'
      id: string
      createdAt: Date
      domain: string
      status: string
      score: number | null
      startedAt: Date | null
      completedAt: Date | null
      clientName: string | null
      requestedBy: string | null
    }

export async function fetchRecentsForOperator(
  operator: string,
  limit: number = 100,
): Promise<RecentItem[]> {
  const [pages, sites] = await Promise.all([
    prisma.adaAudit.findMany({
      where: { requestedBy: operator, siteAuditId: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { client: { select: { name: true } } },
    }),
    prisma.siteAudit.findMany({
      where: { requestedBy: operator },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { client: { select: { name: true } } },
    }),
  ])

  const items: RecentItem[] = [
    ...pages.map((p): RecentItem => ({
      type: 'page',
      id: p.id,
      createdAt: p.createdAt,
      url: p.url,
      status: p.status,
      score: p.score,
      startedAt: p.startedAt,
      completedAt: p.completedAt,
      clientName: p.client?.name ?? null,
      requestedBy: p.requestedBy,
    })),
    ...sites.map((s): RecentItem => ({
      type: 'site',
      id: s.id,
      createdAt: s.createdAt,
      domain: s.domain,
      status: s.status,
      score: s.score,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      clientName: s.client?.name ?? null,
      requestedBy: s.requestedBy,
    })),
  ]
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return items.slice(0, limit)
}
