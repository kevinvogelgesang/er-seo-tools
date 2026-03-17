import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toString } from '../../utils/columnMapper';

export class SecurityParser extends BaseParser {
  static filenamePattern = 'security';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const httpsCol = this.findColumn(['HTTPS', 'Protocol']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    // Insecure pages (HTTP)
    if (httpsCol || addressCol) {
      const insecureUrls: string[] = [];
      let insecureCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const url = addressCol ? toString(this.data[i][addressCol]) : '';
        const https = httpsCol ? toString(this.data[i][httpsCol]).toLowerCase() : '';

        const isInsecure = url.startsWith('http://') || https === 'no' || https === 'false';
        if (isInsecure) {
          insecureCount++;
          if (insecureUrls.length < 30) {
            insecureUrls.push(url);
          }
        }
      }

      stats.insecure_pages = insecureCount;
      if (insecureCount > 0) {
        issues.push({
          type: 'insecure_pages',
          severity: 'critical',
          count: insecureCount,
          description: `${insecureCount} pages served over insecure HTTP`,
          urls: insecureUrls,
        });
      }
    }

    return {
      total_pages: this.length,
      stats,
      issues,
    };
  }
}

export class InsecureContentParser extends BaseParser {
  static filenamePattern = 'insecure';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const pageCol = this.findColumn(['Page', 'Address', 'URL']);
    const resourceCol = this.findColumn(['Resource', 'Insecure URL']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    // Mixed content
    if (this.length > 0) {
      const mixedUrls: string[] = [];
      const uniquePages = new Set<string>();

      for (let i = 0; i < this.data.length; i++) {
        const page = pageCol ? toString(this.data[i][pageCol]) : '';
        if (page && !uniquePages.has(page)) {
          uniquePages.add(page);
          if (mixedUrls.length < 30) {
            mixedUrls.push(page);
          }
        }
      }

      stats.mixed_content_pages = uniquePages.size;
      stats.insecure_resources = this.length;

      if (uniquePages.size > 0) {
        issues.push({
          type: 'mixed_content',
          severity: 'warning',
          count: uniquePages.size,
          description: `${uniquePages.size} HTTPS pages loading insecure HTTP resources`,
          urls: mixedUrls,
        });
      }
    }

    return {
      total_insecure_resources: this.length,
      stats,
      issues,
    };
  }
}
