// app/api/sales/[token]/hero/hero-route.test.ts
// DB-backed + temp hero file on disk. Failure contract (spec Codex fix 7):
// every auth/lookup failure is an indistinguishable 404.
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

const PREFIX = 'c14-hero-rt-'
let heroDir: string
const prevEnv = process.env.HERO_SCREENSHOTS_DIR
let token: string
let auditId: string
let strangerAuditId: string
let nullColumnAuditId: string
let GET: (req: NextRequest, ctx: { params: Promise<{ token: string; siteAuditId: string }> }) => Promise<Response>

async function cleanup() {
  const prospects = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  await prisma.prospect.deleteMany({ where: { id: { in: prospects.map((p) => p.id) } } })
}

beforeAll(async () => {
  heroDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-rt-'))
  process.env.HERO_SCREENSHOTS_DIR = heroDir
  ;({ GET } = await import('./[siteAuditId]/route'))
  await cleanup()
  token = crypto.randomUUID()
  const prospect = await prisma.prospect.create({
    data: { name: 'Hero', domain: `${PREFIX}x.test`, salesToken: token, salesTokenExpiresAt: new Date(Date.now() + 86_400_000) },
  })
  const audit = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}x.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id },
  })
  auditId = audit.id
  await prisma.siteAudit.update({ where: { id: auditId }, data: { homepageScreenshot: `${auditId}.png` } })
  await fs.writeFile(path.join(heroDir, `${auditId}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  const stranger = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}other.test`, wcagLevel: 'wcag21aa', status: 'complete', homepageScreenshot: 'x.png' },
  })
  strangerAuditId = stranger.id
  const nullCol = await prisma.siteAudit.create({
    data: { domain: `${PREFIX}x.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id },
  })
  nullColumnAuditId = nullCol.id
})
afterAll(async () => {
  if (prevEnv === undefined) delete process.env.HERO_SCREENSHOTS_DIR
  else process.env.HERO_SCREENSHOTS_DIR = prevEnv
  await fs.rm(heroDir, { recursive: true, force: true })
  await cleanup()
})

const call = (tok: string, aid: string) =>
  GET(new NextRequest(`http://localhost:3000/api/sales/${tok}/hero/${aid}`), {
    params: Promise.resolve({ token: tok, siteAuditId: aid }),
  })

describe('GET /api/sales/[token]/hero/[siteAuditId]', () => {
  it('streams the hero PNG for an owned audit with a stamped column', async () => {
    const res = await call(token, auditId)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600')
  })
  it('404 — invalid token', async () => {
    expect((await call('bad-token', auditId)).status).toBe(404)
  })
  it("404 — another prospect's / unowned audit", async () => {
    expect((await call(token, strangerAuditId)).status).toBe(404)
  })
  it('404 — malformed audit id', async () => {
    expect((await call(token, '../etc')).status).toBe(404)
  })
  it('404 — owned audit but null homepageScreenshot column', async () => {
    expect((await call(token, nullColumnAuditId)).status).toBe(404)
  })
  it('404 — stamped column but file missing on disk (ENOENT)', async () => {
    await fs.unlink(path.join(heroDir, `${auditId}.png`))
    expect((await call(token, auditId)).status).toBe(404)
    await fs.writeFile(path.join(heroDir, `${auditId}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })
  it('500 — a non-ENOENT fs failure (EACCES) surfaces via withRoute, not as a 404 oracle (plan Codex fix 4)', async () => {
    const spy = vi
      .spyOn(fs, 'readFile')
      .mockRejectedValueOnce(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))
    try {
      const res = await call(token, auditId)
      expect(res.status).toBe(500)
      expect((await res.json()).error).toBe('internal_error') // withRoute envelope, no message leak
    } finally {
      spy.mockRestore()
    }
  })
})
