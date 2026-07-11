// lib/keywords/page-inventory.test.ts
import { describe, it, expect } from 'vitest'
import { parseFaqEvidence, buildPageInventory, type InventoryPageInput } from './page-inventory'

const page = (over: Partial<InventoryPageInput> = {}): InventoryPageInput => ({
  url: 'https://x.test/p', title: 'T', h1: 'H', wordCount: 500, crawlDepth: 3,
  indexable: true, faqEvidence: null, ...over,
})

describe('parseFaqEvidence (strict grammar, Codex #1)', () => {
  it('decodes the exact forms', () => {
    expect(parseFaqEvidence('not-detected')).toEqual({ state: 'not-detected', signals: [] })
    expect(parseFaqEvidence('present:schema')).toEqual({ state: 'present', signals: ['schema'] })
    expect(parseFaqEvidence('present:schema,heading,container,questions'))
      .toEqual({ state: 'present', signals: ['schema', 'heading', 'container', 'questions'] })
    expect(parseFaqEvidence(null)).toEqual({ state: 'unknown', signals: [] })
  })
  it('rejects everything else to unknown — never guess a negative', () => {
    for (const bad of ['present', 'present:', 'present:bogus', 'present:schema,schema',
      'present:heading,schema', 'PRESENT:schema', 'yes', '', 'not-detected ']) {
      expect(parseFaqEvidence(bad).state).toBe('unknown')
    }
  })
})

describe('buildPageInventory', () => {
  it('filters to indexable === true and sorts by url', () => {
    const out = buildPageInventory([
      page({ url: 'https://x.test/b' }),
      page({ url: 'https://x.test/a' }),
      page({ url: 'https://x.test/c', indexable: false }),
      page({ url: 'https://x.test/d', indexable: null }),
    ])
    expect(out.map((e) => e.url)).toEqual(['https://x.test/a', 'https://x.test/b'])
  })

  it('classifies pageType at read time (slug rules)', () => {
    const out = buildPageInventory([page({ url: 'https://x.test/programs/dental-assisting' })])
    expect(out[0].pageType).toBe('program')
  })

  it('programEntityUrls upgrades ONLY weak classifications (Codex #4)', () => {
    const out = buildPageInventory(
      [
        page({ url: 'https://x.test/dental-assisting', crawlDepth: 5 }),        // unknown -> upgraded
        page({ url: 'https://x.test/blog/course-news', crawlDepth: 5 }),        // explicit blog -> kept
        page({ url: 'https://x.test/shallow-page', crawlDepth: 1 }),            // low-conf nav -> upgraded
      ],
      { programEntityUrls: [
        'https://x.test/dental-assisting',
        'https://x.test/blog/course-news',
        'https://x.test/shallow-page',
      ] },
    )
    const byUrl = Object.fromEntries(out.map((e) => [e.url, e]))
    expect(byUrl['https://x.test/dental-assisting'].pageType).toBe('program')
    expect(byUrl['https://x.test/dental-assisting'].pageTypeConfidence).toBe(0.7)
    expect(byUrl['https://x.test/blog/course-news'].pageType).toBe('blog')
    expect(byUrl['https://x.test/shallow-page'].pageType).toBe('program')
  })

  it('normalizes entity-URL matching and discards malformed entries (Codex #5)', () => {
    const out = buildPageInventory(
      [page({ url: 'https://x.test/hvac', crawlDepth: 9 })],
      { programEntityUrls: ['https://X.TEST/hvac#section', 'not a url'] },
    )
    expect(out[0].pageType).toBe('program')
  })

  it('decodes faqEvidence tri-state incl. corrupt values', () => {
    const out = buildPageInventory([
      page({ url: 'https://x.test/a', faqEvidence: 'present:heading' }),
      page({ url: 'https://x.test/b', faqEvidence: 'not-detected' }),
      page({ url: 'https://x.test/c', faqEvidence: 'garbage' }),
      page({ url: 'https://x.test/d', faqEvidence: null }),
    ])
    expect(out.map((e) => e.faqEvidence)).toEqual(['present', 'not-detected', 'unknown', 'unknown'])
    expect(out[0].faqSignals).toEqual(['heading'])
  })
})
