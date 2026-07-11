# KS-3 — Client institution profile + program roster + keyword locale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Client` gains an institution type, a structured human-confirmed program roster (auto-suggestions retained separately, derived from the newest live-scan run), and a primary keyword locale — editable on the client manage page.

**Architecture:** Additive nullable columns on `Client` (JSON roster/suggestions + scalar locale) and `CrawlRun` (`programEntitiesJson` — JSON-LD program names aggregated by the live-scan builder before transient deletion, C14 `schemaTypesJson` precedent). Pure derivation (`deriveProgramSuggestions`) + a thin service + `withRoute` sub-routes mirroring the client-route family + one new manage-page card.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, vitest, Tailwind (class dark mode).

**Spec:** `docs/superpowers/specs/2026-07-10-ks3-client-profile-roster-design.md` (Codex-reviewed; KS3-Codex #1–#6 applied — fix numbers cited inline below).

## Global Constraints

- Array-form `$transaction([...])` only — this plan needs NO transaction (single-row `client.update` everywhere).
- `parse-seo-dom.ts` is `.toString()`-injected: NO module-scope references, NO `typeof` (SWC `_type_of` helper escapes — `cc8d1c1`). The `next build` gate is the real SWC verification (KS3-Codex #6).
- `normalizeLocale()` (`lib/keywords/volume-normalize.ts`) is UNTOUCHED (KS3-Codex #1). KS-3 adds a STRICTER route-side restriction: bare two-letter language codes only (KS3-Codex #2).
- Migrations: hand-authored SQL; apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`. Additive columns only — no PRAGMA rebuild.
- Tests: `DATABASE_URL="file:./local-dev.db" npx vitest run <path>`; component tests need `afterEach(cleanup)`; route files export only handlers + config.
- Never `git add -A`.
- Dark-mode variants on every UI element (`bg-white`→`dark:bg-navy-card`, `text-gray-*`→`dark:text-white/*`, `border-gray-*`→`dark:border-navy-border`).
- New routes are cookie-gated by existing middleware — NO `middleware.ts` change (no new public paths).

---

### Task 1: Schema migration — Client profile columns + CrawlRun.programEntitiesJson

**Files:**
- Modify: `prisma/schema.prisma` (Client model ~line 16, CrawlRun model ~line 378)
- Create: `prisma/migrations/20260710230000_client_keyword_profile/migration.sql`

**Interfaces:**
- Produces: `Client.institutionType/programsJson/programSuggestionsJson/kwLocationCode/kwLanguageCode/kwMarketLabel` (all nullable), `CrawlRun.programEntitiesJson` (nullable) — every later task reads/writes these via the regenerated Prisma client.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

In `model Client`, after `crmClientRef String?`:

```prisma
  institutionType        String?  // KS-3: 'trade' | 'bootcamp' | 'university' | 'k12' | 'other'
  programsJson           String?  // KS-3: confirmed roster — JSON ProgramEntry[]
  programSuggestionsJson String?  // KS-3: suggestions + provenance — JSON ProgramSuggestions
  kwLocationCode         Int?     // KS-3: DataForSEO location_code (e.g. 2840 = US)
  kwLanguageCode         String?  // KS-3: DataForSEO language_code, canonical lowercase bare two-letter
  kwMarketLabel          String?  // KS-3: display label (e.g. 'United States — English')
```

In `model CrawlRun`, after `schemaTypesJson       String? // C14: ...`:

```prisma
  programEntitiesJson   String? // KS-3: JSON-LD Course/EducationalOccupationalProgram {name,url} pairs (live-scan runs only)
```

- [ ] **Step 2: Write the migration SQL**

`prisma/migrations/20260710230000_client_keyword_profile/migration.sql`:

```sql
ALTER TABLE "Client" ADD COLUMN "institutionType" TEXT;
ALTER TABLE "Client" ADD COLUMN "programsJson" TEXT;
ALTER TABLE "Client" ADD COLUMN "programSuggestionsJson" TEXT;
ALTER TABLE "Client" ADD COLUMN "kwLocationCode" INTEGER;
ALTER TABLE "Client" ADD COLUMN "kwLanguageCode" TEXT;
ALTER TABLE "Client" ADD COLUMN "kwMarketLabel" TEXT;
ALTER TABLE "CrawlRun" ADD COLUMN "programEntitiesJson" TEXT;
```

- [ ] **Step 3: Apply + regenerate**

Run: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`
Expected: `1 migration applied` (20260710230000_client_keyword_profile), client regenerated.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (additive columns break nothing).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260710230000_client_keyword_profile/migration.sql
git commit -m "feat(keywords): KS-3 schema — Client keyword-profile columns + CrawlRun.programEntitiesJson"
```

---

### Task 2: `lib/keywords/program-roster.ts` — types, normalization, validation, defensive parsing

**Files:**
- Create: `lib/keywords/program-roster.ts` (client-safe: NO prisma/server imports)
- Test: `lib/keywords/program-roster.test.ts`

**Interfaces:**
- Produces:
  - `INSTITUTION_TYPES: readonly ['trade','bootcamp','university','k12','other']`, `type InstitutionType`
  - `MAX_PROGRAMS = 100`, `MAX_SUGGESTIONS = 40`
  - `interface ProgramEntry { name: string; url?: string; aliases?: string[]; credentialLevel?: string; confirmed: true; source?: 'manual' | 'suggested'; addedAt?: string }`
  - `interface ProgramSuggestion { name: string; url?: string; evidence: ('slug' | 'schema' | 'heading')[] }`
  - `interface ProgramSuggestions { v: 1; derivedFromRunId: string; derivedAt: string; suggestions: ProgramSuggestion[]; dismissedNames: string[] }`
  - `normalizeProgramName(s: string): string` — trim, lowercase, collapse whitespace
  - `validatePrograms(input: unknown): { ok: true; programs: ProgramEntry[] } | { ok: false; reason: string }`
  - `parsePrograms(json: string | null): ProgramEntry[]` — defensive, [] on garbage
  - `parseSuggestions(json: string | null): ProgramSuggestions | null` — defensive, null on garbage

- [ ] **Step 1: Write the failing test**

`lib/keywords/program-roster.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  normalizeProgramName, validatePrograms, parsePrograms, parseSuggestions,
  MAX_PROGRAMS, INSTITUTION_TYPES,
} from './program-roster'

describe('normalizeProgramName', () => {
  it('trims, lowercases, collapses whitespace', () => {
    expect(normalizeProgramName('  Dental   Assisting ')).toBe('dental assisting')
  })
})

describe('validatePrograms', () => {
  it('accepts a valid roster and stamps confirmed:true', () => {
    const r = validatePrograms([{ name: 'Dental Assisting', url: 'https://x.edu/programs/da', credentialLevel: 'diploma' }])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.programs[0].confirmed).toBe(true)
      expect(r.programs[0].name).toBe('Dental Assisting')
    }
  })
  it('rejects non-array', () => {
    expect(validatePrograms('nope').ok).toBe(false)
  })
  it('rejects empty/too-long names with a per-entry reason', () => {
    const r = validatePrograms([{ name: '' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/entry 0/)
    expect(validatePrograms([{ name: 'x'.repeat(201) }]).ok).toBe(false)
  })
  it('rejects non-http(s) and oversized urls', () => {
    expect(validatePrograms([{ name: 'A', url: 'ftp://x' }]).ok).toBe(false)
    expect(validatePrograms([{ name: 'A', url: 'not a url' }]).ok).toBe(false)
    expect(validatePrograms([{ name: 'A', url: 'https://x.edu/' + 'p'.repeat(500) }]).ok).toBe(false)
  })
  it('rejects >10 aliases, bad alias, bad credentialLevel, bad source', () => {
    expect(validatePrograms([{ name: 'A', aliases: Array(11).fill('a') }]).ok).toBe(false)
    expect(validatePrograms([{ name: 'A', aliases: [''] }]).ok).toBe(false)
    expect(validatePrograms([{ name: 'A', credentialLevel: 'x'.repeat(101) }]).ok).toBe(false)
    expect(validatePrograms([{ name: 'A', source: 'robot' }]).ok).toBe(false)
  })
  it('rejects rosters over MAX_PROGRAMS', () => {
    const many = Array.from({ length: MAX_PROGRAMS + 1 }, (_, i) => ({ name: `P${i}` }))
    expect(validatePrograms(many).ok).toBe(false)
  })
  it('rejects duplicate normalized names (clean KS-5 seed set — plan-Codex #3 adjunct)', () => {
    const r = validatePrograms([{ name: 'Dental Assisting' }, { name: 'dental  assisting' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/duplicate/)
  })
})

describe('defensive parsing', () => {
  it('parsePrograms: [] on null, garbage, non-array', () => {
    expect(parsePrograms(null)).toEqual([])
    expect(parsePrograms('{oops')).toEqual([])
    expect(parsePrograms('"str"')).toEqual([])
  })
  it('parsePrograms: drops malformed entries (bad name, bad url type, bad aliases), keeps valid ones', () => {
    const json = JSON.stringify([
      { name: 'Good', confirmed: true },
      { nope: 1 }, null, { name: 42 }, { name: 'BadUrl', confirmed: true, url: 7 },
      { name: 'BadAliases', confirmed: true, aliases: 'x' },
    ])
    expect(parsePrograms(json)).toEqual([{ name: 'Good', confirmed: true }])
  })
  it('parseSuggestions: null on garbage or wrong version; drops malformed suggestion entries and non-string dismissed names', () => {
    expect(parseSuggestions(null)).toBeNull()
    expect(parseSuggestions('{oops')).toBeNull()
    expect(parseSuggestions(JSON.stringify({ v: 2 }))).toBeNull()
    const dirty = JSON.stringify({
      v: 1, derivedFromRunId: 'r', derivedAt: 'd',
      suggestions: [{ name: 'OK', evidence: ['slug'] }, { name: 5, evidence: ['slug'] }, { name: 'BadEv', evidence: ['robot'] }, 'junk'],
      dismissedNames: ['ok', 42],
    })
    const p = parseSuggestions(dirty)
    expect(p!.suggestions).toEqual([{ name: 'OK', evidence: ['slug'] }])
    expect(p!.dismissedNames).toEqual(['ok'])
  })
  it('parseSuggestions: round-trips a valid payload', () => {
    const p = { v: 1, derivedFromRunId: 'r1', derivedAt: '2026-07-10T00:00:00Z', suggestions: [{ name: 'X', evidence: ['slug'] }], dismissedNames: [] }
    expect(parseSuggestions(JSON.stringify(p))).toEqual(p)
  })
})

describe('INSTITUTION_TYPES', () => {
  it('is the spec enum', () => {
    expect([...INSTITUTION_TYPES]).toEqual(['trade', 'bootcamp', 'university', 'k12', 'other'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/program-roster.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/keywords/program-roster.ts`:

```ts
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

export function validatePrograms(
  input: unknown,
): { ok: true; programs: ProgramEntry[] } | { ok: false; reason: string } {
  if (!Array.isArray(input)) return { ok: false, reason: 'programs must be an array' }
  if (input.length > MAX_PROGRAMS) return { ok: false, reason: `max ${MAX_PROGRAMS} programs` }
  const out: ProgramEntry[] = []
  for (let i = 0; i < input.length; i++) {
    const e = input[i] as Record<string, unknown> | null
    const fail = (why: string) => ({ ok: false as const, reason: `entry ${i}: ${why}` })
    if (!e || typeof e !== 'object' || Array.isArray(e)) return fail('not an object')
    if (typeof e.name !== 'string' || !e.name.trim() || e.name.trim().length > MAX_NAME) {
      return fail(`name must be a 1–${MAX_NAME} char string`)
    }
    const entry: ProgramEntry = { name: e.name.trim(), confirmed: true }
    if (e.url != null) {
      if (typeof e.url !== 'string' || e.url.length > MAX_URL || !isHttpUrl(e.url)) {
        return fail('url must be an absolute http(s) URL')
      }
      entry.url = e.url
    }
    if (e.aliases != null) {
      if (
        !Array.isArray(e.aliases) || e.aliases.length > MAX_ALIASES ||
        e.aliases.some((a) => typeof a !== 'string' || !a.trim() || a.length > MAX_ALIAS)
      ) {
        return fail(`aliases must be ≤${MAX_ALIASES} non-empty strings of ≤${MAX_ALIAS} chars`)
      }
      entry.aliases = e.aliases.map((a) => (a as string).trim())
    }
    if (e.credentialLevel != null) {
      if (typeof e.credentialLevel !== 'string' || e.credentialLevel.length > MAX_CREDENTIAL) {
        return fail('credentialLevel too long')
      }
      entry.credentialLevel = e.credentialLevel
    }
    if (e.source != null) {
      if (e.source !== 'manual' && e.source !== 'suggested') return fail('invalid source')
      entry.source = e.source
    }
    if (e.addedAt != null) {
      if (typeof e.addedAt !== 'string') return fail('invalid addedAt')
      entry.addedAt = e.addedAt
    }
    out.push(entry)
  }
  const seen = new Set<string>()
  for (let i = 0; i < out.length; i++) {
    const k = normalizeProgramName(out[i].name)
    if (seen.has(k)) return { ok: false, reason: `entry ${i}: duplicate program name` }
    seen.add(k)
  }
  return { ok: true, programs: out }
}

// Read-side validation is as strict as write-side (plan-Codex #3): corrupt
// persisted JSON must never reach normalizeProgramName or the UI.
function isValidEntry(e: unknown): e is ProgramEntry {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false
  const p = e as Record<string, unknown>
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > MAX_NAME) return false
  if (p.url != null && typeof p.url !== 'string') return false
  if (p.aliases != null && (!Array.isArray(p.aliases) || p.aliases.some((a) => typeof a !== 'string'))) return false
  if (p.credentialLevel != null && typeof p.credentialLevel !== 'string') return false
  return true
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
    return arr.filter(isValidEntry).slice(0, MAX_PROGRAMS)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/program-roster.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/keywords/program-roster.ts lib/keywords/program-roster.test.ts
git commit -m "feat(keywords): KS-3 program-roster types + validation + defensive parsing"
```

---

### Task 3: `lib/keywords/locales.ts` — curated list + strict profile-locale validation

**Files:**
- Create: `lib/keywords/locales.ts` (client-safe data + validator)
- Test: `lib/keywords/locales.test.ts`

**Interfaces:**
- Consumes: `normalizeLocale` from `./volume-normalize` (READ-ONLY dependency — never edited, KS3-Codex #1).
- Produces:
  - `interface CuratedLocale { label: string; locationCode: number; languageCode: string }`
  - `CURATED_LOCALES: CuratedLocale[]` (6 entries, spec §8 table)
  - `validateProfileLocale(input: unknown): { locationCode: number; languageCode: string } | null` — KS-3's stricter gate: bare two-letter language only (KS3-Codex #2), THEN `normalizeLocale`.

- [ ] **Step 1: Write the failing test**

`lib/keywords/locales.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CURATED_LOCALES, validateProfileLocale } from './locales'
import { normalizeLocale } from './volume-normalize'

describe('CURATED_LOCALES', () => {
  it('has the six spec §8 markets', () => {
    expect(CURATED_LOCALES).toHaveLength(6)
    expect(CURATED_LOCALES.map((l) => [l.locationCode, l.languageCode])).toEqual([
      [2840, 'en'], [2124, 'en'], [2124, 'fr'], [2826, 'en'], [2036, 'en'], [2840, 'es'],
    ])
  })
  it('every entry passes BOTH normalizeLocale and validateProfileLocale', () => {
    for (const l of CURATED_LOCALES) {
      expect(normalizeLocale(l)).toEqual({ locationCode: l.locationCode, languageCode: l.languageCode })
      expect(validateProfileLocale(l)).toEqual({ locationCode: l.locationCode, languageCode: l.languageCode })
    }
  })
})

describe('validateProfileLocale', () => {
  it('canonicalizes case/whitespace', () => {
    expect(validateProfileLocale({ locationCode: 2840, languageCode: ' EN ' }))
      .toEqual({ locationCode: 2840, languageCode: 'en' })
  })
  it('rejects hyphenated regionals until case-sensitivity is verified (spec §8.3)', () => {
    expect(validateProfileLocale({ locationCode: 2158, languageCode: 'zh-TW' })).toBeNull()
    expect(validateProfileLocale({ locationCode: 2076, languageCode: 'pt-br' })).toBeNull()
  })
  it('rejects three-letter Labs-only codes — the documented Google Ads provider boundary (spec §8.2)', () => {
    expect(validateProfileLocale({ locationCode: 2608, languageCode: 'ceb' })).toBeNull()
  })
  it('rejects junk shapes', () => {
    expect(validateProfileLocale(null)).toBeNull()
    expect(validateProfileLocale({ locationCode: 0, languageCode: 'en' })).toBeNull()
    expect(validateProfileLocale({ locationCode: 1.5, languageCode: 'en' })).toBeNull()
    expect(validateProfileLocale({ locationCode: 2840, languageCode: 'english' })).toBeNull()
    expect(validateProfileLocale({ locationCode: 2840, languageCode: 'e' })).toBeNull()
    expect(validateProfileLocale({ locationCode: 2840, languageCode: 12 })).toBeNull()
  })
  it('documents the Google Ads regex boundary: representative codes pass normalizeLocale post-lowercase', () => {
    // Spec §8.1–8.2 verification record: sample of the 43 Google Ads codes.
    for (const code of ['en', 'fr', 'es', 'zh-tw', 'pt-br']) {
      expect(normalizeLocale({ locationCode: 2840, languageCode: code })).not.toBeNull()
    }
    for (const junk of ['eng-', 'e', 'english', '12']) {
      expect(normalizeLocale({ locationCode: 2840, languageCode: junk })).toBeNull()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/locales.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/keywords/locales.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/locales.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/keywords/locales.ts lib/keywords/locales.test.ts
git commit -m "feat(keywords): KS-3 curated locale list + strict profile-locale validator"
```

---

### Task 4: `parse-seo-dom.ts` — JSON-LD program-name extraction (injected code)

**Files:**
- Modify: `lib/ada-audit/seo/parse-seo-dom.ts` (RawPageSeo interface ~line 9; JSON-LD walk ~lines 88–101; return ~line 127)
- Test: `lib/ada-audit/seo/parse-seo-dom.test.ts` (extend existing)

**Interfaces:**
- Produces: `RawPageSeo.programNames: string[]` — deduped, each ≤120 chars, ≤20/page, only from JSON-LD nodes whose `@type` includes `Course` or `EducationalOccupationalProgram` and whose `name` is a string.

**THE INJECTION CONTRACT (read before touching the file):** `parseSeoFromDocument` is string-injected into audited pages. No module-scope references. No `typeof` (SWC emits a module-scope `_type_of` helper → in-page `ReferenceError`, the `cc8d1c1` incident). String-ness is checked with `String(v) === v` (true only for string primitives — JSON.parse never yields boxed strings). The `next build` gate at the end of the plan is the actual SWC compilation verification (KS3-Codex #6).

- [ ] **Step 1: Write the failing tests** (add to `parse-seo-dom.test.ts` using its existing local JSDOM helper — named `dom` in that file (plan-Codex #1). The snippets below say `parseFixture` for readability; substitute the file's real helper invocation)

```ts
describe('programNames extraction (KS-3)', () => {
  it('extracts Course and EducationalOccupationalProgram names, incl. @graph nesting and array @type', () => {
    const seo = parseFixture(`
      <script type="application/ld+json">{"@type":"Course","name":"Dental Assisting"}</script>
      <script type="application/ld+json">{"@graph":[{"@type":["EducationalOccupationalProgram","Thing"],"name":"HVAC Technician"}]}</script>
    `)
    expect(seo.programNames).toEqual(['Dental Assisting', 'HVAC Technician'])
  })
  it('ignores non-program types, missing names, and non-string names (object/array/number)', () => {
    const seo = parseFixture(`
      <script type="application/ld+json">{"@type":"Article","name":"Not a program"}</script>
      <script type="application/ld+json">{"@type":"Course"}</script>
      <script type="application/ld+json">{"@type":"Course","name":{"@value":"Localized"}}</script>
      <script type="application/ld+json">{"@type":"Course","name":["A","B"]}</script>
      <script type="application/ld+json">{"@type":"Course","name":42}</script>
    `)
    expect(seo.programNames).toEqual([])
  })
  it('tolerates malformed JSON-LD, dedupes, caps names at 120 chars and 20 per page', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      `<script type="application/ld+json">{"@type":"Course","name":"P${i} ${'x'.repeat(150)}"}</script>`,
    ).join('')
    const seo = parseFixture(`
      <script type="application/ld+json">{broken</script>
      <script type="application/ld+json">{"@type":"Course","name":"Dup"}</script>
      <script type="application/ld+json">{"@type":"Course","name":"Dup"}</script>
      ${many}
    `)
    expect(seo.programNames.filter((n) => n === 'Dup')).toHaveLength(1)
    expect(seo.programNames.length).toBeLessThanOrEqual(20)
    expect(Math.max(...seo.programNames.map((n) => n.length))).toBeLessThanOrEqual(120)
  })
  it('duplicates never crowd out later unique names — the cap counts UNIQUE values (plan-Codex #1)', () => {
    const dups = Array.from({ length: 20 }, () =>
      '<script type="application/ld+json">{"@type":"Course","name":"Same"}</script>',
    ).join('')
    const seo = parseFixture(`${dups}<script type="application/ld+json">{"@type":"Course","name":"Unique Late Program"}</script>`)
    expect(seo.programNames).toEqual(['Same', 'Unique Late Program'])
  })
})
```

(`parseFixture` = whatever helper the existing test file uses to run `parseSeoFromDocument` over a JSDOM document — reuse it verbatim; if it has a different name, use that name.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/parse-seo-dom.test.ts`
Expected: new tests FAIL (`programNames` undefined); every pre-existing test still PASSES.

- [ ] **Step 3: Implement**

In `RawPageSeo` (after `schemaTypes: string[]`):

```ts
  programNames: string[] // KS-3: JSON-LD Course/EducationalOccupationalProgram names, ≤20, each ≤120 chars
```

Replace the JSON-LD walk block (keep surrounding code identical):

```ts
  // schema @type set — JSON-LD only, with @graph recursion.
  // KS-3: also collect Course/EducationalOccupationalProgram names.
  const schemaTypes: string[] = []
  const programNames: string[] = []
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const collect = (o: unknown): void => {
        if (!o) return
        if (Array.isArray(o)) { o.forEach(collect); return }
        const rec = o as Record<string, unknown>
        if (rec['@type']) {
          const types = ([] as unknown[]).concat(rec['@type'])
          types.forEach((t) => schemaTypes.push(String(t)))
          // String-primitive check without typeof (injected-code contract):
          // String(v) === v is true only for string primitives.
          // Dedupe at insert so the 20-cap counts UNIQUE names (plan-Codex #1).
          const nameVal = rec['name']
          if (
            nameVal != null && String(nameVal) === nameVal && programNames.length < 20 &&
            types.some((t) => String(t) === 'Course' || String(t) === 'EducationalOccupationalProgram')
          ) {
            const nm = (nameVal as string).slice(0, 120)
            if (programNames.indexOf(nm) === -1) programNames.push(nm)
          }
        }
        if (rec['@graph']) collect(rec['@graph'])
      }
      collect(JSON.parse(s.textContent || ''))
    } catch { /* ignore malformed */ }
  }
```

In the return statement, after `schemaTypes: boundedSchema,` (already unique + capped at insert):

```ts
    programNames,
```

- [ ] **Step 4: Fix `RawPageSeo` fixtures repo-wide**

`programNames` is a required field on `RawPageSeo`, so every typed fixture breaks. Sweep:

Run: `rg -l 'RawPageSeo' --type ts | grep -v parse-seo-dom`
Expected hits include `lib/jobs/handlers/site-audit-page.test.ts` — add `programNames: []` to each typed `RawPageSeo` fixture object found (plan-Codex #1).

- [ ] **Step 5: Run the full parse-seo-dom suite + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/parse-seo-dom.test.ts && npx tsc --noEmit`
Expected: PASS (including the pre-existing helper-token `toString()` test) / clean.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/seo/parse-seo-dom.ts lib/ada-audit/seo/parse-seo-dom.test.ts lib/jobs/handlers/site-audit-page.test.ts
git commit -m "feat(keywords): KS-3 JSON-LD program-name extraction in parse-seo-dom (injection-contract-safe)"
```

---

### Task 5: `aggregateProgramEntities` — pure, deterministic

**Files:**
- Create: `lib/ada-audit/seo/program-entities.ts`
- Test: `lib/ada-audit/seo/program-entities.test.ts`

**Interfaces:**
- Consumes: rows shaped `{ url: string; detailsJson: string | null }` — the CALLER pre-filters to indexable ∧ ¬login-like (content-similarity precedent; wiring in Task 6).
- Produces:
  - `interface ProgramEntity { name: string; url: string }`
  - `interface ProgramEntitiesSummary { v: 1; entities: ProgramEntity[] }`
  - `aggregateProgramEntities(rows): ProgramEntitiesSummary | null` — null when no entities (builder writes column null).

- [ ] **Step 1: Write the failing test**

`lib/ada-audit/seo/program-entities.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { aggregateProgramEntities } from './program-entities'

const row = (url: string, names: string[] | null) => ({
  url,
  detailsJson: names === null ? null : JSON.stringify({ schemaTypes: [], hreflang: [], programNames: names }),
})

describe('aggregateProgramEntities', () => {
  it('returns null when no rows carry program names (incl. pre-KS-3 detailsJson without the field)', () => {
    expect(aggregateProgramEntities([])).toBeNull()
    expect(aggregateProgramEntities([row('https://x.edu/a', [])])).toBeNull()
    expect(aggregateProgramEntities([{ url: 'https://x.edu/a', detailsJson: '{"schemaTypes":[]}' }])).toBeNull()
  })
  it('tolerates malformed detailsJson', () => {
    expect(aggregateProgramEntities([{ url: 'https://x.edu/a', detailsJson: '{broken' }])).toBeNull()
  })
  it('dedupes by normalized name; winner = pair with lexicographically smallest URL, its verbatim name kept (plan-Codex #2)', () => {
    // Input order deliberately scrambled; the (normalized name, url)-sort decides:
    // the /a pair sorts first, so ITS verbatim name ('dental assisting') wins.
    const out = aggregateProgramEntities([
      row('https://x.edu/z', ['Dental  Assisting']),
      row('https://x.edu/a', ['dental assisting']),
    ])
    expect(out).toEqual({
      v: 1,
      entities: [{ name: 'dental assisting', url: 'https://x.edu/a' }],
    })
  })
  it('caps at 100 entities', () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(`https://x.edu/p${i}`, [`Program ${String(i).padStart(3, '0')}`]))
    expect(aggregateProgramEntities(rows)!.entities).toHaveLength(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/program-entities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/ada-audit/seo/program-entities.ts`:

```ts
// KS-3: aggregate JSON-LD program entities ({name, url}) across harvested
// pages, computed by the live-scan builder BEFORE the transient
// HarvestedPageSeo rows are deleted (schemaTypesJson C14 precedent).
// Durable home: CrawlRun.programEntitiesJson. The CALLER pre-filters rows to
// indexable ∧ ¬login-like (same posture as computeContentSimilarity).
// url = the harvested (audited) page URL — JSON-LD Course.url is NOT captured
// in v1 (KS3-Codex #3).

export interface ProgramEntity {
  name: string
  url: string
}

export interface ProgramEntitiesSummary {
  v: 1
  entities: ProgramEntity[]
}

const MAX_ENTITIES = 100

export function aggregateProgramEntities(
  rows: { url: string; detailsJson: string | null }[],
): ProgramEntitiesSummary | null {
  const pairs: ProgramEntity[] = []
  for (const r of rows) {
    if (!r.detailsJson) continue
    let names: unknown
    try {
      names = (JSON.parse(r.detailsJson) as { programNames?: unknown }).programNames
    } catch {
      continue
    }
    if (!Array.isArray(names)) continue
    for (const n of names) {
      if (typeof n === 'string' && n.trim()) pairs.push({ name: n, url: r.url })
    }
  }
  if (pairs.length === 0) return null
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
  // Deterministic winner: sort by (normalized name, url), keep-first per name.
  pairs.sort((a, b) => norm(a.name).localeCompare(norm(b.name)) || a.url.localeCompare(b.url))
  const seen = new Set<string>()
  const entities: ProgramEntity[] = []
  for (const p of pairs) {
    const k = norm(p.name)
    if (seen.has(k)) continue
    seen.add(k)
    entities.push(p)
    if (entities.length >= MAX_ENTITIES) break
  }
  return { v: 1, entities }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/program-entities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/program-entities.ts lib/ada-audit/seo/program-entities.test.ts
git commit -m "feat(keywords): KS-3 pure program-entity aggregator (deterministic, capped)"
```

---

### Task 6: Wire the durable seam — persist, contract, builder (KS3-Codex #4's named seams)

**Files:**
- Modify: `lib/jobs/handlers/site-audit-page.ts:124` (detailsJson assembly in `persistPageSeo`)
- Modify: `lib/findings/types.ts:47` (CrawlRunInput — after `schemaTypesJson`)
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (~line 512 aggregation block; ~line 550 bundle)
- Test: `lib/jobs/handlers/broken-link-verify.test.ts` (extend existing)

**Interfaces:**
- Consumes: `aggregateProgramEntities` (Task 5), `RawPageSeo.programNames` (Task 4), `CrawlRun.programEntitiesJson` column (Task 1).
- Produces: live-scan runs carry `programEntitiesJson: string | null` (`{v:1, entities:[{name,url}]}` or null).

- [ ] **Step 1: Write the failing test** (extend the existing broken-link-verify test file, using its existing harness for seeding HarvestedPageSeo + running the job; follow the file's established seeding helpers)

```ts
it('KS-3: writes programEntitiesJson from harvested programNames, excluding noindex/login-like rows', async () => {
  // Seed three HarvestedPageSeo rows via the file's existing seeding pattern:
  //  1. indexable page, detailsJson.programNames: ['Dental Assisting']
  //  2. robotsNoindex: true, programNames: ['Hidden Program']
  //  3. loginLike: true,     programNames: ['Walled Program']
  // Run the verify job to completion, then:
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } } })
  const parsed = JSON.parse(run!.programEntitiesJson!)
  expect(parsed.v).toBe(1)
  expect(parsed.entities).toEqual([{ name: 'Dental Assisting', url: expect.any(String) }])
})

it('KS-3: programEntitiesJson is null when no harvested row carries program names', async () => {
  // Seed one indexable row WITHOUT programNames in detailsJson; run the job.
  const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } } })
  expect(run!.programEntitiesJson).toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: new tests FAIL (column always null / tsc error until wired); pre-existing tests PASS.

- [ ] **Step 3: Implement the three seams**

(a) `site-audit-page.ts:124` — thread the field:

```ts
        detailsJson: JSON.stringify({ schemaTypes: seo.schemaTypes, hreflang: seo.hreflang, programNames: seo.programNames }),
```

(b) `lib/findings/types.ts` — after `schemaTypesJson?: string | null`:

```ts
  programEntitiesJson?: string | null   // KS-3: JSON-LD program {name,url} pairs (live-scan runs only)
```

(c) `broken-link-verify.ts` — import at top with the other seo imports:

```ts
import { aggregateProgramEntities } from '@/lib/ada-audit/seo/program-entities'
```

After the `schemaTypesJson` aggregation block (~line 517), same fail-to-null posture:

```ts
  // KS-3: durable JSON-LD program entities. Caller-side eligibility filter
  // (indexable ∧ ¬login-like — content-similarity precedent). Fail-to-null.
  let programEntitiesJson: string | null = null
  try {
    const agg = aggregateProgramEntities(
      seoRows.filter((r) => indexableOf(r) && !r.loginLike).map((r) => ({ url: r.url, detailsJson: r.detailsJson })),
    )
    if (agg) programEntitiesJson = JSON.stringify(agg)
  } catch (e) {
    console.error('[live-seo] program-entity aggregation failed', e)
  }
```

In the bundle's `run` object, after `schemaTypesJson,`:

```ts
      programEntitiesJson,
```

- [ ] **Step 4: Run the suite + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/site-audit-page.ts lib/findings/types.ts lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(keywords): KS-3 durable programEntitiesJson — persist seam, run contract, builder aggregation"
```

---

### Task 7: `deriveProgramSuggestions` — pure request-time derivation

**Files:**
- Create: `lib/keywords/program-suggest.ts`
- Test: `lib/keywords/program-suggest.test.ts`

**Interfaces:**
- Consumes: `classifyPageType` from `@/lib/services/pillarAnalysis/pageType`; `ProgramSuggestion`, `MAX_SUGGESTIONS`, `normalizeProgramName` from `./program-roster`; `ProgramEntity` from `@/lib/ada-audit/seo/program-entities`.
- Produces:
  - `interface SuggestPageInput { url: string; title: string | null; h1: string | null; statusCode: number | null; indexable: boolean | null; crawlDepth: number | null }`
  - `cleanHeading(s: string): string` — strips a site-name suffix after the LAST `|`/`–`/`—`, collapses whitespace, trims
  - `deriveProgramSuggestions(opts: { pages: SuggestPageInput[]; programEntities: ProgramEntity[]; confirmedNames: string[]; dismissedNames: string[] }): ProgramSuggestion[]` — `confirmedNames`/`dismissedNames` are pre-normalized by the caller.

- [ ] **Step 1: Write the failing test**

`lib/keywords/program-suggest.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cleanHeading, deriveProgramSuggestions } from './program-suggest'

const page = (url: string, over: Partial<Parameters<typeof deriveProgramSuggestions>[0]['pages'][number]> = {}) => ({
  url, title: null, h1: null, statusCode: 200, indexable: true, crawlDepth: 2, ...over,
})
const derive = (over: Partial<Parameters<typeof deriveProgramSuggestions>[0]>) =>
  deriveProgramSuggestions({ pages: [], programEntities: [], confirmedNames: [], dismissedNames: [], ...over })

describe('cleanHeading', () => {
  it('strips the site-name suffix after the last separator and collapses whitespace', () => {
    expect(cleanHeading('Dental  Assisting | Bellus Academy')).toBe('Dental Assisting')
    expect(cleanHeading('HVAC – Programs – Foo College')).toBe('HVAC – Programs')
    expect(cleanHeading('Plain Heading')).toBe('Plain Heading')
  })
})

describe('deriveProgramSuggestions', () => {
  it('suggests program-slug pages named by H1, falling back to title', () => {
    const out = derive({
      pages: [
        page('https://x.edu/programs/dental-assisting/', { h1: 'Dental Assisting' }),
        page('https://x.edu/programs/hvac/', { title: 'HVAC Technician | X College' }),
      ],
    })
    expect(out).toEqual([
      { name: 'Dental Assisting', url: 'https://x.edu/programs/dental-assisting/', evidence: ['slug'] },
      { name: 'HVAC Technician', url: 'https://x.edu/programs/hvac/', evidence: ['slug'] },
    ])
  })
  it('excludes non-program pages, non-2xx, non-indexable, and sub-3-char names', () => {
    const out = derive({
      pages: [
        page('https://x.edu/blog/post/', { h1: 'A Blog Post' }),
        page('https://x.edu/programs/a/', { h1: 'Gone', statusCode: 404 }),
        page('https://x.edu/programs/b/', { h1: 'Hidden', indexable: false }),
        page('https://x.edu/programs/c/', { h1: 'Ab' }),
      ],
    })
    expect(out).toEqual([])
  })
  it('merges schema entities by normalized name, unioning evidence, slug URL kept (processed first)', () => {
    const out = derive({
      pages: [page('https://x.edu/programs/dental-assisting/', { h1: 'Dental Assisting' })],
      programEntities: [
        { name: 'dental  assisting', url: 'https://x.edu/other' },
        { name: 'Cosmetology', url: 'https://x.edu/programs/cosmo/' },
      ],
    })
    expect(out).toEqual([
      { name: 'Dental Assisting', url: 'https://x.edu/programs/dental-assisting/', evidence: ['slug', 'schema'] },
      { name: 'Cosmetology', url: 'https://x.edu/programs/cosmo/', evidence: ['schema'] },
    ])
  })
  it('excludes confirmed and dismissed names (normalized match)', () => {
    const out = derive({
      pages: [page('https://x.edu/programs/da/', { h1: 'Dental Assisting' })],
      programEntities: [{ name: 'Cosmetology', url: 'https://x.edu/c' }],
      confirmedNames: ['dental assisting'],
      dismissedNames: ['cosmetology'],
    })
    expect(out).toEqual([])
  })
  it('ranks two-evidence suggestions first, then alphabetical, capped at 40', () => {
    const pages = [page('https://x.edu/programs/zz/', { h1: 'ZZ Prog' })]
    const entities = [
      { name: 'ZZ Prog', url: 'https://x.edu/z' },
      ...Array.from({ length: 45 }, (_, i) => ({ name: `Prog ${String(i).padStart(2, '0')}`, url: `https://x.edu/p${i}` })),
    ]
    const out = derive({ pages, programEntities: entities })
    expect(out[0].name).toBe('ZZ Prog')
    expect(out[0].evidence).toEqual(['slug', 'schema'])
    expect(out).toHaveLength(40)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/program-suggest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/keywords/program-suggest.ts`:

```ts
// lib/keywords/program-suggest.ts
// KS-3 pure suggestion derivation from a live-scan run's durable rows.
// Signals: program-slug pages (pillar classifier) named by cleaned H1/title,
// plus durable JSON-LD program entities (CrawlRun.programEntitiesJson).
// Suggestions only — the durable roster is human-confirmed. Zero fetches.
// 'heading' evidence is reserved for a future token-mining signal (spec §4).

import { classifyPageType } from '@/lib/services/pillarAnalysis/pageType'
import type { ProgramEntity } from '@/lib/ada-audit/seo/program-entities'
import { MAX_SUGGESTIONS, normalizeProgramName, type ProgramSuggestion } from './program-roster'

export interface SuggestPageInput {
  url: string
  title: string | null
  h1: string | null
  statusCode: number | null
  indexable: boolean | null
  crawlDepth: number | null
}

export function cleanHeading(s: string): string {
  return s.replace(/\s*[|–—]\s*[^|–—]*$/, '').replace(/\s+/g, ' ').trim()
}

export function deriveProgramSuggestions(opts: {
  pages: SuggestPageInput[]
  programEntities: ProgramEntity[]
  confirmedNames: string[]
  dismissedNames: string[]
}): ProgramSuggestion[] {
  const excluded = new Set([...opts.confirmedNames, ...opts.dismissedNames])
  const byName = new Map<string, ProgramSuggestion>()

  const add = (name: string, url: string | undefined, kind: 'slug' | 'schema') => {
    // Cap at the roster's MAX name length so confirmSuggestion can never
    // smuggle an over-long name past validatePrograms (plan-Codex #5).
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 200)
    if (clean.length < 3) return
    const key = normalizeProgramName(clean)
    if (excluded.has(key)) return
    const existing = byName.get(key)
    if (existing) {
      if (!existing.evidence.includes(kind)) existing.evidence.push(kind)
    } else {
      byName.set(key, { name: clean, ...(url ? { url } : {}), evidence: [kind] })
    }
  }

  // Slug signal first — its URL wins on merge (deterministic keep-first).
  // Sort pages by URL so keep-first is order-independent (plan-Codex #5).
  const pages = [...opts.pages].sort((a, b) => a.url.localeCompare(b.url))
  for (const p of pages) {
    const status = p.statusCode ?? 0
    if (status < 200 || status >= 300 || p.indexable === false) continue
    const { pageType } = classifyPageType({ url: p.url, schemaTypes: [], crawlDepth: p.crawlDepth })
    if (pageType !== 'program') continue
    const raw = (p.h1 && cleanHeading(p.h1)) || (p.title && cleanHeading(p.title)) || ''
    if (raw) add(raw, p.url, 'slug')
  }

  for (const e of opts.programEntities) add(e.name, e.url, 'schema')

  return [...byName.values()]
    .sort((a, b) => b.evidence.length - a.evidence.length || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/program-suggest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/keywords/program-suggest.ts lib/keywords/program-suggest.test.ts
git commit -m "feat(keywords): KS-3 pure program-suggestion derivation (slug + schema evidence)"
```

---

### Task 8: `lib/services/keyword-profile.ts` — service layer

**Files:**
- Create: `lib/services/keyword-profile.ts`
- Test: `lib/services/keyword-profile.test.ts` (DB-backed, house convention: seed via prisma, clean up in afterEach)

**Interfaces:**
- Consumes: Tasks 2, 3, 7; `prisma` from `@/lib/db`.
- Produces:
  - `interface KeywordProfile { institutionType: string | null; programs: ProgramEntry[]; suggestions: ProgramSuggestions | null; locale: { locationCode: number; languageCode: string; marketLabel: string | null } | null; hasLiveScan: boolean }` — `hasLiveScan` powers the card's initial disabled/hint state (plan-Codex #6)
  - `getKeywordProfile(clientId: number): Promise<KeywordProfile | null>` — null = client not found
  - `type UpdateResult = { ok: true; profile: KeywordProfile } | { ok: false; error: 'client_not_found' | 'client_archived' | 'suggestion_not_found' }`
  - `updateKeywordProfile(clientId: number, patch: { institutionType?: InstitutionType | null; programs?: ProgramEntry[]; locale?: { locationCode: number; languageCode: string; marketLabel?: string | null } | null; confirmSuggestion?: string; dismissSuggestion?: string }): Promise<UpdateResult>` — patch is PRE-VALIDATED by the route (Task 9); `confirmSuggestion`/`dismissSuggestion` carry the raw suggestion name.
  - `suggestPrograms(clientId: number): Promise<{ ok: true; suggestions: ProgramSuggestions } | { ok: false; error: 'client_not_found' | 'client_archived' | 'no_live_scan_run' }>` — archived clients are rejected (plan-Codex #4)

- [ ] **Step 1: Write the failing test**

`lib/services/keyword-profile.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { getKeywordProfile, updateKeywordProfile, suggestPrograms } from './keyword-profile'

let clientId: number
const cleanupIds: number[] = []

beforeEach(async () => {
  const c = await prisma.client.create({ data: { name: `ks3-test-${Date.now()}-${Math.random()}` } })
  clientId = c.id
  cleanupIds.push(c.id)
})

afterEach(async () => {
  await prisma.crawlRun.deleteMany({ where: { clientId: { in: cleanupIds } } })
  await prisma.client.deleteMany({ where: { id: { in: cleanupIds } } })
  cleanupIds.length = 0
})

describe('getKeywordProfile', () => {
  it('null for unknown client; empty profile (hasLiveScan false) for a fresh client', async () => {
    expect(await getKeywordProfile(999999999)).toBeNull()
    expect(await getKeywordProfile(clientId)).toEqual({
      institutionType: null, programs: [], suggestions: null, locale: null, hasLiveScan: false,
    })
  })
  it('hasLiveScan flips true when a live-scan run exists', async () => {
    await prisma.crawlRun.create({
      data: { tool: 'seo-parser', source: 'live-scan', clientId, status: 'complete' },
    })
    expect((await getKeywordProfile(clientId))!.hasLiveScan).toBe(true)
  })
})

describe('updateKeywordProfile', () => {
  it('sets institutionType, programs, and locale', async () => {
    const r = await updateKeywordProfile(clientId, {
      institutionType: 'trade',
      programs: [{ name: 'Dental Assisting', confirmed: true }],
      locale: { locationCode: 2840, languageCode: 'en', marketLabel: 'United States — English' },
    })
    expect(r.ok).toBe(true)
    const p = await getKeywordProfile(clientId)
    expect(p!.institutionType).toBe('trade')
    expect(p!.programs[0].name).toBe('Dental Assisting')
    expect(p!.locale).toEqual({ locationCode: 2840, languageCode: 'en', marketLabel: 'United States — English' })
  })
  it('clears fields with explicit null', async () => {
    await updateKeywordProfile(clientId, { institutionType: 'trade', locale: { locationCode: 2840, languageCode: 'en' } })
    await updateKeywordProfile(clientId, { institutionType: null, locale: null })
    const p = await getKeywordProfile(clientId)
    expect(p!.institutionType).toBeNull()
    expect(p!.locale).toBeNull()
  })
  it('409-class errors: archived client, unknown suggestion', async () => {
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } })
    expect(await updateKeywordProfile(clientId, { institutionType: 'trade' }))
      .toEqual({ ok: false, error: 'client_archived' })
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: null } })
    expect(await updateKeywordProfile(clientId, { confirmSuggestion: 'Nope' }))
      .toEqual({ ok: false, error: 'suggestion_not_found' })
  })
  it('confirmSuggestion moves the entry (url copied, source suggested); already-in-roster just drops it', async () => {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        programSuggestionsJson: JSON.stringify({
          v: 1, derivedFromRunId: 'r1', derivedAt: '2026-07-10T00:00:00Z',
          suggestions: [
            { name: 'Cosmetology', url: 'https://x.edu/c', evidence: ['slug'] },
            { name: 'Dental Assisting', evidence: ['schema'] },
          ],
          dismissedNames: [],
        }),
        programsJson: JSON.stringify([{ name: 'dental  assisting', confirmed: true }]),
      },
    })
    const r1 = await updateKeywordProfile(clientId, { confirmSuggestion: 'Cosmetology' })
    expect(r1.ok).toBe(true)
    const p1 = await getKeywordProfile(clientId)
    expect(p1!.programs.find((e) => e.name === 'Cosmetology')).toMatchObject({
      url: 'https://x.edu/c', source: 'suggested', confirmed: true,
    })
    expect(p1!.suggestions!.suggestions.map((s) => s.name)).toEqual(['Dental Assisting'])
    // Already in roster (normalized match) → dropped from suggestions, roster unchanged.
    const before = p1!.programs.length
    await updateKeywordProfile(clientId, { confirmSuggestion: 'Dental Assisting' })
    const p2 = await getKeywordProfile(clientId)
    expect(p2!.programs).toHaveLength(before)
    expect(p2!.suggestions!.suggestions).toEqual([])
  })
  it('dismissSuggestion removes it and records the normalized name', async () => {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        programSuggestionsJson: JSON.stringify({
          v: 1, derivedFromRunId: 'r1', derivedAt: '2026-07-10T00:00:00Z',
          suggestions: [{ name: 'Cosmetology', evidence: ['slug'] }], dismissedNames: [],
        }),
      },
    })
    const r = await updateKeywordProfile(clientId, { dismissSuggestion: 'Cosmetology' })
    expect(r.ok).toBe(true)
    const p = await getKeywordProfile(clientId)
    expect(p!.suggestions!.suggestions).toEqual([])
    expect(p!.suggestions!.dismissedNames).toEqual(['cosmetology'])
  })
})

describe('suggestPrograms', () => {
  it('errors without a live-scan run; unknown client; archived client', async () => {
    expect(await suggestPrograms(999999999)).toEqual({ ok: false, error: 'client_not_found' })
    expect(await suggestPrograms(clientId)).toEqual({ ok: false, error: 'no_live_scan_run' })
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } })
    expect(await suggestPrograms(clientId)).toEqual({ ok: false, error: 'client_archived' })
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: null } })
  })
  it('derives from the NEWEST live-scan run, persists, preserves dismissedNames, never touches roster', async () => {
    await prisma.client.update({
      where: { id: clientId },
      data: {
        programsJson: JSON.stringify([{ name: 'Kept Program', confirmed: true }]),
        programSuggestionsJson: JSON.stringify({
          v: 1, derivedFromRunId: 'old', derivedAt: '2026-07-01T00:00:00Z',
          suggestions: [], dismissedNames: ['dismissed program'],
        }),
      },
    })
    const old = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', clientId, status: 'complete',
        createdAt: new Date('2026-07-01T00:00:00Z'),
      },
    })
    const fresh = await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', clientId, status: 'complete',
        createdAt: new Date('2026-07-09T00:00:00Z'),
        programEntitiesJson: JSON.stringify({
          v: 1,
          entities: [
            { name: 'Cosmetology', url: 'https://x.edu/c' },
            { name: 'Dismissed Program', url: 'https://x.edu/d' },
          ],
        }),
        pages: {
          create: [{
            url: 'https://x.edu/programs/hvac/', statusCode: 200, indexable: true,
            title: 'HVAC | X', h1: 'HVAC Technician', crawlDepth: 2,
          }],
        },
      },
    })
    void old
    const r = await suggestPrograms(clientId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.suggestions.derivedFromRunId).toBe(fresh.id)
      expect(r.suggestions.dismissedNames).toEqual(['dismissed program'])
      expect(r.suggestions.suggestions.map((s) => s.name).sort()).toEqual(['Cosmetology', 'HVAC Technician'])
    }
    const p = await getKeywordProfile(clientId)
    expect(p!.programs).toEqual([{ name: 'Kept Program', confirmed: true }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/keyword-profile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/services/keyword-profile.ts`:

```ts
// lib/services/keyword-profile.ts
// KS-3 keyword-profile service. Concurrency posture: documented
// last-writer-wins on whole columns (single-operator tool, KS3-Codex #5);
// the UI refetches the whole profile after every mutation. suggestPrograms
// writes ONLY programSuggestionsJson — it can never clobber a roster edit.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  parsePrograms, parseSuggestions, normalizeProgramName,
  type InstitutionType, type ProgramEntry, type ProgramSuggestions,
} from '@/lib/keywords/program-roster'
import { deriveProgramSuggestions } from '@/lib/keywords/program-suggest'

export interface KeywordProfile {
  institutionType: string | null
  programs: ProgramEntry[]
  suggestions: ProgramSuggestions | null
  locale: { locationCode: number; languageCode: string; marketLabel: string | null } | null
  hasLiveScan: boolean // powers the card's "Suggest from latest scan" initial state
}

const LIVE_SCAN_WHERE = { source: 'live-scan', tool: 'seo-parser' } as const

async function hasLiveScanRun(clientId: number): Promise<boolean> {
  const run = await prisma.crawlRun.findFirst({
    where: { clientId, ...LIVE_SCAN_WHERE },
    select: { id: true },
  })
  return run !== null
}

const PROFILE_SELECT = {
  institutionType: true, programsJson: true, programSuggestionsJson: true,
  kwLocationCode: true, kwLanguageCode: true, kwMarketLabel: true, archivedAt: true,
} as const

type ProfileRow = {
  institutionType: string | null
  programsJson: string | null
  programSuggestionsJson: string | null
  kwLocationCode: number | null
  kwLanguageCode: string | null
  kwMarketLabel: string | null
}

function toProfile(row: ProfileRow, hasLiveScan: boolean): KeywordProfile {
  return {
    institutionType: row.institutionType,
    programs: parsePrograms(row.programsJson),
    suggestions: parseSuggestions(row.programSuggestionsJson),
    locale:
      row.kwLocationCode != null && row.kwLanguageCode != null
        ? { locationCode: row.kwLocationCode, languageCode: row.kwLanguageCode, marketLabel: row.kwMarketLabel }
        : null,
    hasLiveScan,
  }
}

export async function getKeywordProfile(clientId: number): Promise<KeywordProfile | null> {
  const row = await prisma.client.findUnique({ where: { id: clientId }, select: PROFILE_SELECT })
  if (!row) return null
  return toProfile(row, await hasLiveScanRun(clientId))
}

export type UpdateResult =
  | { ok: true; profile: KeywordProfile }
  | { ok: false; error: 'client_not_found' | 'client_archived' | 'suggestion_not_found' }

export async function updateKeywordProfile(
  clientId: number,
  patch: {
    institutionType?: InstitutionType | null
    programs?: ProgramEntry[]
    locale?: { locationCode: number; languageCode: string; marketLabel?: string | null } | null
    confirmSuggestion?: string
    dismissSuggestion?: string
  },
): Promise<UpdateResult> {
  const row = await prisma.client.findUnique({ where: { id: clientId }, select: PROFILE_SELECT })
  if (!row) return { ok: false, error: 'client_not_found' }
  if (row.archivedAt) return { ok: false, error: 'client_archived' }

  const data: Prisma.ClientUpdateInput = {}
  if ('institutionType' in patch) data.institutionType = patch.institutionType
  if ('programs' in patch && patch.programs) data.programsJson = JSON.stringify(patch.programs)
  if ('locale' in patch) {
    if (patch.locale === null) {
      data.kwLocationCode = null
      data.kwLanguageCode = null
      data.kwMarketLabel = null
    } else if (patch.locale) {
      data.kwLocationCode = patch.locale.locationCode
      data.kwLanguageCode = patch.locale.languageCode
      data.kwMarketLabel = patch.locale.marketLabel ?? null
    }
  }

  const opName = patch.confirmSuggestion ?? patch.dismissSuggestion
  if (opName != null) {
    const suggestions = parseSuggestions(row.programSuggestionsJson)
    const key = normalizeProgramName(opName)
    const hit = suggestions?.suggestions.find((s) => normalizeProgramName(s.name) === key)
    if (!suggestions || !hit) return { ok: false, error: 'suggestion_not_found' }
    const remaining = suggestions.suggestions.filter((s) => s !== hit)
    if (patch.confirmSuggestion != null) {
      const roster = parsePrograms(row.programsJson)
      if (!roster.some((e) => normalizeProgramName(e.name) === key)) {
        roster.push({
          name: hit.name.slice(0, 200), // belt-and-braces vs validatePrograms' cap (plan-Codex #5)
          ...(hit.url ? { url: hit.url } : {}),
          confirmed: true,
          source: 'suggested',
          addedAt: new Date().toISOString(),
        })
        data.programsJson = JSON.stringify(roster)
      }
      data.programSuggestionsJson = JSON.stringify({ ...suggestions, suggestions: remaining })
    } else {
      data.programSuggestionsJson = JSON.stringify({
        ...suggestions,
        suggestions: remaining,
        dismissedNames: [...suggestions.dismissedNames, key],
      })
    }
  }

  const updated = await prisma.client.update({ where: { id: clientId }, data, select: PROFILE_SELECT })
  return { ok: true, profile: toProfile(updated, await hasLiveScanRun(clientId)) }
}

export async function suggestPrograms(
  clientId: number,
): Promise<{ ok: true; suggestions: ProgramSuggestions } | { ok: false; error: 'client_not_found' | 'client_archived' | 'no_live_scan_run' }> {
  const row = await prisma.client.findUnique({ where: { id: clientId }, select: PROFILE_SELECT })
  if (!row) return { ok: false, error: 'client_not_found' }
  if (row.archivedAt) return { ok: false, error: 'client_archived' }

  // KS-1 precedent: id DESC tiebreaker for same-timestamp rows (plan-Codex #5).
  const run = await prisma.crawlRun.findFirst({
    where: { clientId, ...LIVE_SCAN_WHERE },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, programEntitiesJson: true },
  })
  if (!run) return { ok: false, error: 'no_live_scan_run' }

  const pages = await prisma.crawlPage.findMany({
    where: { runId: run.id },
    select: { url: true, title: true, h1: true, statusCode: true, indexable: true, crawlDepth: true },
  })

  // Validate durable JSON before trusting it (plan-Codex #3) — never cast
  // unknown persisted JSON straight into the derivation input.
  let entities: { name: string; url: string }[] = []
  if (run.programEntitiesJson) {
    try {
      const parsed = JSON.parse(run.programEntitiesJson) as { v?: number; entities?: unknown }
      if (parsed.v === 1 && Array.isArray(parsed.entities)) {
        entities = parsed.entities.filter(
          (e): e is { name: string; url: string } =>
            !!e && typeof e === 'object' &&
            typeof (e as { name?: unknown }).name === 'string' &&
            typeof (e as { url?: unknown }).url === 'string',
        )
      }
    } catch { /* degrade to slug-only */ }
  }

  const prior = parseSuggestions(row.programSuggestionsJson)
  const dismissedNames = prior?.dismissedNames ?? []
  const confirmedNames = parsePrograms(row.programsJson).map((e) => normalizeProgramName(e.name))

  const suggestions: ProgramSuggestions = {
    v: 1,
    derivedFromRunId: run.id,
    derivedAt: new Date().toISOString(),
    suggestions: deriveProgramSuggestions({ pages, programEntities: entities, confirmedNames, dismissedNames }),
    dismissedNames,
  }

  await prisma.client.update({
    where: { id: clientId },
    data: { programSuggestionsJson: JSON.stringify(suggestions) },
  })
  return { ok: true, suggestions }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/keyword-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/keyword-profile.ts lib/services/keyword-profile.test.ts
git commit -m "feat(keywords): KS-3 keyword-profile service (get/update/suggest, LWW documented)"
```

---

### Task 9: Routes — `keyword-profile` GET/PATCH + `suggest` POST

**Files:**
- Create: `app/api/clients/[id]/keyword-profile/route.ts`
- Create: `app/api/clients/[id]/keyword-profile/suggest/route.ts`
- Test: `app/api/clients/[id]/keyword-profile/route.test.ts`

**Interfaces:**
- Consumes: Task 8 service, Task 2 validators, Task 3 `validateProfileLocale`, `withRoute` from `@/lib/api/with-route`, `parseJsonBody` from `@/lib/api/body`, `HttpError` from `@/lib/api/errors`.
- Produces: cookie-gated `GET/PATCH /api/clients/:id/keyword-profile`, `POST /api/clients/:id/keyword-profile/suggest`. NO middleware change (already behind the global cookie gate).

- [ ] **Step 1: Write the failing test** (follow the house route-test convention: import handlers directly, build `NextRequest`s, mock nothing that isn't external — check `app/api/clients/[id]/gsc-snapshot/route.test.ts` for the established harness and reuse its client seeding/cleanup pattern)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { GET, PATCH } from './route'
import { POST as SUGGEST } from './suggest/route'

let clientId: number
const ids: number[] = []

beforeEach(async () => {
  const c = await prisma.client.create({ data: { name: `ks3-route-${Date.now()}-${Math.random()}` } })
  clientId = c.id
  ids.push(c.id)
})
afterEach(async () => {
  await prisma.crawlRun.deleteMany({ where: { clientId: { in: ids } } })
  await prisma.client.deleteMany({ where: { id: { in: ids } } })
  ids.length = 0
})

const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) })
const patchReq = (body: unknown) =>
  new NextRequest('http://localhost/api/clients/1/keyword-profile', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })

describe('GET keyword-profile', () => {
  it('400 bad id, 404 unknown, empty profile for fresh client', async () => {
    expect((await GET(new NextRequest('http://localhost'), params('abc'))).status).toBe(400)
    expect((await GET(new NextRequest('http://localhost'), params(999999999))).status).toBe(404)
    const res = await GET(new NextRequest('http://localhost'), params(clientId))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      institutionType: null, programs: [], suggestions: null, locale: null, hasLiveScan: false,
    })
  })
})

describe('PATCH keyword-profile', () => {
  it('validation rejections with named codes', async () => {
    const cases: [unknown, string][] = [
      [{ institutionType: 'church' }, 'invalid_institution_type'],
      [{ programs: 'nope' }, 'invalid_programs'],
      [{ programs: [{ name: '' }] }, 'invalid_programs'],
      [{ locale: { locationCode: 2840, languageCode: 'zh-TW' } }, 'invalid_locale'],
      [{ locale: { locationCode: 0, languageCode: 'en' } }, 'invalid_locale'],
      [{ programs: [{ name: 'A' }], confirmSuggestion: 'X' }, 'conflicting_ops'],
      [{ confirmSuggestion: 'X', dismissSuggestion: 'Y' }, 'conflicting_ops'],
      [{ confirmSuggestion: '   ' }, 'invalid_suggestion_name'],
      [{}, 'no_valid_fields'],
      [null, 'invalid_body'],
      [[1, 2], 'invalid_body'],
      ['str', 'invalid_body'],
    ]
    for (const [body, code] of cases) {
      const res = await PATCH(patchReq(body), params(clientId))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(code)
    }
  })
  it('malformed JSON body → 400 invalid_json (parseJsonBody)', async () => {
    const req = new NextRequest('http://localhost/x', {
      method: 'PATCH', body: '{oops', headers: { 'content-type': 'application/json' },
    })
    const res = await PATCH(req, params(clientId))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })
  it('happy path sets fields; archived → 409; unknown suggestion → 409', async () => {
    const ok = await PATCH(patchReq({
      institutionType: 'trade',
      programs: [{ name: 'Dental Assisting' }],
      locale: { locationCode: 2840, languageCode: 'EN', marketLabel: 'United States — English' },
    }), params(clientId))
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.locale.languageCode).toBe('en')
    expect(body.programs[0].confirmed).toBe(true)

    expect((await PATCH(patchReq({ confirmSuggestion: 'Nope' }), params(clientId))).status).toBe(409)

    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } })
    const res = await PATCH(patchReq({ institutionType: 'trade' }), params(clientId))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('client_archived')
  })
})

describe('POST suggest', () => {
  it('409 no_live_scan_run without a run; 200 + persisted suggestions with one', async () => {
    const none = await SUGGEST(new NextRequest('http://localhost', { method: 'POST' }), params(clientId))
    expect(none.status).toBe(409)
    expect((await none.json()).error).toBe('no_live_scan_run')

    await prisma.crawlRun.create({
      data: {
        tool: 'seo-parser', source: 'live-scan', clientId, status: 'complete',
        programEntitiesJson: JSON.stringify({ v: 1, entities: [{ name: 'Cosmetology', url: 'https://x.edu/c' }] }),
      },
    })
    const res = await SUGGEST(new NextRequest('http://localhost', { method: 'POST' }), params(clientId))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions.suggestions.map((s: { name: string }) => s.name)).toEqual(['Cosmetology'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run 'app/api/clients/[id]/keyword-profile/route.test.ts'`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both routes**

`app/api/clients/[id]/keyword-profile/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { getKeywordProfile, updateKeywordProfile } from '@/lib/services/keyword-profile'
import { INSTITUTION_TYPES, validatePrograms, type InstitutionType } from '@/lib/keywords/program-roster'
import { validateProfileLocale } from '@/lib/keywords/locales'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

function parseClientId(id: string): number | null {
  const n = parseInt(id, 10)
  return Number.isInteger(n) && n > 0 && String(n) === id.trim() ? n : null
}

/**
 * GET /api/clients/:id/keyword-profile
 * → { institutionType, programs, suggestions, locale } (KS-3 spec §6).
 * Cookie-gated by global middleware.
 */
export const GET = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const clientId = parseClientId(id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
  const profile = await getKeywordProfile(clientId)
  if (!profile) return NextResponse.json({ error: 'client_not_found' }, { status: 404 })
  return NextResponse.json(profile)
})

/**
 * PATCH /api/clients/:id/keyword-profile
 * Any subset of { institutionType, programs, locale } — plus mutually
 * exclusive convenience ops confirmSuggestion / dismissSuggestion (a body
 * mixing ops with `programs`, or both ops, is 400 conflicting_ops —
 * KS3-Codex #5). Locale is validated via validateProfileLocale (bare
 * two-letter language only — KS3-Codex #2). LWW on whole columns; the UI
 * refetches after every mutation. Cookie-gated by global middleware.
 */
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const clientId = parseClientId(id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })

  const raw = await parseJsonBody(request)
  // parseJsonBody returns any valid JSON — null/array/primitive would make
  // `'programs' in body` throw a 500 (plan-Codex #4).
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const body = raw as Record<string, unknown>

  const hasPrograms = 'programs' in body
  const hasConfirm = body.confirmSuggestion != null
  const hasDismiss = body.dismissSuggestion != null
  if ((hasConfirm && hasDismiss) || (hasPrograms && (hasConfirm || hasDismiss))) {
    return NextResponse.json({ error: 'conflicting_ops' }, { status: 400 })
  }

  const patch: Parameters<typeof updateKeywordProfile>[1] = {}

  if ('institutionType' in body) {
    const t = body.institutionType
    if (t !== null && !INSTITUTION_TYPES.includes(t as InstitutionType)) {
      return NextResponse.json({ error: 'invalid_institution_type' }, { status: 400 })
    }
    patch.institutionType = t as InstitutionType | null
  }
  if (hasPrograms) {
    const v = validatePrograms(body.programs)
    if (!v.ok) return NextResponse.json({ error: 'invalid_programs', reason: v.reason }, { status: 400 })
    patch.programs = v.programs
  }
  if ('locale' in body) {
    if (body.locale === null) {
      patch.locale = null
    } else {
      const loc = validateProfileLocale(body.locale)
      if (!loc) return NextResponse.json({ error: 'invalid_locale' }, { status: 400 })
      const marketLabel = (body.locale as Record<string, unknown>).marketLabel
      patch.locale = { ...loc, marketLabel: typeof marketLabel === 'string' ? marketLabel.slice(0, 100) : null }
    }
  }
  if (hasConfirm) {
    if (typeof body.confirmSuggestion !== 'string' || !body.confirmSuggestion.trim()) {
      return NextResponse.json({ error: 'invalid_suggestion_name' }, { status: 400 })
    }
    patch.confirmSuggestion = body.confirmSuggestion
  }
  if (hasDismiss) {
    if (typeof body.dismissSuggestion !== 'string' || !body.dismissSuggestion.trim()) {
      return NextResponse.json({ error: 'invalid_suggestion_name' }, { status: 400 })
    }
    patch.dismissSuggestion = body.dismissSuggestion
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no_valid_fields' }, { status: 400 })
  }

  const result = await updateKeywordProfile(clientId, patch)
  if (!result.ok) {
    const status = result.error === 'client_not_found' ? 404 : 409
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json(result.profile)
})
```

`app/api/clients/[id]/keyword-profile/suggest/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { suggestPrograms } from '@/lib/services/keyword-profile'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

// Route files export only handlers + config, so the strict id parse is
// duplicated here rather than exported from the sibling route (plan-Codex #4).
function parseClientId(id: string): number | null {
  const n = parseInt(id, 10)
  return Number.isInteger(n) && n > 0 && String(n) === id.trim() ? n : null
}

/**
 * POST /api/clients/:id/keyword-profile/suggest
 * No body. Derives program suggestions from the client's NEWEST live-scan run
 * (KS-3 spec §4), persists them (replacing prior suggestions, preserving
 * dismissedNames), returns { suggestions }. Writes ONLY
 * programSuggestionsJson — never the roster. Archived clients 409.
 * Cookie-gated by global middleware.
 */
export const POST = withRoute(async (_request: NextRequest, { params }: RouteParams) => {
  const { id } = await params
  const clientId = parseClientId(id)
  if (clientId === null) {
    return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
  }
  const result = await suggestPrograms(clientId)
  if (!result.ok) {
    const status = result.error === 'client_not_found' ? 404 : 409
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ suggestions: result.suggestions })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run 'app/api/clients/[id]/keyword-profile/route.test.ts'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'app/api/clients/[id]/keyword-profile'
git commit -m "feat(keywords): KS-3 keyword-profile routes (GET/PATCH + suggest POST, withRoute)"
```

---

### Task 10: `KeywordProfileCard` + manage-page wiring

**Files:**
- Create: `components/clients/KeywordProfileCard.tsx` (client component)
- Modify: `app/(app)/clients/[id]/page.tsx` (add `getKeywordProfile` to the Promise.all; render the card after `<GscKeywordCard …>`)
- Test: `components/clients/KeywordProfileCard.test.tsx`

**Interfaces:**
- Consumes: `KeywordProfile` from `@/lib/services/keyword-profile` (type-only import), `INSTITUTION_TYPES`/`ProgramEntry`/`ProgramSuggestion` from `@/lib/keywords/program-roster`, `CURATED_LOCALES` from `@/lib/keywords/locales`; fetches `/api/clients/[id]/keyword-profile` (+ `/suggest`).
- Produces: `<KeywordProfileCard clientId={number} initialProfile={KeywordProfile} archived={boolean} />`.

Behavior (spec §7): institution-type select (5 options + "Not set"); locale select over `CURATED_LOCALES` + Advanced disclosure with raw locationCode/two-letter-language inputs (helper text: "Regional variants like zh-TW aren't supported yet"); roster table (name, credential, url link, source badge, remove button) + inline add form (name required, url/credential optional); suggestions block with "Suggest from latest scan" button, per-row evidence chips + Confirm/Dismiss. EVERY mutation: PATCH (or POST suggest) → on success **refetch GET** (the spec's required LWW mitigation) → update state; on failure render the error envelope's `error` code in a visible message. All controls disabled while a request is in flight and when `archived`. Dark-mode variants everywhere (`bg-white dark:bg-navy-card`, `border-gray-200 dark:border-navy-border`, `text-gray-900 dark:text-white`, etc. — copy the class vocabulary from `GscKeywordCard.tsx`). No localStorage/hydration-sensitive reads.

- [ ] **Step 1: Write the failing test**

`components/clients/KeywordProfileCard.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { KeywordProfileCard } from './KeywordProfileCard'

const emptyProfile = { institutionType: null, programs: [], suggestions: null, locale: null, hasLiveScan: false }
const scannedProfile = { ...emptyProfile, hasLiveScan: true }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mockFetch = (impl: (url: string, init?: RequestInit) => { status: number; body: unknown }) => {
  ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
    const { status, body } = impl(String(url), init)
    return new Response(JSON.stringify(body), { status })
  })
}

describe('KeywordProfileCard', () => {
  it('renders empty states', () => {
    render(<KeywordProfileCard clientId={1} initialProfile={emptyProfile} archived={false} />)
    expect(screen.getByText('Keyword Profile')).toBeTruthy()
    expect(screen.getByText(/No programs yet/i)).toBeTruthy()
  })

  it('renders roster entries and suggestions with evidence chips', () => {
    render(<KeywordProfileCard clientId={1} archived={false} initialProfile={{
      institutionType: 'trade',
      programs: [{ name: 'Dental Assisting', confirmed: true, source: 'suggested' }],
      suggestions: {
        v: 1, derivedFromRunId: 'r', derivedAt: '2026-07-10T00:00:00Z',
        suggestions: [{ name: 'Cosmetology', evidence: ['slug', 'schema'] }], dismissedNames: [],
      },
      locale: { locationCode: 2840, languageCode: 'en', marketLabel: 'United States — English' },
      hasLiveScan: true,
    }} />)
    expect(screen.getByText('Dental Assisting')).toBeTruthy()
    expect(screen.getByText('Cosmetology')).toBeTruthy()
    expect(screen.getByText('slug')).toBeTruthy()
    expect(screen.getByText('schema')).toBeTruthy()
  })

  it('suggest button is INITIALLY disabled with a hint when hasLiveScan is false (plan-Codex #6)', () => {
    render(<KeywordProfileCard clientId={1} initialProfile={emptyProfile} archived={false} />)
    const btn = screen.getByRole('button', { name: /suggest from latest scan/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(screen.getByText(/run a site seo scan first/i)).toBeTruthy()
  })

  it('confirm sends the EXACT op payload then refetches the profile', async () => {
    const calls: { method: string; url: string; body?: unknown }[] = []
    mockFetch((url, init) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (init?.method === 'PATCH') return { status: 200, body: scannedProfile }
      return { status: 200, body: { ...scannedProfile, programs: [{ name: 'Cosmetology', confirmed: true }] } }
    })
    render(<KeywordProfileCard clientId={7} archived={false} initialProfile={{
      ...scannedProfile,
      suggestions: {
        v: 1, derivedFromRunId: 'r', derivedAt: '2026-07-10T00:00:00Z',
        suggestions: [{ name: 'Cosmetology', evidence: ['slug'] }], dismissedNames: [],
      },
    }} />)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH')
      expect(patch?.url).toContain('/api/clients/7/keyword-profile')
      expect(patch?.body).toEqual({ confirmSuggestion: 'Cosmetology' })
      expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1)
    })
    expect(await screen.findByText('Cosmetology')).toBeTruthy()
  })

  it('dismiss, roster remove, and locale select send their exact payloads', async () => {
    const bodies: unknown[] = []
    mockFetch((url, init) => {
      if (init?.method === 'PATCH') bodies.push(JSON.parse(String(init.body)))
      return { status: 200, body: scannedProfile }
    })
    render(<KeywordProfileCard clientId={7} archived={false} initialProfile={{
      ...scannedProfile,
      programs: [{ name: 'Old Prog', confirmed: true }],
      suggestions: {
        v: 1, derivedFromRunId: 'r', derivedAt: '2026-07-10T00:00:00Z',
        suggestions: [{ name: 'Cosmetology', evidence: ['slug'] }], dismissedNames: [],
      },
    }} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    await waitFor(() => expect(bodies).toContainEqual({ dismissSuggestion: 'Cosmetology' }))
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(bodies).toContainEqual({ programs: [] }))
    fireEvent.change(screen.getByLabelText(/keyword locale/i), { target: { value: '2124:fr' } })
    await waitFor(() => expect(bodies).toContainEqual({
      locale: { locationCode: 2124, languageCode: 'fr', marketLabel: 'Canada — French' },
    }))
  })

  it('surfaces the 409 no_live_scan_run hint after a failed suggest (stale hasLiveScan)', async () => {
    mockFetch(() => ({ status: 409, body: { error: 'no_live_scan_run' } }))
    render(<KeywordProfileCard clientId={1} initialProfile={scannedProfile} archived={false} />)
    fireEvent.click(screen.getByRole('button', { name: /suggest from latest scan/i }))
    expect(await screen.findByText(/no completed site seo scan/i)).toBeTruthy()
  })

  it('disables all controls when archived', () => {
    render(<KeywordProfileCard clientId={1} initialProfile={emptyProfile} archived={true} />)
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/KeywordProfileCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the card**

`components/clients/KeywordProfileCard.tsx` — implement with this exact skeleton (fill the JSX per the behavior block above; keep ALL listed class pairs):

```tsx
'use client'

import { useCallback, useState } from 'react'
import {
  INSTITUTION_TYPES, type InstitutionType, type ProgramEntry, type ProgramSuggestion,
} from '@/lib/keywords/program-roster'
import { CURATED_LOCALES } from '@/lib/keywords/locales'
import type { KeywordProfile } from '@/lib/services/keyword-profile'

const TYPE_LABELS: Record<InstitutionType, string> = {
  trade: 'Trade / Career school', bootcamp: 'Bootcamp', university: 'University / College',
  k12: 'K-12', other: 'Other',
}

export function KeywordProfileCard({ clientId, initialProfile, archived }: {
  clientId: number
  initialProfile: KeywordProfile
  archived: boolean
}) {
  const [profile, setProfile] = useState(initialProfile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // add-form fields: name/url/credentialLevel useState strings
  // Advanced-locale disclosure: open flag + locationCode/languageCode strings

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/keyword-profile`)
    if (res.ok) setProfile(await res.json())
  }, [clientId])

  const mutate = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/keyword-profile`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) { setError((await res.json()).error ?? 'request_failed'); return }
      await refetch() // LWW mitigation — ALWAYS refetch after a mutation (spec §6)
    } finally { setBusy(false) }
  }, [clientId, refetch])

  const suggest = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/keyword-profile/suggest`, { method: 'POST' })
      if (!res.ok) {
        const code = (await res.json()).error
        setError(code === 'no_live_scan_run'
          ? 'No completed site SEO scan for this client yet — run one first.' : code)
        return
      }
      await refetch()
    } finally { setBusy(false) }
  }, [clientId, refetch])

  const disabled = busy || archived
  const suggestDisabled = disabled || !profile.hasLiveScan // plan-Codex #6: initial state, not just post-click 409
  // JSX: <section className="bg-white dark:bg-navy-card border border-gray-200
  // dark:border-navy-border rounded-lg p-5"> … heading "Keyword Profile" …
  // 1) institution select → onChange mutate({ institutionType: value || null })
  // 2) locale select over CURATED_LOCALES, aria-label "Keyword locale"
  //    (value `${locationCode}:${languageCode}`) → mutate({ locale:
  //    { locationCode, languageCode, marketLabel: label } });
  //    "Not set" option → mutate({ locale: null }); <details> Advanced with two
  //    inputs + Apply button → mutate({ locale: { locationCode: Number(loc),
  //    languageCode: lang } }) + helper text "Regional variants like zh-TW
  //    aren't supported yet"
  // 3) roster table (empty state "No programs yet — add one or suggest from the
  //    latest scan") — Remove sends mutate({ programs: profile.programs.filter(…) });
  //    add-form submit sends mutate({ programs: [...profile.programs,
  //    { name, url: url || undefined, credentialLevel: cred || undefined }] })
  // 4) suggestions: button "Suggest from latest scan" disabled={suggestDisabled}
  //    → suggest(); when !profile.hasLiveScan render the hint
  //    "Run a site SEO scan first to derive suggestions."; rows with evidence
  //    chips + Confirm → mutate({ confirmSuggestion: s.name }) and Dismiss →
  //    mutate({ dismissSuggestion: s.name })
  // error → <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
}
```

(The final component is ~250 lines of JSX; keep sub-blocks as small local components inside the file if it helps readability, but export only `KeywordProfileCard`.)

- [ ] **Step 4: Wire the page**

`app/(app)/clients/[id]/page.tsx`: add to imports `import { KeywordProfileCard } from '@/components/clients/KeywordProfileCard'` and `import { getKeywordProfile } from '@/lib/services/keyword-profile'`; add `getKeywordProfile(clientId)` to the existing `Promise.all` (new variable `keywordProfile`); render directly after `<GscKeywordCard …/>`:

```tsx
        {keywordProfile && (
          <KeywordProfileCard
            clientId={clientId}
            initialProfile={keywordProfile}
            archived={dash.client.archivedAt != null}
          />
        )}
```

- [ ] **Step 5: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/KeywordProfileCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/clients/KeywordProfileCard.tsx components/clients/KeywordProfileCard.test.tsx 'app/(app)/clients/[id]/page.tsx'
git commit -m "feat(clients): KS-3 KeywordProfileCard on the client manage page"
```

---

### Task 11: Full gates

- [ ] **Step 1: Lint/typecheck** — Run: `npx tsc --noEmit` — Expected: clean.
- [ ] **Step 2: Full test suite** — Run: `DATABASE_URL="file:./local-dev.db" npm test` — Expected: all green (≈4269 pre-existing + new).
- [ ] **Step 3: Build** — Run: `npm run build` — Expected: success. **This is the SWC compilation verification for the Task 4 injected-code change (KS3-Codex #6)**: the `toString()` helper-token test (Task 4) + a green production build is the established gate for injected code — do not invent a new verification mechanism.
- [ ] **Step 4: Commit any stragglers, push, open PR**

```bash
git push -u origin feat/ks3-client-profile-roster
gh pr create --title "feat(keywords): KS-3 client institution profile + program roster + keyword locale" --body "..."
```

---

## Execution notes

- Branch: `feat/ks3-client-profile-roster` off current `main`.
- Task order is dependency order: 1 → 2/3 (parallel-safe) → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Tasks 2, 3 and 4, 5 have no mutual dependency and may run as parallel subagents; Task 6 needs 1+4+5; Task 7 needs 2; Task 8 needs 2+3+7 (and 6 for the entity path); Tasks 9–10 need 8.
- Prisma-client mocking gotcha: the Prisma client is a proxy — `vi.spyOn` on model methods breaks on `mockRestore`; the DB-backed tests above avoid mocking entirely (house preference).
- After merge: deploy (stop-first recipe), prod-verify (migration applied via `deploy.sh`'s `migrate deploy`; GET the keyword-profile route on a real client; confirm `/clients/[id]` renders the card), then tracker + handoff ritual in the same commit, archive spec+plan.
