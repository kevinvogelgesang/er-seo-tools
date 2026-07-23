import { afterAll, beforeEach, describe, expect, it, beforeAll } from 'vitest'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { resetWriteThrottleForTests } from '@/lib/viewbook/public-write-guard'
import { GET } from './[token]/sync/route'
import { PATCH as patchAnswers } from './[token]/answers/route'
import { ensureSeededTemplates } from '@/lib/viewbook/__fixtures__/instance-test-helpers'

// F2 (Task 3): createViewbook snapshots from the template library — seed it
// once per file (idempotent; an earlier file in this worker may have wiped it).
beforeAll(async () => {
  await ensureSeededTemplates()
})

beforeEach(resetWriteThrottleForTests)
afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-sync-route-' } } })
})

function req(token: string): NextRequest {
  return new Request(`http://localhost/api/viewbook/${token}/sync`) as unknown as NextRequest
}

function patchReq(token: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/viewbook/${token}/answers`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const params = (token: string) => ({ params: Promise.resolve({ token }) })

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-test-sync-route-${crypto.randomUUID()}` } })
  const viewbook = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  const field = await prisma.viewbookField.findFirstOrThrow({
    where: { viewbookId: viewbook.id, fieldType: 'text' },
  })
  return { ...viewbook, field }
}

describe('GET /api/viewbook/:token/sync', () => {
  it('returns the current syncVersion with no-store', async () => {
    const ctx = await mkViewbook()
    const res = await GET(req(ctx.token), params(ctx.token))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ v: expect.any(Number) })
  })

  it('404s an invalid token', async () => {
    const res = await GET(req('nope'), params('nope'))
    expect(res.status).toBe(404)
  })

  it('404s a revoked token', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbook.update({ where: { id: ctx.id }, data: { revokedAt: new Date() } })
    const res = await GET(req(ctx.token), params(ctx.token))
    expect(res.status).toBe(404)
  })

  it('reflects a bump after a real write (+1 relative)', async () => {
    const ctx = await mkViewbook()
    const before = await (await GET(req(ctx.token), params(ctx.token))).json()

    const edit = await patchAnswers(
      patchReq(ctx.token, {
        mode: 'edit', fieldId: ctx.field.id, value: 'Bumped', expectedVersion: 0,
      }),
      params(ctx.token),
    )
    expect(edit.status).toBe(200)

    const after = await (await GET(req(ctx.token), params(ctx.token))).json()
    expect(after.v).toBe(before.v + 1)
  })
})
