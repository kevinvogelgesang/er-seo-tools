// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeScoreV2, computeSiteScoreV2, ADA_SCORE_VERSION } from './scoring-v2'
import type { AxeViolation } from './types'

function viol(opts: Partial<AxeViolation> & { id: string; nodeCount: number }): AxeViolation {
  const { nodeCount, ...rest } = opts
  return {
    impact: 'serious', help: '', description: '', helpUrl: '', tags: ['wcag2aa'],
    nodes: Array.from({ length: Math.min(nodeCount, 20) }, () => ({ html: '<a>' })),
    nodeCount,
    ...rest, id: opts.id,
  }
}
const base = { incompleteCount: 0, wcagLevel: 'wcag21aa' as const }

describe('computeScoreV2', () => {
  it('scores a clean page 100', () => {
    expect(computeScoreV2({ ...base, violations: [], domElementCount: 500 }).score).toBe(100)
  })
  it('is monotonic — adding a violation never raises the score', () => {
    const one = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 5 })], domElementCount: 1000 }).score
    const two = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 5 }), viol({ id: 'b', nodeCount: 5 })], domElementCount: 1000 }).score
    expect(two).toBeLessThanOrEqual(one)
  })
  it('is size-invariant for equal proportional breakage', () => {
    // Both fixtures kept under NODE_CAP (200) so capping doesn't make them
    // diverge: 5/100 = 200/4000 = 0.05 density each.
    const small = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 5 })], domElementCount: 100 }).score
    const large = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 200 })], domElementCount: 4000 }).score
    expect(Math.abs(small - large)).toBeLessThanOrEqual(1)
  })
  it('reads raw nodeCount, not truncated nodes.length (20 vs 200 differ)', () => {
    const twenty = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 20 })], domElementCount: 3000 }).score
    const twoHundred = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 200 })], domElementCount: 3000 }).score
    expect(twoHundred).toBeLessThan(twenty)
  })
  it('falls back to nodes.length when nodeCount is absent (pre-v2 blob)', () => {
    const v: AxeViolation = { id: 'a', impact: 'serious', help: '', description: '', helpUrl: '', tags: ['wcag2aa'], nodes: [{ html: '<a>' }, { html: '<b>' }] }
    expect(() => computeScoreV2({ ...base, violations: [v], domElementCount: 500 })).not.toThrow()
  })
  it('discounts best-practice-only violations (~0.4x)', () => {
    const conformance = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 30, tags: ['wcag2aa'] })], domElementCount: 1000 }).score
    const advisory = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 30, tags: ['best-practice'] })], domElementCount: 1000 }).score
    expect(advisory).toBeGreaterThan(conformance)
  })
  it('does not discount a rule tagged both best-practice AND wcag', () => {
    const both = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 30, tags: ['best-practice', 'wcag2aa'] })], domElementCount: 1000 }).score
    const conformance = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 30, tags: ['wcag2aa'] })], domElementCount: 1000 }).score
    expect(both).toBe(conformance)
  })
  it('applies a visible incomplete penalty even on a large DOM', () => {
    const clean = computeScoreV2({ ...base, violations: [], domElementCount: 8000 }).score
    const withIncomplete = computeScoreV2({ violations: [], incompleteCount: 6, wcagLevel: 'wcag21aa', domElementCount: 8000 }).score
    expect(withIncomplete).toBeLessThan(clean)
  })
  it('treats null impact as minor (does not throw, penalizes lightly)', () => {
    const nullImpact = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 10, impact: null })], domElementCount: 1000 }).score
    expect(nullImpact).toBeGreaterThan(0)
    expect(nullImpact).toBeLessThan(100)
  })
  it('uses DOM_FLOOR when domElementCount is missing', () => {
    const r = computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 5 })], domElementCount: null })
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(100)
  })
  it('emits a version-2 breakdown', () => {
    const r = computeScoreV2({ ...base, violations: [], domElementCount: 500 })
    expect(r.breakdown.version).toBe(ADA_SCORE_VERSION)
    expect(r.breakdown.scorer).toBe('ada-v2')
  })
  it('compliance: clean page is compliant; a wcag violation breaks it', () => {
    expect(computeScoreV2({ ...base, violations: [], domElementCount: 500 }).compliant).toBe(true)
    expect(computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 1, tags: ['wcag2a'] })], domElementCount: 500 }).compliant).toBe(false)
  })
  it('compliance: a best-practice-only violation does NOT break compliance', () => {
    expect(computeScoreV2({ ...base, violations: [viol({ id: 'a', nodeCount: 5, tags: ['best-practice'] })], domElementCount: 500 }).compliant).toBe(true)
  })
})

describe('computeSiteScoreV2', () => {
  it('is the rounded unweighted mean of page scores', () => {
    expect(computeSiteScoreV2([100, 80, 60])).toBe(80)
  })
  it('returns null for no scored pages', () => {
    expect(computeSiteScoreV2([])).toBeNull()
  })
})

describe('calibration bands', () => {
  const dom = 1500
  it('a few serious issues → mid band (55-80)', () => {
    const s = computeScoreV2({ incompleteCount: 2, wcagLevel: 'wcag21aa', domElementCount: dom,
      violations: [viol({ id: 'a', nodeCount: 8, impact: 'serious' }), viol({ id: 'b', nodeCount: 4, impact: 'moderate' })] }).score
    expect(s).toBeGreaterThanOrEqual(55); expect(s).toBeLessThanOrEqual(80)
  })
  it('a badly broken page → low but not pinned to 0 (5-40)', () => {
    const s = computeScoreV2({ incompleteCount: 10, wcagLevel: 'wcag21aa', domElementCount: dom,
      violations: [viol({ id: 'a', nodeCount: 120, impact: 'critical' }), viol({ id: 'b', nodeCount: 90, impact: 'serious' })] }).score
    expect(s).toBeGreaterThanOrEqual(5); expect(s).toBeLessThanOrEqual(40)
  })
})
