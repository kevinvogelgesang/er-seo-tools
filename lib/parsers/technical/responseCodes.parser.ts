import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class ResponseCodesParser extends BaseParser {
  static filenamePattern = 'response_codes';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const statusCol = this.findColumn(['Status Code', 'Status']);

    const issues: Issue[] = [];
    const distribution: Record<string, number> = {};

    if (statusCol) {
      const clientErrorUrls: string[] = [];
      const serverErrorUrls: string[] = [];
      let clientCount = 0;
      let serverCount = 0;
      let redirectCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const code = toNumber(this.data[i][statusCol]);
        if (code === null) continue;

        const codeStr = String(code);
        distribution[codeStr] = (distribution[codeStr] || 0) + 1;

        if (code >= 400 && code < 500) {
          clientCount++;
          if (addressCol && clientErrorUrls.length < 30) {
            clientErrorUrls.push(toString(this.data[i][addressCol]));
          }
        } else if (code >= 500 && code < 600) {
          serverCount++;
          if (addressCol && serverErrorUrls.length < 30) {
            serverErrorUrls.push(toString(this.data[i][addressCol]));
          }
        } else if (code >= 300 && code < 400) {
          redirectCount++;
        }
      }

      if (clientCount > 0) {
        issues.push({
          type: 'client_errors_4xx',
          severity: 'critical',
          count: clientCount,
          description: `${clientCount} pages returning 4xx client errors`,
          urls: clientErrorUrls,
        });
      }

      if (serverCount > 0) {
        issues.push({
          type: 'server_errors_5xx',
          severity: 'critical',
          count: serverCount,
          description: `${serverCount} pages returning 5xx server errors`,
          urls: serverErrorUrls,
        });
      }

      if (redirectCount > 0) {
        issues.push({
          type: 'redirects_3xx',
          severity: 'notice',
          count: redirectCount,
          description: `${redirectCount} redirecting URLs`,
        });
      }
    }

    return {
      total_urls: this.length,
      issues,
      distribution,
    };
  }
}
