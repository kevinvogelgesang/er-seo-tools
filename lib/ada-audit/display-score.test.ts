// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { resolveDisplayScore } from './display-score'

describe('resolveDisplayScore', () => {
  it('prefers the persisted score + its version', () => {
    const r = resolveDisplayScore({ persistedScore: 88,
      scoreBreakdown: JSON.stringify({ version: 2, scorer: 'ada-v2' }), recompute: () => 50 })
    expect(r).toEqual({ score: 88, version: 2, fromFallback: false })
  })
  it('recomputes as v1 when no persisted score exists', () => {
    const r = resolveDisplayScore({ persistedScore: null, scoreBreakdown: null, recompute: () => 73 })
    expect(r).toEqual({ score: 73, version: 1, fromFallback: true })
  })
  it('labels a persisted score without breakdown as v1', () => {
    const r = resolveDisplayScore({ persistedScore: 60, scoreBreakdown: null, recompute: () => 50 })
    expect(r).toEqual({ score: 60, version: 1, fromFallback: false })
  })
})
