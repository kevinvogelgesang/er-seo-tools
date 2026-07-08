import { describe, it, expect } from 'vitest'
import { scanIntentOf, SCAN_INTENT_LABEL } from './scan-intent'

describe('scanIntentOf', () => {
  it('maps seoOnly:true → seo', () => expect(scanIntentOf({ seoOnly: true })).toBe('seo'))
  it('maps seoOnly:false → ada', () => expect(scanIntentOf({ seoOnly: false })).toBe('ada'))
  it('maps missing/null → ada', () => {
    expect(scanIntentOf({})).toBe('ada')
    expect(scanIntentOf({ seoOnly: null })).toBe('ada')
  })
  it('labels', () => {
    expect(SCAN_INTENT_LABEL.seo).toBe('SEO')
    expect(SCAN_INTENT_LABEL.ada).toBe('Accessibility')
  })
})
