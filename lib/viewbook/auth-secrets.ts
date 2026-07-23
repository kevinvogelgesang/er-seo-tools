import { randomBytes } from 'crypto'
import { sha256Hex } from '@/lib/findings/keys'

export function mintSecret(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hash: sha256Hex(raw) }
}

export function hashSecret(raw: string): string {
  return sha256Hex(raw)
}

export function memberCookieName(viewbookId: number): string {
  return `vb_s_${viewbookId}`
}
