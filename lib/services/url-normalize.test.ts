import { describe, it, expect } from 'vitest';
import { normalizeUrl, urlJoinKey } from './url-normalize';

describe('normalizeUrl', () => {
  it('lowercases host but not path', () => {
    const r = normalizeUrl('HTTPS://WWW.Example.EDU/Blog/Post');
    expect(r.host).toBe('www.example.edu');
    expect(r.path).toBe('/Blog/Post');
    expect(r.scheme).toBe('https');
  });
  it('drops the fragment', () => {
    expect(normalizeUrl('https://x.edu/a#section').path).toBe('/a');
  });
  it('preserves non-UTM query but strips UTM params', () => {
    const r = normalizeUrl('https://x.edu/s?q=1&utm_source=nl&utm_medium=email');
    expect(r.query).toBe('q=1');
    expect(r.originalUrl).toContain('utm_source');
  });
  it('keeps query undefined when none present', () => {
    expect(normalizeUrl('https://x.edu/a').query).toBeUndefined();
  });
  it('does not strip trailing slash', () => {
    expect(normalizeUrl('https://x.edu/a/').path).toBe('/a/');
  });
  it('falls back to originalUrl for unparseable input', () => {
    const r = normalizeUrl('not a url');
    expect(r.originalUrl).toBe('not a url');
    expect(r.host).toBe('');
  });
});

describe('urlJoinKey', () => {
  it('matches across scheme + trailing-slash differences', () => {
    expect(urlJoinKey('https://x.edu/page/')).toBe(urlJoinKey('http://x.edu/page'));
  });
  it('lowercases host but preserves path case', () => {
    expect(urlJoinKey('https://X.EDU/Page')).toBe('x.edu/Page');
  });
  it('keeps root path as "/"', () => {
    expect(urlJoinKey('https://x.edu/')).toBe('x.edu/');
    expect(urlJoinKey('https://x.edu')).toBe('x.edu/');
  });
  it('drops UTM params but keeps real query', () => {
    expect(urlJoinKey('https://x.edu/a?utm_source=g&q=1')).toBe('x.edu/a?q=1');
  });
  it('falls back to trimmed lowercase for unparseable input', () => {
    expect(urlJoinKey('  NotAUrl  ')).toBe('notaurl');
  });
});
