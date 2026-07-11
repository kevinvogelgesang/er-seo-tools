// lib/keywords/strategy-volume-ledger.test.ts
//
// DB-backed tests for the KS-5 volume-spend ledger (Task 4) — the money-
// integrity core. prisma is real against the local SQLite dev DB; there is no
// provider mock here (this layer never calls DataForSEO — it only guards the
// budget around such a call). House convention: prefix-named test clients,
// cleaned up in beforeAll/afterAll (cascades sessions → volume-request rows).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import {
  VOLUME_SESSION_KEYWORD_CAP_DEFAULT,
  VOLUME_MONTHLY_KEYWORD_CEILING_DEFAULT,
  sessionKeywordCap,
  monthlyKeywordCeiling,
  reserveVolumeBudget,
  settleVolumeRequest,
  monthlyUsedKeywords,
  sweepStaleReservations,
} from './strategy-volume-ledger'

const PREFIX = 'ks5ledger-'
let counter = 0

async function makeSession(cap: number, used = 0): Promise<string> {
  const client = await prisma.client.create({
    data: { name: `${PREFIX}${Date.now()}-${counter++}` },
  })
  const session = await prisma.keywordStrategySession.create({
    data: {
      clientId: client.id,
      tokenMintedAt: new Date(),
      volumeKeywordCap: cap,
      volumeKeywordsUsed: used,
    },
  })
  return session.id
}

async function usedOf(sessionId: string): Promise<number> {
  const row = await prisma.keywordStrategySession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { volumeKeywordsUsed: true },
  })
  return row.volumeKeywordsUsed
}

async function rowOf(requestId: string) {
  return prisma.keywordStrategyVolumeRequest.findUniqueOrThrow({ where: { id: requestId } })
}

beforeAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('env caps', () => {
  it('exposes defaults 1500 / 25000', () => {
    expect(VOLUME_SESSION_KEYWORD_CAP_DEFAULT).toBe(1500)
    expect(VOLUME_MONTHLY_KEYWORD_CEILING_DEFAULT).toBe(25000)
  })

  it('sessionKeywordCap / monthlyKeywordCeiling read env at call time', () => {
    const prevCap = process.env.VOLUME_SESSION_KEYWORD_CAP
    const prevCeil = process.env.VOLUME_MONTHLY_KEYWORD_CEILING
    try {
      delete process.env.VOLUME_SESSION_KEYWORD_CAP
      delete process.env.VOLUME_MONTHLY_KEYWORD_CEILING
      expect(sessionKeywordCap()).toBe(1500)
      expect(monthlyKeywordCeiling()).toBe(25000)
      process.env.VOLUME_SESSION_KEYWORD_CAP = '2000'
      process.env.VOLUME_MONTHLY_KEYWORD_CEILING = '9000'
      expect(sessionKeywordCap()).toBe(2000)
      expect(monthlyKeywordCeiling()).toBe(9000)
    } finally {
      if (prevCap === undefined) delete process.env.VOLUME_SESSION_KEYWORD_CAP
      else process.env.VOLUME_SESSION_KEYWORD_CAP = prevCap
      if (prevCeil === undefined) delete process.env.VOLUME_MONTHLY_KEYWORD_CEILING
      else process.env.VOLUME_MONTHLY_KEYWORD_CEILING = prevCeil
    }
  })
})

describe('reserveVolumeBudget', () => {
  it('reserves and decrements headroom; boundary cap−n fits, n+1 refused', async () => {
    const sid = await makeSession(100)
    const r1 = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'k1', keywordCount: 100 })
    expect(r1.ok).toBe(true)
    expect(await usedOf(sid)).toBe(100)

    const r2 = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'k2', keywordCount: 1 })
    expect(r2).toEqual({ ok: false, reason: 'budget_exhausted', used: 100, cap: 100 })
    expect(await usedOf(sid)).toBe(100)
  })

  it('duplicate key while prior row reserved → duplicate_request, counter unchanged', async () => {
    const sid = await makeSession(100)
    const r1 = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'dup', keywordCount: 10 })
    expect(r1.ok).toBe(true)
    const r2 = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'dup', keywordCount: 10 })
    expect(r2).toEqual({ ok: false, reason: 'duplicate_request', priorState: 'reserved' })
    expect(await usedOf(sid)).toBe(10)
  })

  it('duplicate key while prior row settled → duplicate_settled with stored responseJson', async () => {
    const sid = await makeSession(100)
    const r1 = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'dupset', keywordCount: 10 })
    if (!r1.ok) throw new Error('setup reserve failed')
    await settleVolumeRequest({
      sessionId: sid,
      requestId: r1.requestId,
      outcome: { kind: 'accounted', fetched: 4, fromCache: 6, providerCost: 0.5, responseJson: '{"vol":1}' },
    })
    const r2 = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'dupset', keywordCount: 10 })
    expect(r2).toEqual({ ok: false, reason: 'duplicate_settled', responseJson: '{"vol":1}' })
  })

  it('duplicate precedence over budget exhaustion (exhausted session, duplicate key)', async () => {
    const sid = await makeSession(10)
    const r1 = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'pre', keywordCount: 10 })
    expect(r1.ok).toBe(true) // session now exhausted
    const r2 = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'pre', keywordCount: 10 })
    expect(r2).toEqual({ ok: false, reason: 'duplicate_request', priorState: 'reserved' })
  })

  it('duplicate precedence when budget IS available (unique-violation rollback path)', async () => {
    const sid = await makeSession(1000)
    const r1 = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'preb', keywordCount: 10 })
    expect(r1.ok).toBe(true)
    const usedBefore = await usedOf(sid)
    const r2 = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'preb', keywordCount: 10 })
    expect(r2).toEqual({ ok: false, reason: 'duplicate_request', priorState: 'reserved' })
    expect(await usedOf(sid)).toBe(usedBefore) // rollback — no half-reserve
  })

  it('concurrent reserves under a tight cap: exactly one succeeds', async () => {
    const sid = await makeSession(10)
    const results = await Promise.all([
      reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'c1', keywordCount: 10 }),
      reserveVolumeBudget({ sessionId: sid, idempotencyKey: 'c2', keywordCount: 10 }),
    ])
    const oks = results.filter((r) => r.ok)
    expect(oks).toHaveLength(1)
    expect(await usedOf(sid)).toBe(10)
  })
})

describe('settleVolumeRequest', () => {
  it('accounted (fetched 3 of 10) refunds 7, stores accounting', async () => {
    const sid = await makeSession(100)
    const r = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 's1', keywordCount: 10 })
    if (!r.ok) throw new Error('reserve failed')
    await settleVolumeRequest({
      sessionId: sid,
      requestId: r.requestId,
      outcome: { kind: 'accounted', fetched: 3, fromCache: 7, providerCost: 1.23, responseJson: 'RJ' },
    })
    expect(await usedOf(sid)).toBe(3)
    const row = await rowOf(r.requestId)
    expect(row.state).toBe('settled')
    expect(row.settledKeywords).toBe(3)
    expect(row.fetched).toBe(3)
    expect(row.fromCache).toBe(7)
    expect(row.providerCost).toBe(1.23)
    expect(row.responseJson).toBe('RJ')
  })

  it('wrong-count immunity: fetched >> keywordCount clamps, never over-refunds', async () => {
    const sid = await makeSession(100)
    const r = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 's2', keywordCount: 10 })
    if (!r.ok) throw new Error('reserve failed')
    await settleVolumeRequest({
      sessionId: sid,
      requestId: r.requestId,
      outcome: { kind: 'accounted', fetched: 9999, fromCache: 0, providerCost: 0, responseJson: null },
    })
    expect(await usedOf(sid)).toBe(10) // retained clamped to 10, refund 0
    const row = await rowOf(r.requestId)
    expect(row.settledKeywords).toBe(10)
  })

  it('providerCost null passthrough', async () => {
    const sid = await makeSession(100)
    const r = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 's3', keywordCount: 10 })
    if (!r.ok) throw new Error('reserve failed')
    await settleVolumeRequest({
      sessionId: sid,
      requestId: r.requestId,
      outcome: { kind: 'accounted', fetched: 5, fromCache: 5, providerCost: null, responseJson: 'x' },
    })
    const row = await rowOf(r.requestId)
    expect(row.providerCost).toBeNull()
  })

  it('over-size responseJson stored as null', async () => {
    const sid = await makeSession(100)
    const r = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 's3b', keywordCount: 10 })
    if (!r.ok) throw new Error('reserve failed')
    const huge = 'a'.repeat(1_000_001)
    await settleVolumeRequest({
      sessionId: sid,
      requestId: r.requestId,
      outcome: { kind: 'accounted', fetched: 5, fromCache: 5, providerCost: 0.1, responseJson: huge },
    })
    const row = await rowOf(r.requestId)
    expect(row.responseJson).toBeNull()
  })

  it('unresolved → no refund, state unresolved, settledKeywords stays null', async () => {
    const sid = await makeSession(100)
    const r = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 's4', keywordCount: 10 })
    if (!r.ok) throw new Error('reserve failed')
    await settleVolumeRequest({ sessionId: sid, requestId: r.requestId, outcome: { kind: 'unresolved' } })
    expect(await usedOf(sid)).toBe(10)
    const row = await rowOf(r.requestId)
    expect(row.state).toBe('unresolved')
    expect(row.settledKeywords).toBeNull()
    expect(row.providerCost).toBeNull()
  })

  it('double-settle no-ops (counters + row untouched by the second call)', async () => {
    const sid = await makeSession(100)
    const r = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 's5', keywordCount: 10 })
    if (!r.ok) throw new Error('reserve failed')
    await settleVolumeRequest({
      sessionId: sid,
      requestId: r.requestId,
      outcome: { kind: 'accounted', fetched: 3, fromCache: 7, providerCost: 1, responseJson: 'first' },
    })
    expect(await usedOf(sid)).toBe(3)
    // Second settle with different numbers — must not change anything.
    await settleVolumeRequest({
      sessionId: sid,
      requestId: r.requestId,
      outcome: { kind: 'accounted', fetched: 9, fromCache: 1, providerCost: 5, responseJson: 'second' },
    })
    expect(await usedOf(sid)).toBe(3)
    const row = await rowOf(r.requestId)
    expect(row.settledKeywords).toBe(3)
    expect(row.responseJson).toBe('first')
    expect(row.providerCost).toBe(1)
  })

  it('floor guard: refund larger than the counter cannot go negative', async () => {
    const sid = await makeSession(100)
    const r = await reserveVolumeBudget({ sessionId: sid, idempotencyKey: 's6', keywordCount: 10 })
    if (!r.ok) throw new Error('reserve failed')
    // Corrupt the counter below the reservation to force the MAX(0, …) floor.
    await prisma.keywordStrategySession.update({
      where: { id: sid },
      data: { volumeKeywordsUsed: 3 },
    })
    await settleVolumeRequest({
      sessionId: sid,
      requestId: r.requestId,
      outcome: { kind: 'accounted', fetched: 0, fromCache: 10, providerCost: 0, responseJson: null },
    })
    // refund = 10, MAX(0, 3 - 10) = 0
    expect(await usedOf(sid)).toBe(0)
  })
})

describe('monthlyUsedKeywords', () => {
  it('counts only current UTC month; prefers settledKeywords over keywordCount', async () => {
    const sid = await makeSession(100000)
    const now = new Date('2026-06-15T12:00:00.000Z')
    const baseline = await monthlyUsedKeywords(now)

    // Current-month settled row: contributes settledKeywords (4), NOT keywordCount (10).
    await prisma.keywordStrategyVolumeRequest.create({
      data: {
        strategySessionId: sid,
        idempotencyKey: 'm-current-settled',
        state: 'settled',
        keywordCount: 10,
        settledKeywords: 4,
        createdAt: new Date('2026-06-10T00:00:00.000Z'),
      },
    })
    // Current-month reserved row (no settledKeywords): contributes keywordCount (5).
    await prisma.keywordStrategyVolumeRequest.create({
      data: {
        strategySessionId: sid,
        idempotencyKey: 'm-current-reserved',
        state: 'reserved',
        keywordCount: 5,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    })
    // Previous-month row: must NOT count.
    await prisma.keywordStrategyVolumeRequest.create({
      data: {
        strategySessionId: sid,
        idempotencyKey: 'm-prev',
        state: 'settled',
        keywordCount: 50,
        settledKeywords: 50,
        createdAt: new Date('2026-05-31T23:59:59.000Z'),
      },
    })

    const after = await monthlyUsedKeywords(now)
    expect(after - baseline).toBe(9) // 4 (settled) + 5 (keywordCount), prev-month excluded
  })
})

describe('sweepStaleReservations', () => {
  it('flips >24h reserved rows to unresolved without refunding; fresh rows untouched', async () => {
    const sid = await makeSession(100, 30)
    const now = new Date('2026-06-15T12:00:00.000Z')

    const stale = await prisma.keywordStrategyVolumeRequest.create({
      data: {
        strategySessionId: sid,
        idempotencyKey: 'sweep-stale',
        state: 'reserved',
        keywordCount: 20,
        createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
      },
    })
    const fresh = await prisma.keywordStrategyVolumeRequest.create({
      data: {
        strategySessionId: sid,
        idempotencyKey: 'sweep-fresh',
        state: 'reserved',
        keywordCount: 10,
        createdAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      },
    })

    const flipped = await sweepStaleReservations(now)
    expect(flipped).toBeGreaterThanOrEqual(1)

    expect((await rowOf(stale.id)).state).toBe('unresolved')
    expect((await rowOf(fresh.id)).state).toBe('reserved')
    expect(await usedOf(sid)).toBe(30) // NO refund
  })
})
