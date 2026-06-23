// app/api/reports/batch/[id]/route.ts
//
// GET /api/reports/batch/[id] — batch rollup status.
//
// Response shape:
//   {
//     status: 'running' | 'complete' | 'error',
//     counts: { queued: number, rendering: number, ready: number, error: number },
//     reports: [{ id, clientId, status, ga4Status, gscStatus, prospectsStatus,
//                 periodStart, periodEnd, generatedAt }]
//   }
//
// Rollup rules (spec §7.2 / task brief):
//   running  → any child in queued | fetching | rendering
//   error    → no transient children AND all children are 'error'
//   complete → no transient children AND at least one non-error child
//
// Counts bucket: 'fetching' is included in the 'rendering' bucket — both
// are in-progress rendering states. The 'queued' bucket is queued only.
// This keeps the API surface minimal while covering all child statuses.
//
// 404 if the batch id is not found.
//
// Auth: routes are middleware cookie-gated (middleware.ts matcher covers
// /api/:path*; Codex fix #10 — no per-route auth helper).

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Child statuses that indicate in-progress work (prevent completion)
const TRANSIENT_STATUSES = ['queued', 'fetching', 'rendering'] as const

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  // Verify the batch exists
  const batch = await prisma.seoReportBatch.findUnique({
    where: { id },
    select: { id: true },
  })

  if (!batch) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Load all children
  const children = await prisma.seoReport.findMany({
    where: { batchId: id },
    select: {
      id: true,
      clientId: true,
      status: true,
      ga4Status: true,
      gscStatus: true,
      prospectsStatus: true,
      periodStart: true,
      periodEnd: true,
      generatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  // ── Rollup status ────────────────────────────────────────────────────────
  const statuses = children.map((c) => c.status)

  const hasTransient = statuses.some((s) => TRANSIENT_STATUSES.includes(s as typeof TRANSIENT_STATUSES[number]))
  const allError = statuses.length > 0 && statuses.every((s) => s === 'error')

  let rollupStatus: 'running' | 'complete' | 'error'
  if (hasTransient) {
    rollupStatus = 'running'
  } else if (allError) {
    rollupStatus = 'error'
  } else {
    rollupStatus = 'complete'
  }

  // ── Counts ───────────────────────────────────────────────────────────────
  // fetching and rendering are bucketed together under 'rendering'
  const counts = {
    queued: statuses.filter((s) => s === 'queued').length,
    rendering: statuses.filter((s) => s === 'fetching' || s === 'rendering').length,
    ready: statuses.filter((s) => s === 'ready').length,
    error: statuses.filter((s) => s === 'error').length,
  }

  return NextResponse.json({
    status: rollupStatus,
    counts,
    reports: children.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      status: r.status,
      ga4Status: r.ga4Status,
      gscStatus: r.gscStatus,
      prospectsStatus: r.prospectsStatus,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
    })),
  })
}
