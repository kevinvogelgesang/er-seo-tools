import { describe, it, expect } from 'vitest';
import { computeHealthScore } from './scoring.service';
import type { AggregatedResult } from '../types';

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
    expect(computeHealthScore(result)).toBe(0);
  });
});

// ── Perfect site ─────────────────────────────────────────────────────────────

describe('computeHealthScore — perfect site', () => {
  it('returns 100 for a fully-optimised site', () => {
    // All factors maxed:
    // - 100% indexable (≥95% → 20 pts)
    // - 0 errors → 20 pts
    // - 0 missing titles → 10 pts, 0 missing meta → 8 pts, 0 missing H1 → 7 pts
    // - avg_crawl_depth ≤ 3 → 15 pts
    // - 0 thin content → 10 pts
    // - pages_with_schema / total_urls = 40/100 = 40% ≥ 30% → 10 pts
    const result = makeResult({
      issues: {
        critical: [
          { type: 'thin_content', severity: 'critical', count: 0, description: '' },
        ],
        warnings: [],
        notices: [],
      },
    });
    const score = computeHealthScore(result);
    expect(score).toBe(100);
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
    expect(computeHealthScore(badResult)).toBeLessThan(computeHealthScore(goodResult));
  });

  it('reduces score proportionally when many 5xx errors exist', () => {
    const goodResult = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const badResult = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 50, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(badResult)).toBeLessThan(computeHealthScore(goodResult));
  });

  it('applies full error points when error rate is below 1%', () => {
    // 0 errors — contributes 20/20 pts from error factor
    const result = makeResult({
      crawl_summary: { total_urls: 200, indexable_urls: 190, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    // Just verify score is high (can't be 0 from error factor)
    expect(computeHealthScore(result)).toBeGreaterThan(50);
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
    expect(computeHealthScore(bad)).toBeLessThan(computeHealthScore(good));
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
    expect(computeHealthScore(bad)).toBeLessThan(computeHealthScore(good));
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
    expect(computeHealthScore(bad)).toBeLessThan(computeHealthScore(good));
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
    expect(computeHealthScore(allMissing)).toBeLessThan(computeHealthScore(oneMissing));
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
    expect(computeHealthScore(shallow)).toBe(computeHealthScore(moderate));
  });

  it('reduces score linearly for depth between 3 and 6', () => {
    const depth4 = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 4 },
    });
    const depth5 = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 5 },
    });
    expect(computeHealthScore(depth4)).toBeGreaterThan(computeHealthScore(depth5));
  });

  it('gives 0 crawl depth points for avg_crawl_depth ≥ 6', () => {
    const depth6 = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 6 },
    });
    const depth10 = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 10 },
    });
    // Both contribute 0 depth pts, so scores should be equal
    expect(computeHealthScore(depth6)).toBe(computeHealthScore(depth10));
  });

  it('skips crawl depth factor when avg_crawl_depth is undefined (adaptive weighting)', () => {
    const withDepth = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const withoutDepth = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: undefined },
    });
    // Both should produce valid scores (no crash); they'll differ
    expect(computeHealthScore(withDepth)).toBeGreaterThanOrEqual(0);
    expect(computeHealthScore(withoutDepth)).toBeGreaterThanOrEqual(0);
    expect(computeHealthScore(withoutDepth)).toBeLessThanOrEqual(100);
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
    expect(computeHealthScore(highThin)).toBeLessThan(computeHealthScore(noThin));
  });

  it('skips thin content factor when thin_content issue is absent', () => {
    // No thin_content issue at all → factor skipped, remaining factors normalized
    const result = makeResult({
      issues: { critical: [], warnings: [], notices: [] },
    });
    const score = computeHealthScore(result);
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
    expect(computeHealthScore(result)).toBe(computeHealthScore(withSchema));
  });

  it('gives less schema pts when < 30% of pages have schema', () => {
    const low = makeResult({
      technical_seo: { structured_data: { pages_with_schema: 5, schema_types: {} } },
    });
    const high = makeResult({
      technical_seo: { structured_data: { pages_with_schema: 40, schema_types: {} } },
    });
    expect(computeHealthScore(low)).toBeLessThan(computeHealthScore(high));
  });

  it('skips schema factor when structured_data is undefined (adaptive weighting)', () => {
    const result = makeResult({ technical_seo: {} });
    const score = computeHealthScore(result);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('skips schema factor when technical_seo is undefined (adaptive weighting)', () => {
    // technical_seo itself being undefined should not crash
    const result = makeResult({ technical_seo: undefined as unknown as AggregatedResult['technical_seo'] });
    const score = computeHealthScore(result);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── Threshold boundaries ──────────────────────────────────────────────────────

describe('computeHealthScore — threshold boundaries', () => {
  // ── Crawl depth boundary: <= 3.0 → full 15 pts; >= 6.0 → 0 pts ────────────
  it('avg_crawl_depth exactly 3.0 receives full crawl depth points (same as depth 1)', () => {
    const atBoundary = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 3.0 },
    });
    const clearlyGood = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 1.0 },
    });
    expect(computeHealthScore(atBoundary)).toBe(computeHealthScore(clearlyGood));
  });

  it('avg_crawl_depth of 4.5 (well into degraded zone) scores less than depth 3.0', () => {
    // depth 3.0 → 15 pts; depth 4.5 → 15 * (1 - 1.5/3) = 7.5 pts → big enough gap to survive rounding
    const atBoundary = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 3.0 },
    });
    const degraded = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 4.5 },
    });
    expect(computeHealthScore(atBoundary)).toBeGreaterThan(computeHealthScore(degraded));
  });

  it('avg_crawl_depth exactly 6.0 receives zero crawl depth points (same as depth 10)', () => {
    const atMax = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 6.0 },
    });
    const wayOver = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 10.0 },
    });
    expect(computeHealthScore(atMax)).toBe(computeHealthScore(wayOver));
  });

  it('avg_crawl_depth of 4.5 scores more than depth 6.0 (still in degraded range vs zero range)', () => {
    // depth 4.5 → partial pts; depth 6.0 → 0 pts → meaningful gap
    const partialDepth = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 4.5 },
    });
    const atMax = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 6.0 },
    });
    expect(computeHealthScore(partialDepth)).toBeGreaterThan(computeHealthScore(atMax));
  });

  // ── Error rate boundary: < 1% → full 20 pts; >= 1% → reduced ─────────────
  it('error rate of 0% and error rate of 10% produce different scores', () => {
    // 0 errors → 20/20 pts; 10 errors on 100 URLs (10%) → 20 - (0.1/1.0)*20 = 18 pts → ~2pt gap after rounding
    const noErrors = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const tenPercent = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 10, server_errors: 0, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(noErrors)).toBeGreaterThan(computeHealthScore(tenPercent));
  });

  it('error rate of 0.9% (just under 1%) earns full error points (same as 0%)', () => {
    // < 1% → full 20 pts in both cases
    const noErrors = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    const underOnePercent = makeResult({
      // 0 errors on 100 URLs → 0% (we can't do fractional errors, so test with large URL count)
      // 9/1000 = 0.9%
      crawl_summary: { total_urls: 1000, indexable_urls: 950, client_errors: 0, server_errors: 0, avg_crawl_depth: 2 },
    });
    // Both have < 1% error rate → both earn full error points; scores may differ on other factors
    // Assert: underOnePercent earns full error points, so reducing errors further doesn't help
    const alsoUnder = makeResult({
      crawl_summary: { total_urls: 1000, indexable_urls: 950, client_errors: 9, server_errors: 0, avg_crawl_depth: 2 },
    });
    // 0/1000 = 0% and 9/1000 = 0.9% — both < 1% → both earn full error points → same score
    expect(computeHealthScore(underOnePercent)).toBe(computeHealthScore(alsoUnder));
  });

  it('error rate of 50% earns less than error rate of 10%', () => {
    // 50 errors on 100 URLs (50%) vs 10 errors (10%) — large gap survives rounding
    const tenPct = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 10, server_errors: 0, avg_crawl_depth: 2 },
    });
    const fiftyPct = makeResult({
      crawl_summary: { total_urls: 100, indexable_urls: 95, client_errors: 50, server_errors: 0, avg_crawl_depth: 2 },
    });
    expect(computeHealthScore(tenPct)).toBeGreaterThan(computeHealthScore(fiftyPct));
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
    expect(computeHealthScore(atBoundary)).toBe(computeHealthScore(above));
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
    expect(computeHealthScore(noSchema)).toBeLessThan(computeHealthScore(atBoundary));
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
    const score = computeHealthScore(result);
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
    expect(computeHealthScore(result)).toBe(0);
  });
});

// ── Score boundaries ──────────────────────────────────────────────────────────

describe('computeHealthScore — score boundaries', () => {
  it('never returns a score above 100', () => {
    const result = makeResult();
    expect(computeHealthScore(result)).toBeLessThanOrEqual(100);
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
    expect(computeHealthScore(result)).toBeGreaterThanOrEqual(0);
  });

  it('returns an integer (rounded)', () => {
    const result = makeResult();
    const score = computeHealthScore(result);
    expect(score).toBe(Math.round(score));
  });
});
