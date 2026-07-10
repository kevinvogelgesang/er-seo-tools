import { AggregatedResult } from '../types';
import type { ScoreBreakdownFactor, ScoreResult, ScoringWeights } from '../scoring/weights';
import { WEIGHT_LABELS } from '../scoring/weights';
import {
  indexabilityPoints, errorRatePoints, missingElementPoints, crawlDepthPoints,
  thinContentPoints, schemaPoints, type SfInputsSnapshot,
} from '../scoring/seo-core';

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
 * Curve shapes/knees live in the shared core (lib/scoring/seo-core.ts) —
 * this adapter only decides factor AVAILABILITY (unchanged since v1) and
 * derives the ratios/counts those curves are fed.
 * Returns the score, the per-factor breakdown, and a snapshot of the raw
 * inputs actually used (for persistence/re-scoring — additive, v2).
 */
export function computeHealthScore(
  result: AggregatedResult,
  weights: ScoringWeights,
): ScoreResult & { inputsSnapshot: SfInputsSnapshot } {
  const summary = result.crawl_summary;
  const totalUrls = summary.total_urls ?? 0;
  const indexableUrls = summary.indexable_urls ?? 0;
  const clientErrors = summary.client_errors ?? 0;
  const serverErrors = summary.server_errors ?? 0;

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
    addFactor('indexability', indexabilityPoints(ratio, weights.indexability));
  }

  // ── 2. Error rate ────────────────────────────────────────────────────────
  if (
    totalUrls > 0 &&
    summary.client_errors !== undefined &&
    summary.server_errors !== undefined &&
    weights.errorRate > 0
  ) {
    const errors = clientErrors + serverErrors;
    const errorRate = errors / totalUrls;
    addFactor('errorRate', errorRatePoints(errorRate, weights.errorRate));
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
      const pct = (missingTitleIssue?.count ?? 0) / base;
      addFactor('missingTitle', missingElementPoints(pct, weights.missingTitle));
    }

    // Missing meta
    if (weights.missingMeta > 0) {
      const pct = (missingMetaIssue?.count ?? 0) / base;
      addFactor('missingMeta', missingElementPoints(pct, weights.missingMeta));
    }

    // Missing H1
    if (weights.missingH1 > 0) {
      const pct = (missingH1Issue?.count ?? 0) / base;
      addFactor('missingH1', missingElementPoints(pct, weights.missingH1));
    }
  }

  // ── 4. Crawl depth efficiency ────────────────────────────────────────────
  if (summary.avg_crawl_depth !== undefined && weights.crawlDepth > 0) {
    addFactor('crawlDepth', crawlDepthPoints(summary.avg_crawl_depth, weights.crawlDepth));
  }

  // ── 5. Thin content ratio ────────────────────────────────────────────────
  const thinIssue = allIssues.find((i) => i.type === 'thin_content');
  if (thinIssue !== undefined && indexableUrls > 0 && weights.thinContent > 0) {
    const ratio = (thinIssue.count ?? 0) / indexableUrls;
    addFactor('thinContent', thinContentPoints(ratio, weights.thinContent));
  }

  // ── 6. Schema coverage ────────────────────────────────────────────────────
  const structuredData = result.technical_seo?.structured_data;
  if (structuredData !== undefined && totalUrls > 0 && weights.schema > 0) {
    const ratio = (structuredData.pages_with_schema ?? 0) / totalUrls;
    addFactor('schema', schemaPoints(ratio, weights.schema));
  }

  // ── Inputs snapshot (raw values actually derived above) ──────────────────
  // Nullable fields are null exactly when the underlying data was absent
  // from the blob (not merely when a factor's weight was 0) — this is a
  // record of what COULD be recomputed, independent of today's weight profile.
  const inputsSnapshot: SfInputsSnapshot = {
    source: 'sf',
    totalUrls,
    indexableUrls,
    clientErrors,
    serverErrors,
    base,
    missingTitle: missingTitleIssue?.count ?? 0,
    missingMeta: missingMetaIssue?.count ?? 0,
    missingH1: missingH1Issue?.count ?? 0,
    avgCrawlDepth: summary.avg_crawl_depth ?? null,
    thinCount: thinIssue !== undefined ? (thinIssue.count ?? 0) : null,
    pagesWithSchema: structuredData !== undefined ? (structuredData.pages_with_schema ?? 0) : null,
    indexableKnown: summary.indexable_urls !== undefined,
    errorsKnown: summary.client_errors !== undefined && summary.server_errors !== undefined,
  };

  // ── Normalize and return ─────────────────────────────────────────────────
  const score = possible === 0 ? 0 : clamp(Math.round((earned / possible) * 100), 0, 100);
  return { score, factors, inputsSnapshot };
}
