// app/api/sales/prospects/scan-route.test.ts
// Mocks queueSiteAuditRequest (C15 precedent: the real path fires
// fire-and-forget processNext which can promote unrelated queued audits).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

vi.mock('@/lib/ada-audit/queue-request', () => ({
  queueSiteAuditRequest: vi.fn(async () => ({ kind: 'queued', id: 'audit-mock-1' })),
}))
import { queueSiteAuditRequest } from '@/lib/ada-audit/queue-request'
import { POST as scanPost } from './[id]/scan/route'

const PREFIX = 'c14-scan-'
async function cleanup() {
  await prisma.prospect.deleteMany({ where: { domain: { startsWith: PREFIX } } })
}
beforeAll(cleanup)
afterAll(cleanup)

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) })

describe('POST /api/sales/prospects/[id]/scan', () => {
  it('queues a full audit with prospectId and null clientId', async () => {
    const p = await prisma.prospect.create({ data: { name: 'Scan', domain: `${PREFIX}scan.test` } })
    const r = await scanPost(new NextRequest(`http://localhost:3000/api/sales/prospects/${p.id}/scan`, { method: 'POST' }), params(p.id))
    expect(r.status).toBe(202)
    expect((await r.json()).auditId).toBe('audit-mock-1')
    expect(queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: `${PREFIX}scan.test`,
        clientId: null,
        prospectId: p.id,
        wcagLevel: 'wcag21aa',
        seoOnly: false,
      }),
    )
  })
  it('404s on unknown prospect', async () => {
    const r = await scanPost(new NextRequest('http://localhost:3000/api/sales/prospects/999999/scan', { method: 'POST' }), params(999999))
    expect(r.status).toBe(404)
  })
})
