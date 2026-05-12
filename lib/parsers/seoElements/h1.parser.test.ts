import { describe, it, expect } from 'vitest';
import { H1Parser } from './h1.parser';

describe('H1Parser', () => {
  describe('static properties', () => {
    it('has filenamePattern of "h1"', () => {
      expect(H1Parser.filenamePattern).toEqual(['h1_all', 'h1']);
    });

    it('matchesFile returns true for filenames containing "h1"', () => {
      expect(H1Parser.matchesFile('h1.csv')).toBe(true);
      expect(H1Parser.matchesFile('h1_headings.csv')).toBe(true);
      expect(H1Parser.matchesFile('H1.CSV')).toBe(true);
    });

    it('matches h1_all.csv', () => {
      expect(H1Parser.matchesFile('h1_all.csv')).toBe(true);
    });

    it('matchesFile returns false for unrelated filenames', () => {
      expect(H1Parser.matchesFile('images.csv')).toBe(false);
      expect(H1Parser.matchesFile('canonicals.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new H1Parser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for headers-only CSV', () => {
      const csv = `Address,H1-1,H1-2,Content Type,Indexability`;
      const parser = new H1Parser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  describe('missing H1', () => {
    it('detects pages missing H1 headings', () => {
      const csv = `Address,H1-1,Content Type,Indexability
https://example.com/page1,,text/html,Indexable
https://example.com/page2,Home Page,text/html,Indexable
https://example.com/page3,,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_h1');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/page1');
      expect(issue.urls).toContain('https://example.com/page3');
      expect(issue.urls).not.toContain('https://example.com/page2');
    });

    it('does not create missing_h1 issue when all pages have H1', () => {
      const csv = `Address,H1-1,Content Type,Indexability
https://example.com/page1,Welcome,text/html,Indexable
https://example.com/page2,About Us,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_h1');
      expect(issue).toBeUndefined();
    });

    it('skips missing_h1 check when H1-1 column is absent', () => {
      const csv = `Address,Content Type,Indexability
https://example.com/page1,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_h1');
      expect(issue).toBeUndefined();
    });
  });

  describe('duplicate H1s across pages', () => {
    it('detects duplicate H1 headings used on multiple pages', () => {
      const csv = `Address,H1-1,Content Type,Indexability
https://example.com/page1,Home Page,text/html,Indexable
https://example.com/page2,Home Page,text/html,Indexable
https://example.com/page3,About Us,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'duplicate_h1');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(1); // 1 group of duplicates
      expect(issue.groups).toHaveLength(1);
      expect(issue.groups[0].h1).toBe('Home Page');
      expect(issue.groups[0].count).toBe(2);
    });

    it('does not create duplicate_h1 issue when all H1s are unique', () => {
      const csv = `Address,H1-1,Content Type,Indexability
https://example.com/page1,Home Page,text/html,Indexable
https://example.com/page2,About Us,text/html,Indexable
https://example.com/page3,Contact,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'duplicate_h1');
      expect(issue).toBeUndefined();
    });

    it('reports top duplicate groups sorted by count descending', () => {
      const csv = `Address,H1-1,Content Type,Indexability
https://example.com/a,Duplicate A,text/html,Indexable
https://example.com/b,Duplicate A,text/html,Indexable
https://example.com/c,Duplicate B,text/html,Indexable
https://example.com/d,Duplicate B,text/html,Indexable
https://example.com/e,Duplicate B,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'duplicate_h1');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(2); // 2 groups
      // Should be sorted by count descending: B (3) then A (2)
      expect(issue.groups[0].h1).toBe('Duplicate B');
      expect(issue.groups[0].count).toBe(3);
      expect(issue.groups[1].h1).toBe('Duplicate A');
      expect(issue.groups[1].count).toBe(2);
    });

    it('counts all duplicate groups before applying the top-10 group cap', () => {
      const rows = Array.from({ length: 12 }, (_, i) => [
        `https://example.com/group-${i}-a,Duplicate H1 ${i},text/html,Indexable`,
        `https://example.com/group-${i}-b,Duplicate H1 ${i},text/html,Indexable`,
      ]).flat();
      const csv = `Address,H1-1,Content Type,Indexability\n${rows.join('\n')}`;
      const parser = new H1Parser(csv);
      const result = parser.parse();
      const issue = result.issues.find((i: { type: string }) => i.type === 'duplicate_h1');

      expect(issue?.count).toBe(12);
      expect(issue?.groups).toHaveLength(10);
    });

    it('does not count pages with missing H1 as duplicates', () => {
      const csv = `Address,H1-1,Content Type,Indexability
https://example.com/a,,text/html,Indexable
https://example.com/b,,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      const duplicateIssue = result.issues.find((i: { type: string }) => i.type === 'duplicate_h1');
      expect(duplicateIssue).toBeUndefined();
    });
  });

  describe('multiple H1s on the same page (H1-2 column)', () => {
    it('detects pages with multiple H1 headings via H1-2 column', () => {
      const csv = `Address,H1-1,H1-2,Content Type,Indexability
https://example.com/page1,First H1,Second H1,text/html,Indexable
https://example.com/page2,Only H1,,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'multiple_h1');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/page1');
      expect(issue.urls).not.toContain('https://example.com/page2');
    });

    it('does not create multiple_h1 issue when H1-2 column is absent', () => {
      const csv = `Address,H1-1,Content Type,Indexability
https://example.com/page1,Single H1,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'multiple_h1');
      expect(issue).toBeUndefined();
    });

    it('does not flag pages where H1-2 is empty', () => {
      const csv = `Address,H1-1,H1-2,Content Type,Indexability
https://example.com/page1,My H1,,text/html,Indexable
https://example.com/page2,Their H1, ,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'multiple_h1');
      expect(issue).toBeUndefined();
    });
  });

  describe('indexability filtering', () => {
    it('excludes non-indexable pages from H1 checks', () => {
      const csv = `Address,H1-1,Content Type,Indexability
https://example.com/indexable,,text/html,Indexable
https://example.com/noindex,,text/html,Non-Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      // Only the indexable page should be counted as missing H1
      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_h1');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/indexable');
      expect(issue.urls).not.toContain('https://example.com/noindex');
    });

    it('reports excluded_urls count', () => {
      const csv = `Address,H1-1,Content Type,Indexability
https://example.com/a,H1,text/html,Indexable
https://example.com/b,H1,text/html,Non-Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      expect(result.excluded_urls).toBe(1);
      expect(result.total_pages).toBe(1);
    });
  });

  describe('total_pages', () => {
    it('reports correct total_pages for indexable HTML pages', () => {
      const csv = `Address,H1-1,Content Type,Indexability
https://example.com/a,H1 A,text/html,Indexable
https://example.com/b,H1 B,text/html,Indexable
https://example.com/c,H1 C,text/html,Non-Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      expect(result.total_pages).toBe(2);
    });
  });

  describe('all issues together', () => {
    it('can report missing, duplicate, and multiple H1 issues simultaneously', () => {
      const csv = `Address,H1-1,H1-2,Content Type,Indexability
https://example.com/missing,,, text/html,Indexable
https://example.com/dup-a,Shared Title,,text/html,Indexable
https://example.com/dup-b,Shared Title,,text/html,Indexable
https://example.com/multi,My H1,Second H1,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      expect(result.issues.find((i: { type: string }) => i.type === 'missing_h1')).toBeDefined();
      expect(result.issues.find((i: { type: string }) => i.type === 'duplicate_h1')).toBeDefined();
      expect(result.issues.find((i: { type: string }) => i.type === 'multiple_h1')).toBeDefined();
    });

    it('returns no issues when all pages have valid unique single H1', () => {
      const csv = `Address,H1-1,H1-2,Content Type,Indexability
https://example.com/a,Page A Title,,text/html,Indexable
https://example.com/b,Page B Title,,text/html,Indexable`;

      const parser = new H1Parser(csv);
      const result = parser.parse();

      expect(result.issues).toHaveLength(0);
    });
  });
});
