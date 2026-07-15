// lib/ada-audit/queue-order.ts
//
// ONE home for the site-audit queue's total ordering (PR3, Codex fix 1):
//
//   prospect-owned first, then createdAt ASC, then id ASC.
//
// Reused by ALL FOUR readers — processNext()'s selection, getQueueStatus()'s
// queued list, listProspects()'s queuePosition, and GET /api/site-audit/[id]'s
// queue-position count. Never re-derive this ordering inline anywhere else.
//
// Lives outside queue-manager.ts on purpose: listProspects and the site-audit
// detail route need it, and queue-manager's static import graph pulls the
// finalizer → findings → broken-link-verify handler chain. This module
// imports ONLY the Prisma client.
//
// Job.priority companion (Codex fix 2): selection order alone cannot win when
// an older non-prospect discover job is ALREADY enqueued but unclaimed (both
// audits still queued, two discover jobs pending — the worker would claim the
// older one first). Prospect discover jobs are enqueued with
// PROSPECT_DISCOVER_PRIORITY; the worker claims by
// [{priority:'desc'},{createdAt:'asc'}] (lib/jobs/worker.ts claimNext).
// No preemption — priority only affects which UNCLAIMED job is picked.

import { prisma } from '@/lib/db'

/** Job.priority for a prospect-owned audit's site-audit-discover job. Everything else stays at the default 0. */
export const PROSPECT_DISCOVER_PRIORITY = 1

export interface QueueOrderKey {
  id: string
  createdAt: Date
  prospectId: number | null
}

/** Pure comparator implementing the shared total ordering (used to JS-sort small queued lists). */
export function compareQueuedAudits(a: QueueOrderKey, b: QueueOrderKey): number {
  const aProspect = a.prospectId !== null
  const bProspect = b.prospectId !== null
  if (aProspect !== bProspect) return aProspect ? -1 : 1
  const t = a.createdAt.getTime() - b.createdAt.getTime()
  if (t !== 0) return t
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The promoter's pick under the shared ordering: first queued prospect-owned
 * audit (FIFO among prospects), else the oldest queued audit. Two cheap
 * findFirsts against the status index — the queued set is tiny, and Prisma
 * cannot express "non-null first, then createdAt" in one orderBy without
 * value-ordering by prospectId (which would break prospect FIFO).
 */
export async function findNextQueuedAudit(): Promise<{ id: string; prospectId: number | null } | null> {
  const prospectNext = await prisma.siteAudit.findFirst({
    where: { status: 'queued', prospectId: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, prospectId: true },
  })
  if (prospectNext) return prospectNext
  return prisma.siteAudit.findFirst({
    where: { status: 'queued' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, prospectId: true },
  })
}

/**
 * How many queued audits rank AHEAD of `audit` under the shared ordering.
 * Position = queuedAheadCount(audit) + 1. `audit` itself must be queued.
 */
export async function queuedAheadCount(audit: QueueOrderKey): Promise<number> {
  const earlier = {
    OR: [
      { createdAt: { lt: audit.createdAt } },
      { createdAt: audit.createdAt, id: { lt: audit.id } },
    ],
  }
  if (audit.prospectId !== null) {
    // Only earlier prospect-owned audits rank ahead of a prospect-owned one.
    return prisma.siteAudit.count({
      where: { status: 'queued', prospectId: { not: null }, ...earlier },
    })
  }
  // ALL queued prospect-owned audits + earlier non-prospect ones rank ahead.
  const [prospectQueued, earlierNonProspect] = await Promise.all([
    prisma.siteAudit.count({ where: { status: 'queued', prospectId: { not: null } } }),
    prisma.siteAudit.count({ where: { status: 'queued', prospectId: null, ...earlier } }),
  ])
  return prospectQueued + earlierNonProspect
}
