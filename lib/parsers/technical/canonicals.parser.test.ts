import { describe, it, expect } from 'vitest';
import { CanonicalsParser } from './canonicals.parser';

describe('CanonicalsParser', () => {
  describe('static properties', () => {
    it('has filenamePattern of "canonicals"', () => {
      expect(CanonicalsParser.filenamePattern).toEqual(['canonicals_all', 'canonicals']);
    });

    it('matchesFile returns true for filenames containing "canonicals"', () => {
      expect(CanonicalsParser.matchesFile('canonicals.csv')).toBe(true);
      expect(CanonicalsParser.matchesFile('all_canonicals_export.csv')).toBe(true);
      expect(CanonicalsParser.matchesFile('CANONICALS.CSV')).toBe(true);
    });

    it('matchesFile returns false for unrelated filenames', () => {
      expect(CanonicalsParser.matchesFile('images.csv')).toBe(false);
      expect(CanonicalsParser.matchesFile('h1.csv')).toBe(false);
    });
  });

  describe('empty CSV', () => {
    it('returns empty object for empty string', () => {
      const parser = new CanonicalsParser('');
      expect(parser.parse()).toEqual({});
    });

    it('returns empty object for headers-only CSV', () => {
      const csv = `Address,Canonical Link Element 1`;
      const parser = new CanonicalsParser(csv);
      expect(parser.parse()).toEqual({});
    });
  });

  describe('self-referencing canonicals', () => {
    it('counts pages where canonical matches the page URL', () => {
      const csv = `Address,Canonical Link Element 1
https://example.com/page1,https://example.com/page1
https://example.com/page2,https://example.com/page2`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      expect(result.self_referencing_count).toBe(2);
      expect(result.non_self_canonical_count).toBe(0);
      expect(result.missing_canonical_count).toBe(0);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('non-self canonicals', () => {
    it('detects pages with canonical pointing to a different URL', () => {
      const csv = `Address,Canonical Link Element 1
https://example.com/duplicate,https://example.com/original
https://example.com/self,https://example.com/self`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      expect(result.non_self_canonical_count).toBe(1);
      const issue = result.issues.find((i: { type: string }) => i.type === 'non_self_canonical');
      expect(issue).toBeDefined();
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/duplicate');
      expect(issue.urls).not.toContain('https://example.com/self');
    });

    it('sets severity to "warning" when > 50% of pages have non-self canonicals', () => {
      // 3 out of 4 have non-self canonicals = 75%
      const csv = `Address,Canonical Link Element 1
https://example.com/a,https://example.com/canonical
https://example.com/b,https://example.com/canonical
https://example.com/c,https://example.com/canonical
https://example.com/d,https://example.com/d`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'non_self_canonical');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
    });

    it('sets severity to "notice" when <= 50% of pages have non-self canonicals', () => {
      // 1 out of 4 = 25%
      const csv = `Address,Canonical Link Element 1
https://example.com/a,https://example.com/canonical
https://example.com/b,https://example.com/b
https://example.com/c,https://example.com/c
https://example.com/d,https://example.com/d`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'non_self_canonical');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
    });
  });

  describe('threshold boundaries', () => {
    // nonSelfPercent > 50 → 'warning'; nonSelfPercent <= 50 → 'notice'
    // Use 4 pages to get clean percentages: 2/4 = 50%, 3/4 = 75%

    it('exactly 50% non-self canonicals (2/4 pages) produces severity "notice"', () => {
      // 2 non-self + 2 self = 50% non-self
      const csv = `Address,Canonical Link Element 1
https://example.com/a,https://example.com/canonical
https://example.com/b,https://example.com/canonical
https://example.com/c,https://example.com/c
https://example.com/d,https://example.com/d`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'non_self_canonical');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(2);
    });

    it('exactly 75% non-self canonicals (3/4 pages) produces severity "warning"', () => {
      // 3 non-self + 1 self = 75% non-self → > 50% → warning
      const csv = `Address,Canonical Link Element 1
https://example.com/a,https://example.com/canonical
https://example.com/b,https://example.com/canonical
https://example.com/c,https://example.com/canonical
https://example.com/d,https://example.com/d`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'non_self_canonical');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
      expect(issue.count).toBe(3);
    });

    it('just under 50% (1/4 pages = 25%) produces severity "notice"', () => {
      const csv = `Address,Canonical Link Element 1
https://example.com/a,https://example.com/canonical
https://example.com/b,https://example.com/b
https://example.com/c,https://example.com/c
https://example.com/d,https://example.com/d`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'non_self_canonical');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(1);
    });

    it('just over 50% (use 2 pages: 1/2 non-self = 50% → notice, but with odd number try 3/5 = 60% → warning)', () => {
      // 3/5 = 60% → > 50% → warning
      const csv = `Address,Canonical Link Element 1
https://example.com/a,https://example.com/canonical
https://example.com/b,https://example.com/canonical
https://example.com/c,https://example.com/canonical
https://example.com/d,https://example.com/d
https://example.com/e,https://example.com/e`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse() as any;
      const issue = result.issues.find((i: any) => i.type === 'non_self_canonical');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('warning');
    });
  });

  describe('missing canonicals', () => {
    it('detects pages missing canonical tag', () => {
      const csv = `Address,Canonical Link Element 1
https://example.com/nocanonical,
https://example.com/hascanonical,https://example.com/hascanonical`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      expect(result.missing_canonical_count).toBe(1);
      const issue = result.issues.find((i: { type: string }) => i.type === 'missing_canonical');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(1);
      expect(issue.urls).toContain('https://example.com/nocanonical');
    });
  });

  describe('mixed scenarios', () => {
    it('handles a mix of self, non-self, and missing canonicals', () => {
      const csv = `Address,Canonical Link Element 1
https://example.com/self,https://example.com/self
https://example.com/other,https://example.com/canonical-target
https://example.com/missing,
https://example.com/also-self,https://example.com/also-self`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      expect(result.total_pages).toBe(4);
      expect(result.self_referencing_count).toBe(2);
      expect(result.non_self_canonical_count).toBe(1);
      expect(result.missing_canonical_count).toBe(1);
      expect(result.issues).toHaveLength(2); // missing + non-self
    });

    it('returns no issues when all canonicals are self-referencing', () => {
      const csv = `Address,Canonical Link Element 1
https://example.com/a,https://example.com/a
https://example.com/b,https://example.com/b`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      expect(result.issues).toHaveLength(0);
    });
  });

  describe('Canonicals status column', () => {
    it('detects canonicalised pages via the Canonicals column', () => {
      const csv = `Address,Canonicals
https://example.com/page1,Canonicalised
https://example.com/page2,canonicalised to other
https://example.com/page3,Self Canonical`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'canonicalised_pages');
      expect(issue).toBeDefined();
      expect(issue.severity).toBe('notice');
      expect(issue.count).toBe(2);
      expect(issue.urls).toContain('https://example.com/page1');
      expect(issue.urls).toContain('https://example.com/page2');
    });

    it('does not create canonicalised_pages issue when no rows match', () => {
      const csv = `Address,Canonicals
https://example.com/page1,Self Canonical
https://example.com/page2,`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      const issue = result.issues.find((i: { type: string }) => i.type === 'canonicalised_pages');
      expect(issue).toBeUndefined();
    });
  });

  describe('missing columns', () => {
    it('skips canonical analysis when Canonical Link Element 1 column is absent', () => {
      const csv = `Address,Status Code
https://example.com/page,200`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      expect(result.missing_canonical_count).toBe(0);
      expect(result.non_self_canonical_count).toBe(0);
      expect(result.self_referencing_count).toBe(0);
      expect(result.issues).toHaveLength(0);
    });

    it('accepts "Canonical" as an alternate column name', () => {
      const csv = `Address,Canonical
https://example.com/self,https://example.com/self
https://example.com/missing,`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      expect(result.self_referencing_count).toBe(1);
      expect(result.missing_canonical_count).toBe(1);
    });
  });

  describe('total_pages and excluded_urls', () => {
    it('reports correct total_pages', () => {
      const csv = `Address,Canonical Link Element 1
https://example.com/a,https://example.com/a
https://example.com/b,https://example.com/b
https://example.com/c,`;

      const parser = new CanonicalsParser(csv);
      const result = parser.parse();

      expect(result.total_pages).toBe(3);
    });
  });
});
