import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class LinksIssuesParser extends BaseParser {
  // Matches issues_reports/links_* files (crawl depth, outlinks, anchor quality, etc.)
  static filenamePattern = 'links_';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const crawlDepthCol = this.findColumn(['Crawl Depth', 'Depth']);
    const inlinksCol = this.findColumn(['Inlinks', 'Unique Inlinks']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};
    const urls: string[] = [];

    let maxDepth = 0;

    for (let i = 0; i < this.data.length; i++) {
      if (addressCol) {
        const url = toString(this.data[i][addressCol]);
        if (url) urls.push(url);
      }
      if (crawlDepthCol) {
        const depth = toNumber(this.data[i][crawlDepthCol]);
        if (depth !== null && depth > maxDepth) maxDepth = depth;
      }
    }

    if (maxDepth > 0) stats.max_crawl_depth = maxDepth;

    issues.push({
      type: 'links_quality_issue',
      severity: 'warning',
      count: this.length,
      description: `${this.length} page(s) with link quality issues`,
      urls,
    });

    return {
      total_pages: this.length,
      stats: Object.keys(stats).length > 0 ? stats : undefined,
      issues,
    };
  }
}

export class ExternalLinksParser extends BaseParser {
  static filenamePattern = 'all_outlinks';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const destCol = this.findColumn(['Destination', 'To', 'Target']);
    const statusCol = this.findColumn(['Status Code', 'Status']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    // Broken external links
    if (statusCol && destCol) {
      const brokenUrls: string[] = [];
      let brokenCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const status = toNumber(this.data[i][statusCol]);
        if (status !== null && status >= 400 && status < 600) {
          brokenCount++;
          brokenUrls.push(toString(this.data[i][destCol]));
        }
      }

      stats.broken_external_links = brokenCount;
      if (brokenCount > 0) {
        issues.push({
          type: 'broken_external_links',
          severity: 'warning',
          count: brokenCount,
          description: `${brokenCount} broken external links`,
          urls: brokenUrls,
        });
      }
    }

    return {
      total_external_links: this.length,
      stats,
      issues,
    };
  }
}
