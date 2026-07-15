// lib/services/prospects.test.ts
// DB-backed against local SQLite.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { buildProspectSalesUrl, createProspect, listProspects, normalizeProspectDomain } from './prospects'

const PREFIX = 'c14-svc-'
async function cleanup() {
  const rows = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  const ids = rows.map((r) => r.id)
  await prisma.siteAudit.deleteMany({
    where: { OR: [{ prospectId: { in: ids } }, { domain: { startsWith: PREFIX } }] },
  })
  await prisma.prospect.deleteMany({ where: { id: { in: ids } } })
}
beforeAll(cleanup)
afterAll(cleanup)

describe('normalizeProspectDomain', () => {
  it('strips scheme, www, path, trailing dots and lowercases', () => {
    expect(normalizeProspectDomain('HTTPS://WWW.Acme-College.EDU/programs/')).toBe('acme-college.edu')
    expect(normalizeProspectDomain('acme.edu.')).toBe('acme.edu')
  })
})

describe('createProspect', () => {
  it('creates, then returns existing on same normalized domain', async () => {
    const a = await createProspect({ name: 'Acme', domain: `https://www.${PREFIX}acme.test/` })
    expect(a.kind).toBe('created')
    const b = await createProspect({ name: 'Acme again', domain: `${PREFIX}acme.test` })
    expect(b.kind).toBe('existing')
    if (a.kind !== 'invalid' && b.kind !== 'invalid') expect(b.prospect.id).toBe(a.prospect.id)
  })

  it('rejects an empty name or unusable domain', async () => {
    expect((await createProspect({ name: '  ', domain: `${PREFIX}x.test` })).kind).toBe('invalid')
    expect((await createProspect({ name: 'X', domain: 'not a domain' })).kind).toBe('invalid')
  })
})

describe('listProspects', () => {
  it('joins the latest audit with reportable flag', async () => {
    const created = await createProspect({ name: 'ListMe', domain: `${PREFIX}list.test` })
    if (created.kind === 'invalid') throw new Error('seed failed')
    const audit = await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}list.test`, wcagLevel: 'wcag21aa', status: 'complete',
        prospectId: created.prospect.id, completedAt: new Date(),
      },
    })
    // no seo-parser CrawlRun → complete but NOT reportable
    const rows = await listProspects()
    const mine = rows.find((r) => r.id === created.prospect.id)
    expect(mine?.latestAudit?.id).toBe(audit.id)
    expect(mine?.latestAudit?.reportable).toBe(false)
  })
})

describe('buildProspectSalesUrl — the ONE sales-URL home (Codex fix 5)', () => {
  it('builds from NEXT_PUBLIC_APP_URL in the exact share-route format', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tools.example.com')
    expect(buildProspectSalesUrl('tok-abc')).toBe('https://tools.example.com/sales/tok-abc')
    vi.unstubAllEnvs()
  })

  it('falls back to localhost when the env var is unset/empty (previous route behavior, byte-identical)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(buildProspectSalesUrl('tok-abc')).toBe('http://localhost:3000/sales/tok-abc')
    vi.unstubAllEnvs()
  })
})

describe('listProspects — PR3 progress + queue + sales-URL fields', () => {
  it('surfaces progress counters, startedAt, and salesUrl on the row', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tools.example.com')
    const created = await createProspect({ name: 'Counters', domain: `${PREFIX}counters.test` })
    if (created.kind === 'invalid') throw new Error('seed failed')
    await prisma.prospect.update({
      where: { id: created.prospect.id },
      data: { salesToken: 'tok-counters', salesTokenExpiresAt: new Date(Date.now() + 86_400_000) },
    })
    const startedAt = new Date('2026-07-14T10:00:00.000Z')
    await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}counters.test`, wcagLevel: 'wcag21aa', status: 'running',
        prospectId: created.prospect.id, startedAt,
        pagesTotal: 10, pagesComplete: 4, pagesError: 1, pagesRedirected: 2,
        pdfsTotal: 3, pdfsComplete: 1, lighthouseTotal: 5, lighthouseComplete: 2,
      },
    })
    const row = (await listProspects()).find((r) => r.id === created.prospect.id)
    expect(row?.salesUrl).toBe('https://tools.example.com/sales/tok-counters')
    expect(row?.latestAudit).toMatchObject({
      pagesTotal: 10, pagesComplete: 4, pagesError: 1, pagesRedirected: 2,
      pdfsTotal: 3, pdfsComplete: 1, pdfsError: 0, pdfsSkipped: 0,
      lighthouseTotal: 5, lighthouseComplete: 2, lighthouseError: 0,
      startedAt: startedAt.toISOString(),
      queuePosition: null, // running, not queued
    })
    vi.unstubAllEnvs()
  })

  it('salesUrl is null when the token is absent or expired', async () => {
    const fresh = await createProspect({ name: 'NoTok', domain: `${PREFIX}notok.test` })
    if (fresh.kind === 'invalid') throw new Error('seed failed')
    const expired = await createProspect({ name: 'Expired', domain: `${PREFIX}expired.test` })
    if (expired.kind === 'invalid') throw new Error('seed failed')
    await prisma.prospect.update({
      where: { id: expired.prospect.id },
      data: { salesToken: 'tok-old', salesTokenExpiresAt: new Date(Date.now() - 1000) },
    })
    const rows = await listProspects()
    expect(rows.find((r) => r.id === fresh.prospect.id)?.salesUrl).toBeNull()
    expect(rows.find((r) => r.id === expired.prospect.id)?.salesUrl).toBeNull()
  })

  it('queuePosition follows the shared ordering (prospect-owned first)', async () => {
    // Neutralize stray queued rows in the shared dev DB — positions are
    // meaningless otherwise (queue-manager.test.ts precedent).
    await prisma.siteAudit.updateMany({ where: { status: 'queued' }, data: { status: 'cancelled' } })
    await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}client-q.test`, wcagLevel: 'wcag21aa', status: 'queued',
        createdAt: new Date(Date.now() - 60_000), // older, but NOT prospect-owned
      },
    })
    const created = await createProspect({ name: 'Queue', domain: `${PREFIX}queue.test` })
    if (created.kind === 'invalid') throw new Error('seed failed')
    await prisma.siteAudit.create({
      data: {
        domain: `${PREFIX}queue.test`, wcagLevel: 'wcag21aa', status: 'queued',
        prospectId: created.prospect.id,
      },
    })
    const row = (await listProspects()).find((r) => r.id === created.prospect.id)
    expect(row?.latestAudit?.queuePosition).toBe(1) // jumps the older non-prospect audit
  })
})
