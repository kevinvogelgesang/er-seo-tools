// lib/ada-audit/seo/content-signals.test.ts
import { describe, it, expect } from 'vitest'
import { computeContentSignals } from './content-signals'

const YEAR = 2026
const page = (url: string, text: string) => ({ url, contentText: text, contentTruncated: false })

describe('computeContentSignals — stale dates', () => {
  it('flags an old copyright year', () => {
    const r = computeContentSignals([page('/a', '© 2021 Example College. All rights reserved.')], { currentYear: YEAR })
    expect(r!.staleDates.pagesWithHits).toBe(1)
    expect(r!.staleDates.pages[0].hits[0].kind).toBe('copyright')
    expect(r!.staleDates.pages[0].hits[0].year).toBe(2021)
  })
  it('does NOT flag a current copyright RANGE (en-dash, hyphen, or "to")', () => {
    for (const t of ['© 2018–2026 Example', '© 2018-2026 Example', 'Copyright 2018 to 2026 Example']) {
      const r = computeContentSignals([page('/a', t)], { currentYear: YEAR })
      expect(r!.staleDates.pagesWithHits).toBe(0)
    }
  })
  it('flags a plain current-minus-3 copyright and NOT a current one', () => {
    expect(computeContentSignals([page('/a', '© 2023 Example')], { currentYear: YEAR })!.staleDates.pagesWithHits).toBe(1)
    expect(computeContentSignals([page('/a', '© 2026 Example')], { currentYear: YEAR })!.staleDates.pagesWithHits).toBe(0)
    expect(computeContentSignals([page('/a', '© 2025 Example')], { currentYear: YEAR })!.staleDates.pagesWithHits).toBe(0) // 1-year lag allowed
  })
  it('flags a stale term reference', () => {
    const r = computeContentSignals([page('/a', 'Fall 2023 enrollment is now open.')], { currentYear: YEAR })
    expect(r!.staleDates.pages[0].hits.some(h => h.kind === 'term' && h.year === 2023)).toBe(true)
  })
  it('flags a stale application deadline', () => {
    const r = computeContentSignals([page('/a', 'Apply by the March 2024 deadline.')], { currentYear: YEAR })
    expect(r!.staleDates.pages[0].hits.some(h => h.kind === 'deadline' && h.year === 2024)).toBe(true)
  })
  it('does NOT flag a bare historical year ("founded in 1998")', () => {
    const r = computeContentSignals([page('/a', 'The college was founded in 1998 and since 1998 has grown.')], { currentYear: YEAR })
    expect(r!.staleDates.pagesWithHits).toBe(0)
  })
  it('does NOT flag a future date or a non-year "start"', () => {
    const r = computeContentSignals([page('/a', 'Class of 2027 applications open. Start your journey today.')], { currentYear: YEAR })
    expect(r!.staleDates.pagesWithHits).toBe(0)
  })
  it('caps hits at 5 per page', () => {
    const text = Array.from({ length: 9 }, (_, i) => `© ${2010 + i} note.`).join(' ')
    const r = computeContentSignals([page('/a', text)], { currentYear: YEAR })
    expect(r!.staleDates.pages[0].hits.length).toBeLessThanOrEqual(5)
  })
  it('preserves document order across rule kinds when capping (early term survives 6 copyrights)', () => {
    // One line: an early `term` reference, then 6 old copyright mentions.
    // The 5-hit cap must keep the FIRST 5 hits in textual position — so the
    // leading term hit survives and copyrights fill the rest.
    const text = 'Fall 2023 semester ' + Array.from({ length: 6 }, (_, i) => `© ${2010 + i} note`).join(' ')
    const r = computeContentSignals([page('/a', text)], { currentYear: YEAR })
    const hits = r!.staleDates.pages[0].hits
    expect(hits.length).toBe(5)
    expect(hits[0].kind).toBe('term')
    expect(hits[0].year).toBe(2023)
    expect(hits.slice(1).every(h => h.kind === 'copyright')).toBe(true)
    // years appear in document order (2010, 2011, 2012, 2013 after the term)
    expect(hits.slice(1).map(h => h.year)).toEqual([2010, 2011, 2012, 2013])
  })
})

describe('computeContentSignals — readability', () => {
  it('scores only pages at or above the word floor', () => {
    const short = page('/s', 'Too short to score.')
    const long = page('/l', Array.from({ length: 120 }, () => 'the reading passage is simple and clear').join(' '))
    const r = computeContentSignals([short, long], { currentYear: YEAR })
    expect(r!.readability.scoredPages).toBe(1)
    expect(r!.readability.medianFleschReadingEase).not.toBeNull()
  })
  it('handles text with no sentence terminators (single-sentence fallback, no NaN)', () => {
    const noPunct = page('/n', Array.from({ length: 110 }, () => 'word').join(' '))
    const r = computeContentSignals([noPunct], { currentYear: YEAR })
    expect(Number.isNaN(r!.readability.pages[0].fleschReadingEase)).toBe(false)
  })
  it('computes exact FRE/FK for a pinned passage', () => {
    // 110 words of "cat" (1 syllable each), no terminators → sentences=1.
    // W=110, S=1, Syl=110. FRE = 206.835 - 1.015*110 - 84.6*1 = 206.835 - 111.65 - 84.6 = 10.585 → 10.6
    // FK = 0.39*110 + 11.8*1 - 15.59 = 42.9 + 11.8 - 15.59 = 39.11 → 39.1
    const r = computeContentSignals([page('/p', Array.from({ length: 110 }, () => 'cat').join(' '))], { currentYear: YEAR })
    expect(r!.readability.pages[0].fleschReadingEase).toBe(10.6)
    expect(r!.readability.pages[0].gradeLevel).toBe(39.1)
  })
  it('averages the two middle values for an even scored-page count', () => {
    // Two scoreable pages with distinct FRE → median = rounded average.
    const a = page('/a', Array.from({ length: 110 }, () => 'cat').join(' '))          // 1 syllable → FRE 10.6
    const b = page('/b', Array.from({ length: 110 }, () => 'water').join(' '))        // 2 syllables → distinct FRE
    const r = computeContentSignals([a, b], { currentYear: YEAR })
    const [x, y] = r!.readability.pages.map(p => p.fleschReadingEase)
    expect(r!.readability.medianFleschReadingEase).toBe(Math.round(((x + y) / 2) * 10) / 10)
  })
  it('caps the per-page readability list at 50 and breaks FRE ties by url', () => {
    const pages = Array.from({ length: 60 }, (_, i) =>
      page(`/p${String(i).padStart(2, '0')}`, Array.from({ length: 110 }, () => 'cat').join(' ')))
    const r = computeContentSignals(pages, { currentYear: YEAR })
    expect(r!.readability.scoredPages).toBe(60)
    expect(r!.readability.pages.length).toBe(50)
    // identical FRE across all → url-ascending order
    expect(r!.readability.pages[0].url < r!.readability.pages[1].url).toBe(true)
  })
})

describe('computeContentSignals — shape + edges', () => {
  it('returns null when no page has contentText', () => {
    expect(computeContentSignals([{ url: '/a', contentText: null, contentTruncated: false }], { currentYear: YEAR })).toBeNull()
  })
  it('counts truncated pages', () => {
    const r = computeContentSignals([{ url: '/a', contentText: 'x', contentTruncated: true }], { currentYear: YEAR })
    expect(r!.truncatedPages).toBe(1)
  })
  it('is deterministic given a fixed currentYear', () => {
    const input = [page('/a', '© 2020 Example.')]
    expect(computeContentSignals(input, { currentYear: YEAR })).toEqual(computeContentSignals(input, { currentYear: YEAR }))
  })
})
