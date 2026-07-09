// app/api/clients/audit-summary/route.test.ts
//
// DB-backed C3 score-source tests for GET /api/clients/audit-summary:
// latestSiteAudit.score prefers CrawlRun.score, the summary aggregate is the
// pre-A2 fallback, and pruned audits (summary null + CrawlRun) score from
// the run with a null summary passthrough.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { GET } from './route'
import type { ClientAuditSummary } from '@/lib/ada-audit/types'

const PREFIX = 'c3cs-'

// Aggregate of zeros → computeScoreFromCounts = 100.
const SITE_BLOB = JSON.stringify({
  aggregate: { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 0, incomplete: 0 },
})

let clientIds: Record<string, number>

async function clearState() {
  // CrawlRun first (subtree cascades from it), THEN origin rows.
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeAll(async () => {
  await clearState()
  const mk = async (suffix: string) => (await prisma.client.create({
    data: { name: `${PREFIX}${suffix}`, domains: JSON.stringify([`${PREFIX}${suffix}.example`]) },
  })).id
  clientIds = { withRun: await mk('a'), legacy: await mk('b'), pruned: await mk('c'), seo: await mk('d') }

  const withRun = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}a.example`, status: 'complete', summary: SITE_BLOB, wcagLevel: 'wcag21aa', clientId: clientIds.withRun, completedAt: new Date() },
  })
  await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'site-audit', domain: `${PREFIX}a.example`, siteAuditId: withRun.id, status: 'complete', score: 42, wcagLevel: 'wcag21aa' },
  })

  // C18: an audit carrying BOTH an ada-audit run and a live-scan SEO run.
  const withSeo = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}d.example`, status: 'complete', summary: SITE_BLOB, wcagLevel: 'wcag21aa', clientId: clientIds.seo, completedAt: new Date() },
  })
  await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'site-audit', domain: `${PREFIX}d.example`, siteAuditId: withSeo.id, status: 'complete', score: 55, wcagLevel: 'wcag21aa' },
  })
  await prisma.crawlRun.create({
    data: { tool: 'seo-parser', source: 'live-scan', domain: `${PREFIX}d.example`, siteAuditId: withSeo.id, status: 'complete', score: 91, wcagLevel: 'wcag21aa' },
  })
  await prisma.siteAudit.create({
    data: { domain: `${PREFIX}b.example`, status: 'complete', summary: SITE_BLOB, wcagLevel: 'wcag21aa', clientId: clientIds.legacy, completedAt: new Date() },
  })
  const pruned = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}c.example`, status: 'complete', summary: null, wcagLevel: 'wcag21aa', clientId: clientIds.pruned, completedAt: new Date() },
  })
  await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'site-audit', domain: `${PREFIX}c.example`, siteAuditId: pruned.id, status: 'complete', score: 37, wcagLevel: 'wcag21aa' },
  })
})

afterAll(clearState)

async function fetchRow(clientId: number): Promise<ClientAuditSummary | undefined> {
  const res = await GET()
  expect(res.status).toBe(200)
  const rows = await res.json() as ClientAuditSummary[]
  return rows.find((r) => r.clientId === clientId)
}

describe('GET /api/clients/audit-summary — C3 score source', () => {
  it('prefers CrawlRun.score over a different-scoring summary blob', async () => {
    const row = await fetchRow(clientIds.withRun)
    expect(row?.latestSiteAudit?.score).toBe(42) // blob aggregate would score 100
    expect(row?.latestSiteAudit?.summary).not.toBeNull()
  })

  it('falls back to the summary aggregate for pre-A2 audits (no CrawlRun)', async () => {
    const row = await fetchRow(clientIds.legacy)
    expect(row?.latestSiteAudit?.score).toBe(100)
  })

  it('scores pruned audits from CrawlRun with null summary, no crash', async () => {
    const row = await fetchRow(clientIds.pruned)
    expect(row?.latestSiteAudit?.score).toBe(37)
    expect(row?.latestSiteAudit?.summary).toBeNull()
  })

  it('C18: surfaces the live-scan SEO score alongside the ADA score', async () => {
    const row = await fetchRow(clientIds.seo)
    expect(row?.latestSiteAudit?.score).toBe(55)     // ada-audit run
    expect(row?.latestSiteAudit?.seoScore).toBe(91)  // live-scan run
  })

  it('C18: seoScore is null when the audit has no live-scan run', async () => {
    const row = await fetchRow(clientIds.withRun)
    expect(row?.latestSiteAudit?.seoScore).toBeNull()
  })
})
