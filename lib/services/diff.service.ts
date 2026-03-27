import { AggregatedResult, Issue } from '../types';

export interface CrawlDiff {
  session_a: { id: string; created_at: string };
  session_b: { id: string; created_at: string };
  summary: {
    total_urls_delta: number;
    indexable_delta: number;
    ok_responses_delta: number;
    client_errors_delta: number;
    server_errors_delta: number;
    avg_word_count_delta: number;
    health_score_delta: number | null;
  };
  new_issues: Issue[];
  resolved_issues: Issue[];
  worsened_issues: Issue[];
  improved_issues: Issue[];
}

function flattenIssues(result: AggregatedResult): Map<string, Issue> {
  const map = new Map<string, Issue>();
  const allIssues = [
    ...result.issues.critical,
    ...result.issues.warnings,
    ...result.issues.notices,
  ];
  for (const issue of allIssues) {
    if (issue.type) {
      map.set(issue.type, issue);
    }
  }
  return map;
}

export function diffCrawls(
  sessionAId: string,
  resultA: AggregatedResult,
  sessionBId: string,
  resultB: AggregatedResult,
  createdAtA: string,
  createdAtB: string
): CrawlDiff {
  const sA = resultA.crawl_summary;
  const sB = resultB.crawl_summary;

  const healthA = resultA.metadata?.health_score;
  const healthB = resultB.metadata?.health_score;
  const health_score_delta =
    healthA !== undefined && healthB !== undefined ? healthB - healthA : null;

  const summary: CrawlDiff['summary'] = {
    total_urls_delta: (sB.total_urls ?? 0) - (sA.total_urls ?? 0),
    indexable_delta: (sB.indexable_urls ?? 0) - (sA.indexable_urls ?? 0),
    ok_responses_delta: (sB.ok_responses ?? 0) - (sA.ok_responses ?? 0),
    client_errors_delta: (sB.client_errors ?? 0) - (sA.client_errors ?? 0),
    server_errors_delta: (sB.server_errors ?? 0) - (sA.server_errors ?? 0),
    avg_word_count_delta: (sB.avg_word_count ?? 0) - (sA.avg_word_count ?? 0),
    health_score_delta,
  };

  const issuesA = flattenIssues(resultA);
  const issuesB = flattenIssues(resultB);

  const new_issues: Issue[] = [];
  const resolved_issues: Issue[] = [];
  const worsened_issues: Issue[] = [];
  const improved_issues: Issue[] = [];

  // Issues in B not in A → new
  for (const [type, issueB] of issuesB) {
    if (!issuesA.has(type)) {
      new_issues.push(issueB);
    }
  }

  // Issues in A not in B → resolved
  for (const [type, issueA] of issuesA) {
    if (!issuesB.has(type)) {
      resolved_issues.push(issueA);
    }
  }

  // Issues in both → compare counts
  for (const [type, issueA] of issuesA) {
    const issueB = issuesB.get(type);
    if (!issueB) continue;
    const countA = issueA.count ?? 0;
    const countB = issueB.count ?? 0;
    if (countB > countA) {
      worsened_issues.push(issueB);
    } else if (countB < countA) {
      improved_issues.push(issueB);
    }
  }

  return {
    session_a: { id: sessionAId, created_at: createdAtA },
    session_b: { id: sessionBId, created_at: createdAtB },
    summary,
    new_issues,
    resolved_issues,
    worsened_issues,
    improved_issues,
  };
}
