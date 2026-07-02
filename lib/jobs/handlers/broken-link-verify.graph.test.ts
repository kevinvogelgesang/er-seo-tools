// lib/jobs/handlers/broken-link-verify.graph.test.ts
//
// Task 3: Verify that the live-scan builder populates CrawlPage.inlinks,
// CrawlPage.outlinks, CrawlPage.crawlDepth, and CrawlRun.seoIntent.
//
// Seed: SiteAudit (seoIntent:true) + HarvestedPageSeo for A and B
//       + HarvestedLink (A→B internal-link)
// Expected after builder run:
//   - CrawlPage B: inlinks=1
//   - CrawlPage A: outlinks=1
//   - CrawlPage A: crawlDepth=0 (homepage)
//   - CrawlPage B: crawlDepth=1 (one hop from homepage)
//   - CrawlRun.seoIntent === true

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'

const DOMAIN = 'c6graph.example.com'

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

beforeEach(clean)
afterAll(clean)

const stubDeps: VerifyDeps = {
  checkUrl: async (_url: string) => 'ok',
  now: () => 0,
  sleep: async () => {},
}

describe('runBrokenLinkVerify — link-graph scalars + seoIntent', () => {
  it('populates CrawlPage inlinks/outlinks/crawlDepth and CrawlRun.seoIntent', async () => {
    // URL A is the homepage (https://<domain>/) and URL B is one hop away
    const urlA = `https://${DOMAIN}/`
    const urlB = `https://${DOMAIN}/b`

    // Create a SiteAudit with seoIntent = true
    const sa = await prisma.siteAudit.create({
      data: {
        domain: DOMAIN,
        status: 'complete',
        clientId: null,
        seoIntent: true,
        pagesTotal: 2,
        pagesComplete: 2,
        pagesError: 0,
      },
    })
    const siteAuditId = sa.id

    // Seed HarvestedPageSeo for both pages
    await prisma.harvestedPageSeo.createMany({
      data: [
        {
          siteAuditId,
          url: urlA,
          statusCode: 200,
          isHtml: true,
          robotsNoindex: false,
          xRobotsNoindex: false,
          loginLike: false,
          title: 'Home',
          h1: 'Home',
          metaDescription: 'Home page',
          wordCount: 400,
          schemaCount: 0,
        },
        {
          siteAuditId,
          url: urlB,
          statusCode: 200,
          isHtml: true,
          robotsNoindex: false,
          xRobotsNoindex: false,
          loginLike: false,
          title: 'Page B',
          h1: 'Page B',
          metaDescription: 'Page B description',
          wordCount: 400,
          schemaCount: 0,
        },
      ],
    })

    // Seed HarvestedLink: A→B internal-link
    await prisma.harvestedLink.create({
      data: {
        siteAuditId,
        sourcePageUrl: urlA,
        targetUrl: urlB,
        kind: 'internal-link',
      },
    })

    await runBrokenLinkVerify({ siteAuditId, domain: DOMAIN }, stubDeps)

    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      include: { pages: true },
    })

    expect(run).not.toBeNull()
    expect(run!.seoIntent).toBe(true)

    // Find pages A and B (normalized URL strips trailing slash on bare root)
    // normalizeFindingUrl('https://c6graph.example.com/') → 'https://c6graph.example.com'
    const pageA = run!.pages.find((p) => p.url === `https://${DOMAIN}`)
    const pageB = run!.pages.find((p) => p.url === urlB)

    expect(pageA).not.toBeUndefined()
    expect(pageB).not.toBeUndefined()

    // A links to B: A has outlinks=1, B has inlinks=1
    expect(pageA!.outlinks).toBe(1)
    expect(pageB!.inlinks).toBe(1)

    // Depth: A is the homepage → depth 0; B is one hop away → depth 1
    expect(pageA!.crawlDepth).toBe(0)
    expect(pageB!.crawlDepth).toBe(1)
  })
})
