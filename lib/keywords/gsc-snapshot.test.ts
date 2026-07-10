// lib/keywords/gsc-snapshot.test.ts
//
// DB-backed tests for the KS-1 GSC snapshot service (Task 4). Provider is
// mocked (vi.hoisted + vi.mock); prisma and derive.ts are real — house
// convention (lib/services/client-schedules.test.ts).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { deriveKeywordSignals } from './derive'
import { GSC_MIN_IMPRESSIONS } from './types'
import type { GscQueryPageResult, GscQueryRow, GscQueryPageRow } from '@/lib/analytics/google/gsc-provider'

const { mockFetchGscQueryPage } = vi.hoisted(() => ({
  mockFetchGscQueryPage: vi.fn(),
}))

vi.mock('@/lib/analytics/google/gsc-provider', () => ({
  fetchGscQueryPage: mockFetchGscQueryPage,
}))

vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

import { refreshGscSnapshot, getLatestGscSnapshot } from './gsc-snapshot'

const PREFIX = 'ks1gsc-'
let counter = 0

async function makeClient(gscSiteUrl: string | null) {
  const client = await prisma.client.create({
    data: { name: `${PREFIX}${Date.now()}-${counter++}`, gscSiteUrl },
  })
  return client
}

function queryRow(query: string, overrides: Partial<GscQueryRow> = {}): GscQueryRow {
  return { query, clicks: 5, impressions: 100, ctr: 0.05, position: 5, ...overrides }
}

function queryPageRow(query: string, page: string, overrides: Partial<GscQueryPageRow> = {}): GscQueryPageRow {
  return { query, page, clicks: 2, impressions: 50, position: 8, ...overrides }
}

function okResult(data: GscQueryPageResult extends { ok: true; data: infer D } ? D : never): GscQueryPageResult {
  return { ok: true, data: data as never }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

beforeAll(async () => {
  await prisma.gscSnapshot.deleteMany({}).catch(() => {})
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } }) // cascades GscSnapshot
})

beforeEach(() => {
  mockFetchGscQueryPage.mockReset()
  vi.mocked(logError).mockClear()
})

describe('refreshGscSnapshot', () => {
  it('happy path: creates one GscSnapshot row with verbatim gscSiteUrl + metadata + parseable blobs, returns matching summary', async () => {
    const client = await makeClient('sc-domain:happy.example.edu')
    const data = {
      queryRows: [queryRow('alpha', { position: 5 }), queryRow('beta', { position: 15 })],
      queryPageRows: [
        queryPageRow('gamma', 'https://happy.example.edu/a', { impressions: 60 }),
        queryPageRow('gamma', 'https://happy.example.edu/b', { impressions: 40 }),
      ],
      queryAtLimit: false,
      queryPageAtLimit: false,
    }
    mockFetchGscQueryPage.mockResolvedValue(okResult(data))

    const result = await refreshGscSnapshot(client.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const rows = await prisma.gscSnapshot.findMany({ where: { clientId: client.id } })
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.gscSiteUrl).toBe('sc-domain:happy.example.edu')
    expect(row.queryRowLimit).toBeGreaterThan(0)
    expect(row.queryPageRowLimit).toBeGreaterThan(0)
    expect(row.minImpressions).toBe(GSC_MIN_IMPRESSIONS)
    expect(() => JSON.parse(row.queryRowsJson)).not.toThrow()
    expect(() => JSON.parse(row.queryPageRowsJson)).not.toThrow()
    expect(JSON.parse(row.queryRowsJson)).toEqual(data.queryRows)
    expect(JSON.parse(row.queryPageRowsJson)).toEqual(data.queryPageRows)

    const expected = deriveKeywordSignals(data.queryRows, data.queryPageRows, { minImpressions: GSC_MIN_IMPRESSIONS })
    expect(result.summary.gscSiteUrl).toBe('sc-domain:happy.example.edu')
    expect(result.summary.queryAtLimit).toBe(false)
    expect(result.summary.queryPageAtLimit).toBe(false)
    expect(result.summary.counts).toEqual(expected.counts)
    expect(result.summary.wins).toEqual(expected.wins)
    expect(result.summary.opportunities).toEqual(expected.opportunities)
    expect(result.summary.quickWins).toEqual(expected.quickWins)
    expect(result.summary.cannibalization).toEqual(expected.cannibalization)
  })

  it('publication is atomic: an invalid payload publishes no row, and a prior valid snapshot remains readable', async () => {
    const client = await makeClient('sc-domain:atomic.example.edu')

    // First: a valid refresh.
    mockFetchGscQueryPage.mockResolvedValueOnce(
      okResult({
        queryRows: [queryRow('valid-query', { position: 5 })],
        queryPageRows: [],
        queryAtLimit: false,
        queryPageAtLimit: false,
      }),
    )
    const first = await refreshGscSnapshot(client.id)
    expect(first.ok).toBe(true)

    // Second: provider ok, but payload fails the validator (empty query string).
    mockFetchGscQueryPage.mockResolvedValueOnce(
      okResult({
        queryRows: [{ query: '', clicks: 1, impressions: 20, ctr: 0.1, position: 5 }],
        queryPageRows: [],
        queryAtLimit: false,
        queryPageAtLimit: false,
      }),
    )
    const second = await refreshGscSnapshot(client.id)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe('error')
    expect(second.message).toBe('invalid_payload')

    const rows = await prisma.gscSnapshot.findMany({ where: { clientId: client.id } })
    expect(rows).toHaveLength(1) // no new row published

    const latest = await getLatestGscSnapshot(client.id)
    expect(latest.gscMapped).toBe(true)
    expect(latest.summary).not.toBeNull()
    expect(latest.summary?.wins.map((w) => w.query)).toEqual(['valid-query'])
  })

  it('rejects non-finite/negative clicks or impressions, and rejects missing page on a query-page row', async () => {
    const client = await makeClient('sc-domain:invalid-shapes.example.edu')

    mockFetchGscQueryPage.mockResolvedValueOnce(
      okResult({
        queryRows: [queryRow('nan-clicks', { clicks: NaN })],
        queryPageRows: [],
        queryAtLimit: false,
        queryPageAtLimit: false,
      }),
    )
    const r1 = await refreshGscSnapshot(client.id)
    expect(r1.ok).toBe(false)

    mockFetchGscQueryPage.mockResolvedValueOnce(
      okResult({
        queryRows: [],
        queryPageRows: [{ query: 'q', page: '', clicks: 1, impressions: 20, position: 3 }],
        queryAtLimit: false,
        queryPageAtLimit: false,
      }),
    )
    const r2 = await refreshGscSnapshot(client.id)
    expect(r2.ok).toBe(false)

    const rows = await prisma.gscSnapshot.findMany({ where: { clientId: client.id } })
    expect(rows).toHaveLength(0)
  })

  it('keeps zero/non-positive positions at storage (discarding them is derive.ts job, not the validator)', async () => {
    const client = await makeClient('sc-domain:zero-position.example.edu')
    mockFetchGscQueryPage.mockResolvedValueOnce(
      okResult({
        queryRows: [queryRow('zero-pos', { position: 0 }), queryRow('neg-pos', { position: -5 })],
        queryPageRows: [],
        queryAtLimit: false,
        queryPageAtLimit: false,
      }),
    )
    const result = await refreshGscSnapshot(client.id)
    expect(result.ok).toBe(true)
    const row = await prisma.gscSnapshot.findFirst({ where: { clientId: client.id } })
    const stored = JSON.parse(row!.queryRowsJson) as GscQueryRow[]
    expect(stored.find((r) => r.query === 'zero-pos')?.position).toBe(0)
    expect(stored.find((r) => r.query === 'neg-pos')?.position).toBe(-5)
    if (result.ok) {
      // Both are discarded from every band by derive.ts.
      expect(result.summary.wins.find((w) => w.query === 'zero-pos' || w.query === 'neg-pos')).toBeUndefined()
    }
  })

  it('provider error passes through unchanged and publishes no row', async () => {
    const client = await makeClient('sc-domain:provider-error.example.edu')
    mockFetchGscQueryPage.mockResolvedValueOnce({ ok: false, reason: 'quota', message: 'rate limited' })

    const result = await refreshGscSnapshot(client.id)
    expect(result).toEqual({ ok: false, reason: 'quota', message: 'rate limited' })

    const rows = await prisma.gscSnapshot.findMany({ where: { clientId: client.id } })
    expect(rows).toHaveLength(0)
  })

  it('returns client_not_found for an unknown client id', async () => {
    const maxClient = await prisma.client.findFirst({ orderBy: { id: 'desc' } })
    const missingId = (maxClient?.id ?? 0) + 5_000_000

    const result = await refreshGscSnapshot(missingId)
    expect(result).toEqual({ ok: false, reason: 'client_not_found' })
    expect(mockFetchGscQueryPage).not.toHaveBeenCalled()
  })

  it('single-flight: two concurrent refreshes for one client coalesce into one provider call and one row', async () => {
    const client = await makeClient('sc-domain:single-flight.example.edu')

    let resolveDeferred!: (v: GscQueryPageResult) => void
    const deferred = new Promise<GscQueryPageResult>((resolve) => {
      resolveDeferred = resolve
    })
    mockFetchGscQueryPage.mockImplementation(() => deferred)

    const call1 = refreshGscSnapshot(client.id)
    const call2 = refreshGscSnapshot(client.id)

    await waitFor(() => mockFetchGscQueryPage.mock.calls.length > 0)
    expect(mockFetchGscQueryPage).toHaveBeenCalledTimes(1)

    resolveDeferred(
      okResult({
        queryRows: [queryRow('sf-query', { position: 5 })],
        queryPageRows: [],
        queryAtLimit: false,
        queryPageAtLimit: false,
      }),
    )

    const [r1, r2] = await Promise.all([call1, call2])
    expect(r1.ok).toBe(true)
    expect(r1).toEqual(r2)

    const rows = await prisma.gscSnapshot.findMany({ where: { clientId: client.id } })
    expect(rows).toHaveLength(1)
  })

  it('different clients are not coalesced', async () => {
    const clientA = await makeClient('sc-domain:not-coalesced-a.example.edu')
    const clientB = await makeClient('sc-domain:not-coalesced-b.example.edu')

    mockFetchGscQueryPage.mockImplementation(async () =>
      okResult({
        queryRows: [queryRow('q', { position: 5 })],
        queryPageRows: [],
        queryAtLimit: false,
        queryPageAtLimit: false,
      }),
    )

    const [resultA, resultB] = await Promise.all([
      refreshGscSnapshot(clientA.id),
      refreshGscSnapshot(clientB.id),
    ])
    expect(resultA.ok).toBe(true)
    expect(resultB.ok).toBe(true)
    expect(mockFetchGscQueryPage).toHaveBeenCalledTimes(2)

    const rowsA = await prisma.gscSnapshot.findMany({ where: { clientId: clientA.id } })
    const rowsB = await prisma.gscSnapshot.findMany({ where: { clientId: clientB.id } })
    expect(rowsA).toHaveLength(1)
    expect(rowsB).toHaveLength(1)
  })

  it('summary caps: 51/51/51/21 derived entries cap to 50/50/50/20 while counts stay full', async () => {
    const client = await makeClient('sc-domain:caps.example.edu')

    const queryRows: GscQueryRow[] = []
    const queryPageRows: GscQueryPageRow[] = []

    for (let i = 0; i < 51; i++) {
      queryRows.push(queryRow(`win-${i}`, { position: 5, impressions: 100 }))
    }
    for (let i = 0; i < 51; i++) {
      queryRows.push(queryRow(`opp-${i}`, { position: 15, impressions: 100 }))
    }
    for (let i = 0; i < 21; i++) {
      const q = `cann-${i}`
      queryRows.push(queryRow(q, { position: 999, impressions: 100 })) // outside every band
      queryPageRows.push(queryPageRow(q, `https://caps.example.edu/${q}/a`, { impressions: 50 }))
      queryPageRows.push(queryPageRow(q, `https://caps.example.edu/${q}/b`, { impressions: 50 }))
    }

    mockFetchGscQueryPage.mockResolvedValueOnce(
      okResult({ queryRows, queryPageRows, queryAtLimit: false, queryPageAtLimit: false }),
    )

    const result = await refreshGscSnapshot(client.id)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.summary.counts).toEqual({
      wins: 51,
      opportunities: 51,
      quickWins: 51,
      cannibalizedQueries: 21,
    })
    expect(result.summary.wins).toHaveLength(50)
    expect(result.summary.opportunities).toHaveLength(50)
    expect(result.summary.quickWins).toHaveLength(50)
    expect(result.summary.cannibalization).toHaveLength(20)
  })
})

describe('getLatestGscSnapshot', () => {
  it('same fetchedAt: higher id wins (fetchedAt DESC, id DESC)', async () => {
    const client = await makeClient('sc-domain:ordering.example.edu')
    const sameFetchedAt = new Date('2026-01-01T00:00:00Z')

    await prisma.gscSnapshot.create({
      data: {
        clientId: client.id,
        gscSiteUrl: client.gscSiteUrl!,
        fetchedAt: sameFetchedAt,
        windowStart: new Date('2025-10-01T00:00:00Z'),
        windowEnd: new Date('2026-01-01T00:00:00Z'),
        queryRowLimit: 2500,
        queryPageRowLimit: 5000,
        queryAtLimit: false,
        queryPageAtLimit: false,
        minImpressions: GSC_MIN_IMPRESSIONS,
        queryRowsJson: JSON.stringify([queryRow('older-row', { position: 5 })]),
        queryPageRowsJson: '[]',
      },
    })
    const newer = await prisma.gscSnapshot.create({
      data: {
        clientId: client.id,
        gscSiteUrl: client.gscSiteUrl!,
        fetchedAt: sameFetchedAt,
        windowStart: new Date('2025-10-01T00:00:00Z'),
        windowEnd: new Date('2026-01-01T00:00:00Z'),
        queryRowLimit: 2500,
        queryPageRowLimit: 5000,
        queryAtLimit: false,
        queryPageAtLimit: false,
        minImpressions: GSC_MIN_IMPRESSIONS,
        queryRowsJson: JSON.stringify([queryRow('newer-row', { position: 5 })]),
        queryPageRowsJson: '[]',
      },
    })
    expect(newer.id).toBeGreaterThan(0)

    const latest = await getLatestGscSnapshot(client.id)
    expect(latest.gscMapped).toBe(true)
    expect(latest.summary?.wins.map((w) => w.query)).toEqual(['newer-row'])
  })

  it('mapping-change: a row stamped under property A is never surfaced after the client remaps to B', async () => {
    const client = await makeClient('sc-domain:map-a.example.edu')
    await prisma.gscSnapshot.create({
      data: {
        clientId: client.id,
        gscSiteUrl: 'sc-domain:map-a.example.edu',
        fetchedAt: new Date(),
        windowStart: new Date('2025-10-01T00:00:00Z'),
        windowEnd: new Date('2026-01-01T00:00:00Z'),
        queryRowLimit: 2500,
        queryPageRowLimit: 5000,
        queryAtLimit: false,
        queryPageAtLimit: false,
        minImpressions: GSC_MIN_IMPRESSIONS,
        queryRowsJson: JSON.stringify([queryRow('property-a-query', { position: 5 })]),
        queryPageRowsJson: '[]',
      },
    })

    const before = await getLatestGscSnapshot(client.id)
    expect(before.gscMapped).toBe(true)
    expect(before.summary?.wins.map((w) => w.query)).toEqual(['property-a-query'])

    await prisma.client.update({ where: { id: client.id }, data: { gscSiteUrl: 'sc-domain:map-b.example.edu' } })

    const after = await getLatestGscSnapshot(client.id)
    expect(after.gscMapped).toBe(true)
    expect(after.summary).toBeNull()
  })

  it('corrupt-newest fallback: a corrupt newest blob is skipped (+ logError) in favor of the next valid row', async () => {
    const client = await makeClient('sc-domain:corrupt-fallback.example.edu')
    await prisma.gscSnapshot.create({
      data: {
        clientId: client.id,
        gscSiteUrl: client.gscSiteUrl!,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
        windowStart: new Date('2025-10-01T00:00:00Z'),
        windowEnd: new Date('2026-01-01T00:00:00Z'),
        queryRowLimit: 2500,
        queryPageRowLimit: 5000,
        queryAtLimit: false,
        queryPageAtLimit: false,
        minImpressions: GSC_MIN_IMPRESSIONS,
        queryRowsJson: JSON.stringify([queryRow('older-valid-row', { position: 5 })]),
        queryPageRowsJson: '[]',
      },
    })
    const newest = await prisma.gscSnapshot.create({
      data: {
        clientId: client.id,
        gscSiteUrl: client.gscSiteUrl!,
        fetchedAt: new Date('2026-02-01T00:00:00Z'),
        windowStart: new Date('2025-11-01T00:00:00Z'),
        windowEnd: new Date('2026-02-01T00:00:00Z'),
        queryRowLimit: 2500,
        queryPageRowLimit: 5000,
        queryAtLimit: false,
        queryPageAtLimit: false,
        minImpressions: GSC_MIN_IMPRESSIONS,
        queryRowsJson: JSON.stringify([queryRow('newest-row', { position: 5 })]),
        queryPageRowsJson: '[]',
      },
    })
    await prisma.gscSnapshot.update({ where: { id: newest.id }, data: { queryRowsJson: 'not-json' } })

    const latest = await getLatestGscSnapshot(client.id)
    expect(latest.gscMapped).toBe(true)
    expect(latest.summary?.wins.map((w) => w.query)).toEqual(['older-valid-row'])
    expect(logError).toHaveBeenCalled()
  })

  it('all-corrupt: every retained row corrupt yields gscMapped:true, summary:null', async () => {
    const client = await makeClient('sc-domain:all-corrupt.example.edu')
    const rowA = await prisma.gscSnapshot.create({
      data: {
        clientId: client.id,
        gscSiteUrl: client.gscSiteUrl!,
        fetchedAt: new Date('2026-01-01T00:00:00Z'),
        windowStart: new Date('2025-10-01T00:00:00Z'),
        windowEnd: new Date('2026-01-01T00:00:00Z'),
        queryRowLimit: 2500,
        queryPageRowLimit: 5000,
        queryAtLimit: false,
        queryPageAtLimit: false,
        minImpressions: GSC_MIN_IMPRESSIONS,
        queryRowsJson: JSON.stringify([queryRow('a', { position: 5 })]),
        queryPageRowsJson: '[]',
      },
    })
    const rowB = await prisma.gscSnapshot.create({
      data: {
        clientId: client.id,
        gscSiteUrl: client.gscSiteUrl!,
        fetchedAt: new Date('2026-02-01T00:00:00Z'),
        windowStart: new Date('2025-11-01T00:00:00Z'),
        windowEnd: new Date('2026-02-01T00:00:00Z'),
        queryRowLimit: 2500,
        queryPageRowLimit: 5000,
        queryAtLimit: false,
        queryPageAtLimit: false,
        minImpressions: GSC_MIN_IMPRESSIONS,
        queryRowsJson: JSON.stringify([queryRow('b', { position: 5 })]),
        queryPageRowsJson: '[]',
      },
    })
    await prisma.gscSnapshot.update({ where: { id: rowA.id }, data: { queryRowsJson: 'not-json-a' } })
    await prisma.gscSnapshot.update({ where: { id: rowB.id }, data: { queryPageRowsJson: 'not-json-b' } })

    const latest = await getLatestGscSnapshot(client.id)
    expect(latest.gscMapped).toBe(true)
    expect(latest.summary).toBeNull()
    expect(logError).toHaveBeenCalledTimes(2)
  })

  it('unmapped client (gscSiteUrl null) → gscMapped:false, summary:null, no query', async () => {
    const client = await makeClient(null)
    const latest = await getLatestGscSnapshot(client.id)
    expect(latest).toEqual({ gscMapped: false, summary: null })
  })

  it('unknown client id → gscMapped:false, summary:null', async () => {
    const maxClient = await prisma.client.findFirst({ orderBy: { id: 'desc' } })
    const missingId = (maxClient?.id ?? 0) + 5_000_000
    const latest = await getLatestGscSnapshot(missingId)
    expect(latest).toEqual({ gscMapped: false, summary: null })
  })
})
