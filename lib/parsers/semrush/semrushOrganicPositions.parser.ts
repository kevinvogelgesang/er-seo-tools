import { BaseParser } from '../base.parser';
import { toString } from '../../utils/columnMapper';
import { ParsedData } from '../../types';

const REQUIRED_HEADERS = ['Keyword', 'Search Volume', 'Keyword Intents', 'URL'];

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

function primaryIntent(raw: unknown): string {
  const str = toString(raw);
  if (!str) return '';
  return str.split('|')[0].trim();
}

export interface SemrushOrganicResult extends ParsedData {
  total_ranking_keywords: number;
  keyword_cannibalization: Array<{
    keyword: string;
    search_volume: number;
    intent: string;
    competing_urls: Array<{
      url: string;
      position: number;
      estimated_traffic: number;
    }>;
  }>;
  quick_wins: Array<{
    keyword: string;
    position: number;
    search_volume: number;
    intent: string;
    url: string;
  }>;
  per_url_keyword_data: Array<{ url: string; keywords: Array<{ keyword: string; position: number; search_volume: number }> }>;
}

export class SemrushOrganicPositionsParser extends BaseParser {
  static filenamePattern = '';
  static displayName = 'SEMRush Organic Positions';

  static matchesContent(headers: string[]): boolean {
    if (headers.length === 0) return false;
    return REQUIRED_HEADERS.every(required => headers.includes(required));
  }

  parse(): SemrushOrganicResult {
    if (this.isEmpty) {
      return {
        total_ranking_keywords: 0,
        keyword_cannibalization: [],
        quick_wins: [],
        per_url_keyword_data: [],
      };
    }

    const keywordCol = this.findColumn(['Keyword']);
    const urlCol = this.findColumn(['URL']);
    const positionCol = this.findColumn(['Position']);
    const searchVolumeCol = this.findColumn(['Search Volume']);
    const trafficCol = this.findColumn(['Traffic']);
    const intentsCol = this.findColumn(['Keyword Intents']);

    // Group rows by keyword (for cannibalization) and by URL (for per_url_keyword_data)
    const keywordMap = new Map<string, Array<{
      url: string;
      position: number;
      search_volume: number;
      traffic: number;
      intent: string;
    }>>();

    const urlMap = new Map<string, Array<{
      keyword: string;
      position: number;
      search_volume: number;
      traffic: number;
    }>>();

    const quick_wins_raw: Array<{
      keyword: string;
      position: number;
      search_volume: number;
      intent: string;
      url: string;
    }> = [];

    for (const row of this.data) {
      const keyword = toString(keywordCol ? row[keywordCol] : null);
      const url = toString(urlCol ? row[urlCol] : null);
      if (!keyword || !url) continue;

      const position = parseIntWithCommas(positionCol ? row[positionCol] : null);
      const search_volume = parseIntWithCommas(searchVolumeCol ? row[searchVolumeCol] : null);
      const traffic = parseIntWithCommas(trafficCol ? row[trafficCol] : null);
      const intent = primaryIntent(intentsCol ? row[intentsCol] : null);

      // Accumulate for keyword cannibalization
      if (!keywordMap.has(keyword)) keywordMap.set(keyword, []);
      keywordMap.get(keyword)!.push({ url, position, search_volume, traffic, intent });

      // Accumulate for per_url_keyword_data
      if (!urlMap.has(url)) urlMap.set(url, []);
      urlMap.get(url)!.push({ keyword, position, search_volume, traffic });

      // Quick wins: position 11–20 AND search_volume >= 100
      if (position >= 11 && position <= 20 && search_volume >= 100) {
        quick_wins_raw.push({ keyword, position, search_volume, intent, url });
      }
    }

    // Cannibalization: keywords with 2+ distinct URLs
    const keyword_cannibalization: SemrushOrganicResult['keyword_cannibalization'] = [];
    for (const [keyword, rows] of keywordMap) {
      const uniqueUrls = new Map<string, typeof rows[0]>();
      for (const row of rows) {
        if (!uniqueUrls.has(row.url)) uniqueUrls.set(row.url, row);
      }
      if (uniqueUrls.size >= 2) {
        const firstRow = rows[0];
        const competing_urls = [...uniqueUrls.values()]
          .sort((a, b) => a.position - b.position)
          .map(r => ({ url: r.url, position: r.position, estimated_traffic: r.traffic }));

        keyword_cannibalization.push({
          keyword,
          search_volume: firstRow.search_volume,
          intent: firstRow.intent,
          competing_urls,
        });
      }
    }
    keyword_cannibalization.sort((a, b) => b.search_volume - a.search_volume);

    // Quick wins sorted by search_volume descending
    quick_wins_raw.sort((a, b) => b.search_volume - a.search_volume);

    // per_url_keyword_data: top 3 by traffic descending
    const per_url_keyword_data = Array.from(urlMap.entries()).map(([url, rows]) => {
      const keywords = rows
        .sort((a, b) => b.traffic - a.traffic)
        .slice(0, 3)
        .map(r => ({ keyword: r.keyword, position: r.position, search_volume: r.search_volume }));
      return { url, keywords };
    });

    return {
      total_ranking_keywords: this.data.length,
      keyword_cannibalization,
      quick_wins: quick_wins_raw,
      per_url_keyword_data,
    };
  }
}
