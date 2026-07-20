// PR4: the ONE home of viewbook per-viewbook presentation config (collapse
// affordance + hero overlay strength). Client-safe (no server-only deps) —
// PR3's CollapsibleSection/SectionShell import the type + consts from here.
//
// Read (readPresentationConfig) NEVER throws — a corrupt/legacy stored row
// degrades to PRESENTATION_DEFAULTS, same pattern as theme.ts's
// parseStoredTheme. Write (parsePresentationPatch) is STRICT — throws
// HttpError(400) on anything malformed; the route lets it bubble.

import { HttpError } from '@/lib/api/errors'

// 2026-07-19 collapse local-only revision: the bar affordance is dropped —
// chevron (icon-only) and pill (labeled) are the only two looks. A legacy
// stored 'bar' row is NOT a valid member below, so readPresentationConfig
// degrades it to the default with no data migration required.
export const COLLAPSE_AFFORDANCES = ['chevron', 'pill'] as const
export type CollapseAffordanceKind = (typeof COLLAPSE_AFFORDANCES)[number]

export const PRESENTATION_DEFAULTS = {
  collapseAffordance: 'chevron' as CollapseAffordanceKind,
  heroOverlayStrength: 55,
  revealDurationScale: 1.0,
  firstLoadDelayMs: 3000,
}

const REVEAL_SCALE_MIN = 0.4
const REVEAL_SCALE_MAX = 1.6
const FIRST_LOAD_DELAY_MIN = 0
const FIRST_LOAD_DELAY_MAX = 6000

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function isAffordance(v: unknown): v is CollapseAffordanceKind {
  return typeof v === 'string' && (COLLAPSE_AFFORDANCES as readonly string[]).includes(v)
}

export function parsePresentationPatch(
  raw: Record<string, unknown>,
): Partial<{
  collapseAffordance: CollapseAffordanceKind
  heroOverlayStrength: number
  revealDurationScale: number
  firstLoadDelayMs: number
}> {
  const patch: Partial<{
    collapseAffordance: CollapseAffordanceKind
    heroOverlayStrength: number
    revealDurationScale: number
    firstLoadDelayMs: number
  }> = {}
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
  if ('revealDurationScale' in raw) {
    const n = raw.revealDurationScale
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, 'invalid_reveal_scale')
    patch.revealDurationScale = clamp(n, REVEAL_SCALE_MIN, REVEAL_SCALE_MAX)
  }
  if ('firstLoadDelayMs' in raw) {
    const n = raw.firstLoadDelayMs
    if (typeof n !== 'number' || !Number.isInteger(n)) throw new HttpError(400, 'invalid_first_load_delay')
    patch.firstLoadDelayMs = clamp(n, FIRST_LOAD_DELAY_MIN, FIRST_LOAD_DELAY_MAX)
  }
  return patch
}

export function readPresentationConfig(row: {
  collapseAffordance: string
  heroOverlayStrength: number
  revealDurationScale?: number
  firstLoadDelayMs?: number
}): {
  collapseAffordance: CollapseAffordanceKind
  heroOverlayStrength: number
  revealDurationScale: number
  firstLoadDelayMs: number
} {
  return {
    collapseAffordance: isAffordance(row.collapseAffordance)
      ? row.collapseAffordance
      : PRESENTATION_DEFAULTS.collapseAffordance,
    heroOverlayStrength: Number.isFinite(row.heroOverlayStrength)
      ? Math.max(0, Math.min(100, Math.round(row.heroOverlayStrength)))
      : PRESENTATION_DEFAULTS.heroOverlayStrength,
    revealDurationScale: Number.isFinite(row.revealDurationScale as number)
      ? clamp(row.revealDurationScale as number, REVEAL_SCALE_MIN, REVEAL_SCALE_MAX)
      : PRESENTATION_DEFAULTS.revealDurationScale,
    firstLoadDelayMs: Number.isFinite(row.firstLoadDelayMs as number)
      ? clamp(Math.round(row.firstLoadDelayMs as number), FIRST_LOAD_DELAY_MIN, FIRST_LOAD_DELAY_MAX)
      : PRESENTATION_DEFAULTS.firstLoadDelayMs,
  }
}
