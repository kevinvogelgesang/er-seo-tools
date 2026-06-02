import { describe, it, expect } from 'vitest';
import { computeCompleteness } from './completeness';
import type { AggregatedResult, Issue, PageIndexEntry } from '@/lib/types';

function makeResult(opts: {
  pages?: number;
  critical?: Issue[];
  warnings?: Issue[];
  notices?: Issue[];
}): AggregatedResult {
  const page_index: PageIndexEntry[] = Array.from({ length: opts.pages ?? 0 }, (_, i) => ({
    ref: i, title: 't', h1: 'h', metaDescription: 'm',
    wordCount: 500, crawlDepth: 1, indexable: true, issueTypes: [],
  }));
  return {
    crawl_summary: {} as AggregatedResult['crawl_summary'],
    issues: { critical: opts.critical ?? [], warnings: opts.warnings ?? [], notices: opts.notices ?? [] },
    site_structure: {} as AggregatedResult['site_structure'],
    resources: {} as AggregatedResult['resources'],
    technical_seo: {} as AggregatedResult['technical_seo'],
    performance: {} as AggregatedResult['performance'],
    recommendations: [],
    metadata: { files_processed: [], parsers_used: [], total_parsers_available: 43 },
    page_index,
  } as AggregatedResult;
}

const withUrls = (type: string): Issue => ({
  type, severity: 'warning', count: 2, description: '', affectedUrlRefs: [0, 1],
});
const noUrls = (type: string): Issue => ({
  type, severity: 'warning', count: 2, description: '',
});

describe('computeCompleteness', () => {
  it('flags an empty page index as "thin" (no internal crawl) regardless of issue URLs', () => {
    const c = computeCompleteness(makeResult({ pages: 0, warnings: [withUrls('a'), withUrls('b')] }));
    expect(c.verdict).toBe('thin');
    expect(c.hasInternalCrawl).toBe(false);
    expect(c.pageIndexCount).toBe(0);
    expect(c.missingInputs.join(' ').toLowerCase()).toContain('internal');
    expect(c.message.length).toBeGreaterThan(0);
  });

  it('returns "complete" when the page index is populated and issues carry URLs', () => {
    const c = computeCompleteness(makeResult({ pages: 120, critical: [withUrls('a')], warnings: [withUrls('b')] }));
    expect(c.verdict).toBe('complete');
    expect(c.hasInternalCrawl).toBe(true);
    expect(c.message).toBe('');
    expect(c.missingInputs).toEqual([]);
  });

  it('returns "partial" when a crawl exists but most issues have no affected URLs', () => {
    const c = computeCompleteness(makeResult({
      pages: 100,
      warnings: [noUrls('a'), noUrls('b'), noUrls('c'), withUrls('d')],
    }));
    expect(c.verdict).toBe('partial');
    expect(c.hasInternalCrawl).toBe(true);
    expect(c.noUrlIssues).toBe(3);
    expect(c.noUrlIssueRatio).toBeCloseTo(0.75, 2);
  });

  it('counts an issue with an empty affectedUrlRefs array AND no urls as a no-URL issue', () => {
    const issue: Issue = { type: 'x', severity: 'notice', count: 1, description: '', affectedUrlRefs: [], urls: [] };
    const c = computeCompleteness(makeResult({ pages: 100, notices: [issue] }));
    expect(c.noUrlIssues).toBe(1);
  });

  it('treats an issue with sample urls (but no refs) as having URLs', () => {
    const issue: Issue = { type: 'x', severity: 'warning', count: 1, description: '', urls: ['https://x/a'] };
    const c = computeCompleteness(makeResult({ pages: 100, warnings: [issue] }));
    expect(c.noUrlIssues).toBe(0);
    expect(c.verdict).toBe('complete');
  });

  it('handles a result with no issues and a crawl as complete with zero ratio', () => {
    const c = computeCompleteness(makeResult({ pages: 50 }));
    expect(c.verdict).toBe('complete');
    expect(c.totalIssues).toBe(0);
    expect(c.noUrlIssueRatio).toBe(0);
  });
});
