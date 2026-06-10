// lib/jobs/queue.ts
//
// Enqueue + group helpers for the durable job queue.
//
// Dedup is active-window only (partial unique index jobs_active_dedup on
// (type, dedupKey) WHERE status IN ('queued','running')). Scheduled jobs
// additionally carry (scheduleId, scheduledFor) under a real unique index
// that survives terminal status — exactly-once-per-slot.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { JOB_ACTIVE_STATUSES } from './types'
import type { EnqueueJobOptions, EnqueueJobResult } from './types'

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function enqueueJob(opts: EnqueueJobOptions): Promise<EnqueueJobResult> {
  const data = {
    type: opts.type,
    payload: JSON.stringify(opts.payload ?? {}),
    dedupKey: opts.dedupKey ?? null,
    groupKey: opts.groupKey ?? null,
    priority: opts.priority ?? 0,
    runAfter: opts.runAfter ?? new Date(),
    ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
    scheduleId: opts.scheduleId ?? null,
    scheduledFor: opts.scheduledFor ?? null,
  }

  // Total dedup-race handling: P2002 → look up the twin; if the twin went
  // terminal between our create and the lookup (active-window row vanished),
  // retry the create once. Never assume P2002 leaves an active row visible.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const job = await prisma.job.create({ data })
      kickWorkerSoon()
      return { id: job.id, deduped: false }
    } catch (err) {
      if (!isUniqueViolation(err)) throw err

      if (opts.scheduleId && opts.scheduledFor) {
        // Durable slot index — the twin exists regardless of status.
        const slotTwin = await prisma.job.findFirst({
          where: { scheduleId: opts.scheduleId, scheduledFor: opts.scheduledFor },
          select: { id: true },
        })
        if (slotTwin) return { id: slotTwin.id, deduped: true }
      }

      if (opts.dedupKey) {
        const activeTwin = await prisma.job.findFirst({
          where: { type: opts.type, dedupKey: opts.dedupKey, status: { in: [...JOB_ACTIVE_STATUSES] } },
          select: { id: true },
        })
        if (activeTwin) return { id: activeTwin.id, deduped: true }
        continue // twin went terminal — retry the create once
      }

      throw err
    }
  }
  throw new Error(`enqueueJob: dedup race did not settle for type=${opts.type} dedupKey=${opts.dedupKey}`)
}

/** Cancel queued jobs for a group. Running jobs finish; their fenced/conditional writes no-op if the owner is gone. */
export async function cancelJobsByGroup(groupKey: string): Promise<number> {
  const res = await prisma.job.updateMany({
    where: { groupKey, status: 'queued' },
    data: { status: 'cancelled', completedAt: new Date() },
  })
  return res.count
}

/**
 * Outstanding (queued + running) jobs for a group — IGNORING runAfter, so
 * backoff-delayed jobs still count. Recovery uses this to decide whether a
 * parent is still being drained. Never counts terminal rows.
 */
export async function countActiveJobsByGroup(groupKey: string): Promise<number> {
  return prisma.job.count({
    where: { groupKey, status: { in: [...JOB_ACTIVE_STATUSES] } },
  })
}

// Dynamic import: avoids a static queue → worker edge (worker dynamically
// imports handlers, which import modules that import this file).
function kickWorkerSoon(): void {
  void import('./worker')
    .then((w) => w.kickJobWorker())
    .catch(() => {})
}
