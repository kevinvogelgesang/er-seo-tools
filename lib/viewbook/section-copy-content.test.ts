import { describe, it, expect } from 'vitest'
import { validateSectionCopy, resolveSectionCopy, sectionCopyKey } from './section-copy-content'
import { SECTION_COPY } from './section-copy'

describe('sectionCopyKey', () => {
  it('namespaces the section key', () => {
    expect(sectionCopyKey('brand')).toBe('section-copy:brand')
  })
})

describe('validateSectionCopy', () => {
  it('accepts a well-formed object and normalizes empty whatWeNeed to null', () => {
    expect(validateSectionCopy({ purpose: 'p', whatThis: 't', whatWeNeed: '' }))
      .toEqual({ purpose: 'p', whatThis: 't', whatWeNeed: null })
    expect(validateSectionCopy({ purpose: 'p', whatThis: 't', whatWeNeed: '  ' })!.whatWeNeed).toBeNull()
    expect(validateSectionCopy({ purpose: 'p', whatThis: 't', whatWeNeed: 'need' })!.whatWeNeed).toBe('need')
  })
  it('rejects missing/extra fields, wrong types, and over-cap', () => {
    expect(validateSectionCopy({ purpose: 'p', whatThis: 't' })).toBeNull()
    expect(validateSectionCopy({ purpose: 'p', whatThis: 't', whatWeNeed: null, extra: 1 })).toBeNull()
    expect(validateSectionCopy({ purpose: 1, whatThis: 't', whatWeNeed: null })).toBeNull()
    expect(validateSectionCopy({ purpose: 'p', whatThis: 'x'.repeat(601), whatWeNeed: null })).toBeNull()
    expect(validateSectionCopy(null)).toBeNull()
    expect(validateSectionCopy('nope')).toBeNull()
  })
  it('requires purpose and whatThis to be non-empty', () => {
    expect(validateSectionCopy({ purpose: '', whatThis: 't', whatWeNeed: null })).toBeNull()
    expect(validateSectionCopy({ purpose: 'p', whatThis: '', whatWeNeed: null })).toBeNull()
  })
})

describe('resolveSectionCopy (3-layer, whole-object per layer)', () => {
  const code = SECTION_COPY['brand'] // { purpose, whatThis, whatWeNeed }
  it('falls back to the code default when both layers absent', () => {
    const r = resolveSectionCopy('brand', null, null)
    expect(r).toEqual({ purpose: code.purpose, whatThis: code.whatThis, whatWeNeed: code.whatWeNeed })
  })
  it('company-wide wins over code default', () => {
    const cw = { purpose: 'CW p', whatThis: 'CW t', whatWeNeed: null }
    expect(resolveSectionCopy('brand', cw, null)).toEqual(cw)
  })
  it('per-viewbook override wins over company-wide', () => {
    const cw = { purpose: 'CW p', whatThis: 'CW t', whatWeNeed: 'cw' }
    const ov = { purpose: 'OV p', whatThis: 'OV t', whatWeNeed: null }
    expect(resolveSectionCopy('brand', cw, ov)).toEqual(ov)
  })
  it('an ABSENT override (null, e.g. invalidated upstream) falls through to company-wide, not code default', () => {
    const cw = { purpose: 'CW p', whatThis: 'CW t', whatWeNeed: 'cw' }
    expect(resolveSectionCopy('brand', cw, null)).toEqual(cw)
  })
})
