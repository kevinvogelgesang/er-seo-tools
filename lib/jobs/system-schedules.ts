// lib/jobs/system-schedules.ts
//
// Code-owned recurring schedules, seeded idempotently at every boot
// (instrumentation.ts, after recovery, before startJobWorker so the first
// tick sees them). Phase 4 of the durable-job-queue spec — these replace the
// setIntervals that lived in instrumentation.ts.
//
// 'system-' is a RESERVED namespace and the seed is the source of truth: a
// manual DB disable of a system-* row is temporary by design (re-enabled at
// next boot). An operator kill switch, if ever needed, is an env flag — not
// DB mutation. C2/D5 client schedules will use name = NULL (exempt from the
// unique index and from the retired-row sweep).

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { CLEANUP_JOB_TYPE } from './handlers/cleanup'
import { SCREENSHOT_SWEEP_JOB_TYPE } from './handlers/screenshot-sweep'
import { STALE_AUDIT_RESET_JOB_TYPE } from './handlers/stale-audit-reset'
import { DB_BACKUP_JOB_TYPE } from './handlers/db-backup'
import { HEALTH_ALERT_JOB_TYPE } from './handlers/health-alert'
import { ROBOTS_MONITOR_SWEEP_JOB_TYPE } from './handlers/robots-monitor-sweep'
import { CLIENT_SWEEP_JOB_TYPE, SWEEP_DIGEST_JOB_TYPE } from '@/lib/sweep/types'
import { nextRun } from './scheduler'

interface SystemScheduleDef {
  name: string
  jobType: string
  cadence: string
  /** false → first run waits for the next cadence slot instead of now. */
  immediate: boolean
}

export const SYSTEM_SCHEDULES: SystemScheduleDef[] = [
  // NOT immediate: the inline startup runCleanup() in instrumentation.ts
  // already covers "cleanup soon after deploy" — an immediate seed would
  // race two concurrent cleanups at first boot (idempotent but noisy).
  // daily@09:00 server-local = overnight for US clients (server runs UTC).
  { name: 'system-cleanup', jobType: CLEANUP_JOB_TYPE, cadence: 'daily@09:00', immediate: false },
  { name: 'system-screenshot-sweep', jobType: SCREENSHOT_SWEEP_JOB_TYPE, cadence: 'every:30m', immediate: true },
  { name: 'system-stale-audit-reset', jobType: STALE_AUDIT_RESET_JOB_TYPE, cadence: 'every:10m', immediate: true },
  // D0 ops safety. Backup at 08:00 UTC — a fresh snapshot before system-cleanup
  // (09:00) runs its retention deletes. Not immediate: the first daily slot is
  // soon enough, and a post-deploy manual backup covers the initial window.
  { name: 'system-db-backup', jobType: DB_BACKUP_JOB_TYPE, cadence: 'daily@08:00', immediate: false },
  { name: 'system-health-alert', jobType: HEALTH_ALERT_JOB_TYPE, cadence: 'every:15m', immediate: true },
  // D5: weekly robots/sitemap monitoring sweep — Monday 06:30 server-local
  // (prod host runs UTC), clear of db-backup 08:00 and cleanup 09:00.
  { name: 'system-robots-monitor', jobType: ROBOTS_MONITOR_SWEEP_JOB_TYPE, cadence: 'weekly:1@06:30', immediate: false },
  // D8: weekly client sweep — Monday 01:00 server-local (prod host runs UTC),
  // ahead of db-backup 08:00 / cleanup 09:00. Not immediate: the fan-out is a
  // heavy full-audit-per-client burst that must land on its intended slot, not
  // at deploy time.
  { name: 'system-client-sweep', jobType: CLIENT_SWEEP_JOB_TYPE, cadence: 'weekly:1@01:00', immediate: false },
  // D8: weekly digest — Monday 14:00 server-local, 13h after the 01:00 fan-out so
  // the audits have drained and their snapshots frozen. Not immediate: the digest
  // only makes sense once a real sweep has run on its slot.
  { name: 'system-sweep-digest', jobType: SWEEP_DIGEST_JOB_TYPE, cadence: 'weekly:1@14:00', immediate: false },
]

export async function seedSystemSchedules(now: Date = new Date()): Promise<void> {
  for (const def of SYSTEM_SCHEDULES) {
    let existing = await prisma.schedule.findUnique({ where: { name: def.name } })
    if (!existing) {
      try {
        await prisma.schedule.create({
          data: {
            name: def.name,
            jobType: def.jobType,
            cadence: def.cadence,
            payload: '{}',
            enabled: true,
            nextRunAt: def.immediate ? now : nextRun(def.cadence, now),
          },
        })
        continue
      } catch (err) {
        // Lost a concurrent-create race on the name unique index — fall
        // through to the update path against the winner's row. Race-safety
        // matters here: this is the reusable C2/D5 seeding primitive.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
        existing = await prisma.schedule.findUniqueOrThrow({ where: { name: def.name } })
      }
    }
    await prisma.schedule.update({
      where: { id: existing.id },
      data: {
        jobType: def.jobType,
        cadence: def.cadence,
        payload: '{}',
        enabled: true,
        // Preserve scheduling continuity across restarts; recompute only
        // when the cadence itself changed in code.
        ...(existing.cadence !== def.cadence ? { nextRunAt: nextRun(def.cadence, now) } : {}),
      },
    })
  }

  // Retired system schedules: a renamed/removed entry must not keep
  // enqueuing jobs no handler will claim — and its already-queued orphans
  // would sit 'queued' forever (retention never touches queued rows).
  const retired = await prisma.schedule.findMany({
    where: { name: { startsWith: 'system-', notIn: SYSTEM_SCHEDULES.map((s) => s.name) } },
    select: { id: true, name: true },
  })
  if (retired.length > 0) {
    const ids = retired.map((r) => r.id)
    await prisma.schedule.updateMany({ where: { id: { in: ids } }, data: { enabled: false } })
    await prisma.job.updateMany({
      where: { scheduleId: { in: ids }, status: 'queued' },
      data: { status: 'cancelled', completedAt: now },
    })
    console.warn(`[jobs] disabled retired system schedule(s): ${retired.map((r) => r.name).join(', ')}`)
  }
}
