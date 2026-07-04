import { parseScoreVersion } from '@/lib/scoring/breakdown-version'

export function resolveDisplayScore(args: {
  persistedScore: number | null
  scoreBreakdown: string | null
  recompute: () => number | null
}): { score: number | null; version: number; fromFallback: boolean } {
  if (args.persistedScore != null) {
    return { score: args.persistedScore, version: parseScoreVersion(args.scoreBreakdown), fromFallback: false }
  }
  // Fallback recompute is always the frozen v1 formula.
  return { score: args.recompute(), version: 1, fromFallback: true }
}
