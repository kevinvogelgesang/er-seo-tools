// lib/services/pillarAnalysis/embeddings.ts
// Local-only embeddings via @xenova/transformers (ONNX runtime, pure JS).
// No external API calls.
import type { Pipeline } from '@xenova/transformers';

let extractorPromise: Promise<Pipeline> | null = null;

async function getExtractor(): Promise<Pipeline> {
  if (!extractorPromise) {
    // Lazy import keeps the (~1MB) module out of any bundle that doesn't
    // actually call into the embedding service.
    const { pipeline } = await import('@xenova/transformers');
    extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as Promise<Pipeline>;
  }
  return extractorPromise;
}

/**
 * Embeds an array of strings into 384-dim mean-pooled, L2-normalized vectors.
 * Batched internally by the pipeline; safe for arrays of thousands.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  // output is a Tensor with shape [N, 384]. Convert to number[][].
  const data = Array.from(output.data as Float32Array);
  const dim = output.dims[1] as number;
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    result.push(data.slice(i * dim, (i + 1) * dim));
  }
  return result;
}

/** Cosine similarity for L2-normalized vectors is just dot product. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Test-only: drop the cached extractor (for memory or re-warm scenarios). */
export function _resetExtractorForTesting(): void {
  extractorPromise = null;
}
