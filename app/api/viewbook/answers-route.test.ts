import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { lockViewbook } from '@/lib/viewbook/answers'
import { resetWriteThrottleForTests } from '@/lib/viewbook/public-write-guard'
import { PATCH } from './[token]/answers/route'

beforeEach(resetWriteThrottleForTests)
afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-pr3-route-' } } })
})

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-test-pr3-route-${crypto.randomUUID()}` } })
  const viewbook = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  const field = await prisma.viewbookField.findFirstOrThrow({
    where: { viewbookId: viewbook.id, fieldType: 'text' },
  })
  return { ...viewbook, field }
}

function req(token: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost/api/viewbook/${token}/answers`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const params = (token: string) => ({ params: Promise.resolve({ token }) })

describe('PATCH /api/viewbook/:token/answers', () => {
  it('uses the public guard chain and rejects unknown modes', async () => {
    const ctx = await mkViewbook()
    const noType = await PATCH(new Request(`http://localhost/api/viewbook/${ctx.token}/answers`, {
      method: 'PATCH', body: '{}',
    }) as unknown as NextRequest, params(ctx.token))
    expect(noType.status).toBe(415)
    const cross = await PATCH(req(ctx.token, {}, {
      origin: 'https://evil.example', 'sec-fetch-site': 'cross-site',
    }), params(ctx.token))
    expect(cross.status).toBe(403)
    const badMode = await PATCH(req(ctx.token, { mode: 'surprise' }), params(ctx.token))
    expect(badMode.status).toBe(400)
    expect(badMode.headers.get('cache-control')).toBe('no-store')
  })

  it('edits and returns stale current truth with no-store', async () => {
    const ctx = await mkViewbook()
    const edited = await PATCH(req(ctx.token, {
      mode: 'edit', fieldId: ctx.field.id, value: 'Saved', expectedVersion: 0,
    }), params(ctx.token))
    expect(edited.status).toBe(200)
    expect(edited.headers.get('cache-control')).toBe('no-store')
    expect((await edited.json()).field).toMatchObject({ id: ctx.field.id, value: 'Saved', version: 1 })

    const stale = await PATCH(req(ctx.token, {
      mode: 'edit', fieldId: ctx.field.id, value: 'Stale overwrite', expectedVersion: 0,
    }), params(ctx.token))
    expect(stale.status).toBe(409)
    expect(stale.headers.get('cache-control')).toBe('no-store')
    expect(await stale.json()).toEqual({ error: 'stale_version', current: { value: 'Saved', version: 1 } })
  })

  it('creates an explicit amendment and replays it with 200', async () => {
    const ctx = await mkViewbook()
    await lockViewbook(ctx.id, 'operator@example.com')
    const body = {
      mode: 'amend', fieldId: ctx.field.id, value: 'Please update', clientMutationId: crypto.randomUUID(),
    }
    const created = await PATCH(req(ctx.token, body), params(ctx.token))
    expect(created.status).toBe(201)
    const first = await created.json()
    const replay = await PATCH(req(ctx.token, body), params(ctx.token))
    expect(replay.status).toBe(200)
    expect((await replay.json()).amendment.id).toBe(first.amendment.id)
  })
})
