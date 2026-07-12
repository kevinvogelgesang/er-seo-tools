import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './route'
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const DOMAIN = 'poll-cat.example.com'
describe('GET content-audit (poll)', () => {
  beforeEach(async () => {
    await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('reports minted:false when no contentAuditJson, minted:true after it is set', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.crawlRun.create({ data: { siteAuditId: sa.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 1 } })
    let res = await GET(new NextRequest('https://app.test/x'), params(sa.id))
    expect((await res.json()).minted).toBe(false)
    await prisma.crawlRun.update({ where: { siteAuditId_tool: { siteAuditId: sa.id, tool: 'seo-parser' } }, data: { contentAuditJson: '{"v":1,"generatedAt":"x","findings":[]}' } })
    res = await GET(new NextRequest('https://app.test/x'), params(sa.id))
    const body = await res.json()
    expect(body.minted).toBe(true)
    expect(body.contentAuditJson).toContain('"v":1')
  })
})
