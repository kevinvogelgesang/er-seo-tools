// Client-safe pure validators for viewbook global content — MOVED verbatim
// out of global-content.ts (Task 3, F1a) so later client-safe callers
// (envelope parsers, the template seeder) can import validation without
// dragging in Prisma/`@/lib/db`/HttpError/sync statements. Imports limited to
// ./theme + ./global-content-keys + types — never server-only modules.

import { ASSET_FILENAME_RE } from './theme'
import { canonicalMailbox, type ContentBlocks, type TeamMember } from './global-content-keys'

export const TEAM_CAPS = { members: 20, name: 120, role: 160, blurb: 2048 }
export const BLOCK_CAPS = { blocks: 20, heading: 200, body: 4096 }
export const PC_INTRO_CAP = 2000

// The exact fallback string PcIntroSection.tsx used to own locally
// (FALLBACK_INTRO) — copied verbatim so both the section component and any
// future client-safe consumer (e.g. the template seeder) share one default.
export const PC_INTRO_DEFAULT =
  "Welcome! Let's get your viewbook set up — a few quick basics, then invite your team so everyone can follow along."

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function validateTeam(raw: unknown): TeamMember[] | null {
  if (!Array.isArray(raw) || raw.length > TEAM_CAPS.members) return null
  const out: TeamMember[] = []
  const seen = new Set<string>()
  for (const m of raw) {
    if (!isPlainObject(m)) return null
    const keys = Object.keys(m)
    if (keys.length < 4 || keys.length > 6) return null
    const known = new Set(['name', 'role', 'photo', 'blurb', 'isCsm', 'email'])
    if (keys.some((key) => !known.has(key))) return null
    const { name, role, photo, blurb, isCsm, email } = m
    if (typeof name !== 'string' || name.length === 0 || name.length > TEAM_CAPS.name) return null
    if (typeof role !== 'string' || role.length === 0 || role.length > TEAM_CAPS.role) return null
    if (photo !== null && (typeof photo !== 'string' || !ASSET_FILENAME_RE.test(photo))) return null
    if (typeof blurb !== 'string' || blurb.length > TEAM_CAPS.blurb) return null
    if ('isCsm' in m && typeof isCsm !== 'boolean') return null
    const canonicalEmail = 'email' in m ? canonicalMailbox(email) : null
    if ('email' in m && canonicalEmail === null) return null
    // Unique names — the stable selector for photo attachment.
    if (seen.has(name)) return null
    seen.add(name)
    out.push({
      name,
      role,
      photo: photo as string | null,
      blurb,
      ...('isCsm' in m ? { isCsm: isCsm as boolean } : {}),
      ...('email' in m ? { email: canonicalEmail as string } : {}),
    })
  }
  return out
}

export function validateBlocks(raw: unknown): ContentBlocks | null {
  if (!isPlainObject(raw) || Object.keys(raw).length !== 1 || !Array.isArray(raw.blocks)) return null
  if (raw.blocks.length > BLOCK_CAPS.blocks) return null
  const blocks: ContentBlocks['blocks'] = []
  for (const b of raw.blocks) {
    if (!isPlainObject(b) || Object.keys(b).length !== 2) return null
    const { heading, body } = b
    if (typeof heading !== 'string' || heading.length > BLOCK_CAPS.heading) return null
    if (typeof body !== 'string' || body.length > BLOCK_CAPS.body) return null
    blocks.push({ heading, body })
  }
  return { blocks }
}

// PR5: pc-intro is a single bounded plain-text string (the post-contract
// welcome hero), not a heading/body block list — read exactly as strict as
// write, same as every other key here.
export function validatePcIntro(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > PC_INTRO_CAP) return null
  return raw
}
