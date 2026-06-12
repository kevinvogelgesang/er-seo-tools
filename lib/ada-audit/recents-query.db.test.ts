// lib/ada-audit/recents-query.db.test.ts
//
// DB-backed C3 score-source tests for fetchAllRecents: CrawlRun.score is
// preferred; the blob parse is only the pre-A2 fallback; pruned rows
// (blob null + CrawlRun present) still get a score and never crash.
// Scoped to a unique operator so shared-DB rows can't leak in.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { fetchAllRecents } from './recents-query'

const PREFIX = 'c3rec-'
const OPERATOR = 'c3rec-op'

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
}

let ids: Record<string, string>

beforeAll(async () => {
  await clearState()

  // Page audits (standalone — siteAuditId null)
  const pageRun = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}a.example/`, status: 'complete', result: PAGE_BLOB, wcagLevel: 'wcag21aa', requestedBy: OPERATOR, completedAt: new Date() },
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

  // Site audits
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

  ids = {
    pageRun: pageRun.id, pageLegacy: pageLegacy.id, pagePruned: pagePruned.id,
    siteRun: siteRun.id, siteLegacy: siteLegacy.id, sitePruned: sitePruned.id,
  }
})

afterAll(clearState)

describe('fetchAllRecents — C3 score source (DB-backed)', () => {
  it('prefers CrawlRun.score over a different-scoring blob (page + site)', async () => {
    const items = await fetchAllRecents(100, OPERATOR)
    const page = items.find((i) => i.id === ids.pageRun)
    const site = items.find((i) => i.id === ids.siteRun)
    expect(page?.score).toBe(42) // blob would score 100
    expect(site?.score).toBe(41) // blob would score 100
  })

  it('falls back to the blob for pre-A2 rows (no CrawlRun)', async () => {
    const items = await fetchAllRecents(100, OPERATOR)
    const page = items.find((i) => i.id === ids.pageLegacy)
    const site = items.find((i) => i.id === ids.siteLegacy)
    expect(page?.score).toBe(100)
    expect(site?.score).toBe(100)
  })

  it('returns the CrawlRun score for pruned rows (blob null) without crashing', async () => {
    const items = await fetchAllRecents(100, OPERATOR)
    const page = items.find((i) => i.id === ids.pagePruned)
    const site = items.find((i) => i.id === ids.sitePruned)
    expect(page?.score).toBe(37)
    expect(site?.score).toBe(33)
  })
})
