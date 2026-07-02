// lib/services/client-findings.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { getClientFindings } from './client-findings'
import { URLS_PER_FINDING } from './findings-shared'

const PREFIX = 'test-cfind-'
const DOMAIN = 'client-findings-test.example'
const NOW = new Date()
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

async function clearTestState() {
  // CrawlRuns by test domain FIRST (SetNull origins make some unreachable via FK).
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.session.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}
beforeEach(clearTestState)
afterAll(clearTestState)

function makeClient(tag: string) {
  return prisma.client.create({
    data: { name: `${PREFIX}${tag}-${randomUUID().slice(0, 8)}`, domains: JSON.stringify([DOMAIN]) },
  })
}

async function makeSeoRun(clientId: number, opts: {
  completedAt: Date
  withSession?: boolean
  findings?: {
    runScope: { type: string; severity: string; count: number; detail?: string; affectedComplete?: boolean | null }[]
    pageScope?: { type: string; url: string }[]
  }
}) {
  let sessionId: string | null = null
  if (opts.withSession !== false) {
    const s = await prisma.session.create({
      data: { id: PREFIX + randomUUID(), status: 'complete', workflow: 'technical', files: '[]', siteName: DOMAIN, clientId },
    })
    sessionId = s.id
  }
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId, sessionId,
      status: 'complete', score: 80, pagesTotal: 1, completedAt: opts.completedAt, createdAt: opts.completedAt,
    },
  })
  for (const f of opts.findings?.runScope ?? []) {
    await prisma.finding.create({
      data: {
        runId: run.id, scope: 'run', type: f.type, severity: f.severity, count: f.count,
        detail: f.detail ?? null, affectedComplete: f.affectedComplete === undefined ? null : f.affectedComplete,
        dedupKey: randomUUID(),
      },
    })
  }
  for (const p of opts.findings?.pageScope ?? []) {
    await prisma.finding.create({
      data: { runId: run.id, scope: 'page', type: p.type, severity: 'warning', url: p.url, dedupKey: randomUUID() },
    })
  }
  return run
}

async function makeAdaSiteRun(clientId: number, opts: {
  completedAt: Date
  wcagLevel?: string
  violations?: { type: string; severity: string; url: string; impact?: string; help?: string; dedupKey?: string }[]
  /** Extra complete pages (exact URLs) — page-set awareness for instance diffs. */
  extraPages?: string[]
}) {
  const sa = await prisma.siteAudit.create({
    data: { domain: DOMAIN, status: 'complete', clientId, completedAt: opts.completedAt },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'site-audit', domain: DOMAIN, clientId, siteAuditId: sa.id,
      status: 'complete', score: 85, pagesTotal: 3, completedAt: opts.completedAt, createdAt: opts.completedAt,
      wcagLevel: opts.wcagLevel ?? 'wcag21aa',
    },
  })
  for (const u of opts.extraPages ?? []) {
    await prisma.crawlPage.create({ data: { runId: run.id, url: u, status: 'complete' } })
  }
  for (const v of opts.violations ?? []) {
    const page = await prisma.crawlPage.create({
      data: { runId: run.id, url: v.url + '#' + randomUUID().slice(0, 6), status: 'complete' },
    })
    const f = await prisma.finding.create({
      data: { runId: run.id, pageId: page.id, scope: 'page', type: v.type, severity: v.severity, url: v.url, dedupKey: v.dedupKey ?? randomUUID() },
    })
    await prisma.violation.create({
      data: {
        findingId: f.id, runId: run.id, pageId: page.id, ruleId: v.type,
        impact: v.impact ?? 'serious', wcagTags: '[]', help: v.help ?? null, nodeCount: 1,
      },
    })
  }
  return { run, siteAuditId: sa.id }
}

async function makeLiveScanRun(clientId: number, opts: { completedAt: Date; brokenInternal: number }) {
  const sa = await prisma.siteAudit.create({
    data: { domain: DOMAIN, status: 'complete', clientId, completedAt: opts.completedAt },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, clientId, siteAuditId: sa.id,
      status: 'complete', score: null, pagesTotal: 1, completedAt: opts.completedAt, createdAt: opts.completedAt,
    },
  })
  await prisma.finding.create({
    data: {
      runId: run.id, scope: 'run', type: 'broken_internal_links', severity: 'critical',
      count: opts.brokenInternal, affectedComplete: true,
      detail: JSON.stringify({ description: 'Internal links that resolve to a 4xx/5xx response.' }),
      dedupKey: randomUUID(),
    },
  })
  await prisma.finding.create({
    data: { runId: run.id, scope: 'page', type: 'broken_internal_links', severity: 'critical', url: `https://${DOMAIN}/src`, dedupKey: randomUUID() },
  })
  return run
}

describe('getClientFindings', () => {
  // ── Task 9: canonical SEO selector tests ─────────────────────────────────

  it('Task 9: seoIntent live-scan becomes seo.current (canonical) when no sf-upload exists', async () => {
    const c = await makeClient('t9-canon')
    const sa = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', clientId: c.id, completedAt: daysAgo(1) },
    })
    const liveRun = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', seoIntent: true, domain: DOMAIN,
        clientId: c.id, siteAuditId: sa.id,
        status: 'complete', score: 55, pagesTotal: 20, completedAt: daysAgo(1),
      },
    })
    await prisma.finding.create({
      data: {
        runId: liveRun.id, scope: 'run', type: 'missing_title', severity: 'critical',
        count: 4, affectedComplete: true, dedupKey: randomUUID(),
      },
    })
    const out = await getClientFindings(c.id)
    // Canonical live-scan → seo meta set; findings surfaced
    expect(out.seo).not.toBeNull()
    expect(out.rows.some((r) => r.type === 'missing_title')).toBe(true)
    // seo.liveScan must be null (no double-count)
    // The canonical run is seo.current; there is no separate additive liveScan
    expect(out.seo?.href).toMatch(/^\/seo-parser\/results\/run\//)
  })

  it('Task 9: fresh sf-upload still keeps SEO canonical; seoIntent live-scan goes to liveScan additive', async () => {
    const c = await makeClient('t9-sf-wins')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(2),  // sf-upload within 30d → canonical
      findings: { runScope: [{ type: 'missing_h1', severity: 'warning', count: 7, affectedComplete: true }] },
    })
    // seoIntent live-scan (newer, but SF is fresh → SF canonical; live-scan goes additive)
    const sa = await prisma.siteAudit.create({
      data: { domain: DOMAIN, status: 'complete', clientId: c.id, completedAt: daysAgo(1) },
    })
    const liveRun = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', seoIntent: true, domain: DOMAIN,
        clientId: c.id, siteAuditId: sa.id,
        status: 'complete', score: 99, pagesTotal: 20, completedAt: daysAgo(1),
      },
    })
    await prisma.finding.create({
      data: {
        runId: liveRun.id, scope: 'run', type: 'broken_internal_links', severity: 'critical',
        count: 2, affectedComplete: true, dedupKey: randomUUID(),
      },
    })
    const out = await getClientFindings(c.id)
    // SF still canonical — sf-upload findings are in seo rows
    expect(out.rows.some((r) => r.type === 'missing_h1')).toBe(true)
    // Live-scan additive findings also surface
    expect(out.rows.some((r) => r.type === 'broken_internal_links')).toBe(true)
    // seo meta points at the sf-upload (session href, not run href)
    expect(out.seo?.href).toMatch(/^\/seo-parser\/results\//)
    expect(out.seo?.href).not.toMatch(/\/run\//)
  })

  it('surfaces live-scan broken-link findings additively; sf-upload keeps the SEO score', async () => {
    const c = await makeClient('livescan')
    // sf-upload run (scored) is OLDER; live-scan run is NEWER.
    await makeSeoRun(c.id, {
      completedAt: daysAgo(2),
      findings: { runScope: [{ type: 'missing_title', severity: 'critical', count: 3, affectedComplete: true }] },
    })
    await makeLiveScanRun(c.id, { completedAt: daysAgo(1), brokenInternal: 5 })
    const out = await getClientFindings(c.id)
    // broken-link row present (additive)
    const bl = out.rows.find((r) => r.type === 'broken_internal_links')!
    expect(bl).toBeTruthy()
    expect(bl.count).toBe(5)
    // sf-upload run remains the SEO meta source (score 80), NOT the live-scan run
    expect(out.seo).not.toBeNull()
    expect(out.rows.some((r) => r.type === 'missing_title')).toBe(true)
  })

  it('returns both empty-state shapes', async () => {
    const noRuns = await makeClient('none')
    const a = await getClientFindings(noRuns.id)
    expect(a.rows).toEqual([])
    expect(a.seo).toBeNull()
    expect(a.ada).toBeNull()

    const clean = await makeClient('clean')
    await makeSeoRun(clean.id, { completedAt: daysAgo(1) }) // run, zero findings
    const b = await getClientFindings(clean.id)
    expect(b.rows).toEqual([])
    expect(b.seo).not.toBeNull()
  })

  it('builds SEO rows from run-scope findings with page-scope URLs, three-state sample flag', async () => {
    const c = await makeClient('seo')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(1),
      findings: {
        runScope: [
          { type: 'missing_title', severity: 'critical', count: 12, detail: JSON.stringify({ description: 'Pages without titles' }), affectedComplete: true },
          { type: 'thin_content', severity: 'warning', count: 30, affectedComplete: null }, // null → sample (Codex fix #2)
        ],
        pageScope: [
          { type: 'missing_title', url: `https://${DOMAIN}/p1` },
          { type: 'missing_title', url: `https://${DOMAIN}/p2` },
        ],
      },
    })
    const out = await getClientFindings(c.id)
    const mt = out.rows.find((r) => r.type === 'missing_title')!
    expect(mt.tool).toBe('seo')
    expect(mt.count).toBe(12)            // run-scope count is authoritative
    expect(mt.totalUrls).toBe(2)
    expect(mt.urls).toHaveLength(2)
    expect(mt.isSample).toBe(false)      // explicit true
    expect(mt.description).toBe('Pages without titles')
    expect(mt.href).toMatch(/^\/seo-parser\/results\//)
    const tc = out.rows.find((r) => r.type === 'thin_content')!
    expect(tc.isSample).toBe(true)       // null affectedComplete → sample
    expect(out.rows[0].type).toBe('missing_title') // critical sorts first
  })

  it('builds ADA rows grouped by rule with Violation help and max severity', async () => {
    const c = await makeClient('ada')
    const { siteAuditId } = await makeAdaSiteRun(c.id, {
      completedAt: daysAgo(1),
      violations: [
        { type: 'color-contrast', severity: 'warning', url: `https://${DOMAIN}/a`, help: 'Elements must meet contrast' },
        { type: 'color-contrast', severity: 'critical', url: `https://${DOMAIN}/b`, help: 'Elements must meet contrast' },
      ],
    })
    const out = await getClientFindings(c.id)
    expect(out.rows).toHaveLength(1)
    const cc = out.rows[0]
    expect(cc.tool).toBe('ada')
    expect(cc.count).toBe(2)
    expect(cc.totalUrls).toBe(2)
    expect(cc.severity).toBe('critical') // max across rows
    expect(cc.description).toBe('Elements must meet contrast')
    expect(cc.href).toBe(`/ada-audit/site/${siteAuditId}`)
    expect(out.ada?.sourceClass).toBe('site')
  })

  it('diffs against the previous domain-matched run: NEW badge, count delta, resolved count', async () => {
    const c = await makeClient('diff')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(10),
      findings: { runScope: [
        { type: 'thin_content', severity: 'warning', count: 30 },
        { type: 'gone_issue', severity: 'notice', count: 3 },
      ] },
    })
    await makeSeoRun(c.id, {
      completedAt: daysAgo(1),
      findings: { runScope: [
        { type: 'thin_content', severity: 'warning', count: 22 },
        { type: 'broken_pages', severity: 'critical', count: 4 },
      ] },
    })
    const out = await getClientFindings(c.id)
    const bp = out.rows.find((r) => r.type === 'broken_pages')!
    expect(bp.isNew).toBe(true)
    expect(bp.countDelta).toBeNull()
    const tc = out.rows.find((r) => r.type === 'thin_content')!
    expect(tc.isNew).toBe(false)
    expect(tc.countDelta).toBe(-8)
    expect(out.seo?.hasPrevious).toBe(true)
    expect(out.seo?.newTypeCount).toBe(1)
    expect(out.seo?.resolvedTypeCount).toBe(1)
    // Instance diffing is ADA-only v1 — SEO meta carries nulls.
    expect(out.seo?.newInstanceCount).toBeNull()
    expect(out.seo?.resolvedInstanceCount).toBeNull()
  })

  it('ada meta carries instance counts when a same-level previous run exists', async () => {
    const c = await makeClient('inst')
    await makeAdaSiteRun(c.id, {
      completedAt: daysAgo(10),
      violations: [
        { type: 'color-contrast', severity: 'critical', url: `https://${DOMAIN}/a`, dedupKey: 'cfind-k-a' },
        { type: 'image-alt', severity: 'critical', url: `https://${DOMAIN}/b`, dedupKey: 'cfind-k-b' },
      ],
    })
    await makeAdaSiteRun(c.id, {
      completedAt: daysAgo(1),
      violations: [
        { type: 'color-contrast', severity: 'critical', url: `https://${DOMAIN}/a`, dedupKey: 'cfind-k-a' },
        { type: 'link-name', severity: 'critical', url: `https://${DOMAIN}/c`, dedupKey: 'cfind-k-c' },
      ],
      extraPages: [`https://${DOMAIN}/b`], // /b rescanned clean → k-b resolved
    })
    const out = await getClientFindings(c.id)
    expect(out.ada?.hasPrevious).toBe(true)
    expect(out.ada?.newInstanceCount).toBe(1)      // cfind-k-c only (k-a unchanged)
    expect(out.ada?.resolvedInstanceCount).toBe(1) // cfind-k-b, page rescanned
  })

  it('ada instance counts are null when there is no previous run', async () => {
    const c = await makeClient('inst-noprev')
    await makeAdaSiteRun(c.id, {
      completedAt: daysAgo(1),
      violations: [{ type: 'color-contrast', severity: 'critical', url: `https://${DOMAIN}/a` }],
    })
    const out = await getClientFindings(c.id)
    expect(out.ada?.hasPrevious).toBe(false)
    expect(out.ada?.newInstanceCount).toBeNull()
    expect(out.ada?.resolvedInstanceCount).toBeNull()
  })

  it('ada instance counts are null when wcagLevels differ (type diff still renders)', async () => {
    const c = await makeClient('inst-level')
    await makeAdaSiteRun(c.id, {
      completedAt: daysAgo(10), wcagLevel: 'wcag22aa',
      violations: [{ type: 'image-alt', severity: 'critical', url: `https://${DOMAIN}/b` }],
    })
    await makeAdaSiteRun(c.id, {
      completedAt: daysAgo(1), wcagLevel: 'wcag21aa',
      violations: [{ type: 'color-contrast', severity: 'critical', url: `https://${DOMAIN}/a` }],
    })
    const out = await getClientFindings(c.id)
    expect(out.ada?.hasPrevious).toBe(true)
    expect(out.ada?.newTypeCount).toBe(1) // type-level diff unaffected by level gate
    expect(out.ada?.newInstanceCount).toBeNull()
    expect(out.ada?.resolvedInstanceCount).toBeNull()
  })

  it('no previous run → no badges, hasPrevious false', async () => {
    const c = await makeClient('noprev')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(1),
      findings: { runScope: [{ type: 'broken_pages', severity: 'critical', count: 4 }] },
    })
    const out = await getClientFindings(c.id)
    expect(out.rows[0].isNew).toBe(false)
    expect(out.rows[0].countDelta).toBeNull()
    expect(out.seo?.hasPrevious).toBe(false)
  })

  it('caps urls at URLS_PER_FINDING but reports full totalUrls', async () => {
    const c = await makeClient('cap')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(1),
      findings: {
        runScope: [{ type: 'missing_alt_text', severity: 'warning', count: 40, affectedComplete: true }],
        pageScope: Array.from({ length: 30 }, (_, i) => ({ type: 'missing_alt_text', url: `https://${DOMAIN}/img-${i}` })),
      },
    })
    const row = (await getClientFindings(c.id)).rows[0]
    expect(row.urls).toHaveLength(URLS_PER_FINDING)
    expect(row.totalUrls).toBe(30)
    expect(row.urls).toEqual([...row.urls].sort()) // deterministic sample (sorted)
  })

  it('expired origin (null sessionId) renders rows with null href', async () => {
    const c = await makeClient('orphan')
    await makeSeoRun(c.id, {
      completedAt: daysAgo(1), withSession: false,
      findings: { runScope: [{ type: 'broken_pages', severity: 'critical', count: 2 }] },
    })
    const out = await getClientFindings(c.id)
    expect(out.rows[0].href).toBeNull()
    expect(out.seo?.href).toBeNull()
  })

  it('keyword-research runs are not findings sources', async () => {
    const c = await makeClient('kw')
    const s = await prisma.session.create({
      data: { id: PREFIX + randomUUID(), status: 'complete', workflow: 'keyword-research', files: '[]', siteName: DOMAIN, clientId: c.id },
    })
    const run = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'sf-upload', domain: DOMAIN, clientId: c.id, sessionId: s.id,
        status: 'complete', score: 99, pagesTotal: 1, completedAt: daysAgo(1), createdAt: daysAgo(1),
      },
    })
    await prisma.finding.create({
      data: { runId: run.id, scope: 'run', type: 'kw_noise', severity: 'critical', count: 1, dedupKey: randomUUID() },
    })
    const out = await getClientFindings(c.id)
    expect(out.seo).toBeNull()
    expect(out.rows).toEqual([])
  })
})
