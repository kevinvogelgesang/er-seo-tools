import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { recoverBrokenLinkVerifies } from './broken-link-recovery'

const DOMAIN = 'c6blr.example.com'

async function clean() {
  // Scope job cleanup to THIS test's site audits — never blanket-delete.
  const sas = await prisma.siteAudit.findMany({ where: { domain: DOMAIN }, select: { id: true } })
  const groups = sas.map((s) => `site-audit:${s.id}`)
  if (groups.length) await prisma.job.deleteMany({ where: { type: 'broken-link-verify', groupKey: { in: groups } } })
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(clean)
afterAll(clean)

describe('recoverBrokenLinkVerifies', () => {
  it('re-enqueues for a complete audit with harvest rows + no verify job + no live-scan run', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedLink.create({
      data: { siteAuditId: sa.id, targetUrl: 'https://c6blr.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blr.example.com/a' },
    })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })
    expect(job).not.toBeNull()
  })

  it('skips audits that already have a live-scan run', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedLink.create({
      data: { siteAuditId: sa.id, targetUrl: 'https://c6blr.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blr.example.com/a' },
    })
    await prisma.crawlRun.create({
      data: { id: 'c6blr-run', tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', siteAuditId: sa.id, pagesTotal: 0 },
    })
    const before = await prisma.job.count({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })
    await recoverBrokenLinkVerifies()
    expect(await prisma.job.count({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })).toBe(before)
  })

  it('skips non-complete audits', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'running' } })
    await prisma.harvestedLink.create({
      data: { siteAuditId: sa.id, targetUrl: 'https://c6blr.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blr.example.com/a' },
    })
    await recoverBrokenLinkVerifies()
    expect(await prisma.job.count({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })).toBe(0)
  })

  it('re-enqueues a stranded audit that has only HarvestedPageSeo rows', async () => {
    // seed complete SiteAudit + 1 harvestedPageSeo row, no harvestedLink, no live-scan run, no job
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedPageSeo.create({
      data: { siteAuditId: sa.id, url: 'https://c6blr.example.com/a', statusCode: 200, isHtml: true },
    })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })
    expect(job).not.toBeNull()
  })

  it('C11: recovery re-enqueues a complete zero-harvest seoOnly audit', async () => {
    // Arrange: complete seoOnly SiteAudit, NO HarvestedLink/HarvestedPageSeo rows,
    // NO seo-parser CrawlRun, NO active verify job. Today's transient-keyed scan
    // never sees this row (all pages failed/redirected or harvest returned null,
    // then the process crashed before enqueueBrokenLinkVerify).
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', seoOnly: true } })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({
      where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` },
      select: { id: true },
    })
    expect(job).not.toBeNull()
  })

  it('C11: does not double-enqueue a seoOnly audit that also has transient rows', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', seoOnly: true } })
    await prisma.harvestedLink.create({
      data: { siteAuditId: sa.id, targetUrl: 'https://c6blr.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blr.example.com/a' },
    })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBe(1)
    expect(await prisma.job.count({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })).toBe(1)
  })

  it('C12 D1: does NOT re-enqueue a completed audit that already has a live-scan run + retained pageSeo', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', contentAuditRetainUntil: new Date(Date.now() + 3600_000) } })
    await prisma.crawlRun.create({ data: { siteAuditId: sa.id, tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', pagesTotal: 1 } })
    await prisma.harvestedPageSeo.create({ data: { siteAuditId: sa.id, url: 'https://x/a', contentText: 'body' } })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBe(0)
    const jobs = await prisma.job.count({ where: { groupKey: `site-audit:${sa.id}` } })
    expect(jobs).toBe(0)
  })
})
