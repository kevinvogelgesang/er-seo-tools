import { describe, it, expect } from 'vitest'
import { DEFAULT_WEIGHTS, WEIGHT_LABELS, LIVE_ELIGIBLE_KEYS, PERSISTABLE_WEIGHT_KEYS, validateWeights, serializeBreakdown, type ScoringWeights } from './weights'

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
  it('honors a submitted brokenLinks value (C19 PR3 — real column, no longer forced to default)', () => {
    const r = validateWeights({ ...DEFAULT_WEIGHTS, brokenLinks: 999 }) as typeof DEFAULT_WEIGHTS
    expect(r.brokenLinks).toBe(999)
  })
  it('PERSISTABLE_WEIGHT_KEYS includes brokenLinks (C19 PR3 — real column)', () => {
    expect(PERSISTABLE_WEIGHT_KEYS).toContain('brokenLinks')
  })
  it('validateWeights accepts a submitted brokenLinks value', () => {
    const v = validateWeights({ brokenLinks: 22 })
    expect('error' in v).toBe(false)
    expect((v as ScoringWeights).brokenLinks).toBe(22)
  })
  it('validateWeights rejects a negative brokenLinks', () => {
    expect(validateWeights({ brokenLinks: -1 })).toHaveProperty('error')
  })
  it('all-zero persistable weights still rejected (brokenLinks now counts toward the guard)', () => {
    const zeros = Object.fromEntries(PERSISTABLE_WEIGHT_KEYS.map((k) => [k, 0]))
    expect(validateWeights({ ...zeros, crawlDepth: 15 })).toHaveProperty('error')
  })
  it('brokenLinks alone > 0 satisfies the guard (it is user-settable now)', () => {
    const zeros = Object.fromEntries(PERSISTABLE_WEIGHT_KEYS.map((k) => [k, 0]))
    expect('error' in validateWeights({ ...zeros, brokenLinks: 5 })).toBe(false)
  })
})

describe('brokenLinks weight key', () => {
  it('defaults to 10', () => expect(DEFAULT_WEIGHTS.brokenLinks).toBe(10))
  it('has a label', () => expect(WEIGHT_LABELS.brokenLinks).toBe('Broken links'))
  it('is live-eligible', () => expect(LIVE_ELIGIBLE_KEYS).toContain('brokenLinks'))
  it('is persistable (real DB column since C19 PR3)', () => expect(PERSISTABLE_WEIGHT_KEYS).toContain('brokenLinks'))
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
