// lib/services/pillarAnalysis/config.ts

export interface PillarConfig {
  clusterSimilarityThreshold: number;   // MiniLM cosine cut for cluster membership
  nearDuplicateThreshold: number;       // MiniLM cosine for `consolidate` verdict
  verticalAlignmentThreshold: number;   // cluster-to-program alignment threshold
  minClusterSize: number;               // min pages to constitute a "cluster"
  thinContentMaxWords: number;          // word count below which content is "thin"
  pruneMaxWords: number;                // word count below which content is `prune`-eligible
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
  clusterSimilarityThreshold: 0.55,
  nearDuplicateThreshold: 0.85,
  verticalAlignmentThreshold: 0.55,
  minClusterSize: 3,
  thinContentMaxWords: 500,
  pruneMaxWords: 100,
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
