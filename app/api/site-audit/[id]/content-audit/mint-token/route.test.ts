import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { POST } from './route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const DOMAIN = 'mint-cat.example.com'

async function seedComplete(withRun: boolean, retainUntil: Date | null) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: retainUntil } })
  if (withRun) await prisma.crawlRun.create({ data: { siteAuditId: sa.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 1 } })
  return sa
}

describe('POST content-audit/mint-token', () => {
  beforeEach(async () => {
    await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('mints a cat_ token for a complete audit with a live-scan run', async () => {
    const sa = await seedComplete(true, new Date(Date.now() + 3600_000))
    // seed a page with text so textAvailable=true
    await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', contentText: 'body', statusCode: 200 } })
    const res = await POST(new NextRequest('https://app.test/api/site-audit/' + sa.id + '/content-audit/mint-token', { method: 'POST' }), params(sa.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token.startsWith('cat_')).toBe(true)
    expect(body.textAvailable).toBe(true)
  })
  it('409s when there is no live-scan run', async () => {
    const sa = await seedComplete(false, null)
    const res = await POST(new NextRequest('https://app.test/x', { method: 'POST' }), params(sa.id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('no_live_scan_run')
  })
  it('409s when the only seo-parser run is an exhausted-verifier placeholder', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.crawlRun.create({ data: { siteAuditId: sa.id, tool: 'seo-parser', source: 'live-scan-placeholder', domain: DOMAIN, status: 'partial', seoIntent: false } })
    const res = await POST(new NextRequest('https://app.test/x', { method: 'POST' }), params(sa.id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('no_live_scan_run')
  })
  it('mints but reports textAvailable:false when text is already gone', async () => {
    const sa = await seedComplete(true, new Date(Date.now() - 1000)) // window already closed
    // no HarvestedPageSeo rows (swept)
    const res = await POST(new NextRequest('https://app.test/x', { method: 'POST' }), params(sa.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token.startsWith('cat_')).toBe(true)
    // mint RAISES the window to now+TTL, so text would be available IF rows existed;
    // with zero text rows textAvailable must be false.
    expect(body.textAvailable).toBe(false)
  })
})
