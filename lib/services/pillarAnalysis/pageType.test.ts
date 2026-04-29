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

  it('archive: /category/news/ → nav', () => {
    const r = classifyPageType({ url: 'https://e.edu/category/news/', schemaTypes: [], crawlDepth: 2 });
    expect(r.pageType).toBe('nav');
  });

  it('archive: /tag/cosmetology/ → nav', () => {
    expect(classifyPageType({ url: 'https://e.edu/tag/cosmetology/', schemaTypes: [], crawlDepth: 2 }).pageType).toBe('nav');
  });

  it('archive: /page/2/ pagination → nav', () => {
    expect(classifyPageType({ url: 'https://e.edu/blog/page/2/', schemaTypes: [], crawlDepth: 2 }).pageType).toBe('nav');
  });

  it('bare /news/ → nav (index page)', () => {
    expect(classifyPageType({ url: 'https://e.edu/news/', schemaTypes: [], crawlDepth: 1 }).pageType).toBe('nav');
  });

  it('bare /news (no trailing slash) → nav', () => {
    expect(classifyPageType({ url: 'https://e.edu/news', schemaTypes: [], crawlDepth: 1 }).pageType).toBe('nav');
  });

  it('bare /blog/ → nav', () => {
    expect(classifyPageType({ url: 'https://e.edu/blog/', schemaTypes: [], crawlDepth: 1 }).pageType).toBe('nav');
  });

  it('but /blog/some-post → still blog', () => {
    expect(classifyPageType({ url: 'https://e.edu/blog/some-post', schemaTypes: [], crawlDepth: 2 }).pageType).toBe('blog');
  });

  it('but /news/article-slug → still blog', () => {
    expect(classifyPageType({ url: 'https://e.edu/news/article-slug', schemaTypes: [], crawlDepth: 3 }).pageType).toBe('blog');
  });
});
