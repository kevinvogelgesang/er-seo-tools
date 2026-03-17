import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toString } from '../../utils/columnMapper';

export class H2Parser extends BaseParser {
  static filenamePattern = 'h2';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const h2Col = this.findColumn(['H2-1', 'H2']);

    const indexableMask = this.getIndexableHtmlMask();
    const hasIndexable = indexableMask.some(Boolean);
    const mask = hasIndexable ? indexableMask : this.getSeoRelevantMask(addressCol);

    const issues: Issue[] = [];
    const totalPages = this.countMask(mask);

    // Missing H2
    if (h2Col) {
      const missingUrls: string[] = [];
      let missingCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const h2 = toString(this.data[i][h2Col]);
        if (!h2) {
          missingCount++;
          if (addressCol && missingUrls.length < 20) {
            missingUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (missingCount > 0) {
        issues.push({
          type: 'missing_h2',
          severity: 'notice',
          count: missingCount,
          description: `${missingCount} pages missing H2 headings`,
          urls: missingUrls,
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
