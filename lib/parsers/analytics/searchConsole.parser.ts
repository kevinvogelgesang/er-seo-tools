import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class SearchConsoleParser extends BaseParser {
  static filenamePattern = 'search_console';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const clicksCol = this.findColumn(['Clicks', 'GSC Clicks']);
    const impressionsCol = this.findColumn(['Impressions', 'GSC Impressions']);
    const ctrCol = this.findColumn(['CTR', 'GSC CTR', 'Click Through Rate']);
    const positionCol = this.findColumn(['Position', 'GSC Position', 'Average Position']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    let totalClicks = 0;
    let totalImpressions = 0;

    // Calculate clicks
    if (clicksCol) {
      for (let i = 0; i < this.data.length; i++) {
        const clicks = toNumber(this.data[i][clicksCol]);
        if (clicks !== null) totalClicks += clicks;
      }
      stats.total_clicks = totalClicks;
    }

    // Calculate impressions and find low CTR opportunities
    if (impressionsCol) {
      const lowCtrUrls: string[] = [];
      let lowCtrCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const impressions = toNumber(this.data[i][impressionsCol]);
        if (impressions !== null) {
          totalImpressions += impressions;

          // Low CTR opportunities: high impressions (> 100) but low CTR (< 2%)
          if (impressions > 100 && clicksCol) {
            const clicks = toNumber(this.data[i][clicksCol]) || 0;
            const ctr = impressions > 0 ? clicks / impressions : 0;
            if (ctr < 0.02) {
              lowCtrCount++;
              if (addressCol && lowCtrUrls.length < 20) {
                lowCtrUrls.push(toString(this.data[i][addressCol]));
              }
            }
          }
        }
      }

      stats.total_impressions = totalImpressions;

      // Calculate avg CTR from totals
      if (totalImpressions > 0) {
        stats.avg_ctr = Math.round((totalClicks / totalImpressions) * 10000) / 10000;
      }

      if (lowCtrCount > 0) {
        issues.push({
          type: 'low_ctr_opportunities',
          severity: 'notice',
          count: lowCtrCount,
          description: `${lowCtrCount} pages with high impressions but low CTR (< 2%)`,
          urls: lowCtrUrls,
        });
      }
    }

    // Calculate average position
    if (positionCol) {
      let totalPosition = 0;
      let positionCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const position = toNumber(this.data[i][positionCol]);
        if (position !== null && position > 0) {
          totalPosition += position;
          positionCount++;
        }
      }

      if (positionCount > 0) {
        stats.avg_position = Math.round((totalPosition / positionCount) * 10) / 10;
      }
    }

    return {
      total_pages: this.length,
      stats,
      issues,
    };
  }
}
