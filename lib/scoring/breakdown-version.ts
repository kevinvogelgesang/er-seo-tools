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
