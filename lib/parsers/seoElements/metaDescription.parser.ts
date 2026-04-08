import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class MetaDescriptionParser extends BaseParser {
  static filenamePattern = ['meta_description_all', 'meta_description'];

  private static META_MIN_LENGTH = 70;
  private static META_MAX_LENGTH = 160;

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const metaCol = this.findColumn(['Meta Description 1', 'Meta Description']);
    const lengthCol = this.findColumn(['Meta Description 1 Length', 'Length']);

    const indexableMask = this.getIndexableHtmlMask();
    const hasIndexable = indexableMask.some(Boolean);
    const mask = hasIndexable ? indexableMask : this.getSeoRelevantMask(addressCol);

    const issues: Issue[] = [];
    const totalPages = this.countMask(mask);

    // Missing meta descriptions
    if (metaCol) {
      const missingUrls: string[] = [];
      let missingCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const meta = toString(this.data[i][metaCol]);
        if (!meta) {
          missingCount++;
          if (addressCol && missingUrls.length < 20) {
            missingUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (missingCount > 0) {
        issues.push({
          type: 'missing_meta_description',
          severity: 'warning',
          count: missingCount,
          description: `${missingCount} pages missing meta descriptions`,
          urls: missingUrls,
        });
      }
    }

    // Length issues
    if (lengthCol) {
      const shortUrls: string[] = [];
      const longUrls: string[] = [];
      let shortCount = 0;
      let longCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const length = toNumber(this.data[i][lengthCol]);
        if (length === null) continue;

        if (length < MetaDescriptionParser.META_MIN_LENGTH && length > 0) {
          shortCount++;
          if (addressCol && shortUrls.length < 20) {
            shortUrls.push(toString(this.data[i][addressCol]));
          }
        } else if (length > MetaDescriptionParser.META_MAX_LENGTH) {
          longCount++;
          if (addressCol && longUrls.length < 20) {
            longUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (shortCount > 0) {
        issues.push({
          type: 'meta_description_too_short',
          severity: 'notice',
          count: shortCount,
          description: `${shortCount} pages with meta descriptions under ${MetaDescriptionParser.META_MIN_LENGTH} characters`,
          threshold: `< ${MetaDescriptionParser.META_MIN_LENGTH} chars`,
          urls: shortUrls,
        });
      }

      if (longCount > 0) {
        issues.push({
          type: 'meta_description_too_long',
          severity: 'notice',
          count: longCount,
          description: `${longCount} pages with meta descriptions over ${MetaDescriptionParser.META_MAX_LENGTH} characters`,
          threshold: `> ${MetaDescriptionParser.META_MAX_LENGTH} chars`,
          urls: longUrls,
        });
      }
    }

    // Duplicates
    if (metaCol) {
      const metaCounts: Record<string, number> = {};
      const metaUrlMap: Record<string, string[]> = {};
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const meta = toString(this.data[i][metaCol]);
        if (meta) {
          metaCounts[meta] = (metaCounts[meta] || 0) + 1;
          if (addressCol) {
            if (!metaUrlMap[meta]) metaUrlMap[meta] = [];
            if (metaUrlMap[meta].length < 50) {
              metaUrlMap[meta].push(toString(this.data[i][addressCol]));
            }
          }
        }
      }

      const duplicates = Object.entries(metaCounts)
        .filter(([_, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      if (duplicates.length > 0) {
        issues.push({
          type: 'duplicate_meta_description',
          severity: 'warning',
          count: duplicates.length,
          description: `${duplicates.length} groups of pages with duplicate meta descriptions`,
          groups: duplicates.map(([meta, count]) => ({
            meta_description: meta.slice(0, 200),
            count,
            urls: metaUrlMap[meta] ?? [],
          })),
        });
      }
    }

    return {
      total_pages: totalPages,
      excluded_urls: this.length - totalPages,
      issues,
    };
  }
}
