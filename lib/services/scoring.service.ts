import { AggregatedResult } from '../types';

/**
 * Clamp a value between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Compute an SEO health score from 0–100 based on weighted factors.
 * If data is unavailable for a factor, that factor is skipped and the
 * remaining weights are normalized to still sum to 100.
 */
export function computeHealthScore(result: AggregatedResult): number {
  const summary = result.crawl_summary;
  const totalUrls = summary.total_urls ?? 0;
  const indexableUrls = summary.indexable_urls ?? 0;

  // We accumulate (earned points, max possible points) for each factor.
  let earned = 0;
  let possible = 0;

  // ── 1. Indexability ratio (20 pts) ──────────────────────────────────────────
  if (totalUrls > 0 && summary.indexable_urls !== undefined) {
    const ratio = indexableUrls / totalUrls;
    // Full 20 pts if >= 95%, linear scale down to 0 at 0%
    const pts = ratio >= 0.95 ? 20 : (ratio / 0.95) * 20;
    earned += clamp(pts, 0, 20);
    possible += 20;
  }

  // ── 2. Error rate (20 pts) ───────────────────────────────────────────────────
  if (
    totalUrls > 0 &&
    summary.client_errors !== undefined &&
    summary.server_errors !== undefined
  ) {
    const errors = (summary.client_errors ?? 0) + (summary.server_errors ?? 0);
    const errorRate = errors / totalUrls;
    // Full points if < 1% errors; linear to 0 at 100% errors
    const pts = errorRate < 0.01 ? 20 : Math.max(0, 20 - (errorRate / 1.0) * 20);
    earned += clamp(pts, 0, 20);
    possible += 20;
  }

  // ── 3. Missing critical SEO elements (25 pts total) ─────────────────────────
  //    Missing titles: 10 pts
  //    Missing meta:    8 pts
  //    Missing H1:      7 pts
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
    // Missing titles (10 pts)
    {
      const count = missingTitleIssue?.count ?? 0;
      const pct = count / base;
      const pts = pct === 0 ? 10 : Math.max(0, 10 - pct * 10);
      earned += clamp(pts, 0, 10);
      possible += 10;
    }

    // Missing meta (8 pts)
    {
      const count = missingMetaIssue?.count ?? 0;
      const pct = count / base;
      const pts = pct === 0 ? 8 : Math.max(0, 8 - pct * 8);
      earned += clamp(pts, 0, 8);
      possible += 8;
    }

    // Missing H1 (7 pts)
    {
      const count = missingH1Issue?.count ?? 0;
      const pct = count / base;
      const pts = pct === 0 ? 7 : Math.max(0, 7 - pct * 7);
      earned += clamp(pts, 0, 7);
      possible += 7;
    }
  }

  // ── 4. Crawl depth efficiency (15 pts) ──────────────────────────────────────
  // Full pts if avg_crawl_depth <= 3.0, zero if >= 6.0, linear between
  if (summary.avg_crawl_depth !== undefined) {
    const depth = summary.avg_crawl_depth;
    let pts: number;
    if (depth <= 3.0) {
      pts = 15;
    } else if (depth >= 6.0) {
      pts = 0;
    } else {
      pts = 15 * (1 - (depth - 3.0) / 3.0);
    }
    earned += clamp(pts, 0, 15);
    possible += 15;
  }

  // ── 5. Thin content ratio (10 pts) ──────────────────────────────────────────
  // Full pts if thin_content / indexable < 5%, zero if > 40%
  const thinIssue = allIssues.find((i) => i.type === 'thin_content');
  if (thinIssue !== undefined && indexableUrls > 0) {
    const thinCount = thinIssue.count ?? 0;
    const ratio = thinCount / indexableUrls;
    let pts: number;
    if (ratio < 0.05) {
      pts = 10;
    } else if (ratio > 0.40) {
      pts = 0;
    } else {
      pts = 10 * (1 - (ratio - 0.05) / 0.35);
    }
    earned += clamp(pts, 0, 10);
    possible += 10;
  }

  // ── 6. Schema coverage (10 pts) ─────────────────────────────────────────────
  // Full pts if pages_with_schema / total_urls > 30%
  const structuredData = result.technical_seo?.structured_data;
  if (structuredData !== undefined && totalUrls > 0) {
    const pagesWithSchema = structuredData.pages_with_schema ?? 0;
    const ratio = pagesWithSchema / totalUrls;
    const pts = ratio >= 0.30 ? 10 : (ratio / 0.30) * 10;
    earned += clamp(pts, 0, 10);
    possible += 10;
  }

  // ── Normalize and return ─────────────────────────────────────────────────────
  if (possible === 0) return 0;

  const raw = (earned / possible) * 100;
  return clamp(Math.round(raw), 0, 100);
}
