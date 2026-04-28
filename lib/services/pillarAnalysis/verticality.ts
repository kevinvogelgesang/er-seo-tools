// lib/services/pillarAnalysis/verticality.ts
import type { UrlRecord } from './types';
import { cosineSimilarity } from './embeddings';

/**
 * For each cluster, compute the maximum cosine similarity between the
 * cluster's centroid and any program-page vector. Higher = more program-aligned.
 */
export function computeClusterVerticality(
  records: UrlRecord[],
  vectorsByUrl: Map<string, number[]>,
): Map<number, number> {
  const result = new Map<number, number>();

  const clusters = new Map<number, UrlRecord[]>();
  for (const r of records) {
    if (r.topicClusterId == null || r.topicClusterId < 0) continue;
    const arr = clusters.get(r.topicClusterId) ?? [];
    arr.push(r);
    clusters.set(r.topicClusterId, arr);
  }

  const programVectors = records
    .filter((r) => r.pageType === 'program')
    .map((r) => vectorsByUrl.get(r.url))
    .filter((v): v is number[] => v != null);

  if (programVectors.length === 0) {
    for (const id of clusters.keys()) result.set(id, 0);
    return result;
  }

  for (const [clusterId, members] of clusters.entries()) {
    const memberVectors = members
      .map((m) => vectorsByUrl.get(m.url))
      .filter((v): v is number[] => v != null);
    if (memberVectors.length === 0) {
      result.set(clusterId, 0);
      continue;
    }
    const centroid = meanVector(memberVectors);
    let best = -Infinity;
    for (const pv of programVectors) {
      const s = cosineSimilarity(centroid, pv);
      if (s > best) best = s;
    }
    result.set(clusterId, Math.max(0, best));
  }

  return result;
}

function meanVector(vs: number[][]): number[] {
  const dim = vs[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vs) for (let i = 0; i < dim; i++) out[i] += v[i];
  for (let i = 0; i < dim; i++) out[i] /= vs.length;
  return out;
}
