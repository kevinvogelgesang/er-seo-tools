// Client-safe global-content key constants + body types (the server store in
// global-content.ts imports these; client components import ONLY this file).

export const GLOBAL_CONTENT_KEYS = ['team', 'process', 'why', 'seo-base', 'geo-base', 'eeat-base'] as const
export type GlobalContentKey = (typeof GLOBAL_CONTENT_KEYS)[number]

export interface TeamMember {
  name: string
  role: string
  photo: string | null
  blurb: string
  isCsm?: boolean
  email?: string
}

export const PRIMARY_CONTACT_EMAIL_DEFKEY = 'school-contact-email'

/** One client-safe canonical mailbox parser for roster, recipient filtering, and PR5 writes. */
export function canonicalMailbox(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > 254 || /[\s,<>()]/.test(value)) return null
  const at = value.indexOf('@')
  if (at < 1 || at !== value.lastIndexOf('@')) return null
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return null
  const labels = domain.split('.')
  if (labels.length < 2 || labels.some((label) =>
    !label || label.length > 63 || !/^[A-Za-z0-9-]+$/.test(label) || label.startsWith('-') || label.endsWith('-'))) {
    return null
  }
  return value.toLowerCase()
}

export interface ContentBlocks {
  blocks: { heading: string; body: string }[]
}
