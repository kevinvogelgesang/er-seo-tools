// lib/jobs/handlers/sweep-digest.ts
//
// D8 weekly client sweep — digest job. Fired by the system-sweep-digest schedule
// (weekly:1@14:00), it summarizes the sweep that fanned out earlier THE SAME DAY
// (system-client-sweep at 01:00) and emails the support inbox one digest.
//
// The digest job's OWN scheduledFor (14:00) is the campaign key; the sweep it
// summarizes lives at 01:00 the same server-local day. Slot derivation is
// server-local (setHours, NOT Date.UTC — Codex plan-fix #18): it matches the
// scheduler's cadence math and diverges only on a non-UTC dev host, which is the
// point. No fallback slot — a null scheduledFor throws (mirrors client-sweep).
//
// Missing sweep row = an ops signal (a sweep that never fired), NOT a retryable
// error: logError + no-op (no send, no throw). Everything else (transport, DB)
// THROWS so the worker retries; the durable `digestSentAt` marker keeps the send
// at-least-once with a narrow duplicate window (D7 pattern). The dark gate is a
// PERMANENT suppression with NO stamp — flipping notify env on later must still
// let this week's digest send. The snapshot is computed + race-safe published
// even when notify is dark, so /issues has a frozen payload regardless of email.

import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { registerJobHandler } from '../registry'
import { isNotifyEnabled, supportNotifyEmail } from '@/lib/notify/config'
import { sendEmail, type SendArgs } from '@/lib/notify/transport'
import { buildSweepDigestEmail } from '@/lib/notify/sweep-digest-content'
import { computeSweepSnapshot, loadPreviousSnapshot, publishSweepSnapshot } from '@/lib/sweep/snapshot'
import { SWEEP_DIGEST_JOB_TYPE, SWEEP_SLOT_HOUR, parseSnapshot } from '@/lib/sweep/types'

export { SWEEP_DIGEST_JOB_TYPE }

export interface SweepDigestDeps {
  /** Injected transport (real = a thin sendEmail wrapper); tests substitute a fake. */
  send: (args: SendArgs) => Promise<void>
  now: () => Date
}

const realDeps: SweepDigestDeps = {
  send: (args) => sendEmail(args),
  now: () => new Date(),
}

export async function runSweepDigest(digestSlot: Date, deps: SweepDigestDeps = realDeps): Promise<void> {
  // Server-local sweep-slot derivation (Codex plan-fix #18): the sweep fired at
  // 01:00 the same calendar day the digest fires (14:00).
  const sweepSlot = new Date(digestSlot)
  sweepSlot.setHours(SWEEP_SLOT_HOUR, 0, 0, 0)

  const sweep = await prisma.weeklySweep.findUnique({ where: { scheduledFor: sweepSlot } })
  if (!sweep) {
    // A sweep that never fired is an ops signal, not a retryable error.
    logError(
      { subsystem: 'jobs', job: 'sweep-digest', sweepSlot: sweepSlot.toISOString() },
      new Error('[sweep] digest fired but no WeeklySweep row for its slot'),
    )
    return
  }

  // Resolve the render payload: prefer the frozen snapshot; otherwise compute and
  // race-safe publish, then use the WINNER's payload (never the local compute).
  let snapshot = parseSnapshot(sweep.snapshotJson)
  if (!snapshot) {
    const computed = await computeSweepSnapshot(sweep, await loadPreviousSnapshot(sweepSlot), deps.now())
    snapshot = await publishSweepSnapshot(sweep.id, computed)
  }

  if (sweep.digestSentAt) return // already sent — no second email

  if (!isNotifyEnabled()) return // dark — permanent suppression, NO stamp

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || null
  const content = buildSweepDigestEmail(snapshot, appUrl)
  // Transport errors THROW; the marker is stamped only AFTER a successful send.
  await deps.send({ to: supportNotifyEmail(), content })
  await prisma.weeklySweep.updateMany({
    where: { id: sweep.id, digestSentAt: null },
    data: { digestSentAt: deps.now() },
  })
}

export function registerSweepDigestHandler(): void {
  registerJobHandler({
    type: SWEEP_DIGEST_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3,
    timeoutMs: 120_000,
    handler: async (_payload, ctx) => {
      // The digest slot is the campaign key — read it from THIS job's own row. No
      // fallback (mirrors client-sweep): a null scheduledFor means a manual job
      // was enqueued without a slot, and manufacturing one could misattribute it.
      const job = await prisma.job.findUnique({
        where: { id: ctx.jobId },
        select: { scheduledFor: true },
      })
      if (!job?.scheduledFor) throw new Error('[sweep] sweep-digest job has no scheduledFor slot')
      await runSweepDigest(job.scheduledFor)
    },
  })
}
