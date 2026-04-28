import { describe, it, expect } from 'vitest';
import { agglomerativeCluster } from './cluster';

describe('agglomerativeCluster', () => {
  it('clusters 3 obviously-similar vectors together', () => {
    const vectors = [
      [1, 0], [0.99, 0.01], [0.98, 0.02], // cluster A
      [0, 1], [0.01, 0.99],                // cluster B
    ];
    const labels = agglomerativeCluster(vectors, 0.95);
    // First three in same cluster
    expect(labels[0]).toBe(labels[1]);
    expect(labels[1]).toBe(labels[2]);
    // Last two in same cluster
    expect(labels[3]).toBe(labels[4]);
    // Different clusters across groups
    expect(labels[0]).not.toBe(labels[3]);
  });

  it('returns -1 for singletons below threshold', () => {
    const vectors = [
      [1, 0], [0.99, 0.01], [0.98, 0.02],
      [0, 1], // alone
    ];
    const labels = agglomerativeCluster(vectors, 0.95);
    expect(labels[3]).toBe(-1);
  });

  it('handles empty input', () => {
    expect(agglomerativeCluster([], 0.5)).toEqual([]);
  });

  it('handles single vector', () => {
    expect(agglomerativeCluster([[1, 0]], 0.5)).toEqual([-1]);
  });

  it('threshold=0 puts everything in one cluster', () => {
    const vectors = [[1, 0], [0, 1], [0.5, 0.5]];
    const labels = agglomerativeCluster(vectors, 0);
    expect(new Set(labels).size).toBe(1);
  });
});
