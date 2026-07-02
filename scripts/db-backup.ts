// scripts/db-backup.ts
// Manual on-demand DB backup / restore-prep tool (D0).
// Run from the app dir: npx tsx scripts/db-backup.ts
//
// Relative imports + $disconnect() in finally match scripts/findings-rebuild.ts.
// initPragmas() is intentionally NOT called — VACUUM INTO produces a correct
// snapshot regardless of the connection's journal-mode pragma (the persistent
// DB file is already WAL).
import { prisma } from '../lib/db'
import { runDbBackup, backupDir } from '../lib/ops/backup'

async function main() {
  const res = await runDbBackup()
  console.log(`Backup written to ${res.file} (${res.bytes} bytes) in ${backupDir()}; pruned ${res.prunedCount}.`)
}

main()
  .catch((err) => {
    console.error('Backup failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
