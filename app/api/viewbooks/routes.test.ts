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
import sharp from 'sharp'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { AUTH_COOKIE_NAME, createAuthCookieValue } from '@/lib/auth'
import { MAX_ASSET_BYTES, readViewbookAsset } from '@/lib/viewbook/assets'
import { parseStoredTheme } from '@/lib/viewbook/theme'
import { addAssessmentImage } from '@/lib/viewbook/assessment-notes'
import { GET as listViewbooks, POST as createViewbookRoute } from './route'
import { GET as getViewbook, PATCH as patchViewbook, DELETE as deleteViewbookRoute } from './[id]/route'
import { POST as attachAsset } from './[id]/assets/route'
import { ensureSeededTemplates } from '@/lib/viewbook/__fixtures__/instance-test-helpers'

// F2 (Task 3): createViewbook snapshots from the template library — seed it
// once per file (idempotent; an earlier file in this worker may have wiped it).
beforeAll(async () => {
  await ensureSeededTemplates()
})

// Real tiny PNG — the assets route decodes every upload via sharp now, so the
// old "PNG magic + zero bytes" fake is correctly rejected as invalid_image.
let PNG: Buffer

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
  PNG = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toBuffer()
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

  it('POST /api/viewbooks: offerings validated + threaded; GET index carries availability (F2)', async () => {
    // Non-boolean offering value → 400 before the service runs.
    const nonBoolean = await createViewbookRoute(
      req('/api/viewbooks', {
        method: 'POST',
        body: JSON.stringify({ clientId: 1, kind: 'upgrade', offerings: { website: 'yes' } }),
      }),
    )
    expect(nonBoolean.status).toBe(400)
    expect((await nonBoolean.json()).error).toBe('invalid_request')

    const client = await prisma.client.create({ data: { name: `vb-test-route-${crypto.randomUUID()}` } })
    // All-false → the service's 400 invalid_offerings.
    const allFalse = await createViewbookRoute(
      req('/api/viewbooks', {
        method: 'POST',
        body: JSON.stringify({ clientId: client.id, kind: 'upgrade', offerings: { website: false, va: false, ppc: false } }),
      }),
    )
    expect(allFalse.status).toBe(400)
    expect((await allFalse.json()).error).toBe('invalid_offerings')

    // Seeded templates carry no va-tagged subsection → 409 offering_unavailable.
    const vaOnly = await createViewbookRoute(
      req('/api/viewbooks', {
        method: 'POST',
        body: JSON.stringify({ clientId: client.id, kind: 'upgrade', offerings: { website: false, va: true, ppc: false } }),
      }),
    )
    expect(vaOnly.status).toBe(409)
    expect((await vaOnly.json()).error).toBe('offering_unavailable')

    // Partial offerings merge over the website-only default and create fine.
    const ok = await createViewbookRoute(
      req('/api/viewbooks', {
        method: 'POST',
        body: JSON.stringify({ clientId: client.id, kind: 'upgrade', offerings: { website: true } }),
      }),
    )
    expect(ok.status).toBe(201)
    const { viewbook } = await ok.json()
    const row = await prisma.viewbook.findUniqueOrThrow({ where: { id: viewbook.id } })
    expect(row).toMatchObject({ offeringWebsite: true, offeringVa: false, offeringPpc: false })

    // GET index: template-derived availability rides along.
    const list = await listViewbooks()
    expect(list.status).toBe(200)
    const body = await list.json()
    expect(body.availability).toEqual({ website: true, va: false, ppc: false })
  })

  it('GET/PATCH /api/viewbooks/:id: non-numeric id 404, invalid theme 400', async () => {
    const notFound = await getViewbook(req('/api/viewbooks/abc'), params({ id: 'abc' }))
    expect(notFound.status).toBe(404)

    const { id } = await mkViewbook()
    const primitive = await patchViewbook(
      req(`/api/viewbooks/${id}`, { method: 'PATCH', body: 'null' }),
      params({ id: String(id) }),
    )
    expect(primitive.status).toBe(400)
    expect((await primitive.json()).error).toBe('invalid_request')

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

  it('PATCH/GET/assets preserve a catalog-only font through unchanged service internals', async () => {
    const { id } = await mkViewbook()
    const theme = {
      primary: '#122033', secondary: '#1D7F7F', tertiary: '#C99334',
      headingFont: 'abril-fatface', bodyFont: 'inter', logo: null, sectionHeroes: {},
    }
    const patched = await patchViewbook(
      req(`/api/viewbooks/${id}`, { method: 'PATCH', body: JSON.stringify({ theme }) }),
      params({ id: String(id) }),
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).theme.headingFont).toBe('abril-fatface')

    const detail = await getViewbook(req(`/api/viewbooks/${id}`), params({ id: String(id) }))
    expect((await detail.json()).viewbook.theme.headingFont).toBe('abril-fatface')

    const form = new FormData()
    form.set('kind', 'logo')
    form.set('file', new File([PNG], 'logo.png', { type: 'image/png' }))
    const attached = await attachAsset(
      req(`/api/viewbooks/${id}/assets`, {
        method: 'POST', headers: { 'content-length': String(PNG.length + 1024) }, body: form,
      }),
      params({ id: String(id) }),
    )
    expect(attached.status).toBe(200)
    expect((await attached.json()).theme.headingFont).toBe('abril-fatface')
  })

  it('PATCH /api/viewbooks/:id: presentation branch — bad affordance/overlay 400, happy path persists + syncVersion bumps', async () => {
    const { id } = await mkViewbook()

    const badAffordance = await patchViewbook(
      req(`/api/viewbooks/${id}`, { method: 'PATCH', body: JSON.stringify({ collapseAffordance: 'zzz' }) }),
      params({ id: String(id) }),
    )
    expect(badAffordance.status).toBe(400)
    expect((await badAffordance.json()).error).toBe('invalid_affordance')

    const badOverlay = await patchViewbook(
      req(`/api/viewbooks/${id}`, { method: 'PATCH', body: JSON.stringify({ heroOverlayStrength: 12.5 }) }),
      params({ id: String(id) }),
    )
    expect(badOverlay.status).toBe(400)
    expect((await badOverlay.json()).error).toBe('invalid_overlay')

    const before = await getViewbook(req(`/api/viewbooks/${id}`), params({ id: String(id) }))
    const beforeSync = (await before.json()).viewbook.syncVersion as number

    const happy = await patchViewbook(
      req(`/api/viewbooks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ collapseAffordance: 'pill', heroOverlayStrength: 250 }),
      }),
      params({ id: String(id) }),
    )
    expect(happy.status).toBe(200)

    const after = await getViewbook(req(`/api/viewbooks/${id}`), params({ id: String(id) }))
    const { viewbook } = await after.json()
    expect(viewbook.collapseAffordance).toBe('pill')
    expect(viewbook.heroOverlayStrength).toBe(100) // clamped from 250
    expect(viewbook.syncVersion).toBe(beforeSync + 1)
  })

  it('PATCH /api/viewbooks/:id: revealDurationScale/firstLoadDelayMs branch (Task 3) — bad type 400, happy path persists + one syncVersion bump', async () => {
    const { id } = await mkViewbook()

    const badScale = await patchViewbook(
      req(`/api/viewbooks/${id}`, { method: 'PATCH', body: JSON.stringify({ revealDurationScale: 'x' }) }),
      params({ id: String(id) }),
    )
    expect(badScale.status).toBe(400)
    expect((await badScale.json()).error).toBe('invalid_reveal_scale')

    const badDelay = await patchViewbook(
      req(`/api/viewbooks/${id}`, { method: 'PATCH', body: JSON.stringify({ firstLoadDelayMs: 12.5 }) }),
      params({ id: String(id) }),
    )
    expect(badDelay.status).toBe(400)
    expect((await badDelay.json()).error).toBe('invalid_first_load_delay')

    const before = await getViewbook(req(`/api/viewbooks/${id}`), params({ id: String(id) }))
    const beforeSync = (await before.json()).viewbook.syncVersion as number

    const happy = await patchViewbook(
      req(`/api/viewbooks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ revealDurationScale: 1.4, firstLoadDelayMs: 2000 }),
      }),
      params({ id: String(id) }),
    )
    expect(happy.status).toBe(200)

    const after = await getViewbook(req(`/api/viewbooks/${id}`), params({ id: String(id) }))
    const { viewbook } = await after.json()
    expect(viewbook.revealDurationScale).toBe(1.4)
    expect(viewbook.firstLoadDelayMs).toBe(2000)
    expect(viewbook.syncVersion).toBe(beforeSync + 1)
  })

  it('PATCH /api/viewbooks/:id: viewerMode branch (P2-2) — bad value 400, happy path persists collapse + one syncVersion bump', async () => {
    const { id } = await mkViewbook()

    // default is continuous (Phase 1 read side + column default)
    const initial = await getViewbook(req(`/api/viewbooks/${id}`), params({ id: String(id) }))
    expect((await initial.json()).viewbook.viewerMode).toBe('continuous')

    const bad = await patchViewbook(
      req(`/api/viewbooks/${id}`, { method: 'PATCH', body: JSON.stringify({ viewerMode: 'weird' }) }),
      params({ id: String(id) }),
    )
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_viewer_mode')

    const before = await getViewbook(req(`/api/viewbooks/${id}`), params({ id: String(id) }))
    const beforeSync = (await before.json()).viewbook.syncVersion as number

    const happy = await patchViewbook(
      req(`/api/viewbooks/${id}`, { method: 'PATCH', body: JSON.stringify({ viewerMode: 'collapse' }) }),
      params({ id: String(id) }),
    )
    expect(happy.status).toBe(200)

    const after = await getViewbook(req(`/api/viewbooks/${id}`), params({ id: String(id) }))
    const { viewbook } = await after.json()
    expect(viewbook.viewerMode).toBe('collapse')
    expect(viewbook.syncVersion).toBe(beforeSync + 1)
  })

  it('POST /api/viewbooks/:id/assets: multipart logo attach stamps theme + file readable', async () => {
    const { id } = await mkViewbook()
    const form = new FormData()
    form.set('kind', 'logo')
    form.set('file', new File([PNG], 'logo.png', { type: 'image/png' }))
    const res = await attachAsset(
      req(`/api/viewbooks/${id}/assets`, {
        method: 'POST',
        headers: { 'content-length': String(PNG.length + 1024) },
        body: form,
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(200)
    const { theme } = await res.json()
    expect(theme.logo).toMatch(/\.webp$/)
    const row = await prisma.viewbook.findUniqueOrThrow({ where: { id } })
    expect(parseStoredTheme(row.themeJson).logo).toBe(theme.logo)
    expect(await readViewbookAsset(String(id), theme.logo)).not.toBeNull()

    const badForm = new FormData()
    badForm.set('kind', 'hero') // no sectionKey, no file
    const bad = await attachAsset(
      req(`/api/viewbooks/${id}/assets`, {
        method: 'POST',
        headers: { 'content-length': '1024' },
        body: badForm,
      }),
      params({ id: String(id) }),
    )
    expect(bad.status).toBe(400)
  })

  it('POST /api/viewbooks/:id/assets: rejects an over-limit Content-Length with 413 before buffering', async () => {
    const { id } = await mkViewbook()
    const form = new FormData()
    form.set('kind', 'logo')
    form.set('file', new File([PNG], 'logo.png', { type: 'image/png' }))
    const res = await attachAsset(
      req(`/api/viewbooks/${id}/assets`, {
        method: 'POST',
        headers: { 'content-length': String(MAX_ASSET_BYTES + 64 * 1024 + 1) },
        body: form,
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(413)
  })

  it('POST /api/viewbooks/:id/assets: rejects an over-limit File.size with 413 (valid Content-Length so the header gate does not fire vacuously)', async () => {
    const { id } = await mkViewbook()
    const big = new File([new Uint8Array(MAX_ASSET_BYTES + 1)], 'big.png', { type: 'image/png' })
    const form = new FormData()
    form.set('kind', 'logo')
    form.set('file', big)
    const res = await attachAsset(
      req(`/api/viewbooks/${id}/assets`, {
        method: 'POST',
        headers: { 'content-length': '1024' },
        body: form,
      }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(413)
  })

  it('DELETE /api/viewbooks/:id: removes theme + assessment-image asset files (Task 9)', async () => {
    const { id } = await mkViewbook()
    const form = new FormData()
    form.set('kind', 'logo')
    form.set('file', new File([PNG], 'logo.png', { type: 'image/png' }))
    const attachRes = await attachAsset(
      req(`/api/viewbooks/${id}/assets`, {
        method: 'POST',
        headers: { 'content-length': String(PNG.length + 1024) },
        body: form,
      }),
      params({ id: String(id) }),
    )
    expect(attachRes.status).toBe(200)
    const { theme } = await attachRes.json()

    const img = await addAssessmentImage(id, PNG, 'kevin@enrollmentresources.com')

    expect(await readViewbookAsset(String(id), theme.logo)).not.toBeNull()
    expect(await readViewbookAsset(String(id), img.filename)).not.toBeNull()

    const del = await deleteViewbookRoute(req(`/api/viewbooks/${id}`, { method: 'DELETE' }), params({ id: String(id) }))
    expect(del.status).toBe(200)

    expect(await prisma.viewbook.findUnique({ where: { id } })).toBeNull()
    // theme file (deleteViewbook/service.ts's existing coverage) AND the
    // assessment-image file (this task's route-owned snapshot) are both gone.
    expect(await readViewbookAsset(String(id), theme.logo)).toBeNull()
    expect(await readViewbookAsset(String(id), img.filename)).toBeNull()
  })

  it('DELETE /api/viewbooks/:id: 401 without a session', async () => {
    const { id } = await mkViewbook()
    const res = await deleteViewbookRoute(
      req(`/api/viewbooks/${id}`, { method: 'DELETE', auth: false }),
      params({ id: String(id) }),
    )
    expect(res.status).toBe(401)
    expect(await prisma.viewbook.findUnique({ where: { id } })).not.toBeNull()
  })
})
