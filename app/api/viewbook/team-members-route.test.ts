import crypto from 'crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { resetWriteThrottleForTests } from '@/lib/viewbook/public-write-guard'
import { POST } from './[token]/team-members/route'

vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(async () => ({ id: 'mock-job', deduped: false })) }
})

const PREFIX = 'vb-test-team-route-'

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

async function seedMembers(viewbookId: number, count: number) {
  for (let i = 0; i < count; i++) {
    await prisma.viewbookTeamMember.create({
      data: {
        viewbookId,
        memberKey: crypto.randomUUID(),
        name: `Seed ${i}`,
        email: `seed-${i}-${crypto.randomUUID()}@example.com`,
        addedBy: 'client',
      },
    })
  }
}

function mutationId() {
  return crypto.randomUUID()
}

function req(token: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost/api/viewbook/${token}/team-members`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const params = (token: string) => ({ params: Promise.resolve({ token }) })

describe('POST /api/viewbook/:token/team-members', () => {
  it('creates a member (201) and replays idempotently (200)', async () => {
    const ctx = await mkViewbook()
    const id = mutationId()
    const created = await POST(
      req(ctx.token, { mode: 'create', name: 'Alex', email: 'alex@example.com', clientMutationId: id }),
      params(ctx.token),
    )
    expect(created.status).toBe(201)
    expect(created.headers.get('cache-control')).toBe('no-store')
    const body = await created.json()
    expect(body.member.email).toBe('alex@example.com')
    expect(body.delivered).toBe(true)

    const replay = await POST(
      req(ctx.token, { mode: 'create', name: 'Alex', email: 'alex@example.com', clientMutationId: id }),
      params(ctx.token),
    )
    expect(replay.status).toBe(200)
    expect((await replay.json()).member.id).toBe(body.member.id)
  })

  it('resends an invite for an existing member (200, delivered)', async () => {
    const ctx = await mkViewbook()
    const created = await POST(
      req(ctx.token, { mode: 'create', name: 'Alex', email: 'alex2@example.com', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    const memberId = (await created.json()).member.id
    const resend = await POST(req(ctx.token, { mode: 'resend', memberId }), params(ctx.token))
    expect(resend.status).toBe(200)
    expect(resend.headers.get('cache-control')).toBe('no-store')
    expect((await resend.json()).delivered).toBe(true)
  })

  it('400s on an unknown mode', async () => {
    const ctx = await mkViewbook()
    const res = await POST(req(ctx.token, { mode: 'delete', memberId: 1 }), params(ctx.token))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_mode')
  })

  it('415s on non-JSON content-type', async () => {
    const ctx = await mkViewbook()
    const res = await POST(
      new Request(`http://localhost/api/viewbook/${ctx.token}/team-members`, { method: 'POST', body: '{}' }) as unknown as NextRequest,
      params(ctx.token),
    )
    expect(res.status).toBe(415)
  })

  it('403s on a cross-site request', async () => {
    const ctx = await mkViewbook()
    const res = await POST(
      req(ctx.token, { mode: 'create', name: 'Alex', email: 'alex3@example.com', clientMutationId: mutationId() }, {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      params(ctx.token),
    )
    expect(res.status).toBe(403)
  })

  it('404s on an unknown token and a revoked viewbook', async () => {
    const unknown = await POST(
      req('does-not-exist', { mode: 'create', name: 'Alex', email: 'alex4@example.com', clientMutationId: mutationId() }),
      params('does-not-exist'),
    )
    expect(unknown.status).toBe(404)

    const ctx = await mkViewbook()
    await prisma.viewbook.update({ where: { id: ctx.viewbook.id }, data: { revokedAt: new Date() } })
    const revoked = await POST(
      req(ctx.token, { mode: 'create', name: 'Alex', email: 'alex5@example.com', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(revoked.status).toBe(404)
  })

  it('413s over the 4KB body cap', async () => {
    const ctx = await mkViewbook()
    const res = await POST(
      req(ctx.token, {
        mode: 'create', name: 'Alex', email: 'alex6@example.com', clientMutationId: mutationId(), pad: 'x'.repeat(5000),
      }),
      params(ctx.token),
    )
    expect(res.status).toBe(413)
  })

  it('400s on invalid create body (bad email, missing name)', async () => {
    const ctx = await mkViewbook()
    const badEmail = await POST(
      req(ctx.token, { mode: 'create', name: 'Alex', email: 'not-an-email', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(badEmail.status).toBe(400)
    expect((await badEmail.json()).error).toBe('invalid_email')

    const missingName = await POST(
      req(ctx.token, { mode: 'create', email: 'alex7@example.com', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(missingName.status).toBe(400)
    expect((await missingName.json()).error).toBe('invalid_name')
  })

  it('maps duplicate_email to 409', async () => {
    const ctx = await mkViewbook()
    await POST(
      req(ctx.token, { mode: 'create', name: 'Alex', email: 'dup@example.com', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    const dup = await POST(
      req(ctx.token, { mode: 'create', name: 'Someone Else', email: 'dup@example.com', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(dup.status).toBe(409)
    expect((await dup.json()).error).toBe('duplicate_email')
  })

  it('maps team_member_limit_reached to 409 at the 15-member cap', async () => {
    const ctx = await mkViewbook()
    await seedMembers(ctx.viewbook.id, 15)
    const res = await POST(
      req(ctx.token, { mode: 'create', name: 'Overflow', email: 'overflow@example.com', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('team_member_limit_reached')
  })

  it('maps resend_limit_reached to 409 after 3 sends', async () => {
    const ctx = await mkViewbook()
    const created = await POST(
      req(ctx.token, { mode: 'create', name: 'Alex', email: 'resend-cap@example.com', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    const memberId = (await created.json()).member.id
    // 1 send already happened on create; 2 more resends reach the 3-send cap.
    for (let i = 0; i < 2; i++) {
      const res = await POST(req(ctx.token, { mode: 'resend', memberId }), params(ctx.token))
      expect(res.status).toBe(200)
    }
    const capped = await POST(req(ctx.token, { mode: 'resend', memberId }), params(ctx.token))
    expect(capped.status).toBe(409)
    expect((await capped.json()).error).toBe('resend_limit_reached')
  })

  it('429s after exceeding the per-token write-throttle window', async () => {
    const ctx = await mkViewbook()
    await seedMembers(ctx.viewbook.id, 5)
    for (let i = 0; i < 10; i++) {
      const res = await POST(req(ctx.token, { mode: 'resend', memberId: -1 }), params(ctx.token))
      // memberId -1 always 404s (not found) — throttle counts the attempt regardless.
      expect(res.status).toBe(404)
    }
    const limited = await POST(req(ctx.token, { mode: 'resend', memberId: -1 }), params(ctx.token))
    expect(limited.status).toBe(429)
  })
})
