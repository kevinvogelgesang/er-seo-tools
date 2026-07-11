// lib/keywords/retention.test.ts
//
// DB-backed test for KS-1 Task 6: keep-latest-3 GscSnapshot retention.
// Follows the house convention (lib/keywords/gsc-snapshot.test.ts, Task 4):
// PREFIX-scoped test clients created/cleaned around the suite; cascade
// delete from Client removes GscSnapshot rows.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { pruneGscSnapshots, pruneKeywordVolumeCache, pruneKeywordStrategySessions } from './retention'
import { reserveVolumeBudget, monthlyUsedKeywords } from './strategy-volume-ledger'

const PREFIX = 'ks1retention-'
let counter = 0

async function makeClient() {
  const client = await prisma.client.create({
    data: { name: `${PREFIX}${Date.now()}-${counter++}` },
  })
  return client
}

async function makeSnapshot(clientId: number, fetchedAt: Date) {
  return prisma.gscSnapshot.create({
    data: {
      clientId,
      gscSiteUrl: 'sc-domain:retention.example.edu',
      fetchedAt,
      windowStart: new Date('2025-10-01T00:00:00Z'),
      windowEnd: new Date('2026-01-01T00:00:00Z'),
      queryRowLimit: 2500,
      queryPageRowLimit: 5000,
      queryAtLimit: false,
      queryPageAtLimit: false,
      minImpressions: 10,
      queryRowsJson: '[]',
      queryPageRowsJson: '[]',
    },
  })
}

beforeAll(async () => {
  await prisma.gscSnapshot.deleteMany({ where: { client: { name: { startsWith: PREFIX } } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } }) // cascades GscSnapshot
})

describe('pruneGscSnapshots', () => {
  it('keeps the latest 3 per client by (fetchedAt DESC, id DESC); other clients untouched', async () => {
    const clientA = await makeClient()
    const clientB = await makeClient()

    const base = new Date('2026-01-01T00:00:00Z').getTime()
    // 5 staggered snapshots for client A, oldest to newest.
    const aRows = []
    for (let i = 0; i < 5; i++) {
      aRows.push(await makeSnapshot(clientA.id, new Date(base + i * 60_000)))
    }
    // 2 snapshots for client B (below the keep-3 threshold — must survive untouched).
    const bRows = []
    for (let i = 0; i < 2; i++) {
      bRows.push(await makeSnapshot(clientB.id, new Date(base + i * 60_000)))
    }

    await pruneGscSnapshots()

    const survivingA = await prisma.gscSnapshot.findMany({
      where: { clientId: clientA.id },
      orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
    })
    // Latest 3 by fetchedAt DESC, id DESC = the last 3 inserted (indices 2,3,4).
    const expectedSurvivorIds = [aRows[4].id, aRows[3].id, aRows[2].id]
    expect(survivingA.map((r) => r.id)).toEqual(expectedSurvivorIds)

    const survivingB = await prisma.gscSnapshot.findMany({ where: { clientId: clientB.id } })
    expect(survivingB.map((r) => r.id).sort()).toEqual(bRows.map((r) => r.id).sort())
  })

  it('same-fetchedAt tiebreak: with an identical fetchedAt, the higher id survives when trimming', async () => {
    const client = await makeClient()
    const sameFetchedAt = new Date('2026-02-01T00:00:00Z')

    // 4 rows total, all at the same fetchedAt, so only id DESC decides the
    // trim: the row with the LOWEST id must be the one pruned.
    const rows = []
    for (let i = 0; i < 4; i++) {
      rows.push(await makeSnapshot(client.id, sameFetchedAt))
    }

    await pruneGscSnapshots()

    const surviving = await prisma.gscSnapshot.findMany({
      where: { clientId: client.id },
      orderBy: { id: 'desc' },
    })
    const expectedSurvivorIds = [rows[3].id, rows[2].id, rows[1].id]
    expect(surviving.map((r) => r.id)).toEqual(expectedSurvivorIds)
    expect(surviving.some((r) => r.id === rows[0].id)).toBe(false)
  })
})

// ─── KS-2 Task 6: 30-d KeywordVolumeCache prune ──────────────────────────────
const VOLUME_PREFIX = 'ks2ret-'

async function makeVolumeCacheRow(keyword: string, fetchedAt: Date) {
  return prisma.keywordVolumeCache.create({
    data: {
      keyword,
      locationCode: 2840,
      languageCode: 'en',
      providerVersion: 'google_ads_v3',
      resultStatus: 'returned',
      searchVolume: 100,
      fetchedAt,
    },
  })
}

describe('pruneKeywordVolumeCache', () => {
  beforeAll(async () => {
    await prisma.keywordVolumeCache.deleteMany({ where: { keyword: { startsWith: VOLUME_PREFIX } } })
  })

  afterAll(async () => {
    await prisma.keywordVolumeCache.deleteMany({ where: { keyword: { startsWith: VOLUME_PREFIX } } })
  })

  it('prunes rows fetched 31 days ago, keeps rows fetched 29 days ago', async () => {
    const now = Date.now()
    const old = await makeVolumeCacheRow(
      `${VOLUME_PREFIX}old`,
      new Date(now - 31 * 24 * 60 * 60 * 1000),
    )
    const fresh = await makeVolumeCacheRow(
      `${VOLUME_PREFIX}fresh`,
      new Date(now - 29 * 24 * 60 * 60 * 1000),
    )

    await pruneKeywordVolumeCache()

    const survivors = await prisma.keywordVolumeCache.findMany({
      where: { keyword: { startsWith: VOLUME_PREFIX } },
    })
    expect(survivors.map((r) => r.id)).toEqual([fresh.id])
    expect(survivors.some((r) => r.id === old.id)).toBe(false)
  })
})

// ─── KS-5 Task 9: tiered KeywordStrategySession prune ────────────────────────
const STRATEGY_PREFIX = 'ks5ret-'

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

async function makeStrategyClient() {
  return prisma.client.create({
    data: { name: `${STRATEGY_PREFIX}${Date.now()}-${counter++}` },
  })
}

async function makeStrategySession(opts: {
  clientId: number
  tokenMintedAt: Date
  memoMarkdown?: string | null
}) {
  return prisma.keywordStrategySession.create({
    data: {
      clientId: opts.clientId,
      tokenMintedAt: opts.tokenMintedAt,
      memoMarkdown: opts.memoMarkdown ?? null,
      volumeKeywordCap: 1500,
    },
  })
}

describe('pruneKeywordStrategySessions', () => {
  beforeAll(async () => {
    await prisma.client.deleteMany({ where: { name: { startsWith: STRATEGY_PREFIX } } })
  })

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { name: { startsWith: STRATEGY_PREFIX } } }) // cascades sessions + requests
  })

  it('prunes a memo-less session with no request rows at 8 days old', async () => {
    const client = await makeStrategyClient()
    const session = await makeStrategySession({ clientId: client.id, tokenMintedAt: daysAgo(8) })

    await pruneKeywordStrategySessions()

    const survivor = await prisma.keywordStrategySession.findUnique({ where: { id: session.id } })
    expect(survivor).toBeNull()
  })

  it('keeps a memo-less session with no request rows at 6 days old', async () => {
    const client = await makeStrategyClient()
    const session = await makeStrategySession({ clientId: client.id, tokenMintedAt: daysAgo(6) })

    await pruneKeywordStrategySessions()

    const survivor = await prisma.keywordStrategySession.findUnique({ where: { id: session.id } })
    expect(survivor).not.toBeNull()
  })

  it('keeps a memo-less session WITH a request row at 8 days old; monthlyUsedKeywords still counts its spend', async () => {
    const client = await makeStrategyClient()
    const session = await makeStrategySession({ clientId: client.id, tokenMintedAt: daysAgo(8) })
    const reserve = await reserveVolumeBudget({
      sessionId: session.id,
      idempotencyKey: 'k1',
      keywordCount: 10,
    })
    expect(reserve.ok).toBe(true)

    const usedBefore = await monthlyUsedKeywords(new Date())
    await pruneKeywordStrategySessions()
    const usedAfter = await monthlyUsedKeywords(new Date())

    expect(usedAfter).toBe(usedBefore)
    const survivor = await prisma.keywordStrategySession.findUnique({ where: { id: session.id } })
    expect(survivor).not.toBeNull()
    const requestCount = await prisma.keywordStrategyVolumeRequest.count({
      where: { strategySessionId: session.id },
    })
    expect(requestCount).toBe(1)
  })

  it('prunes a memo-less session WITH request rows at 46 days old, cascading the request rows', async () => {
    const client = await makeStrategyClient()
    const session = await makeStrategySession({ clientId: client.id, tokenMintedAt: daysAgo(46) })
    const reserve = await reserveVolumeBudget({
      sessionId: session.id,
      idempotencyKey: 'k1',
      keywordCount: 10,
    })
    expect(reserve.ok).toBe(true)

    await pruneKeywordStrategySessions()

    const survivor = await prisma.keywordStrategySession.findUnique({ where: { id: session.id } })
    expect(survivor).toBeNull()
    const requestCount = await prisma.keywordStrategyVolumeRequest.count({
      where: { strategySessionId: session.id },
    })
    expect(requestCount).toBe(0)
  })

  it('never prunes a memo-bearing session, even at 46 days old', async () => {
    const client = await makeStrategyClient()
    const session = await makeStrategySession({
      clientId: client.id,
      tokenMintedAt: daysAgo(46),
      memoMarkdown: '# Strategy',
    })

    await pruneKeywordStrategySessions()

    const survivor = await prisma.keywordStrategySession.findUnique({ where: { id: session.id } })
    expect(survivor).not.toBeNull()
  })
})
