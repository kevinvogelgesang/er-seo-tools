// app/api/keyword-strategy/[id]/memo/route.test.ts
// KS-5 Task 7 — public token-authed memo PATCH. Body validated BEFORE auth
// (400 beats 401). DB-backed; real token verification.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { mintKeywordStrategyToken } from '@/lib/keyword-strategy-token'
import { mintKeywordMemoToken } from '@/lib/keyword-memo-token'
import { PATCH } from './route'

const ORIG_ENV = { ...process.env }
const TEST_SECRET = 'ks5pub-secret'
const PREFIX = 'ks5pub-'
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

function req(id: string, body: unknown, auth?: string, raw?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth) headers.authorization = auth
  return new NextRequest(`http://localhost/api/keyword-strategy/${id}/memo`, {
    method: 'PATCH',
    headers,
    body: raw !== undefined ? raw : JSON.stringify(body),
  })
}
function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('PATCH /api/keyword-strategy/[id]/memo', () => {
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

  it('400 invalid_json even with NO auth header (body before auth)', async () => {
    const res = await PATCH(req('kss_x', null, undefined, 'not json{'), params('kss_x'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('400 memo_required when memo missing/empty (before auth)', async () => {
    const res = await PATCH(req('kss_x', { memo: '' }), params('kss_x'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('memo_required')
  })

  it('400 memo_too_long over 50k', async () => {
    const res = await PATCH(req('kss_x', { memo: 'a'.repeat(50_001) }), params('kss_x'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('memo_too_long')
  })

  it('400 structured_invalid for a primitive', async () => {
    const res = await PATCH(req('kss_x', { memo: 'ok', structured: 'a string' }), params('kss_x'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('structured_invalid')
  })

  it('400 structured_too_long over 200k', async () => {
    const big = { blob: 'a'.repeat(200_001) }
    const res = await PATCH(req('kss_x', { memo: 'ok', structured: big }), params('kss_x'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('structured_too_long')
  })

  it('401 for a real legacy krt_ memo token', async () => {
    const { token } = await mintKeywordMemoToken('kss_x')
    const res = await PATCH(req('kss_x', { memo: 'ok' }, `Bearer ${token}`), params('kss_x'))
    expect(res.status).toBe(401)
  })

  it('401 token_missing_scope without memo-write', async () => {
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const token = await mintScoped(id, ['read', 'volume-lookup'])
    const res = await PATCH(req(id, { memo: 'ok' }, `Bearer ${token}`), params(id))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('token_missing_scope')
  })

  it('404 when session row is gone', async () => {
    const { token } = await mintKeywordStrategyToken('kss_ghost')
    const res = await PATCH(req('kss_ghost', { memo: 'ok' }, `Bearer ${token}`), params('kss_ghost'))
    expect(res.status).toBe(404)
  })

  it('200 stores memo + structured, flips status:complete, stamps memoUpdatedAt', async () => {
    const clientId = await makeClient()
    const id = await makeSession(clientId)
    const { token } = await mintKeywordStrategyToken(id)
    const res = await PATCH(
      req(id, { memo: '# Strategy', structured: { sections: [1, 2] } }, `Bearer ${token}`),
      params(id),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.updatedAt).toBe('string')

    const row = await prisma.keywordStrategySession.findUniqueOrThrow({ where: { id } })
    expect(row.memoMarkdown).toBe('# Strategy')
    expect(row.structured).toBe(JSON.stringify({ sections: [1, 2] }))
    expect(row.status).toBe('complete')
    expect(row.memoUpdatedAt).toBeInstanceOf(Date)
  })
})
