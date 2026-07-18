import { describe, it, expect, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { loadAssessmentData } from './assessment'
import { setAssessmentNote } from './assessment-notes'

const clientIds: number[] = []
const auditIds: string[] = []

async function mkClient(domain = 'acme.edu') {
  const c = await prisma.client.create({
    data: { name: `vb-test-${randomUUID()}`, domains: JSON.stringify([domain]) },
  })
  clientIds.push(c.id)
  return c
}

async function mkViewbook(clientId: number) {
  return prisma.viewbook.create({
    data: { clientId, kind: 'upgrade', token: randomUUID() },
  })
}

interface AuditOpts {
  seoOnly?: boolean
  status?: string
  completedAt?: Date
  summary?: string | null
  domain?: string
  liveScan?: { score?: number | null; placeholder?: boolean; findings?: { type: string; count: number }[] } | null
  adaScore?: number | null
}

async function mkAudit(clientId: number, opts: AuditOpts = {}) {
  const audit = await prisma.siteAudit.create({
    data: {
      domain: opts.domain ?? 'acme.edu',
      status: opts.status ?? 'complete',
      seoOnly: opts.seoOnly ?? false,
      wcagLevel: 'wcag21aa',
      clientId,
      pagesTotal: 5,
      pagesComplete: 5,
      completedAt: opts.completedAt ?? new Date('2026-07-01T00:00:00Z'),
      summary: opts.summary ?? null,
    },
  })
  auditIds.push(audit.id)
  if (opts.adaScore !== null) {
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', status: 'complete', siteAuditId: audit.id, score: opts.adaScore ?? 82 },
    })
  }
  if (opts.liveScan !== null) {
    const ls = opts.liveScan ?? {}
    await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser',
        source: ls.placeholder ? 'live-scan-placeholder' : 'live-scan',
        status: ls.placeholder ? 'partial' : 'complete',
        siteAuditId: audit.id,
        score: ls.placeholder ? null : ls.score ?? 74,
        findings: {
          create: (ls.findings ?? []).map((f) => ({
            scope: 'run', type: f.type, severity: 'warning', count: f.count,
            dedupKey: `${f.type}-${randomUUID()}`,
          })),
        },
      },
    })
  }
  return audit
}

// SetNull FKs: client delete does NOT cascade SiteAudits/CrawlRuns — clean
// explicitly, in dependency order (child AdaAudits cascade from SiteAudit).
afterAll(async () => {
  await prisma.crawlRun.deleteMany({ where: { siteAuditId: { in: auditIds } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: auditIds } } })
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
})

describe('loadAssessmentData', () => {
  it('returns null for an unknown token', async () => {
    expect(await loadAssessmentData(randomUUID())).toBeNull()
  })

  it('resolves the token but returns a null assessment when the client has no reportable audit', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { seoOnly: true }) // seoOnly excluded
    await mkAudit(c.id, { status: 'error' }) // not complete
    await mkAudit(c.id, { liveScan: null }) // no seo-parser run
    const load = await loadAssessmentData(vb.token)
    expect(load).not.toBeNull()
    expect(load!.viewbookId).toBe(vb.id)
    expect(load!.assessment).toBeNull()
    expect(load!.notes).toBeNull() // no content row authored yet
  })

  it('returns operator notes even when no reportable audit exists', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await setAssessmentNote(vb.id, 'general', '<p>Heads up before the scan.</p>', 'op@er.com')
    const load = await loadAssessmentData(vb.token)
    expect(load).not.toBeNull()
    expect(load!.assessment).toBeNull()
    expect(load!.notes).not.toBeNull()
    expect(load!.notes!.generalNotesHtml).toContain('Heads up before the scan.')
  })

  it('builds the full payload from the newest reportable audit', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { completedAt: new Date('2026-06-01T00:00:00Z'), adaScore: 40 })
    const summary = JSON.stringify({
      commonIssues: [
        { ruleId: 'a', impact: 'moderate', help: 'Moderate thing', description: '', helpUrl: '', affectedPagesCount: 5, totalPagesScanned: 5, sharedAncestor: null, ancestorConfidence: null },
        { ruleId: 'b', impact: 'critical', help: 'Critical thing', description: '', helpUrl: '', affectedPagesCount: 2, totalPagesScanned: 5, sharedAncestor: null, ancestorConfidence: null },
      ],
    })
    await mkAudit(c.id, {
      completedAt: new Date('2026-07-02T00:00:00Z'),
      summary,
      adaScore: 82,
      liveScan: { score: 74, findings: [
        { type: 'missing_title', count: 3 },
        { type: 'broken_internal_links', count: 9 },
        { type: 'duplicate_title', count: 2 },
      ] },
    })
    await setAssessmentNote(vb.id, 'userBehaviour', '<p>Visitors bounce fast.</p>', 'op@er.com')
    const load = await loadAssessmentData(vb.token)
    expect(load).not.toBeNull()
    const data = load!.assessment
    expect(data).not.toBeNull()
    expect(data!.domain).toBe('acme.edu')
    expect(data!.adaScore).toBe(82) // newest reportable, not the June audit
    expect(data!.seoScore).toBe(74)
    expect(data!.seoUnavailable).toBe(false)
    expect(data!.standardTested).toBe('WCAG 2.1 AA')
    expect(data!.pagesAudited).toBe(5)
    // impact rank beats affected count: critical first
    expect(data!.adaPatterns.map((p) => p.help)).toEqual(['Critical thing', 'Moderate thing'])
    // count-desc, labeled, unit-mapped
    expect(data!.seoIssues[0]).toEqual({ label: 'Broken internal links', count: 9, unit: 'targets' })
    expect(data!.seoIssues.find((i) => i.unit === 'groups')?.count).toBe(2)
    // <3 lighthouse rows → rollup null, homepage null
    expect(data!.performance).toBeNull()
    expect(data!.homepage).toBeNull()
    // notes ride alongside the audit payload after one token validation
    expect(load!.notes!.userBehaviourHtml).toContain('Visitors bounce fast.')
  })

  it('marks a placeholder live-scan run seoUnavailable with no seo issues', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { liveScan: { placeholder: true } })
    const data = (await loadAssessmentData(vb.token))!.assessment
    expect(data).not.toBeNull()
    expect(data!.seoUnavailable).toBe(true)
    expect(data!.seoScore).toBeNull()
    expect(data!.seoIssues).toEqual([])
    expect(data!.adaScore).toBe(82) // ADA half still renders
  })

  it('degrades corrupt summary JSON via the findings fallback (never throws)', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { summary: '{not json', liveScan: {} })
    const data = (await loadAssessmentData(vb.token))!.assessment
    expect(data).not.toBeNull()
    // No CrawlPage/Violation rows in this fixture → buildSummaryFromFindings
    // yields no commonIssues → empty patterns, not a throw.
    expect(data!.adaPatterns).toEqual([])
  })

  it('drops curated-set-external and zero-count finding types from seoIssues', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { liveScan: { findings: [
      { type: 'missing_title', count: 3 },
      { type: 'hreflang_conflict', count: 99 }, // not in the curated sets
      { type: 'thin_content', count: 0 }, // zero-count
    ] } })
    const data = (await loadAssessmentData(vb.token))!.assessment
    expect(data!.seoIssues).toEqual([{ label: 'Missing title', count: 3, unit: 'pages' }])
  })

  it('returns null for a revoked viewbook (controlled, no throw)', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { liveScan: {} })
    await prisma.viewbook.update({ where: { id: vb.id }, data: { revokedAt: new Date() } })
    expect(await loadAssessmentData(vb.token)).toBeNull()
  })

  it('resolves client-wide across domains and never leaks another client', async () => {
    const c = await mkClient('one.edu')
    const vb = await mkViewbook(c.id)
    await mkAudit(c.id, { domain: 'one.edu', completedAt: new Date('2026-06-01T00:00:00Z') })
    await mkAudit(c.id, { domain: 'two.edu', completedAt: new Date('2026-07-03T00:00:00Z'), adaScore: 55 })
    const other = await mkClient('other.edu')
    await mkAudit(other.id, { domain: 'other.edu', completedAt: new Date('2026-07-10T00:00:00Z'), adaScore: 99 })
    const data = (await loadAssessmentData(vb.token))!.assessment
    expect(data!.domain).toBe('two.edu') // newest for THIS client, audited domain displayed
    expect(data!.adaScore).toBe(55) // the other client's newer audit never leaks
  })

  it('aggregates CWV from 3+ lighthouse children and picks the homepage row', async () => {
    const c = await mkClient()
    const vb = await mkViewbook(c.id)
    const audit = await mkAudit(c.id, { liveScan: {} })
    const lh = (performance: number, lcp: number) => JSON.stringify({
      scores: { performance },
      cwv: { lcp, cls: 0.05, tbt: 150, lcpStatus: 'pass', clsStatus: 'pass', tbtStatus: 'pass' },
      topFailures: [],
    })
    await prisma.adaAudit.createMany({
      data: [
        { url: 'https://acme.edu/', status: 'complete', siteAuditId: audit.id, lighthouseSummary: lh(95, 1800) },
        { url: 'https://acme.edu/a', status: 'complete', siteAuditId: audit.id, lighthouseSummary: lh(60, 2500) },
        { url: 'https://acme.edu/b', status: 'complete', siteAuditId: audit.id, lighthouseSummary: lh(40, 4000) },
      ],
    })
    const data = (await loadAssessmentData(vb.token))!.assessment
    expect(data!.performance).not.toBeNull()
    expect(data!.performance!.measuredPages).toBe(3)
    expect(data!.homepage).not.toBeNull()
    expect(data!.homepage!.performance).toBe(95) // canonical root wins
  })
})
