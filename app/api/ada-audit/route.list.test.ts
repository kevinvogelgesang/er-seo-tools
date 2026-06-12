// app/api/ada-audit/route.list.test.ts
//
// DB-backed C3 score-source tests for GET /api/ada-audit (list). The
// existing route.test.ts is POST-focused with mocked prisma — GET list
// behavior is pinned here against the real DB instead (Codex plan-fix #5).
//
// Coverage: CrawlRun.score preferred over a different-scoring blob; pre-A2
// blob fallback; pruned rows (result null + CrawlRun) score from the run AND
// get a scorecard rebuilt from Violation rows + CrawlPage pass/incomplete sums.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './route'
import type { AuditScorecard } from '@/lib/ada-audit/types'

const PREFIX = 'c3list-'

// Empty violations → computeScore = 100; one pass + one incomplete for the
// blob scorecard so the blob path stays distinguishable from the rebuild.
const PAGE_BLOB = JSON.stringify({
  violations: [],
  passes: [{ id: 'p1', nodes: [] }],
  incomplete: [{ id: 'i1', nodes: [] }],
})

let clientId: number
let ids: Record<string, string>

async function clearState() {
  // CrawlRun first (Violation/Finding/CrawlPage cascade from it), THEN origin rows.
  await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.adaAudit.deleteMany({ where: { url: { contains: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}

beforeAll(async () => {
  await clearState()
  const client = await prisma.client.create({
    data: { name: `${PREFIX}client`, domains: JSON.stringify([`${PREFIX}a.example`]) },
  })
  clientId = client.id

  const withRun = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}a.example/`, status: 'complete', result: PAGE_BLOB, wcagLevel: 'wcag21aa', clientId, completedAt: new Date() },
  })
  await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'page-audit', domain: `${PREFIX}a.example`, adaAuditId: withRun.id, status: 'complete', score: 42, wcagLevel: 'wcag21aa' },
  })

  const legacy = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}b.example/`, status: 'complete', result: PAGE_BLOB, wcagLevel: 'wcag21aa', clientId, completedAt: new Date() },
  })

  // Pruned: blob null, findings subtree present — scorecard must be rebuilt
  // from Violation groupBy + CrawlPage passCount/incompleteCount sums.
  const pruned = await prisma.adaAudit.create({
    data: { url: `https://${PREFIX}c.example/`, status: 'complete', result: null, wcagLevel: 'wcag21aa', clientId, completedAt: new Date() },
  })
  const run = await prisma.crawlRun.create({
    data: { tool: 'ada-audit', source: 'page-audit', domain: `${PREFIX}c.example`, adaAuditId: pruned.id, status: 'complete', score: 37, wcagLevel: 'wcag21aa', archivePrunedAt: new Date() },
  })
  const page = await prisma.crawlPage.create({
    data: { runId: run.id, url: `https://${PREFIX}c.example/`, status: 'complete', passCount: 7, incompleteCount: 2 },
  })
  const seedViolation = async (ruleId: string, impact: string, dedupKey: string) => {
    const finding = await prisma.finding.create({
      data: { runId: run.id, pageId: page.id, scope: 'page', type: ruleId, severity: impact === 'critical' ? 'critical' : 'warning', url: `https://${PREFIX}c.example/`, dedupKey },
    })
    await prisma.violation.create({
      data: { findingId: finding.id, runId: run.id, pageId: page.id, ruleId, impact, wcagTags: '[]', nodeCount: 1 },
    })
  }
  await seedViolation('image-alt', 'critical', 'c3list-dk-1')
  await seedViolation('color-contrast', 'serious', 'c3list-dk-2')
  await seedViolation('region', 'moderate', 'c3list-dk-3')

  ids = { withRun: withRun.id, legacy: legacy.id, pruned: pruned.id }
})

afterAll(clearState)

type Item = { id: string; score: number | null; scorecard: AuditScorecard | null }

async function fetchItems(): Promise<Item[]> {
  const res = await GET(new NextRequest(`http://localhost/api/ada-audit?clientId=${clientId}&pageSize=100`))
  expect(res.status).toBe(200)
  const json = await res.json() as { items: Item[] }
  return json.items
}

describe('GET /api/ada-audit — C3 score source', () => {
  it('prefers CrawlRun.score over a different-scoring blob; blob scorecard kept', async () => {
    const items = await fetchItems()
    const row = items.find((i) => i.id === ids.withRun)
    expect(row?.score).toBe(42) // blob would score 100
    expect(row?.scorecard).toEqual({
      critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 1, incomplete: 1,
    })
  })

  it('falls back to the blob for pre-A2 rows (no CrawlRun)', async () => {
    const items = await fetchItems()
    const row = items.find((i) => i.id === ids.legacy)
    expect(row?.score).toBe(100)
    expect(row?.scorecard?.passed).toBe(1)
  })

  it('rebuilds the scorecard from Violation rows for pruned rows', async () => {
    const items = await fetchItems()
    const row = items.find((i) => i.id === ids.pruned)
    expect(row?.score).toBe(37)
    expect(row?.scorecard).toEqual({
      critical: 1, serious: 1, moderate: 1, minor: 0, total: 3, passed: 7, incomplete: 2,
    })
  })
})
