// lib/services/pillarAnalysis/cluster.ts
// Complete-linkage agglomerative clustering on cosine similarity.
// Returns a label per input vector. Singletons below threshold get label -1.
import { cosineSimilarity } from './embeddings';

export function agglomerativeCluster(
  vectors: number[][],
  similarityThreshold: number,
): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (n === 1) return [-1];

  // Each point starts in its own cluster
  const cluster = new Map<number, number[]>(); // clusterId -> indices
  for (let i = 0; i < n; i++) cluster.set(i, [i]);

  // Pairwise similarity matrix (only upper triangle)
  const sim: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sim[i][j] = cosineSimilarity(vectors[i], vectors[j]);
    }
  }

  // Complete-linkage = use the MIN pairwise sim across two clusters' members
  function clusterSim(a: number[], b: number[]): number {
    let min = Infinity;
    for (const i of a) for (const j of b) {
      const s = i < j ? sim[i][j] : sim[j][i];
      if (s < min) min = s;
    }
    return min;
  }

  while (true) {
    let bestSim = -Infinity;
    let bestA = -1;
    let bestB = -1;
    const ids = Array.from(cluster.keys());
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const s = clusterSim(cluster.get(ids[i])!, cluster.get(ids[j])!);
        if (s > bestSim) {
          bestSim = s;
          bestA = ids[i];
          bestB = ids[j];
        }
      }
    }
    if (bestSim < similarityThreshold) break;

    // Merge bestB into bestA
    cluster.set(bestA, [...cluster.get(bestA)!, ...cluster.get(bestB)!]);
    cluster.delete(bestB);
  }

  // Assign labels — singletons get -1, multi-member clusters get sequential ids
  const labels = new Array<number>(n).fill(-1);
  let nextId = 0;
  for (const members of cluster.values()) {
    if (members.length < 2) continue;
    for (const idx of members) labels[idx] = nextId;
    nextId++;
  }
  return labels;
}
