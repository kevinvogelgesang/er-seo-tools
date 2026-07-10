// lib/keywords/volume-normalize.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeKeyword, normalizeLocale } from './volume-normalize'

describe('normalizeKeyword', () => {
  it('trims, lowercases, and collapses internal whitespace runs', () => {
    expect(normalizeKeyword('  Nursing   Program ')).toBe('nursing program')
  })

  it('passes through an already-normal keyword unchanged', () => {
    expect(normalizeKeyword('nursing program')).toBe('nursing program')
  })

  it('empty string → empty string', () => {
    expect(normalizeKeyword('')).toBe('')
  })

  it('whitespace-only string → empty string', () => {
    expect(normalizeKeyword('   ')).toBe('')
  })

  it('collapses tabs/newlines too', () => {
    expect(normalizeKeyword('nursing\t\nprogram')).toBe('nursing program')
  })
})

describe('normalizeLocale', () => {
  it("'EN' and 'en' normalize to the same canonical locale", () => {
    const upper = normalizeLocale({ locationCode: 2840, languageCode: 'EN' })
    const lower = normalizeLocale({ locationCode: 2840, languageCode: 'en' })
    expect(upper).toEqual({ locationCode: 2840, languageCode: 'en' })
    expect(upper).toEqual(lower)
  })

  it("accepts valid 'en-us' style region-tagged codes", () => {
    expect(normalizeLocale({ locationCode: 2840, languageCode: 'en-us' })).toEqual({
      locationCode: 2840,
      languageCode: 'en-us',
    })
  })

  it('canonicalizes region-tagged code casing', () => {
    expect(normalizeLocale({ locationCode: 2840, languageCode: 'EN-US' })).toEqual({
      locationCode: 2840,
      languageCode: 'en-us',
    })
  })

  it.each([0, -1, 1.5, NaN])('locationCode %p → null', (locationCode) => {
    expect(normalizeLocale({ locationCode, languageCode: 'en' })).toBeNull()
  })

  it.each(['', '  ', 'e', 'english', 'EN_US'])('languageCode %p → null', (languageCode) => {
    expect(normalizeLocale({ locationCode: 2840, languageCode })).toBeNull()
  })
})
