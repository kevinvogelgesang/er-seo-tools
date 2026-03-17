import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toString } from '../../utils/columnMapper';

export class H1Parser extends BaseParser {
  static filenamePattern = 'h1';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const h1Col = this.findColumn(['H1-1', 'H1']);
    const h1_2Col = this.findColumn(['H1-2']);

    const indexableMask = this.getIndexableHtmlMask();
    const hasIndexable = indexableMask.some(Boolean);
    const mask = hasIndexable ? indexableMask : this.getSeoRelevantMask(addressCol);

    const issues: Issue[] = [];
    const totalPages = this.countMask(mask);

    // Missing H1
    if (h1Col) {
      const missingUrls: string[] = [];
      let missingCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const h1 = toString(this.data[i][h1Col]);
        if (!h1) {
          missingCount++;
          if (addressCol && missingUrls.length < 20) {
            missingUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (missingCount > 0) {
        issues.push({
          type: 'missing_h1',
          severity: 'warning',
          count: missingCount,
          description: `${missingCount} pages missing H1 headings`,
          urls: missingUrls,
        });
      }
    }

    // Duplicate H1s across pages
    if (h1Col) {
      const h1Counts: Record<string, number> = {};
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const h1 = toString(this.data[i][h1Col]);
        if (h1) {
          h1Counts[h1] = (h1Counts[h1] || 0) + 1;
        }
      }

      const duplicates = Object.entries(h1Counts)
        .filter(([_, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      if (duplicates.length > 0) {
        issues.push({
          type: 'duplicate_h1',
          severity: 'notice',
          count: duplicates.length,
          description: `${duplicates.length} groups of pages with duplicate H1 headings`,
          groups: duplicates.map(([h1, count]) => ({
            h1: h1.slice(0, 100),
            count,
          })),
        });
      }
    }

    // Multiple H1s on same page
    if (h1_2Col) {
      const multipleUrls: string[] = [];
      let multipleCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const h1_2 = toString(this.data[i][h1_2Col]).trim();
        if (h1_2) {
          multipleCount++;
          if (addressCol && multipleUrls.length < 20) {
            multipleUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (multipleCount > 0) {
        issues.push({
          type: 'multiple_h1',
          severity: 'warning',
          count: multipleCount,
          description: `${multipleCount} pages with multiple H1 headings`,
          urls: multipleUrls,
        });
      }
    }

    return {
      total_pages: totalPages,
      excluded_urls: this.length - totalPages,
      issues,
    };
  }
}
