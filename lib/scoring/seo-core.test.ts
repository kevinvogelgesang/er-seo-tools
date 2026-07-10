// lib/scoring/seo-core.test.ts — per-fn boundary/interior/monotonicity/clamp
// cases for the shared SEO curve core (C19 PR2 Task 1).
import { describe, it, expect } from 'vitest'
import {
  SEO_KNEES,
  indexabilityPoints, errorRatePoints, missingElementPoints, crawlDepthPoints,
  thinContentPoints, schemaPoints, brokenLinksPoints,
} from './seo-core'

describe('indexabilityPoints', () => {
  it('full points at the knee (0.98) and above', () => {
    expect(indexabilityPoints(SEO_KNEES.indexabilityFull, 20)).toBe(20)
    expect(indexabilityPoints(1, 20)).toBe(20)
  })
  it('zero points at ratio 0', () => {
    expect(indexabilityPoints(0, 20)).toBe(0)
  })
  it('interior point: ratio 0.49 → half of weight (0.49/0.98)', () => {
    expect(indexabilityPoints(0.49, 20)).toBeCloseTo(10, 5)
  })
  it('monotonicity: higher ratio never scores lower', () => {
    let prev = -1
    for (const ratio of [0, 0.2, 0.4, 0.6, 0.8, 0.98, 1]) {
      const pts = indexabilityPoints(ratio, 20)
      expect(pts).toBeGreaterThanOrEqual(prev)
      prev = pts
    }
  })
  it('clamps: never negative, never exceeds weight', () => {
    expect(indexabilityPoints(-1, 20)).toBeGreaterThanOrEqual(0)
    expect(indexabilityPoints(5, 20)).toBeLessThanOrEqual(20)
  })
})

describe('errorRatePoints', () => {
  it('full points below/at the full knee (0.01)', () => {
    expect(errorRatePoints(0, 20)).toBe(20)
    expect(errorRatePoints(0.01, 20)).toBe(20)
  })
  it('zero points at/above the zero knee (0.20)', () => {
    expect(errorRatePoints(0.20, 20)).toBe(0)
    expect(errorRatePoints(0.5, 20)).toBe(0)
  })
  it('interior point: 0.105 → weight × 0.5', () => {
    // weight × (1 − (0.105 − 0.01) / (0.20 − 0.01)) = weight × 0.5
    expect(errorRatePoints(0.105, 20)).toBeCloseTo(10, 5)
  })
  it('monotonicity: higher error rate never scores higher', () => {
    let prev = 21
    for (const rate of [0, 0.01, 0.05, 0.105, 0.15, 0.20, 1]) {
      const pts = errorRatePoints(rate, 20)
      expect(pts).toBeLessThanOrEqual(prev)
      prev = pts
    }
  })
  it('clamps: never negative, never exceeds weight', () => {
    expect(errorRatePoints(5, 20)).toBeGreaterThanOrEqual(0)
    expect(errorRatePoints(-1, 20)).toBeLessThanOrEqual(20)
  })
})

describe('missingElementPoints', () => {
  it('full points at/below the full knee (0.02)', () => {
    expect(missingElementPoints(0, 10)).toBe(10)
    expect(missingElementPoints(0.02, 10)).toBe(10)
  })
  it('zero points at/above the zero knee (0.30)', () => {
    expect(missingElementPoints(0.30, 10)).toBe(0)
    expect(missingElementPoints(0.9, 10)).toBe(0)
  })
  it('interior point: pct 0.16 (midpoint of 0.02–0.30) → weight × 0.5', () => {
    expect(missingElementPoints(0.16, 10)).toBeCloseTo(5, 5)
  })
  it('monotonicity: higher missing pct never scores higher', () => {
    let prev = 11
    for (const pct of [0, 0.02, 0.1, 0.16, 0.25, 0.30, 1]) {
      const pts = missingElementPoints(pct, 10)
      expect(pts).toBeLessThanOrEqual(prev)
      prev = pts
    }
  })
  it('clamps: never negative, never exceeds weight', () => {
    expect(missingElementPoints(5, 10)).toBeGreaterThanOrEqual(0)
    expect(missingElementPoints(-1, 10)).toBeLessThanOrEqual(10)
  })
})

describe('crawlDepthPoints', () => {
  it('full points at/below the full knee (3.0)', () => {
    expect(crawlDepthPoints(0, 15)).toBe(15)
    expect(crawlDepthPoints(3.0, 15)).toBe(15)
  })
  it('zero points at/above the zero knee (6.0)', () => {
    expect(crawlDepthPoints(6.0, 15)).toBe(0)
    expect(crawlDepthPoints(20, 15)).toBe(0)
  })
  it('interior point: depth 4.5 (midpoint) → weight × 0.5', () => {
    expect(crawlDepthPoints(4.5, 15)).toBeCloseTo(7.5, 5)
  })
  it('monotonicity: deeper crawl never scores higher', () => {
    let prev = 16
    for (const depth of [0, 3, 3.5, 4.5, 5.5, 6, 10]) {
      const pts = crawlDepthPoints(depth, 15)
      expect(pts).toBeLessThanOrEqual(prev)
      prev = pts
    }
  })
  it('clamps: never negative, never exceeds weight', () => {
    expect(crawlDepthPoints(100, 15)).toBeGreaterThanOrEqual(0)
    expect(crawlDepthPoints(-5, 15)).toBeLessThanOrEqual(15)
  })
})

describe('thinContentPoints', () => {
  it('full points at/below the full knee (0.05)', () => {
    expect(thinContentPoints(0, 10)).toBe(10)
    expect(thinContentPoints(0.05, 10)).toBe(10)
  })
  it('zero points at/above the zero knee (0.25)', () => {
    expect(thinContentPoints(0.25, 10)).toBe(0)
    expect(thinContentPoints(0.9, 10)).toBe(0)
  })
  it('interior point: ratio 0.15 (midpoint of 0.05–0.25) → weight × 0.5', () => {
    expect(thinContentPoints(0.15, 10)).toBeCloseTo(5, 5)
  })
  it('monotonicity: more thin content never scores higher', () => {
    let prev = 11
    for (const ratio of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 1]) {
      const pts = thinContentPoints(ratio, 10)
      expect(pts).toBeLessThanOrEqual(prev)
      prev = pts
    }
  })
  it('clamps: never negative, never exceeds weight', () => {
    expect(thinContentPoints(5, 10)).toBeGreaterThanOrEqual(0)
    expect(thinContentPoints(-1, 10)).toBeLessThanOrEqual(10)
  })
})

describe('schemaPoints', () => {
  it('full points at/above the full knee (0.30)', () => {
    expect(schemaPoints(0.30, 10)).toBe(10)
    expect(schemaPoints(1, 10)).toBe(10)
  })
  it('zero points at ratio 0', () => {
    expect(schemaPoints(0, 10)).toBe(0)
  })
  it('interior point: ratio 0.15 → half of weight (0.15/0.30)', () => {
    expect(schemaPoints(0.15, 10)).toBeCloseTo(5, 5)
  })
  it('monotonicity: more schema coverage never scores lower', () => {
    let prev = -1
    for (const ratio of [0, 0.1, 0.15, 0.2, 0.3, 1]) {
      const pts = schemaPoints(ratio, 10)
      expect(pts).toBeGreaterThanOrEqual(prev)
      prev = pts
    }
  })
  it('clamps: never negative, never exceeds weight', () => {
    expect(schemaPoints(-1, 10)).toBeGreaterThanOrEqual(0)
    expect(schemaPoints(5, 10)).toBeLessThanOrEqual(10)
  })
})

describe('brokenLinksPoints', () => {
  it('full points at/below ratio 0', () => {
    expect(brokenLinksPoints(0, 20)).toBe(20)
    expect(brokenLinksPoints(-0.1, 20)).toBe(20)
  })
  it('zero points at/above the zero knee (0.05)', () => {
    expect(brokenLinksPoints(0.05, 20)).toBe(0)
    expect(brokenLinksPoints(0.5, 20)).toBe(0)
  })
  it('interior point: ratio 0.025 (midpoint) → weight × 0.5', () => {
    expect(brokenLinksPoints(0.025, 20)).toBeCloseTo(10, 5)
  })
  it('monotonicity: more broken links never scores higher', () => {
    let prev = 21
    for (const ratio of [0, 0.01, 0.025, 0.04, 0.05, 1]) {
      const pts = brokenLinksPoints(ratio, 20)
      expect(pts).toBeLessThanOrEqual(prev)
      prev = pts
    }
  })
  it('clamps: never negative, never exceeds weight', () => {
    expect(brokenLinksPoints(5, 20)).toBeGreaterThanOrEqual(0)
    expect(brokenLinksPoints(-5, 20)).toBeLessThanOrEqual(20)
  })
})

describe('SEO_KNEES', () => {
  it('pins the calibrated constants (C19 PR2 spec)', () => {
    expect(SEO_KNEES).toEqual({
      indexabilityFull: 0.98,
      errorRateFull: 0.01,
      errorRateZero: 0.20,
      missingElementFull: 0.02,
      missingElementZero: 0.30,
      crawlDepthFull: 3.0,
      crawlDepthZero: 6.0,
      thinFull: 0.05,
      thinZero: 0.25,
      schemaFull: 0.30,
      brokenLinksZero: 0.05,
    })
  })
})
