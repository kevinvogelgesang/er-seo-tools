// lib/findings/parity.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import type { AggregatedResult } from '@/lib/types'
import { writeSeoFindings } from './seo-write'
import { writeAdaSiteFindings, writeAdaSingleFindings } from './ada-write'
import { compareSeoParity, compareAdaParity, compareAdaSingleParity } from './parity'

const SESSION_ID = 'test-findings-parity'

const RESULT = {
  crawl_summary: { total_urls: 2 },
  issues: {
    critical: [{ type: 'broken_pages', severity: 'critical', count: 1, description: 'broken', affectedUrlRefs: [0], affectedUrlRefsComplete: true }],
    warnings: [],
    notices: [{ type: 'thin_content', severity: 'notice', count: 1, description: 'thin', affectedUrlRefs: [1], affectedUrlRefsComplete: true }],
  },
  site_structure: {}, resources: {}, technical_seo: {}, performance: {},
  recommendations: [],
  metadata: { files_processed: [], parsers_used: [], total_parsers_available: 41, site_name: 'par.test', health_score: 70 },
  url_registry: {
    sessionOrigin: { scheme: 'https', host: 'par.test' },
    hosts: ['par.test'],
    urls: [
      { id: 0, kind: 'page', hostId: 0, scheme: 'https', path: '/a' },
      { id: 1, kind: 'page', hostId: 0, scheme: 'https', path: '/b' },
    ],
  },
  page_index: [
    { ref: 0, title: 'A', h1: null, metaDescription: null, wordCount: 10, crawlDepth: 1, indexable: true, issueTypes: ['broken_pages'] },
    { ref: 1, title: 'B', h1: null, metaDescription: null, wordCount: 20, crawlDepth: 1, indexable: true, issueTypes: ['thin_content'] },
  ],
} as unknown as AggregatedResult

async function clearTestState() {
  await prisma.crawlRun.deleteMany({
    where: { OR: [{ sessionId: SESSION_ID }, { domain: 'par.test' }] },
  })
  await prisma.session.deleteMany({ where: { id: SESSION_ID } })
}

describe('compareSeoParity', () => {
  beforeEach(async () => {
    await clearTestState()
    await prisma.session.create({
      data: { id: SESSION_ID, status: 'complete', files: '[]', result: JSON.stringify(RESULT) },
    })
  })
  afterEach(clearTestState)

  it('reports ok when tables match the blob', async () => {
    await writeSeoFindings(SESSION_ID, RESULT, null)
    const report = await compareSeoParity(SESSION_ID)
    expect(report.diffs).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('reports a diff when a finding is missing from the tables', async () => {
    await writeSeoFindings(SESSION_ID, RESULT, null)
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { sessionId: SESSION_ID } })
    await prisma.finding.deleteMany({ where: { runId: run.id, type: 'thin_content' } })
    const report = await compareSeoParity(SESSION_ID)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/thin_content/)
  })

  it('reports a diff when a stored finding has the right key but wrong fields', async () => {
    await writeSeoFindings(SESSION_ID, RESULT, null)
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { sessionId: SESSION_ID } })
    await prisma.finding.updateMany({
      where: { runId: run.id, type: 'broken_pages', scope: 'run' },
      data: { count: 999, severity: 'notice' },
    })
    const report = await compareSeoParity(SESSION_ID)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/count/)
    expect(report.diffs.join('\n')).toMatch(/severity/)
  })

  it('reports a diff when no run exists at all', async () => {
    const report = await compareSeoParity(SESSION_ID)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/no CrawlRun/i)
  })
})

// ── ADA parity ──────────────────────────────────────────────────────────────

const ADA_DOMAIN = 'par-ada.test'

const ADA_AXE_BLOB = JSON.stringify({
  violations: [
    {
      id: 'color-contrast', impact: 'serious', help: 'contrast', description: 'c',
      helpUrl: 'https://example.org/cc', tags: ['wcag2aa'],
      nodes: [{ html: '<a>x</a>', target: ['a'] }, { html: '<p>y</p>', target: ['p'] }],
    },
    {
      id: 'image-alt', impact: 'critical', help: 'alt', description: 'a',
      helpUrl: 'https://example.org/ia', tags: ['wcag2a'],
      nodes: [{ html: '<img>', target: ['img'] }],
    },
  ],
  passes: [], incomplete: [], inapplicable: [],
  timestamp: '2026-06-10T00:00:00Z', url: `https://${ADA_DOMAIN}/`,
  testEngine: { name: 'axe-core', version: '4.10' },
  testRunner: { name: 'er-seo-tools' },
})

// summary.aggregate matching the blob above: 1 critical + 1 serious.
const ADA_SUMMARY = JSON.stringify({
  aggregate: { critical: 1, serious: 1, moderate: 0, minor: 0, total: 2, passed: 0, incomplete: 0 },
  pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
  pages: [],
})

async function clearAdaTestState() {
  await prisma.crawlRun.deleteMany({ where: { domain: ADA_DOMAIN } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: ADA_DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: ADA_DOMAIN } })
}

describe('compareAdaParity', () => {
  let siteId: string

  beforeEach(async () => {
    await clearAdaTestState()
    const site = await prisma.siteAudit.create({
      data: {
        domain: ADA_DOMAIN, status: 'complete', wcagLevel: 'wcag21aa',
        pagesTotal: 2, pagesComplete: 1, pagesRedirected: 1,
        summary: ADA_SUMMARY, startedAt: new Date(), completedAt: new Date(),
      },
    })
    siteId = site.id
    await prisma.adaAudit.createMany({
      data: [
        { url: `https://${ADA_DOMAIN}/a`, status: 'complete', result: ADA_AXE_BLOB, siteAuditId: siteId, wcagLevel: 'wcag21aa' },
        { url: `https://${ADA_DOMAIN}/old`, status: 'redirected', finalUrl: `https://${ADA_DOMAIN}/new`, siteAuditId: siteId, wcagLevel: 'wcag21aa' },
      ],
    })
  })
  afterEach(clearAdaTestState)

  it('reports ok when tables match the child blobs and summary aggregate', async () => {
    await writeAdaSiteFindings(siteId)
    const report = await compareAdaParity(siteId)
    expect(report.diffs).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('reports a diff when a violation row is missing', async () => {
    await writeAdaSiteFindings(siteId)
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { siteAuditId: siteId } })
    await prisma.finding.deleteMany({ where: { runId: run.id, type: 'image-alt' } })
    const report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/image-alt/)
  })

  it('reports a diff when a stored nodeCount diverges from the blob', async () => {
    await writeAdaSiteFindings(siteId)
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { siteAuditId: siteId } })
    await prisma.violation.updateMany({
      where: { runId: run.id, ruleId: 'color-contrast' },
      data: { nodeCount: 99 },
    })
    const report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/nodeCount/)
  })

  it('reports ONLY an aggregate diff when summary.aggregate disagrees with the Violation rows', async () => {
    await writeAdaSiteFindings(siteId)
    // Corrupt the summary blob, NOT the rows: the stored rows still match the
    // child blobs (no missing-Finding noise), so any diff comes solely from
    // the independent Violation-rows-vs-summary.aggregate cross-check.
    const corrupted = JSON.parse(ADA_SUMMARY)
    corrupted.aggregate.critical = 5
    await prisma.siteAudit.update({
      where: { id: siteId },
      data: { summary: JSON.stringify(corrupted) },
    })
    const report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs).toEqual(['aggregate critical: violation rows=1 summary.aggregate=5'])
  })

  it('reports a diff when stored passCount is null (stale pre-C3 row) or wrong', async () => {
    await writeAdaSiteFindings(siteId)
    const run = await prisma.crawlRun.findUniqueOrThrow({ where: { siteAuditId: siteId } })
    // Fresh rebuild matches (covered by the ok test above). Null = stale row:
    await prisma.crawlPage.updateMany({ where: { runId: run.id, status: 'complete' }, data: { passCount: null } })
    let report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/passCount: tables=null/)
    // Wrong value also reported:
    await prisma.crawlPage.updateMany({ where: { runId: run.id, status: 'complete' }, data: { passCount: 999 } })
    report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/passCount: tables=999/)
  })

  it('reports a diff when a complete site audit has no summary blob', async () => {
    await writeAdaSiteFindings(siteId)
    await prisma.siteAudit.update({ where: { id: siteId }, data: { summary: null } })
    const report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/summary blob missing/)
  })

  it('reports a diff when no run exists at all', async () => {
    const report = await compareAdaParity(siteId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/no CrawlRun/i)
  })
})

describe('compareAdaSingleParity', () => {
  let auditId: string

  beforeEach(async () => {
    await clearAdaTestState()
    const audit = await prisma.adaAudit.create({
      data: {
        url: `https://${ADA_DOMAIN}/solo`, status: 'complete', result: ADA_AXE_BLOB,
        wcagLevel: 'wcag21aa', startedAt: new Date(), completedAt: new Date(),
      },
    })
    auditId = audit.id
  })
  afterEach(clearAdaTestState)

  it('reports ok when tables match the blob', async () => {
    await writeAdaSingleFindings(auditId)
    const report = await compareAdaSingleParity(auditId)
    expect(report.diffs).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('reports a diff when the stored run score diverges', async () => {
    await writeAdaSingleFindings(auditId)
    await prisma.crawlRun.update({ where: { adaAuditId: auditId }, data: { score: 1 } })
    const report = await compareAdaSingleParity(auditId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/score/)
  })

  it('reports a diff when no run exists at all', async () => {
    const report = await compareAdaSingleParity(auditId)
    expect(report.ok).toBe(false)
    expect(report.diffs.join('\n')).toMatch(/no CrawlRun/i)
  })
})
