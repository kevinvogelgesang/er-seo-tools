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
import { getTemplateTree, patchSectionTemplate, reorderSections } from './template-service'

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
