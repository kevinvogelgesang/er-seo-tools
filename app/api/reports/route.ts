// app/api/reports/route.ts
//
// POST /api/reports — on-demand single-client SEO report generation (C10).
//
// Single-client support ships here (Task 16). Multi-client / 'all' is added
// in Task 21 in this same file (Codex fix #9 — no temporary route).
//
// Request body (single-client forms):
//   { clientId: number, periodStart: string, periodEnd: string, comparisonMode }
//   { clientIds: [number], periodStart: string, periodEnd: string, comparisonMode }
//
// periodStart/periodEnd: YYYY-MM-DD strings → converted to midnight-UTC Date.
// comparisonMode: 'prev_period' | 'prev_year'
//
// Enqueue-failure handling (Codex fix #5): if enqueueSeoReportRender throws,
// flip that SeoReport.status='error' immediately and continue — return 201
// with the batch/report ids so the caller can surface the error via status
// polling.
//
// Auth: routes are middleware cookie-gated (middleware.ts matcher covers
// /api/:path*; Codex fix #10 — no per-route auth helper).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createBatchWithReports } from '@/lib/services/seo-reports'
import { enqueueSeoReportRender } from '@/lib/jobs/handlers/seo-report-render'

export const dynamic = 'force-dynamic'

const VALID_COMPARISON_MODES = ['prev_period', 'prev_year'] as const
type ComparisonMode = (typeof VALID_COMPARISON_MODES)[number]

function isValidComparisonMode(s: unknown): s is ComparisonMode {
  return typeof s === 'string' && (VALID_COMPARISON_MODES as readonly string[]).includes(s)
}

/** Parse YYYY-MM-DD → midnight-UTC Date. */
function parseYmd(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  // Resolve clientIds — accept either `clientId` (scalar) or `clientIds` (array)
  let clientIds: number[]
  if (typeof b.clientId === 'number') {
    clientIds = [b.clientId]
  } else if (Array.isArray(b.clientIds) && b.clientIds.length > 0 && typeof b.clientIds[0] === 'number') {
    clientIds = b.clientIds as number[]
  } else {
    return NextResponse.json({ error: 'missing_client_id' }, { status: 400 })
  }

  // Validate period strings
  if (typeof b.periodStart !== 'string' || typeof b.periodEnd !== 'string') {
    return NextResponse.json({ error: 'missing_period' }, { status: 400 })
  }
  if (!isValidComparisonMode(b.comparisonMode)) {
    return NextResponse.json({ error: 'invalid_comparison_mode' }, { status: 400 })
  }

  const period = {
    start: parseYmd(b.periodStart),
    end: parseYmd(b.periodEnd),
  }
  const comparisonMode = b.comparisonMode

  // Create batch + reports
  const { batchId, reportIds } = await createBatchWithReports({
    trigger: 'manual',
    clientIds,
    period,
    comparisonMode,
  })

  // Enqueue each report; on failure flip that report to error and continue
  for (const reportId of reportIds) {
    try {
      await enqueueSeoReportRender(reportId)
    } catch (err) {
      console.error(`[api/reports] enqueue failed for report ${reportId}:`, err)
      await prisma.seoReport.updateMany({
        where: { id: reportId },
        data: { status: 'error' },
      })
    }
  }

  return NextResponse.json({ batchId, reportIds }, { status: 201 })
}
