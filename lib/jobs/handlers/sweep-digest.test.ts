// lib/jobs/handlers/sweep-digest.test.ts
//
// Task 10 (D8 weekly client sweep): the digest job handler. DB-backed, with the
// transport injected via `deps.send` (house NotifyDeps-shaped injection, NO
// module mocking — mirrors client-sweep.test's discipline over the shared dev
// DB). Every test owns its own far-future sweep slot(s) at 01:00 server-local so
// the exact-slot findUnique never contends with real rows or parallel suites.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import type { SendArgs } from '@/lib/notify/transport'
import type { SweepMembership, SweepSnapshot } from '@/lib/sweep/types'
import {
  runSweepDigest,
  registerSweepDigestHandler,
  SWEEP_DIGEST_JOB_TYPE,
  type SweepDigestDeps,
} from './sweep-digest'
import { getJobHandler } from '../registry'

// --- slot allocation -------------------------------------------------------
// scheduledFor is @unique; the handler derives the sweep slot from the digest
// slot via setHours(1,0,0,0), so each test needs a DISTINCT calendar day at
// 01:00 local. Base 10 years out to stay clear of real + other suites' rows.
const sweepSlots: Date[] = []
let dayCounter = 0
function nextSweepSlot(): Date {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 10)
  d.setHours(1, 0, 0, 0)
  d.setDate(d.getDate() + dayCounter++)
  sweepSlots.push(d)
  return d
}
/** The 14:00 digest slot whose setHours(1,…) normalizes back to `sweepSlot`. */
function digestSlotFor(sweepSlot: Date): Date {
  const d = new Date(sweepSlot)
  d.setHours(14, 0, 0, 0)
  return d
}

function mkSnapshot(actionable: number): SweepSnapshot {
  return {
    v: 1,
    snapshotAt: new Date().toISOString(),
    totals: {
      actionable,
      delta: null,
      comparablePairs: 0,
      newCount: 0,
      worsenedCount: 0,
      resolvedCount: 0,
      scanned: 0,
      expected: 0,
      comparableDomains: 0,
      partialDomains: 0,
      failedDomains: 0,
    },
    coverage: [],
    groups: [],
    staleGroups: [],
    resolvedGroups: [],
    shortlist: [],
    semanticKeys: [],
  }
}

async function seedSweep(
  slot: Date,
  opts: { snapshot?: SweepSnapshot | null; membership?: SweepMembership | null; digestSentAt?: Date | null } = {},
): Promise<void> {
  await prisma.weeklySweep.create({
    data: {
      scheduledFor: slot,
      startedAt: new Date(),
      membershipJson: opts.membership ? JSON.stringify(opts.membership) : null,
      snapshotJson: opts.snapshot ? JSON.stringify(opts.snapshot) : null,
      digestSentAt: opts.digestSentAt ?? null,
    },
  })
}

function makeSend(impl?: (args: SendArgs) => Promise<void>) {
  const calls: SendArgs[] = []
  const fn = (async (args: SendArgs) => {
    calls.push(args)
    if (impl) await impl(args)
  }) as SweepDigestDeps['send']
  return { fn, calls }
}

const now = () => new Date()

const OLD_ENV = process.env
beforeEach(() => {
  process.env = { ...OLD_ENV, MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'mg.x', SUPPORT_NOTIFY_EMAIL: 'support@example.com' }
})
afterEach(() => {
  process.env = OLD_ENV
})

afterAll(async () => {
  await prisma.weeklySweep.deleteMany({ where: { scheduledFor: { in: sweepSlots } } })
})

describe('runSweepDigest', () => {
  it('selects the sweep by the EXACT derived 01:00 slot — never a neighbour', async () => {
    const slotA = nextSweepSlot()
    const slotB = nextSweepSlot()
    await seedSweep(slotA, { snapshot: mkSnapshot(7) })
    await seedSweep(slotB, { snapshot: mkSnapshot(3) })

    const send = makeSend()
    await runSweepDigest(digestSlotFor(slotB), { send: send.fn, now })

    expect(send.calls).toHaveLength(1)
    expect(send.calls[0].to).toBe('support@example.com')
    expect(send.calls[0].content.subject).toContain('3 actionable')
    expect(send.calls[0].content.subject).not.toContain('7 actionable')

    const rowA = await prisma.weeklySweep.findUniqueOrThrow({ where: { scheduledFor: slotA } })
    const rowB = await prisma.weeklySweep.findUniqueOrThrow({ where: { scheduledFor: slotB } })
    expect(rowA.digestSentAt).toBeNull()
    expect(rowB.digestSentAt).not.toBeNull()
  })

  it('missing sweep row → no send, no throw (ops signal, not retryable)', async () => {
    const slot = nextSweepSlot() // never seeded
    const send = makeSend()
    await expect(runSweepDigest(digestSlotFor(slot), { send: send.fn, now })).resolves.toBeUndefined()
    expect(send.calls).toHaveLength(0)
  })

  it('computes + publishes the snapshot when snapshotJson is null, then sends the winner', async () => {
    const slot = nextSweepSlot()
    const membership: SweepMembership = {
      v: 1,
      expectedCount: 1,
      // siteAuditId null → not scanned; compute yields an empty (0-actionable) snapshot.
      members: [{ clientId: 999_001, clientName: 'seed', domain: 'compute.example', siteAuditId: null, outcome: 'enqueued' }],
    }
    await seedSweep(slot, { membership, snapshot: null })

    const send = makeSend()
    await runSweepDigest(digestSlotFor(slot), { send: send.fn, now })

    const row = await prisma.weeklySweep.findUniqueOrThrow({ where: { scheduledFor: slot } })
    expect(row.snapshotJson).not.toBeNull() // published
    expect(row.digestSentAt).not.toBeNull()
    expect(send.calls).toHaveLength(1)
    expect(send.calls[0].content.subject).toContain('0 actionable')
  })

  it('already-sent marker → no second send', async () => {
    const slot = nextSweepSlot()
    await seedSweep(slot, { snapshot: mkSnapshot(2), digestSentAt: new Date() })

    const send = makeSend()
    await runSweepDigest(digestSlotFor(slot), { send: send.fn, now })
    expect(send.calls).toHaveLength(0)
  })

  it('dark env (notify disabled) → no send AND no stamp', async () => {
    const slot = nextSweepSlot()
    await seedSweep(slot, { snapshot: mkSnapshot(4) })
    delete process.env.MAILGUN_API_KEY

    const send = makeSend()
    await runSweepDigest(digestSlotFor(slot), { send: send.fn, now })

    expect(send.calls).toHaveLength(0)
    const row = await prisma.weeklySweep.findUniqueOrThrow({ where: { scheduledFor: slot } })
    expect(row.digestSentAt).toBeNull() // permanent suppression — never stamped
  })

  it('transport throw → marker stays unstamped and the error propagates (worker retries)', async () => {
    const slot = nextSweepSlot()
    await seedSweep(slot, { snapshot: mkSnapshot(5) })

    const send = makeSend(async () => {
      throw new Error('smtp down')
    })
    await expect(runSweepDigest(digestSlotFor(slot), { send: send.fn, now })).rejects.toThrow('smtp down')

    const row = await prisma.weeklySweep.findUniqueOrThrow({ where: { scheduledFor: slot } })
    expect(row.digestSentAt).toBeNull()
  })
})

describe('registerSweepDigestHandler', () => {
  it('registers a concurrency-1, 3-attempt handler', () => {
    registerSweepDigestHandler()
    const h = getJobHandler(SWEEP_DIGEST_JOB_TYPE)
    expect(h).toBeDefined()
    expect(h!.concurrency).toBe(1)
    expect(h!.maxAttempts).toBe(3)
    expect(h!.timeoutMs).toBe(120_000)
  })

  it('a job with no scheduledFor slot throws (no-fallback, mirrors Task 5)', async () => {
    registerSweepDigestHandler()
    const h = getJobHandler(SWEEP_DIGEST_JOB_TYPE)!
    const job = await prisma.job.create({
      data: { type: SWEEP_DIGEST_JOB_TYPE, payload: '{}', status: 'running', scheduledFor: null },
    })
    const ctx = {
      jobId: job.id,
      attempt: 1,
      signal: new AbortController().signal,
      reportProgress: () => {},
    }
    await expect(h.handler({}, ctx)).rejects.toThrow('sweep-digest job has no scheduledFor slot')
    await prisma.job.delete({ where: { id: job.id } })
  })
})
