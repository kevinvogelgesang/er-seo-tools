import crypto from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { pruneViewbookAuthRows } from './auth-retention'

const PREFIX = 'vb-auth-retention-u1-'
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('pruneViewbookAuthRows', () => {
  it('prunes only auth rows beyond their model-specific retention windows', async () => {
    const now = new Date('2026-07-22T12:00:00.000Z')
    const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
    const viewbook = await createViewbook(client.id, 'upgrade', 'operator@example.com')
    const member = await prisma.viewbookTeamMember.create({
      data: {
        viewbookId: viewbook.id,
        memberKey: crypto.randomUUID(),
        name: 'Jamie Client',
        email: `${crypto.randomUUID()}@example.com`,
        addedBy: 'operator@example.com',
      },
    })

    const grants = await Promise.all([
      prisma.viewbookAuthGrant.create({
        data: { memberId: member.id, tokenHash: crypto.randomUUID(), expiresAt: new Date(now.getTime() - 8 * DAY_MS) },
      }),
      prisma.viewbookAuthGrant.create({
        data: {
          memberId: member.id,
          tokenHash: crypto.randomUUID(),
          expiresAt: new Date(now.getTime() + DAY_MS),
          consumedAt: new Date(now.getTime() - 8 * DAY_MS),
        },
      }),
      prisma.viewbookAuthGrant.create({
        data: { memberId: member.id, tokenHash: crypto.randomUUID(), expiresAt: new Date(now.getTime() - 6 * DAY_MS) },
      }),
      prisma.viewbookAuthGrant.create({
        data: {
          memberId: member.id,
          tokenHash: crypto.randomUUID(),
          expiresAt: new Date(now.getTime() + DAY_MS),
          consumedAt: new Date(now.getTime() - 6 * DAY_MS),
        },
      }),
      prisma.viewbookAuthGrant.create({
        data: { memberId: member.id, tokenHash: crypto.randomUUID(), expiresAt: new Date(now.getTime() + DAY_MS) },
      }),
    ])
    const sessions = await Promise.all([
      prisma.viewbookMemberSession.create({
        data: { memberId: member.id, tokenHash: crypto.randomUUID(), expiresAt: new Date(now.getTime() - 1) },
      }),
      prisma.viewbookMemberSession.create({
        data: {
          memberId: member.id,
          tokenHash: crypto.randomUUID(),
          expiresAt: new Date(now.getTime() + DAY_MS),
          revokedAt: new Date(now.getTime() - 8 * DAY_MS),
        },
      }),
      prisma.viewbookMemberSession.create({
        data: {
          memberId: member.id,
          tokenHash: crypto.randomUUID(),
          expiresAt: new Date(now.getTime() + DAY_MS),
          revokedAt: new Date(now.getTime() - 6 * DAY_MS),
        },
      }),
      prisma.viewbookMemberSession.create({
        data: { memberId: member.id, tokenHash: crypto.randomUUID(), expiresAt: new Date(now.getTime() + DAY_MS) },
      }),
    ])
    const requests = await Promise.all([
      prisma.viewbookAuthRequest.create({
        data: {
          id: crypto.randomUUID(),
          viewbookId: viewbook.id,
          email: member.email,
          createdAt: new Date(now.getTime() - 49 * HOUR_MS),
        },
      }),
      prisma.viewbookAuthRequest.create({
        data: {
          id: crypto.randomUUID(),
          viewbookId: viewbook.id,
          email: member.email,
          createdAt: new Date(now.getTime() - 47 * HOUR_MS),
        },
      }),
    ])

    await expect(pruneViewbookAuthRows(now)).resolves.toEqual({ grants: 2, sessions: 2, requests: 1 })

    expect((await prisma.viewbookAuthGrant.findMany({
      where: { memberId: member.id },
      orderBy: { id: 'asc' },
      select: { id: true },
    })).map(({ id }) => id)).toEqual(grants.slice(2).map(({ id }) => id).sort((a, b) => a - b))
    expect((await prisma.viewbookMemberSession.findMany({
      where: { memberId: member.id },
      orderBy: { id: 'asc' },
      select: { id: true },
    })).map(({ id }) => id)).toEqual(sessions.slice(2).map(({ id }) => id).sort((a, b) => a - b))
    expect((await prisma.viewbookAuthRequest.findMany({
      where: { viewbookId: viewbook.id },
      select: { id: true },
    })).map(({ id }) => id)).toEqual([requests[1].id])
  })
})
