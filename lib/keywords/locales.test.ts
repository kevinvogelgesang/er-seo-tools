import { describe, it, expect } from 'vitest'
import { CURATED_LOCALES, validateProfileLocale } from './locales'
import { normalizeLocale } from './volume-normalize'

describe('CURATED_LOCALES', () => {
  it('has the six spec §8 markets', () => {
    expect(CURATED_LOCALES).toHaveLength(6)
    expect(CURATED_LOCALES.map((l) => [l.locationCode, l.languageCode])).toEqual([
      [2840, 'en'], [2124, 'en'], [2124, 'fr'], [2826, 'en'], [2036, 'en'], [2840, 'es'],
    ])
  })
  it('every entry passes BOTH normalizeLocale and validateProfileLocale', () => {
    for (const l of CURATED_LOCALES) {
      expect(normalizeLocale(l)).toEqual({ locationCode: l.locationCode, languageCode: l.languageCode })
      expect(validateProfileLocale(l)).toEqual({ locationCode: l.locationCode, languageCode: l.languageCode })
    }
  })
})

describe('validateProfileLocale', () => {
  it('canonicalizes case/whitespace', () => {
    expect(validateProfileLocale({ locationCode: 2840, languageCode: ' EN ' }))
      .toEqual({ locationCode: 2840, languageCode: 'en' })
  })
  it('rejects hyphenated regionals until case-sensitivity is verified (spec §8.3)', () => {
    expect(validateProfileLocale({ locationCode: 2158, languageCode: 'zh-TW' })).toBeNull()
    expect(validateProfileLocale({ locationCode: 2076, languageCode: 'pt-br' })).toBeNull()
  })
  it('rejects three-letter Labs-only codes — the documented Google Ads provider boundary (spec §8.2)', () => {
    expect(validateProfileLocale({ locationCode: 2608, languageCode: 'ceb' })).toBeNull()
  })
  it('rejects junk shapes', () => {
    expect(validateProfileLocale(null)).toBeNull()
    expect(validateProfileLocale({ locationCode: 0, languageCode: 'en' })).toBeNull()
    expect(validateProfileLocale({ locationCode: 1.5, languageCode: 'en' })).toBeNull()
    expect(validateProfileLocale({ locationCode: 2840, languageCode: 'english' })).toBeNull()
    expect(validateProfileLocale({ locationCode: 2840, languageCode: 'e' })).toBeNull()
    expect(validateProfileLocale({ locationCode: 2840, languageCode: 12 })).toBeNull()
  })
  it('documents the Google Ads regex boundary: representative codes pass normalizeLocale post-lowercase', () => {
    // Spec §8.1–8.2 verification record: sample of the 43 Google Ads codes.
    for (const code of ['en', 'fr', 'es', 'zh-tw', 'pt-br']) {
      expect(normalizeLocale({ locationCode: 2840, languageCode: code })).not.toBeNull()
    }
    for (const junk of ['eng-', 'e', 'english', '12']) {
      expect(normalizeLocale({ locationCode: 2840, languageCode: junk })).toBeNull()
    }
  })
})
