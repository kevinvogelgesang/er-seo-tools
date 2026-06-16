// lib/ada-audit/findings-fallback.test.ts
//
// DB-backed tests for the C3 archived-blob fallbacks. Seeds a complete
// SiteAudit + children, populates findings via the REAL mapper + writer
// (writeAdaSiteFindings / writeAdaSingleFindings), then compares the
// degraded builders against the live blob-based builder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeAdaSiteFindings, writeAdaSingleFindings } from '@/lib/findings/ada-write'
import { buildSiteAuditSummary } from './site-audit-helpers'
import { buildSummaryFromFindings, buildArchivedAxeResults } from './findings-fallback'
import type { SitePageResult } from './types'

const SITE_DOMAIN = 'c3fb-site.example'
const SOLO_DOMAIN = 'c3fb-solo.example'

const LIGHTHOUSE_SUMMARY = JSON.stringify({
  scores: { performance: 91, accessibility: 88, bestPractices: 100, seo: 95 },
  cwv: { lcpMs: 1800, cls: 0.02, tbtMs: 120 },
  topFailures: [],
})

/** Blob shared by all 5 complete pages: color-contrast everywhere (template
 *  tier at 5/5), page 0 adds image-alt (1/5 — below the common-issue floor).
 *  passes.length = 2, incomplete.length = 1 on every page. */
function axeBlob(url: string, opts?: { extraCritical?: boolean }): string {
  const violations: unknown[] = [
    {
      id: 'color-contrast',
      impact: 'serious',
      help: 'Elements must have sufficient color contrast',
      description: 'Full description — lost on archive by contract',
      helpUrl: 'https://example.org/cc',
      tags: ['wcag2aa', 'cat.color'],
      nodes: [
        { html: '<a class="cta">x</a>', target: ['footer > a.cta'] },
        { html: '<p>y</p>', target: ['footer > p'] },
      ],
    },
  ]
  if (opts?.extraCritical) {
    violations.push({
      id: 'image-alt',
      impact: 'critical',
      help: 'Images must have alternate text',
      description: 'd',
      helpUrl: 'https://example.org/ia',
      tags: ['wcag2a'],
      nodes: [{ html: '<img>', target: ['img'] }],
    })
  }
  return JSON.stringify({
    violations,
    passes: [
      { id: 'p1', help: 'p', nodes: [{ html: '<div>' }] },
      { id: 'p2', help: 'p', nodes: [] },
    ],
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
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: 'c3fb-' } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: 'c3fb-' } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'c3fb-' } } })
}

interface SeededSite {
  siteAuditId: string
  childIds: string[] // index 0..4 complete (0 has LH + PDFs), 5 redirected
}

async function seedSiteAudit(): Promise<SeededSite> {
  const site = await prisma.siteAudit.create({
    data: {
      domain: SITE_DOMAIN,
      status: 'complete',
      wcagLevel: 'wcag21aa',
      pagesTotal: 6,
      pagesComplete: 5,
      pagesRedirected: 1,
      startedAt: new Date('2026-06-12T00:00:00Z'),
      completedAt: new Date('2026-06-12T00:10:00Z'),
    },
  })
  const childIds: string[] = []
  for (let i = 0; i < 5; i++) {
    const url = `https://${SITE_DOMAIN}/page-${i}`
    const child = await prisma.adaAudit.create({
      data: {
        url,
        status: 'complete',
        result: axeBlob(url, { extraCritical: i === 0 }),
        siteAuditId: site.id,
        wcagLevel: 'wcag21aa',
        lighthouseSummary: i === 0 ? LIGHTHOUSE_SUMMARY : null,
      },
    })
    childIds.push(child.id)
  }
  const redirected = await prisma.adaAudit.create({
    data: {
      url: `https://${SITE_DOMAIN}/old`,
      status: 'redirected',
      finalUrl: `https://${SITE_DOMAIN}/new`,
      siteAuditId: site.id,
      wcagLevel: 'wcag21aa',
    },
  })
  childIds.push(redirected.id)

  await prisma.pdfAudit.createMany({
    data: [
      {
        siteAuditId: site.id,
        adaAuditId: childIds[0],
        url: `https://${SITE_DOMAIN}/doc-a.pdf`,
        status: 'complete',
        issues: JSON.stringify([{ page: 1, type: 'untagged', detail: 'No tags' }]),
      },
      {
        siteAuditId: site.id,
        adaAuditId: childIds[0],
        url: `https://${SITE_DOMAIN}/doc-b.pdf`,
        status: 'skipped',
        skipReason: 'oversize',
      },
    ],
  })

  await writeAdaSiteFindings(site.id)
  return { siteAuditId: site.id, childIds }
}

async function loadChildrenForLiveSummary(siteAuditId: string) {
  return prisma.adaAudit.findMany({
    where: { siteAuditId },
    select: {
      id: true, url: true, status: true, error: true, result: true,
      lighthouseSummary: true, finalUrl: true,
      pdfAudits: { select: { status: true, issues: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

function byUrl(pages: SitePageResult[]): Map<string, SitePageResult> {
  return new Map(pages.map((p) => [p.url, p]))
}

describe('buildSummaryFromFindings', () => {
  let seeded: SeededSite

  beforeEach(async () => {
    await clearState()
    seeded = await seedSiteAudit()
  })
  afterEach(clearState)

  it('matches buildSiteAuditSummary on the same seeded children', async () => {
    const children = await loadChildrenForLiveSummary(seeded.siteAuditId)
    const live = buildSiteAuditSummary(children)
    const fallback = await buildSummaryFromFindings(seeded.siteAuditId)
    expect(fallback).not.toBeNull()

    // Aggregate identical (passCount/incompleteCount stamped by the post-C3 mapper).
    expect(fallback!.aggregate).toEqual(live.aggregate)
    // PDFs identical, including skipped in the aggregate.
    expect(fallback!.pdfsAggregate).toEqual(live.pdfsAggregate)
    expect(fallback!.pdfsAggregate.skipped).toBe(1)
    expect(fallback!.pdfsAggregate.withIssues).toBe(1)

    // Same page set; per-page scorecards, violationIds (set compare),
    // lighthouse passthrough, pdf state.
    const liveByUrl = byUrl(live.pages)
    const fbByUrl = byUrl(fallback!.pages)
    expect([...fbByUrl.keys()].sort()).toEqual([...liveByUrl.keys()].sort())
    for (const [url, livePage] of liveByUrl) {
      const fbPage = fbByUrl.get(url)!
      expect(fbPage.status).toBe(livePage.status)
      expect(fbPage.scorecard).toEqual(livePage.scorecard)
      expect(new Set(fbPage.violationIds)).toEqual(new Set(livePage.violationIds))
      expect(fbPage.lighthouse).toEqual(livePage.lighthouse)
      expect(fbPage.pdfs).toEqual(livePage.pdfs)
      expect(fbPage.adaAuditId).toBe(livePage.adaAuditId)
    }
  })

  it('marks the summary archived and carries aggregate + per-page archivedCounts', async () => {
    const fallback = await buildSummaryFromFindings(seeded.siteAuditId)
    expect(fallback!.archived).toBe(true)
    // 5 complete pages × (2 passes, 1 incomplete).
    expect(fallback!.archivedCounts).toEqual({ passed: 10, incomplete: 5 })
    const complete = fallback!.pages.filter((p) => p.status === 'complete')
    expect(complete).toHaveLength(5)
    for (const p of complete) {
      expect(p.archivedCounts).toEqual({ passed: 2, incomplete: 1 })
    }
  })

  it('emits a minimal row for the redirected page', async () => {
    const fallback = await buildSummaryFromFindings(seeded.siteAuditId)
    const redirected = fallback!.pages.find((p) => p.status === 'redirected')
    expect(redirected).toBeDefined()
    expect(redirected!.url).toBe(`https://${SITE_DOMAIN}/old`)
    expect(redirected!.scorecard).toBeNull()
    expect(redirected!.finalUrl).toBe(`https://${SITE_DOMAIN}/new`)
    expect(redirected!.violationIds).toEqual([])
    expect(redirected!.pdfs).toEqual({ total: 0, complete: 0, errored: 0, withIssues: 0 })
  })

  it('matches live commonIssues counts and tier (hints best-effort)', async () => {
    const children = await loadChildrenForLiveSummary(seeded.siteAuditId)
    const live = buildSiteAuditSummary(children)
    const fallback = await buildSummaryFromFindings(seeded.siteAuditId)

    const liveCommon = (live.commonIssues ?? []).map((c) => ({
      ruleId: c.ruleId, impact: c.impact, affectedPagesCount: c.affectedPagesCount,
      totalPagesScanned: c.totalPagesScanned, tier: c.tier,
    }))
    const fbCommon = (fallback!.commonIssues ?? []).map((c) => ({
      ruleId: c.ruleId, impact: c.impact, affectedPagesCount: c.affectedPagesCount,
      totalPagesScanned: c.totalPagesScanned, tier: c.tier,
    }))
    expect(fbCommon).toEqual(liveCommon)
    // The seeded shape itself: one rule on all 5 complete pages → template.
    expect(fbCommon).toEqual([{
      ruleId: 'color-contrast', impact: 'serious',
      affectedPagesCount: 5, totalPagesScanned: 5, tier: 'template',
    }])
  })

  it('renders 0 in the scorecard but null archivedCounts when passCount is unknown (pre-C3 rows)', async () => {
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { siteAuditId_tool: { siteAuditId: seeded.siteAuditId, tool: 'ada-audit' } } })
    await prisma.crawlPage.updateMany({ where: { runId: run.id }, data: { passCount: null } })

    const fallback = await buildSummaryFromFindings(seeded.siteAuditId)
    const complete = fallback!.pages.filter((p) => p.status === 'complete')
    for (const p of complete) {
      expect(p.scorecard!.passed).toBe(0)
      expect(p.archivedCounts!.passed).toBeNull()
      // incompleteCount untouched — still known.
      expect(p.archivedCounts!.incomplete).toBe(1)
    }
    // Every page null → aggregate passed unknown, incomplete still summed.
    expect(fallback!.archivedCounts!.passed).toBeNull()
    expect(fallback!.archivedCounts!.incomplete).toBe(5)
  })

  it('returns null when no CrawlRun exists for the site audit', async () => {
    expect(await buildSummaryFromFindings('c3fb-no-such-site-audit')).toBeNull()
  })
})

describe('buildArchivedAxeResults', () => {
  let seeded: SeededSite

  beforeEach(async () => {
    await clearState()
    seeded = await seedSiteAudit()
  })
  afterEach(clearState)

  it('synthesizes degraded StoredAxeResults for a site-audit child via CrawlPage.adaAuditId', async () => {
    // page-1: color-contrast only (no extra rule).
    const results = await buildArchivedAxeResults(seeded.childIds[1])
    expect(results).not.toBeNull()
    expect(results!.archived).toBe(true)
    expect(results!.url).toBe(`https://${SITE_DOMAIN}/page-1`)
    expect(results!.passes).toEqual([])
    expect(results!.incomplete).toEqual([])
    expect(results!.inapplicable).toEqual([])
    expect(results!.archivedCounts).toEqual({ passed: 2, incomplete: 1 })
    expect(results!.testRunner.name).toBe('archived-findings')

    expect(results!.violations).toHaveLength(1)
    const v = results!.violations[0]
    expect(v.id).toBe('color-contrast')
    expect(v.impact).toBe('serious')
    expect(v.help).toBe('Elements must have sufficient color contrast')
    // description degraded to help by contract.
    expect(v.description).toBe('Elements must have sufficient color contrast')
    expect(v.helpUrl).toBe('https://example.org/cc')
    expect(v.tags).toEqual(['wcag2aa', 'cat.color'])
    // Capped nodes survive with html + target (failureSummary/screenshots gone).
    expect(v.nodes).toEqual([
      { html: '<a class="cta">x</a>', target: ['footer > a.cta'] },
      { html: '<p>y</p>', target: ['footer > p'] },
    ])
  })

  it('resolves standalone audits and maps the unknown impact sentinel back to null', async () => {
    const url = `https://${SOLO_DOMAIN}/solo`
    const audit = await prisma.adaAudit.create({
      data: {
        url,
        status: 'complete',
        wcagLevel: 'wcag21aa',
        startedAt: new Date(),
        completedAt: new Date(),
        result: JSON.stringify({
          violations: [
            {
              id: 'impactless-rule', impact: null, help: 'No impact metadata',
              description: 'd', helpUrl: 'https://example.org/x', tags: ['best-practice'],
              nodes: [{ html: '<span>z</span>', target: ['span'] }],
            },
          ],
          passes: [{ id: 'p1', help: 'p', nodes: [] }],
          incomplete: [],
          inapplicable: [],
          timestamp: '2026-06-12T00:00:00Z',
          url,
          testEngine: { name: 'axe-core', version: '4.10' },
          testRunner: { name: 'er-seo-tools' },
        }),
      },
    })
    await writeAdaSingleFindings(audit.id)

    const results = await buildArchivedAxeResults(audit.id)
    expect(results).not.toBeNull()
    expect(results!.archived).toBe(true)
    expect(results!.url).toBe(url)
    expect(results!.archivedCounts).toEqual({ passed: 1, incomplete: 0 })
    expect(results!.violations).toHaveLength(1)
    expect(results!.violations[0].id).toBe('impactless-rule')
    // Stored as the 'unknown' sentinel; synthesized back to null.
    expect(results!.violations[0].impact).toBeNull()
  })

  it('returns null for an unknown audit id (pre-A2 / dual-write failure)', async () => {
    expect(await buildArchivedAxeResults('c3fb-no-such-ada-audit')).toBeNull()
  })
})
