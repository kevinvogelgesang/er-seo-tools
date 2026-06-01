import type { AggregatedResult, Issue, Recommendation, UrlRef } from '@/lib/types';
import { calculateEffort } from './priority.service';
import { rehydrate } from './url-registry';
import { ISSUE_RECOMMENDATIONS, fillRecommendationTemplate } from '@/lib/constants/issue-recommendations';

const SEV_ORDER = { critical: 0, warning: 1, notice: 2 } as const;

function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function buildStructuredRecommendations(result: AggregatedResult): Recommendation[] {
  const reg = result.url_registry;
  const all: Array<{ issue: Issue; severity: 'critical' | 'warning' | 'notice' }> = [
    ...result.issues.critical.map((issue) => ({ issue, severity: 'critical' as const })),
    ...result.issues.warnings.map((issue) => ({ issue, severity: 'warning' as const })),
    ...result.issues.notices.map((issue) => ({ issue, severity: 'notice' as const })),
  ];

  const recs: Recommendation[] = all.map(({ issue, severity }) => {
    const refs: UrlRef[] = issue.affectedUrlRefs ?? [];
    const urls = reg && refs.length
      ? refs.map((r) => rehydrate(reg, r)).filter(Boolean)
      : (issue.urls ?? []);
    const sortedUrls = [...urls].sort();
    const template = ISSUE_RECOMMENDATIONS[issue.type];
    const source = issue.affectedUrlSource ?? 'unknown';
    return {
      issueType: issue.type,
      severity,
      count: issue.count,
      effort: calculateEffort(issue),
      fixGuidance: template ? fillRecommendationTemplate(template, issue.count) : `Address ${issue.count} ${issue.type} issue(s).`,
      affectedUrlRefs: refs,
      affectedUrlCount: refs.length || urls.length,
      affectedUrlComplete: issue.affectedUrlRefsComplete ?? false,
      affectedUrlSource: issue.affectedUrlSource,
      affectedSetHash: stableHash(`${issue.type}|${source}|${sortedUrls.join(',')}`),
      groups: issue.groups,
      sampleUrls: issue.urls,
    };
  });

  return recs.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}
