// lib/jobs/handlers/client-sweep.ts
//
// D8 weekly client sweep — fan-out job. Fired by the system-client-sweep
// schedule (weekly:1@01:00). Freezes a cohort of every active client's
// registered domains BEFORE any enqueue (Codex #2), then queues one full
// site audit per member through the shared request helper, collapsing
// shared-domain duplicates and recording a per-member outcome so a retry
// reprocesses ONLY the pending/error members (idempotent fan-out).
//
// The slot (WeeklySweep.scheduledFor) is the campaign key: the handler reads
// it from its OWN job row's scheduledFor (never manufactured — Codex #4), so
// a retry re-attaches to the same WeeklySweep row and a manual re-fire must
// carry the intended scheduledFor explicitly.

import { prisma } from '@/lib/db'
import { registerJobHandler } from '../registry'
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'
import { runSweepFanout, type SweepFanoutDeps } from '@/lib/sweep/fanout'
import { CLIENT_SWEEP_JOB_TYPE } from '@/lib/sweep/types'

export { CLIENT_SWEEP_JOB_TYPE }

export interface ClientSweepDeps {
  queue: typeof queueSiteAuditRequest
  now: () => Date
}

const realDeps: ClientSweepDeps = { queue: queueSiteAuditRequest, now: () => new Date() }

export async function runClientSweep(slot: Date, deps: ClientSweepDeps = realDeps): Promise<void> {
  // Resolve the sweep Schedule row once — attribution + retention marker on
  // every enqueued audit. Missing = misconfigured boot (seedSystemSchedules
  // should always have created it) → throw. This resolution stays in the
  // scheduled wrapper; the shared fan-out core takes the id as a parameter.
  const sweepSchedule = await prisma.schedule.findUnique({
    where: { name: 'system-client-sweep' },
    select: { id: true },
  })
  if (!sweepSchedule) throw new Error('[sweep] system-client-sweep schedule row missing')

  await runSweepFanout(
    { slot, origin: 'scheduled', requestedBy: 'sweep', scheduleId: sweepSchedule.id },
    deps as SweepFanoutDeps,
  )
}

export function registerClientSweepHandler(): void {
  registerJobHandler({
    type: CLIENT_SWEEP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    timeoutMs: 120_000,
    handler: async (_payload, ctx) => {
      // The slot is the campaign key — read it from THIS job's own row. No
      // fallback slot (Codex #4): a null scheduledFor means a manual job was
      // enqueued without a slot, and manufacturing "today at 01:00" could
      // attach it to the wrong campaign.
      const job = await prisma.job.findUnique({
        where: { id: ctx.jobId },
        select: { scheduledFor: true },
      })
      if (!job?.scheduledFor) throw new Error('[sweep] client-sweep job has no scheduledFor slot')
      await runClientSweep(job.scheduledFor)
    },
  })
}
