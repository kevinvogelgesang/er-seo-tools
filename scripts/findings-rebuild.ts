// scripts/findings-rebuild.ts
//
// Rebuild the findings run for one session from its archived blob.
// Recovery tool for failed dual-writes of NEW (current-format) runs —
// NOT a historical backfill tool.
//
// Usage (local):  DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-rebuild.ts <sessionId>
// Usage (prod):   cd /home/seo/webapps/seo-tools && npx tsx scripts/findings-rebuild.ts <sessionId>
import { prisma } from '../lib/db'
import { writeSeoFindings } from '../lib/findings/seo-write'
import type { AggregatedResult } from '../lib/types'

async function main() {
  const sessionId = process.argv[2]
  if (!sessionId) {
    console.error('Usage: npx tsx scripts/findings-rebuild.ts <sessionId>')
    process.exit(1)
  }
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { result: true, clientId: true, status: true },
  })
  if (!session) throw new Error(`session ${sessionId} not found`)
  if (session.status !== 'complete' || !session.result) {
    throw new Error(`session ${sessionId} is not a completed run with a result blob`)
  }
  const result = JSON.parse(session.result) as AggregatedResult
  await writeSeoFindings(sessionId, result, session.clientId)
  const run = await prisma.crawlRun.findUnique({
    where: { sessionId },
    include: { _count: { select: { pages: true, findings: true } } },
  })
  console.log(`rebuilt run ${run!.id}: ${run!._count.pages} pages, ${run!._count.findings} findings`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
