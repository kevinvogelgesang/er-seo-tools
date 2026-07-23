import { describe, it, expect } from 'vitest'
import { CATALOG } from './catalog'
import { GLOBAL_CONTENT_KEYS } from './global-content-keys'
import { CAPS } from './section-copy-validator'
import {
  FIELD_KEY_RE,
  parseTemplateCopy,
  parseSubsectionContent,
  parseTemplateContent,
  toLegacySectionCopy,
  toLegacyGlobalBody,
  type SubsectionContentV1,
} from './template-content'

// ---- shared fixtures --------------------------------------------------

const validTeam = [{ name: 'Kevin', role: 'Web Lead', photo: null, blurb: 'Builds the sites.' }]
const processBlocks = { blocks: [{ heading: 'Step 1', body: 'Discovery call.' }] }
const whyBlocks = { blocks: [{ heading: 'Why us', body: 'We deliver results.' }] }

const seoBlocks = { blocks: [{ heading: 'SEO', body: 'On-page work.' }] }
const geoBlocks = { blocks: [{ heading: 'GEO', body: 'Local visibility.' }] }
const eeatBlocks = { blocks: [{ heading: 'E-E-A-T', body: 'Trust signals.' }] }

const milestonesBlocks = { blocks: [{ heading: 'Kickoff', body: 'Week 1.' }] }
const genericBlocks = { blocks: [{ heading: 'Generic', body: 'Config-driven content.' }] }

const welcomeContent: SubsectionContentV1 = { v: 1, team: validTeam, process: processBlocks, why: whyBlocks }
const strategyContent: SubsectionContentV1 = { v: 1, seoBase: seoBlocks, geoBase: geoBlocks, eeatBase: eeatBlocks }
const milestonesContent: SubsectionContentV1 = { v: 1, processMilestones: milestonesBlocks }
const pcIntroContent: SubsectionContentV1 = { v: 1, intro: 'Welcome to your viewbook!' }
const genericContent: SubsectionContentV1 = { v: 1, blocks: genericBlocks }

const sectionCopy = { purpose: 'Purpose text.', whatThis: 'What this section covers.', whatWeNeed: null }

// ---- FIELD_KEY_RE -------------------------------------------------------

describe('FIELD_KEY_RE', () => {
  it('accepts every catalog defKey', () => {
    for (const entry of CATALOG) {
      expect(FIELD_KEY_RE.test(entry.defKey)).toBe(true)
    }
  })

  it('rejects an uppercase leading char', () => {
    expect(FIELD_KEY_RE.test('A-upper')).toBe(false)
  })

  it('rejects a leading hyphen', () => {
    expect(FIELD_KEY_RE.test('-lead')).toBe(false)
  })

  it('rejects 65+ chars', () => {
    expect(FIELD_KEY_RE.test('a' + 'a'.repeat(64))).toBe(false) // 65 chars
    expect(FIELD_KEY_RE.test('a' + 'a'.repeat(63))).toBe(true) // 64 chars, at the cap
  })
})

// ---- parseTemplateCopy --------------------------------------------------

describe('parseTemplateCopy', () => {
  it('round-trips a valid envelope', () => {
    const raw = JSON.stringify({ v: 1, copy: sectionCopy })
    expect(parseTemplateCopy(raw)).toEqual({ v: 1, copy: sectionCopy })
  })

  it('rejects a missing v', () => {
    expect(parseTemplateCopy(JSON.stringify({ copy: sectionCopy }))).toBeNull()
  })

  it('rejects v: 2', () => {
    expect(parseTemplateCopy(JSON.stringify({ v: 2, copy: sectionCopy }))).toBeNull()
  })

  it('rejects an extra top-level key', () => {
    expect(parseTemplateCopy(JSON.stringify({ v: 1, copy: sectionCopy, extra: 1 }))).toBeNull()
  })

  it('rejects an inner copy shape that fails validateSectionCopy (over-cap purpose)', () => {
    const overCap = { ...sectionCopy, purpose: 'p'.repeat(CAPS.purpose + 1) }
    expect(parseTemplateCopy(JSON.stringify({ v: 1, copy: overCap }))).toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseTemplateCopy('{not json')).toBeNull()
  })

  it('rejects null raw', () => {
    expect(parseTemplateCopy(null)).toBeNull()
  })

  it('rejects a non-object top-level shape', () => {
    expect(parseTemplateCopy(JSON.stringify([1, 2, 3]))).toBeNull()
    expect(parseTemplateCopy(JSON.stringify('a string'))).toBeNull()
    expect(parseTemplateCopy(JSON.stringify(42))).toBeNull()
    expect(parseTemplateCopy(JSON.stringify(null))).toBeNull()
  })
})

// ---- parseSubsectionContent — happy path, all five variants ------------

describe('parseSubsectionContent — happy-path round-trips', () => {
  it('welcome', () => {
    expect(parseSubsectionContent('welcome', JSON.stringify(welcomeContent))).toEqual(welcomeContent)
  })

  it('strategy', () => {
    expect(parseSubsectionContent('strategy', JSON.stringify(strategyContent))).toEqual(strategyContent)
  })

  it('milestones', () => {
    expect(parseSubsectionContent('milestones', JSON.stringify(milestonesContent))).toEqual(milestonesContent)
  })

  it('pc-intro', () => {
    expect(parseSubsectionContent('pc-intro', JSON.stringify(pcIntroContent))).toEqual(pcIntroContent)
  })

  it('generic', () => {
    expect(parseSubsectionContent('generic', JSON.stringify(genericContent))).toEqual(genericContent)
  })
})

// ---- parseSubsectionContent — strict whole-doc-reject -------------------

describe('parseSubsectionContent — whole-doc reject', () => {
  it('rejects a missing v', () => {
    const { v: _v, ...rest } = welcomeContent as { v: 1; team: unknown; process: unknown; why: unknown }
    expect(parseSubsectionContent('welcome', JSON.stringify(rest))).toBeNull()
  })

  it('rejects v: 2', () => {
    expect(parseSubsectionContent('welcome', JSON.stringify({ ...welcomeContent, v: 2 }))).toBeNull()
  })

  it('rejects an extra key', () => {
    expect(parseSubsectionContent('welcome', JSON.stringify({ ...welcomeContent, extra: 1 }))).toBeNull()
  })

  it('rejects a wrong inner shape (team not an array)', () => {
    expect(parseSubsectionContent('welcome', JSON.stringify({ ...welcomeContent, team: 'nope' }))).toBeNull()
  })

  it('rejects a wrong inner shape (over-cap block heading)', () => {
    const badProcess = { blocks: [{ heading: 'h'.repeat(201), body: 'b' }] }
    expect(parseSubsectionContent('welcome', JSON.stringify({ ...welcomeContent, process: badProcess }))).toBeNull()
  })

  it('rejects malformed JSON', () => {
    expect(parseSubsectionContent('welcome', '{not json')).toBeNull()
  })

  it('rejects null raw for any renderer type', () => {
    expect(parseSubsectionContent('welcome', null)).toBeNull()
    expect(parseSubsectionContent('brand', null)).toBeNull()
    expect(parseSubsectionContent('bogus-type', null)).toBeNull()
  })

  it('rejects an entirely unknown rendererType even with well-formed content', () => {
    expect(parseSubsectionContent('not-a-real-renderer', JSON.stringify(genericContent))).toBeNull()
  })

  it('rejects non-null content for a contentless renderer (e.g. brand)', () => {
    expect(parseSubsectionContent('brand', JSON.stringify(welcomeContent))).toBeNull()
    expect(parseSubsectionContent('brand', JSON.stringify(genericContent))).toBeNull()
    expect(parseSubsectionContent('data-source', JSON.stringify(genericContent))).toBeNull()
    expect(parseSubsectionContent('pc-setup', JSON.stringify(genericContent))).toBeNull()
  })
})

// ---- parseTemplateContent — always null in F1 --------------------------

describe('parseTemplateContent', () => {
  it('returns null for null raw', () => {
    expect(parseTemplateContent('welcome', null)).toBeNull()
    expect(parseTemplateContent('brand', null)).toBeNull()
  })

  it('rejects ALL non-null input, including well-formed-looking JSON', () => {
    expect(parseTemplateContent('welcome', JSON.stringify({ v: 1, anything: true }))).toBeNull()
    expect(parseTemplateContent('generic', JSON.stringify(genericContent))).toBeNull()
    expect(parseTemplateContent('brand', 'plain string, not even JSON')).toBeNull()
    expect(parseTemplateContent('brand', JSON.stringify({}))).toBeNull()
    expect(parseTemplateContent('bogus-type', JSON.stringify({ v: 1 }))).toBeNull()
  })
})

// ---- toLegacySectionCopy -------------------------------------------------

describe('toLegacySectionCopy', () => {
  it('unwraps to exactly the 3-key SectionCopyContent shape (never leaks v)', async () => {
    const { validateSectionCopy } = await import('./section-copy-validator')
    const parsed = parseTemplateCopy(JSON.stringify({ v: 1, copy: sectionCopy }))
    expect(parsed).not.toBeNull()
    const legacy = toLegacySectionCopy(parsed!)
    expect(legacy).toEqual(sectionCopy)
    expect(Object.keys(legacy).sort()).toEqual(['purpose', 'whatThis', 'whatWeNeed'])
    expect(validateSectionCopy(legacy)).toEqual(sectionCopy)
  })
})

// ---- toLegacyGlobalBody — all eight keys + mismatches --------------------

describe('toLegacyGlobalBody', () => {
  it('team ← welcome content', () => {
    expect(toLegacyGlobalBody('team', welcomeContent)).toEqual(validTeam)
  })

  it('process ← welcome content', () => {
    expect(toLegacyGlobalBody('process', welcomeContent)).toEqual(processBlocks)
  })

  it('why ← welcome content', () => {
    expect(toLegacyGlobalBody('why', welcomeContent)).toEqual(whyBlocks)
  })

  it('seo-base ← strategy content', () => {
    expect(toLegacyGlobalBody('seo-base', strategyContent)).toEqual(seoBlocks)
  })

  it('geo-base ← strategy content', () => {
    expect(toLegacyGlobalBody('geo-base', strategyContent)).toEqual(geoBlocks)
  })

  it('eeat-base ← strategy content', () => {
    expect(toLegacyGlobalBody('eeat-base', strategyContent)).toEqual(eeatBlocks)
  })

  it('process-milestones ← milestones content', () => {
    expect(toLegacyGlobalBody('process-milestones', milestonesContent)).toEqual(milestonesBlocks)
  })

  it('pc-intro ← pc-intro content', () => {
    expect(toLegacyGlobalBody('pc-intro', pcIntroContent)).toBe('Welcome to your viewbook!')
  })

  it('covers all eight GlobalContentKey values with a matching mapping', () => {
    expect(GLOBAL_CONTENT_KEYS.length).toBe(8)
  })

  it('renderer/key MISMATCH: team key against strategy content → null', () => {
    expect(toLegacyGlobalBody('team', strategyContent)).toBeNull()
  })

  it('renderer/key MISMATCH: seo-base key against welcome content → null', () => {
    expect(toLegacyGlobalBody('seo-base', welcomeContent)).toBeNull()
  })

  it('renderer/key MISMATCH: process-milestones key against pc-intro content → null', () => {
    expect(toLegacyGlobalBody('process-milestones', pcIntroContent)).toBeNull()
  })

  it('renderer/key MISMATCH: pc-intro key against welcome content → null', () => {
    expect(toLegacyGlobalBody('pc-intro', welcomeContent)).toBeNull()
  })

  it('renderer/key MISMATCH: every global key against generic content → null (no field matches)', () => {
    for (const key of GLOBAL_CONTENT_KEYS) {
      expect(toLegacyGlobalBody(key, genericContent)).toBeNull()
    }
  })
})
