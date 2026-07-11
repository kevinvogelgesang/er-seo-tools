// lib/keywords/volume-normalize.ts
// THE shared canonicalizer (Codex plan #1) — both the transport's response
// matching and the service's cache keys import from here so a keyword/locale
// only ever has one canonical form.

const LANGUAGE_CODE_RE = /^[a-z]{2}(-[a-z]{2,4})?$/

export function normalizeKeyword(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeLocale(locale: {
  locationCode: number
  languageCode: string
}): { locationCode: number; languageCode: string } | null {
  const { locationCode } = locale
  if (!Number.isInteger(locationCode) || locationCode <= 0) return null

  const languageCode = locale.languageCode.trim().toLowerCase()
  if (!LANGUAGE_CODE_RE.test(languageCode)) return null

  return { locationCode, languageCode }
}
