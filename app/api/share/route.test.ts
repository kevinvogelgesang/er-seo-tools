// A3 Phase 1 characterization test — pins CURRENT behavior of the public
// share-mint route (POST /api/share). No auth; DB-backed with real prisma.
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { POST } from './route'

const PREFIX = '__a3share__'

function jsonReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function rawReq(rawBody: string): NextRequest {
  return new NextRequest('http://localhost/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  })
}

async function makeSession(idSuffix: string, opts: { status?: string; result?: string | null } = {}) {
  // Session.id must be a valid uuid (isValidSessionId gate on the route), so
  // the fixture prefix rides on siteName instead of the id.
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

async function clear(sessionIds: string[]) {
  if (sessionIds.length === 0) return
  await prisma.shareLink.deleteMany({ where: { sessionId: { in: sessionIds } } })
  await prisma.session.deleteMany({ where: { id: { in: sessionIds } } })
}

const createdSessionIds: string[] = []

beforeEach(async () => {
  await clear(createdSessionIds)
  createdSessionIds.length = 0
})

afterAll(async () => {
  await clear(createdSessionIds)
})

describe('POST /api/share', () => {
  it('400 Invalid JSON body on malformed JSON', async () => {
    const res = await POST(rawReq('{not json'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON body')
  })

  it('400 Invalid or missing sessionId when sessionId is missing', async () => {
    const res = await POST(jsonReq({}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid or missing sessionId')
  })

  it('400 Invalid or missing sessionId when sessionId is not a valid uuid', async () => {
    const res = await POST(jsonReq({ sessionId: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid or missing sessionId')
  })

  it('404 Session not found for a well-formed but unknown sessionId', async () => {
    const res = await POST(jsonReq({ sessionId: randomUUID() }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Session not found')
  })

  it('400 Session is not complete for a pending session', async () => {
    const sessionId = await makeSession('pending', { status: 'pending', result: null })
    createdSessionIds.push(sessionId)

    const res = await POST(jsonReq({ sessionId }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Session is not complete')
  })

  it('200 mints a token, persists a ShareLink row, and returns { token, shareUrl, expiresAt }', async () => {
    const sessionId = await makeSession('ok')
    createdSessionIds.push(sessionId)

    const res = await POST(jsonReq({ sessionId }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(0)
    expect(body.shareUrl).toContain(`/share/${body.token}`)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const row = await prisma.shareLink.findUnique({ where: { token: body.token } })
    expect(row).not.toBeNull()
    expect(row?.sessionId).toBe(sessionId)
  })
})
