// lib/sweep/retention.test.ts
//
// Task 11: WeeklySweep retention is a GLOBAL rule (one row per calendar
// week — no per-client scoping), so this test seeds every row far in the
// future (50+ years out, one calendar day apart) to guarantee it ranks
// above any real or other-suite data in the worker's isolated test DB
// (mirrors lib/jobs/handlers/sweep-digest.test.ts's far-future-slot
// discipline). `now` is passed explicitly to pruneWeeklySweeps so the
// 14-day dead-sweep cutoff is computed against the same fake clock the
// rows were seeded relative to.

import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { pruneWeeklySweeps } from './retention'

const DAY_MS = 24 * 60 * 60 * 1000

function anchor(): Date {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 60)
  d.setMonth(0, 1)
  d.setHours(3, 0, 0, 0)
  return d
}

function dateAt(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() - offsetMs)
}

const seededSlots: Date[] = []

async function seed(
  scheduledFor: Date,
  opts: { snapshot?: boolean; digestSent?: boolean } = {},
): Promise<void> {
  seededSlots.push(scheduledFor)
  await prisma.weeklySweep.create({
    data: {
      scheduledFor,
      snapshotJson: opts.snapshot ? JSON.stringify({ v: 1, seeded: true }) : null,
      digestSentAt: opts.digestSent ? scheduledFor : null,
    },
  })
}

async function exists(scheduledFor: Date): Promise<boolean> {
  return (await prisma.weeklySweep.findUnique({ where: { scheduledFor } })) !== null
}

afterAll(async () => {
  await prisma.weeklySweep.deleteMany({ where: { scheduledFor: { in: seededSlots } } })
})

describe('pruneWeeklySweeps', () => {
  it('keeps the newest 26 snapshotted rows and young dead sweeps; deletes older snapshotted rows and old dead sweeps', async () => {
    const now = anchor()

    // 30 snapshotted rows, one calendar day apart, offsets 1..30 days back
    // from `now`. Rule 1 ranks by scheduledFor desc, so offsets 1..26 (the
    // 26 newest) survive and offsets 27..30 (the 4 oldest) are deleted —
    // regardless of absolute age. Offset 20 (a 20-day-old snapshotted row)
    // is deliberately inside the surviving 26 to prove rule 1 is rank-based,
    // not age-based.
    const snapshotDates: Date[] = []
    for (let i = 1; i <= 30; i++) {
      const d = dateAt(now, i * DAY_MS)
      snapshotDates.push(d)
      await seed(d, { snapshot: true })
    }

    // Dead sweep (snapshotJson null, digestSentAt null) 20 days old — past
    // the 14-day dead-sweep cutoff, so it gets deleted by rule 2.
    const deadOld = dateAt(now, 20 * DAY_MS + 500)
    await seed(deadOld)

    // Dead sweep 2 days old — inside the 14-day cutoff (the current
    // in-progress week), so it must survive.
    const deadYoung = dateAt(now, 2 * DAY_MS + 500)
    await seed(deadYoung)

    await pruneWeeklySweeps(now)

    // Rule 1: exactly the 26 newest of the 30 snapshotted rows survive.
    const survivingSnapshots = await prisma.weeklySweep.findMany({
      where: { scheduledFor: { in: snapshotDates } },
      select: { scheduledFor: true },
    })
    expect(survivingSnapshots).toHaveLength(26)

    for (let i = 1; i <= 26; i++) {
      expect(await exists(snapshotDates[i - 1])).toBe(true)
    }
    for (let i = 27; i <= 30; i++) {
      expect(await exists(snapshotDates[i - 1])).toBe(false)
    }
    // The 20-day-old snapshotted row (offset 20) is inside the newest-26 —
    // survives despite being older than the 14-day dead-sweep cutoff.
    expect(await exists(snapshotDates[19])).toBe(true)

    // Rule 2: the 20-day-old dead sweep is pruned; the 2-day-old one is not.
    expect(await exists(deadOld)).toBe(false)
    expect(await exists(deadYoung)).toBe(true)
  })

  it('never deletes a row with digestSentAt set, even if old and unsnapshotted', async () => {
    const now = anchor()
    now.setDate(now.getDate() + 1) // distinct day range from the other test
    const sentOld = dateAt(now, 30 * DAY_MS)
    await seed(sentOld, { digestSent: true })

    await pruneWeeklySweeps(now)

    expect(await exists(sentOld)).toBe(true)
  })
})
