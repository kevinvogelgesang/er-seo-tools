// app/api/reports/[id]/prospects/route.ts
//
// PUT /api/reports/[id]/prospects — manual ProspectsEntry upsert.
//
// Body: { total: number, organic?: number | null }
//
// Validation:
//   - total: non-negative integer (required)
//   - organic: non-negative integer OR null/absent
//
// Flow:
//   1. Validate body
//   2. Load SeoReport (404 if missing) to get clientId, periodStart, periodEnd
//   3. Upsert ProspectsEntry for that window
//   4. Critical invariant (Codex fix #8): null metricsJson, reset status='queued'
//      and prospectsStatus='pending', then enqueue render
//
// Auth: route is middleware cookie-gated.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { enqueueSeoReportRender } from '@/lib/jobs/handlers/seo-report-render'

export const dynamic = 'force-dynamic'

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  // Parse + validate body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Validate total
  if (!isNonNegativeInteger(body.total)) {
    return NextResponse.json(
      { error: 'total_invalid', detail: 'total must be a non-negative integer' },
      { status: 400 },
    )
  }

  // Validate organic (optional — null/absent are both fine)
  const organicRaw = body.organic
  if (organicRaw !== undefined && organicRaw !== null && !isNonNegativeInteger(organicRaw)) {
    return NextResponse.json(
      { error: 'organic_invalid', detail: 'organic must be a non-negative integer or null' },
      { status: 400 },
    )
  }

  const total = body.total as number
  const organic = organicRaw != null ? (organicRaw as number) : null

  // Load SeoReport to get clientId + period window
  const report = await prisma.seoReport.findUnique({
    where: { id },
    select: { clientId: true, periodStart: true, periodEnd: true },
  })

  if (!report) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const { clientId, periodStart, periodEnd } = report

  // Upsert ProspectsEntry for this window
  await prisma.prospectsEntry.upsert({
    where: {
      clientId_periodStart_periodEnd: { clientId, periodStart, periodEnd },
    },
    create: { clientId, periodStart, periodEnd, total, organic: organic ?? null },
    update: { total, organic: organic ?? null },
  })

  // Critical invariant (Codex fix #8): null metricsJson so the next render
  // refetches fresh data. Reset status + prospectsStatus then re-enqueue.
  await prisma.seoReport.update({
    where: { id },
    data: {
      metricsJson: null,
      status: 'queued',
      prospectsStatus: 'pending',
    },
  })

  await enqueueSeoReportRender(id)

  return NextResponse.json({ ok: true })
}
