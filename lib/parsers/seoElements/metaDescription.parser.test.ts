import { describe, it, expect } from 'vitest';
import { MetaDescriptionParser } from './metaDescription.parser';

describe('MetaDescriptionParser', () => {
  describe('filenamePattern', () => {
    it('has the correct filenamePattern', () => {
      expect(MetaDescriptionParser.filenamePattern).toBe('meta_description');
    });

    it('matchesFile returns true for matching filenames', () => {
      expect(MetaDescriptionParser.matchesFile('meta_description.csv')).toBe(true);
      expect(MetaDescriptionParser.matchesFile('seoElements_meta_description_all.csv')).toBe(true);
    });

    it('matchesFile returns false for non-matching filenames', () => {
      expect(MetaDescriptionParser.matchesFile('page_titles.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new MetaDescriptionParser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for header-only CSV', () => {
      const csv = `Address,Meta Description 1,Meta Description 1 Length\n`;
      const parser = new MetaDescriptionParser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  // Helper: build a CSV without Indexability/Content Type so all rows pass the SEO-relevant mask
  function makeCsv(rows: string[]): string {
    const header = 'Address,Meta Description 1,Meta Description 1 Length';
    return [header, ...rows].join('\n');
  }

  describe('missing meta descriptions', () => {
    it('reports pages with no meta description', () => {
      const csv = makeCsv([
        'https://example.com/,A good meta description that is long enough,100',
        'https://example.com/about,,0',
        'https://example.com/contact,,0',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'missing_meta_description');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/about');
      expect(issue.urls).toContain('https://example.com/contact');
    });

    it('does not report missing_meta_description when all pages have descriptions', () => {
      const csv = makeCsv([
        'https://example.com/,A good description here that is long enough for SEO purposes,100',
        'https://example.com/about,Another solid description that meets length requirements,95',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'missing_meta_description');
      expect(issue).toBeUndefined();
    });
  });

  describe('meta description length', () => {
    it('reports meta descriptions that are too short (< 70 chars, > 0)', () => {
      const csv = makeCsv([
        'https://example.com/short,Too short,30',
        'https://example.com/ok,This is a good meta description with enough characters to be good,80',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'meta_description_too_short');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/short');
      expect(issue.threshold).toContain('70');
    });

    it('reports meta descriptions that are too long (> 160 chars)', () => {
      const csv = makeCsv([
        'https://example.com/long,This is a very long meta description that goes way over the maximum recommended length of 160 characters and should be flagged by the parser as too long,170',
        'https://example.com/ok,This is a good meta description with enough characters to be valid,80',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'meta_description_too_long');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/long');
      expect(issue.threshold).toContain('160');
    });

    it('does not flag length=0 as too short (treated as missing)', () => {
      const csv = makeCsv([
        'https://example.com/missing,,0',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const shortIssue = result.issues.find((i: any) => i.type === 'meta_description_too_short');
      expect(shortIssue).toBeUndefined();
    });

    it('does not flag length exactly at boundaries', () => {
      const csv = makeCsv([
        'https://example.com/min,Exactly seventy characters description here with all the content there,70',
        'https://example.com/max,This is a meta description exactly 160 characters long and should not be flagged because it is right at the maximum limit of the acceptable range.,160',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'meta_description_too_short')).toBeUndefined();
      expect(result.issues.find((i: any) => i.type === 'meta_description_too_long')).toBeUndefined();
    });
  });

  describe('duplicate meta descriptions', () => {
    it('reports groups of duplicate meta descriptions', () => {
      const csv = makeCsv([
        'https://example.com/,Same description used on multiple pages,90',
        'https://example.com/about,Same description used on multiple pages,90',
        'https://example.com/contact,Unique description for contact page only,85',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'duplicate_meta_description');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(1);
    });

    it('does not report duplicates when all descriptions are unique', () => {
      const csv = makeCsv([
        'https://example.com/,First unique description for the homepage here,80',
        'https://example.com/about,Second unique description for the about page here,85',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'duplicate_meta_description');
      expect(issue).toBeUndefined();
    });

    it('counts multiple duplicate groups correctly', () => {
      const csv = makeCsv([
        'https://example.com/a,Shared description A used here,80',
        'https://example.com/b,Shared description A used here,80',
        'https://example.com/c,Shared description B used here,80',
        'https://example.com/d,Shared description B used here,80',
        'https://example.com/e,Unique description for this page only,85',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'duplicate_meta_description');
      expect(issue.count).toBe(2);
    });
  });

  describe('total_pages and excluded_urls', () => {
    it('reports correct total_pages count', () => {
      const csv = makeCsv([
        'https://example.com/,Good meta description that is well within the limits here,85',
        'https://example.com/about,Another good meta description for about page content,80',
        'https://example.com/contact,Contact page meta description with good length range,78',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      expect(result.total_pages).toBe(3);
      expect(result.excluded_urls).toBe(0);
    });
  });

  describe('boundary conditions', () => {
    // META_MIN_LENGTH = 70: condition is length < 70 → flagged; length >= 70 → not flagged
    it('does NOT flag a meta description of exactly 70 characters as too short', () => {
      const csv = makeCsv([
        'https://example.com/at-min,Exactly seventy characters meta description for the boundary test!!!!,70',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'meta_description_too_short');
      expect(issue).toBeUndefined();
    });

    it('DOES flag a meta description of exactly 69 characters (one under min) as too short', () => {
      const csv = makeCsv([
        'https://example.com/under-min,Sixty-nine character meta description for the boundary condition test,69',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'meta_description_too_short');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(1);
    });

    // META_MAX_LENGTH = 160: condition is length > 160 → flagged; length <= 160 → not flagged
    it('does NOT flag a meta description of exactly 160 characters as too long', () => {
      const csv = makeCsv([
        'https://example.com/at-max,A meta description that is precisely 160 characters long and sits exactly at the maximum allowed limit and should not be flagged at all.,160',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'meta_description_too_long');
      expect(issue).toBeUndefined();
    });

    it('DOES flag a meta description of exactly 161 characters (one over max) as too long', () => {
      const csv = makeCsv([
        'https://example.com/over-max,A meta description that is precisely 161 characters long and sits exactly one character over the maximum allowed limit and should be flagged.,161',
      ]);
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'meta_description_too_long');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(1);
    });
  });

  describe('missing optional columns', () => {
    it('skips length checks gracefully if length column is absent', () => {
      const csv = `Address,Meta Description 1
https://example.com/,Short
https://example.com/about,`;
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      // Should not throw; length issues won't appear
      expect(result.issues.find((i: any) => i.type === 'meta_description_too_short')).toBeUndefined();
      expect(result.issues.find((i: any) => i.type === 'meta_description_too_long')).toBeUndefined();
    });

    it('skips missing/duplicate checks gracefully if meta column is absent', () => {
      const csv = `Address,Meta Description 1 Length
https://example.com/,50
https://example.com/about,170`;
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'missing_meta_description')).toBeUndefined();
      expect(result.issues.find((i: any) => i.type === 'duplicate_meta_description')).toBeUndefined();
    });
  });

  describe('indexable HTML masking', () => {
    it('excludes non-indexable pages from counts', () => {
      const csv = `Address,Content Type,Indexability,Meta Description 1,Meta Description 1 Length
https://example.com/,text/html,Indexable,Good description here that is long enough to pass,80
https://example.com/noindex,text/html,Non-Indexable,,0
https://example.com/css,text/css,Indexable,,0`;
      const parser = new MetaDescriptionParser(csv);
      const result = parser.parse() as any;
      // Only the indexable HTML page counts
      expect(result.total_pages).toBe(1);
      const issue = result.issues.find((i: any) => i.type === 'missing_meta_description');
      expect(issue).toBeUndefined();
    });
  });
});
