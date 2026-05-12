import { describe, it, expect } from 'vitest';
import { PageTitlesParser } from './pageTitles.parser';

describe('PageTitlesParser', () => {
  describe('filenamePattern', () => {
    it('has the correct filenamePattern', () => {
      expect(PageTitlesParser.filenamePattern).toEqual(['page_titles_all', 'page_titles']);
    });

    it('matchesFile returns true for matching filenames', () => {
      expect(PageTitlesParser.matchesFile('page_titles.csv')).toBe(true);
      expect(PageTitlesParser.matchesFile('seoElements_page_titles_all.csv')).toBe(true);
    });

    it('matchesFile returns false for non-matching filenames', () => {
      expect(PageTitlesParser.matchesFile('meta_description.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new PageTitlesParser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for header-only CSV', () => {
      const csv = `Address,Title 1,Title 1 Length\n`;
      const parser = new PageTitlesParser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  // Helper: build CSV without Indexability/Content Type columns so all rows pass mask
  function makeCsv(rows: string[]): string {
    const header = 'Address,Title 1,Title 1 Length';
    return [header, ...rows].join('\n');
  }

  describe('missing titles', () => {
    it('reports pages missing title tags', () => {
      const csv = makeCsv([
        'https://example.com/,Good Home Page Title For SEO,28',
        'https://example.com/about,,0',
        'https://example.com/contact,,0',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'missing_title');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('critical');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/about');
      expect(issue.urls).toContain('https://example.com/contact');
    });

    it('does not report missing_title when all pages have titles', () => {
      const csv = makeCsv([
        'https://example.com/,Homepage Title That Is Good Enough,35',
        'https://example.com/about,About Us Page Title That Meets Length,38',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'missing_title')).toBeUndefined();
    });
  });

  describe('title length', () => {
    it('reports titles that are too short (< 30 chars, > 0)', () => {
      const csv = makeCsv([
        'https://example.com/short,Short,5',
        'https://example.com/ok,Homepage Title That Is Good Length,35',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'title_too_short');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/short');
      expect(issue.threshold).toContain('30');
    });

    it('reports titles that are too long (> 60 chars)', () => {
      const csv = makeCsv([
        'https://example.com/long,This Is A Very Long Title That Goes Way Over The Maximum Length,65',
        'https://example.com/ok,Good Length Title For SEO Purposes,35',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'title_too_long');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/long');
      expect(issue.threshold).toContain('60');
    });

    it('does not flag length=0 as too short (treated as missing)', () => {
      const csv = makeCsv([
        'https://example.com/missing,,0',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const shortIssue = result.issues.find((i: any) => i.type === 'title_too_short');
      expect(shortIssue).toBeUndefined();
    });

    it('does not flag titles at exact boundary lengths', () => {
      const csv = makeCsv([
        'https://example.com/min,This Is Exactly Thirty Chars Long,30',
        'https://example.com/max,This Is A Title That Is Exactly Sixty Characters Long!!,60',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'title_too_short')).toBeUndefined();
      expect(result.issues.find((i: any) => i.type === 'title_too_long')).toBeUndefined();
    });
  });

  describe('duplicate titles', () => {
    it('reports groups of duplicate titles', () => {
      const csv = makeCsv([
        'https://example.com/,Same Title Used Across Multiple Pages,38',
        'https://example.com/about,Same Title Used Across Multiple Pages,38',
        'https://example.com/contact,Unique Contact Page Title Here,31',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'duplicate_title');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(1);
      expect(issue.groups).toBeDefined();
      expect(issue.groups[0].title).toBe('Same Title Used Across Multiple Pages');
      expect(issue.groups[0].count).toBe(2);
    });

    it('does not report duplicates when all titles are unique', () => {
      const csv = makeCsv([
        'https://example.com/,Unique Homepage Title That Is Good Length,41',
        'https://example.com/about,Unique About Page Title That Is Good,37',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'duplicate_title')).toBeUndefined();
    });

    it('counts multiple duplicate groups', () => {
      const csv = makeCsv([
        'https://example.com/a,Shared Title Group Alpha For Testing,38',
        'https://example.com/b,Shared Title Group Alpha For Testing,38',
        'https://example.com/c,Shared Title Group Beta For Testing,37',
        'https://example.com/d,Shared Title Group Beta For Testing,37',
        'https://example.com/e,Unique Title That Is Only Used Once Here,41',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'duplicate_title');
      expect(issue.count).toBe(2);
    });

    it('counts all duplicate groups before applying the top-10 group cap', () => {
      const rows = Array.from({ length: 12 }, (_, i) => [
        `https://example.com/group-${i}-a,Shared Title Group ${i},38`,
        `https://example.com/group-${i}-b,Shared Title Group ${i},38`,
      ]).flat();
      const parser = new PageTitlesParser(makeCsv(rows));
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'duplicate_title');

      expect(issue.count).toBe(12);
      expect(issue.groups).toHaveLength(10);
    });
  });

  describe('multiple title tags', () => {
    it('reports pages with a second title tag (Title 2 column)', () => {
      const csv = `Address,Title 1,Title 1 Length,Title 2
https://example.com/,Good Title Here For SEO,23,Duplicate Second Title
https://example.com/about,About Page Title That Meets Length Requirements,48,`;
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'multiple_titles');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/');
    });

    it('does not report multiple_titles when no Title 2 column exists', () => {
      const csv = makeCsv([
        'https://example.com/,Homepage Title That Is Good Length For SEO,42',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'multiple_titles')).toBeUndefined();
    });
  });

  describe('total_pages and excluded_urls', () => {
    it('reports correct total_pages', () => {
      const csv = makeCsv([
        'https://example.com/,Homepage Title That Meets SEO Length,37',
        'https://example.com/about,About Page Title That Meets SEO Length,39',
        'https://example.com/contact,Contact Page Title That Meets Length,37',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      expect(result.total_pages).toBe(3);
      expect(result.excluded_urls).toBe(0);
    });
  });

  describe('boundary conditions', () => {
    // TITLE_MIN_LENGTH = 30: condition is length < 30 → flagged; length >= 30 → not flagged
    it('does NOT flag a title of exactly 30 characters as too short', () => {
      const csv = makeCsv([
        'https://example.com/at-min,Exact Minimum Length Title Here!!,30',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'title_too_short');
      expect(issue).toBeUndefined();
    });

    it('DOES flag a title of exactly 29 characters (one under min) as too short', () => {
      const csv = makeCsv([
        'https://example.com/under-min,One Under Min Length Title Here,29',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'title_too_short');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(1);
    });

    // TITLE_MAX_LENGTH = 60: condition is length > 60 → flagged; length <= 60 → not flagged
    it('does NOT flag a title of exactly 60 characters as too long', () => {
      const csv = makeCsv([
        'https://example.com/at-max,Exact Maximum Length Title That Hits Sixty Characters!!!!,60',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'title_too_long');
      expect(issue).toBeUndefined();
    });

    it('DOES flag a title of exactly 61 characters (one over max) as too long', () => {
      const csv = makeCsv([
        'https://example.com/over-max,One Over Maximum Length Title That Exceeds Sixty Characters!,61',
      ]);
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'title_too_long');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(1);
    });
  });

  describe('missing optional columns', () => {
    it('skips length checks when length column is absent', () => {
      const csv = `Address,Title 1
https://example.com/,Short
https://example.com/about,`;
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'title_too_short')).toBeUndefined();
      expect(result.issues.find((i: any) => i.type === 'title_too_long')).toBeUndefined();
    });

    it('skips title checks when title column is absent', () => {
      const csv = `Address,Title 1 Length
https://example.com/,5
https://example.com/about,70`;
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      expect(result.issues.find((i: any) => i.type === 'missing_title')).toBeUndefined();
      expect(result.issues.find((i: any) => i.type === 'duplicate_title')).toBeUndefined();
    });
  });

  describe('indexable HTML masking', () => {
    it('excludes non-indexable pages from counts', () => {
      const csv = `Address,Content Type,Indexability,Title 1,Title 1 Length
https://example.com/,text/html,Indexable,Good Title For SEO Here,23
https://example.com/noindex,text/html,Non-Indexable,,0
https://example.com/css,text/css,Indexable,,0`;
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      expect(result.total_pages).toBe(1);
      expect(result.issues.find((i: any) => i.type === 'missing_title')).toBeUndefined();
    });
  });

  describe('alternative column names', () => {
    it('accepts "Title" as title column and "Title Length" as length column', () => {
      const csv = `Address,Title,Title Length
https://example.com/,,0
https://example.com/about,Short,5`;
      const parser = new PageTitlesParser(csv);
      const result = parser.parse() as any;
      const missingIssue = result.issues.find((i: any) => i.type === 'missing_title');
      expect(missingIssue).toBeDefined();
      expect(missingIssue.count).toBe(1);
      const shortIssue = result.issues.find((i: any) => i.type === 'title_too_short');
      expect(shortIssue).toBeDefined();
      expect(shortIssue.count).toBe(1);
    });
  });
});
