import { describe, it, expect } from 'vitest';
import { assignToAnchors } from './anchorClustering';
import type { UrlRecord } from './types';

function rec(url: string, pageType: UrlRecord['pageType']): UrlRecord {
  return {
    url, pageType, pageTypeConfidence: 0.85,
    title: null, h1: null, metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 3, outlinks: 5, indexable: true,
    gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: null, verdict: 'excluded', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
  };
}

describe('assignToAnchors', () => {
  it('blog assigned to closest anchor above threshold', () => {
    const records = [
      rec('https://e.edu/programs/cosmetology', 'program'),
      rec('https://e.edu/programs/nursing', 'program'),
      rec('https://e.edu/blog/cosmetology-tips', 'blog'),
    ];
    const vectors = new Map([
      ['https://e.edu/programs/cosmetology', [1, 0]],
      ['https://e.edu/programs/nursing', [0, 1]],
      ['https://e.edu/blog/cosmetology-tips', [0.95, 0.31]], // close to cosmetology
    ]);
    const result = assignToAnchors(records, vectors, 0.55);
    expect(result[2].clusterId).toBe(0); // anchor index of cosmetology program
    expect(result[2].pillarUrl).toBe('https://e.edu/programs/cosmetology');
  });

  it('blog below threshold → catchall (-2)', () => {
    const records = [
      rec('https://e.edu/programs/cosmetology', 'program'),
      rec('https://e.edu/blog/random', 'blog'),
    ];
    const vectors = new Map([
      ['https://e.edu/programs/cosmetology', [1, 0]],
      ['https://e.edu/blog/random', [0, 1]], // orthogonal → cosine 0
    ]);
    const result = assignToAnchors(records, vectors, 0.55);
    expect(result[1].clusterId).toBe(-2); // catchall
    expect(result[1].pillarUrl).toBeNull();
  });

  it('anchor records get their own index as clusterId', () => {
    const records = [
      rec('https://e.edu/programs/cosmetology', 'program'),
      rec('https://e.edu/locations/austin', 'location'),
    ];
    const vectors = new Map([
      ['https://e.edu/programs/cosmetology', [1, 0]],
      ['https://e.edu/locations/austin', [0, 1]],
    ]);
    const result = assignToAnchors(records, vectors, 0.55);
    expect(result[0].clusterId).toBe(0);
    expect(result[1].clusterId).toBe(1);
  });

  it('out-of-scope page types get clusterId -1', () => {
    const records = [
      rec('https://e.edu/about', 'nav'),
      rec('https://e.edu/', 'home'),
    ];
    const result = assignToAnchors(records, new Map(), 0.55);
    expect(result[0].clusterId).toBe(-1);
    expect(result[1].clusterId).toBe(-1);
  });
});
