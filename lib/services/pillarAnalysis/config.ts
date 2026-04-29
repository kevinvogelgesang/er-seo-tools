// lib/services/pillarAnalysis/config.ts

export interface PillarConfig {
  clusterSimilarityThreshold: number;   // MiniLM cosine cut for cluster membership
  nearDuplicateThreshold: number;       // MiniLM cosine for `consolidate` verdict
  verticalAlignmentThreshold: number;   // cluster-to-program alignment threshold
  minClusterSize: number;               // min pages to constitute a "cluster"
  thinContentMaxWords: number;          // word count below which content is "thin"
  pruneMaxWords: number;                // word count below which content is `prune`-eligible
  /**
   * Pages with word count below this threshold are excluded from cluster
   * candidacy regardless of their pageType — they're typically forms,
   * stubs, or boilerplate that shouldn't compete for pillar/cluster slots.
   */
  minContentWordsForCluster: number;
  subscoreWeights: {
    contentVolume: number;
    topicalConcentration: number;
    organicFootprint: number;
    internalLinkGap: number;
    programPageClarity: number;
    backlinkDistribution: number;
  };
}

export const DEFAULT_CONFIG: PillarConfig = {
  // Tuned during the nuvani.edu smoke test: 0.55 produced ~19 clusters where
  // 5–8 were expected. 0.65 gives tighter, more meaningful groupings.
  clusterSimilarityThreshold: 0.65,
  nearDuplicateThreshold: 0.85,
  verticalAlignmentThreshold: 0.55,
  minClusterSize: 3,
  thinContentMaxWords: 500,
  pruneMaxWords: 100,
  minContentWordsForCluster: 150,
  subscoreWeights: {
    contentVolume: 0.25,
    topicalConcentration: 0.20,
    organicFootprint: 0.20,
    internalLinkGap: 0.15,
    programPageClarity: 0.15,
    backlinkDistribution: 0.05,
  },
};

export function mergeConfig(overrides: Partial<PillarConfig>): PillarConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    subscoreWeights: {
      ...DEFAULT_CONFIG.subscoreWeights,
      ...(overrides.subscoreWeights || {}),
    },
  };
}
