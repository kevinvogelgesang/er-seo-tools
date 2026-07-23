import { afterAll, describe, expect, it, beforeAll } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { appendActivityStatements, listActivity } from './activity'
import { createViewbook } from './service'
import { ensureSeededTemplates } from './__fixtures__/instance-test-helpers'

// F2 (Task 3): createViewbook snapshots from the template library — seed it
// once per file (idempotent; an earlier file in this worker may have wiped it).
beforeAll(async () => {
  await ensureSeededTemplates()
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'upgrade', 'operator@example.com')
}

describe('viewbook activity', () => {
  it('composes activity writes into an array-form transaction', async () => {
    const vb = await mkViewbook()
    await prisma.$transaction([
      ...appendActivityStatements(vb.id, 'feedback', 'client', 'client', 'Client added feedback'),
      ...appendActivityStatements(vb.id, 'section-done', 'operator@example.com', 'operator', 'Completed Brand Guidelines'),
    ])
    const feed = await listActivity(vb.id)
    expect(feed.items.map((row) => row.summary)).toEqual([
      'Completed Brand Guidelines',
      'Client added feedback',
    ])
  })

  it('paginates newest-first with an exclusive id cursor and bounded limit', async () => {
    const vb = await mkViewbook()
    await prisma.$transaction(Array.from({ length: 4 }, (_, i) =>
      prisma.viewbookActivity.create({
        data: { viewbookId: vb.id, kind: 'test', actor: 'client', summary: `row ${i + 1}` },
      })))
    const first = await listActivity(vb.id, undefined, 2)
    expect(first.items.map((row) => row.summary)).toEqual(['row 4', 'row 3'])
    expect(first.nextCursor).toBe(first.items[1].id)
    const second = await listActivity(vb.id, first.nextCursor, 2)
    expect(second.items.map((row) => row.summary)).toEqual(['row 2', 'row 1'])
    expect(second.nextCursor).toBeNull()
  })
})
