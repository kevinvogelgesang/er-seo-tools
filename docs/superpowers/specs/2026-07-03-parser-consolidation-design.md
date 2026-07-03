# C7 part 2 — Parser consolidation (declarative bases)

**Status:** design · **Date:** 2026-07-03 · **Author:** roadmap C7, part 2 of 3
**Roadmap source:** `docs/superpowers/nyi/improvement-roadmaps/01-seo-parser.md` Phase 3
**Predecessor:** C7 part 1 (per-file parse reporting, PR #93, merged) ·
**Successor:** C7 part 3 (streaming parse — the memory piece; NOT in scope here)

## Context

The SEO parser has 41 `*.parser.ts` files extending `BaseParser`. The roadmap
(line 25) notes "~20% of parser code is the same find-column → mask → iterate →
accumulate pattern repeated; titles/meta/H1 are structurally identical." This PR
removes that duplication by extracting **two declarative base classes** and
re-expressing the homogeneous parsers as thin config-bearing subclasses.

Kevin decomposed C7 into three independent PRs (isolation → consolidation →
streaming). This is part 2. **Streaming and concurrent parsing are explicitly out
of scope** — the roadmap warns against parallelizing parsing before streaming it
(`01-seo-parser.md` line 111), and part 3 owns that.

## Goals

1. Extract `LengthValidatorParser` — a config-driven base absorbing the four
   structurally-identical on-page-element parsers: `pageTitles`,
   `metaDescription`, `h1`, `h2`.
2. Extract `ResourceFileParser` — a config-driven base absorbing the three
   structurally-identical static-resource parsers: `css`, `javascript`, `pdf`.
3. Preserve every public contract so the refactor is invisible to consumers.

## Non-goals

- **No behavior change.** `parse()` output must be deep-equal to today's for
  identical input, including issue array order, `stats` key insertion order,
  URL-list caps, thresholds, severities, and description strings. This is a pure
  refactor.
- **No streaming, no concurrency, no memory work** (part 3).
- **No findings-schema, aggregator, scoring, or priority changes.**
- **No consolidation of `images` or `links`** (see "Scope refinement" below).
- **No config *tables* / DB / migration** — config is in-code object literals.
- **No expansion of the parser fleet** and no new issue types.

## Scope refinement — why images & links stay bespoke

The roadmap names `ResourceParser (images/links/CSS/JS/PDF)`, but the code shows
only `css`/`javascript`/`pdf` are genuinely homogeneous (a single large-file
check + a broken-file check). The other two do not fit:

- **`images.parser.ts`** has four distinct checks (alt-text with a coverage-driven
  severity, two-tier size classification, broken, missing-dimensions) plus an
  `alt_coverage_percent` stat. Its output shape (`total_images`, populated
  `stats`) diverges from the file-resource shape.
- **`links.parser.ts`** defines *two* unrelated classes — `LinksIssuesParser`
  (a single `links_quality_issue` over `links_*` files) and `ExternalLinksParser`
  (`broken_external_links` over `all_outlinks`) — neither of which is the
  size/broken pattern. `LinksIssuesParser` also returns `stats` conditionally
  (`Object.keys(stats).length > 0 ? stats : undefined`), unlike css/js/pdf which
  always return a `stats` object.

Folding these in would force the base to carry many optional check-types and
special-cases — a leaky abstraction that *raises* parity risk for zero
maintenance win. They remain as-is. **Consolidated total: 7 parsers** (4 + 3).

## Mechanism — thin subclasses over shared bases

Each parser stays a **named class, one file**, reduced to static keys + a config
literal. Example end state:

```ts
export class PageTitlesParser extends LengthValidatorParser {
  static parserKey = 'pagetitles';
  static filenamePattern = ['page_titles_all', 'page_titles'];
  protected static config: LengthValidatorConfig = { /* … */ };
}
```

Why thin subclasses (not a config registry that deletes the classes):

- `PARSER_MAP` and `findParserForFile` (`lib/parsers/index.ts`) reference these
  class names + their `static parserKey` / `filenamePattern` / `matchesFile` —
  **untouched**.
- Every `static parserKey` stays an **explicit per-subclass string literal**.
  This is the 2026-06-02 minification landmine (SWC minifies class names in prod;
  `parser-key.test.ts` guards it). The base MUST NOT derive a key from the class
  name and MUST NOT provide a non-empty default `parserKey`.
- Existing per-parser test suites keep passing, but they are **not** sufficient
  parity proof on their own (see Testing — 4 of the 7 target parsers have no test
  file at all). The parity net is a **golden-output test suite written first**
  (below).

**TypeScript note:** TS has no "abstract static" that a base method can read
generically. The base reads its subclass config via a `protected abstract`
instance member (or a static resolved through `this.constructor`), not an
abstract static field. Pin the exact accessor pattern in the plan.

File count stays ~the same; the ~989 duplicated LOC of `parse()` bodies collapse
into two bases (~120 LOC each) plus seven ~12-line configs. The win is
de-duplication, not file count.

## `LengthValidatorParser` — design

**Base-owned, identical across all four parsers:**

- Empty guard: `if (this.isEmpty) return {};`
- Column resolution via `findColumn` from config candidate lists.
- Mask: `const m = this.getIndexableHtmlMask(); const mask = m.some(Boolean) ? m
  : this.getSeoRelevantMask(addressCol);`
- `total_pages = countMask(mask)`, `excluded_urls = this.length - total_pages`.
- Return `{ total_pages, excluded_urls, issues }` (keys in that order).
- Checks run in this **fixed order**, each emitted only when its column exists
  (and its config block is present): **missing → length(short, long) →
  duplicate → multiple**. URL caps: missing/short/long/multiple push up to **20**
  URLs; duplicate builds a per-value URL map capped at **50** and emits the top
  **10** groups (`slice(0,10)`, sorted by count desc).

**Config shape:**

```ts
type Severity = 'critical' | 'warning' | 'notice';

interface LengthValidatorConfig {
  valueColumn: string[];      // e.g. ['Title 1','Title'] — the primary value column
  lengthColumn?: string[];    // present ⇒ run length check
  secondColumn?: string[];    // present ⇒ run "multiple" check (e.g. ['Title 2'])
  missing: { type: string; severity: Severity; label: string };
  length?: { min: number; max: number; noun: string;
             shortType: string; shortSeverity: Severity;
             longType: string;  longSeverity: Severity };
  duplicate?: { type: string; severity: Severity;
                label: string; groupValueKey: string; groupValueSlice: number };
  multiple?: { type: string; severity: Severity; label: string };
}
```

**Description templates owned by the base** (regular across members):

- missing: `` `${count} pages missing ${label}` `` — labels: `title tags` /
  `meta descriptions` / `H1 headings` / `H2 headings`.
- short: `` `${count} pages with ${noun} under ${min} characters` ``,
  `threshold: `< ${min} chars``. long: `` `${count} pages with ${noun} over
  ${max} characters` ``, `threshold: `> ${max} chars``. nouns: `titles` /
  `meta descriptions`.
- duplicate: `` `${count} groups of pages with duplicate ${label}` ``; each group
  is `{ [groupValueKey]: value.slice(0, groupValueSlice), count, urls }`.
  groupValueKey/slice: `title`/100, `meta_description`/200, `h1`/100.
- multiple: `` `${count} pages with multiple ${label}` `` — labels:
  `title tags` / `H1 headings`.

**Per-parser config (verified against current code):**

| parser | valueColumn | lengthColumn | secondColumn | missing (type/sev) | length (min/max, short-sev/long-sev) | duplicate (type/sev, key/slice) | multiple (type/sev) |
|---|---|---|---|---|---|---|---|
| pageTitles | Title 1, Title | Title 1 Length, Title Length, Length | Title 2 | missing_title / critical | 30 / 60, warning / notice | duplicate_title / warning, title / 100 | multiple_titles / warning |
| metaDescription | Meta Description 1, Meta Description | Meta Description 1 Length, Length | — | missing_meta_description / warning | 70 / 160, notice / notice | duplicate_meta_description / notice, meta_description / 200 | — |
| h1 | H1-1, H1 | — | H1-2 | missing_h1 / warning | — | duplicate_h1 / notice, h1 / 100 | multiple_h1 / warning |
| h2 | H2-1, H2 | — | — | missing_h2 / notice | — | — | — |

(H1's current order is missing → duplicate → multiple, i.e. no length block —
the fixed check order already produces this when `length` is absent.)

## `ResourceFileParser` — design

**Base-owned, identical across css/js/pdf:**

- Empty guard: `if (this.isEmpty) return {};`
- Resolve `addressCol`, `sizeCol` (`['Size (Bytes)','Size','File Size']`),
  `statusCol` (`['Status Code','Status']`).
- Build `stats = {}`; run **large-file** check then **broken-file** check, in
  that order, each gated on its column. URL caps: **30** for both.
- large: count rows with `size > threshold`; set `stats[largeStatKey]`; emit issue
  when count > 0. broken: count rows with `status >= 400 && status < 600`; set
  `stats[brokenStatKey]`; emit issue when count > 0.
- Return `{ [totalKey]: this.length, stats, issues }` — `stats` is **always
  present** (may be `{}`), matching css/js/pdf today.

**Config shape** (descriptions are irregular across members, so they are explicit
builders — only three members, no duplication concern):

```ts
interface ResourceFileConfig {
  totalKey: string;                          // total_css_files | total_js_files | total_pdfs
  large:  { threshold: number; type: string; severity: Severity;
            statKey: string; description: (count: number) => string };
  broken: { type: string; severity: Severity;
            statKey: string; description: (count: number) => string };
}
```

**Per-parser config (verified against current code):**

| parser | totalKey | large: threshold / type / sev / statKey / desc | broken: type / sev / statKey / desc |
|---|---|---|---|
| css | total_css_files | 100KB / large_css_files / notice / large_css_files / `N large CSS files (> 100KB)` | broken_css / warning / broken_css / `N broken CSS files` |
| javascript | total_js_files | 100KB / large_js_files / warning / large_js_files / `N large JavaScript files (> 100KB)` | broken_js / critical / broken_js / `N broken JavaScript files` |
| pdf | total_pdfs | 5MB / large_pdfs / notice / large_pdfs / `N large PDFs (> 5MB)` | broken_pdfs / warning / broken_pdfs / `N broken PDF links` |

(`type` and `statKey` for the large check are identically-named in all three;
kept as separate config fields for clarity, both required.)

## Files

- **New:** `lib/parsers/seoElements/length-validator.base.ts`,
  `lib/parsers/resources/resource-file.base.ts` (+ their unit test files).
- **Rewritten (thin):** `seoElements/{pageTitles,metaDescription,h1,h2}.parser.ts`,
  `resources/{css,javascript,pdf}.parser.ts`.
- **New test files:** golden-output suites for all seven target parsers,
  including the four that have none today (`h2`, `css`, `javascript`, `pdf`).
- **Unchanged:** `base.parser.ts`, `index.ts` (PARSER_MAP/registration),
  `images.parser.ts`, `links.parser.ts`, all other parsers, the aggregator, and
  the existing partial `*.parser.test.ts` (kept, but not the parity guarantee).

## Testing

**Coverage reality (verified):** only `pageTitles`, `metaDescription`, `h1`,
`images`, `links` have `*.parser.test.ts` files — and those assert *selected*
fields, not full output. **`h2`, `css`, `javascript`, `pdf` have NO test file at
all.** So "existing tests pass = parity" is false for 4 of the 7 target parsers.
The plan MUST close this before touching implementation.

1. **Golden-output parity suite (primary, written FIRST, TDD order):** for **all
   seven** target parsers, add deep-equal (`toEqual(...)`) tests against
   representative CSV fixtures, capturing the *current* implementation's exact
   output as the golden baseline. Written and green against today's code **before**
   the base classes exist; they must stay green after the refactor. Deep-equal
   covers issue-array order, every description string, thresholds, severities, URL
   caps, duplicate group value-key/slice, and `stats` key presence + insertion
   order. Required cases:
   - Full mixed output for `pageTitles`, `metaDescription`, `h1` (missing +
     short/long length + duplicate + multiple where applicable).
   - Missing-only shape for `h2`.
   - `css`/`javascript`/`pdf` with large + broken + normal rows together.
   - Resource cases with **only** `sizeCol`, **only** `statusCol`, and **neither**
     (empty `stats: {}` still returned for a non-empty CSV; `{}` for an empty CSV
     via the empty guard).
   - Length-parser mask fallback (no indexable rows → seo-relevant mask).
   - The short-length boundary: `length < min && length > 0` must NOT count
     `length === 0` as "too short" (both title and meta rely on this today).
2. **New base unit tests:** cover config-driven branches of each base directly
   (the same edge cases, exercised through the base rather than a subclass).
3. **`parser-key.test.ts` unchanged** — guards the explicit-literal `parserKey`
   invariant for the rewritten classes; must stay green.
4. Full gate: `npm run lint` + `npm test` + `npm run build`.

The golden suite is the deliverable that makes this refactor safe; the existing
partial tests are kept but are not the parity guarantee.

## Risks & mitigations

- **Silent behavior drift** → the golden-output parity suite (written first,
  deep-equal, all 7 parsers) is the byte-level net; the thin-subclass mechanism
  keeps class names/registration stable so those tests apply unchanged.
- **Minification regression** → no name-derived keys; per-subclass literal
  `parserKey`; `parser-key.test.ts` enforces it; verify the parser buckets in the
  post-deploy build check.
- **Check-order or stats-key-order drift** → order is pinned in the base and in
  this spec; deep-equal tests catch reordering.
- **Config typo (wrong threshold/severity/string)** → the corresponding existing
  test fails; this is the whole point of keeping them.

## Prod verification

Code-only, no migration/env/middleware change. After deploy: upload a real SF
crawl for a **client/staging** site that includes page-titles, meta, H1, H2, CSS,
JS, and PDF exports; confirm the SEO report's on-page-element and resource issues
render identically to a pre-refactor run of the same crawl (same counts,
severities, groups). A pre-C7 archived session must still render.
