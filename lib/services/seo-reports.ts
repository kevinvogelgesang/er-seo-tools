// lib/services/seo-reports.ts
//
// Batch + per-client SeoReport creation helper for the C10 SEO reporting pipeline.
//
// Key design rules (per Codex fixes #5/#6/#7):
// - NO createMany / skipDuplicates — unsupported / insufficient on SQLite.
// - NOT one big transaction. Individual creates guarded by P2002 catch, following
//   the exact precedent in lib/jobs/handlers/site-audit-discover.ts.
// - NO interactive prisma.$transaction(async tx => ...) — array-form only if used.
//   Here we need no transaction at all: individual row creates are the rule.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { comparisonWindow, type DateWindow } from '@/lib/analytics/dates'

// ── eligibility ───────────────────────────────────────────────────────────────

/**
 * A client is eligible for SEO report generation if it is not archived and
 * has at least one analytics source mapped (GA4 or GSC).
 */
export function isClientEligible(c: {
  archivedAt: Date | null
  ga4PropertyId: string | null
  gscSiteUrl: string | null
}): boolean {
  return c.archivedAt === null && (c.ga4PropertyId != null || c.gscSiteUrl != null)
}

// ── createBatchWithReports ────────────────────────────────────────────────────

export interface CreateBatchInput {
  trigger: 'manual' | 'scheduled'
  scheduleId?: string
  scheduledFor?: Date
  clientIds: number[]
  period: DateWindow
  comparisonMode: 'prev_period' | 'prev_year'
  createdBy?: string | null
}

/**
 * Create a SeoReportBatch + one SeoReport per clientId, idempotently.
 *
 * Idempotency surfaces:
 * - Batch: @@unique([scheduleId, scheduledFor]) — a P2002 on create means the
 *   scheduled slot already exists; fetch and reuse the existing batch.
 * - Report: @@unique([batchId, clientId]) — a P2002 on create means this client
 *   already has a report in this batch; fetch and collect the existing report id.
 *
 * Returns { batchId, reportIds } where reportIds includes every report in the
 * batch (created or pre-existing). Enqueueing is the CALLER's responsibility.
 */
export async function createBatchWithReports(
  input: CreateBatchInput,
): Promise<{ batchId: string; reportIds: string[] }> {
  const { trigger, scheduleId, scheduledFor, clientIds, period, comparisonMode, createdBy } = input

  const comparison = comparisonWindow(period, comparisonMode)

  // ── Step 1: Create or fetch the batch ─────────────────────────────────────
  let batchId: string

  try {
    const batch = await prisma.seoReportBatch.create({
      data: {
        trigger,
        scheduleId: scheduleId ?? null,
        scheduledFor: scheduledFor ?? null,
        periodStart: period.start,
        periodEnd: period.end,
        comparisonMode,
        comparisonStart: comparison.start,
        comparisonEnd: comparison.end,
        createdBy: createdBy ?? null,
        totalReports: clientIds.length,
      },
      select: { id: true },
    })
    batchId = batch.id
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      scheduleId != null &&
      scheduledFor != null
    ) {
      // The @@unique([scheduleId, scheduledFor]) slot already exists — reuse it.
      const existing = await prisma.seoReportBatch.findUnique({
        where: { scheduleId_scheduledFor: { scheduleId, scheduledFor } },
        select: { id: true },
      })
      if (!existing) throw e // unexpected — rethrow
      batchId = existing.id
    } else {
      throw e
    }
  }

  // ── Step 2: Create or fetch one report per clientId ───────────────────────
  const reportIds: string[] = []

  for (const clientId of clientIds) {
    try {
      const report = await prisma.seoReport.create({
        data: {
          batchId,
          clientId,
          periodStart: period.start,
          periodEnd: period.end,
          comparisonStart: comparison.start,
          comparisonEnd: comparison.end,
        },
        select: { id: true },
      })
      reportIds.push(report.id)
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // The @@unique([batchId, clientId]) slot already exists — fetch it.
        const existing = await prisma.seoReport.findUnique({
          where: { batchId_clientId: { batchId, clientId } },
          select: { id: true },
        })
        if (existing) {
          reportIds.push(existing.id)
        }
        continue
      }
      throw e
    }
  }

  return { batchId, reportIds }
}
