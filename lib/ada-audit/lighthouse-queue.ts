// lib/ada-audit/lighthouse-queue.ts
//
// In-process worker pool for PageSpeed Insights jobs. Decouples PSI HTTP
// fetches from the puppeteer page slot — the page loop enqueues a job and
// moves on; this pool drains in parallel up to PSI_CONCURRENCY workers.
//
// Lifecycle:
//   - Jobs are enqueued by queue-manager.ts after each page's axe completes.
//   - Workers fetch PSI, write the result (or error) back to the AdaAudit
//     row, increment SiteAudit.lighthouseComplete/Error, and invoke
//     finalizeSiteAudit (which is idempotent and may flip status to
//     'complete' once all drains are done).
//   - No durable state. Process restarts wipe the in-flight queue;
//     orphan AdaAudit rows in 'axe-complete' are cleaned up by
//     failOrphanAdaAudits via recoverQueue / resetStaleAudits.

import { prisma } from '@/lib/db'
import { runPageSpeedInsights } from './lighthouse-pagespeed'
import { finalizeSiteAudit } from './site-audit-finalizer'

export interface PsiJob {
  adaAuditId: string
  siteAuditId: string
  url: string
  wcagLevel: string
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const PSI_CONCURRENCY = parsePositiveInt(process.env.PSI_CONCURRENCY, 6)

/** JOB_QUEUE_PSI=1 routes PSI work through the durable Job table (spec Phase 1).
 *  Read at call time so tests and ecosystem.config.js control it without module reloads. */
export function isPsiJobQueueEnabled(): boolean {
  return process.env.JOB_QUEUE_PSI === '1' || process.env.JOB_QUEUE_PSI === 'true'
}

const queue: PsiJob[] = []
let active = 0

export function enqueuePsiJob(job: PsiJob): void {
  if (isPsiJobQueueEnabled()) {
    // Durable path: the jobs worker picks this up (lib/jobs/handlers/psi.ts).
    // Dynamic import keeps the legacy path dependency-free.
    void import('@/lib/jobs/queue')
      .then(({ enqueueJob }) =>
        enqueueJob({
          type: 'psi',
          payload: job,
          dedupKey: `psi:${job.adaAuditId}`,
          groupKey: `site-audit:${job.siteAuditId}`,
        }),
      )
      .catch(async (err) => {
        // The page loop already committed axe-complete + lighthouseTotal++.
        // With no durable job, nothing would ever drain this page — settle
        // the LH portion as failed NOW instead of waiting for the parent's
        // stale-failure path.
        console.error('[lighthouse-queue] durable PSI enqueue failed for', job.adaAuditId, ':', (err as Error).message)
        try {
          const { settlePsiFailure } = await import('@/lib/jobs/handlers/psi')
          await settlePsiFailure(job, `Failed to enqueue durable PSI job: ${(err as Error).message}`)
        } catch (settleErr) {
          console.error('[lighthouse-queue] PSI enqueue-failure settle also failed for', job.adaAuditId, ':', (settleErr as Error).message)
        }
      })
    return
  }
  queue.push(job)
  pump()
}

export function getPsiQueueState(): { active: number; queued: number } {
  return { active, queued: queue.length }
}

function pump(): void {
  while (active < PSI_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()
    if (!job) break
    active += 1
    void runJob(job).finally(() => {
      active -= 1
      pump()
    })
  }
}

async function runJob(job: PsiJob): Promise<void> {
  let lighthouseSummary: string | null = null
  let lighthouseError: string | null = null
  try {
    const result = await runPageSpeedInsights(job.url)
    if (result.summary) {
      lighthouseSummary = JSON.stringify(result.summary)
    }
    if (result.error) {
      lighthouseError = result.error
    }
  } catch (err) {
    lighthouseError = err instanceof Error ? err.message : String(err)
  }

  // Conditional update on status='axe-complete'. This prevents a stale worker
  // from resurrecting a row that recovery (resetStaleAudits / recoverQueue)
  // already flipped to 'error'. If updateMany matches 0 rows, the row was
  // taken from us — skip the counter bump and skip finalize.
  let claimed = false
  try {
    const result = await prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: 'axe-complete' },
      data: {
        status: 'complete',
        lighthouseSummary,
        lighthouseError,
        completedAt: new Date(),
      },
    })
    claimed = result.count === 1
  } catch (err) {
    console.warn('[lighthouse-queue] adaAudit update failed for', job.adaAuditId, ':', (err as Error).message)
    return  // do NOT call finalizeSiteAudit — counters weren't bumped
  }

  if (!claimed) {
    // Row was already terminal (error / complete) — recovery beat us, or
    // a second worker raced. Either way, don't bump counters; the orphan
    // path already accounted for this row.
    return
  }

  try {
    await prisma.siteAudit.update({
      where: { id: job.siteAuditId },
      data: lighthouseSummary !== null
        ? { lighthouseComplete: { increment: 1 } }
        : { lighthouseError: { increment: 1 } },
    })
  } catch (err) {
    console.warn('[lighthouse-queue] siteAudit counter bump failed for', job.siteAuditId, ':', (err as Error).message)
    return  // do NOT call finalizeSiteAudit — the audit would wedge in lighthouse-running otherwise
  }

  // Centralized drain check — may finalize, or may flip to a transient phase.
  try {
    await finalizeSiteAudit(job.siteAuditId)
  } catch (err) {
    console.warn('[lighthouse-queue] finalize after PSI settle failed:', (err as Error).message)
  }
}
