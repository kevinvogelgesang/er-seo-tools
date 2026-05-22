import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  prisma: {
    siteAudit: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))
vi.mock('@/lib/ada-audit/audit-batch-helpers', () => ({
  closeBatchIfDrained: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { closeBatchIfDrained } = await import('@/lib/ada-audit/audit-batch-helpers')
const { POST } = await import('./route')

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const req = () =>
  new NextRequest('http://localhost/api/site-audit/x/cancel', { method: 'POST' })

beforeEach(() => {
  vi.mocked(prisma.siteAudit.findUnique).mockReset()
  vi.mocked(prisma.siteAudit.updateMany).mockReset()
  vi.mocked(closeBatchIfDrained).mockReset()
  vi.mocked(closeBatchIfDrained).mockResolvedValue(undefined)
})

describe('POST /api/site-audit/[id]/cancel', () => {
  it('flips queued → cancelled and closes the batch if drained', async () => {
    vi.mocked(prisma.siteAudit.findUnique).mockResolvedValue({
      status: 'queued',
      batchId: 'batch-1',
    } as never)
    vi.mocked(prisma.siteAudit.updateMany).mockResolvedValue({ count: 1 } as never)

    const res = await POST(req(), ctx('audit-1'))

    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; id: string; status: string }
    expect(json).toEqual({ ok: true, id: 'audit-1', status: 'cancelled' })
    expect(prisma.siteAudit.updateMany).toHaveBeenCalledWith({
      where: { id: 'audit-1', status: 'queued' },
      data: { status: 'cancelled', completedAt: expect.any(Date) },
    })
    expect(closeBatchIfDrained).toHaveBeenCalledWith('batch-1')
  })

  it('does not call closeBatchIfDrained when audit has no batch', async () => {
    vi.mocked(prisma.siteAudit.findUnique).mockResolvedValue({
      status: 'queued',
      batchId: null,
    } as never)
    vi.mocked(prisma.siteAudit.updateMany).mockResolvedValue({ count: 1 } as never)

    const res = await POST(req(), ctx('audit-1'))

    expect(res.status).toBe(200)
    expect(closeBatchIfDrained).not.toHaveBeenCalled()
  })

  it.each(['running', 'pdfs-running', 'lighthouse-running', 'complete', 'error', 'cancelled', 'pending'])(
    'returns 409 with current status when audit is %s (no write, no batch close)',
    async (status) => {
      vi.mocked(prisma.siteAudit.findUnique).mockResolvedValue({
        status,
        batchId: 'batch-1',
      } as never)
      vi.mocked(prisma.siteAudit.updateMany).mockResolvedValue({ count: 0 } as never)

      const res = await POST(req(), ctx('audit-1'))

      expect(res.status).toBe(409)
      const json = await res.json() as { currentStatus: string }
      expect(json.currentStatus).toBe(status)
      expect(closeBatchIfDrained).not.toHaveBeenCalled()
    },
  )

  it('refetches status for the 409 body when the row transitions between the existence check and the update', async () => {
    // Simulates: existence check sees 'queued', then runAudit's conditional
    // claim wins the race and flips the row to 'running', so our updateMany
    // observes count===0. The response must report the FRESH status, not
    // the stale 'queued' we read first.
    vi.mocked(prisma.siteAudit.findUnique)
      .mockResolvedValueOnce({ status: 'queued', batchId: 'batch-1' } as never)
      .mockResolvedValueOnce({ status: 'running' } as never)
    vi.mocked(prisma.siteAudit.updateMany).mockResolvedValue({ count: 0 } as never)

    const res = await POST(req(), ctx('audit-1'))

    expect(res.status).toBe(409)
    const json = await res.json() as { currentStatus: string }
    expect(json.currentStatus).toBe('running')
    expect(closeBatchIfDrained).not.toHaveBeenCalled()
  })

  it('returns 404 when the audit does not exist', async () => {
    vi.mocked(prisma.siteAudit.findUnique).mockResolvedValue(null)

    const res = await POST(req(), ctx('missing'))

    expect(res.status).toBe(404)
    expect(prisma.siteAudit.updateMany).not.toHaveBeenCalled()
    expect(closeBatchIfDrained).not.toHaveBeenCalled()
  })
})
