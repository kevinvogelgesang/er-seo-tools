import { describe, it, expect } from 'vitest'
import {
  computeAdaScoreV4, DEFAULT_ADA_V4_WEIGHTS, ADA_V4_SATURATION, ADA_SCORE_VERSION,
  type AdaV4Inputs, type AdaV4RuleInput,
} from './ada-v4'

const rule = (over: Partial<AdaV4RuleInput> = {}): AdaV4RuleInput => ({
  ruleId: 'color-contrast', impact: 'serious', advisory: false, pagesAffected: 1, ...over,
})
const inputs = (over: Partial<AdaV4Inputs> = {}): AdaV4Inputs => ({
  pagesAudited: 100, pagesTotal: 100, meanIncomplete: 0, rules: [], ...over,
})

describe('computeAdaScoreV4', () => {
  it('clean site scores 100 with five zero-point deduction lines', () => {
    const r = computeAdaScoreV4(inputs())
    expect(r.score).toBe(100)
    expect(r.breakdown.version).toBe(4)
    expect(r.breakdown.scorer).toBe('ada-v4')
    expect(r.breakdown.deductions).toHaveLength(5)
    expect(r.breakdown.deductions.every((d) => d.points === 0)).toBe(true)
  })

  it('spec anchor: critical 30% + serious 60% + moderate 50% ≈ 76', () => {
    const r = computeAdaScoreV4(inputs({ rules: [
      rule({ ruleId: 'image-alt', impact: 'critical', pagesAffected: 30 }),
      rule({ ruleId: 'color-contrast', impact: 'serious', pagesAffected: 60 }),
      rule({ ruleId: 'heading-order', impact: 'moderate', pagesAffected: 50 }),
    ] }))
    // 100 − (40×0.30 + 30×(0.60/2) + 15×(0.50/3)) = 100 − 23.5 = 76.5 → 77|76 band
    expect(r.score).toBeGreaterThanOrEqual(74)
    expect(r.score).toBeLessThanOrEqual(78)
  })

  it('one critical rule on every page = the full critical cap (saturation 1.0)', () => {
    const r = computeAdaScoreV4(inputs({ rules: [rule({ impact: 'critical', pagesAffected: 100 })] }))
    expect(r.score).toBe(60)
  })

  it('category deduction saturates: two site-wide critical rules deduct the same 40 as one', () => {
    const one = computeAdaScoreV4(inputs({ rules: [rule({ ruleId: 'a', impact: 'critical', pagesAffected: 100 })] }))
    const two = computeAdaScoreV4(inputs({ rules: [
      rule({ ruleId: 'a', impact: 'critical', pagesAffected: 100 }),
      rule({ ruleId: 'b', impact: 'critical', pagesAffected: 100 }),
    ] }))
    expect(two.score).toBe(one.score)
  })

  it('monotonicity: more prevalence never raises the score', () => {
    let prev = 101
    for (const affected of [0, 10, 25, 50, 75, 100]) {
      const r = computeAdaScoreV4(inputs({ rules: affected ? [rule({ pagesAffected: affected })] : [] }))
      expect(r.score).toBeLessThanOrEqual(prev)
      prev = r.score
    }
  })

  it('fragmented equals concentrated at equal prevalence totals (Codex #2)', () => {
    const concentrated = computeAdaScoreV4(inputs({ rules: [rule({ ruleId: 'a', pagesAffected: 60 })] }))
    const fragmented = computeAdaScoreV4(inputs({ rules: [
      rule({ ruleId: 'a', pagesAffected: 20 }), rule({ ruleId: 'b', pagesAffected: 20 }), rule({ ruleId: 'c', pagesAffected: 20 }),
    ] }))
    expect(fragmented.score).toBe(concentrated.score)
  })

  it('many distinct low-prevalence rules accumulate but the cap bounds them (Codex #2)', () => {
    const rules = Array.from({ length: 40 }, (_, i) => rule({ ruleId: `r${i}`, impact: 'serious', pagesAffected: 10 }))
    const r = computeAdaScoreV4(inputs({ rules }))
    // Σ prevalence = 4.0 over saturation 2.0 → clamped to 1 → exactly the serious cap
    expect(r.score).toBe(100 - DEFAULT_ADA_V4_WEIGHTS.serious)
  })

  it('advisory rules are discounted by advisoryDiscount', () => {
    const normal = computeAdaScoreV4(inputs({ rules: [rule({ pagesAffected: 100 })] }))
    const advisory = computeAdaScoreV4(inputs({ rules: [rule({ pagesAffected: 100, advisory: true })] }))
    // serious site-wide: 30×(1/2)=15 vs 30×(0.4/2)=6
    expect(100 - normal.score).toBe(15)
    expect(100 - advisory.score).toBe(6)
  })

  it('unknown impact buckets into minor', () => {
    const r = computeAdaScoreV4(inputs({ rules: [rule({ impact: 'unknown', pagesAffected: 100 })] }))
    const minorLine = r.breakdown.deductions.find((d) => d.category === 'minor')!
    expect(minorLine.points).toBeGreaterThan(0)
  })

  it('needsReview: mean incomplete of 4+ rules/page = full cap; 0 = none', () => {
    expect(computeAdaScoreV4(inputs({ meanIncomplete: 4 })).score).toBe(90)
    expect(computeAdaScoreV4(inputs({ meanIncomplete: 8 })).score).toBe(90) // clamped
    expect(computeAdaScoreV4(inputs({ meanIncomplete: 0 })).score).toBe(100)
  })

  it('zero-weight category contributes nothing (lever can disable)', () => {
    const w = { ...DEFAULT_ADA_V4_WEIGHTS, critical: 0 }
    const r = computeAdaScoreV4(inputs({ rules: [rule({ impact: 'critical', pagesAffected: 100 })] }), w)
    expect(r.score).toBe(100)
  })

  it('everything saturated floors at 0, not negative', () => {
    const rules: AdaV4RuleInput[] = [
      rule({ ruleId: 'c1', impact: 'critical', pagesAffected: 100 }),
      rule({ ruleId: 's1', pagesAffected: 100 }), rule({ ruleId: 's2', pagesAffected: 100 }),
      rule({ ruleId: 'm1', impact: 'moderate', pagesAffected: 100 }), rule({ ruleId: 'm2', impact: 'moderate', pagesAffected: 100 }), rule({ ruleId: 'm3', impact: 'moderate', pagesAffected: 100 }),
      rule({ ruleId: 'n1', impact: 'minor', pagesAffected: 100 }), rule({ ruleId: 'n2', impact: 'minor', pagesAffected: 100 }), rule({ ruleId: 'n3', impact: 'minor', pagesAffected: 100 }), rule({ ruleId: 'n4', impact: 'minor', pagesAffected: 100 }),
    ]
    const r = computeAdaScoreV4(inputs({ rules, meanIncomplete: 4 }))
    expect(r.score).toBe(0)
  })

  it('lowCoverage flag: scored < 50% of pagesTotal; standalone (pagesTotal null) never flags', () => {
    expect(computeAdaScoreV4(inputs({ pagesAudited: 40, pagesTotal: 100 })).breakdown.lowCoverage).toBe(true)
    expect(computeAdaScoreV4(inputs({ pagesAudited: 60, pagesTotal: 100 })).breakdown.lowCoverage).toBe(false)
    expect(computeAdaScoreV4(inputs({ pagesAudited: 1, pagesTotal: null })).breakdown.lowCoverage).toBe(false)
  })

  it('single-page audit: one critical rule = full 40-point deduction (intended page-grade semantic)', () => {
    const r = computeAdaScoreV4(inputs({ pagesAudited: 1, pagesTotal: null, rules: [rule({ impact: 'critical', pagesAffected: 1 })] }))
    expect(r.score).toBe(60)
  })

  it('throws on pagesAudited 0 (caller must keep the run null-scored instead)', () => {
    expect(() => computeAdaScoreV4(inputs({ pagesAudited: 0 }))).toThrow()
  })

  it('contribution lines: sorted by prevalence desc (ties by ruleId), top 8 + "other" rollup', () => {
    const rules = Array.from({ length: 12 }, (_, i) => rule({ ruleId: `r${i}`, pagesAffected: (i + 1) * 5 }))
    const r = computeAdaScoreV4(inputs({ rules }))
    const line = r.breakdown.deductions.find((d) => d.category === 'serious')!
    expect(line.contributions).toHaveLength(9)
    expect(line.contributions[0].ruleId).toBe('r11')
    expect(line.contributions[8].ruleId).toBe('other')
    expect(line.contributions[8].ruleCount).toBe(4)
  })

  it('"other" rollup preserves advisory discounts: weighted sum reconciles to the deduction (Codex plan-fix #2)', () => {
    // 10 rules, the 4 smallest (rolled up) include 2 advisories — the line's
    // Σ weightedPrevalence must equal the fill used for points.
    const rules = [
      ...Array.from({ length: 6 }, (_, i) => rule({ ruleId: `big${i}`, pagesAffected: 50 })),
      rule({ ruleId: 'sm0', pagesAffected: 10 }), rule({ ruleId: 'sm1', pagesAffected: 10 }),
      rule({ ruleId: 'adv0', pagesAffected: 10, advisory: true }), rule({ ruleId: 'adv1', pagesAffected: 10, advisory: true }),
    ]
    const r = computeAdaScoreV4(inputs({ rules }))
    const line = r.breakdown.deductions.find((d) => d.category === 'serious')!
    const weightedSum = line.contributions.reduce((s, c) => s + c.weightedPrevalence, 0)
    const expectedFill = Math.min(1, weightedSum / 2) // serious saturation 2
    expect(line.points).toBeCloseTo(Math.round(30 * expectedFill * 10) / 10, 1)
  })

  it('exports the version constant as 4', () => {
    expect(ADA_SCORE_VERSION).toBe(4)
    expect(ADA_V4_SATURATION.critical).toBe(1)
  })
})
