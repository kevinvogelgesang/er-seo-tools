import { describe, it, expect } from 'vitest';
import { diffCrawls, CrawlDiff } from './diff.service';
import { AggregatedResult, Issue } from '../types/index';

// ---- helpers ----

function makeResult(overrides: {
  total_urls?: number;
  indexable_urls?: number;
  ok_responses?: number;
  client_errors?: number;
  server_errors?: number;
  avg_word_count?: number;
  health_score?: number;
  critical?: Issue[];
  warnings?: Issue[];
  notices?: Issue[];
}): AggregatedResult {
  return {
    crawl_summary: {
      total_urls: overrides.total_urls ?? 100,
      indexable_urls: overrides.indexable_urls ?? 80,
      ok_responses: overrides.ok_responses ?? 95,
      client_errors: overrides.client_errors ?? 2,
      server_errors: overrides.server_errors ?? 1,
      avg_word_count: overrides.avg_word_count ?? 400,
    },
    issues: {
      critical: overrides.critical ?? [],
      warnings: overrides.warnings ?? [],
      notices: overrides.notices ?? [],
    },
    site_structure: {},
    resources: {},
    technical_seo: {},
    performance: {},
    recommendations: [],
    metadata: {
      files_processed: [],
      parsers_used: [],
      total_parsers_available: 0,
      health_score: overrides.health_score,
    },
  };
}

function makeIssue(type: string, severity: Issue['severity'], count: number): Issue {
  return { type, severity, count, description: `${count} ${type}` };
}

// ---- tests ----

describe('diffCrawls', () => {
  const SESSION_A = 'session-a';
  const SESSION_B = 'session-b';
  const DATE_A = '2024-01-01T00:00:00.000Z';
  const DATE_B = '2024-02-01T00:00:00.000Z';

  describe('session metadata', () => {
    it('returns session ids and timestamps in the result', () => {
      const a = makeResult({});
      const b = makeResult({});
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.session_a).toEqual({ id: SESSION_A, created_at: DATE_A });
      expect(diff.session_b).toEqual({ id: SESSION_B, created_at: DATE_B });
    });
  });

  describe('summary deltas', () => {
    it('returns zero deltas for two identical results', () => {
      const a = makeResult({ total_urls: 100, indexable_urls: 80, ok_responses: 95,
                              client_errors: 2, server_errors: 1, avg_word_count: 400 });
      const b = makeResult({ total_urls: 100, indexable_urls: 80, ok_responses: 95,
                              client_errors: 2, server_errors: 1, avg_word_count: 400 });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.summary.total_urls_delta).toBe(0);
      expect(diff.summary.indexable_delta).toBe(0);
      expect(diff.summary.ok_responses_delta).toBe(0);
      expect(diff.summary.client_errors_delta).toBe(0);
      expect(diff.summary.server_errors_delta).toBe(0);
      expect(diff.summary.avg_word_count_delta).toBe(0);
    });

    it('calculates positive deltas when B is larger', () => {
      const a = makeResult({ total_urls: 100, indexable_urls: 80, ok_responses: 90,
                              client_errors: 5, server_errors: 2, avg_word_count: 300 });
      const b = makeResult({ total_urls: 120, indexable_urls: 95, ok_responses: 115,
                              client_errors: 8, server_errors: 3, avg_word_count: 350 });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.summary.total_urls_delta).toBe(20);
      expect(diff.summary.indexable_delta).toBe(15);
      expect(diff.summary.ok_responses_delta).toBe(25);
      expect(diff.summary.client_errors_delta).toBe(3);
      expect(diff.summary.server_errors_delta).toBe(1);
      expect(diff.summary.avg_word_count_delta).toBe(50);
    });

    it('calculates negative deltas when B is smaller', () => {
      const a = makeResult({ total_urls: 150 });
      const b = makeResult({ total_urls: 100 });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.summary.total_urls_delta).toBe(-50);
    });
  });

  describe('health_score_delta', () => {
    it('calculates health score delta when both results have a score', () => {
      const a = makeResult({ health_score: 60 });
      const b = makeResult({ health_score: 75 });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.summary.health_score_delta).toBe(15);
    });

    it('calculates negative delta when score declined', () => {
      const a = makeResult({ health_score: 80 });
      const b = makeResult({ health_score: 70 });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.summary.health_score_delta).toBe(-10);
    });

    it('returns null when health_score is missing from one result', () => {
      const a = makeResult({ health_score: 60 });
      const b = makeResult({}); // no health_score
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.summary.health_score_delta).toBeNull();
    });

    it('returns null when health_score is missing from both results', () => {
      const a = makeResult({});
      const b = makeResult({});
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.summary.health_score_delta).toBeNull();
    });
  });

  describe('new_issues', () => {
    it('identifies issues present in B but not in A', () => {
      const a = makeResult({});
      const b = makeResult({
        critical: [makeIssue('client_errors_4xx', 'critical', 5)],
      });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.new_issues).toHaveLength(1);
      expect(diff.new_issues[0].type).toBe('client_errors_4xx');
    });

    it('returns empty new_issues when A and B have identical issue types', () => {
      const issue = makeIssue('client_errors_4xx', 'critical', 5);
      const a = makeResult({ critical: [issue] });
      const b = makeResult({ critical: [issue] });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.new_issues).toHaveLength(0);
    });
  });

  describe('resolved_issues', () => {
    it('identifies issues present in A but not in B', () => {
      const a = makeResult({
        warnings: [makeIssue('missing_meta_descriptions', 'warning', 10)],
      });
      const b = makeResult({});
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.resolved_issues).toHaveLength(1);
      expect(diff.resolved_issues[0].type).toBe('missing_meta_descriptions');
    });

    it('returns empty resolved_issues when no issues disappeared', () => {
      const a = makeResult({});
      const b = makeResult({});
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.resolved_issues).toHaveLength(0);
    });
  });

  describe('worsened_issues', () => {
    it('identifies issues with higher count in B', () => {
      const a = makeResult({ critical: [makeIssue('client_errors_4xx', 'critical', 3)] });
      const b = makeResult({ critical: [makeIssue('client_errors_4xx', 'critical', 10)] });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.worsened_issues).toHaveLength(1);
      expect(diff.worsened_issues[0].type).toBe('client_errors_4xx');
      expect(diff.worsened_issues[0].count).toBe(10);
    });
  });

  describe('improved_issues', () => {
    it('identifies issues with lower count in B', () => {
      const a = makeResult({ warnings: [makeIssue('missing_h1', 'warning', 20)] });
      const b = makeResult({ warnings: [makeIssue('missing_h1', 'warning', 5)] });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.improved_issues).toHaveLength(1);
      expect(diff.improved_issues[0].type).toBe('missing_h1');
      expect(diff.improved_issues[0].count).toBe(5);
    });
  });

  describe('same count — neither worsened nor improved', () => {
    it('does not add to worsened or improved when count is unchanged', () => {
      const issue = makeIssue('some_issue', 'notice', 7);
      const a = makeResult({ notices: [issue] });
      const b = makeResult({ notices: [issue] });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.worsened_issues).toHaveLength(0);
      expect(diff.improved_issues).toHaveLength(0);
    });
  });

  describe('issues across multiple severity levels', () => {
    it('flattens critical, warnings, and notices from both results', () => {
      const a = makeResult({
        critical: [makeIssue('critical_issue', 'critical', 3)],
        warnings: [makeIssue('warning_issue', 'warning', 8)],
        notices: [makeIssue('notice_issue', 'notice', 15)],
      });
      const b = makeResult({
        critical: [makeIssue('critical_issue', 'critical', 3)],
        // warning_issue is gone → resolved
        notices: [
          makeIssue('notice_issue', 'notice', 10), // improved
          makeIssue('new_notice', 'notice', 2),    // new
        ],
      });
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.resolved_issues.map(i => i.type)).toContain('warning_issue');
      expect(diff.new_issues.map(i => i.type)).toContain('new_notice');
      expect(diff.improved_issues.map(i => i.type)).toContain('notice_issue');
      expect(diff.worsened_issues).toHaveLength(0);
    });
  });

  describe('missing crawl_summary fields default to 0', () => {
    it('treats undefined fields as 0 when computing deltas', () => {
      const a = makeResult({ total_urls: undefined as unknown as number });
      const b = makeResult({ total_urls: 50 });
      // Force undefined to test the ?? 0 fallback
      (a.crawl_summary as any).total_urls = undefined;
      const diff = diffCrawls(SESSION_A, a, SESSION_B, b, DATE_A, DATE_B);
      expect(diff.summary.total_urls_delta).toBe(50);
    });
  });
});
