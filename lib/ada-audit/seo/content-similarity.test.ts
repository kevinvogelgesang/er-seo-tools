import { describe, it, expect } from 'vitest'
import { computeContentSimilarity, type SimilarityPageInput } from './content-similarity'

const p = (url: string, text: string, contentTruncated = false): SimilarityPageInput => ({ url, contentText: text, contentTruncated })
const toks = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ')
const NF = { boilerplateDfMin: 999 } // disables DF filtering (df can never reach 999) for similarity-focused tests

describe('computeContentSimilarity', () => {
  it('returns null with fewer than 2 eligible pages', () => {
    expect(computeContentSimilarity([p('/a', toks('w', 80))])).toBeNull()
  })

  it('flags exact duplicates and does not re-list them as a near group', () => {
    const same = toks('w', 80)
    const r = computeContentSimilarity([p('/a', same), p('/b', same), p('/c', toks('z', 80))], NF)!
    expect(r.exactDuplicateGroups).toHaveLength(1)
    expect(r.exactDuplicateGroups[0].urls).toEqual(['/a', '/b'])
    expect(r.nearDuplicateGroups.find(g => g.urls.join() === '/a,/b')).toBeUndefined()
  })

  it('flags near duplicates that are above threshold but not exact', () => {
    const base = toks('w', 120)
    const r = computeContentSimilarity([p('/a', base + ' xtail'), p('/b', base + ' ytail'), p('/c', toks('z', 120))], NF)!
    const g = r.nearDuplicateGroups.find(x => x.urls.includes('/a') && x.urls.includes('/b'))
    expect(g).toBeDefined()
    expect(g!.similarity).toBeGreaterThanOrEqual(0.9)
    expect(g!.similarity).toBeLessThan(1)
    expect(r.exactDuplicateGroups).toHaveLength(0) // near, not exact
  })

  it('reports MIN pairwise similarity and exactSubgroups for a mixed exact+near group', () => {
    const base = toks('w', 120)
    // A,B identical (exact, Jaccard 1); C near both (base with a changed tail)
    const r = computeContentSimilarity([p('/a', base), p('/b', base), p('/c', base + ' zt')], NF)!
    const g = r.nearDuplicateGroups.find(x => x.urls.length === 3)!
    expect(g.urls).toEqual(['/a', '/b', '/c'])
    expect(g.similarity).toBeGreaterThanOrEqual(0.9)
    expect(g.similarity).toBeLessThan(1) // min pairwise = A/C (or B/C), NOT the exact A/B
    expect(g.exactSubgroups).toEqual([['/a', '/b']])
    expect(r.exactDuplicateGroups[0].urls).toEqual(['/a', '/b'])
  })

  it('does NOT falsely group two pages sharing a moderate boilerplate block (2-page df floor)', () => {
    const boiler = toks('nav', 60)
    // default options: boiler df=2 < boilerplateDfMin(3) → NOT dropped; distinct bodies keep Jaccard low.
    const r = computeContentSimilarity([
      p('/a', boiler + ' ' + toks('a', 120)),
      p('/b', boiler + ' ' + toks('b', 120)),
    ])!
    expect(r.boilerplateShinglesDropped).toBe(0)
    expect(r.nearDuplicateGroups).toHaveLength(0)
  })

  it('drops shared boilerplate across many pages so distinct bodies are not falsely grouped', () => {
    const boiler = toks('nav', 60)
    const r = computeContentSimilarity([
      p('/a', boiler + ' ' + toks('a', 120)),
      p('/b', boiler + ' ' + toks('b', 120)),
      p('/c', boiler + ' ' + toks('c', 120)),
    ])! // default options: boiler df=3, 3/3=1.0>0.5 AND df>=3 → dropped
    expect(r.boilerplateShinglesDropped).toBeGreaterThan(0)
    expect(r.nearDuplicateGroups).toHaveLength(0)
  })

  it('excludes truncated pages from exact groups but counts them', () => {
    const same = toks('w', 80)
    const r = computeContentSimilarity([p('/a', same, true), p('/b', same, true), p('/c', toks('z', 80))], NF)!
    expect(r.truncatedPages).toBe(2)
    expect(r.exactDuplicateGroups).toHaveLength(0)
  })

  it('skips pages below the content-token floor (→ < 2 eligible → null)', () => {
    const r = computeContentSimilarity([p('/a', 'too short'), p('/b', 'also short here'), p('/c', toks('w', 80))])
    expect(r).toBeNull()
  })

  it('is deterministic (byte-identical JSON on repeat)', () => {
    const pages = [p('/a', toks('w', 80)), p('/b', toks('w', 80)), p('/c', toks('z', 80))]
    expect(JSON.stringify(computeContentSimilarity(pages, NF))).toBe(JSON.stringify(computeContentSimilarity(pages, NF)))
  })
})
