import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

type Severity = 'critical' | 'warning' | 'notice';

export interface ResourceFileConfig {
  totalKey: string;
  large: { threshold: number; type: string; severity: Severity; statKey: string; description: (count: number) => string };
  broken: { type: string; severity: Severity; statKey: string; description: (count: number) => string };
}

export abstract class ResourceFileParser extends BaseParser {
  protected abstract readonly config: ResourceFileConfig;

  parse(): ParsedData {
    if (this.isEmpty) return {};
    const cfg = this.config;

    const addressCol = this.findColumn(['Address', 'URL']);
    const sizeCol = this.findColumn(['Size (Bytes)', 'Size', 'File Size']);
    const statusCol = this.findColumn(['Status Code', 'Status']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    if (sizeCol) {
      const largeUrls: string[] = [];
      let largeCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        const size = toNumber(this.data[i][sizeCol]);
        if (size !== null && size > cfg.large.threshold) {
          largeCount++;
          if (addressCol && largeUrls.length < 30) largeUrls.push(toString(this.data[i][addressCol]));
        }
      }
      stats[cfg.large.statKey] = largeCount;
      if (largeCount > 0) {
        issues.push({
          type: cfg.large.type, severity: cfg.large.severity, count: largeCount,
          description: cfg.large.description(largeCount), urls: largeUrls,
        });
      }
    }

    if (statusCol) {
      const brokenUrls: string[] = [];
      let brokenCount = 0;
      for (let i = 0; i < this.data.length; i++) {
        const status = toNumber(this.data[i][statusCol]);
        if (status !== null && status >= 400 && status < 600) {
          brokenCount++;
          if (addressCol && brokenUrls.length < 30) brokenUrls.push(toString(this.data[i][addressCol]));
        }
      }
      stats[cfg.broken.statKey] = brokenCount;
      if (brokenCount > 0) {
        issues.push({
          type: cfg.broken.type, severity: cfg.broken.severity, count: brokenCount,
          description: cfg.broken.description(brokenCount), urls: brokenUrls,
        });
      }
    }

    return { [cfg.totalKey]: this.length, stats, issues };
  }
}
