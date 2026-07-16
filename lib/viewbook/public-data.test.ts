import crypto from 'crypto'
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { loadViewbookPublicData } from './public-data'

// Client.name is @unique — house pattern (route-auth.test.ts): random names.
async function makeClient() {
  return prisma.client.create({ data: { name: `vb-pub-${crypto.randomUUID()}` } })
}

describe('loadViewbookPublicData', () => {
  it('returns null for unknown, revoked, and archived-client tokens', async () => {
    expect(await loadViewbookPublicData('nope')).toBeNull()

    const client = await makeClient()
    const { id, token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    await prisma.viewbook.update({ where: { id }, data: { revokedAt: new Date() } })
    expect(await loadViewbookPublicData(token)).toBeNull()

    await prisma.viewbook.update({ where: { id }, data: { revokedAt: null } })
    await prisma.client.update({ where: { id: client.id }, data: { archivedAt: new Date() } })
    expect(await loadViewbookPublicData(token)).toBeNull()
  })

  it('returns sections visible-only in fixed order; hidden assessment (new-build) is absent', async () => {
    const client = await makeClient()
    const { token } = await createViewbook(client.id, 'new-build', 'kevin@er.com')
    const data = await loadViewbookPublicData(token)
    expect(data).not.toBeNull()
    expect(data!.clientName).toMatch(/^vb-pub-/)
    expect(typeof data!.syncVersion).toBe('number')
    // Creation stage is 'building' in PR1 — the building lineup's primary
    // list mirrors the old fixed SECTION_KEYS order, minus hidden 'assessment'.
    const keys = data!.primarySections.map((s) => s.sectionKey)
    expect(keys).toEqual(['welcome', 'milestones', 'data-source', 'brand', 'strategy', 'materials'])
    expect(data!.carriedSections).toEqual([])
  })

  it('resolves the building lineup: v1 sections primary, nothing carried', async () => {
    const { token } = await createViewbook((await makeClient()).id, 'upgrade', 'op@er.com')
    const data = await loadViewbookPublicData(token) // creation stage is 'building' in PR1
    expect(data?.stage).toBe('building')
    expect(data?.stageLabel).toBe('Now Building')
    expect(data?.primarySections.map((s) => s.sectionKey)).toEqual(
      ['welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy', 'materials'],
    )
    expect(data?.carriedSections).toEqual([])
  })

  it('kickoff stage: primary trio + data-source carried; hidden still suppresses', async () => {
    const { id, token } = await createViewbook((await makeClient()).id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'kickoff' } })
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: id, sectionKey: 'strategy' } },
      data: { state: 'hidden' },
    })
    const data = await loadViewbookPublicData(token)
    expect(data?.stage).toBe('kickoff')
    expect(data?.primarySections.map((s) => s.sectionKey)).toEqual(['welcome', 'milestones'])
    expect(data?.carriedSections.map((s) => s.sectionKey)).toEqual(['data-source'])
  })

  it('unknown stored stage degrades to building lineup (never blanks)', async () => {
    const { id, token } = await createViewbook((await makeClient()).id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'bogus' } })
    const data = await loadViewbookPublicData(token)
    expect(data?.stage).toBe('building')
    expect(data?.primarySections.map((s) => s.sectionKey)).toEqual(
      ['welcome', 'milestones', 'data-source', 'brand', 'assessment', 'strategy', 'materials'],
    )
  })

  it('groups fields by category in catalog order, excludes archived, parses stamps + amendments', async () => {
    const client = await makeClient()
    const { id, token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    const field = await prisma.viewbookField.findFirstOrThrow({
      where: { viewbookId: id, defKey: 'school-name' },
    })
    await prisma.viewbookField.update({
      where: { id: field.id },
      data: { value: 'Pro Way', valueUpdatedBy: 'client', valueUpdatedAt: new Date(), version: 2 },
    })
    await prisma.viewbookFieldAmendment.create({
      data: { fieldId: field.id, value: 'Pro Way Hair School', author: 'client' },
    })
    const archived = await prisma.viewbookField.findFirstOrThrow({
      where: { viewbookId: id, defKey: 'school-contact-name' },
    })
    await prisma.viewbookField.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })

    const data = await loadViewbookPublicData(token)
    expect(data!.fieldCategories[0].category).toBe('school')
    const school = data!.fieldCategories[0].fields
    expect(school.some((f) => f.label === 'Primary contact name')).toBe(false)
    const named = school.find((f) => f.label === 'School name')!
    expect(named.value).toBe('Pro Way')
    expect(named.valueUpdatedBy).toBe('client')
    expect(named.version).toBe(2)
    expect(named.createdAt).toMatch(/^\d{4}-/)
    expect(named.amendments).toHaveLength(1)
    expect(named.amendments[0].value).toBe('Pro Way Hair School')
    expect(named.amendments[0].id).toBeGreaterThan(0)
  })

  it('carries milestones with review links + feedback, and material links', async () => {
    const client = await makeClient()
    const { id, token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    const m = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: id, sortOrder: 5 } })
    const link = await prisma.viewbookReviewLink.create({
      data: { milestoneId: m.id, label: 'Homepage mockup', url: 'https://example.com/mock', kind: 'mockup', createdBy: 'kevin@er.com' },
    })
    await prisma.viewbookFeedback.create({
      data: { reviewLinkId: link.id, body: 'Love it', authorKind: 'client', authorName: 'Pat' },
    })
    await prisma.viewbookMaterialLink.create({
      data: { viewbookId: id, label: 'Logo files', status: 'requested', addedBy: 'kevin@er.com' },
    })

    const data = await loadViewbookPublicData(token)
    expect(data!.milestones).toHaveLength(7)
    expect(data!.milestones[0].status).toBe('current')
    const withLink = data!.milestones.find((x) => x.reviewLinks.length > 0)!
    expect(withLink.reviewLinks[0].url).toBe('https://example.com/mock')
    expect(withLink.reviewLinks[0].feedback[0].body).toBe('Love it')
    expect(data!.materials).toHaveLength(1)
    expect(data!.materials[0].status).toBe('requested')
  })

  it('degrades global content to null blocks instead of failing (corrupt row)', async () => {
    const client = await makeClient()
    const { token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    await prisma.viewbookGlobalContent.upsert({
      where: { key: 'process' },
      update: { bodyJson: 'not-json{', updatedBy: 'kevin@er.com' },
      create: { key: 'process', bodyJson: 'not-json{', updatedBy: 'kevin@er.com' },
    })
    const data = await loadViewbookPublicData(token)
    expect(data).not.toBeNull()
    expect(data!.global.blocks.process ?? null).toBeNull()
  })

  it('degrades ONE failing block without blanking the page (Codex plan-fix 2)', async () => {
    const client = await makeClient()
    const { token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    const spy = vi
      .spyOn(prisma.viewbookMilestone, 'findMany')
      .mockRejectedValueOnce(new Error('simulated db failure'))
    const data = await loadViewbookPublicData(token)
    spy.mockRestore()
    expect(data).not.toBeNull()
    expect(data!.milestones).toEqual([])
    expect(data!.fieldCategories.length).toBeGreaterThan(0) // sibling block survived
  })

  it('rethrows operational failures from token validation instead of masking them as 404 (Codex plan-fix 1)', async () => {
    const spy = vi
      .spyOn(prisma.viewbook, 'findUnique')
      .mockRejectedValueOnce(new Error('simulated db failure'))
    await expect(loadViewbookPublicData('some-token')).rejects.toThrow('simulated db failure')
    spy.mockRestore()
  })
})
