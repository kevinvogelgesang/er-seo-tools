// Fix 3 (post-review, 2026-07-19): POST /api/viewbook/[token]/collapse is now
// PERMANENTLY 410 `collapse_local_only` for every caller — collapse is
// client-local (localStorage), and this dormant shared-write surface must
// never mutate SQLite again. The old success/operator-gate/throttle/content-
// type/token-validation assertions are gone; those behaviors no longer exist
// on this route (see the DORMANT banner in route.ts).
import crypto from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { POST } from './[token]/collapse/route'

const PREFIX = 'vb-test-collapse-route-'

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const created = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  await prisma.viewbook.update({ where: { id: created.id }, data: { stage: 'post-contract' } })
  const viewbook = await requireViewbookToken(created.token)
  return { client, viewbook, token: created.token }
}

function req(token: string, body: unknown = {}, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost/api/viewbook/${token}/collapse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const params = (token: string) => ({ params: Promise.resolve({ token }) })

describe('POST /api/viewbook/:token/collapse (Fix 3: permanently retired, 410)', () => {
  it('410s collapse_local_only for a real viewbook/token/section — no write, no syncVersion bump', async () => {
    const ctx = await mkViewbook()
    const before = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'brand' } },
    })
    const beforeSync = (await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })).syncVersion

    const res = await POST(req(ctx.token, { sectionKey: 'brand', collapsed: true }), params(ctx.token))
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('collapse_local_only')

    const after = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'brand' } },
    })
    expect(after.collapsedShared).toBe(before.collapsedShared)
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
    const afterSync = (await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })).syncVersion
    expect(afterSync).toBe(beforeSync)
  })

  it('410s regardless of token validity — an unknown/garbage token is never even resolved', async () => {
    const res = await POST(req('does-not-exist', { sectionKey: 'brand', collapsed: true }), params('does-not-exist'))
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('collapse_local_only')
  })

  it('410s regardless of body shape — malformed/missing JSON is never parsed', async () => {
    const ctx = await mkViewbook()
    const malformed = new Request(`http://localhost/api/viewbook/${ctx.token}/collapse`, {
      method: 'POST',
      body: 'not json',
    }) as unknown as NextRequest
    const res = await POST(malformed, params(ctx.token))
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('collapse_local_only')
  })

  it('410s regardless of content-type or same-site headers — no preflight runs before the short-circuit', async () => {
    const ctx = await mkViewbook()
    const res = await POST(
      req(ctx.token, { sectionKey: 'brand', collapsed: true }, {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      params(ctx.token),
    )
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('collapse_local_only')
  })

  it('never calls the dormant setSectionCollapsedShared write path — repeated hits stay a pure no-op', async () => {
    const ctx = await mkViewbook()
    for (let i = 0; i < 5; i++) {
      const res = await POST(req(ctx.token, { sectionKey: 'brand', collapsed: i % 2 === 0 }), params(ctx.token))
      expect(res.status).toBe(410)
    }
    const row = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'brand' } },
    })
    expect(row.collapsedShared).toBe(false) // never flipped by any of the 5 calls
  })
})
