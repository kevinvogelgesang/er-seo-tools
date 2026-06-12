// app/api/site-audit/[id]/csv/route.ts
//
// C4: CSV export for a completed site audit. Default sheet = all violation
// instances (relational — works on archived/pruned audits); ?sheet=changes =
// the uncapped run-over-run instance diff (same previous-run selection as the
// results-page diff panel).
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { buildCsv, safeFilenamePart } from '@/lib/report/csv'
import { getSiteAuditInstanceDiffDetailed } from '@/lib/services/site-audit-diff'

export const dynamic = 'force-dynamic'

const IMPACT_RANK: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 }
const rank = (impact: string) => IMPACT_RANK[impact] ?? 4 // 'unknown' sentinel sorts last

function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

const dateStamp = (d: Date) => d.toISOString().slice(0, 10)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({
    where: { id },
    select: { id: true, domain: true, status: true, completedAt: true, createdAt: true },
  })
  if (!audit) return NextResponse.json({ error: 'Site audit not found' }, { status: 404 })
  if (audit.status !== 'complete') return NextResponse.json({ error: 'not_complete' }, { status: 409 })

  const stamp = dateStamp(audit.completedAt ?? audit.createdAt)

  if (request.nextUrl.searchParams.get('sheet') === 'changes') {
    const result = await getSiteAuditInstanceDiffDetailed(id)
    if (!result) return NextResponse.json({ error: 'no_previous_run' }, { status: 409 })
    const rows: (string | number)[][] = []
    for (const r of result.detailed.rules) {
      for (const u of r.regressedUrls) rows.push(['new', r.type, r.severity, u])
      for (const u of r.newPageUrls) rows.push(['new-page', r.type, r.severity, u])
      for (const u of r.resolvedUrls) rows.push(['resolved', r.type, r.severity, u])
      for (const u of r.notRescannedUrls) rows.push(['not-rescanned', r.type, r.severity, u])
    }
    return csvResponse(
      buildCsv(['change', 'rule_id', 'severity', 'page_url'], rows),
      `ada-changes-${safeFilenamePart(audit.domain)}-${stamp}.csv`,
    )
  }

  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId: id }, select: { id: true } })
  if (!run) return NextResponse.json({ error: 'no_findings_run' }, { status: 409 })

  const violations = await prisma.violation.findMany({
    where: { runId: run.id },
    select: {
      ruleId: true, impact: true, wcagTags: true, help: true, helpUrl: true, nodeCount: true,
      page: { select: { url: true } },
      finding: { select: { severity: true } },
    },
  })
  const rows = violations
    .sort((a, b) =>
      rank(a.impact) - rank(b.impact) || a.ruleId.localeCompare(b.ruleId) || a.page.url.localeCompare(b.page.url))
    .map((v) => {
      let tags: string[] = []
      try { const parsed = JSON.parse(v.wcagTags); if (Array.isArray(parsed)) tags = parsed.filter((x): x is string => typeof x === 'string') } catch { /* ignore */ }
      return [v.page.url, v.ruleId, v.impact, v.finding.severity, tags.join('|'), v.help, v.helpUrl, v.nodeCount]
    })
  return csvResponse(
    buildCsv(['page_url', 'rule_id', 'impact', 'severity', 'wcag_tags', 'help', 'help_url', 'node_count'], rows),
    `ada-violations-${safeFilenamePart(audit.domain)}-${stamp}.csv`,
  )
}
