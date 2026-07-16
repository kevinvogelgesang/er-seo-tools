// Client-safe viewbook theme kit: strict whole-object validator (spec §6,
// Codex fixes: plain-object-only, hasOwnProperty font lookup, UTF-8 byte cap,
// 0.179 luminance crossover). Read is exactly as strict as write —
// parseStoredTheme degrades to DEFAULT_THEME, never throws.

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

// Curated Google Fonts. gfQuery values are code-owned constants — client input
// never reaches the fonts URL (only catalog KEYS are stored on themes).
export const FONT_CATALOG: Record<string, { family: string; gfQuery: string }> = {
  inter: { family: 'Inter', gfQuery: 'family=Inter:wght@400;600;800' },
  lora: { family: 'Lora', gfQuery: 'family=Lora:wght@400;600;700' },
  'playfair-display': { family: 'Playfair Display', gfQuery: 'family=Playfair+Display:wght@400;700;900' },
  montserrat: { family: 'Montserrat', gfQuery: 'family=Montserrat:wght@400;600;800' },
  oswald: { family: 'Oswald', gfQuery: 'family=Oswald:wght@400;600;700' },
  merriweather: { family: 'Merriweather', gfQuery: 'family=Merriweather:wght@400;700;900' },
  'source-sans-3': { family: 'Source Sans 3', gfQuery: 'family=Source+Sans+3:wght@400;600;700' },
  'work-sans': { family: 'Work Sans', gfQuery: 'family=Work+Sans:wght@400;600;800' },
  'libre-baskerville': { family: 'Libre Baskerville', gfQuery: 'family=Libre+Baskerville:wght@400;700' },
  poppins: { family: 'Poppins', gfQuery: 'family=Poppins:wght@400;600;800' },
  archivo: { family: 'Archivo', gfQuery: 'family=Archivo:wght@400;600;800' },
  'dm-serif-display': { family: 'DM Serif Display', gfQuery: 'family=DM+Serif+Display:wght@400' },
}

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

function isCatalogFont(key: unknown): key is string {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(FONT_CATALOG, key)
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
  if (!isCatalogFont(headingFont) || !isCatalogFont(bodyFont)) return null
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

// WCAG relative luminance; 0.179 is the crossover where black and white text
// have equal contrast ratio against the background.
export function onThemeColorText(hex: string): '#ffffff' | '#111111' {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
  return luminance > 0.179 ? '#111111' : '#ffffff'
}
