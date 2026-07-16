import { describe, expect, it, afterAll } from 'vitest'
import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import {
  syncVersionBumpStatement,
  syncVersionBumpWhere,
  syncVersionBumpAllStatement,
  syncVersionBumpAllWhere,
} from './sync'

async function mkClient() {
  return prisma.client.create({
    data: { name: `vb-sync-test-${crypto.randomUUID()}` },
  })
}

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-sync-test-' } } })
})

describe('syncVersion bump statements', () => {
  it('unconditional bump increments and stamps updatedAt', async () => {
    const { id } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    const before = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    await prisma.$transaction([syncVersionBumpStatement(id)])
    const after = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(after.syncVersion).toBe(before.syncVersion + 1)
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())
  })

  it('predicated bump is a no-op when the predicate is false', async () => {
    const { id } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    await prisma.$transaction([
      syncVersionBumpWhere(id, Prisma.sql`EXISTS (SELECT 1 FROM "Viewbook" WHERE "id" = ${id} AND "dataLockedAt" IS NOT NULL)`),
    ])
    const after = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(after.syncVersion).toBe(0)
  })

  it('predicated bump fires when the predicate is true', async () => {
    const { id } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    await prisma.$transaction([
      syncVersionBumpWhere(id, Prisma.sql`EXISTS (SELECT 1 FROM "Viewbook" WHERE "id" = ${id} AND "dataLockedAt" IS NULL)`),
    ])
    const after = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(after.syncVersion).toBe(1)
  })

  it('bump rolls back when a later statement in the array throws (P2025)', async () => {
    const { id } = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    await expect(
      prisma.$transaction([
        syncVersionBumpStatement(id),
        prisma.viewbook.update({ where: { id, stage: 'kickoff' }, data: { stage: 'building' } }), // stage is 'post-contract' → P2025
      ])
    ).rejects.toThrow()
    const after = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(after.syncVersion).toBe(0)
  })

  it('bumpAll touches every viewbook', async () => {
    const a = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    const b = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    await prisma.$transaction([syncVersionBumpAllStatement()])
    const rows = await prisma.viewbook.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(rows.map((r) => r.syncVersion)).toEqual([1, 1])
  })

  it('bumpAllWhere is a no-op for every row when the predicate is false', async () => {
    const a = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    const b = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    await prisma.$transaction([
      syncVersionBumpAllWhere(Prisma.sql`"dataLockedAt" IS NOT NULL`),
    ])
    const rows = await prisma.viewbook.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(rows.map((r) => r.syncVersion)).toEqual([0, 0])
  })

  it('bumpAllWhere fires for every row when the predicate is true', async () => {
    const a = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    const b = await createViewbook((await mkClient()).id, 'upgrade', 'op@er.com')
    await prisma.$transaction([
      syncVersionBumpAllWhere(Prisma.sql`"dataLockedAt" IS NULL`),
    ])
    const rows = await prisma.viewbook.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(rows.map((r) => r.syncVersion)).toEqual([1, 1])
  })
})
