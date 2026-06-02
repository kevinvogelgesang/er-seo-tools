import { describe, it, expect } from 'vitest';
import { AggregatorService } from './aggregator.service';

describe('optimization_gaps title/h1 join', () => {
  it('populates title/h1 from the internal per_url_index', () => {
    const agg = new AggregatorService();
    agg.addParserResult('internal', { per_url_index: [
      { url: 'https://x.edu/p', title: 'P Title', h1: 'P H1', metaDescription: null, wordCount: 100, crawlDepth: 1, indexable: true },
    ] }, 'internal_all.csv');
    agg.addParserResult('semrushorganicpositions', {
      total_ranking_keywords: 1,
      per_url_keyword_data: [{ url: 'https://x.edu/p', keywords: [{ keyword: 'k', position: 12, search_volume: 500 }] }],
    }, 'positions.csv');
    const result = agg.aggregate();
    const gap = result.keyword_signals?.optimization_gaps?.find(g => g.url === 'https://x.edu/p');
    expect(gap?.title).toBe('P Title');
    expect(gap?.h1).toBe('P H1');
  });
});
