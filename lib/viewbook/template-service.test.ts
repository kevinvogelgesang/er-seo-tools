import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { seedViewbookTemplates, CANONICAL_SECTION_ORDER } from './template-seed'
import { GLOBAL_CONTENT_KEYS } from './global-content-keys'
import { SECTION_KEYS } from './theme'
import { sectionCopyKey, putSectionCopyGlobal, resolveSectionCopy } from './section-copy-content'
import { CATALOG } from './catalog'
import { parseTemplateCopy, toLegacySectionCopy } from './template-content'
import { validateSectionCopy } from './section-copy-validator'
import { createViewbook } from './service'
import {
  getTemplateTree,
  patchSectionTemplate,
  reorderSections,
  patchSubsection,
  createSubsection,
  createField,
  patchField,
} from './template-service'
import { parseSubsectionContent, toLegacyGlobalBody } from './template-content'

const OPERATOR = 'kevin@enrollmentresources.com'
const SEED_KEYS = [...GLOBAL_CONTENT_KEYS, ...SECTION_KEYS.map(sectionCopyKey)]

async function mkClient() {
  return prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
}

async function cleanTemplates() {
  await prisma.fieldTemplate.deleteMany({})
  await prisma.subsectionTemplate.deleteMany({})
  await prisma.sectionTemplate.deleteMany({})
  await prisma.viewbookGlobalContent.deleteMany({ where: { key: { in: SEED_KEYS } } })
}

beforeEach(async () => {
  await cleanTemplates()
  await seedViewbookTemplates()
})
afterEach(async () => {
  // Cascades to any Viewbook (+ its subtree) created by mkClient/createViewbook
  // in the test — keeps the "N viewbooks bump exactly once" assertions isolated
  // per-test rather than accumulating across the whole file.
  await prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })
})
afterAll(cleanTemplates)

describe('getTemplateTree', () => {
  it('returns 13 sections in sortOrder with decoded copy and contentKind', async () => {
    const { sections } = await getTemplateTree()
    expect(sections.map((s) => s.templateKey)).toEqual([...CANONICAL_SECTION_ORDER])
    const welcome = sections.find((s) => s.templateKey === 'welcome')!
    expect(welcome.copy).toEqual(resolveSectionCopy('welcome', null, null))
    expect(welcome.subsections[0].contentKind).toBe('welcome')
    const brand = sections.find((s) => s.templateKey === 'brand')!
    expect(brand.subsections[0].contentKind).toBe('none')
    const ds = sections.find((s) => s.templateKey === 'data-source')!
    expect(ds.subsections).toHaveLength(8)
    expect(ds.subsections.every((s) => s.contentKind === 'none')).toBe(true)
    expect(ds.subsections.flatMap((s) => s.fields)).toHaveLength(CATALOG.length)
  })
})

describe('patchSectionTemplate', () => {
  it('copy edit dual-writes the legacy section-copy row and bumps version + syncVersion', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find((x) => x.templateKey === 'brand')!
    const copy = { purpose: 'New purpose', whatThis: 'New what', whatWeNeed: null }
    await patchSectionTemplate(s.id, { version: s.version, copy }, 'op@er.com')
    const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'section-copy:brand' } })
    expect(validateSectionCopy(JSON.parse(row!.bodyJson))).toEqual(copy)
    const after = await prisma.sectionTemplate.findUnique({ where: { id: s.id } })
    expect(after!.version).toBe(s.version + 1)
    expect(toLegacySectionCopy(parseTemplateCopy(after!.copyJson)!)).toEqual(copy)
  })

  it('stale version → 409, txn rolled back: no legacy write, no template change, no syncVersion bump (Codex fix #7)', async () => {
    await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    // ALSO pre-seed an existing legacy row to pin the already-present branch:
    await putSectionCopyGlobal('brand', { purpose: 'Old', whatThis: 'Old', whatWeNeed: null }, 'x')
    const beforeSync = await prisma.viewbook.findMany({ select: { syncVersion: true } })
    const { sections } = await getTemplateTree()
    const s = sections.find((x) => x.templateKey === 'brand')!
    const copy = { purpose: 'P', whatThis: 'W', whatWeNeed: null }
    await expect(patchSectionTemplate(s.id, { version: s.version + 5, copy }, 'op@er.com')).rejects.toMatchObject({
      status: 409,
    })
    const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'section-copy:brand' } })
    expect(JSON.parse(row!.bodyJson).purpose).toBe('Old') // existing legacy content byte-unchanged
    expect(await prisma.viewbook.findMany({ select: { syncVersion: true } })).toEqual(beforeSync) // no bump
    expect((await prisma.sectionTemplate.findUnique({ where: { id: s.id } }))!.version).toBe(s.version)
  })

  it('syncVersion deltas are exact (Codex fix #6): bridged edit +1 per viewbook, title-only +0', async () => {
    await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    await createViewbook((await mkClient()).id, 'upgrade', OPERATOR)
    const { sections } = await getTemplateTree()
    const s = sections.find((x) => x.templateKey === 'brand')!
    const before = await prisma.viewbook.findMany({ orderBy: { id: 'asc' }, select: { syncVersion: true } })
    await patchSectionTemplate(s.id, { version: s.version, copy: { purpose: 'P', whatThis: 'W', whatWeNeed: null } }, 'op@er.com')
    const after = await prisma.viewbook.findMany({ orderBy: { id: 'asc' }, select: { syncVersion: true } })
    expect(after.map((v, i) => v.syncVersion - before[i].syncVersion)).toEqual([1, 1]) // exactly once, every viewbook
    await patchSectionTemplate(s.id, { version: s.version + 1, title: 'T' }, 'op@er.com')
    const after2 = await prisma.viewbook.findMany({ orderBy: { id: 'asc' }, select: { syncVersion: true } })
    expect(after2).toEqual(after) // template-only: zero
  })

  it('title-only edit back-writes nothing', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find((x) => x.templateKey === 'materials')!
    await patchSectionTemplate(s.id, { version: s.version, title: 'Materials & assets' }, 'op@er.com')
    expect(await prisma.viewbookGlobalContent.findUnique({ where: { key: 'section-copy:materials' } })).toBeNull()
  })

  it('rejects an empty patch (neither title nor copy)', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find((x) => x.templateKey === 'materials')!
    await expect(patchSectionTemplate(s.id, { version: s.version }, 'op@er.com')).rejects.toMatchObject({ status: 400 })
  })

  it('rejects an invalid title (too long) and a missing section id', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find((x) => x.templateKey === 'materials')!
    await expect(
      patchSectionTemplate(s.id, { version: s.version, title: 'x'.repeat(201) }, 'op@er.com'),
    ).rejects.toMatchObject({ status: 400 })
    await expect(patchSectionTemplate(999999, { version: 1, title: 'X' }, 'op@er.com')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('rejects an invalid copy shape', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find((x) => x.templateKey === 'brand')!
    await expect(
      patchSectionTemplate(s.id, { version: s.version, copy: { purpose: '' } }, 'op@er.com'),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('reorderSections', () => {
  it('swaps two adjacent sections and bumps both versions; a stale version 409s with ZERO rows changed (Codex fix #4)', async () => {
    const { sections } = await getTemplateTree()
    const [a, b, c] = sections
    await reorderSections([
      { id: a.id, version: a.version, sortOrder: b.sortOrder },
      { id: b.id, version: b.version, sortOrder: a.sortOrder },
    ])
    const after = await getTemplateTree()
    expect(after.sections[0].id).toBe(b.id)
    // one fresh item + one stale item → whole txn rolls back, the FRESH item moved nothing
    const snapshot = await prisma.sectionTemplate.findMany({ select: { id: true, sortOrder: true, version: true } })
    await expect(
      reorderSections([
        { id: c.id, version: c.version, sortOrder: 500 }, // fresh
        { id: a.id, version: a.version, sortOrder: 5 }, // stale (bumped by the swap above)
      ]),
    ).rejects.toMatchObject({ status: 409 })
    expect(await prisma.sectionTemplate.findMany({ select: { id: true, sortOrder: true, version: true } })).toEqual(
      snapshot,
    )
  })

  it('rejects an empty list and duplicate ids', async () => {
    await expect(reorderSections([])).rejects.toMatchObject({ status: 400 })
    const { sections } = await getTemplateTree()
    const [a] = sections
    await expect(
      reorderSections([
        { id: a.id, version: a.version, sortOrder: 1 },
        { id: a.id, version: a.version, sortOrder: 2 },
      ]),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('patchSubsection content bridge', () => {
  it('strategy/main content edit rewrites all three legacy rows + template envelope', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'strategy')!
    const sub = s.subsections[0]
    const blocks = (h: string) => ({ blocks: [{ heading: h, body: 'b' }] })
    await patchSubsection(sub.id, { version: s.version, content: { seoBase: blocks('SEO'), geoBase: blocks('GEO'), eeatBase: blocks('EEAT') } }, 'op@er.com')
    const seo = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'seo-base' } })
    expect(JSON.parse(seo!.bodyJson)).toEqual(blocks('SEO'))
    const after = await prisma.subsectionTemplate.findUnique({ where: { id: sub.id } })
    const parsed = parseSubsectionContent('strategy', after!.contentJson)!
    expect(toLegacyGlobalBody('geo-base', parsed)).toEqual(blocks('GEO'))
    const section = await prisma.sectionTemplate.findUnique({ where: { id: s.id } })
    expect(section!.version).toBe(s.version + 1)
    expect(after!.version).toBe(sub.version + 1)
  })
  it('welcome roster edit ignores incoming photo values (re-derived by name)', async () => {
    await prisma.viewbookGlobalContent.create({ data: { key: 'team', bodyJson: JSON.stringify([{ name: 'A', role: 'R', photo: 'a.webp', blurb: '' }]), updatedBy: 'x' } })
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'welcome')!
    await patchSubsection(s.subsections[0].id, { version: s.version, content: {
      team: [{ name: 'A', role: 'R2', photo: 'evil.webp', blurb: '' }], process: { blocks: [] }, why: { blocks: [] },
    } }, 'op@er.com')
    const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'team' } })
    expect(JSON.parse(row!.bodyJson)[0].photo).toBe('a.webp')
  })
  it('stale version → 409, txn rolled back: no legacy row, no subsection change, no syncVersion bump', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'milestones')!
    await expect(patchSubsection(s.subsections[0].id, { version: s.version + 9, content: { processMilestones: { blocks: [] } } }, 'op@er.com'))
      .rejects.toMatchObject({ status: 409 })
    expect(await prisma.viewbookGlobalContent.findUnique({ where: { key: 'process-milestones' } })).toBeNull()
    const sub = await prisma.subsectionTemplate.findUnique({ where: { id: s.subsections[0].id } })
    expect(sub!.version).toBe(s.subsections[0].version)   // guard threw → subsection update rolled back too
  })
  it('a concurrent roster edit during a welcome content PATCH → 409, nothing committed (throwing roster guard)', async () => {
    await prisma.viewbookGlobalContent.create({ data: { key: 'team', bodyJson: JSON.stringify([{ name: 'A', role: 'R', photo: null, blurb: '' }]), updatedBy: 'x' } })
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'welcome')!
    // patchSubsection loads the team row, then a rival write lands before the txn (deps.beforeWrite seam, test-only)
    await expect(patchSubsection(s.subsections[0].id, {
      version: s.version,
      content: { team: [{ name: 'A', role: 'R2', photo: null, blurb: '' }], process: { blocks: [] }, why: { blocks: [] } },
    }, 'op@er.com', { beforeWrite: async () => {
      await prisma.viewbookGlobalContent.update({ where: { key: 'team' }, data: { bodyJson: JSON.stringify([{ name: 'B', role: 'R', photo: null, blurb: '' }]) } })
    } })).rejects.toMatchObject({ status: 409 })
    const sec = await prisma.sectionTemplate.findUnique({ where: { id: s.id } })
    expect(sec!.version).toBe(s.version)                  // guard bump rolled back with the roster P2025
  })
  it('content on a contentless seeded main → 400; generic content on a created subsection is accepted with no legacy write', async () => {
    const { sections } = await getTemplateTree()
    const brand = sections.find(x => x.templateKey === 'brand')!
    await expect(patchSubsection(brand.subsections[0].id, { version: brand.version, content: { blocks: [] } }, 'op@er.com'))
      .rejects.toMatchObject({ status: 400 })
    await createSubsection(brand.id, { version: brand.version, subsectionKey: 'va-notes', title: 'VA notes', offeringVa: true }, 'op@er.com')
    const t2 = await getTemplateTree()
    const b2 = t2.sections.find(x => x.templateKey === 'brand')!
    const created = b2.subsections.find(x => x.subsectionKey === 'va-notes')!
    expect(created.contentKind).toBe('generic')
    await patchSubsection(created.id, { version: b2.version, content: { blocks: [{ heading: 'H', body: 'B' }] } }, 'op@er.com')
  })
})
describe('fields', () => {
  it('createField validates key format, global uniqueness, version token, bumps aggregate version', async () => {
    const { sections } = await getTemplateTree()
    const ds = sections.find(x => x.templateKey === 'data-source')!
    const sub = ds.subsections[0]
    await expect(createField(sub.id, { version: ds.version, fieldKey: 'Bad Key', label: 'X', fieldType: 'text' }, 'op@er.com')).rejects.toMatchObject({ status: 400 })
    await expect(createField(sub.id, { version: ds.version, fieldKey: 'school-name', label: 'X', fieldType: 'text' }, 'op@er.com')).rejects.toMatchObject({ status: 409 })
    await expect(createField(sub.id, { version: ds.version + 7, fieldKey: 'va-hours', label: 'X', fieldType: 'text' }, 'op@er.com')).rejects.toMatchObject({ status: 409 })  // stale token → rolled back, no row
    expect(await prisma.fieldTemplate.findUnique({ where: { fieldKey: 'va-hours' } })).toBeNull()
    await createField(sub.id, { version: ds.version, fieldKey: 'va-hours', label: 'VA hours', fieldType: 'text' }, 'op@er.com')
    const after = await getTemplateTree()
    expect(after.sections.find(x => x.templateKey === 'data-source')!.version).toBe(ds.version + 1)
  })
  it('patchField archives (never deletes) and 409s on stale version', async () => {
    const { sections } = await getTemplateTree()
    const ds = sections.find(x => x.templateKey === 'data-source')!
    const field = ds.subsections[0].fields[0]
    await patchField(field.id, { version: ds.version, archived: true }, 'op@er.com')
    const row = await prisma.fieldTemplate.findUnique({ where: { id: field.id } })
    expect(row!.archivedAt).not.toBeNull()
    await expect(patchField(field.id, { version: ds.version, label: 'nope' }, 'op@er.com')).rejects.toMatchObject({ status: 409 })
  })
})
