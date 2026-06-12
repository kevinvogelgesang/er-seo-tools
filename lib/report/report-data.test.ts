// lib/report/report-data.test.ts — DB-backed (DATABASE_URL="file:./local-dev.db").
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@/lib/db'
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers'
import type { SiteAuditSummary } from '@/lib/ada-audit/types'
import { loadSiteReportData } from './report-data'

const PREFIX = 'c4rpt-'
const siteAuditIds: string[] = []
const screenshotDirs: string[] = []
const looseFiles: string[] = []

beforeAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
})

afterAll(async () => {
  // CrawlRun by domain BEFORE origin rows (subtree cascades from CrawlRun).
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  if (siteAuditIds.length) {
    await prisma.siteAudit.deleteMany({ where: { id: { in: siteAuditIds } } })
  }
  for (const dir of screenshotDirs) await fs.rm(dir, { recursive: true, force: true })
  for (const file of looseFiles) await fs.rm(file, { force: true })
})

interface SeedViolation {
  ruleId: string
  impact: string
  help?: string | null
  helpUrl?: string | null
  nodes?: string | null
}

interface SeedPage {
  url: string
  adaAuditId?: string | null
  passCount?: number | null
  incompleteCount?: number | null
  violations?: SeedViolation[]
}

function summaryBlob(pages: { url: string; critical?: number; serious?: number }[]): string {
  const pageRows = pages.map((p) => {
    const critical = p.critical ?? 0
    const serious = p.serious ?? 0
    return {
      adaAuditId: '', url: p.url, status: 'complete', error: null,
      scorecard: { critical, serious, moderate: 0, minor: 0, total: critical + serious, passed: 25, incomplete: 1 },
      lighthouse: null, pdfs: { total: 0, complete: 0, errored: 0, withIssues: 0 },
    }
  }).sort((a, b) => b.scorecard.total - a.scorecard.total)
  const aggregate = pageRows.reduce(
    (acc, p) => ({
      critical: acc.critical + p.scorecard.critical,
      serious: acc.serious + p.scorecard.serious,
      moderate: 0, minor: 0,
      total: acc.total + p.scorecard.total,
      passed: acc.passed + p.scorecard.passed,
      incomplete: acc.incomplete + p.scorecard.incomplete,
    }),
    { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 0, incomplete: 0 },
  )
  const summary: SiteAuditSummary = {
    aggregate,
    pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
    pages: pageRows as SiteAuditSummary['pages'],
  }
  return JSON.stringify(summary)
}

async function seedAudit(opts: {
  domain: string
  completedAt: Date
  wcagLevel?: string
  runScore?: number | null
  summary?: string | null
  requestedBy?: string | null
  pdfsTotal?: number
  pages: SeedPage[]
  skipRun?: boolean
}) {
  const wcagLevel = opts.wcagLevel ?? 'wcag21aa'
  const audit = await prisma.siteAudit.create({
    data: {
      domain: opts.domain, status: 'complete', wcagLevel,
      completedAt: opts.completedAt, summary: opts.summary ?? null,
      requestedBy: opts.requestedBy ?? null, pagesTotal: opts.pages.length,
      pdfsTotal: opts.pdfsTotal ?? 0,
    },
  })
  siteAuditIds.push(audit.id)
  if (opts.skipRun) return { auditId: audit.id, runId: null as string | null }

  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'site-audit', domain: opts.domain, wcagLevel,
      status: 'complete', score: opts.runScore ?? null,
      pagesTotal: opts.pages.length, completedAt: opts.completedAt, siteAuditId: audit.id,
    },
  })
  for (const p of opts.pages) {
    const page = await prisma.crawlPage.create({
      data: {
        runId: run.id, url: p.url, status: 'complete',
        adaAuditId: p.adaAuditId ?? null,
        passCount: p.passCount ?? null, incompleteCount: p.incompleteCount ?? null,
      },
    })
    for (const v of p.violations ?? []) {
      const finding = await prisma.finding.create({
        data: {
          runId: run.id, pageId: page.id, scope: 'page', type: v.ruleId,
          severity: 'critical', url: p.url, dedupKey: `${v.ruleId}::${p.url}`,
        },
      })
      await prisma.violation.create({
        data: {
          findingId: finding.id, runId: run.id, pageId: page.id,
          ruleId: v.ruleId, impact: v.impact, wcagTags: '[]',
          help: v.help ?? null, helpUrl: v.helpUrl ?? null,
          nodeCount: 1, nodes: v.nodes ?? null,
        },
      })
    }
  }
  return { auditId: audit.id, runId: run.id }
}

async function seedChildWithScreenshot(opts: {
  siteAuditId: string
  url: string
  ruleId: string
  screenshotPath: string
  createFile: boolean
}): Promise<string> {
  const child = await prisma.adaAudit.create({
    data: {
      url: opts.url, status: 'complete', siteAuditId: opts.siteAuditId,
      result: JSON.stringify({
        violations: [{
          id: opts.ruleId, impact: 'critical', help: 'h', description: 'd', helpUrl: '',
          tags: [], nodes: [{ html: '<img>', screenshotPath: opts.screenshotPath }],
        }],
        passes: [], incomplete: [], inapplicable: [],
        timestamp: '', url: opts.url,
        testEngine: { name: 'axe-core', version: '4' }, testRunner: { name: 'test' },
      }),
    },
  })
  if (opts.createFile) {
    const dir = path.join(SCREENSHOTS_DIR, child.id)
    screenshotDirs.push(dir)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, opts.screenshotPath), Buffer.from('fake-png-bytes'))
  }
  return child.id
}

describe('loadSiteReportData', () => {
  it('returns null for a missing audit and for an audit without a CrawlRun (findings-run-only)', async () => {
    expect(await loadSiteReportData('c4rpt-no-such-audit')).toBeNull()
    const preA2 = await seedAudit({
      domain: `${PREFIX}prea2.example`, completedAt: new Date('2026-06-01T00:00:00Z'),
      summary: summaryBlob([{ url: 'https://x/a', critical: 1 }]),
      pages: [], skipRun: true,
    })
    expect(await loadSiteReportData(preA2.auditId)).toBeNull()
  })

  it('assembles a fresh-blob audit: topIssues from Violation rows, CrawlRun score, worst pages, PDFs', async () => {
    const domain = `${PREFIX}fresh.example`
    const base = `https://${domain}`
    const seeded = await seedAudit({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      runScore: 88, requestedBy: 'Kevin', pdfsTotal: 2,
      summary: summaryBlob([
        { url: `${base}/a`, critical: 1, serious: 1 },
        { url: `${base}/b`, serious: 1 },
        { url: `${base}/clean` },
      ]),
      pages: [
        {
          url: `${base}/a`,
          violations: [
            { ruleId: 'image-alt', impact: 'critical', help: 'Images need alt', nodes: JSON.stringify([{ html: '<img src="x">' }]) },
            { ruleId: 'color-contrast', impact: 'serious', help: 'Contrast' },
            { ruleId: 'mystery', impact: 'unknown' },
          ],
        },
        { url: `${base}/b`, violations: [{ ruleId: 'color-contrast', impact: 'serious' }] },
        { url: `${base}/clean` },
      ],
    })
    await prisma.pdfAudit.create({
      data: { siteAuditId: seeded.auditId, url: `${base}/doc1.pdf`, status: 'complete', issues: '[{"type":"untagged"}]' },
    })
    await prisma.pdfAudit.create({
      data: { siteAuditId: seeded.auditId, url: `${base}/doc2.pdf`, status: 'complete', issues: '[]' },
    })

    const data = await loadSiteReportData(seeded.auditId)
    expect(data).not.toBeNull()
    expect(data!.archived).toBe(false)
    expect(data!.score).toBe(88) // CrawlRun.score wins over the computed score
    expect(data!.requestedBy).toBe('Kevin')
    expect(data!.auditDate).toBe('2026-06-01T00:00:00.000Z')

    // Impact rank then pageCount desc; 'unknown' sentinel sorts last.
    expect(data!.topIssues.map((i) => i.ruleId)).toEqual(['image-alt', 'color-contrast', 'mystery'])
    expect(data!.topIssues[1].pageCount).toBe(2)
    expect(data!.topIssues[1].sampleUrls).toEqual([`${base}/a`, `${base}/b`])
    expect(data!.topIssues[0].nodeSamples).toEqual(['<img src="x">'])
    expect(data!.topIssues[0].help).toBe('Images need alt')
    expect(data!.topIssues[2].impact).toBe('unknown')
    expect(data!.topIssues.every((i) => i.screenshot === null)).toBe(true)

    // Worst pages exclude the clean page; issuePagesTotal is the uncapped count.
    expect(data!.worstPages.map((p) => p.url)).toEqual([`${base}/a`, `${base}/b`])
    expect(data!.issuePagesTotal).toBe(2)

    expect(data!.pdfsTotal).toBe(2)
    expect(data!.pdfsWithIssues).toBe(1)

    // Only run on this domain → no diff, one trend point.
    expect(data!.diff).toBeNull()
    expect(data!.previousCompletedAt).toBeNull()
    expect(data!.trend.map((p) => p.score)).toEqual([88])
  })

  it('archived audit (null blob): fallback summary, archived:true, computed score, screenshots skipped', async () => {
    const domain = `${PREFIX}arch.example`
    const base = `https://${domain}`
    const seeded = await seedAudit({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      runScore: null, summary: null,
      pages: [{
        url: `${base}/a`, passCount: null, incompleteCount: null,
        violations: [{ ruleId: 'image-alt', impact: 'critical', nodes: JSON.stringify([{ html: '<img>' }]) }],
      }],
    })
    // Child blob + real file exist — the archived gate must still skip screenshots.
    const childId = await seedChildWithScreenshot({
      siteAuditId: seeded.auditId, url: `${base}/a`,
      ruleId: 'image-alt', screenshotPath: 'image-alt-0.png', createFile: true,
    })
    await prisma.crawlPage.updateMany({
      where: { url: `${base}/a` }, data: { adaAuditId: childId },
    })

    const data = await loadSiteReportData(seeded.auditId)
    expect(data).not.toBeNull()
    expect(data!.archived).toBe(true)
    // 1 critical → penalty 4 / log10(10) → 96; compliant false.
    expect(data!.score).toBe(96)
    expect(data!.compliant).toBe(false)
    // pre-C3 child scalars are null → unknown, never 0.
    expect(data!.archivedCounts).toEqual({ passed: null, incomplete: null })
    expect(data!.topIssues).toHaveLength(1)
    expect(data!.topIssues[0].screenshot).toBeNull()
  })

  it('embeds a child-blob screenshot as a data URI on fresh audits', async () => {
    const domain = `${PREFIX}shot.example`
    const base = `https://${domain}`
    const seeded = await seedAudit({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      runScore: 90, summary: summaryBlob([{ url: `${base}/a`, critical: 1 }]),
      pages: [], // pages created below so adaAuditId can point at the child
    })
    const childId = await seedChildWithScreenshot({
      siteAuditId: seeded.auditId, url: `${base}/a`,
      ruleId: 'image-alt', screenshotPath: 'image-alt-0.png', createFile: true,
    })
    const page = await prisma.crawlPage.create({
      data: { runId: seeded.runId!, url: `${base}/a`, status: 'complete', adaAuditId: childId },
    })
    const finding = await prisma.finding.create({
      data: {
        runId: seeded.runId!, pageId: page.id, scope: 'page', type: 'image-alt',
        severity: 'critical', url: `${base}/a`, dedupKey: `image-alt::${base}/a`,
      },
    })
    await prisma.violation.create({
      data: {
        findingId: finding.id, runId: seeded.runId!, pageId: page.id,
        ruleId: 'image-alt', impact: 'critical', wcagTags: '[]', nodeCount: 1,
        nodes: JSON.stringify([{ html: '<img>' }]),
      },
    })

    const data = await loadSiteReportData(seeded.auditId)
    expect(data!.topIssues[0].screenshot).toBe(
      `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`)
  })

  it('rejects traversal screenshotPaths even when the target file exists', async () => {
    const domain = `${PREFIX}trav.example`
    const base = `https://${domain}`
    const seeded = await seedAudit({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      runScore: 90, summary: summaryBlob([{ url: `${base}/a`, critical: 1 }]),
      pages: [],
    })
    // Plant a real file one level above the child dir; the guard must refuse it.
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true })
    const evil = path.join(SCREENSHOTS_DIR, 'c4rpt-evil.png')
    looseFiles.push(evil)
    await fs.writeFile(evil, Buffer.from('secret'))

    const childId = await seedChildWithScreenshot({
      siteAuditId: seeded.auditId, url: `${base}/a`,
      ruleId: 'image-alt', screenshotPath: '../c4rpt-evil.png', createFile: false,
    })
    const page = await prisma.crawlPage.create({
      data: { runId: seeded.runId!, url: `${base}/a`, status: 'complete', adaAuditId: childId },
    })
    const finding = await prisma.finding.create({
      data: {
        runId: seeded.runId!, pageId: page.id, scope: 'page', type: 'image-alt',
        severity: 'critical', url: `${base}/a`, dedupKey: `image-alt::${base}/a`,
      },
    })
    await prisma.violation.create({
      data: {
        findingId: finding.id, runId: seeded.runId!, pageId: page.id,
        ruleId: 'image-alt', impact: 'critical', wcagTags: '[]', nodeCount: 1, nodes: null,
      },
    })

    const data = await loadSiteReportData(seeded.auditId)
    expect(data!.topIssues[0].screenshot).toBeNull()
  })

  it('trend includes only same-domain same-level scored site runs; diff anchors to the previous run', async () => {
    const domain = `${PREFIX}trend.example`
    const base = `https://${domain}`
    await seedAudit({
      domain, completedAt: new Date('2026-05-01T00:00:00Z'),
      runScore: 50, summary: summaryBlob([{ url: `${base}/a` }]),
      pages: [{ url: `${base}/a` }],
    })
    // Same domain, different wcagLevel → excluded.
    await seedAudit({
      domain, wcagLevel: 'wcag22aa', completedAt: new Date('2026-05-15T00:00:00Z'),
      runScore: 10, summary: summaryBlob([{ url: `${base}/a` }]),
      pages: [{ url: `${base}/a` }],
    })
    // Different domain → excluded.
    await seedAudit({
      domain: `${PREFIX}other.example`, completedAt: new Date('2026-05-20T00:00:00Z'),
      runScore: 99, summary: summaryBlob([{ url: 'https://c4rpt-other.example/a' }]),
      pages: [{ url: 'https://c4rpt-other.example/a' }],
    })
    const current = await seedAudit({
      domain, completedAt: new Date('2026-06-01T00:00:00Z'),
      runScore: 70, summary: summaryBlob([{ url: `${base}/a` }]),
      pages: [{ url: `${base}/a` }],
    })

    const data = await loadSiteReportData(current.auditId)
    expect(data!.trend.map((p) => p.score)).toEqual([50, 70])
    expect(data!.trend.map((p) => p.date)).toEqual([
      '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z',
    ])
    // Level-matched previous run found → diff present.
    expect(data!.diff).not.toBeNull()
    expect(data!.previousCompletedAt).toBe('2026-05-01T00:00:00.000Z')
  })
})
