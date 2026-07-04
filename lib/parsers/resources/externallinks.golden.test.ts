// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ExternalLinksParser } from './links.parser';
import { parseString } from '../test-parse-helper';

const CSV = [
  'Destination,Status Code',
  'https://ok.com/a,200',
  'https://dead.com/x,404',
  'https://dead.com/y,500',
  'https://ok.com/b,301',
].join('\n');

describe('ExternalLinksParser golden', () => {
  it('broken (4xx/5xx) counted + collected in file order', () => {
    expect(parseString(ExternalLinksParser, CSV)).toEqual({
      total_external_links: 4,
      stats: { broken_external_links: 2 },
      issues: [
        {
          type: 'broken_external_links',
          severity: 'warning',
          count: 2,
          description: '2 broken external links',
          urls: ['https://dead.com/x', 'https://dead.com/y'],
        },
      ],
    });
  });

  it('empty input → {}', () => {
    expect(parseString(ExternalLinksParser, 'Destination,Status Code')).toEqual({});
  });
});
