// scripts/dev-seed-prospect.ts
// Dev-only: seeds a Prospect + reportable synthetic SiteAudit so /sales and
// /sales/[token] can be browser-verified with NO external scanning.
// Run: npx tsx scripts/dev-seed-prospect.ts
import { prisma } from '@/lib/db'

async function main() {
  const domain = 'seeded-prospect.example'
  const token = crypto.randomUUID()
  const prospect = await prisma.prospect.create({
    data: {
      name: 'Seeded College', domain, createdBy: 'Kevin (seed)',
      salesToken: token, salesTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  })
  const audit = await prisma.siteAudit.create({
    data: {
      domain, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id,
      completedAt: new Date(), pagesTotal: 4,
      summary: JSON.stringify({
        aggregate: { critical: 3, serious: 8, moderate: 4, minor: 2, total: 17, passed: 41, incomplete: 1 },
        pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
        pages: [],
        commonIssues: [{
          ruleId: 'color-contrast', impact: 'serious', help: 'Elements must have sufficient color contrast',
          description: 'Text elements do not meet the 4.5:1 contrast ratio.', helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
          affectedPagesCount: 3, totalPagesScanned: 4, sharedAncestor: null, ancestorConfidence: null,
          examplePageUrl: `https://${domain}/programs`,
        }],
      }),
    },
  })
  const lh = (perf: number, lcp: number) => JSON.stringify({
    scores: { performance: perf, accessibility: 88, bestPractices: 92 },
    cwv: { lcp, cls: 0.12, tbt: 350, lcpStatus: lcp > 2500 ? 'fail' : 'pass', clsStatus: 'needs-improvement', tbtStatus: 'needs-improvement' },
    topFailures: [],
  })
  await prisma.adaAudit.create({
    data: {
      url: `https://${domain}/programs`, status: 'complete', siteAuditId: audit.id, lighthouseSummary: lh(38, 4600),
      result: JSON.stringify({
        violations: [{
          id: 'color-contrast', impact: 'serious', help: 'Elements must have sufficient color contrast',
          description: 'd', helpUrl: 'u', tags: [],
          nodes: [{ html: '<a class="apply-btn">Apply Now</a>', target: ['a.apply-btn'] }],
        }],
        passes: [], incomplete: [], inapplicable: [], timestamp: new Date().toISOString(),
        url: `https://${domain}/programs`, testEngine: { name: 'axe-core', version: '4' }, testRunner: { name: 'axe' },
      }),
    },
  })
  for (const [i, perf] of [72, 55].entries()) {
    await prisma.adaAudit.create({
      data: { url: `https://${domain}/p${i}`, status: 'complete', siteAuditId: audit.id, lighthouseSummary: lh(perf, 2200 + i * 900) },
    })
  }
  await prisma.crawlRun.create({
    data: {
      id: `seed-ada-${audit.id}`, tool: 'ada-audit', source: 'site-audit', domain, siteAuditId: audit.id,
      status: 'complete', score: 58, pagesTotal: 4, startedAt: new Date(), completedAt: new Date(),
    },
  })
  await prisma.crawlRun.create({
    data: {
      id: `seed-seo-${audit.id}`, tool: 'seo-parser', source: 'live-scan', domain, siteAuditId: audit.id,
      status: 'complete', score: 66, pagesTotal: 4, startedAt: new Date(), completedAt: new Date(),
      schemaTypesJson: JSON.stringify({ v: 1, observedPages: 4, pagesWithSchema: 1, types: [{ type: 'WebPage', pages: 1 }] }),
      contentSimilarityJson: JSON.stringify({
        v: 1,
        exactDuplicateGroups: [],
        nearDuplicateGroups: [{ urls: [`https://${domain}/a`, `https://${domain}/b`], similarity: 0.94 }],
      }),
      findings: {
        create: [
          { scope: 'run', type: 'broken_internal_links', severity: 'critical', count: 5, dedupKey: `seed-${audit.id}-1` },
          { scope: 'page', type: 'broken_internal_links', severity: 'critical', count: 2, url: `https://${domain}/programs`, dedupKey: `seed-${audit.id}-2` },
          { scope: 'run', type: 'missing_meta_description', severity: 'warning', count: 3, dedupKey: `seed-${audit.id}-3` },
        ],
      },
    },
  })
  console.log(`Seeded. Intake: http://localhost:3000/sales`)
  console.log(`Public report: http://localhost:3000/sales/${token}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
