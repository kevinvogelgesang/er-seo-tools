// app/api/site-audit/bulk-queue/route.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'

describe('POST /api/site-audit/bulk-queue (manual sweep)', () => {
  beforeEach(async () => {
    await prisma.job.deleteMany({ where: { type: 'manual-sweep' } })
    await prisma.weeklySweep.deleteMany({})
  })

  it('creates a manual WeeklySweep row and enqueues manual-sweep', async () => {
    const { POST } = await import('./route')
    const res = await POST(new Request('http://x/api/site-audit/bulk-queue', { method: 'POST' }) as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { started: boolean; scheduledFor: string }
    expect(body.started).toBe(true)
    const row = await prisma.weeklySweep.findUnique({ where: { scheduledFor: new Date(body.scheduledFor) } })
    expect(row?.origin).toBe('manual')
    const job = await prisma.job.findFirst({ where: { type: 'manual-sweep' } })
    expect(job).not.toBeNull()
  })

  it('returns 409 when a manual sweep is already in flight', async () => {
    await prisma.weeklySweep.create({ data: { scheduledFor: new Date('2030-06-01T10:00:00Z'), origin: 'manual' } })
    const { POST } = await import('./route')
    const res = await POST(new Request('http://x', { method: 'POST' }) as never)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe('manual_sweep_in_progress')
  })
})
