import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const req = () =>
  new NextRequest('http://localhost/api/site-audit/bulk-queue', { method: 'POST' })

// Mock prisma.client.findMany so the route operates on a known seed set.
// Mock queueSiteAuditRequest so we don't touch the real queue.
vi.mock('@/lib/db', () => ({
  prisma: {
    client: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/ada-audit/queue-request', () => ({
  queueSiteAuditRequest: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { queueSiteAuditRequest } = await import('@/lib/ada-audit/queue-request')
const { POST } = await import('./route')

beforeEach(() => {
  vi.mocked(prisma.client.findMany).mockReset()
  vi.mocked(queueSiteAuditRequest).mockReset()
})

describe('POST /api/site-audit/bulk-queue', () => {
  it('returns 400 missing_domains when at least one client has no domain', async () => {
    vi.mocked(prisma.client.findMany).mockResolvedValue([
      { id: 1, name: 'With Domain', domains: JSON.stringify(['ok.example']) },
      { id: 2, name: 'No Domain', domains: '[]' },
    ] as never)

    const res = await POST()
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string; clientsWithoutDomains: { id: number; name: string }[] }
    expect(json.error).toBe('missing_domains')
    expect(json.clientsWithoutDomains.map((c) => c.name)).toEqual(['No Domain'])
    // Pre-check failure → no queue attempts
    expect(queueSiteAuditRequest).not.toHaveBeenCalled()
  })

  it('queues all clients when all have domains', async () => {
    vi.mocked(prisma.client.findMany).mockResolvedValue([
      { id: 1, name: 'A', domains: JSON.stringify(['a.example']) },
      { id: 2, name: 'B', domains: JSON.stringify(['b.example']) },
    ] as never)
    vi.mocked(queueSiteAuditRequest)
      .mockResolvedValueOnce({ kind: 'queued', id: 'audit-1' })
      .mockResolvedValueOnce({ kind: 'queued', id: 'audit-2' })

    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json() as { queued: { clientId: number; auditId: string }[]; skipped: unknown[] }
    expect(json.queued).toEqual([
      { clientId: 1, auditId: 'audit-1' },
      { clientId: 2, auditId: 'audit-2' },
    ])
    expect(json.skipped).toEqual([])
  })

  it('marks duplicates as skipped without failing the whole batch', async () => {
    vi.mocked(prisma.client.findMany).mockResolvedValue([
      { id: 1, name: 'Dup', domains: JSON.stringify(['dup.example']) },
      { id: 2, name: 'Fresh', domains: JSON.stringify(['fresh.example']) },
    ] as never)
    vi.mocked(queueSiteAuditRequest)
      .mockResolvedValueOnce({ kind: 'duplicate', existingId: 'existing-audit-id' })
      .mockResolvedValueOnce({ kind: 'queued', id: 'audit-2' })

    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json() as { queued: { clientId: number; auditId: string }[]; skipped: { clientId: number; reason: string }[] }
    expect(json.queued).toEqual([{ clientId: 2, auditId: 'audit-2' }])
    expect(json.skipped).toEqual([
      expect.objectContaining({ clientId: 1, reason: expect.stringContaining('already') }),
    ])
  })

  it('treats clients with whitespace-only domain entries as missing-domain', async () => {
    vi.mocked(prisma.client.findMany).mockResolvedValue([
      { id: 1, name: 'Whitespace', domains: JSON.stringify(['   ', '']) },
    ] as never)
    const res = await POST()
    expect(res.status).toBe(400)
    const json = await res.json() as { clientsWithoutDomains: { id: number }[] }
    expect(json.clientsWithoutDomains.map((c) => c.id)).toEqual([1])
  })
})
