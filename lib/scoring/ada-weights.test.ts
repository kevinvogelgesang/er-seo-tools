import { describe, it, expect } from 'vitest'
import { DEFAULT_ADA_V4_WEIGHTS } from './ada-v4'
import { validateAdaWeights, ADA_CAP_KEYS } from './ada-weights'

describe('validateAdaWeights', () => {
  it('accepts the defaults (sum of caps is exactly 100)', () => {
    expect(validateAdaWeights({ ...DEFAULT_ADA_V4_WEIGHTS })).toEqual(DEFAULT_ADA_V4_WEIGHTS)
  })
  it('merges partial input over the defaults', () => {
    const v = validateAdaWeights({ critical: 50, serious: 20 })
    expect(v).toEqual({ ...DEFAULT_ADA_V4_WEIGHTS, critical: 50, serious: 20 })
  })
  it('rejects a cap above 100', () => {
    expect(validateAdaWeights({ critical: 101, serious: 0, moderate: 0, minor: 0, needsReview: 0 })).toHaveProperty('error')
  })
  it('rejects a negative cap', () => {
    expect(validateAdaWeights({ minor: -1 })).toHaveProperty('error')
  })
  it('rejects sum(caps) > 100', () => {
    expect(validateAdaWeights({ critical: 60, serious: 41 })).toHaveProperty('error') // 60+41+15+5+10 = 131
  })
  it('rejects all caps zero', () => {
    const zeros = Object.fromEntries(ADA_CAP_KEYS.map((k) => [k, 0]))
    expect(validateAdaWeights(zeros)).toHaveProperty('error')
  })
  it('rejects advisoryDiscount outside 0..1', () => {
    expect(validateAdaWeights({ advisoryDiscount: 1.5 })).toHaveProperty('error')
    expect(validateAdaWeights({ advisoryDiscount: -0.1 })).toHaveProperty('error')
  })
  it('accepts advisoryDiscount boundary values 0 and 1', () => {
    expect('error' in validateAdaWeights({ advisoryDiscount: 0 })).toBe(false)
    expect('error' in validateAdaWeights({ advisoryDiscount: 1 })).toBe(false)
  })
  it('rejects non-numeric values', () => {
    expect(validateAdaWeights({ critical: 'lots' })).toHaveProperty('error')
    expect(validateAdaWeights({ critical: NaN })).toHaveProperty('error')
  })
})
