import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class RedirectChainsParser extends BaseParser {
  static filenamePattern = 'redirect_chains';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL', 'Initial URL']);
    const hopsCol = this.findColumn(['Number of Redirects', 'Redirects', 'Hops']);

    const issues: Issue[] = [];

    if (hopsCol) {
      const chainUrls: string[] = [];
      const longChainUrls: string[] = [];
      let chainsCount = 0;
      let longChainsCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const hops = toNumber(this.data[i][hopsCol]);
        if (hops === null) continue;

        if (hops >= 2) {
          chainsCount++;
          if (addressCol && chainUrls.length < 30) {
            chainUrls.push(toString(this.data[i][addressCol]));
          }
        }

        if (hops >= 4) {
          longChainsCount++;
          if (addressCol && longChainUrls.length < 20) {
            longChainUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (chainsCount > 0) {
        issues.push({
          type: 'redirect_chains',
          severity: 'warning',
          count: chainsCount,
          description: `${chainsCount} redirect chains (2+ hops)`,
          urls: chainUrls,
        });
      }

      if (longChainsCount > 0) {
        issues.push({
          type: 'long_redirect_chains',
          severity: 'critical',
          count: longChainsCount,
          description: `${longChainsCount} long redirect chains (4+ hops)`,
          urls: longChainUrls,
        });
      }
    }

    return {
      total_chains: this.length,
      issues,
    };
  }
}
