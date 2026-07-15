// scripts/findings-rebuild.ts
//
// Rebuild the findings run for one origin row from its archived blob.
// Auto-detects the id type: SEO parse session, ADA site audit, or
// standalone ADA page audit. Recovery tool for failed dual-writes of NEW
// (current-format) runs — NOT a historical backfill tool.
//
// Usage (local):  DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-rebuild.ts <sessionId|siteAuditId|adaAuditId>
// Usage (prod):   cd $APP_HOME && npx tsx scripts/findings-rebuild.ts <id>
import { prisma } from '../lib/db'
import { writeSeoFindings } from '../lib/findings/seo-write'
import { writeAdaSiteFindings, writeAdaSingleFindings } from '../lib/findings/ada-write'
import type { AggregatedResult } from '../lib/types'

async function printRun(
  where:
    | { sessionId: string }
    | { siteAuditId_tool: { siteAuditId: string; tool: 'ada-audit' | 'seo-parser' } }
    | { adaAuditId: string },
) {
  const run = await prisma.crawlRun.findUnique({
    where,
    include: { _count: { select: { pages: true, findings: true, violations: true } } },
  })
  console.log(
    `rebuilt run ${run!.id}: ${run!._count.pages} pages, ${run!._count.findings} findings, ${run!._count.violations} violations`,
  )
}

async function main() {
  const id = process.argv[2]
  if (!id) {
    console.error('Usage: npx tsx scripts/findings-rebuild.ts <sessionId|siteAuditId|adaAuditId>')
    process.exit(1)
  }

  const [session, siteAudit, adaAudit] = await Promise.all([
    prisma.session.findUnique({ where: { id }, select: { result: true, clientId: true, status: true } }),
    prisma.siteAudit.findUnique({ where: { id }, select: { id: true } }),
    prisma.adaAudit.findUnique({ where: { id }, select: { id: true, siteAuditId: true } }),
  ])

  if (session) {
    if (session.status === 'complete' && !session.result) {
      throw new Error(`session ${id}: result blob was pruned (90-d archive) — cannot rebuild. Findings rows are the canonical record now.`)
    }
    if (session.status !== 'complete' || !session.result) {
      throw new Error(`session ${id} is not a completed run with a result blob`)
    }
    const result = JSON.parse(session.result) as AggregatedResult
    await writeSeoFindings(id, result, session.clientId)
    await printRun({ sessionId: id })
  } else if (siteAudit) {
    // C6: a SiteAudit origin can now carry two runs (ada-audit + seo-parser
    // live-scan). This rebuild path is for the ADA run; rebuilding the
    // live-scan run is a rare manual op (the verifier owns it).
    await writeAdaSiteFindings(id)
    await printRun({ siteAuditId_tool: { siteAuditId: id, tool: 'ada-audit' } })
  } else if (adaAudit) {
    await writeAdaSingleFindings(id) // throws its own message for child rows
    await printRun({ adaAuditId: id })
  } else {
    throw new Error(`no session, site audit, or ada audit with id ${id}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
