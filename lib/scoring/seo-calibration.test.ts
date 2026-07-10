// lib/scoring/seo-calibration.test.ts — C19 PR2 golden archetypes for the
// shared SEO curve core (Kevin 2026-07-09 anchor, SEO edition).
// These bands ARE the calibration anchor. A knee/weight change that moves an
// archetype out of band must be a deliberate, reviewed decision — never
// collateral damage. Arithmetic is pre-verified in the task brief; if a band
// fails, the CODE is wrong — never adjust the fixture or the band.
import { describe, it, expect } from 'vitest'
import { DEFAULT_WEIGHTS } from './weights'
import {
  indexabilityPoints, errorRatePoints, missingElementPoints, crawlDepthPoints,
  thinContentPoints, schemaPoints,
} from './seo-core'

interface Archetype {
  indexableRatio: number
  errorRate: number
  missingTitlePct: number
  missingMetaPct: number
  missingH1Pct: number
  crawlDepth: number
  thinRatio: number
  schemaRatio: number
}

// Composes the core fns summed/normalized exactly as computeHealthScore does
// (earned/possible over the 8 SF factors) — mirrors
// lib/services/scoring.service.ts:18-145 without importing/modifying it.
function scoreArchetype(a: Archetype): number {
  const w = DEFAULT_WEIGHTS
  const earned =
    indexabilityPoints(a.indexableRatio, w.indexability) +
    errorRatePoints(a.errorRate, w.errorRate) +
    missingElementPoints(a.missingTitlePct, w.missingTitle) +
    missingElementPoints(a.missingMetaPct, w.missingMeta) +
    missingElementPoints(a.missingH1Pct, w.missingH1) +
    crawlDepthPoints(a.crawlDepth, w.crawlDepth) +
    thinContentPoints(a.thinRatio, w.thinContent) +
    schemaPoints(a.schemaRatio, w.schema)
  const possible =
    w.indexability + w.errorRate + w.missingTitle + w.missingMeta + w.missingH1 +
    w.crawlDepth + w.thinContent + w.schema
  return Math.round((earned / possible) * 100)
}

describe('SEO calibration bands (Kevin 2026-07-09 anchor, SEO edition)', () => {
  it('CLEAN: 100% indexable, 0 errors, 0 missing, depth 2.5, 2% thin, 40% schema → ≥95', () => {
    const s = scoreArchetype({
      indexableRatio: 1, errorRate: 0, missingTitlePct: 0, missingMetaPct: 0, missingH1Pct: 0,
      crawlDepth: 2.5, thinRatio: 0.02, schemaRatio: 0.40,
    })
    expect(s).toBeGreaterThanOrEqual(95)
  })

  it('LIGHTLY FLAWED: 96% indexable, 2% errors, 5% missing meta+h1, depth 3.5, 8% thin, 25% schema → 85–92 (≈91)', () => {
    const s = scoreArchetype({
      indexableRatio: 0.96, errorRate: 0.02, missingTitlePct: 0, missingMetaPct: 0.05, missingH1Pct: 0.05,
      crawlDepth: 3.5, thinRatio: 0.08, schemaRatio: 0.25,
    })
    expect(s).toBeGreaterThanOrEqual(85)
    expect(s).toBeLessThanOrEqual(92)
  })

  it('VISIBLY FLAWED: 93% indexable, 4% errors, 8% missing all, depth 4.0, 12% thin, 15% schema → 70–80 (≈77)', () => {
    const s = scoreArchetype({
      indexableRatio: 0.93, errorRate: 0.04, missingTitlePct: 0.08, missingMetaPct: 0.08, missingH1Pct: 0.08,
      crawlDepth: 4.0, thinRatio: 0.12, schemaRatio: 0.15,
    })
    expect(s).toBeGreaterThanOrEqual(70)
    expect(s).toBeLessThanOrEqual(80)
  })

  it('BROKEN: 70% indexable, 25% errors, 35% missing all, depth 6.5, 30% thin, 0% schema → ≤50 (≈14)', () => {
    const s = scoreArchetype({
      indexableRatio: 0.70, errorRate: 0.25, missingTitlePct: 0.35, missingMetaPct: 0.35, missingH1Pct: 0.35,
      crawlDepth: 6.5, thinRatio: 0.30, schemaRatio: 0,
    })
    expect(s).toBeLessThanOrEqual(50)
  })
})
