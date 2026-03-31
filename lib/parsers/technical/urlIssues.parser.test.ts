import { describe, it, expect } from 'vitest';
import { UrlIssuesParser } from './urlIssues.parser';

describe('UrlIssuesParser', () => {
  describe('matchesFile', () => {
    it('matches filenames containing url_', () => {
      expect(UrlIssuesParser.matchesFile('url_issues.csv')).toBe(true);
      expect(UrlIssuesParser.matchesFile('URL_export.csv')).toBe(true);
    });

    it('does not match unrelated filenames', () => {
      expect(UrlIssuesParser.matchesFile('response_codes.csv')).toBe(false);
      expect(UrlIssuesParser.matchesFile('directives.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const p = new UrlIssuesParser('');
      expect(p.parse()).toEqual({});
    });

    it('returns empty object for header-only CSV', () => {
      const p = new UrlIssuesParser('Address,Length\n');
      expect(p.parse()).toEqual({});
    });
  });

  describe('basic parse', () => {
    it('creates a url_issues issue with correct count', () => {
      const csv = `Address,Length
https://example.com/a-very-long-url-that-has-issues,80
https://example.com/page_with_underscore,40
https://example.com/PageWithUpperCase,30`;
      const p = new UrlIssuesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string; severity: string; count: number }>;
      expect(issues).toHaveLength(1);
      const issue = issues[0];
      expect(issue.type).toBe('url_issues');
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(3);
    });

    it('reports total_urls matching row count', () => {
      const csv = `Address,Length
https://example.com/page1,50
https://example.com/page2,60`;
      const p = new UrlIssuesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      expect(result.total_urls).toBe(2);
    });

    it('includes urls in the issue', () => {
      const csv = `Address,Length
https://example.com/problem-url,90`;
      const p = new UrlIssuesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string; urls?: string[] }>;
      const issue = issues.find(i => i.type === 'url_issues');
      expect(issue!.urls).toContain('https://example.com/problem-url');
    });
  });

  describe('stats — average URL length', () => {
    it('calculates avg_url_length when Length column is present', () => {
      const csv = `Address,Length
https://example.com/page1,60
https://example.com/page2,100
https://example.com/page3,80`;
      const p = new UrlIssuesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const stats = result.stats as Record<string, number> | undefined;
      expect(stats).toBeDefined();
      expect(stats!.avg_url_length).toBe(80);
    });

    it('returns undefined stats when Length column is absent', () => {
      const csv = `Address\nhttps://example.com/page1`;
      const p = new UrlIssuesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      expect(result.stats).toBeUndefined();
    });

    it('accepts "URL Length" as an alternative to "Length"', () => {
      const csv = `Address,URL Length
https://example.com/page1,70`;
      const p = new UrlIssuesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const stats = result.stats as Record<string, number> | undefined;
      expect(stats).toBeDefined();
      expect(stats!.avg_url_length).toBe(70);
    });

    it('accepts "Char Count" as an alternative column name', () => {
      const csv = `Address,Char Count
https://example.com/page1,55`;
      const p = new UrlIssuesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const stats = result.stats as Record<string, number> | undefined;
      expect(stats).toBeDefined();
      expect(stats!.avg_url_length).toBe(55);
    });

    it('rounds avg_url_length to nearest integer', () => {
      const csv = `Address,Length
https://example.com/page1,10
https://example.com/page2,11`;
      const p = new UrlIssuesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const stats = result.stats as Record<string, number>;
      // 10.5 rounded → 11
      expect(stats.avg_url_length).toBe(11);
    });
  });

  describe('URL column fallback', () => {
    it('accepts "URL" as the address column', () => {
      const csv = `URL,Length
https://example.com/page,50`;
      const p = new UrlIssuesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ urls?: string[] }>;
      expect(issues[0].urls).toContain('https://example.com/page');
    });
  });

  describe('URL cap', () => {
    it('caps URL list at 30 entries in the issue', () => {
      const header = 'Address,Length';
      const rows = Array.from({ length: 40 }, (_, i) =>
        `https://example.com/page${i},100`
      );
      const p = new UrlIssuesParser([header, ...rows].join('\n'));
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string; count: number; urls?: string[] }>;
      const issue = issues[0];
      expect(issue.count).toBe(40);
      expect(issue.urls!.length).toBeLessThanOrEqual(30);
    });
  });

  describe('single URL', () => {
    it('handles single-row CSV correctly', () => {
      const csv = `Address,Length\nhttps://example.com/only,75`;
      const p = new UrlIssuesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      expect(result.total_urls).toBe(1);
      const issues = result.issues as Array<{ count: number }>;
      expect(issues[0].count).toBe(1);
    });
  });
});
