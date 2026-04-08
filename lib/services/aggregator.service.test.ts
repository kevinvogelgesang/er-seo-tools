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
