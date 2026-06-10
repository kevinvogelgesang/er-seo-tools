// lib/jobs/recovery.ts
//
// Generic job recovery — this is what replaces the bespoke
// resetStaleAudits/recoverQueue logic as job types migrate onto the queue.
//
// Both paths use the same fenced re-queue-or-fail: a job whose attempts are
// exhausted flips to 'error' (+ onExhausted domain settle); otherwise it goes
// back to 'queued' for the next claim. Writes are fenced on
// (status='running', attempts) so a live worker that settles concurrently
// wins — recovery never clobbers a settled job.

import { prisma } from '@/lib/db'
import { STALE_HEARTBEAT_MS } from './config'
import { runOnExhausted } from './registry'

interface RecoverableJob {
  id: string
  type: string
  payload: string
  attempts: number
  maxAttempts: number
}

/**
 * Startup pass — run BEFORE the worker starts and BEFORE recoverQueue()
 * (which decides parent-audit survival based on active jobs). Every
 * 'running' job is orphaned by definition: this is a fresh process.
 */
export async function recoverJobsOnStartup(): Promise<void> {
  const running = await prisma.job.findMany({
    where: { status: 'running' },
    select: { id: true, type: true, payload: true, attempts: true, maxAttempts: true },
  })
  for (const job of running) {
    await recoverOne(job, 'Job interrupted by restart')
  }
  if (running.length > 0) {
    console.warn(`[jobs] startup recovery handled ${running.length} orphaned running job(s)`)
  }
}

/** Periodic pass — recovers jobs whose heartbeat stopped (hung handler whose
 * timeout also failed to settle, or an event-loop stall). */
export async function sweepStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_HEARTBEAT_MS)
  const stale = await prisma.job.findMany({
    where: { status: 'running', heartbeatAt: { lt: cutoff } },
    select: { id: true, type: true, payload: true, attempts: true, maxAttempts: true },
  })
  for (const job of stale) {
    console.warn(`[jobs] stale heartbeat on job=${job.id} type=${job.type}`)
    await recoverOne(job, 'Job heartbeat went stale (worker hung or process died)')
  }
}

async function recoverOne(job: RecoverableJob, reason: string): Promise<void> {
  const fence = { id: job.id, status: 'running', attempts: job.attempts }
  try {
    if (job.attempts >= job.maxAttempts) {
      const res = await prisma.job.updateMany({
        where: fence,
        data: { status: 'error', lastError: reason, completedAt: new Date() },
      })
      if (res.count === 1) {
        await runOnExhausted(job.type, job.payload, job.id, job.attempts, reason)
      }
    } else {
      await prisma.job.updateMany({
        where: fence,
        data: { status: 'queued', lastError: reason, runAfter: new Date(), heartbeatAt: null },
      })
    }
  } catch (err) {
    console.warn(`[jobs] recovery failed for job=${job.id}:`, (err as Error).message)
  }
}
