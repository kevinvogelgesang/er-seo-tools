import { describe, it, expect } from 'vitest';
import { buildTechnicalAuditExport } from './claude-export-builder';
import type { AggregatedResult } from '@/lib/types';

const mockResult: AggregatedResult = {
  crawl_summary: { total_urls: 100, indexable_urls: 80, non_indexable_urls: 20 },
  issues: {
    critical: [
      {
        type: 'broken_internal_links',
        severity: 'critical',
        count: 5,
        description: '5 broken internal links',
        urls: ['https://example.com/broken-1', 'https://example.com/broken-2'],
      },
    ],
    warnings: [],
    notices: [],
  },
  site_structure: {
    crawl_depth_distribution: { 0: 1, 1: 20, 2: 79 },
    internal_link_distribution: { homepage: 100, about: 50 },
    hreflang_languages: { en: 100 },
    non_indexable_reasons: [{ Address: 'https://example.com/noindex', reason: 'noindex' }],
  },
  resources: { images: { total: 50, stats: { missing_alt: 10 } } },
  technical_seo: {
    canonicals: { total_pages: 100, missing_canonical: 5 },
  },
  performance: {
    core_web_vitals: { lcp: 2500, cls: 0.1 },
    server_response: { avg_ms: 300 },
    pagespeed_opportunities: [
      {
        opportunity: 'render-blocking-resources',
        urls_affected: 10,
        total_savings_ms: 500,
        average_savings_ms: 50,
        total_savings_size_bytes: 0,
      },
    ],
    gsc_top_pages: [
      { url: 'https://example.com/page1', clicks: 100, impressions: 1000, ctr_pct: 10, average_position: 5 },
      { url: 'https://example.com/page2', clicks: 50, impressions: 500, ctr_pct: 10, average_position: 8 },
    ],
    ga4_top_pages: [
      {
        url: 'https://example.com/page1',
        sessions: 200,
        views: 300,
        engaged_sessions: 150,
        bounce_rate_pct: 25,
        average_session_duration_seconds: 120,
      },
    ],
    ga4_traffic: { total_sessions: 200, avg_bounce_rate: 0.25 },
    search_console: { total_clicks: 150, total_impressions: 1500, avg_position: 6.5 },
  },
  duplicate_content: {
    exact_duplicates: [
      {
        address: 'https://example.com/a',
        duplicate_of: 'https://example.com/b',
        similarity_pct: 100,
        indexability: 'Indexable',
      },
    ],
    near_duplicates: [],
    duplicate_titles: [{ title: 'Home', affected_urls: ['https://example.com/', 'https://example.com/home'] }],
    duplicate_meta_descriptions: [],
    duplicate_h1s: [],
  },
  keyword_signals: {
    semrush_connected: true,
    gsc_connected: true,
    ga4_connected: true,
    total_ranking_keywords: 5000,
    keyword_cannibalization: [
      {
        keyword: 'seo tools',
        search_volume: 1000,
        intent: 'commercial',
        competing_urls: [{ url: 'https://example.com/tools', position: 3, estimated_traffic: 200 }],
      },
    ],
    optimization_gaps: [],
    quick_wins: [
      {
        keyword: 'seo checker',
        position: 15,
        search_volume: 500,
        intent: 'informational',
        url: 'https://example.com/tools',
      },
    ],
    top_pages_by_organic_traffic: [],
  },
  link_analysis: {
    total_internal_links: 500,
    nofollow_ratio_pct: 5,
    non_descriptive_anchor_pct: 10,
    top_linked_pages: [{ url: 'https://example.com/', inlink_count: 100 }],
    top_anchor_texts: [{ anchor_text: 'click here', count: 50, is_descriptive: false }],
  },
  recommendations: ['Fix broken links', 'Add missing alt text'],
  metadata: {
    files_processed: ['internal_all.csv'],
    parsers_used: ['InternalParser'],
    total_parsers_available: 40,
    health_score: 72,
  },
};

describe('buildTechnicalAuditExport', () => {
  it('excludes keyword_signals entirely', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result).not.toHaveProperty('keyword_signals');
  });

  it('excludes performance.gsc_top_pages', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance).not.toHaveProperty('gsc_top_pages');
  });

  it('excludes performance.ga4_top_pages', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance).not.toHaveProperty('ga4_top_pages');
  });

  it('excludes performance.ga4_traffic raw block', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance).not.toHaveProperty('ga4_traffic');
  });

  it('excludes performance.search_console raw block', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance).not.toHaveProperty('search_console');
  });

  it('replaces gsc_top_pages with gsc_summary derived from search_console stats', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance.gsc_summary).toEqual({
      total_clicks: 150,
      total_impressions: 1500,
      avg_position: 6.5,
    });
  });

  it('replaces ga4_top_pages with ga4_summary derived from ga4_traffic stats', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance.ga4_summary).toEqual({
      total_sessions: 200,
      avg_bounce_rate: 0.25,
    });
  });

  it('omits gsc_summary when no search_console stats present', () => {
    const noGsc = { ...mockResult, performance: { core_web_vitals: { lcp: 2500 } } };
    const result = buildTechnicalAuditExport(noGsc);
    expect(result.performance).not.toHaveProperty('gsc_summary');
  });

  it('omits ga4_summary when no ga4_traffic stats present', () => {
    const noGa4 = { ...mockResult, performance: { core_web_vitals: { lcp: 2500 } } };
    const result = buildTechnicalAuditExport(noGa4);
    expect(result.performance).not.toHaveProperty('ga4_summary');
  });

  it('excludes site_structure.internal_link_distribution', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.site_structure).not.toHaveProperty('internal_link_distribution');
  });

  it('preserves site_structure.crawl_depth_distribution', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.site_structure.crawl_depth_distribution).toEqual({ 0: 1, 1: 20, 2: 79 });
  });

  it('preserves site_structure.hreflang_languages', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.site_structure.hreflang_languages).toEqual({ en: 100 });
  });

  it('preserves site_structure.non_indexable_reasons', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.site_structure.non_indexable_reasons).toHaveLength(1);
  });

  it('excludes link_analysis.top_linked_pages', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.link_analysis).not.toHaveProperty('top_linked_pages');
  });

  it('excludes link_analysis.top_anchor_texts', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.link_analysis).not.toHaveProperty('top_anchor_texts');
  });

  it('preserves link_analysis scalar metrics', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.link_analysis?.total_internal_links).toBe(500);
    expect(result.link_analysis?.nofollow_ratio_pct).toBe(5);
    expect(result.link_analysis?.non_descriptive_anchor_pct).toBe(10);
  });

  it('preserves issues with full urls arrays', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.issues.critical[0].urls).toEqual([
      'https://example.com/broken-1',
      'https://example.com/broken-2',
    ]);
  });

  it('preserves duplicate_content unchanged', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.duplicate_content?.exact_duplicates).toHaveLength(1);
    expect(result.duplicate_content?.duplicate_titles[0].affected_urls).toHaveLength(2);
  });

  it('preserves crawl_summary unchanged', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.crawl_summary).toEqual(mockResult.crawl_summary);
  });

  it('preserves performance.pagespeed_opportunities', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance.pagespeed_opportunities).toHaveLength(1);
    expect(result.performance.pagespeed_opportunities![0].opportunity).toBe('render-blocking-resources');
  });

  it('preserves performance.core_web_vitals', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.performance.core_web_vitals).toEqual({ lcp: 2500, cls: 0.1 });
  });

  it('preserves recommendations unchanged', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.recommendations).toEqual(['Fix broken links', 'Add missing alt text']);
  });

  it('preserves metadata unchanged', () => {
    const result = buildTechnicalAuditExport(mockResult);
    expect(result.metadata).toEqual(mockResult.metadata);
  });

  it('handles result with no link_analysis', () => {
    const noLinks = { ...mockResult, link_analysis: undefined };
    const result = buildTechnicalAuditExport(noLinks);
    expect(result.link_analysis).toBeUndefined();
  });

  it('handles result with no duplicate_content', () => {
    const noDups = { ...mockResult, duplicate_content: undefined };
    const result = buildTechnicalAuditExport(noDups);
    expect(result.duplicate_content).toBeUndefined();
  });
});
