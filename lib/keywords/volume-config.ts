// lib/keywords/volume-config.ts
// Single home for all KS-2 DataForSEO volume-provider env reads + constants.
// Dark-by-default gate: isVolumeEnabled() (notify-config pattern). Env is read
// at CALL time, never cached at module load — PM2 restart semantics + testability.

export const DATAFORSEO_API_BASE = 'https://api.dataforseo.com'
export const VOLUME_REQUEST_TIMEOUT_MS = 30_000
export const PROVIDER_VERSION = 'google_ads_v3'
export const VOLUME_MAX_CHUNKS_PER_CALL = 3
export const VOLUME_CHUNK_SIZE = 1000
export const VOLUME_CACHE_TTL_DAYS = 30
export const KEYWORD_MAX_CHARS = 80
export const KEYWORD_MAX_WORDS = 10

export function isVolumeEnabled(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD)
}

export function dataForSeoAuthHeader(): string {
  if (!isVolumeEnabled()) throw new Error('volume provider disabled')
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64')
}
