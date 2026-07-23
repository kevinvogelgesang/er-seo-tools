import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { requireViewbookToken } from './route-auth'
import { createViewbook, revokeViewbook } from './service'
import { HttpError } from '@/lib/api/errors'
import { ensureSeededTemplates } from './__fixtures__/instance-test-helpers'

// F2 (Task 3): createViewbook snapshots from the template library — seed it
// once per file (idempotent; an earlier file in this worker may have wiped it).
beforeAll(async () => {
  await ensureSeededTemplates()
})

const OPERATOR = 'kevin@enrollmentresources.com'

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

async function code(fn: () => Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await fn()
    throw new Error('expected rejection')
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, code: err.code }
    throw err
  }
}

describe('requireViewbookToken', () => {
  it('returns the viewbook for a live token', async () => {
    const c = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
    const { id, token } = await createViewbook(c.id, 'upgrade', OPERATOR)
    const vb = await requireViewbookToken(token)
    expect(vb.id).toBe(id)
  })

  it('bad token, revoked viewbook, and archived client are indistinguishable 404s', async () => {
    const cRevoked = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
    const revoked = await createViewbook(cRevoked.id, 'upgrade', OPERATOR)
    await revokeViewbook(revoked.id)

    const cArchived = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
    const archived = await createViewbook(cArchived.id, 'upgrade', OPERATOR)
    await prisma.client.update({ where: { id: cArchived.id }, data: { archivedAt: new Date() } })

    const results = await Promise.all([
      code(() => requireViewbookToken('no-such-token')),
      code(() => requireViewbookToken(revoked.token)),
      code(() => requireViewbookToken(archived.token)),
      code(() => requireViewbookToken('')),
    ])
    for (const r of results) expect(r).toEqual({ status: 404, code: 'not_found' })
  })
})
