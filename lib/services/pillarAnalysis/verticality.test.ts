import { describe, it, expect } from 'vitest';
import { computeClusterVerticality } from './verticality';
import type { UrlRecord } from './types';

function rec(p: Partial<UrlRecord>): UrlRecord {
  return {
    url: 'https://e.edu/x', pageType: 'blog', pageTypeConfidence: 0.85,
    title: null, h1: null, metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 3, outlinks: 5, indexable: true,
    gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: null, verdict: 'unclear', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
    ...p,
  };
}

describe('computeClusterVerticality', () => {
  it('cluster centroid close to a program centroid → high verticality', () => {
    const records = [
      rec({ url: 'p', pageType: 'program', topicClusterId: null }),
      rec({ url: 'a', topicClusterId: 0 }),
      rec({ url: 'b', topicClusterId: 0 }),
    ];
    const vectors = new Map([
      ['p', [1, 0, 0]],
      ['a', [1, 0, 0]],
      ['b', [1, 0, 0]],
    ]);
    const m = computeClusterVerticality(records, vectors);
    expect(m.get(0)).toBeCloseTo(1.0, 5);
  });

  it('cluster orthogonal to all programs → 0 verticality', () => {
    const records = [
      rec({ url: 'p', pageType: 'program' }),
      rec({ url: 'a', topicClusterId: 0 }),
      rec({ url: 'b', topicClusterId: 0 }),
    ];
    const vectors = new Map([
      ['p', [1, 0]],
      ['a', [0, 1]],
      ['b', [0, 1]],
    ]);
    expect(computeClusterVerticality(records, vectors).get(0)).toBeCloseTo(0, 5);
  });

  it('returns empty map when no clusters or no programs', () => {
    expect(computeClusterVerticality([], new Map()).size).toBe(0);
  });
});
