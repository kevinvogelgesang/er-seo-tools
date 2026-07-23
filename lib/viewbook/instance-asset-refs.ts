// Pure extraction of asset filename references from instance content.
// Single home for identifying which files a viewbook instance references,
// consumed by Tasks 3 (asset copy), 8 (allowlist/retention/delete unions).
// Never throws; corrupt JSON → [].

import { isPlainObject } from './content-validators'
import { ASSET_FILENAME_RE } from './theme'

/**
 * Extract asset filename references from a viewbook instance's subsection content.
 * Pure function, never throws (corrupt JSON → []).
 * Lenient extraction: valid filenames pass through even if the full content
 * fails validation (e.g., invalid filename in another member).
 *
 * @param rendererType - The subsection renderer type (e.g. 'welcome', 'strategy')
 * @param contentJson - Serialized SubsectionContentV1 envelope or null
 * @returns Array of valid asset filenames matching ASSET_FILENAME_RE
 */
export function extractInstanceAssetRefs(rendererType: string, contentJson: string | null): string[] {
  try {
    if (contentJson === null) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(contentJson)
    } catch {
      return []
    }

    // Envelope check: plain object with v === 1
    if (!isPlainObject(parsed) || parsed.v !== 1) {
      return []
    }

    // Only the 'welcome' renderer has asset refs (team roster photos) in F2
    if (rendererType !== 'welcome') {
      return []
    }

    // Lenient team extraction: collect any team array that exists
    const team = parsed.team
    if (!Array.isArray(team)) return []

    const refs: string[] = []
    for (const member of team) {
      if (!isPlainObject(member)) continue
      const photo = member.photo
      // Valid ref: non-null string matching the filename grammar
      if (photo !== null && typeof photo === 'string' && ASSET_FILENAME_RE.test(photo)) {
        refs.push(photo)
      }
    }
    return refs
  } catch {
    // Any other parse error → []
    return []
  }
}
