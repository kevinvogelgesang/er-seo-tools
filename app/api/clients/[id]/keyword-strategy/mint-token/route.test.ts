// app/api/clients/[id]/keyword-strategy/mint-token/route.test.ts
// DB-backed tests for the KS-5 mint route (Task 6). prisma is real against
// the local SQLite dev DB (house convention: prefix-named rows, cleaned in
// afterEach). refreshGscSnapshot and mintKeywordStrategyToken are module-
// mocked via vi.mock — Prisma model methods themselves are NEVER spied
// (house gotcha: vi.spyOn on prisma methods leaks across test files).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { VOLUME_SESSION_KEYWORD_CAP_DEFAULT } from '@/lib/keywords/strategy-volume-ledger'

const { mockRefreshGscSnapshot } = vi.hoisted(() => ({
  mockRefreshGscSnapshot: vi.fn(),
}));
vi.mock('@/lib/keywords/gsc-snapshot', () => ({
  refreshGscSnapshot: mockRefreshGscSnapshot,
}));

const { mockMintKeywordStrategyToken } = vi.hoisted(() => ({
  mockMintKeywordStrategyToken: vi.fn(),
}));
vi.mock('@/lib/keyword-strategy-token', () => ({
  mintKeywordStrategyToken: mockMintKeywordStrategyToken,
}));

import { POST } from './route'

const PREFIX = 'ks5mint-'
let counter = 0
const clientIds: number[] = []

async function makeClient(overrides: Record<string, unknown> = {}): Promise<number> {
  const client = await prisma.client.create({
    data: { name: `${PREFIX}${Date.now()}-${counter++}`, ...overrides },
  })
  clientIds.push(client.id)
  return client.id
}

function params(id: string | number) {
  return { params: Promise.resolve({ id: String(id) }) }
}

function req() {
  return new NextRequest('http://localhost/api/clients/1/keyword-strategy/mint-token', { method: 'POST' })
}

const MINTED = { token: 'kst_testtoken', expiresAt: new Date(Date.now() + 3600_000).toISOString() }

describe('POST /api/clients/[id]/keyword-strategy/mint-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefreshGscSnapshot.mockResolvedValue({ ok: true, summary: null })
    mockMintKeywordStrategyToken.mockResolvedValue(MINTED)
  })

  afterEach(async () => {
    await prisma.keywordStrategySession.deleteMany({ where: { clientId: { in: clientIds } } })
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
    clientIds.length = 0
  })

  it('400 invalid client id (NaN, leading zero, trailing garbage)', async () => {
    for (const bad of ['abc', '01', '1abc', '-1', '0']) {
      const res = await POST(req(), params(bad))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_client_id')
    }
    expect(mockRefreshGscSnapshot).not.toHaveBeenCalled()
  })

  it('404 unknown client', async () => {
    const res = await POST(req(), params(999999999))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('client_not_found')
  })

  it('409 client_archived', async () => {
    const clientId = await makeClient({ archivedAt: new Date() })
    const res = await POST(req(), params(clientId))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('client_archived')
    const count = await prisma.keywordStrategySession.count({ where: { clientId } })
    expect(count).toBe(0)
  })

  it('success: creates a processing row with the default cap, gscRefreshed:true, and returns { token, expiresAt, strategyId }', async () => {
    const clientId = await makeClient()
    const res = await POST(req(), params(clientId))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toMatch(/^kst_/)
    expect(body.expiresAt).toBe(MINTED.expiresAt)
    expect(typeof body.strategyId).toBe('string')

    const row = await prisma.keywordStrategySession.findUniqueOrThrow({ where: { id: body.strategyId } })
    expect(row.clientId).toBe(clientId)
    expect(row.status).toBe('processing')
    expect(row.gscRefreshed).toBe(true)
    expect(row.volumeKeywordCap).toBe(VOLUME_SESSION_KEYWORD_CAP_DEFAULT)
    expect(row.tokenMintedAt).toBeInstanceOf(Date)

    expect(mockMintKeywordStrategyToken).toHaveBeenCalledWith(row.id)
  })

  it('GSC refresh throwing still mints, with gscRefreshed:false', async () => {
    mockRefreshGscSnapshot.mockRejectedValue(new Error('gsc boom'))
    const clientId = await makeClient()
    const res = await POST(req(), params(clientId))
    expect(res.status).toBe(200)
    const body = await res.json()
    const row = await prisma.keywordStrategySession.findUniqueOrThrow({ where: { id: body.strategyId } })
    expect(row.gscRefreshed).toBe(false)
  })

  it('GSC refresh returning ok:false still mints, with gscRefreshed:false', async () => {
    mockRefreshGscSnapshot.mockResolvedValue({ ok: false, reason: 'not_mapped' })
    const clientId = await makeClient()
    const res = await POST(req(), params(clientId))
    expect(res.status).toBe(200)
    const body = await res.json()
    const row = await prisma.keywordStrategySession.findUniqueOrThrow({ where: { id: body.strategyId } })
    expect(row.gscRefreshed).toBe(false)
  })

  it('mint throwing → 500, and the just-created row is deleted (Codex #6)', async () => {
    mockMintKeywordStrategyToken.mockRejectedValue(new Error('token secret missing'))
    const clientId = await makeClient()

    const before = await prisma.keywordStrategySession.count({ where: { clientId } })
    expect(before).toBe(0)

    const res = await POST(req(), params(clientId))
    expect(res.status).toBe(500)

    const after = await prisma.keywordStrategySession.count({ where: { clientId } })
    expect(after).toBe(0)
  })
})
