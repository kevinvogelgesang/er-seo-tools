// PR1 Task 1 Step 5 (Codex FIX-PR1-REAL-MIGRATION-PROOF): proves the migration's
// backfill statements (prisma/migrations/20260719211837_viewbook_collapsed_shared)
// actually convert a legacy state='collapsed' row onto collapsedShared and bump
// ONLY the affected parent's syncVersion. The test DB already has the migration
// applied (collapsedShared exists, the writer path no longer allows 'collapsed'),
// so we seed a pre-normalized row via raw SQL and re-run the exact backfill UPDATE
// statements the migration.sql file uses.
import crypto from 'crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'

const PREFIX = 'vb-collapsed-migration-'

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'new-build', 'op@x')
}

describe('collapsed→collapsedShared backfill', () => {
  it('normalizes a state=collapsed row and bumps only the affected parent', async () => {
    const affected = await mkViewbook()
    const untouched = await mkViewbook()
    // seed a legacy collapsed row via raw SQL (the writer path no longer allows 'collapsed')
    await prisma.$executeRaw`UPDATE "ViewbookSection" SET "state" = 'collapsed', "updatedAt" = 1 WHERE "viewbookId" = ${affected.id} AND "sectionKey" = 'brand'`
    const beforeAffected = (await prisma.viewbook.findUniqueOrThrow({ where: { id: affected.id } })).syncVersion
    const beforeUntouched = (await prisma.viewbook.findUniqueOrThrow({ where: { id: untouched.id } })).syncVersion
    const now = Date.now()
    // run the migration's backfill statements verbatim
    await prisma.$executeRaw`UPDATE "ViewbookSection" SET "collapsedShared" = true, "state" = 'active', "updatedAt" = ${now} WHERE "state" = 'collapsed'`
    await prisma.$executeRaw`UPDATE "Viewbook" SET "syncVersion" = "syncVersion" + 1, "updatedAt" = ${now} WHERE "id" IN (SELECT DISTINCT "viewbookId" FROM "ViewbookSection" WHERE "collapsedShared" = true)`

    const row = await prisma.viewbookSection.findUniqueOrThrow({ where: { viewbookId_sectionKey: { viewbookId: affected.id, sectionKey: 'brand' } } })
    expect(row.state).toBe('active')
    expect(row.collapsedShared).toBe(true)
    expect(Number(row.updatedAt)).toBe(now) // updatedAt advanced from the seeded 1
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: affected.id } })).syncVersion).toBe(beforeAffected + 1)
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: untouched.id } })).syncVersion).toBe(beforeUntouched) // unaffected parent unchanged
  })
})
