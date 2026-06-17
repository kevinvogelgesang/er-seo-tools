import { describe, it, expect } from 'vitest'
import { scoreLiveSeo, type LiveScoreInputs } from './live-seo-score'

// A perfect indexable site: every factor maxed.
const perfect = (o: Partial<LiveScoreInputs> = {}): LiveScoreInputs => ({
  attempted: 100, observed: 100, indexableScored: 100, pagesError: 0,
  missingTitle: 0, missingMeta: 0, missingH1: 0, thin: 0, pagesWithSchema: 30, ...o,
})

describe('scoreLiveSeo', () => {
  it('returns null when nothing was attempted', () => {
    expect(scoreLiveSeo(perfect({ attempted: 0 }))).toBeNull()
  })
  it('returns null below 50% extraction coverage (observed/attempted)', () => {
    expect(scoreLiveSeo(perfect({ attempted: 100, observed: 40, indexableScored: 40 }))).toBeNull()
  })
  it('returns null when no indexable pages (noindex / login-wall site)', () => {
    expect(scoreLiveSeo(perfect({ indexableScored: 0 }))).toBeNull()
  })
  it('scores a perfect indexable site at 100 (no phantom crawl-depth/broken factors)', () => {
    expect(scoreLiveSeo(perfect())).toBe(100)
  })
  it('penalizes missing titles', () => {
    expect(scoreLiveSeo(perfect({ missingTitle: 50 }))).toBeLessThan(100)
  })
  it('penalizes a high error rate', () => {
    expect(scoreLiveSeo(perfect({ pagesError: 50 }))).toBeLessThan(100)
  })
  it('penalizes thin content', () => {
    expect(scoreLiveSeo(perfect({ thin: 50 }))).toBeLessThan(100)
  })
  it('a partially-noindex site scores (not null) and below a fully-indexable one', () => {
    const partial = scoreLiveSeo(perfect({ indexableScored: 50 }))
    expect(partial).not.toBeNull()
    expect(partial!).toBeLessThan(100) // indexability factor (50/100) drags it down
  })
  it('indexability uses observed (not attempted) as denominator', () => {
    // observed 50 of 100 attempted (50% — passes the guard); all 50 indexable → indexability full
    const s = scoreLiveSeo(perfect({ attempted: 100, observed: 50, indexableScored: 50, pagesWithSchema: 15 }))
    expect(s).toBe(100)
  })
})
