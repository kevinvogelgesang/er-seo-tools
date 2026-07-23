import crypto from 'crypto'
import { afterAll, beforeEach, describe, expect, it, vi, beforeAll } from 'vitest'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { resetWriteThrottleForTests } from '@/lib/viewbook/public-write-guard'
import { POST } from './[token]/ack/route'
import { ensureSeededTemplates } from '@/lib/viewbook/__fixtures__/instance-test-helpers'

// F2 (Task 3): createViewbook snapshots from the template library — seed it
// once per file (idempotent; an earlier file in this worker may have wiped it).
beforeAll(async () => {
  await ensureSeededTemplates()
})

// Emails enqueue via a real durable Job row (fire-and-forget) — mock the
// queue so route tests never depend on the job worker (ack.test.ts precedent).
vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(async () => ({ id: 'mock-job', deduped: false })) }
})

const PREFIX = 'vb-test-ack-route-'

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

function mutationId() {
  return crypto.randomUUID()
}

function req(token: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost/api/viewbook/${token}/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const params = (token: string) => ({ params: Promise.resolve({ token }) })

describe('POST /api/viewbook/:token/ack', () => {
  it('acknowledges a section (201, no-store) and replays idempotently (200)', async () => {
    const ctx = await mkViewbook()
    const created = await POST(
      req(ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(created.status).toBe(201)
    expect(created.headers.get('cache-control')).toBe('no-store')
    const body = await created.json()
    expect(body.acknowledged.sectionKey).toBe('pc-setup')
    expect(body.pcCompleted).toBe(false)

    const replay = await POST(
      req(ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(replay.status).toBe(200)
    expect(replay.headers.get('cache-control')).toBe('no-store')
    expect((await replay.json()).acknowledged.sectionKey).toBe('pc-setup')
  })

  it('signals completion via the 201 status, not the pcCompleted field alone', async () => {
    const ctx = await mkViewbook()
    await POST(req(ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }), params(ctx.token))
    await POST(req(ctx.token, { sectionKey: 'pc-invite', clientMutationId: mutationId() }), params(ctx.token))
    const last = await POST(
      req(ctx.token, { sectionKey: 'data-source', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(last.status).toBe(201)
    expect((await last.json()).pcCompleted).toBe(true)

    // Replaying the completing ack still reports pcCompleted:true (honest,
    // per-core), but the status is 200 — callers must treat only 201 as the
    // "just completed" event.
    const replay = await POST(
      req(ctx.token, { sectionKey: 'data-source', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(replay.status).toBe(200)
    expect((await replay.json()).pcCompleted).toBe(true)
  })

  it('415s on non-JSON content-type', async () => {
    const ctx = await mkViewbook()
    const res = await POST(
      new Request(`http://localhost/api/viewbook/${ctx.token}/ack`, { method: 'POST', body: '{}' }) as unknown as NextRequest,
      params(ctx.token),
    )
    expect(res.status).toBe(415)
  })

  it('403s on a cross-site request', async () => {
    const ctx = await mkViewbook()
    const res = await POST(
      req(ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }, {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      params(ctx.token),
    )
    expect(res.status).toBe(403)
  })

  it('404s on an unknown token and a revoked viewbook', async () => {
    const unknown = await POST(
      req('does-not-exist', { sectionKey: 'pc-setup', clientMutationId: mutationId() }),
      params('does-not-exist'),
    )
    expect(unknown.status).toBe(404)

    const ctx = await mkViewbook()
    await prisma.viewbook.update({ where: { id: ctx.viewbook.id }, data: { revokedAt: new Date() } })
    const revoked = await POST(
      req(ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(revoked.status).toBe(404)
  })

  it('413s over the 2KB body cap', async () => {
    const ctx = await mkViewbook()
    const res = await POST(
      req(ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId(), pad: 'x'.repeat(3000) }),
      params(ctx.token),
    )
    expect(res.status).toBe(413)
  })

  it('400s on an invalid body: missing sectionKey and a non-ackable sectionKey', async () => {
    const ctx = await mkViewbook()
    const missing = await POST(req(ctx.token, { clientMutationId: mutationId() }), params(ctx.token))
    expect(missing.status).toBe(400)

    const notAckable = await POST(
      req(ctx.token, { sectionKey: 'welcome', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(notAckable.status).toBe(400)
    expect((await notAckable.json()).error).toBe('invalid_section')
  })

  it('429s after exceeding the per-token write-throttle window', async () => {
    const ctx = await mkViewbook()
    for (let i = 0; i < 10; i++) {
      const res = await POST(
        req(ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }),
        params(ctx.token),
      )
      expect(res.status).toBeLessThan(400)
    }
    const limited = await POST(
      req(ctx.token, { sectionKey: 'pc-setup', clientMutationId: mutationId() }),
      params(ctx.token),
    )
    expect(limited.status).toBe(429)
  })
})
