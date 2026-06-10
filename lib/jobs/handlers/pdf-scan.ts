// lib/jobs/handlers/pdf-scan.ts
//
// Durable-queue PDF scan handler — replaces the fire-and-forget
// withPdfSlot() dispatch that used to live in lib/ada-audit/pdf-orchestrator
// (the in-memory pool in pdf-worker-pool.ts was deleted with it). One job
// per PdfAudit row; rows are identified by the (siteAuditId, url) /
// (adaAuditId, url) unique pairs, matching the orchestrator's insert-race
// semantics, not by PdfAudit.id.
//
// Idempotency: the conditional claim on PdfAudit.status IN
// ('pending','scanning') re-scans an unfinished row on re-run (crash
// recovery, zombie attempts) and no-ops on settled rows. 'scanning' is
// claimable because a crashed attempt leaves the row there.
//
// Error semantics (mirrors handlers/psi.ts):
// - scanPdfUrl never throws — HTTP errors, parse failures, and oversize
//   skips come back as scanError/skipReason and are DOMAIN results: the row
//   settles, counters bump, the job completes. No job retry.
// - DB failures THROW → the queue retries (covers transient SQLITE_BUSY).
// - The row settle + SiteAudit counter bump run in ONE short transaction
//   (no network work inside), conditional on status='scanning', so recovery
//   that already failed the row wins and retries can't double-bump.
// - finalizeSiteAudit failure after the transaction committed
//   warns-and-continues — another settling job or stale recovery picks it
//   up, same exposure as the PSI handler.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { scanPdfUrl } from '@/lib/ada-audit/pdf-runner'
import { finalizeSiteAudit } from '@/lib/ada-audit/site-audit-finalizer'
import { parsePositiveInt } from '../config'
import { registerJobHandler } from '../registry'
import type { JobExhaustedContext } from '../types'

export const PDF_SCAN_JOB_TYPE = 'pdf-scan'

export interface PdfScanJob {
  url: string
  siteAuditId?: string
  adaAuditId?: string
  sourcePageUrl?: string
}

function assertPdfScanPayload(payload: unknown): PdfScanJob {
  const p = payload as Partial<PdfScanJob> | null
  if (
    !p ||
    typeof p.url !== 'string' ||
    (typeof p.siteAuditId !== 'string' && typeof p.adaAuditId !== 'string')
  ) {
    throw new Error('Invalid pdf-scan job payload')
  }
  return p as PdfScanJob
}

/** The PdfAudit row for this job — keyed by the table's unique pairs. */
function rowWhere(job: PdfScanJob) {
  return job.siteAuditId
    ? { siteAuditId: job.siteAuditId, url: job.url }
    : { adaAuditId: job.adaAuditId, url: job.url }
}

interface PdfOutcome {
  status: 'complete' | 'error' | 'skipped'
  fileSize: number | null
  pageCount: number | null
  issues: string
  scanError: string | null
  skipReason: string | null
}

/**
 * Atomically settle the row and bump the matching SiteAudit counter.
 * Returns false when no row matched the claimable statuses (recovery beat
 * us / idempotent re-run). On true and a site-audit job, the caller must
 * invoke finalizeSiteAudit (outside the transaction).
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
async function settlePdfOutcome(
  job: PdfScanJob,
  outcome: PdfOutcome,
  claimableStatuses: string[],
): Promise<boolean> {
  if (!job.siteAuditId) {
    // Standalone single-page audit: no counters, single autocommit write.
    const flipped = await prisma.pdfAudit.updateMany({
      where: { ...rowWhere(job), status: { in: claimableStatuses } },
      data: outcome,
    })
    return flipped.count === 1
  }

  const counter =
    outcome.status === 'skipped' ? 'pdfsSkipped' : outcome.status === 'error' ? 'pdfsError' : 'pdfsComplete'
  const [, flipped] = await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "SiteAudit"
      SET ${Prisma.raw(`"${counter}" = "${counter}" + 1`)}, "updatedAt" = ${Date.now()}
      WHERE "id" = ${job.siteAuditId}
        AND EXISTS (
          SELECT 1 FROM "PdfAudit"
          WHERE "siteAuditId" = ${job.siteAuditId} AND "url" = ${job.url}
            AND "status" IN (${Prisma.join(claimableStatuses)})
        )`,
    prisma.pdfAudit.updateMany({
      where: { ...rowWhere(job), status: { in: claimableStatuses } },
      data: outcome,
    }),
  ])
  return flipped.count === 1
}

export async function runPdfScanJob(payload: unknown): Promise<void> {
  const job = assertPdfScanPayload(payload)

  // Claim before the scan: pending (normal) or scanning (crash re-run).
  // 0 rows → already settled or recovery failed it; nothing to do.
  const claimed = await prisma.pdfAudit.updateMany({
    where: { ...rowWhere(job), status: { in: ['pending', 'scanning'] } },
    data: { status: 'scanning' },
  })
  if (claimed.count !== 1) return

  const result = await scanPdfUrl(job.url, { referer: job.sourcePageUrl })
  const isSkipped = !!result.skipReason
  const isErrored = !isSkipped && !!result.scanError

  const settled = await settlePdfOutcome(
    job,
    {
      status: isSkipped ? 'skipped' : isErrored ? 'error' : 'complete',
      fileSize: result.fileSize,
      pageCount: result.pageCount,
      issues: JSON.stringify(result.issues),
      scanError: isErrored ? result.scanError! : null,
      skipReason: isSkipped ? result.skipReason! : null,
    },
    ['scanning'],
  )
  if (!settled || !job.siteAuditId) return

  try {
    await finalizeSiteAudit(job.siteAuditId)
  } catch (err) {
    console.warn('[jobs/pdf-scan] finalize after settle failed:', (err as Error).message)
  }
}

/**
 * Settle a PDF failure that happened OUTSIDE the scan path — job exhaustion
 * or a failed durable enqueue (pdf-orchestrator's fallback). Without this a
 * site-audit parent strands in pdfs-running, because finalizeSiteAudit only
 * counts pdfsComplete + pdfsError + pdfsSkipped against pdfsTotal.
 */
export async function settlePdfFailure(payload: unknown, message: string): Promise<void> {
  const job = assertPdfScanPayload(payload)
  const settled = await settlePdfOutcome(
    job,
    { status: 'error', fileSize: null, pageCount: null, issues: '[]', scanError: message, skipReason: null },
    ['pending', 'scanning'],
  )
  if (!settled || !job.siteAuditId) return
  try {
    await finalizeSiteAudit(job.siteAuditId)
  } catch (err) {
    console.warn('[jobs/pdf-scan] finalize after failure settle failed:', (err as Error).message)
  }
}

export async function onPdfScanExhausted(payload: unknown, ctx: JobExhaustedContext): Promise<void> {
  await settlePdfFailure(payload, `PDF scan job failed after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerPdfScanHandler(): void {
  registerJobHandler({
    type: PDF_SCAN_JOB_TYPE,
    concurrency: parsePositiveInt(process.env.PDF_POOL_SIZE, 4),
    maxAttempts: 3,
    backoffBaseMs: 30_000,
    // scanPdfUrl self-limits (byte cap, one retry with small backoff) and
    // pdfjs parses a capped buffer; 120s also catches DB hangs.
    timeoutMs: 120_000,
    handler: runPdfScanJob,
    onExhausted: onPdfScanExhausted,
  })
}
