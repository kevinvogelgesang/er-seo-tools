import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET as MANIFEST } from './route'
import { GET as PAGE } from '../page/route'
import { mintContentAuditToken } from '@/lib/content-audit-token'
const DOMAIN = 'exproute-cat.example.com'
const p = (id: string) => ({ params: Promise.resolve({ siteAuditId: id }) })
const authed = (id: string, token: string, qs = '') =>
  new NextRequest(`https://app.test/api/content-audit/${id}/manifest${qs}`, { headers: { authorization: `Bearer ${token}` } })
async function seed(retainUntil: Date | null) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', completedAt: new Date(), contentAuditRetainUntil: retainUntil } })
  await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', statusCode: 200, isHtml: true, contentText: 'body' } })
  return sa
}
describe('cat_ export route handlers', () => {
  beforeEach(async () => {
    await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('manifest 401s a missing token', async () => {
    const sa = await seed(new Date(Date.now() + 60000))
    const res = await MANIFEST(new NextRequest(`https://app.test/api/content-audit/${sa.id}/manifest`), p(sa.id))
    expect(res.status).toBe(401)
  })
  it('manifest 401s a token bound to a different audit', async () => {
    const sa = await seed(new Date(Date.now() + 60000))
    const { token } = await mintContentAuditToken('other_audit')
    const res = await MANIFEST(authed(sa.id, token), p(sa.id))
    expect(res.status).toBe(401)
  })
  it('page 410s an expired in-set page', async () => {
    const sa = await seed(new Date(Date.now() - 1000))
    const { token } = await mintContentAuditToken(sa.id)
    const res = await PAGE(authed(sa.id, token, '?url=https://x/a'), p(sa.id))
    expect(res.status).toBe(410)
  })
})
