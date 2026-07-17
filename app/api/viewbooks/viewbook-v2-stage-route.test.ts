// Route-level tests for the v2 PR1 stage-move route (Codex plan fix 8):
// real signed session cookies, not mocked operator auth — mirrors
// routes.test.ts's harness exactly.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { POST as createViewbookRoute } from './route'
import { POST as moveStage } from './[id]/stage/route'

let cookie: string
const savedEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  for (const k of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET']) savedEnv[k] = process.env[k]
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  cookie = `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({
    sub: 'google:1',
    email: 'kevin@enrollmentresources.com',
    hd: 'enrollmentresources.com',
    name: 'Kevin',
  })}`
})
afterAll(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})

function req(url: string, init: RequestInit & { auth?: boolean } = {}): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) headers.set('cookie', cookie)
  return new Request(`http://localhost${url}`, { ...init, headers }) as unknown as NextRequest
}

const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) })

async function mkViewbook(): Promise<{ clientId: number; id: number }> {
  const c = await prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
  const res = await createViewbookRoute(
    req('/api/viewbooks', { method: 'POST', body: JSON.stringify({ clientId: c.id, kind: 'upgrade' }) }),
  )
  expect(res.status).toBe(201)
  const { viewbook } = await res.json()
  return { clientId: c.id, id: viewbook.id }
}

describe('POST /api/viewbooks/:id/stage', () => {
  it('200 forward move', async () => {
    const { id } = await mkViewbook()
    await prisma.viewbook.update({ where: { id }, data: { stage: 'kickoff' } })
    const res = await moveStage(
      req(`/api/viewbooks/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify({ direction: 'forward', expectedStage: 'kickoff' }),
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(200)
    const { stage } = await res.json()
    expect(stage).toBe('website-specifics')
  })

  it('409 at the boundary (building has no next)', async () => {
    const { id } = await mkViewbook()
    const res = await moveStage(
      req(`/api/viewbooks/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify({ direction: 'forward', expectedStage: 'building' }),
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(409)
  })

  it('400 on bad/missing direction or expectedStage', async () => {
    const { id } = await mkViewbook()
    const badDirection = await moveStage(
      req(`/api/viewbooks/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify({ direction: 'sideways', expectedStage: 'building' }),
      }),
      params({ id: String(id) }),
    )
    expect(badDirection.status).toBe(400)

    const missingDirection = await moveStage(
      req(`/api/viewbooks/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify({ expectedStage: 'building' }),
      }),
      params({ id: String(id) }),
    )
    expect(missingDirection.status).toBe(400)

    const badStage = await moveStage(
      req(`/api/viewbooks/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify({ direction: 'forward', expectedStage: 'nope' }),
      }),
      params({ id: String(id) }),
    )
    expect(badStage.status).toBe(400)

    const missingStage = await moveStage(
      req(`/api/viewbooks/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify({ direction: 'forward' }),
      }),
      params({ id: String(id) }),
    )
    expect(missingStage.status).toBe(400)
  })

  it('401 unauthenticated', async () => {
    const { id } = await mkViewbook()
    const res = await moveStage(
      req(`/api/viewbooks/${id}/stage`, {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ direction: 'forward', expectedStage: 'building' }),
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('auth_required')
  })

  it('404 unknown id', async () => {
    const res = await moveStage(
      req('/api/viewbooks/999999999/stage', {
        method: 'POST',
        body: JSON.stringify({ direction: 'forward', expectedStage: 'building' }),
      }),
      params({ id: '999999999' }),
    )
    expect(res.status).toBe(404)
  })

  it('409 on stale expectedStage', async () => {
    const { id } = await mkViewbook() // stage: building
    const res = await moveStage(
      req(`/api/viewbooks/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify({ direction: 'back', expectedStage: 'kickoff' }),
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(409)
  })

  // Task 6: force + the ack-to-stage forward fence.
  it('409 ack_incomplete advancing out of post-contract without force', async () => {
    const { id } = await mkViewbook()
    await prisma.viewbook.update({ where: { id }, data: { stage: 'post-contract' } })
    const res = await moveStage(
      req(`/api/viewbooks/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify({ direction: 'forward', expectedStage: 'post-contract' }),
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('ack_incomplete')
  })

  it('parses and threads body.force through to moveViewbookStage, bypassing the fence', async () => {
    const { id } = await mkViewbook()
    await prisma.viewbook.update({ where: { id }, data: { stage: 'post-contract' } })
    const res = await moveStage(
      req(`/api/viewbooks/${id}/stage`, {
        method: 'POST',
        body: JSON.stringify({ direction: 'forward', expectedStage: 'post-contract', force: true }),
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(200)
    const { stage } = await res.json()
    expect(stage).toBe('kickoff')
    const vb = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(vb.pcCompletedAt).not.toBeNull()
  })
})
