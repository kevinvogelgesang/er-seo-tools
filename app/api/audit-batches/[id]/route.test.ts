import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { GET, PATCH } from './route'
import { NextRequest } from 'next/server'

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init)
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/audit-batches/[id]', () => {
  beforeEach(async () => {
    await prisma.auditBatch.updateMany({
      where: { closedAt: null },
      data: { closedAt: new Date() },
    })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: 'abd-' } } })
    await prisma.auditBatch.deleteMany({ where: { label: { startsWith: '__abd__' } } })
  })

  it('returns 404 when not found', async () => {
    const res = await GET(req('http://localhost/api/audit-batches/nonexistent'), params('nonexistent'))
    expect(res.status).toBe(404)
  })

  it('returns the batch with its members ordered by createdAt ascending', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abd__detail', closedAt: new Date() } })
    const first = await prisma.siteAudit.create({
      data: {
        domain: 'abd-first.example', status: 'complete', wcagLevel: 'wcag21aa',
        batchId: b.id, createdAt: new Date('2026-05-13T19:00:00Z'),
      },
    })
    const second = await prisma.siteAudit.create({
      data: {
        domain: 'abd-second.example', status: 'error', wcagLevel: 'wcag21aa',
        batchId: b.id, createdAt: new Date('2026-05-13T19:01:00Z'),
      },
    })

    const res = await GET(req(`http://localhost/api/audit-batches/${b.id}`), params(b.id))
    expect(res.status).toBe(200)
    const json = await res.json() as { id: string; members: { id: string; status: string }[] }
    expect(json.id).toBe(b.id)
    expect(json.members.map((m) => m.id)).toEqual([first.id, second.id])
    expect(json.members.map((m) => m.status)).toEqual(['complete', 'error'])
  })

  it('returns closedAt as null when the batch is open', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abd__open' } })
    const res = await GET(req(`http://localhost/api/audit-batches/${b.id}`), params(b.id))
    const json = await res.json() as { closedAt: string | null }
    expect(json.closedAt).toBeNull()
  })
})

describe('GET /api/audit-batches/[id] — C3 member score source', () => {
  const PREFIX = 'c3bat-'
  // Aggregate of zeros → computeScoreFromCounts = 100.
  const SITE_BLOB = JSON.stringify({
    aggregate: { critical: 0, serious: 0, moderate: 0, minor: 0, total: 0, passed: 0, incomplete: 0 },
  })
  let batchId: string
  let ids: Record<string, string>

  async function clearState() {
    // CrawlRun first (subtree cascades from it), THEN origin rows.
    await prisma.crawlRun.deleteMany({ where: { domain: { startsWith: PREFIX } } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
    await prisma.auditBatch.deleteMany({ where: { label: { startsWith: '__c3bat__' } } })
  }

  beforeAll(async () => {
    await clearState()
    const batch = await prisma.auditBatch.create({ data: { label: '__c3bat__scores', closedAt: new Date() } })
    batchId = batch.id
    const withRun = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}a.example`, status: 'complete', summary: SITE_BLOB, wcagLevel: 'wcag21aa', batchId, completedAt: new Date() },
    })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', domain: `${PREFIX}a.example`, siteAuditId: withRun.id, status: 'complete', score: 42, wcagLevel: 'wcag21aa' },
    })
    const legacy = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}b.example`, status: 'complete', summary: SITE_BLOB, wcagLevel: 'wcag21aa', batchId, completedAt: new Date() },
    })
    const pruned = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}c.example`, status: 'complete', summary: null, wcagLevel: 'wcag21aa', batchId, completedAt: new Date() },
    })
    await prisma.crawlRun.create({
      data: { tool: 'ada-audit', source: 'site-audit', domain: `${PREFIX}c.example`, siteAuditId: pruned.id, status: 'complete', score: 37, wcagLevel: 'wcag21aa' },
    })
    ids = { withRun: withRun.id, legacy: legacy.id, pruned: pruned.id }
  })

  afterAll(clearState)

  async function fetchMembers(): Promise<{ id: string; score: number | null }[]> {
    const res = await GET(req(`http://localhost/api/audit-batches/${batchId}`), params(batchId))
    expect(res.status).toBe(200)
    const json = await res.json() as { members: { id: string; score: number | null }[] }
    return json.members
  }

  it('prefers CrawlRun.score over a different-scoring summary blob', async () => {
    const members = await fetchMembers()
    expect(members.find((m) => m.id === ids.withRun)?.score).toBe(42) // blob would score 100
  })

  it('falls back to the summary aggregate for pre-A2 members (no CrawlRun)', async () => {
    const members = await fetchMembers()
    expect(members.find((m) => m.id === ids.legacy)?.score).toBe(100)
  })

  it('scores pruned members (summary null) from CrawlRun without crashing', async () => {
    const members = await fetchMembers()
    expect(members.find((m) => m.id === ids.pruned)?.score).toBe(37)
  })
})

describe('PATCH /api/audit-batches/[id]', () => {
  beforeEach(async () => {
    await prisma.auditBatch.updateMany({
      where: { closedAt: null },
      data: { closedAt: new Date() },
    })
    await prisma.auditBatch.deleteMany({ where: { label: { startsWith: '__abp__' } } })
  })

  it('sets a label', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abp__initial', closedAt: new Date() } })
    const res = await PATCH(
      req(`http://localhost/api/audit-batches/${b.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: '__abp__renamed' }),
      }),
      params(b.id),
    )
    expect(res.status).toBe(200)
    const after = await prisma.auditBatch.findUniqueOrThrow({ where: { id: b.id } })
    expect(after.label).toBe('__abp__renamed')
  })

  it('clears a label when given null', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abp__clearme', closedAt: new Date() } })
    const res = await PATCH(
      req(`http://localhost/api/audit-batches/${b.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: null }),
      }),
      params(b.id),
    )
    expect(res.status).toBe(200)
    const after = await prisma.auditBatch.findUniqueOrThrow({ where: { id: b.id } })
    expect(after.label).toBeNull()
  })

  it('rejects labels longer than 200 chars with 400', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abp__lengthcheck', closedAt: new Date() } })
    const res = await PATCH(
      req(`http://localhost/api/audit-batches/${b.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'x'.repeat(201) }),
      }),
      params(b.id),
    )
    expect(res.status).toBe(400)
  })

  it('rejects non-string non-null label with 400', async () => {
    const b = await prisma.auditBatch.create({ data: { label: '__abp__typecheck', closedAt: new Date() } })
    const res = await PATCH(
      req(`http://localhost/api/audit-batches/${b.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 42 }),
      }),
      params(b.id),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for missing batch', async () => {
    const res = await PATCH(
      req('http://localhost/api/audit-batches/nope', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'x' }),
      }),
      params('nope'),
    )
    expect(res.status).toBe(404)
  })
})
