// PR4: the ONE home of viewbook per-viewbook presentation config (collapse
// affordance + hero overlay strength). Client-safe (no server-only deps) —
// PR3's CollapsibleSection/SectionShell import the type + consts from here.
//
// Read (readPresentationConfig) NEVER throws — a corrupt/legacy stored row
// degrades to PRESENTATION_DEFAULTS, same pattern as theme.ts's
// parseStoredTheme. Write (parsePresentationPatch) is STRICT — throws
// HttpError(400) on anything malformed; the route lets it bubble.

import { HttpError } from '@/lib/api/errors'

export const COLLAPSE_AFFORDANCES = ['bar', 'pill', 'chevron'] as const
export type CollapseAffordanceKind = (typeof COLLAPSE_AFFORDANCES)[number]

export const PRESENTATION_DEFAULTS = {
  collapseAffordance: 'bar' as CollapseAffordanceKind,
  heroOverlayStrength: 55,
}

function isAffordance(v: unknown): v is CollapseAffordanceKind {
  return typeof v === 'string' && (COLLAPSE_AFFORDANCES as readonly string[]).includes(v)
}

export function parsePresentationPatch(
  raw: Record<string, unknown>,
): Partial<{ collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number }> {
  const patch: Partial<{ collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number }> = {}
  if ('collapseAffordance' in raw) {
    if (!isAffordance(raw.collapseAffordance)) throw new HttpError(400, 'invalid_affordance')
    patch.collapseAffordance = raw.collapseAffordance
  }
  if ('heroOverlayStrength' in raw) {
    const n = raw.heroOverlayStrength
    // Require a FINITE INTEGER before clamping (Codex FIX-10) — reject 12.5, NaN, "high".
    if (typeof n !== 'number' || !Number.isInteger(n)) throw new HttpError(400, 'invalid_overlay')
    patch.heroOverlayStrength = Math.max(0, Math.min(100, n))
  }
  return patch
}

export function readPresentationConfig(row: {
  collapseAffordance: string
  heroOverlayStrength: number
}): { collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number } {
  return {
    collapseAffordance: isAffordance(row.collapseAffordance)
      ? row.collapseAffordance
      : PRESENTATION_DEFAULTS.collapseAffordance,
    heroOverlayStrength: Number.isFinite(row.heroOverlayStrength)
      ? Math.max(0, Math.min(100, Math.round(row.heroOverlayStrength)))
      : PRESENTATION_DEFAULTS.heroOverlayStrength,
  }
}
