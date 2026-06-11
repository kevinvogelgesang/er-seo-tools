// lib/jobs/retention.ts
//
// Job-row retention: terminal rows are deleted by age so the Job table
// doesn't grow without bound (one row per audited page + ~150 scheduled-job
// rows/day). Runs as a task inside runCleanup().
//
// Slot-record guard: scheduled jobs double as the durable
// exactly-once-per-slot record (@@unique([scheduleId, scheduledFor])).
// Never delete a job referenced by Schedule.lastJobId, or one whose
// (scheduleId, scheduledFor) matches its schedule's CURRENT nextRunAt — a
// stuck/unadvanced schedule would lose its slot record and re-run the slot.

import { prisma } from '@/lib/db'

const DAY_MS = 24 * 60 * 60 * 1000
/** complete/cancelled rows are kept 7 days. */
export const TERMINAL_JOB_RETENTION_MS = 7 * DAY_MS
/** error rows are kept 30 days (introspection surfaces recent failures). */
export const ERROR_JOB_RETENTION_MS = 30 * DAY_MS

export async function cleanOldTerminalJobs(now: Date = new Date()): Promise<void> {
  // Raw SQL: conditional logic in SQL per house style; updatedAt comparisons
  // are integer ms (SQLite storage format).
  const completeCutoff = now.getTime() - TERMINAL_JOB_RETENTION_MS
  const errorCutoff = now.getTime() - ERROR_JOB_RETENTION_MS
  await prisma.$executeRaw`
    DELETE FROM "Job"
    WHERE (
      ("status" IN ('complete', 'cancelled') AND "updatedAt" < ${completeCutoff})
      OR ("status" = 'error' AND "updatedAt" < ${errorCutoff})
    )
    AND "id" NOT IN (SELECT "lastJobId" FROM "Schedule" WHERE "lastJobId" IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM "Schedule" s
      WHERE s."id" = "Job"."scheduleId" AND s."nextRunAt" = "Job"."scheduledFor"
    )`
}
