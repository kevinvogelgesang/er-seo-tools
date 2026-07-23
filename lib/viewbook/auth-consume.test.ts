import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { POST as consumeRoute } from '@/app/api/viewbook/[token]/auth/consume/route'
import { POST as logoutRoute } from '@/app/api/viewbook/[token]/auth/logout/route'
import { SESSION_TTL_MS } from './auth-config'
import { consumeGrant, revokeSessionByCookie } from './auth-consume'
import { hashSecret, memberCookieName, mintSecret } from './auth-secrets'
import { resolveViewbookPrincipalFromCookies } from './principal'
import { createViewbook } from './service'

const PREFIX = 'vb-auth-consume-u1-'
const ORIGINAL_ENV = { ...process.env }

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'upgrade', 'operator@example.com')
}

async function mkGrant(viewbookId: number, overrides: { expiresAt?: Date; email?: string } = {}) {
  const member = await prisma.viewbookTeamMember.create({
    data: {
      viewbookId,
      memberKey: crypto.randomUUID(),
      name: 'Jamie Client',
      email: overrides.email ?? `${crypto.randomUUID()}@example.com`,
      addedBy: 'operator@example.com',
    },
  })
  const secret = mintSecret()
  const grant = await prisma.viewbookAuthGrant.create({
    data: {
      memberId: member.id,
      tokenHash: secret.hash,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    },
  })
  return { member, grant, raw: secret.raw }
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    APP_AUTH_PASSWORD: 'configured-for-u1-tests',
    APP_AUTH_SECRET: 'u1-consume-test-secret',
  }
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

afterAll(async () => {
  process.env = { ...ORIGINAL_ENV }
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('consumeGrant', () => {
  it('atomically consumes a live grant and returns the only copy of the session secret', async () => {
    const viewbook = await mkViewbook()
    const seeded = await mkGrant(viewbook.id)
    const now = Date.now()
    const result = await consumeGrant(viewbook, seeded.raw, now)
    expect(result).not.toBeNull()
    const session = await prisma.viewbookMemberSession.findFirstOrThrow({ where: { memberId: seeded.member.id } })
    expect(session.tokenHash).toBe(hashSecret(result!.rawSession))
    expect(session.expiresAt.getTime()).toBe(now + SESSION_TTL_MS)
    expect((await prisma.viewbookAuthGrant.findUniqueOrThrow({ where: { id: seeded.grant.id } })).consumedAt?.getTime()).toBe(now)
    await expect(consumeGrant(viewbook, seeded.raw, now + 1)).resolves.toBeNull()
  })

  it('uniformly rejects expired and wrong-viewbook grants', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    const expired = await mkGrant(a.id, { expiresAt: new Date(Date.now() - 1) })
    const live = await mkGrant(a.id)
    await expect(consumeGrant(a, expired.raw)).resolves.toBeNull()
    await expect(consumeGrant(b, live.raw)).resolves.toBeNull()
    expect(await prisma.viewbookMemberSession.count({ where: { memberId: { in: [expired.member.id, live.member.id] } } })).toBe(0)
  })

  it('allows exactly one winner under concurrent consumption', async () => {
    const viewbook = await mkViewbook()
    const seeded = await mkGrant(viewbook.id)
    const results = await Promise.all([
      consumeGrant(viewbook, seeded.raw),
      consumeGrant(viewbook, seeded.raw),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await prisma.viewbookMemberSession.count({ where: { memberId: seeded.member.id } })).toBe(1)
  })
})

describe('session revocation', () => {
  it('revokes a matching cookie and no-ops for unknown values', async () => {
    const viewbook = await mkViewbook()
    const grant = await mkGrant(viewbook.id)
    const consumed = await consumeGrant(viewbook, grant.raw)
    await revokeSessionByCookie('unknown-cookie')
    await revokeSessionByCookie(consumed!.rawSession)
    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: consumed!.rawSession }, { id: viewbook.id },
    )).resolves.toBeNull()
  })
})

describe('auth consume/logout routes', () => {
  it('sets the isolated secure cookie on success and returns a uniform 401 on replay', async () => {
    const viewbook = await mkViewbook()
    const grant = await mkGrant(viewbook.id)
    const request = () => new NextRequest(`http://localhost/api/viewbook/${viewbook.token}/auth/consume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ g: grant.raw }),
    })
    const first = await consumeRoute(request(), { params: Promise.resolve({ token: viewbook.token }) })
    expect(first.status).toBe(200)
    const cookie = first.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${memberCookieName(viewbook.id)}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=lax')
    expect(cookie).toContain('Path=/')

    const second = await consumeRoute(request(), { params: Promise.resolve({ token: viewbook.token }) })
    expect(second.status).toBe(401)
    await expect(second.json()).resolves.toEqual({ error: 'invalid_grant' })
  })

  it('keeps same-email memberships isolated in distinct per-viewbook cookies', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    const email = `${crypto.randomUUID()}@example.com`
    const grantA = await mkGrant(a.id, { email })
    const grantB = await mkGrant(b.id, { email })

    const consume = (token: string, rawGrant: string) => consumeRoute(
      new NextRequest(`http://localhost/api/viewbook/${token}/auth/consume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ g: rawGrant }),
      }),
      { params: Promise.resolve({ token }) },
    )
    const responseA = await consume(a.token, grantA.raw)
    const responseB = await consume(b.token, grantB.raw)
    const cookieA = responseA.cookies.get(memberCookieName(a.id))?.value
    const cookieB = responseB.cookies.get(memberCookieName(b.id))?.value

    expect(responseA.status).toBe(200)
    expect(responseB.status).toBe(200)
    expect(memberCookieName(a.id)).not.toBe(memberCookieName(b.id))
    expect(cookieA).toBeTruthy()
    expect(cookieB).toBeTruthy()
    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: cookieA! }, { id: a.id },
    )).resolves.toMatchObject({ kind: 'member', member: { email } })
    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: cookieB! }, { id: b.id },
    )).resolves.toMatchObject({ kind: 'member', member: { email } })
    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: cookieA! }, { id: b.id },
    )).resolves.toBeNull()
    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: cookieB! }, { id: a.id },
    )).resolves.toBeNull()
  })

  it('logout revokes any matching member cookie and always clears it for a valid token', async () => {
    const viewbook = await mkViewbook()
    const grant = await mkGrant(viewbook.id)
    const consumed = await consumeGrant(viewbook, grant.raw)
    const cookieName = memberCookieName(viewbook.id)
    const response = await logoutRoute(new NextRequest(`http://localhost/api/viewbook/${viewbook.token}/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${cookieName}=${encodeURIComponent(consumed!.rawSession)}` },
    }), { params: Promise.resolve({ token: viewbook.token }) })
    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain(`${cookieName}=;`)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: consumed!.rawSession }, { id: viewbook.id },
    )).resolves.toBeNull()
  })
})
