// lib/services/pillarAnalysis/verdict.ts
import type { UrlRecord } from './types';
import type { PillarConfig } from './config';

const SCOPE_PAGE_TYPES = new Set(['blog', 'news', 'resource']);
const STRONG_AUTHORITY_GSC = 100;
const STRONG_AUTHORITY_RD = 5;

export function assignVerdicts(records: UrlRecord[], cfg: PillarConfig): void {
  // 1. Out-of-scope page types: stay 'unclear'
  for (const r of records) {
    if (!SCOPE_PAGE_TYPES.has(r.pageType)) {
      r.verdict = 'unclear';
      r.verdictConfidence = 1.0;
      r.reasoning = [`pageType=${r.pageType} (out of scope for pillar conversion)`];
    }
  }

  // 2. Group by cluster
  const byCluster = new Map<number, UrlRecord[]>();
  for (const r of records) {
    if (!SCOPE_PAGE_TYPES.has(r.pageType)) continue;
    const k = r.topicClusterId ?? -1;
    const arr = byCluster.get(k) ?? [];
    arr.push(r);
    byCluster.set(k, arr);
  }

  for (const [clusterId, members] of byCluster.entries()) {
    if (clusterId === -1) {
      // Singletons → leave-as-blog or prune
      for (const r of members) classifySingleton(r, cfg);
      continue;
    }

    // Filter informational members for pillar selection
    const informational = members.filter((m) => m.intentClass === 'informational');
    const commercials = members.filter((m) => m.intentClass !== 'informational');

    // Commercial members in a cluster → leave-as-blog
    for (const r of commercials) {
      r.verdict = 'leave-as-blog';
      r.verdictConfidence = 0.8;
      r.reasoning = ['intent is non-informational; would not fit cluster model'];
    }

    if (informational.length < cfg.minClusterSize) {
      // Cluster too small after filtering → all become singletons
      for (const r of informational) classifySingleton(r, cfg);
      continue;
    }

    // Pick pillar: highest authority composite rank
    const pillar = pickPillar(informational);
    pillar.verdict = 'pillar';
    pillar.verdictConfidence = 0.8;
    pillar.reasoning = [
      `cluster size ${informational.length}`,
      `highest authority composite (inlinks=${pillar.inlinks ?? 0}, gscClicks=${pillar.gscClicks ?? 0}, referringDomains=${pillar.referringDomains ?? 0})`,
    ];

    for (const r of informational) {
      if (r === pillar) continue;
      r.verdict = 'cluster';
      r.verdictConfidence = 0.75;
      r.recommendedPillar = pillar.url;
      r.reasoning = [`cluster member of "${pillar.url}"`];
    }
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
    r.reasoning = ['singleton (no cluster) with no near-duplicate'];
  }
}

function pickPillar(members: UrlRecord[]): UrlRecord {
  // Rank within cluster on each signal (1 = highest); missing signals contribute 0.
  const rankedSum = members.map((m, i) => ({ idx: i, score: 0, m }));
  for (const field of ['inlinks', 'gscClicks', 'referringDomains'] as const) {
    const present = members.filter((m) => m[field] != null);
    if (present.length === 0) continue;
    // Sort descending; position determines rank-score
    const sorted = [...members].sort((a, b) => (b[field] ?? -1) - (a[field] ?? -1));
    sorted.forEach((m, rank) => {
      if (m[field] == null) return;
      const score = present.length - rank; // higher = better
      const target = rankedSum.find((x) => x.m === m)!;
      target.score += score;
    });
  }
  // Tiebreak on word count
  rankedSum.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.m.wordCount ?? 0) - (a.m.wordCount ?? 0);
  });
  return rankedSum[0].m;
}
