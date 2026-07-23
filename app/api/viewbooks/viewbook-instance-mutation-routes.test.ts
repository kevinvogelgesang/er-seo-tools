// F2 (Task 4): route-level coverage for the instance-mutation cutover —
// the section PATCH route's mixed-body 400, the new subsections PATCH
// route, and the field routes' aggregate bump + archiveReason + the
// missing-category-subsection 409 (spec §9, carried from the Task 3 review).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { createViewbook } from '@/lib/viewbook/service'
import { PATCH as patchSection } from './[id]/sections/[sectionKey]/route'
import { POST as pullSection } from './[id]/sections/[sectionKey]/pull/route'
import { PATCH as patchSubsection } from './[id]/subsections/[subId]/route'
import { POST as createField } from './[id]/fields/route'
import { DELETE as archiveField, PATCH as patchField } from './[id]/fields/[fieldId]/route'
import { ensureSeededTemplates } from '@/lib/viewbook/__fixtures__/instance-test-helpers'

beforeAll(async () => {
  await ensureSeededTemplates()
})

let cookie: string
const savedEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  for (const key of ['APP_AUTH_PASSWORD', 'APP_AUTH_SECRET']) savedEnv[key] = process.env[key]
  process.env.APP_AUTH_PASSWORD = 'test-password'
  process.env.APP_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
  cookie = `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({
    sub: 'google:t4', email: 'operator@example.com', hd: 'example.com', name: 'Operator',
  })}`
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-t4-' } } })
})

function req(path: string, init: RequestInit & { auth?: boolean } = {}): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) headers.set('cookie', cookie)
  if (init.body) headers.set('content-type', 'application/json')
  return new Request(`http://localhost${path}`, { ...init, headers }) as unknown as NextRequest
}

const params = (value: Record<string, string>) => ({ params: Promise.resolve(value) })

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vb-test-t4-${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'upgrade', 'operator@example.com')
}

async function syncVersion(viewbookId: number): Promise<number> {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbookId } })).syncVersion
}

async function getSection(viewbookId: number, sectionKey: string) {
  return prisma.viewbookSection.findUniqueOrThrow({ where: { viewbookId_sectionKey: { viewbookId, sectionKey } } })
}

describe('PATCH /api/viewbooks/:id/sections/:sectionKey — instance path + mixed-body rejection', () => {
  it('title/copy switches to the fenced instance path', async () => {
    const { id } = await mkViewbook()
    const before = await getSection(id, 'brand')
    const res = await patchSection(
      req(`/api/viewbooks/${id}/sections/brand`, {
        method: 'PATCH',
        body: JSON.stringify({ version: before.version, title: 'Route Title' }),
      }),
      params({ id: String(id), sectionKey: 'brand' }),
    )
    expect(res.status).toBe(200)
    const after = await getSection(id, 'brand')
    expect(after.title).toBe('Route Title')
    expect(after.version).toBe(before.version + 1)
  })

  it('a body mixing state AND instance keys is 400 invalid_field', async () => {
    const { id } = await mkViewbook()
    const before = await getSection(id, 'brand')
    const beforeSync = await syncVersion(id)
    const res = await patchSection(
      req(`/api/viewbooks/${id}/sections/brand`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'hidden', title: 'Nope', version: before.version }),
      }),
      params({ id: String(id), sectionKey: 'brand' }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_field')
    expect((await getSection(id, 'brand')).version).toBe(before.version)
    expect(await syncVersion(id)).toBe(beforeSync)
  })

  it('the state path is unaffected (today\'s unfenced semantics)', async () => {
    const { id } = await mkViewbook()
    const res = await patchSection(
      req(`/api/viewbooks/${id}/sections/brand`, { method: 'PATCH', body: JSON.stringify({ state: 'hidden' }) }),
      params({ id: String(id), sectionKey: 'brand' }),
    )
    expect(res.status).toBe(200)
    expect((await getSection(id, 'brand')).state).toBe('hidden')
  })
})

describe('PATCH /api/viewbooks/:id/subsections/:subId', () => {
  it('patches copy, fenced on the subsection version, bumping the owning section once', async () => {
    const { id } = await mkViewbook()
    const section = await getSection(id, 'brand')
    const sub = await prisma.viewbookSubsection.findFirstOrThrow({ where: { viewbookId: id, subsectionKey: 'main', sectionId: section.id } })
    const res = await patchSubsection(
      req(`/api/viewbooks/${id}/subsections/${sub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: sub.version, copy: { intro: 'Hello', whatWeNeed: null } }),
      }),
      params({ id: String(id), subId: String(sub.id) }),
    )
    expect(res.status).toBe(200)
    const afterSub = await prisma.viewbookSubsection.findUniqueOrThrow({ where: { id: sub.id } })
    const afterSection = await getSection(id, 'brand')
    expect(JSON.parse(afterSub.copyJson!).copy.intro).toBe('Hello')
    expect(afterSub.version).toBe(sub.version + 1)
    expect(afterSection.version).toBe(section.version + 1)
  })

  it('cross-viewbook subId is an indistinguishable 404', async () => {
    const a = await mkViewbook()
    const b = await mkViewbook()
    const bSection = await getSection(b.id, 'brand')
    const bSub = await prisma.viewbookSubsection.findFirstOrThrow({ where: { viewbookId: b.id, subsectionKey: 'main', sectionId: bSection.id } })
    const res = await patchSubsection(
      req(`/api/viewbooks/${a.id}/subsections/${bSub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: bSub.version, title: 'Hijack' }),
      }),
      params({ id: String(a.id), subId: String(bSub.id) }),
    )
    expect(res.status).toBe(404)
  })
})

describe('field routes — aggregate bump + archiveReason (F2 Task 4)', () => {
  it('POST create bumps the data-source section aggregate exactly once', async () => {
    const { id } = await mkViewbook()
    const dataSource = await getSection(id, 'data-source')
    const res = await createField(
      req(`/api/viewbooks/${id}/fields`, {
        method: 'POST',
        body: JSON.stringify({ label: 'Custom question', fieldType: 'textarea', category: 'school' }),
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(201)
    const after = await getSection(id, 'data-source')
    expect(after.version).toBe(dataSource.version + 1)
  })

  it('client archived in the race window between the precondition reads and the txn leaves version+syncVersion untouched (Fix round 1, Finding 1)', async () => {
    const { id } = await mkViewbook()
    const viewbookRow = await prisma.viewbook.findUniqueOrThrow({ where: { id }, select: { clientId: true } })
    const dataSource = await getSection(id, 'data-source')
    const beforeSync = await syncVersion(id)

    // Simulate the archived-client race: the subsection lookup (the LAST
    // precondition read before the txn) resolves normally, then — before the
    // txn runs — the client is archived out from under the request. Before
    // the fix, the aggregate bump had no archived-client guard and would
    // still commit a spurious version+syncVersion bump even though the
    // INSERT (which DOES guard on the archived client) inserts zero rows.
    // Reinstall via `mockImplementation`, NOT `mockRestore` — this codebase's
    // convention (lib/viewbook/public-data.test.ts) for prisma model-delegate
    // spies, since `mockRestore`'s captured property descriptor is a proxy
    // artifact here (`value: undefined`) that permanently breaks the method.
    const original = prisma.viewbookSubsection.findFirst.bind(prisma.viewbookSubsection)
    const spy = vi
      .spyOn(prisma.viewbookSubsection, 'findFirst')
      .mockImplementationOnce(async (...args: unknown[]) => {
        const result = await (original as (...a: unknown[]) => Promise<unknown>)(...args)
        await prisma.client.update({ where: { id: viewbookRow.clientId }, data: { archivedAt: new Date() } })
        return result
      })

    try {
      const res = await createField(
        req(`/api/viewbooks/${id}/fields`, {
          method: 'POST',
          body: JSON.stringify({ label: 'Race question', fieldType: 'text', category: 'school' }),
        }),
        params({ id: String(id) }),
      )
      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe('not_found')
    } finally {
      spy.mockImplementation(original)
    }

    expect((await getSection(id, 'data-source')).version).toBe(dataSource.version)
    expect(await syncVersion(id)).toBe(beforeSync)
    const created = await prisma.viewbookField.findMany({ where: { viewbookId: id, label: 'Race question' } })
    expect(created).toHaveLength(0)
  })

  it('POST create 409 conflicting_ops when the category subsection instance is missing', async () => {
    const { id } = await mkViewbook()
    // Simulate a category subsection instance that is missing (e.g. never
    // pulled in / archived away — Task 6/7 territory): delete the row directly.
    const sub = await prisma.viewbookSubsection.findFirstOrThrow({ where: { viewbookId: id, subsectionKey: 'programs' } })
    await prisma.viewbookSubsection.delete({ where: { id: sub.id } })
    const beforeSync = await syncVersion(id)

    const res = await createField(
      req(`/api/viewbooks/${id}/fields`, {
        method: 'POST',
        body: JSON.stringify({ label: 'Custom question', fieldType: 'text', category: 'programs' }),
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('conflicting_ops')
    expect(await syncVersion(id)).toBe(beforeSync)
  })

  it('DELETE archive stamps archiveReason: operator, bumps the aggregate once, and preserves value/amendments', async () => {
    const { id } = await mkViewbook()
    const dataSource = await getSection(id, 'data-source')
    const created = await createField(
      req(`/api/viewbooks/${id}/fields`, {
        method: 'POST',
        body: JSON.stringify({ label: 'Custom question', fieldType: 'text', category: 'school' }),
      }),
      params({ id: String(id) }),
    )
    const { field } = await created.json()

    await patchField(
      req(`/api/viewbooks/${id}/fields/${field.id}`, {
        method: 'PATCH', body: JSON.stringify({ value: 'Kept value', expectedVersion: 0 }),
      }),
      params({ id: String(id), fieldId: String(field.id) }),
    )

    const afterCreate = await getSection(id, 'data-source')
    expect(afterCreate.version).toBe(dataSource.version + 1)

    const archived = await archiveField(
      req(`/api/viewbooks/${id}/fields/${field.id}`, { method: 'DELETE' }),
      params({ id: String(id), fieldId: String(field.id) }),
    )
    expect(archived.status).toBe(200)

    const row = await prisma.viewbookField.findUniqueOrThrow({ where: { id: field.id } })
    expect(row.archivedAt).toBeInstanceOf(Date)
    expect(row.archiveReason).toBe('operator')
    expect(row.value).toBe('Kept value') // value survives archive — never clobbered

    const afterArchive = await getSection(id, 'data-source')
    expect(afterArchive.version).toBe(afterCreate.version + 1)

    // Re-archiving is a clean 404 — no double-bump.
    const beforeReplay = await getSection(id, 'data-source')
    const replay = await archiveField(
      req(`/api/viewbooks/${id}/fields/${field.id}`, { method: 'DELETE' }),
      params({ id: String(id), fieldId: String(field.id) }),
    )
    expect(replay.status).toBe(404)
    expect((await getSection(id, 'data-source')).version).toBe(beforeReplay.version)
  })
})

describe('POST /api/viewbooks/:id/sections/:sectionKey/pull (F2 Task 5)', () => {
  it('pulls the section, returning {summary, section} — an equal-version pull is legal', async () => {
    const { id } = await mkViewbook()
    const before = await getSection(id, 'brand')
    const res = await pullSection(
      req(`/api/viewbooks/${id}/sections/brand/pull`, {
        method: 'POST',
        body: JSON.stringify({ version: before.version }),
      }),
      params({ id: String(id), sectionKey: 'brand' }),
    )
    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload.summary).toEqual({
      subsectionsAdded: 0,
      subsectionsUpdated: 1,
      subsectionsArchived: 0,
      fieldsAdded: 0,
      fieldsUpdated: 0,
      fieldsArchived: 0,
    })
    expect(payload.section.sectionKey).toBe('brand')
    expect(payload.section.version).toBe(before.version + 1)
    expect(Array.isArray(payload.section.subsections)).toBe(true)
  })

  it('stale version → 409 version_conflict envelope', async () => {
    const { id } = await mkViewbook()
    const before = await getSection(id, 'brand')
    const res = await pullSection(
      req(`/api/viewbooks/${id}/sections/brand/pull`, {
        method: 'POST',
        body: JSON.stringify({ version: before.version + 7 }),
      }),
      params({ id: String(id), sectionKey: 'brand' }),
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('version_conflict')
    expect((await getSection(id, 'brand')).version).toBe(before.version)
  })

  it('missing/non-integer version → 400 invalid_content', async () => {
    const { id } = await mkViewbook()
    for (const body of [{}, { version: 'one' }, { version: 1.5 }]) {
      const res = await pullSection(
        req(`/api/viewbooks/${id}/sections/brand/pull`, { method: 'POST', body: JSON.stringify(body) }),
        params({ id: String(id), sectionKey: 'brand' }),
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_content')
    }
  })

  it('no auth cookie → 401', async () => {
    const { id } = await mkViewbook()
    const res = await pullSection(
      req(`/api/viewbooks/${id}/sections/brand/pull`, {
        method: 'POST',
        body: JSON.stringify({ version: 1 }),
        auth: false,
      }),
      params({ id: String(id), sectionKey: 'brand' }),
    )
    expect(res.status).toBe(401)
  })
})
