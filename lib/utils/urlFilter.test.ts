import { describe, it, expect } from 'vitest';
import { isSeoRelevantUrl, truncateUrlList } from './urlFilter';

describe('isSeoRelevantUrl', () => {
  // ── Normal page URLs (should be SEO-relevant) ───────────────────────────────
  it('returns true for a plain page URL', () => {
    expect(isSeoRelevantUrl('https://example.com/about')).toBe(true);
  });

  it('returns true for the homepage', () => {
    expect(isSeoRelevantUrl('https://example.com/')).toBe(true);
  });

  it('returns true for a deep page path', () => {
    expect(isSeoRelevantUrl('https://example.com/programs/undergraduate/cs')).toBe(true);
  });

  it('returns true for a URL with a query string (not a CMS pattern)', () => {
    expect(isSeoRelevantUrl('https://example.com/search?q=test')).toBe(true);
  });

  // ── Null / undefined / non-string (should return false) ─────────────────────
  it('returns false for null', () => {
    expect(isSeoRelevantUrl(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSeoRelevantUrl(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSeoRelevantUrl('')).toBe(false);
  });

  // ── WordPress patterns ───────────────────────────────────────────────────────
  it('returns false for /wp-content/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/wp-content/uploads/image.jpg')).toBe(false);
  });

  it('returns false for /wp-includes/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/wp-includes/js/jquery.js')).toBe(false);
  });

  it('returns false for /wp-admin/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/wp-admin/post.php')).toBe(false);
  });

  it('returns false for /wp-json/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/wp-json/wp/v2/posts')).toBe(false);
  });

  it('returns false for ?doing_wp_cron query param URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/?doing_wp_cron=1234')).toBe(false);
  });

  // ── Drupal patterns ──────────────────────────────────────────────────────────
  it('returns false for /sites/default/files/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/sites/default/files/doc.pdf')).toBe(false);
  });

  it('returns false for /modules/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/modules/contrib/views')).toBe(false);
  });

  it('returns false for theme file paths with .php extension', () => {
    expect(isSeoRelevantUrl('https://example.com/themes/mytheme/page.php')).toBe(false);
  });

  it('returns false for theme file paths with .js extension', () => {
    expect(isSeoRelevantUrl('https://example.com/themes/mytheme/app.js')).toBe(false);
  });

  it('returns false for theme file paths with .css extension', () => {
    expect(isSeoRelevantUrl('https://example.com/themes/mytheme/style.css')).toBe(false);
  });

  // ── Common CMS patterns ──────────────────────────────────────────────────────
  it('returns false for /admin/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/admin/settings')).toBe(false);
  });

  it('returns false for /administrator/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/administrator/index.php')).toBe(false);
  });

  it('returns false for /backend/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/backend/dashboard')).toBe(false);
  });

  it('returns false for /cms/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/cms/edit')).toBe(false);
  });

  it('returns false for /_resources/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/_resources/images/logo.png')).toBe(false);
  });

  // ── Asset/file extension patterns ────────────────────────────────────────────
  it('returns false for .php? query URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/page.php?id=1')).toBe(false);
  });

  it('returns false for .asp? query URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/page.asp?id=1')).toBe(false);
  });

  it('returns false for .js asset URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/assets/app.js')).toBe(false);
  });

  it('returns false for .css asset URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/style.css')).toBe(false);
  });

  it('returns false for .xml URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/sitemap.xml')).toBe(false);
  });

  it('returns false for .json URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/data.json')).toBe(false);
  });

  it('returns false for .txt URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/robots.txt')).toBe(false);
  });

  it('returns false for .ico URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/favicon.ico')).toBe(false);
  });

  it('returns false for .woff font URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/fonts/myfont.woff')).toBe(false);
  });

  it('returns false for .woff2 font URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/fonts/myfont.woff2')).toBe(false);
  });

  // ── Feed URLs ────────────────────────────────────────────────────────────────
  it('returns false for /feed/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/feed/')).toBe(false);
  });

  it('returns false for /rss/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/rss/')).toBe(false);
  });

  it('returns false for /atom/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/atom/')).toBe(false);
  });

  it('returns false for /feed (no trailing slash)', () => {
    expect(isSeoRelevantUrl('https://example.com/feed')).toBe(false);
  });

  // ── Other non-page paths ─────────────────────────────────────────────────────
  it('returns false for /cgi-bin/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/cgi-bin/script.cgi')).toBe(false);
  });

  it('returns false for /includes/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/includes/functions.php')).toBe(false);
  });

  it('returns false for /assets/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/assets/logo.png')).toBe(false);
  });

  it('returns false for /_inc/ URLs', () => {
    expect(isSeoRelevantUrl('https://example.com/_inc/header.php')).toBe(false);
  });

  // ── Case-insensitivity ───────────────────────────────────────────────────────
  it('is case-insensitive for pattern matching', () => {
    expect(isSeoRelevantUrl('https://example.com/WP-CONTENT/uploads/image.jpg')).toBe(false);
  });
});

describe('truncateUrlList', () => {
  it('returns all URLs when list is smaller than limit', () => {
    const urls = ['https://a.com', 'https://b.com'];
    const result = truncateUrlList(urls, 10);
    expect(result.urls).toEqual(urls);
    expect(result.total_affected).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('returns all URLs when list equals the limit', () => {
    const urls = ['https://a.com', 'https://b.com', 'https://c.com'];
    const result = truncateUrlList(urls, 3);
    expect(result.urls).toHaveLength(3);
    expect(result.total_affected).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('truncates when list exceeds the limit', () => {
    const urls = Array.from({ length: 50 }, (_, i) => `https://example.com/page-${i}`);
    const result = truncateUrlList(urls, 30);
    expect(result.urls).toHaveLength(30);
    expect(result.total_affected).toBe(50);
    expect(result.truncated).toBe(true);
  });

  it('uses default limit of 30', () => {
    const urls = Array.from({ length: 40 }, (_, i) => `https://example.com/page-${i}`);
    const result = truncateUrlList(urls);
    expect(result.urls).toHaveLength(30);
    expect(result.total_affected).toBe(40);
    expect(result.truncated).toBe(true);
  });

  it('handles empty URL list', () => {
    const result = truncateUrlList([]);
    expect(result.urls).toEqual([]);
    expect(result.total_affected).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('preserves original url order up to limit', () => {
    const urls = ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'];
    const result = truncateUrlList(urls, 2);
    expect(result.urls).toEqual(['https://a.com', 'https://b.com']);
  });

  it('does not truncate when limit is 0 (edge case)', () => {
    // slice(0, 0) returns []
    const result = truncateUrlList(['https://a.com'], 0);
    expect(result.urls).toEqual([]);
    expect(result.total_affected).toBe(1);
    expect(result.truncated).toBe(true);
  });
});
