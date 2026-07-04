// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { LinksIssuesParser } from './links.parser';
import { parseString } from '../test-parse-helper';

const CSV = [
  'Address,Crawl Depth',
  'https://ex.com/a,1',
  'https://ex.com/b,3',
  'https://ex.com/c,2',
].join('\n');

describe('LinksIssuesParser golden', () => {
  it('collects all urls + max crawl depth', () => {
    expect(parseString(LinksIssuesParser, CSV)).toEqual({
      total_pages: 3,
      stats: { max_crawl_depth: 3 },
      issues: [
        {
          type: 'links_quality_issue',
          severity: 'warning',
          count: 3,
          description: '3 page(s) with link quality issues',
          urls: ['https://ex.com/a', 'https://ex.com/b', 'https://ex.com/c'],
        },
      ],
    });
  });

  it('empty input → {}', () => {
    expect(parseString(LinksIssuesParser, 'Address,Crawl Depth')).toEqual({});
  });
});
