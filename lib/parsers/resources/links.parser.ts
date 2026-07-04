import { StreamingParser } from '../streaming-parser.base';
import { ParsedData, Issue, CSVRow } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class LinksIssuesParser extends StreamingParser {
  static parserKey = 'linksissues';
  static filenamePattern = 'links_';

  private addressCol: string | null = null;
  private crawlDepthCol: string | null = null;
  private urls: string[] = [];
  private maxDepth = 0;

  protected onHeaders(): void {
    this.addressCol = this.findColumn(['Address', 'URL']);
    this.crawlDepthCol = this.findColumn(['Crawl Depth', 'Depth']);
  }

  protected consumeRow(row: CSVRow): void {
    if (this.addressCol) {
      const url = toString(row[this.addressCol]);
      if (url) this.urls.push(url);
    }
    if (this.crawlDepthCol) {
      const depth = toNumber(row[this.crawlDepthCol]);
      if (depth !== null && depth > this.maxDepth) this.maxDepth = depth;
    }
  }

  finalize(): ParsedData {
    if (this.isEmpty) return {};
    const stats: Record<string, number> = {};
    if (this.maxDepth > 0) stats.max_crawl_depth = this.maxDepth;
    const issues: Issue[] = [{
      type: 'links_quality_issue',
      severity: 'warning',
      count: this.length,
      description: `${this.length} page(s) with link quality issues`,
      urls: this.urls,
    }];
    return {
      total_pages: this.length,
      stats: Object.keys(stats).length > 0 ? stats : undefined,
      issues,
    };
  }
}

export class ExternalLinksParser extends StreamingParser {
  static parserKey = 'externallinks';
  static filenamePattern = 'all_outlinks';

  private destCol: string | null = null;
  private statusCol: string | null = null;
  private brokenUrls: string[] = [];
  private brokenCount = 0;

  protected onHeaders(): void {
    this.destCol = this.findColumn(['Destination', 'To', 'Target']);
    this.statusCol = this.findColumn(['Status Code', 'Status']);
  }

  protected consumeRow(row: CSVRow): void {
    if (this.statusCol && this.destCol) {
      const status = toNumber(row[this.statusCol]);
      if (status !== null && status >= 400 && status < 600) {
        this.brokenCount++;
        this.brokenUrls.push(toString(row[this.destCol]));
      }
    }
  }

  finalize(): ParsedData {
    if (this.isEmpty) return {};
    const issues: Issue[] = [];
    const stats: Record<string, number> = {};
    if (this.statusCol && this.destCol) {
      stats.broken_external_links = this.brokenCount;
      if (this.brokenCount > 0) {
        issues.push({
          type: 'broken_external_links',
          severity: 'warning',
          count: this.brokenCount,
          description: `${this.brokenCount} broken external links`,
          urls: this.brokenUrls,
        });
      }
    }
    return { total_external_links: this.length, stats, issues };
  }
}
