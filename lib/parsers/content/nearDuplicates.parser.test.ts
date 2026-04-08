import { describe, it, expect } from 'vitest';
import { NearDuplicatesParser } from './nearDuplicates.parser';

describe('NearDuplicatesParser', () => {
  describe('filenamePattern', () => {
    it('matches content_near_duplicates.csv', () => {
      expect(NearDuplicatesParser.matchesFile('content_near_duplicates.csv')).toBe(true);
    });
    it('does not match page_titles_all.csv', () => {
      expect(NearDuplicatesParser.matchesFile('page_titles_all.csv')).toBe(false);
    });
  });

  describe('parse', () => {
    it('extracts near duplicate entries correctly', () => {
      const csv = `Address,Closest Near Duplicate Match,No. Near Duplicates,Indexability,Indexability Status,Canonical Link Element 1
https://example.com/a,https://example.com/b,3,Indexable,,
https://example.com/c,https://example.com/d,1,Non-Indexable,,`;
      const result = new NearDuplicatesParser(csv).parse();
      expect(result.near_duplicates).toHaveLength(2);
      expect(result.near_duplicates[0]).toEqual({
        address: 'https://example.com/a',
        closest_match: 'https://example.com/b',
        near_duplicate_count: 3,
        indexability: 'Indexable',
      });
    });

    it('skips rows with empty closest_match', () => {
      const csv = `Address,Closest Near Duplicate Match,No. Near Duplicates,Indexability,Indexability Status,Canonical Link Element 1
https://example.com/a,,0,Indexable,,
https://example.com/b,https://example.com/c,2,Indexable,,`;
      const result = new NearDuplicatesParser(csv).parse();
      expect(result.near_duplicates).toHaveLength(1);
    });

    it('skips rows where near_duplicate_count is 0', () => {
      const csv = `Address,Closest Near Duplicate Match,No. Near Duplicates,Indexability,Indexability Status,Canonical Link Element 1
https://example.com/a,https://example.com/b,0,Indexable,,`;
      const result = new NearDuplicatesParser(csv).parse();
      expect(result.near_duplicates).toHaveLength(0);
    });

    it('parses near_duplicate_count as integer', () => {
      const csv = `Address,Closest Near Duplicate Match,No. Near Duplicates,Indexability,Indexability Status,Canonical Link Element 1
https://example.com/a,https://example.com/b,5,Indexable,,`;
      const result = new NearDuplicatesParser(csv).parse();
      expect(result.near_duplicates[0].near_duplicate_count).toBe(5);
      expect(typeof result.near_duplicates[0].near_duplicate_count).toBe('number');
    });

    it('returns empty array for CSV with only headers', () => {
      const csv = `Address,Closest Near Duplicate Match,No. Near Duplicates,Indexability,Indexability Status,Canonical Link Element 1`;
      const result = new NearDuplicatesParser(csv).parse();
      expect(result.near_duplicates).toHaveLength(0);
    });

    it('defaults near_duplicate_count to 0 for non-numeric values', () => {
      const csv = `Address,Closest Near Duplicate Match,No. Near Duplicates,Indexability,Indexability Status,Canonical Link Element 1
https://example.com/a,https://example.com/b,-,Indexable,,`;
      const result = new NearDuplicatesParser(csv).parse();
      expect(result.near_duplicates).toHaveLength(0);
    });
  });
});
