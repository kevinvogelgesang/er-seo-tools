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
    // Fold in group URLs: grouped issues (duplicate_title, duplicate_h1,
    // duplicate meta) carry their affected URLs in groups[*].urls, NOT in
    // issue.urls / affectedUrlRefs. Without this they'd hash an empty set and
    // report affectedUrlCount: 0, colliding across all grouped types.
    const groupUrls = (issue.groups ?? []).flatMap((g) => g.urls ?? []);
    const knownUrls = Array.from(new Set([...urls, ...groupUrls]));
    const sortedUrls = [...knownUrls].sort();
    const template = ISSUE_RECOMMENDATIONS[issue.type];
    return {
      issueType: issue.type,
      severity,
      count: issue.count,
      effort: calculateEffort(issue),
      fixGuidance: template ? fillRecommendationTemplate(template, issue.count) : `Address ${issue.count} ${issue.type} issue(s).`,
      affectedUrlRefs: refs,
      affectedUrlCount: refs.length || knownUrls.length,
      affectedUrlComplete: issue.affectedUrlRefsComplete ?? false,
      affectedUrlSource: issue.affectedUrlSource,
      // Hash the affected-URL SET only. Exclude `source`: it can flip
      // (parser-sample -> derived-page-index) for an unchanged URL set and would
      // break cross-crawl dedupe / future auto-resolve. JSON.stringify the
      // sorted list so URLs containing commas can't collide. (Callers should
      // treat this as authoritative only when affectedUrlComplete === true.)
      affectedSetHash: stableHash(`${issue.type}|${JSON.stringify(sortedUrls)}`),
      groups: issue.groups,
      sampleUrls: issue.urls,
    };
  });

  return recs.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}
