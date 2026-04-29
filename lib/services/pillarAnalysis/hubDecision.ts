// lib/services/pillarAnalysis/hubDecision.ts
import type { UrlRecord, HubFormat, HubRecommendation } from './types';
import type { PillarConfig } from './config';

const CAREER_GUIDE_PATTERNS = [
  /\bcareer\b/i,
  /\bsalary\b/i,
  /\bhow to become\b/i,
  /\bjobs? for\b/i,
];

interface FormatScore {
  format: HubFormat;
  score: number;
  reasoning: string[];
}

export function decideHubFormat(
  records: UrlRecord[],
  clusterVerticality: Map<number, number>,
  cfg: PillarConfig,
): HubRecommendation {
  const clusters = Array.from(clusterVerticality.keys());

  // No clusters formed at all — there's literally nothing to organize. Honest
  // recommendation: the site doesn't have enough informational content to pillar.
  if (clusters.length === 0) {
    return {
      primary: 'insufficient-content',
      alternates: [],
      reasoning: [
        'No topic clusters formed — site has no informational pages or content is too sparse to anchor a pillar model.',
        'Recommendation: focus on content production first. Re-run pillar analysis once the site has 15+ informational posts AND at least one program or location anchor with associated content.',
      ],
    };
  }

  const programs = records.filter((r) => r.pageType === 'program');
  const programsHaveInfoImpressions = programs.some(
    (p) => (p.gscImpressions ?? 0) > 0,
  );

  const vertical = clusters.filter(
    (c) => (clusterVerticality.get(c) ?? 0) >= cfg.verticalAlignmentThreshold,
  );
  const horizontal = clusters.filter(
    (c) => (clusterVerticality.get(c) ?? 0) < cfg.verticalAlignmentThreshold,
  );
  const verticalShare = clusters.length === 0 ? 0 : vertical.length / clusters.length;

  const horizontalRecords = records.filter(
    (r) => r.topicClusterId != null && horizontal.includes(r.topicClusterId),
  );
  const careerGuideyHits = horizontalRecords.filter((r) => {
    const text = `${r.title || ''} ${r.h1 || ''}`;
    return CAREER_GUIDE_PATTERNS.some((p) => p.test(text));
  }).length;
  const careerGuideyRatio = horizontalRecords.length === 0
    ? 0
    : careerGuideyHits / horizontalRecords.length;

  const candidates: FormatScore[] = [
    {
      format: 'nest-under-programs',
      score: verticalShare * 6 + (programsHaveInfoImpressions ? 4 : 0),
      reasoning: [
        `${Math.round(verticalShare * 100)}% of clusters are program-aligned`,
        programsHaveInfoImpressions
          ? 'program pages already pull informational impressions'
          : 'program pages do not currently rank for informational queries',
      ],
    },
    {
      format: 'hybrid',
      score: clusters.length === 0 ? 0 : (1 - Math.abs(verticalShare - 0.5)) * 8 + 1,
      reasoning: [
        `vertical/horizontal split ratio is ${Math.round(verticalShare * 100)}/${Math.round((1 - verticalShare) * 100)}`,
        'mixed split favors per-cluster routing',
      ],
    },
    {
      format: 'rename-blog-to-resources',
      score: (1 - verticalShare) * 4 + (hasBlogBacklinkAuthority(records) ? 3 : 0),
      reasoning: [
        `${Math.round((1 - verticalShare) * 100)}% horizontal clusters argue for a non-program hub`,
        hasBlogBacklinkAuthority(records)
          ? 'existing /blog/ has backlink authority worth preserving'
          : 'no significant blog backlink authority',
      ],
    },
    {
      format: 'fresh-career-guides-hub',
      score: careerGuideyRatio * 9,
      reasoning: [
        `${Math.round(careerGuideyRatio * 100)}% of horizontal cluster pages match career-guide keyword patterns`,
      ],
    },
    {
      format: 'fresh-resources-hub',
      score: (1 - verticalShare) * 3,
      reasoning: ['horizontal clusters with no other strong signal'],
    },
  ];

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  const alternates = candidates
    .slice(1)
    .map((c) => ({ format: c.format, scoreDelta: winner.score - c.score }));

  return {
    primary: winner.format,
    alternates,
    reasoning: winner.reasoning,
  };
}

function hasBlogBacklinkAuthority(records: UrlRecord[]): boolean {
  const blogRecs = records.filter(
    (r) => r.pageType === 'blog' && r.url.includes('/blog/'),
  );
  const totalRD = blogRecs.reduce((a, r) => a + (r.referringDomains ?? 0), 0);
  return totalRD >= 10;
}
