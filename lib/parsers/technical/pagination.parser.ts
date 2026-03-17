import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toString } from '../../utils/columnMapper';

export class PaginationParser extends BaseParser {
  static filenamePattern = 'pagination';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const indexabilityCol = this.findColumn(['Indexability']);

    const issues: Issue[] = [];
    const urls: string[] = [];

    let nonIndexableCount = 0;

    for (let i = 0; i < this.data.length; i++) {
      if (addressCol && urls.length < 30) {
        const url = toString(this.data[i][addressCol]);
        if (url) urls.push(url);
      }
      if (indexabilityCol) {
        const idx = toString(this.data[i][indexabilityCol]).toLowerCase();
        if (idx === 'non-indexable') nonIndexableCount++;
      }
    }

    if (nonIndexableCount > 0) {
      issues.push({
        type: 'pagination_non_indexable',
        severity: 'warning',
        count: nonIndexableCount,
        description: `${nonIndexableCount} non-indexable pagination pages`,
      });
    }

    if (this.length > 0) {
      issues.push({
        type: 'pagination_issues',
        severity: 'notice',
        count: this.length,
        description: `${this.length} pagination issue(s) detected`,
        urls: nonIndexableCount > 0 ? undefined : urls,
      });
    }

    return {
      total_pages: this.length,
      issues,
    };
  }
}
