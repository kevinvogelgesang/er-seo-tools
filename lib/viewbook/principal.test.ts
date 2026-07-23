import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthCookieValue } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { LAST_SEEN_TOUCH_MS } from './auth-config'
import { mintSecret } from './auth-secrets'
import { createViewbook } from './service'
import {
  attributionOf,
  canRead,
  canWrite,
  memberWriteFence,
  resolveViewbookPrincipalFromCookies,
  type ViewbookPrincipal,
} from './principal'

const PREFIX = 'vb-principal-u1-'
const ORIGINAL_ENV = { ...process.env }

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'upgrade', 'operator@example.com')
}

async function mkMemberSession(viewbookId: number, overrides: { expiresAt?: Date; revokedAt?: Date | null; lastSeenAt?: Date | null } = {}) {
  const member = await prisma.viewbookTeamMember.create({
    data: {
      viewbookId,
      memberKey: crypto.randomUUID(),
      name: 'Jamie Client',
      email: `${crypto.randomUUID()}@example.com`,
      addedBy: 'operator@example.com',
    },
  })
  const secret = mintSecret()
  const session = await prisma.viewbookMemberSession.create({
    data: {
      memberId: member.id,
      tokenHash: secret.hash,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
      revokedAt: overrides.revokedAt,
      lastSeenAt: overrides.lastSeenAt,
    },
  })
  return { member, session, raw: secret.raw }
}

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    APP_AUTH_PASSWORD: 'configured-for-u1-tests',
    APP_AUTH_SECRET: 'u1-principal-test-secret',
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env = { ...ORIGINAL_ENV }
})

afterAll(async () => {
  process.env = { ...ORIGINAL_ENV }
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('viewbook principal resolution', () => {
  it('lets the explicit dev bypass win before every cookie type', async () => {
    delete process.env.APP_AUTH_PASSWORD
    const result = await resolveViewbookPrincipalFromCookies(
      { erAuthCookie: 'garbage', memberCookie: 'garbage' },
      { id: 999 },
    )
    expect(result).toEqual({ kind: 'dev', email: 'dev@localhost' })
  })

  it('maps verified ER identities to operator and break-glass principals', async () => {
    const operatorCookie = await createAuthCookieValue({
      sub: 'google:1', email: 'op@example.com', hd: 'example.com', name: 'Operator',
    })
    const breakGlassCookie = await createAuthCookieValue({
      sub: 'password:break-glass', email: null, hd: null, name: 'Break Glass',
    })

    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: operatorCookie, memberCookie: null }, { id: 1 },
    )).resolves.toEqual({ kind: 'operator', email: 'op@example.com' })
    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: breakGlassCookie, memberCookie: null }, { id: 1 },
    )).resolves.toEqual({ kind: 'break-glass' })
  })

  it('resolves only a live member session belonging to this viewbook', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    const live = await mkMemberSession(a.id)
    const expired = await mkMemberSession(a.id, { expiresAt: new Date(Date.now() - 1) })
    const revoked = await mkMemberSession(a.id, { revokedAt: new Date() })

    const principal = await resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: live.raw }, { id: a.id },
    )
    expect(principal).toEqual({
      kind: 'member',
      member: {
        id: live.member.id,
        memberKey: live.member.memberKey,
        name: live.member.name,
        email: live.member.email,
      },
      sessionId: live.session.id,
    })
    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: live.raw }, { id: b.id },
    )).resolves.toBeNull()
    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: expired.raw }, { id: a.id },
    )).resolves.toBeNull()
    await expect(resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: revoked.raw }, { id: a.id },
    )).resolves.toBeNull()
  })

  it('fences the throttled lastSeenAt touch under concurrent resolution', async () => {
    const viewbook = await mkViewbook()
    const old = new Date(Date.now() - LAST_SEEN_TOUCH_MS - 5_000)
    const live = await mkMemberSession(viewbook.id, { lastSeenAt: old })
    const originalUpdate = prisma.viewbookMemberSession.updateMany.bind(prisma.viewbookMemberSession)
    const counts: number[] = []
    vi.spyOn(prisma.viewbookMemberSession, 'updateMany').mockImplementation(async (args) => {
      const result = await originalUpdate(args)
      counts.push(result.count)
      return result
    })

    await Promise.all(Array.from({ length: 6 }, () => resolveViewbookPrincipalFromCookies(
      { erAuthCookie: null, memberCookie: live.raw }, { id: viewbook.id },
    )))

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1)
    const row = await prisma.viewbookMemberSession.findUniqueOrThrow({ where: { id: live.session.id } })
    expect(row.lastSeenAt?.getTime()).toBeGreaterThan(old.getTime())
  })

  it('exposes read/write capabilities and verified attribution', () => {
    const member: ViewbookPrincipal = {
      kind: 'member',
      member: { id: 1, memberKey: 'm', name: 'Jamie', email: 'jamie@example.com' },
      sessionId: 2,
    }
    const operator: ViewbookPrincipal = { kind: 'operator', email: 'op@example.com' }
    const dev: ViewbookPrincipal = { kind: 'dev', email: 'dev@localhost' }
    const breakGlass: ViewbookPrincipal = { kind: 'break-glass' }

    expect([member, operator, dev, breakGlass].every(canRead)).toBe(true)
    expect(canRead(null)).toBe(false)
    expect(canWrite(member)).toBe(true)
    expect(canWrite(operator)).toBe(true)
    expect(canWrite(dev)).toBe(true)
    expect(canWrite(breakGlass)).toBe(false)
    expect(canWrite(null)).toBe(false)
    expect(attributionOf(member)).toEqual({ actorEmail: 'jamie@example.com', authorName: 'Jamie', actorKind: 'member' })
    expect(attributionOf(operator)).toEqual({ actorEmail: 'op@example.com', authorName: 'op@example.com', actorKind: 'operator' })
    expect(() => attributionOf(breakGlass)).toThrow()
  })

  it('makes the member write fence depend on a live session and current membership', async () => {
    const viewbook = await mkViewbook()
    const live = await mkMemberSession(viewbook.id)
    const principal: ViewbookPrincipal = {
      kind: 'member',
      member: {
        id: live.member.id,
        memberKey: live.member.memberKey,
        name: live.member.name,
        email: live.member.email,
      },
      sessionId: live.session.id,
    }
    const allowed = async (p: ViewbookPrincipal) => {
      const rows = await prisma.$queryRaw<Array<{ allowed: bigint }>>(Prisma.sql`
        SELECT CASE WHEN (${memberWriteFence(p, viewbook.id, Date.now())}) THEN 1 ELSE 0 END AS allowed
      `)
      return Number(rows[0]?.allowed ?? 0)
    }

    expect(await allowed(principal)).toBe(1)
    expect(await allowed({ kind: 'operator', email: 'op@example.com' })).toBe(1)
    await prisma.viewbookTeamMember.delete({ where: { id: live.member.id } })
    expect(await allowed(principal)).toBe(0)
  })
})
