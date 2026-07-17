import crypto from 'crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { resetWriteThrottleForTests } from '@/lib/viewbook/public-write-guard'
import { PATCH } from './[token]/setup/route'

const PREFIX = 'vb-test-setup-route-'

beforeEach(resetWriteThrottleForTests)
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

async function addMember(viewbookId: number, email: string) {
  await prisma.viewbookTeamMember.create({
    data: { viewbookId, memberKey: crypto.randomUUID(), name: 'Member', email, addedBy: 'client' },
  })
}

function mutationId() {
  return crypto.randomUUID()
}

function req(token: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost/api/viewbook/${token}/setup`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const params = (token: string) => ({ params: Promise.resolve({ token }) })

describe('PATCH /api/viewbook/:token/setup', () => {
  it('persists a valid notify-emails list (200, no-store)', async () => {
    const ctx = await mkViewbook()
    await addMember(ctx.viewbook.id, 'member@example.com')
    const res = await PATCH(
      req(ctx.token, { notifyEmails: ['member@example.com'], clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.json()).notifyEmails).toEqual(['member@example.com'])
  })

  it('415s on non-JSON content-type', async () => {
    const ctx = await mkViewbook()
    const res = await PATCH(
      new Request(`http://localhost/api/viewbook/${ctx.token}/setup`, { method: 'PATCH', body: '{}' }) as unknown as NextRequest,
      params(ctx.token),
    )
    expect(res.status).toBe(415)
  })

  it('403s on a cross-site request', async () => {
    const ctx = await mkViewbook()
    const res = await PATCH(
      req(ctx.token, { notifyEmails: [] }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
      params(ctx.token),
    )
    expect(res.status).toBe(403)
  })

  it('404s on an unknown token and a revoked viewbook', async () => {
    const unknown = await PATCH(req('does-not-exist', { notifyEmails: [] }), params('does-not-exist'))
    expect(unknown.status).toBe(404)

    const ctx = await mkViewbook()
    await prisma.viewbook.update({ where: { id: ctx.viewbook.id }, data: { revokedAt: new Date() } })
    const revoked = await PATCH(req(ctx.token, { notifyEmails: [] }), params(ctx.token))
    expect(revoked.status).toBe(404)
  })

  it('413s over the 4KB body cap', async () => {
    const ctx = await mkViewbook()
    const res = await PATCH(
      req(ctx.token, { notifyEmails: [], clientMutationId: mutationId(), pad: 'x'.repeat(5000) }),
      params(ctx.token),
    )
    expect(res.status).toBe(413)
  })

  it('400s on an address not already known to the viewbook', async () => {
    const ctx = await mkViewbook()
    const res = await PATCH(req(ctx.token, { notifyEmails: ['stranger@example.com'] }), params(ctx.token))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_notify_recipient')
  })

  it('400s on a malformed clientMutationId (shape guard, though advisory-only)', async () => {
    const ctx = await mkViewbook()
    const res = await PATCH(
      req(ctx.token, { notifyEmails: [], clientMutationId: 'not-a-uuid' }),
      params(ctx.token),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_client_mutation_id')
  })

  it('429s after exceeding the per-token write-throttle window', async () => {
    const ctx = await mkViewbook()
    for (let i = 0; i < 10; i++) {
      const res = await PATCH(req(ctx.token, { notifyEmails: [] }), params(ctx.token))
      expect(res.status).toBeLessThan(400)
    }
    const limited = await PATCH(req(ctx.token, { notifyEmails: [] }), params(ctx.token))
    expect(limited.status).toBe(429)
  })
})
