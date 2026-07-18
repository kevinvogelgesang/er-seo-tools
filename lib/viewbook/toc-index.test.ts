// Pure TOC + fuzzy-search index builders (PR7 Task 8) — feed the floating TOC
// rail (a later task) from data ALREADY on the payload (no new round-trip).
import { describe, expect, it } from 'vitest'
import {
  buildTocIndex,
  buildSearchIndex,
  fuzzyScore,
  searchViewbook,
  type SearchEntry,
} from './toc-index'
import type { ViewbookPublicData } from './public-types'

function section(sectionKey: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sectionKey,
    state: 'active',
    doneAt: null,
    acknowledgedAt: null,
    introNote: null,
    narrative: null,
    ...overrides,
  }
}

// Minimal building-stage fixture: primary lineup carries welcome, milestones,
// data-source, materials, strategy — carried carries pc-setup (not otherwise
// visible content). One category, one milestone, one material, one doc.
function buildFixture(): ViewbookPublicData {
  return {
    viewbookId: 1,
    clientName: 'Acme',
    displayName: 'Acme',
    csmName: null,
    kind: 'new-build',
    welcomeNote: null,
    dataLockedAt: null,
    theme: {} as any,
    stage: 'building',
    stageLabel: 'Now Building',
    syncVersion: 1,
    pcCompletedAt: null,
    clientNotifyJson: [],
    teamMembers: [],
    primarySections: [
      section('welcome'),
      section('milestones'),
      section('data-source', { state: 'done' }),
      section('materials'),
      section('strategy'),
    ] as any,
    carriedSections: [section('pc-setup')] as any,
    fieldCategories: [
      {
        category: 'school',
        fields: [
          { id: 101, defKey: null, label: 'School name', fieldType: 'text', value: 'Acme U', version: 1, createdAt: '2026-01-01', valueUpdatedBy: null, valueUpdatedAt: null, isCustom: false, amendments: [] },
        ],
      },
    ],
    milestones: [
      { id: 201, title: 'Kickoff call', blurb: 'Intro meeting with the team', status: 'current', targetDate: null, doneAt: null, reviewLinks: [] },
    ],
    materials: [
      { id: 301, label: 'Old site backup', status: 'provided', url: 'https://example.com/backup.zip', addedBy: 'client', providedAt: null },
    ],
    docs: {
      global: [{ id: 401, title: 'Brand Guide', blurb: 'How to use our brand', filename: 'brand-guide.pdf', sortOrder: 0 }],
      own: [],
    },
    global: { team: null, pcIntro: null, blocks: {} },
    overrides: {},
  } as unknown as ViewbookPublicData
}

// A parallel fixture where the "hidden" section content (assessment/brand) is
// NOT in either lineup, so its data must never leak into the search index —
// even though the payload technically carries it (e.g. stale fieldCategories
// left over from a prior stage).
function fixtureWithHiddenSection(): ViewbookPublicData {
  const data = buildFixture()
  return {
    ...data,
    primarySections: (data.primarySections as any[]).filter((s) => s.sectionKey !== 'materials'),
  } as unknown as ViewbookPublicData
}

describe('buildTocIndex', () => {
  it('builds one entry per primary section, in lineup order, with done/acked flags', () => {
    const toc = buildTocIndex(buildFixture())
    expect(toc.map((t) => t.sectionKey)).toEqual(['welcome', 'milestones', 'data-source', 'materials', 'strategy'])
    const dataSource = toc.find((t) => t.sectionKey === 'data-source')!
    expect(dataSource.done).toBe(true)
    expect(dataSource.acked).toBe(false)
    expect(dataSource.anchor).toBe('#data-source')
    expect(dataSource.label).toBe('Data Source')
  })

  it('never includes carried sections', () => {
    const toc = buildTocIndex(buildFixture())
    expect(toc.some((t) => t.sectionKey === 'pc-setup')).toBe(false)
  })

  it('adds category sub-entries under data-source only in the building stage', () => {
    const toc = buildTocIndex(buildFixture())
    const dataSource = toc.find((t) => t.sectionKey === 'data-source')!
    expect(dataSource.children).toEqual([{ label: 'Your school', anchor: '#vb-cat-school' }])

    const kickoff = buildTocIndex({ ...buildFixture(), stage: 'kickoff' } as ViewbookPublicData)
    // data-source isn't even in kickoff's primary lineup in this fixture, but
    // guard the rule directly: no non-building stage ever gets children.
    const kickoffDataSource = kickoff.find((t) => t.sectionKey === 'data-source')
    expect(kickoffDataSource?.children).toBeUndefined()
  })

  it('falls back to the raw category key when no label is registered', () => {
    const data = buildFixture()
    data.fieldCategories = [{ category: 'made-up-category', fields: [] }]
    const toc = buildTocIndex(data)
    const dataSource = toc.find((t) => t.sectionKey === 'data-source')!
    expect(dataSource.children).toEqual([{ label: 'made-up-category', anchor: '#vb-cat-made-up-category' }])
  })
})

describe('buildSearchIndex', () => {
  it('emits all five entry kinds for a fully-visible building-stage payload', () => {
    const index = buildSearchIndex(buildFixture())
    const kinds = new Set(index.map((e) => e.kind))
    expect(kinds).toEqual(new Set(['section', 'qa', 'milestone', 'material', 'doc']))
  })

  it('emits a verbose qa sub-entry per field, anchored at the field id', () => {
    const index = buildSearchIndex(buildFixture())
    const qa = index.find((e) => e.kind === 'qa')!
    expect(qa.label).toBe('School name')
    expect(qa.anchor).toBe('#vb-field-101')
    expect(qa.sectionKey).toBe('data-source')
    expect(qa.haystack).toContain('School name')
    expect(qa.haystack).toContain('Acme U')
  })

  it('emits milestone entries anchored at the milestone id, including the blurb in the haystack', () => {
    const index = buildSearchIndex(buildFixture())
    const milestone = index.find((e) => e.kind === 'milestone')!
    expect(milestone.label).toBe('Kickoff call')
    expect(milestone.anchor).toBe('#vb-milestone-201')
    expect(milestone.haystack).toContain('Intro meeting with the team')
  })

  it('includes the milestone description in the haystack so a description-only match is found', () => {
    const data = buildFixture()
    data.milestones = [
      { id: 201, title: 'Kickoff call', blurb: 'Intro meeting with the team', description: 'Bring your laptop and questions.', status: 'current', targetDate: null, doneAt: null, reviewLinks: [] } as any,
    ]
    const index = buildSearchIndex(data)
    const milestone = index.find((e) => e.kind === 'milestone')!
    expect(milestone.haystack).toContain('Bring your laptop and questions.')
    expect(searchViewbook(index, 'laptop').some((e) => e.id === 'milestone:201')).toBe(true)
  })

  it('emits material entries anchored at the material id', () => {
    const index = buildSearchIndex(buildFixture())
    const material = index.find((e) => e.kind === 'material')!
    expect(material.label).toBe('Old site backup')
    expect(material.anchor).toBe('#vb-material-301')
    expect(material.sectionKey).toBe('materials')
  })

  it('emits doc entries (global + own) anchored at the filename, scoped to strategy', () => {
    const index = buildSearchIndex(buildFixture())
    const doc = index.find((e) => e.kind === 'doc')!
    expect(doc.label).toBe('Brand Guide')
    expect(doc.anchor).toBe('#vb-doc-brand-guide.pdf')
    expect(doc.sectionKey).toBe('strategy')
    expect(doc.haystack).toContain('How to use our brand')
  })

  it('excludes content belonging to a section that is not in the visible lineup', () => {
    // materials removed from primary (and not carried) in this fixture —
    // its material rows must not leak into the index even though
    // data.materials still has rows.
    const index = buildSearchIndex(fixtureWithHiddenSection())
    expect(index.some((e) => e.kind === 'material')).toBe(false)
    expect(index.some((e) => e.sectionKey === 'materials')).toBe(false)
  })
})

describe('fuzzyScore', () => {
  it('returns 0 when the query is not a subsequence of the haystack', () => {
    expect(fuzzyScore('xyz', 'hello world')).toBe(0)
  })

  it('returns 0 for an empty query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('HELLO', 'hello world')).toBeGreaterThan(0)
  })

  it('scores a contiguous match higher than a scattered subsequence match', () => {
    const contiguous = fuzzyScore('cat', 'the category') // "cat" appears literally, contiguous
    const scattered = fuzzyScore('cat', 'cXaXt') // same 3 letters, but scattered apart
    expect(contiguous).toBeGreaterThan(scattered)
  })

  it('gives a word-start bonus', () => {
    const wordStart = fuzzyScore('cat', 'cat concatenate') // "cat" at position 0 (word start)
    const midWord = fuzzyScore('cat', 'xxxcatxxx') // "cat" mid-word, no boundary
    expect(wordStart).toBeGreaterThan(midWord)
  })
})

describe('searchViewbook', () => {
  const index: SearchEntry[] = [
    { id: 'a', kind: 'section', label: 'Milestones', sectionKey: 'milestones' as any, anchor: '#milestones', haystack: 'Process & Milestones' },
    { id: 'b', kind: 'qa', label: 'School name', sectionKey: 'data-source' as any, anchor: '#vb-field-101', haystack: 'School name Acme U' },
    { id: 'c', kind: 'material', label: 'Old site backup', sectionKey: 'materials' as any, anchor: '#vb-material-301', haystack: 'Old site backup' },
  ]

  it('filters to entries with a positive score and sorts descending', () => {
    const results = searchViewbook(index, 'school')
    expect(results.map((r) => r.id)).toEqual(['b'])
  })

  it('excludes entries with no match', () => {
    const results = searchViewbook(index, 'zzzznotfound')
    expect(results).toEqual([])
  })

  it('caps results at the given limit (default 20)', () => {
    const big: SearchEntry[] = Array.from({ length: 30 }, (_, i) => ({
      id: `e${i}`,
      kind: 'section',
      label: 'Milestones',
      sectionKey: 'milestones' as any,
      anchor: '#milestones',
      haystack: 'milestones',
    }))
    expect(searchViewbook(big, 'milestones').length).toBe(20)
    expect(searchViewbook(big, 'milestones', 5).length).toBe(5)
  })

  it('returns hits with their original anchors intact', () => {
    const results = searchViewbook(index, 'milestones')
    expect(results[0].anchor).toBe('#milestones')
  })
})
