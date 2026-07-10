// lib/services/prospects.test.ts
// DB-backed against local SQLite.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { createProspect, listProspects, normalizeProspectDomain } from './prospects'

const PREFIX = 'c14-svc-'
async function cleanup() {
  const rows = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
  const ids = rows.map((r) => r.id)
  await prisma.siteAudit.deleteMany({ where: { prospectId: { in: ids } } })
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
