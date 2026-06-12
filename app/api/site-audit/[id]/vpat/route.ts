import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { buildVpatScaffold, type VpatViolationRow } from '@/lib/report/vpat'
import { safeFilenamePart } from '@/lib/report/csv'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { domain: true, status: true, wcagLevel: true, pagesTotal: true, completedAt: true, createdAt: true },
  })
  if (!audit) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  if (audit.status !== 'complete') return NextResponse.json({ error: 'not_complete' }, { status: 409 })
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId: id }, select: { id: true } })
  if (!run) return NextResponse.json({ error: 'no_findings_run' }, { status: 409 })

  const violations = await prisma.violation.findMany({
    where: { runId: run.id },
    select: { ruleId: true, impact: true, wcagTags: true, helpUrl: true, page: { select: { url: true } } },
  })
  const rows: VpatViolationRow[] = violations.map((v) => {
    let tags: string[] = []
    try { const parsed = JSON.parse(v.wcagTags); if (Array.isArray(parsed)) tags = parsed.filter((x): x is string => typeof x === 'string') } catch { /* ignore */ }
    return { ruleId: v.ruleId, impact: v.impact, wcagTags: tags, helpUrl: v.helpUrl, pageUrl: v.page.url }
  })
  const stamp = (audit.completedAt ?? audit.createdAt).toISOString()
  const md = buildVpatScaffold({
    domain: audit.domain, auditDate: stamp, wcagLevel: audit.wcagLevel, pagesTotal: audit.pagesTotal, rows,
  })
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="vpat-scaffold-${safeFilenamePart(audit.domain)}-${stamp.slice(0, 10)}.md"`,
    },
  })
}
