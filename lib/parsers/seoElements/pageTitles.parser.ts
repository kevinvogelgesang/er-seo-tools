import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class PageTitlesParser extends BaseParser {
  static filenamePattern = ['page_titles_all', 'page_titles'];

  private static TITLE_MIN_LENGTH = 30;
  private static TITLE_MAX_LENGTH = 60;

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const titleCol = this.findColumn(['Title 1', 'Title']);
    const lengthCol = this.findColumn(['Title 1 Length', 'Title Length', 'Length']);
    const title2Col = this.findColumn(['Title 2']);

    const indexableMask = this.getIndexableHtmlMask();
    const hasIndexable = indexableMask.some(Boolean);
    const mask = hasIndexable ? indexableMask : this.getSeoRelevantMask(addressCol);

    const issues: Issue[] = [];
    const totalPages = this.countMask(mask);

    // Missing titles
    if (titleCol) {
      const missingUrls: string[] = [];
      let missingCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const title = toString(this.data[i][titleCol]);
        if (!title) {
          missingCount++;
          if (addressCol && missingUrls.length < 20) {
            missingUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (missingCount > 0) {
        issues.push({
          type: 'missing_title',
          severity: 'critical',
          count: missingCount,
          description: `${missingCount} pages missing title tags`,
          urls: missingUrls,
        });
      }
    }

    // Title length issues
    if (lengthCol) {
      const shortUrls: string[] = [];
      const longUrls: string[] = [];
      let shortCount = 0;
      let longCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const length = toNumber(this.data[i][lengthCol]);
        if (length === null) continue;

        if (length < PageTitlesParser.TITLE_MIN_LENGTH && length > 0) {
          shortCount++;
          if (addressCol && shortUrls.length < 20) {
            shortUrls.push(toString(this.data[i][addressCol]));
          }
        } else if (length > PageTitlesParser.TITLE_MAX_LENGTH) {
          longCount++;
          if (addressCol && longUrls.length < 20) {
            longUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (shortCount > 0) {
        issues.push({
          type: 'title_too_short',
          severity: 'warning',
          count: shortCount,
          description: `${shortCount} pages with titles under ${PageTitlesParser.TITLE_MIN_LENGTH} characters`,
          threshold: `< ${PageTitlesParser.TITLE_MIN_LENGTH} chars`,
          urls: shortUrls,
        });
      }

      if (longCount > 0) {
        issues.push({
          type: 'title_too_long',
          severity: 'notice',
          count: longCount,
          description: `${longCount} pages with titles over ${PageTitlesParser.TITLE_MAX_LENGTH} characters`,
          threshold: `> ${PageTitlesParser.TITLE_MAX_LENGTH} chars`,
          urls: longUrls,
        });
      }
    }

    // Duplicate titles
    if (titleCol) {
      const titleCounts: Record<string, number> = {};
      const titleUrlMap: Record<string, string[]> = {};
      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const title = toString(this.data[i][titleCol]);
        if (title) {
          titleCounts[title] = (titleCounts[title] || 0) + 1;
          if (addressCol) {
            if (!titleUrlMap[title]) titleUrlMap[title] = [];
            if (titleUrlMap[title].length < 50) {
              titleUrlMap[title].push(toString(this.data[i][addressCol]));
            }
          }
        }
      }

      const duplicates = Object.entries(titleCounts)
        .filter(([_, count]) => count > 1)
        .sort((a, b) => b[1] - a[1]);

      if (duplicates.length > 0) {
        issues.push({
          type: 'duplicate_title',
          severity: 'warning',
          count: duplicates.length,
          description: `${duplicates.length} groups of pages with duplicate titles`,
          groups: duplicates.slice(0, 10).map(([title, count]) => ({
            title: title.slice(0, 100),
            count,
            urls: titleUrlMap[title] ?? [],
          })),
        });
      }
    }

    // Multiple titles
    if (title2Col) {
      const multipleUrls: string[] = [];
      let multipleCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        if (!mask[i]) continue;
        const title2 = toString(this.data[i][title2Col]).trim();
        if (title2) {
          multipleCount++;
          if (addressCol && multipleUrls.length < 20) {
            multipleUrls.push(toString(this.data[i][addressCol]));
          }
        }
      }

      if (multipleCount > 0) {
        issues.push({
          type: 'multiple_titles',
          severity: 'warning',
          count: multipleCount,
          description: `${multipleCount} pages with multiple title tags`,
          urls: multipleUrls,
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
