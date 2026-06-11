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
  violations?: { type: string; severity: string; url: string; impact?: string; help?: string }[]
}) {
  const sa = await prisma.siteAudit.create({
    data: { domain: DOMAIN, status: 'complete', clientId, completedAt: opts.completedAt },
  })
  const run = await prisma.crawlRun.create({
    data: {
      tool: 'ada-audit', source: 'site-audit', domain: DOMAIN, clientId, siteAuditId: sa.id,
      status: 'complete', score: 85, pagesTotal: 3, completedAt: opts.completedAt, createdAt: opts.completedAt,
    },
  })
  for (const v of opts.violations ?? []) {
    const page = await prisma.crawlPage.create({
      data: { runId: run.id, url: v.url + '#' + randomUUID().slice(0, 6), status: 'complete' },
    })
    const f = await prisma.finding.create({
      data: { runId: run.id, pageId: page.id, scope: 'page', type: v.type, severity: v.severity, url: v.url, dedupKey: randomUUID() },
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

describe('getClientFindings', () => {
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
