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

describe('assignVerdicts (anchor-based)', () => {
  it('anchor with >= minClusterSize cluster members → pillar', () => {
    const records = [
      rec({ url: 'https://e.edu/programs/nursing', pageType: 'program', topicClusterId: 0 }),
      rec({ url: 'https://e.edu/blog/a', topicClusterId: 0, recommendedPillar: 'https://e.edu/programs/nursing' }),
      rec({ url: 'https://e.edu/blog/b', topicClusterId: 0, recommendedPillar: 'https://e.edu/programs/nursing' }),
      rec({ url: 'https://e.edu/blog/c', topicClusterId: 0, recommendedPillar: 'https://e.edu/programs/nursing' }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('pillar');
    expect(records[1].verdict).toBe('cluster');
    expect(records[1].recommendedPillar).toBe('https://e.edu/programs/nursing');
    expect(records[2].verdict).toBe('cluster');
    expect(records[3].verdict).toBe('cluster');
  });

  it('anchor with too few cluster members → unclear', () => {
    const records = [
      rec({ url: 'https://e.edu/programs/nursing', pageType: 'program', topicClusterId: 0 }),
      rec({ url: 'https://e.edu/blog/a', topicClusterId: 0, recommendedPillar: 'https://e.edu/programs/nursing' }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('unclear');
    // single cluster member with no catchall fallback → singleton handling
    expect(['leave-as-blog', 'cluster']).toContain(records[1].verdict);
  });

  it('catchall with >= minClusterSize members → all become cluster (no pillar)', () => {
    const records = [
      rec({ url: 'https://e.edu/blog/a', topicClusterId: -2 }),
      rec({ url: 'https://e.edu/blog/b', topicClusterId: -2 }),
      rec({ url: 'https://e.edu/blog/c', topicClusterId: -2 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    for (const r of records) {
      expect(r.verdict).toBe('cluster');
      expect(r.recommendedPillar).toBeNull();
    }
  });

  it('catchall below minClusterSize → singleton handling (leave-as-blog or prune)', () => {
    const records = [
      rec({ url: 'https://e.edu/blog/thin', topicClusterId: -2, wordCount: 80, gscClicks: 0, referringDomains: 0, inlinks: 0 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('prune');
  });

  it('catchall singleton with strong authority → leave-as-blog', () => {
    const records = [
      rec({ url: 'https://e.edu/blog/strong', topicClusterId: -2, gscClicks: 500, referringDomains: 12 }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('leave-as-blog');
  });

  it('out-of-scope page types (nav/home) get unclear', () => {
    const records = [
      rec({ url: 'a', pageType: 'nav' }),
      rec({ url: 'b', pageType: 'home' }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    for (const r of records) expect(r.verdict).toBe('unclear');
  });

  it('location anchor with cluster members → pillar', () => {
    const records = [
      rec({ url: 'https://e.edu/locations/austin', pageType: 'location', topicClusterId: 0 }),
      rec({ url: 'https://e.edu/blog/a', topicClusterId: 0, recommendedPillar: 'https://e.edu/locations/austin' }),
      rec({ url: 'https://e.edu/blog/b', topicClusterId: 0, recommendedPillar: 'https://e.edu/locations/austin' }),
      rec({ url: 'https://e.edu/blog/c', topicClusterId: 0, recommendedPillar: 'https://e.edu/locations/austin' }),
    ];
    assignVerdicts(records, DEFAULT_CONFIG);
    expect(records[0].verdict).toBe('pillar');
  });
});
