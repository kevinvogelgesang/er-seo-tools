import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class RedirectsParser extends BaseParser {
  static parserKey = 'redirects';
  static filenamePattern = 'redirects';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const statusCol = this.findColumn(['Status Code', 'Status']);

    const issues: Issue[] = [];
    const types: Record<string, number> = {};

    if (statusCol) {
      const tempRedirectUrls: string[] = [];
      let tempCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const status = toNumber(this.data[i][statusCol]);
        if (status !== null) {
          const statusStr = String(status);
          types[statusStr] = (types[statusStr] || 0) + 1;

          if (status === 302) {
            tempCount++;
            if (addressCol && tempRedirectUrls.length < 30) {
              tempRedirectUrls.push(toString(this.data[i][addressCol]));
            }
          }
        }
      }

      if (tempCount > 0) {
        issues.push({
          type: 'temporary_redirects',
          severity: 'notice',
          count: tempCount,
          description: `${tempCount} temporary (302) redirects - consider 301 for permanent moves`,
          urls: tempRedirectUrls,
        });
      }
    }

    return {
      total_redirects: this.length,
      issues,
      types,
    };
  }
}
