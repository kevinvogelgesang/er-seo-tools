import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toString } from '../../utils/columnMapper';

export class CanonicalsParser extends BaseParser {
  static parserKey = 'canonicals';
  static filenamePattern = ['canonicals_all', 'canonicals'];

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const canonicalCol = this.findColumn(['Canonical Link Element 1', 'Canonical']);
    const statusCol = this.findColumn(['Canonicals']);

    const issues: Issue[] = [];
    let selfReferencingCount = 0;
    let differentCount = 0;
    let missingCount = 0;

    if (canonicalCol) {
      const missingUrls: string[] = [];
      const nonSelfUrls: string[] = [];

      for (let i = 0; i < this.data.length; i++) {
        const canonical = toString(this.data[i][canonicalCol]);
        const address = addressCol ? toString(this.data[i][addressCol]) : '';

        if (!canonical) {
          missingCount++;
          if (addressCol && missingUrls.length < 30) missingUrls.push(address);
        } else if (address && canonical === address) {
          selfReferencingCount++;
        } else if (address && canonical !== address) {
          differentCount++;
          if (addressCol && nonSelfUrls.length < 30) nonSelfUrls.push(address);
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
        const nonSelfPercent = this.length > 0 ? (differentCount / this.length) * 100 : 0;
        issues.push({
          type: 'non_self_canonical',
          severity: nonSelfPercent > 50 ? 'warning' : 'notice',
          count: differentCount,
          description: `${differentCount} pages with canonical pointing to different URL`,
          urls: nonSelfUrls,
        });
      }
    }

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

    return {
      total_pages: this.length,
      self_referencing_count: selfReferencingCount,
      non_self_canonical_count: differentCount,
      missing_canonical_count: missingCount,
      issues,
    };
  }
}
