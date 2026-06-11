// lib/findings/writer.ts
//
// Idempotent persistence for a FindingsBundle: delete any existing run for
// the same origin, then insert the whole bundle — ONE array-form
// $transaction (never interactive; see CLAUDE.md "Do not"), createMany
// chunked (SQLite bound-variable guard, same idea as the SessionPage insert).
import { prisma } from '@/lib/db'
import type { FindingsBundle } from './types'

// 50, not 75: CrawlPage has ~15 columns and SQLite's classic bound-variable
// limit is 999 — 75 × 15 would exceed it. 50 × 15 = 750 keeps headroom for
// every table in the bundle.
const CHUNK = 50

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function writeFindingsRun(bundle: FindingsBundle): Promise<void> {
  const { run, pages, findings, violations } = bundle
  const origins = [run.sessionId, run.siteAuditId, run.adaAuditId].filter((v) => v != null)
  if (origins.length !== 1) {
    throw new Error(
      `[findings] writeFindingsRun requires exactly one origin FK, got ${origins.length}`,
    )
  }

  const where = run.sessionId
    ? { sessionId: run.sessionId }
    : run.siteAuditId
      ? { siteAuditId: run.siteAuditId }
      : { adaAuditId: run.adaAuditId! }

  await prisma.$transaction([
    prisma.crawlRun.deleteMany({ where }), // cascade clears the old subtree
    prisma.crawlRun.create({ data: run }),
    ...chunk(pages, CHUNK).map((data) => prisma.crawlPage.createMany({ data })),
    ...chunk(findings, CHUNK).map((data) => prisma.finding.createMany({ data })),
    ...chunk(violations, CHUNK).map((data) => prisma.violation.createMany({ data })),
  ])
}
