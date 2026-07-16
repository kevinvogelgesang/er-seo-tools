// Route-level tests for the viewbook admin API (Codex plan fix 14):
// malformed JSON, strict id parsing, session-derived attribution, validation
// envelopes, multipart attachment behavior. Handlers are invoked directly
// with Request objects; auth is exercised through REAL signed cookies
// (APP_AUTH_PASSWORD/SECRET set → dev bypass off).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { readViewbookAsset } from '@/lib/viewbook/assets'
import { parseStoredTheme } from '@/lib/viewbook/theme'
import { GET as listViewbooks, POST as createViewbookRoute } from './route'
import { GET as getViewbook, PATCH as patchViewbook } from './[id]/route'
import { POST as attachAsset } from './[id]/assets/route'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])

let cookie: string
let assetsDir: string
const savedEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  for (const k of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET', 'VIEWBOOK_ASSETS_DIR']) savedEnv[k] = process.env[k]
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-routes-'))
  process.env.VIEWBOOK_ASSETS_DIR = assetsDir
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
  await rm(assetsDir, { recursive: true, force: true })
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

describe('viewbook admin routes', () => {
  it('POST /api/viewbooks: malformed JSON 400, bad body 400, no session 401, happy 201', async () => {
    const bad = await createViewbookRoute(req('/api/viewbooks', { method: 'POST', body: '{nope' }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_json')

    const invalid = await createViewbookRoute(
      req('/api/viewbooks', { method: 'POST', body: JSON.stringify({ clientId: -1, kind: 'upgrade' }) }),
    )
    expect(invalid.status).toBe(400)

    const unauth = await createViewbookRoute(
      req('/api/viewbooks', { method: 'POST', auth: false, body: JSON.stringify({ clientId: 1, kind: 'upgrade' }) }),
    )
    expect(unauth.status).toBe(401)
    expect((await unauth.json()).error).toBe('auth_required')

    const { id } = await mkViewbook()
    expect(id).toBeGreaterThan(0)
    const list = await listViewbooks()
    expect(list.status).toBe(200)
  })

  it('GET/PATCH /api/viewbooks/:id: non-numeric id 404, invalid theme 400', async () => {
    const notFound = await getViewbook(req('/api/viewbooks/abc'), params({ id: 'abc' }))
    expect(notFound.status).toBe(404)

    const { id } = await mkViewbook()
    const badTheme = await patchViewbook(
      req(`/api/viewbooks/${id}`, { method: 'PATCH', body: JSON.stringify({ theme: { bogus: 1 } }) }),
      params({ id: String(id) }),
    )
    expect(badTheme.status).toBe(400)
    expect((await badTheme.json()).error).toBe('invalid_theme')

    const detail = await getViewbook(req(`/api/viewbooks/${id}`), params({ id: String(id) }))
    expect(detail.status).toBe(200)
    const { viewbook } = await detail.json()
    expect(viewbook.fields.length).toBeGreaterThan(0)
  })

  it('POST /api/viewbooks/:id/assets: multipart logo attach stamps theme + file readable', async () => {
    const { id } = await mkViewbook()
    const form = new FormData()
    form.set('kind', 'logo')
    form.set('file', new File([PNG], 'logo.png', { type: 'image/png' }))
    const res = await attachAsset(
      req(`/api/viewbooks/${id}/assets`, { method: 'POST', body: form }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(200)
    const { theme } = await res.json()
    expect(theme.logo).toMatch(/\.png$/)
    const row = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(parseStoredTheme(row.themeJson).logo).toBe(theme.logo)
    expect(await readViewbookAsset(String(id), theme.logo)).not.toBeNull()

    const badForm = new FormData()
    badForm.set('kind', 'hero') // no sectionKey, no file
    const bad = await attachAsset(
      req(`/api/viewbooks/${id}/assets`, { method: 'POST', body: badForm }),
      params({ id: String(id) }),
    )
    expect(bad.status).toBe(400)
  })
})
