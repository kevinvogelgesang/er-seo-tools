// scripts/findings-parity.ts
//
// Blob-vs-tables parity for one session. Run against production for 3-5
// representative clients before flipping any reader (A2 Phase 3).
//
// Usage: DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-parity.ts <sessionId>
import { prisma } from '../lib/db'
import { compareSeoParity } from '../lib/findings/parity'

async function main() {
  const sessionId = process.argv[2]
  if (!sessionId) {
    console.error('Usage: npx tsx scripts/findings-parity.ts <sessionId>')
    process.exit(1)
  }
  const report = await compareSeoParity(sessionId)
  if (report.ok) {
    console.log(`PARITY OK for session ${sessionId}`)
  } else {
    console.log(`PARITY FAILED for session ${sessionId}:`)
    for (const d of report.diffs) console.log(`  - ${d}`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
