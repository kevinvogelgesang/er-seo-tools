import { describe, it, expect } from 'vitest';
import { BaseParser } from './base.parser';
import { ParsedData } from '../types/index';

// Minimal concrete subclass to expose protected methods for testing
class TestParser extends BaseParser {
  static filenamePattern = 'test';

  parse(): ParsedData {
    return {};
  }

  public testFindColumn(names: string[]) {
    return this.findColumn(names);
  }

  public testGetHtmlMask() {
    return this.getHtmlMask();
  }

  public testGetIndexableMask() {
    return this.getIndexableMask();
  }

  public testGetIndexableHtmlMask() {
    return this.getIndexableHtmlMask();
  }

  public testLength() {
    return this.length;
  }

  public testIsEmpty() {
    return this.isEmpty;
  }

  public testGetUrlsWhereMask(mask: boolean[], limit?: number) {
    return this.getUrlsWhereMask(mask, limit);
  }

  public testGetPrimaryDomain() {
    return this.getPrimaryDomain();
  }
}

// ----- CSV fixtures -----

const BASIC_CSV = `Address,Content Type,Indexability,Status Code
https://example.com/,text/html; charset=utf-8,Indexable,200
https://example.com/about,text/html; charset=utf-8,Indexable,200
https://example.com/image.png,image/png,Non-Indexable,200
https://example.com/noindex,text/html; charset=utf-8,Non-Indexable,200`;

const EMPTY_CSV = ``;

const MULTI_DOMAIN_CSV = `Address,Content Type,Indexability
https://example.com/,text/html,Indexable
https://example.com/page2,text/html,Indexable
https://other.com/page,text/html,Indexable`;

const NO_ADDRESS_CSV = `Content Type,Indexability
text/html,Indexable
image/png,Non-Indexable`;

const CASE_INSENSITIVE_CSV = `address,content type,indexability
https://example.com/,text/html,Indexable`;

describe('BaseParser (via TestParser)', () => {
  // ---- findColumn ----
  describe('findColumn', () => {
    it('finds a column by exact name', () => {
      const p = new TestParser(BASIC_CSV);
      expect(p.testFindColumn(['Address'])).toBe('Address');
    });

    it('finds a column case-insensitively', () => {
      const p = new TestParser(BASIC_CSV);
      expect(p.testFindColumn(['address'])).toBe('Address');
      expect(p.testFindColumn(['CONTENT TYPE'])).toBe('Content Type');
    });

    it('returns null when column is not found', () => {
      const p = new TestParser(BASIC_CSV);
      expect(p.testFindColumn(['NonExistent', 'AlsoMissing'])).toBeNull();
    });

    it('returns first matching column when multiple candidates provided', () => {
      const p = new TestParser(BASIC_CSV);
      // 'URL' is not present, 'Address' is — should return Address
      expect(p.testFindColumn(['URL', 'Address'])).toBe('Address');
    });

    it('works with lowercase CSV headers', () => {
      const p = new TestParser(CASE_INSENSITIVE_CSV);
      expect(p.testFindColumn(['Address'])).toBe('address');
      expect(p.testFindColumn(['address'])).toBe('address');
    });
  });

  // ---- length / isEmpty ----
  describe('length and isEmpty', () => {
    it('returns correct length for non-empty data', () => {
      const p = new TestParser(BASIC_CSV);
      expect(p.testLength()).toBe(4);
      expect(p.testIsEmpty()).toBe(false);
    });

    it('returns 0 and isEmpty=true for empty CSV', () => {
      const p = new TestParser(EMPTY_CSV);
      expect(p.testLength()).toBe(0);
      expect(p.testIsEmpty()).toBe(true);
    });

    it('returns 0 and isEmpty=true for header-only CSV', () => {
      const p = new TestParser('Address,Content Type,Indexability\n');
      expect(p.testLength()).toBe(0);
      expect(p.testIsEmpty()).toBe(true);
    });
  });

  // ---- getHtmlMask ----
  describe('getHtmlMask', () => {
    it('returns true for text/html rows and false for others', () => {
      const p = new TestParser(BASIC_CSV);
      const mask = p.testGetHtmlMask();
      // row 0: text/html → true
      // row 1: text/html → true
      // row 2: image/png → false
      // row 3: text/html → true
      expect(mask).toEqual([true, true, false, true]);
    });

    it('returns all-true when Content Type column is absent', () => {
      const p = new TestParser(`Address,Indexability\nhttps://example.com/,Indexable`);
      expect(p.testGetHtmlMask()).toEqual([true]);
    });
  });

  // ---- getIndexableMask ----
  describe('getIndexableMask', () => {
    it('returns true only for Indexable rows', () => {
      const p = new TestParser(BASIC_CSV);
      const mask = p.testGetIndexableMask();
      expect(mask).toEqual([true, true, false, false]);
    });

    it('returns all-true when Indexability column is absent', () => {
      const p = new TestParser(`Address,Content Type\nhttps://example.com/,text/html`);
      expect(p.testGetIndexableMask()).toEqual([true]);
    });
  });

  // ---- getIndexableHtmlMask ----
  describe('getIndexableHtmlMask', () => {
    it('returns true only for rows that are both HTML and Indexable', () => {
      const p = new TestParser(BASIC_CSV);
      const mask = p.testGetIndexableHtmlMask();
      // row 0: html + indexable → true
      // row 1: html + indexable → true
      // row 2: image + non-indexable → false
      // row 3: html + non-indexable → false
      expect(mask[0]).toBe(true);
      expect(mask[1]).toBe(true);
      expect(mask[2]).toBe(false);
      expect(mask[3]).toBe(false);
    });
  });

  // ---- getUrlsWhereMask ----
  describe('getUrlsWhereMask', () => {
    it('returns URLs where mask is true', () => {
      const p = new TestParser(BASIC_CSV);
      const mask = [true, false, false, false];
      expect(p.testGetUrlsWhereMask(mask)).toEqual(['https://example.com/']);
    });

    it('returns empty array when no mask values are true', () => {
      const p = new TestParser(BASIC_CSV);
      expect(p.testGetUrlsWhereMask([false, false, false, false])).toEqual([]);
    });

    it('respects the limit parameter', () => {
      const p = new TestParser(BASIC_CSV);
      const mask = [true, true, true, true];
      const urls = p.testGetUrlsWhereMask(mask, 2);
      expect(urls).toHaveLength(2);
    });

    it('returns empty array when Address column is absent', () => {
      const p = new TestParser(NO_ADDRESS_CSV);
      expect(p.testGetUrlsWhereMask([true, true])).toEqual([]);
    });

    it('defaults to a limit of 20', () => {
      // Build a CSV with 25 rows
      const header = 'Address,Content Type,Indexability';
      const rows = Array.from({ length: 25 }, (_, i) =>
        `https://example.com/page${i},text/html,Indexable`
      );
      const p = new TestParser([header, ...rows].join('\n'));
      const mask = Array(25).fill(true);
      const urls = p.testGetUrlsWhereMask(mask);
      expect(urls).toHaveLength(20);
    });
  });

  // ---- getPrimaryDomain ----
  describe('getPrimaryDomain', () => {
    it('returns the most common hostname', () => {
      const p = new TestParser(MULTI_DOMAIN_CSV);
      // example.com appears twice, other.com once
      expect(p.testGetPrimaryDomain()).toBe('example.com');
    });

    it('returns null when no Address column exists', () => {
      const p = new TestParser(NO_ADDRESS_CSV);
      expect(p.testGetPrimaryDomain()).toBeNull();
    });

    it('returns null for empty CSV', () => {
      const p = new TestParser(EMPTY_CSV);
      expect(p.testGetPrimaryDomain()).toBeNull();
    });

    it('ignores non-URL values in Address column', () => {
      const csv = `Address\nnot-a-url\nhttps://example.com/`;
      const p = new TestParser(csv);
      expect(p.testGetPrimaryDomain()).toBe('example.com');
    });
  });

  // ---- matchesFile static method ----
  describe('matchesFile', () => {
    it('returns true when filename contains the pattern (case-insensitive)', () => {
      expect(TestParser.matchesFile('test_export.csv')).toBe(true);
      expect(TestParser.matchesFile('TEST_EXPORT.csv')).toBe(true);
      expect(TestParser.matchesFile('my_test_file.csv')).toBe(true);
    });

    it('returns false when filename does not contain the pattern', () => {
      expect(TestParser.matchesFile('response_codes.csv')).toBe(false);
      expect(TestParser.matchesFile('directives.csv')).toBe(false);
    });

    it('returns false when filenamePattern is empty', () => {
      class EmptyPatternParser extends BaseParser {
        static filenamePattern = '';
        parse(): ParsedData { return {}; }
      }
      expect(EmptyPatternParser.matchesFile('anything.csv')).toBe(false);
    });
  });
});
