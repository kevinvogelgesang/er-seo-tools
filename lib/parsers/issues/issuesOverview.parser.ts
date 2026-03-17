import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toString, toNumber } from '../../utils/columnMapper';

/**
 * Parser for ScreamingFrog's issues_overview_report.csv
 * This is a goldmine - it contains pre-computed issues with priority, count,
 * description, and "how to fix" recommendations.
 */
export class IssuesOverviewParser extends BaseParser {
  static filenamePattern = 'issues_overview';

  // Map ScreamingFrog issue types to our severity levels
  private static ISSUE_TYPE_MAP: Record<string, 'critical' | 'warning' | 'notice'> = {
    issue: 'critical',
    warning: 'warning',
    opportunity: 'notice',
  };

  // Map ScreamingFrog priority to severity (as fallback)
  private static PRIORITY_MAP: Record<string, 'critical' | 'warning' | 'notice'> = {
    high: 'critical',
    medium: 'warning',
    low: 'notice',
  };

  // Normalize issue names to our issue type format
  private normalizeIssueType(issueName: string): string {
    return issueName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const issueNameCol = this.findColumn(['Issue Name', 'Issue']);
    const issueTypeCol = this.findColumn(['Issue Type', 'Type']);
    const priorityCol = this.findColumn(['Issue Priority', 'Priority']);
    const urlsCol = this.findColumn(['URLs', 'URL Count', 'Count']);
    const percentCol = this.findColumn(['% of Total', 'Percent']);
    const descriptionCol = this.findColumn(['Description', 'Desc']);
    const howToFixCol = this.findColumn(['How To Fix', 'How to Fix', 'Fix']);

    const issues: Issue[] = [];
    const issuesSummary: Record<string, number> = {
      critical: 0,
      warning: 0,
      notice: 0,
    };

    for (const row of this.data) {
      const issueName = issueNameCol ? toString(row[issueNameCol]) : '';
      if (!issueName) continue;

      const urlCount = urlsCol ? toNumber(row[urlsCol]) : 0;
      if (urlCount === null || urlCount === 0) continue;

      // Determine severity from issue type or priority
      const issueType = issueTypeCol ? toString(row[issueTypeCol]).toLowerCase() : '';
      const priority = priorityCol ? toString(row[priorityCol]).toLowerCase() : '';

      let severity: 'critical' | 'warning' | 'notice' = 'notice';
      if (issueType && IssuesOverviewParser.ISSUE_TYPE_MAP[issueType]) {
        severity = IssuesOverviewParser.ISSUE_TYPE_MAP[issueType];
      } else if (priority && IssuesOverviewParser.PRIORITY_MAP[priority]) {
        severity = IssuesOverviewParser.PRIORITY_MAP[priority];
      }

      const description = descriptionCol ? toString(row[descriptionCol]) : '';
      const howToFix = howToFixCol ? toString(row[howToFixCol]) : '';
      const percent = percentCol ? toNumber(row[percentCol]) : null;

      // Create the issue
      const issue: Issue = {
        type: `sf_${this.normalizeIssueType(issueName)}`,
        severity,
        count: urlCount || 0,
        description: description || issueName,
        source: 'issues_overview',
      };

      // Add how to fix as part of description if available
      if (howToFix) {
        issue.description = `${issue.description} | Fix: ${howToFix.slice(0, 200)}`;
      }

      issues.push(issue);
      issuesSummary[severity]++;
    }

    // Sort issues by count (descending) within each severity
    issues.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, notice: 2 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return (b.count || 0) - (a.count || 0);
    });

    return {
      total_issues: issues.length,
      issues_by_severity: issuesSummary,
      issues,
      stats: {
        critical_count: issuesSummary.critical,
        warning_count: issuesSummary.warning,
        notice_count: issuesSummary.notice,
      },
    };
  }
}
