// syncVersion bump coverage for the public client writes. Behavioral coverage
// (replay, caps, route guards) already lives in app/api/viewbook/public-writes.test.ts;
// this file adds only the fence-shared syncVersion assertions (v2 PR2 task 2).

import { afterAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { insertClientFeedback, insertClientMaterial } from './public-writes'

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-pw-' } } })
})

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-test-pw-${crypto.randomUUID()}` } })
  const created = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  const viewbook = await requireViewbookToken(created.token)
  const milestone = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: created.id } })
  const reviewLink = await prisma.viewbookReviewLink.create({
    data: { milestoneId: milestone.id, label: 'Homepage', url: 'https://example.com', kind: 'live', createdBy: 'operator@example.com' },
  })
  return { client, viewbook, token: created.token, reviewLink }
}

function mutationId() { return crypto.randomUUID() }

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

describe('insertClientFeedback syncVersion bump', () => {
  it('bumps once on a successful write and not again on clientMutationId replay', async () => {
    const ctx = await mkViewbook()
    const before = await syncVersion(ctx.viewbook.id)
    const input = { reviewLinkId: ctx.reviewLink.id, body: 'Please revise this', authorName: null, clientMutationId: mutationId() }
    const first = await insertClientFeedback(ctx.viewbook, ctx.token, input)
    const afterFirst = await syncVersion(ctx.viewbook.id)
    expect(afterFirst).toBe(before + 1)

    const replay = await insertClientFeedback(ctx.viewbook, ctx.token, input)
    expect(replay.replayed).toBe(true)
    expect(replay.feedback.id).toBe(first.feedback.id)
    expect(await syncVersion(ctx.viewbook.id)).toBe(afterFirst)
  })

  it('does not bump on a fenced failure (feedback on a hidden milestones section)', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbookSection.updateMany({
      where: { viewbookId: ctx.viewbook.id, sectionKey: 'milestones' },
      data: { state: 'hidden' },
    })
    const before = await syncVersion(ctx.viewbook.id)
    await expect(insertClientFeedback(ctx.viewbook, ctx.token, {
      reviewLinkId: ctx.reviewLink.id, body: 'Should not land', authorName: null, clientMutationId: mutationId(),
    })).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
  })
})

describe('insertClientMaterial syncVersion bump', () => {
  it('bumps once on a successful write and not again on clientMutationId replay', async () => {
    const ctx = await mkViewbook()
    const before = await syncVersion(ctx.viewbook.id)
    const input = { label: 'Brand files', url: 'https://example.com/brand', clientMutationId: mutationId() }
    const first = await insertClientMaterial(ctx.viewbook, ctx.token, input)
    const afterFirst = await syncVersion(ctx.viewbook.id)
    expect(afterFirst).toBe(before + 1)

    const replay = await insertClientMaterial(ctx.viewbook, ctx.token, input)
    expect(replay.replayed).toBe(true)
    expect(replay.material.id).toBe(first.material.id)
    expect(await syncVersion(ctx.viewbook.id)).toBe(afterFirst)
  })

  it('does not bump on a fenced failure (material link on a hidden materials section)', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbookSection.updateMany({
      where: { viewbookId: ctx.viewbook.id, sectionKey: 'materials' },
      data: { state: 'hidden' },
    })
    const before = await syncVersion(ctx.viewbook.id)
    await expect(insertClientMaterial(ctx.viewbook, ctx.token, {
      label: 'Should not land', url: 'https://example.com/x', clientMutationId: mutationId(),
    })).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(await syncVersion(ctx.viewbook.id)).toBe(before)
  })
})
