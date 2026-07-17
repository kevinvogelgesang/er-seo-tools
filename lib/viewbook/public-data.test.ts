import crypto from 'crypto'
import { describe, it, expect, vi, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { loadViewbookPublicData, gatePcThanks } from './public-data'
import type { PublicSection } from './public-types'

// Client.name is @unique — house pattern (route-auth.test.ts): random names.
async function makeClient() {
  return prisma.client.create({ data: { name: `vb-pub-${crypto.randomUUID()}` } })
}

// Global ViewbookDoc rows (viewbookId: null) aren't scoped to any client or
// viewbook, so a plain client-cascade cleanup never reaches them — tag with
// a distinctive title prefix so the assertion below can scope to exactly
// this test's rows (never an exact whole-list equality, which would break
// the moment another test/file's global doc coexists in the shared worker
// DB) and afterAll can remove exactly what this file created.
const GLOBAL_DOC_TITLE_PREFIX = 'vb-pub-test-global-doc-'

afterAll(async () => {
  await prisma.viewbookDoc.deleteMany({
    where: { viewbookId: null, title: { startsWith: GLOBAL_DOC_TITLE_PREFIX } },
  })
})

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

  it('kickoff stage: shipped primary sections + data-source carried; hidden still suppresses', async () => {
    const { id, token } = await createViewbook((await makeClient()).id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { stage: 'kickoff' } })
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: id, sectionKey: 'strategy' } },
      data: { state: 'hidden' },
    })
    const data = await loadViewbookPublicData(token)
    expect(data?.stage).toBe('kickoff')
    expect(data?.primarySections.map((s) => s.sectionKey)).toEqual(['welcome', 'milestones', 'kickoff-next'])
    expect(data?.carriedSections.map((s) => s.sectionKey)).toEqual(['data-source'])
  })

  it('adds viewbook identity, CSM name, and ordered global/own docs to the public payload', async () => {
    const { id, token } = await createViewbook((await makeClient()).id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { csmName: 'Kevin' } })
    const marker = crypto.randomUUID()
    const globalSecondTitle = `${GLOBAL_DOC_TITLE_PREFIX}second-${marker}`
    const globalFirstTitle = `${GLOBAL_DOC_TITLE_PREFIX}first-${marker}`
    await prisma.viewbookDoc.createMany({
      data: [
        { viewbookId: null, title: globalSecondTitle, filename: 'g2.pdf', sortOrder: 2, createdBy: 'op@er.com' },
        { viewbookId: null, title: globalFirstTitle, filename: 'g1.pdf', sortOrder: 1, createdBy: 'op@er.com' },
        { viewbookId: id, title: 'Own first', filename: 'o1.pdf', sortOrder: 1, createdBy: 'op@er.com' },
      ],
    })
    const data = await loadViewbookPublicData(token)
    expect(data?.viewbookId).toBe(id)
    expect(data?.csmName).toBe('Kevin')
    // Scoped to this test's own titles (never an exact whole-list equality —
    // the shared worker DB may carry other tests'/files' global doc rows).
    const ownGlobalTitles = data?.docs.global
      .filter((doc) => doc.title.includes(marker))
      .map((doc) => doc.title)
    expect(ownGlobalTitles).toEqual([globalFirstTitle, globalSecondTitle])
    expect(data?.docs.own.map((doc) => doc.title)).toEqual(['Own first'])
  })

  it('fault-isolates docs without blanking sibling payload blocks', async () => {
    const { token } = await createViewbook((await makeClient()).id, 'upgrade', 'op@er.com')
    const original = prisma.viewbookDoc.findMany.bind(prisma.viewbookDoc)
    const spy = vi.spyOn(prisma.viewbookDoc, 'findMany').mockRejectedValueOnce(new Error('docs unavailable'))
    const data = await loadViewbookPublicData(token)
    spy.mockImplementation(original)
    expect(data?.docs).toEqual({ global: [], own: [] })
    expect(data?.fieldCategories.length).toBeGreaterThan(0)
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

  it('emits defKey on seeded fields and null on custom fields (PR5)', async () => {
    const client = await makeClient()
    const { id, token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    await prisma.viewbookField.create({
      data: {
        viewbookId: id,
        defKey: null,
        category: 'school',
        label: 'Custom question',
        fieldType: 'text',
        sortOrder: 999,
        createdBy: 'kevin@er.com',
      },
    })
    const data = await loadViewbookPublicData(token)
    const school = data!.fieldCategories.find((c) => c.category === 'school')!.fields
    const named = school.find((f) => f.label === 'School name')!
    expect(named.defKey).toBe('school-name')
    expect(named.isCustom).toBe(false)
    const custom = school.find((f) => f.label === 'Custom question')!
    expect(custom.defKey).toBeNull()
    expect(custom.isCustom).toBe(true)
  })

  it('carries pcCompletedAt and parsed clientNotifyJson on the payload (PR5)', async () => {
    const { id, token } = await createViewbook((await makeClient()).id, 'upgrade', 'op@er.com')
    let data = await loadViewbookPublicData(token)
    expect(data!.pcCompletedAt).toBeNull()
    expect(data!.clientNotifyJson).toEqual([])

    const stamp = new Date('2026-07-16T12:00:00.000Z')
    await prisma.viewbook.update({
      where: { id },
      data: { pcCompletedAt: stamp, clientNotifyJson: JSON.stringify(['a@example.com', 'b@example.com']) },
    })
    data = await loadViewbookPublicData(token)
    expect(data!.pcCompletedAt).toBe(stamp.toISOString())
    expect(data!.clientNotifyJson).toEqual(['a@example.com', 'b@example.com'])
  })

  it('degrades clientNotifyJson to [] on corrupt/non-array JSON (read exactly as strict as write)', async () => {
    const { id, token } = await createViewbook((await makeClient()).id, 'upgrade', 'op@er.com')
    await prisma.viewbook.update({ where: { id }, data: { clientNotifyJson: 'not-json{' } })
    expect((await loadViewbookPublicData(token))!.clientNotifyJson).toEqual([])
    await prisma.viewbook.update({ where: { id }, data: { clientNotifyJson: JSON.stringify({ not: 'an array' }) } })
    expect((await loadViewbookPublicData(token))!.clientNotifyJson).toEqual([])
  })

  it('carries teamMembers with existence-only `invited` (Codex fix 7 — never send/suppress status)', async () => {
    const { id, token } = await createViewbook((await makeClient()).id, 'upgrade', 'op@er.com')
    const invitedMember = await prisma.viewbookTeamMember.create({
      data: { viewbookId: id, memberKey: 'm-invited', name: 'Invited Pat', email: 'pat@example.com', addedBy: 'client' },
    })
    await prisma.viewbookTeamMember.create({
      data: { viewbookId: id, memberKey: 'm-uninvited', name: 'Uninvited Sam', email: 'sam@example.com', addedBy: 'client' },
    })
    await prisma.viewbookEmailDelivery.create({
      data: {
        viewbookId: id,
        kind: 'team-invite',
        recipient: 'pat@example.com',
        dedupKey: `vb-invite:${invitedMember.memberKey}:1`,
        sentAt: new Date(),
      },
    })
    const data = await loadViewbookPublicData(token)
    const members = data!.teamMembers
    expect(members.map((m) => m.memberKey)).toEqual(['m-invited', 'm-uninvited'])
    expect(members.find((m) => m.memberKey === 'm-invited')!.invited).toBe(true)
    expect(members.find((m) => m.memberKey === 'm-uninvited')!.invited).toBe(false)
    // Existence-only: sentAt/suppressedAt never leak onto the public row.
    expect(members[0]).not.toHaveProperty('sentAt')
    expect(members[0]).not.toHaveProperty('suppressedAt')
  })

  it('derives displayName from the school-name answer, else falls back to clientName (spec §7)', async () => {
    const client = await makeClient()
    const { id, token } = await createViewbook(client.id, 'upgrade', 'op@er.com')
    let data = await loadViewbookPublicData(token)
    expect(data!.displayName).toBe(client.name)

    const field = await prisma.viewbookField.findFirstOrThrow({ where: { viewbookId: id, defKey: 'school-name' } })
    await prisma.viewbookField.update({ where: { id: field.id }, data: { value: '  Pro Way Hair School  ' } })
    data = await loadViewbookPublicData(token)
    expect(data!.displayName).toBe('Pro Way Hair School')
  })

  it('surfaces the pc-intro global-content string in data.global.pcIntro (PR5)', async () => {
    const { token } = await createViewbook((await makeClient()).id, 'upgrade', 'op@er.com')
    let data = await loadViewbookPublicData(token)
    expect(data!.global.pcIntro).toBeNull()

    await prisma.viewbookGlobalContent.upsert({
      where: { key: 'pc-intro' },
      update: { bodyJson: JSON.stringify('Welcome aboard!'), updatedBy: 'op@er.com' },
      create: { key: 'pc-intro', bodyJson: JSON.stringify('Welcome aboard!'), updatedBy: 'op@er.com' },
    })
    data = await loadViewbookPublicData(token)
    expect(data!.global.pcIntro).toBe('Welcome aboard!')
  })

  // Kept LAST in the describe block: vi.spyOn+mockRestore on Prisma's
  // proxy-based model delegate (prisma.viewbook.findUnique) doesn't reliably
  // rehydrate the original method for tests that run after it in the same
  // file — pre-existing flakiness, not something this PR's tests should mask
  // by reordering around it.
  it('rethrows operational failures from token validation instead of masking them as 404 (Codex plan-fix 1)', async () => {
    const spy = vi
      .spyOn(prisma.viewbook, 'findUnique')
      .mockRejectedValueOnce(new Error('simulated db failure'))
    await expect(loadViewbookPublicData('some-token')).rejects.toThrow('simulated db failure')
    spy.mockRestore()
  })
})

describe('gatePcThanks (PR5 pure gate)', () => {
  const sec = (sectionKey: PublicSection['sectionKey']): PublicSection => ({
    sectionKey,
    state: 'active',
    doneAt: null,
    acknowledgedAt: null,
    introNote: null,
    narrative: null,
  })

  it('drops pc-thanks when pcCompletedAt is null', () => {
    const sections = [sec('data-source'), sec('pc-thanks')]
    expect(gatePcThanks(sections, null).map((s) => s.sectionKey)).toEqual(['data-source'])
  })

  it('keeps pc-thanks (and everything else) when pcCompletedAt is set', () => {
    const sections = [sec('data-source'), sec('pc-thanks')]
    expect(gatePcThanks(sections, '2026-07-16T00:00:00.000Z').map((s) => s.sectionKey)).toEqual([
      'data-source',
      'pc-thanks',
    ])
  })

  it('is a no-op when pc-thanks is absent either way', () => {
    const sections = [sec('data-source')]
    expect(gatePcThanks(sections, null)).toEqual(sections)
    expect(gatePcThanks(sections, '2026-07-16T00:00:00.000Z')).toEqual(sections)
  })
})
