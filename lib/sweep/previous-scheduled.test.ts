// lib/sweep/previous-scheduled.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { loadPreviousScheduledSnapshot, loadPreviousSnapshot } from './snapshot'

const SNAP = (at: string) =>
  JSON.stringify({
    v: 1,
    snapshotAt: at,
    totals: {
      actionable: 0, delta: null, comparablePairs: 0, newCount: 0, worsenedCount: 0,
      resolvedCount: 0, scanned: 0, expected: 0, comparableDomains: 0, partialDomains: 0, failedDomains: 0,
    },
    coverage: [], groups: [], staleGroups: [], resolvedGroups: [], shortlist: [], semanticKeys: [],
  })

describe('loadPreviousScheduledSnapshot', () => {
  beforeEach(async () => {
    await prisma.weeklySweep.deleteMany({})
  })

  it('returns the newest scheduled snapshot before `before`, ignoring manual + unsnapshotted', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-07-01T01:00:00Z'), origin: 'scheduled', snapshotJson: SNAP('sun') } })
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-07-03T15:00:00Z'), origin: 'manual', snapshotJson: SNAP('wed') } })
    const prev = await loadPreviousScheduledSnapshot(new Date('2030-07-04T15:00:00Z'))
    expect(prev?.snapshotAt).toBe('sun') // NOT the manual 'wed'
  })

  it('falls through a corrupt newest scheduled row to the next valid one', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-08-01T01:00:00Z'), origin: 'scheduled', snapshotJson: SNAP('older') } })
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-08-08T01:00:00Z'), origin: 'scheduled', snapshotJson: '{bad json' } })
    const prev = await loadPreviousScheduledSnapshot(new Date('2030-08-10T00:00:00Z'))
    expect(prev?.snapshotAt).toBe('older')
  })

  it('returns null when no scheduled snapshot exists before `before`', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-09-01T15:00:00Z'), origin: 'manual', snapshotJson: SNAP('m') } })
    expect(await loadPreviousScheduledSnapshot(new Date('2030-09-02T00:00:00Z'))).toBeNull()
  })
})

describe('loadPreviousSnapshot (email −7d baseline, origin-scheduled only)', () => {
  beforeEach(async () => {
    await prisma.weeklySweep.deleteMany({})
  })

  it('ignores a manual row that somehow shares the exact −7d slot', async () => {
    const sunday = new Date('2030-10-13T01:00:00Z')
    const prevSlot = new Date(sunday.getTime() - 7 * 24 * 60 * 60 * 1000)
    await prisma.weeklySweep.create({ data: { scheduledFor: prevSlot, origin: 'manual', snapshotJson: SNAP('manual-at-slot') } })
    expect(await loadPreviousSnapshot(sunday)).toBeNull() // no scheduled row there
  })
})
