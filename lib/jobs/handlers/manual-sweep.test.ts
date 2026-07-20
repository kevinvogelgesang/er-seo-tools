// lib/jobs/handlers/manual-sweep.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { sealOrAbandonManualSweep } from './manual-sweep'

describe('manual-sweep sealOrAbandonManualSweep (exhaustion = abandon)', () => {
  beforeEach(async () => {
    await prisma.job.deleteMany({ where: { type: 'manual-sweep' } })
    await prisma.weeklySweep.deleteMany({})
  })

  it('deletes the unsnapshotted manual row (frees the in-flight slot) — even with enqueued members', async () => {
    const slot = new Date('2030-05-01T12:00:00Z')
    await prisma.weeklySweep.create({
      data: {
        scheduledFor: slot,
        origin: 'manual',
        membershipJson: JSON.stringify({
          v: 1,
          expectedCount: 1,
          members: [{ clientId: 1, clientName: 'A', domain: 'a.edu', siteAuditId: 'sa1', outcome: 'enqueued' }],
        }),
      },
    })
    await sealOrAbandonManualSweep(slot)
    expect(await prisma.weeklySweep.findUnique({ where: { scheduledFor: slot } })).toBeNull()
  })

  it('does NOT delete a snapshotted manual row (fence)', async () => {
    const slot = new Date('2030-05-02T12:00:00Z')
    await prisma.weeklySweep.create({ data: { scheduledFor: slot, origin: 'manual', snapshotJson: '{"v":1}' } })
    await sealOrAbandonManualSweep(slot)
    expect(await prisma.weeklySweep.findUnique({ where: { scheduledFor: slot } })).not.toBeNull()
  })

  it('never touches a scheduled row at the same slot', async () => {
    const slot = new Date('2030-05-03T01:00:00Z')
    await prisma.weeklySweep.create({ data: { scheduledFor: slot, origin: 'scheduled' } })
    await sealOrAbandonManualSweep(slot)
    expect(await prisma.weeklySweep.findUnique({ where: { scheduledFor: slot } })).not.toBeNull()
  })
})
