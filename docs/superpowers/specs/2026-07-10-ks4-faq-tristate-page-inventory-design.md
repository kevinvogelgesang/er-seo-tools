# KS-4 — FAQ tri-state detection + page inventory — Design

**Date:** 2026-07-10 · **Umbrella:** `2026-07-10-keyword-strategy-capability-design.md` §4 KS-4 (G5, G6) + Codex #6
**Depends on:** C6 live-scan builder (shipped), KS-3 (`programEntitiesJson`, pillar `classifyPageType` precedent — shipped #148)
**Consumer:** KS-5 (client-scoped keyword-strategy export). KS-4 itself ships **dark** — storage + a pure builder, no UI, no export surface (KS-2 precedent).

## 1. Problem

The keyword-strategy workflow's §8 candidate selection needs "only pages that
lack a FAQ" and §7's duplicate screening needs a per-page inventory
(url/title/h1/pageType/wordCount) from the newest live scan. Today neither
exists: `parseSeoFromDocument` extracts schema `@type`s (so JSON-LD `FAQPage`
is *observable* transiently) but nothing durable records FAQ presence per page,
and there is no assembled page inventory — KS-5 would have to re-derive
everything from raw `CrawlPage` rows with no FAQ signal at all.

The epistemics are the hard part (umbrella Codex #6): detection can prove
**presence**, never absence. A page whose parse failed, that was never
harvested, or that predates KS-4 must read as **unknown** — distinct from
"parsed clean and found nothing" (**not-detected**). A boolean column destroys
that distinction permanently in historical exports.

## 2. Goals / Non-goals

**Goals**
- Per-page FAQ evidence, tri-state at read time: `present` / `not-detected` /
  `unknown`, with signal provenance (which detector fired) preserved.
- Detection = JSON-LD `FAQPage` (already extracted) + a bounded rendered-DOM
  heuristic (faq-ish headings / accordion containers / question-mark headings).
- Durable per-page persistence on `CrawlPage` so historical exports distinguish
  `unknown` from `not-detected` forever.
- A pure page-inventory builder (`buildPageInventory`) KS-5 calls with rows it
  already loads: url/title/h1/pageType/wordCount/faqEvidence for indexable
  pages.
- Injected-code contract held absolutely (`cc8d1c1` class): self-contained, no
  module scope, no `typeof` (use `String(v) === v` — KS-3 discipline), verified
  by both the `toString()` keyword grep test AND a real `next build`.

**Non-goals**
- No Finding, no score change, no UI section, no export wording shipped here
  (the hedged phrasing is *proposed* in §7 and goes live in KS-5's memo).
- No re-detection on historical runs (they stay `unknown` — never backfill).
- No microdata/RDFa FAQ detection (JSON-LD only, matching the parser's
  standing MVP scope).
- No per-page schema-types durable persistence (see §6 pageType decision).

## 3. In-page detection (decision: three bounded DOM signals + Node-side schema check)

### What runs in-page (`parse-seo-dom.ts` addition)

`RawPageSeo` gains one field:

```ts
faqSignals: {
  heading: boolean          // a non-boilerplate h2/h3/h4 matches /\bfaqs?\b|frequently asked/i
  container: boolean        // a non-boilerplate [id*="faq" i]/[class*="faq" i] element that CONTAINS a heading or <details>
  questionHeadings: number  // count of non-boilerplate h2/h3/h4 whose trimmed text ends with '?'
}
```

The JSON-LD `FAQPage` signal needs **zero new in-page code** — `schemaTypes`
is already collected and persisted; the schema check happens Node-side in the
builder (§5).

**Bounds and false-positive guards:**
- Heading scan: `querySelectorAll('h2,h3,h4')`, iterate until **300 eligible**
  headings have been inspected or **600 raw** headings walked, whichever
  first (Codex #3: a boilerplate-only cap would let a heading-heavy mega-nav
  consume the whole budget and starve the content headings this
  negative-consumed signal depends on). A heading is *eligible* when neither
  `inBoilerplateRegion(...)` nor `hiddenAncestor(...)` excludes it — both
  helpers already exist inside the function body (injected-contract-safe
  reuse). The boilerplate guard kills the classic false positive: a footer
  "FAQs" nav heading on every page of the site.
- Container scan: `querySelectorAll('[id*="faq" i],[class*="faq" i]')`,
  inspect at most the first **50** matches. A match counts only if it is
  outside boilerplate/hidden regions AND (it **is itself a `<details>`** —
  Codex #3: `<details class="faq">` is a common accordion shape and
  `querySelector` never matches the element itself — OR contains at least one
  `h2–h6` or `<details>` descendant). A bare `<a class="faq-link">` in a nav
  never fires.
- Question-heading count: piggybacks on the same heading scan (one pass, two
  outputs, same eligibility + caps); a heading counts when its trimmed text
  ends with `?`.

**Injected-contract compliance:** all new code lives inside
`parseSeoFromDocument`'s body; string checks use `.textContent`/regex on
values already known to be strings (DOM APIs return strings or null — no
`typeof` needed anywhere); no new module-scope references; caps are numeric
literals declared in-body. Verified at es2017 by the existing
`toString()`-injection test extended with the new keywords, plus the real
build gate.

### Presence rule (Node-side, §5)

`present` when **any** of: JSON-LD `FAQPage` in the page's `schemaTypes` ·
`heading` · `container` · `questionHeadings >= 3`.

The schema check accepts the URI forms too (Codex #2): `'FAQPage'`,
`'https://schema.org/FAQPage'`, `'http://schema.org/FAQPage'` — `schemaTypes`
stores verbatim `@type` values and URI-form JSON-LD is legal; an exact-string
check would turn real markup into a false `not-detected`, exactly the error
this detector is biased against.

**Bias rationale:** the workflow consumes the *negative* ("pages that lack a
FAQ" → recommend building one). A false `present` merely skips a candidate
(safe); a false `not-detected` makes the memo recommend an FAQ the page
already has (embarrassing, client-facing). So detection is tuned for recall on
`present` — generous signals, including the standalone `questionHeadings >= 3`
tier — and every `not-detected` is phrased hedged (§7).

## 4. Storage shape (decision: nullable `CrawlPage.faqEvidence` string with signal grammar)

### Transient (`HarvestedPageSeo`) — rides `detailsJson`, no migration

`persistPageSeo` folds the raw signals into the existing bounded
`detailsJson` blob: `{ schemaTypes, hreflang, programNames, faqSignals }`.
The transient table's schema is untouched (same trick as KS-3's
`programNames`). The builder already selects `detailsJson`.

### Durable (`CrawlPage`) — one new nullable column

```prisma
faqEvidence String?  // 'present:<sig>[,<sig>]' | 'not-detected' ; NULL = unknown (no successful parse / pre-KS-4 run)
```

Value grammar (compact, prefix-queryable, human-readable in CSV exports):
- `present:schema` / `present:heading,questions` / `present:schema,container` —
  the comma list is the fired signals, from the fixed vocabulary
  `schema | heading | container | questions`, in that canonical order.
- `not-detected` — parse succeeded, zero signals fired.
- `NULL` — **unknown**: the page had no `HarvestedPageSeo` row (error page,
  non-HTML, redirect, non-2xx — the persist is fenced to successful settles),
  or the run predates KS-4, or the row predates the signal (legacy
  `detailsJson` without `faqSignals` also maps to NULL, not `not-detected` —
  a mid-deploy audit must not fabricate a negative).

**Why a string with grammar, not a JSON column or bare enum:** the tri-state +
provenance fits one small string; a `faqEvidenceJson` column would need
parsing at every read for no added information; a bare
`present|not-detected` enum loses the provenance that §7's phrasing and
future tuning need ("detected via schema" is much stronger than "3 headings
end in question marks"). Alternative considered and rejected: two columns
(enum + signals JSON) — more schema for the same bits.

`CrawlPageInput` (`lib/findings/types.ts`) gains **required**
`faqEvidence: string | null` so `tsc` forces every producer to take a
position. Producer inventory (Codex #1 — enumerate them all, including test
fixtures typed as `CrawlPageInput`): `seo-mapper.ts` and `ada-mapper.ts` set
`null` (their sources have no FAQ signal — SF uploads and axe runs are
`unknown`, honestly); `broken-link-verify.ts`'s `ensurePage()` **default
object** gets `faqEvidence: null` explicitly (its scalar merge skips nulls,
so the default carries the unknown state and only a valid derived value
overwrites it); the live-scan builder computes the real value per row.
`writer.ts` threads the field through its chunked `createMany`.

**Migration:** `20260711…_crawl_page_faq_evidence` — a single additive
`ALTER TABLE "CrawlPage" ADD COLUMN "faqEvidence" TEXT;` (SQLite-safe,
hand-authored per house procedure).

## 5. Builder integration (rides the existing page-scalars path)

In `runBrokenLinkVerify` (the single live-scan run builder), alongside the
existing per-row `detailsJson` parses:

1. Parse `faqSignals` from each row's `detailsJson` (tolerant: missing/
   malformed → `null` → the page's `faqEvidence` stays NULL/unknown).
2. Parse `schemaTypes` from the same blob; `schema` signal =
   `schemaTypes` contains `'FAQPage'` (exact string, the parser stores
   verbatim `@type` values).
3. Derive the grammar string via a small pure helper
   `deriveFaqEvidence(signals, schemaTypes): string | null` in
   `lib/ada-audit/seo/faq-evidence.ts` (pure, unit-tested in isolation, also
   the single place the §3 presence rule lives).
4. Pass it into the existing `ensurePage(r.url, { …, faqEvidence })` scalar
   materialization loop — no new write path, no new query. Note
   `ensurePage`'s merge skips `null` scalars, which is exactly right: NULL
   column default = unknown.

Fail-soft: `deriveFaqEvidence` never throws (malformed input → `null`); a
faq derivation problem can never fail the run write.

Both full audits and `seoOnly` render-only audits get this for free — both
paths run the same harvest evaluate and the same builder.

## 6. Page inventory (decision: pure builder now, pageType computed at read time)

New pure module `lib/keywords/page-inventory.ts` (KS-5's assembly seam —
shipping it now means KS-5 consumes a tested contract instead of re-deriving
one):

```ts
export type FaqEvidenceState = 'present' | 'not-detected' | 'unknown'

export interface InventoryPageInput {   // shape of a CrawlPage row KS-5 already loads
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
  pageType: PageType               // pillar classifier vocabulary
  pageTypeConfidence: number
  wordCount: number | null
  faqEvidence: FaqEvidenceState    // decoded tri-state
  faqSignals: string[]             // parsed from the grammar; [] unless present
}

export function parseFaqEvidence(raw: string | null): { state: FaqEvidenceState; signals: string[] }
export function buildPageInventory(
  pages: InventoryPageInput[],
  opts?: { programEntityUrls?: string[] },  // from CrawlRun.programEntitiesJson
): PageInventoryEntry[]
```

- **Filter:** `indexable === true` only (the umbrella's "indexable pages";
  matches the aggregation set every on-page consumer uses). Deterministic
  `url` sort. No cap here — the run itself is bounded (≤1000 pages); KS-5
  decides export-payload caps.
- **pageType at read time, not persisted** (decision): calls
  `classifyPageType({ url, schemaTypes: [], crawlDepth })` — the exact KS-3
  `program-suggest` precedent. Rationale: the classifier improves over time
  and read-time compute picks that up; persisting would fossilize today's
  regexes into historical rows. Cost: the schema tiebreaker is unavailable
  (per-page schemaTypes are transient). Mitigation: callers pass
  `programEntityUrls` from the run's **durable** `programEntitiesJson`, and
  an inventory page whose URL appears there is upgraded to
  `pageType: 'program'` (confidence 0.7 — schema-tier) **only when the
  classifier didn't already produce a definite slug/home classification**
  (Codex #4 — the upgrade mirrors `classifyPageType`'s own tiebreaker
  semantics, where schema fires only when URL rules yield nothing clear):
  upgrade applies iff the read-time result is `unknown` or the low-confidence
  crawl-depth `nav` fallback (`pageTypeConfidence <= 0.4`); explicit `blog`/
  `nav`/`location`/`home` slug classifications are never overridden — a
  `/blog/...` post that happens to embed a Course entity stays `blog`.
  Alternative considered: persist a `pageType` column written by the builder
  (better-informed at write time, schema in hand) — rejected for
  fossilization + a second column + KS-3 already establishing the read-time
  pattern.
- **URL matching for the upgrade is normalized on both sides** (Codex #5):
  the builder builds the `programEntityUrls` set through
  `normalizeFindingUrl` and normalizes each inventory page URL before
  lookup — fresh rows already match (both paths store normalized audited
  URLs) but historical/hand-edited `programEntitiesJson` can differ by
  trailing slash or host casing; malformed entity URLs are discarded, never
  thrown on.
- `parseFaqEvidence` is exported separately so KS-5's memo wording and any
  future CSV column can decode consistently. **Strict grammar** (Codex #1):
  only the exact forms decode — `not-detected`, or `present:` followed by a
  non-empty, duplicate-free, canonically-ordered comma list drawn from the
  fixed vocabulary. Everything else — bare `present`, empty `present:`,
  unknown or duplicated signals, noncanonical order, arbitrary strings —
  decodes to `unknown` (never guess a negative from a corrupt value).

**Run resolution stays out:** "newest seoIntent live-scan run for this
client" is KS-5's query (it owns the export assembly and the client scope).
KS-4(b) is the pure builder + the durable column feeding it.

## 7. Export phrasing (proposed default for Kevin's Q7 — goes live in KS-5)

- `present` → "FAQ detected (schema markup)" / "FAQ detected (page
  structure)" depending on whether `schema` is among the signals.
- `not-detected` → **"no FAQ detected — verify before recommending"** — never
  "confirmed no FAQ", never a bare "no FAQ".
- `unknown` → "not analyzed" — pages that error, historical runs, non-HTML.

This is the hedged default the umbrella flags for Kevin's Q7; it ships as
KS-5 memo wording and Kevin can override there. KS-4 only guarantees the data
can express the distinction.

## 8. Testing

- `parse-seo-dom.test.ts`: jsdom fixtures — faq heading fires / footer-nav
  faq heading does NOT (boilerplate guard) / hidden faq block does NOT /
  `[class*=faq]` container with a heading fires / **`<details class="faq">`
  self-match fires (Codex #3)** / bare `a.faq-link` does NOT /
  question-heading counting / eligible-vs-raw caps respected on a page whose
  nav holds hundreds of headings; extend the injected-`toString()` grep test
  with the new code (no `_type_of`, no escaping helper at es2017).
- `faq-evidence.test.ts`: presence rule truth table (each signal alone,
  `questionHeadings` 2 vs 3, schema match incl. **URI forms
  `https://schema.org/FAQPage` / `http://…` (Codex #2)**), grammar canonical
  order, malformed/missing input → `null`.
- `site-audit-page.test.ts`: `persistPageSeo` writes `faqSignals` into
  `detailsJson`.
- `broken-link-verify` builder test: a seoRow with signals → CrawlPage row
  with `present:…`; signals-empty row → `not-detected`; legacy `detailsJson`
  (no `faqSignals` key) → NULL.
- `page-inventory.test.ts`: indexable filter, sort, strict-grammar decode
  (bare `present`, `present:`, duplicate/unknown/misordered signals, corrupt
  strings → `unknown`), programEntityUrls upgrade fires on `unknown` +
  low-confidence `nav`, does NOT override explicit `blog`/`nav`/`location`
  slug classifications (Codex #4), URL-normalization matching incl.
  trailing-slash/case variants + malformed entity URLs discarded (Codex #5),
  stable output.
- Mapper/type compile coverage: `seo-mapper`/`ada-mapper` set `faqEvidence:
  null` (tsc-enforced by the required field).

Gates: `npx tsc --noEmit` + `DATABASE_URL="file:./local-dev.db" npm test` +
`npm run build` (the build IS the SWC gate for the injected code).

## 9. Out of scope / deferred

- Memo/export wording + the krt_-v2 payload (KS-5).
- Any UI surface for FAQ evidence (could later join `OnPageSeoSection`; not
  needed for the workflow).
- Historical backfill / re-scan prompting.
- Microdata/RDFa FAQ markup; `<details>`-only accordion detection without a
  faq-ish id/class or heading (revisit only with false-negative evidence).
