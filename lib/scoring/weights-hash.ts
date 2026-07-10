// SERVER-ONLY (node:crypto). Never import from a client component; the Score Lab
// shows live unsaved weights without a hash.
import { createHash } from 'crypto'

export function hashWeights(weights: Record<string, number>): string {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(weights).sort(([a], [b]) => a.localeCompare(b))),
  )
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12)
}
