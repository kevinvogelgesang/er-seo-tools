// lib/services/pillarAnalysis/anchorClustering.ts
import type { UrlRecord } from './types';
import { cosineSimilarity } from './embeddings';

export interface AnchorAssignment {
  /** Index in the input records array, used as the cluster id. -2 indicates catchall. */
  clusterId: number;
  /** Anchor URL, or null for catchall. */
  pillarUrl: string | null;
  /** Best similarity score this record had to the chosen anchor (or 0 for catchall). */
  similarity: number;
}

/**
 * Assigns each in-scope informational record to its best-matching anchor (program/location)
 * by cosine similarity. Records below the threshold go to the catchall (-2).
 *
 * Returns a parallel array: result[i] is the assignment for records[i].
 * Records that aren't in scope (anchors themselves, nav, home) get clusterId = -1.
 */
export function assignToAnchors(
  records: UrlRecord[],
  vectorByUrl: Map<string, number[]>,
  similarityThreshold: number,
): AnchorAssignment[] {
  const result: AnchorAssignment[] = new Array(records.length);

  // Identify anchors and their indices
  const anchorIndices: number[] = [];
  records.forEach((r, i) => {
    if (r.pageType === 'program' || r.pageType === 'location') {
      anchorIndices.push(i);
    }
  });

  for (let i = 0; i < records.length; i++) {
    const r = records[i];

    // Anchors themselves: clusterId = own index (so the orchestrator can mark them as pillars later)
    if (r.pageType === 'program' || r.pageType === 'location') {
      result[i] = { clusterId: i, pillarUrl: r.url, similarity: 1.0 };
      continue;
    }

    // Out-of-scope (nav, home, unknown): clusterId = -1 (excluded)
    if (r.pageType !== 'blog' && r.pageType !== 'news' && r.pageType !== 'resource') {
      result[i] = { clusterId: -1, pillarUrl: null, similarity: 0 };
      continue;
    }

    // In-scope informational: find best anchor
    const recordVec = vectorByUrl.get(r.url);
    if (!recordVec) {
      result[i] = { clusterId: -2, pillarUrl: null, similarity: 0 };
      continue;
    }

    let bestSim = -Infinity;
    let bestAnchorIdx = -1;
    for (const ai of anchorIndices) {
      const anchorVec = vectorByUrl.get(records[ai].url);
      if (!anchorVec) continue;
      const sim = cosineSimilarity(recordVec, anchorVec);
      if (sim > bestSim) {
        bestSim = sim;
        bestAnchorIdx = ai;
      }
    }

    if (bestAnchorIdx >= 0 && bestSim >= similarityThreshold) {
      result[i] = {
        clusterId: bestAnchorIdx,
        pillarUrl: records[bestAnchorIdx].url,
        similarity: bestSim,
      };
    } else {
      // Catchall
      result[i] = { clusterId: -2, pillarUrl: null, similarity: bestSim < 0 ? 0 : bestSim };
    }
  }

  return result;
}
