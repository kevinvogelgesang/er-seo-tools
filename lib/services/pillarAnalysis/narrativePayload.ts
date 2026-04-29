// lib/services/pillarAnalysis/narrativePayload.ts
//
// Transform a stored PillarAnalysis row into a narrative-shaped payload.
// The Bearer-protected GET /api/pillar-analysis/[id] endpoint uses this
// to feed the Claude narrative skill: the skill needs score data, hub
// recommendation, per-cluster anchor stats + sample members, verdict
// counts, and a few examples of low-confidence assignments — but does
// NOT need the full urlVerdicts list (159+ records with embeddings,
// full GSC fields, etc.). Trimming here lets the skill read the
// payload in a single tool call instead of chunk-and-parse loops.
//
// The dashboard does NOT consume this endpoint — it reads Prisma
// directly — so trimming is safe.

import type {
  HubRecommendation,
  PageType,
  PillarTopic,
  SubscoreBreakdown,
  SubscoreContext,
  SubscorePresence,
  UrlRecord,
  Verdict,
} from './types';

const LOW_CONFIDENCE_THRESHOLD = 0.7;
const SAMPLE_MEMBERS_PER_CLUSTER = 5;
const MAX_LOW_CONFIDENCE_SAMPLES = 5;

export interface NarrativeAnchorStats {
  title: string | null;
  h1: string | null;
  wordCount: number | null;
  inlinks: number | null;
  gscClicks: number | null;
  gscImpressions: number | null;
  gscPosition: number | null;
}

export interface NarrativeSampleMember {
  url: string;
  title: string | null;
  verdict: Verdict;
  verdictConfidence: number;
}

export interface NarrativeCluster {
  clusterId: number;
  name: string;
  pillarUrl: string | null;
  pillarPageType: PageType | null;
  size: number;
  anchorStats: NarrativeAnchorStats | null;
  sampleMembers: NarrativeSampleMember[];
}

export interface NarrativeLowConfidenceSample {
  url: string;
  pageType: PageType;
  verdict: Verdict;
  verdictConfidence: number;
  recommendedPillar: string | null;
}

export interface NarrativeExcludedAnchor {
  url: string;
  pageType: PageType;
  reasoning: string[];
}

export type VerdictSummary = Record<Verdict, number>;

export interface NarrativePayload {
  id: string;
  sessionId: string;
  /**
   * The site under analysis (e.g. "www.prowayhairschool.com"). Pulled from
   * Session.siteName, which is extracted from the crawled URLs. The skill
   * MUST use this in the memo and chat summary — NOT the webapp URL where
   * the dashboard happens to be hosted.
   */
  siteName: string | null;
  status: string;
  error: string | null;
  score: number | null;
  subscores: SubscoreBreakdown | null;
  subscorePresence: SubscorePresence | null;
  subscoreContext: SubscoreContext | null;
  dataCompleteness: number | null;
  hubRecommendation: HubRecommendation | null;
  clusters: NarrativeCluster[];
  verdictSummary: VerdictSummary;
  totalUrls: number;
  lowConfidenceAssignments: {
    threshold: number;
    count: number;
    samples: NarrativeLowConfidenceSample[];
  };
  excludedAnchors: NarrativeExcludedAnchor[];
  createdAt: string;
  updatedAt: string;
}

interface PillarAnalysisRow {
  id: string;
  sessionId: string;
  status: string;
  error: string | null;
  score: number | null;
  subscores: string | null;
  subscorePresence: string | null;
  subscoreContext: string | null;
  dataCompleteness: number | null;
  hubRecommendation: string | null;
  pillarTopics: string | null;
  urlVerdicts: string | null;
  createdAt: Date;
  updatedAt: Date;
  session?: { siteName: string | null } | null;
}

function safeParse<T>(s: string | null): T | null {
  if (s == null) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

function emptyVerdictSummary(): VerdictSummary {
  return {
    pillar: 0,
    cluster: 0,
    'leave-as-blog': 0,
    consolidate: 0,
    prune: 0,
    excluded: 0,
  };
}

export function buildNarrativePayload(row: PillarAnalysisRow): NarrativePayload {
  const subscores = safeParse<SubscoreBreakdown>(row.subscores);
  const subscorePresence = safeParse<SubscorePresence>(row.subscorePresence);
  const subscoreContext = safeParse<SubscoreContext>(row.subscoreContext);
  const hubRecommendation = safeParse<HubRecommendation>(row.hubRecommendation);
  const pillarTopics = safeParse<PillarTopic[]>(row.pillarTopics) ?? [];
  const urlVerdicts = safeParse<UrlRecord[]>(row.urlVerdicts) ?? [];

  const recordsByUrl = new Map<string, UrlRecord>();
  for (const r of urlVerdicts) recordsByUrl.set(r.url, r);

  const verdictSummary = emptyVerdictSummary();
  for (const r of urlVerdicts) {
    if (r.verdict in verdictSummary) verdictSummary[r.verdict] += 1;
  }

  const clusters: NarrativeCluster[] = pillarTopics.map(t => {
    const anchor = t.pillarUrl ? recordsByUrl.get(t.pillarUrl) ?? null : null;
    const memberRecords = t.clusterUrls
      .map(u => recordsByUrl.get(u))
      .filter((r): r is UrlRecord => r != null);
    const sampleMembers: NarrativeSampleMember[] = memberRecords
      .slice(0, SAMPLE_MEMBERS_PER_CLUSTER)
      .map(r => ({
        url: r.url,
        title: r.title,
        verdict: r.verdict,
        verdictConfidence: r.verdictConfidence,
      }));
    return {
      clusterId: t.clusterId,
      name: t.name,
      pillarUrl: t.pillarUrl,
      pillarPageType: t.pillarPageType,
      size: t.size,
      anchorStats: anchor ? {
        title: anchor.title,
        h1: anchor.h1,
        wordCount: anchor.wordCount,
        inlinks: anchor.inlinks,
        gscClicks: anchor.gscClicks,
        gscImpressions: anchor.gscImpressions,
        gscPosition: anchor.gscPosition,
      } : null,
      sampleMembers,
    };
  });

  const lowConfidenceMatches = urlVerdicts.filter(r =>
    r.verdictConfidence < LOW_CONFIDENCE_THRESHOLD &&
    (r.verdict === 'cluster' || r.verdict === 'leave-as-blog' || r.verdict === 'consolidate'),
  );
  const lowConfidenceSamples: NarrativeLowConfidenceSample[] = lowConfidenceMatches
    .slice(0, MAX_LOW_CONFIDENCE_SAMPLES)
    .map(r => ({
      url: r.url,
      pageType: r.pageType,
      verdict: r.verdict,
      verdictConfidence: r.verdictConfidence,
      recommendedPillar: r.recommendedPillar,
    }));

  const excludedAnchors: NarrativeExcludedAnchor[] = urlVerdicts
    .filter(r => (r.pageType === 'program' || r.pageType === 'location') && r.verdict === 'excluded')
    .map(r => ({ url: r.url, pageType: r.pageType, reasoning: r.reasoning }));

  return {
    id: row.id,
    sessionId: row.sessionId,
    siteName: row.session?.siteName ?? null,
    status: row.status,
    error: row.error,
    score: row.score,
    subscores,
    subscorePresence,
    subscoreContext,
    dataCompleteness: row.dataCompleteness,
    hubRecommendation,
    clusters,
    verdictSummary,
    totalUrls: urlVerdicts.length,
    lowConfidenceAssignments: {
      threshold: LOW_CONFIDENCE_THRESHOLD,
      count: lowConfidenceMatches.length,
      samples: lowConfidenceSamples,
    },
    excludedAnchors,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
