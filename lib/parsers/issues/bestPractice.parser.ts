import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toString } from '../../utils/columnMapper';

export class BestPracticeParser extends BaseParser {
  static parserKey = 'bestpractice';
  static filenamePattern = 'best_practice';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const issueCol = this.findColumn(['Issue', 'Issue Name', 'Violation']);
    const addressCol = this.findColumn(['Address', 'URL']);
    const priorityCol = this.findColumn(['Priority', 'User Impact']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = { total_violations: this.length };

    const byPriority: Record<string, number> = {};
    const byIssue: Record<string, string[]> = {};

    for (let i = 0; i < this.data.length; i++) {
      const issueName = issueCol ? toString(this.data[i][issueCol]).trim() : '';
      const priority = priorityCol ? toString(this.data[i][priorityCol]).trim().toLowerCase() : 'unknown';
      const address = addressCol ? toString(this.data[i][addressCol]).trim() : '';

      byPriority[priority] = (byPriority[priority] || 0) + 1;

      if (issueName) {
        if (!byIssue[issueName]) byIssue[issueName] = [];
        if (byIssue[issueName].length < 5 && address) {
          byIssue[issueName].push(address);
        }
      }
    }

    for (const [priority, count] of Object.entries(byPriority)) {
      stats[`priority_${priority}`] = count;
    }

    const highCount = (byPriority['high'] || 0) + (byPriority['critical'] || 0);
    if (highCount > 0) {
      issues.push({
        type: 'best_practice_high_priority',
        severity: 'critical',
        count: highCount,
        description: `${highCount} high/critical best practice violations`,
      });
    }

    const medCount = byPriority['medium'] || 0;
    if (medCount > 0) {
      issues.push({
        type: 'best_practice_medium_priority',
        severity: 'warning',
        count: medCount,
        description: `${medCount} medium priority best practice violations`,
      });
    }

    const lowCount = byPriority['low'] || 0;
    if (lowCount > 0) {
      issues.push({
        type: 'best_practice_low_priority',
        severity: 'notice',
        count: lowCount,
        description: `${lowCount} low priority best practice violations`,
      });
    }

    return {
      total_violations: this.length,
      by_issue: byIssue,
      stats,
      issues,
    };
  }
}
