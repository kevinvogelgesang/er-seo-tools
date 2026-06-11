// scripts/findings-parity.ts
//
// Blob-vs-tables parity for one origin row. Auto-detects the id type: SEO
// parse session, ADA site audit, or standalone ADA page audit. Run against
// production for 3-5 representative clients before flipping any reader
// (A2 Phase 3).
//
// Usage: DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-parity.ts <sessionId|siteAuditId|adaAuditId>
import { prisma } from '../lib/db'
import { compareSeoParity, compareAdaParity, compareAdaSingleParity } from '../lib/findings/parity'

async function main() {
  const id = process.argv[2]
  if (!id) {
    console.error('Usage: npx tsx scripts/findings-parity.ts <sessionId|siteAuditId|adaAuditId>')
    process.exit(1)
  }

  const [session, siteAudit, adaAudit] = await Promise.all([
    prisma.session.findUnique({ where: { id }, select: { id: true } }),
    prisma.siteAudit.findUnique({ where: { id }, select: { id: true } }),
    prisma.adaAudit.findUnique({ where: { id }, select: { id: true } }),
  ])

  const [kind, report] = session
    ? ['session', await compareSeoParity(id)] as const
    : siteAudit
      ? ['site audit', await compareAdaParity(id)] as const
      : adaAudit
        ? ['ada audit', await compareAdaSingleParity(id)] as const
        : ['session', await compareSeoParity(id)] as const // unknown id → same "missing" report as before

  if (report.ok) {
    console.log(`PARITY OK for ${kind} ${id}`)
  } else {
    console.log(`PARITY FAILED for ${kind} ${id}:`)
    for (const d of report.diffs) console.log(`  - ${d}`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
