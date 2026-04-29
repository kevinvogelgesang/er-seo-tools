// lib/services/pillarAnalysis.service.ts
import { joinUrlRecords, type JoinInput } from './pillarAnalysis/joinRecords';
import { embedTexts } from './pillarAnalysis/embeddings';
import { assignToAnchors } from './pillarAnalysis/anchorClustering';
import { decideHubFormat } from './pillarAnalysis/hubDecision';
import { assignVerdicts } from './pillarAnalysis/verdict';
import { computeFitScore } from './pillarAnalysis/score';
import { mergeConfig, DEFAULT_CONFIG, type PillarConfig } from './pillarAnalysis/config';
import type { PillarAnalysisResult, PillarTopic, UrlRecord } from './pillarAnalysis/types';

export interface RunInput extends JoinInput {
  configOverrides?: Partial<PillarConfig>;
}

/**
 * The full deterministic pipeline:
 *   parsers → join → embed → anchor-assign → score/hub/verdict
 * No external API calls; embeddings run locally via Transformers.js.
 *
 * Anchor-based clustering: program/location pages are predetermined pillars.
 * Each in-scope blog/news/resource is assigned to its closest anchor by cosine
 * similarity. Below-threshold pages go to a catchall (-2) for the hub recommendation.
 */
export async function runPillarAnalysisFromInputs(input: RunInput): Promise<PillarAnalysisResult> {
  const cfg = mergeConfig(input.configOverrides ?? {});

  // 1. Join per-URL records (already classifies pageType + intent)
  const records: UrlRecord[] = joinUrlRecords(input);

  // 2. Embed each record's text
  const texts = records.map(buildEmbeddingText);
  const vectors = await embedTexts(texts);
  const vectorByUrl = new Map<string, number[]>();
  records.forEach((r, i) => vectorByUrl.set(r.url, vectors[i]));

  // 3. Anchor-based assignment: each blog/news/resource → closest program/location
  const assignments = assignToAnchors(records, vectorByUrl, cfg.verticalAlignmentThreshold);
  records.forEach((r, i) => {
    r.topicClusterId = assignments[i].clusterId;
    if (
      assignments[i].pillarUrl &&
      (r.pageType === 'blog' || r.pageType === 'news' || r.pageType === 'resource')
    ) {
      r.recommendedPillar = assignments[i].pillarUrl;
    }
  });

  // 4. Build a degenerate verticality map for the hub-format decision tree.
  //    Program anchor → 1.0, location anchor → 0.5, catchall → 0.0.
  const verticality = buildVerticalityMap(records);

  // 5. Assign verdicts
  assignVerdicts(records, cfg);

  // 6. Score the site
  const fit = computeFitScore(records, cfg);

  // 7. Hub recommendation
  const hub = decideHubFormat(records, verticality, cfg);

  // 8. Pillar topic groupings (named from anchor title/H1)
  const pillarTopics = buildPillarTopics(records, cfg.minClusterSize);

  return {
    score: fit.score,
    subscores: fit.subscores,
    dataCompleteness: fit.dataCompleteness,
    hubRecommendation: hub,
    pillarTopics,
    urlVerdicts: records,
  };
}

function buildEmbeddingText(r: UrlRecord): string {
  return [r.title, r.h1, r.metaDescription, r.firstParagraph]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2048);
}

function buildVerticalityMap(records: UrlRecord[]): Map<number, number> {
  const result = new Map<number, number>();
  // Collect cluster ids actually present on in-scope members
  const clusterMembers = new Map<number, UrlRecord[]>();
  for (const r of records) {
    if (r.topicClusterId == null) continue;
    if (r.topicClusterId === -1) continue;
    const arr = clusterMembers.get(r.topicClusterId) ?? [];
    arr.push(r);
    clusterMembers.set(r.topicClusterId, arr);
  }
  for (const [clusterId, members] of clusterMembers.entries()) {
    if (clusterId === -2) {
      result.set(clusterId, 0);
      continue;
    }
    const anchor = members.find((m) => m.pageType === 'program' || m.pageType === 'location');
    if (anchor?.pageType === 'program') result.set(clusterId, 1.0);
    else if (anchor?.pageType === 'location') result.set(clusterId, 0.5);
    else result.set(clusterId, 0);
  }
  return result;
}

function buildPillarTopics(records: UrlRecord[], minClusterSize: number): PillarTopic[] {
  const byCluster = new Map<number, UrlRecord[]>();
  for (const r of records) {
    if (r.topicClusterId == null || r.topicClusterId < -2) continue;
    if (r.topicClusterId === -1) continue; // out-of-scope
    const arr = byCluster.get(r.topicClusterId) ?? [];
    arr.push(r);
    byCluster.set(r.topicClusterId, arr);
  }

  const topics: PillarTopic[] = [];
  for (const [clusterId, members] of byCluster.entries()) {
    if (clusterId === -2) {
      // Catchall
      const blogs = members.filter(
        (m) => m.pageType === 'blog' || m.pageType === 'news' || m.pageType === 'resource',
      );
      if (blogs.length < minClusterSize) continue;
      topics.push({
        clusterId,
        name: 'General Resources (catchall)',
        pillarUrl: null,
        clusterUrls: blogs.map((b) => b.url),
        size: blogs.length,
      });
    } else {
      // Anchor cluster: clusterId is the index of the anchor record
      const anchor = members.find((m) => m.pageType === 'program' || m.pageType === 'location');
      if (!anchor) continue;
      const blogs = members.filter((m) => m !== anchor);
      if (blogs.length < minClusterSize) continue; // Anchor exists but cluster too small
      topics.push({
        clusterId,
        name: anchor.title || anchor.h1 || prettifyUrl(anchor.url),
        pillarUrl: anchor.url,
        clusterUrls: blogs.map((b) => b.url),
        size: members.length,
      });
    }
  }
  return topics;
}

function prettifyUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.replace(/\/$/, '').split('/').pop() || 'page';
    return last.split('-').map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  } catch {
    return url;
  }
}

export type { PillarAnalysisResult, UrlRecord } from './pillarAnalysis/types';
export { DEFAULT_CONFIG };
