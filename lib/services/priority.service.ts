import { Issue } from '../types';

// SEO Impact weights for different issue categories
const ISSUE_WEIGHTS: Record<string, number> = {
  // Critical indexability issues (highest impact)
  broken_pages: 100,
  server_errors_5xx: 100,
  client_errors_4xx: 95,
  missing_title: 95,
  broken_internal_links: 90,
  broken_images: 85,
  broken_js: 80,
  long_redirect_chains: 80,
  poor_performance_score: 75,
  critical_accessibility: 70,
  broken_hreflang_targets: 70,

  // Important SEO elements
  missing_meta_description: 65,
  missing_h1: 60,
  duplicate_title: 60,
  duplicate_titles: 60,
  duplicate_content: 58,
  missing_canonical: 55,
  thin_content: 55,
  orphan_pages: 50,

  // Technical SEO
  redirect_chains: 50,
  mixed_content: 48,
  slow_server_response: 45,
  poor_lcp: 45,
  poor_cls: 40,
  sitemap_errors: 40,
  sitemap_redirects: 38,
  non_indexable_in_sitemap: 35,
  schema_validation_errors: 35,
  missing_hreflang_return: 35,

  // Other issues
  duplicate_meta_description: 35,
  duplicate_h1: 30,
  multiple_titles: 30,
  multiple_h1: 30,
  title_too_short: 25,
  title_too_long: 20,
  meta_description_too_short: 20,
  meta_description_too_long: 20,
  missing_h2: 15,
  noindex_pages: 10,
  temporary_redirects: 10,
  canonicalised_pages: 10,
  non_self_canonical: 10,

  // Resource issues (not already defined above)
  very_large_images: 45,
  large_images: 30,
  missing_alt_text: 30,
  large_js_files: 35,
  broken_css: 40,
  large_css_files: 20,
  broken_pdfs: 30,
  large_pdfs: 15,
  broken_external_links: 35,
  empty_anchor_text: 25,
  insecure_pages: 70,
};

const DEFAULT_WEIGHT = 25;

// Scale multipliers based on issue count
const SCALE_MULTIPLIERS: [number, number][] = [
  [1000, 2.0],
  [500, 1.8],
  [100, 1.5],
  [50, 1.3],
  [20, 1.2],
  [10, 1.1],
  [0, 1.0],
];

// Severity multipliers
const SEVERITY_MULTIPLIERS: Record<string, number> = {
  critical: 1.5,
  warning: 1.0,
  notice: 0.6,
};

// Low effort issue types (quick fixes)
const LOW_EFFORT_TYPES = new Set([
  'missing_meta_description',
  'missing_alt_text',
  'title_too_long',
  'title_too_short',
  'meta_description_too_long',
  'meta_description_too_short',
  'temporary_redirects',
]);

// High effort issue types
const HIGH_EFFORT_TYPES = new Set([
  'thin_content',
  'duplicate_content',
  'poor_performance_score',
  'critical_accessibility',
  'server_errors_5xx',
  'poor_lcp',
  'poor_cls',
  'orphan_pages',
]);

export interface ScoredIssue extends Issue {
  priority_score: number;
  effort: 'low' | 'medium' | 'high';
  roi: 'low' | 'medium' | 'high';
}

export interface PrioritySummary {
  total_issues: number;
  total_impact_score: number;
  top_priorities: ScoredIssue[];
  quick_wins: ScoredIssue[];
  effort_breakdown: {
    low: number;
    medium: number;
    high: number;
  };
}

/**
 * Calculate priority score for an issue
 */
export function calculatePriorityScore(issue: Issue): number {
  const baseWeight = ISSUE_WEIGHTS[issue.type] ?? DEFAULT_WEIGHT;

  // Scale multiplier based on count
  let scaleMult = 1.0;
  for (const [threshold, mult] of SCALE_MULTIPLIERS) {
    if (issue.count >= threshold) {
      scaleMult = mult;
      break;
    }
  }

  // Severity multiplier
  const severityMult = SEVERITY_MULTIPLIERS[issue.severity] ?? 1.0;

  return Math.round(baseWeight * scaleMult * severityMult * 10) / 10;
}

/**
 * Estimate effort to fix an issue
 */
export function calculateEffort(issue: Issue): 'low' | 'medium' | 'high' {
  let baseEffort: 'low' | 'medium' | 'high';

  if (LOW_EFFORT_TYPES.has(issue.type)) {
    baseEffort = 'low';
  } else if (HIGH_EFFORT_TYPES.has(issue.type)) {
    baseEffort = 'high';
  } else {
    baseEffort = 'medium';
  }

  // Adjust for scale
  if (issue.count > 100 && baseEffort === 'low') {
    baseEffort = 'medium';
  } else if (issue.count > 50 && baseEffort === 'medium') {
    baseEffort = 'high';
  }

  return baseEffort;
}

/**
 * Calculate ROI indicator
 */
export function calculateRoi(score: number, effort: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
  const effortValues = { low: 1, medium: 2, high: 3 };
  const roiRatio = score / effortValues[effort];

  if (roiRatio >= 40) return 'high';
  if (roiRatio >= 20) return 'medium';
  return 'low';
}

/**
 * Prioritize a list of issues
 */
export function prioritizeIssues(issues: Issue[]): ScoredIssue[] {
  return issues
    .map(issue => {
      const priority_score = calculatePriorityScore(issue);
      const effort = calculateEffort(issue);
      const roi = calculateRoi(priority_score, effort);

      return {
        ...issue,
        priority_score,
        effort,
        roi,
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score);
}

/**
 * Get priority summary for all issues
 */
export function getPrioritySummary(issues: {
  critical: Issue[];
  warnings: Issue[];
  notices: Issue[];
}): PrioritySummary {
  const allIssues: Issue[] = [
    ...issues.critical.map(i => ({ ...i, severity: 'critical' as const })),
    ...issues.warnings.map(i => ({ ...i, severity: 'warning' as const })),
    ...issues.notices.map(i => ({ ...i, severity: 'notice' as const })),
  ];

  const scored = prioritizeIssues(allIssues);

  const quickWins = scored.filter(i => i.roi === 'high').slice(0, 5);
  const topPriorities = scored.slice(0, 10);

  const totalScore = scored.reduce((sum, i) => sum + i.priority_score, 0);

  return {
    total_issues: scored.length,
    total_impact_score: Math.round(totalScore * 10) / 10,
    top_priorities: topPriorities,
    quick_wins: quickWins,
    effort_breakdown: {
      low: scored.filter(i => i.effort === 'low').length,
      medium: scored.filter(i => i.effort === 'medium').length,
      high: scored.filter(i => i.effort === 'high').length,
    },
  };
}

/**
 * Format prioritized issues as markdown
 */
export function formatPriorityMarkdown(issues: {
  critical: Issue[];
  warnings: Issue[];
  notices: Issue[];
}): string {
  const summary = getPrioritySummary(issues);
  const lines: string[] = [];

  lines.push('## Priority Analysis');
  lines.push('');
  lines.push(`**Total Issues:** ${summary.total_issues}`);
  lines.push(`**Total Impact Score:** ${summary.total_impact_score}`);
  lines.push('');

  const effort = summary.effort_breakdown;
  lines.push(`**Effort Breakdown:** ${effort.low} low, ${effort.medium} medium, ${effort.high} high effort fixes`);
  lines.push('');

  if (summary.quick_wins.length > 0) {
    lines.push('### Quick Wins (High ROI)');
    lines.push('');
    summary.quick_wins.forEach((issue, i) => {
      lines.push(`${i + 1}. **${issue.type}** (${issue.count} pages) - Score: ${issue.priority_score}`);
      if (issue.description) {
        lines.push(`   - ${issue.description}`);
      }
    });
    lines.push('');
  }

  lines.push('### Top 10 Priorities');
  lines.push('');
  lines.push('| Priority | Issue | Count | Score | Effort | ROI |');
  lines.push('|----------|-------|-------|-------|--------|-----|');

  summary.top_priorities.forEach((issue, i) => {
    lines.push(`| ${i + 1} | ${issue.type} | ${issue.count} | ${issue.priority_score} | ${issue.effort} | ${issue.roi} |`);
  });

  lines.push('');

  return lines.join('\n');
}
