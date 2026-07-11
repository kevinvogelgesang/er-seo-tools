# KS-4 — FAQ Tri-State Detection + Page Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-page tri-state FAQ evidence (`present:<signals>` / `not-detected` / NULL=unknown) persisted on `CrawlPage` by the live-scan builder, plus a pure page-inventory builder (`buildPageInventory`) for KS-5 to consume.

**Architecture:** The injected DOM parser (`parse-seo-dom.ts`) gains bounded raw FAQ signals riding the existing transient `HarvestedPageSeo.detailsJson` blob (no transient migration); a pure Node-side helper (`deriveFaqEvidence`) turns signals + schemaTypes into the grammar string; the live-scan builder passes it through the existing `ensurePage()` scalar path into a new nullable `CrawlPage.faqEvidence` column; a pure `lib/keywords/page-inventory.ts` decodes the grammar and classifies pageType at read time. Ships dark — no UI, no export surface.

**Tech Stack:** Next.js 15 / TypeScript / Prisma + SQLite / vitest (jsdom for DOM tests).

**Spec:** `docs/superpowers/specs/2026-07-10-ks4-faq-tristate-page-inventory-design.md` (Codex-reviewed, fixes #1–#5 applied — annotations referenced per task below).

## Global Constraints

- **Injected-code contract (cc8d1c1 class):** everything added inside `parseSeoFromDocument` must be self-contained — NO module-scope references, NO `typeof` (string checks via `String(v) === v` if ever needed; DOM APIs return strings/null so none is needed here). The existing `toString()` grep test must stay green; the real gate is `npm run build`.
- **Array-form `$transaction([...])` only** — not touched by this plan, but no task may introduce an interactive transaction.
- **Migration is hand-authored SQL** (`migrate dev` is interactive-only here); apply locally with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`.
- **Test env:** `DATABASE_URL="file:./local-dev.db" npx vitest run <path>`; vitest `globals: false`.
- **Never `git add -A`** — add named files only.
- **NULL means unknown, never not-detected** — no code path may fabricate `'not-detected'` from missing/legacy/malformed data (spec §4, Codex #6 upstream).
- Gate commands (final task): `npx tsc --noEmit` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.
- Branch: `feat/ks4-faq-tristate-inventory` off current `main`.

## File Structure

| File | Role |
|---|---|
| `lib/ada-audit/seo/parse-seo-dom.ts` (modify) | in-page raw FAQ signals (`faqSignals` on `RawPageSeo`) |
| `lib/jobs/handlers/site-audit-page.ts` (modify) | persist `faqSignals` into `detailsJson` |
| `lib/ada-audit/seo/faq-evidence.ts` (create) | pure `deriveFaqEvidence(detailsJson)` — the ONE home of the presence rule + grammar encoder |
| `prisma/schema.prisma` + `prisma/migrations/20260711000000_crawl_page_faq_evidence/migration.sql` (create) | nullable `CrawlPage.faqEvidence` |
| `lib/findings/types.ts` (modify) | `CrawlPageInput.faqEvidence: string \| null` (required) |
| `lib/findings/seo-mapper.ts`, `lib/findings/ada-mapper.ts` (modify) | set `faqEvidence: null` (their sources have no signal) |
| `lib/jobs/handlers/broken-link-verify.ts` (modify) | `ensurePage` default `faqEvidence: null` + per-row derive |
| `lib/keywords/page-inventory.ts` (create) | pure `parseFaqEvidence` (strict grammar) + `buildPageInventory` |

---

### Task 1: In-page FAQ signals in `parseSeoFromDocument`

**Files:**
- Modify: `lib/ada-audit/seo/parse-seo-dom.ts`
- Test: `lib/ada-audit/seo/parse-seo-dom.test.ts`

**Interfaces:**
- Consumes: nothing new (in-body helpers `hiddenAncestor`, `inBoilerplateRegion` already exist inside the function).
- Produces: `RawPageSeo.faqSignals: { heading: boolean; container: boolean; questionHeadings: number }` — Task 2 persists it; Task 3 consumes the persisted shape.

- [ ] **Step 1: Write the failing tests** (append to `parse-seo-dom.test.ts`, using the file's existing `dom(html)` helper):

```ts
describe('faqSignals extraction (KS-4)', () => {
  it('fires heading on a main-content FAQ heading, and counts question headings', () => {
    const r = dom(`
      <main>
        <h2>Frequently Asked Questions</h2>
        <h3>How long is the program?</h3>
        <h3>What does tuition cost?</h3>
      </main>`)
    expect(r.faqSignals.heading).toBe(true)
    expect(r.faqSignals.questionHeadings).toBe(2)
  })

  it('does NOT fire heading for a footer FAQs nav heading (boilerplate guard)', () => {
    const r = dom(`<main><h2>Programs</h2></main><footer><h3>FAQs</h3></footer>`)
    expect(r.faqSignals.heading).toBe(false)
  })

  it('does NOT fire heading inside a hidden block', () => {
    const r = dom(`<main><div style="display:none"><h2>FAQ</h2></div></main>`)
    expect(r.faqSignals.heading).toBe(false)
  })

  it('fires container for a faq-classed section containing a heading', () => {
    const r = dom(`<main><section class="faq-block"><h3>Questions</h3><p>…</p></section></main>`)
    expect(r.faqSignals.container).toBe(true)
  })

  it('fires container when the faq element IS a <details> (self-match, Codex #3)', () => {
    const r = dom(`<main><details class="faq"><summary>How do I apply?</summary><p>…</p></details></main>`)
    expect(r.faqSignals.container).toBe(true)
  })

  it('does NOT fire container for a bare nav faq link', () => {
    const r = dom(`<nav><a class="faq-link" href="/faq">FAQ</a></nav><main><p>Hello</p></main>`)
    expect(r.faqSignals.container).toBe(false)
  })

  it('does NOT fire container for a faq-classed div with no heading or details', () => {
    const r = dom(`<main><div class="faq-teaser"><a href="/faq">See our FAQ</a></div></main>`)
    expect(r.faqSignals.container).toBe(false)
  })

  it('respects the eligible/raw heading caps: a heading-stuffed nav cannot starve content headings', () => {
    const navHeadings = Array.from({ length: 400 }, (_, i) => `<h3>Nav ${i}</h3>`).join('')
    const r = dom(`<nav>${navHeadings}</nav><main><h2>Frequently Asked Questions</h2></main>`)
    expect(r.faqSignals.heading).toBe(true) // nav headings are raw-walked but not eligible
  })

  it('stops at the raw cap of 600 headings', () => {
    // 600 hidden headings exhaust the raw budget before the visible FAQ heading
    const hidden = Array.from({ length: 600 }, (_, i) => `<h3 style="display:none">H ${i}</h3>`).join('')
    const r = dom(`<main>${hidden}<h2>Frequently Asked Questions</h2></main>`)
    expect(r.faqSignals.heading).toBe(false)
  })
})
```

Note: the existing test `'injected source stays SWC-helper-free'` greps the WHOLE `parseSeoFromDocument.toString()` — the new code is automatically covered by it; no edit needed there.

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/parse-seo-dom.test.ts`
Expected: FAIL — `faqSignals` is `undefined` (property missing from return).

- [ ] **Step 3: Implement.** In `lib/ada-audit/seo/parse-seo-dom.ts`:

Add to the `RawPageSeo` interface (after `loginLike: boolean`):

```ts
  // KS-4: raw FAQ signals (tri-state evidence is derived Node-side in
  // lib/ada-audit/seo/faq-evidence.ts — detection proves presence, never absence)
  faqSignals: { heading: boolean; container: boolean; questionHeadings: number }
```

Add inside the function body, after the `loginLike` computation and before the `return`:

```ts
  // KS-4: bounded FAQ signals. Heading pass: inspect up to 300 ELIGIBLE
  // (non-boilerplate, non-hidden) h2/h3/h4, walking at most 600 raw — an
  // eligible-only cap would let a heading-heavy mega-nav starve the content
  // headings this signal depends on (spec Codex #3).
  const FAQ_HEADING_RE = /\bfaqs?\b|frequently asked/i
  let faqHeading = false
  let questionHeadings = 0
  const faqHs = Array.from(doc.querySelectorAll('h2,h3,h4'))
  let faqEligible = 0
  for (let i = 0; i < faqHs.length && i < 600 && faqEligible < 300; i++) {
    const el = faqHs[i]
    if (hiddenAncestor(el) || inBoilerplateRegion(el)) continue
    faqEligible++
    const t = (el.textContent || '').trim()
    if (FAQ_HEADING_RE.test(t)) faqHeading = true
    if (t.endsWith('?')) questionHeadings++
  }
  // Container pass: first 50 faq-ish id/class elements; counts when outside
  // boilerplate/hidden AND (is itself a <details> — querySelector never
  // matches the element itself — or contains a heading/<details> descendant).
  let faqContainer = false
  for (const el of Array.from(doc.querySelectorAll('[id*="faq" i],[class*="faq" i]')).slice(0, 50)) {
    if (hiddenAncestor(el) || inBoilerplateRegion(el)) continue
    if (el.tagName === 'DETAILS' || el.querySelector('h2,h3,h4,h5,h6,details')) { faqContainer = true; break }
  }
```

And add to the returned object literal:

```ts
    faqSignals: { heading: faqHeading, container: faqContainer, questionHeadings },
```

- [ ] **Step 4: Run the full test file, verify all pass** (including the SWC-helper grep test)

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/parse-seo-dom.test.ts`
Expected: PASS (all, including `'injected source stays SWC-helper-free'`).

- [ ] **Step 5: Fix any `RawPageSeo` fixture fallout, then commit.** `npx tsc --noEmit` will flag test fixtures that construct `RawPageSeo` objects (e.g. the `seo()` helper in `lib/jobs/handlers/site-audit-page.test.ts`). Add `faqSignals: { heading: false, container: false, questionHeadings: 0 }` to each flagged fixture. Then:

```bash
npx tsc --noEmit
git checkout -b feat/ks4-faq-tristate-inventory
git add lib/ada-audit/seo/parse-seo-dom.ts lib/ada-audit/seo/parse-seo-dom.test.ts lib/jobs/handlers/site-audit-page.test.ts
git commit -m "feat(ks4): bounded in-page FAQ signals in parseSeoFromDocument"
```

---

### Task 2: Persist `faqSignals` into `HarvestedPageSeo.detailsJson`

**Files:**
- Modify: `lib/jobs/handlers/site-audit-page.ts` (the `persistPageSeo` function, `detailsJson` line ~124)
- Test: `lib/jobs/handlers/site-audit-page.test.ts`

**Interfaces:**
- Consumes: `RawPageSeo.faqSignals` (Task 1).
- Produces: `detailsJson` shape `{ schemaTypes, hreflang, programNames, faqSignals }` — Task 3's `deriveFaqEvidence` parses exactly this.

- [ ] **Step 1: Write the failing test** (append to `site-audit-page.test.ts`, reusing the file's existing `seo()` fixture helper and audit-row setup used by the `persistPageSeo` describe block):

```ts
describe('persistPageSeo — faqSignals (KS-4)', () => {
  it('writes faqSignals into detailsJson', async () => {
    const audit = await prisma.siteAudit.create({ data: { domain: 'faq.test', status: 'running' } })
    await persistPageSeo(audit.id, 'https://faq.test/p', seo({
      faqSignals: { heading: true, container: false, questionHeadings: 4 },
    }))
    const row = await prisma.harvestedPageSeo.findFirst({ where: { siteAuditId: audit.id } })
    const details = JSON.parse(row!.detailsJson!)
    expect(details.faqSignals).toEqual({ heading: true, container: false, questionHeadings: 4 })
  })
})
```

(Adapt the `siteAudit.create` data to match the minimal shape the file's existing tests use — copy the fields from the `'persistPageSeo — content similarity fields'` describe block's setup.)

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-page.test.ts`
Expected: FAIL — `details.faqSignals` is `undefined`.

- [ ] **Step 3: Implement.** In `persistPageSeo`, change the `detailsJson` line to:

```ts
        detailsJson: JSON.stringify({ schemaTypes: seo.schemaTypes, hreflang: seo.hreflang, programNames: seo.programNames, faqSignals: seo.faqSignals }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/site-audit-page.ts lib/jobs/handlers/site-audit-page.test.ts
git commit -m "feat(ks4): persist faqSignals in HarvestedPageSeo.detailsJson"
```

---

### Task 3: Pure `deriveFaqEvidence` helper

**Files:**
- Create: `lib/ada-audit/seo/faq-evidence.ts`
- Test: `lib/ada-audit/seo/faq-evidence.test.ts`

**Interfaces:**
- Consumes: the `detailsJson` string shape from Task 2.
- Produces: `deriveFaqEvidence(detailsJson: string | null): string | null` — returns `'present:<sig,list>'` (canonical order `schema,heading,container,questions`), `'not-detected'`, or `null` (unknown). Task 5 calls it per seoRow.

- [ ] **Step 1: Write the failing tests:**

```ts
// lib/ada-audit/seo/faq-evidence.test.ts
import { describe, it, expect } from 'vitest'
import { deriveFaqEvidence } from './faq-evidence'

const details = (schemaTypes: unknown[], faqSignals: unknown) =>
  JSON.stringify({ schemaTypes, hreflang: [], programNames: [], faqSignals })
const signals = (over: Partial<{ heading: boolean; container: boolean; questionHeadings: number }> = {}) =>
  ({ heading: false, container: false, questionHeadings: 0, ...over })

describe('deriveFaqEvidence', () => {
  it('null / malformed / non-object input -> null (unknown)', () => {
    expect(deriveFaqEvidence(null)).toBeNull()
    expect(deriveFaqEvidence('{broken')).toBeNull()
    expect(deriveFaqEvidence('"just a string"')).toBeNull()
  })

  it('legacy detailsJson without faqSignals -> null, NEVER not-detected', () => {
    expect(deriveFaqEvidence(JSON.stringify({ schemaTypes: ['FAQPage'], hreflang: [] }))).toBeNull()
  })

  it('no signals -> not-detected', () => {
    expect(deriveFaqEvidence(details([], signals()))).toBe('not-detected')
  })

  it('each signal alone, canonical grammar', () => {
    expect(deriveFaqEvidence(details(['FAQPage'], signals()))).toBe('present:schema')
    expect(deriveFaqEvidence(details([], signals({ heading: true })))).toBe('present:heading')
    expect(deriveFaqEvidence(details([], signals({ container: true })))).toBe('present:container')
    expect(deriveFaqEvidence(details([], signals({ questionHeadings: 3 })))).toBe('present:questions')
  })

  it('questionHeadings threshold: 2 is not a signal, 3 is', () => {
    expect(deriveFaqEvidence(details([], signals({ questionHeadings: 2 })))).toBe('not-detected')
    expect(deriveFaqEvidence(details([], signals({ questionHeadings: 3 })))).toBe('present:questions')
  })

  it('schema URI forms count (Codex #2)', () => {
    expect(deriveFaqEvidence(details(['https://schema.org/FAQPage'], signals()))).toBe('present:schema')
    expect(deriveFaqEvidence(details(['http://schema.org/FAQPage'], signals()))).toBe('present:schema')
    expect(deriveFaqEvidence(details(['FaqPage'], signals()))).toBe('not-detected') // case-exact, no fuzzy match
  })

  it('multiple signals emit in canonical order regardless of input', () => {
    expect(deriveFaqEvidence(details(['FAQPage'], signals({ questionHeadings: 5, heading: true }))))
      .toBe('present:schema,heading,questions')
  })

  it('malformed signal values -> null (unknown), NEVER not-detected (plan-Codex #1)', () => {
    // a corrupt shape cannot certify a negative
    expect(deriveFaqEvidence(details([], { heading: 'yes', container: false, questionHeadings: 'many' }))).toBeNull()
    expect(deriveFaqEvidence(details([], { heading: false, container: false, questionHeadings: -1 }))).toBeNull()
    expect(deriveFaqEvidence(JSON.stringify({ faqSignals: 42 }))).toBeNull()
    // missing/malformed schemaTypes with all-false DOM signals -> null too
    // (a lost FAQPage value must not fabricate a negative)
    expect(deriveFaqEvidence(JSON.stringify({ schemaTypes: 'oops', faqSignals: { heading: false, container: false, questionHeadings: 0 } }))).toBeNull()
  })

  it('a VALID positive signal still fires despite malformed neighbors (plan-Codex #1)', () => {
    expect(deriveFaqEvidence(JSON.stringify({ schemaTypes: 'oops', faqSignals: { heading: true, container: false, questionHeadings: 0 } }))).toBe('present:heading')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/faq-evidence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement:**

```ts
// lib/ada-audit/seo/faq-evidence.ts
//
// KS-4 pure tri-state FAQ evidence derivation (spec §5). The injected parser
// only reports raw signals; the presence rule and the grammar encoder live
// HERE, Node-side. Never throws: malformed/missing/legacy input -> null,
// which the CrawlPage column stores as NULL = unknown (detection proves
// presence, never absence — a missing signal must not fabricate a negative).

export const FAQ_SIGNAL_ORDER = ['schema', 'heading', 'container', 'questions'] as const
export type FaqSignal = (typeof FAQ_SIGNAL_ORDER)[number]

// schemaTypes stores verbatim @type values — accept the URI forms too (Codex #2).
const FAQ_SCHEMA_TYPES = new Set(['FAQPage', 'https://schema.org/FAQPage', 'http://schema.org/FAQPage'])

export function deriveFaqEvidence(detailsJson: string | null): string | null {
  if (!detailsJson) return null
  let d: Record<string, unknown>
  try {
    const parsed = JSON.parse(detailsJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    d = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const s = d.faqSignals
  // Legacy row (pre-KS-4 detailsJson) or corrupt shape -> unknown, never not-detected.
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null
  const sig = s as Record<string, unknown>

  // Field validity (plan-Codex #1): a positive fires off any VALID true value,
  // but a NEGATIVE ('not-detected') requires EVERY field — schemaTypes
  // included — to be well-formed. A corrupt shape cannot certify absence.
  const headingValid = sig.heading === true || sig.heading === false
  const containerValid = sig.container === true || sig.container === false
  const qh = sig.questionHeadings
  const qhValid = typeof qh === 'number' && Number.isInteger(qh) && qh >= 0
  const schemaValid = Array.isArray(d.schemaTypes)
  const schemaTypes = schemaValid ? (d.schemaTypes as unknown[]) : []

  const fired: FaqSignal[] = []
  if (schemaTypes.some((t) => typeof t === 'string' && FAQ_SCHEMA_TYPES.has(t))) fired.push('schema')
  if (sig.heading === true) fired.push('heading')
  if (sig.container === true) fired.push('container')
  if (qhValid && qh >= 3) fired.push('questions')
  if (fired.length) return `present:${fired.join(',')}`
  return headingValid && containerValid && qhValid && schemaValid ? 'not-detected' : null
}
```

(Canonical order is guaranteed by push order — the array literal above IS the vocabulary order.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/seo/faq-evidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/seo/faq-evidence.ts lib/ada-audit/seo/faq-evidence.test.ts
git commit -m "feat(ks4): deriveFaqEvidence — tri-state presence rule + grammar encoder"
```

---

### Task 4: `CrawlPage.faqEvidence` column + required `CrawlPageInput` field

**Files:**
- Modify: `prisma/schema.prisma` (CrawlPage model)
- Create: `prisma/migrations/20260711000000_crawl_page_faq_evidence/migration.sql`
- Modify: `lib/findings/types.ts` (CrawlPageInput), `lib/findings/seo-mapper.ts`, `lib/findings/ada-mapper.ts`, `lib/jobs/handlers/broken-link-verify.ts` (ensurePage default only — the derive call is Task 5)
- Test: `lib/findings/writer.test.ts` (+ every test fixture `tsc` flags)

**Interfaces:**
- Consumes: nothing from prior tasks (independent of Tasks 1–3).
- Produces: `CrawlPage.faqEvidence String?` column; `CrawlPageInput.faqEvidence: string | null` (REQUIRED field — every producer must set it). Task 5 writes real values through it.

- [ ] **Step 1: Schema + hand-authored migration.** In `prisma/schema.prisma`, add to `model CrawlPage` after `incompleteCount Int?`:

```prisma
  faqEvidence     String?  // KS-4: 'present:<sig,list>' | 'not-detected'; NULL = unknown (no successful parse / pre-KS-4 run)
```

Create `prisma/migrations/20260711000000_crawl_page_faq_evidence/migration.sql`:

```sql
-- KS-4: per-page tri-state FAQ evidence. NULL = unknown (pre-KS-4 rows stay unknown forever — never backfill).
ALTER TABLE "CrawlPage" ADD COLUMN "faqEvidence" TEXT;
```

Apply + regenerate:

```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate
```

Expected: migration applied, client regenerated.

- [ ] **Step 2: Make the field required.** In `lib/findings/types.ts`, add to `CrawlPageInput` after `incompleteCount: number | null`:

```ts
  faqEvidence: string | null // KS-4 tri-state grammar; null = unknown. REQUIRED so every producer takes a position.
```

- [ ] **Step 3: Fix every producer `tsc` flags** (spec-Codex #1 — the enumeration):

Run: `npx tsc --noEmit` — expect errors in each `CrawlPageInput` construction. Fix:

- `lib/findings/seo-mapper.ts` (page construction ~line 51): add `faqEvidence: null,` (SF uploads carry no FAQ signal — honestly unknown).
- `lib/findings/ada-mapper.ts` (BOTH constructions, ~lines 259 and 356): add `faqEvidence: null,`.
- `lib/jobs/handlers/broken-link-verify.ts` `ensurePage()` default object (~line 436): add `faqEvidence: null` after `adaAuditId: null` — the default carries the unknown state; the scalar merge skips nulls so only a valid derived value (Task 5) overwrites it.
- Every test fixture flagged — expect hits in `writer*.test.ts`, `parity.test.ts`, and the `ensurePage`-consuming mapper tests (`validation-mapper`, `broken-link-mapper`, `onpage-seo-mapper`) if they build typed page objects: add `faqEvidence: null`.

Run `npx tsc --noEmit` again. Expected: clean.

- [ ] **Step 4: Add the writer characterization test** (plan-Codex #2: this is NOT red-green — the writer needs no code change because `writeFindingsRun` passes page objects verbatim into `crawlPage.createMany`, so the test passes as soon as the column + type exist. It characterizes that intentional no-writer-change behavior and guards it against future writer refactors). Append to `lib/findings/writer.test.ts`:

```ts
it('persists CrawlPage.faqEvidence verbatim — writer intentionally needs no change (KS-4)', async () => {
  // Build a minimal bundle exactly like the file's existing round-trip test,
  // with two pages: /a with faqEvidence: 'present:schema', /b with faqEvidence: null.
  // After writeFindingsRun, read both rows back:
  const rows = await prisma.crawlPage.findMany({ where: { runId }, orderBy: { url: 'asc' } })
  expect(rows.map((r) => r.faqEvidence)).toEqual(['present:schema', null])
})
```

(Adapt the bundle construction verbatim from the nearest existing `writeFindingsRun` round-trip test in the same file — same run shape, same cleanup.)

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/writer.test.ts`
Expected: PASS (immediately — that is the point).

- [ ] **Step 5: Run the full findings + handler suites**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings lib/jobs/handlers`
Expected: PASS.

- [ ] **Step 6: Commit — explicit paths only** (plan-Codex #4: NO `git add -u`, which can stage unrelated tracked changes). Run `git status --short`, confirm every modified path is one you touched in this task, then list them all explicitly:

```bash
git add prisma/schema.prisma prisma/migrations/20260711000000_crawl_page_faq_evidence/migration.sql lib/findings/types.ts lib/findings/seo-mapper.ts lib/findings/ada-mapper.ts lib/jobs/handlers/broken-link-verify.ts lib/findings/writer.test.ts <each tsc-flagged fixture file, listed explicitly>
git commit -m "feat(ks4): CrawlPage.faqEvidence column + required CrawlPageInput field"
```

---

### Task 5: Builder integration — derive per row in `runBrokenLinkVerify`

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts`
- Test: `lib/jobs/handlers/broken-link-verify.test.ts`

**Interfaces:**
- Consumes: `deriveFaqEvidence` (Task 3), the `faqEvidence: null` ensurePage default (Task 4).
- Produces: live-scan `CrawlPage` rows with real `faqEvidence` values — `buildPageInventory` (Task 6) reads them via KS-5.

- [ ] **Step 1: Write the failing tests** (append to `broken-link-verify.test.ts`, copying the file's existing harvestedPageSeo-row setup pattern — see its KS-3 programNames tests ~line 200):

```ts
describe('faqEvidence on live-scan CrawlPage rows (KS-4)', () => {
  it('derives present / not-detected / unknown from detailsJson', async () => {
    // three rows on one audit — URLS ARE LOAD-BEARING (plan-Codex #3): the
    // assertion relies on orderBy url asc, so the fixtures MUST be /a, /b, /c:
    // /a: detailsJson with faqSignals {heading:true,...}   -> 'present:heading'
    // /b: detailsJson with all-false faqSignals            -> 'not-detected'
    // /c: legacy detailsJson WITHOUT faqSignals key        -> null (unknown)
    // run the verifier with stub deps, then:
    const pages = await prisma.crawlPage.findMany({ where: { runId: run!.id }, orderBy: { url: 'asc' } })
    expect(pages.map((p) => p.faqEvidence)).toEqual(['present:heading', 'not-detected', null])
  })
})
```

(Write the full setup by copying the nearest existing builder test in the same file: create SiteAudit, three `harvestedPageSeo` rows at urls `https://<domain>/a`, `/b`, `/c` — in that order — whose `detailsJson` values are `JSON.stringify({ schemaTypes: [], hreflang: [], programNames: [], faqSignals: { heading: true, container: false, questionHeadings: 0 } })`, the all-false variant, and `JSON.stringify({ schemaTypes: [], hreflang: [] })`; invoke `runBrokenLinkVerify` with the file's stub `VerifyDeps`; locate the run via `prisma.crawlRun.findFirst({ where: { siteAuditId, tool: 'seo-parser' } })`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL — all three `faqEvidence` values are `null`.

- [ ] **Step 3: Implement.** In `broken-link-verify.ts`:

Add the import:

```ts
import { deriveFaqEvidence } from '@/lib/ada-audit/seo/faq-evidence'
```

In the seoRows materialization loop (`for (const r of seoRows) { … ensurePage(r.url, { … }) }`), add one scalar:

```ts
    ensurePage(r.url, {
      statusCode: r.statusCode, title: r.title, h1: r.h1, metaDescription: r.metaDescription,
      wordCount: r.wordCount, indexable: indexableOf(r) && !r.loginLike,
      inlinks: g?.inlinks ?? null,
      outlinks: g?.outlinks ?? null,
      crawlDepth: g?.crawlDepth ?? null,
      faqEvidence: deriveFaqEvidence(r.detailsJson),
    })
```

(No fail-soft wrapper needed: `deriveFaqEvidence` never throws by contract — Task 3's hostile-shape test proves it. A `null` return leaves the ensurePage default in place = unknown.)

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts
git commit -m "feat(ks4): live-scan builder derives CrawlPage.faqEvidence per harvested row"
```

---

### Task 6: Pure page-inventory builder

**Files:**
- Create: `lib/keywords/page-inventory.ts`
- Test: `lib/keywords/page-inventory.test.ts`

**Interfaces:**
- Consumes: `classifyPageType` (`@/lib/services/pillarAnalysis/pageType`), `PageType` (`@/lib/services/pillarAnalysis/types`), `normalizeFindingUrl` (`@/lib/findings/normalize-url`).
- Produces: `parseFaqEvidence(raw: string | null): { state: FaqEvidenceState; signals: string[] }` and `buildPageInventory(pages: InventoryPageInput[], opts?: { programEntityUrls?: string[] }): PageInventoryEntry[]` — KS-5's assembly seam. No consumer in this PR (ships dark).

- [ ] **Step 1: Write the failing tests:**

```ts
// lib/keywords/page-inventory.test.ts
import { describe, it, expect } from 'vitest'
import { parseFaqEvidence, buildPageInventory, type InventoryPageInput } from './page-inventory'

const page = (over: Partial<InventoryPageInput> = {}): InventoryPageInput => ({
  url: 'https://x.test/p', title: 'T', h1: 'H', wordCount: 500, crawlDepth: 3,
  indexable: true, faqEvidence: null, ...over,
})

describe('parseFaqEvidence (strict grammar, Codex #1)', () => {
  it('decodes the exact forms', () => {
    expect(parseFaqEvidence('not-detected')).toEqual({ state: 'not-detected', signals: [] })
    expect(parseFaqEvidence('present:schema')).toEqual({ state: 'present', signals: ['schema'] })
    expect(parseFaqEvidence('present:schema,heading,container,questions'))
      .toEqual({ state: 'present', signals: ['schema', 'heading', 'container', 'questions'] })
    expect(parseFaqEvidence(null)).toEqual({ state: 'unknown', signals: [] })
  })
  it('rejects everything else to unknown — never guess a negative', () => {
    for (const bad of ['present', 'present:', 'present:bogus', 'present:schema,schema',
      'present:heading,schema', 'PRESENT:schema', 'yes', '', 'not-detected ']) {
      expect(parseFaqEvidence(bad).state).toBe('unknown')
    }
  })
})

describe('buildPageInventory', () => {
  it('filters to indexable === true and sorts by url', () => {
    const out = buildPageInventory([
      page({ url: 'https://x.test/b' }),
      page({ url: 'https://x.test/a' }),
      page({ url: 'https://x.test/c', indexable: false }),
      page({ url: 'https://x.test/d', indexable: null }),
    ])
    expect(out.map((e) => e.url)).toEqual(['https://x.test/a', 'https://x.test/b'])
  })

  it('classifies pageType at read time (slug rules)', () => {
    const out = buildPageInventory([page({ url: 'https://x.test/programs/dental-assisting' })])
    expect(out[0].pageType).toBe('program')
  })

  it('programEntityUrls upgrades ONLY weak classifications (Codex #4)', () => {
    const out = buildPageInventory(
      [
        page({ url: 'https://x.test/dental-assisting', crawlDepth: 5 }),        // unknown -> upgraded
        page({ url: 'https://x.test/blog/course-news', crawlDepth: 5 }),        // explicit blog -> kept
        page({ url: 'https://x.test/shallow-page', crawlDepth: 1 }),            // low-conf nav -> upgraded
      ],
      { programEntityUrls: [
        'https://x.test/dental-assisting',
        'https://x.test/blog/course-news',
        'https://x.test/shallow-page',
      ] },
    )
    const byUrl = Object.fromEntries(out.map((e) => [e.url, e]))
    expect(byUrl['https://x.test/dental-assisting'].pageType).toBe('program')
    expect(byUrl['https://x.test/dental-assisting'].pageTypeConfidence).toBe(0.7)
    expect(byUrl['https://x.test/blog/course-news'].pageType).toBe('blog')
    expect(byUrl['https://x.test/shallow-page'].pageType).toBe('program')
  })

  it('normalizes entity-URL matching and discards malformed entries (Codex #5)', () => {
    const out = buildPageInventory(
      [page({ url: 'https://x.test/hvac', crawlDepth: 9 })],
      { programEntityUrls: ['https://X.TEST/hvac#section', 'not a url'] },
    )
    expect(out[0].pageType).toBe('program')
  })

  it('decodes faqEvidence tri-state incl. corrupt values', () => {
    const out = buildPageInventory([
      page({ url: 'https://x.test/a', faqEvidence: 'present:heading' }),
      page({ url: 'https://x.test/b', faqEvidence: 'not-detected' }),
      page({ url: 'https://x.test/c', faqEvidence: 'garbage' }),
      page({ url: 'https://x.test/d', faqEvidence: null }),
    ])
    expect(out.map((e) => e.faqEvidence)).toEqual(['present', 'not-detected', 'unknown', 'unknown'])
    expect(out[0].faqSignals).toEqual(['heading'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/page-inventory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement:**

```ts
// lib/keywords/page-inventory.ts
//
// KS-4 pure page-inventory builder — KS-5's assembly seam (no consumer in
// this repo yet; ships dark). Input rows are CrawlPage scalars the caller
// already loads from the newest seoIntent live-scan run. pageType is
// computed at READ time (classifier improvements apply retroactively;
// KS-3 program-suggest precedent) with a durable-programEntities upgrade
// for the schema signal that read-time classification loses.

import { classifyPageType } from '@/lib/services/pillarAnalysis/pageType'
import type { PageType } from '@/lib/services/pillarAnalysis/types'
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
import { FAQ_SIGNAL_ORDER } from '@/lib/ada-audit/seo/faq-evidence'

export type FaqEvidenceState = 'present' | 'not-detected' | 'unknown'

export interface InventoryPageInput {
  url: string
  title: string | null
  h1: string | null
  wordCount: number | null
  crawlDepth: number | null
  indexable: boolean | null
  faqEvidence: string | null
}

export interface PageInventoryEntry {
  url: string
  title: string | null
  h1: string | null
  pageType: PageType
  pageTypeConfidence: number
  wordCount: number | null
  faqEvidence: FaqEvidenceState
  faqSignals: string[]
}

/**
 * Strict grammar decode (spec §6, Codex #1): only the exact forms parse —
 * 'not-detected', or 'present:' + a non-empty, duplicate-free,
 * canonically-ordered comma list from the fixed vocabulary. Everything else
 * decodes to 'unknown' — a corrupt stored value must never read as a negative.
 */
export function parseFaqEvidence(raw: string | null): { state: FaqEvidenceState; signals: string[] } {
  if (raw === 'not-detected') return { state: 'not-detected', signals: [] }
  if (raw != null && raw.startsWith('present:')) {
    const sigs = raw.slice('present:'.length).split(',')
    let last = -1
    for (const s of sigs) {
      const i = (FAQ_SIGNAL_ORDER as readonly string[]).indexOf(s)
      if (i === -1 || i <= last) return { state: 'unknown', signals: [] }
      last = i
    }
    if (sigs.length > 0 && sigs[0] !== '') return { state: 'present', signals: sigs }
  }
  return { state: 'unknown', signals: [] }
}

export function buildPageInventory(
  pages: InventoryPageInput[],
  opts?: { programEntityUrls?: string[] },
): PageInventoryEntry[] {
  // Normalize the entity set on OUR side (Codex #5): historical/hand-edited
  // programEntitiesJson can differ by fragment/host case; malformed entries
  // are discarded, never thrown on.
  const entityUrls = new Set<string>()
  for (const u of opts?.programEntityUrls ?? []) {
    try { new URL(u) } catch { continue }
    entityUrls.add(normalizeFindingUrl(u))
  }
  return pages
    .filter((p) => p.indexable === true)
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((p) => {
      let { pageType, pageTypeConfidence } = classifyPageType({ url: p.url, schemaTypes: [], crawlDepth: p.crawlDepth })
      // Upgrade mirrors classifyPageType's own tiebreaker semantics (Codex #4):
      // schema fires only when URL rules yielded nothing definite. With
      // schemaTypes: [] the read-time result is <= 0.4 exactly for the
      // unknown (0.2) and crawl-depth nav fallback (0.4) cases; slug/home
      // classifications (>= 0.85) are never overridden.
      if (pageType !== 'program' && pageTypeConfidence <= 0.4 && entityUrls.has(normalizeFindingUrl(p.url))) {
        pageType = 'program'
        pageTypeConfidence = 0.7 // schema-tier confidence
      }
      const faq = parseFaqEvidence(p.faqEvidence)
      return {
        url: p.url, title: p.title, h1: p.h1, pageType, pageTypeConfidence,
        wordCount: p.wordCount, faqEvidence: faq.state, faqSignals: faq.signals,
      }
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/keywords/page-inventory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/keywords/page-inventory.ts lib/keywords/page-inventory.test.ts
git commit -m "feat(ks4): pure page-inventory builder — strict faqEvidence decode + read-time pageType"
```

---

### Task 7: Full gates + PR

**Files:** none new.

- [ ] **Step 1: Run all three gates**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```

Expected: all green. The build is the REAL SWC gate for Task 1's injected code — a failure here (or a `_type_of`-style helper in the built output) is a Task 1 defect, not a build flake.

- [ ] **Step 2: Push + open the PR**

```bash
git push -u origin feat/ks4-faq-tristate-inventory
gh pr create --title "feat(ks4): FAQ tri-state detection + page inventory (C20 KS-4)" --body "..."
```

PR body: summarize the spec path, the 5 Codex fixes, the migration (additive nullable column — no prod pre-step needed), and that the feature ships dark (consumer = KS-5).

---

## Self-review notes

- Spec coverage: §3 → Task 1; §4 transient → Task 2, durable+producers → Task 4; §5 → Tasks 3+5; §6 → Task 6; §7 is KS-5 wording (no task, by design); §8 test list is distributed across Tasks 1–6.
- Type consistency: `faqSignals` shape `{ heading, container, questionHeadings }` identical in Tasks 1/2/3; `FAQ_SIGNAL_ORDER` exported in Task 3, consumed in Task 6; `faqEvidence: string | null` required field introduced in Task 4, written in Task 5, decoded in Task 6.
- Task 4 before Task 5 is load-bearing (column + ensurePage default must exist before the derive call); Tasks 1–3 are independent of 4 but ordered for narrative flow.
