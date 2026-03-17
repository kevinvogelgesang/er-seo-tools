import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class HreflangParser extends BaseParser {
  static filenamePattern = 'hreflang';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const hreflangCol = this.findColumn(['hreflang', 'Hreflang Language']);
    const statusCol = this.findColumn(['Status Code']);
    const returnLinkCol = this.findColumn(['Missing Return Link', 'Return Link']);

    const issues: Issue[] = [];
    const languages: Record<string, number> = {};

    // Language distribution
    if (hreflangCol) {
      let hasXDefault = false;

      for (let i = 0; i < this.data.length; i++) {
        const lang = toString(this.data[i][hreflangCol]);
        if (lang) {
          languages[lang] = (languages[lang] || 0) + 1;
          if (lang === 'x-default') {
            hasXDefault = true;
          }
        }
      }

      if (!hasXDefault && this.length > 0) {
        issues.push({
          type: 'missing_x_default',
          severity: 'notice',
          count: 1,
          description: 'No x-default hreflang found',
        });
      }
    }

    // Missing return links
    if (returnLinkCol) {
      let missingCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        const returnLink = toString(this.data[i][returnLinkCol]).toLowerCase();
        if (returnLink.includes('missing') || returnLink.includes('no')) {
          missingCount++;
        }
      }

      if (missingCount > 0) {
        issues.push({
          type: 'missing_hreflang_return',
          severity: 'warning',
          count: missingCount,
          description: `${missingCount} hreflang entries missing return links`,
        });
      }
    }

    // Broken hreflang targets
    if (statusCol) {
      let brokenCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        const status = toNumber(this.data[i][statusCol]);
        if (status !== null && status >= 400 && status < 600) {
          brokenCount++;
        }
      }

      if (brokenCount > 0) {
        issues.push({
          type: 'broken_hreflang_targets',
          severity: 'critical',
          count: brokenCount,
          description: `${brokenCount} hreflang URLs returning errors`,
        });
      }
    }

    return {
      total_entries: this.length,
      issues,
      languages,
    };
  }
}
