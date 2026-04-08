import { BaseParser } from '../base.parser';
import { ParsedData } from '../../types';

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export class PageSpeedOpportunitiesParser extends BaseParser {
  static filenamePattern = 'pagespeed_opportunities_summary';
  static displayName = 'PageSpeed Opportunities';

  parse(): ParsedData {
    if (this.isEmpty) return { pagespeed_opportunities: [] };

    const opportunityCol = this.findColumn(['Opportunity']);
    const urlsAffectedCol = this.findColumn(['Number of URLs Affected']);
    const totalSavingsMsCol = this.findColumn(['Total Savings ms']);
    const avgSavingsMsCol = this.findColumn(['Average Savings ms']);
    const totalSavingsBytesCol = this.findColumn(['Total Savings Size Bytes']);

    const opportunities: Array<{
      opportunity: string;
      urls_affected: number;
      total_savings_ms: number;
      average_savings_ms: number;
      total_savings_size_bytes: number;
    }> = [];

    for (const row of this.data) {
      const urls_affected = toInt(urlsAffectedCol ? row[urlsAffectedCol] : 0);
      if (urls_affected === 0) continue;

      const opportunity = String(opportunityCol ? (row[opportunityCol] ?? '') : '');
      const total_savings_ms = toInt(totalSavingsMsCol ? row[totalSavingsMsCol] : 0);
      const average_savings_ms = toInt(avgSavingsMsCol ? row[avgSavingsMsCol] : 0);
      const total_savings_size_bytes = toInt(totalSavingsBytesCol ? row[totalSavingsBytesCol] : 0);

      opportunities.push({
        opportunity,
        urls_affected,
        total_savings_ms,
        average_savings_ms,
        total_savings_size_bytes,
      });
    }

    opportunities.sort((a, b) => b.total_savings_ms - a.total_savings_ms);

    return { pagespeed_opportunities: opportunities };
  }
}
