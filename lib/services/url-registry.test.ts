import { describe, it, expect } from 'vitest';
import { UrlRegistryBuilder, rehydrate } from './url-registry';

describe('UrlRegistryBuilder', () => {
  it('interns same URL to the same ref', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'www.x.edu' });
    const a = b.intern('https://www.x.edu/a', 'page');
    const a2 = b.intern('https://www.x.edu/a', 'page');
    expect(a).toBe(a2);
    expect(b.build().urls).toHaveLength(1);
  });
  it('treats subdomains as distinct hosts', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'www.x.edu' });
    b.intern('https://www.x.edu/a', 'page');
    b.intern('https://apply.x.edu/b', 'external');
    expect(b.build().hosts).toContain('apply.x.edu');
  });
  it('rehydrates a ref to an absolute url', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'www.x.edu' });
    const ref = b.intern('https://www.x.edu/a?q=1', 'page');
    const reg = b.build();
    expect(rehydrate(reg, ref)).toBe('https://www.x.edu/a?q=1');
  });
  it('rehydrates external host correctly', () => {
    const b = new UrlRegistryBuilder({ scheme: 'https', host: 'www.x.edu' });
    const ref = b.intern('http://other.com/z', 'external');
    expect(rehydrate(b.build(), ref)).toBe('http://other.com/z');
  });
});
