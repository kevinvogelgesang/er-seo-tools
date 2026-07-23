import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/** Prisma statements that callers can compose into the repo's array-form transactions. */
export function appendActivityStatements(
  viewbookId: number,
  kind: string,
  actor: string,
  actorKind: string,
  summary: string,
): Prisma.PrismaPromise<unknown>[] {
  return [prisma.viewbookActivity.create({ data: { viewbookId, kind, actor, actorKind, summary } })]
}

export async function listActivity(viewbookId: number, cursor?: number, limit = DEFAULT_LIMIT) {
  const take = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)))
  const rows = await prisma.viewbookActivity.findMany({
    where: { viewbookId, ...(cursor ? { id: { lt: cursor } } : {}) },
    orderBy: { id: 'desc' },
    take: take + 1,
  })
  const hasMore = rows.length > take
  const items = hasMore ? rows.slice(0, take) : rows
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
}
