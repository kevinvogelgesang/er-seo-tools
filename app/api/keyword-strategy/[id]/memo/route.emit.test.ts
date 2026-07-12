// app/api/keyword-strategy/[id]/memo/route.emit.test.ts
//
// A5 Task 24: KeywordStrategyCard subscribes to memo:<KeywordStrategySession.id>
// — unlike SeoRoadmap/KeywordResearchSession, this model has NO separate
// sessionId FK to a parser Session; its OWN id (the "strategyId" minted by
// POST .../mint-token and re-subscribed on every regenerate) is the identity
// the card polls/tracks by. So the emit uses the route's own `id` param
// directly — no row lookup needed. DB-backed (real prisma), matching
// route.test.ts's existing convention for this route.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { PATCH } from './route'

vi.mock('@/lib/events/bus', () => ({ publishInvalidation: vi.fn() }))
import { publishInvalidation } from '@/lib/events/bus'
import { memoTopic } from '@/lib/events/topics'

const ORIG_ENV = { ...process.env }
const TEST_SECRET = 'ks5emit-secret'
const PREFIX = 'ks5emit-'
let counter = 0
const clientIds: number[] = []
const sessionIds: string[] = []

async function makeClient(): Promise<number> {
  const c = await prisma.client.create({ data: { name: `${PREFIX}${Date.now()}-${counter++}` } })
  clientIds.push(c.id)
  return c.id
}
async function makeSession(clientId: number): Promise<string> {
  const s = await prisma.keywordStrategySession.create({
    data: { clientId, tokenMintedAt: new Date(), volumeKeywordCap: 1500 },
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

function req(id: string, body: unknown, auth?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth) headers.authorization = auth
  return new NextRequest(`http://localhost/api/keyword-strategy/${id}/memo`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
}
function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('PATCH /api/keyword-strategy/[id]/memo — SSE emit (A5 Task 24)', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV, KEYWORD_MEMO_TOKEN_SECRET: TEST_SECRET, NODE_ENV: 'test' }
    vi.mocked(publishInvalidation).mockClear()
  })
  afterEach(async () => {
    process.env = { ...ORIG_ENV }
    if (sessionIds.length) await prisma.keywordStrategySession.deleteMany({ where: { id: { in: sessionIds } } })
    if (clientIds.length) await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
    sessionIds.length = 0
    clientIds.length = 0
  })

  it('emits memo:<id> using the route\'s own id (this model has no separate sessionId)', async () => {
    const clientId = await makeClient()
    const sessionId = await makeSession(clientId)
    const token = await mintScoped(sessionId, ['memo-write'])

    const res = await PATCH(req(sessionId, { memo: '# Strategy' }, `Bearer ${token}`), params(sessionId))

    expect(res.status).toBe(200)
    expect(publishInvalidation).toHaveBeenCalledWith(memoTopic(sessionId))
  })

  it('does not emit when the session row does not exist (404, no write)', async () => {
    const missingId = 'does-not-exist'
    const token = await mintScoped(missingId, ['memo-write'])

    const res = await PATCH(req(missingId, { memo: '# Strategy' }, `Bearer ${token}`), params(missingId))

    expect(res.status).toBe(404)
    expect(publishInvalidation).not.toHaveBeenCalled()
  })
})
