// app/api/reports/route.ts
//
// POST /api/reports — on-demand SEO report generation (C10).
// GET  /api/reports — list reports with optional filters.
//
// POST accepts:
//   { clientId: number, ... }              — single client (scalar, Task 16)
//   { clientIds: number[], ... }           — explicit multi-client list
//   { clientIds: 'all', ... }              — all eligible active clients
//
// Eligibility (spec §7.2, Codex fix #8):
//   - 'all'         → ineligible/archived clients are silently excluded
//   - number[]      → if ANY selected client is ineligible, respond 422 with
//                     the list UNLESS confirm:true is passed
//
// Validation (Task-21 must-do): every element of a number[] clientIds must be
// a number (fixes the Task-16 code that only checked clientIds[0]).
//
// GET returns a list of reports (most-recent first, limit 100) with optional
// query filters: ?clientId=<n>, ?status=<s>, ?batchId=<s>.
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
import { createBatchWithReports, isClientEligible, recomputeSeoReportBatchStatus } from '@/lib/services/seo-reports'
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports — list reports with optional filters
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url)
  const clientIdParam = url.searchParams.get('clientId')
  const statusParam = url.searchParams.get('status')
  const batchIdParam = url.searchParams.get('batchId')

  const where: Record<string, unknown> = {}
  if (clientIdParam) {
    const n = parseInt(clientIdParam, 10)
    if (!isNaN(n)) where.clientId = n
  }
  if (statusParam) {
    where.status = statusParam
  }
  if (batchIdParam) {
    where.batchId = batchIdParam
  }

  const reports = await prisma.seoReport.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      batchId: true,
      clientId: true,
      status: true,
      ga4Status: true,
      gscStatus: true,
      prospectsStatus: true,
      prospectsTotal: true,
      prospectsOrganic: true,
      periodStart: true,
      periodEnd: true,
      generatedAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json({
    reports: reports.map((r) => ({
      ...r,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      generatedAt: r.generatedAt ? r.generatedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reports — generate reports
// ─────────────────────────────────────────────────────────────────────────────

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

  // ── Validate period + comparisonMode ────────────────────────────────────
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
  const confirm = b.confirm === true

  // ── Resolve clientIds ────────────────────────────────────────────────────
  //
  // Three accepted forms:
  //   1. clientId: number           (scalar, Task-16 backward compat)
  //   2. clientIds: number[]        (explicit list)
  //   3. clientIds: 'all'           (all eligible active clients)

  let resolvedClientIds: number[]
  let isAllMode = false

  if (typeof b.clientId === 'number') {
    // Scalar form (Task 16)
    resolvedClientIds = [b.clientId]
  } else if (b.clientIds === 'all') {
    // 'all' mode — resolve eligible active clients from DB
    isAllMode = true
    const allClients = await prisma.client.findMany({
      where: { archivedAt: null },
      select: { id: true, archivedAt: true, ga4PropertyId: true, gscSiteUrl: true },
    })
    resolvedClientIds = allClients
      .filter((c) => isClientEligible(c))
      .map((c) => c.id)

    if (resolvedClientIds.length === 0) {
      return NextResponse.json({ error: 'no_eligible_clients' }, { status: 422 })
    }
  } else if (Array.isArray(b.clientIds)) {
    if (b.clientIds.length === 0) {
      return NextResponse.json({ error: 'missing_client_id' }, { status: 400 })
    }
    // Task-21 must-do: validate EVERY element is a number (Task 16 only checked [0])
    const allNumbers = b.clientIds.every((id) => typeof id === 'number')
    if (!allNumbers) {
      return NextResponse.json({ error: 'invalid_client_ids' }, { status: 400 })
    }
    resolvedClientIds = b.clientIds as number[]
  } else {
    return NextResponse.json({ error: 'missing_client_id' }, { status: 400 })
  }

  // ── Eligibility gate (Codex fix #8) ─────────────────────────────────────
  //
  // For explicit number[] lists: if any client is ineligible, return 422
  // UNLESS confirm:true was passed.
  // For 'all' mode: ineligible clients are already excluded above — no 422.

  if (!isAllMode) {
    const selectedClients = await prisma.client.findMany({
      where: { id: { in: resolvedClientIds } },
      select: { id: true, name: true, archivedAt: true, ga4PropertyId: true, gscSiteUrl: true },
    })

    const ineligible = selectedClients.filter((c) => !isClientEligible(c))

    if (ineligible.length > 0 && !confirm) {
      return NextResponse.json(
        {
          error: 'ineligible_clients',
          ineligibleClients: ineligible.map((c) => ({
            id: c.id,
            name: c.name,
            reason: c.archivedAt !== null ? 'archived' : 'no_analytics_source',
          })),
        },
        { status: 422 },
      )
    }
  }

  // ── Create batch + reports ───────────────────────────────────────────────
  const { batchId, reportIds } = await createBatchWithReports({
    trigger: 'manual',
    clientIds: resolvedClientIds,
    period,
    comparisonMode,
  })

  // ── Enqueue each report; on failure flip that report to error and continue
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

  // ── Recompute batch rollup status after enqueue loop ────────────────────
  // If ALL enqueues failed every child is now 'error', but the batch defaults
  // to 'running'. Recompute so the batch is immediately set to 'error' rather
  // than remaining stuck with no render job to ever update it.
  // On the normal path (all children still 'queued') this recomputes to
  // 'running' — matching the default, so there is no observable change.
  await recomputeSeoReportBatchStatus(batchId)

  return NextResponse.json({ batchId, reportIds }, { status: 201 })
}
