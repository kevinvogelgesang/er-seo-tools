import { BaseParser } from '../base.parser';
import { ExactDuplicatePair } from '../../types';
import { toString } from '../../utils/columnMapper';

const TRACKING_PATTERNS = ['gtm=', 'pid=', 'v=3&t='];
const MAX_URL_LENGTH = 300;

function isTrackingUrl(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) return true;
  return TRACKING_PATTERNS.some(pattern => url.includes(pattern));
}

function parseSimilarityPercent(value: unknown): number {
  const raw = String(value ?? '').trim();
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return 0;
  const percent = raw.includes('%') || parsed > 1 ? parsed : parsed * 100;
  return Math.round(percent);
}

export class ExactDuplicatesParser extends BaseParser {
  static filenamePattern = 'exact_duplicates_report';
  static displayName = 'Exact Duplicates';

  parse(): { exact_duplicates: ExactDuplicatePair[]; exact_duplicates_count: number } {
    if (this.isEmpty) return { exact_duplicates: [], exact_duplicates_count: 0 };

    const addressCol = this.findColumn(['Address', 'URL']);
    const duplicateOfCol = this.findColumn(['Exact Duplicate Address']);
    const similarityCol = this.findColumn(['Similarity']);
    const indexabilityCol = this.findColumn(['Indexability']);

    const exact_duplicates: ExactDuplicatePair[] = [];

    for (const row of this.data) {
      const address = toString(addressCol ? row[addressCol] : null);
      if (!address || isTrackingUrl(address)) continue;

      const duplicate_of = toString(duplicateOfCol ? row[duplicateOfCol] : null);
      if (!duplicate_of) continue;

      const rawSimilarity = similarityCol ? row[similarityCol] : null;
      const similarity_pct = parseSimilarityPercent(rawSimilarity);
      const indexability = toString(indexabilityCol ? row[indexabilityCol] : null);

      exact_duplicates.push({
        address,
        duplicate_of,
        similarity_pct,
        indexability,
      });
    }

    return {
      exact_duplicates,
      exact_duplicates_count: exact_duplicates.length,
    };
  }
}
