// lib/sweep/origin-migration.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'

describe('WeeklySweep origin + in-flight index', () => {
  // The partial index makes a leftover in-flight manual row fail the next
  // test's create — clear between every test.
  beforeEach(async () => {
    await prisma.weeklySweep.deleteMany({})
  })

  it('defaults new rows to scheduled', async () => {
    const row = await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-01-06T01:00:00Z') } })
    expect(row.origin).toBe('scheduled')
  })

  it('permits exactly one in-flight (snapshotJson null) manual row', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-02-01T10:00:00Z'), origin: 'manual' } })
    await expect(
      prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-02-01T11:00:00Z'), origin: 'manual' } }),
    ).rejects.toThrow() // P2002 on the partial unique index
  })

  it('allows a second manual row once the first is snapshotted', async () => {
    await prisma.weeklySweep.create({
      data: { scheduledFor: new Date('2030-03-01T10:00:00Z'), origin: 'manual', snapshotJson: '{"v":1}' },
    })
    await expect(
      prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-03-01T11:00:00Z'), origin: 'manual' } }),
    ).resolves.toBeTruthy()
  })

  it('does not constrain scheduled rows (many allowed)', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-04-01T01:00:00Z'), origin: 'scheduled' } })
    await expect(
      prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-04-08T01:00:00Z'), origin: 'scheduled' } }),
    ).resolves.toBeTruthy()
  })
})
