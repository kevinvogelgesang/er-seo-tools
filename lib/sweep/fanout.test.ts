// lib/sweep/fanout.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { runSweepFanout } from './fanout'

describe('runSweepFanout', () => {
  beforeEach(async () => {
    await prisma.weeklySweep.deleteMany({})
    await prisma.client.deleteMany({})
  })

  it('manual origin: queues SWEEP_SCAN_PROFILE audits, requestedBy=manual-sweep, scheduleId=null, stamps origin+fanoutCompletedAt', async () => {
    const client = await prisma.client.create({ data: { name: 'Acme', domains: JSON.stringify(['acme.edu']) } })
    const queue = vi.fn().mockResolvedValue({ kind: 'queued', id: 'sa1' })
    const slot = new Date('2030-04-10T15:00:00Z')
    await runSweepFanout(
      { slot, origin: 'manual', requestedBy: 'manual-sweep', scheduleId: null },
      { queue, now: () => slot },
    )
    expect(queue).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'acme.edu',
        clientId: client.id,
        wcagLevel: 'wcag21aa',
        seoIntent: true,
        seoOnly: false,
        requestedBy: 'manual-sweep',
        scheduleId: null,
      }),
    )
    const row = await prisma.weeklySweep.findUnique({ where: { scheduledFor: slot } })
    expect(row?.origin).toBe('manual')
    expect(row?.fanoutCompletedAt).not.toBeNull()
  })

  it('throws on cross-origin slot collision', async () => {
    const slot = new Date('2030-04-11T15:00:00Z')
    await prisma.weeklySweep.create({ data: { scheduledFor: slot, origin: 'scheduled' } })
    await expect(
      runSweepFanout(
        { slot, origin: 'manual', requestedBy: 'manual-sweep', scheduleId: null },
        { queue: vi.fn(), now: () => slot },
      ),
    ).rejects.toThrow(/origin mismatch/)
  })
})
