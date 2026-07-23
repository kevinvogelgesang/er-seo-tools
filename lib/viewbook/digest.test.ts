import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { processViewbookDigest, runViewbookDigests, type ViewbookDigestDeps } from './digest'
import type { SendArgs } from '@/lib/notify/transport'

const OLD_ENV = process.env
beforeEach(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
  process.env = { ...OLD_ENV, MAILGUN_API_KEY: 'key', MAILGUN_DOMAIN: 'mg.example', NOTIFY_ADMIN_EMAIL: 'admin@example.com' }
})
afterEach(() => { process.env = OLD_ENV })
afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'upgrade', 'operator@example.com')
}

function deps(overrides: Partial<ViewbookDigestDeps> = {}) {
  const calls: SendArgs[] = []
  return {
    calls,
    value: {
      send: async (args: SendArgs) => { calls.push(args) },
      now: () => new Date('2026-07-16T12:00:00Z'),
      ...overrides,
    } satisfies ViewbookDigestDeps,
  }
}

describe('viewbook digest high-water core', () => {
  it('leaves a concurrent client insertion above the captured high-water pending', async () => {
    const vb = await mkViewbook()
    const first = await prisma.viewbookActivity.create({
      data: { viewbookId: vb.id, kind: 'feedback', actor: 'client', actorKind: 'client', summary: 'first' },
    })
    let concurrentId = 0
    const d = deps({
      beforeSend: async (viewbookId, highWater) => {
        expect(highWater).toBe(first.id)
        concurrentId = (await prisma.viewbookActivity.create({
          data: { viewbookId, kind: 'material-link', actor: 'client', actorKind: 'client', summary: 'concurrent' },
        })).id
      },
    })
    await processViewbookDigest(vb.id, d.value)
    const row = await prisma.viewbook.findUniqueOrThrow({ where: { id: vb.id } })
    expect(row.digestCursorId).toBe(first.id)
    expect(concurrentId).toBeGreaterThan(row.digestCursorId)
    expect(d.calls).toHaveLength(1)
    expect(d.calls[0].content.text).toContain('first')
    expect(d.calls[0].content.text).not.toContain('concurrent')
  })

  it('dark env advances the cursor but does not stamp digestSentAt', async () => {
    delete process.env.MAILGUN_API_KEY
    const vb = await mkViewbook()
    const activity = await prisma.viewbookActivity.create({
      data: { viewbookId: vb.id, kind: 'feedback', actor: 'client', actorKind: 'client', summary: 'suppressed' },
    })
    const d = deps()
    await processViewbookDigest(vb.id, d.value)
    const row = await prisma.viewbook.findUniqueOrThrow({ where: { id: vb.id } })
    expect(row.digestCursorId).toBe(activity.id)
    expect(row.digestSentAt).toBeNull()
    expect(d.calls).toHaveLength(0)
  })

  it('includes at most 30 rows and advances through the honest overflow', async () => {
    const vb = await mkViewbook()
    await prisma.viewbookActivity.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({ viewbookId: vb.id, kind: 'feedback', actor: 'client', actorKind: 'client', summary: `item ${i}` })),
    })
    const d = deps()
    await processViewbookDigest(vb.id, d.value)
    expect(d.calls[0].content.text).toContain('+5 more in the activity feed')
    const max = await prisma.viewbookActivity.aggregate({ where: { viewbookId: vb.id }, _max: { id: true } })
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: vb.id } })).digestCursorId).toBe(max._max.id)
  })

  it('operator activity never triggers the digest sweep', async () => {
    const vb = await mkViewbook()
    await prisma.viewbookActivity.create({
      data: { viewbookId: vb.id, kind: 'section-done', actor: 'operator@example.com', actorKind: 'operator', summary: 'operator only' },
    })
    const d = deps()
    await runViewbookDigests(d.value)
    expect(d.calls).toHaveLength(0)
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id: vb.id } })).digestCursorId).toBe(0)
  })

  it('a transport failure leaves both cursor and sent marker unchanged for retry', async () => {
    const vb = await mkViewbook()
    await prisma.viewbookActivity.create({
      data: { viewbookId: vb.id, kind: 'feedback', actor: 'client', actorKind: 'client', summary: 'retry me' },
    })
    const d = deps({ send: async () => { throw new Error('mail down') } })
    await expect(processViewbookDigest(vb.id, d.value)).rejects.toThrow('mail down')
    const row = await prisma.viewbook.findUniqueOrThrow({ where: { id: vb.id } })
    expect(row.digestCursorId).toBe(0)
    expect(row.digestSentAt).toBeNull()
  })

  it('includes member activity but excludes operator activity from the same range', async () => {
    const vb = await mkViewbook()
    await prisma.viewbookActivity.createMany({ data: [
      { viewbookId: vb.id, kind: 'answer', actor: 'member@example.com', actorKind: 'member', summary: 'member update' },
      { viewbookId: vb.id, kind: 'section-done', actor: 'operator@example.com', actorKind: 'operator', summary: 'operator update' },
    ] })
    const d = deps()
    await processViewbookDigest(vb.id, d.value)
    expect(d.calls).toHaveLength(1)
    expect(d.calls[0].content.text).toContain('member update')
    expect(d.calls[0].content.text).not.toContain('operator update')
  })
})
