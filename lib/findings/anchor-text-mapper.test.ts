import { describe, it, expect } from 'vitest'
import { mapAnchorTextFindings, type AnchorAggregate } from './anchor-text-mapper'
import type { CrawlPageInput } from './types'

const deps = () => {
  const pages = new Map<string, CrawlPageInput>()
  return {
    runId: 'run1',
    ensurePage: (url: string) => {
      let p = pages.get(url)
      if (!p) { p = { id: `pg-${pages.size}`, runId: 'run1', url } as CrawlPageInput; pages.set(url, p) }
      return p
    },
  }
}
const base = (): AnchorAggregate => ({
  emptyCount: 0, emptySources: [], nonDescriptiveCount: 0, nonDescriptiveSources: [],
  singleVariationCount: 0, singleVariationTargets: [], harvestTruncated: false, targetsTruncated: false,
})

describe('mapAnchorTextFindings', () => {
  it('empty_anchor_text: run finding + page rows per source with per-source counts', () => {
    const agg = { ...base(), emptyCount: 3, emptySources: [{ url: 'https://e/p1', count: 2 }, { url: 'https://e/p2', count: 1 }] }
    const f = mapAnchorTextFindings(agg, deps())
    const run = f.find((x) => x.scope === 'run' && x.type === 'empty_anchor_text')!
    expect(run.count).toBe(3)
    expect(run.severity).toBe('warning')
    const pages = f.filter((x) => x.scope === 'page' && x.type === 'empty_anchor_text')
    expect(pages.map((p) => p.count)).toEqual([2, 1])
  })
  it('single_anchor_variation: fires only when > 10, run-scope ONLY (no page rows)', () => {
    const ten = { ...base(), singleVariationCount: 10, singleVariationTargets: Array.from({ length: 10 }, (_, i) => `https://e/${i}`) }
    expect(mapAnchorTextFindings(ten, deps()).some((x) => x.type === 'single_anchor_variation')).toBe(false)
    const eleven = { ...base(), singleVariationCount: 11, singleVariationTargets: ['https://e/x'] }
    const f = mapAnchorTextFindings(eleven, deps())
    const runs = f.filter((x) => x.type === 'single_anchor_variation')
    expect(runs).toHaveLength(1)
    expect(runs[0].scope).toBe('run')
    expect(JSON.parse(runs[0].detail!).sample).toEqual(['https://e/x'])
  })
  it('single_anchor_variation affectedComplete false when targetsTruncated', () => {
    const agg = { ...base(), singleVariationCount: 11, singleVariationTargets: ['x'], targetsTruncated: true }
    expect(mapAnchorTextFindings(agg, deps())[0].affectedComplete).toBe(false)
  })
  it('non_descriptive_anchor_text: notice severity, run + page rows, affectedSource + dedupKeys', () => {
    const agg = { ...base(), nonDescriptiveCount: 2, nonDescriptiveSources: [{ url: 'https://e/p1', count: 2 }] }
    const f = mapAnchorTextFindings(agg, deps())
    const run = f.find((x) => x.scope === 'run' && x.type === 'non_descriptive_anchor_text')!
    const page = f.find((x) => x.scope === 'page' && x.type === 'non_descriptive_anchor_text')!
    expect(run.severity).toBe('notice')
    expect(run.count).toBe(2)
    expect(run.affectedSource).toBe('live-scan-anchor')
    expect(page.affectedSource).toBe('live-scan-anchor')
    // dedupKeys differ run vs page and are keyed by source page
    expect(run.dedupKey).not.toBe(page.dedupKey)
    expect(typeof run.dedupKey).toBe('string')
    expect(typeof page.dedupKey).toBe('string')
  })
  it('empty/non-descriptive affectedComplete tracks harvestTruncated', () => {
    const agg = { ...base(), emptyCount: 1, emptySources: [{ url: 'https://e/p', count: 1 }], harvestTruncated: true }
    for (const x of mapAnchorTextFindings(agg, deps())) expect(x.affectedComplete).toBe(false)
  })
  it('emits nothing when all counts zero', () => {
    expect(mapAnchorTextFindings(base(), deps())).toEqual([])
  })
})
