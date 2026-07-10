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
  for (let i = 0; i < 3; i++) {
    await prisma.adaAudit.create({
      data: { url: `https://${domain}/${i}`, status: 'complete', siteAuditId: audit.id, lighthouseSummary: lhSummary },
    })
  }
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
          { scope: 'run', type: 'broken_internal_links', severity: 'critical', count: 7, dedupKey: `${PREFIX}f1` },
          { scope: 'page', type: 'broken_internal_links', severity: 'critical', count: 3, url: `https://${domain}/0`, dedupKey: `${PREFIX}f2` },
          { scope: 'run', type: 'missing_title', severity: 'warning', count: 2, dedupKey: `${PREFIX}f3` },
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
    expect(d.headline.accessibilityScore).toBe(62)
    expect(d.headline.seoScore).toBe(71)
    expect(d.headline.performanceScore).toBe(40)
    expect(d.headline.schemaCoveragePct).toBe(40) // 2/5
    expect(d.accessibility.counts.critical).toBe(4)
    expect(d.accessibility.patterns[0].ruleId).toBe('color-contrast')
    const broken = d.seo.issueGroups.find((g) => g.type === 'broken_internal_links')
    expect(broken?.count).toBe(7)
    expect(broken?.examplePages).toEqual([`https://${domain(audit)}/0`])
    expect(d.performance?.measuredPages).toBe(3)
    expect(d.geo.types).toContainEqual({ type: 'Organization', pages: 2 })
    expect(d.geo.missingHighValueTypes).toContain('Course')
  })
})

function domain(a: { domain: string }) { return a.domain }
