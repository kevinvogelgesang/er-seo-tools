// app/api/site-audit/route.test.ts
//
// DB-backed C3 score-source tests for GET /api/site-audit: score prefers
// CrawlRun.score, blob aggregate is the pre-A2 fallback, pruned rows
// (summary null + CrawlRun) score from the run with summary passthrough null.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './route'

const PREFIX = 'c3sal-'

// Aggregate of zeros → computeScoreFromCounts = 100.
const SITE_BLOB = JSON.stringify({
  aggregate: { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 0, incomplete: 0 },
})

let clientId: number
let ids: Record<string, string>

async function clearState() {
  // CrawlRun first (subtree cascades from it), THEN origin rows.
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeAll(async () => {
  await clearState()
  const client = await prisma.client.create({
    data: { name: `${PREFIX}client`, domains: JSON.stringify([`${PREFIX}a.example`]) },
  })
  clientId = client.id

  const withRun = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}a.example`, status: 'complete', summary: SITE_BLOB, wcagLevel: 'wcag21aa', clientId, completedAt: new Date() },
  })
  await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'site-audit', domain: `${PREFIX}a.example`, siteAuditId: withRun.id, status: 'complete', score: 42, wcagLevel: 'wcag21aa' },
  })
  const legacy = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}b.example`, status: 'complete', summary: SITE_BLOB, wcagLevel: 'wcag21aa', clientId, completedAt: new Date() },
  })
  const pruned = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}c.example`, status: 'complete', summary: null, wcagLevel: 'wcag21aa', clientId, completedAt: new Date() },
  })
  await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'site-audit', domain: `${PREFIX}c.example`, siteAuditId: pruned.id, status: 'complete', score: 37, wcagLevel: 'wcag21aa' },
  })
  ids = { withRun: withRun.id, legacy: legacy.id, pruned: pruned.id }
})

afterAll(clearState)

type Item = { id: string; score: number | null; summary: { aggregate?: unknown } | null }

async function fetchItems(): Promise<Item[]> {
  const res = await GET(new NextRequest(`http://localhost/api/site-audit?clientId=${clientId}&pageSize=100`))
  expect(res.status).toBe(200)
  const json = await res.json() as { items: Item[] }
  return json.items
}

describe('GET /api/site-audit — C3 score source', () => {
  it('prefers CrawlRun.score over a different-scoring summary blob', async () => {
    const items = await fetchItems()
    const row = items.find((i) => i.id === ids.withRun)
    expect(row?.score).toBe(42) // blob aggregate would score 100
    expect(row?.summary).not.toBeNull() // passthrough unchanged
  })

  it('falls back to the summary aggregate for pre-A2 rows (no CrawlRun)', async () => {
    const items = await fetchItems()
    const row = items.find((i) => i.id === ids.legacy)
    expect(row?.score).toBe(100)
  })

  it('scores pruned rows from CrawlRun with null summary passthrough, no crash', async () => {
    const items = await fetchItems()
    const row = items.find((i) => i.id === ids.pruned)
    expect(row?.score).toBe(37)
    expect(row?.summary).toBeNull()
  })
})
