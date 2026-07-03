// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { H2Parser } from './h2.parser';

const CSV = [
  'Address,H2-1',
  'https://ex.com/a,Some H2',
  'https://ex.com/b,',   // missing
].join('\n');

describe('H2Parser golden', () => {
  it('produces exact current output (missing-only)', () => {
    const out = new H2Parser(CSV).parse();
    expect(out).toEqual({
      total_pages: 2,
      excluded_urls: 0,
      issues: [
        {
          type: 'missing_h2',
          severity: 'notice',
          count: 1,
          description: '1 pages missing H2 headings',
          urls: ['https://ex.com/b'],
        },
      ],
    });
  });
  it('returns {} on empty CSV', () => {
    expect(new H2Parser('Address,H2-1').parse()).toEqual({});
  });
});
