// lib/jobs/handlers/psi.ts
//
// Durable-queue PSI handler. lib/ada-audit/lighthouse-queue.ts is the
// enqueue facade; this module owns execution. The legacy in-memory pool
// was deleted after production parity (2026-06-10).
//
// Idempotency: the conditional claim on AdaAudit.status='axe-complete' makes
// re-runs (crash recovery, zombie attempts) no-ops — same pattern as legacy.
//
// Error semantics:
// - PSI fetch failure (returned error or throw) is a DOMAIN result: recorded
//   as lighthouseError, row completes, job completes. No job retry.
// - The AdaAudit settle + SiteAudit counter bump run in ONE short
//   transaction (no network work inside) — the legacy split is the wedge
//   where the row flips but the counter doesn't, and a retry no-ops forever.
// - DB failures THROW → the queue retries (covers transient SQLITE_BUSY).
//   Legacy warned-and-returned, wedging the audit until stale reset.
// - finalizeSiteAudit failure after the transaction committed
//   warns-and-continues: a retried handler would match 0 rows on the claim
//   and never finalize, so retrying would make things worse. Another
//   settling job or stale recovery picks it up — same exposure as legacy.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { runPageSpeedInsights } from '@/lib/ada-audit/lighthouse-pagespeed'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import type { PsiJob } from '@/lib/ada-audit/lighthouse-queue'
import { parsePositiveInt } from '../config'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'
import { publishInvalidation } from '@/lib/events/bus'
import { queueTopic, siteAuditTopic } from '@/lib/events/topics'

export const PSI_JOB_TYPE = 'psi'

function assertPsiPayload(payload: unknown): PsiJob {
  const p = payload as Partial<PsiJob> | null
  if (!p || typeof p.adaAuditId !== 'string' || typeof p.siteAuditId !== 'string' || typeof p.url !== 'string') {
    throw new Error('Invalid psi job payload')
  }
  return p as PsiJob
}

/**
 * Atomically claim the axe-complete AdaAudit row, write the LH outcome, and
 * bump the matching SiteAudit counter. Returns false when the row was
 * already terminal (recovery beat us / idempotent re-run). On true, the
 * caller must invoke finalizeSiteAudit (outside the transaction).
 *
 * MUST stay an ARRAY-FORM transaction — never the interactive
 * $transaction(async tx => ...) form. Interactive transactions hold SQLite's
 * write lock across event-loop round-trips; concurrent pdfjs parsing starves
 * the loop, the lock outlives busy_timeout, and every other writer times out
 * (production incident 2026-06-10). Array form executes BEGIN..COMMIT
 * engine-side with no JS in between. The counter bump is therefore expressed
 * in SQL: it fires IFF the row is still claimable (EXISTS over the pre-flip
 * state, same snapshot as the flip), and sets updatedAt manually (raw SQL
 * bypasses Prisma's @updatedAt; storage is integer ms in SQLite).
 */
async function settlePsiOutcome(
  job: PsiJob,
  data: { lighthouseSummary: string | null; lighthouseError: string | null },
): Promise<boolean> {
  const counter = data.lighthouseSummary !== null ? 'lighthouseComplete' : 'lighthouseError'
  const [, flipped] = await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "SiteAudit"
      SET ${Prisma.raw(`"${counter}" = "${counter}" + 1`)}, "updatedAt" = ${Date.now()}
      WHERE "id" = ${job.siteAuditId}
        AND EXISTS (SELECT 1 FROM "AdaAudit" WHERE "id" = ${job.adaAuditId} AND "status" = 'axe-complete')`,
    prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: 'axe-complete' },
      data: {
        status: 'complete',
        lighthouseSummary: data.lighthouseSummary,
        lighthouseError: data.lighthouseError,
        completedAt: new Date(),
      },
    }),
  ])
  return flipped.count === 1
}

export async function runPsiJob(payload: unknown): Promise<void> {
  const job = assertPsiPayload(payload)

  let lighthouseSummary: string | null = null
  let lighthouseError: string | null = null
  try {
    const result = await runPageSpeedInsights(job.url)
    if (result.summary) lighthouseSummary = JSON.stringify(result.summary)
    if (result.error) lighthouseError = result.error
  } catch (err) {
    lighthouseError = err instanceof Error ? err.message : String(err)
  }

  const settled = await settlePsiOutcome(job, { lighthouseSummary, lighthouseError })
  if (!settled) return // row already terminal — recovery beat us

  // A5: the lighthouse* counter bump changed the queue view + detail. Emit
  // AFTER the settle tx committed, gated on the winning fence above.
  publishInvalidation(siteAuditTopic(job.siteAuditId))
  publishInvalidation(queueTopic())

  try {
    await finalizeSiteAudit(job.siteAuditId)
  } catch (err) {
    console.warn('[jobs/psi] finalize after PSI settle failed:', (err as Error).message)
  }
}

/**
 * Settle a PSI failure that happened OUTSIDE the handler's fetch path —
 * job exhaustion, or a failed durable enqueue (lighthouse-queue's fallback).
 * Without this, the parent strands in lighthouse-running until stale
 * recovery fails the whole audit, because finalizeSiteAudit only counts
 * lighthouseComplete + lighthouseError.
 */
export async function settlePsiFailure(payload: unknown, message: string): Promise<void> {
  const job = assertPsiPayload(payload)
  const settled = await settlePsiOutcome(job, { lighthouseSummary: null, lighthouseError: message })
  if (!settled) return
  // A5: lighthouseError bump changed the queue + detail view (post-commit, fenced).
  publishInvalidation(siteAuditTopic(job.siteAuditId))
  publishInvalidation(queueTopic())
  try {
    await finalizeSiteAudit(job.siteAuditId)
  } catch (err) {
    console.warn('[jobs/psi] finalize after failure settle failed:', (err as Error).message)
  }
}

export async function onPsiExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  await settlePsiFailure(payload, `PSI job failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerPsiHandler(): void {
  registerJobHandler({
    type: PSI_JOB_TYPE,
    concurrency: parsePositiveInt(process.env.PSI_CONCURRENCY, 6),
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    // PSI fetch has its own ~90s internal timeout; 120s catches DB hangs too.
    timeoutMs: 120_000,
    handler: runPsiJob,
    onExhausted: onPsiExhausted,
  })
}
