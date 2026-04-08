import { BaseParser } from '../base.parser';
import { ParsedData } from '../types';

export interface SemrushPositionTrackingResult extends ParsedData {
  position_tracking_pages: Array<{
    url: string;
    keyword_count: number;
    average_position: number;
    estimated_traffic: number;
  }>;
}

/**
 * Strip the SEMRush metadata header block (lines between the two `-----` delimiters)
 * and return only the CSV portion of the file.
 */
function stripMetadataHeader(rawContent: string): string {
  const lines = rawContent.split('\n');
  let dashCount = 0;
  let csvStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '-----') {
      dashCount++;
      if (dashCount === 2) {
        // Skip blank lines after the second `-----`
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') {
          j++;
        }
        csvStartIndex = j;
        break;
      }
    }
  }

  if (csvStartIndex === -1) {
    // No metadata block found — return as-is
    return rawContent;
  }

  return lines.slice(csvStartIndex).join('\n');
}

export class SemrushPositionTrackingParser extends BaseParser {
  static filenamePattern = '';
  static displayName = 'SEMRush Position Tracking';

  constructor(rawContent: string) {
    super(stripMetadataHeader(rawContent));
  }

  static matchesRawContent(rawContent: string): boolean {
    const trimmed = rawContent.trimStart();
    return (
      trimmed.startsWith('-----') &&
      rawContent.includes('Report type: position_tracking_pages')
    );
  }

  parse(): SemrushPositionTrackingResult {
    if (this.isEmpty) {
      return { position_tracking_pages: [] };
    }

    const urlCol = this.findColumn(['URL', 'Landing Page', 'Page']);
    const keywordsCol = this.findColumn(['Keywords', 'Number of Keywords', 'Keyword Count']);
    const avgPositionCol = this.findColumn(['Average Position', 'Avg. Position', 'Avg Position', 'Average Pos']);
    const trafficCol = this.findColumn(['Estimated Traffic', 'Traffic', 'Est. Traffic']);

    const results: SemrushPositionTrackingResult['position_tracking_pages'] = [];

    for (const row of this.data) {
      const url = urlCol ? String(row[urlCol] ?? '').trim() : '';
      if (!url || !url.startsWith('http')) continue;

      const keyword_count = keywordsCol ? Number(row[keywordsCol] ?? 0) || 0 : 0;
      const average_position = avgPositionCol ? Number(row[avgPositionCol] ?? 0) || 0 : 0;
      const estimated_traffic = trafficCol ? Number(row[trafficCol] ?? 0) || 0 : 0;

      results.push({ url, keyword_count, average_position, estimated_traffic });
    }

    return { position_tracking_pages: results };
  }
}
