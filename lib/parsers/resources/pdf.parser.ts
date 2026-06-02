import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class PDFParser extends BaseParser {
  static parserKey = 'pdf';
  static filenamePattern = 'pdf';

  private static LARGE_PDF_SIZE = 5 * 1024 * 1024; // 5MB

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const sizeCol = this.findColumn(['Size (Bytes)', 'Size', 'File Size']);
    const statusCol = this.findColumn(['Status Code', 'Status']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    // Large PDFs
    if (sizeCol) {
      const largeUrls: string[] = [];
      let largeCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const size = toNumber(this.data[i][sizeCol]);
        if (size !== null && size > PDFParser.LARGE_PDF_SIZE) {
          largeCount++;
          if (addressCol && largeUrls.length < 30) {
            largeUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      stats.large_pdfs = largeCount;
      if (largeCount > 0) {
        issues.push({
          type: 'large_pdfs',
          severity: 'notice',
          count: largeCount,
          description: `${largeCount} large PDFs (> 5MB)`,
          urls: largeUrls,
        });
      }
    }

    // Broken PDFs
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

      stats.broken_pdfs = brokenCount;
      if (brokenCount > 0) {
        issues.push({
          type: 'broken_pdfs',
          severity: 'warning',
          count: brokenCount,
          description: `${brokenCount} broken PDF links`,
          urls: brokenUrls,
        });
      }
    }

    return {
      total_pdfs: this.length,
      stats,
      issues,
    };
  }
}
