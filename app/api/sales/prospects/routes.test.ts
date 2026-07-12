// app/api/sales/prospects/routes.test.ts
// DB-backed; handlers called directly (house pattern from the C4 share route test).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))

const { prisma } = await import('@/lib/db')
const { publishInvalidation } = await import('@/lib/events/bus')
const { GET: listGet, POST: createPost } = await import('./route')
const { DELETE: prospectDelete } = await import('./[id]/route')
const { GET: shareGet, POST: sharePost } = await import('./[id]/share/route')

const PREFIX = 'c14-rt-'
async function cleanup() {
  const rows = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  await prisma.siteAudit.deleteMany({ where: { prospectId: { in: rows.map((r) => r.id) } } })
  await prisma.prospect.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
}
beforeAll(cleanup)
afterAll(cleanup)
beforeEach(() => { vi.mocked(publishInvalidation).mockClear() })

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) })

describe('POST /api/sales/prospects', () => {
  it('creates then reports existing on duplicate domain', async () => {
    const r1 = await createPost(req('/api/sales/prospects', 'POST', { name: 'Acme', domain: `${PREFIX}dup.test` }))
    expect(r1.status).toBe(201)
    const r2 = await createPost(req('/api/sales/prospects', 'POST', { name: 'Acme 2', domain: `www.${PREFIX}dup.test` }))
    expect(r2.status).toBe(200)
    expect((await r2.json()).existing).toBe(true)
  })
  it('400s on invalid input', async () => {
    const r = await createPost(req('/api/sales/prospects', 'POST', { name: '', domain: 'x' }))
    expect(r.status).toBe(400)
  })
  it('A5 Task 19: emits prospect-list on a real create, but NOT on the existing-domain path or invalid input', async () => {
    const r1 = await createPost(req('/api/sales/prospects', 'POST', { name: 'Acme', domain: `${PREFIX}emit-create.test` }))
    expect(r1.status).toBe(201)
    expect(vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])).toContain('prospect-list')

    vi.mocked(publishInvalidation).mockClear()
    const r2 = await createPost(req('/api/sales/prospects', 'POST', { name: 'Acme 2', domain: `www.${PREFIX}emit-create.test` }))
    expect(r2.status).toBe(200)
    expect(publishInvalidation).not.toHaveBeenCalled()

    vi.mocked(publishInvalidation).mockClear()
    const r3 = await createPost(req('/api/sales/prospects', 'POST', { name: '', domain: 'x' }))
    expect(r3.status).toBe(400)
    expect(publishInvalidation).not.toHaveBeenCalled()
  })
})

describe('GET /api/sales/prospects', () => {
  it('lists prospects', async () => {
    const r = await listGet()
    expect(r.status).toBe(200)
    expect(Array.isArray((await r.json()).prospects)).toBe(true)
  })
})

describe('share route', () => {
  it('404s without a reportable audit? No — token issuance requires only the prospect; POST rotates, GET reads', async () => {
    const p = await prisma.prospect.create({ data: { name: 'Share', domain: `${PREFIX}share.test` } })
    const g0 = await shareGet(req(`/api/sales/prospects/${p.id}/share`, 'GET'), params(p.id))
    expect((await g0.json()).salesToken).toBeNull()
    const r = await sharePost(req(`/api/sales/prospects/${p.id}/share`, 'POST'), params(p.id))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.salesUrl).toContain('/sales/')
    const row = await prisma.prospect.findUnique({ where: { id: p.id } })
    expect(row?.salesToken).toBeTruthy()
    expect(row?.salesTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now())
    // GET must NOT mutate expiry
    const before = row?.salesTokenExpiresAt!.getTime()
    await shareGet(req(`/api/sales/prospects/${p.id}/share`, 'GET'), params(p.id))
    const after = (await prisma.prospect.findUnique({ where: { id: p.id } }))?.salesTokenExpiresAt!.getTime()
    expect(after).toBe(before)
  })
})

describe('DELETE /api/sales/prospects/[id]', () => {
  it('deletes and SetNulls audits', async () => {
    const p = await prisma.prospect.create({ data: { name: 'Del', domain: `${PREFIX}del.test` } })
    const a = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}del.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: p.id },
    })
    const r = await prospectDelete(req(`/api/sales/prospects/${p.id}`, 'DELETE'), params(p.id))
    expect(r.status).toBe(200)
    expect((await prisma.siteAudit.findUnique({ where: { id: a.id } }))?.prospectId).toBeNull()
    // A5 Task 19: the dashboard list changed (a row disappeared).
    expect(vi.mocked(publishInvalidation).mock.calls.map((c) => c[0])).toContain('prospect-list')
    // cleanup of the orphaned audit
    await prisma.siteAudit.delete({ where: { id: a.id } })
  })

  it('A5 Task 19: does NOT emit on a 404 (nothing changed)', async () => {
    const r = await prospectDelete(req('/api/sales/prospects/999999999', 'DELETE'), params(999999999))
    expect(r.status).toBe(404)
    expect(publishInvalidation).not.toHaveBeenCalled()
  })
})
