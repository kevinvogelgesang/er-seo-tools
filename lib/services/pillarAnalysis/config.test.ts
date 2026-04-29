import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from './config';

describe('pillarAnalysis config', () => {
  it('subscore weights sum to 1.0', () => {
    const w = DEFAULT_CONFIG.subscoreWeights;
    const sum = w.contentVolume + w.topicalConcentration + w.organicFootprint
      + w.internalLinkGap + w.programPageClarity + w.backlinkDistribution;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('mergeConfig overrides only provided keys', () => {
    const merged = mergeConfig({ clusterSimilarityThreshold: 0.7 });
    expect(merged.clusterSimilarityThreshold).toBe(0.7);
    expect(merged.nearDuplicateThreshold).toBe(DEFAULT_CONFIG.nearDuplicateThreshold);
    expect(merged.subscoreWeights).toEqual(DEFAULT_CONFIG.subscoreWeights);
  });

  it('mergeConfig deep-merges subscoreWeights', () => {
    const merged = mergeConfig({ subscoreWeights: { contentVolume: 0.30 } as any });
    expect(merged.subscoreWeights.contentVolume).toBe(0.30);
    expect(merged.subscoreWeights.topicalConcentration).toBe(DEFAULT_CONFIG.subscoreWeights.topicalConcentration);
  });

  it('mergeConfig overrides minContentWordsForCluster independently', () => {
    const merged = mergeConfig({ minContentWordsForCluster: 200 });
    expect(merged.minContentWordsForCluster).toBe(200);
    expect(merged.clusterSimilarityThreshold).toBe(DEFAULT_CONFIG.clusterSimilarityThreshold);
  });
});
