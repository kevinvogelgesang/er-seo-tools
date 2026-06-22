// app/api/reports/[id]/route.ts
//
// GET  /api/reports/[id]         — report status (status, per-source statuses, generatedAt)
// GET  /api/reports/[id]?file=1  — stream the PDF from disk
// DELETE /api/reports/[id]       — cancel jobs + delete row + unlink file (best-effort)
//
// Auth: routes are middleware cookie-gated (middleware.ts matcher covers
// /api/:path*; Codex fix #10 — no per-route auth helper).

import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { prisma } from '@/lib/db'
import { cancelJobsByGroup } from '@/lib/jobs/queue'
import { seoReportPath, seoReportFileExists, deleteSeoReportFile } from '@/lib/report/seo/seo-report-file'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET — status or stream
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const { id } = await params

  const report = await prisma.seoReport.findUnique({
    where: { id },
    select: {
      status: true,
      ga4Status: true,
      gscStatus: true,
      prospectsStatus: true,
      generatedAt: true,
    },
  })

  if (!report) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // If ?file=1 — stream the PDF
  const url = new URL(request.url)
  if (url.searchParams.get('file') === '1') {
    const exists = await seoReportFileExists(id)
    if (!exists) {
      return NextResponse.json({ error: 'report_not_generated' }, { status: 404 })
    }
    const buf = await fs.readFile(seoReportPath(id))
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="seo-report-${id}.pdf"`,
      },
    })
  }

  // Status response
  return NextResponse.json({
    status: report.status,
    ga4Status: report.ga4Status,
    gscStatus: report.gscStatus,
    prospectsStatus: report.prospectsStatus,
    generatedAt: report.generatedAt ? report.generatedAt.toISOString() : null,
  })
}

// ---------------------------------------------------------------------------
// DELETE — cancel jobs + delete row + unlink file
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  const report = await prisma.seoReport.findUnique({
    where: { id },
    select: { id: true },
  })

  if (!report) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Cancel any queued render jobs for this report
  await cancelJobsByGroup(`seo-report:${id}`)

  // Delete the DB row (cascade removes nothing external here)
  await prisma.seoReport.deleteMany({ where: { id } })

  // Best-effort unlink the PDF file
  await deleteSeoReportFile(id)

  return NextResponse.json({ deleted: true })
}
