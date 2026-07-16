import crypto from 'crypto'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { MAX_DOC_BYTES } from '@/lib/viewbook/assets'
import { createViewbook } from '@/lib/viewbook/service'
import { GET as getGlobal, POST as postGlobal } from './route'
import { DELETE as deleteGlobal } from './[docId]/route'
import { GET as getOwn, POST as postOwn } from '../viewbooks/[id]/docs/route'
import { DELETE as deleteOwn } from '../viewbooks/[id]/docs/[docId]/route'

const PREFIX = 'vb-doc-route-'
const PDF = new File([Buffer.from('%PDF-1.7\nroute')], 'guide.pdf', { type: 'application/pdf' })
const savedEnv: Record<string, string | undefined> = {}
let cookie: string
let assetsDir: string

beforeAll(async () => {
  for (const key of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET', 'VIEWBOOK_ASSETS_DIR']) savedEnv[key] = process.env[key]
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  assetsDir = await mkdtemp(path.join(tmpdir(), PREFIX))
  process.env.VIEWBOOK_ASSETS_DIR = assetsDir
  cookie = `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({
    sub: 'google:docs', email: `${PREFIX}operator@example.com`, hd: 'example.com', name: 'Operator',
  })}`
})

afterAll(async () => {
  await prisma.viewbookDoc.deleteMany({ where: { createdBy: `${PREFIX}operator@example.com` } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(assetsDir, { recursive: true, force: true })
})

const params = (value: Record<string, string>) => ({ params: Promise.resolve(value) })

function request(pathname: string, init: RequestInit = {}, authenticated = true): NextRequest {
  const headers = new Headers(init.headers)
  if (authenticated) headers.set('cookie', cookie)
  return new Request(`http://localhost${pathname}`, { ...init, headers }) as unknown as NextRequest
}

function uploadRequest(pathname: string, options: { file?: File; contentLength?: string; authenticated?: boolean } = {}) {
  const form = new FormData()
  form.set('title', `${PREFIX}${crypto.randomUUID()}`)
  form.set('blurb', 'Route test blurb')
  form.set('file', options.file ?? PDF)
  const headers = new Headers()
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength)
  return request(pathname, { method: 'POST', headers, body: form }, options.authenticated ?? true)
}

async function mkViewbook(archived = false) {
  const client = await prisma.client.create({ data: { name: `${PREFIX}${crypto.randomUUID()}` } })
  const viewbook = await createViewbook(client.id, 'upgrade', `${PREFIX}operator@example.com`)
  if (archived) await prisma.client.update({ where: { id: client.id }, data: { archivedAt: new Date() } })
  return { ...viewbook, clientId: client.id }
}

describe('viewbook document routes', () => {
  it('supports authenticated global CRUD and rejects unauthenticated GET/POST/DELETE', async () => {
    expect((await getGlobal(request('/api/viewbook-docs', {}, false))).status).toBe(401)
    expect((await postGlobal(uploadRequest('/api/viewbook-docs', { contentLength: '1024', authenticated: false }))).status).toBe(401)

    const created = await postGlobal(uploadRequest('/api/viewbook-docs', { contentLength: '1024' }))
    expect(created.status).toBe(201)
    const { doc } = await created.json()
    const listed = await getGlobal(request('/api/viewbook-docs'))
    expect(listed.status).toBe(200)
    expect((await listed.json()).docs).toContainEqual(expect.objectContaining({ id: doc.id, blurb: 'Route test blurb' }))

    expect((await deleteGlobal(
      request(`/api/viewbook-docs/${doc.id}`, { method: 'DELETE' }, false),
      params({ docId: String(doc.id) }),
    )).status).toBe(401)
    expect((await deleteGlobal(
      request(`/api/viewbook-docs/${doc.id}`, { method: 'DELETE' }),
      params({ docId: String(doc.id) }),
    )).status).toBe(200)
  })

  it('supports authenticated per-viewbook CRUD', async () => {
    const vb = await mkViewbook()
    expect((await getOwn(
      request(`/api/viewbooks/${vb.id}/docs`, {}, false),
      params({ id: String(vb.id) }),
    )).status).toBe(401)
    expect((await postOwn(
      uploadRequest(`/api/viewbooks/${vb.id}/docs`, { contentLength: '1024', authenticated: false }),
      params({ id: String(vb.id) }),
    )).status).toBe(401)
    const created = await postOwn(
      uploadRequest(`/api/viewbooks/${vb.id}/docs`, { contentLength: '1024' }),
      params({ id: String(vb.id) }),
    )
    expect(created.status).toBe(201)
    const { doc } = await created.json()
    const listed = await getOwn(request(`/api/viewbooks/${vb.id}/docs`), params({ id: String(vb.id) }))
    expect(listed.status).toBe(200)
    expect((await listed.json()).docs.own).toContainEqual(expect.objectContaining({ id: doc.id }))
    expect((await deleteOwn(
      request(`/api/viewbooks/${vb.id}/docs/${doc.id}`, { method: 'DELETE' }, false),
      params({ id: String(vb.id), docId: String(doc.id) }),
    )).status).toBe(401)
    expect((await deleteOwn(
      request(`/api/viewbooks/${vb.id}/docs/${doc.id}`, { method: 'DELETE' }),
      params({ id: String(vb.id), docId: String(doc.id) }),
    )).status).toBe(200)
  })

  it('rejects missing/oversized Content-Length before formData and oversized File before arrayBuffer', async () => {
    expect((await postGlobal(uploadRequest('/api/viewbook-docs'))).status).toBe(413)
    expect((await postGlobal(uploadRequest('/api/viewbook-docs', {
      contentLength: String(MAX_DOC_BYTES + 64 * 1024 + 1),
    }))).status).toBe(413)
    const huge = new File([Buffer.alloc(MAX_DOC_BYTES + 1)], 'huge.pdf', { type: 'application/pdf' })
    expect((await postGlobal(uploadRequest('/api/viewbook-docs', {
      contentLength: String(MAX_DOC_BYTES),
      file: huge,
    }))).status).toBe(413)
  })

  it('404s unknown viewbooks for GET, POST, and DELETE', async () => {
    const unknown = '999999999'
    expect((await getOwn(request(`/api/viewbooks/${unknown}/docs`), params({ id: unknown }))).status).toBe(404)
    expect((await postOwn(
      uploadRequest(`/api/viewbooks/${unknown}/docs`, { contentLength: '1024' }),
      params({ id: unknown }),
    )).status).toBe(404)
    expect((await deleteOwn(
      request(`/api/viewbooks/${unknown}/docs/1`, { method: 'DELETE' }),
      params({ id: unknown, docId: '1' }),
    )).status).toBe(404)
  })

  it('409s per-viewbook POST and DELETE when the client is archived', async () => {
    const vb = await mkViewbook()
    const created = await postOwn(
      uploadRequest(`/api/viewbooks/${vb.id}/docs`, { contentLength: '1024' }),
      params({ id: String(vb.id) }),
    )
    const { doc } = await created.json()
    await prisma.client.update({ where: { id: vb.clientId }, data: { archivedAt: new Date() } })
    expect((await postOwn(
      uploadRequest(`/api/viewbooks/${vb.id}/docs`, { contentLength: '1024' }),
      params({ id: String(vb.id) }),
    )).status).toBe(409)
    expect((await deleteOwn(
      request(`/api/viewbooks/${vb.id}/docs/${doc.id}`, { method: 'DELETE' }),
      params({ id: String(vb.id), docId: String(doc.id) }),
    )).status).toBe(409)
  })
})
