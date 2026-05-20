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

const queue: PsiJob[] = []
let active = 0

export function enqueuePsiJob(job: PsiJob): void {
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
      data: lighthouseError && !lighthouseSummary
        ? { lighthouseError: { increment: 1 } }
        : { lighthouseComplete: { increment: 1 } },
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
