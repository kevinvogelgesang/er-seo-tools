import crypto from 'crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { resetWriteThrottleForTests } from '@/lib/viewbook/public-write-guard'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { POST as ackPost } from './[token]/ack/route'
import { POST } from './[token]/collapse/route'

const PREFIX = 'vb-test-collapse-route-'
const ENV_KEYS = ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  resetWriteThrottleForTests()
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  // Configure auth so the dev bypass is OFF — anonymous vs operator is
  // distinguishable in these tests.
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

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

async function operatorCookie(): Promise<string> {
  const value = await createAuthCookieValue({
    sub: 'google:1', email: 'kevin@enrollmentresources.com', hd: 'enrollmentresources.com', name: 'Kevin',
  })
  return `${AUTH_COOKIE_NAME}=${value}`
}

function req(token: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost/api/viewbook/${token}/collapse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const params = (token: string) => ({ params: Promise.resolve({ token }) })

describe('POST /api/viewbook/:token/collapse', () => {
  it('anonymous collapsed=true succeeds (200, no-store)', async () => {
    const ctx = await mkViewbook()
    const res = await POST(req(ctx.token, { sectionKey: 'brand', collapsed: true }), params(ctx.token))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ collapsedShared: true })
  })

  it('anonymous collapsed=false is rejected (403 operator_required)', async () => {
    const ctx = await mkViewbook()
    await POST(req(ctx.token, { sectionKey: 'brand', collapsed: true }), params(ctx.token))
    const res = await POST(req(ctx.token, { sectionKey: 'brand', collapsed: false }), params(ctx.token))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('operator_required')
  })

  it('operator collapsed=false succeeds (200)', async () => {
    const ctx = await mkViewbook()
    const cookie = await operatorCookie()
    await POST(req(ctx.token, { sectionKey: 'brand', collapsed: true }, { cookie }), params(ctx.token))
    const res = await POST(req(ctx.token, { sectionKey: 'brand', collapsed: false }, { cookie }), params(ctx.token))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ collapsedShared: false })
  })

  it('415s on non-JSON content-type', async () => {
    const ctx = await mkViewbook()
    const res = await POST(
      new Request(`http://localhost/api/viewbook/${ctx.token}/collapse`, { method: 'POST', body: '{}' }) as unknown as NextRequest,
      params(ctx.token),
    )
    expect(res.status).toBe(415)
  })

  it('403s on a cross-site request (missing same-site header rejected)', async () => {
    const ctx = await mkViewbook()
    const res = await POST(
      req(ctx.token, { sectionKey: 'brand', collapsed: true }, {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      params(ctx.token),
    )
    expect(res.status).toBe(403)
  })

  it('404s on an unknown token', async () => {
    const res = await POST(
      req('does-not-exist', { sectionKey: 'brand', collapsed: true }),
      params('does-not-exist'),
    )
    expect(res.status).toBe(404)
  })

  it('404s on a rotated (old) token', async () => {
    const ctx = await mkViewbook()
    const oldToken = ctx.token
    // Rotate: the DB row's token no longer matches oldToken.
    await prisma.viewbook.update({ where: { id: ctx.viewbook.id }, data: { token: crypto.randomUUID() } })
    const res = await POST(req(oldToken, { sectionKey: 'brand', collapsed: true }), params(oldToken))
    expect(res.status).toBe(404)
  })

  it('400s on an unknown sectionKey', async () => {
    const ctx = await mkViewbook()
    const res = await POST(req(ctx.token, { sectionKey: 'not-a-real-section', collapsed: true }), params(ctx.token))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_section')
  })

  it('hidden section is blocked (409 collapse_blocked) and does NOT bump syncVersion', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: ctx.viewbook.id, sectionKey: 'brand' } },
      data: { state: 'hidden' },
    })
    const before = (await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })).syncVersion
    const res = await POST(req(ctx.token, { sectionKey: 'brand', collapsed: true }), params(ctx.token))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('collapse_blocked')
    const after = (await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })).syncVersion
    expect(after).toBe(before)
  })

  it('revoked viewbook / archived client are blocked (404 at the token preflight) and do NOT bump syncVersion', async () => {
    const revokedCtx = await mkViewbook()
    await prisma.viewbook.update({ where: { id: revokedCtx.viewbook.id }, data: { revokedAt: new Date() } })
    const beforeRevoked = (await prisma.viewbook.findUniqueOrThrow({ where: { id: revokedCtx.viewbook.id } })).syncVersion
    const revokedRes = await POST(req(revokedCtx.token, { sectionKey: 'brand', collapsed: true }), params(revokedCtx.token))
    expect(revokedRes.status).toBe(404)
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: revokedCtx.viewbook.id } })).syncVersion).toBe(beforeRevoked)

    const archivedCtx = await mkViewbook()
    await prisma.client.update({ where: { id: archivedCtx.client.id }, data: { archivedAt: new Date() } })
    const beforeArchived = (await prisma.viewbook.findUniqueOrThrow({ where: { id: archivedCtx.viewbook.id } })).syncVersion
    const archivedRes = await POST(req(archivedCtx.token, { sectionKey: 'brand', collapsed: true }), params(archivedCtx.token))
    expect(archivedRes.status).toBe(404)
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: archivedCtx.viewbook.id } })).syncVersion).toBe(beforeArchived)
  })

  it('uses a dedicated collapse:<token> throttle bucket — an ack POST for the same token still succeeds after collapse spam', async () => {
    const ctx = await mkViewbook()
    for (let i = 0; i < 10; i++) {
      const res = await POST(req(ctx.token, { sectionKey: 'brand', collapsed: i % 2 === 0 }, { cookie: await operatorCookie() }), params(ctx.token))
      expect(res.status).toBeLessThan(400)
    }
    const limited = await POST(req(ctx.token, { sectionKey: 'brand', collapsed: true }), params(ctx.token))
    expect(limited.status).toBe(429)

    // The ack route's bucket is keyed on the bare token — collapse spam under
    // `collapse:<token>` must not have consumed it.
    const ackRes = await ackPost(
      new Request(`http://localhost/api/viewbook/${ctx.token}/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sectionKey: 'pc-setup', clientMutationId: crypto.randomUUID() }),
      }) as unknown as NextRequest,
      params(ctx.token),
    )
    expect(ackRes.status).toBeLessThan(400)
  })
})
