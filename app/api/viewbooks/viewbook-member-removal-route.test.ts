import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isPublicPath } from '@/middleware'
import { createViewbook, getViewbookAdmin } from '@/lib/viewbook/service'
import { hashSecret, memberCookieName } from '@/lib/viewbook/auth-secrets'
import { resolveViewbookPrincipalFromCookies } from '@/lib/viewbook/principal'
import { DELETE } from './[id]/team-members/[memberId]/route'

const PREFIX = 'vb-member-removal-route-'
const SAVED_ENV: Record<string, string | undefined> = {}
let operatorCookie: string

beforeAll(async () => {
  for (const key of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET']) SAVED_ENV[key] = process.env[key]
  process.env.APP_AUTH_PASSWORD = 'member-removal-test-password'
  process.env.APP_AUTH_SECRET = 'member-removal-test-secret'
  operatorCookie = `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({
    sub: 'google:member-removal',
    email: 'operator@example.com',
    hd: 'example.com',
    name: 'Operator',
  })}`
})

afterAll(async () => {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

async function seed() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const viewbook = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  const member = await prisma.viewbookTeamMember.create({
    data: {
      viewbookId: viewbook.id,
      memberKey: crypto.randomUUID(),
      name: 'Remove Me',
      email: `${crypto.randomUUID()}@example.com`,
      addedBy: 'operator@example.com',
    },
  })
  const rawSession = crypto.randomBytes(32).toString('base64url')
  const session = await prisma.viewbookMemberSession.create({
    data: {
      memberId: member.id,
      tokenHash: hashSecret(rawSession),
      expiresAt: new Date(Date.now() + 60_000),
    },
  })
  const grant = await prisma.viewbookAuthGrant.create({
    data: {
      memberId: member.id,
      tokenHash: hashSecret(crypto.randomBytes(32).toString('base64url')),
      expiresAt: new Date(Date.now() + 60_000),
    },
  })
  return { client, viewbook, member, rawSession, session, grant }
}

function request(auth = true): NextRequest {
  return new Request('http://localhost/api/viewbooks/1/team-members/1', {
    method: 'DELETE',
    headers: auth ? { cookie: operatorCookie } : undefined,
  }) as unknown as NextRequest
}

const params = (viewbookId: number, memberId: number) => ({
  params: Promise.resolve({ id: String(viewbookId), memberId: String(memberId) }),
})

describe('DELETE /api/viewbooks/:id/team-members/:memberId', () => {
  it('is cookie-gated and is not a public middleware path', async () => {
    const ctx = await seed()
    expect(isPublicPath(`/api/viewbooks/${ctx.viewbook.id}/team-members/${ctx.member.id}`)).toBe(false)
    const response = await DELETE(request(false), params(ctx.viewbook.id, ctx.member.id))
    expect(response.status).toBe(401)
    expect(await prisma.viewbookTeamMember.findUnique({ where: { id: ctx.member.id } })).not.toBeNull()
  })

  it('atomically bumps sync, records operator activity, deletes the member, and cascades credentials', async () => {
    const ctx = await seed()
    const before = (await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })).syncVersion
    const response = await DELETE(request(), params(ctx.viewbook.id, ctx.member.id))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })

    expect(await prisma.viewbookTeamMember.findUnique({ where: { id: ctx.member.id } })).toBeNull()
    expect(await prisma.viewbookAuthGrant.findUnique({ where: { id: ctx.grant.id } })).toBeNull()
    expect(await prisma.viewbookMemberSession.findUnique({ where: { id: ctx.session.id } })).toBeNull()
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.viewbook.id } })).syncVersion).toBe(before + 1)
    expect(await prisma.viewbookActivity.findFirst({
      where: { viewbookId: ctx.viewbook.id, kind: 'team-remove' },
    })).toMatchObject({ actor: 'operator@example.com', actorKind: 'operator' })

    expect(await resolveViewbookPrincipalFromCookies({
      erAuthCookie: null,
      memberCookie: ctx.rawSession,
    }, { id: ctx.viewbook.id })).toBeNull()
  })

  it('404s unknown and cross-viewbook member ids without changing either viewbook', async () => {
    const a = await seed()
    const b = await seed()
    for (const memberId of [9_999_999, b.member.id]) {
      const before = (await prisma.viewbook.findUniqueOrThrow({ where: { id: a.viewbook.id } })).syncVersion
      const response = await DELETE(request(), params(a.viewbook.id, memberId))
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'not_found' })
      expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: a.viewbook.id } })).syncVersion).toBe(before)
    }
    expect(await prisma.viewbookTeamMember.findUnique({ where: { id: b.member.id } })).not.toBeNull()
  })

  it('loads the admin roster in deterministic id order', async () => {
    const ctx = await seed()
    await prisma.viewbookTeamMember.create({
      data: {
        viewbookId: ctx.viewbook.id,
        memberKey: crypto.randomUUID(),
        name: 'Later Member',
        email: `${crypto.randomUUID()}@example.com`,
        addedBy: 'operator@example.com',
      },
    })
    const admin = await getViewbookAdmin(ctx.viewbook.id)
    expect(admin.teamMembers.map((member) => member.name)).toEqual(['Remove Me', 'Later Member'])
  })
})
