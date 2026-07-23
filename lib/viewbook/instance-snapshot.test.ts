// F2 projection unit tests (Task 3, spec §5): pure — no DB. Fixtures are
// hand-built RawTemplateSection docs; the projection must snapshot raw
// envelopes byte-verbatim (except the welcome roster photo null-strip, whose
// refs are captured member-mapped in the assetPlan BEFORE stripping).
import { describe, it, expect } from 'vitest'
import {
  projectInstanceTree,
  projectSectionInstance,
  offeringAvailability,
  type RawTemplateSection,
  type RawTemplateSubsection,
} from './instance-snapshot'

let nextId = 1

function mkRawSub(overrides: Partial<RawTemplateSubsection> = {}): RawTemplateSubsection {
  return {
    id: nextId++,
    subsectionKey: 'main',
    title: 'Main',
    offeringWebsite: true,
    offeringVa: false,
    offeringPpc: false,
    copyJson: null,
    contentJson: null,
    sortOrder: 10,
    archivedAt: null,
    fields: [],
    ...overrides,
  }
}

function mkRawSection(overrides: Partial<RawTemplateSection> = {}): RawTemplateSection {
  return {
    id: nextId++,
    templateKey: 'welcome',
    rendererType: 'welcome',
    title: 'Welcome',
    copyJson: '{"v":1,"copy":{"purpose":"p","whatThis":"wt","whatWeNeed":null}}',
    contentJson: null,
    sortOrder: 10,
    version: 3,
    archivedAt: null,
    subsections: [mkRawSub()],
    ...overrides,
  }
}

const WEBSITE = { website: true, va: false, ppc: false }

describe('projectInstanceTree — offering + archive filtering (D5)', () => {
  it('includes only subsections matching the enabled offerings and drops sections with no match', async () => {
    const raw = [
      mkRawSection({
        templateKey: 'strategy',
        rendererType: 'strategy',
        subsections: [
          mkRawSub({ subsectionKey: 'main', offeringWebsite: true }),
          mkRawSub({ subsectionKey: 'va-extra', offeringWebsite: false, offeringVa: true }),
        ],
      }),
      mkRawSection({
        templateKey: 'va-only-section',
        rendererType: 'generic-section',
        subsections: [mkRawSub({ subsectionKey: 'va-main', offeringWebsite: false, offeringVa: true })],
      }),
    ]
    const { sections } = projectInstanceTree(raw, WEBSITE, 'upgrade')
    expect(sections.map((s) => s.sectionKey)).toEqual(['strategy'])
    expect(sections[0].subsections.map((s) => s.subsectionKey)).toEqual(['main'])
  })

  it('a multi-offering viewbook includes subsections of every enabled tag', () => {
    const raw = [
      mkRawSection({
        subsections: [
          mkRawSub({ subsectionKey: 'main', offeringWebsite: true }),
          mkRawSub({ subsectionKey: 'va-extra', offeringWebsite: false, offeringVa: true }),
          mkRawSub({ subsectionKey: 'ppc-extra', offeringWebsite: false, offeringPpc: true }),
        ],
      }),
    ]
    const { sections } = projectInstanceTree(raw, { website: true, va: true, ppc: false }, 'upgrade')
    expect(sections[0].subsections.map((s) => s.subsectionKey)).toEqual(['main', 'va-extra'])
  })

  it('skips archived template sections, subsections, and fields', () => {
    const raw = [
      mkRawSection({ templateKey: 'gone', archivedAt: new Date() }),
      mkRawSection({
        templateKey: 'data-source',
        rendererType: 'data-source',
        subsections: [
          mkRawSub({
            subsectionKey: 'school',
            fields: [
              { id: 1, fieldKey: 'live-field', label: 'Live', fieldType: 'text', sortOrder: 1, archivedAt: null },
              { id: 2, fieldKey: 'dead-field', label: 'Dead', fieldType: 'text', sortOrder: 2, archivedAt: new Date() },
            ],
          }),
          mkRawSub({ subsectionKey: 'dead-sub', archivedAt: new Date() }),
        ],
      }),
    ]
    const { sections } = projectInstanceTree(raw, WEBSITE, 'upgrade')
    expect(sections.map((s) => s.sectionKey)).toEqual(['data-source'])
    expect(sections[0].subsections.map((s) => s.subsectionKey)).toEqual(['school'])
    expect(sections[0].subsections[0].fields.map((f) => f.defKey)).toEqual(['live-field'])
  })
})

describe('projectInstanceTree — snapshot fidelity', () => {
  it('snapshots section/subsection scalars verbatim and stamps templateVersion + template ids', () => {
    const sub = mkRawSub({
      subsectionKey: 'main',
      title: 'Sub Title',
      copyJson: '{"v":1,"copy":{"intro":"i","whatWeNeed":null}}',
      contentJson: '{"v":1,"seoBase":{"blocks":[]},"geoBase":{"blocks":[]},"eeatBase":{"blocks":[]}}',
      sortOrder: 30,
    })
    const raw = [
      mkRawSection({
        templateKey: 'strategy',
        rendererType: 'strategy',
        title: 'Your Strategy',
        copyJson: '{"v":1,"copy":{"purpose":"x","whatThis":"y","whatWeNeed":"z"}}',
        sortOrder: 70,
        version: 9,
        subsections: [sub],
      }),
    ]
    const { sections, assetPlan } = projectInstanceTree(raw, WEBSITE, 'upgrade')
    const s = sections[0]
    expect(s).toMatchObject({
      sectionKey: 'strategy',
      rendererType: 'strategy',
      title: 'Your Strategy',
      copyJson: raw[0].copyJson, // byte-verbatim
      contentJson: null,
      sortOrder: 70,
      templateVersion: 9,
      sectionTemplateId: raw[0].id,
      state: 'active',
    })
    const si = s.subsections[0]
    expect(si).toMatchObject({
      subsectionKey: 'main',
      title: 'Sub Title',
      subsectionTemplateId: sub.id,
      copyJson: sub.copyJson,
      sortOrder: 30,
      offeringWebsite: true,
      offeringVa: false,
      offeringPpc: false,
    })
    // Non-welcome content copies BYTE-VERBATIM (same string identity of content).
    expect(si.contentJson).toBe(sub.contentJson)
    expect(assetPlan).toEqual([])
  })

  it('fields carry defKey = fieldKey, category = subsectionKey, null value, createdBy seed', () => {
    const raw = [
      mkRawSection({
        templateKey: 'data-source',
        rendererType: 'data-source',
        subsections: [
          mkRawSub({
            subsectionKey: 'programs',
            fields: [{ id: 5, fieldKey: 'programs-roster', label: 'Programs', fieldType: 'list', sortOrder: 4, archivedAt: null }],
          }),
        ],
      }),
    ]
    const { sections } = projectInstanceTree(raw, WEBSITE, 'upgrade')
    expect(sections[0].subsections[0].fields).toEqual([
      {
        defKey: 'programs-roster',
        category: 'programs',
        label: 'Programs',
        fieldType: 'list',
        sortOrder: 4,
        createdBy: 'seed',
      },
    ])
  })

  it('assessment starts hidden for new-build, active for upgrade; other sections stay active', () => {
    const raw = [
      mkRawSection({ templateKey: 'assessment', rendererType: 'assessment' }),
      mkRawSection({ templateKey: 'brand', rendererType: 'brand' }),
    ]
    const nb = projectInstanceTree(raw, WEBSITE, 'new-build').sections
    expect(nb.find((s) => s.sectionKey === 'assessment')?.state).toBe('hidden')
    expect(nb.find((s) => s.sectionKey === 'brand')?.state).toBe('active')
    const up = projectInstanceTree(raw, WEBSITE, 'upgrade').sections
    expect(up.find((s) => s.sectionKey === 'assessment')?.state).toBe('active')
  })
})

describe('projectInstanceTree — welcome roster null-strip + assetPlan', () => {
  const welcomeContent = JSON.stringify({
    v: 1,
    team: [
      { name: 'With Photo', role: 'CSM', photo: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp', blurb: 'b', isCsm: true },
      { name: 'No Photo', role: 'SEO', photo: null, blurb: 'b2' },
      { name: 'Bad Ref', role: 'X', photo: '../../etc/passwd', blurb: 'b3' },
    ],
    process: { blocks: [] },
    why: { blocks: [] },
  })

  it('writes photo: null in phase-1 content and captures a member-mapped assetPlan BEFORE stripping', () => {
    const raw = [mkRawSection({ subsections: [mkRawSub({ contentJson: welcomeContent })] })]
    const { sections, assetPlan } = projectInstanceTree(raw, WEBSITE, 'upgrade')
    const stored = JSON.parse(sections[0].subsections[0].contentJson as string)
    expect(stored.team.map((m: { photo: unknown }) => m.photo)).toEqual([null, null, null])
    // Everything else survives byte-equal after the strip.
    expect(stored.team.map((m: { name: string }) => m.name)).toEqual(['With Photo', 'No Photo', 'Bad Ref'])
    expect(stored.process).toEqual({ blocks: [] })
    // assetPlan: ONLY the valid, present photo ref — mapped to its member.
    expect(assetPlan).toEqual([
      {
        sectionKey: 'welcome',
        subsectionKey: 'main',
        refs: [{ memberName: 'With Photo', filename: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp' }],
      },
    ])
  })

  it('a corrupt welcome envelope copies verbatim with no plan entry (extractor parity)', () => {
    const raw = [mkRawSection({ subsections: [mkRawSub({ contentJson: 'not-json{' })] })]
    const { sections, assetPlan } = projectInstanceTree(raw, WEBSITE, 'upgrade')
    expect(sections[0].subsections[0].contentJson).toBe('not-json{')
    expect(assetPlan).toEqual([])
  })

  it('non-main subsections are generic — roster-shaped content is NOT stripped', () => {
    const raw = [mkRawSection({ subsections: [mkRawSub({ subsectionKey: 'extra', contentJson: welcomeContent })] })]
    const { sections, assetPlan } = projectInstanceTree(raw, WEBSITE, 'upgrade')
    expect(sections[0].subsections[0].contentJson).toBe(welcomeContent)
    expect(assetPlan).toEqual([])
  })
})

describe('projectSectionInstance', () => {
  it('returns null for an archived section or one with no matching active subsection', () => {
    expect(projectSectionInstance(mkRawSection({ archivedAt: new Date() }), WEBSITE)).toBeNull()
    expect(
      projectSectionInstance(
        mkRawSection({ subsections: [mkRawSub({ offeringWebsite: false, offeringVa: true })] }),
        WEBSITE,
      ),
    ).toBeNull()
  })
})

describe('offeringAvailability', () => {
  it('an offering is available iff ≥1 ACTIVE subsection under an ACTIVE section carries the tag', () => {
    const raw = [
      mkRawSection({
        subsections: [
          mkRawSub({ subsectionKey: 'main', offeringWebsite: true }),
          mkRawSub({ subsectionKey: 'va-dead', offeringWebsite: false, offeringVa: true, archivedAt: new Date() }),
        ],
      }),
      mkRawSection({
        templateKey: 'archived-ppc',
        archivedAt: new Date(),
        subsections: [mkRawSub({ subsectionKey: 'ppc', offeringWebsite: false, offeringPpc: true })],
      }),
    ]
    expect(offeringAvailability(raw)).toEqual({ website: true, va: false, ppc: false })
  })
})
