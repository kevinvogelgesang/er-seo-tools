// app/api/sales/[token]/screenshot/screenshot-route.test.ts
// DB-backed + temp screenshot file on disk.
import fs from 'fs/promises'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { SCREENSHOTS_DIR } from '@/lib/ada-audit/screenshot-helpers'
import { GET } from './[adaAuditId]/[filename]/route'

const PREFIX = 'c14-shot-'
let token: string
let childId: string
let strangerChildId: string

async function cleanup() {
  const prospects = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  const audits = await prisma.siteAudit.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  await prisma.adaAudit.deleteMany({ where: { siteAuditId: { in: audits.map((a) => a.id) } } })
  await prisma.siteAudit.deleteMany({ where: { id: { in: audits.map((a) => a.id) } } })
  await prisma.prospect.deleteMany({ where: { id: { in: prospects.map((p) => p.id) } } })
}

beforeAll(async () => {
  await cleanup()
  token = crypto.randomUUID()
  const prospect = await prisma.prospect.create({
    data: { name: 'Shot', domain: `${PREFIX}x.test`, salesToken: token, salesTokenExpiresAt: new Date(Date.now() + 86_400_000) },
  })
  // Curated-set membership requires: parent summary names the pattern +
  // example page; the child's result blob carries the screenshot node.
  const site = await prisma.siteAudit.create({
    data: {
      domain: `${PREFIX}x.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id,
      summary: JSON.stringify({
        aggregate: { critical: 0, serious: 1, moderate: 0, minor: 0, total: 1, passed: 10, incomplete: 0 },
        pdfsAggregate: { total: 0, complete: 0, errored: 0, skipped: 0, withIssues: 0 },
        pages: [],
        commonIssues: [{
          ruleId: 'color-contrast', impact: 'serious', help: 'Contrast', description: 'd', helpUrl: 'u',
          affectedPagesCount: 1, totalPagesScanned: 1, sharedAncestor: null, ancestorConfidence: null,
          examplePageUrl: `https://${PREFIX}x.test/a`,
        }],
      }),
    },
  })
  const child = await prisma.adaAudit.create({
    data: {
      url: `https://${PREFIX}x.test/a`, status: 'complete', siteAuditId: site.id,
      result: JSON.stringify({
        violations: [{
          id: 'color-contrast', impact: 'serious', help: 'h', description: 'd', helpUrl: 'u', tags: [],
          nodes: [{ html: '<a>x</a>', target: ['a'], screenshotPath: 'color-contrast-0.png' }],
        }],
        passes: [], incomplete: [], inapplicable: [], timestamp: 't',
        url: `https://${PREFIX}x.test/a`, testEngine: { name: 'axe', version: '4' }, testRunner: { name: 'axe' },
      }),
    },
  })
  childId = child.id
  const strangerSite = await prisma.siteAudit.create({ data: { domain: `${PREFIX}other.test`, wcagLevel: 'wcag21aa', status: 'complete' } })
  const strangerChild = await prisma.adaAudit.create({ data: { url: `https://${PREFIX}other.test/a`, status: 'complete', siteAuditId: strangerSite.id } })
  strangerChildId = strangerChild.id
  await fs.mkdir(path.join(SCREENSHOTS_DIR, childId), { recursive: true })
  await fs.writeFile(path.join(SCREENSHOTS_DIR, childId, 'color-contrast-0.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})
afterAll(async () => {
  await fs.rm(path.join(SCREENSHOTS_DIR, childId), { recursive: true, force: true })
  await cleanup()
})

const call = (tok: string, aid: string, file: string) =>
  GET(new NextRequest(`http://localhost:3000/api/sales/${tok}/screenshot/${aid}/${file}`), {
    params: Promise.resolve({ token: tok, adaAuditId: aid, filename: file }),
  })

describe('GET /api/sales/[token]/screenshot/[adaAuditId]/[filename]', () => {
  it('streams a curated screenshot', async () => {
    const res = await call(token, childId, 'color-contrast-0.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
  })
  it('404s on a child audit the prospect does not own', async () => {
    expect((await call(token, strangerChildId, 'color-contrast-0.png')).status).toBe(404)
  })
  it('404s on an owned file that is NOT in the curated set', async () => {
    // File exists on disk under the owned audit, but no curated node references it.
    await fs.writeFile(path.join(SCREENSHOTS_DIR, childId, 'color-contrast-9.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect((await call(token, childId, 'color-contrast-9.png')).status).toBe(404)
  })
  it('404s on invalid token / bad filename / traversal', async () => {
    expect((await call('bad-token', childId, 'color-contrast-0.png')).status).toBe(404)
    expect((await call(token, childId, '../secrets.png')).status).toBe(404)
    expect((await call(token, childId, 'shot.svg')).status).toBe(404)
  })
})
