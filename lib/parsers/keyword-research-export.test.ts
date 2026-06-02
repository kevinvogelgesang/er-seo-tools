import { describe, it, expect } from 'vitest';
import { buildKeywordResearchExport } from './keyword-research-export';
import type { AggregatedResult } from '@/lib/types';

const mockResult: AggregatedResult = {
  crawl_summary: { total_urls: 120, indexable_urls: 95 },
  issues: { critical: [], warnings: [], notices: [] },
  site_structure: {},
  resources: {},
  technical_seo: {},
  performance: {},
  metadata: {
    files_processed: ['internal_all.csv', 'keyword_gap.csv'],
    parsers_used: ['InternalParser', 'SemrushKeywordGapParser'],
    total_parsers_available: 40,
    site_name: 'Example Site',
    health_score: 80,
  },
  keyword_signals: {
    semrush_connected: true,
    gsc_connected: true,
    ga4_connected: false,
    total_ranking_keywords: 3200,
    keyword_cannibalization: [
      {
        keyword: 'enrollment software',
        search_volume: 800,
        intent: 'commercial',
        competing_urls: [{ url: 'https://example.com/software', position: 4, estimated_traffic: 120 }],
      },
    ],
    optimization_gaps: [],
    quick_wins: [
      {
        keyword: 'enrollment management',
        position: 12,
        search_volume: 1200,
        intent: 'informational',
        url: 'https://example.com/management',
      },
    ],
    top_pages_by_organic_traffic: [],
    gap_keywords: [
      { keyword: 'student enrollment system', volume: 500, difficulty: 35, intent: 'commercial' },
      { keyword: 'college enrollment software', volume: 300, difficulty: 42, intent: 'commercial' },
    ],
  },
  duplicate_content: {
    exact_duplicates: [],
    near_duplicates: [],
    duplicate_titles: [
      { title: 'Enrollment Software', affected_urls: ['https://example.com/a', 'https://example.com/b'] },
    ],
    duplicate_meta_descriptions: [],
    duplicate_h1s: [],
  },
  recommendations: ['Fix duplicate titles'],
};

describe('buildKeywordResearchExport', () => {
  it('carries keyword_signals including gap_keywords', () => {
    const result = buildKeywordResearchExport(mockResult);
    expect(result.keyword_signals).toBeDefined();
    expect(result.keyword_signals?.gap_keywords).toHaveLength(2);
    expect(result.keyword_signals?.gap_keywords?.[0].keyword).toBe('student enrollment system');
  });

  it('carries duplicate_titles for cannibalization context', () => {
    const result = buildKeywordResearchExport(mockResult);
    expect(result.duplicate_titles).toBeDefined();
    expect(result.duplicate_titles).toHaveLength(1);
    expect(result.duplicate_titles?.[0].title).toBe('Enrollment Software');
  });

  it('carries crawl_summary with total_urls and indexable_urls', () => {
    const result = buildKeywordResearchExport(mockResult);
    expect(result.crawl_summary.total_urls).toBe(120);
    expect(result.crawl_summary.indexable_urls).toBe(95);
  });

  it('carries site_name from metadata', () => {
    const result = buildKeywordResearchExport(mockResult);
    expect(result.site_name).toBe('Example Site');
  });

  it('does NOT carry issues', () => {
    const result = buildKeywordResearchExport(mockResult);
    expect(result).not.toHaveProperty('issues');
  });

  it('does NOT carry resources', () => {
    const result = buildKeywordResearchExport(mockResult);
    expect(result).not.toHaveProperty('resources');
  });

  it('does NOT carry technical_seo', () => {
    const result = buildKeywordResearchExport(mockResult);
    expect(result).not.toHaveProperty('technical_seo');
  });

  it('does NOT carry page_index', () => {
    const result = buildKeywordResearchExport(mockResult);
    expect(result).not.toHaveProperty('page_index');
  });

  it('handles missing keyword_signals gracefully', () => {
    const noSignals = { ...mockResult, keyword_signals: undefined };
    const result = buildKeywordResearchExport(noSignals);
    expect(result.keyword_signals).toBeUndefined();
  });

  it('handles missing duplicate_content gracefully', () => {
    const noDups = { ...mockResult, duplicate_content: undefined };
    const result = buildKeywordResearchExport(noDups);
    expect(result.duplicate_titles).toBeUndefined();
  });

  it('handles missing indexable_urls in crawl_summary', () => {
    const noIndexable = { ...mockResult, crawl_summary: { total_urls: 50 } };
    const result = buildKeywordResearchExport(noIndexable);
    expect(result.crawl_summary.total_urls).toBe(50);
    expect(result.crawl_summary.indexable_urls).toBeUndefined();
  });
});
