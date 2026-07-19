// Client-safe viewbook theme kit: strict whole-object validator (spec §6,
// Codex fixes: plain-object-only, hasOwnProperty font lookup, UTF-8 byte cap,
// 0.179 luminance crossover). Read is exactly as strict as write —
// parseStoredTheme degrades to DEFAULT_THEME, never throws.

import { relativeLuminance } from './contrast'
import { FONT_MANIFEST, isAllowedFont } from './font-manifest'

export { FONT_MANIFEST as FONT_CATALOG }

export const SECTION_KEYS = [
  'welcome',
  'milestones',
  'data-source',
  'brand',
  'assessment',
  'strategy',
  'materials',
  'pc-intro',
  'pc-setup',
  'pc-invite',
  'pc-thanks',
  'kickoff-next',
  'ws-intro',
] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

// Server-enforced collapse allowlist — the ONE home shared by the operator
// Collapse control (SectionQuickControls) and the server (service.setSectionState).
// A collapsed section renders ONLY its hero band on the public view; its body
// (intro + content) is suppressed. Excluded from collapse:
//   - the framing bookends: pc-intro, pc-thanks
//   - client-INTERACTIVE sections whose forms the client must reach:
//       pc-setup / pc-invite / data-source (client form intake + acknowledgment),
//       milestones (client review-link feedback → insertClientFeedback),
//       materials (client link submission → insertClientMaterial)
// Everything else — operator-authored read-only content (welcome, brand,
// assessment, strategy, kickoff-next, ws-intro) — stays collapsible.
// This module is client-safe (no server imports), so both the client control
// and the server service import it without pulling client-only code.
export const COLLAPSE_EXCLUDED_SECTION_KEYS: ReadonlySet<string> = new Set([
  'pc-intro',
  'pc-thanks',
  'pc-setup',
  'pc-invite',
  'data-source',
  'milestones',
  'materials',
])

export function sectionSupportsCollapse(sectionKey: string): boolean {
  return !COLLAPSE_EXCLUDED_SECTION_KEYS.has(sectionKey)
}

export interface ViewbookTheme {
  primary: string
  secondary: string
  tertiary: string
  headingFont: string
  bodyFont: string
  logo: string | null
  sectionHeroes: Partial<Record<SectionKey, string>>
}

export const ASSET_FILENAME_RE = /^[a-z0-9-]+\.(png|jpe?g|webp)$/

export const DEFAULT_THEME: ViewbookTheme = {
  primary: '#122033',
  secondary: '#1D7F7F',
  tertiary: '#C99334',
  headingFont: 'inter',
  bodyFont: 'inter',
  logo: null,
  sectionHeroes: {},
}

const THEME_KEYS = ['primary', 'secondary', 'tertiary', 'headingFont', 'bodyFont', 'logo', 'sectionHeroes'] as const
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const THEME_BYTE_CAP = 8192

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function themeByteLength(theme: ViewbookTheme): number {
  return new TextEncoder().encode(JSON.stringify(theme)).length
}

export function validateViewbookTheme(raw: unknown): ViewbookTheme | null {
  if (!isPlainObject(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length !== THEME_KEYS.length) return null
  for (const k of THEME_KEYS) if (!(k in raw)) return null

  const { primary, secondary, tertiary, headingFont, bodyFont, logo, sectionHeroes } = raw
  for (const color of [primary, secondary, tertiary]) {
    if (typeof color !== 'string' || !HEX_RE.test(color)) return null
  }
  if (!isAllowedFont(headingFont) || !isAllowedFont(bodyFont)) return null
  if (logo !== null && (typeof logo !== 'string' || !ASSET_FILENAME_RE.test(logo))) return null
  if (!isPlainObject(sectionHeroes)) return null
  const heroes: Partial<Record<SectionKey, string>> = {}
  for (const [k, v] of Object.entries(sectionHeroes)) {
    if (!(SECTION_KEYS as readonly string[]).includes(k)) return null
    if (typeof v !== 'string' || !ASSET_FILENAME_RE.test(v)) return null
    heroes[k as SectionKey] = v
  }

  const theme: ViewbookTheme = {
    primary: primary as string,
    secondary: secondary as string,
    tertiary: tertiary as string,
    headingFont,
    bodyFont,
    logo: logo as string | null,
    sectionHeroes: heroes,
  }
  if (themeByteLength(theme) > THEME_BYTE_CAP) return null
  return theme
}

export function parseStoredTheme(json: string): ViewbookTheme {
  try {
    const parsed: unknown = JSON.parse(json)
    return validateViewbookTheme(parsed) ?? DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

// WCAG relative luminance via the shared contrast primitive (spec §9 — one impl,
// not two). 0.179 is the crossover where black and white text have equal
// contrast ratio against the background. Output is unchanged from the prior
// inlined 0.03928-threshold form for all byte-quantized #rrggbb inputs.
export function onThemeColorText(hex: string): '#ffffff' | '#111111' {
  return relativeLuminance(hex) > 0.179 ? '#111111' : '#ffffff'
}
