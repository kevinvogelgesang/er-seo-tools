import { describe, it, expect } from 'vitest';
import { ResponseCodesParser } from './responseCodes.parser';

describe('ResponseCodesParser', () => {
  describe('filenamePattern', () => {
    it('has the correct filenamePattern', () => {
      expect(ResponseCodesParser.filenamePattern).toEqual(['response_codes_all', 'response_codes']);
    });

    it('matchesFile returns true for matching filenames', () => {
      expect(ResponseCodesParser.matchesFile('response_codes.csv')).toBe(true);
      expect(ResponseCodesParser.matchesFile('internal_html_response_codes.csv')).toBe(true);
    });

    it('matches response_codes_all.csv', () => {
      expect(ResponseCodesParser.matchesFile('response_codes_all.csv')).toBe(true);
    });

    it('matchesFile returns false for non-matching filenames', () => {
      expect(ResponseCodesParser.matchesFile('page_titles.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new ResponseCodesParser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for header-only CSV', () => {
      const csv = `Address,Status Code\n`;
      const parser = new ResponseCodesParser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  describe('normal data', () => {
    const csv = `Address,Status Code
https://example.com/,200
https://example.com/about,200
https://example.com/services,200
https://example.com/old-page,301
https://example.com/moved,302
https://example.com/missing,404
https://example.com/gone,410
https://example.com/error,500`;

    it('returns correct total_urls count', () => {
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse();
      expect(result.total_urls).toBe(8);
    });

    it('builds correct distribution', () => {
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse() as any;
      expect(result.distribution['200']).toBe(3);
      expect(result.distribution['301']).toBe(1);
      expect(result.distribution['302']).toBe(1);
      expect(result.distribution['404']).toBe(1);
      expect(result.distribution['410']).toBe(1);
      expect(result.distribution['500']).toBe(1);
    });

    it('creates a client_errors_4xx issue', () => {
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'client_errors_4xx');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('critical');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/missing');
      expect(issue.urls).toContain('https://example.com/gone');
    });

    it('creates a server_errors_5xx issue', () => {
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'server_errors_5xx');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('critical');
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/error');
    });

    it('creates a redirects_3xx issue', () => {
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'redirects_3xx');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(2);
    });
  });

  describe('only 2xx responses', () => {
    const csv = `Address,Status Code
https://example.com/,200
https://example.com/page,200`;

    it('returns no issues for clean site', () => {
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse() as any;
      expect(result.issues).toHaveLength(0);
    });

    it('distribution contains only 200', () => {
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse() as any;
      expect(result.distribution['200']).toBe(2);
      expect(result.distribution['404']).toBeUndefined();
    });
  });

  describe('missing optional Status Code column', () => {
    it('returns total_urls but no issues when Status Code column is absent', () => {
      const csv = `Address\nhttps://example.com/\nhttps://example.com/page`;
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse() as any;
      expect(result.total_urls).toBe(2);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('alternative column names', () => {
    it('accepts "Status" as the status column', () => {
      const csv = `Address,Status
https://example.com/,404`;
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'client_errors_4xx');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(1);
    });

    it('accepts "URL" as the address column', () => {
      const csv = `URL,Status Code
https://example.com/broken,404`;
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'client_errors_4xx');
      expect(issue.urls).toContain('https://example.com/broken');
    });
  });

  describe('url cap on error lists', () => {
    it('caps client error URL list at 30 entries', () => {
      const rows = Array.from({ length: 40 }, (_, i) =>
        `https://example.com/page${i},404`
      ).join('\n');
      const csv = `Address,Status Code\n${rows}`;
      const parser = new ResponseCodesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'client_errors_4xx');
      expect(issue.count).toBe(40);
      expect(issue.urls.length).toBeLessThanOrEqual(30);
    });
  });
});
