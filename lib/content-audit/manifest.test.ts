import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { loadContentAuditManifest, loadContentAuditPageText } from './manifest'

const DOMAIN = 'manifest-cat.example.com'
async function seed(retainUntil: Date | null) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', completedAt: new Date(), contentAuditRetainUntil: retainUntil } })
  // indexable page (200/html/not-noindex/not-login) with text
  await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', statusCode: 200, isHtml: true, title: 'A', wordCount: 500, contentText: 'body a' } })
  // non-indexable (noindex) -- excluded
  await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/n', statusCode: 200, isHtml: true, robotsNoindex: true, contentText: 'body n' } })
  return sa
}

describe('content-audit manifest loader', () => {
  beforeEach(async () => {
    await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
    await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  })
  it('lists indexable pages only + textAvailable true in-window', async () => {
    const sa = await seed(new Date(Date.now() + 60000))
    const m = await loadContentAuditManifest(sa.id, new Date())
    expect(m).not.toBeNull()
    expect(m!.pages.map((p) => p.url)).toEqual(['https://x/a'])
    expect(m!.textAvailable).toBe(true)
  })
  it('textAvailable false when retainUntil has passed', async () => {
    const sa = await seed(new Date(Date.now() - 1000))
    const m = await loadContentAuditManifest(sa.id, new Date())
    expect(m!.textAvailable).toBe(false)
  })
  it('page loader: text in-window, 410 when expired, 404 when not in audit', async () => {
    const open = await seed(new Date(Date.now() + 60000))
    expect(await loadContentAuditPageText(open.id, 'https://x/a', new Date())).toMatchObject({ contentText: 'body a' })
    expect(await loadContentAuditPageText(open.id, 'https://x/zzz', new Date())).toEqual({ status: 404 })
    const expired = await seed(new Date(Date.now() - 1000))
    expect(await loadContentAuditPageText(expired.id, 'https://x/a', new Date())).toEqual({ status: 410 })
  })
})
