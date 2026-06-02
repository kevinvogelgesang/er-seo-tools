import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class UrlIssuesParser extends BaseParser {
  static parserKey = 'urlissues';
  static filenamePattern = 'url_';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const lengthCol = this.findColumn(['Length', 'URL Length', 'Char Count']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};
    const urls: string[] = [];

    let totalLength = 0;
    let lengthCounted = 0;

    for (let i = 0; i < this.data.length; i++) {
      if (addressCol && urls.length < 30) {
        const url = toString(this.data[i][addressCol]);
        if (url) urls.push(url);
      }
      if (lengthCol) {
        const len = toNumber(this.data[i][lengthCol]);
        if (len !== null) {
          totalLength += len;
          lengthCounted++;
        }
      }
    }

    if (lengthCounted > 0) {
      stats.avg_url_length = Math.round(totalLength / lengthCounted);
    }

    issues.push({
      type: 'url_issues',
      severity: 'warning',
      count: this.length,
      description: `${this.length} URL(s) with structural issues`,
      urls,
    });

    return {
      total_urls: this.length,
      stats: Object.keys(stats).length > 0 ? stats : undefined,
      issues,
    };
  }
}
