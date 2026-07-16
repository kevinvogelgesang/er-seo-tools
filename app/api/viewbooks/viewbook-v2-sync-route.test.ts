// Route-level tests for the v2 PR2 admin sync-version read route: real
// signed session cookies, not mocked operator auth — mirrors
// viewbook-v2-stage-route.test.ts's harness exactly.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { POST as createViewbookRoute } from './route'
import { GET as getSync } from './[id]/sync/route'

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

describe('GET /api/viewbooks/:id/sync', () => {
  it('200 with the current syncVersion', async () => {
    const { id } = await mkViewbook()
    const res = await getSync(req(`/api/viewbooks/${id}/sync`), params({ id: String(id) }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ v: expect.any(Number) })
  })

  it('404 unknown id', async () => {
    const res = await getSync(req('/api/viewbooks/999999999/sync'), params({ id: '999999999' }))
    expect(res.status).toBe(404)
  })
})
