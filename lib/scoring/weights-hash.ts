// SERVER-ONLY (node:crypto). Never import from a client component; the Score Lab
// shows live unsaved weights without a hash.
import { createHash } from 'crypto'
import type { ScoringWeights } from './weights'
import type { AdaV4Weights } from './ada-v4'

export function hashWeights(weights: ScoringWeights | AdaV4Weights | Record<string, number>): string {
  const record = weights as unknown as Record<string, number> // single cast, here only
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))),
  )
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12)
}
