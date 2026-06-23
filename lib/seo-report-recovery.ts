// lib/seo-report-recovery.ts
//
// Global stranded SEO-report recovery sweep (C10 spec §7, "Enqueue-failure
// handling"). Piggybacks on the existing recovery hooks:
//   • recoverQueue()          — boot, in lib/ada-audit/queue-manager.ts
//   • stale-audit-reset job  — every 10 min, in lib/jobs/handlers/stale-audit-reset.ts
//
// A SeoReport in a non-terminal status (queued | fetching | rendering) whose
// updatedAt has not moved in more than SEO_REPORT_RECOVERY_THRESHOLD_MS is
// considered stranded. For each such report, if there is no active
// seo-report-render job in the group seo-report:<id>, we re-enqueue the
// render job. enqueueSeoReportRender is idempotent via its dedupKey
// (seo-report:<id>) so a race with a live-but-slow render does no harm.
//
// Terminal statuses (ready | error) are never touched.

import { prisma } from '@/lib/db'
import {
  enqueueSeoReportRender,
  SEO_REPORT_RENDER_JOB_TYPE,
} from '@/lib/jobs/handlers/seo-report-render'
import { JOB_ACTIVE_STATUSES } from '@/lib/jobs/types'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * How long a non-terminal SeoReport must be idle before the recovery sweep
 * considers it stranded. Mirrors the 5-minute threshold used for SiteAudit
 * stale recovery in resetStaleAudits().
 *
 * Exported so tests can use it when seeding backdated rows.
 */
export const SEO_REPORT_RECOVERY_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

/** Non-terminal SeoReport statuses that recovery monitors. */
const NON_TERMINAL_STATUSES = ['queued', 'fetching', 'rendering'] as const

// ---------------------------------------------------------------------------
// Recovery sweep
// ---------------------------------------------------------------------------

export interface RecoverSeoReportsOptions {
  /**
   * Optional clock override for deterministic tests. Defaults to `new Date()`.
   * When provided, the threshold is computed as `now - SEO_REPORT_RECOVERY_THRESHOLD_MS`.
   */
  now?: Date
}

/**
 * Re-enqueue seo-report-render jobs for any SeoReport that is:
 *   1. In a non-terminal status (queued | fetching | rendering)
 *   2. Has not been updated within the recovery threshold (5 min)
 *   3. Has no active (queued | running) job in its seo-report:<id> group
 *
 * Returns `{ requeued }` — the count of reports that were re-enqueued.
 */
export async function recoverSeoReports(
  opts: RecoverSeoReportsOptions = {},
): Promise<{ requeued: number }> {
  const now = opts.now ?? new Date()
  const threshold = new Date(now.getTime() - SEO_REPORT_RECOVERY_THRESHOLD_MS)

  // Find all non-terminal reports whose heartbeat (updatedAt) has gone cold.
  const candidates = await prisma.seoReport.findMany({
    where: {
      status: { in: [...NON_TERMINAL_STATUSES] },
      updatedAt: { lt: threshold },
    },
    select: { id: true, status: true },
  })

  let requeued = 0

  for (const { id } of candidates) {
    // Skip if there is already a live job for this report — the render is
    // running (or queued) and merely slow; it needs no intervention.
    const activeJob = await prisma.job.findFirst({
      where: {
        type: SEO_REPORT_RENDER_JOB_TYPE,
        groupKey: `seo-report:${id}`,
        status: { in: [...JOB_ACTIVE_STATUSES] },
      },
      select: { id: true },
    })
    if (activeJob) continue

    // No active job → re-enqueue. The dedupKey makes this idempotent against
    // a racing enqueue that happened between our findMany and this point.
    await enqueueSeoReportRender(id)
    requeued++
  }

  if (requeued > 0) {
    console.log(`[seo-report-recovery] re-enqueued ${requeued} stranded report(s)`)
  }

  return { requeued }
}
