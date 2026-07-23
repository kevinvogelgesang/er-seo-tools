import crypto from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { createAuthCookieValue } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { hashSecret, memberCookieName } from '@/lib/viewbook/auth-secrets'
import { resetWriteThrottleForTests } from '@/lib/viewbook/public-write-guard'
import { GET as getSync } from '@/app/api/viewbook/[token]/sync/route'
import { POST as postFeedback } from '@/app/api/viewbook/[token]/feedback/route'
import { POST as postMaterials } from '@/app/api/viewbook/[token]/materials/route'
import { PATCH as patchAnswers } from '@/app/api/viewbook/[token]/answers/route'
import { POST as postAck } from '@/app/api/viewbook/[token]/ack/route'
import { POST as postTeamMembers } from '@/app/api/viewbook/[token]/team-members/route'
import { PATCH as patchSetup } from '@/app/api/viewbook/[token]/setup/route'
import { POST as postLogout } from '@/app/api/viewbook/[token]/auth/logout/route'

const PREFIX = 'vb-route-principal-matrix-'
const ORIGINAL_ENV = { ...process.env }

type RouteCall = (token: string, cookie?: string) => Promise<Response>

const params = (token: string) => ({ params: Promise.resolve({ token }) })

function request(token: string, tail: string, method: string, cookie?: string): NextRequest {
  return new Request(`http://localhost/api/viewbook/${token}/${tail}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: method === 'GET' ? undefined : '{}',
  }) as unknown as NextRequest
}

const readRoutes: Record<string, RouteCall> = {
  sync: (token, cookie) => getSync(request(token, 'sync', 'GET', cookie), params(token)),
}

const writeRoutes: Record<string, RouteCall> = {
  feedback: (token, cookie) => postFeedback(request(token, 'feedback', 'POST', cookie), params(token)),
  materials: (token, cookie) => postMaterials(request(token, 'materials', 'POST', cookie), params(token)),
  answers: (token, cookie) => patchAnswers(request(token, 'answers', 'PATCH', cookie), params(token)),
  ack: (token, cookie) => postAck(request(token, 'ack', 'POST', cookie), params(token)),
  'team-members': (token, cookie) => postTeamMembers(request(token, 'team-members', 'POST', cookie), params(token)),
  setup: (token, cookie) => patchSetup(request(token, 'setup', 'PATCH', cookie), params(token)),
}

async function seedViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  return { client, ...(await createViewbook(client.id, 'upgrade', 'operator@example.com')) }
}

async function memberCookie(viewbookId: number): Promise<{ header: string; sessionId: number }> {
  const member = await prisma.viewbookTeamMember.create({
    data: {
      viewbookId,
      memberKey: crypto.randomUUID(),
      name: 'Invited Member',
      email: `${crypto.randomUUID()}@example.com`,
      addedBy: 'operator@example.com',
    },
  })
  const raw = crypto.randomBytes(32).toString('base64url')
  const session = await prisma.viewbookMemberSession.create({
    data: {
      memberId: member.id,
      tokenHash: hashSecret(raw),
      expiresAt: new Date(Date.now() + 60_000),
    },
  })
  return { header: `${memberCookieName(viewbookId)}=${raw}`, sessionId: session.id }
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    APP_AUTH_PASSWORD: 'route-test-password',
    APP_AUTH_SECRET: 'route-test-secret',
  }
  resetWriteThrottleForTests()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

async function operatorCookie(email: string | null): Promise<string> {
  const value = await createAuthCookieValue({
    sub: email ? 'google:route-test' : 'password:break-glass',
    email,
    hd: email ? 'example.com' : null,
    name: email ? 'Route Operator' : 'Break-glass',
  })
  return `er_auth=${value}`
}

describe('viewbook token route principal matrix', () => {
  it('uniformly 404s every guarded route with no principal', async () => {
    const viewbook = await seedViewbook()
    for (const [name, call] of Object.entries({ ...readRoutes, ...writeRoutes })) {
      resetWriteThrottleForTests()
      const missingPrincipal = await call(viewbook.token)
      const badToken = await call('unknown-token')
      expect(missingPrincipal.status, name).toBe(404)
      expect(await missingPrincipal.json(), name).toEqual(await badToken.json())
    }
  })

  it('allows member, operator, and dev principals through every guarded route', async () => {
    const viewbook = await seedViewbook()
    const member = await memberCookie(viewbook.id)
    const operator = await operatorCookie('operator@example.com')

    for (const [identity, cookie] of [['member', member.header], ['operator', operator]] as const) {
      for (const [name, call] of Object.entries({ ...readRoutes, ...writeRoutes })) {
        resetWriteThrottleForTests()
        const response = await call(viewbook.token, cookie)
        expect(response.status, `${identity}:${name}`).not.toBe(404)
      }
    }

    delete process.env.APP_AUTH_PASSWORD
    for (const [name, call] of Object.entries({ ...readRoutes, ...writeRoutes })) {
      resetWriteThrottleForTests()
      const response = await call(viewbook.token)
      expect(response.status, `dev:${name}`).not.toBe(404)
    }
  })

  it('allows break-glass reads but uniformly 404s writes', async () => {
    const viewbook = await seedViewbook()
    const cookie = await operatorCookie(null)
    expect((await readRoutes.sync(viewbook.token, cookie)).status).toBe(200)
    for (const [name, call] of Object.entries(writeRoutes)) {
      resetWriteThrottleForTests()
      const response = await call(viewbook.token, cookie)
      expect(response.status, name).toBe(404)
      expect(await response.json(), name).toEqual({ error: 'not_found' })
    }
  })

  it('uniformly 404s unknown, revoked, and archived tokens before auth', async () => {
    const revoked = await seedViewbook()
    const archived = await seedViewbook()
    await prisma.viewbook.update({ where: { id: revoked.id }, data: { revokedAt: new Date() } })
    await prisma.client.update({ where: { id: archived.client.id }, data: { archivedAt: new Date() } })
    const operator = await operatorCookie('operator@example.com')

    for (const [name, call] of Object.entries({ ...readRoutes, ...writeRoutes })) {
      resetWriteThrottleForTests()
      for (const token of ['unknown-token', revoked.token, archived.token]) {
        const response = await call(token, operator)
        expect(response.status, `${name}:${token}`).toBe(404)
        expect(await response.json(), `${name}:${token}`).toEqual({ error: 'not_found' })
      }
    }
  })

  it('logout stays callable without a principal and revokes a member cookie even beside staff auth', async () => {
    const viewbook = await seedViewbook()
    expect((await postLogout(request(viewbook.token, 'auth/logout', 'POST'), params(viewbook.token))).status).toBe(204)

    for (const staffCookie of [
      await operatorCookie('operator@example.com'),
      await operatorCookie(null),
    ]) {
      const member = await memberCookie(viewbook.id)
      const response = await postLogout(
        request(viewbook.token, 'auth/logout', 'POST', `${staffCookie}; ${member.header}`),
        params(viewbook.token),
      )
      expect(response.status).toBe(204)
      expect(response.headers.get('set-cookie')).toContain(`${memberCookieName(viewbook.id)}=`)
      expect((await prisma.viewbookMemberSession.findUniqueOrThrow({ where: { id: member.sessionId } })).revokedAt).not.toBeNull()
    }

    for (const token of ['unknown-token']) {
      expect((await postLogout(request(token, 'auth/logout', 'POST'), params(token))).status).toBe(404)
    }
  })
})
