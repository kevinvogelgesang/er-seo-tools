// lib/jobs/handlers/manual-sweep.ts
//
// Manual full-cohort sweep fan-out. Enqueued by the repurposed
// POST /api/site-audit/bulk-queue. Reads its slot from the PAYLOAD (a manual
// job carries no schedule slot), runs the shared fan-out core with
// origin='manual', requestedBy='manual-sweep', scheduleId=null. No email, no
// snapshot here — advanceManualSweeps (stale-audit-reset) computes on drain.

import { prisma } from '@/lib/db'
import { registerJobHandler } from '../registry'
import { runSweepFanout } from '@/lib/sweep/fanout'
import { logError } from '@/lib/log'

export const MANUAL_SWEEP_JOB_TYPE = 'manual-sweep'

function slotFromPayload(payload: unknown): Date {
  const iso = (payload as { scheduledFor?: string })?.scheduledFor
  const d = iso ? new Date(iso) : new Date(NaN)
  if (Number.isNaN(d.getTime())) throw new Error('[manual-sweep] payload missing valid scheduledFor')
  return d
}

/**
 * Exhaustion = ABANDON, not seal. onExhausted can fire after a TIMEOUT, where
 * the timed-out handler may STILL be queuing members — sealing (stamping
 * fanoutCompletedAt) would let the advancer publish a snapshot from a
 * half-frozen membership. So we DELETE the unsnapshotted manual row outright
 * (fenced), freeing the one-in-flight-manual slot. Any members that already
 * enqueued simply run as ordinary audits (harmless); the operator can re-click,
 * and a re-run reuses those in-flight audits via the duplicate/shared-domain
 * path. Exported for direct unit testing.
 */
export async function sealOrAbandonManualSweep(slot: Date): Promise<void> {
  try {
    await prisma.weeklySweep.deleteMany({
      where: { scheduledFor: slot, origin: 'manual', snapshotJson: null },
    })
  } catch (err) {
    logError({ subsystem: 'sweep', scope: 'manual-sweep.onExhausted' }, err)
  }
}

export function registerManualSweepHandler(): void {
  registerJobHandler({
    type: MANUAL_SWEEP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    timeoutMs: 120_000,
    handler: async (payload) => {
      const slot = slotFromPayload(payload)
      await runSweepFanout({ slot, origin: 'manual', requestedBy: 'manual-sweep', scheduleId: null })
    },
    // ctx (JobExhaustedContext) is available but unused.
    onExhausted: async (payload) => {
      try {
        await sealOrAbandonManualSweep(slotFromPayload(payload))
      } catch (err) {
        logError({ subsystem: 'sweep', scope: 'manual-sweep.onExhausted' }, err)
      }
    },
  })
}
