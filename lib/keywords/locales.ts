// lib/keywords/locales.ts
// KS-3 curated keyword-locale list + the profile-locale validator.
// STRICTER than normalizeLocale on purpose (KS3-Codex #1/#2): bare two-letter
// language codes only — hyphenated regionals are rejected until DataForSEO's
// acceptance of lowercased regional codes is empirically verified (spec §8.3),
// and normalizeLocale itself is the Google Ads provider seam and stays untouched.

import { normalizeLocale } from './volume-normalize'

export interface CuratedLocale {
  label: string
  locationCode: number
  languageCode: string
}

export const CURATED_LOCALES: CuratedLocale[] = [
  { label: 'United States — English', locationCode: 2840, languageCode: 'en' },
  { label: 'Canada — English', locationCode: 2124, languageCode: 'en' },
  { label: 'Canada — French', locationCode: 2124, languageCode: 'fr' },
  { label: 'United Kingdom — English', locationCode: 2826, languageCode: 'en' },
  { label: 'Australia — English', locationCode: 2036, languageCode: 'en' },
  { label: 'United States — Spanish', locationCode: 2840, languageCode: 'es' },
]

const BARE_TWO_LETTER = /^[a-z]{2}$/

export function validateProfileLocale(
  input: unknown,
): { locationCode: number; languageCode: string } | null {
  if (!input || typeof input !== 'object') return null
  const { locationCode, languageCode } = input as { locationCode?: unknown; languageCode?: unknown }
  if (typeof locationCode !== 'number' || typeof languageCode !== 'string') return null
  const lang = languageCode.trim().toLowerCase()
  if (!BARE_TWO_LETTER.test(lang)) return null
  return normalizeLocale({ locationCode, languageCode: lang })
}
