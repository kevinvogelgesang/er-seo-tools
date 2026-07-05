// A3 Phase 1 characterization test — pins CURRENT behavior of the public
// share-read route (GET /api/share/[token]). No auth; DB-backed with real
// prisma. Do NOT assert accessCount — it's a void fire-and-forget update
// (lib/ada-audit route reads race a re-read).
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './route'

const PREFIX = '__a3share__'

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) }
}

function makeRequest(token: string) {
  return new NextRequest(`http://localhost/api/share/${token}`)
}

async function makeSession(idSuffix: string, opts: { status?: string; result?: string | null } = {}) {
  const sessionId = randomUUID()
  await prisma.session.create({
    data: {
      id: sessionId,
      files: '[]',
      status: opts.status ?? 'complete',
      result: opts.result === undefined ? JSON.stringify({ issues: { critical: [], warnings: [], notices: [] } }) : opts.result,
      siteName: `${PREFIX}${idSuffix}.example.com`,
      workflow: 'technical',
    },
  })
  return sessionId
}

async function makeShareLink(sessionId: string, opts: { expiresAt?: Date } = {}) {
  const token = `${PREFIX}${randomUUID()}`
  await prisma.shareLink.create({
    data: {
      sessionId,
      token,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })
  return token
}

const createdSessionIds: string[] = []

async function clear(sessionIds: string[]) {
  if (sessionIds.length === 0) return
  await prisma.shareLink.deleteMany({ where: { sessionId: { in: sessionIds } } })
  await prisma.session.deleteMany({ where: { id: { in: sessionIds } } })
}

beforeEach(async () => {
  await clear(createdSessionIds)
  createdSessionIds.length = 0
})

afterAll(async () => {
  await clear(createdSessionIds)
})

describe('GET /api/share/[token]', () => {
  it('400 Invalid token for an empty token param', async () => {
    const res = await GET(makeRequest(''), makeParams(''))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid token')
  })

  it('404 Share link not found for an unknown token', async () => {
    const token = `${PREFIX}unknown-token`
    const res = await GET(makeRequest(token), makeParams(token))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Share link not found')
  })

  it('410 Share link has expired for an expired ShareLink', async () => {
    const sessionId = await makeSession('expired')
    createdSessionIds.push(sessionId)
    const token = await makeShareLink(sessionId, { expiresAt: new Date(Date.now() - 60 * 60 * 1000) })

    const res = await GET(makeRequest(token), makeParams(token))
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('Share link has expired')
  })

  it('400 when the session is not complete', async () => {
    const sessionId = await makeSession('pending', { status: 'pending', result: null })
    createdSessionIds.push(sessionId)
    const token = await makeShareLink(sessionId)

    const res = await GET(makeRequest(token), makeParams(token))
    expect(res.status).toBe(400)
  })

  it('200 returns { result, expiresAt, sessionId, siteName } for a valid, non-expired, complete session', async () => {
    const sessionId = await makeSession('ok')
    createdSessionIds.push(sessionId)
    const token = await makeShareLink(sessionId)

    const res = await GET(makeRequest(token), makeParams(token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toEqual({ issues: { critical: [], warnings: [], notices: [] } })
    expect(body.sessionId).toBe(sessionId)
    expect(body.siteName).toBe(`${PREFIX}ok.example.com`)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })
})
