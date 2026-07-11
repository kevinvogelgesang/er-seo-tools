import { describe, it, expect } from 'vitest'
import { deriveFaqEvidence } from './faq-evidence'

const details = (schemaTypes: unknown[], faqSignals: unknown) =>
  JSON.stringify({ schemaTypes, hreflang: [], programNames: [], faqSignals })
const signals = (over: Partial<{ heading: boolean; container: boolean; questionHeadings: number }> = {}) =>
  ({ heading: false, container: false, questionHeadings: 0, ...over })

describe('deriveFaqEvidence', () => {
  it('null / malformed / non-object input -> null (unknown)', () => {
    expect(deriveFaqEvidence(null)).toBeNull()
    expect(deriveFaqEvidence('{broken')).toBeNull()
    expect(deriveFaqEvidence('"just a string"')).toBeNull()
  })

  it('legacy detailsJson without faqSignals -> null, NEVER not-detected', () => {
    expect(deriveFaqEvidence(JSON.stringify({ schemaTypes: ['FAQPage'], hreflang: [] }))).toBeNull()
  })

  it('no signals -> not-detected', () => {
    expect(deriveFaqEvidence(details([], signals()))).toBe('not-detected')
  })

  it('each signal alone, canonical grammar', () => {
    expect(deriveFaqEvidence(details(['FAQPage'], signals()))).toBe('present:schema')
    expect(deriveFaqEvidence(details([], signals({ heading: true })))).toBe('present:heading')
    expect(deriveFaqEvidence(details([], signals({ container: true })))).toBe('present:container')
    expect(deriveFaqEvidence(details([], signals({ questionHeadings: 3 })))).toBe('present:questions')
  })

  it('questionHeadings threshold: 2 is not a signal, 3 is', () => {
    expect(deriveFaqEvidence(details([], signals({ questionHeadings: 2 })))).toBe('not-detected')
    expect(deriveFaqEvidence(details([], signals({ questionHeadings: 3 })))).toBe('present:questions')
  })

  it('schema URI forms count (Codex #2)', () => {
    expect(deriveFaqEvidence(details(['https://schema.org/FAQPage'], signals()))).toBe('present:schema')
    expect(deriveFaqEvidence(details(['http://schema.org/FAQPage'], signals()))).toBe('present:schema')
    expect(deriveFaqEvidence(details(['FaqPage'], signals()))).toBe('not-detected') // case-exact, no fuzzy match
  })

  it('multiple signals emit in canonical order regardless of input', () => {
    expect(deriveFaqEvidence(details(['FAQPage'], signals({ questionHeadings: 5, heading: true }))))
      .toBe('present:schema,heading,questions')
  })

  it('malformed signal values -> null (unknown), NEVER not-detected (plan-Codex #1)', () => {
    // a corrupt shape cannot certify a negative
    expect(deriveFaqEvidence(details([], { heading: 'yes', container: false, questionHeadings: 'many' }))).toBeNull()
    expect(deriveFaqEvidence(details([], { heading: false, container: false, questionHeadings: -1 }))).toBeNull()
    expect(deriveFaqEvidence(JSON.stringify({ faqSignals: 42 }))).toBeNull()
    // missing/malformed schemaTypes with all-false DOM signals -> null too
    // (a lost FAQPage value must not fabricate a negative)
    expect(deriveFaqEvidence(JSON.stringify({ schemaTypes: 'oops', faqSignals: { heading: false, container: false, questionHeadings: 0 } }))).toBeNull()
  })

  it('a VALID positive signal still fires despite malformed neighbors (plan-Codex #1)', () => {
    expect(deriveFaqEvidence(JSON.stringify({ schemaTypes: 'oops', faqSignals: { heading: true, container: false, questionHeadings: 0 } }))).toBe('present:heading')
  })
})
