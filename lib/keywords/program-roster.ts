// lib/keywords/program-roster.ts
// KS-3 client-safe program-roster types + validation. No server imports —
// the manage-page card imports these shapes directly.

export const INSTITUTION_TYPES = ['trade', 'bootcamp', 'university', 'k12', 'other'] as const
export type InstitutionType = (typeof INSTITUTION_TYPES)[number]

export const MAX_PROGRAMS = 100
export const MAX_SUGGESTIONS = 40
const MAX_NAME = 200
const MAX_URL = 500
const MAX_ALIASES = 10
const MAX_ALIAS = 100
const MAX_CREDENTIAL = 100

export interface ProgramEntry {
  name: string
  url?: string
  aliases?: string[]
  credentialLevel?: string
  confirmed: true
  source?: 'manual' | 'suggested'
  addedAt?: string
}

export interface ProgramSuggestion {
  name: string
  url?: string
  evidence: ('slug' | 'schema' | 'heading')[]
}

export interface ProgramSuggestions {
  v: 1
  derivedFromRunId: string
  derivedAt: string
  suggestions: ProgramSuggestion[]
  dismissedNames: string[]
}

export function normalizeProgramName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// The SINGLE per-entry field gate, shared by the write path (validatePrograms,
// reason-returning) and the read path (parsePrograms, filter-not-throw) so the
// two gates cannot drift: read-side validation is as strict as write-side
// (plan-Codex #3) — corrupt persisted JSON must never reach
// normalizeProgramName or the UI. Returns a FRESH sanitized ProgramEntry so
// unknown extra properties on the input never pass through.
function checkEntryFields(
  e: unknown,
): { ok: true; entry: ProgramEntry } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason })
  if (!e || typeof e !== 'object' || Array.isArray(e)) return fail('not an object')
  const p = e as Record<string, unknown>
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > MAX_NAME) {
    return fail(`name must be a 1–${MAX_NAME} char string`)
  }
  const entry: ProgramEntry = { name: p.name.trim(), confirmed: true }
  if (p.url != null) {
    if (typeof p.url !== 'string' || p.url.length > MAX_URL || !isHttpUrl(p.url)) {
      return fail('url must be an absolute http(s) URL')
    }
    entry.url = p.url
  }
  if (p.aliases != null) {
    if (
      !Array.isArray(p.aliases) || p.aliases.length > MAX_ALIASES ||
      p.aliases.some((a) => typeof a !== 'string' || !a.trim() || a.length > MAX_ALIAS)
    ) {
      return fail(`aliases must be ≤${MAX_ALIASES} non-empty strings of ≤${MAX_ALIAS} chars`)
    }
    entry.aliases = p.aliases.map((a) => (a as string).trim())
  }
  if (p.credentialLevel != null) {
    if (typeof p.credentialLevel !== 'string' || p.credentialLevel.length > MAX_CREDENTIAL) {
      return fail('credentialLevel too long')
    }
    entry.credentialLevel = p.credentialLevel
  }
  if (p.source != null) {
    if (p.source !== 'manual' && p.source !== 'suggested') return fail('invalid source')
    entry.source = p.source
  }
  if (p.addedAt != null) {
    if (typeof p.addedAt !== 'string') return fail('invalid addedAt')
    entry.addedAt = p.addedAt
  }
  return { ok: true, entry }
}

export function validatePrograms(
  input: unknown,
): { ok: true; programs: ProgramEntry[] } | { ok: false; reason: string } {
  if (!Array.isArray(input)) return { ok: false, reason: 'programs must be an array' }
  if (input.length > MAX_PROGRAMS) return { ok: false, reason: `max ${MAX_PROGRAMS} programs` }
  const out: ProgramEntry[] = []
  for (let i = 0; i < input.length; i++) {
    const r = checkEntryFields(input[i])
    if (!r.ok) return { ok: false, reason: `entry ${i}: ${r.reason}` }
    out.push(r.entry)
  }
  const seen = new Set<string>()
  for (let i = 0; i < out.length; i++) {
    const k = normalizeProgramName(out[i].name)
    if (seen.has(k)) return { ok: false, reason: `entry ${i}: duplicate program name` }
    seen.add(k)
  }
  return { ok: true, programs: out }
}

const EVIDENCE_KINDS = ['slug', 'schema', 'heading']

function isValidSuggestion(s: unknown): s is ProgramSuggestion {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false
  const p = s as Record<string, unknown>
  if (typeof p.name !== 'string' || !p.name.trim()) return false
  if (p.url != null && typeof p.url !== 'string') return false
  return Array.isArray(p.evidence) && p.evidence.length > 0 &&
    p.evidence.every((e) => typeof e === 'string' && EVIDENCE_KINDS.includes(e))
}

export function parsePrograms(json: string | null): ProgramEntry[] {
  if (!json) return []
  try {
    const arr: unknown = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    const out: ProgramEntry[] = []
    for (const raw of arr) {
      if (out.length >= MAX_PROGRAMS) break
      // Read is filter-not-throw: an entry failing ANY write-side check is
      // dropped. Persisted entries must also carry the literal confirmed:true
      // stamp that validatePrograms writes.
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      if ((raw as Record<string, unknown>).confirmed !== true) continue
      const r = checkEntryFields(raw)
      if (r.ok) out.push(r.entry)
    }
    return out
  } catch {
    return []
  }
}

export function parseSuggestions(json: string | null): ProgramSuggestions | null {
  if (!json) return null
  try {
    const o = JSON.parse(json) as Record<string, unknown>
    if (!o || o.v !== 1 || !Array.isArray(o.suggestions) || !Array.isArray(o.dismissedNames)) return null
    return {
      v: 1,
      derivedFromRunId: typeof o.derivedFromRunId === 'string' ? o.derivedFromRunId : '',
      derivedAt: typeof o.derivedAt === 'string' ? o.derivedAt : '',
      suggestions: o.suggestions.filter(isValidSuggestion).slice(0, MAX_SUGGESTIONS),
      dismissedNames: o.dismissedNames.filter((n): n is string => typeof n === 'string'),
    }
  } catch {
    return null
  }
}
