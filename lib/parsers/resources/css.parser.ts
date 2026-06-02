import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class CSSParser extends BaseParser {
  static parserKey = 'css';
  static filenamePattern = ['internal_css', 'css'];

  private static LARGE_CSS_SIZE = 100 * 1024; // 100KB

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const sizeCol = this.findColumn(['Size (Bytes)', 'Size', 'File Size']);
    const statusCol = this.findColumn(['Status Code', 'Status']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    // Large CSS files
    if (sizeCol) {
      const largeUrls: string[] = [];
      let largeCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const size = toNumber(this.data[i][sizeCol]);
        if (size !== null && size > CSSParser.LARGE_CSS_SIZE) {
          largeCount++;
          if (addressCol && largeUrls.length < 30) {
            largeUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      stats.large_css_files = largeCount;
      if (largeCount > 0) {
        issues.push({
          type: 'large_css_files',
          severity: 'notice',
          count: largeCount,
          description: `${largeCount} large CSS files (> 100KB)`,
          urls: largeUrls,
        });
      }
    }

    // Broken CSS
    if (statusCol) {
      const brokenUrls: string[] = [];
      let brokenCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const status = toNumber(this.data[i][statusCol]);
        if (status !== null && status >= 400 && status < 600) {
          brokenCount++;
          if (addressCol && brokenUrls.length < 30) {
            brokenUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      stats.broken_css = brokenCount;
      if (brokenCount > 0) {
        issues.push({
          type: 'broken_css',
          severity: 'warning',
          count: brokenCount,
          description: `${brokenCount} broken CSS files`,
          urls: brokenUrls,
        });
      }
    }

    return {
      total_css_files: this.length,
      stats,
      issues,
    };
  }
}
