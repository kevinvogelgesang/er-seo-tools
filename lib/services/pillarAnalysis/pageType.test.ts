import { describe, it, expect } from 'vitest';
import { classifyPageType } from './pageType';

describe('classifyPageType', () => {
  it('URL-slug primary: /programs/ → program with high confidence', () => {
    const r = classifyPageType({
      url: 'https://example.edu/programs/nursing',
      schemaTypes: [],
      crawlDepth: 2,
    });
    expect(r.pageType).toBe('program');
    expect(r.pageTypeConfidence).toBeGreaterThanOrEqual(0.85);
  });

  it('URL-slug primary: /blog/post → blog', () => {
    const r = classifyPageType({
      url: 'https://example.edu/blog/nursing-tips',
      schemaTypes: [],
      crawlDepth: 3,
    });
    expect(r.pageType).toBe('blog');
  });

  it('URL-slug primary: /resources/ → resource', () => {
    const r = classifyPageType({
      url: 'https://example.edu/resources/financial-aid',
      schemaTypes: [],
      crawlDepth: 3,
    });
    expect(r.pageType).toBe('resource');
  });

  it('URL-slug primary: /career-guides/ → resource', () => {
    const r = classifyPageType({
      url: 'https://example.edu/career-guides/become-rn',
      schemaTypes: [],
      crawlDepth: 3,
    });
    expect(r.pageType).toBe('resource');
  });

  it('schema fallback: ambiguous slug + Course schema → program', () => {
    const r = classifyPageType({
      url: 'https://example.edu/learn/intro',
      schemaTypes: ['Course'],
      crawlDepth: 2,
    });
    expect(r.pageType).toBe('program');
    expect(r.pageTypeConfidence).toBeLessThan(0.85);
    expect(r.pageTypeConfidence).toBeGreaterThanOrEqual(0.6);
  });

  it('schema fallback: BlogPosting → blog', () => {
    const r = classifyPageType({
      url: 'https://example.edu/learn/study-tips',
      schemaTypes: ['BlogPosting'],
      crawlDepth: 3,
    });
    expect(r.pageType).toBe('blog');
  });

  it('depth fallback: shallow + no signals → home/nav', () => {
    const r = classifyPageType({
      url: 'https://example.edu/welcome',
      schemaTypes: [],
      crawlDepth: 1,
    });
    expect(['home', 'nav', 'unknown']).toContain(r.pageType);
    expect(r.pageTypeConfidence).toBeLessThan(0.6);
  });

  it('homepage: depth 0 → home', () => {
    const r = classifyPageType({
      url: 'https://example.edu/',
      schemaTypes: [],
      crawlDepth: 0,
    });
    expect(r.pageType).toBe('home');
  });

  it('nav slug: /about/ → nav', () => {
    const r = classifyPageType({
      url: 'https://example.edu/about/leadership',
      schemaTypes: [],
      crawlDepth: 2,
    });
    expect(r.pageType).toBe('nav');
  });
});
