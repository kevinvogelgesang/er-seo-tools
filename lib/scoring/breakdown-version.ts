// Pure, client-safe. Read the formula version from a scoreBreakdown string.
// A null/absent/unparseable breakdown means the score predates versioning → v1.
export function parseScoreVersion(scoreBreakdown: string | null | undefined): number {
  if (!scoreBreakdown) return 1
  try {
    const v = (JSON.parse(scoreBreakdown) as { version?: unknown }).version
    return typeof v === 'number' && Number.isFinite(v) ? v : 1
  } catch {
    return 1
  }
}

// Read both the formula version and the weights hash (if any) from a
// scoreBreakdown string. Same tolerant style as parseScoreVersion: a
// null/absent/unparseable breakdown, or one with no weightsHash, degrades to
// { version: 1, weightsHash: null } rather than throwing.
export function parseScoreMeta(scoreBreakdown: string | null | undefined): { version: number; weightsHash: string | null } {
  if (!scoreBreakdown) return { version: 1, weightsHash: null }
  try {
    const parsed = JSON.parse(scoreBreakdown) as { version?: unknown; weightsHash?: unknown }
    const version = typeof parsed.version === 'number' && Number.isFinite(parsed.version) ? parsed.version : 1
    const weightsHash = typeof parsed.weightsHash === 'string' ? parsed.weightsHash : null
    return { version, weightsHash }
  } catch {
    return { version: 1, weightsHash: null }
  }
}
