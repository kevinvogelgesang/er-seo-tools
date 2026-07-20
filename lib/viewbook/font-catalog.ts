// Full Google Fonts snapshot. Public client components MUST NOT statically
// import this module: the admin picker loads it with `await import(...)`, and
// public rendering reaches it only through the server-only theme seam.
import catalogJson from './font-catalog.json'

export interface CatalogFont {
  family: string
  supportedWeights: readonly string[]
  gfQuery: string
}

export interface CatalogSearchResult extends CatalogFont {
  key: string
}

export interface CatalogSearchResponse {
  results: CatalogSearchResult[]
  total: number
}

type CatalogSnapshot = Readonly<Record<string, readonly [string, readonly string[]]>>

const CATALOG = catalogJson as unknown as CatalogSnapshot
const PREFERRED_EXTRA_WEIGHTS = ['600', '700', '800', '900', '300', '500'] as const

function queryWeights(supportedWeights: readonly string[]): string[] {
  const extras = PREFERRED_EXTRA_WEIGHTS.filter((weight) => supportedWeights.includes(weight)).slice(0, 3)
  return ['400', ...extras].sort((a, b) => Number(a) - Number(b))
}

function toFont(tuple: readonly [string, readonly string[]]): CatalogFont {
  const [family, supportedWeights] = tuple
  return {
    family,
    supportedWeights,
    gfQuery: `family=${family.replaceAll(' ', '+')}:wght@${queryWeights(supportedWeights).join(';')}`,
  }
}

export function resolveCatalogFont(key: unknown): CatalogFont | null {
  if (!isCatalogFont(key)) return null
  return toFont(CATALOG[key])
}

export function isCatalogFont(key: unknown): key is string {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(CATALOG, key)
}

export function searchCatalogFonts(query: string, limit = 50): CatalogSearchResponse {
  const normalized = query.trim().toLocaleLowerCase()
  const matches = Object.entries(CATALOG).flatMap(([key, tuple]) => {
    const family = tuple[0]
    const haystack = `${family} ${key}`.toLocaleLowerCase()
    if (normalized && !haystack.includes(normalized)) return []
    const rank = !normalized ? 2 : family.toLocaleLowerCase().startsWith(normalized) || key.startsWith(normalized) ? 0 : 1
    return [{ key, rank, ...toFont(tuple) }]
  }).sort((a, b) => a.rank - b.rank || a.family.localeCompare(b.family))

  return {
    total: matches.length,
    results: matches.slice(0, Math.max(0, limit)).map(({ rank: _rank, ...font }) => font),
  }
}
