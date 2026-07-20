// app/api/site-audit/bulk-queue/route.ts
//
// "Queue all clients" — repurposed (2026-07-20) into a MANUAL full-cohort sweep:
// freezes a WeeklySweep(origin='manual') row and enqueues the manual-sweep
// fan-out (full ADA+SEO of every registered client domain). Refreshes /issues
// silently on drain (no email). Domainless clients are skipped by buildCohort
// (no hard 400 anymore). Cookie-gated by global middleware.

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { enqueueJob } from '@/lib/jobs/queue'
import { MANUAL_SWEEP_JOB_TYPE } from '@/lib/jobs/handlers/manual-sweep'

export const dynamic = 'force-dynamic'

function isP2002(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

async function inFlightManual() {
  return prisma.weeklySweep.findFirst({ where: { origin: 'manual', snapshotJson: null }, select: { id: true } })
}

export const POST = withRoute(async () => {
  if (await inFlightManual()) throw new HttpError(409, 'manual_sweep_in_progress')

  // Create the manual slot row. Deterministic retry slots from ONE base
  // (baseMs+attempt) — two immediate new Date() can repeat the same ms. On the
  // partial-index P2002, 409 iff an in-flight manual row exists; on a bare
  // scheduledFor ms-collision, retry; if both retries collide with NO in-flight
  // manual row, RETHROW the last P2002 (never a false 409).
  const baseMs = Date.now()
  let row: { id: number; scheduledFor: Date } | null = null
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3 && !row; attempt++) {
    const slot = new Date(baseMs + attempt)
    try {
      row = await prisma.weeklySweep.create({
        data: { scheduledFor: slot, origin: 'manual', startedAt: slot },
        select: { id: true, scheduledFor: true },
      })
    } catch (err) {
      if (!isP2002(err)) throw err
      lastErr = err
      if (await inFlightManual()) throw new HttpError(409, 'manual_sweep_in_progress')
      // else a bare scheduledFor collision — loop retries with baseMs+attempt.
    }
  }
  if (!row) throw lastErr ?? new HttpError(500, 'manual_sweep_create_failed')

  const iso = row.scheduledFor.toISOString()
  try {
    await enqueueJob({
      type: MANUAL_SWEEP_JOB_TYPE,
      payload: { scheduledFor: iso },
      dedupKey: `manual-sweep:${iso}`,
      groupKey: `manual-sweep:${iso}`,
    })
  } catch (err) {
    // Enqueue failed — delete the just-created row so the partial index doesn't
    // block future manual sweeps. (A crash BEFORE this line is covered by
    // recoverManualSweeps, which waits out a grace period.)
    await prisma.weeklySweep.deleteMany({ where: { id: row.id, snapshotJson: null, membershipJson: null } })
    throw err
  }

  return NextResponse.json({ started: true, scheduledFor: iso })
})
