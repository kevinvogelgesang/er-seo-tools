// DB-backed: full synthetic fixture — prospect + complete audit + summary blob
// + ada/seo CrawlRuns + child with lighthouseSummary. ZERO network.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { loadSalesReportData } from './sales-report-data'

const PREFIX = 'c14-load-'
async function cleanup() {
  const prospects = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  const audits = await prisma.siteAudit.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  const auditIds = audits.map((a) => a.id)
  await prisma.crawlRun.deleteMany({ where: { siteAuditId: { in: auditIds } } })
  await prisma.adaAudit.deleteMany({ where: { siteAuditId: { in: auditIds } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: auditIds } } })
  await prisma.prospect.deleteMany({ where: { id: { in: prospects.map((p) => p.id) } } })
}
beforeAll(cleanup)
afterAll(cleanup)

const future = () => new Date(Date.now() + 86_400_000)

function summaryBlob(domain: string) {
  return JSON.stringify({
    aggregate: { critical: 4, serious: 10, moderate: 2, minor: 1, total: 17, passed: 40, incomplete: 0 },
    pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
    pages: [],
    commonIssues: [{
      ruleId: 'color-contrast', impact: 'serious', help: 'Contrast', description: 'd', helpUrl: 'u',
      affectedPagesCount: 3, totalPagesScanned: 5, sharedAncestor: null, ancestorConfidence: null,
      examplePageUrl: `https://${domain}/a`,
    }],
  })
}

const lhSummary = JSON.stringify({
  scores: { performance: 40, accessibility: 90, bestPractices: 90 },
  cwv: { lcp: 4200, cls: 0.3, tbt: 700, lcpStatus: 'fail', clsStatus: 'fail', tbtStatus: 'fail' },
  topFailures: [],
})

const lhHome = JSON.stringify({
  scores: { performance: 55, accessibility: 90, bestPractices: 90 },
  cwv: { lcp: 3100, cls: 0.12, tbt: 350, lcpStatus: 'needs-improvement', clsStatus: 'needs-improvement', tbtStatus: 'needs-improvement' },
  topFailures: [],
})

async function seedReady() {
  const domain = `${PREFIX}ready.test`
  const prospect = await prisma.prospect.create({
    data: { name: 'Ready U', domain, createdBy: 'Kevin', salesToken: crypto.randomUUID(), salesTokenExpiresAt: future() },
  })
  const audit = await prisma.siteAudit.create({
    data: {
      domain, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id,
      completedAt: new Date(), pagesTotal: 5, summary: summaryBlob(domain),
    },
  })
  const childUrls = [`https://${domain}/`, `https://${domain}/a`, `https://${domain}/b`]
  for (const url of childUrls) {
    await prisma.adaAudit.create({
      data: { url, status: 'complete', siteAuditId: audit.id, lighthouseSummary: url.endsWith('/') ? lhHome : lhSummary },
    })
  }
  await prisma.siteAudit.update({ where: { id: audit.id }, data: { homepageScreenshot: `${audit.id}.png` } })
  await prisma.crawlRun.create({
    data: {
      id: `${PREFIX}ada-run`, tool: 'ada-audit', source: 'site-audit', domain, siteAuditId: audit.id,
      status: 'complete', score: 62, pagesTotal: 5, startedAt: new Date(), completedAt: new Date(),
    },
  })
  await prisma.crawlRun.create({
    data: {
      id: `${PREFIX}seo-run`, tool: 'seo-parser', source: 'live-scan', domain, siteAuditId: audit.id,
      status: 'complete', score: 71, pagesTotal: 5, startedAt: new Date(), completedAt: new Date(),
      schemaTypesJson: JSON.stringify({ v: 1, observedPages: 5, pagesWithSchema: 2, types: [{ type: 'Organization', pages: 2 }] }),
      findings: {
        create: [
          { scope: 'run', type: 'broken_internal_links', severity: 'critical', count: 7, dedupKey: `${PREFIX}f1`, affectedComplete: true },
          { scope: 'page', type: 'broken_internal_links', severity: 'critical', count: 3, url: `https://${domain}/0`, dedupKey: `${PREFIX}f2` },
          { scope: 'run', type: 'missing_title', severity: 'warning', count: 2, dedupKey: `${PREFIX}f3` },
          { scope: 'page', type: 'broken_internal_links', severity: 'critical', count: 2, url: `https://${domain}/1`, dedupKey: `${PREFIX}f4`, affectedComplete: true },
        ],
      },
    },
  })
  return { prospect, audit }
}

describe('loadSalesReportData', () => {
  it('invalid on unknown/expired token', async () => {
    expect((await loadSalesReportData('nope')).kind).toBe('invalid')
    const p = await prisma.prospect.create({
      data: { name: 'Exp', domain: `${PREFIX}exp.test`, salesToken: crypto.randomUUID(), salesTokenExpiresAt: new Date(Date.now() - 1000) },
    })
    expect((await loadSalesReportData(p.salesToken!)).kind).toBe('invalid')
  })

  it('pending when no reportable audit (complete but no seo run)', async () => {
    const p = await prisma.prospect.create({
      data: { name: 'Pend U', domain: `${PREFIX}pend.test`, salesToken: crypto.randomUUID(), salesTokenExpiresAt: future() },
    })
    await prisma.siteAudit.create({
      data: { domain: `${PREFIX}pend.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: p.id, completedAt: new Date() },
    })
    const out = await loadSalesReportData(p.salesToken!)
    expect(out.kind).toBe('pending')
    if (out.kind === 'pending') expect(out.prospect.name).toBe('Pend U')
  })

  it('assembles the full report for a reportable audit', async () => {
    const { prospect, audit } = await seedReady()
    const out = await loadSalesReportData(prospect.salesToken!)
    expect(out.kind).toBe('ready')
    if (out.kind !== 'ready') return
    const d = out.data
    expect(d.auditId).toBe(audit.id)
    expect(d.preparedBy).toBe('Kevin')
    expect(d.standardTested).toBe('WCAG 2.1 AA')
    expect(d.heroScreenshot).toBe(true)
    expect(d.headline).toEqual({ accessibilityScore: 62, seoScore: 71, performanceScore: 40, schemaCoveragePct: 40 })
    // overall = round((62 + 71 + 40 + 40) / 4) = 53
    expect(d.overallScore).toBe(53)
    expect(d.accessibility.counts.critical).toBe(4)
    const broken = d.seo.issueGroups.find((g) => g.type === 'broken_internal_links')
    expect(broken?.count).toBe(7)               // issue-specific unit (distinct targets)
    expect(broken?.affectedPages).toBe(2)       // distinct page-scope URLs
    expect(broken?.affectedComplete).toBe(true)
    expect(d.performance.rollup?.measuredPages).toBe(3)
    // homepage CWV resolved from the root child, independent of the rollup
    expect(d.performance.homepage).toEqual({
      performance: 55, lcpMs: 3100, cls: 0.12, tbtMs: 350,
      lcpStatus: 'needs-improvement', clsStatus: 'needs-improvement', tbtStatus: 'needs-improvement',
    })
    expect(d.geo.missingHighValueTypes).toContain('Course')
    expect(d.seoUnavailable).toBe(false) // real live-scan run
  })

  // Verifier-memory-loop fix (Task 4): the exhausted verifier's terminal
  // placeholder run (source: 'live-scan-placeholder') still counts as
  // "reportable" (pinned decision — ADA-only report, never "being prepared"
  // forever) but must surface as SEO-unavailable rather than a real SEO run.
  it('seoUnavailable=true when the only seo-parser run is an exhausted-verifier placeholder', async () => {
    const domain = `${PREFIX}placeholder.test`
    const prospect = await prisma.prospect.create({
      data: { name: 'Placeholder U', domain, createdBy: 'Kevin', salesToken: crypto.randomUUID(), salesTokenExpiresAt: future() },
    })
    const audit = await prisma.siteAudit.create({
      data: { domain, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id, completedAt: new Date(), pagesTotal: 3 },
    })
    await prisma.crawlRun.create({
      data: {
        id: `${PREFIX}placeholder-run`, tool: 'seo-parser', source: 'live-scan-placeholder', domain,
        siteAuditId: audit.id, status: 'partial', seoIntent: false,
      },
    })
    const out = await loadSalesReportData(prospect.salesToken!)
    expect(out.kind).toBe('ready') // placeholder still counts as reportable
    if (out.kind !== 'ready') return
    expect(out.data.seoUnavailable).toBe(true)
    expect(out.data.seo.score).toBeNull()
  })

  it('overallScore averages only available metrics; null when none exist', async () => {
    const p = await prisma.prospect.create({
      data: { name: 'Avg U', domain: `${PREFIX}avg.test`, salesToken: crypto.randomUUID(), salesTokenExpiresAt: future() },
    })
    const audit = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}avg.test`, wcagLevel: 'wcag22aa', status: 'complete', completedAt: new Date(), prospectId: p.id },
    })
    // seo run only, no schema json, no ada run, no LH children → seoScore is the only metric
    await prisma.crawlRun.create({
      data: {
        id: `${PREFIX}avg-seo`, tool: 'seo-parser', source: 'live-scan', domain: `${PREFIX}avg.test`,
        siteAuditId: audit.id, status: 'complete', score: 80, pagesTotal: 1, startedAt: new Date(), completedAt: new Date(),
      },
    })
    const out = await loadSalesReportData(p.salesToken!)
    expect(out.kind).toBe('ready')
    if (out.kind !== 'ready') return
    expect(out.data.overallScore).toBe(80)              // 80/1, nulls excluded from the denominator
    expect(out.data.standardTested).toBe('WCAG 2.2 AA + best practices')
    expect(out.data.heroScreenshot).toBe(false)          // column null → slot hidden
    expect(out.data.performance.rollup).toBeNull()
    expect(out.data.performance.homepage).toBeNull()
  })

  it('affectedComplete=false surfaces from a capped run-scope finding', async () => {
    const p = await prisma.prospect.create({
      data: { name: 'Cap U', domain: `${PREFIX}cap.test`, salesToken: crypto.randomUUID(), salesTokenExpiresAt: future() },
    })
    const audit = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}cap.test`, wcagLevel: 'wcag21aa', status: 'complete', completedAt: new Date(), prospectId: p.id },
    })
    await prisma.crawlRun.create({
      data: {
        id: `${PREFIX}cap-seo`, tool: 'seo-parser', source: 'live-scan', domain: `${PREFIX}cap.test`,
        siteAuditId: audit.id, status: 'complete', score: 50, pagesTotal: 3, startedAt: new Date(), completedAt: new Date(),
        findings: {
          create: [
            { scope: 'run', type: 'thin_content', severity: 'warning', count: 9, dedupKey: `${PREFIX}c1`, affectedComplete: false },
            { scope: 'page', type: 'thin_content', severity: 'warning', count: 1, url: `https://${PREFIX}cap.test/a`, dedupKey: `${PREFIX}c2` },
          ],
        },
      },
    })
    const out = await loadSalesReportData(p.salesToken!)
    if (out.kind !== 'ready') throw new Error('expected ready')
    const g = out.data.seo.issueGroups.find((x) => x.type === 'thin_content')
    expect(g?.affectedPages).toBe(1)
    expect(g?.affectedComplete).toBe(false)
  })
})
