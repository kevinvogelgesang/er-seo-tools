import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { createViewbook } from '@/lib/viewbook/service'
import { PATCH as assignCsm } from './[id]/csm/route'

const PREFIX = 'vb-csm-route-test-'
const OPERATOR = 'kevin@enrollmentresources.com'
const savedEnv: Record<string, string | undefined> = {}
let cookie: string

beforeAll(async () => {
  for (const key of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET']) savedEnv[key] = process.env[key]
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  cookie = `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({
    sub: 'google:csm-route', email: OPERATOR, hd: 'enrollmentresources.com', name: 'Kevin',
  })}`
  await prisma.viewbookGlobalContent.upsert({
    where: { key: 'team' },
    update: { bodyJson: JSON.stringify([{ name: 'Casey CSM', role: 'CSM', photo: null, blurb: '', isCsm: true, email: 'casey@example.com' }]), updatedBy: OPERATOR },
    create: { key: 'team', bodyJson: JSON.stringify([{ name: 'Casey CSM', role: 'CSM', photo: null, blurb: '', isCsm: true, email: 'casey@example.com' }]), updatedBy: OPERATOR },
  })
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
  await prisma.viewbookGlobalContent.deleteMany({ where: { key: 'team', updatedBy: OPERATOR } })
})

function req(url: string, init: RequestInit & { auth?: boolean } = {}): NextRequest {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (init.auth !== false) headers.set('cookie', cookie)
  return new Request(`http://localhost${url}`, { ...init, headers }) as unknown as NextRequest
}

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) })

async function makeViewbook() {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const viewbook = await createViewbook(client.id, 'upgrade', OPERATOR)
  return { client, ...viewbook }
}

describe('PATCH /api/viewbooks/:id/csm', () => {
  it('assigns a valid flagged CSM', async () => {
    const { id } = await makeViewbook()
    const response = await assignCsm(
      req(`/api/viewbooks/${id}/csm`, { method: 'PATCH', body: JSON.stringify({ csmName: 'Casey CSM' }) }),
      params(id),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect((await prisma.viewbook.findUniqueOrThrow({ where: { id } })).csmName).toBe('Casey CSM')
  })

  it('401s without a signed operator cookie', async () => {
    const { id } = await makeViewbook()
    const response = await assignCsm(
      req(`/api/viewbooks/${id}/csm`, { method: 'PATCH', auth: false, body: JSON.stringify({ csmName: null }) }),
      params(id),
    )
    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe('auth_required')
  })

  it('404s for an unknown viewbook', async () => {
    const response = await assignCsm(
      req('/api/viewbooks/999999999/csm', { method: 'PATCH', body: JSON.stringify({ csmName: null }) }),
      params(999_999_999),
    )
    expect(response.status).toBe(404)
  })

  it('400s for an invalid or absent CSM', async () => {
    const { id } = await makeViewbook()
    for (const body of [{ csmName: 'Nobody' }, { csmName: 42 }, {}]) {
      const response = await assignCsm(
        req(`/api/viewbooks/${id}/csm`, { method: 'PATCH', body: JSON.stringify(body) }),
        params(id),
      )
      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe('invalid_csm')
    }
  })

  it('409s when the owning client is archived', async () => {
    const { id, client } = await makeViewbook()
    await prisma.client.update({ where: { id: client.id }, data: { archivedAt: new Date() } })
    const response = await assignCsm(
      req(`/api/viewbooks/${id}/csm`, { method: 'PATCH', body: JSON.stringify({ csmName: 'Casey CSM' }) }),
      params(id),
    )
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe('client_archived')
  })
})
