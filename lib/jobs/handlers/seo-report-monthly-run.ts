// lib/jobs/handlers/seo-report-monthly-run.ts
//
// C10 Phase 2: thin wrapper fired by the operator-configurable 'seo-report-monthly'
// Schedule row.  It:
//   1. Resolves scheduleId + scheduledFor from the Job row (same pattern as
//      scheduled-site-audit.ts — JobHandlerContext does not inject scheduleId).
//   2. Loads the Schedule and bails if missing/disabled (no-op, not an error).
//   3. Computes period = lastFullMonth(scheduledFor ?? now).
//   4. Resolves all active eligible clients (not archived, GA4 or GSC mapped).
//   5. Calls createBatchWithReports — fully idempotent on @@unique([scheduleId, scheduledFor]).
//   6. Enqueues a seo-report-render job for EACH returned reportId.
//
// This handler does NO fetching or rendering; it only creates rows and enqueues.
// Idempotency: a re-run for the same slot hits the P2002 guard in
// createBatchWithReports and enqueueSeoReportRender's dedupKey and produces
// zero duplicates.

import { prisma } from '@/lib/db'
import { registerJobHandler } from '../registry'
import { lastFullMonth } from '@/lib/analytics/dates'
import { createBatchWithReports, isClientEligible } from '@/lib/services/seo-reports'
import { enqueueSeoReportRender } from './seo-report-render'

export const SEO_REPORT_MONTHLY_RUN_JOB_TYPE = 'seo-report-monthly-run'

type ComparisonMode = 'prev_period' | 'prev_year'

function parseComparisonMode(v: unknown): ComparisonMode {
  return v === 'prev_year' ? 'prev_year' : 'prev_period'
}

export function registerSeoReportMonthlyRunHandler(): void {
  registerJobHandler({
    type: SEO_REPORT_MONTHLY_RUN_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    timeoutMs: 60_000, // only creates rows + enqueues
    onExhausted: async (_payload, ctx) => {
      // No domain row to fail — the next scheduled slot is the durable retry.
      console.warn(
        `[seo-report-monthly-run] job ${ctx.jobId} exhausted after ${ctx.attempts} attempts: ${ctx.lastError}`,
      )
    },
    handler: async (payload, ctx) => {
      // Step 1: resolve scheduleId + scheduledFor from the Job row.
      const job = await prisma.job.findUnique({
        where: { id: ctx.jobId },
        select: { scheduleId: true, scheduledFor: true },
      })
      if (!job?.scheduleId) {
        console.warn(`[seo-report-monthly-run] job ${ctx.jobId} has no scheduleId; skipping`)
        return
      }

      // Step 2: load the Schedule — bail if missing or paused.
      const schedule = await prisma.schedule.findUnique({
        where: { id: job.scheduleId },
        select: { id: true, enabled: true },
      })
      if (!schedule || !schedule.enabled) {
        // Deleted or paused since enqueue — no-op, not an error.
        return
      }

      // Step 3: parse payload for comparisonMode (default 'prev_period').
      const comparisonMode = parseComparisonMode(
        typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).comparisonMode
          : undefined,
      )

      // Step 4: compute period = last full calendar month relative to scheduledFor.
      const anchor = job.scheduledFor ?? new Date()
      const period = lastFullMonth(anchor)

      // Step 5: resolve all active eligible clients.
      const clients = await prisma.client.findMany({
        where: { archivedAt: null },
        select: { id: true, archivedAt: true, ga4PropertyId: true, gscSiteUrl: true },
      })
      const eligibleIds = clients.filter(isClientEligible).map((c) => c.id)

      if (eligibleIds.length === 0) {
        console.log(`[seo-report-monthly-run] no eligible clients for slot ${anchor.toISOString()}; no-op`)
        return
      }

      // Step 6: create the batch + one report per eligible client (idempotent).
      const { reportIds } = await createBatchWithReports({
        trigger: 'scheduled',
        scheduleId: schedule.id,
        scheduledFor: anchor,
        clientIds: eligibleIds,
        period,
        comparisonMode,
      })

      // Step 7: enqueue a render job for each report (idempotent via dedupKey).
      for (const id of reportIds) {
        await enqueueSeoReportRender(id)
      }

      console.log(
        `[seo-report-monthly-run] slot ${anchor.toISOString()}: ${reportIds.length} reports enqueued (scheduleId=${schedule.id})`,
      )
    },
  })
}
