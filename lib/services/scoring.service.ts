import { AggregatedResult } from '../types';
import type { ScoreBreakdownFactor, ScoreResult, ScoringWeights } from '../scoring/weights';
import { WEIGHT_LABELS } from '../scoring/weights';

/**
 * Clamp a value between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute an SEO health score from 0–100 based on weighted factors.
 * If data is unavailable for a factor, or its weight is 0, that factor is
 * skipped and the remaining weights are normalized to still sum to 100.
 * Returns both the score and the per-factor breakdown that produced it.
 */
export function computeHealthScore(result: AggregatedResult, weights: ScoringWeights): ScoreResult {
  const summary = result.crawl_summary;
  const totalUrls = summary.total_urls ?? 0;
  const indexableUrls = summary.indexable_urls ?? 0;

  // We accumulate (earned points, max possible points) for each factor.
  let earned = 0;
  let possible = 0;
  const factors: ScoreBreakdownFactor[] = [];

  const addFactor = (key: keyof ScoringWeights, pts: number): void => {
    const weight = weights[key];
    const e = clamp(pts, 0, weight);
    earned += e;
    possible += weight;
    factors.push({ key, label: WEIGHT_LABELS[key], weight, earned: e, possible: weight });
  };

  // ── 1. Indexability ratio ────────────────────────────────────────────────
  if (totalUrls > 0 && summary.indexable_urls !== undefined && weights.indexability > 0) {
    const ratio = indexableUrls / totalUrls;
    // Full pts if >= 95%, linear scale down to 0 at 0%
    const pts = ratio >= 0.95 ? weights.indexability : (ratio / 0.95) * weights.indexability;
    addFactor('indexability', pts);
  }

  // ── 2. Error rate ────────────────────────────────────────────────────────
  if (
    totalUrls > 0 &&
    summary.client_errors !== undefined &&
    summary.server_errors !== undefined &&
    weights.errorRate > 0
  ) {
    const errors = (summary.client_errors ?? 0) + (summary.server_errors ?? 0);
    const errorRate = errors / totalUrls;
    // Full points if < 1% errors; linear to 0 at 100% errors
    const pts = errorRate < 0.01 ? weights.errorRate : Math.max(0, weights.errorRate - (errorRate / 1.0) * weights.errorRate);
    addFactor('errorRate', pts);
  }

  // ── 3. Missing critical SEO elements ─────────────────────────────────────
  // The SEO elements data lives inside the parsed internal data that the
  // aggregator builds into issues; we can reconstruct counts from issues.
  const allIssues = [
    ...result.issues.critical,
    ...result.issues.warnings,
    ...result.issues.notices,
  ];

  const missingTitleIssue = allIssues.find((i) => i.type === 'missing_title');
  const missingMetaIssue = allIssues.find((i) => i.type === 'missing_meta_description');
  const missingH1Issue = allIssues.find((i) => i.type === 'missing_h1');

  // Base for % calculations: use indexable urls if available, else total_urls
  const base = indexableUrls > 0 ? indexableUrls : totalUrls;

  if (base > 0) {
    // Missing titles
    if (weights.missingTitle > 0) {
      const count = missingTitleIssue?.count ?? 0;
      const pct = count / base;
      const pts = pct === 0 ? weights.missingTitle : Math.max(0, weights.missingTitle - pct * weights.missingTitle);
      addFactor('missingTitle', pts);
    }

    // Missing meta
    if (weights.missingMeta > 0) {
      const count = missingMetaIssue?.count ?? 0;
      const pct = count / base;
      const pts = pct === 0 ? weights.missingMeta : Math.max(0, weights.missingMeta - pct * weights.missingMeta);
      addFactor('missingMeta', pts);
    }

    // Missing H1
    if (weights.missingH1 > 0) {
      const count = missingH1Issue?.count ?? 0;
      const pct = count / base;
      const pts = pct === 0 ? weights.missingH1 : Math.max(0, weights.missingH1 - pct * weights.missingH1);
      addFactor('missingH1', pts);
    }
  }

  // ── 4. Crawl depth efficiency ────────────────────────────────────────────
  // Full pts if avg_crawl_depth <= 3.0, zero if >= 6.0, linear between
  if (summary.avg_crawl_depth !== undefined && weights.crawlDepth > 0) {
    const depth = summary.avg_crawl_depth;
    let pts: number;
    if (depth <= 3.0) {
      pts = weights.crawlDepth;
    } else if (depth >= 6.0) {
      pts = 0;
    } else {
      pts = weights.crawlDepth * (1 - (depth - 3.0) / 3.0);
    }
    addFactor('crawlDepth', pts);
  }

  // ── 5. Thin content ratio ────────────────────────────────────────────────
  // Full pts if thin_content / indexable < 5%, zero if > 40%
  const thinIssue = allIssues.find((i) => i.type === 'thin_content');
  if (thinIssue !== undefined && indexableUrls > 0 && weights.thinContent > 0) {
    const thinCount = thinIssue.count ?? 0;
    const ratio = thinCount / indexableUrls;
    let pts: number;
    if (ratio < 0.05) {
      pts = weights.thinContent;
    } else if (ratio > 0.40) {
      pts = 0;
    } else {
      pts = weights.thinContent * (1 - (ratio - 0.05) / 0.35);
    }
    addFactor('thinContent', pts);
  }

  // ── 6. Schema coverage ────────────────────────────────────────────────────
  // Full pts if pages_with_schema / total_urls > 30%
  const structuredData = result.technical_seo?.structured_data;
  if (structuredData !== undefined && totalUrls > 0 && weights.schema > 0) {
    const pagesWithSchema = structuredData.pages_with_schema ?? 0;
    const ratio = pagesWithSchema / totalUrls;
    const pts = ratio >= 0.30 ? weights.schema : (ratio / 0.30) * weights.schema;
    addFactor('schema', pts);
  }

  // ── Normalize and return ─────────────────────────────────────────────────
  const score = possible === 0 ? 0 : clamp(Math.round((earned / possible) * 100), 0, 100);
  return { score, factors };
}
