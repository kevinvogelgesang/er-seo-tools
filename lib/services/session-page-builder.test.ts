import { describe, it, expect } from 'vitest';
import { buildSessionPages } from './session-page-builder';
import type { AggregatedResult } from '@/lib/types';

function makeResult(): AggregatedResult {
  return {
    crawl_summary: { total_urls: 2 } as AggregatedResult['crawl_summary'],
    issues: {
      critical: [{ type: 'missing_title', severity: 'critical', count: 1, description: '' }],
      warnings: [{ type: 'thin_content', severity: 'warning', count: 1, description: '' }],
      notices: [],
    },
    site_structure: {} as AggregatedResult['site_structure'],
    resources: {} as AggregatedResult['resources'],
    technical_seo: {} as AggregatedResult['technical_seo'],
    performance: {} as AggregatedResult['performance'],
    recommendations: [],
    metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0, site_name: 'x.edu' },
    url_registry: {
      sessionOrigin: { scheme: 'https', host: 'x.edu' },
      hosts: ['x.edu'],
      urls: [
        { id: 0, kind: 'page', scheme: 'https', hostId: 0, path: '/a' },
        { id: 1, kind: 'page', scheme: 'https', hostId: 0, path: '/b' },
      ],
    },
    page_index: [
      { ref: 0, title: null, h1: 'A', metaDescription: 'm', wordCount: 100, crawlDepth: 0, indexable: true, issueTypes: ['missing_title'] },
      { ref: 1, title: 'B', h1: 'B', metaDescription: 'm', wordCount: 50, crawlDepth: 1, indexable: true, issueTypes: ['thin_content'] },
    ],
  } as AggregatedResult;
}

describe('buildSessionPages', () => {
  it('builds one row per page with rehydrated url, issueTypes and issueCount', () => {
    const { pages } = buildSessionPages('sess1', makeResult());
    expect(pages).toHaveLength(2);
    const a = pages.find(p => p.url === 'https://x.edu/a')!;
    expect(a.sessionId).toBe('sess1');
    expect(a.issueCount).toBe(1);
    expect(JSON.parse(a.issueTypes)).toEqual(['missing_title']);
    expect(a.title).toBeNull();
  });
  it('computes scalars from crawl summary + issue counts', () => {
    const { scalars } = buildSessionPages('sess1', makeResult());
    expect(scalars).toEqual({ siteHost: 'x.edu', totalUrls: 2, criticalCount: 1, warningCount: 1, noticeCount: 0 });
  });
  it('returns empty pages + scalars when no page_index/url_registry (no internal_all uploaded)', () => {
    const r = makeResult(); delete (r as Record<string, unknown>).page_index; delete (r as Record<string, unknown>).url_registry;
    const { pages, scalars } = buildSessionPages('s', r);
    expect(pages).toEqual([]);
    expect(scalars.totalUrls).toBe(2);
    expect(scalars.criticalCount).toBe(1);
  });
});
