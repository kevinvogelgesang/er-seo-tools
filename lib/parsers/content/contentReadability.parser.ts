import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class ContentReadabilityParser extends BaseParser {
  static filenamePattern = 'readability';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const wordCountCol = this.findColumn(['Word Count', 'Words']);
    const indexabilityCol = this.findColumn(['Indexability']);

    const issues: Issue[] = [];
    const urls: string[] = [];

    for (let i = 0; i < this.data.length && urls.length < 30; i++) {
      if (addressCol) {
        const url = toString(this.data[i][addressCol]);
        if (url) urls.push(url);
      }
    }

    issues.push({
      type: 'readability_issue',
      severity: 'notice',
      count: this.length,
      description: `${this.length} pages with readability issues`,
      urls,
    });

    return {
      total_pages: this.length,
      issues,
    };
  }
}

export class LowContentParser extends BaseParser {
  static filenamePattern = 'low_content';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const wordCountCol = this.findColumn(['Word Count', 'Words']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};
    const urls: string[] = [];

    let totalWords = 0;
    let counted = 0;

    for (let i = 0; i < this.data.length; i++) {
      if (addressCol && urls.length < 30) {
        const url = toString(this.data[i][addressCol]);
        if (url) urls.push(url);
      }
      if (wordCountCol) {
        const wc = toNumber(this.data[i][wordCountCol]);
        if (wc !== null) {
          totalWords += wc;
          counted++;
        }
      }
    }

    if (counted > 0) {
      stats.avg_word_count = Math.round(totalWords / counted);
    }

    issues.push({
      type: 'low_content_pages',
      severity: 'warning',
      count: this.length,
      description: `${this.length} pages with low word count`,
      urls,
    });

    return {
      total_pages: this.length,
      stats: Object.keys(stats).length > 0 ? stats : undefined,
      issues,
    };
  }
}
