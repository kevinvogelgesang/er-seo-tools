import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class JavaScriptParser extends BaseParser {
  static parserKey = 'javascript';
  static filenamePattern = ['javascript_all', 'javascript'];

  private static LARGE_JS_SIZE = 100 * 1024; // 100KB

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const sizeCol = this.findColumn(['Size (Bytes)', 'Size', 'File Size']);
    const statusCol = this.findColumn(['Status Code', 'Status']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    // Large JS files
    if (sizeCol) {
      const largeUrls: string[] = [];
      let largeCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const size = toNumber(this.data[i][sizeCol]);
        if (size !== null && size > JavaScriptParser.LARGE_JS_SIZE) {
          largeCount++;
          if (addressCol && largeUrls.length < 30) {
            largeUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      stats.large_js_files = largeCount;
      if (largeCount > 0) {
        issues.push({
          type: 'large_js_files',
          severity: 'warning',
          count: largeCount,
          description: `${largeCount} large JavaScript files (> 100KB)`,
          urls: largeUrls,
        });
      }
    }

    // Broken JS
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

      stats.broken_js = brokenCount;
      if (brokenCount > 0) {
        issues.push({
          type: 'broken_js',
          severity: 'critical',
          count: brokenCount,
          description: `${brokenCount} broken JavaScript files`,
          urls: brokenUrls,
        });
      }
    }

    return {
      total_js_files: this.length,
      stats,
      issues,
    };
  }
}
