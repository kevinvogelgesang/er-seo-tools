// F1a Task 7 — seed-projection parity ACCEPTANCE suite (spec §6, fix #15).
//
// This is the roadmap's "byte-parity" bar in its additive-phase form: the
// viewer doesn't read templates until F2, so what's provable NOW is that the
// projected seed (`projectTemplateSeed`, Tasks 3-6) decodes back to EXACTLY
// the same values the legacy global-content / section-copy stores already
// serve. All comparisons are on DECODED values, never raw JSON strings, and
// this suite is PURE — fixture rows in, projection out, no DB.
//
// Codex plan-fix #8: a raw `{key, bodyJson}` fixture is NEVER handed to
// `resolveSectionCopy` directly. It is first run through the same
// `validateSectionCopy` gate the projector itself uses, and THAT validated
// value is what `resolveSectionCopy` compares against.
//
// Atomicity / double-seed / edit-preservation live in Task 6's
// `template-seed.test.ts` (DB-backed) — not repeated here. The F1b
// bridge-parity test (template write -> legacy row) lands with F1b.
import { describe, it, expect } from 'vitest'
import {
  projectTemplateSeed,
  projectTemplateSeedWithIssues,
  type SeedSourceRow,
  type SeedSectionTree,
} from './template-seed'
import {
  parseTemplateCopy,
  parseSubsectionContent,
  toLegacySectionCopy,
  toLegacyGlobalBody,
} from './template-content'
import { validateSectionCopy, type SectionCopyContent } from './section-copy-validator'
import { resolveSectionCopy, sectionCopyKey } from './section-copy-content'
import { validateTeam, validateBlocks, validatePcIntro, PC_INTRO_DEFAULT } from './content-validators'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import { SECTION_COPY } from './section-copy'
import { CATALOG, CATALOG_CATEGORIES } from './catalog'
import { CATEGORY_LABELS } from './category-labels'
import { SECTION_KEYS, type SectionKey } from './theme'

// ---- fixture helpers --------------------------------------------------

const g = (key: string, body: unknown): SeedSourceRow => ({ key, bodyJson: JSON.stringify(body) })
const raw = (key: string, bodyJson: string): SeedSourceRow => ({ key, bodyJson })

const ALL_KEYS: SectionKey[] = [...SECTION_KEYS]

const byKey = (trees: SeedSectionTree[], k: string): SeedSectionTree => {
  const t = trees.find((x) => x.templateKey === k)
  if (!t) throw new Error(`no tree ${k}`)
  return t
}

// ===========================================================================
// 1. Copy parity, per key (Codex plan-fix #8)
// ===========================================================================

function customCopyFor(key: SectionKey): SectionCopyContent {
  return {
    purpose: `Custom purpose for ${key}.`,
    whatThis: `Custom what-this text for ${key}.`,
    whatWeNeed: key === 'pc-thanks' ? null : `Custom what-we-need for ${key}.`,
  }
}

// Every key gets a `section-copy:` row EXCEPT one (FALLBACK_KEY), so the
// same table-driven assertion below exercises both the override path and
// the code-default fallback path across the full 13-key catalog.
const FALLBACK_KEY: SectionKey = 'kickoff-next'

const sectionCopyRows: SeedSourceRow[] = ALL_KEYS
  .filter((k) => k !== FALLBACK_KEY)
  .map((k) => g(sectionCopyKey(k), customCopyFor(k)))

describe('Copy parity — per key (fix #8: fixture validated before resolveSectionCopy)', () => {
  const trees = projectTemplateSeed([], sectionCopyRows)

  it.each(ALL_KEYS)(
    'key=%s: toLegacySectionCopy(parseTemplateCopy(tree.copyJson)) deep-equals resolveSectionCopy(key, validatedGlobal, null)',
    (key) => {
      const tree = byKey(trees, key)
      const parsed = parseTemplateCopy(tree.copyJson)
      expect(parsed).not.toBeNull()
      const legacy = toLegacySectionCopy(parsed!)

      // Fix #8: validate the raw fixture FIRST — never hand a raw row to
      // resolveSectionCopy.
      const row = sectionCopyRows.find((r) => r.key === sectionCopyKey(key))
      const validatedGlobal = row ? validateSectionCopy(JSON.parse(row.bodyJson)) : null
      if (row) expect(validatedGlobal).not.toBeNull() // fixtures are well-formed by construction

      const expected = resolveSectionCopy(key, validatedGlobal, null)
      expect(legacy).toEqual(expected)
    },
  )

  it('precedence: a present section-copy row overrides the code default', () => {
    const tree = byKey(trees, 'welcome')
    const legacy = toLegacySectionCopy(parseTemplateCopy(tree.copyJson)!)
    expect(legacy).toEqual(customCopyFor('welcome'))
    expect(legacy).not.toEqual(SECTION_COPY.welcome)
  })

  it('fallback: an absent section-copy row resolves to the code default', () => {
    const tree = byKey(trees, FALLBACK_KEY)
    const legacy = toLegacySectionCopy(parseTemplateCopy(tree.copyJson)!)
    expect(legacy).toEqual(resolveSectionCopy(FALLBACK_KEY, null, null))
    expect(legacy).toEqual(SECTION_COPY[FALLBACK_KEY])
  })
})

// ===========================================================================
// 2. Title parity
// ===========================================================================

describe('Title parity', () => {
  const trees = projectTemplateSeed([], [])

  it.each(ALL_KEYS)('key=%s: tree.title === SECTION_TITLES[key]', (key) => {
    expect(byKey(trees, key).title).toBe(SECTION_TITLES[key])
  })

  it('data-source carries the data-source-rename title "What we need from you"', () => {
    expect(SECTION_TITLES['data-source']).toBe('What we need from you')
    expect(byKey(trees, 'data-source').title).toBe('What we need from you')
  })
})

// ===========================================================================
// 3. Content parity — welcome / strategy / milestones / pc-intro
// ===========================================================================

const TEAM_ROW = g('team', [
  { name: 'Ada Lovelace', role: 'CSM', photo: 'ada-headshot.jpg', blurb: 'Your onboarding guide.' },
  { name: 'Grace Hopper', role: 'Strategist', photo: null, blurb: 'Keeps the strategy sharp.' },
])
const PROCESS_ROW = g('process', { blocks: [{ heading: 'Kickoff', body: 'We start with a call.' }] })
const WHY_ROW = g('why', { blocks: [{ heading: 'Why us', body: 'Because we deliver results.' }] })
const SEO_ROW = g('seo-base', { blocks: [{ heading: 'SEO', body: 'On-page + technical work.' }] })
const GEO_ROW = g('geo-base', { blocks: [{ heading: 'GEO', body: 'Local + map-pack visibility.' }] })
const EEAT_ROW = g('eeat-base', { blocks: [{ heading: 'E-E-A-T', body: 'Trust + authority signals.' }] })
const MILES_ROW = g('process-milestones', { blocks: [{ heading: 'Milestone 1', body: 'Discovery complete.' }] })
const INTRO_ROW = g('pc-intro', 'A fully custom onboarding welcome message.')

const CONTENT_GLOBAL_ROWS: SeedSourceRow[] = [
  TEAM_ROW, PROCESS_ROW, WHY_ROW, SEO_ROW, GEO_ROW, EEAT_ROW, MILES_ROW, INTRO_ROW,
]

describe('Content parity — decoded values against the exact global-store objects', () => {
  const trees = projectTemplateSeed(CONTENT_GLOBAL_ROWS, [])

  it('welcome/main decoded content deep-equals validateTeam/validateBlocks of the source rows (incl. photo filenames)', () => {
    const decodedTeam = validateTeam(JSON.parse(TEAM_ROW.bodyJson))
    const decodedProcess = validateBlocks(JSON.parse(PROCESS_ROW.bodyJson))
    const decodedWhy = validateBlocks(JSON.parse(WHY_ROW.bodyJson))
    expect(decodedTeam).not.toBeNull()
    expect(decodedProcess).not.toBeNull()
    expect(decodedWhy).not.toBeNull()
    // photo filenames survive decoding exactly
    expect(decodedTeam![0].photo).toBe('ada-headshot.jpg')
    expect(decodedTeam![1].photo).toBeNull()

    const welcomeTree = byKey(trees, 'welcome')
    const parsed = parseSubsectionContent('welcome', welcomeTree.subsections[0].contentJson)
    expect(parsed).toEqual({ v: 1, team: decodedTeam, process: decodedProcess, why: decodedWhy })

    expect(toLegacyGlobalBody('team', parsed!)).toEqual(decodedTeam)
    expect(toLegacyGlobalBody('process', parsed!)).toEqual(decodedProcess)
    expect(toLegacyGlobalBody('why', parsed!)).toEqual(decodedWhy)
  })

  it('strategy/main decoded content deep-equals validateBlocks of the seo/geo/eeat rows', () => {
    const decodedSeo = validateBlocks(JSON.parse(SEO_ROW.bodyJson))
    const decodedGeo = validateBlocks(JSON.parse(GEO_ROW.bodyJson))
    const decodedEeat = validateBlocks(JSON.parse(EEAT_ROW.bodyJson))
    expect(decodedSeo).not.toBeNull()
    expect(decodedGeo).not.toBeNull()
    expect(decodedEeat).not.toBeNull()

    const strategyTree = byKey(trees, 'strategy')
    const parsed = parseSubsectionContent('strategy', strategyTree.subsections[0].contentJson)
    expect(parsed).toEqual({ v: 1, seoBase: decodedSeo, geoBase: decodedGeo, eeatBase: decodedEeat })

    expect(toLegacyGlobalBody('seo-base', parsed!)).toEqual(decodedSeo)
    expect(toLegacyGlobalBody('geo-base', parsed!)).toEqual(decodedGeo)
    expect(toLegacyGlobalBody('eeat-base', parsed!)).toEqual(decodedEeat)
  })

  it('milestones/main decoded content deep-equals validateBlocks of the process-milestones row', () => {
    const decodedMiles = validateBlocks(JSON.parse(MILES_ROW.bodyJson))
    expect(decodedMiles).not.toBeNull()

    const milestonesTree = byKey(trees, 'milestones')
    const parsed = parseSubsectionContent('milestones', milestonesTree.subsections[0].contentJson)
    expect(parsed).toEqual({ v: 1, processMilestones: decodedMiles })
    expect(toLegacyGlobalBody('process-milestones', parsed!)).toEqual(decodedMiles)
  })

  it('pc-intro/main decoded content string-equals the pc-intro row', () => {
    const decodedIntro = validatePcIntro(JSON.parse(INTRO_ROW.bodyJson))
    expect(decodedIntro).not.toBeNull()
    expect(decodedIntro).toBe('A fully custom onboarding welcome message.')

    const introTree = byKey(trees, 'pc-intro')
    const parsed = parseSubsectionContent('pc-intro', introTree.subsections[0].contentJson)
    expect(parsed).toEqual({ v: 1, intro: decodedIntro })
    expect(toLegacyGlobalBody('pc-intro', parsed!)).toBe(decodedIntro)
  })
})

// ===========================================================================
// 4. Catalog parity
// ===========================================================================

describe('Catalog parity', () => {
  const trees = projectTemplateSeed([], [])
  const ds = byKey(trees, 'data-source')

  it('flattened FieldTemplate seed rows deep-equal CATALOG order-sensitively (fieldKey/category/label/fieldType/sortOrder)', () => {
    const flattened = ds.subsections.flatMap((s) =>
      s.fields.map((f) => ({
        fieldKey: f.fieldKey,
        category: s.subsectionKey,
        label: f.label,
        fieldType: f.fieldType,
        sortOrder: f.sortOrder,
      })),
    )
    const expected = CATALOG.map((c) => ({
      fieldKey: c.defKey,
      category: c.category,
      label: c.label,
      fieldType: c.fieldType,
      sortOrder: c.sortOrder,
    }))
    expect(flattened).toEqual(expected)
    expect(flattened.length).toBe(CATALOG.length)
  })

  it('data-source subsection order matches CATALOG_CATEGORIES order-sensitively', () => {
    expect(ds.subsections.map((s) => s.subsectionKey)).toEqual([...CATALOG_CATEGORIES])
  })

  it('subsection titles equal CATEGORY_LABELS for every category', () => {
    for (const s of ds.subsections) {
      expect(s.title).toBe(CATEGORY_LABELS[s.subsectionKey])
    }
  })
})

// ===========================================================================
// 5. Behavior — absence/corruption + section-copy precedence
// ===========================================================================

describe('Behavior — absent globals, corrupt bodyJson, section-copy precedence', () => {
  it('absent globals -> empty seeds + pc-intro fallback (decoded)', () => {
    const trees = projectTemplateSeed([], [])

    const welcome = parseSubsectionContent('welcome', byKey(trees, 'welcome').subsections[0].contentJson)
    expect(welcome).toEqual({ v: 1, team: [], process: { blocks: [] }, why: { blocks: [] } })

    const strategy = parseSubsectionContent('strategy', byKey(trees, 'strategy').subsections[0].contentJson)
    expect(strategy).toEqual({ v: 1, seoBase: { blocks: [] }, geoBase: { blocks: [] }, eeatBase: { blocks: [] } })

    const milestones = parseSubsectionContent('milestones', byKey(trees, 'milestones').subsections[0].contentJson)
    expect(milestones).toEqual({ v: 1, processMilestones: { blocks: [] } })

    const pcIntro = parseSubsectionContent('pc-intro', byKey(trees, 'pc-intro').subsections[0].contentJson)
    expect(pcIntro).toEqual({ v: 1, intro: PC_INTRO_DEFAULT })
  })

  it('corrupt bodyJson on a global key -> treated absent, and recorded as the issue the seeder logs', () => {
    // `projectTemplateSeedWithIssues` is PURELY a projection: it never logs
    // (template-seed.ts fix #3). `seedViewbookTemplates` (Task 6, DB-backed)
    // is the layer that turns every returned issue into a `logError` call —
    // this pure suite proves the DATA that call is built from is correct;
    // the actual logging call is exercised in template-seed.test.ts.
    const globalRows: SeedSourceRow[] = [raw('team', '{not valid json')]
    const { trees, issues } = projectTemplateSeedWithIssues(globalRows, [])

    const welcome = parseSubsectionContent('welcome', byKey(trees, 'welcome').subsections[0].contentJson)
    expect(welcome).toEqual({ v: 1, team: [], process: { blocks: [] }, why: { blocks: [] } })
    expect(issues).toContainEqual({ key: 'team', reason: 'corrupt-json' })
  })

  it('corrupt bodyJson on a section-copy row -> treated absent, falls back to the code default, and is recorded as an issue', () => {
    const sectionCopyRowsCorrupt: SeedSourceRow[] = [raw(sectionCopyKey('brand'), 'not json{{')]
    const { trees, issues } = projectTemplateSeedWithIssues([], sectionCopyRowsCorrupt)

    const legacy = toLegacySectionCopy(parseTemplateCopy(byKey(trees, 'brand').copyJson)!)
    expect(legacy).toEqual(SECTION_COPY.brand)
    expect(issues).toContainEqual({ key: sectionCopyKey('brand'), reason: 'corrupt-json' })
  })

  it('section-copy: row precedence over the code default, verified through resolveSectionCopy directly', () => {
    const custom: SectionCopyContent = {
      purpose: 'Precedence check.',
      whatThis: 'This row must override the code default.',
      whatWeNeed: null,
    }
    const trees = projectTemplateSeed([], [g(sectionCopyKey('materials'), custom)])
    const legacy = toLegacySectionCopy(parseTemplateCopy(byKey(trees, 'materials').copyJson)!)

    const validatedGlobal = validateSectionCopy(custom)
    expect(legacy).toEqual(resolveSectionCopy('materials', validatedGlobal, null))
    expect(legacy).not.toEqual(resolveSectionCopy('materials', null, null))
    expect(legacy).not.toEqual(SECTION_COPY.materials)
  })
})
