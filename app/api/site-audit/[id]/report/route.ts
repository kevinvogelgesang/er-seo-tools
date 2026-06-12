// POST /api/site-audit/[id]/report — enqueue a branded-PDF render job.
// GET  /api/site-audit/[id]/report — stream the rendered PDF from disk.
//
// Reports are findings-run-only (loader contract, Codex plan fix #3): a
// pre-A2 audit with no CrawlRun is rejected up front instead of queueing a
// job that would no-op.
import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { prisma } from '@/lib/db'
import { enqueueJob } from '@/lib/jobs/queue'
import { REPORT_RENDER_JOB_TYPE } from '@/lib/jobs/handlers/report-render'
import { reportPath } from '@/lib/report/report-file'
import { safeFilenamePart } from '@/lib/report/csv'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({ where: { id }, select: { status: true } })
  if (!audit) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  if (audit.status !== 'complete') return NextResponse.json({ error: 'not_complete' }, { status: 409 })
  // Reports are findings-run-only (loader contract) — reject pre-A2 audits
  // here instead of queueing a job that would no-op (Codex plan fix #3).
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId: id }, select: { id: true } })
  if (!run) return NextResponse.json({ error: 'no_findings_run' }, { status: 409 })
  try {
    await enqueueJob({
      type: REPORT_RENDER_JOB_TYPE,
      payload: { siteAuditId: id },
      dedupKey: `report:${id}`,
      groupKey: `report:${id}`,
    })
  } catch (err) {
    console.error('[site-audit/report] enqueue failed:', err)
    return NextResponse.json({ error: 'enqueue_failed' }, { status: 500 })
  }
  return NextResponse.json({ queued: true }, { status: 202 })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { domain: true, completedAt: true, createdAt: true },
  })
  if (!audit) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  let buf: Buffer
  try {
    buf = await fs.readFile(reportPath(id))
  } catch {
    return NextResponse.json({ error: 'report_not_generated' }, { status: 404 })
  }
  const stamp = (audit.completedAt ?? audit.createdAt).toISOString().slice(0, 10)
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="ada-report-${safeFilenamePart(audit.domain)}-${stamp}.pdf"`,
    },
  })
}
