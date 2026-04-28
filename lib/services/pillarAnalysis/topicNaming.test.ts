import { describe, it, expect } from 'vitest';
import { nameClusters } from './topicNaming';
import type { UrlRecord } from './types';

function rec(title: string, h1: string, clusterId: number): UrlRecord {
  return {
    url: 'https://e.edu/' + title.toLowerCase().replace(/\W+/g, '-'),
    pageType: 'blog', pageTypeConfidence: 0.85,
    title, h1, metaDescription: null, firstParagraph: null,
    wordCount: 1000, crawlDepth: 3, inlinks: 3, outlinks: 5, indexable: true,
    gscClicks: null, gscImpressions: null, gscCtr: null, gscPosition: null,
    ga4Sessions: null, ga4EngagementRate: null, ga4KeyEvents: null,
    referringDomains: null, organicKeywords: null,
    intentClass: 'informational', intentConfidence: 0.8,
    topicClusterId: clusterId, verdict: 'unclear', verdictConfidence: 0,
    recommendedPillar: null, reasoning: [],
  };
}

describe('nameClusters', () => {
  it('picks top-frequency content terms as the cluster name', () => {
    const recs = [
      rec('Practical Nursing Career Paths', 'Nursing Careers', 0),
      rec('Practical Nursing Salary Guide', 'Nursing Salary', 0),
      rec('Practical Nursing Certification', 'Nursing Certification', 0),
    ];
    const names = nameClusters(recs);
    expect(names.get(0)).toMatch(/nursing/i);
  });

  it('skips stopwords and very short tokens', () => {
    const recs = [
      rec('The Best of It', 'A Guide', 0),
      rec('How to Do It Better', 'Better', 0),
      rec('Doing It With Style', 'Style', 0),
    ];
    const names = nameClusters(recs);
    const name = names.get(0)!;
    expect(name).not.toMatch(/^(the|of|a|to|in|with)$/i);
  });

  it('returns empty map for no clusters', () => {
    expect(nameClusters([]).size).toBe(0);
  });
});
