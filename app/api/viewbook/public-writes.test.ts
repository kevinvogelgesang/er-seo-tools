import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { resetWriteThrottleForTests } from '@/lib/viewbook/public-write-guard'
import { POST as postFeedback } from './[token]/feedback/route'
import { POST as postMaterial } from './[token]/materials/route'
import { insertClientFeedback as insertClientFeedbackCore, insertClientMaterial as insertClientMaterialCore } from '@/lib/viewbook/public-writes'

const LEGACY_TEST_AUTH = { principal: { kind: 'operator', email: 'client' } } as const
function insertClientFeedback(...args: [Parameters<typeof insertClientFeedbackCore>[0], Parameters<typeof insertClientFeedbackCore>[1], Parameters<typeof insertClientFeedbackCore>[2], Parameters<typeof insertClientFeedbackCore>[4]?]) {
  return insertClientFeedbackCore(args[0], args[1], args[2], LEGACY_TEST_AUTH, args[3])
}
function insertClientMaterial(...args: [Parameters<typeof insertClientMaterialCore>[0], Parameters<typeof insertClientMaterialCore>[1], Parameters<typeof insertClientMaterialCore>[2], Parameters<typeof insertClientMaterialCore>[4]?]) {
  return insertClientMaterialCore(args[0], args[1], args[2], LEGACY_TEST_AUTH, args[3])
}

beforeEach(resetWriteThrottleForTests)
afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
  const created = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  const viewbook = await requireViewbookToken(created.token)
  const milestone = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: created.id } })
  const reviewLink = await prisma.viewbookReviewLink.create({
    data: { milestoneId: milestone.id, label: 'Homepage', url: 'https://example.com', kind: 'live', createdBy: 'operator@example.com' },
  })
  return { client, viewbook, token: created.token, reviewLink }
}

function mutationId() { return crypto.randomUUID() }

function request(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
  }) as unknown as NextRequest
}

const params = (token: string) => ({ params: Promise.resolve({ token }) })

describe('public feedback writes', () => {
  it('commit-time revocation rejects with 404 and writes neither domain nor activity row', async () => {
    const ctx = await mkViewbook()
    const id = mutationId()
    await expect(insertClientFeedback(ctx.viewbook, ctx.token, {
      reviewLinkId: ctx.reviewLink.id, body: 'Please revise this', authorName: null, clientMutationId: id,
    }, {
      beforeCommit: () => prisma.viewbook.update({ where: { id: ctx.viewbook.id }, data: { revokedAt: new Date() } }).then(() => {}),
    })).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(await prisma.viewbookFeedback.count({ where: { clientMutationId: id } })).toBe(0)
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id } })).toBe(0)
  })

  it('rejects a cross-viewbook reviewLinkId', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    await expect(insertClientFeedback(a.viewbook, a.token, {
      reviewLinkId: b.reviewLink.id, body: 'Cross write', authorName: null, clientMutationId: mutationId(),
    })).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(await prisma.viewbookFeedback.count({ where: { reviewLinkId: b.reviewLink.id } })).toBe(0)
  })

  it('enforces the 200-row cap under Promise.all double-submit', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbookFeedback.createMany({
      data: Array.from({ length: 199 }, (_, i) => ({
        reviewLinkId: ctx.reviewLink.id, body: `seed ${i}`, authorKind: 'client', clientMutationId: mutationId(),
      })),
    })
    const results = await Promise.allSettled([0, 1].map((i) => insertClientFeedback(ctx.viewbook, ctx.token, {
      reviewLinkId: ctx.reviewLink.id, body: `racing ${i}`, authorName: null, clientMutationId: mutationId(),
    })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(await prisma.viewbookFeedback.count({ where: { reviewLinkId: ctx.reviewLink.id } })).toBe(200)
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id, kind: 'feedback' } })).toBe(1)
  })

  it('replays clientMutationId as the same row without duplicate activity', async () => {
    const ctx = await mkViewbook()
    const input = {
      reviewLinkId: ctx.reviewLink.id, body: 'One request', authorName: 'Alex', clientMutationId: mutationId(),
    }
    const first = await insertClientFeedback(ctx.viewbook, ctx.token, input)
    const replay = await insertClientFeedback(ctx.viewbook, ctx.token, input)
    expect(replay.replayed).toBe(true)
    expect(replay.feedback.id).toBe(first.feedback.id)
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id, kind: 'feedback' } })).toBe(1)
  })

  it('route applies content-type and same-site guards and returns no-store', async () => {
    const ctx = await mkViewbook()
    const noType = await postFeedback(new Request(`http://localhost/api/viewbook/${ctx.token}/feedback`, {
      method: 'POST', body: '{}',
    }) as unknown as NextRequest, params(ctx.token))
    expect(noType.status).toBe(415)
    const cross = await postFeedback(request(`/api/viewbook/${ctx.token}/feedback`, {}, {
      origin: 'https://evil.example', 'sec-fetch-site': 'cross-site',
    }), params(ctx.token))
    expect(cross.status).toBe(403)
    const ok = await postFeedback(request(`/api/viewbook/${ctx.token}/feedback`, {
      reviewLinkId: ctx.reviewLink.id, body: 'Looks good', clientMutationId: mutationId(),
    }), params(ctx.token))
    expect(ok.status).toBe(201)
    expect(ok.headers.get('cache-control')).toBe('no-store')
  })
})

describe('public material writes', () => {
  it('stores https links, activity, and idempotent replay', async () => {
    const ctx = await mkViewbook()
    const input = { label: 'Brand files', url: 'https://example.com/brand', clientMutationId: mutationId() }
    const first = await insertClientMaterial(ctx.viewbook, ctx.token, input)
    const replay = await insertClientMaterial(ctx.viewbook, ctx.token, input)
    expect(first.material.status).toBe('provided')
    expect(first.material.addedBy).toBe('client')
    expect(replay.material.id).toBe(first.material.id)
    expect(replay.replayed).toBe(true)
    expect(await prisma.viewbookActivity.count({ where: { viewbookId: ctx.viewbook.id, kind: 'material-link' } })).toBe(1)
  })

  it('route rejects non-https URLs', async () => {
    const ctx = await mkViewbook()
    const response = await postMaterial(request(`/api/viewbook/${ctx.token}/materials`, {
      label: 'Bad', url: 'http://example.com', clientMutationId: mutationId(),
    }), params(ctx.token))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_material')
  })
})
