import { describe, it, expect } from 'vitest';
import { ExactDuplicatesParser } from './exactDuplicates.parser';

describe('ExactDuplicatesParser', () => {
  describe('filenamePattern', () => {
    it('matches exact_duplicates_report.csv', () => {
      expect(ExactDuplicatesParser.matchesFile('exact_duplicates_report.csv')).toBe(true);
    });
    it('does not match page_titles_all.csv', () => {
      expect(ExactDuplicatesParser.matchesFile('page_titles_all.csv')).toBe(false);
    });
  });

  describe('parse', () => {
    it('extracts exact duplicate pairs correctly', () => {
      const csv = `Address,Exact Duplicate Address,Similarity,Indexability,Indexability Status
https://example.com/a,https://example.com/b,0.98,Indexable,
      https://example.com/c,https://example.com/d,0.75,Non-Indexable,`;
      const result = new ExactDuplicatesParser(csv).parse();
      expect(result.exact_duplicates).toHaveLength(2);
      expect(result.exact_duplicates_count).toBe(2);
      expect(result.exact_duplicates[0]).toEqual({
        address: 'https://example.com/a',
        duplicate_of: 'https://example.com/b',
        similarity_pct: 98,
        indexability: 'Indexable',
      });
      expect(result.exact_duplicates[1].similarity_pct).toBe(75);
    });

    it('filters rows with gtm= in address', () => {
      const csv = `Address,Exact Duplicate Address,Similarity,Indexability,Indexability Status
https://example.com/?gtm=abc,https://example.com/b,0.99,Indexable,
https://example.com/a,https://example.com/b,0.98,Indexable,`;
      const result = new ExactDuplicatesParser(csv).parse();
      expect(result.exact_duplicates).toHaveLength(1);
    });

    it('filters rows with pid= in address', () => {
      const csv = `Address,Exact Duplicate Address,Similarity,Indexability,Indexability Status
https://example.com/?pid=123,https://example.com/b,0.99,Indexable,`;
      const result = new ExactDuplicatesParser(csv).parse();
      expect(result.exact_duplicates).toHaveLength(0);
    });

    it('filters rows with v=3&t= in address', () => {
      const csv = `Address,Exact Duplicate Address,Similarity,Indexability,Indexability Status
https://example.com/?v=3&t=event,https://example.com/b,0.99,Indexable,`;
      const result = new ExactDuplicatesParser(csv).parse();
      expect(result.exact_duplicates).toHaveLength(0);
    });

    it('filters rows with address longer than 300 characters', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(290);
      const csv = `Address,Exact Duplicate Address,Similarity,Indexability,Indexability Status
${longUrl},https://example.com/b,0.99,Indexable,`;
      const result = new ExactDuplicatesParser(csv).parse();
      expect(result.exact_duplicates).toHaveLength(0);
    });

    it('defaults similarity_pct to 0 when Similarity cell is a dash', () => {
      const csv = `Address,Exact Duplicate Address,Similarity,Indexability,Indexability Status
https://example.com/a,https://example.com/b,-,Indexable,`;
      const result = new ExactDuplicatesParser(csv).parse();
      expect(result.exact_duplicates[0].similarity_pct).toBe(0);
    });

    it('does not multiply percent-formatted Similarity values twice', () => {
      const csv = `Address,Exact Duplicate Address,Similarity,Indexability,Indexability Status
https://example.com/a,https://example.com/b,98%,Indexable,
https://example.com/c,https://example.com/d,100,Indexable,`;
      const result = new ExactDuplicatesParser(csv).parse();
      expect(result.exact_duplicates[0].similarity_pct).toBe(98);
      expect(result.exact_duplicates[1].similarity_pct).toBe(100);
    });

    it('defaults similarity_pct to 0 when Similarity column is absent', () => {
      const csv = `Address,Exact Duplicate Address,Indexability,Indexability Status
https://example.com/a,https://example.com/b,Indexable,`;
      const result = new ExactDuplicatesParser(csv).parse();
      expect(result.exact_duplicates[0].similarity_pct).toBe(0);
    });

    it('returns empty array for empty CSV', () => {
      const csv = `Address,Exact Duplicate Address,Similarity,Indexability,Indexability Status`;
      const result = new ExactDuplicatesParser(csv).parse();
      expect(result.exact_duplicates).toHaveLength(0);
    });
  });
});
