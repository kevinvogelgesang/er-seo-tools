import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { DEAD_PAGE_FINDING_TYPE } from '@/lib/findings/finding-type-sets'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'

const DOMAIN = 't9deadpage.example.com'

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.harvestedPageError.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

const deps: VerifyDeps = {
  resolve: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  resolveExternal: async (url) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  now: () => 0,
  sleep: async () => {},
}

describe('runBrokenLinkVerify — dead pages', () => {
  beforeEach(clean)
  afterEach(clean)
  afterAll(clean)

  it('writes dead_page findings, deletes transient errors, and leaves their CrawlPage statusCode null', async () => {
    const siteAudit = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', clientId: null, pagesTotal: 2, pagesComplete: 0, pagesError: 2 },
    })
    const deadUrls = [`https://${DOMAIN}/gone-404`, `https://${DOMAIN}/gone-410`]
    await prisma.harvestedPageError.createMany({
      data: [
        { siteAuditId: siteAudit.id, url: deadUrls[0], statusCode: 404 },
        { siteAuditId: siteAudit.id, url: deadUrls[1], statusCode: 410 },
      ],
    })

    await runBrokenLinkVerify({ siteAuditId: siteAudit.id, domain: DOMAIN }, deps)

    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId: siteAudit.id, tool: 'seo-parser' } },
      include: { findings: true, pages: true },
    })
    expect(run).not.toBeNull()

    const deadFindings = run!.findings.filter((finding) => finding.type === DEAD_PAGE_FINDING_TYPE)
    expect(deadFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'run', count: 2, pageId: null }),
    ]))
    expect(deadFindings.filter((finding) => finding.scope === 'page')).toHaveLength(2)

    expect(await prisma.harvestedPageError.count({ where: { siteAuditId: siteAudit.id } })).toBe(0)
    expect(run!.pages).toEqual(expect.arrayContaining(
      deadUrls.map((url) => expect.objectContaining({ url, statusCode: null })),
    ))
  })
})
