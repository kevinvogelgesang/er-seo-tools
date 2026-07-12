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
import { publishInvalidation } from '@/lib/events/bus'
import { auditBatchTopic, queueTopic } from '@/lib/events/topics'

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
    // A5: a brand-new open batch changed the batch header + the queue view.
    // Emit only on an ACTUAL create (this try branch); the P2002-loser path
    // below re-reads a batch another caller created (which already emitted).
    publishInvalidation(auditBatchTopic(created.id))
    publishInvalidation(queueTopic())
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
  const closed = await prisma.$executeRaw`
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
  // A5: emit only when THIS call actually closed the batch (affected count > 0)
  // — a no-op close (already closed / still has in-flight members) emits nothing.
  if (closed > 0) {
    publishInvalidation(auditBatchTopic(batchId))
    publishInvalidation(queueTopic())
  }
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

/**
 * Returns the stored custom label if one is set, otherwise null (indicating
 * the client should render an auto-label in its own timezone).
 * Mirrors the custom-label detection in resolveBatchLabel:
 *   `batch.label && batch.label.trim()` → truthy means a custom label exists.
 */
export function customLabelOrNull(batch: { label: string | null }): string | null {
  return batch.label?.trim() ? batch.label : null
}

/**
 * Summarises the operators (requestedBy values) across a batch's site audits.
 * Returns the leading operator by frequency; on a tie, named operators sort
 * alphabetically and 'unknown' (null/blank) sorts last. Appends "+N" when
 * multiple distinct operators are present.
 */
export function summarizeOperators(siteAudits: { requestedBy: string | null }[]): string {
  const counts = new Map<string, number>()
  for (const s of siteAudits) {
    const name = s.requestedBy?.trim() || 'unknown'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    if (a[0] === 'unknown') return 1
    if (b[0] === 'unknown') return -1
    return a[0].localeCompare(b[0])
  })
  if (sorted.length === 0) return 'unknown'
  if (sorted.length === 1) return sorted[0][0]
  return `${sorted[0][0]} +${sorted.length - 1}`
}
