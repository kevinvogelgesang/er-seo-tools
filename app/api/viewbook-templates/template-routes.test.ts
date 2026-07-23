// Route-level tests for the viewbook template-admin API (F1b, Task 8):
// auth gating, the 13-section tree read, version-guard 409 envelopes,
// resolve-and-check 404s (subsection-under-wrong-section,
// field-under-wrong-subsection), the photo route's multipart validation, and
// fieldKey immutability. Convention (mirrors
// app/api/viewbooks/[id]/section-copy/[sectionKey]/route.test.ts): ONLY
// requireOperatorEmail is mocked — every service call underneath is REAL and
// DB-backed, so the tree/version/conflict assertions exercise the actual
// template-service (Tasks 3-7), not a stub.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.mock('@/lib/viewbook/operator', () => ({ requireOperatorEmail: vi.fn(async () => 'op@er.com') }))

import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { seedViewbookTemplates, CANONICAL_SECTION_ORDER } from '@/lib/viewbook/template-seed'
import { GLOBAL_CONTENT_KEYS } from '@/lib/viewbook/global-content-keys'
import { SECTION_KEYS } from '@/lib/viewbook/theme'
import { sectionCopyKey } from '@/lib/viewbook/section-copy-content'
import { RECONCILE_MARKER_KEY, getTemplateTree } from '@/lib/viewbook/template-service'

import { GET as getTree } from './route'
import { PATCH as patchSection } from './sections/[id]/route'
import { POST as createSubsectionRoute } from './sections/[id]/subsections/route'
import { PATCH as patchSubsectionRoute } from './sections/[id]/subsections/[subId]/route'
import { POST as photoRoute } from './sections/[id]/photo/route'
import { POST as createFieldRoute } from './subsections/[id]/fields/route'
import { PATCH as patchFieldRoute } from './subsections/[id]/fields/[fieldId]/route'
import { POST as reorderRoute } from './reorder/route'

const SEED_KEYS = [...GLOBAL_CONTENT_KEYS, ...SECTION_KEYS.map(sectionCopyKey)]

async function cleanTemplates() {
  await prisma.fieldTemplate.deleteMany({})
  await prisma.subsectionTemplate.deleteMany({})
  await prisma.sectionTemplate.deleteMany({})
  await prisma.viewbookGlobalContent.deleteMany({ where: { key: { in: [...SEED_KEYS, RECONCILE_MARKER_KEY] } } })
}

beforeEach(async () => {
  vi.mocked(requireOperatorEmail).mockReset()
  vi.mocked(requireOperatorEmail).mockImplementation(async () => 'op@er.com')
  await cleanTemplates()
  await seedViewbookTemplates()
})
afterAll(cleanTemplates)

function req(url: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${url}`, init)
}
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) })

describe('viewbook-templates routes', () => {
  it('unauthenticated request (mocked requireOperatorEmail throws) -> 401 auth_required envelope', async () => {
    vi.mocked(requireOperatorEmail).mockRejectedValueOnce(new HttpError(401, 'auth_required'))
    const res = await getTree(req('/api/viewbook-templates') as any)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('auth_required')
  })

  it('GET /api/viewbook-templates returns the 13-section tree', async () => {
    const res = await getTree(req('/api/viewbook-templates') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sections.map((s: { templateKey: string }) => s.templateKey)).toEqual([...CANONICAL_SECTION_ORDER])
  })

  it('PATCH section: happy path 200, then the now-stale version -> 409 version_conflict envelope', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find((x) => x.templateKey === 'brand')!

    const ok = await patchSection(
      req(`/api/viewbook-templates/sections/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: s.version, title: 'Brand identity' }),
      }) as any,
      params({ id: String(s.id) }) as any,
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true })

    const stale = await patchSection(
      req(`/api/viewbook-templates/sections/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: s.version, title: 'Nope' }), // stale — the happy edit above bumped it
      }) as any,
      params({ id: String(s.id) }) as any,
    )
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'version_conflict' })
  })

  it('POST subsection under a section creates a row (happy path)', async () => {
    const { sections } = await getTemplateTree()
    const brand = sections.find((x) => x.templateKey === 'brand')!
    const res = await createSubsectionRoute(
      req(`/api/viewbook-templates/sections/${brand.id}/subsections`, {
        method: 'POST',
        body: JSON.stringify({ version: brand.version, subsectionKey: 'va-notes', title: 'VA notes' }),
      }) as any,
      params({ id: String(brand.id) }) as any,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const after = await getTemplateTree()
    const b2 = after.sections.find((x) => x.templateKey === 'brand')!
    expect(b2.subsections.some((sub) => sub.subsectionKey === 'va-notes')).toBe(true)
  })

  it('PATCH subsection under the wrong section id -> 404', async () => {
    const { sections } = await getTemplateTree()
    const brand = sections.find((x) => x.templateKey === 'brand')!
    const welcome = sections.find((x) => x.templateKey === 'welcome')!
    const brandSub = brand.subsections[0]

    const res = await patchSubsectionRoute(
      req(`/api/viewbook-templates/sections/${welcome.id}/subsections/${brandSub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: welcome.version, title: 'Nope' }),
      }) as any,
      params({ id: String(welcome.id), subId: String(brandSub.id) }) as any,
    )
    expect(res.status).toBe(404)
  })

  it('PATCH subsection under its real section is a happy 200', async () => {
    const { sections } = await getTemplateTree()
    const brand = sections.find((x) => x.templateKey === 'brand')!
    const brandSub = brand.subsections[0]
    const res = await patchSubsectionRoute(
      req(`/api/viewbook-templates/sections/${brand.id}/subsections/${brandSub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: brand.version, title: 'Overview' }),
      }) as any,
      params({ id: String(brand.id), subId: String(brandSub.id) }) as any,
    )
    expect(res.status).toBe(200)
  })

  it('POST photo: missing file -> 400 invalid_upload', async () => {
    const { sections } = await getTemplateTree()
    const welcome = sections.find((x) => x.templateKey === 'welcome')!
    const form = new FormData()
    form.set('memberName', 'A')
    form.set('version', String(welcome.version))
    const headers = new Headers({ 'content-length': '1024' })
    const res = await photoRoute(
      new Request(`http://localhost/api/viewbook-templates/sections/${welcome.id}/photo`, {
        method: 'POST',
        headers,
        body: form,
      }) as any,
      params({ id: String(welcome.id) }) as any,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_upload')
  })

  it('POST field creates a field (happy path)', async () => {
    const { sections } = await getTemplateTree()
    const ds = sections.find((x) => x.templateKey === 'data-source')!
    const sub = ds.subsections[0]
    const res = await createFieldRoute(
      req(`/api/viewbook-templates/subsections/${sub.id}/fields`, {
        method: 'POST',
        body: JSON.stringify({ version: ds.version, fieldKey: 'va-hours', label: 'VA hours', fieldType: 'text' }),
      }) as any,
      params({ id: String(sub.id) }) as any,
    )
    expect(res.status).toBe(200)
  })

  it('PATCH field with a fieldKey property in the body -> 400 invalid_content (immutability)', async () => {
    const { sections } = await getTemplateTree()
    const ds = sections.find((x) => x.templateKey === 'data-source')!
    const sub = ds.subsections[0]
    const field = sub.fields[0]
    const res = await patchFieldRoute(
      req(`/api/viewbook-templates/subsections/${sub.id}/fields/${field.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: ds.version, fieldKey: 'nope' }),
      }) as any,
      params({ id: String(sub.id), fieldId: String(field.id) }) as any,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_content')
  })

  it('PATCH field under the wrong subsection id -> 404', async () => {
    const { sections } = await getTemplateTree()
    const ds = sections.find((x) => x.templateKey === 'data-source')!
    const otherSub = sections.find((x) => x.templateKey === 'brand')!.subsections[0]
    const field = ds.subsections[0].fields[0]
    const res = await patchFieldRoute(
      req(`/api/viewbook-templates/subsections/${otherSub.id}/fields/${field.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ version: ds.version, label: 'X' }),
      }) as any,
      params({ id: String(otherSub.id), fieldId: String(field.id) }) as any,
    )
    expect(res.status).toBe(404)
  })

  it('POST reorder swaps sortOrder (happy path)', async () => {
    const { sections } = await getTemplateTree()
    const [a, b] = sections
    const res = await reorderRoute(
      req('/api/viewbook-templates/reorder', {
        method: 'POST',
        body: JSON.stringify({
          items: [
            { id: a.id, version: a.version, sortOrder: b.sortOrder },
            { id: b.id, version: b.version, sortOrder: a.sortOrder },
          ],
        }),
      }) as any,
    )
    expect(res.status).toBe(200)
    const after = await getTemplateTree()
    expect(after.sections[0].id).toBe(b.id)
  })
})
