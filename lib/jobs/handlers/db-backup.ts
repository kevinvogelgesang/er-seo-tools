// lib/jobs/handlers/db-backup.ts
//
// Scheduled DB backup (D0). VACUUM INTO a timestamped snapshot, prune to N.
// maxAttempts 2: a transient FS/lock error retries once; the next daily slot
// is the ultimate retry. A throw correctly fails the job → visible in
// introspection and feeds the health-alert 'jobs-exhausted' condition.
import { runDbBackup } from '@/lib/ops/backup'
import { registerJobHandler } from '../registry'

export const DB_BACKUP_JOB_TYPE = 'db-backup'

export function registerDbBackupHandler(): void {
  registerJobHandler({
    type: DB_BACKUP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 2,
    timeoutMs: 10 * 60 * 1000,
    handler: async () => {
      const res = await runDbBackup()
      console.log(`[db-backup] wrote ${res.file} (${res.bytes} bytes), pruned ${res.prunedCount}`)
    },
  })
}
