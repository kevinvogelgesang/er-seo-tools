// lib/findings/keys.ts
//
// Canonical identity helpers for the normalized findings layer.
// Same hashing discipline as lib/ada-audit/checks-keys.ts: sha256 of
// canonical JSON, never delimiter-joined raw strings.
import { createHash } from 'crypto'
import { canonicalJson } from '@/lib/ada-audit/checks-keys'

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Normalization shared by CrawlPage.url, Finding.url, and the page dedup
 * key: lowercase host, drop fragment, strip the trailing slash on a bare
 * root path. Non-URLs pass through unchanged.
 */
export function normalizeFindingUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  u.hash = ''
  let out = u.toString()
  if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
  return out
}

export function runFindingKey(type: string): string {
  return sha256Hex(canonicalJson({ scope: 'run', type }))
}

export function pageFindingKey(type: string, url: string): string {
  return sha256Hex(canonicalJson({ scope: 'page', type, url: normalizeFindingUrl(url) }))
}
