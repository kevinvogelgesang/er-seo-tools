import { BaseParser } from '../base.parser';
import { toString } from '../../utils/columnMapper';
import { ParsedData } from '../../types';

const REQUIRED_HEADERS = ['Number of Keywords', 'Adwords Positions'];

function parseIntWithCommas(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const str = String(value).replace(/,/g, '');
  const parsed = parseInt(str, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseFloatStrip(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const str = String(value).replace(/%/g, '').replace(/,/g, '');
  const parsed = parseFloat(str);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface SemrushOrganicPagesResult extends ParsedData {
  top_pages_by_organic_traffic: Array<{
    url: string;
    estimated_monthly_traffic: number;
    keyword_count: number;
    traffic_share_pct: number;
    dominant_intent: string;
  }>;
}

export class SemrushOrganicPagesParser extends BaseParser {
  static filenamePattern = '';
  static displayName = 'SEMRush Organic Pages';

  static matchesContent(headers: string[]): boolean {
    if (headers.length === 0) return false;
    return REQUIRED_HEADERS.every(required => headers.includes(required));
  }

  parse(): SemrushOrganicPagesResult {
    if (this.isEmpty) {
      return { top_pages_by_organic_traffic: [] };
    }

    const urlCol = this.findColumn(['URL']);
    const trafficShareCol = this.findColumn(['Traffic (%)']);
    const keywordCountCol = this.findColumn(['Number of Keywords']);
    const trafficCol = this.findColumn(['Traffic']);

    // Find intent columns: headers containing "intents" (case-insensitive)
    const intentColumns = this.headers.filter(h => h.toLowerCase().includes('intents'));

    const pages = this.data.map(row => {
      const url = toString(urlCol ? row[urlCol] : null);
      const traffic_share_pct = parseFloatStrip(trafficShareCol ? row[trafficShareCol] : null);
      const keyword_count = parseIntWithCommas(keywordCountCol ? row[keywordCountCol] : null);
      const estimated_monthly_traffic = parseIntWithCommas(trafficCol ? row[trafficCol] : null);

      // Determine dominant intent
      let dominant_intent = 'unknown';
      if (intentColumns.length > 0) {
        let maxVal = -Infinity;
        let maxCol = '';
        for (const col of intentColumns) {
          const val = parseIntWithCommas(row[col]);
          if (val > maxVal) {
            maxVal = val;
            maxCol = col;
          }
        }
        if (maxCol) {
          // Extract intent name from column header, e.g. "Intents - Informational" → "Informational"
          const dashIdx = maxCol.lastIndexOf('-');
          if (dashIdx !== -1) {
            dominant_intent = maxCol.slice(dashIdx + 1).trim();
          } else {
            dominant_intent = maxCol.trim();
          }
        }
      }

      return { url, estimated_monthly_traffic, keyword_count, traffic_share_pct, dominant_intent };
    });

    // Sort by estimated_monthly_traffic descending, take top 20
    pages.sort((a, b) => b.estimated_monthly_traffic - a.estimated_monthly_traffic);

    return { top_pages_by_organic_traffic: pages.slice(0, 20) };
  }
}
