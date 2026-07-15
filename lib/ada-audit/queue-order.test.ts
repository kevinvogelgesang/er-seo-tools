// lib/ada-audit/queue-order.test.ts
// DB-backed against the local SQLite dev DB. House convention (copied from
// queue-manager.test.ts): PREFIX-scoped seeds + stray queued/transient
// neutralization, because position math over a shared DB is otherwise flaky.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import {
  PROSPECT_DISCOVER_PRIORITY,
  compareQueuedAudits,
  findNextQueuedAudit,
  queuedAheadCount,
} from './queue-order'

const PREFIX = 'pr3-order-'

async function clearTestState() {
  const prospects = await prisma.prospect.findMany({
    where: { domain: { startsWith: PREFIX } },
    select: { id: true },
  })
  await prisma.siteAudit.deleteMany({
    where: {
      OR: [
        { domain: { startsWith: PREFIX } },
        { prospectId: { in: prospects.map((p) => p.id) } },
      ],
    },
  })
  await prisma.prospect.deleteMany({ where: { id: { in: prospects.map((p) => p.id) } } })
  // Neutralize stray rows from other test files in the shared dev DB —
  // findNextQueuedAudit/queuedAheadCount scan ALL queued rows.
  await prisma.siteAudit.updateMany({
    where: { status: { in: ['running', 'pdfs-running', 'lighthouse-running'] } },
    data: { status: 'error', error: 'neutralized by queue-order.test.ts (one-active invariant)' },
  })
  await prisma.siteAudit.updateMany({
    where: { status: 'queued' },
    data: { status: 'cancelled' },
  })
}

async function seedQueued(name: string, opts: { prospectId?: number | null; createdAt?: Date } = {}) {
  return prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}${name}`,
      status: 'queued',
      wcagLevel: 'wcag21aa',
      prospectId: opts.prospectId ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  })
}

async function seedProspect(name: string) {
  return prisma.prospect.create({ data: { name, domain: `${PREFIX}${name}.test` } })
}

// beforeEach alone would leak this file's FINAL seeded queued rows into the
// shared dev DB for whatever test file runs next — clean on the way out too.
afterAll(clearTestState)

describe('compareQueuedAudits — pure comparator', () => {
  const at = (ms: number) => new Date(ms)

  it('ranks prospect-owned ahead of non-prospect regardless of createdAt', () => {
    const prospect = { id: 'b', createdAt: at(2000), prospectId: 7 }
    const older = { id: 'a', createdAt: at(1000), prospectId: null }
    expect(compareQueuedAudits(prospect, older)).toBeLessThan(0)
    expect(compareQueuedAudits(older, prospect)).toBeGreaterThan(0)
  })

  it('within a class, orders by createdAt ASC then id ASC', () => {
    const a = { id: 'a', createdAt: at(1000), prospectId: null }
    const b = { id: 'b', createdAt: at(2000), prospectId: null }
    const tieA = { id: 'a', createdAt: at(1000), prospectId: 3 }
    const tieB = { id: 'b', createdAt: at(1000), prospectId: 4 }
    expect(compareQueuedAudits(a, b)).toBeLessThan(0)
    expect(compareQueuedAudits(tieA, tieB)).toBeLessThan(0)
    expect(compareQueuedAudits(tieA, tieA)).toBe(0)
  })
})

describe('findNextQueuedAudit', () => {
  beforeEach(clearTestState)

  it('returns null when nothing is queued', async () => {
    expect(await findNextQueuedAudit()).toBeNull()
  })

  it('picks a newer prospect-owned audit over an older non-prospect one', async () => {
    await seedQueued('older-client', { createdAt: new Date(Date.now() - 60_000) })
    const prospect = await seedProspect('next')
    const pAudit = await seedQueued('prospect', { prospectId: prospect.id })
    const next = await findNextQueuedAudit()
    expect(next?.id).toBe(pAudit.id)
    expect(next?.prospectId).toBe(prospect.id)
  })

  it('falls back to the oldest non-prospect audit when no prospect scan is queued', async () => {
    const older = await seedQueued('older', { createdAt: new Date(Date.now() - 60_000) })
    await seedQueued('newer')
    const next = await findNextQueuedAudit()
    expect(next?.id).toBe(older.id)
    expect(next?.prospectId).toBeNull()
  })
})

describe('queuedAheadCount — agrees with the comparator', () => {
  beforeEach(clearTestState)

  it('position (aheadCount + 1) matches the comparator-sorted index for a mixed queue', async () => {
    const now = Date.now()
    const p1 = await seedProspect('p1')
    const p2 = await seedProspect('p2')
    const rows = [
      await seedQueued('client-old', { createdAt: new Date(now - 300_000) }),
      await seedQueued('prospect-late', { prospectId: p2.id, createdAt: new Date(now - 50_000) }),
      await seedQueued('client-new', { createdAt: new Date(now - 100_000) }),
      await seedQueued('prospect-early', { prospectId: p1.id, createdAt: new Date(now - 200_000) }),
    ]
    const sorted = [...rows].sort(compareQueuedAudits)
    // Expected total order: prospect-early, prospect-late, client-old, client-new.
    expect(sorted.map((r) => r.domain)).toEqual([
      `${PREFIX}prospect-early`,
      `${PREFIX}prospect-late`,
      `${PREFIX}client-old`,
      `${PREFIX}client-new`,
    ])
    for (const [index, row] of sorted.entries()) {
      expect(await queuedAheadCount(row)).toBe(index)
    }
  })

  it('only counts queued rows (running/complete rows never rank ahead)', async () => {
    const target = await seedQueued('only-queued')
    await prisma.siteAudit.create({
      data: { domain: `${PREFIX}done`, status: 'complete', wcagLevel: 'wcag21aa', createdAt: new Date(Date.now() - 60_000) },
    })
    expect(await queuedAheadCount(target)).toBe(0)
  })
})

describe('PROSPECT_DISCOVER_PRIORITY', () => {
  it('is 1 (default Job.priority is 0 — higher claims first)', () => {
    expect(PROSPECT_DISCOVER_PRIORITY).toBe(1)
  })
})
