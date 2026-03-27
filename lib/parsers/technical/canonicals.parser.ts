import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toString } from '../../utils/columnMapper';

export class CanonicalsParser extends BaseParser {
  static filenamePattern = 'canonicals';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const canonicalCol = this.findColumn(['Canonical Link Element 1', 'Canonical']);
    const statusCol = this.findColumn(['Canonicals']);

    const issues: Issue[] = [];

    // Missing canonicals + self-referencing + non-self canonical detection
    if (canonicalCol) {
      const missingUrls: string[] = [];
      let missingCount = 0;
      let differentCount = 0;
      let selfReferencingCount = 0; // NEW — canonical === page URL (correct)
      const nonSelfUrls: string[] = []; // NEW
      let nonSelfCount = 0; // NEW — alias for differentCount, with URL sampling

      for (let i = 0; i < this.data.length; i++) {
        const canonical = toString(this.data[i][canonicalCol]);
        const address = addressCol ? toString(this.data[i][addressCol]) : '';

        if (!canonical) {
          missingCount++;
          if (addressCol && missingUrls.length < 30) {
            missingUrls.push(address);
          }
        } else if (address && canonical === address) {
          // NEW — self-referencing canonical: this is the correct/expected state
          selfReferencingCount++;
        } else if (address && canonical !== address) {
          differentCount++;
          nonSelfCount++; // NEW
          if (addressCol && nonSelfUrls.length < 30) { // NEW
            nonSelfUrls.push(address); // NEW
          }
        }
      }

      if (missingCount > 0) {
        issues.push({
          type: 'missing_canonical',
          severity: 'notice',
          count: missingCount,
          description: `${missingCount} pages missing canonical tags`,
          urls: missingUrls,
        });
      }

      if (differentCount > 0) {
        // NEW — flag as warning if > 50% of pages have non-self canonicals
        const nonSelfPercent = this.length > 0 ? (differentCount / this.length) * 100 : 0;
        issues.push({
          type: 'non_self_canonical',
          severity: nonSelfPercent > 50 ? 'warning' : 'notice', // NEW
          count: differentCount,
          description: `${differentCount} pages with canonical pointing to different URL`,
          urls: nonSelfUrls, // NEW
        });
      }
    }

    // Canonicalised status
    if (statusCol) {
      const canonicalisedUrls: string[] = [];
      let canonCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const status = toString(this.data[i][statusCol]).toLowerCase();
        if (status.includes('canonicalised')) {
          canonCount++;
          if (addressCol && canonicalisedUrls.length < 30) {
            canonicalisedUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (canonCount > 0) {
        issues.push({
          type: 'canonicalised_pages',
          severity: 'notice',
          count: canonCount,
          description: `${canonCount} pages canonicalised to other URLs`,
          urls: canonicalisedUrls,
        });
      }
    }

    // NEW — Compute per-category counts for aggregator consumption
    let selfReferencingTotal = 0;
    let nonSelfTotal = 0;
    let missingTotal = 0;

    if (canonicalCol) {
      for (let i = 0; i < this.data.length; i++) {
        const canonical = toString(this.data[i][canonicalCol]);
        const address = addressCol ? toString(this.data[i][addressCol]) : '';
        if (!canonical) {
          missingTotal++;
        } else if (address && canonical === address) {
          selfReferencingTotal++;
        } else if (address && canonical !== address) {
          nonSelfTotal++;
        }
      }
    }

    return {
      total_pages: this.length,
      self_referencing_count: selfReferencingTotal, // NEW
      non_self_canonical_count: nonSelfTotal, // NEW
      missing_canonical_count: missingTotal, // NEW
      issues,
    };
  }
}
