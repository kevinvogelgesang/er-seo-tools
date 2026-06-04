import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class SitemapsParser extends BaseParser {
  static parserKey = 'sitemaps';
  static filenamePattern = ['sitemaps_all', 'sitemaps'];

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const statusCol = this.findColumn(['Status Code', 'Status']);
    const indexabilityCol = this.findColumn(['Indexability']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    // Sitemap errors (4xx/5xx)
    if (statusCol) {
      const errorUrls: string[] = [];
      const redirectUrls: string[] = [];
      let errorCount = 0;
      let redirectCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const status = toNumber(this.data[i][statusCol]);
        if (status === null) continue;

        if (status >= 400 && status < 600) {
          errorCount++;
          if (addressCol && errorUrls.length < 30) {
            errorUrls.push(toString(this.data[i][addressCol]));
          }
        } else if (status >= 300 && status < 400) {
          redirectCount++;
          if (addressCol && redirectUrls.length < 30) {
            redirectUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      stats.sitemap_errors = errorCount;
      stats.sitemap_redirects = redirectCount;

      if (errorCount > 0) {
        issues.push({
          type: 'sitemap_errors',
          severity: 'warning',
          count: errorCount,
          description: `${errorCount} URLs in sitemap returning errors`,
          urls: errorUrls,
        });
      }

      if (redirectCount > 0) {
        issues.push({
          type: 'sitemap_redirects',
          severity: 'warning',
          count: redirectCount,
          description: `${redirectCount} URLs in sitemap that redirect`,
          urls: redirectUrls,
        });
      }
    }

    // Non-indexable URLs in sitemap
    if (indexabilityCol) {
      const nonIndexableUrls: string[] = [];
      let nonIndexableCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const indexability = toString(this.data[i][indexabilityCol]).toLowerCase();
        // Only count REACHABLE (2xx) non-indexable URLs. A 4xx/5xx URL is already
        // a sitemap_error and a 3xx a sitemap_redirect; a status-0/unfetched URL
        // (often a CSS/asset) was never evaluated. Counting those here just
        // double-flags errors and pulls non-page assets in as "pages".
        const status = statusCol ? toNumber(this.data[i][statusCol]) : null;
        // When status is unavailable (no column), fall back to counting all
        // non-indexable (old behavior) rather than silently dropping to zero.
        const reachable = !statusCol || (status !== null && status >= 200 && status < 300);
        if (indexability === 'non-indexable' && reachable) {
          nonIndexableCount++;
          if (addressCol && nonIndexableUrls.length < 30) {
            nonIndexableUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      stats.non_indexable_in_sitemap = nonIndexableCount;
      if (nonIndexableCount > 0) {
        issues.push({
          type: 'non_indexable_in_sitemap',
          severity: 'warning',
          count: nonIndexableCount,
          description: `${nonIndexableCount} non-indexable URLs in sitemap`,
          urls: nonIndexableUrls,
        });
      }
    }

    return {
      total_sitemap_urls: this.length,
      stats,
      issues,
    };
  }
}

export class OrphanPagesParser extends BaseParser {
  static parserKey = 'orphanpages';
  static filenamePattern = 'orphan';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);

    const issues: Issue[] = [];

    // All orphan pages
    const orphanUrls: string[] = [];
    for (let i = 0; i < this.data.length && orphanUrls.length < 50; i++) {
      if (addressCol) {
        orphanUrls.push(toString(this.data[i][addressCol]));
      }
    }

    if (this.length > 0) {
      issues.push({
        type: 'orphan_pages',
        severity: 'warning',
        count: this.length,
        description: `${this.length} orphan pages not linked from anywhere on the site`,
        urls: orphanUrls,
      });
    }

    return {
      total_orphan_pages: this.length,
      issues,
    };
  }
}
