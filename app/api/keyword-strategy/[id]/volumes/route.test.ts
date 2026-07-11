// app/api/keyword-strategy/[id]/volumes/route.test.ts
// KS-5 Task 7 — the billable volumes POST. DB-backed ledger (real prisma +
// real strategy-volume-ledger); getKeywordVolumes and isVolumeEnabled are
// module-mocked (KS-2 constants kept real via importOriginal). Tokens minted
// real; the token module is NOT mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { mintKeywordStrategyToken } from '@/lib/keyword-strategy-token'
import { mintKeywordMemoToken } from '@/lib/keyword-memo-token'
import {
  reserveVolumeBudget,
  settleVolumeRequest,
  monthlyUsedKeywords,
} from '@/lib/keywords/strategy-volume-ledger'
import type { GetKeywordVolumesResult } from '@/lib/keywords/volume'

const { mockGetKeywordVolumes } = vi.hoisted(() => ({ mockGetKeywordVolumes: vi.fn() }))
vi.mock('@/lib/keywords/volume', () => ({ getKeywordVolumes: mockGetKeywordVolumes }))

const { mockIsVolumeEnabled } = vi.hoisted(() => ({ mockIsVolumeEnabled: vi.fn() }))
vi.mock('@/lib/keywords/volume-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/keywords/volume-config')>()
  return { ...actual, isVolumeEnabled: mockIsVolumeEnabled }
})

import { POST } from './route'

const ORIG_ENV = { ...process.env }
const TEST_SECRET = 'ks5pub-secret'
const PREFIX = 'ks5pub-'
let counter = 0
const clientIds: number[] = []
const sessionIds: string[] = []

async function makeClient(withLocale = true): Promise<number> {
  const c = await prisma.client.create({
    data: {
      name: `${PREFIX}${Date.now()}-${counter++}`,
      ...(withLocale ? { kwLocationCode: 2840, kwLanguageCode: 'en', kwMarketLabel: 'US' } : {}),
    },
  })
  clientIds.push(c.id)
  return c.id
}
async function makeSession(clientId: number, cap = 1500): Promise<string> {
  const s = await prisma.keywordStrategySession.create({
    data: { clientId, tokenMintedAt: new Date(), volumeKeywordCap: cap },
  })
  sessionIds.push(s.id)
  return s.id
}
async function tokenFor(id: string): Promise<string> {
  return (await mintKeywordStrategyToken(id)).token
}

function req(id: string, body: unknown, auth?: string, raw?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth) headers.authorization = auth
  return new NextRequest(`http://localhost/api/keyword-strategy/${id}/volumes`, {
    method: 'POST',
    headers,
    body: raw !== undefined ? raw : JSON.stringify(body),
  })
}
function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function okResult(over: Partial<GetKeywordVolumesResult> = {}): GetKeywordVolumesResult {
  return {
    ok: true,
    volumes: [],
    fromCache: 0,
    fetched: 0,
    skipped: [],
    attemptedChunks: 0,
    successfulChunks: 0,
    providerCost: 0,
    ...over,
  } as GetKeywordVolumesResult
}

async function usedFor(id: string): Promise<number> {
  const row = await prisma.keywordStrategySession.findUniqueOrThrow({ where: { id } })
  return row.volumeKeywordsUsed
}

describe('POST /api/keyword-strategy/[id]/volumes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...ORIG_ENV, KEYWORD_MEMO_TOKEN_SECRET: TEST_SECRET, NODE_ENV: 'test' }
    mockIsVolumeEnabled.mockReturnValue(true)
  })
  afterEach(async () => {
    await prisma.keywordStrategyVolumeRequest.deleteMany({ where: { strategySessionId: { in: sessionIds } } })
    await prisma.keywordStrategySession.deleteMany({ where: { id: { in: sessionIds } } })
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
    sessionIds.length = 0
    clientIds.length = 0
    process.env = { ...ORIG_ENV }
  })

  // ---- auth / scope ----
  it('401 for a real legacy krt_ memo token', async () => {
    const { token } = await mintKeywordMemoToken('kss_x')
    const res = await POST(req('kss_x', { idempotencyKey: 'k', keywords: ['a'] }, `Bearer ${token}`), params('kss_x'))
    expect(res.status).toBe(401)
  })

  it('401 token_missing_scope without volume-lookup', async () => {
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(TEST_SECRET)
    const iat = Math.floor(Date.now() / 1000)
    const jwt = await new SignJWT({ scope: ['read', 'memo-write'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('keyword-strategy-client')
      .setSubject('kss_x')
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(secret)
    const res = await POST(req('kss_x', { idempotencyKey: 'k', keywords: ['a'] }, `Bearer kst_${jwt}`), params('kss_x'))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('token_missing_scope')
  })

  // ---- body validation (before auth) ----
  it('400 idempotency_key_required (before auth)', async () => {
    const res = await POST(req('kss_x', { keywords: ['a'] }), params('kss_x'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('idempotency_key_required')
  })

  it('400 idempotency_key_too_long over 64', async () => {
    const res = await POST(req('kss_x', { idempotencyKey: 'x'.repeat(65), keywords: ['a'] }), params('kss_x'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('idempotency_key_too_long')
  })

  it('400 keywords_required when not an array', async () => {
    const res = await POST(req('kss_x', { idempotencyKey: 'k', keywords: 'nope' }), params('kss_x'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('keywords_required')
  })

  it('400 too_many_keywords over 300', async () => {
    const kws = Array.from({ length: 301 }, (_, i) => `kw${i}`)
    const res = await POST(req('kss_x', { idempotencyKey: 'k', keywords: kws }), params('kss_x'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('too_many_keywords')
  })

  // ---- dark gate ----
  it('409 volume_disabled before any reservation (no request row created)', async () => {
    mockIsVolumeEnabled.mockReturnValue(false)
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const res = await POST(req(id, { idempotencyKey: 'k', keywords: ['a'] }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('volume_disabled')
    const count = await prisma.keywordStrategyVolumeRequest.count({ where: { strategySessionId: id } })
    expect(count).toBe(0)
    expect(mockGetKeywordVolumes).not.toHaveBeenCalled()
  })

  // ---- locale ----
  it('409 locale_not_configured when the client profile has no locale', async () => {
    const clientId = await makeClient(false)
    const id = await makeSession(clientId)
    const res = await POST(req(id, { idempotencyKey: 'k', keywords: ['a'] }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('locale_not_configured')
    expect(mockGetKeywordVolumes).not.toHaveBeenCalled()
  })

  it('body-supplied locale is ignored — getKeywordVolumes gets the profile locale', async () => {
    mockGetKeywordVolumes.mockResolvedValue(okResult({ volumes: [], fromCache: 1, fetched: 0 }))
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const res = await POST(
      req(id, { idempotencyKey: 'k1', keywords: ['nursing'], locale: { locationCode: 9, languageCode: 'zz' } }, `Bearer ${await tokenFor(id)}`),
      params(id),
    )
    expect(res.status).toBe(200)
    expect(mockGetKeywordVolumes).toHaveBeenCalledWith(['nursing'], { locationCode: 2840, languageCode: 'en' })
  })

  // ---- filter/dedupe ----
  it('81-char keyword is route-filtered into skipped AND excluded from the reservation', async () => {
    mockGetKeywordVolumes.mockResolvedValue(okResult({ volumes: [], fromCache: 1, fetched: 0 }))
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const longKw = 'a'.repeat(81)
    const res = await POST(
      req(id, { idempotencyKey: 'k1', keywords: [longKw, 'nursing'] }, `Bearer ${await tokenFor(id)}`),
      params(id),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.accounting.skipped).toEqual(expect.arrayContaining([{ keyword: longKw, reason: 'too_long' }]))
    // reservation counted only the 1 survivor
    const reqRow = await prisma.keywordStrategyVolumeRequest.findFirstOrThrow({ where: { strategySessionId: id } })
    expect(reqRow.keywordCount).toBe(1)
    expect(mockGetKeywordVolumes).toHaveBeenCalledWith(['nursing'], { locationCode: 2840, languageCode: 'en' })
  })

  it('400 no_valid_keywords when everything is dropped', async () => {
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const res = await POST(
      req(id, { idempotencyKey: 'k1', keywords: ['', '   ', 'a'.repeat(81)] }, `Bearer ${await tokenFor(id)}`),
      params(id),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('no_valid_keywords')
    expect(mockGetKeywordVolumes).not.toHaveBeenCalled()
  })

  // ---- happy path ----
  it('happy path: reserve 5, KS-2 returns 2 fetched / 3 cache, settle refunds 3', async () => {
    mockGetKeywordVolumes.mockResolvedValue(
      okResult({ volumes: [{ keyword: 'a', outcome: 'not_returned', fromCache: true }] as never, fromCache: 3, fetched: 2, providerCost: 0.02 }),
    )
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const kws = ['a', 'b', 'c', 'd', 'e']
    const res = await POST(req(id, { idempotencyKey: 'k1', keywords: kws }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.accounting.fetched).toBe(2)
    expect(body.accounting.fromCache).toBe(3)
    expect(body.budget.cap).toBe(1500)
    // reserve added 5, settle refunded 5-2=3 → used=2
    expect(await usedFor(id)).toBe(2)
    expect(body.budget.used).toBe(2)
    const reqRow = await prisma.keywordStrategyVolumeRequest.findFirstOrThrow({ where: { strategySessionId: id } })
    expect(reqRow.state).toBe('settled')
    expect(reqRow.settledKeywords).toBe(2)
  })

  // ---- duplicate-settled replay ----
  it('duplicate of a settled request replays stored responseJson with 200', async () => {
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    // Seed a settled row through the real ledger with a stored responseJson.
    const reserved = await reserveVolumeBudget({ sessionId: id, idempotencyKey: 'dup', keywordCount: 2 })
    if (!reserved.ok) throw new Error('seed reserve failed')
    const stored = { ok: true, volumes: [{ keyword: 'x' }], accounting: { fetched: 2 }, budget: { used: 2, cap: 1500 } }
    await settleVolumeRequest({
      sessionId: id,
      requestId: reserved.requestId,
      outcome: { kind: 'accounted', fetched: 2, fromCache: 0, providerCost: 0.01, responseJson: JSON.stringify(stored) },
    })
    const res = await POST(req(id, { idempotencyKey: 'dup', keywords: ['x', 'y'] }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(stored)
    expect(mockGetKeywordVolumes).not.toHaveBeenCalled()
  })

  it('duplicate settled with null responseJson → 409 duplicate_request', async () => {
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const reserved = await reserveVolumeBudget({ sessionId: id, idempotencyKey: 'dupn', keywordCount: 2 })
    if (!reserved.ok) throw new Error('seed reserve failed')
    await settleVolumeRequest({
      sessionId: id,
      requestId: reserved.requestId,
      outcome: { kind: 'accounted', fetched: 2, fromCache: 0, providerCost: null, responseJson: null },
    })
    const res = await POST(req(id, { idempotencyKey: 'dupn', keywords: ['x'] }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('duplicate_request')
  })

  // ---- duplicate-reserved ----
  it('duplicate of a still-reserved request → 409, counter unchanged', async () => {
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const reserved = await reserveVolumeBudget({ sessionId: id, idempotencyKey: 'live', keywordCount: 3 })
    if (!reserved.ok) throw new Error('seed reserve failed')
    const before = await usedFor(id)
    const res = await POST(req(id, { idempotencyKey: 'live', keywords: ['x', 'y'] }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('duplicate_request')
    expect(await usedFor(id)).toBe(before)
    expect(mockGetKeywordVolumes).not.toHaveBeenCalled()
  })

  // ---- ok:false with accounting ----
  it('KS-2 ok:false with accounting retains fetched and maps the envelope with budget', async () => {
    mockGetKeywordVolumes.mockResolvedValue({
      ok: false,
      reason: 'payment',
      message: 'insufficient funds',
      fromCache: 0,
      fetched: 2,
      skipped: [],
      attemptedChunks: 1,
      successfulChunks: 1,
      providerCost: 0.01,
    } as GetKeywordVolumesResult)
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const res = await POST(req(id, { idempotencyKey: 'k1', keywords: ['a', 'b', 'c'] }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.reason).toBe('payment')
    expect(body.budget.cap).toBe(1500)
    // reserve 3, retained=fetched=2, refund=1 → used=2
    expect(await usedFor(id)).toBe(2)
    expect(body.budget.used).toBe(2)
    const reqRow = await prisma.keywordStrategyVolumeRequest.findFirstOrThrow({ where: { strategySessionId: id } })
    expect(reqRow.settledKeywords).toBe(2)
  })

  it('KS-2 rate_limited maps to 429', async () => {
    mockGetKeywordVolumes.mockResolvedValue({
      ok: false, reason: 'rate_limited', fromCache: 0, fetched: 0, skipped: [], attemptedChunks: 1, successfulChunks: 0, providerCost: null,
    } as GetKeywordVolumesResult)
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const res = await POST(req(id, { idempotencyKey: 'k1', keywords: ['a'] }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(429)
    expect((await res.json()).reason).toBe('rate_limited')
  })

  // ---- thrown call ----
  it('getKeywordVolumes THROWS → 500, request unresolved, no refund', async () => {
    mockGetKeywordVolumes.mockRejectedValue(new Error('boom'))
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const res = await POST(req(id, { idempotencyKey: 'k1', keywords: ['a', 'b', 'c'] }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(500)
    // reserve added 3, no refund on unresolved
    expect(await usedFor(id)).toBe(3)
    const reqRow = await prisma.keywordStrategyVolumeRequest.findFirstOrThrow({ where: { strategySessionId: id } })
    expect(reqRow.state).toBe('unresolved')
  })

  // ---- budget exhaustion ----
  it('reservation over the session cap → 429 volume_budget_exhausted with used/cap', async () => {
    const clientId = await makeClient()
    const id = await makeSession(clientId, 2) // cap 2
    const res = await POST(req(id, { idempotencyKey: 'k1', keywords: ['a', 'b', 'c'] }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('volume_budget_exhausted')
    expect(body.used).toBe(0)
    expect(body.cap).toBe(2)
    expect(mockGetKeywordVolumes).not.toHaveBeenCalled()
  })

  // ---- monthly ceiling ----
  it('monthly ceiling: used + n > ceiling → 429 volume_monthly_ceiling', async () => {
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const now = new Date()
    const base = await monthlyUsedKeywords(now)
    const seed = 5
    const n = 2 // ['a','b']
    process.env.VOLUME_MONTHLY_KEYWORD_CEILING = String(base + seed + n - 1)
    // seed a settled row this month contributing `seed` keywords
    await prisma.keywordStrategyVolumeRequest.create({
      data: { strategySessionId: id, idempotencyKey: 'seed', state: 'settled', keywordCount: seed, settledKeywords: seed },
    })
    const res = await POST(req(id, { idempotencyKey: 'k1', keywords: ['a', 'b'] }, `Bearer ${await tokenFor(id)}`), params(id))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('volume_monthly_ceiling')
    expect(mockGetKeywordVolumes).not.toHaveBeenCalled()
  })
})
