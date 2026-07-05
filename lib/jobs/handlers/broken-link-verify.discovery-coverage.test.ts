// lib/jobs/handlers/broken-link-verify.discovery-coverage.test.ts
//
// C6 hybrid-discovery Increment 1 (Task 4): the builder computes a sitemap
// miss-rate measurement from already-harvested internal links vs the
// discovery baseline (SiteAudit.discoveredUrls) and stores it on the
// live-scan CrawlRun as discoveryCoverageJson. ZERO new fetches, NOT a
// Finding.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify, type VerifyDeps } from './broken-link-verify'

const DOMAIN = 'c6coverage.example.com'

async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.harvestedPageSeo.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

beforeEach(clean)
afterAll(clean)

const stubDeps: VerifyDeps = {
  resolve: async (url: string) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  resolveExternal: async (url: string) => ({ result: 'ok', finalUrl: url, status: 200, hops: 0, chain: [], tooManyRedirects: false }),
  now: () => 0,
  sleep: async () => {},
}

describe('runBrokenLinkVerify — discovery coverage measurement', () => {
  it('writes discoveryCoverageJson with the off-baseline count for a sitemap audit', async () => {
    const urlA = `https://${DOMAIN}/a`
    const urlZ = `https://${DOMAIN}/z`

    const sa = await prisma.siteAudit.create({
      data: {
        domain: DOMAIN,
        status: 'complete',
        clientId: null,
        pagesTotal: 1,
        pagesComplete: 1,
        pagesError: 0,
        discoveredUrls: JSON.stringify([urlA]),
        discoveryMode: 'sitemap',
        discoveryCapped: false,
      },
    })
    const siteAuditId = sa.id

    // Internal links: /a is in the baseline, /z is off-baseline.
    await prisma.harvestedLink.createMany({
      data: [
        { siteAuditId, sourcePageUrl: urlA, targetUrl: urlA, kind: 'internal-link' },
        { siteAuditId, sourcePageUrl: urlA, targetUrl: urlZ, kind: 'internal-link' },
      ],
    })

    await runBrokenLinkVerify({ siteAuditId, domain: DOMAIN }, stubDeps)

    const run = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } },
      select: { id: true, discoveryCoverageJson: true },
    })

    expect(run).not.toBeNull()
    expect(run!.discoveryCoverageJson).not.toBeNull()
    const cov = JSON.parse(run!.discoveryCoverageJson!)
    expect(cov.offBaselineCount).toBe(1)
    expect(cov.applicable).toBe(true)
    expect(cov.mode).toBe('sitemap')

    // Measurement only — must never materialize as a Finding.
    const coverageFindings = await prisma.finding.findMany({
      where: { runId: run!.id, type: { contains: 'discovery' } },
    })
    expect(coverageFindings).toHaveLength(0)
  })
})
