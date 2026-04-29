import { describe, it, expect } from 'vitest';
import { decideHubFormat } from './hubDecision';
import { DEFAULT_CONFIG } from './config';
import type { UrlRecord } from './types';

function urlRec(p: Partial<UrlRecord>): UrlRecord {
  return {
    url: 'https://e.edu/x', pageType: 'blog', pageTypeConfidence: 0.85,
    title: null, h1: null, metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 3, outlinks: 5, indexable: true,
    gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: 0, verdict: 'excluded', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
    ...p,
  };
}

describe('decideHubFormat', () => {
  it('mostly vertical clusters + program pages have informational impressions → nest under programs', () => {
    const records: UrlRecord[] = [
      urlRec({ pageType: 'program', topicClusterId: null, gscImpressions: 500 }),
      urlRec({ topicClusterId: 0, gscImpressions: 100 }),
      urlRec({ topicClusterId: 0, gscImpressions: 100 }),
      urlRec({ topicClusterId: 0, gscImpressions: 100 }),
    ];
    const verticality = new Map([[0, 0.8]]);
    const r = decideHubFormat(records, verticality, DEFAULT_CONFIG);
    expect(r.primary).toBe('nest-under-programs');
  });

  it('career-guides keyword pattern in cluster names → fresh-career-guides-hub', () => {
    const records: UrlRecord[] = [
      urlRec({ topicClusterId: 0, title: 'How to Become an RN', h1: 'How to Become an RN' }),
      urlRec({ topicClusterId: 0, title: 'Salary for Nurses', h1: 'Nursing Salary' }),
      urlRec({ topicClusterId: 0, title: 'Career Paths in Nursing', h1: 'Nursing Careers' }),
    ];
    const verticality = new Map([[0, 0.3]]);
    const r = decideHubFormat(records, verticality, DEFAULT_CONFIG);
    expect(r.primary).toBe('fresh-career-guides-hub');
  });

  it('returns alternates with score deltas', () => {
    const records: UrlRecord[] = [
      urlRec({ topicClusterId: 0 }),
      urlRec({ topicClusterId: 0 }),
      urlRec({ topicClusterId: 0 }),
    ];
    const verticality = new Map([[0, 0.5]]);
    const r = decideHubFormat(records, verticality, DEFAULT_CONFIG);
    expect(r.alternates.length).toBeGreaterThanOrEqual(1);
    for (const a of r.alternates) {
      expect(typeof a.scoreDelta).toBe('number');
    }
  });
});
