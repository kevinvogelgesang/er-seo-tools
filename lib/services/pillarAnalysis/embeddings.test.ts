import { describe, it, expect, beforeAll } from 'vitest';
import { embedTexts, cosineSimilarity } from './embeddings';

describe('embeddings', () => {
  beforeAll(() => {
    // Allow extra time for first model load
  }, 60_000);

  it('produces 384-dim vectors', async () => {
    const [v] = await embedTexts(['hello world']);
    expect(v).toHaveLength(384);
  }, 60_000);

  it('similar texts have higher cosine than unrelated ones', async () => {
    const [a, b, c] = await embedTexts([
      'how to become a registered nurse',
      'becoming an RN: what you need to know',
      'best pizza recipes for the weekend',
    ]);
    const simAB = cosineSimilarity(a, b);
    const simAC = cosineSimilarity(a, c);
    expect(simAB).toBeGreaterThan(simAC);
    expect(simAB).toBeGreaterThan(0.5);
  }, 60_000);

  it('cosineSimilarity returns 1.0 for identical vectors', () => {
    const v = [1, 0, 1, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});
