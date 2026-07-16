import { afterAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { pruneViewbookActivity } from './retention'

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

describe('pruneViewbookActivity', () => {
  it('deletes activity older than 180 days and keeps the boundary/newer rows', async () => {
    const client = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
    const vb = await createViewbook(client.id, 'upgrade', 'operator@example.com')
    const now = new Date('2026-07-16T12:00:00Z')
    await prisma.viewbookActivity.createMany({ data: [
      { viewbookId: vb.id, kind: 'test', actor: 'client', summary: 'old', createdAt: new Date('2025-01-01T00:00:00Z') },
      { viewbookId: vb.id, kind: 'test', actor: 'client', summary: 'new', createdAt: now },
    ] })
    expect(await pruneViewbookActivity(now)).toBe(1)
    expect((await prisma.viewbookActivity.findMany({ where: { viewbookId: vb.id } })).map((row) => row.summary)).toEqual(['new'])
  })
})
