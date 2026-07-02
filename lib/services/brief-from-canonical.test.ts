// lib/services/brief-from-canonical.test.ts
//
// Task 12: provider-fed brief (live, degraded keywords/schema)
// TDD: write failing test → implement → pass

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { buildBriefFromCanonical } from './brief-from-canonical'

// =============================================================================
// DB test helpers
// =============================================================================

const DOMAIN = 'bfc-test-' + randomUUID().slice(0, 8) + '.example'
const PREFIX = 'test-bfc-'

async function clearTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeEach(clearTestState)
afterAll(clearTestState)

async function makeClient(): Promise<{ id: number; name: string }> {
  const name = PREFIX + randomUUID().slice(0, 8)
  const c = await prisma.client.create({
    data: { name, domains: JSON.stringify([DOMAIN]) },
  })
  return { id: c.id, name }
}

/**
 * Seed a seoIntent:true live-scan CrawlRun with multiple CrawlPage rows.
 */
async function makeLiveScanRun(
  clientId: number,
  completedAt: Date,
  pageRows: Array<{
    url: string
    inlinks?: number | null
    statusCode?: number | null
    title?: string | null
    h1?: string | null
    metaDescription?: string | null
    wordCount?: number | null
    indexable?: boolean | null
  }>,
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
      score: 72,
      pagesTotal: pageRows.length,
      completedAt,
      createdAt: completedAt,
    },
  })
  await prisma.$transaction(
    pageRows.map((p) =>
      prisma.crawlPage.create({
        data: {
          runId: run.id,
          url: p.url,
          inlinks: p.inlinks ?? null,
          statusCode: p.statusCode ?? null,
          title: p.title ?? null,
          h1: p.h1 ?? null,
          metaDescription: p.metaDescription ?? null,
          wordCount: p.wordCount ?? null,
          indexable: p.indexable ?? null,
        },
      }),
    ),
  )
  return run
}

// =============================================================================
// Tests
// =============================================================================

describe('buildBriefFromCanonical', () => {
  it('returns null when no canonical run exists for the client+domain', async () => {
    const { id: clientId } = await makeClient()
    const result = await buildBriefFromCanonical({ clientId, domain: DOMAIN })
    expect(result).toBeNull()
  })

  it('returns a BriefResult with brief string and degraded schema/keyword sections', async () => {
    const { id: clientId } = await makeClient()
    const completedAt = new Date()

    await makeLiveScanRun(clientId, completedAt, [
      {
        url: `https://${DOMAIN}/nursing-program`,
        inlinks: 15,
        statusCode: 200,
        title: 'Nursing Program',
        h1: 'Our Nursing Program',
        metaDescription: 'Become a nurse today',
        wordCount: 900,
        indexable: true,
      },
      {
        url: `https://${DOMAIN}/about`,
        inlinks: 5,
        statusCode: 200,
        title: 'About Us',
        h1: 'About',
        metaDescription: null,
        wordCount: 400,
        indexable: true,
      },
    ])

    const result = await buildBriefFromCanonical({ clientId, domain: DOMAIN })
    expect(result).not.toBeNull()
    expect(typeof result!.brief).toBe('string')
    expect(result!.brief.length).toBeGreaterThan(0)
    expect(result!.stats.pages).toBe(2)

    // Degraded sections: no schema, no keywords
    expect(result!.stats.schemaEntries).toBe(0)
    expect(result!.stats.keywords).toBe(0)
    expect(result!.brief).toContain('No structured data export provided')
    expect(result!.brief).toContain('No keyword data provided')
  })

  it('sorts program pages by inlinks descending in the brief', async () => {
    const { id: clientId } = await makeClient()
    const completedAt = new Date()

    await makeLiveScanRun(clientId, completedAt, [
      {
        url: `https://${DOMAIN}/dental-program`,
        inlinks: 3,
        statusCode: 200,
        title: 'Dental Program',
        indexable: true,
      },
      {
        url: `https://${DOMAIN}/nursing-program`,
        inlinks: 20,
        statusCode: 200,
        title: 'Nursing Program',
        indexable: true,
      },
    ])

    const result = await buildBriefFromCanonical({ clientId, domain: DOMAIN })
    expect(result).not.toBeNull()

    // Nursing (20 inlinks) should appear before Dental (3 inlinks) in the table
    const nursingIdx = result!.brief.indexOf('nursing-program')
    const dentalIdx = result!.brief.indexOf('dental-program')
    // Both should be present
    expect(nursingIdx).toBeGreaterThan(-1)
    expect(dentalIdx).toBeGreaterThan(-1)
    // nursing (higher inlinks) comes first
    expect(nursingIdx).toBeLessThan(dentalIdx)
  })

  it('identifies orphan pages (inlinks === 0) and counts them correctly', async () => {
    const { id: clientId } = await makeClient()
    const completedAt = new Date()

    await makeLiveScanRun(clientId, completedAt, [
      {
        url: `https://${DOMAIN}/nursing-program`,
        inlinks: 10,
        statusCode: 200,
        title: 'Nursing Program',
        indexable: true,
      },
      {
        url: `https://${DOMAIN}/orphan-page`,
        inlinks: 0,
        statusCode: 200,
        title: 'Orphaned Content',
        indexable: true,
      },
    ])

    const result = await buildBriefFromCanonical({ clientId, domain: DOMAIN })
    expect(result).not.toBeNull()
    // Brief should report 1 orphaned page
    expect(result!.brief).toContain('Orphaned pages (0 inlinks):** 1')
  })

  it('treats facts with null inlinks as 0 (orphan) for brief purposes', async () => {
    const { id: clientId } = await makeClient()
    const completedAt = new Date()

    // Live-scan page with null inlinks (not all pages have inlinks data)
    await makeLiveScanRun(clientId, completedAt, [
      {
        url: `https://${DOMAIN}/nursing-program`,
        inlinks: null, // null → mapped to 0 → treated as orphan
        statusCode: 200,
        title: 'Nursing Program',
        indexable: true,
      },
    ])

    const result = await buildBriefFromCanonical({ clientId, domain: DOMAIN })
    expect(result).not.toBeNull()
    // 0 inlinks (from null) makes it an orphan
    expect(result!.brief).toContain('Orphaned pages (0 inlinks):** 1')
  })

  it('treats facts with null statusCode as statusCode=0 (non-error, passes < 400 gate)', async () => {
    const { id: clientId } = await makeClient()
    const completedAt = new Date()

    // SF-upload-style live page: has indexable info but null statusCode
    await makeLiveScanRun(clientId, completedAt, [
      {
        url: `https://${DOMAIN}/nursing-program`,
        inlinks: 5,
        statusCode: null,  // null → 0 → passes < 400 gate → treated as valid
        title: 'Nursing Program',
        indexable: true,
      },
    ])

    const result = await buildBriefFromCanonical({ clientId, domain: DOMAIN })
    expect(result).not.toBeNull()
    // The page should NOT be excluded by the statusCode >= 400 gate
    // so it should be counted in program pages
    expect(result!.brief).toContain('Program pages identified:** 1')
  })

  it('handles indexability: fact.indexability string takes priority over fact.indexable boolean', async () => {
    const { id: clientId } = await makeClient()
    const completedAt = new Date()

    await makeLiveScanRun(clientId, completedAt, [
      {
        url: `https://${DOMAIN}/nursing-program`,
        inlinks: 8,
        statusCode: 200,
        title: 'Nursing Program',
        indexable: false, // boolean false
        // no indexability string in CrawlPage → fact.indexability will be null
        // → falls back to indexable boolean: false → 'Non-Indexable'
      },
    ])

    const result = await buildBriefFromCanonical({ clientId, domain: DOMAIN })
    expect(result).not.toBeNull()
    // Non-indexable page should not count as indexable
    expect(result!.brief).toContain('Indexable pages:** 0')
    // And not counted as program page
    expect(result!.brief).toContain('Program pages identified:** 0')
  })

  it('brief contains the client name in the heading', async () => {
    const { id: clientId, name: clientName } = await makeClient()
    const completedAt = new Date()

    await makeLiveScanRun(clientId, completedAt, [
      {
        url: `https://${DOMAIN}/nursing-program`,
        inlinks: 5,
        statusCode: 200,
        title: 'Nursing Program',
        indexable: true,
      },
    ])

    const result = await buildBriefFromCanonical({ clientId, domain: DOMAIN })
    expect(result).not.toBeNull()
    expect(result!.brief).toContain(clientName)
  })
})
