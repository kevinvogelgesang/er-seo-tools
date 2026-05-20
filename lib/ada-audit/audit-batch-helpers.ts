// lib/ada-audit/audit-batch-helpers.ts
//
// Helpers for the AuditBatch lifecycle. The key invariant — "at most one open
// batch" — is enforced by a SQLite partial unique index on
// AuditBatch(closedAt IS NULL). This module owns three operations:
//
//  - ensureOpenBatch(): get the open batch id, creating one if none exists.
//    Race-safe via P2002 retry.
//  - closeBatchIfDrained(batchId): flip the batch to closed when no member
//    is still in flight. Idempotent.
//  - resolveBatchLabel(batch): turn the optional label column into a display
//    string (auto-generates from startedAt when label is null).

import { prisma } from '@/lib/db'

/** Statuses that count as "in flight" — a batch with any such member stays open. */
const IN_FLIGHT_STATUSES = ['queued', 'pending', 'running', 'pdfs-running', 'lighthouse-running']

interface BatchForLabel {
  id: string
  startedAt: Date
  closedAt: Date | null
  label: string | null
}

/**
 * Returns the id of the currently open AuditBatch, creating a new one if
 * none exists. Race-safe: if two callers observe "no open batch" simultaneously,
 * the partial unique index `audit_batches_one_open` causes one create() to
 * succeed; the loser catches P2002 and re-reads.
 */
export async function ensureOpenBatch(): Promise<string> {
  const existing = await prisma.auditBatch.findFirst({
    where: { closedAt: null },
    select: { id: true },
  })
  if (existing) return existing.id

  try {
    const created = await prisma.auditBatch.create({ data: {} })
    return created.id
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code !== 'P2002') throw err
    const after = await prisma.auditBatch.findFirst({
      where: { closedAt: null },
      select: { id: true },
    })
    if (!after) throw err  // pathological — P2002 but no open batch visible
    return after.id
  }
}

/**
 * If the batch has no in-flight members and is currently open, mark it closed.
 * No-op when batchId is null, the batch doesn't exist, the batch is already
 * closed, or at least one member is still in flight.
 *
 * The drain-check and close are a single atomic UPDATE with a correlated
 * NOT EXISTS subquery. The earlier two-statement approach (count → update)
 * had a race: a concurrent enqueueAudit could observe the still-open batch,
 * decide to attach a new SiteAudit to it, AFTER we had counted zero in-flight
 * but BEFORE we set closedAt. The conditional UPDATE rejects the close if any
 * in-flight member exists at write time, including ones that landed during
 * our own execution. Paired with `enqueueAudit`'s post-create verification,
 * this closes the race in both directions.
 */
export async function closeBatchIfDrained(batchId: string | null | undefined): Promise<void> {
  if (!batchId) return

  // SQLite-compatible: parameterized $executeRaw. Prisma's updateMany doesn't
  // support correlated subqueries, so we drop to raw. Returns 0 when nothing
  // matched (already closed, or has in-flight members).
  await prisma.$executeRaw`
    UPDATE "AuditBatch"
    SET "closedAt" = ${new Date()}
    WHERE "id" = ${batchId}
      AND "closedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "SiteAudit"
        WHERE "SiteAudit"."batchId" = ${batchId}
          AND "SiteAudit"."status" IN ('queued', 'pending', 'running', 'pdfs-running', 'lighthouse-running')
      )
  `
}

/**
 * Resolve a batch's display label. Returns the stored label if set, otherwise
 * an auto-generated string of the form "Batch — May 13, 2026 7:15 PM".
 */
export function resolveBatchLabel(batch: BatchForLabel): string {
  if (batch.label && batch.label.trim()) return batch.label.trim()
  const formatted = batch.startedAt.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
  return `Batch — ${formatted}`
}
