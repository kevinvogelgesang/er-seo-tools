import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { createViewbook } from '@/lib/viewbook/service'
import { POST as lockRoute } from './[id]/lock/route'
import { POST as createField } from './[id]/fields/route'
import { DELETE as archiveField, PATCH as patchField } from './[id]/fields/[fieldId]/route'

let cookie: string
const savedEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  for (const key of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET']) savedEnv[key] = process.env[key]
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  cookie = `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({
    sub: 'google:pr3', email: 'operator@example.com', hd: 'example.com', name: 'Operator',
  })}`
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-pr3-admin-' } } })
})

function req(path: string, init: RequestInit & { auth?: boolean } = {}): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) headers.set('cookie', cookie)
  if (init.body) headers.set('content-type', 'application/json')
  return new Request(`http://localhost${path}`, { ...init, headers }) as unknown as NextRequest
}

const params = (value: Record<string, string>) => ({ params: Promise.resolve(value) })

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-test-pr3-admin-${crypto.randomUUID()}` } })
  const viewbook = await createViewbook(client.id, 'upgrade', 'operator@example.com')
  const field = await prisma.viewbookField.findFirstOrThrow({ where: { viewbookId: viewbook.id, fieldType: 'text' } })
  return { ...viewbook, field }
}

describe('viewbook PR3 operator routes', () => {
  it('locks idempotently with session-derived first-writer attribution', async () => {
    const ctx = await mkViewbook()
    const unauth = await lockRoute(
      req(`/api/viewbooks/${ctx.id}/lock`, { method: 'POST', auth: false }), params({ id: String(ctx.id) }),
    )
    expect(unauth.status).toBe(401)
    const first = await lockRoute(
      req(`/api/viewbooks/${ctx.id}/lock`, { method: 'POST' }), params({ id: String(ctx.id) }),
    )
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ dataLockedBy: 'operator@example.com', alreadyLocked: false })
    const replay = await lockRoute(
      req(`/api/viewbooks/${ctx.id}/lock`, { method: 'POST' }), params({ id: String(ctx.id) }),
    )
    expect(await replay.json()).toMatchObject({ dataLockedBy: 'operator@example.com', alreadyLocked: true })
  })

  it('creates validated custom fields pre/post-lock with category-local ordering', async () => {
    const ctx = await mkViewbook()
    await prisma.viewbook.update({
      where: { id: ctx.id }, data: { dataLockedAt: new Date(Date.now() + 1000), dataLockedBy: 'operator@example.com' },
    })
    const created = await createField(req(`/api/viewbooks/${ctx.id}/fields`, {
      method: 'POST', body: JSON.stringify({ label: 'Custom question', fieldType: 'textarea', category: 'school' }),
    }), params({ id: String(ctx.id) }))
    expect(created.status).toBe(201)
    const { field } = await created.json()
    expect(field).toMatchObject({ defKey: null, label: 'Custom question', version: 0, createdBy: 'operator@example.com' })
    const locked = await prisma.viewbook.findUniqueOrThrow({ where: { id: ctx.id } })
    expect(new Date(field.createdAt).getTime()).toBeGreaterThan(locked.dataLockedAt!.getTime())

    const invalid = await createField(req(`/api/viewbooks/${ctx.id}/fields`, {
      method: 'POST', body: JSON.stringify({ label: '', fieldType: 'bogus', category: 'nope' }),
    }), params({ id: String(ctx.id) }))
    expect(invalid.status).toBe(400)
  })

  it('edits answers, relabels custom fields only, and creates operator amendments', async () => {
    const ctx = await mkViewbook()
    const edited = await patchField(req(`/api/viewbooks/${ctx.id}/fields/${ctx.field.id}`, {
      method: 'PATCH', body: JSON.stringify({ value: 'Operator answer', expectedVersion: 0 }),
    }), params({ id: String(ctx.id), fieldId: String(ctx.field.id) }))
    expect(edited.status).toBe(200)
    expect((await edited.json()).field).toMatchObject({ value: 'Operator answer', version: 1, valueUpdatedBy: 'operator@example.com' })

    const catalogRelabel = await patchField(req(`/api/viewbooks/${ctx.id}/fields/${ctx.field.id}`, {
      method: 'PATCH', body: JSON.stringify({ label: 'Nope' }),
    }), params({ id: String(ctx.id), fieldId: String(ctx.field.id) }))
    expect(catalogRelabel.status).toBe(400)

    const custom = await prisma.viewbookField.create({
      data: { viewbookId: ctx.id, category: 'school', label: 'Old label', fieldType: 'text', sortOrder: 999, createdBy: 'operator@example.com' },
    })
    const relabeled = await patchField(req(`/api/viewbooks/${ctx.id}/fields/${custom.id}`, {
      method: 'PATCH', body: JSON.stringify({ label: 'New label' }),
    }), params({ id: String(ctx.id), fieldId: String(custom.id) }))
    expect(relabeled.status).toBe(200)
    expect((await relabeled.json()).field.label).toBe('New label')

    await lockRoute(req(`/api/viewbooks/${ctx.id}/lock`, { method: 'POST' }), params({ id: String(ctx.id) }))
    const amended = await patchField(req(`/api/viewbooks/${ctx.id}/fields/${ctx.field.id}`, {
      method: 'PATCH', body: JSON.stringify({
        mode: 'amend', value: 'Operator amendment', clientMutationId: crypto.randomUUID(),
      }),
    }), params({ id: String(ctx.id), fieldId: String(ctx.field.id) }))
    expect(amended.status).toBe(201)
    expect((await amended.json()).amendment.author).toBe('operator@example.com')
  })

  it('soft-archives with ownership fencing', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    const cross = await archiveField(
      req(`/api/viewbooks/${b.id}/fields/${a.field.id}`, { method: 'DELETE' }),
      params({ id: String(b.id), fieldId: String(a.field.id) }),
    )
    expect(cross.status).toBe(404)
    const archived = await archiveField(
      req(`/api/viewbooks/${a.id}/fields/${a.field.id}`, { method: 'DELETE' }),
      params({ id: String(a.id), fieldId: String(a.field.id) }),
    )
    expect(archived.status).toBe(200)
    expect((await prisma.viewbookField.findUniqueOrThrow({ where: { id: a.field.id } })).archivedAt).toBeInstanceOf(Date)
  })
})
