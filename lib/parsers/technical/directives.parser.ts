import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toString } from '../../utils/columnMapper';

export class DirectivesParser extends BaseParser {
  static filenamePattern = 'directives';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const metaRobotsCol = this.findColumn(['Meta Robots 1', 'Meta Robots']);
    const xRobotsCol = this.findColumn(['X-Robots-Tag 1', 'X-Robots-Tag']);

    const issues: Issue[] = [];
    const noindexUrls: string[] = [];
    let noindexCount = 0;
    let nofollowCount = 0;

    // Track noindex (from both meta robots and x-robots)
    const noindexSet = new Set<number>();

    for (let i = 0; i < this.data.length; i++) {
      if (metaRobotsCol) {
        const metaRobots = toString(this.data[i][metaRobotsCol]).toLowerCase();
        if (metaRobots.includes('noindex')) {
          noindexSet.add(i);
        }
        if (metaRobots.includes('nofollow')) {
          nofollowCount++;
        }
      }

      if (xRobotsCol) {
        const xRobots = toString(this.data[i][xRobotsCol]).toLowerCase();
        if (xRobots.includes('noindex')) {
          noindexSet.add(i);
        }
      }
    }

    // Collect noindex URLs
    for (const idx of Array.from(noindexSet)) {
      noindexCount++;
      if (addressCol && noindexUrls.length < 30) {
        noindexUrls.push(toString(this.data[idx][addressCol]));
      }
    }

    if (noindexCount > 0) {
      issues.push({
        type: 'noindex_pages',
        severity: 'notice',
        count: noindexCount,
        description: `${noindexCount} pages with noindex directive`,
        urls: noindexUrls,
      });
    }

    if (nofollowCount > 0) {
      issues.push({
        type: 'nofollow_pages',
        severity: 'notice',
        count: nofollowCount,
        description: `${nofollowCount} pages with nofollow directive`,
      });
    }

    return {
      total_pages: this.length,
      issues,
      stats: {
        noindex_count: noindexCount,
        nofollow_count: nofollowCount,
      },
    };
  }
}
