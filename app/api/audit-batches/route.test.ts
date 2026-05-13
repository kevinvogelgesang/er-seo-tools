import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { GET } from './route'
import { NextRequest } from 'next/server'

function req(url: string): NextRequest {
  return new NextRequest(url)
}

describe('GET /api/audit-batches', () => {
  beforeEach(async () => {
    // Close any pre-existing open batch so our tests can create open rows
    // without hitting the partial unique index.
    await prisma.auditBatch.updateMany({
      where: { closedAt: null },
      data: { closedAt: new Date() },
    })
    await prisma.adaAudit.deleteMany({ where: { url: { startsWith: 'https://abtest-' } } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'abtest-' } } })
    await prisma.auditBatch.deleteMany({ where: { label: { startsWith: '__abtest__' } } })
  })

  it('excludes open batches', async () => {
    await prisma.auditBatch.create({ data: { label: '__abtest__open' } })
    await prisma.auditBatch.create({ data: { label: '__abtest__closed', closedAt: new Date() } })

    const res = await GET(req('http://localhost/api/audit-batches'))
    const json = await res.json() as { items: { label: string }[] }
    const ours = json.items.filter((i) => i.label.startsWith('__abtest__'))
    expect(ours.map((i) => i.label)).toEqual(['__abtest__closed'])
  })

  it('orders closed batches newest first by closedAt', async () => {
    const older = new Date('2026-05-12T00:00:00Z')
    const newer = new Date('2026-05-13T00:00:00Z')
    await prisma.auditBatch.create({ data: { label: '__abtest__older', closedAt: older, startedAt: older } })
    await prisma.auditBatch.create({ data: { label: '__abtest__newer', closedAt: newer, startedAt: newer } })

    const res = await GET(req('http://localhost/api/audit-batches'))
    const json = await res.json() as { items: { label: string }[] }
    const ours = json.items.filter((i) => i.label.startsWith('__abtest__'))
    expect(ours.map((i) => i.label)).toEqual(['__abtest__newer', '__abtest__older'])
  })

  it('derives counts from member SiteAudits', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abtest__counts', closedAt: new Date() } })
    await prisma.siteAudit.create({ data: { domain: 'abtest-1.example', status: 'complete', wcagLevel: 'wcag21aa', batchId: b.id } })
    await prisma.siteAudit.create({ data: { domain: 'abtest-2.example', status: 'complete', wcagLevel: 'wcag21aa', batchId: b.id } })
    await prisma.siteAudit.create({ data: { domain: 'abtest-3.example', status: 'error', wcagLevel: 'wcag21aa', batchId: b.id } })

    const res = await GET(req('http://localhost/api/audit-batches'))
    const json = await res.json() as { items: { label: string; auditCount: number; completeCount: number; errorCount: number }[] }
    const ours = json.items.find((i) => i.label === '__abtest__counts')!
    expect(ours).toMatchObject({ auditCount: 3, completeCount: 2, errorCount: 1 })
  })

  it('paginates with page + pageSize and returns totalCount', async () => {
    for (let i = 0; i < 5; i++) {
      await prisma.auditBatch.create({
        data: {
          label: `__abtest__page-${i}`,
          closedAt: new Date(Date.now() - i * 1000),
        },
      })
    }
    const res = await GET(req('http://localhost/api/audit-batches?page=2&pageSize=2'))
    const json = await res.json() as { items: { label: string }[]; totalCount: number; page: number; pageSize: number }
    expect(json.page).toBe(2)
    expect(json.pageSize).toBe(2)
    expect(json.totalCount).toBeGreaterThanOrEqual(5)
    expect(json.items.length).toBeLessThanOrEqual(2)
  })
})
