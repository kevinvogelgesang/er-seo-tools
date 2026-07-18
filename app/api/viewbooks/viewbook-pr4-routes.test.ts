import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { createViewbook } from '@/lib/viewbook/service'
import { POST as createReviewLink } from './[id]/milestones/[milestoneId]/review-links/route'
import { DELETE as deleteReviewLink } from './[id]/review-links/[reviewLinkId]/route'
import { POST as resolveFeedback } from './[id]/feedback/[feedbackId]/resolve/route'
import { GET as getActivity } from './[id]/activity/route'
import { POST as createMilestoneRoute } from './[id]/milestones/route'
import { PATCH as updateMilestoneRoute } from './[id]/milestones/[milestoneId]/route'

let cookie: string
const savedEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  for (const key of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET']) savedEnv[key] = process.env[key]
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  cookie = `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({
    sub: 'google:pr4', email: 'operator@example.com', hd: 'example.com', name: 'Operator',
  })}`
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

function req(path: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers(init.headers)
  headers.set('cookie', cookie)
  if (init.body) headers.set('content-type', 'application/json')
  return new Request(`http://localhost${path}`, { ...init, headers }) as unknown as NextRequest
}

const params = (value: Record<string, string>) => ({ params: Promise.resolve(value) })

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
  const vb = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  const milestone = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: vb.id } })
  return { ...vb, milestone }
}

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

describe('viewbook PR4 operator routes', () => {
  it('creates https review links and fences milestone ownership', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    const before = await syncVersion(a.id)
    const ok = await createReviewLink(
      req(`/api/viewbooks/${a.id}/milestones/${a.milestone.id}/review-links`, {
        method: 'POST', body: JSON.stringify({ label: 'Homepage', url: 'https://example.com/mockup', kind: 'mockup' }),
      }),
      params({ id: String(a.id), milestoneId: String(a.milestone.id) }),
    )
    expect(ok.status).toBe(201)
    expect(await syncVersion(a.id)).toBe(before + 1)
    const beforeCross = await syncVersion(b.id)
    const cross = await createReviewLink(
      req(`/api/viewbooks/${b.id}/milestones/${a.milestone.id}/review-links`, {
        method: 'POST', body: JSON.stringify({ label: 'Nope', url: 'https://example.com', kind: 'live' }),
      }),
      params({ id: String(b.id), milestoneId: String(a.milestone.id) }),
    )
    expect(cross.status).toBe(404)
    // cross-viewbook milestone ownership fails the guard — no bump
    expect(await syncVersion(b.id)).toBe(beforeCross)
  })

  it('ownership-fences resolve and delete operations', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    const link = await prisma.viewbookReviewLink.create({
      data: { milestoneId: a.milestone.id, label: 'Review', url: 'https://example.com', kind: 'live', createdBy: 'operator@example.com' },
    })
    const feedback = await prisma.viewbookFeedback.create({
      data: { reviewLinkId: link.id, body: 'Looks good', authorKind: 'client' },
    })
    const beforeCrossResolve = await syncVersion(b.id)
    const crossResolve = await resolveFeedback(
      req(`/api/viewbooks/${b.id}/feedback/${feedback.id}/resolve`, { method: 'POST' }),
      params({ id: String(b.id), feedbackId: String(feedback.id) }),
    )
    expect(crossResolve.status).toBe(404)
    expect(await syncVersion(b.id)).toBe(beforeCrossResolve)
    const beforeResolve = await syncVersion(a.id)
    const resolved = await resolveFeedback(
      req(`/api/viewbooks/${a.id}/feedback/${feedback.id}/resolve`, { method: 'POST' }),
      params({ id: String(a.id), feedbackId: String(feedback.id) }),
    )
    expect(resolved.status).toBe(200)
    expect((await prisma.viewbookFeedback.findUniqueOrThrow({ where: { id: feedback.id } })).resolvedBy)
      .toBe('operator@example.com')
    expect(await syncVersion(a.id)).toBe(beforeResolve + 1)
    const beforeCrossDelete = await syncVersion(b.id)
    const crossDelete = await deleteReviewLink(
      req(`/api/viewbooks/${b.id}/review-links/${link.id}`, { method: 'DELETE' }),
      params({ id: String(b.id), reviewLinkId: String(link.id) }),
    )
    expect(crossDelete.status).toBe(404)
    expect(await syncVersion(b.id)).toBe(beforeCrossDelete)
    const beforeDelete = await syncVersion(a.id)
    const deleted = await deleteReviewLink(
      req(`/api/viewbooks/${a.id}/review-links/${link.id}`, { method: 'DELETE' }),
      params({ id: String(a.id), reviewLinkId: String(link.id) }),
    )
    expect(deleted.status).toBe(200)
    expect(await syncVersion(a.id)).toBe(beforeDelete + 1)
  })

  it('returns a cursor-paginated operator activity feed', async () => {
    const vb = await mkViewbook()
    await prisma.viewbookActivity.createMany({
      data: [1, 2, 3].map((n) => ({ viewbookId: vb.id, kind: 'test', actor: 'client', summary: `row ${n}` })),
    })
    const first = await getActivity(
      req(`/api/viewbooks/${vb.id}/activity?limit=2`), params({ id: String(vb.id) }),
    )
    expect(first.status).toBe(200)
    const page = await first.json()
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).toBeTypeOf('number')
  })
})

describe('milestone description threading (Task 3)', () => {
  it('POST /milestones threads description into the created row', async () => {
    const vb = await mkViewbook()
    const res = await createMilestoneRoute(
      req(`/api/viewbooks/${vb.id}/milestones`, {
        method: 'POST',
        body: JSON.stringify({ title: 'Detail phase', sortOrder: 20, description: 'Extra detail copy.' }),
      }),
      params({ id: String(vb.id) }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.milestone.description).toBe('Extra detail copy.')
  })

  it('PATCH /milestones/:id threads description; an over-cap value 400s', async () => {
    const vb = await mkViewbook()
    const ok = await updateMilestoneRoute(
      req(`/api/viewbooks/${vb.id}/milestones/${vb.milestone.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: 'Updated description' }),
      }),
      params({ id: String(vb.id), milestoneId: String(vb.milestone.id) }),
    )
    expect(ok.status).toBe(200)
    const okBody = await ok.json()
    expect(okBody.milestone.description).toBe('Updated description')

    const before = await syncVersion(vb.id)
    const bad = await updateMilestoneRoute(
      req(`/api/viewbooks/${vb.id}/milestones/${vb.milestone.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: 'x'.repeat(2001) }),
      }),
      params({ id: String(vb.id), milestoneId: String(vb.milestone.id) }),
    )
    expect(bad.status).toBe(400)
    expect(await syncVersion(vb.id)).toBe(before)
  })
})
