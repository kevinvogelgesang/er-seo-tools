import { describe, it, expect } from 'vitest';
import {
  findColumnName,
  isHtmlContentType,
  isIndexable,
  toNumber,
  toString,
} from './columnMapper';

describe('findColumnName', () => {
  it('returns exact match when present', () => {
    expect(findColumnName(['Address', 'Title 1', 'Status Code'], ['Address'])).toBe('Address');
  });

  it('returns the first matching candidate when multiple candidates exist', () => {
    const headers = ['Status Code', 'Address', 'Title 1'];
    expect(findColumnName(headers, ['Address', 'URL', 'Path'])).toBe('Address');
  });

  it('returns first candidate that matches when earlier candidates are absent', () => {
    const headers = ['URL', 'Title 1'];
    expect(findColumnName(headers, ['Address', 'URL', 'Path'])).toBe('URL');
  });

  it('performs case-insensitive fallback match', () => {
    const headers = ['address', 'Title 1'];
    expect(findColumnName(headers, ['Address'])).toBe('address');
  });

  it('prefers exact match over case-insensitive match in candidate order', () => {
    // First candidate has case-insensitive match in header "title 1"
    // Second candidate has exact match — should still return first candidate's header
    const headers = ['title 1', 'Status Code'];
    expect(findColumnName(headers, ['Title 1', 'Status Code'])).toBe('title 1');
  });

  it('returns null when no candidate matches', () => {
    expect(findColumnName(['Address', 'Title 1'], ['Status Code', 'HTTP Status'])).toBeNull();
  });

  it('returns null for empty headers array', () => {
    expect(findColumnName([], ['Address', 'URL'])).toBeNull();
  });

  it('returns null for empty candidates array', () => {
    expect(findColumnName(['Address', 'Title 1'], [])).toBeNull();
  });

  it('handles both arrays empty', () => {
    expect(findColumnName([], [])).toBeNull();
  });

  it('handles mixed-case headers and candidates', () => {
    expect(findColumnName(['META DESCRIPTION 1'], ['Meta Description 1'])).toBe(
      'META DESCRIPTION 1'
    );
  });
});

describe('isHtmlContentType', () => {
  it('returns true for text/html', () => {
    expect(isHtmlContentType('text/html')).toBe(true);
  });

  it('returns true for text/html with charset', () => {
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
  });

  it('returns true for application/xhtml+xml', () => {
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
  });

  it('returns true for uppercase TEXT/HTML', () => {
    expect(isHtmlContentType('TEXT/HTML')).toBe(true);
  });

  it('returns false for text/css', () => {
    expect(isHtmlContentType('text/css')).toBe(false);
  });

  it('returns false for application/json', () => {
    expect(isHtmlContentType('application/json')).toBe(false);
  });

  it('returns false for image/png', () => {
    expect(isHtmlContentType('image/png')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isHtmlContentType('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isHtmlContentType(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isHtmlContentType(undefined)).toBe(false);
  });
});

describe('isIndexable', () => {
  it('returns true for "Indexable"', () => {
    expect(isIndexable('Indexable')).toBe(true);
  });

  it('returns true for lowercase "indexable"', () => {
    expect(isIndexable('indexable')).toBe(true);
  });

  it('returns true for uppercase "INDEXABLE"', () => {
    expect(isIndexable('INDEXABLE')).toBe(true);
  });

  it('returns true for "indexable" with surrounding whitespace', () => {
    expect(isIndexable('  Indexable  ')).toBe(true);
  });

  it('returns false for "Non-Indexable"', () => {
    expect(isIndexable('Non-Indexable')).toBe(false);
  });

  it('returns false for "Noindex"', () => {
    expect(isIndexable('Noindex')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isIndexable('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isIndexable(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isIndexable(undefined)).toBe(false);
  });
});

describe('toNumber', () => {
  it('converts a valid integer string', () => {
    expect(toNumber('42')).toBe(42);
  });

  it('converts a valid float string', () => {
    expect(toNumber('3.14')).toBeCloseTo(3.14);
  });

  it('converts "0" to 0', () => {
    expect(toNumber('0')).toBe(0);
  });

  it('converts the number 0 to 0', () => {
    expect(toNumber(0)).toBe(0);
  });

  it('converts a numeric value directly', () => {
    expect(toNumber(100)).toBe(100);
  });

  it('returns null for empty string', () => {
    expect(toNumber('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(toNumber(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(toNumber(undefined)).toBeNull();
  });

  it('returns null for non-numeric string "abc"', () => {
    expect(toNumber('abc')).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(toNumber(NaN)).toBeNull();
  });

  it('handles negative numbers', () => {
    expect(toNumber('-5')).toBe(-5);
  });

  it('handles number with leading/trailing spaces (valid for Number())', () => {
    // Number(' 42 ') === 42 in JS
    expect(toNumber(' 42 ')).toBe(42);
  });
});

describe('toString', () => {
  it('returns the string as-is', () => {
    expect(toString('hello')).toBe('hello');
  });

  it('converts a number to string', () => {
    expect(toString(42)).toBe('42');
  });

  it('converts 0 to "0"', () => {
    expect(toString(0)).toBe('0');
  });

  it('converts false to "false"', () => {
    expect(toString(false)).toBe('false');
  });

  it('returns empty string for null', () => {
    expect(toString(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(toString(undefined)).toBe('');
  });

  it('converts an array to its string representation', () => {
    expect(toString([1, 2, 3])).toBe('1,2,3');
  });

  it('returns empty string for empty string input', () => {
    expect(toString('')).toBe('');
  });
});
