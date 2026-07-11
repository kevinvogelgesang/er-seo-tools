# KS-3 — Client institution profile + structured program roster + keyword locale — Design

**Date:** 2026-07-10
**Status:** Reviewed — Codex accept-with-named-fixes applied (KS3-Codex #1–#6, 2026-07-10)
**Parent:** `2026-07-10-keyword-strategy-capability-design.md` §4 KS-3 (Codex #3, #7)
**Increment:** C20 Keyword Strategy, 3 of 5 (after KS-1 GSC snapshot, KS-2 volume provider; before KS-4 FAQ signals, KS-5 export)

## 1. Problem

The keyword-strategy workflow (KS-5's export + the krt_ skill) needs three
pieces of client metadata that exist nowhere in the system today:

1. **What kind of institution is this?** (trade school vs bootcamp vs
   university vs K-12) — drives keyword framing and compliance tone.
2. **What programs does it offer?** — the roster is the seed set for keyword
   generation. Today this knowledge lives in Kevin's head and in SEMRush CSVs.
3. **What market is it in?** — DataForSEO volume lookups (KS-2, dark; consumed
   in KS-5) require structured `location_code` + `language_code`, not freeform
   market names (umbrella Codex #3).

The scans already observe program evidence (program-slug URLs, JSON-LD
`Course`/`EducationalOccupationalProgram` entities, titles/H1s) — but a durable
roster must be **human-confirmed**, never auto-derived (umbrella's "unclear
programs → confirm" rule; Codex #7).

## 2. Goals / Non-goals

**Goals**
- `Client` carries: institution type, a structured confirmed program roster,
  auto-suggestions retained separately, and a primary keyword locale.
- Editable on the client manage page (`/clients/[id]`).
- "Suggest from latest scan" derives candidates from the newest live-scan run —
  zero new fetches, suggestions only, operator confirms.
- Close the KS-2 rolled-up review note: verify `normalizeLocale`'s language
  regex against real DataForSEO `language_code` values (done — §8).

**Non-goals**
- No consumer wiring: KS-5 reads this data; nothing here calls
  `getKeywordVolumes` or changes exports.
- No new crawling or external fetches of any kind (suggest reads existing rows;
  the locale picker is a static list — no locations-endpoint sync, umbrella §10
  breadcrumb).
- No per-campus/location roster (deferred — §9).
- No AI API (standing gate).

## 3. Storage shape (decision)

**JSON columns on `Client`, not a new model.** Precedent: `domains` and
`seedUrls` are JSON-string columns. The roster is small (a school offers
~5–50 programs), read whole-per-client (KS-5 export), never queried
relationally. A `Program` model would add FK/migration surface for zero query
benefit. Locale fields are scalars (queryable, mirrors
`ga4PropertyId`/`gscSiteUrl`).

```prisma
model Client {
  // ... existing ...
  institutionType        String?  // 'trade' | 'bootcamp' | 'university' | 'k12' | 'other'
  programsJson           String?  // confirmed roster — JSON ProgramEntry[]
  programSuggestionsJson String?  // suggestions + provenance — JSON ProgramSuggestions
  kwLocationCode         Int?     // DataForSEO location_code (e.g. 2840 = US)
  kwLanguageCode         String?  // DataForSEO language_code, canonical lowercase (e.g. 'en')
  kwMarketLabel          String?  // display name (e.g. 'United States — English')
}
```

Migration: additive nullable columns only — hand-authored SQL, no PRAGMA
rebuild.

### TypeScript shapes (`lib/keywords/program-roster.ts`, client-safe)

```ts
interface ProgramEntry {
  name: string                 // required, trimmed, 1–200 chars
  url?: string                 // absolute http(s) URL, ≤500 chars
  aliases?: string[]           // ≤10, each 1–100 chars
  credentialLevel?: string     // freeform, ≤100 chars (e.g. 'diploma', 'AAS')
  confirmed: true              // always true in programsJson (shape per umbrella)
  source?: 'manual' | 'suggested'  // provenance: typed in vs confirmed from a suggestion
  addedAt?: string             // ISO timestamp
}

interface ProgramSuggestion {
  name: string
  url?: string
  evidence: ('slug' | 'schema' | 'heading')[]  // which signals produced it
}

interface ProgramSuggestions {
  v: 1
  derivedFromRunId: string
  derivedAt: string            // ISO
  suggestions: ProgramSuggestion[]   // cap 40
  dismissedNames: string[]     // normalized names the operator dismissed —
                               // re-running suggest does not resurface them
}
```

Caps enforced at the route: roster ≤ 100 entries; suggestions ≤ 40. Confirmed
entries and suggestions are disjoint by normalized name (confirm moves the
entry; dismiss records the name).

**Parse posture:** all three JSON columns are parsed defensively at read time
(try/catch → treat as empty, per house `JSON.parse` rule); the writer always
re-serializes the full validated value — no partial JSON patching.

## 4. Suggestion derivation (decision)

**Request-time, from durable rows of the newest live-scan run.** No new fetches,
no job, no schedule — a POST computes and returns in one request (bounded: ≤1000
`CrawlPage` rows, pure classification).

Resolve the run:
```ts
prisma.crawlRun.findFirst({
  where: { clientId, source: 'live-scan', tool: 'seo-parser' },
  orderBy: { createdAt: 'desc' },   // uses @@index([clientId, tool, createdAt])
})
```
No run → 409 `no_live_scan_run` (UI disables the button with a hint to run a
site SEO scan first).

### Signals (pure `deriveProgramSuggestions()` in `lib/keywords/program-suggest.ts`)

1. **URL slug** — `classifyPageType()` (the pillar classifier,
   `lib/services/pillarAnalysis/pageType.ts`) over each `CrawlPage.url` with
   `schemaTypes: []` and the page's `crawlDepth`; keep `pageType === 'program'`.
   Candidate name = cleaned H1, falling back to cleaned title (strip a
   site-name suffix after the last `|` / `–` / `—` separator; collapse
   whitespace; drop candidates < 3 chars).
2. **JSON-LD program entities** — `CrawlRun.programEntitiesJson` (new, §5) when
   present: `{ name, url }` pairs from `Course` /
   `EducationalOccupationalProgram` nodes. Older runs lack it → signal silently
   absent (suggestions degrade to slug/heading evidence — never an error).
3. **Headings on program-typed pages** are already covered by (1)'s name
   extraction; no separate token mining in v1 (keeps precision high — a noisy
   suggestion list erodes trust in confirm-flow).

Dedupe by normalized name (trim, lowercase, collapse whitespace); merge
evidence arrays; exclude names already in the confirmed roster or in
`dismissedNames`; only pages with `indexable !== false` and 2xx
`statusCode` participate. Cap 40 (slug+schema evidence ranks above
single-signal).

**Persistence:** POST replaces `programSuggestionsJson` wholesale (new
provenance stamp, preserved `dismissedNames`), and NEVER touches
`programsJson`. Confirming a suggestion is a PATCH that appends to the roster
(`source: 'suggested'`) and drops it from suggestions.

## 5. Durable JSON-LD program entities (small scan-side addition)

Per-page JSON-LD types live only in transient `HarvestedPageSeo.detailsJson`
(deleted after the live-scan builder runs), and the durable
`CrawlRun.schemaTypesJson` is a type histogram — **names are not persisted
anywhere**. The umbrella names JSON-LD Course/EducationalOccupationalProgram
*names* as a derivation source, so:

1. **`parse-seo-dom.ts`:** in the existing JSON-LD walk (the same
   `@type`/`@graph` recursion), when a node's `@type` includes `Course` or
   `EducationalOccupationalProgram` and `rec.name != null`, push
   `String(rec.name).slice(0, 120)` — cap 20 names/page.
   **Injection contract is absolute:** self-contained, no module scope, no
   `typeof` (SWC `_type_of` helper — the `cc8d1c1` incident class); the
   `rec.name != null` + `String()` pattern already used for `@type` needs no
   `typeof`. **Verification claim, stated honestly (KS3-Codex #6):** the
   existing parse-seo-dom test inspects `parseSeoFromDocument.toString()` for
   helper-looking tokens — it is NOT an es2017/SWC compilation check; the
   production `next build` gate is the actual compiler verification and is
   REQUIRED before merge. Tests add malformed-JSON-LD and non-string-`name`
   cases (object/array/number names must not crash or emit junk).
2. **`HarvestedPageSeo.detailsJson`** gains `programNames?: string[]` (bounded;
   no schema change — it's already a bounded-JSON column). Named seams that
   must ALL be touched (KS3-Codex #4): the `RawPageSeo` type
   (`parse-seo-dom.ts`), the `detailsJson` assembly in the page job's
   post-settle persist (`persistPageSeo` seam), the builder's harvested-row
   `select` (it must select `detailsJson` — it already does for schema types),
   the `CrawlRunInput` contract in `lib/findings/types.ts` (new optional
   `programEntitiesJson`), and the bundle passed to `writeFindingsRun()` —
   the writer's spread persists it, but tsc rejects the builder until the
   input contract is extended.
3. **Builder (`broken-link-verify.ts`):** aggregate `{ name, url }` pairs
   across harvested rows → new nullable **`CrawlRun.programEntitiesJson`** —
   written before transient deletion, exactly like `schemaTypesJson` (C14
   precedent, `lib/ada-audit/seo/schema-types.ts`). Pure aggregator
   `aggregateProgramEntities()` beside it. **Determinism + eligibility
   (KS3-Codex #3):** `url` is the harvested row's normalized `url` (the
   audited page URL — JSON-LD `Course.url` is NOT captured in v1); only rows
   that are indexable (2xx ∧ html ∧ ¬noindex) ∧ ¬login-like participate (a
   login-walled page must never seed a roster suggestion); rows are sorted by
   normalized name, then URL, BEFORE dedupe/cap, and the first URL per
   normalized name wins — cap 100 entries. Failure to aggregate must never
   fail the run write (same try/catch posture as content similarity).

This benefits all future audits; historical runs simply lack the signal.

## 6. API surface

New cookie-gated sub-routes (mirrors `analytics/route.ts` — **no
`middleware.ts` change**: `/api/clients/*` is already behind the global cookie
gate; the new-route 401 trap applies to public/token routes only). Both use
`withRoute` + `parseJsonBody` (A3).

- **`GET /api/clients/[id]/keyword-profile`** → `{ institutionType, programs,
  suggestions, locale: { locationCode, languageCode, marketLabel } | null }`.
  404 unknown client.
- **`PATCH /api/clients/[id]/keyword-profile`** — accepts any subset of:
  - `institutionType`: enum above or null → 400 `invalid_institution_type`
    otherwise.
  - `programs`: full replacement array of ProgramEntry (validated: name
    lengths, http(s) url parse, alias caps, roster cap; entries are stored with
    `confirmed: true`) → 400 `invalid_programs` with a per-entry reason.
  - `confirmSuggestion` / `dismissSuggestion`: `{ name }` convenience ops that
    move/remove a suggestion together with the roster/suggestions rewrite
    (single `client.update` — one row, no transaction needed).
    **Op-conflict rules (KS3-Codex #5):** a body combining `programs` with
    `confirmSuggestion`/`dismissSuggestion` (or both ops at once) is 400
    `conflicting_ops` — the ops exist precisely so the UI never sends whole
    arrays for a one-entry move. An unknown suggestion name → 409
    `suggestion_not_found`; confirming a name already in the roster
    (normalized match) drops it from suggestions without duplicating the
    roster entry. Confirm copies the suggestion's `url` and stamps
    `source: 'suggested'`, `confirmed: true`, `addedAt`.
  - `locale`: `{ locationCode, languageCode, marketLabel? } | null` — validated
    through **`normalizeLocale()` (KS-2's canonicalizer — the ONE validation
    seam, never a reimplementation)** PLUS the KS-3 route-side restriction of
    §8 (bare two-letter language codes only); the canonical (lowercased) form
    is what gets stored. 400 `invalid_locale` on rejection.
  - 409 `client_archived` on archived clients (matches schedules-route
    posture).
- **`POST /api/clients/[id]/keyword-profile/suggest`** — no body; resolves the
  newest live-scan run, derives, persists suggestions, returns the new
  suggestions payload. 409 `no_live_scan_run` when the client has none.

Concurrency (KS3-Codex #5, decided): **documented last-writer-wins** — this is
a single-operator tool and every other client field has the same posture; no
compare-and-swap. The read-modify-write inside confirm/dismiss can in
principle race a concurrent suggest POST; accepted, because the ops touch
disjoint concerns in the common case and the UI **refetches the whole profile
after every mutation** (required behavior), so any lost update is visible and
re-appliable immediately. The suggest POST writes only
`programSuggestionsJson`, so it can never clobber a concurrent roster edit.

## 7. Manage-page UX (decision)

New **`KeywordProfileCard`** client component (`components/clients/`,
`AnalyticsIdsPanel` precedent: server page passes initial values; card PATCHes
its sub-route), placed on `/clients/[id]` near `GscKeywordCard` (the keyword
cluster). Sections:

1. **Institution type** — five-option select (Trade/Career school, Bootcamp,
   University/College, K-12, Other) + "not set" state.
2. **Keyword locale** — select over the curated list (§8): market label shown,
   codes stored. An "Advanced" disclosure exposes raw
   `locationCode`/`languageCode` inputs for markets not in the list —
   language restricted to **bare two-letter codes** (§8, KS3-Codex #2), with
   helper text saying regional variants (`zh-TW`-style) are not yet supported.
3. **Program roster** — table of confirmed entries (name, credential, url link,
   source badge); inline add/edit/delete; empty state explains the KS-5 payoff
   ("programs feed keyword generation").
4. **Suggestions** — "Suggest from latest scan" button (disabled + hint when
   the client has no live-scan run; shows the source run's date when
   suggestions exist). Each suggestion row: name, evidence chips
   (slug/schema/heading), linkified url, **Confirm** / **Dismiss**.

House UI rules: dark-mode variants on every element; no hydration-mismatch
patterns; loading/error states on every mutation.

## 8. Keyword locale — curated list + regex verification (closes the KS-2 note)

### Curated list (`lib/keywords/locales.ts`, client-safe static data)

ER's client base is North-American schools. v1 list (label → codes):

| Market | location_code | language_code |
|---|---|---|
| United States — English | 2840 | en |
| Canada — English | 2124 | en |
| Canada — French | 2124 | fr |
| United Kingdom — English | 2826 | en |
| Australia — English | 2036 | en |
| United States — Spanish | 2840 | es |

Every entry passes `normalizeLocale()` (asserted by a test that runs the whole
list through it). Location codes are DataForSEO's Google-Ads location codes
(country level). **No locations-endpoint sync** — revisit only if a client
lands outside this table and the Advanced inputs don't suffice (umbrella §10
breadcrumb stands).

### Language-regex verification (KS-2 rolled-up review note — resolved)

Verified against DataForSEO's Google Ads languages documentation (2026-07-10):
43 languages; `language_code` is ISO 639-1 — two-letter lowercase primaries
plus hyphenated regional variants with **uppercase region** (`zh-TW`, `zh-CN`,
`pt-BR`, `pt-PT`). Findings vs `LANGUAGE_CODE_RE = /^[a-z]{2}(-[a-z]{2,4})?$/`
(applied after lowercasing):

1. **All 43 Google Ads codes pass** the regex post-lowercase. No 3-letter
   primaries exist in the Google Ads set. (DataForSEO **Labs** language lists
   do include 3-letter ISO 639-2 codes, e.g. `ceb` — out of scope: KS-2's only
   consumer is the Google Ads endpoint.)
2. **Regex stays as-is (KS3-Codex #1).** `normalizeLocale` is the Google Ads
   *provider's* validation seam — widening it to `[a-z]{2,3}` would let KS-3's
   form admit Labs-only codes that KS-2's sole consumer cannot use. If a Labs
   endpoint ever lands (KS-6), it gets its own validator (or the validator
   splits per provider) — recorded breadcrumb, no code change now. A KS-3 test
   documents the verification: the 43-code Google Ads set (representative
   sample: `en`, `fr`, `es`, `zh-tw`, `pt-br` post-lowercase) passes; junk
   (`eng-`, `e`, `english`, `12`, `ceb`) fails — `ceb` failing is the
   *documented* provider boundary, not a bug.
3. **Case-sensitivity gap is real at the Advanced inputs (KS3-Codex #2):**
   `normalizeLocale` lowercases, and `dataforseo-client.ts` sends the
   canonical form on the wire — an operator typing `zh-TW` into Advanced
   would put `zh-tw` on the wire, and DataForSEO's docs don't state whether
   matching is case-insensitive. **KS-3 therefore restricts the language
   field (curated list AND Advanced inputs) to bare two-letter codes**
   (`/^[a-z]{2}$/` after trim+lowercase, enforced at the route — stricter
   than, and in addition to, `normalizeLocale`). Hyphenated regionals are
   rejected with a clear message until someone empirically verifies the API
   accepts the lowercased form (or the canonicalizer learns to preserve
   region case — a cache-key-versioning change). Recorded constraint.

## 9. Kevin decisions touched (proposed defaults — not blocking)

- **§5 Q5 (profile shape):** `trade | bootcamp | university | k12 | other` is
  enough for v1; roster entries carry optional `credentialLevel` + `aliases`
  from day one (cheap JSON, feeds KS-5 keyword generation); **per-campus geo
  fields deferred** — campuses are a locations roster, not program fields, and
  nothing in KS-4/KS-5 consumes them yet.
- **§5 Q2 (roster confirmation UX):** operator-confirm stands. Proposed
  refinement for KS-5 (recorded here, implemented there): the export includes
  the confirmed roster as the seed set AND the current suggestions in a
  separate advisory block explicitly marked unconfirmed — the skill may ask
  Kevin about them but never treats them as roster.

## 10. Testing

- **Pure:** `deriveProgramSuggestions` (slug/schema/heading merge, dedupe,
  dismissed exclusion, caps, non-indexable exclusion, title-suffix cleaning),
  `aggregateProgramEntities` (dedupe, caps, malformed detailsJson tolerance,
  **noindex/login-like exclusion, deterministic first-URL winner for duplicate
  names** — KS3-Codex #3), locale-list validation (every entry through
  `normalizeLocale` AND the two-letter restriction), the §8 regex-boundary
  documentation test (Google Ads sample passes; `ceb`/regionals rejected at
  the route).
- **parse-seo-dom:** program-name extraction incl. `@graph` nesting, array
  `@type`, missing name, **non-string name (object/array/number), malformed
  JSON-LD** (KS3-Codex #6), 20/page cap — the `toString()` helper-token test
  stays green, and the `next build` gate is the actual SWC compilation
  verification (required before merge).
- **Routes:** GET/PATCH/suggest — validation rejections (institution enum,
  program entry bounds, locale restriction), archived-client 409,
  no-live-scan-run 409, confirm/dismiss moves (incl. `conflicting_ops` 400,
  `suggestion_not_found` 409, already-in-roster dedupe — KS3-Codex #5),
  suggest replaces suggestions but never touches roster.
- **Component:** `KeywordProfileCard` states (empty/populated/suggesting/
  error), `afterEach(cleanup)` + `getAllBy*` per house test gotchas.
- **Builder:** live-scan builder writes `programEntitiesJson` (and its
  aggregation failure never fails the run write).

## 11. Out of scope / deferred

- KS-5 export assembly, volume-lookup endpoint, krt_ scope changes.
- Locations-endpoint sync; hyphenated-regional locales (gated on the §8
  case-sensitivity check); Labs-endpoint locale validation (KS-6, own
  validator per KS3-Codex #1).
- Per-campus roster; program-page content analysis.
- Any change to KS-1/KS-2 code — `volume-normalize.ts` is untouched.
