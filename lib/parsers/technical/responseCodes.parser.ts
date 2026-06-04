import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class ResponseCodesParser extends BaseParser {
  static parserKey = 'responsecodes';
  static filenamePattern = ['response_codes_all', 'response_codes'];

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const statusCol = this.findColumn(['Status Code', 'Status']);

    // Optional internal-scope column. SF response-code exports may carry an
    // `Internal` boolean column. Tri-state so an unrelated column (or blank
    // cell) never silently zeroes the count:
    //   recognized external/false → exclude; recognized internal/true → include;
    //   unrecognized/blank → include (legacy). External 4xx are covered by
    //   broken_external_links, so excluding them here is correct.
    // ('Type' is intentionally NOT a candidate: real SF response-code exports
    // only carry `Redirect Type` (HTTP vs JS redirect), which is unrelated to
    // internal/external scope.)
    const scopeCol = this.findColumn(['Internal']);
    const isInternalRow = (row: Record<string, unknown>): boolean => {
      if (!scopeCol) return true; // no scope column → count all (legacy)
      const v = toString(row[scopeCol]).trim().toLowerCase();
      if (v === 'false' || v === 'external' || v === 'no' || v === '0') return false;
      // 'true'/'internal'/'yes'/'1' and any unrecognized/blank value → include
      return true;
    };

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
          if (!isInternalRow(this.data[i])) continue;
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
