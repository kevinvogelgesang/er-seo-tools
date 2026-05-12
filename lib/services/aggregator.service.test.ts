import { describe, it, expect } from 'vitest';
import { AggregatorService } from './aggregator.service';

describe('AggregatorService URL deduplication', () => {
  it('stores all URLs without slicing when count exceeds 50', () => {
    const aggregator = new AggregatorService();
    const urls = Array.from({ length: 100 }, (_, i) => `https://example.com/page-${i}`);
    aggregator.addParserResult('test', {
      issues: [{
        type: 'test_issue',
        severity: 'warning',
        count: 100,
        description: 'test issue',
        urls,
      }],
    }, 'test.csv');
    const result = aggregator.aggregate();
    const allIssues = [
      ...result.issues.critical,
      ...result.issues.warnings,
      ...result.issues.notices,
    ];
    const issue = allIssues.find(i => i.type === 'test_issue');
    expect(issue).toBeDefined();
    expect(issue!.urls?.length).toBe(100);
    expect((issue as Record<string, unknown>).truncated).toBeUndefined();
    expect((issue as Record<string, unknown>).total_affected).toBeUndefined();
  });

  it('deduplicates URLs when the same issue type is added twice', () => {
    const aggregator = new AggregatorService();
    aggregator.addParserResult('test', {
      issues: [{
        type: 'dupe_issue',
        severity: 'warning',
        count: 3,
        description: 'first batch',
        urls: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
      }],
    }, 'test.csv');
    aggregator.addParserResult('test2', {
      issues: [{
        type: 'dupe_issue',
        severity: 'warning',
        count: 2,
        description: 'second batch',
        urls: ['https://example.com/b', 'https://example.com/d'],
      }],
    }, 'test2.csv');
    const result = aggregator.aggregate();
    const allIssues = [
      ...result.issues.critical,
      ...result.issues.warnings,
      ...result.issues.notices,
    ];
    const issue = allIssues.find(i => i.type === 'dupe_issue');
    expect(issue!.urls?.length).toBe(4);
  });
});

describe('AggregatorService duplicate content totals', () => {
  it('preserves duplicate group counts separately from capped group samples', () => {
    const aggregator = new AggregatorService();
    aggregator.addParserResult('pagetitles', {
      issues: [{
        type: 'duplicate_title',
        severity: 'warning',
        count: 12,
        description: '12 duplicate title groups',
        groups: Array.from({ length: 10 }, (_, i) => ({
          title: `Shared title ${i}`,
          count: 2,
          urls: [`https://example.com/${i}-a`, `https://example.com/${i}-b`],
        })),
      }],
    }, 'page_titles_all.csv');

    const result = aggregator.aggregate();

    expect(result.duplicate_content?.duplicate_titles_count).toBe(12);
    expect(result.duplicate_content?.duplicate_titles).toHaveLength(10);
    expect(result.duplicate_content?.duplicate_titles[0].count).toBe(2);
  });
});
