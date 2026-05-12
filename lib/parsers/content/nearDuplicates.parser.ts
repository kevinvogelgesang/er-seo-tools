import { BaseParser } from '../base.parser';
import { NearDuplicateEntry } from '../../types';
import { toString } from '../../utils/columnMapper';

export class NearDuplicatesParser extends BaseParser {
  static filenamePattern = 'content_near_duplicates';
  static displayName = 'Near Duplicates';

  parse(): { near_duplicates: NearDuplicateEntry[]; near_duplicates_count: number } {
    if (this.isEmpty) return { near_duplicates: [], near_duplicates_count: 0 };

    const addressCol = this.findColumn(['Address']);
    const closestMatchCol = this.findColumn(['Closest Near Duplicate Match']);
    const countCol = this.findColumn(['No. Near Duplicates']);
    const indexabilityCol = this.findColumn(['Indexability']);

    const near_duplicates: NearDuplicateEntry[] = [];

    for (const row of this.data) {
      const address = toString(addressCol ? row[addressCol] : null);
      if (!address) continue;

      const closest_match = toString(closestMatchCol ? row[closestMatchCol] : null);
      if (!closest_match) continue;

      const rawCount = countCol ? row[countCol] : null;
      const parsed = parseInt(String(rawCount ?? ''), 10);
      const near_duplicate_count = Number.isFinite(parsed) ? parsed : 0;
      if (near_duplicate_count === 0) continue;

      const indexability = toString(indexabilityCol ? row[indexabilityCol] : null);

      near_duplicates.push({
        address,
        closest_match,
        near_duplicate_count,
        indexability,
      });
    }

    return {
      near_duplicates,
      near_duplicates_count: near_duplicates.length,
    };
  }
}
