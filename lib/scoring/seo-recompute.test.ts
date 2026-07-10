import { describe, it, expect } from 'vitest'
import { computeHealthScore } from '@/lib/services/scoring.service'
import { scoreLiveSeo, type LiveScoreInputs } from '@/lib/findings/live-seo-score'
import { DEFAULT_WEIGHTS, type ScoringWeights } from './weights'
import { recomputeSeoScore } from './seo-recompute'
import type { AggregatedResult } from '@/lib/types'

// Minimal SF blob: 100 urls, 90 indexable, 4 client + 1 server errors,
// 12 missing titles / 6 metas / 3 h1s, depth 3.4, 8 thin, 40 with schema.
const sfBlob = {
  crawl_summary: { total_urls: 100, indexable_urls: 90, client_errors: 4, server_errors: 1, avg_crawl_depth: 3.4 },
  issues: {
    critical: [{ type: 'missing_title', count: 12 }],
    warnings: [{ type: 'missing_meta_description', count: 6 }, { type: 'thin_content', count: 8 }],
    notices: [{ type: 'missing_h1', count: 3 }],
  },
  technical_seo: { structured_data: { pages_with_schema: 40 } },
} as unknown as AggregatedResult

const liveInputs: LiveScoreInputs = {
  attempted: 60, observed: 55, indexableScored: 50, pagesError: 2,
  missingTitle: 4, missingMeta: 6, missingH1: 1, thin: 5, pagesWithSchema: 30,
  linkVerification: { internalChecked: 200, internalBroken: 4, imagesChecked: 40, imagesBroken: 1, passComplete: true },
}

const CUSTOM: ScoringWeights = { ...DEFAULT_WEIGHTS, indexability: 5, errorRate: 30, brokenLinks: 25, crawlDepth: 0 }

describe('sf snapshot recompute mirrors computeHealthScore', () => {
  for (const [name, w] of [['defaults', DEFAULT_WEIGHTS], ['custom profile', CUSTOM]] as const) {
    it(`score+factors identical under ${name}`, () => {
      const snapshot = computeHealthScore(sfBlob, DEFAULT_WEIGHTS).inputsSnapshot // snapshot is weights-independent
      const direct = computeHealthScore(sfBlob, w)
      const re = recomputeSeoScore(snapshot, w)
      expect(re.score).toBe(direct.score)
      expect(re.factors).toEqual(direct.factors)
    })
  }
  it('null-marked fields renormalize away (no crawlDepth/thin/schema factors)', () => {
    const snapshot = { ...computeHealthScore(sfBlob, DEFAULT_WEIGHTS).inputsSnapshot, avgCrawlDepth: null, thinCount: null, pagesWithSchema: null }
    const re = recomputeSeoScore(snapshot, DEFAULT_WEIGHTS)
    const keys = re.factors.map((f) => f.key)
    expect(keys).not.toContain('crawlDepth')
    expect(keys).not.toContain('thinContent')
    expect(keys).not.toContain('schema')
  })
  it('brokenLinks is never a factor for an sf snapshot', () => {
    const snapshot = computeHealthScore(sfBlob, DEFAULT_WEIGHTS).inputsSnapshot
    expect(recomputeSeoScore(snapshot, CUSTOM).factors.map((f) => f.key)).not.toContain('brokenLinks')
  })
  it('mirrors availability for blobs with UNDEFINED indexable/error fields (Codex #3)', () => {
    const sparseBlob = {
      crawl_summary: { total_urls: 100 }, // no indexable_urls, no client/server errors
      issues: { critical: [], warnings: [], notices: [] },
    } as unknown as AggregatedResult
    const direct = computeHealthScore(sparseBlob, DEFAULT_WEIGHTS)
    const re = recomputeSeoScore(direct.inputsSnapshot, DEFAULT_WEIGHTS)
    expect(direct.inputsSnapshot.indexableKnown).toBe(false)
    expect(direct.inputsSnapshot.errorsKnown).toBe(false)
    expect(re.score).toBe(direct.score)
    expect(re.factors).toEqual(direct.factors) // neither includes indexability/errorRate
  })
  it('pre-PR3 snapshots (no booleans) fall back to the lossy present-implies-available rule', () => {
    const snapshot = computeHealthScore(sfBlob, DEFAULT_WEIGHTS).inputsSnapshot
    const legacy = { ...snapshot }
    delete (legacy as Record<string, unknown>).indexableKnown
    delete (legacy as Record<string, unknown>).errorsKnown
    expect(recomputeSeoScore(legacy, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(sfBlob, DEFAULT_WEIGHTS).score)
  })
})

describe('live snapshot recompute mirrors scoreLiveSeo', () => {
  for (const [name, w] of [['defaults', DEFAULT_WEIGHTS], ['custom profile', CUSTOM]] as const) {
    it(`score+factors identical under ${name}`, () => {
      const snapshot = scoreLiveSeo(liveInputs, DEFAULT_WEIGHTS).inputsSnapshot
      const direct = scoreLiveSeo(liveInputs, w)
      const re = recomputeSeoScore(snapshot, w)
      expect(re.score).toBe(direct.score)
      expect(re.factors).toEqual(direct.factors)
    })
  }
  it('re-applies the live null gates (a null-scored run stays null under any weights)', () => {
    const gated = scoreLiveSeo({ ...liveInputs, indexableScored: 0 }, DEFAULT_WEIGHTS)
    expect(recomputeSeoScore(gated.inputsSnapshot, CUSTOM).score).toBeNull()
  })
})
