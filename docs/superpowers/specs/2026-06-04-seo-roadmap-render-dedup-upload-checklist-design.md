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

---

## Phase 1 — Roadmap accuracy + rendering

### 1a. Shared markdown renderer with GFM tables

**Current:** `components/seo-parser/RoadmapMarkdown.tsx` and `app/pillar-analysis/[id]/components/MemoMarkdown.tsx` are identical: `<ReactMarkdown components={components}>{source}</ReactMarkdown>`, no `remarkPlugins`. `react-markdown@^10.1.0` is present; `remark-gfm` is **not** a dependency.

**Change:**
- Add `remark-gfm` dependency (compatible with react-markdown 10 — `remark-gfm@^4`).
- Create a shared `components/markdown/DashboardMarkdown.tsx` holding the existing component overrides **plus** table overrides: `table` (wrapped in an overflow-x-auto container, `w-full text-sm border-collapse`), `thead`, `tbody`, `tr`, `th` (left-aligned, bold, `border-b`, dark-mode header bg), `td` (`border-b`, padded). Styling mirrors the existing palette (`text-[#1c2d4a] dark:text-white`, `border-gray-200 dark:border-navy-border`).
- Render with `remarkPlugins={[remarkGfm]}`. **Do not** add `rehype-raw` (preserve the existing security stance documented in both files' header comments — carry that comment into the shared component).
- `RoadmapMarkdown` and `MemoMarkdown` become thin re-exports/wrappers of `DashboardMarkdown` (keep their names/import paths so call sites don't churn), or are replaced at call sites — implementer's choice, but both rendered outputs must use the shared overrides.

**Acceptance:** The §5 roadmap markdown from the handoff doc renders with the Duplicate Content and Implementation Order tables as HTML tables (header row, aligned cells), readable in light and dark mode, horizontally scrollable on narrow viewports. Pillar memos with tables render the same way.

### 1b. Curated duplicate-type dedup (§A.1)

**Current:** For one underlying duplicate-titles problem the aggregator emits up to three curated issue types. `dropSupersededSfIssues` only collapses `sf_*` → curated; it does not touch curated↔curated overlap. Same pattern for duplicate H1 and duplicate meta description.

**Change:** Add a curated-canonicalization pass (sibling to `dropSupersededSfIssues`, in `lib/services/sf-issue-dedup.ts` or a new `lib/services/curated-issue-dedup.ts`) driven by a `CURATED_CANONICAL` map: each duplicate-category lists a canonical type and the redundant aliases to drop when the canonical (or any sibling) is present. Run it inside `buildIssues` after collection, before/alongside `dropSupersededSfIssues`. Categories to canonicalize (final names verified during implementation against actual emitters):
- duplicate titles: `duplicate_title` | `duplicate_titles` | `duplicate_title_tags` → one canonical
- duplicate H1: `duplicate_h1` | `duplicate_h1_tags` → one canonical
- duplicate meta: `duplicate_meta_description` | `duplicate_meta_descriptions` → one canonical

The canonical chosen for each category must be the **URL-bearing** variant (so the Duplicate Content table and roadmap keep their affected-URL lists). If the richest variant differs per category, pick per category.

**Acceptance:** For the nuvani fixture, exactly one duplicate-title issue, one duplicate-h1 issue, and one duplicate-meta issue appear across all severity buckets; affected-URL groups are preserved; the Duplicate Content table counts are unchanged in value (2 title groups, 3 meta groups, 1 h1 group) but no longer triple-listed in the issue tabs.

### 1c. `sf_h2_*` mapping (§A.2)

**Change:** Add `sf_h2_missing: ['missing_h2']` to `SF_SUPERSEDED_BY`. Audit other `sf_h2_*` keys; **keep** `sf_h2_multiple` (no curated twin). Document the keep in a comment (consistent with the existing conservative-by-design note).

**Acceptance:** With curated `missing_h2` present, `sf_h2_missing` is dropped; `sf_h2_multiple` survives.

### 1d. `client_errors_4xx` internal-only scope (§A.3)

**Current:** `client_errors_4xx` (critical) is created by `ResponseCodesParser` but its affected URLs in the fixture are all external targets (enrollmentresources.com, ope.ed.gov, …) — i.e. it is double-surfacing `broken_external_links` under a critical "internal 4xx" label.

**Change:** Trace the `client_errors_4xx` source in the response-codes path. It must count/list **internal pages** returning 4xx only. If SF's `response_codes_internal_*` already separates internal from external, source strictly from the internal set; if the current input conflates them, filter to internal URLs (same-host or SF "Internal" flag). External 4xx remain covered by `broken_external_links`.

**Acceptance:** On the nuvani fixture, `client_errors_4xx` lists only internal-host 4xx URLs (likely 0 for nuvani, which is the correct result), and the external targets remain under `broken_external_links` only. No external URL appears under `client_errors_4xx`.

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

`tier: 'core'` = `internal_all`, `response_codes` (the only two that gate processing). The manifest seeds Phase 3's checklist and is the documented contract for "what a complete crawl looks like." Enable-instructions text comes from handoff §4 (paths trusted, corrected in review). SEMRush entries are marked `notExpectedFromSf` so the SF-gap UI never flags them.

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

### 3c. Server backstop

The upload API (`app/api/upload/route.ts`) remains authoritative: it already runs `findParserForFile`. Add a server-side core-export check that returns the same core-missing signal (so a client that bypasses the gate still can't process without core files). Server check reuses the manifest's `core` tier. (Server response shape additions are backward-compatible.)

**Acceptance:** Dropping only `images_missing_alt_text.csv` shows a blocking "missing core: internal_all, response_codes" warning with SF instructions and a disabled process button. Adding `internal_all.csv` + `response_codes_all.csv` clears the block; remaining recommended gaps show as advisory with enable-instructions. Server rejects a process attempt with no core files even if the client gate is bypassed.

---

## Files touched (summary)

**Phase 1:** `package.json` (+`remark-gfm`), new `components/markdown/DashboardMarkdown.tsx`, `components/seo-parser/RoadmapMarkdown.tsx`, `app/pillar-analysis/[id]/components/MemoMarkdown.tsx`, `lib/services/aggregator.service.ts` (`buildIssues`), `lib/services/sf-issue-dedup.ts` (+ possibly new `curated-issue-dedup.ts`), `lib/parsers/technical/responseCodes.parser.ts`.

**Phase 2:** new `lib/parsers/expected-exports.ts`, `lib/parsers/resources/security.parser.ts`, `lib/parsers/index.ts` (remove `ResponseTimeParser` if dropped), `lib/parsers/technical/redirectChains.parser.ts`, `lib/parsers/technical/redirects.parser.ts`.

**Phase 3:** `components/seo-parser/UploadChecklist.tsx` (rewrite), `components/seo-parser/FileDropzone.tsx`, `app/seo-parser/page.tsx`, `app/api/upload/route.ts`.

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
