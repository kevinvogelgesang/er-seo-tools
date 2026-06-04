# Spec — Roadmap rendering + issue dedup + frontloaded upload checklist

**Date:** 2026-06-04
**Source:** `docs/superpowers/todos/HANDOFF-2026-06-04-seo-audit-test-findings.md` (§A, §B, §4)
**Status:** Design — for review

## Problem

A test audit of nuvani.edu (33/45 parsers matched, 72 issues, partial completeness) surfaced three distinct problems in the SEO parser → roadmap pipeline:

1. **Roadmap tables render as raw text.** The generated technical-SEO roadmap contains GFM markdown tables (Duplicate Content, Implementation Order). `RoadmapMarkdown` renders with `react-markdown` but **no `remark-gfm`** and no table component overrides, so a table like `| Type | Count |` collapses into a run-on paragraph (`| Type | Count |-|-| Exact duplicate pages | 0 | ...`). `MemoMarkdown` (pillar memos) is byte-identical and shares the same latent bug.

2. **Issue data feeding the roadmap is inaccurate.** The aggregator triple-counts duplicate categories (`duplicate_title` + `duplicate_titles` + `duplicate_title_tags`, plus h1/meta equivalents), leaves `sf_h2_missing` un-deduped against curated `missing_h2`, and `client_errors_4xx` surfaces *external* link targets (overlapping `broken_external_links`) rather than internal-page 4xx.

3. **No upload-time feedback on missing exports.** A user can upload an incomplete Screaming Frog crawl and only discover gaps after processing. `UploadChecklist` is a static list that never checks the actual file set.

## Goals

- Roadmap (and pillar-memo) markdown tables render as real, readable, dark-mode-styled tables.
- The issue list feeding the roadmap is deduplicated and correctly scoped before rendering/export.
- At file-selection, the uploader shows which expected SF exports are present/missing, with per-missing "enable this in Screaming Frog" instructions, and **blocks processing only when a core export (`internal_all` or `response_codes`) is missing**.

## Non-goals

- No change to the `er-handoff-memo` skill's markdown *generation* (the skill already emits valid GFM tables; the bug is on the render side). The skill's roadmap template stays as-is.
- No change to the core stack, scoring formula, or completeness thresholds (handoff §C items 7–8 are explicitly deferred).
- No new parsers; Phase 2 only fixes orphaned/misrouted existing parsers.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Roadmap-tables target | **Both** — fix render (GFM tables) *and* app-side dedup (§A.1–3) |
| Renderer scope | **Shared component** — extract one `DashboardMarkdown`, fix roadmap + pillar memos, remove duplication |
| Upload check behavior | **Block only on core files** (`internal_all`, `response_codes`); advisory for the rest |
| Upload check timing | **At file-selection** (true frontload), client-side; server stays authoritative |
| Packaging | **One spec, three phases**; one Codex spec review, phased PRs |
| SF enable-instructions source | **Trust handoff §4 paths**; correct any stale paths during spec/code review |
| Core-gate enforcement (Codex) | Client disables Analyze button on missing core; **authoritative gate lives in `/api/parse/[sessionId]`, scoped to `workflow === 'technical'`** — never blocks uploads or keyword-research/SEMRush-only sessions |

---

## Phase 1 — Roadmap accuracy + rendering

### 1a. Shared markdown renderer with GFM tables

**Current:** `components/seo-parser/RoadmapMarkdown.tsx` and `app/pillar-analysis/[id]/components/MemoMarkdown.tsx` are identical: `<ReactMarkdown components={components}>{source}</ReactMarkdown>`, no `remarkPlugins`. `react-markdown@^10.1.0` is present; `remark-gfm` is **not** a dependency.

**Change:**
- Add `remark-gfm` dependency (compatible with react-markdown 10 — `remark-gfm@^4`).
- Create a shared `components/markdown/DashboardMarkdown.tsx` holding the existing component overrides **plus** table overrides: `table` (wrapped in an overflow-x-auto container, `w-full text-sm border-collapse`), `thead`, `tbody`, `tr`, `th` (left-aligned, bold, `border-b`, dark-mode header bg), `td` (`border-b`, padded). Styling mirrors the existing palette (`text-[#1c2d4a] dark:text-white`, `border-gray-200 dark:border-navy-border`).
- Render with `remarkPlugins={[remarkGfm]}`. **Do not** add `rehype-raw` (preserve the existing security stance documented in both files' header comments — carry that comment into the shared component, and keep an explicit test/expectation that raw HTML is NOT rendered, since `remark-gfm` widens the markdown parsing surface beyond tables).
- **Three** renderers are byte-identical and must all route through `DashboardMarkdown`: `components/seo-parser/RoadmapMarkdown.tsx`, `app/pillar-analysis/[id]/components/MemoMarkdown.tsx`, and `components/keyword-research/KeywordMemoMarkdown.tsx` (Codex caught this third one — without it the same table bug survives in the keyword-research workflow). They become thin re-exports/wrappers of `DashboardMarkdown` (keep their names/import paths so call sites don't churn), or are replaced at call sites — implementer's choice, but all three rendered outputs must use the shared overrides.

**Acceptance:** The §5 roadmap markdown from the handoff doc renders with the Duplicate Content and Implementation Order tables as HTML tables (header row, aligned cells), readable in light and dark mode, horizontally scrollable on narrow viewports. Pillar memos with tables render the same way.

### 1b. Curated duplicate-type dedup (§A.1)

**Current:** For one underlying duplicate-titles problem the aggregator emits up to three curated issue types. `dropSupersededSfIssues` only collapses `sf_*` → curated; it does not touch curated↔curated overlap. Same pattern for duplicate H1 and duplicate meta description.

**Change:** Add a curated-canonicalization pass (sibling to `dropSupersededSfIssues`, in `lib/services/sf-issue-dedup.ts` or a new `lib/services/curated-issue-dedup.ts`) driven by a `CURATED_CANONICAL` map: each duplicate-category lists a canonical type and the redundant aliases to drop when the canonical (or any sibling) is present.

**Canonical choices (verified by Codex against the emitters + `priority.service.ts` weights):**
- **duplicate titles → keep `duplicate_title`**, drop `duplicate_titles` and `duplicate_title_tags`. `duplicate_title` (from `PageTitlesParser`) carries grouped URLs; `duplicate_titles` (from `internal_all`) has count/title groups but no URLs; `duplicate_title_tags` is a re-emitted wrapper.
- **duplicate meta → keep `duplicate_meta_description`**, drop `duplicate_meta_descriptions`. This matters most: `duplicate_meta_description` (from `MetaDescriptionParser`) has `groups` with URLs; the aggregator's `duplicate_meta_descriptions` wrapper currently does **not** carry `groups`.
- **duplicate H1 → keep `duplicate_h1`**, drop `duplicate_h1_tags`. Both may carry groups, but `duplicate_h1` is the original parser issue and is the one weighted in `priority.service.ts` (the `_tags`/`_descriptions` variants are absent from the weight map — confirmed).

**Ordering (corrected):** collect all issues → `dedupeIssues()` same-type pass → **curated canonicalization** → `dropSupersededSfIssues()`. The curated pass must run *before* the SF supersession pass so the latter sees the final curated present-set. (Today `buildIssues` ends with `dropSupersededSfIssues({critical: dedupeIssues(...), ...})` at ~line 506 — slot the canonicalization between `dedupeIssues` and `dropSupersededSfIssues`.)

**Cleanup follow-up:** confirm during implementation whether `duplicate_title_tags`, `duplicate_meta_descriptions`, and `duplicate_h1_tags` are still needed at all — they may be removable emissions (delete at source) rather than aliases to drop in a pass. Prefer deleting a redundant emission over masking it, when the emission has no other consumer.

**Acceptance:** For the nuvani fixture, exactly one duplicate-title issue, one duplicate-h1 issue, and one duplicate-meta issue appear across all severity buckets; affected-URL groups are preserved; the Duplicate Content table counts are unchanged in value (2 title groups, 3 meta groups, 1 h1 group) but no longer triple-listed in the issue tabs.

### 1c. `sf_h2_*` mapping (§A.2)

**Change:** Add `sf_h2_missing: ['missing_h2']` to `SF_SUPERSEDED_BY`. Audit other `sf_h2_*` keys; **keep** `sf_h2_multiple` (no curated twin). Document the keep in a comment (consistent with the existing conservative-by-design note).

**Acceptance:** With curated `missing_h2` present, `sf_h2_missing` is dropped; `sf_h2_multiple` survives.

### 1d. `client_errors_4xx` internal-only scope (§A.3)

**Current:** `client_errors_4xx` (critical) is created by `ResponseCodesParser` but its affected URLs in the fixture are all external targets (enrollmentresources.com, ope.ed.gov, …) — i.e. it is double-surfacing `broken_external_links` under a critical "internal 4xx" label.

**Change (refined per Codex — the parser has NO internal/external scope today; it counts *every* 4xx row in the matched CSV at `responseCodes.parser.ts:7`+):** Minimal safe fix, in priority order:
1. Prefer the SF **internal** response-code export in the manifest/checklist, so the input itself is already internal-scoped.
2. In `ResponseCodesParser`, if the CSV has an SF scope column (`Internal`, `Type`, `Link Type`, or similar — confirm the real column name against the nuvani CSV), count only rows marked internal.
3. Only fall back to same-host filtering if the parser can determine the **site host reliably**. Do **not** infer the site host from an all-external 4xx file — otherwise the external host becomes the inferred "primary" host and the filter inverts. When the host can't be reliably determined and no scope column exists, leave the count as-is rather than guess.

External 4xx remain covered by `broken_external_links`.

**Acceptance:** A regression fixture containing internal 404s **and** external 404 targets in the same CSV: `client_errors_4xx` lists only the internal-host 4xx URLs, the external targets appear only under `broken_external_links`, and no external URL appears under `client_errors_4xx`. (On the nuvani fixture the correct result is likely 0 internal 4xx.)

---

## Phase 2 — SF export review + parser-orphan fixes

### 2a. Expected-exports manifest (single source of truth)

Create `lib/parsers/expected-exports.ts` exporting a typed array of expected SF exports. Each entry:

```ts
interface ExpectedExport {
  id: string;                 // stable key
  label: string;              // human name, e.g. "Internal — All"
  filenamePatterns: string[]; // substrings matched against uploaded filenames (mirror filenamePattern)
  parserKey?: string;         // maps to PARSER_MAP key when 1:1
  tier: 'core' | 'recommended' | 'optional';
  sfInstructions: string;     // "enable this in Screaming Frog" — from handoff §4
  notExpectedFromSf?: boolean;// true for SEMRush exports (don't flag as missing SF gaps)
}
```

`tier: 'core'` = `internal_all`, `response_codes` (the only two that gate processing for the technical workflow). The manifest seeds Phase 3's checklist and is the documented contract for "what a complete crawl looks like." Enable-instructions text comes from handoff §4 (paths trusted, corrected in review). SEMRush entries are marked `notExpectedFromSf` so the SF-gap UI never flags them.

**Export a pure matching helper from the manifest module** — `matchExpectedExports(filenames: string[])` → per-export coverage (present + which file satisfied it, or missing). Both client and server call this **same** helper, so there is no duplicated/drifting matching logic. The helper does case-insensitive substring matching mirroring `findParserForFile`'s filename pass, but imports **no** parser classes and no `papaparse` (keeps it client-safe). The manifest is for *expected-file coverage only* — it is **not** a parser resolver; `findParserForFile()` remains the authoritative parser selector on the server (especially for content-detected SEMRush files).

### 2b. Parser-orphan fixes exposed by the review

- **§B-4 (confirmed):** `SecurityParser.filenamePattern = ['security_all', 'security']`. The bare `'security'` substring matches `security_form_url_insecure.csv` before `InsecureContentParser` (`'insecure'`) is reached in `findParserForFile`'s ordered loop, orphaning the insecure-content file. **Fix:** drop the bare `'security'` pattern (use `['security_all', 'security_headers']`) so the insecure file routes to `InsecureContentParser`; verify no real SF security export relied on the bare substring. (Reordering is the fallback if a real `security*.csv` would otherwise miss.)
- **§B-5:** `ResponseTimeParser` (`response_time`) matches no standalone SF export (response time is a column in `internal_all`). **Fix:** remove the parser from `PARSERS`/`PARSER_MAP` and `expected-exports`, OR repoint it to read response-time from `internal_all`. Default: remove, and note response-time lives in `internal_all`. Implementer confirms nothing else references `responsetime`.
- **§B-6:** Reconcile `RedirectChainsParser` / `RedirectsParser` `filenamePattern`s against real SF export names (`Reports → Redirects → Redirect Chains` / `All Redirects`). Update patterns so the actual exported filenames match, and align the manifest's `filenamePatterns` + `sfInstructions` to the reconciled names.

**Acceptance:** Re-running the parser set over a crawl that includes `security_form_url_insecure.csv` routes it to `InsecureContentParser`; `responsetime` is no longer an orphaned no-match (removed or sourced from internal); redirect-chain / all-redirects exports match their parsers. `tsc --noEmit` clean.

---

## Phase 3 — Frontloaded upload checklist

### 3a. Client-side matching

In the dropzone (`components/seo-parser/FileDropzone.tsx` + `app/seo-parser/page.tsx`), as files are selected/dropped, match each filename against `expected-exports.ts` `filenamePatterns` (case-insensitive substring — the same logic as `findParserForFile`'s filename pass, reimplemented client-side from the shared manifest). Produce, per expected export: present (which file satisfied it) or missing.

### 3b. Checklist UI (evolve `UploadChecklist`)

Replace the static `UploadChecklist` with a dynamic version:
- **Core (tier `core`) missing** → prominent blocking warning; the upload/process action is disabled until satisfied. Copy: names the missing core export + its `sfInstructions`.
- **Recommended/optional missing** → advisory list, each with its `sfInstructions` ("To include this, in Screaming Frog: …"), never blocks.
- **Present** → ✓ with the matched filename.
- SEMRush / `notExpectedFromSf` entries appear as optional and are never presented as an SF crawl gap.

### 3c. Server backstop — gate at the *parse* step, not upload (Codex correction)

The hard server-side gate belongs in **`app/api/parse/[sessionId]/route.ts`** (the "Analyze" action), **not** `app/api/upload/route.ts`. Rationale: uploads are batched and can be appended to an existing pending session, so rejecting a partial upload batch before the user has added their core files makes the UX brittle. Gating the *parse/analyze* step is the correct backstop — by then the full file set for the session is known.

Constraints:
- **Scope the gate to `workflow === 'technical'`.** Do **not** block keyword-research / SEMRush-only uploads (no `internal_all`/`response_codes` expected there).
- The gate reuses the manifest's `core` tier via `matchExpectedExports`.
- The client-side checklist (3b) *disables the Analyze/process button* when core is missing — it does not reject uploads. Server gate is the authoritative backstop for a bypassed client.

**Acceptance:** In the technical workflow, dropping only `images_missing_alt_text.csv` shows a blocking "missing core: internal_all, response_codes" warning with SF instructions and a disabled Analyze button. Adding `internal_all.csv` + `response_codes_all.csv` clears the block; remaining recommended gaps show as advisory with enable-instructions. A direct POST to `/api/parse/[sessionId]` with no core files is rejected for a technical-workflow session, but a keyword-research/SEMRush-only session parses normally (not gated). Partial upload *batches* are never rejected by `/api/upload`.

---

## Files touched (summary)

**Phase 1:** `package.json` (+`remark-gfm`), new `components/markdown/DashboardMarkdown.tsx`, `components/seo-parser/RoadmapMarkdown.tsx`, `app/pillar-analysis/[id]/components/MemoMarkdown.tsx`, `components/keyword-research/KeywordMemoMarkdown.tsx` (third renderer — Codex), `lib/services/aggregator.service.ts` (`buildIssues`), `lib/services/sf-issue-dedup.ts` (+ possibly new `curated-issue-dedup.ts`), `lib/parsers/technical/responseCodes.parser.ts`.

**Phase 2:** new `lib/parsers/expected-exports.ts` (incl. pure `matchExpectedExports` helper), `lib/parsers/resources/security.parser.ts`, `lib/parsers/index.ts` (remove `ResponseTimeParser` if dropped), `lib/parsers/technical/redirectChains.parser.ts`, `lib/parsers/technical/redirects.parser.ts`.

**Phase 3:** `components/seo-parser/UploadChecklist.tsx` (rewrite), `components/seo-parser/FileDropzone.tsx`, `app/seo-parser/page.tsx`, `app/api/parse/[sessionId]/route.ts` (core gate, technical-workflow only). `app/api/upload/route.ts` is **not** gated (uploads stay batchable).

## Testing strategy

- **Unit:** dedup passes (curated canonicalization + `sf_h2` mapping) against fixtures derived from the nuvani issue set; `client_errors_4xx` internal-only filter; client-side filename→manifest matcher; core-missing gate logic.
- **Render:** snapshot/RTL test that `DashboardMarkdown` renders a GFM table as `<table>` with header + body rows.
- **Integration:** upload route returns core-missing signal for a no-core file set.
- **Verification gate:** `npx tsc --noEmit` + `npm run build` clean before commit; deploy per CLAUDE.md (`git push` → `ssh seo@… "~/deploy.sh"`).

## Risks / rollback

- **Dedup dropping a real finding:** mitigated by canonicalizing only within known duplicate-categories and keeping the URL-bearing variant; conservative like the existing `SF_SUPERSEDED_BY`. Rollback = revert the canonicalization map.
- **SecurityParser pattern change misrouting a real security export:** verify against a crawl that includes the real `security*.csv` before merging; reorder-instead-of-retighten is the fallback.
- **remark-gfm rendering regression in pillar memos:** shared component is covered by the render test; pillar memos already contain only headings/lists/emphasis today, so tables are additive.
- **Stale §4 SF paths in manifest:** corrected at review per decision; low blast radius (instruction text only).

## Open verification items (from Codex review — resolve during implementation)

- Real SF response-code export names: confirm whether the intended **core** file is internal-only, and whether external response-code exports also contain `response_codes` in the filename (affects both the manifest `core` pattern and §1d).
- Actual scope column name in the nuvani response-code CSV (`Internal` / `Type` / `Link Type` / other) — §1d's filter must use the real column.
- Whether `duplicate_title_tags` / `duplicate_meta_descriptions` / `duplicate_h1_tags` are still needed post-canonicalization, or are dead emissions to delete at source (§1b cleanup follow-up).
- Whether keyword memos can emit tables (they can today route through `DashboardMarkdown` regardless — §1a includes `KeywordMemoMarkdown`).
- Whether `issues_overview` should be a **recommended (non-blocking)** manifest entry — valuable for SF-only issue categories but not core enough to gate.
