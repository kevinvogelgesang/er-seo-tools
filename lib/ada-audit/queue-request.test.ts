import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock enqueueAudit so success-path tests don't fire processNext() or
// create an open AuditBatch row in the dev DB.
vi.mock('@/lib/ada-audit/queue-manager', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ada-audit/queue-manager')>('@/lib/ada-audit/queue-manager')
  return {
    ...actual,
    enqueueAudit: vi.fn(async () => ({ id: 'mock-audit-id', status: 'queued' as const })),
  }
})

const { prisma } = await import('@/lib/db')
const queueManager = await import('@/lib/ada-audit/queue-manager')
const { queueSiteAuditRequest } = await import('./queue-request')

describe('queueSiteAuditRequest', () => {
  beforeEach(async () => {
    vi.mocked(queueManager.enqueueAudit).mockClear()
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'qr-test-' } } })
    await prisma.client.deleteMany({ where: { name: { startsWith: 'qr-test-client-' } } })
  })

  it('returns invalid for empty domain', async () => {
    const r = await queueSiteAuditRequest({ domain: '', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r).toEqual({ kind: 'invalid', reason: expect.stringContaining('domain') })
    expect(queueManager.enqueueAudit).not.toHaveBeenCalled()
  })

  it('returns invalid for malformed domain', async () => {
    const r = await queueSiteAuditRequest({ domain: 'not a domain!', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r.kind).toBe('invalid')
    expect(queueManager.enqueueAudit).not.toHaveBeenCalled()
  })

  it('returns queued with the mocked enqueue id on success', async () => {
    const r = await queueSiteAuditRequest({ domain: 'qr-test-fresh.example', clientId: 42, wcagLevel: 'wcag21aa' })
    expect(r).toEqual({ kind: 'queued', id: 'mock-audit-id' })
    expect(queueManager.enqueueAudit).toHaveBeenCalledTimes(1)
    expect(queueManager.enqueueAudit).toHaveBeenCalledWith(
      'qr-test-fresh.example',
      42,
      'wcag21aa',
      { preDiscoveredUrls: undefined, requestedBy: null, scheduleId: null, seoIntent: false },
    )
  })

  it('returns duplicate when a site audit for the domain is already queued', async () => {
    const seeded = await prisma.siteAudit.create({
      data: { domain: 'qr-test-dup.example', status: 'queued', wcagLevel: 'wcag21aa' },
    })
    const r = await queueSiteAuditRequest({ domain: 'qr-test-dup.example', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r).toEqual({ kind: 'duplicate', existingId: seeded.id })
    expect(queueManager.enqueueAudit).not.toHaveBeenCalled()
  })

  it('treats pdfs-running as in-flight for the duplicate guard', async () => {
    const seeded = await prisma.siteAudit.create({
      data: { domain: 'qr-test-pdfs.example', status: 'pdfs-running', wcagLevel: 'wcag21aa' },
    })
    const r = await queueSiteAuditRequest({ domain: 'qr-test-pdfs.example', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r).toEqual({ kind: 'duplicate', existingId: seeded.id })
    expect(queueManager.enqueueAudit).not.toHaveBeenCalled()
  })

  it('does NOT treat cancelled as in-flight — same domain can be re-queued', async () => {
    await prisma.siteAudit.create({
      data: { domain: 'qr-test-cancelled.example', status: 'cancelled', wcagLevel: 'wcag21aa' },
    })
    const r = await queueSiteAuditRequest({ domain: 'qr-test-cancelled.example', clientId: null, wcagLevel: 'wcag21aa' })
    expect(r).toEqual({ kind: 'queued', id: 'mock-audit-id' })
    expect(queueManager.enqueueAudit).toHaveBeenCalledTimes(1)
  })

  it('normalizes domain before forwarding to enqueueAudit (strips scheme/path, lowercases)', async () => {
    const r = await queueSiteAuditRequest({
      domain: 'HTTPS://QR-Test-Norm.Example/some/path',
      clientId: null,
      wcagLevel: 'wcag21aa',
    })
    expect(r.kind).toBe('queued')
    expect(queueManager.enqueueAudit).toHaveBeenCalledWith(
      'qr-test-norm.example',
      null,
      'wcag21aa',
      { preDiscoveredUrls: undefined, requestedBy: null, scheduleId: null, seoIntent: false },
    )
  })

  it('falls back to client seedUrls when preDiscoveredUrls is not provided and clientId is set', async () => {
    const client = await prisma.client.create({
      data: {
        name: 'qr-test-client-seed',
        seedUrls: JSON.stringify([
          'https://qr-test-seed.example/',
          'https://qr-test-seed.example/about/',
        ]),
      },
    })
    const r = await queueSiteAuditRequest({
      domain: 'qr-test-seed.example',
      clientId: client.id,
      wcagLevel: 'wcag21aa',
    })
    expect(r).toEqual({ kind: 'queued', id: 'mock-audit-id' })
    expect(queueManager.enqueueAudit).toHaveBeenCalledTimes(1)
    const [, , , opts] = vi.mocked(queueManager.enqueueAudit).mock.calls[0]
    expect(opts.preDiscoveredUrls).toBeDefined()
    expect(opts.preDiscoveredUrls).toHaveLength(2)
    expect(opts.preDiscoveredUrls).toContain('https://qr-test-seed.example/')
    expect(opts.preDiscoveredUrls).toContain('https://qr-test-seed.example/about/')
    await prisma.client.delete({ where: { id: client.id } })
  })

  it('passes scheduleId through to enqueueAudit (C2)', async () => {
    const r = await queueSiteAuditRequest({
      domain: 'qr-test-sched.example',
      clientId: null,
      wcagLevel: 'wcag21aa',
      scheduleId: 'sched-abc',
    })
    expect(r).toEqual({ kind: 'queued', id: 'mock-audit-id' })
    const [, , , opts] = vi.mocked(queueManager.enqueueAudit).mock.calls[0]
    expect(opts.scheduleId).toBe('sched-abc')
  })

  it('does NOT use seedUrls when preDiscoveredUrls is explicitly provided', async () => {
    const client = await prisma.client.create({
      data: {
        name: 'qr-test-client-noseed',
        seedUrls: JSON.stringify(['https://qr-test-noseed.example/seed-only/']),
      },
    })
    const r = await queueSiteAuditRequest({
      domain: 'qr-test-noseed.example',
      clientId: client.id,
      wcagLevel: 'wcag21aa',
      preDiscoveredUrls: ['https://qr-test-noseed.example/explicit/'],
    })
    expect(r).toEqual({ kind: 'queued', id: 'mock-audit-id' })
    const [, , , opts] = vi.mocked(queueManager.enqueueAudit).mock.calls[0]
    expect(opts.preDiscoveredUrls).toHaveLength(1)
    expect(opts.preDiscoveredUrls![0]).toBe('https://qr-test-noseed.example/explicit/')
    await prisma.client.delete({ where: { id: client.id } })
  })

  it('passes seoIntent:true through to enqueueAudit (D1)', async () => {
    const r = await queueSiteAuditRequest({
      domain: 'qr-test-seoint.example',
      clientId: null,
      wcagLevel: 'wcag21aa',
      seoIntent: true,
    })
    expect(r).toEqual({ kind: 'queued', id: 'mock-audit-id' })
    const [, , , opts] = vi.mocked(queueManager.enqueueAudit).mock.calls[0]
    expect(opts.seoIntent).toBe(true)
  })

  it('defaults seoIntent to false when omitted (D1)', async () => {
    const r = await queueSiteAuditRequest({
      domain: 'qr-test-seoint-default.example',
      clientId: null,
      wcagLevel: 'wcag21aa',
    })
    expect(r).toEqual({ kind: 'queued', id: 'mock-audit-id' })
    const [, , , opts] = vi.mocked(queueManager.enqueueAudit).mock.calls[0]
    expect(opts.seoIntent).toBeFalsy()
  })
})
