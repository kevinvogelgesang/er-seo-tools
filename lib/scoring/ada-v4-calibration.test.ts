// lib/scoring/ada-v4-calibration.test.ts — C19 golden archetypes.
// These bands ARE Kevin's 2026-07-09 calibration anchor ("school-grade").
// A weights/saturation change that moves an archetype out of band must be a
// deliberate, reviewed decision — never collateral damage.
import { describe, it, expect } from 'vitest'
import { computeAdaScoreV4, type AdaV4Inputs } from './ada-v4'

const site = (rules: AdaV4Inputs['rules'], meanIncomplete = 0): AdaV4Inputs =>
  ({ pagesAudited: 200, pagesTotal: 200, meanIncomplete, rules })
const r = (ruleId: string, impact: 'critical'|'serious'|'moderate'|'minor', pct: number, advisory = false) =>
  ({ ruleId, impact, advisory, pagesAffected: Math.round(200 * pct) })

describe('ADA v4 calibration bands (Kevin 2026-07-09 anchor)', () => {
  it('CLEAN: no violations, a stray incomplete → 95+', () => {
    const s = computeAdaScoreV4(site([], 0.5)).score
    expect(s).toBeGreaterThanOrEqual(95)
  })

  it('LIGHTLY FLAWED: serious on 40%, moderate on 20%, minor site-wide, light incomplete → 85–92', () => {
    // (Codex plan-fix #3: the original fixture scored ~95 — a "lightly flawed"
    // site needs a serious rule at meaningful prevalence to sit in-band.)
    // 30×(0.40/2) + 15×(0.20/3) + 5×(1.0/4) + 10×(1/4) = 6 + 1 + 1.25 + 2.5 = 10.75 → 89
    const s = computeAdaScoreV4(site([
      r('color-contrast', 'serious', 0.40), r('heading-order', 'moderate', 0.20), r('region', 'minor', 1.0),
    ], 1)).score
    expect(s).toBeGreaterThanOrEqual(85)
    expect(s).toBeLessThanOrEqual(92)
  })

  it('VISIBLY FLAWED (the "98 vibe" site): critical on 30%, serious on 60%, moderate on 50% → 70–80', () => {
    const s = computeAdaScoreV4(site([
      r('image-alt', 'critical', 0.30), r('color-contrast', 'serious', 0.60), r('heading-order', 'moderate', 0.50),
    ], 1)).score
    expect(s).toBeGreaterThanOrEqual(70)
    expect(s).toBeLessThanOrEqual(80)
  })

  it('BROKEN: two criticals site-wide, serious everywhere, widespread moderate/minor → ≤50', () => {
    const s = computeAdaScoreV4(site([
      r('image-alt', 'critical', 1.0), r('button-name', 'critical', 0.8),
      r('color-contrast', 'serious', 1.0), r('link-name', 'serious', 0.9),
      r('heading-order', 'moderate', 0.9), r('landmark-one-main', 'minor', 1.0),
    ], 3)).score
    expect(s).toBeLessThanOrEqual(50)
  })

  it('advisory-only site never drops below 85 (best-practice noise must not fail a site)', () => {
    const s = computeAdaScoreV4(site([
      r('region', 'serious', 1.0, true), r('landmark-unique', 'moderate', 1.0, true),
    ])).score
    expect(s).toBeGreaterThanOrEqual(85)
  })
})
