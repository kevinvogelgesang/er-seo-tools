import crypto from 'crypto'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { GET } from './[filename]/route'
import { createAuthCookieValue } from '@/lib/auth'
import { hashSecret, memberCookieName } from '@/lib/viewbook/auth-secrets'

// 1x1 PNG (magic bytes are all the route cares about — files are read raw)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const PDF = Buffer.from('%PDF-1.7\nasset route')

let assetsDir: string
// Global ViewbookDoc rows (viewbookId: null) aren't scoped to any client or
// viewbook, so they aren't reachable by any per-test/per-client cleanup —
// tag them with a distinctive createdBy so afterAll can remove exactly the
// rows this file created from the shared worker DB.
const GLOBAL_DOC_CREATED_BY = 'vb-assets-route-test'

function call(token: string, filename: string, cookie?: string) {
  const req = new NextRequest(`http://localhost/api/viewbook/${token}/assets/${filename}`, {
    headers: cookie ? { cookie } : undefined,
  })
  return GET(req, { params: Promise.resolve({ token, filename }) })
}

// Full 404 envelope (plan-review fix 8): status + parsed body + every header,
// so "identical to a bad token" means byte-identical, not just status===404.
async function envelope(res: Response) {
  return {
    status: res.status,
    body: await res.json(),
    headers: Object.fromEntries(res.headers.entries()),
  }
}

async function seedAssessmentImage(viewbookId: number, filenameOverride?: string) {
  const content = await prisma.viewbookAssessmentContent.upsert({
    where: { viewbookId },
    create: { viewbookId },
    update: {},
  })
  const filename = filenameOverride ?? `${crypto.randomUUID()}.webp`
  await prisma.viewbookAssessmentImage.create({
    data: { contentId: content.id, filename, sortOrder: 1, createdBy: 'test' },
  })
  await mkdir(path.join(assetsDir, String(viewbookId)), { recursive: true })
  await writeFile(path.join(assetsDir, String(viewbookId), filename), PNG)
  return filename
}

beforeAll(async () => {
  assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-assets-'))
  vi.stubEnv('VIEWBOOK_ASSETS_DIR', assetsDir)
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await rm(assetsDir, { recursive: true, force: true })
  await prisma.viewbookDoc.deleteMany({ where: { viewbookId: null, createdBy: GLOBAL_DOC_CREATED_BY } })
})

async function seedViewbookWithLogo() {
  const client = await prisma.client.create({ data: { name: `vb-assets-${crypto.randomUUID()}` } })
  const { id, token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
  const logo = `${crypto.randomUUID()}.png` // unique per seed — the cross-token test depends on it
  await mkdir(path.join(assetsDir, String(id)), { recursive: true })
  await writeFile(path.join(assetsDir, String(id), logo), PNG)
  const theme = {
    primary: '#122033', secondary: '#1D7F7F', tertiary: '#C99334',
    headingFont: 'inter', bodyFont: 'inter', logo, sectionHeroes: {},
  }
  await prisma.viewbook.update({ where: { id }, data: { themeJson: JSON.stringify(theme) } })
  return { id, token, logo, clientId: client.id }
}

describe('GET /api/viewbook/[token]/assets/[filename]', () => {
  it('requires a readable principal and admits member, operator, break-glass, and dev identities', async () => {
    const originalEnv = { ...process.env }
    try {
      process.env.APP_AUTH_PASSWORD = 'asset-route-test-password'
      process.env.APP_AUTH_SECRET = 'asset-route-test-secret'
      const { id, token, logo } = await seedViewbookWithLogo()

      const noPrincipal = await call(token, logo)
      expect(noPrincipal.status).toBe(404)
      expect(await noPrincipal.json()).toEqual({ error: 'not_found' })

      const member = await prisma.viewbookTeamMember.create({
        data: {
          viewbookId: id,
          memberKey: crypto.randomUUID(),
          name: 'Asset Member',
          email: `${crypto.randomUUID()}@example.com`,
          addedBy: 'operator@example.com',
        },
      })
      const rawSession = crypto.randomBytes(32).toString('base64url')
      await prisma.viewbookMemberSession.create({
        data: {
          memberId: member.id,
          tokenHash: hashSecret(rawSession),
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
      const memberHeader = `${memberCookieName(id)}=${rawSession}`

      const operator = await createAuthCookieValue({
        sub: 'google:asset-test', email: 'operator@example.com', hd: 'example.com', name: 'Operator',
      })
      const breakGlass = await createAuthCookieValue({
        sub: 'password:break-glass', email: null, hd: null, name: 'Break-glass',
      })
      for (const cookie of [memberHeader, `er_auth=${operator}`, `er_auth=${breakGlass}`]) {
        expect((await call(token, logo, cookie)).status).toBe(200)
      }

      delete process.env.APP_AUTH_PASSWORD
      expect((await call(token, logo)).status).toBe(200)
    } finally {
      process.env = originalEnv
    }
  })

  it('serves an allowlisted theme asset with mime + nosniff', async () => {
    const { id, token, logo } = await seedViewbookWithLogo()
    const row = await prisma.viewbook.findUniqueOrThrow({ where: { id }, select: { themeJson: true } })
    await prisma.viewbook.update({
      where: { id },
      data: { themeJson: JSON.stringify({ ...JSON.parse(row.themeJson), headingFont: 'abril-fatface' }) },
    })
    const res = await call(token, logo)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('404s a file that exists on disk but is NOT in the themeJson allowlist', async () => {
    const { id, token } = await seedViewbookWithLogo()
    const stray = `${crypto.randomUUID()}.png`
    await writeFile(path.join(assetsDir, String(id), stray), PNG)
    const res = await call(token, stray)
    expect(res.status).toBe(404)
  })

  it('404s traversal shapes, unknown tokens, and revoked viewbooks identically', async () => {
    const { id, token, logo } = await seedViewbookWithLogo()
    expect((await call(token, '..%2F' + String(id) + '%2F' + logo)).status).toBe(404)
    expect((await call(token, 'no-such.png')).status).toBe(404)
    expect((await call('unknown-token', logo)).status).toBe(404)
    await prisma.viewbook.update({ where: { id }, data: { revokedAt: new Date() } })
    expect((await call(token, logo)).status).toBe(404)
  })

  it('serves a global team photo via the roster allowlist', async () => {
    const { token } = await seedViewbookWithLogo()
    const photo = `${crypto.randomUUID()}.png`
    await mkdir(path.join(assetsDir, 'global'), { recursive: true })
    await writeFile(path.join(assetsDir, 'global', photo), PNG)
    await prisma.viewbookGlobalContent.upsert({
      where: { key: 'team' },
      update: {
        bodyJson: JSON.stringify([{ name: 'Kev', role: 'SEO', photo, blurb: '' }]),
        updatedBy: 'kevin@er.com',
      },
      create: {
        key: 'team',
        bodyJson: JSON.stringify([{ name: 'Kev', role: 'SEO', photo, blurb: '' }]),
        updatedBy: 'kevin@er.com',
      },
    })
    const res = await call(token, photo)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })

  it('serves owned and global PDF docs with inline PDF headers', async () => {
    const { id, token } = await seedViewbookWithLogo()
    const owned = `${crypto.randomUUID()}.pdf`
    const global = `${crypto.randomUUID()}.pdf`
    await mkdir(path.join(assetsDir, String(id)), { recursive: true })
    await mkdir(path.join(assetsDir, 'global'), { recursive: true })
    await writeFile(path.join(assetsDir, String(id), owned), PDF)
    await writeFile(path.join(assetsDir, 'global', global), PDF)
    await prisma.viewbookDoc.createMany({
      data: [
        { viewbookId: id, title: 'Owned', filename: owned, sortOrder: 1, createdBy: 'test' },
        { viewbookId: null, title: 'Global', filename: global, sortOrder: 1, createdBy: GLOBAL_DOC_CREATED_BY },
      ],
    })

    for (const filename of [owned, global]) {
      const res = await call(token, filename)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/pdf')
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(res.headers.get('Content-Disposition')).toBe('inline')
    }
  })

  it("404s another viewbook's PDF doc", async () => {
    const a = await seedViewbookWithLogo()
    const b = await seedViewbookWithLogo()
    const filename = `${crypto.randomUUID()}.pdf`
    await writeFile(path.join(assetsDir, String(b.id), filename), PDF)
    await prisma.viewbookDoc.create({
      data: { viewbookId: b.id, title: 'Private to B', filename, sortOrder: 1, createdBy: 'test' },
    })
    expect((await call(a.token, filename)).status).toBe(404)
  })

  it('prefers the owned scope when a doc filename collides with a global row', async () => {
    const { id, token } = await seedViewbookWithLogo()
    const filename = `${crypto.randomUUID()}.pdf`
    const ownedPdf = Buffer.from('%PDF-owned')
    const globalPdf = Buffer.from('%PDF-global')
    await mkdir(path.join(assetsDir, String(id)), { recursive: true })
    await mkdir(path.join(assetsDir, 'global'), { recursive: true })
    await writeFile(path.join(assetsDir, String(id), filename), ownedPdf)
    await writeFile(path.join(assetsDir, 'global', filename), globalPdf)
    await prisma.viewbookDoc.createMany({
      data: [
        { viewbookId: id, title: 'Owned', filename, sortOrder: 1, createdBy: 'test' },
        { viewbookId: null, title: 'Global', filename, sortOrder: 1, createdBy: GLOBAL_DOC_CREATED_BY },
      ],
    })
    const res = await call(token, filename)
    expect(Buffer.from(await res.arrayBuffer()).equals(ownedPdf)).toBe(true)
  })

  it('404s a roster-shaped filename when the roster does not contain it', async () => {
    const { token } = await seedViewbookWithLogo()
    const res = await call(token, `${crypto.randomUUID()}.png`)
    expect(res.status).toBe(404)
  })

  it("404s token A requesting a file allowlisted only on token B's viewbook (Codex plan-fix 8)", async () => {
    const a = await seedViewbookWithLogo()
    const b = await seedViewbookWithLogo()
    // b.logo exists on disk under b's scope and is allowlisted on b — but the
    // request rides token A: cross-token curation must 404.
    const res = await call(a.token, b.logo)
    expect(res.status).toBe(404)
  })

  it('404s an allowlisted asset once the client is archived (Codex plan-fix 8)', async () => {
    const { token, logo, clientId } = await seedViewbookWithLogo()
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } })
    const res = await call(token, logo)
    expect(res.status).toBe(404)
  })
})

// Feedback screenshots (2026-07-20): same viewbook-fenced allowlist shape as
// assessment images, resolved through the reviewLink→milestone chain.
async function seedFeedbackImage(viewbookId: number) {
  const milestone = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId } })
  const reviewLink = await prisma.viewbookReviewLink.create({
    data: { milestoneId: milestone.id, label: 'Homepage', url: 'https://example.com', kind: 'live', createdBy: 'test' },
  })
  const feedback = await prisma.viewbookFeedback.create({
    data: { reviewLinkId: reviewLink.id, body: 'See screenshot', authorKind: 'client' },
  })
  const filename = `${crypto.randomUUID()}.webp`
  await prisma.viewbookFeedbackImage.create({
    data: { feedbackId: feedback.id, filename, sortOrder: 0 },
  })
  await mkdir(path.join(assetsDir, String(viewbookId)), { recursive: true })
  await writeFile(path.join(assetsDir, String(viewbookId), filename), PNG)
  return filename
}

describe('GET /api/viewbook/[token]/assets/[filename] — feedback screenshots', () => {
  it('serves an allowlisted feedback screenshot for its own viewbook', async () => {
    const { id, token } = await seedViewbookWithLogo()
    const filename = await seedFeedbackImage(id)
    const res = await call(token, filename)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('404s a cross-viewbook feedback screenshot with the identical envelope', async () => {
    const a = await seedViewbookWithLogo()
    const b = await seedViewbookWithLogo()
    const bImage = await seedFeedbackImage(b.id)

    const baseline = await envelope(await call('unknown-token', bImage))
    expect(baseline.status).toBe(404)
    const crossViewbook = await envelope(await call(a.token, bImage))
    expect(crossViewbook).toEqual(baseline)
  })
})

// Task 6: assessment-image allowlist branch (viewbook-scoped only — never global).
describe('GET /api/viewbook/[token]/assets/[filename] — assessment images', () => {
  it('serves an allowlisted assessment image for its own viewbook', async () => {
    const { id, token } = await seedViewbookWithLogo()
    const filename = await seedAssessmentImage(id)
    const res = await call(token, filename)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it(
    '404s a bad/expired token, a cross-viewbook assessment image, a traversal ' +
      'shape, and an unallowlisted filename with the IDENTICAL envelope (plan-review fix 8)',
    async () => {
      const a = await seedViewbookWithLogo()
      const b = await seedViewbookWithLogo()
      const bImage = await seedAssessmentImage(b.id)

      // Baseline: bad/expired token.
      const baseline = await envelope(await call('unknown-token', bImage))
      expect(baseline.status).toBe(404)
      expect(baseline.body).toEqual({ error: 'not_found' })

      // b's assessment image exists on disk and is allowlisted on b — but
      // requested via a's token: cross-viewbook curation must 404 the same way.
      const crossViewbook = await envelope(await call(a.token, bImage))

      // Path-traversal-shaped filename.
      const traversal = await envelope(await call(a.token, '..%2F' + String(b.id) + '%2F' + bImage))

      // A plausible-looking but never-allowlisted filename.
      const unallowlisted = await envelope(await call(a.token, `${crypto.randomUUID()}.webp`))

      for (const env of [crossViewbook, traversal, unallowlisted]) {
        expect(env).toEqual(baseline)
      }
    },
  )
})
