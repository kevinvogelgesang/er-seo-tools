import crypto from 'crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { acknowledgeSection } from '@/lib/viewbook/ack'
import { DELETE as deleteAck } from './[id]/ack/[sectionKey]/route'

// acknowledgeSection (test setup) enqueues pc-complete/team-invite emails via
// a real durable Job row — mock the queue (ack.test.ts precedent) so this
// route-focused suite never depends on the job worker.
vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jobs/queue')>()
  return { ...actual, enqueueJob: vi.fn(async () => ({ id: 'mock-job', deduped: false })) }
})

let cookie: string
const savedEnv: Record<string, string | undefined> = {}
const PREFIX = 'vb-test-ack-reset-route-'

beforeAll(async () => {
  for (const key of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET']) savedEnv[key] = process.env[key]
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  cookie = `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({
    sub: 'google:ackreset', email: 'operator@example.com', hd: 'example.com', name: 'Operator',
  })}`
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

function req(path: string, init: RequestInit & { auth?: boolean } = {}): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) headers.set('cookie', cookie)
  return new Request(`http://localhost${path}`, { ...init, headers }) as unknown as NextRequest
}

const params = (value: Record<string, string>) => ({ params: Promise.resolve(value) })

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const created = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  await prisma.viewbook.update({ where: { id: created.id }, data: { stage: 'post-contract' } })
  const viewbook = await requireViewbookToken(created.token)
  return { client, viewbook, token: created.token }
}

describe('DELETE /api/viewbooks/:id/ack/:sectionKey', () => {
  it('401s without an operator session', async () => {
    const ctx = await mkViewbook()
    const res = await deleteAck(
      req(`/api/viewbooks/${ctx.viewbook.id}/ack/pc-setup`, { method: 'DELETE', auth: false }),
      params({ id: String(ctx.viewbook.id), sectionKey: 'pc-setup' }),
    )
    expect(res.status).toBe(401)
  })

  it('clears acknowledgedAt so the client can re-ack, and is idempotent', async () => {
    const ctx = await mkViewbook()
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: crypto.randomUUID() })
    const acked = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'pc-setup' } },
    })
    expect(acked.acknowledgedAt).not.toBeNull()

    const res = await deleteAck(
      req(`/api/viewbooks/${ctx.viewbook.id}/ack/pc-setup`, { method: 'DELETE' }),
      params({ id: String(ctx.viewbook.id), sectionKey: 'pc-setup' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const reset = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'pc-setup' } },
    })
    expect(reset.acknowledgedAt).toBeNull()

    // Idempotent — resetting an already-unacked section is a harmless no-op, still 200.
    const again = await deleteAck(
      req(`/api/viewbooks/${ctx.viewbook.id}/ack/pc-setup`, { method: 'DELETE' }),
      params({ id: String(ctx.viewbook.id), sectionKey: 'pc-setup' }),
    )
    expect(again.status).toBe(200)
  })

  it('never clears pcCompletedAt (thank-you state is one-way)', async () => {
    const ctx = await mkViewbook()
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-setup', clientMutationId: crypto.randomUUID() })
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'pc-invite', clientMutationId: crypto.randomUUID() })
    await acknowledgeSection(ctx.viewbook, ctx.token, { sectionKey: 'data-source', clientMutationId: crypto.randomUUID() })
    const completed = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(completed.pcCompletedAt).not.toBeNull()

    await deleteAck(
      req(`/api/viewbooks/${ctx.viewbook.id}/ack/pc-setup`, { method: 'DELETE' }),
      params({ id: String(ctx.viewbook.id), sectionKey: 'pc-setup' }),
    )
    const stillCompleted = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })
    expect(stillCompleted.pcCompletedAt).toEqual(completed.pcCompletedAt)
  })

  it('400s on a non-ackable sectionKey', async () => {
    const ctx = await mkViewbook()
    const res = await deleteAck(
      req(`/api/viewbooks/${ctx.viewbook.id}/ack/welcome`, { method: 'DELETE' }),
      params({ id: String(ctx.viewbook.id), sectionKey: 'welcome' }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_section')
  })

  it('404s on a malformed id (indistinguishable-404 parseId)', async () => {
    const res = await deleteAck(
      req(`/api/viewbooks/not-a-number/ack/pc-setup`, { method: 'DELETE' }),
      params({ id: 'not-a-number', sectionKey: 'pc-setup' }),
    )
    expect(res.status).toBe(404)
  })
})
