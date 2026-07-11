// app/api/clients/[id]/keyword-strategy/route.test.ts
// DB-backed tests for the KS-5 poll route (Task 6). prisma is real against
// the local SQLite dev DB (house convention: prefix-named rows, cleaned in
// afterEach).
import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET } from './route'

const PREFIX = 'ks5poll-'
let counter = 0
const clientIds: number[] = []

async function makeClient(): Promise<number> {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${Date.now()}-${counter++}` } })
  clientIds.push(client.id)
  return client.id
}

function params(id: string | number) {
  return { params: Promise.resolve({ id: String(id) }) }
}

function req() {
  return new NextRequest('http://localhost/api/clients/1/keyword-strategy')
}

describe('GET /api/clients/[id]/keyword-strategy', () => {
  afterEach(async () => {
    await prisma.keywordStrategySession.deleteMany({ where: { clientId: { in: clientIds } } })
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } })
    clientIds.length = 0
  })

  it('400 invalid client id', async () => {
    for (const bad of ['abc', '01', '1abc', '0']) {
      const res = await GET(req(), params(bad))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_client_id')
    }
  })

  it('{ session: null } when the client has no sessions (including unknown clients)', async () => {
    const clientId = await makeClient()
    const res = await GET(req(), params(clientId))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ session: null })

    const unknown = await GET(req(), params(999999999))
    expect(unknown.status).toBe(200)
    expect(await unknown.json()).toEqual({ session: null })
  })

  it('returns the latest session by (createdAt desc, id desc), shaped { id, status, tokenMintedAt, memoMarkdown, memoUpdatedAt }', async () => {
    const clientId = await makeClient()
    const now = Date.now()
    const older = await prisma.keywordStrategySession.create({
      data: {
        clientId, status: 'complete', tokenMintedAt: new Date(now - 10_000), volumeKeywordCap: 1500,
        createdAt: new Date(now - 10_000),
      },
    })
    const newer = await prisma.keywordStrategySession.create({
      data: {
        clientId, status: 'processing', tokenMintedAt: new Date(now), volumeKeywordCap: 1500,
        createdAt: new Date(now),
      },
    })
    expect(older.id).not.toBe(newer.id)

    const res = await GET(req(), params(clientId))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.id).toBe(newer.id)
    expect(body.session.status).toBe('processing')
    expect(typeof body.session.tokenMintedAt).toBe('string')
    expect(body.session.memoMarkdown).toBeNull()
    expect(body.session.memoUpdatedAt).toBeNull()
    expect(Object.keys(body.session).sort()).toEqual(
      ['id', 'memoMarkdown', 'memoUpdatedAt', 'status', 'tokenMintedAt'].sort(),
    )
  })
})
