// lib/scoring/ada-v4-inputs.server.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { loadAdaV4InputsForRun } from './ada-v4-inputs.server'

const DOMAIN = 'ada-v4-inputs.test'

async function clearTestState() {
  // CrawlPage/Finding/Violation cascade from CrawlRun; SiteAudit is separate.
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}

interface PageSpec { score: number | null; incompleteCount: number | null }

async function makeRun(opts: {
  source: 'site-audit' | 'page-audit'
  siteAuditId?: string | null
  pages: PageSpec[]
}) {
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit',
      source: opts.source,
      domain: DOMAIN,
      status: 'complete',
      siteAuditId: opts.siteAuditId ?? null,
      pagesTotal: opts.pages.length,
    },
  })
  const pages = await Promise.all(opts.pages.map((p) => prisma.crawlPage.create({
    data: {
      runId: run.id,
      url: `https://${DOMAIN}/${randomUUID()}`,
      score: p.score,
      incompleteCount: p.incompleteCount,
    },
  })))
  return { run, pages }
}

async function addViolation(
  runId: string,
  pageId: string,
  ruleId: string,
  opts: { impact?: string; wcagTags?: string[]; dedupKey: string },
) {
  const findingId = randomUUID()
  await prisma.finding.create({
    data: {
      id: findingId, runId, pageId, scope: 'page', type: ruleId,
      severity: 'critical', dedupKey: opts.dedupKey,
    },
  })
  await prisma.violation.create({
    data: {
      findingId, runId, pageId, ruleId,
      impact: opts.impact ?? 'critical',
      wcagTags: JSON.stringify(opts.wcagTags ?? ['wcag2a']),
    },
  })
}

describe('loadAdaV4InputsForRun', () => {
  beforeEach(clearTestState)
  afterEach(clearTestState)

  it('returns null when a run has zero scored pages', async () => {
    const { run } = await makeRun({
      source: 'page-audit',
      pages: [{ score: null, incompleteCount: null }],
    })
    expect(await loadAdaV4InputsForRun(run.id)).toBeNull()
  })

  it('a clean run (pages, zero findings) returns rules: [], not null', async () => {
    const { run } = await makeRun({
      source: 'page-audit',
      pages: [
        { score: 100, incompleteCount: 0 },
        { score: 100, incompleteCount: 0 },
      ],
    })
    const inputs = await loadAdaV4InputsForRun(run.id)
    expect(inputs).not.toBeNull()
    expect(inputs!.pagesAudited).toBe(2)
    expect(inputs!.rules).toEqual([])
  })

  it('counts only score !== null pages as pagesAudited (scored-page definition)', async () => {
    const { run } = await makeRun({
      source: 'page-audit',
      pages: [
        { score: 90, incompleteCount: 0 },
        { score: 80, incompleteCount: 0 },
        { score: null, incompleteCount: null }, // errored/redirected page — excluded
      ],
    })
    const inputs = await loadAdaV4InputsForRun(run.id)
    expect(inputs!.pagesAudited).toBe(2)
  })

  it('averages null incompleteCount as 0', async () => {
    const { run } = await makeRun({
      source: 'page-audit',
      pages: [
        { score: 90, incompleteCount: 4 },
        { score: 80, incompleteCount: null },
      ],
    })
    const inputs = await loadAdaV4InputsForRun(run.id)
    expect(inputs!.meanIncomplete).toBe(2) // (4 + 0) / 2
  })

  it('pagesAffected is a DISTINCT pageId count, not a violation-row count', async () => {
    const { run, pages } = await makeRun({
      source: 'page-audit',
      pages: [
        { score: 90, incompleteCount: 0 },
        { score: 90, incompleteCount: 0 },
        { score: 90, incompleteCount: 0 },
        { score: 90, incompleteCount: 0 },
        { score: 90, incompleteCount: 0 },
      ],
    })
    // Two violation rows on the SAME page (pages[0]) for the same rule, plus
    // one each on pages[1] and pages[2] — 4 rows total, 3 distinct pages.
    await addViolation(run.id, pages[0].id, 'color-contrast', { dedupKey: 'k1' })
    await addViolation(run.id, pages[0].id, 'color-contrast', { dedupKey: 'k2' })
    await addViolation(run.id, pages[1].id, 'color-contrast', { dedupKey: 'k3' })
    await addViolation(run.id, pages[2].id, 'color-contrast', { dedupKey: 'k4' })

    const inputs = await loadAdaV4InputsForRun(run.id)
    expect(inputs!.rules).toHaveLength(1)
    expect(inputs!.rules[0]).toMatchObject({
      ruleId: 'color-contrast', impact: 'critical', advisory: false, pagesAffected: 3,
    })
  })

  it('a site run picks up siteAudit.pagesTotal; a standalone run yields pagesTotal: null', async () => {
    const site = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', wcagLevel: 'wcag21aa', pagesTotal: 10 },
    })
    const { run: siteRun } = await makeRun({
      source: 'site-audit', siteAuditId: site.id,
      pages: [{ score: 90, incompleteCount: 0 }],
    })
    const siteInputs = await loadAdaV4InputsForRun(siteRun.id)
    expect(siteInputs!.pagesTotal).toBe(10)

    const { run: standaloneRun } = await makeRun({
      source: 'page-audit',
      pages: [{ score: 90, incompleteCount: 0 }],
    })
    const standaloneInputs = await loadAdaV4InputsForRun(standaloneRun.id)
    expect(standaloneInputs!.pagesTotal).toBeNull()
  })
})
