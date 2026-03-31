import { describe, it, expect } from 'vitest';
import {
  calculatePriorityScore,
  calculateEffort,
  calculateRoi,
  prioritizeIssues,
  getPrioritySummary,
  formatPriorityMarkdown,
} from '@/lib/services/priority.service';
import type { Issue } from '@/lib/types';

function makeIssue(overrides: Partial<Issue> & { type: string; count: number }): Issue {
  return {
    severity: 'warning',
    description: 'Test issue',
    ...overrides,
  } as Issue;
}

// ---------------------------------------------------------------------------
// calculatePriorityScore
// ---------------------------------------------------------------------------
describe('calculatePriorityScore', () => {
  // --- known weights ---
  it('uses known weight for broken_pages (100)', () => {
    const issue = makeIssue({ type: 'broken_pages', count: 1, severity: 'warning' });
    expect(calculatePriorityScore(issue)).toBe(100);
  });

  it('uses known weight for missing_meta_description (65)', () => {
    const issue = makeIssue({ type: 'missing_meta_description', count: 1, severity: 'warning' });
    expect(calculatePriorityScore(issue)).toBe(65);
  });

  it('uses known weight for missing_h1 (60)', () => {
    const issue = makeIssue({ type: 'missing_h1', count: 1, severity: 'warning' });
    expect(calculatePriorityScore(issue)).toBe(60);
  });

  // --- default weight ---
  it('uses default weight (25) for unknown type', () => {
    const issue = makeIssue({ type: 'unknown_issue_xyz', count: 1, severity: 'warning' });
    expect(calculatePriorityScore(issue)).toBe(25);
  });

  // --- severity multipliers ---
  it('applies critical severity multiplier (1.5)', () => {
    const issue = makeIssue({ type: 'broken_pages', count: 1, severity: 'critical' });
    // 100 * 1.0 * 1.5 = 150
    expect(calculatePriorityScore(issue)).toBe(150);
  });

  it('applies warning severity multiplier (1.0) — no change', () => {
    const issue = makeIssue({ type: 'broken_pages', count: 1, severity: 'warning' });
    expect(calculatePriorityScore(issue)).toBe(100);
  });

  it('applies notice severity multiplier (0.6)', () => {
    const issue = makeIssue({ type: 'broken_pages', count: 1, severity: 'notice' });
    // 100 * 1.0 * 0.6 = 60
    expect(calculatePriorityScore(issue)).toBe(60);
  });

  // --- scale multipliers (all tiers) ---
  it('applies scale 2.0 for count >= 1000', () => {
    const issue = makeIssue({ type: 'missing_title', count: 1000, severity: 'warning' });
    // 95 * 2.0 * 1.0 = 190
    expect(calculatePriorityScore(issue)).toBe(190);
  });

  it('applies scale 1.8 for count >= 500', () => {
    const issue = makeIssue({ type: 'missing_title', count: 500, severity: 'warning' });
    // 95 * 1.8 = 171
    expect(calculatePriorityScore(issue)).toBe(171);
  });

  it('applies scale 1.5 for count >= 100', () => {
    const issue = makeIssue({ type: 'missing_title', count: 100, severity: 'warning' });
    // 95 * 1.5 = 142.5
    expect(calculatePriorityScore(issue)).toBe(142.5);
  });

  it('applies scale 1.3 for count >= 50', () => {
    const issue = makeIssue({ type: 'missing_title', count: 50, severity: 'warning' });
    // 95 * 1.3 = 123.5
    expect(calculatePriorityScore(issue)).toBe(123.5);
  });

  it('applies scale 1.2 for count >= 20', () => {
    const issue = makeIssue({ type: 'missing_title', count: 20, severity: 'warning' });
    // 95 * 1.2 = 114
    expect(calculatePriorityScore(issue)).toBe(114);
  });

  it('applies scale 1.1 for count >= 10', () => {
    const issue = makeIssue({ type: 'missing_title', count: 10, severity: 'warning' });
    // 95 * 1.1 = 104.5
    expect(calculatePriorityScore(issue)).toBe(104.5);
  });

  it('applies scale 1.0 for count < 10', () => {
    const issue = makeIssue({ type: 'missing_title', count: 5, severity: 'warning' });
    expect(calculatePriorityScore(issue)).toBe(95);
  });

  // --- boundary: count exactly at threshold ---
  it('count=999 gets scale 1.8 (not 2.0)', () => {
    const issue = makeIssue({ type: 'missing_title', count: 999, severity: 'warning' });
    // 95 * 1.8 = 171
    expect(calculatePriorityScore(issue)).toBe(171);
  });

  it('count=0 gets scale 1.0', () => {
    const issue = makeIssue({ type: 'missing_title', count: 0, severity: 'warning' });
    expect(calculatePriorityScore(issue)).toBe(95);
  });

  // --- combined multipliers ---
  it('combines scale and severity multipliers', () => {
    const issue = makeIssue({ type: 'broken_pages', count: 1000, severity: 'critical' });
    // 100 * 2.0 * 1.5 = 300
    expect(calculatePriorityScore(issue)).toBe(300);
  });

  it('combines scale and notice severity', () => {
    const issue = makeIssue({ type: 'broken_pages', count: 500, severity: 'notice' });
    // 100 * 1.8 * 0.6 = 108
    expect(calculatePriorityScore(issue)).toBe(108);
  });

  // --- rounding ---
  it('rounds to one decimal place', () => {
    // missing_meta_description=65, count=100 (scale=1.5), notice (0.6)
    // 65 * 1.5 * 0.6 = 58.5
    const issue = makeIssue({ type: 'missing_meta_description', count: 100, severity: 'notice' });
    expect(calculatePriorityScore(issue)).toBe(58.5);
  });
});

// ---------------------------------------------------------------------------
// calculateEffort
// ---------------------------------------------------------------------------
describe('calculateEffort', () => {
  // --- base effort categories ---
  it('returns low for low-effort types', () => {
    expect(calculateEffort(makeIssue({ type: 'missing_meta_description', count: 5 }))).toBe('low');
    expect(calculateEffort(makeIssue({ type: 'missing_alt_text', count: 5 }))).toBe('low');
    expect(calculateEffort(makeIssue({ type: 'title_too_long', count: 5 }))).toBe('low');
    expect(calculateEffort(makeIssue({ type: 'title_too_short', count: 5 }))).toBe('low');
    expect(calculateEffort(makeIssue({ type: 'meta_description_too_long', count: 5 }))).toBe('low');
    expect(calculateEffort(makeIssue({ type: 'meta_description_too_short', count: 5 }))).toBe('low');
    expect(calculateEffort(makeIssue({ type: 'temporary_redirects', count: 5 }))).toBe('low');
  });

  it('returns high for high-effort types', () => {
    expect(calculateEffort(makeIssue({ type: 'thin_content', count: 5 }))).toBe('high');
    expect(calculateEffort(makeIssue({ type: 'duplicate_content', count: 5 }))).toBe('high');
    expect(calculateEffort(makeIssue({ type: 'poor_performance_score', count: 5 }))).toBe('high');
    expect(calculateEffort(makeIssue({ type: 'critical_accessibility', count: 5 }))).toBe('high');
    expect(calculateEffort(makeIssue({ type: 'server_errors_5xx', count: 5 }))).toBe('high');
    expect(calculateEffort(makeIssue({ type: 'poor_lcp', count: 5 }))).toBe('high');
    expect(calculateEffort(makeIssue({ type: 'poor_cls', count: 5 }))).toBe('high');
    expect(calculateEffort(makeIssue({ type: 'orphan_pages', count: 5 }))).toBe('high');
  });

  it('returns medium for types not in low or high sets', () => {
    expect(calculateEffort(makeIssue({ type: 'broken_pages', count: 5 }))).toBe('medium');
    expect(calculateEffort(makeIssue({ type: 'duplicate_title', count: 5 }))).toBe('medium');
    expect(calculateEffort(makeIssue({ type: 'unknown_type', count: 5 }))).toBe('medium');
  });

  // --- scale adjustments ---
  it('adjusts low to medium when count > 100', () => {
    expect(calculateEffort(makeIssue({ type: 'missing_meta_description', count: 101 }))).toBe('medium');
  });

  it('keeps low when count is exactly 100', () => {
    expect(calculateEffort(makeIssue({ type: 'missing_meta_description', count: 100 }))).toBe('low');
  });

  it('adjusts medium to high when count > 50', () => {
    expect(calculateEffort(makeIssue({ type: 'broken_pages', count: 51 }))).toBe('high');
  });

  it('keeps medium when count is exactly 50', () => {
    expect(calculateEffort(makeIssue({ type: 'broken_pages', count: 50 }))).toBe('medium');
  });

  it('does not bump low directly to high (else-if prevents double bump)', () => {
    // count=101: low -> medium via first branch, second branch is else-if so skipped
    expect(calculateEffort(makeIssue({ type: 'missing_alt_text', count: 101 }))).toBe('medium');
  });

  it('does not adjust high-effort types regardless of count', () => {
    expect(calculateEffort(makeIssue({ type: 'thin_content', count: 1 }))).toBe('high');
    expect(calculateEffort(makeIssue({ type: 'thin_content', count: 200 }))).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// calculateRoi
// ---------------------------------------------------------------------------
describe('calculateRoi', () => {
  it('returns high when ratio >= 40', () => {
    // score=80, effort=low (1) => ratio=80
    expect(calculateRoi(80, 'low')).toBe('high');
    // score=40, effort=low => ratio=40 (boundary)
    expect(calculateRoi(40, 'low')).toBe('high');
  });

  it('returns medium when ratio >= 20 and < 40', () => {
    // score=20, effort=low => ratio=20 (boundary)
    expect(calculateRoi(20, 'low')).toBe('medium');
    // score=60, effort=medium (2) => ratio=30
    expect(calculateRoi(60, 'medium')).toBe('medium');
    // score=39, effort=low => ratio=39
    expect(calculateRoi(39, 'low')).toBe('medium');
  });

  it('returns low when ratio < 20', () => {
    // score=10, effort=low => ratio=10
    expect(calculateRoi(10, 'low')).toBe('low');
    // score=30, effort=high (3) => ratio=10
    expect(calculateRoi(30, 'high')).toBe('low');
    // score=57, effort=high => ratio=19
    expect(calculateRoi(57, 'high')).toBe('low');
  });

  it('handles boundary at ratio = 40 with medium effort', () => {
    // score=80, effort=medium (2) => ratio=40
    expect(calculateRoi(80, 'medium')).toBe('high');
  });

  it('handles boundary at ratio = 20 with high effort', () => {
    // score=60, effort=high (3) => ratio=20
    expect(calculateRoi(60, 'high')).toBe('medium');
  });

  it('returns low for score of 0', () => {
    expect(calculateRoi(0, 'low')).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// prioritizeIssues
// ---------------------------------------------------------------------------
describe('prioritizeIssues', () => {
  it('returns empty array for empty input', () => {
    expect(prioritizeIssues([])).toEqual([]);
  });

  it('attaches priority_score, effort, and roi to each issue', () => {
    const issues = [makeIssue({ type: 'broken_pages', count: 1, severity: 'critical' })];
    const result = prioritizeIssues(issues);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('priority_score');
    expect(result[0]).toHaveProperty('effort');
    expect(result[0]).toHaveProperty('roi');
  });

  it('sorts issues by priority_score descending', () => {
    const issues = [
      makeIssue({ type: 'noindex_pages', count: 1, severity: 'notice' }),
      makeIssue({ type: 'broken_pages', count: 1000, severity: 'critical' }),
      makeIssue({ type: 'missing_meta_description', count: 5, severity: 'warning' }),
    ];
    const result = prioritizeIssues(issues);
    expect(result[0].type).toBe('broken_pages');
    expect(result[2].type).toBe('noindex_pages');
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].priority_score).toBeGreaterThanOrEqual(result[i].priority_score);
    }
  });

  it('preserves original issue fields', () => {
    const issue = makeIssue({
      type: 'broken_pages',
      count: 3,
      severity: 'critical',
      description: 'Pages returning errors',
      urls: ['https://example.com/404'],
    });
    const result = prioritizeIssues([issue]);
    expect(result[0].description).toBe('Pages returning errors');
    expect(result[0].urls).toEqual(['https://example.com/404']);
    expect(result[0].type).toBe('broken_pages');
    expect(result[0].count).toBe(3);
  });

  it('computes correct scores matching calculatePriorityScore', () => {
    const issue = makeIssue({ type: 'broken_pages', count: 500, severity: 'critical' });
    const result = prioritizeIssues([issue]);
    expect(result[0].priority_score).toBe(calculatePriorityScore(issue));
  });

  it('handles single issue', () => {
    const result = prioritizeIssues([makeIssue({ type: 'missing_h1', count: 1, severity: 'warning' })]);
    expect(result).toHaveLength(1);
    expect(result[0].priority_score).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// getPrioritySummary
// ---------------------------------------------------------------------------
describe('getPrioritySummary', () => {
  const mixedIssues = {
    critical: [
      makeIssue({ type: 'broken_pages', count: 5, severity: 'critical', description: 'Broken' }),
    ],
    warnings: [
      makeIssue({ type: 'missing_meta_description', count: 10, severity: 'warning', description: 'Missing meta' }),
      makeIssue({ type: 'duplicate_title', count: 3, severity: 'warning', description: 'Dup title' }),
    ],
    notices: [
      makeIssue({ type: 'noindex_pages', count: 2, severity: 'notice', description: 'Noindex' }),
    ],
  };

  it('counts total issues correctly', () => {
    const summary = getPrioritySummary(mixedIssues);
    expect(summary.total_issues).toBe(4);
  });

  it('returns up to 10 top priorities', () => {
    const summary = getPrioritySummary(mixedIssues);
    expect(summary.top_priorities.length).toBeLessThanOrEqual(10);
    expect(summary.top_priorities.length).toBe(4);
  });

  it('caps top priorities at 10 for many issues', () => {
    const manyWarnings = Array.from({ length: 15 }, (_, i) =>
      makeIssue({ type: `issue_${i}`, count: i + 1, severity: 'warning', description: `Issue ${i}` })
    );
    const summary = getPrioritySummary({ critical: [], warnings: manyWarnings, notices: [] });
    expect(summary.top_priorities).toHaveLength(10);
  });

  it('returns quick wins filtered by high ROI, max 5', () => {
    const summary = getPrioritySummary(mixedIssues);
    expect(summary.quick_wins.length).toBeLessThanOrEqual(5);
    summary.quick_wins.forEach(qw => {
      expect(qw.roi).toBe('high');
    });
  });

  it('caps quick wins at 5', () => {
    // Create many low-effort, high-weight issues that should all be high-ROI
    const lotsOfQuickWins = Array.from({ length: 8 }, (_, i) =>
      makeIssue({ type: 'missing_meta_description', count: 5, severity: 'critical', description: `QW ${i}` })
    );
    const summary = getPrioritySummary({ critical: lotsOfQuickWins, warnings: [], notices: [] });
    expect(summary.quick_wins.length).toBeLessThanOrEqual(5);
  });

  it('computes effort breakdown that sums to total_issues', () => {
    const summary = getPrioritySummary(mixedIssues);
    const { low, medium, high } = summary.effort_breakdown;
    expect(low + medium + high).toBe(summary.total_issues);
  });

  it('computes total_impact_score as rounded sum of all priority scores', () => {
    const summary = getPrioritySummary(mixedIssues);
    const expectedTotal = summary.top_priorities.reduce((sum, i) => sum + i.priority_score, 0);
    expect(summary.total_impact_score).toBe(Math.round(expectedTotal * 10) / 10);
  });

  it('overrides severity from the category key', () => {
    // An issue placed in critical array gets severity='critical' regardless of its original value
    const issues = {
      critical: [makeIssue({ type: 'noindex_pages', count: 1, severity: 'notice' })],
      warnings: [],
      notices: [],
    };
    const summary = getPrioritySummary(issues);
    // Should use critical multiplier (1.5) not notice (0.6)
    expect(summary.top_priorities[0].priority_score).toBe(
      calculatePriorityScore(makeIssue({ type: 'noindex_pages', count: 1, severity: 'critical' }))
    );
  });

  it('handles empty input', () => {
    const summary = getPrioritySummary({ critical: [], warnings: [], notices: [] });
    expect(summary.total_issues).toBe(0);
    expect(summary.top_priorities).toEqual([]);
    expect(summary.quick_wins).toEqual([]);
    expect(summary.total_impact_score).toBe(0);
    expect(summary.effort_breakdown).toEqual({ low: 0, medium: 0, high: 0 });
  });

  it('top_priorities are sorted by score descending', () => {
    const summary = getPrioritySummary(mixedIssues);
    for (let i = 1; i < summary.top_priorities.length; i++) {
      expect(summary.top_priorities[i - 1].priority_score)
        .toBeGreaterThanOrEqual(summary.top_priorities[i].priority_score);
    }
  });
});

// ---------------------------------------------------------------------------
// formatPriorityMarkdown
// ---------------------------------------------------------------------------
describe('formatPriorityMarkdown', () => {
  const issues = {
    critical: [
      makeIssue({ type: 'broken_pages', count: 5, severity: 'critical', description: 'Pages broken' }),
    ],
    warnings: [
      makeIssue({ type: 'missing_meta_description', count: 10, severity: 'warning', description: 'Missing meta' }),
    ],
    notices: [],
  };

  it('contains Priority Analysis header', () => {
    const md = formatPriorityMarkdown(issues);
    expect(md).toContain('## Priority Analysis');
  });

  it('contains total issues and impact score', () => {
    const md = formatPriorityMarkdown(issues);
    expect(md).toContain('**Total Issues:** 2');
    expect(md).toContain('**Total Impact Score:**');
  });

  it('contains effort breakdown line', () => {
    const md = formatPriorityMarkdown(issues);
    expect(md).toContain('**Effort Breakdown:**');
    expect(md).toContain('effort fixes');
  });

  it('contains Top 10 Priorities table with correct header and separator', () => {
    const md = formatPriorityMarkdown(issues);
    expect(md).toContain('### Top 10 Priorities');
    expect(md).toContain('| Priority | Issue | Count | Score | Effort | ROI |');
    expect(md).toContain('|----------|-------|-------|-------|--------|-----|');
  });

  it('includes issue types in table rows', () => {
    const md = formatPriorityMarkdown(issues);
    expect(md).toContain('broken_pages');
    expect(md).toContain('missing_meta_description');
  });

  it('table rows have pipe-delimited columns with priority numbers', () => {
    const md = formatPriorityMarkdown(issues);
    // First row should start with | 1 |
    expect(md).toContain('| 1 |');
    expect(md).toContain('| 2 |');
  });

  it('includes Quick Wins section when high-ROI issues exist', () => {
    const md = formatPriorityMarkdown(issues);
    const summary = getPrioritySummary(issues);
    if (summary.quick_wins.length > 0) {
      expect(md).toContain('### Quick Wins (High ROI)');
    }
  });

  it('includes descriptions under quick win entries', () => {
    const md = formatPriorityMarkdown(issues);
    const summary = getPrioritySummary(issues);
    summary.quick_wins.forEach(qw => {
      if (qw.description) {
        expect(md).toContain(`- ${qw.description}`);
      }
    });
  });

  it('omits Quick Wins section when no high-ROI issues exist', () => {
    // All notice-severity, low-weight issues should have low ROI
    const lowIssues = {
      critical: [],
      warnings: [],
      notices: [
        makeIssue({ type: 'unknown_low', count: 1, severity: 'notice', description: 'Low' }),
      ],
    };
    const summary = getPrioritySummary(lowIssues);
    if (summary.quick_wins.length === 0) {
      const md = formatPriorityMarkdown(lowIssues);
      expect(md).not.toContain('### Quick Wins (High ROI)');
    }
  });

  it('handles empty issues without error', () => {
    const md = formatPriorityMarkdown({ critical: [], warnings: [], notices: [] });
    expect(md).toContain('## Priority Analysis');
    expect(md).toContain('**Total Issues:** 0');
    expect(md).toContain('**Total Impact Score:** 0');
  });

  it('returns a string', () => {
    const md = formatPriorityMarkdown(issues);
    expect(typeof md).toBe('string');
  });
});
