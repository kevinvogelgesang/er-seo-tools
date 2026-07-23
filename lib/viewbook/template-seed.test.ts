import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  CANONICAL_SECTION_ORDER,
  projectTemplateSeed,
  projectTemplateSeedWithIssues,
  createSeedTree,
  seedViewbookTemplates,
  type SeedSourceRow,
  type SeedSectionTree,
} from './template-seed'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import { SECTION_COPY } from './section-copy'
import { CATALOG, CATALOG_CATEGORIES } from './catalog'
import { CATEGORY_LABELS } from './category-labels'
import { PC_INTRO_DEFAULT } from './content-validators'
import { GLOBAL_CONTENT_KEYS } from './global-content-keys'
import { SECTION_KEYS } from './theme'
import { sectionCopyKey } from './section-copy-content'

// ---------------------------------------------------------------------------
// Step 1: pure projection
// ---------------------------------------------------------------------------

const g = (key: string, body: unknown): SeedSourceRow => ({ key, bodyJson: JSON.stringify(body) })
const raw = (key: string, bodyJson: string): SeedSourceRow => ({ key, bodyJson })

const TEAM = [{ name: 'Ada', role: 'CSM', photo: null, blurb: 'Your guide' }]
const PROCESS = { blocks: [{ heading: 'Kickoff', body: 'We begin.' }] }
const WHY = { blocks: [{ heading: 'Why', body: 'Because.' }] }
const SEO = { blocks: [{ heading: 'SEO', body: 'seo body' }] }
const GEO = { blocks: [{ heading: 'GEO', body: 'geo body' }] }
const EEAT = { blocks: [{ heading: 'EEAT', body: 'eeat body' }] }
const MILES = { blocks: [{ heading: 'M1', body: 'first' }] }
const INTRO = 'A custom welcome intro.'
const COPY = { purpose: 'Custom purpose.', whatThis: 'Custom what this.', whatWeNeed: 'Do the thing.' }

function fullGlobals(): SeedSourceRow[] {
  return [
    g('team', TEAM),
    g('process', PROCESS),
    g('why', WHY),
    g('seo-base', SEO),
    g('geo-base', GEO),
    g('eeat-base', EEAT),
    g('process-milestones', MILES),
    g('pc-intro', INTRO),
  ]
}

const byKey = (trees: SeedSectionTree[], k: string) => {
  const t = trees.find((x) => x.templateKey === k)
  if (!t) throw new Error(`no tree ${k}`)
  return t
}

describe('projectTemplateSeed — pure projection', () => {
  it('produces 13 trees in canonical order with gapped sortOrder', () => {
    const trees = projectTemplateSeed([], [])
    expect(trees.map((t) => t.templateKey)).toEqual([...CANONICAL_SECTION_ORDER])
    expect(trees.length).toBe(13)
    expect(trees.map((t) => t.sortOrder)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130])
  })

  it('CANONICAL_SECTION_ORDER covers exactly the 13 SECTION_KEYS', () => {
    expect([...CANONICAL_SECTION_ORDER].sort()).toEqual([...SECTION_KEYS].sort())
  })

  it('rendererType === templateKey and section contentJson === null for all', () => {
    const trees = projectTemplateSeed(fullGlobals(), [])
    for (const t of trees) {
      expect(t.rendererType).toBe(t.templateKey)
      expect(t.contentJson).toBeNull()
    }
  })

  it('title === SECTION_TITLES[key]; data-source is "What we need from you"', () => {
    const trees = projectTemplateSeed([], [])
    for (const t of trees) expect(t.title).toBe(SECTION_TITLES[t.templateKey])
    expect(byKey(trees, 'data-source').title).toBe('What we need from you')
  })

  it('copyJson uses the section-copy row when present+valid, else SECTION_COPY default', () => {
    const trees = projectTemplateSeed([], [g(sectionCopyKey('brand'), COPY)])
    // brand: row present
    const brand = JSON.parse(byKey(trees, 'brand').copyJson)
    expect(brand).toEqual({ v: 1, copy: COPY })
    // welcome: no row → code default (3-key projection)
    const welcome = JSON.parse(byKey(trees, 'welcome').copyJson)
    const d = SECTION_COPY.welcome
    expect(welcome).toEqual({ v: 1, copy: { purpose: d.purpose, whatThis: d.whatThis, whatWeNeed: d.whatWeNeed } })
  })

  it('every non-data-source section has one "main" subsection with website-only offering', () => {
    const trees = projectTemplateSeed([], [])
    for (const t of trees) {
      if (t.templateKey === 'data-source') continue
      expect(t.subsections.length).toBe(1)
      const s = t.subsections[0]
      expect(s.subsectionKey).toBe('main')
      expect(s.title).toBe(t.title)
      expect(s.offeringWebsite).toBe(true)
      expect(s.offeringVa).toBe(false)
      expect(s.offeringPpc).toBe(false)
      expect(s.copyJson).toBeNull()
      expect(s.fields).toEqual([])
    }
  })

  it('data-source has the 8 category subsections with catalog fields', () => {
    const trees = projectTemplateSeed([], [])
    const ds = byKey(trees, 'data-source')
    expect(ds.subsections.map((s) => s.subsectionKey)).toEqual([...CATALOG_CATEGORIES])
    ds.subsections.forEach((s, i) => {
      const cat = CATALOG_CATEGORIES[i]
      expect(s.title).toBe(CATEGORY_LABELS[cat])
      expect(s.sortOrder).toBe((i + 1) * 10)
      expect(s.offeringWebsite).toBe(true)
      expect(s.contentJson).toBeNull()
      const expected = CATALOG.filter((c) => c.category === cat).map((c) => ({
        fieldKey: c.defKey,
        label: c.label,
        fieldType: c.fieldType,
        sortOrder: c.sortOrder,
      }))
      expect(s.fields).toEqual(expected)
    })
  })

  it('flattened FieldTemplate rows equal CATALOG order-sensitively', () => {
    const ds = byKey(projectTemplateSeed([], []), 'data-source')
    const flat = ds.subsections.flatMap((s) => s.fields.map((f) => f.fieldKey))
    expect(flat).toEqual(CATALOG.map((c) => c.defKey))
    expect(flat.length).toBe(CATALOG.length)
  })

  it('content mapping fills welcome/strategy/milestones/pc-intro from the global rows', () => {
    const trees = projectTemplateSeed(fullGlobals(), [])
    expect(JSON.parse(byKey(trees, 'welcome').subsections[0].contentJson!)).toEqual({
      v: 1, team: TEAM, process: PROCESS, why: WHY,
    })
    expect(JSON.parse(byKey(trees, 'strategy').subsections[0].contentJson!)).toEqual({
      v: 1, seoBase: SEO, geoBase: GEO, eeatBase: EEAT,
    })
    expect(JSON.parse(byKey(trees, 'milestones').subsections[0].contentJson!)).toEqual({
      v: 1, processMilestones: MILES,
    })
    expect(JSON.parse(byKey(trees, 'pc-intro').subsections[0].contentJson!)).toEqual({ v: 1, intro: INTRO })
  })

  it('non-content main subsections have contentJson null', () => {
    const trees = projectTemplateSeed(fullGlobals(), [])
    for (const key of ['pc-setup', 'pc-invite', 'kickoff-next', 'ws-intro', 'brand', 'assessment', 'materials', 'pc-thanks']) {
      expect(byKey(trees, key).subsections[0].contentJson).toBeNull()
    }
  })

  it('absent globals → empty seeds and pc-intro default', () => {
    const trees = projectTemplateSeed([], [])
    expect(JSON.parse(byKey(trees, 'welcome').subsections[0].contentJson!)).toEqual({
      v: 1, team: [], process: { blocks: [] }, why: { blocks: [] },
    })
    expect(JSON.parse(byKey(trees, 'strategy').subsections[0].contentJson!)).toEqual({
      v: 1, seoBase: { blocks: [] }, geoBase: { blocks: [] }, eeatBase: { blocks: [] },
    })
    expect(JSON.parse(byKey(trees, 'milestones').subsections[0].contentJson!)).toEqual({
      v: 1, processMilestones: { blocks: [] },
    })
    expect(JSON.parse(byKey(trees, 'pc-intro').subsections[0].contentJson!)).toEqual({ v: 1, intro: PC_INTRO_DEFAULT })
  })

  it('corrupt/invalid rows are treated absent AND returned as issues (never logged)', () => {
    const globalRows: SeedSourceRow[] = [
      raw('team', '{not json'),                       // corrupt-json
      g('process', { blocks: 'nope' }),               // invalid-shape (validateBlocks null)
      g('pc-intro', 42),                              // invalid-shape (validatePcIntro null)
    ]
    const sectionCopyRows: SeedSourceRow[] = [
      raw(sectionCopyKey('brand'), 'garbage{'),       // corrupt-json
      g(sectionCopyKey('welcome'), { purpose: '' }),  // invalid-shape
    ]
    const { trees, issues } = projectTemplateSeedWithIssues(globalRows, sectionCopyRows)
    // treated absent → defaults
    expect(JSON.parse(byKey(trees, 'welcome').subsections[0].contentJson!).team).toEqual([])
    expect(JSON.parse(byKey(trees, 'welcome').subsections[0].contentJson!).process).toEqual({ blocks: [] })
    expect(JSON.parse(byKey(trees, 'pc-intro').subsections[0].contentJson!).intro).toBe(PC_INTRO_DEFAULT)
    // brand + welcome copy fall back to code default
    expect(JSON.parse(byKey(trees, 'brand').copyJson).copy.purpose).toBe(SECTION_COPY.brand.purpose)
    // issues reported with correct reasons
    expect(issues).toContainEqual({ key: 'team', reason: 'corrupt-json' })
    expect(issues).toContainEqual({ key: 'process', reason: 'invalid-shape' })
    expect(issues).toContainEqual({ key: 'pc-intro', reason: 'invalid-shape' })
    expect(issues).toContainEqual({ key: sectionCopyKey('brand'), reason: 'corrupt-json' })
    expect(issues).toContainEqual({ key: sectionCopyKey('welcome'), reason: 'invalid-shape' })
  })

  it('projectTemplateSeed is a thin .trees wrapper', () => {
    const rows = fullGlobals()
    expect(projectTemplateSeed(rows, [])).toEqual(projectTemplateSeedWithIssues(rows, []).trees)
  })
})

// ---------------------------------------------------------------------------
// Step 3: DB-backed seeder
// ---------------------------------------------------------------------------

const SEED_KEYS = [...GLOBAL_CONTENT_KEYS, ...SECTION_KEYS.map(sectionCopyKey)]

async function cleanTemplates() {
  await prisma.fieldTemplate.deleteMany({})
  await prisma.subsectionTemplate.deleteMany({})
  await prisma.sectionTemplate.deleteMany({})
  await prisma.viewbookGlobalContent.deleteMany({ where: { key: { in: SEED_KEYS } } })
}

describe('seedViewbookTemplates — DB-backed', () => {
  beforeEach(cleanTemplates)
  afterAll(cleanTemplates)

  it('empty DB → 13 sections, 20 subsections, CATALOG.length fields', async () => {
    await seedViewbookTemplates()
    expect(await prisma.sectionTemplate.count()).toBe(13)
    expect(await prisma.subsectionTemplate.count()).toBe(12 * 1 + 8)
    expect(await prisma.fieldTemplate.count()).toBe(CATALOG.length)
  })

  it('idempotent re-run adds nothing and preserves operator edits', async () => {
    await seedViewbookTemplates()
    // operator edits pc-intro's row
    await prisma.sectionTemplate.update({
      where: { templateKey: 'pc-intro' },
      data: { title: 'Operator Title', version: 2 },
    })
    await seedViewbookTemplates()
    expect(await prisma.sectionTemplate.count()).toBe(13)
    const edited = await prisma.sectionTemplate.findUnique({ where: { templateKey: 'pc-intro' } })
    expect(edited?.title).toBe('Operator Title')
    expect(edited?.version).toBe(2)
  })

  it('createSeedTree is atomic — a duplicate fieldKey leaves NO partial tree', async () => {
    const tree: SeedSectionTree = {
      templateKey: 'atomic-probe',
      rendererType: 'generic',
      title: 'Atomic',
      copyJson: JSON.stringify({ v: 1, copy: { purpose: 'p', whatThis: 'w', whatWeNeed: null } }),
      contentJson: null,
      sortOrder: 999,
      subsections: [
        {
          subsectionKey: 'main', title: 'Atomic',
          offeringWebsite: true, offeringVa: false, offeringPpc: false,
          copyJson: null, contentJson: null, sortOrder: 10,
          fields: [
            { fieldKey: 'atomic-dup-key', label: 'A', fieldType: 'text', sortOrder: 1 },
            { fieldKey: 'atomic-dup-key', label: 'B', fieldType: 'text', sortOrder: 2 },
          ],
        },
      ],
    }
    await expect(createSeedTree(tree)).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
    expect(await prisma.sectionTemplate.findUnique({ where: { templateKey: 'atomic-probe' } })).toBeNull()
    expect(await prisma.subsectionTemplate.count()).toBe(0)
    expect(await prisma.fieldTemplate.count()).toBe(0)
  })

  it('concurrent double-seed → exactly one create wins, loser P2002s and continues', async () => {
    // 2-party rendezvous on the FIRST templateKey so both runs pass findUnique
    // before either creates it — forcing the P2002 loser path deterministically.
    const target = CANONICAL_SECTION_ORDER[0]
    let arrivals = 0
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const beforeCreate = async (templateKey: string) => {
      if (templateKey !== target) return
      arrivals += 1
      if (arrivals >= 2) release()
      await gate
    }
    await Promise.all([
      seedViewbookTemplates({ beforeCreate }),
      seedViewbookTemplates({ beforeCreate }),
    ])
    expect(await prisma.sectionTemplate.count()).toBe(13)
    expect(await prisma.subsectionTemplate.count()).toBe(20)
    expect(await prisma.fieldTemplate.count()).toBe(CATALOG.length)
  })

  it('a nested fieldKey collision with a pre-existing row skips that section only', async () => {
    // Pre-reserve 'school-name' (a data-source catalog fieldKey) under a dummy tree.
    await prisma.sectionTemplate.create({
      data: {
        templateKey: 'dummy-holder', rendererType: 'generic', title: 'Dummy',
        copyJson: JSON.stringify({ v: 1, copy: { purpose: 'p', whatThis: 'w', whatWeNeed: null } }),
        sortOrder: 5,
        subsections: {
          create: [{
            subsectionKey: 'main', title: 'Dummy', offeringWebsite: true, sortOrder: 10,
            fields: { create: [{ fieldKey: 'school-name', label: 'X', fieldType: 'text', sortOrder: 1 }] },
          }],
        },
      },
    })
    await seedViewbookTemplates()
    // data-source could not seed (its 'school-name' field collides) → skipped
    expect(await prisma.sectionTemplate.findUnique({ where: { templateKey: 'data-source' } })).toBeNull()
    // the other 12 canonical sections seeded fine (+ the dummy holder = 13)
    for (const key of CANONICAL_SECTION_ORDER) {
      if (key === 'data-source') continue
      expect(await prisma.sectionTemplate.findUnique({ where: { templateKey: key } })).not.toBeNull()
    }
    expect(await prisma.sectionTemplate.count()).toBe(13)
  })

  it('a non-P2002 infra failure propagates — never a silent partial success', async () => {
    const spy = vi
      .spyOn(prisma.sectionTemplate, 'create')
      .mockRejectedValueOnce(new Error('db unavailable'))
    await expect(seedViewbookTemplates()).rejects.toThrow('db unavailable')
    spy.mockRestore()
    // first create threw before persisting anything
    expect(await prisma.sectionTemplate.count()).toBe(0)
  })
})
