// lib/services/canonical-page-facts.test.ts
//
// Step 1: assert SF parse persists CrawlPage.inlinks/outlinks via seo-mapper.
// Step 2: assert getCanonicalPageFacts returns correct source + facts, and
//         that adding a fresh SF run flips source from 'live-scan' to 'sf-upload'.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { mapSeoResult } from '@/lib/findings/seo-mapper'
import { DEFAULT_WEIGHTS } from '@/lib/scoring/weights'
import { getCanonicalPageFacts } from './canonical-page-facts'
import type { AggregatedResult } from '@/lib/types'

// --- Step 1 fixture helpers ---------------------------------------------------

/** Minimal AggregatedResult with two page_index entries carrying inlinks/outlinks */
function sfFixture(domain: string, sessionId: string): AggregatedResult {
  return {
    crawl_summary: { total_urls: 2 },
    issues: { critical: [], warnings: [], notices: [] },
    site_structure: {},
    resources: {},
    technical_seo: {},
    performance: {},
    recommendations: [],
    metadata: {
      files_processed: [], parsers_used: [], total_parsers_available: 1,
      site_name: domain, health_score: 80,
    },
    url_registry: {
      sessionOrigin: { scheme: 'https', host: domain },
      hosts: [domain],
      urls: [
        { id: 0, kind: 'page', hostId: 0, scheme: 'https', path: '/' },
        { id: 1, kind: 'page', hostId: 0, scheme: 'https', path: '/about' },
      ],
    },
    page_index: [
      {
        ref: 0, title: 'Home', h1: 'Welcome', metaDescription: 'Intro',
        wordCount: 600, crawlDepth: 0, inlinks: 15, outlinks: 8,
        indexable: true, issueTypes: [],
      },
      {
        ref: 1, title: 'About', h1: 'About Us', metaDescription: null,
        wordCount: 250, crawlDepth: 1, inlinks: 3, outlinks: null,
        indexable: true, issueTypes: [],
      },
    ],
  } as unknown as AggregatedResult
}

// --- DB test helpers ----------------------------------------------------------

const DOMAIN = 'cpf-test-' + randomUUID().slice(0, 8) + '.example'
const PREFIX = 'test-cpf-'

async function clearTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeEach(clearTestState)
afterAll(clearTestState)

async function makeClient(): Promise<number> {
  const c = await prisma.client.create({
    data: { name: PREFIX + randomUUID().slice(0, 8), domains: JSON.stringify([DOMAIN]) },
  })
  return c.id
}

/**
 * Seed a live-scan seoIntent CrawlRun with a single CrawlPage carrying
 * the given scalars.
 */
async function makeLiveScanRun(
  clientId: number,
  completedAt: Date,
  pageFacts: { url: string; inlinks?: number | null; crawlDepth?: number | null; statusCode?: number | null },
) {
  const sa = await prisma.siteAudit.create({
    data: { domain: DOMAIN, status: 'complete', clientId, completedAt },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'seo-parser',
      source: 'live-scan',
      seoIntent: true,
      domain: DOMAIN,
      clientId,
      siteAuditId: sa.id,
      status: 'complete',
      score: 70,
      pagesTotal: 1,
      completedAt,
      createdAt: completedAt,
    },
  })
  await prisma.crawlPage.create({
    data: {
      runId: run.id,
      url: pageFacts.url,
      inlinks: pageFacts.inlinks ?? null,
      crawlDepth: pageFacts.crawlDepth ?? null,
      statusCode: pageFacts.statusCode ?? null,
      indexable: true,
    },
  })
  return run
}

/**
 * Seed a fresh SF-upload CrawlRun (via seo-mapper) with inlinks/outlinks
 * populated on the page_index.
 */
async function makeSfRun(
  clientId: number,
  completedAt: Date,
) {
  const sessionId = PREFIX + randomUUID()
  await prisma.session.create({
    data: { id: sessionId, status: 'complete', files: '[]', siteName: DOMAIN, clientId },
  })
  const bundle = mapSeoResult(
    sfFixture(DOMAIN, sessionId),
    { sessionId, clientId, startedAt: completedAt, completedAt, weights: DEFAULT_WEIGHTS },
  )
  // Persist via low-level prisma (mirrors writeFindingsRun without the delete-first)
  const run = await prisma.crawlRun.create({
    data: {
      id: bundle.run.id,
      tool: bundle.run.tool,
      source: bundle.run.source,
      seoIntent: bundle.run.seoIntent ?? false,
      domain: DOMAIN,
      clientId,
      sessionId,
      status: bundle.run.status,
      score: bundle.run.score,
      pagesTotal: bundle.run.pagesTotal,
      completedAt,
      createdAt: completedAt,
    },
  })
  await prisma.$transaction(
    bundle.pages.map((p) => prisma.crawlPage.create({ data: p })),
  )
  return run
}

// =============================================================================
// Step 1: SF mapper preserves inlinks/outlinks on CrawlPageInput
// =============================================================================

describe('Step 1: seo-mapper preserves inlinks/outlinks from page_index', () => {
  it('maps inlinks/outlinks from PageIndexEntry onto CrawlPageInput', () => {
    const result = mapSeoResult(
      sfFixture('maptest.example', 'sess-map-1'),
      { sessionId: 'sess-map-1', clientId: 1, startedAt: new Date(), completedAt: new Date(), weights: DEFAULT_WEIGHTS },
    )

    const home = result.pages.find((p) => p.url === 'https://maptest.example')
    expect(home).toBeDefined()
    expect(home!.inlinks).toBe(15)
    expect(home!.outlinks).toBe(8)

    const about = result.pages.find((p) => p.url === 'https://maptest.example/about')
    expect(about).toBeDefined()
    expect(about!.inlinks).toBe(3)
    expect(about!.outlinks).toBeNull()
  })

  it('persists CrawlPage.inlinks/outlinks to DB via prisma.crawlPage.create', async () => {
    // Simulate what writeFindingsRun does after mapSeoResult
    const sessionId = PREFIX + randomUUID()
    await prisma.session.create({
      data: { id: sessionId, status: 'complete', files: '[]', siteName: DOMAIN },
    })

    const bundle = mapSeoResult(
      sfFixture(DOMAIN, sessionId),
      { sessionId, clientId: null, startedAt: new Date(), completedAt: new Date(), weights: DEFAULT_WEIGHTS },
    )

    const run = await prisma.crawlRun.create({
      data: {
        id: bundle.run.id, tool: bundle.run.tool, source: bundle.run.source,
        seoIntent: false, domain: DOMAIN, sessionId, status: 'complete',
        score: bundle.run.score, pagesTotal: bundle.run.pagesTotal,
        completedAt: new Date(), createdAt: new Date(),
      },
    })

    await prisma.$transaction(
      bundle.pages.map((p) => prisma.crawlPage.create({ data: p })),
    )

    const dbPages = await prisma.crawlPage.findMany({ where: { runId: run.id } })
    expect(dbPages).toHaveLength(2)

    const home = dbPages.find((p) => p.url === `https://${DOMAIN}`)
    expect(home).toBeDefined()
    expect(home!.inlinks).toBe(15)
    expect(home!.outlinks).toBe(8)

    const about = dbPages.find((p) => p.url.endsWith('/about'))
    expect(about).toBeDefined()
    expect(about!.inlinks).toBe(3)
    expect(about!.outlinks).toBeNull()
  })
})

// =============================================================================
// Step 2: getCanonicalPageFacts
// =============================================================================

describe('getCanonicalPageFacts', () => {
  it('returns null when no qualifying runs exist', async () => {
    const clientId = await makeClient()
    const result = await getCanonicalPageFacts({ clientId, domain: DOMAIN })
    expect(result).toBeNull()
  })

  it('returns source:live-scan with facts from a seoIntent live run', async () => {
    const clientId = await makeClient()
    const completedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago

    await makeLiveScanRun(clientId, completedAt, {
      url: `https://${DOMAIN}/`,
      inlinks: 7,
      crawlDepth: 0,
      statusCode: 200,
    })

    const result = await getCanonicalPageFacts({ clientId, domain: DOMAIN })
    expect(result).not.toBeNull()
    expect(result!.source).toBe('live-scan')
    expect(result!.pages).toHaveLength(1)

    const p = result!.pages[0]
    expect(p.url).toBe(`https://${DOMAIN}/`)
    expect(p.inlinks).toBe(7)
    expect(p.crawlDepth).toBe(0)
    expect(p.statusCode).toBe(200)
    expect(p.indexable).toBe(true)
  })

  it('flips to source:sf-upload when a fresh SF run is added', async () => {
    const clientId = await makeClient()
    const liveAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000) // 35 days ago

    // Stale live-scan run (seoIntent)
    await makeLiveScanRun(clientId, liveAt, {
      url: `https://${DOMAIN}/`,
      inlinks: 7,
      crawlDepth: 0,
    })

    // First: live-scan is only run, so we get it (stale doesn't matter here — it IS the live)
    // But actually selectCanonicalSeoRun: no sf → fall back to live
    const before = await getCanonicalPageFacts({ clientId, domain: DOMAIN })
    expect(before!.source).toBe('live-scan')

    // Add a fresh SF run (within 30 days)
    const sfAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
    await makeSfRun(clientId, sfAt)

    const after = await getCanonicalPageFacts({ clientId, domain: DOMAIN })
    expect(after).not.toBeNull()
    expect(after!.source).toBe('sf-upload')
    expect(after!.pages).toHaveLength(2)

    // Verify SF facts include inlinks/outlinks
    const home = after!.pages.find((p) => p.url === `https://${DOMAIN}`)
    expect(home).toBeDefined()
    expect(home!.inlinks).toBe(15)
    expect(home!.outlinks).toBe(8)
    expect(home!.title).toBe('Home')
    expect(home!.crawlDepth).toBe(0)
    // SF path: statusCode is not present (null in DB) → omitted from fact
    expect('statusCode' in home!).toBe(false)
  })

  it('omits null scalar fields from facts (never-fake rule)', async () => {
    const clientId = await makeClient()
    const now = new Date()

    await makeLiveScanRun(clientId, now, {
      url: `https://${DOMAIN}/`,
      inlinks: null,
      crawlDepth: null,
      statusCode: null,
    })

    const result = await getCanonicalPageFacts({ clientId, domain: DOMAIN })
    const p = result!.pages[0]
    // Null scalars should NOT appear as keys in the fact object
    expect('inlinks' in p).toBe(false)
    expect('crawlDepth' in p).toBe(false)
    expect('statusCode' in p).toBe(false)
  })
})
