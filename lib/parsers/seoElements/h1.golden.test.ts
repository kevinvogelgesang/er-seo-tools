// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { H1Parser } from './h1.parser';

const CSV = [
  'Address,H1-1,H1-2',
  'https://ex.com/a,Unique Heading,',
  'https://ex.com/b,,',                 // missing
  'https://ex.com/c,Dupe H1,',          // dup
  'https://ex.com/d,Dupe H1,Second H1', // dup + multiple
].join('\n');

describe('H1Parser golden', () => {
  it('produces exact current output', () => {
    const out = new H1Parser(CSV).parse();
    expect(out).toEqual({
      total_pages: 4,
      excluded_urls: 0,
      issues: [
        {
          type: 'missing_h1',
          severity: 'warning',
          count: 1,
          description: '1 pages missing H1 headings',
          urls: ['https://ex.com/b'],
        },
        {
          type: 'duplicate_h1',
          severity: 'notice',
          count: 1,
          description: '1 groups of pages with duplicate H1 headings',
          groups: [
            {
              h1: 'Dupe H1',
              count: 2,
              urls: ['https://ex.com/c', 'https://ex.com/d'],
            },
          ],
        },
        {
          type: 'multiple_h1',
          severity: 'warning',
          count: 1,
          description: '1 pages with multiple H1 headings',
          urls: ['https://ex.com/d'],
        },
      ],
    });
  });
});
