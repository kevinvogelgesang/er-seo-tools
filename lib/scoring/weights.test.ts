import { describe, it, expect } from 'vitest'
import { DEFAULT_WEIGHTS, LIVE_ELIGIBLE_KEYS, validateWeights, serializeBreakdown } from './weights'

describe('validateWeights', () => {
  it('accepts a full valid set', () => expect(validateWeights({ ...DEFAULT_WEIGHTS })).toMatchObject(DEFAULT_WEIGHTS))
  it('fills missing keys from defaults', () => {
    const r = validateWeights({ indexability: 30 }) as typeof DEFAULT_WEIGHTS
    expect(r.indexability).toBe(30); expect(r.errorRate).toBe(DEFAULT_WEIGHTS.errorRate)
  })
  it('rejects negative', () => expect(validateWeights({ ...DEFAULT_WEIGHTS, indexability: -1 })).toHaveProperty('error'))
  it('rejects non-number', () => expect(validateWeights({ ...DEFAULT_WEIGHTS, schema: 'x' })).toHaveProperty('error'))
  it('rejects when only crawlDepth is positive', () => {
    const only = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0])); only.crawlDepth = 15
    expect(validateWeights(only)).toHaveProperty('error')
  })
  it('accepts a positive live-eligible factor with crawlDepth 0', () => {
    const w = { ...Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0])), indexability: 5 }
    expect(validateWeights(w)).toMatchObject({ indexability: 5, crawlDepth: 0 })
  })
})
describe('serializeBreakdown', () => {
  it('wraps with version/scorer/score', () => {
    const j = serializeBreakdown('health', { score: 72, factors: [{ key:'indexability', label:'Indexability', weight:20, earned:18, possible:20 }] })
    expect(JSON.parse(j)).toEqual({ version:1, scorer:'health', score:72, factors:[{ key:'indexability', label:'Indexability', weight:20, earned:18, possible:20 }] })
  })
})
describe('LIVE_ELIGIBLE_KEYS', () => {
  it('excludes crawlDepth', () => { expect(LIVE_ELIGIBLE_KEYS).not.toContain('crawlDepth'); expect(LIVE_ELIGIBLE_KEYS).toContain('indexability') })
})
