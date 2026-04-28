import { describe, it, expect } from 'vitest';
import { assignVerdicts } from './verdict';
import type { UrlRecord } from './types';
import { DEFAULT_CONFIG } from './config';

function rec(partial: Partial<UrlRecord>): UrlRecord {
  return {
    url: 'https://e.edu/x',
    pageType: 'blog',
    pageTypeConfidence: 0.85,
    title: null, h1: null, metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 2, outlinks: 5, indexable: true,
    gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: null, verdict: 'unclear', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
    ...partial,
  };
}

describe('assignVerdicts', () => {
  it('cluster of 3+ → highest authority composite gets pillar, others cluster', () => {
    const records = [
      rec({ url: 'a', topicClusterId: 0, inlinks: 10, gscClicks: 50, referringDomains: 5 }),
      rec({ url: 'b', topicClusterId: 0, inlinks: 3, gscClicks: 5, referringDomains: 1 }),
      rec({ url: 'c', topicClusterId: 0, inlinks: 1, gscClicks: 0, referringDomains: 0 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('pillar');
    expect(records[1].verdict).toBe('cluster');
    expect(records[2].verdict).toBe('cluster');
  });

  it('singleton informational with no traffic → leave-as-blog', () => {
    const records = [
      rec({ url: 'a', topicClusterId: -1, gscClicks: null, referringDomains: null }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('leave-as-blog');
  });

  it('thin content with zero traffic + zero links → prune', () => {
    const records = [
      rec({ url: 'a', topicClusterId: -1, wordCount: 80, gscClicks: 0, referringDomains: 0, inlinks: 0 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('prune');
  });

  it('commercial-intent in a cluster → leave-as-blog (does not fit cluster model)', () => {
    const records = [
      rec({ url: 'a', topicClusterId: 0, intentClass: 'commercial', inlinks: 5 }),
      rec({ url: 'b', topicClusterId: 0, inlinks: 4 }),
      rec({ url: 'c', topicClusterId: 0, inlinks: 3 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('leave-as-blog');
  });

  it('singleton with strong authority → leave-as-blog', () => {
    const records = [
      rec({ url: 'a', topicClusterId: -1, gscClicks: 500, referringDomains: 12 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('leave-as-blog');
  });

  it('non-blog/news/resource URLs receive unclear verdict (out of scope)', () => {
    const records = [
      rec({ url: 'a', pageType: 'program' }),
      rec({ url: 'b', pageType: 'nav' }),
      rec({ url: 'c', pageType: 'home' }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    for (const r of records) expect(r.verdict).toBe('unclear');
  });
});
