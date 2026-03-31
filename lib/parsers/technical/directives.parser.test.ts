import { describe, it, expect } from 'vitest';
import { DirectivesParser } from './directives.parser';

describe('DirectivesParser', () => {
  describe('matchesFile', () => {
    it('matches filenames containing directives', () => {
      expect(DirectivesParser.matchesFile('directives.csv')).toBe(true);
      expect(DirectivesParser.matchesFile('DIRECTIVES_export.csv')).toBe(true);
    });

    it('does not match unrelated filenames', () => {
      expect(DirectivesParser.matchesFile('response_codes.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const p = new DirectivesParser('');
      expect(p.parse()).toEqual({});
    });

    it('returns empty object for header-only CSV', () => {
      const p = new DirectivesParser('Address,Meta Robots 1,X-Robots-Tag 1\n');
      expect(p.parse()).toEqual({});
    });
  });

  describe('noindex via Meta Robots', () => {
    it('detects pages with noindex in Meta Robots 1', () => {
      const csv = `Address,Meta Robots 1,X-Robots-Tag 1
https://example.com/page1,noindex,,
https://example.com/page2,index,,`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string; count: number; urls?: string[] }>;
      const noindexIssue = issues.find(i => i.type === 'noindex_pages');
      expect(noindexIssue).toBeDefined();
      expect(noindexIssue!.count).toBe(1);
      expect(noindexIssue!.urls).toContain('https://example.com/page1');
    });

    it('detects pages with noindex,nofollow combined directive', () => {
      const csv = `Address,Meta Robots 1
https://example.com/page1,"noindex, nofollow"
https://example.com/page2,"index, follow"`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string; count: number }>;
      const noindexIssue = issues.find(i => i.type === 'noindex_pages');
      expect(noindexIssue!.count).toBe(1);
    });

    it('is case-insensitive for noindex value', () => {
      const csv = `Address,Meta Robots 1
https://example.com/page1,NOINDEX`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string; count: number }>;
      const noindexIssue = issues.find(i => i.type === 'noindex_pages');
      expect(noindexIssue).toBeDefined();
      expect(noindexIssue!.count).toBe(1);
    });
  });

  describe('noindex via X-Robots-Tag', () => {
    it('detects noindex from X-Robots-Tag 1 column', () => {
      const csv = `Address,Meta Robots 1,X-Robots-Tag 1
https://example.com/page1,,noindex
https://example.com/page2,,`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string; count: number }>;
      const noindexIssue = issues.find(i => i.type === 'noindex_pages');
      expect(noindexIssue).toBeDefined();
      expect(noindexIssue!.count).toBe(1);
    });

    it('deduplicates pages with noindex in both Meta Robots and X-Robots', () => {
      const csv = `Address,Meta Robots 1,X-Robots-Tag 1
https://example.com/page1,noindex,noindex`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string; count: number }>;
      const noindexIssue = issues.find(i => i.type === 'noindex_pages');
      // Should count once, not twice
      expect(noindexIssue!.count).toBe(1);
    });
  });

  describe('nofollow via Meta Robots', () => {
    it('detects pages with nofollow directive', () => {
      const csv = `Address,Meta Robots 1
https://example.com/page1,nofollow
https://example.com/page2,index, follow`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string; count: number }>;
      const nofollowIssue = issues.find(i => i.type === 'nofollow_pages');
      expect(nofollowIssue).toBeDefined();
      expect(nofollowIssue!.count).toBe(1);
    });
  });

  describe('pages without directives', () => {
    it('returns no issues when all pages are index, follow', () => {
      const csv = `Address,Meta Robots 1,X-Robots-Tag 1
https://example.com/page1,index, follow,
https://example.com/page2,index,,`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<unknown>;
      expect(issues).toHaveLength(0);
    });
  });

  describe('stats', () => {
    it('returns noindex_count and nofollow_count in stats', () => {
      // Use quoted CSV value to avoid papaparse splitting "noindex, nofollow" on the comma
      const csv = `Address,Meta Robots 1
https://example.com/page1,noindex
https://example.com/page2,nofollow
https://example.com/page3,"noindex, nofollow"`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const stats = result.stats as Record<string, number>;
      expect(stats.noindex_count).toBe(2);
      expect(stats.nofollow_count).toBe(2);
    });

    it('returns zero stats when no directives present', () => {
      const csv = `Address,Meta Robots 1
https://example.com/,index, follow`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const stats = result.stats as Record<string, number>;
      expect(stats.noindex_count).toBe(0);
      expect(stats.nofollow_count).toBe(0);
    });
  });

  describe('total_pages', () => {
    it('reports correct total_pages count', () => {
      const csv = `Address,Meta Robots 1
https://example.com/,index, follow
https://example.com/about,noindex`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      expect(result.total_pages).toBe(2);
    });
  });

  describe('URL cap', () => {
    it('caps noindex URL list at 30 entries', () => {
      const header = 'Address,Meta Robots 1';
      const rows = Array.from({ length: 40 }, (_, i) =>
        `https://example.com/page${i},noindex`
      );
      const p = new DirectivesParser([header, ...rows].join('\n'));
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string; count: number; urls?: string[] }>;
      const noindexIssue = issues.find(i => i.type === 'noindex_pages');
      expect(noindexIssue!.count).toBe(40);
      expect(noindexIssue!.urls!.length).toBeLessThanOrEqual(30);
    });
  });

  describe('alternative column names', () => {
    it('accepts "Meta Robots" (without number) as the meta robots column', () => {
      const csv = `Address,Meta Robots
https://example.com/page1,noindex`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string }>;
      expect(issues.find(i => i.type === 'noindex_pages')).toBeDefined();
    });

    it('accepts "X-Robots-Tag" (without number) as the x-robots column', () => {
      const csv = `Address,X-Robots-Tag
https://example.com/page1,noindex`;
      const p = new DirectivesParser(csv);
      const result = p.parse() as Record<string, unknown>;
      const issues = result.issues as Array<{ type: string }>;
      expect(issues.find(i => i.type === 'noindex_pages')).toBeDefined();
    });
  });
});
