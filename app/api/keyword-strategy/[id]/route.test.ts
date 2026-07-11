// app/api/keyword-strategy/[id]/route.test.ts
// KS-5 Task 7 — public token-authed export GET. DB-backed (prisma real,
// prefix-named rows cleaned in afterEach). Tokens are minted REAL via
// mintKeywordStrategyToken; reduced-scope / cross-family tokens are hand-crafted
// with jose. The token module is NOT mocked — we want real verification.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { mintKeywordStrategyToken } from '@/lib/keyword-strategy-token'
import { mintKeywordMemoToken } from '@/lib/keyword-memo-token'
import { GET } from './route'

const ORIG_ENV = { ...process.env }
const TEST_SECRET = 'ks5pub-secret'
const PREFIX = 'ks5pub-'
let counter = 0
const clientIds: number[] = []
const sessionIds: string[] = []

async function makeClient(overrides: Record<string, unknown> = {}): Promise<number> {
  const c = await prisma.client.create({ data: { name: `${PREFIX}${Date.now()}-${counter++}`, ...overrides } })
  clientIds.push(c.id)
  return c.id
}

async function makeSession(clientId: number, overrides: Record<string, unknown> = {}): Promise<string> {
  const s = await prisma.keywordStrategySession.create({
    data: { clientId, tokenMintedAt: new Date(), volumeKeywordCap: 1500, ...overrides },
  })
  sessionIds.push(s.id)
  return s.id
}

async function mintScoped(sessionId: string, scopes: string[]): Promise<string> {
  const secret = new TextEncoder().encode(TEST_SECRET)
  const iat = Math.floor(Date.now() / 1000)
  const jwt = await new SignJWT({ scope: scopes })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('er-seo-tools')
    .setAudience('keyword-strategy-client')
    .setSubject(sessionId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(secret)
  return 'kst_' + jwt
}

function req(auth?: string) {
  const headers: Record<string, string> = {}
  if (auth) headers.authorization = auth
  return new NextRequest('http://localhost/api/keyword-strategy/x', { headers })
}
function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/keyword-strategy/[id]', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV, KEYWORD_MEMO_TOKEN_SECRET: TEST_SECRET, NODE_ENV: 'test' }
  })
  afterEach(async () => {
    await prisma.keywordStrategySession.deleteMany({ where: { id: { in: sessionIds } } })
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
    sessionIds.length = 0
    clientIds.length = 0
    process.env = { ...ORIG_ENV }
  })

  it('401 when no Authorization header', async () => {
    const res = await GET(req(), params('kss_x'))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('auth_missing')
  })

  it('401 when header is malformed (not a kst_ bearer)', async () => {
    const res = await GET(req('Bearer nope'), params('kss_x'))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('auth_malformed')
  })

  it('401 for a real legacy krt_ memo token', async () => {
    const { token } = await mintKeywordMemoToken('kss_x')
    const res = await GET(req(`Bearer ${token}`), params('kss_x'))
    expect(res.status).toBe(401)
  })

  it('401 for a wrong-sub token', async () => {
    const { token } = await mintKeywordStrategyToken('kss_other')
    const res = await GET(req(`Bearer ${token}`), params('kss_x'))
    expect(res.status).toBe(401)
  })

  it('401 for an expired token', async () => {
    const secret = new TextEncoder().encode(TEST_SECRET)
    const iat = Math.floor(Date.now() / 1000) - 7200
    const jwt = await new SignJWT({ scope: ['read'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('er-seo-tools')
      .setAudience('keyword-strategy-client')
      .setSubject('kss_x')
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(secret)
    const res = await GET(req(`Bearer kst_${jwt}`), params('kss_x'))
    // jose's expiry message is '"exp" claim timestamp check failed' (no
    // 'expired' substring), so the shared taxonomy maps it to token_invalid —
    // still a 401, matching the auth-matrix requirement.
    expect(res.status).toBe(401)
  })

  it('401 token_missing_scope when the token lacks read scope', async () => {
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const token = await mintScoped(id, ['memo-write', 'volume-lookup'])
    const res = await GET(req(`Bearer ${token}`), params(id))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('token_missing_scope')
  })

  it('404 when the session row is gone (token sub matches a nonexistent id)', async () => {
    const { token } = await mintKeywordStrategyToken('kss_ghost')
    const res = await GET(req(`Bearer ${token}`), params('kss_ghost'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('200 returns the export payload framing', async () => {
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const { token } = await mintKeywordStrategyToken(id)
    const res = await GET(req(`Bearer ${token}`), params(id))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(id)
    expect(body.clientId).toBe(clientId)
    expect(typeof body.generatedAt).toBe('string')
    expect(body.profile).toBeDefined()
    expect(body.volumeLookup.endpoint).toBe(`/api/keyword-strategy/${id}/volumes`)
  })
})
