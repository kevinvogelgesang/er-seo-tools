import { describe, expect, it } from 'vitest'
import { seoOnlyRedirectTarget } from './seo-only-redirect'

describe('seoOnlyRedirectTarget', () => {
  it('C11: seoOnly audit redirects to /seo-parser', () => {
    expect(seoOnlyRedirectTarget({ seoOnly: true })).toBe('/seo-parser')
    expect(seoOnlyRedirectTarget({ seoOnly: false })).toBeNull()
  })
})
