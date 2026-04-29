// lib/services/pillarAnalysis/types.ts

export type PageType =
  | 'program'
  | 'location'
  | 'blog'
  | 'news'
  | 'resource'
  | 'nav'
  | 'home'
  | 'unknown';

export type IntentClass =
  | 'informational'
  | 'commercial'
  | 'transactional'
  | 'navigational'
  | 'unknown';

export type Verdict =
  | 'pillar'
  | 'cluster'
  | 'leave-as-blog'
  | 'consolidate'
  | 'prune'
  | 'excluded';

export type HubFormat =
  | 'nest-under-programs'
  | 'hybrid'
  | 'rename-blog-to-resources'
  | 'fresh-resources-hub'
  | 'fresh-career-guides-hub';

export interface UrlRecord {
  url: string;
  pageType: PageType;
  pageTypeConfidence: number;

  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  firstParagraph: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  inlinks: number | null;
  outlinks: number | null;
  indexable: boolean;

  gscClicks: number | null;
  gscImpressions: number | null;
  gscCtr: number | null;
  gscPosition: number | null;

  ga4Sessions: number | null;
  ga4EngagementRate: number | null;
  ga4KeyEvents: number | null;

  referringDomains: number | null;
  organicKeywords: number | null;

  intentClass: IntentClass;
  intentConfidence: number;
  topicClusterId: number | null;
  verdict: Verdict;
  verdictConfidence: number;
  recommendedPillar: string | null;
  reasoning: string[];
}

export interface SubscoreBreakdown {
  contentVolume: number;
  topicalConcentration: number;
  organicFootprint: number;
  internalLinkGap: number;
  programPageClarity: number;
  backlinkDistribution: number;
}

/**
 * Per-subscore "did we have real data for this?" map. Parallel to
 * SubscoreBreakdown. When a value is `false` the corresponding subscore
 * was substituted with the neutral 5.0 default for composite-score
 * stability — the dashboard surfaces it as N/A so users don't mistake
 * the placeholder for a real measurement.
 */
export interface SubscorePresence {
  contentVolume: boolean;
  topicalConcentration: boolean;
  organicFootprint: boolean;
  internalLinkGap: boolean;
  programPageClarity: boolean;
  backlinkDistribution: boolean;
}

export interface HubRecommendation {
  primary: HubFormat;
  alternates: Array<{ format: HubFormat; scoreDelta: number }>;
  reasoning: string[];
}

export interface PillarTopic {
  clusterId: number;
  name: string;            // derived from top-frequency terms
  pillarUrl: string | null; // anchor candidate, null if cluster too small
  pillarPageType: PageType | null; // 'program' | 'location' | null (null for catchall)
  clusterUrls: string[];
  size: number;
}

export interface PillarAnalysisResult {
  score: number;            // 1-10
  subscores: SubscoreBreakdown;
  subscorePresence: SubscorePresence;
  dataCompleteness: number; // 0.0-1.0
  hubRecommendation: HubRecommendation;
  pillarTopics: PillarTopic[];
  urlVerdicts: UrlRecord[];
}
