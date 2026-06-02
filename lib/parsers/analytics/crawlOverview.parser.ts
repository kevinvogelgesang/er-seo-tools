import Papa from 'papaparse';
import { BaseParser } from '../base.parser';
import { ParsedData } from '../../types';

/**
 * Parser for crawl_overview.csv - special key-value format file
 * This file has a different format than other CSVs (key-value pairs, not tabular data)
 */
export class CrawlOverviewParser extends BaseParser {
  static parserKey = 'crawloverview';
  private kvData: string[][] = [];

  static filenamePattern = 'crawl_overview';

  constructor(csvContent: string) {
    // Call parent constructor with empty content to initialize
    super('');
    // Parse as key-value format instead
    this.parseKeyValueCSV(csvContent);
  }

  private parseKeyValueCSV(content: string): void {
    const result = Papa.parse<string[]>(content, {
      header: false, // No header for key-value format
      skipEmptyLines: true,
    });
    this.kvData = result.data;
  }

  parse(): ParsedData {
    if (this.kvData.length === 0) return {};

    const crawlInfo: Record<string, string> = {};
    const summary: Record<string, number> = {};

    for (const row of this.kvData) {
      if (row.length < 2) continue;

      const key = String(row[0] || '').trim();
      const value = String(row[1] || '').trim();

      if (!key) continue;

      // Extract crawl metadata
      switch (key) {
        case 'Site Crawled':
          crawlInfo.site = value;
          break;
        case 'Start Date':
          crawlInfo.start_date = value;
          break;
        case 'Start Time':
          crawlInfo.start_time = value;
          break;
        case 'Elapsed':
          crawlInfo.duration = value;
          break;
        case 'Total URLs Crawled':
          summary.total_crawled = this.parseIntValue(value);
          break;
        case 'Total Internal URLs':
          summary.internal_urls = this.parseIntValue(value);
          break;
        case 'Total External URLs':
          summary.external_urls = this.parseIntValue(value);
          break;
        case 'Total Internal Indexable URLs':
          summary.indexable_urls = this.parseIntValue(value);
          break;
        case 'Total Internal Non-Indexable URLs':
          summary.non_indexable_urls = this.parseIntValue(value);
          break;
        case 'Total Internal HTML':
          summary.html_urls = this.parseIntValue(value);
          break;
        case 'Total Internal JavaScript':
          summary.javascript_urls = this.parseIntValue(value);
          break;
        case 'Total Internal CSS':
          summary.css_urls = this.parseIntValue(value);
          break;
        case 'Total Internal Images':
          summary.image_urls = this.parseIntValue(value);
          break;
        case 'Total Internal PDFs':
          summary.pdf_urls = this.parseIntValue(value);
          break;
      }
    }

    return {
      crawl_info: crawlInfo,
      summary,
      issues: [],
    };
  }

  private parseIntValue(value: string): number {
    // Handle commas in numbers
    const cleaned = value.replace(/,/g, '');
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  }
}
