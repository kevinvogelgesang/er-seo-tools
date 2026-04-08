import { BaseParser } from '../base.parser';
import { ExactDuplicatePair } from '../../types';
import { toString } from '../../utils/columnMapper';

const TRACKING_PATTERNS = ['gtm=', 'pid=', 'v=3&t='];
const MAX_URL_LENGTH = 300;

function isTrackingUrl(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) return true;
  return TRACKING_PATTERNS.some(pattern => url.includes(pattern));
}

export class ExactDuplicatesParser extends BaseParser {
  static filenamePattern = 'exact_duplicates_report';
  static displayName = 'Exact Duplicates';

  parse(): { exact_duplicates: ExactDuplicatePair[] } {
    if (this.isEmpty) return { exact_duplicates: [] };

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
      const parsed = parseFloat(String(rawSimilarity ?? ''));
      const similarity_pct = Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
      const indexability = toString(indexabilityCol ? row[indexabilityCol] : null);

      exact_duplicates.push({
        address,
        duplicate_of,
        similarity_pct,
        indexability,
      });
    }

    return { exact_duplicates };
  }
}
