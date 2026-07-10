import { describe, it, expect } from 'vitest'
import { scoreLiveSeo, type LiveScoreInputs } from './live-seo-score'
import { DEFAULT_WEIGHTS } from '@/lib/scoring/weights'
import { brokenLinksPoints, SEO_KNEES, type LinkVerificationSnapshot } from '@/lib/scoring/seo-core'

// A perfect indexable site: every factor maxed.
const perfect = (o: Partial<LiveScoreInputs> = {}): LiveScoreInputs => ({
  attempted: 100, observed: 100, indexableScored: 100, pagesError: 0,
  missingTitle: 0, missingMeta: 0, missingH1: 0, thin: 0, pagesWithSchema: 30, ...o,
})

const linkVerif = (o: Partial<LinkVerificationSnapshot> = {}): LinkVerificationSnapshot => ({
  internalChecked: 150, internalBroken: 0, imagesChecked: 50, imagesBroken: 0, passComplete: true, ...o,
})

describe('scoreLiveSeo', () => {
  it('returns null when nothing was attempted', () => {
    expect(scoreLiveSeo(perfect({ attempted: 0 }), DEFAULT_WEIGHTS)).toMatchObject({ score: null, factors: [] })
  })
  it('returns null below 50% extraction coverage (observed/attempted)', () => {
    expect(scoreLiveSeo(perfect({ attempted: 100, observed: 40, indexableScored: 40 }), DEFAULT_WEIGHTS))
      .toMatchObject({ score: null, factors: [] })
  })
  it('returns null when no indexable pages (noindex / login-wall site)', () => {
    expect(scoreLiveSeo(perfect({ indexableScored: 0 }), DEFAULT_WEIGHTS)).toMatchObject({ score: null, factors: [] })
  })
  it('scores a perfect indexable site at 100 (no phantom crawl-depth/broken factors)', () => {
    expect(scoreLiveSeo(perfect(), DEFAULT_WEIGHTS).score).toBe(100)
  })
  it('scores a perfect indexable site at 100 under doubled weights too (crawlDepth ignored)', () => {
    const doubled = { ...DEFAULT_WEIGHTS }
    for (const k of Object.keys(doubled) as (keyof typeof doubled)[]) doubled[k] = doubled[k] * 2
    expect(scoreLiveSeo(perfect(), doubled).score).toBe(100)
  })
  it('penalizes missing titles', () => {
    expect(scoreLiveSeo(perfect({ missingTitle: 50 }), DEFAULT_WEIGHTS).score).toBeLessThan(100)
  })
  it('penalizes a high error rate', () => {
    expect(scoreLiveSeo(perfect({ pagesError: 50 }), DEFAULT_WEIGHTS).score).toBeLessThan(100)
  })
  it('penalizes thin content', () => {
    expect(scoreLiveSeo(perfect({ thin: 50 }), DEFAULT_WEIGHTS).score).toBeLessThan(100)
  })
  it('a partially-noindex site scores (not null) and below a fully-indexable one', () => {
    const partial = scoreLiveSeo(perfect({ indexableScored: 50 }), DEFAULT_WEIGHTS).score
    expect(partial).not.toBeNull()
    expect(partial!).toBeLessThan(100) // indexability factor (50/100) drags it down
  })
  it('indexability uses observed (not attempted) as denominator', () => {
    // observed 50 of 100 attempted (50% — passes the guard); all 50 indexable → indexability full
    const s = scoreLiveSeo(perfect({ attempted: 100, observed: 50, indexableScored: 50, pagesWithSchema: 15 }), DEFAULT_WEIGHTS)
    expect(s.score).toBe(100)
  })
  it('live score excludes crawl depth (v1 guard)', () => {
    const base = { attempted:10, observed:10, indexableScored:10, pagesError:0,
      missingTitle:0, missingMeta:0, missingH1:0, thin:0, pagesWithSchema:10 }
    expect(scoreLiveSeo(base, DEFAULT_WEIGHTS).score).toBe(scoreLiveSeo({ ...base }, DEFAULT_WEIGHTS).score)
    // @ts-expect-error — depth is intentionally NOT part of LiveScoreInputs
    expect(scoreLiveSeo({ ...base, crawlDepth: 3 }, DEFAULT_WEIGHTS).score).toBe(scoreLiveSeo(base, DEFAULT_WEIGHTS).score)
    // crawlDepth weight has no effect on live scoring even if set
    expect(scoreLiveSeo(base, { ...DEFAULT_WEIGHTS, crawlDepth: 999 }).score).toBe(scoreLiveSeo(base, DEFAULT_WEIGHTS).score)
  })
})

// ─── C19 PR2 Task 4: broken-links factor ───────────────────────────────────
describe('scoreLiveSeo — brokenLinks factor', () => {
  it('factor present (clean, 0 of 200 checked) → included with earned == weight, score stays 100', () => {
    const r = scoreLiveSeo(perfect({ linkVerification: linkVerif({ internalChecked: 150, imagesChecked: 50 }) }), DEFAULT_WEIGHTS)
    expect(r.score).toBe(100)
    const f = r.factors.find((x) => x.key === 'brokenLinks')
    expect(f).toBeDefined()
    expect(f!.earned).toBe(DEFAULT_WEIGHTS.brokenLinks)
  })

  it('5%+ broken → earned 0, score drops below the no-factor baseline (100)', () => {
    const r = scoreLiveSeo(perfect({
      linkVerification: linkVerif({ internalChecked: 100, internalBroken: 5, imagesChecked: 0, imagesBroken: 0 }),
    }), DEFAULT_WEIGHTS)
    const f = r.factors.find((x) => x.key === 'brokenLinks')
    expect(f).toBeDefined()
    expect(f!.earned).toBe(0)
    expect(r.score!).toBeLessThan(100)
  })

  it('passComplete false → factor absent', () => {
    const r = scoreLiveSeo(perfect({ linkVerification: linkVerif({ passComplete: false }) }), DEFAULT_WEIGHTS)
    expect(r.factors.find((x) => x.key === 'brokenLinks')).toBeUndefined()
  })

  it('zero checked → factor absent even when passComplete', () => {
    const r = scoreLiveSeo(perfect({ linkVerification: linkVerif({ internalChecked: 0, imagesChecked: 0 }) }), DEFAULT_WEIGHTS)
    expect(r.factors.find((x) => x.key === 'brokenLinks')).toBeUndefined()
  })

  it('weights.brokenLinks 0 → factor absent', () => {
    const r = scoreLiveSeo(perfect({ linkVerification: linkVerif() }), { ...DEFAULT_WEIGHTS, brokenLinks: 0 })
    expect(r.factors.find((x) => x.key === 'brokenLinks')).toBeUndefined()
  })

  it('no linkVerification → factor absent (unchanged for all pre-Task-4 callers)', () => {
    const r = scoreLiveSeo(perfect(), DEFAULT_WEIGHTS)
    expect(r.factors.find((x) => x.key === 'brokenLinks')).toBeUndefined()
  })

  it('inputsSnapshot carries the raw linkVerification snapshot (or null)', () => {
    const lv = linkVerif()
    const withLv = scoreLiveSeo(perfect({ linkVerification: lv }), DEFAULT_WEIGHTS)
    expect(withLv.inputsSnapshot.source).toBe('live')
    expect(withLv.inputsSnapshot.linkVerification).toEqual(lv)
    const withoutLv = scoreLiveSeo(perfect(), DEFAULT_WEIGHTS)
    expect(withoutLv.inputsSnapshot.linkVerification).toBeNull()
  })
})

describe('scoreLiveSeo — brokenLinks curve matches the shared core (contract)', () => {
  const weight = DEFAULT_WEIGHTS.brokenLinks
  const cases: number[] = [0, SEO_KNEES.brokenLinksZero, 0.01, 0.03] // both knees + 2 interiors
  it.each(cases)('ratio %f matches brokenLinksPoints', (ratio) => {
    const checked = 1000
    const brokenCount = Math.round(ratio * checked)
    const r = scoreLiveSeo(perfect({
      linkVerification: linkVerif({ internalChecked: checked, internalBroken: brokenCount, imagesChecked: 0, imagesBroken: 0 }),
    }), DEFAULT_WEIGHTS)
    const f = r.factors.find((x) => x.key === 'brokenLinks')!
    const expected = brokenLinksPoints(brokenCount / checked, weight)
    expect(f.earned).toBeCloseTo(expected, 6)
  })
})
