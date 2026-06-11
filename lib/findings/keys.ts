// lib/findings/keys.ts
//
// Canonical identity helpers for the normalized findings layer.
// Same hashing discipline as lib/ada-audit/checks-keys.ts: sha256 of
// canonical JSON, never delimiter-joined raw strings.
import { createHash } from 'crypto'
import { canonicalJson } from '@/lib/ada-audit/checks-keys'
import { normalizeFindingUrl } from './normalize-url'

// Re-export so existing imports keep working; the implementation lives in the
// client-safe module (this file pulls in node crypto, which client components
// cannot import).
export { normalizeFindingUrl }

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function runFindingKey(type: string): string {
  return sha256Hex(canonicalJson({ scope: 'run', type }))
}

export function pageFindingKey(type: string, url: string): string {
  return sha256Hex(canonicalJson({ scope: 'page', type, url: normalizeFindingUrl(url) }))
}
