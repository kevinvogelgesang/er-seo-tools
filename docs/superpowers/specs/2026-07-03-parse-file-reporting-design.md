# Per-file parse reporting (C7 Phase 3, part 1 of 3) — Design

**Date:** 2026-07-03
**Status:** spec
**Roadmap item:** C7 (parser consolidation + streaming parse + per-file failure
isolation), decomposed into three independent PRs. This is **part 1 of 3**:
*failure-isolation surfacing*. Parts 2 (consolidation) and 3 (streaming) follow
as separate spec→plan→PR cycles. Ordering rationale: isolation-surfacing is the
cheapest, lowest-risk, zero-dependency piece and ships an analyst-facing win
first.

---

## Problem

Per-file failure **isolation already works**. `app/api/parse/[sessionId]/route.ts`
wraps each uploaded file in a `try/catch` inside `parseFile`, pushes failures
into a local `errors: string[]`, and returns `null` so a single corrupt CSV never
fails the whole parse (the session only goes to `error` status if the *whole*
parse throws — e.g. a corrupt file manifest or zero files).

The gap is **visibility**:

1. Collected errors are written to `result.parsing_errors` (a `string[]`) and
   then **never rendered anywhere** — dead data (grep-confirmed: the only writer
   is the parse route; there are no readers in `app/`, `components/`, or `lib/`).
2. CSVs that match **no parser** return `null` silently. `.txt` files return
   `null` silently. The analyst has no signal that an uploaded file was ignored.
3. **Worst case:** a *present-but-corrupt core export* (e.g. `internal_all.csv`)
   throws inside its parser, is isolated into `errors`, and the parse completes
   with a **degraded result and a misleading health score** — with zero visible
   warning. The pre-parse gate (`missingCoreExports`) only catches *missing* core
   exports, not *present-but-corrupt* ones.

## Goal

Give analysts one clear per-file outcome report on the SEO parser results page,
with a prominent signal when a **core** export failed to parse (because that
silently corrupts the score).

Non-goal: changing *isolation* behavior. Individual file failures already do not
fail the session; this PR does not change that. This PR is purely about
**structuring** the per-file outcomes and **surfacing** them.

## Design

### 1. Data model — structured per-file outcomes

Today the parse loop produces:
- `filesProcessed: string[]` (successful files, on the aggregator) → surfaced as
  `metadata.files_processed`.
- `parsers_used: string[]` → `metadata.parsers_used`.
- `errors: string[]` → `result.parsing_errors` (unrendered).

Replace the loose `errors: string[]` with a **structured report — exactly one
entry per manifest file**:

```ts
// lib/types/index.ts (extend AggregatedResult.metadata)
export type FileReportStatus = 'parsed' | 'failed' | 'unmatched' | 'skipped';
export type FileReportSeverity = 'core' | 'normal' | 'info';

export interface FileReport {
  filename: string;
  status: FileReportStatus;
  /** parser key, present when status === 'parsed' */
  parser?: string;
  /** failure message, present when status === 'failed' */
  error?: string;
  /**
   * 'core'   → a failed file whose name maps to a tier:'core' expected export
   * 'normal' → any other failed file
   * 'info'   → unmatched / skipped (never alarming)
   */
  severity: FileReportSeverity;
}
```

Taxonomy (mutually exclusive; one per manifest file):

| status | condition (in `parseFile`) | severity |
|---|---|---|
| `parsed` | matched a parser and `parser.parse()` succeeded | `info` (records `parser`) |
| `failed` | file-not-found, read error, or `parse()`/constructor threw | `core` if `isCoreExport(filename)`, else `normal` |
| `unmatched` | a `.csv` that `findParserForFile` returned `null` for | `info` |
| `skipped` | `.txt` or any non-`.csv` extension | `info` |

`parsed` uses `info` severity (it is not a problem); severity is only meaningful
for surfacing `failed` files loudly. Keeping a single `severity` field (rather
than a separate boolean) keeps the UI switch simple.

### 2. Core-export severity — reuse the existing source of truth

Core-ness is derived from the **existing pure** `matchExpectedExports()` /
`EXPECTED_EXPORTS` table in `lib/parsers/expected-exports.ts` (which already
classifies each expected export as `tier: 'core' | 'recommended' | 'optional'`
and is already client-safe / imported by `UploadChecklist`). Add a small pure
helper:

```ts
// lib/parsers/expected-exports.ts
/** True when the filename matches a tier:'core' expected export. */
export function isCoreExport(filename: string): boolean {
  return matchExpectedExports([filename]).some(
    (c) => c.present && c.export.tier === 'core'
  );
}
```

No new taxonomy, no duplicated filename patterns.

### 3. Parse route changes (`app/api/parse/[sessionId]/route.ts`)

- `parseFile` returns a `FileReport` for **every** manifest file (instead of
  `ParseSuccess | null` + a side-channel `errors` array). The `.txt`/non-csv
  early-return becomes a `skipped` report; the no-parser branch becomes
  `unmatched`; the read/parse failures become `failed` with computed severity;
  the success path becomes `parsed`.
- The successful reports still feed `aggregator.addParserResult(...)` and
  `parsersUsed` exactly as today (so `metadata.parsers_used` /
  `files_processed` are unchanged for parsed files).
- Attach `result.metadata.file_reports = reports` after `aggregate()`.
- **Remove** the now-redundant `result.parsing_errors` write (nothing reads it).
- Primary-domain detection currently iterates `parseResults` for
  `primaryDomain`; this now reads from the `parsed` reports (carry `primaryDomain`
  on the `parsed` report, or keep a parallel success list — implementation
  detail for the plan). No behavior change to domain detection.

### 4. UI — "File processing" panel (`components/seo-parser/ResultsView.tsx`)

A new dark-mode-compliant panel (Tailwind `dark:` variants on every element,
matching the app's `bg-white`→`dark:bg-navy-card` etc. mapping):

- **Summary line:** `N parsed · M failed · K not recognized` (omit zero
  buckets). `skipped` folds into "not recognized" for the count or is shown
  separately — plan decides; keep it terse.
- **Core-failure banner:** if any report is `status:'failed'` &&
  `severity:'core'`, render a prominent amber/red banner above the panel:
  *"Core export `internal_all.csv` failed to parse — the health score may be
  unreliable."* (list each core-failed filename).
- **Expandable list** (`<details>`): one row per non-`parsed` file first
  (failed → unmatched → skipped), then parsed files, each with a status badge +
  parser key or error message. This **subsumes** the existing buried "Debug
  info / Parsers used" `<details>` footer (removed).
- **Backward-compat:** when `result.metadata.file_reports` is absent (pre-PR
  sessions) the panel falls back to today's files/parsers summary text; when
  `result.archived` is true (C5 pruned-blob fallback, which does not
  reconstruct `file_reports`) the panel is hidden. No crashes, no empty box.

### 5. Scope boundaries (YAGNI)

- **No** change to session `error` semantics (isolation already exists).
- **No** change to the pre-parse `missingCoreExports` gate.
- **No** retry / re-upload-missing-file flow.
- **No** relational storage — `file_reports` lives on the `Session.result` JSON
  blob as display metadata only. It is intentionally lost when the blob is
  pruned at 90 d (the archived view already degrades detail; the panel hides).
- Keyword-research (SEMRush-only) sessions get the same reporting; their files
  simply resolve to `parsed`/`unmatched` via the same code path.

## Testing

**Parse-route tests** (`app/api/parse/[sessionId]/route.test.ts`, DB-backed with
the house unique-prefix + scoped-cleanup convention):

- Happy path: all uploaded files → `status:'parsed'`, `metadata.file_reports`
  length == manifest length.
- Corrupt non-core CSV → one `failed` report, `severity:'normal'`, other files
  still `parsed`, session `status:'complete'` (isolation preserved).
- Corrupt **core** export (`internal_all.csv` that throws) → `failed` +
  `severity:'core'`.
- Unrecognized CSV → `unmatched`; `.txt` file → `skipped`.
- `parsing_errors` no longer present on the result.

**`ResultsView` render tests** (`// @vitest-environment jsdom` pragma +
`afterEach(cleanup)`, per the repo's no-global-RTL-cleanup convention):

- Core-failure banner renders when a `severity:'core'` failed report exists.
- Mixed list renders each bucket with the right badge/label.
- Backward-compat: no `file_reports` → legacy summary text, no panel crash.
- Archived result → panel hidden.

## Change classification & gates

- **Class:** small feature + **UI change** → full gate set (`npm run lint` /
  `npm test` / `npm run build`) PLUS dark-mode variants on every new element and
  no hydration-mismatch patterns. No schema migration. No new env var. No
  `middleware.ts` / `isPublicPath` change (the parse route is already gated).
- **Pipeline:** this spec → Codex review → plan → Codex review → TDD build →
  gate-green → PR → Kevin merges → Kevin deploys → prod-verify → tracker/handoff
  ritual.
- **Prod verification:** upload a small crawl including one deliberately-corrupt
  CSV and one mis-named CSV on `https://seo.erstaging.site` (a client/staging
  site only), confirm the panel shows the correct buckets and the core-failure
  banner behaves; confirm an existing pre-PR session still renders (backward
  compat).

## Files touched (anticipated)

- `lib/types/index.ts` — `FileReport*` types + `metadata.file_reports`.
- `lib/parsers/expected-exports.ts` — `isCoreExport()` helper.
- `app/api/parse/[sessionId]/route.ts` — structured reports, drop
  `parsing_errors`.
- `components/seo-parser/ResultsView.tsx` — panel + banner, remove debug footer.
- Tests for the route and the component.
