// lib/services/pillarAnalysis.service.ts
import { joinUrlRecords, type JoinInput } from './pillarAnalysis/joinRecords';
import { embedTexts } from './pillarAnalysis/embeddings';
import { agglomerativeCluster } from './pillarAnalysis/cluster';
import { computeClusterVerticality } from './pillarAnalysis/verticality';
import { nameClusters } from './pillarAnalysis/topicNaming';
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
 *   parsers → join → embed → cluster → verticality → name → score/hub/verdict
 * No external API calls; embeddings run locally via Transformers.js.
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

  // 3. Cluster only the in-scope informational records
  const scopeIdxs: number[] = [];
  records.forEach((r, i) => {
    if (
      r.intentClass === 'informational' &&
      (r.pageType === 'blog' || r.pageType === 'news' || r.pageType === 'resource')
    ) {
      scopeIdxs.push(i);
    }
  });
  const scopeVectors = scopeIdxs.map((i) => vectors[i]);
  const labels = agglomerativeCluster(scopeVectors, cfg.clusterSimilarityThreshold);
  scopeIdxs.forEach((origIdx, scopeI) => {
    records[origIdx].topicClusterId = labels[scopeI];
  });

  // 4. Compute cluster verticality (vs program pages)
  const verticality = computeClusterVerticality(records, vectorByUrl);

  // 5. Assign verdicts
  assignVerdicts(records, cfg);

  // 6. Score the site
  const fit = computeFitScore(records, cfg);

  // 7. Hub recommendation
  const hub = decideHubFormat(records, verticality, cfg);

  // 8. Pillar topic groupings (named, with anchor URL)
  const topicNames = nameClusters(records);
  const pillarTopics = buildPillarTopics(records, topicNames, cfg.minClusterSize);

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

function buildPillarTopics(
  records: UrlRecord[],
  names: Map<number, string>,
  minClusterSize: number,
): PillarTopic[] {
  const byCluster = new Map<number, UrlRecord[]>();
  for (const r of records) {
    if (r.topicClusterId == null || r.topicClusterId < 0) continue;
    const arr = byCluster.get(r.topicClusterId) ?? [];
    arr.push(r);
    byCluster.set(r.topicClusterId, arr);
  }
  return Array.from(byCluster.entries())
    .filter(([, members]) => members.length >= minClusterSize)
    .map(([id, members]) => {
      const pillar = members.find((m) => m.verdict === 'pillar');
      return {
        clusterId: id,
        name: names.get(id) ?? `Cluster ${id + 1}`,
        pillarUrl: pillar?.url ?? null,
        clusterUrls: members.filter((m) => m.verdict === 'cluster').map((m) => m.url),
        size: members.length,
      };
    });
}

export type { PillarAnalysisResult, UrlRecord } from './pillarAnalysis/types';
export { DEFAULT_CONFIG };
