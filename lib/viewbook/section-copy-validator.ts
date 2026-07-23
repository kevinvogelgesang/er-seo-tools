// Client-safe pure validator for viewbook section copy — MOVED verbatim out
// of section-copy-content.ts (Task 3 Step 3b, F1a Codex plan-fix #1) so
// later client-safe callers (e.g. template-content.ts's envelope parsers)
// can validate section-copy shapes without dragging in Prisma/`@/lib/db`/
// HttpError/sync statements. section-copy-content.ts imports AND re-exports
// these — zero behavior or import-site changes elsewhere. No server-only
// imports here — types + pure code only.

export interface SectionCopyContent {
  purpose: string
  whatThis: string
  whatWeNeed: string | null
}
export type ResolvedSectionCopy = SectionCopyContent

export const CAPS = { purpose: 240, whatThis: 600, whatWeNeed: 600 }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function validateSectionCopy(raw: unknown): SectionCopyContent | null {
  if (!isPlainObject(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length !== 3) return null
  const { purpose, whatThis, whatWeNeed } = raw
  if (typeof purpose !== 'string' || purpose.trim().length === 0 || purpose.length > CAPS.purpose) return null
  if (typeof whatThis !== 'string' || whatThis.trim().length === 0 || whatThis.length > CAPS.whatThis) return null
  if (whatWeNeed !== null && typeof whatWeNeed !== 'string') return null
  if (typeof whatWeNeed === 'string' && whatWeNeed.length > CAPS.whatWeNeed) return null
  const normalizedNeed = typeof whatWeNeed === 'string' && whatWeNeed.trim().length > 0 ? whatWeNeed : null
  return { purpose, whatThis, whatWeNeed: normalizedNeed }
}
