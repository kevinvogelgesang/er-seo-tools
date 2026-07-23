// Route-level tests for the cookie-gated assessment note/image operator
// routes (Task 5, Lane 4). Handlers invoked directly with Request objects;
// auth exercised through a real signed cookie (APP_AUTH_PASSWORD/SECRET set
// -> dev bypass off), same harness convention as routes.test.ts /
// viewbook-v2-csm-route.test.ts. The persistence/sanitize/bump behavior
// itself is covered by lib/viewbook/assessment-notes.test.ts — these tests
// exercise only the route-layer contract (auth, id parsing, body
// validation, bounded-length gates).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import path from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { createViewbook } from '@/lib/viewbook/service'
import { PATCH as patchNotes } from './[id]/assessment/notes/route'
import { POST as postImage } from './[id]/assessment/images/route'
import { DELETE as deleteImage } from './[id]/assessment/images/[imageId]/route'
import { ensureSeededTemplates } from '@/lib/viewbook/__fixtures__/instance-test-helpers'

// F2 (Task 3): createViewbook snapshots from the template library — seed it
// once per file (idempotent; an earlier file in this worker may have wiped it).
beforeAll(async () => {
  await ensureSeededTemplates()
})

const PREFIX = 'vb-assess-route-'
const OPERATOR = 'kevin@enrollmentresources.com'
const savedEnv: Record<string, string | undefined> = {}
let cookie: string
let assetsDir: string

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

beforeAll(async () => {
  for (const key of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET', 'VIEWBOOK_ASSETS_DIR']) savedEnv[key] = process.env[key]
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-assess-route-'))
  process.env.VIEWBOOK_ASSETS_DIR = assetsDir
  cookie = `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({
    sub: 'google:assess-route',
    email: OPERATOR,
    hd: 'enrollmentresources.com',
    name: 'Kevin',
  })}`
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(assetsDir, { recursive: true, force: true })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

function req(url: string, init: RequestInit & { auth?: boolean } = {}): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) headers.set('cookie', cookie)
  return new Request(`http://localhost${url}`, { ...init, headers }) as unknown as NextRequest
}

function jsonReq(url: string, body: unknown, init: RequestInit & { auth?: boolean; contentLength?: number } = {}) {
  const payload = JSON.stringify(body)
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('content-length', String(init.contentLength ?? Buffer.byteLength(payload, 'utf8')))
  return req(url, { ...init, method: 'PATCH', headers, body: payload })
}

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) })
const imageParams = (id: number | string, imageId: number | string) => ({
  params: Promise.resolve({ id: String(id), imageId: String(imageId) }),
})

async function makeViewbook(): Promise<number> {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const viewbook = await createViewbook(client.id, 'upgrade', OPERATOR)
  return viewbook.id
}

describe('PATCH /api/viewbooks/:id/assessment/notes', () => {
  it('persists sanitized html for a valid field', async () => {
    const id = await makeViewbook()
    const response = await patchNotes(
      jsonReq(`/api/viewbooks/${id}/assessment/notes`, {
        field: 'general',
        html: '<p>General <script>alert(1)</script>notes</p>',
      }),
      params(id),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    const row = await prisma.viewbookAssessmentContent.findUniqueOrThrow({ where: { viewbookId: id } })
    expect(row.generalNotesHtml).toBe('<p>General notes</p>')
  })

  it('persists the userBehaviour field independently', async () => {
    const id = await makeViewbook()
    const response = await patchNotes(
      jsonReq(`/api/viewbooks/${id}/assessment/notes`, { field: 'userBehaviour', html: '<p>Behaviour</p>' }),
      params(id),
    )
    expect(response.status).toBe(200)
    const row = await prisma.viewbookAssessmentContent.findUniqueOrThrow({ where: { viewbookId: id } })
    expect(row.userBehaviourHtml).toBe('<p>Behaviour</p>')
  })

  it('400s on an invalid field enum', async () => {
    const id = await makeViewbook()
    const response = await patchNotes(
      jsonReq(`/api/viewbooks/${id}/assessment/notes`, { field: 'bogus', html: '<p>x</p>' }),
      params(id),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_field')
  })

  it('400s on a non-string html value', async () => {
    const id = await makeViewbook()
    const response = await patchNotes(
      jsonReq(`/api/viewbooks/${id}/assessment/notes`, { field: 'general', html: 123 }),
      params(id),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_html')
  })

  it('413s on an over-cap declared Content-Length before parsing', async () => {
    const id = await makeViewbook()
    const response = await patchNotes(
      jsonReq(
        `/api/viewbooks/${id}/assessment/notes`,
        { field: 'general', html: '<p>x</p>' },
        { contentLength: 64 * 1024 + 1 },
      ),
      params(id),
    )
    expect(response.status).toBe(413)
    expect((await response.json()).error).toBe('payload_too_large')
  })

  it('401s without a signed operator cookie', async () => {
    const id = await makeViewbook()
    const response = await patchNotes(
      jsonReq(`/api/viewbooks/${id}/assessment/notes`, { field: 'general', html: '<p>x</p>' }, { auth: false }),
      params(id),
    )
    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe('auth_required')
  })

  it('404s for a non-numeric id', async () => {
    const response = await patchNotes(
      jsonReq('/api/viewbooks/abc/assessment/notes', { field: 'general', html: '<p>x</p>' }),
      params('abc'),
    )
    expect(response.status).toBe(404)
  })
})

describe('POST /api/viewbooks/:id/assessment/images', () => {
  it('accepts a valid image and returns its filename', async () => {
    const id = await makeViewbook()
    const form = new FormData()
    form.set('file', new File([PNG_1PX], 'note.png', { type: 'image/png' }))
    const response = await postImage(
      req(`/api/viewbooks/${id}/assessment/images`, {
        method: 'POST',
        headers: { 'content-length': String(PNG_1PX.length + 1024) },
        body: form,
      }),
      params(id),
    )
    expect(response.status).toBe(200)
    const { filename } = await response.json()
    expect(filename).toMatch(/\.webp$/)
    const row = await prisma.viewbookAssessmentImage.findFirstOrThrow({ where: { filename } })
    expect(row.filename).toBe(filename)
  })

  it('rejects a non-image upload', async () => {
    const id = await makeViewbook()
    const notAnImage = Buffer.from('not an image')
    const form = new FormData()
    form.set('file', new File([notAnImage], 'note.txt', { type: 'text/plain' }))
    const response = await postImage(
      req(`/api/viewbooks/${id}/assessment/images`, {
        method: 'POST',
        headers: { 'content-length': String(notAnImage.length + 1024) },
        body: form,
      }),
      params(id),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_image')
  })

  it('413s on an over-cap declared Content-Length before buffering', async () => {
    const id = await makeViewbook()
    const form = new FormData()
    form.set('file', new File([PNG_1PX], 'note.png', { type: 'image/png' }))
    const response = await postImage(
      req(`/api/viewbooks/${id}/assessment/images`, {
        method: 'POST',
        headers: { 'content-length': String(10 * 1024 * 1024 + 64 * 1024 + 1) },
        body: form,
      }),
      params(id),
    )
    expect(response.status).toBe(413)
  })

  it('401s without a signed operator cookie', async () => {
    const id = await makeViewbook()
    const form = new FormData()
    form.set('file', new File([PNG_1PX], 'note.png', { type: 'image/png' }))
    const response = await postImage(
      req(`/api/viewbooks/${id}/assessment/images`, {
        method: 'POST',
        auth: false,
        headers: { 'content-length': String(PNG_1PX.length + 1024) },
        body: form,
      }),
      params(id),
    )
    expect(response.status).toBe(401)
  })
})

describe('DELETE /api/viewbooks/:id/assessment/images/:imageId', () => {
  it('deletes an existing image', async () => {
    const id = await makeViewbook()
    const form = new FormData()
    form.set('file', new File([PNG_1PX], 'note.png', { type: 'image/png' }))
    const uploaded = await postImage(
      req(`/api/viewbooks/${id}/assessment/images`, {
        method: 'POST',
        headers: { 'content-length': String(PNG_1PX.length + 1024) },
        body: form,
      }),
      params(id),
    )
    const { filename } = await uploaded.json()
    const row = await prisma.viewbookAssessmentImage.findFirstOrThrow({ where: { filename } })

    const response = await deleteImage(req(`/api/viewbooks/${id}/assessment/images/${row.id}`, { method: 'DELETE' }), imageParams(id, row.id))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(await prisma.viewbookAssessmentImage.findUnique({ where: { id: row.id } })).toBeNull()
  })

  it('404s for a non-numeric imageId', async () => {
    const id = await makeViewbook()
    const response = await deleteImage(
      req(`/api/viewbooks/${id}/assessment/images/abc`, { method: 'DELETE' }),
      imageParams(id, 'abc'),
    )
    expect(response.status).toBe(404)
  })

  it('404s for an unknown imageId', async () => {
    const id = await makeViewbook()
    const response = await deleteImage(
      req(`/api/viewbooks/${id}/assessment/images/999999999`, { method: 'DELETE' }),
      imageParams(id, 999_999_999),
    )
    expect(response.status).toBe(404)
  })

  it('401s without a signed operator cookie', async () => {
    const id = await makeViewbook()
    const response = await deleteImage(
      req(`/api/viewbooks/${id}/assessment/images/1`, { method: 'DELETE', auth: false }),
      imageParams(id, 1),
    )
    expect(response.status).toBe(401)
  })
})
