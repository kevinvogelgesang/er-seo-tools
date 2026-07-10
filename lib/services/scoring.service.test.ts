import { describe, it, expect } from 'vitest';
import { computeHealthScore } from './scoring.service';
import { DEFAULT_WEIGHTS, type ScoringWeights } from '../scoring/weights';
import type { AggregatedResult } from '../types';
import {
  indexabilityPoints, errorRatePoints, missingElementPoints, crawlDepthPoints,
  thinContentPoints, schemaPoints,
} from '../scoring/seo-core';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal AggregatedResult. Every field used by computeHealthScore
 * must be present (or explicitly undefined to test adaptive weighting).
 */
function makeResult(overrides: Partial<AggregatedResult> = {}): AggregatedResult {
  const base: AggregatedResult = {
    crawl_summary: {
      total_urls: 100,
      indexable_urls: 95,
      client_errors: 0,
      server_errors: 0,
      avg_crawl_depth: 2,
    },
    issues: {
      critical: [],
      warnings: [],
      notices: [],
    },
    site_structure: {},
    resources: {},
    technical_seo: {
      structured_data: { pages_with_schema: 40, schema_types: {} },
    },
    performance: {},
    recommendations: [],
    metadata: {
      files_processed: [],
      parsers_used: [],
      total_parsers_available: 0,
    },
  };

  return {
    ...base,
    ...overrides,
    crawl_summary: { ...base.crawl_summary, ...overrides.crawl_summary },
    issues: overrides.issues ?? base.issues,
    technical_seo: overrides.technical_seo !== undefined ? overrides.technical_seo : base.technical_seo,
  };
}

// ── Zero URLs ────────────────────────────────────────────────────────────────

describe('computeHealthScore — zero total URLs', () => {
  it('returns 0 when total_urls is 0', () => {
    const result = makeResult({
      crawl_summary: {
        total_urls: 0,
        indexable_urls: 0,
        client_errors: 0,
        server_errors: 0,
        avg_crawl_depth: undefined,
      },
      technical_seo: undefined,
    });
    expect(computeHealthScore(result, DEFAULT_WEIGHTS).score).toBe(0);
  });
});

// ── Perfect site ─────────────────────────────────────────────────────────────

/**
 * A result where every factor is maxed out, regardless of weight profile:
 * - 100% indexable (≥98% → full pts — the default fixture's 95% is no
 *   longer full under the new knee, so this override is required)
 * - 0 errors → full pts
 * - 0 missing titles/meta/H1 → full pts
 * - avg_crawl_depth ≤ 3 → full pts
 * - 0 thin content → full pts
 * - pages_with_schema / total_urls = 40/100 = 40% ≥ 30% → full pts
 */
function makePerfectResult(): AggregatedResult {
  return makeResult({
    crawl_summary: { indexable_urls: 100 },
    issues: {
      critical: [
        { type: 'thin_content', severity: 'critical', count: 0, description: '' },
      ],
      warnings: [],
      notices: [],
    },
  });
}

describe('computeHealthScore — perfect site', () => {
  it('returns 100 for a fully-optimised site', () => {
    const result = makePerfectResult();
    const score = computeHealthScore(result, DEFAULT_WEIGHTS).score;
    expect(score).toBe(100);
  });

  it('returns 100 for a fully-optimised site under default AND doubled weights', () => {
    const result = makePerfectResult();
    expect(computeHealthScore(result, DEFAULT_WEIGHTS).score).toBe(100);

    const doubled: ScoringWeights = Object.fromEntries(
      Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, v * 2]),
    ) as ScoringWeights;
    expect(computeHealthScore(result, doubled).score).toBe(100);
  });

  it('breakdown factors have possible === weight and earned <= possible', () => {
    const result = makePerfectResult();
    const { factors } = computeHealthScore(result, DEFAULT_WEIGHTS);
    expect(factors.length).toBeGreaterThan(0);
    for (const f of factors) {
      expect(f.possible).toBe(f.weight);
      expect(f.earned).toBeLessThanOrEqual(f.possible);
      expect(f.earned).toBeGreaterThanOrEqual(0);
    }
  });

  it('a zeroed factor drops out of the breakdown (perfect site still scores 100)', () => {
    const result = makePerfectResult();
    const weights: ScoringWeights = { ...DEFAULT_WEIGHTS, schema: 0 };
    const { score, factors } = computeHealthScore(result, weights);
    expect(score).toBe(100);
    expect(factors.find((f) => f.key === 'schema')).toBeUndefined();
  });
});

// ── Error rate ────────────────────────────────────────────────────────────────

describe('computeHealthScore — error rate', () => {
  it('reduces score proportionally when many 4xx errors exist', () => {
    const goodResult = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const badResult = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 40, server_errors: 0, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(badResult, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(goodResult, DEFAULT_WEIGHTS).score);
  });

  it('reduces score proportionally when many 5xx errors exist', () => {
    const goodResult = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const badResult = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 50, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(badResult, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(goodResult, DEFAULT_WEIGHTS).score);
  });

  it('applies full error points when error rate is below 1%', () => {
    // 0 errors — contributes 20/20 pts from error factor
    const result = makeResult({
      crawl_summary: { total_urls: 200, indexable_urls: 190, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    // Just verify score is high (can't be 0 from error factor)
    expect(computeHealthScore(result, DEFAULT_WEIGHTS).score).toBeGreaterThan(50);
  });
});

// ── Missing SEO elements ──────────────────────────────────────────────────────

describe('computeHealthScore — missing SEO elements', () => {
  it('reduces score when all pages are missing titles', () => {
    const good = makeResult();
    const bad = makeResult({
      issues: {
        critical: [{ type: 'missing_title', severity: 'critical', count: 95, description: '' }],
        warnings: [],
        notices: [],
      },
    });
    expect(computeHealthScore(bad, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(good, DEFAULT_WEIGHTS).score);
  });

  it('reduces score when all pages are missing meta descriptions', () => {
    const good = makeResult();
    const bad = makeResult({
      issues: {
        critical: [],
        warnings: [{ type: 'missing_meta_description', severity: 'warning', count: 95, description: '' }],
        notices: [],
      },
    });
    expect(computeHealthScore(bad, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(good, DEFAULT_WEIGHTS).score);
  });

  it('reduces score when all pages are missing H1s', () => {
    const good = makeResult();
    const bad = makeResult({
      issues: {
        critical: [],
        warnings: [{ type: 'missing_h1', severity: 'warning', count: 95, description: '' }],
        notices: [],
      },
    });
    expect(computeHealthScore(bad, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(good, DEFAULT_WEIGHTS).score);
  });

  it('reduces score further when multiple SEO elements are missing', () => {
    const oneMissing = makeResult({
      issues: {
        critical: [{ type: 'missing_title', severity: 'critical', count: 95, description: '' }],
        warnings: [],
        notices: [],
      },
    });
    const allMissing = makeResult({
      issues: {
        critical: [{ type: 'missing_title', severity: 'critical', count: 95, description: '' }],
        warnings: [
          { type: 'missing_meta_description', severity: 'warning', count: 95, description: '' },
          { type: 'missing_h1', severity: 'warning', count: 95, description: '' },
        ],
        notices: [],
      },
    });
    expect(computeHealthScore(allMissing, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(oneMissing, DEFAULT_WEIGHTS).score);
  });
});

// ── Crawl depth ───────────────────────────────────────────────────────────────

describe('computeHealthScore — crawl depth', () => {
  it('gives full crawl depth points for avg_crawl_depth ≤ 3', () => {
    const shallow = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 1 },
    });
    const moderate = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 3 },
    });
    expect(computeHealthScore(shallow, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(moderate, DEFAULT_WEIGHTS).score);
  });

  it('reduces score linearly for depth between 3 and 6', () => {
    const depth4 = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 4 },
    });
    const depth5 = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 5 },
    });
    expect(computeHealthScore(depth4, DEFAULT_WEIGHTS).score).toBeGreaterThan(computeHealthScore(depth5, DEFAULT_WEIGHTS).score);
  });

  it('gives 0 crawl depth points for avg_crawl_depth ≥ 6', () => {
    const depth6 = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 6 },
    });
    const depth10 = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 10 },
    });
    // Both contribute 0 depth pts, so scores should be equal
    expect(computeHealthScore(depth6, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(depth10, DEFAULT_WEIGHTS).score);
  });

  it('skips crawl depth factor when avg_crawl_depth is undefined (adaptive weighting)', () => {
    const withDepth = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const withoutDepth = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: undefined },
    });
    // Both should produce valid scores (no crash); they'll differ
    expect(computeHealthScore(withDepth, DEFAULT_WEIGHTS).score).toBeGreaterThanOrEqual(0);
    expect(computeHealthScore(withoutDepth, DEFAULT_WEIGHTS).score).toBeGreaterThanOrEqual(0);
    expect(computeHealthScore(withoutDepth, DEFAULT_WEIGHTS).score).toBeLessThanOrEqual(100);
  });
});

// ── Thin content ──────────────────────────────────────────────────────────────

describe('computeHealthScore — thin content', () => {
  it('reduces score when thin content ratio is high (> 40%)', () => {
    const noThin = makeResult({
      issues: {
        critical: [{ type: 'thin_content', severity: 'critical', count: 0, description: '' }],
        warnings: [],
        notices: [],
      },
    });
    const highThin = makeResult({
      issues: {
        critical: [{ type: 'thin_content', severity: 'critical', count: 50, description: '' }],
        warnings: [],
        notices: [],
      },
    });
    expect(computeHealthScore(highThin, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(noThin, DEFAULT_WEIGHTS).score);
  });

  it('skips thin content factor when thin_content issue is absent', () => {
    // No thin_content issue at all → factor skipped, remaining factors normalized
    const result = makeResult({
      issues: { critical: [], warnings: [], notices: [] },
    });
    const score = computeHealthScore(result, DEFAULT_WEIGHTS).score;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── Schema coverage ───────────────────────────────────────────────────────────

describe('computeHealthScore — schema coverage', () => {
  it('gives full schema pts when ≥30% of pages have schema', () => {
    const result = makeResult({
      technical_seo: { structured_data: { pages_with_schema: 30, schema_types: {} } },
    });
    const withSchema = makeResult({
      technical_seo: { structured_data: { pages_with_schema: 60, schema_types: {} } },
    });
    // Both ≥30% → same schema contribution, should score the same
    expect(computeHealthScore(result, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(withSchema, DEFAULT_WEIGHTS).score);
  });

  it('gives less schema pts when < 30% of pages have schema', () => {
    const low = makeResult({
      technical_seo: { structured_data: { pages_with_schema: 5, schema_types: {} } },
    });
    const high = makeResult({
      technical_seo: { structured_data: { pages_with_schema: 40, schema_types: {} } },
    });
    expect(computeHealthScore(low, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(high, DEFAULT_WEIGHTS).score);
  });

  it('skips schema factor when structured_data is undefined (adaptive weighting)', () => {
    const result = makeResult({ technical_seo: {} });
    const score = computeHealthScore(result, DEFAULT_WEIGHTS).score;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('skips schema factor when technical_seo is undefined (adaptive weighting)', () => {
    // technical_seo itself being undefined should not crash
    const result = makeResult({ technical_seo: undefined as unknown as AggregatedResult['technical_seo'] });
    const score = computeHealthScore(result, DEFAULT_WEIGHTS).score;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── Threshold boundaries ──────────────────────────────────────────────────────
// C19 PR2 Task 3: knees now live in lib/scoring/seo-core.ts (SEO_KNEES). This
// describe pins the SF adapter to the NEW knee values.

describe('computeHealthScore — threshold boundaries', () => {
  // ── Indexability boundary: new full knee is >= 98% (was 95%) ─────────────
  it('indexability of 98% (new full knee) scores the same as 100%', () => {
    const atBoundary = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 98, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const perfect = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 100, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(atBoundary, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(perfect, DEFAULT_WEIGHTS).score);
  });

  it('indexability of 95% (the OLD full knee) now scores below the 98% boundary', () => {
    const oldKnee = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const newKnee = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 98, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(oldKnee, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(newKnee, DEFAULT_WEIGHTS).score);
  });

  // ── Crawl depth boundary: <= 3.0 → full 15 pts; >= 6.0 → 0 pts (UNCHANGED) ──
  it('avg_crawl_depth exactly 3.0 receives full crawl depth points (same as depth 1)', () => {
    const atBoundary = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 3.0 },
    });
    const clearlyGood = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 1.0 },
    });
    expect(computeHealthScore(atBoundary, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(clearlyGood, DEFAULT_WEIGHTS).score);
  });

  it('avg_crawl_depth of 4.5 (well into degraded zone) scores less than depth 3.0', () => {
    // depth 3.0 → 15 pts; depth 4.5 → 15 * (1 - 1.5/3) = 7.5 pts → big enough gap to survive rounding
    const atBoundary = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 3.0 },
    });
    const degraded = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 4.5 },
    });
    expect(computeHealthScore(atBoundary, DEFAULT_WEIGHTS).score).toBeGreaterThan(computeHealthScore(degraded, DEFAULT_WEIGHTS).score);
  });

  it('avg_crawl_depth exactly 6.0 receives zero crawl depth points (same as depth 10)', () => {
    const atMax = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 6.0 },
    });
    const wayOver = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 10.0 },
    });
    expect(computeHealthScore(atMax, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(wayOver, DEFAULT_WEIGHTS).score);
  });

  it('avg_crawl_depth of 4.5 scores more than depth 6.0 (still in degraded range vs zero range)', () => {
    // depth 4.5 → partial pts; depth 6.0 → 0 pts → meaningful gap
    const partialDepth = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 4.5 },
    });
    const atMax = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 6.0 },
    });
    expect(computeHealthScore(partialDepth, DEFAULT_WEIGHTS).score).toBeGreaterThan(computeHealthScore(atMax, DEFAULT_WEIGHTS).score);
  });

  // ── Error rate boundary: full < 1% (unchanged); zero >= 20% (was 100%) ───
  it('error rate of 0% and error rate of 10% produce different scores', () => {
    const noErrors = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const tenPercent = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 10, server_errors: 0, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(noErrors, DEFAULT_WEIGHTS).score).toBeGreaterThan(computeHealthScore(tenPercent, DEFAULT_WEIGHTS).score);
  });

  it('error rate of 0.9% (just under 1%) earns full error points (same as 0%)', () => {
    // < 1% → full 20 pts in both cases (full knee unchanged)
    const noErrors = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const underOnePercent = makeResult({
      // 0 errors on 100 URLs → 0% (we can't do fractional errors, so test with large URL count)
      // 9/1000 = 0.9%
      crawl_summary: { total_urls: 1000, indexable_urls: 950, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const alsoUnder = makeResult({
      crawl_summary: { total_urls: 1000, indexable_urls: 950, client_errors: 9, server_errors: 0, avg_crawl_depth: 2 },
    });
    // 0/1000 = 0% and 9/1000 = 0.9% — both < 1% → both earn full error points → same score
    expect(computeHealthScore(underOnePercent, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(alsoUnder, DEFAULT_WEIGHTS).score);
  });

  it('error rate of 19% (just under the new 20% zero knee) still earns some points, 20% earns zero', () => {
    const justUnder = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 19, server_errors: 0, avg_crawl_depth: 2 },
    });
    const atZero = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 20, server_errors: 0, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(justUnder, DEFAULT_WEIGHTS).score).toBeGreaterThan(computeHealthScore(atZero, DEFAULT_WEIGHTS).score);
  });

  it('error rate of 50% and error rate of 100% score the same (both >= the new 20% zero knee, was 1.0)', () => {
    const fiftyPct = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 50, server_errors: 0, avg_crawl_depth: 2 },
    });
    const hundredPct = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 100, server_errors: 0, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(fiftyPct, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(hundredPct, DEFAULT_WEIGHTS).score);
  });

  it('error rate of 50% earns less than error rate of 10%', () => {
    // 50 errors on 100 URLs (50%) vs 10 errors (10%) — large gap survives rounding
    const tenPct = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 10, server_errors: 0, avg_crawl_depth: 2 },
    });
    const fiftyPct = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 50, server_errors: 0, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(tenPct, DEFAULT_WEIGHTS).score).toBeGreaterThan(computeHealthScore(fiftyPct, DEFAULT_WEIGHTS).score);
  });

  // ── Missing elements boundary: full <= 2% (was 0%); zero >= 30% (was 100%) ──
  it('missing-title pct of exactly 2% (new full knee) scores the same as 0%', () => {
    const cfg = { total_urls: 100, indexable_urls: 100, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 };
    const zero = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'missing_title', severity: 'critical' as const, count: 0, description: '' }], warnings: [], notices: [] },
    });
    const twoPct = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'missing_title', severity: 'critical' as const, count: 2, description: '' }], warnings: [], notices: [] },
    });
    expect(computeHealthScore(zero, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(twoPct, DEFAULT_WEIGHTS).score);
  });

  it('missing-title pct of 16% (interior) scores less than 2% (full knee)', () => {
    const cfg = { total_urls: 100, indexable_urls: 100, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 };
    const twoPct = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'missing_title', severity: 'critical' as const, count: 2, description: '' }], warnings: [], notices: [] },
    });
    const sixteenPct = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'missing_title', severity: 'critical' as const, count: 16, description: '' }], warnings: [], notices: [] },
    });
    expect(computeHealthScore(sixteenPct, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(twoPct, DEFAULT_WEIGHTS).score);
  });

  it('missing-title pct of exactly 30% (new zero knee) scores the same as 100% (was 100% previously too, but now reached much earlier)', () => {
    const cfg = { total_urls: 100, indexable_urls: 100, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 };
    const thirtyPct = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'missing_title', severity: 'critical' as const, count: 30, description: '' }], warnings: [], notices: [] },
    });
    const hundredPct = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'missing_title', severity: 'critical' as const, count: 100, description: '' }], warnings: [], notices: [] },
    });
    expect(computeHealthScore(thirtyPct, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(hundredPct, DEFAULT_WEIGHTS).score);
  });

  // ── Thin content boundary: full <= 5% (unchanged); zero >= 25% (was 40%) ──
  it('thin-content ratio of exactly 5% (full knee, unchanged) scores the same as 0%', () => {
    const cfg = { total_urls: 100, indexable_urls: 100, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 };
    const zero = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'thin_content', severity: 'critical' as const, count: 0, description: '' }], warnings: [], notices: [] },
    });
    const fivePct = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'thin_content', severity: 'critical' as const, count: 5, description: '' }], warnings: [], notices: [] },
    });
    expect(computeHealthScore(zero, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(fivePct, DEFAULT_WEIGHTS).score);
  });

  it('thin-content ratio of exactly 25% (new zero knee) scores the same as 100%', () => {
    const cfg = { total_urls: 100, indexable_urls: 100, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 };
    const twentyFivePct = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'thin_content', severity: 'critical' as const, count: 25, description: '' }], warnings: [], notices: [] },
    });
    const hundredPct = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'thin_content', severity: 'critical' as const, count: 100, description: '' }], warnings: [], notices: [] },
    });
    expect(computeHealthScore(twentyFivePct, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(hundredPct, DEFAULT_WEIGHTS).score);
  });

  it('thin-content ratio of 30% (the OLD zero knee) now scores the same as 25% (both zero)', () => {
    const cfg = { total_urls: 100, indexable_urls: 100, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 };
    const twentyFivePct = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'thin_content', severity: 'critical' as const, count: 25, description: '' }], warnings: [], notices: [] },
    });
    const thirtyPct = makeResult({
      crawl_summary: cfg,
      issues: { critical: [{ type: 'thin_content', severity: 'critical' as const, count: 30, description: '' }], warnings: [], notices: [] },
    });
    expect(computeHealthScore(thirtyPct, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(twentyFivePct, DEFAULT_WEIGHTS).score);
  });

  // ── Schema coverage boundary: >= 30% → full 10 pts ───────────────────────
  it('schema coverage of exactly 30% receives full schema points (same as 40%)', () => {
    // total_urls = 100, pages_with_schema = 30 → 30% → full pts
    const atBoundary = makeResult({
      technical_seo: { structured_data: { pages_with_schema: 30, schema_types: {} } },
    });
    // pages_with_schema = 40 → 40% → also full pts
    const above = makeResult({
      technical_seo: { structured_data: { pages_with_schema: 40, schema_types: {} } },
    });
    expect(computeHealthScore(atBoundary, DEFAULT_WEIGHTS).score).toBe(computeHealthScore(above, DEFAULT_WEIGHTS).score);
  });

  it('schema coverage of 0% (no schema) scores less than coverage of 30%', () => {
    // 0 pages_with_schema → 0/100 = 0% → (0/0.30)*10 = 0 pts; 30% → 10 pts
    // 10 pt gap in a total of ~100 must survive rounding
    const noSchema = makeResult({
      technical_seo: { structured_data: { pages_with_schema: 0, schema_types: {} } },
    });
    const atBoundary = makeResult({
      technical_seo: { structured_data: { pages_with_schema: 30, schema_types: {} } },
    });
    expect(computeHealthScore(noSchema, DEFAULT_WEIGHTS).score).toBeLessThan(computeHealthScore(atBoundary, DEFAULT_WEIGHTS).score);
  });
});

// ── Adaptive weighting ────────────────────────────────────────────────────────

describe('computeHealthScore — adaptive weighting', () => {
  it('still returns a valid score when only crawl_summary data is available', () => {
    // Provide only the bare minimum: total_urls, indexable_urls, errors
    const result = makeResult({
      crawl_summary: { total_urls: 50, indexable_urls: 48, client_errors: 1, server_errors: 0 },
      technical_seo: {},
    });
    const score = computeHealthScore(result, DEFAULT_WEIGHTS).score;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('returns 0 when possible === 0 (no computable factors)', () => {
    // total_urls = 0, indexable_urls = 0 → disables indexability and error factors
    // base = 0 → disables SEO element factors
    // avg_crawl_depth undefined → disables depth factor
    // no structured_data → disables schema factor
    // → possible stays 0 → return 0
    const result: AggregatedResult = {
      crawl_summary: {
        total_urls: 0,
        indexable_urls: 0,
        // avg_crawl_depth intentionally absent
      },
      issues: { critical: [], warnings: [], notices: [] },
      site_structure: {},
      resources: {},
      technical_seo: {},
      performance: {},
      recommendations: [],
      metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0 },
    };
    expect(computeHealthScore(result, DEFAULT_WEIGHTS).score).toBe(0);
  });
});

// ── Score boundaries ──────────────────────────────────────────────────────────

describe('computeHealthScore — score boundaries', () => {
  it('never returns a score above 100', () => {
    const result = makeResult();
    expect(computeHealthScore(result, DEFAULT_WEIGHTS).score).toBeLessThanOrEqual(100);
  });

  it('never returns a score below 0', () => {
    // Worst-case site: all errors, all pages missing everything, deep crawl
    const result = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 0, client_errors: 100, server_errors: 0, avg_crawl_depth: 10 },
      issues: {
        critical: [
          { type: 'missing_title', severity: 'critical', count: 100, description: '' },
          { type: 'thin_content', severity: 'critical', count: 100, description: '' },
        ],
        warnings: [
          { type: 'missing_meta_description', severity: 'warning', count: 100, description: '' },
          { type: 'missing_h1', severity: 'warning', count: 100, description: '' },
        ],
        notices: [],
      },
      technical_seo: { structured_data: { pages_with_schema: 0, schema_types: {} } },
    });
    expect(computeHealthScore(result, DEFAULT_WEIGHTS).score).toBeGreaterThanOrEqual(0);
  });

  it('returns an integer (rounded)', () => {
    const result = makeResult();
    const score = computeHealthScore(result, DEFAULT_WEIGHTS).score;
    expect(score).toBe(Math.round(score));
  });
});

// ── Contract: SF adapter curves === shared core (Codex #4 requirement) ────────
// For each factor, feed computeHealthScore a synthetic result at both knees
// plus two interior points, isolating the factor under test by zeroing every
// other weight. The earned points must match calling the core fn directly,
// within 1e-9 — proving the adapter delegates rather than reimplements.

const ZERO_WEIGHTS: ScoringWeights = {
  indexability: 0, errorRate: 0, missingTitle: 0, missingMeta: 0, missingH1: 0,
  crawlDepth: 0, thinContent: 0, schema: 0, brokenLinks: 0,
};

function earnedFor(result: AggregatedResult, weights: ScoringWeights, key: string): number {
  const factor = computeHealthScore(result, weights).factors.find((f) => f.key === key);
  if (!factor) throw new Error(`factor "${key}" was not present in the breakdown`);
  return factor.earned;
}

describe('computeHealthScore — contract: adapter curves match the shared core exactly', () => {
  const WEIGHT = 20;

  it('indexability: 0, interior, knee, and 100% all match indexabilityPoints', () => {
    const weights: ScoringWeights = { ...ZERO_WEIGHTS, indexability: WEIGHT };
    for (const ratio of [0, 0.49, 0.98, 1]) {
      const result = makeResult({
        crawl_summary: { total_urls: 1000, indexable_urls: Math.round(ratio * 1000), client_errors: 0, server_errors: 0 },
      });
      expect(earnedFor(result, weights, 'indexability')).toBeCloseTo(indexabilityPoints(ratio, WEIGHT), 9);
    }
  });

  it('errorRate: full knee, interior, zero knee, and beyond all match errorRatePoints', () => {
    const weights: ScoringWeights = { ...ZERO_WEIGHTS, errorRate: WEIGHT };
    for (const rate of [0, 0.01, 0.105, 0.20, 0.5]) {
      const result = makeResult({
        crawl_summary: { total_urls: 1000, indexable_urls: 1000, client_errors: Math.round(rate * 1000), server_errors: 0 },
      });
      expect(earnedFor(result, weights, 'errorRate')).toBeCloseTo(errorRatePoints(rate, WEIGHT), 9);
    }
  });

  it('missingTitle: full knee, interior, zero knee, and beyond all match missingElementPoints', () => {
    const weights: ScoringWeights = { ...ZERO_WEIGHTS, missingTitle: WEIGHT };
    for (const pct of [0, 0.02, 0.16, 0.30, 0.9]) {
      const result = makeResult({
        crawl_summary: { total_urls: 1000, indexable_urls: 1000, client_errors: 0, server_errors: 0 },
        issues: {
          critical: [{ type: 'missing_title', severity: 'critical', count: Math.round(pct * 1000), description: '' }],
          warnings: [], notices: [],
        },
      });
      expect(earnedFor(result, weights, 'missingTitle')).toBeCloseTo(missingElementPoints(pct, WEIGHT), 9);
    }
  });

  it('crawlDepth: full knee, interior, zero knee, and beyond all match crawlDepthPoints', () => {
    const weights: ScoringWeights = { ...ZERO_WEIGHTS, crawlDepth: WEIGHT };
    for (const depth of [0, 3.0, 4.5, 6.0, 10]) {
      const result = makeResult({ crawl_summary: { avg_crawl_depth: depth } });
      expect(earnedFor(result, weights, 'crawlDepth')).toBeCloseTo(crawlDepthPoints(depth, WEIGHT), 9);
    }
  });

  it('thinContent: full knee, interior, zero knee, and beyond all match thinContentPoints', () => {
    const weights: ScoringWeights = { ...ZERO_WEIGHTS, thinContent: WEIGHT };
    for (const ratio of [0, 0.05, 0.15, 0.25, 0.9]) {
      const result = makeResult({
        crawl_summary: { total_urls: 1000, indexable_urls: 1000, client_errors: 0, server_errors: 0 },
        issues: {
          critical: [{ type: 'thin_content', severity: 'critical', count: Math.round(ratio * 1000), description: '' }],
          warnings: [], notices: [],
        },
      });
      expect(earnedFor(result, weights, 'thinContent')).toBeCloseTo(thinContentPoints(ratio, WEIGHT), 9);
    }
  });

  it('schema: 0, interior, knee, and 100% all match schemaPoints', () => {
    const weights: ScoringWeights = { ...ZERO_WEIGHTS, schema: WEIGHT };
    for (const ratio of [0, 0.15, 0.30, 1]) {
      const result = makeResult({
        crawl_summary: { total_urls: 1000 },
        technical_seo: { structured_data: { pages_with_schema: Math.round(ratio * 1000), schema_types: {} } },
      });
      expect(earnedFor(result, weights, 'schema')).toBeCloseTo(schemaPoints(ratio, WEIGHT), 9);
    }
  });
});

// ── inputsSnapshot (additive, C19 PR2 Task 3) ─────────────────────────────────

describe('computeHealthScore — inputsSnapshot', () => {
  it('carries source "sf" and the raw inputs used, nulling data-unavailable factors', () => {
    const result = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 2, server_errors: 1, avg_crawl_depth: undefined },
      technical_seo: {},
      issues: {
        critical: [{ type: 'missing_title', severity: 'critical', count: 3, description: '' }],
        warnings: [{ type: 'missing_meta_description', severity: 'warning', count: 4, description: '' }],
        notices: [],
      },
    });
    const { inputsSnapshot } = computeHealthScore(result, DEFAULT_WEIGHTS);
    expect(inputsSnapshot).toEqual({
      source: 'sf',
      totalUrls: 100,
      indexableUrls: 95,
      clientErrors: 2,
      serverErrors: 1,
      base: 95,
      missingTitle: 3,
      missingMeta: 4,
      missingH1: 0,
      avgCrawlDepth: null,
      thinCount: null,
      pagesWithSchema: null,
    });
  });

  it('carries non-null avgCrawlDepth/thinCount/pagesWithSchema when the underlying data is present', () => {
    const result = makePerfectResult();
    const { inputsSnapshot } = computeHealthScore(result, DEFAULT_WEIGHTS);
    expect(inputsSnapshot.avgCrawlDepth).toBe(2);
    expect(inputsSnapshot.thinCount).toBe(0);
    expect(inputsSnapshot.pagesWithSchema).toBe(40);
  });
});
