// lib/ada-audit/recents-query.db.test.ts
//
// DB-backed tests for the C16 unified recents feed: C3 score-source rules
// (CrawlRun.score preferred, blob parse only as the pre-A2 fallback for
// audits), the four type badges + the orphan-run source, Mine semantics
// (incl. Session.requestedBy), q/clientId filters, and cursor page-two
// correctness at timestamp ties. Scoped to unique operators so shared-DB
// rows can't leak in.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { fetchAllRecents, decodeRecentsCursor } from './recents-query'

const PREFIX = 'c16rec-'
const OPERATOR = 'c16rec-op'
const PAGER_OP = 'c16rec-pager-op'
const CLIENT_NAME = 'c16rec Client A'

// Empty violations → computeScore returns 100; aggregate of zeros → 100.
const PAGE_BLOB = JSON.stringify({ violations: [], passes: [], incomplete: [] })
const SITE_BLOB = JSON.stringify({
  aggregate: { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 0, incomplete: 0 },
})

async function clearState() {
  // CrawlRun first (subtree cascades from it), THEN the origin rows.
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.session.deleteMany({ where: { id: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: CLIENT_NAME } })
}

let ids: Record<string, string>
let clientAId: number

beforeAll(async () => {
  await clearState()

  const clientA = await prisma.client.create({ data: { name: CLIENT_NAME } })
  clientAId = clientA.id

  // Page audits (standalone — siteAuditId null)
  const pageRun = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}a.example/`, status: 'complete', result: PAGE_BLOB, wcagLevel: 'wcag21aa', requestedBy: OPERATOR, completedAt: new Date(), clientId: clientAId },
  })
  await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'page-audit', domain: `${PREFIX}a.example`, adaAuditId: pageRun.id, status: 'complete', score: 42, wcagLevel: 'wcag21aa' },
  })
  const pageLegacy = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}b.example/`, status: 'complete', result: PAGE_BLOB, wcagLevel: 'wcag21aa', requestedBy: OPERATOR, completedAt: new Date() },
  })
  const pagePruned = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}c.example/`, status: 'complete', result: null, wcagLevel: 'wcag21aa', requestedBy: OPERATOR, completedAt: new Date() },
  })
  await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'page-audit', domain: `${PREFIX}c.example`, adaAuditId: pagePruned.id, status: 'complete', score: 37, wcagLevel: 'wcag21aa' },
  })

  // Site audits (full pipeline → 'site-ada')
  const siteRun = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}s1.example`, status: 'complete', summary: SITE_BLOB, wcagLevel: 'wcag21aa', requestedBy: OPERATOR, completedAt: new Date() },
  })
  await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'site-audit', domain: `${PREFIX}s1.example`, siteAuditId: siteRun.id, status: 'complete', score: 41, wcagLevel: 'wcag21aa' },
  })
  const siteLegacy = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}s2.example`, status: 'complete', summary: SITE_BLOB, wcagLevel: 'wcag21aa', requestedBy: OPERATOR, completedAt: new Date() },
  })
  const sitePruned = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}s3.example`, status: 'complete', summary: null, wcagLevel: 'wcag21aa', requestedBy: OPERATOR, completedAt: new Date() },
  })
  await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'site-audit', domain: `${PREFIX}s3.example`, siteAuditId: sitePruned.id, status: 'complete', score: 33, wcagLevel: 'wcag21aa' },
  })

  // C16: seoOnly site audits — complete (with live-scan run) and running.
  const siteSeoOnly = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}s4.example`, status: 'complete', summary: null, wcagLevel: 'wcag21aa', requestedBy: OPERATOR, completedAt: new Date(), seoOnly: true },
  })
  const liveRun = await prisma.crawlRun.create({
    data: { tool: 'seo-parser', source: 'live-scan', seoIntent: true, domain: `${PREFIX}s4.example`, siteAuditId: siteSeoOnly.id, status: 'complete', score: 77 },
  })
  const seoOnlyRunning = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}s5.example`, status: 'running', summary: null, wcagLevel: 'wcag21aa', requestedBy: OPERATOR, seoOnly: true },
  })
  // Verifier-memory-loop fix (Task 4): a seoOnly audit whose ONLY seo-parser
  // run is an exhausted-verifier terminal placeholder must fall back to the
  // site page (failed/unavailable banner), never link the run page.
  const seoOnlyPlaceholder = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}s6.example`, status: 'complete', summary: null, wcagLevel: 'wcag21aa', requestedBy: OPERATOR, completedAt: new Date(), seoOnly: true },
  })
  await prisma.crawlRun.create({
    data: { tool: 'seo-parser', source: 'live-scan-placeholder', seoIntent: false, domain: `${PREFIX}s6.example`, siteAuditId: seoOnlyPlaceholder.id, status: 'partial' },
  })

  // C16: sessions — technical (deletable sf-upload), keyword-research (excluded),
  // legacy null-requestedBy (never matches Mine).
  await prisma.session.create({
    data: { id: `${PREFIX}sess-tech`, status: 'complete', files: JSON.stringify(['internal_all.csv']), workflow: 'technical', requestedBy: OPERATOR, siteName: `${PREFIX}t.example`, clientId: clientAId },
  })
  await prisma.crawlRun.create({
    data: { tool: 'seo-parser', source: 'sf-upload', domain: `${PREFIX}t.example`, sessionId: `${PREFIX}sess-tech`, status: 'complete', score: 64 },
  })
  await prisma.session.create({
    data: { id: `${PREFIX}sess-kw`, status: 'complete', files: JSON.stringify(['kw.csv']), workflow: 'keyword-research', requestedBy: OPERATOR },
  })
  await prisma.session.create({
    data: { id: `${PREFIX}sess-legacy`, status: 'complete', files: JSON.stringify(['old.csv']), workflow: 'technical', requestedBy: null },
  })

  // C16: orphaned live-scan run (parent pruned by scheduled retention → SetNull)
  // + an attached one that must NOT surface as its own row (covered by liveRun above).
  const orphanRun = await prisma.crawlRun.create({
    data: { tool: 'seo-parser', source: 'live-scan', seoIntent: true, domain: `${PREFIX}orphan.example`, siteAuditId: null, status: 'complete', score: 58 },
  })

  ids = {
    pageRun: pageRun.id, pageLegacy: pageLegacy.id, pagePruned: pagePruned.id,
    siteRun: siteRun.id, siteLegacy: siteLegacy.id, sitePruned: sitePruned.id,
    siteSeoOnly: siteSeoOnly.id, liveRun: liveRun.id,
    seoOnlyRunning: seoOnlyRunning.id, orphanRun: orphanRun.id,
    seoOnlyPlaceholder: seoOnlyPlaceholder.id,
  }

  // C16 pagination fixtures: 8 rows at ONE shared timestamp, dedicated
  // operator, explicit ids so the expected order is deterministic.
  const T = new Date('2026-07-01T12:00:00.000Z')
  await prisma.adaAudit.create({ data: { id: `${PREFIX}pg-a`, url: `https://${PREFIX}pg.example/a`, status: 'complete', wcagLevel: 'wcag21aa', requestedBy: PAGER_OP, createdAt: T } })
  await prisma.adaAudit.create({ data: { id: `${PREFIX}pg-b`, url: `https://${PREFIX}pg.example/b`, status: 'complete', wcagLevel: 'wcag21aa', requestedBy: PAGER_OP, createdAt: T } })
  await prisma.session.create({ data: { id: `${PREFIX}ss-a`, status: 'complete', files: '[]', workflow: 'technical', requestedBy: PAGER_OP, createdAt: T } })
  await prisma.session.create({ data: { id: `${PREFIX}ss-b`, status: 'complete', files: '[]', workflow: 'technical', requestedBy: PAGER_OP, createdAt: T } })
  await prisma.siteAudit.create({ data: { id: `${PREFIX}sa-a`, domain: `${PREFIX}sa.example`, status: 'complete', wcagLevel: 'wcag21aa', requestedBy: PAGER_OP, createdAt: T } })
  await prisma.siteAudit.create({ data: { id: `${PREFIX}sa-b`, domain: `${PREFIX}sa.example`, status: 'complete', wcagLevel: 'wcag21aa', requestedBy: PAGER_OP, createdAt: T } })
  await prisma.siteAudit.create({ data: { id: `${PREFIX}sq-a`, domain: `${PREFIX}sq.example`, status: 'complete', wcagLevel: 'wcag21aa', requestedBy: PAGER_OP, createdAt: T, seoOnly: true } })
  await prisma.siteAudit.create({ data: { id: `${PREFIX}sq-b`, domain: `${PREFIX}sq.example`, status: 'complete', wcagLevel: 'wcag21aa', requestedBy: PAGER_OP, createdAt: T, seoOnly: true } })
})

afterAll(clearState)

describe('fetchAllRecents — C3 score source (DB-backed)', () => {
  it('prefers CrawlRun.score over a different-scoring blob (page + site)', async () => {
    const { items } = await fetchAllRecents({ limit: 100, operator: OPERATOR })
    const page = items.find((i) => i.id === ids.pageRun)
    const site = items.find((i) => i.id === ids.siteRun)
    expect(page?.score).toBe(42) // blob would score 100
    expect(site?.score).toBe(41) // blob would score 100
  })

  it('falls back to the blob for pre-A2 rows (no CrawlRun)', async () => {
    const { items } = await fetchAllRecents({ limit: 100, operator: OPERATOR })
    expect(items.find((i) => i.id === ids.pageLegacy)?.score).toBe(100)
    expect(items.find((i) => i.id === ids.siteLegacy)?.score).toBe(100)
  })

  it('returns the CrawlRun score for pruned rows (blob null) without crashing', async () => {
    const { items } = await fetchAllRecents({ limit: 100, operator: OPERATOR })
    expect(items.find((i) => i.id === ids.pagePruned)?.score).toBe(37)
    expect(items.find((i) => i.id === ids.sitePruned)?.score).toBe(33)
  })
})

describe('fetchAllRecents — C16 unified feed (DB-backed)', () => {
  it('includes seoOnly site audits as site-seo with run-page href + run score when complete', async () => {
    const { items } = await fetchAllRecents({ limit: 100, operator: OPERATOR })
    const row = items.find((i) => i.id === ids.siteSeoOnly)!
    expect(row.type).toBe('site-seo')
    expect(row.href).toBe(`/seo-audits/results/run/${ids.liveRun}`)
    expect(row.score).toBe(77)
  })

  it('an exhausted-verifier placeholder run falls back to the site page, never the run page', async () => {
    const { items } = await fetchAllRecents({ limit: 100 })
    const row = items.find((i) => i.id === ids.seoOnlyPlaceholder)!
    expect(row.type).toBe('site-seo')
    expect(row.href).toBe(`/ada-audit/site/${ids.seoOnlyPlaceholder}`)
    expect(row.score).toBeNull()
    expect(row.inFlight).toBe(false) // exhaustion is terminal — never keep polling
  })

  it('transient seoOnly audits link to the site page (poller host)', async () => {
    const { items } = await fetchAllRecents({ limit: 100, operator: OPERATOR })
    const row = items.find((i) => i.id === ids.seoOnlyRunning)!
    expect(row.type).toBe('site-seo')
    expect(row.href).toBe(`/ada-audit/site/${ids.seoOnlyRunning}`)
  })

  it('technical sessions appear as sf-upload (deletable, CrawlRun score); keyword-research excluded', async () => {
    const { items } = await fetchAllRecents({ limit: 100, operator: OPERATOR })
    const sf = items.find((i) => i.id === `${PREFIX}sess-tech`)!
    expect(sf.type).toBe('sf-upload')
    expect(sf.deletable).toBe(true)
    expect(sf.href).toBe(`/seo-audits/results/${PREFIX}sess-tech`)
    expect(sf.score).toBe(64)
    expect(items.find((i) => i.id === `${PREFIX}sess-kw`)).toBeUndefined()
  })

  it('Mine scope matches Session.requestedBy; null-requestedBy sessions never match', async () => {
    const { items } = await fetchAllRecents({ limit: 100, operator: OPERATOR })
    expect(items.some((i) => i.id === `${PREFIX}sess-tech`)).toBe(true)
    expect(items.some((i) => i.id === `${PREFIX}sess-legacy`)).toBe(false)
  })

  it('orphaned live-scan runs appear as site-seo linking the run page; attached runs never surface as rows', async () => {
    // Orphan runs carry no attribution → all-scope only.
    const { items } = await fetchAllRecents({ limit: 200 })
    const row = items.find((i) => i.id === ids.orphanRun)
    expect(row?.type).toBe('site-seo')
    expect(row?.href).toBe(`/seo-audits/results/run/${ids.orphanRun}`)
    expect(row?.requestedBy).toBeNull()
    expect(items.find((i) => i.id === ids.liveRun)).toBeUndefined()
    // ...and Mine scope excludes orphan runs entirely.
    const mine = await fetchAllRecents({ limit: 200, operator: OPERATOR })
    expect(mine.items.find((i) => i.id === ids.orphanRun)).toBeUndefined()
  })

  it('q filter matches url/domain/siteName; clientId filter narrows to that client', async () => {
    const byQ = await fetchAllRecents({ limit: 100, operator: OPERATOR, q: `${PREFIX}t.example` })
    expect(byQ.items.map((i) => i.id)).toEqual([`${PREFIX}sess-tech`])
    const byClient = await fetchAllRecents({ limit: 100, operator: OPERATOR, clientId: clientAId })
    expect(byClient.items.map((i) => i.id).sort()).toEqual([ids.pageRun, `${PREFIX}sess-tech`].sort())
    const unassigned = await fetchAllRecents({ limit: 100, operator: OPERATOR, clientId: 'unassigned' })
    expect(unassigned.items.every((i) => i.clientName === null)).toBe(true)
    expect(unassigned.items.some((i) => i.id === ids.pageRun)).toBe(false)
  })

  it('page-two correctness — identical createdAt across types, no dup, no skip, exact order', async () => {
    const page1 = await fetchAllRecents({ limit: 3, operator: PAGER_OP })
    expect(page1.items).toHaveLength(3)
    expect(page1.nextCursor).not.toBeNull()
    const page2 = await fetchAllRecents({ limit: 3, operator: PAGER_OP, cursor: decodeRecentsCursor(page1.nextCursor) })
    expect(page2.nextCursor).not.toBeNull()
    const page3 = await fetchAllRecents({ limit: 3, operator: PAGER_OP, cursor: decodeRecentsCursor(page2.nextCursor) })
    const all = [...page1.items, ...page2.items, ...page3.items].map((i) => `${i.type}:${i.id}`)
    expect(new Set(all).size).toBe(all.length) // no duplicates
    expect(all).toHaveLength(8)                // no skips
    expect(page3.nextCursor).toBeNull()
    // At ONE timestamp the total order is type ASC then id ASC.
    expect(all).toEqual([
      `page:${PREFIX}pg-a`, `page:${PREFIX}pg-b`,
      `sf-upload:${PREFIX}ss-a`, `sf-upload:${PREFIX}ss-b`,
      `site-ada:${PREFIX}sa-a`, `site-ada:${PREFIX}sa-b`,
      `site-seo:${PREFIX}sq-a`, `site-seo:${PREFIX}sq-b`,
    ])
  })
})
