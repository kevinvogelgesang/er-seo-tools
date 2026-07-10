import { describe, it, expect } from 'vitest'
import { hashWeights } from './weights-hash'

describe('hashWeights', () => {
  it('is stable across key order and 12 hex chars', () => {
    const a = hashWeights({ critical: 40, serious: 30 })
    const b = hashWeights({ serious: 30, critical: 40 })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{12}$/)
  })
  it('changes when any value changes', () => {
    expect(hashWeights({ critical: 40 })).not.toBe(hashWeights({ critical: 41 }))
  })
})
