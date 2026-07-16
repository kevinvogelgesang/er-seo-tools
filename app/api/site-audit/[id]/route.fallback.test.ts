// app/api/site-audit/[id]/route.fallback.test.ts
//
// DB-backed tests for the C3 archived-summary fallback on GET
// /api/site-audit/[id]. The sibling route.test.ts is mock-based
// (DELETE-focused) — these seed real rows (domain prefix c3det-*.example)
// and call the handler directly.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeAdaSiteFindings } from '@/lib/findings/ada-write'
import { GET } from './route'

const DOMAIN = 'c3det-site.example'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function axeBlob(url: string): string {
  return JSON.stringify({
    violations: [
      {
        id: 'image-alt',
        impact: 'critical',
        help: 'Images must have alternate text',
        description: 'd',
        helpUrl: 'https://example.org/ia',
        tags: ['wcag2a'],
        nodes: [{ html: '<img>', target: ['img'] }],
      },
    ],
    passes: [{ id: 'p1', help: 'p', nodes: [] }, { id: 'p2', help: 'p', nodes: [] }],
    incomplete: [{ id: 'i1', help: 'i', impact: 'minor', nodes: [] }],
    inapplicable: [],
    timestamp: '2026-06-12T00:00:00Z',
    url,
    testEngine: { name: 'axe-core', version: '4.10' },
    testRunner: { name: 'er-seo-tools' },
  })
}

async function clearState() {
  // CrawlRun first (subtree cascades from it), THEN the origin rows.
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: 'c3det-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: 'c3det-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'c3det-' } } })
}

async function seedSite(opts: { withFindings: boolean }) {
  const site = await prisma.siteAudit.create({
    data: {
      domain: DOMAIN,
      status: 'complete',
      wcagLevel: 'wcag21aa',
      pagesTotal: 1,
      pagesComplete: 1,
      summary: null, // pruned
      startedAt: new Date('2026-06-12T00:00:00Z'),
      completedAt: new Date('2026-06-12T00:10:00Z'),
    },
  })
  await prisma.adaAudit.create({
    data: {
      url: `https://${DOMAIN}/page-0`,
      status: 'complete',
      result: axeBlob(`https://${DOMAIN}/page-0`),
      siteAuditId: site.id,
      wcagLevel: 'wcag21aa',
    },
  })
  if (opts.withFindings) await writeAdaSiteFindings(site.id)
  return site
}

describe('GET /api/site-audit/[id] — archived fallback', () => {
  beforeEach(clearState)
  afterEach(clearState)

  it('synthesizes an archived summary from findings when summary is null', async () => {
    const site = await seedSite({ withFindings: true })

    const res = await GET({} as never, makeParams(site.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('complete')
    expect(body.summary).not.toBeNull()
    expect(body.summary.archived).toBe(true)
    expect(body.summary.archivedCounts).toEqual({ passed: 2, incomplete: 1 })
    expect(body.summary.aggregate.critical).toBe(1)
    expect(body.summary.aggregate.total).toBe(1)
    expect(body.summary.pages).toHaveLength(1)
    expect(body.summary.pages[0].violationIds).toEqual(['image-alt'])
  })

  it('returns null summary when no CrawlRun exists (pre-A2)', async () => {
    const site = await seedSite({ withFindings: false })

    const res = await GET({} as never, makeParams(site.id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('complete')
    expect(body.summary).toBeNull()
  })

  it('still prefers the stored summary blob when present (no archived marker)', async () => {
    const site = await seedSite({ withFindings: true })
    const stored = {
      aggregate: { critical: 9, serious: 0, moderate: 0, minor: 0, total: 9, passed: 1, incomplete: 0 },
      pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
      pages: [],
    }
    await prisma.siteAudit.update({ where: { id: site.id }, data: { summary: JSON.stringify(stored) } })

    const res = await GET({} as never, makeParams(site.id))
    const body = await res.json()
    expect(body.summary.archived).toBeUndefined()
    expect(body.summary.aggregate.critical).toBe(9)
  })
})

describe('GET /api/site-audit/[id] — C11 seoOnly + liveScanRunId', () => {
  beforeEach(clearState)
  afterEach(clearState)

  it('C11: detail returns seoOnly + liveScanRunId (null before, id after)', async () => {
    const site = await prisma.siteAudit.create({
      data: {
        domain: DOMAIN,
        status: 'complete',
        wcagLevel: 'wcag21aa',
        seoOnly: true,
        pagesTotal: 1,
        pagesComplete: 1,
        summary: null,
        startedAt: new Date('2026-06-12T00:00:00Z'),
        completedAt: new Date('2026-06-12T00:10:00Z'),
      },
    })

    let res = await GET({} as never, makeParams(site.id))
    let body = await res.json()
    expect(body.seoOnly).toBe(true)
    expect(body.liveScanRunId).toBeNull()

    const run = await prisma.crawlRun.create({
      data: {
        siteAuditId: site.id,
        tool: 'seo-parser',
        source: 'live-scan',
        domain: DOMAIN,
        status: 'complete',
      },
    })

    res = await GET({} as never, makeParams(site.id))
    body = await res.json()
    expect(body.liveScanRunId).toBe(run.id)
  })

  // Verifier-memory-loop fix (Task 4): an exhausted verifier's terminal
  // placeholder run (source: 'live-scan-placeholder') must never be reported
  // as a real live-scan run — the route would otherwise redirect/link to a
  // run page with no real SEO content behind it.
  it('excludes a live-scan-placeholder run from liveScanRunId (SEO stays unavailable)', async () => {
    const site = await prisma.siteAudit.create({
      data: {
        domain: DOMAIN,
        status: 'complete',
        wcagLevel: 'wcag21aa',
        seoOnly: true,
        pagesTotal: 1,
        pagesComplete: 1,
        summary: null,
        startedAt: new Date('2026-07-15T00:00:00Z'),
        completedAt: new Date('2026-07-15T00:10:00Z'),
      },
    })

    await prisma.crawlRun.create({
      data: {
        siteAuditId: site.id,
        tool: 'seo-parser',
        source: 'live-scan-placeholder',
        domain: DOMAIN,
        status: 'partial',
        seoIntent: false,
      },
    })

    const res = await GET({} as never, makeParams(site.id))
    const body = await res.json()
    expect(body.liveScanRunId).toBeNull()
  })
})
