import { describe, it, expect } from 'vitest';
import { SitemapsParser } from './sitemaps.parser';
import type { Issue } from '../../types';

const CSV = `Address,Content Type,Status Code,Status,Indexability,Indexability Status
https://x.edu/broken.jpg,text/html,404,Not Found,Non-Indexable,
https://x.edu/,text/html,200,OK,Non-Indexable,noindex
https://x.edu/style.css,text/css,0,,Non-Indexable,
https://x.edu/good,text/html,200,OK,Indexable,
https://x.edu/old,text/html,301,Moved,Non-Indexable,Redirected`;

function parse() {
  const out = new SitemapsParser(CSV).parse();
  const issues = (out.issues as Issue[]) ?? [];
  const by = (t: string) => issues.find((i) => i.type === t);
  return { stats: out.stats as Record<string, number>, by };
}

describe('SitemapsParser', () => {
  it('counts only 4xx/5xx as sitemap_errors', () => {
    expect(parse().stats.sitemap_errors).toBe(1);
  });

  it('counts 3xx as sitemap_redirects', () => {
    expect(parse().stats.sitemap_redirects).toBe(1);
  });

  it('counts only REACHABLE (2xx) non-indexable URLs as non_indexable_in_sitemap', () => {
    // The 404 image and status-0 CSS are NOT distinct "non-indexable page"
    // findings — they are already errors/unfetched. Only the 200 noindex
    // homepage is a real "non-indexable page in sitemap".
    const { stats, by } = parse();
    expect(stats.non_indexable_in_sitemap).toBe(1);
    expect(by('non_indexable_in_sitemap')?.urls).toEqual(['https://x.edu/']);
  });
});
