import crypto from 'crypto'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { GET } from './[filename]/route'

// 1x1 PNG (magic bytes are all the route cares about — files are read raw)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

let assetsDir: string

function call(token: string, filename: string) {
  const req = new NextRequest(`http://localhost/api/viewbook/${token}/assets/${filename}`)
  return GET(req, { params: Promise.resolve({ token, filename }) })
}

beforeAll(async () => {
  assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-assets-'))
  vi.stubEnv('VIEWBOOK_ASSETS_DIR', assetsDir)
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await rm(assetsDir, { recursive: true, force: true })
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
  it('serves an allowlisted theme asset with mime + nosniff', async () => {
    const { token, logo } = await seedViewbookWithLogo()
    const res = await call(token, logo)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600')
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
