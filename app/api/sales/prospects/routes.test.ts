// app/api/sales/prospects/routes.test.ts
// DB-backed; handlers called directly (house pattern from the C4 share route test).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET as listGet, POST as createPost } from './route'
import { DELETE as prospectDelete } from './[id]/route'
import { GET as shareGet, POST as sharePost } from './[id]/share/route'

const PREFIX = 'c14-rt-'
async function cleanup() {
  const rows = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  await prisma.siteAudit.deleteMany({ where: { prospectId: { in: rows.map((r) => r.id) } } })
  await prisma.prospect.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } })
}
beforeAll(cleanup)
afterAll(cleanup)

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
    // cleanup of the orphaned audit
    await prisma.siteAudit.delete({ where: { id: a.id } })
  })
})
