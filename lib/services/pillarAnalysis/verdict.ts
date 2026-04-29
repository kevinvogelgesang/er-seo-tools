// lib/services/pillarAnalysis/verdict.ts
import type { UrlRecord } from './types';
import type { PillarConfig } from './config';

const ANCHOR_PAGE_TYPES = new Set(['program', 'location']);
const SCOPE_PAGE_TYPES = new Set(['blog', 'news', 'resource']);
const STRONG_AUTHORITY_GSC = 100;
const STRONG_AUTHORITY_RD = 5;

/**
 * Anchor-based verdict assignment.
 *
 *  1. Anchor pages (program/location): if >= minClusterSize in-scope pages list this
 *     anchor as their `recommendedPillar`, the anchor is `pillar`. Otherwise `unclear`
 *     (anchor exists, no current cluster forming under it).
 *  2. In-scope pages (blog/news/resource) with `recommendedPillar` set
 *     (clusterId points to an anchor): `cluster`.
 *  3. In-scope pages in catchall (clusterId === -2): if catchall has >= minClusterSize
 *     members, all → `cluster` (with recommendedPillar=null, hub will own them).
 *     Otherwise per-page singleton handling: `leave-as-blog` / `prune`.
 *  4. Out-of-scope (nav, home, unknown): `unclear`.
 */
export function assignVerdicts(records: UrlRecord[], cfg: PillarConfig): void {
  // 4. Out-of-scope page types → 'unclear' (initial pass; anchors handled below)
  for (const r of records) {
    if (!ANCHOR_PAGE_TYPES.has(r.pageType) && !SCOPE_PAGE_TYPES.has(r.pageType)) {
      r.verdict = 'unclear';
      r.verdictConfidence = 1.0;
      r.reasoning = [`pageType=${r.pageType} (out of scope for pillar conversion)`];
    }
  }

  // Count cluster members for each anchor (by URL == recommendedPillar)
  const anchorMemberCount = new Map<string, number>();
  for (const r of records) {
    if (!SCOPE_PAGE_TYPES.has(r.pageType)) continue;
    if (!r.recommendedPillar) continue;
    anchorMemberCount.set(r.recommendedPillar, (anchorMemberCount.get(r.recommendedPillar) ?? 0) + 1);
  }

  // 1. Anchors: pillar if cluster size meets threshold
  for (const r of records) {
    if (!ANCHOR_PAGE_TYPES.has(r.pageType)) continue;
    const count = anchorMemberCount.get(r.url) ?? 0;
    if (count >= cfg.minClusterSize) {
      r.verdict = 'pillar';
      r.verdictConfidence = 0.85;
      r.reasoning = [
        `anchor ${r.pageType} page with ${count} cluster members`,
      ];
    } else {
      r.verdict = 'unclear';
      r.verdictConfidence = 0.7;
      r.reasoning = [
        `anchor ${r.pageType} page; ${count} cluster member(s) below minClusterSize=${cfg.minClusterSize}`,
      ];
    }
  }

  // Group in-scope pages by clusterId for catchall handling
  const catchallMembers: UrlRecord[] = [];
  for (const r of records) {
    if (!SCOPE_PAGE_TYPES.has(r.pageType)) continue;
    if (r.topicClusterId === -2) {
      catchallMembers.push(r);
      continue;
    }
    if (r.recommendedPillar) {
      // 2. Cluster member of an anchor
      // Non-informational intent? Still cluster (we're not filtering by intent in anchor model).
      r.verdict = 'cluster';
      r.verdictConfidence = 0.75;
      r.reasoning = [`cluster member of anchor "${r.recommendedPillar}"`];
    } else {
      // No anchor and not catchall (unusual, but possible if topicClusterId is null) → singleton
      classifySingleton(r, cfg);
    }
  }

  // 3. Catchall handling
  if (catchallMembers.length >= cfg.minClusterSize) {
    for (const r of catchallMembers) {
      r.verdict = 'cluster';
      r.verdictConfidence = 0.6;
      r.recommendedPillar = null;
      r.reasoning = [
        `catchall cluster (${catchallMembers.length} members) — pillar TBD via hub recommendation`,
      ];
    }
  } else {
    for (const r of catchallMembers) classifySingleton(r, cfg);
  }
}

function classifySingleton(r: UrlRecord, cfg: PillarConfig): void {
  const wc = r.wordCount ?? 0;
  const clicks = r.gscClicks ?? 0;
  const rd = r.referringDomains ?? 0;
  const inlinks = r.inlinks ?? 0;

  // Prune: very thin OR (zero traffic AND zero links)
  if (wc < cfg.pruneMaxWords || (clicks === 0 && rd === 0 && inlinks === 0 && wc < cfg.thinContentMaxWords)) {
    r.verdict = 'prune';
    r.verdictConfidence = 0.7;
    r.reasoning = [`thin (wordCount=${wc}) and no signals (clicks=${clicks}, rd=${rd}, inlinks=${inlinks})`];
    return;
  }

  // Default singleton → leave-as-blog
  r.verdict = 'leave-as-blog';
  if (clicks >= STRONG_AUTHORITY_GSC || rd >= STRONG_AUTHORITY_RD) {
    r.verdictConfidence = 0.85;
    r.reasoning = [`singleton with standalone authority (clicks=${clicks}, rd=${rd})`];
  } else {
    r.verdictConfidence = 0.6;
    r.reasoning = ['singleton (no anchor match) below catchall threshold'];
  }
}
