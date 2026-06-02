import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class ResponseTimeParser extends BaseParser {
  static parserKey = 'responsetime';
  static filenamePattern = 'response_time';

  private static TTFB_GOOD = 200; // ms
  private static TTFB_POOR = 600; // ms

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const ttfbCol = this.findColumn(['Response Time', 'TTFB', 'Time to First Byte', 'Response Time (ms)']);
    const downloadCol = this.findColumn(['Download Time', 'Download Time (ms)']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    // TTFB analysis
    if (ttfbCol) {
      let totalTtfb = 0;
      let maxTtfb = 0;
      let ttfbCount = 0;
      let slowCount = 0;
      const slowUrls: string[] = [];

      for (let i = 0; i < this.data.length; i++) {
        const ttfb = toNumber(this.data[i][ttfbCol]);
        if (ttfb !== null) {
          totalTtfb += ttfb;
          ttfbCount++;
          if (ttfb > maxTtfb) maxTtfb = ttfb;

          if (ttfb > ResponseTimeParser.TTFB_POOR) {
            slowCount++;
            if (addressCol && slowUrls.length < 30) {
              slowUrls.push(toString(this.data[i][addressCol]));
            }
          }
        }
      }

      if (ttfbCount > 0) {
        stats.avg_response_time_ms = Math.round(totalTtfb / ttfbCount);
        stats.max_response_time_ms = Math.round(maxTtfb);

        if (slowCount > 0) {
          issues.push({
            type: 'slow_server_response',
            severity: 'warning',
            count: slowCount,
            description: `${slowCount} pages with slow server response (> 600ms TTFB)`,
            urls: slowUrls,
          });
        }
      }
    }

    return {
      total_pages: this.length,
      stats: Object.keys(stats).length > 0 ? stats : undefined,
      issues,
    };
  }
}
