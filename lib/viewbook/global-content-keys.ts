// Client-safe global-content key constants + body types (the server store in
// global-content.ts imports these; client components import ONLY this file).

// 'pc-intro' (PR5) is a plain bounded string, unlike the roster ('team') or
// heading/body blocks (everything else) — see validateGlobalContent.
export const GLOBAL_CONTENT_KEYS = ['team', 'process', 'why', 'seo-base', 'geo-base', 'eeat-base', 'pc-intro'] as const
export type GlobalContentKey = (typeof GLOBAL_CONTENT_KEYS)[number]

// Per-viewbook "your plan" content overrides (ContentTab.tsx / putContentOverride
// in global-content.ts) only make sense for the heading/body block keys: 'team'
// has its own roster editor (never an override target) and 'pc-intro' is read
// ONLY from `data.global.pcIntro` (PcIntroSection) — an override on either key
// would upsert successfully but have NO rendering effect, a dead/misleading
// control. ONE shared list so the admin UI filter and the write-path
// validation can never drift apart.
export const OVERRIDE_ELIGIBLE_KEYS = GLOBAL_CONTENT_KEYS.filter(
  (key): key is Exclude<GlobalContentKey, 'team' | 'pc-intro'> => key !== 'team' && key !== 'pc-intro',
)

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
