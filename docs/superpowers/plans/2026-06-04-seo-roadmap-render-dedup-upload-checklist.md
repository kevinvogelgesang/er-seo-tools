# SEO Roadmap Rendering + Issue Dedup + Frontloaded Upload Checklist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the generated technical-SEO roadmap render its markdown tables as real tables, deduplicate the curated issue list feeding it, and warn users at upload time which Screaming Frog exports are missing (blocking only when a core export is absent).

**Architecture:** Three sequenced phases. Phase 1 fixes rendering (shared `DashboardMarkdown` + `remark-gfm`) and issue-data accuracy (curated canonicalization pass, `sf_h2` mapping, `client_errors_4xx` scoping). Phase 2 adds a single expected-exports manifest with a pure `matchExpectedExports` helper and fixes parser-routing orphans. Phase 3 consumes the manifest for a dynamic upload checklist (client) and a server-side core gate in the parse route (technical workflow only).

**Tech Stack:** Next.js 15 App Router, TypeScript, React, `react-markdown@^10` + `remark-gfm@^4`, Vitest (`environment: node`, per-file `// @vitest-environment jsdom` for component tests), `@testing-library/react`, Prisma + SQLite.

**Spec:** `docs/superpowers/specs/2026-06-04-seo-roadmap-render-dedup-upload-checklist-design.md` (Codex-reviewed).

**Conventions:**
- Test runner: `npx vitest run <path>` for a single file; `npm test` for all.
- Verify before claiming done: `npx tsc --noEmit` and `npm run build` must be clean before the final commit of each phase.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Branch: `feat/seo-roadmap-render-dedup-upload-checklist` (already created; spec committed there).

---

## File Structure

**Phase 1 — rendering + accuracy**
- Create: `components/markdown/DashboardMarkdown.tsx` — single shared markdown renderer (typography + GFM tables, no `rehype-raw`).
- Create: `components/markdown/DashboardMarkdown.test.tsx` — render test (jsdom).
- Modify: `package.json` — add `remark-gfm` dependency.
- Modify: `components/seo-parser/RoadmapMarkdown.tsx` — re-export `DashboardMarkdown`.
- Modify: `app/pillar-analysis/[id]/components/MemoMarkdown.tsx` — re-export `DashboardMarkdown`.
- Modify: `components/keyword-research/KeywordMemoMarkdown.tsx` — re-export `DashboardMarkdown`.
- Create: `lib/services/curated-issue-dedup.ts` — `canonicalizeCuratedIssues` + `CURATED_CANONICAL`.
- Create: `lib/services/curated-issue-dedup.test.ts`.
- Modify: `lib/services/aggregator.service.ts` — delete 3 redundant wrapper emissions; wire `canonicalizeCuratedIssues` into `buildIssues`.
- Modify: `lib/services/sf-issue-dedup.ts` — add `sf_h2_missing → missing_h2`.
- Modify: `lib/services/sf-issue-dedup.test.ts` — cover the new mapping.
- Modify: `lib/parsers/technical/responseCodes.parser.ts` — scope `client_errors_4xx` to internal rows.
- Create: `lib/parsers/technical/responseCodes.parser.test.ts` — internal/external 4xx fixture.

**Phase 2 — manifest + parser routing**
- Create: `lib/parsers/expected-exports.ts` — `EXPECTED_EXPORTS`, `matchExpectedExports`, `missingCoreExports`.
- Create: `lib/parsers/expected-exports.test.ts`.
- Modify: `lib/parsers/index.ts` — reorder `InsecureContentParser` before `SecurityParser`; remove `ResponseTimeParser` registration; reconcile redirect patterns.
- Create/Modify: `lib/parsers/index.routing.test.ts` — assert correct routing for the security/insecure overlap.

**Phase 3 — upload checklist + gate**
- Modify: `components/seo-parser/UploadChecklist.tsx` — dynamic, consumes `matchExpectedExports`.
- Create: `components/seo-parser/UploadChecklist.test.tsx`.
- Modify: `app/seo-parser/page.tsx` — pass `files` to checklist; disable Analyze when core missing.
- Modify: `app/api/parse/[sessionId]/route.ts` — server core gate (technical workflow only).
- Create: `app/api/parse/[sessionId]/route.test.ts` — gate test.

---

# Phase 1 — Roadmap accuracy + rendering

## Task 1: Shared `DashboardMarkdown` with GFM tables

**Files:**
- Modify: `package.json` (add `remark-gfm`)
- Create: `components/markdown/DashboardMarkdown.tsx`
- Create: `components/markdown/DashboardMarkdown.test.tsx`

- [ ] **Step 1: Add the dependency**

Run: `npm install remark-gfm@^4`
Expected: `package.json` `dependencies` now includes `"remark-gfm": "^4.x"`; `npm install` exits 0.

- [ ] **Step 2: Write the failing render test**

Create `components/markdown/DashboardMarkdown.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DashboardMarkdown } from './DashboardMarkdown';

describe('DashboardMarkdown', () => {
  it('renders a GFM pipe table as a real <table> with header and body cells', () => {
    const md = [
      '| Type | Count |',
      '|------|-------|',
      '| Exact duplicate pages | 0 |',
      '| Duplicate title tags | 2 groups |',
    ].join('\n');
    const { container } = render(<DashboardMarkdown source={md} />);
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(container.querySelectorAll('thead th').length).toBe(2);
    expect(container.querySelectorAll('tbody tr').length).toBe(2);
    expect(container.textContent).toContain('Duplicate title tags');
  });

  it('does NOT render raw HTML (no rehype-raw)', () => {
    const { container } = render(<DashboardMarkdown source={'<script>alert(1)</script> and <b>bold</b>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run components/markdown/DashboardMarkdown.test.tsx`
Expected: FAIL — module `./DashboardMarkdown` not found.

- [ ] **Step 4: Implement `DashboardMarkdown`**

Create `components/markdown/DashboardMarkdown.tsx`:

```tsx
'use client';

// components/markdown/DashboardMarkdown.tsx
//
// The single shared markdown renderer for dashboard documents (technical-SEO
// roadmaps, pillar strategic memos, keyword strategy memos). Uses react-markdown
// with custom component overrides for the dashboard's typography PLUS GFM tables.
//
// We deliberately do NOT enable `rehype-raw`: these documents are server-stored
// markdown that we trust as text only. `remark-gfm` widens the markdown surface
// (tables, strikethrough, autolinks) but still does not execute raw HTML. Do not
// add `rehype-raw` here — a render test asserts raw HTML stays inert.

import React, { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="font-display font-bold text-xl text-[#1c2d4a] dark:text-white mt-6 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="font-display font-semibold text-lg text-[#1c2d4a] dark:text-white mt-4">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="text-gray-700 dark:text-white/80 mt-2 leading-relaxed">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="list-disc ml-6 mt-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="list-decimal ml-6 mt-2 space-y-1">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="text-gray-700 dark:text-white/80">{children}</li>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-[#1c2d4a] dark:text-white">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => <em className="italic">{children}</em>,
  code: ({ children }: { children?: ReactNode }) => (
    <code className="font-mono text-[0.875em] bg-gray-100 dark:bg-navy-deep text-[#1c2d4a] dark:text-white px-1.5 py-0.5 rounded border border-gray-200 dark:border-navy-border">
      {children}
    </code>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="bg-gray-50 dark:bg-navy-deep">{children}</thead>
  ),
  tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className="border-b border-gray-200 dark:border-navy-border">{children}</tr>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="text-left font-semibold text-[#1c2d4a] dark:text-white px-3 py-2 border-b border-gray-200 dark:border-navy-border">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="text-gray-700 dark:text-white/80 px-3 py-2 align-top">{children}</td>
  ),
};

export function DashboardMarkdown({ source }: { source: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{source}</ReactMarkdown>;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run components/markdown/DashboardMarkdown.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json components/markdown/DashboardMarkdown.tsx components/markdown/DashboardMarkdown.test.tsx
git commit -m "feat(seo): shared DashboardMarkdown renderer with GFM tables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Route all three renderers through `DashboardMarkdown`

The three existing renderers (`RoadmapMarkdown`, `MemoMarkdown`, `KeywordMemoMarkdown`) are byte-identical. Replace each body with a re-export so call sites and import paths don't change.

**Files:**
- Modify: `components/seo-parser/RoadmapMarkdown.tsx`
- Modify: `app/pillar-analysis/[id]/components/MemoMarkdown.tsx`
- Modify: `components/keyword-research/KeywordMemoMarkdown.tsx`

- [ ] **Step 1: Replace `RoadmapMarkdown` body**

Overwrite `components/seo-parser/RoadmapMarkdown.tsx` with:

```tsx
'use client';

// components/seo-parser/RoadmapMarkdown.tsx
// Thin wrapper over the shared DashboardMarkdown renderer (GFM tables, no rehype-raw).
import { DashboardMarkdown } from '@/components/markdown/DashboardMarkdown';

export function RoadmapMarkdown({ source }: { source: string }) {
  return <DashboardMarkdown source={source} />;
}
```

- [ ] **Step 2: Replace `MemoMarkdown` body**

Overwrite `app/pillar-analysis/[id]/components/MemoMarkdown.tsx` with:

```tsx
'use client';

// app/pillar-analysis/[id]/components/MemoMarkdown.tsx
// Thin wrapper over the shared DashboardMarkdown renderer (GFM tables, no rehype-raw).
import { DashboardMarkdown } from '@/components/markdown/DashboardMarkdown';

export function MemoMarkdown({ source }: { source: string }) {
  return <DashboardMarkdown source={source} />;
}
```

- [ ] **Step 3: Replace `KeywordMemoMarkdown` body**

Open `components/keyword-research/KeywordMemoMarkdown.tsx`, confirm the exported component name and prop name (`source`), then overwrite preserving the SAME export name. If its export is `KeywordMemoMarkdown({ source }: { source: string })`:

```tsx
'use client';

// components/keyword-research/KeywordMemoMarkdown.tsx
// Thin wrapper over the shared DashboardMarkdown renderer (GFM tables, no rehype-raw).
import { DashboardMarkdown } from '@/components/markdown/DashboardMarkdown';

export function KeywordMemoMarkdown({ source }: { source: string }) {
  return <DashboardMarkdown source={source} />;
}
```

If the original prop name differs (e.g. `markdown` instead of `source`), keep the original signature and pass it through: `<DashboardMarkdown source={markdown} />`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (imports resolve, prop types match).

- [ ] **Step 5: Commit**

```bash
git add components/seo-parser/RoadmapMarkdown.tsx app/pillar-analysis/[id]/components/MemoMarkdown.tsx components/keyword-research/KeywordMemoMarkdown.tsx
git commit -m "refactor(seo): route roadmap/pillar/keyword markdown through DashboardMarkdown

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Curated duplicate-type canonicalization + delete redundant wrappers

**Background (verified):** `buildIssues` collects each parser's `issues` (so `duplicate_title` from PageTitlesParser, `duplicate_meta_description` from MetaDescriptionParser, `duplicate_h1` from H1Parser all land in the issue arrays), then ALSO emits wrapper issues `duplicate_title_tags` (aggregator.service.ts:441–455), `duplicate_meta_descriptions` (:457–470), `duplicate_h1_tags` (:472–486). `computeDuplicateContent` (:754–828) reads the *parser* data directly, NOT these wrappers — so the wrappers have no other consumer and are safe to delete. The internal-summary `duplicate_titles` (:336–346) is the only one with a fallback role (sole signal when `page_titles` export is absent), so it is collapsed via a canonicalization pass instead of deleted.

**Files:**
- Create: `lib/services/curated-issue-dedup.ts`
- Create: `lib/services/curated-issue-dedup.test.ts`
- Modify: `lib/services/aggregator.service.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/services/curated-issue-dedup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canonicalizeCuratedIssues, CURATED_CANONICAL } from './curated-issue-dedup';
import type { Issue, IssuesResult } from '@/lib/types';

const iss = (type: string, severity: Issue['severity'] = 'warning', count = 1): Issue =>
  ({ type, severity, count, description: '' });

function group(all: Issue[]): IssuesResult {
  return {
    critical: all.filter((i) => i.severity === 'critical'),
    warnings: all.filter((i) => i.severity === 'warning'),
    notices: all.filter((i) => i.severity === 'notice'),
  };
}

describe('canonicalizeCuratedIssues', () => {
  it('keeps duplicate_title and drops duplicate_titles when both present', () => {
    const out = canonicalizeCuratedIssues(group([
      iss('duplicate_title', 'warning', 2),
      iss('duplicate_titles', 'warning', 2),
    ]));
    const types = [...out.critical, ...out.warnings, ...out.notices].map((i) => i.type);
    expect(types).toContain('duplicate_title');
    expect(types).not.toContain('duplicate_titles');
  });

  it('keeps duplicate_titles when it is the only duplicate-title signal', () => {
    const out = canonicalizeCuratedIssues(group([iss('duplicate_titles', 'warning', 3)]));
    const types = [...out.warnings].map((i) => i.type);
    expect(types).toContain('duplicate_titles');
  });

  it('never touches unrelated issues', () => {
    const out = canonicalizeCuratedIssues(group([
      iss('large_images'),
      iss('missing_alt_text'),
      iss('client_errors_4xx', 'critical'),
    ]));
    expect([...out.critical, ...out.warnings, ...out.notices]).toHaveLength(3);
  });

  it('every canonical group lists at least two non-sf_ types in preference order', () => {
    for (const order of CURATED_CANONICAL) {
      expect(order.length).toBeGreaterThanOrEqual(2);
      for (const t of order) expect(t.startsWith('sf_')).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/services/curated-issue-dedup.test.ts`
Expected: FAIL — module `./curated-issue-dedup` not found.

- [ ] **Step 3: Implement the canonicalization pass**

Create `lib/services/curated-issue-dedup.ts`:

```ts
import type { Issue, IssuesResult } from '@/lib/types';

/**
 * Curated issue types that describe the SAME finding under different names,
 * listed in PREFERENCE order (most precise / URL-bearing first). The first
 * present type in a group is kept; the rest are dropped.
 *
 * This complements `dropSupersededSfIssues` (which collapses count-only `sf_*`
 * passthroughs into a curated equivalent). Here we collapse curated↔curated
 * overlap where the TYPES differ.
 *
 * Today the only live overlap is duplicate-titles: PageTitlesParser emits
 * `duplicate_title` (grouped, URL-bearing); the internal_all summary emits
 * `duplicate_titles` (groups, no per-URL list) as a fallback when the
 * page_titles export is absent. Prefer `duplicate_title`; keep `duplicate_titles`
 * only when it is the sole signal. (The former `duplicate_title_tags`,
 * `duplicate_meta_descriptions`, and `duplicate_h1_tags` wrapper emissions were
 * deleted at source — they had no consumer beyond the issue list.)
 */
export const CURATED_CANONICAL: string[][] = [
  ['duplicate_title', 'duplicate_titles'],
];

export function canonicalizeCuratedIssues(issues: IssuesResult): IssuesResult {
  const all = [...issues.critical, ...issues.warnings, ...issues.notices];
  const present = new Set(all.map((i) => i.type));

  const drop = new Set<string>();
  for (const order of CURATED_CANONICAL) {
    const winnerIdx = order.findIndex((t) => present.has(t));
    if (winnerIdx === -1) continue;
    order.forEach((t, i) => {
      if (i !== winnerIdx) drop.add(t);
    });
  }

  const keep = (list: Issue[]) => list.filter((i) => !drop.has(i.type));
  return {
    critical: keep(issues.critical),
    warnings: keep(issues.warnings),
    notices: keep(issues.notices),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/services/curated-issue-dedup.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Delete the three redundant wrapper emissions in the aggregator**

In `lib/services/aggregator.service.ts`, delete these three blocks entirely:
- The `// NEW — Duplicate title tags (from PageTitlesParser)` block (currently ~441–455, pushes `duplicate_title_tags`).
- The `// NEW — Duplicate meta descriptions (from MetaDescriptionParser)` block (currently ~457–470, pushes `duplicate_meta_descriptions`).
- The `// NEW — Duplicate H1s (from H1Parser)` block (currently ~472–486, pushes `duplicate_h1_tags`).

Leave the `duplicate_titles` block (~336–346, from the internal summary) untouched — the canonicalization pass handles it.

- [ ] **Step 6: Wire the pass into `buildIssues`**

In `lib/services/aggregator.service.ts`, add the import near the existing dedup import (top of file, after line 6 `import { dropSupersededSfIssues } from './sf-issue-dedup';`):

```ts
import { canonicalizeCuratedIssues } from './curated-issue-dedup';
```

Then change the final `return` of `buildIssues` (currently lines ~506–510) from:

```ts
    return dropSupersededSfIssues({
      critical: dedupeIssues(critical),
      warnings: dedupeIssues(warnings),
      notices: dedupeIssues(notices),
    });
```

to (canonicalize BEFORE the SF supersession pass, so the latter sees the final curated present-set):

```ts
    return dropSupersededSfIssues(
      canonicalizeCuratedIssues({
        critical: dedupeIssues(critical),
        warnings: dedupeIssues(warnings),
        notices: dedupeIssues(notices),
      })
    );
```

- [ ] **Step 7: Run the aggregator + new tests, and typecheck**

Run: `npx vitest run lib/services/aggregator.service.test.ts lib/services/curated-issue-dedup.test.ts && npx tsc --noEmit`
Expected: PASS. If `aggregator.service.test.ts` asserts on `duplicate_title_tags`/`duplicate_meta_descriptions`/`duplicate_h1_tags` issue types, update those assertions to the canonical names (`duplicate_title` / `duplicate_meta_description` / `duplicate_h1`) — the Duplicate Content table (`computeDuplicateContent`) is unchanged, only the issue-list entries are.

- [ ] **Step 8: Commit**

```bash
git add lib/services/curated-issue-dedup.ts lib/services/curated-issue-dedup.test.ts lib/services/aggregator.service.ts
git commit -m "fix(seo): collapse curated duplicate-issue aliases; drop redundant wrappers

duplicate_title_tags/_meta_descriptions/_h1_tags wrappers had no consumer
(computeDuplicateContent reads parser data directly) — deleted at source.
duplicate_titles (internal-summary fallback) collapsed to duplicate_title
via a new canonicalization pass, run before dropSupersededSfIssues.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Map `sf_h2_missing → missing_h2`

**Files:**
- Modify: `lib/services/sf-issue-dedup.ts`
- Modify: `lib/services/sf-issue-dedup.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/services/sf-issue-dedup.test.ts` inside the existing `describe('dropSupersededSfIssues', ...)`:

```ts
  it('drops sf_h2_missing when curated missing_h2 is present, keeps sf_h2_multiple', () => {
    const out = dropSupersededSfIssues(group([
      iss('sf_h2_missing', 'notice', 42),
      iss('missing_h2', 'warning', 42),
      iss('sf_h2_multiple', 'notice', 84),
    ]));
    const types = [...out.critical, ...out.warnings, ...out.notices].map((i) => i.type);
    expect(types).not.toContain('sf_h2_missing');
    expect(types).toContain('missing_h2');
    expect(types).toContain('sf_h2_multiple');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/services/sf-issue-dedup.test.ts`
Expected: FAIL — `sf_h2_missing` still present (no mapping yet).

- [ ] **Step 3: Add the mapping**

In `lib/services/sf-issue-dedup.ts`, inside `SF_SUPERSEDED_BY`, add an H2 section (after the Links/anchors block, before the closing brace):

```ts
  // Headings (H2). Keep sf_h2_multiple — no curated twin.
  sf_h2_missing: ['missing_h2'],
```

- [ ] **Step 4: Confirm the curated `missing_h2` type exists**

Run: `grep -rn "missing_h2" lib/parsers lib/services | grep -v test`
Expected: at least one emitter of `missing_h2` (H2Parser or the internal summary). If the curated type is named differently, use that exact name in the mapping instead. If no curated `missing_h2` emitter exists at all, STOP — the mapping would be inert; reconcile with the actual H2 issue type before proceeding.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/services/sf-issue-dedup.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/sf-issue-dedup.ts lib/services/sf-issue-dedup.test.ts
git commit -m "fix(seo): dedup sf_h2_missing against curated missing_h2 (keep sf_h2_multiple)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Scope `client_errors_4xx` to internal pages

**Background (verified):** `ResponseCodesParser` (`lib/parsers/technical/responseCodes.parser.ts`) currently counts EVERY 4xx row in the matched CSV — no internal/external scope — so external link targets surface under the critical "internal 4xx" issue. Fix: if the CSV carries an internal-scope column, count only internal rows; otherwise leave behavior unchanged (the Phase 2 manifest will steer users to the internal export). Do NOT infer the site host from the rows (an all-external file would invert the filter).

**Files:**
- Modify: `lib/parsers/technical/responseCodes.parser.ts`
- Create: `lib/parsers/technical/responseCodes.parser.test.ts`

- [ ] **Step 1: Confirm the real scope-column name**

Run: `grep -rn "Internal" lib/parsers/technical/responseCodes.parser.ts; echo "---"; head -1 /Users/kevin/enrollment-resources/sf-crawls/pro-way-hair-school/*/response_codes*.csv 2>/dev/null | tr ',' '\n' | grep -iE "internal|type|indexab"`
Expected: identify whether SF's response-code export has an `Internal` column (values like `true`/`false`) or a `Type` column (values `Internal`/`External`). Use the column you find in Step 3. If neither exists in the available exports, default the candidate list to `['Internal']` and rely on the regression fixture (Step 2) to prove the filter; note this in the commit.

- [ ] **Step 2: Write the failing test**

Create `lib/parsers/technical/responseCodes.parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ResponseCodesParser } from './responseCodes.parser';

function parse(csv: string) {
  // BaseParser is constructed from raw CSV content in this codebase's pattern.
  // If the constructor signature differs, mirror an existing parser test
  // (e.g. lib/parsers/seoElements/pageTitles.parser.test.ts) for setup.
  const parser = new ResponseCodesParser(csv);
  return parser.parse();
}

describe('ResponseCodesParser — client_errors_4xx scope', () => {
  it('counts only internal 4xx rows when an Internal scope column is present', () => {
    const csv = [
      'Address,Status Code,Internal',
      'https://site.com/missing,404,true',
      'https://external.example/dead,404,false',
      'https://other.example/gone,403,false',
    ].join('\n');
    const result = parse(csv);
    const issues = (result.issues ?? []) as Array<{ type: string; count: number; urls?: string[] }>;
    const clientErr = issues.find((i) => i.type === 'client_errors_4xx');
    expect(clientErr?.count).toBe(1);
    expect(clientErr?.urls).toEqual(['https://site.com/missing']);
  });

  it('counts all 4xx rows when no scope column exists (legacy behavior preserved)', () => {
    const csv = [
      'Address,Status Code',
      'https://site.com/a,404',
      'https://site.com/b,410',
    ].join('\n');
    const result = parse(csv);
    const issues = (result.issues ?? []) as Array<{ type: string; count: number }>;
    expect(issues.find((i) => i.type === 'client_errors_4xx')?.count).toBe(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/parsers/technical/responseCodes.parser.test.ts`
Expected: FAIL on the first test — current parser counts 3 (all 4xx), not 1. (If the constructor signature is wrong, fix the test setup to match an existing parser test first, then re-run.)

- [ ] **Step 4: Implement the internal-scope filter**

In `lib/parsers/technical/responseCodes.parser.ts`, after the existing column lookups (after line 13 `const statusCol = this.findColumn(['Status Code', 'Status']);`), add:

```ts
    // Optional internal-scope column. SF response-code exports may carry an
    // `Internal` boolean or a `Type` (Internal/External) column. When present,
    // client_errors_4xx counts ONLY internal pages — external 4xx targets are
    // covered by broken_external_links. When absent, behavior is unchanged.
    const internalCol = this.findColumn(['Internal', 'Type']);
    const isInternalRow = (row: Record<string, unknown>): boolean => {
      if (!internalCol) return true; // no scope info → count all (legacy)
      const v = toString(row[internalCol]).trim().toLowerCase();
      return v === 'true' || v === 'internal' || v === 'yes' || v === '1';
    };
```

Then guard the 4xx branch inside the row loop. Change:

```ts
        if (code >= 400 && code < 500) {
          clientCount++;
          if (addressCol && clientErrorUrls.length < 30) {
            clientErrorUrls.push(toString(this.data[i][addressCol]));
          }
        }
```

to:

```ts
        if (code >= 400 && code < 500) {
          if (!isInternalRow(this.data[i])) continue;
          clientCount++;
          if (addressCol && clientErrorUrls.length < 30) {
            clientErrorUrls.push(toString(this.data[i][addressCol]));
          }
        }
```

Note: `continue` skips this row entirely (it is an external 4xx), which is correct — external dead links are reported by the external-links path, not here. The `distribution` map above still records all status codes (computed before this branch), preserving the status-code histogram.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/parsers/technical/responseCodes.parser.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/parsers/technical/responseCodes.parser.ts lib/parsers/technical/responseCodes.parser.test.ts
git commit -m "fix(seo): scope client_errors_4xx to internal pages when scope column present

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Phase 1 verification gate**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green. If the production build surfaces an issue with `remark-gfm` ESM interop, confirm `remark-gfm` is in `dependencies` (not `devDependencies`) and re-run.

---

# Phase 2 — Expected-exports manifest + parser routing fixes

## Task 6: Expected-exports manifest + `matchExpectedExports` helper

**Files:**
- Create: `lib/parsers/expected-exports.ts`
- Create: `lib/parsers/expected-exports.test.ts`

This module is PURE TypeScript — no parser-class imports, no `papaparse`, no Node APIs — so it is safe to import from client components. It describes expected-file COVERAGE only; it is NOT a parser resolver (`findParserForFile` remains authoritative server-side).

- [ ] **Step 1: Write the failing test**

Create `lib/parsers/expected-exports.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  EXPECTED_EXPORTS,
  matchExpectedExports,
  missingCoreExports,
} from './expected-exports';

describe('expected-exports manifest', () => {
  it('marks internal_all and response_codes as the two core exports', () => {
    const core = EXPECTED_EXPORTS.filter((e) => e.tier === 'core').map((e) => e.id);
    expect(core).toContain('internal_all');
    expect(core).toContain('response_codes');
    expect(core).toHaveLength(2);
  });

  it('matches an uploaded internal_all.csv to the internal_all export (case-insensitive)', () => {
    const cov = matchExpectedExports(['Internal_All.csv', 'response_codes_all.csv']);
    const internal = cov.find((c) => c.export.id === 'internal_all');
    expect(internal?.present).toBe(true);
    expect(internal?.matchedFile).toBe('Internal_All.csv');
  });

  it('reports both core exports missing when only a non-core file is uploaded', () => {
    const missing = missingCoreExports(['images_missing_alt_text.csv']).map((e) => e.id);
    expect(missing).toContain('internal_all');
    expect(missing).toContain('response_codes');
  });

  it('reports no missing core when both core files are present', () => {
    expect(missingCoreExports(['internal_all.csv', 'response_codes_all.csv'])).toHaveLength(0);
  });

  it('every export has non-empty patterns and SF instructions (SEMRush flagged notExpectedFromSf)', () => {
    for (const e of EXPECTED_EXPORTS) {
      expect(e.filenamePatterns.length).toBeGreaterThan(0);
      if (e.notExpectedFromSf) continue;
      expect(e.sfInstructions.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/parsers/expected-exports.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the manifest + helpers**

Create `lib/parsers/expected-exports.ts`. SF instruction text is taken from the handoff §4 / existing `UploadChecklist`; correct any stale menu paths during review.

```ts
// lib/parsers/expected-exports.ts
//
// Single source of truth for "what a complete Screaming Frog crawl looks like"
// for the technical-SEO workflow. PURE module (no parser classes, no papaparse)
// so it is safe to import from client components. This describes expected-file
// COVERAGE only — it is NOT a parser resolver. findParserForFile() remains the
// authoritative parser selector on the server.

export type ExportTier = 'core' | 'recommended' | 'optional';

export interface ExpectedExport {
  /** stable key */
  id: string;
  /** human label for the checklist */
  label: string;
  /** case-insensitive filename substrings; any match = present */
  filenamePatterns: string[];
  tier: ExportTier;
  /** "enable this in Screaming Frog" guidance shown when missing */
  sfInstructions: string;
  /** true for non-SF (SEMRush) inputs — never flagged as an SF crawl gap */
  notExpectedFromSf?: boolean;
}

export const EXPECTED_EXPORTS: ExpectedExport[] = [
  {
    id: 'internal_all',
    label: 'Internal — All',
    filenamePatterns: ['internal_all'],
    tier: 'core',
    sfInstructions: 'Bulk Export → Internal → All. The core crawl (titles, H1s, meta, status, depth, indexability).',
  },
  {
    id: 'response_codes',
    label: 'Response Codes',
    filenamePatterns: ['response_codes'],
    tier: 'core',
    sfInstructions: 'Bulk Export → Response Codes (prefer the Internal export so 4xx counts exclude external link targets).',
  },
  {
    id: 'page_titles',
    label: 'Page Titles',
    filenamePatterns: ['page_titles'],
    tier: 'recommended',
    sfInstructions: 'Bulk Export → Page Titles → All. Powers duplicate/missing/short title detection with per-URL groups.',
  },
  {
    id: 'meta_description',
    label: 'Meta Descriptions',
    filenamePatterns: ['meta_description'],
    tier: 'recommended',
    sfInstructions: 'Bulk Export → Meta Description → All.',
  },
  {
    id: 'h1',
    label: 'H1',
    filenamePatterns: ['h1_'],
    tier: 'recommended',
    sfInstructions: 'Bulk Export → H1 → All.',
  },
  {
    id: 'images_missing_alt_text',
    label: 'Images Missing Alt Text',
    filenamePatterns: ['images_missing_alt_text'],
    tier: 'recommended',
    sfInstructions: 'Bulk Export → Images → Missing Alt Text. Per-image accessibility & image-SEO list.',
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    filenamePatterns: ['accessibility'],
    tier: 'optional',
    sfInstructions: 'Config → Spider → Rendering = JavaScript, enable Accessibility; then Bulk Export → Accessibility.',
  },
  {
    id: 'exact_duplicates',
    label: 'Exact Duplicates',
    filenamePatterns: ['exact_duplicates'],
    tier: 'optional',
    sfInstructions: 'Config → Content → Duplicates; then Reports → Duplicates → Exact.',
  },
  {
    id: 'low_content',
    label: 'Low Content Pages',
    filenamePatterns: ['low_content'],
    tier: 'optional',
    sfInstructions: 'Enable content analysis; then Bulk Export → Content → Low Content Pages.',
  },
  {
    id: 'redirect_chains',
    label: 'Redirect Chains',
    filenamePatterns: ['redirect_chains'],
    tier: 'optional',
    sfInstructions: 'Reports → Redirects → Redirect Chains.',
  },
  {
    id: 'all_redirects',
    label: 'All Redirects',
    // NOTE: reconcile against the real SF export filename in Task 8.
    filenamePatterns: ['all_redirects', 'redirects'],
    tier: 'optional',
    sfInstructions: 'Reports → Redirects → All Redirects.',
  },
  {
    id: 'pagespeed',
    label: 'PageSpeed (CWV)',
    filenamePatterns: ['pagespeed'],
    tier: 'optional',
    sfInstructions: 'Configure the PageSpeed Insights API in SF; then Bulk Export → PageSpeed. Adds Core Web Vitals.',
  },
  {
    id: 'search_console',
    label: 'Search Console',
    filenamePatterns: ['search_console'],
    tier: 'optional',
    sfInstructions: 'Connect Search Console in SF; then Bulk Export → Search Console. Adds clicks/impressions/position.',
  },
  {
    id: 'semrush_organic_positions',
    label: 'SEMRush Organic Positions',
    filenamePatterns: ['organic.positions', 'organic_positions'],
    tier: 'optional',
    sfInstructions: 'Not a Screaming Frog export — SEMRush → Organic Research → Positions.',
    notExpectedFromSf: true,
  },
];

export interface ExportCoverage {
  export: ExpectedExport;
  present: boolean;
  matchedFile?: string;
}

/**
 * Case-insensitive substring match of uploaded filenames against the manifest,
 * mirroring findParserForFile's filename pass — but without importing parser
 * classes (client-safe).
 */
export function matchExpectedExports(filenames: string[]): ExportCoverage[] {
  const lower = filenames.map((f) => ({ orig: f, lc: f.toLowerCase() }));
  return EXPECTED_EXPORTS.map((exp) => {
    const hit = lower.find(({ lc }) =>
      exp.filenamePatterns.some((p) => lc.includes(p.toLowerCase()))
    );
    return { export: exp, present: !!hit, matchedFile: hit?.orig };
  });
}

/** Core exports (tier 'core') that are NOT covered by the uploaded files. */
export function missingCoreExports(filenames: string[]): ExpectedExport[] {
  return matchExpectedExports(filenames)
    .filter((c) => c.export.tier === 'core' && !c.present)
    .map((c) => c.export);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/parsers/expected-exports.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/expected-exports.ts lib/parsers/expected-exports.test.ts
git commit -m "feat(seo): expected-exports manifest + matchExpectedExports helper (client-safe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Reorder so `InsecureContentParser` wins the insecure-content file

**Background (verified):** `SecurityParser.filenamePattern = ['security_all', 'security']`. In `findParserForFile`'s ordered loop, `SecurityParser` (PARSERS index ~97) is checked before `InsecureContentParser` (~98). The bare `'security'` substring matches `security_form_url_insecure.csv`, orphaning the insecure file. Reordering (check `InsecureContentParser` first) is robust regardless of SF's real security-export filename, because `security_form_url_insecure.csv` contains `'insecure'` while a pure `security*.csv` does not.

**Files:**
- Modify: `lib/parsers/index.ts`
- Create: `lib/parsers/index.routing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/parsers/index.routing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findParserForFile } from './index';

describe('findParserForFile — security vs insecure-content routing', () => {
  it('routes a *_insecure.csv file to InsecureContentParser, not SecurityParser', () => {
    const parser = findParserForFile('security_form_url_insecure.csv');
    expect(parser?.parserKey).toBe('insecurecontent');
  });

  it('routes a security headers export to SecurityParser', () => {
    const parser = findParserForFile('security_all.csv');
    expect(parser?.parserKey).toBe('security');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/parsers/index.routing.test.ts`
Expected: FAIL on the first test — currently resolves to `security`.

- [ ] **Step 3: Reorder the registry**

In `lib/parsers/index.ts`, in the `PARSERS` array (Resources block ~90–102), move `InsecureContentParser` so it is listed BEFORE `SecurityParser`. Change:

```ts
  ExternalLinksParser,
  LinksIssuesParser,
  SecurityParser,
  InsecureContentParser,
  SitemapsParser,
```

to:

```ts
  ExternalLinksParser,
  LinksIssuesParser,
  InsecureContentParser,
  SecurityParser,
  SitemapsParser,
```

Add a short comment above `InsecureContentParser`: `// Must precede SecurityParser: SecurityParser's bare 'security' pattern would otherwise swallow security_*_insecure.csv.`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/parsers/index.routing.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/index.ts lib/parsers/index.routing.test.ts
git commit -m "fix(seo): route *_insecure.csv to InsecureContentParser (order before SecurityParser)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Remove orphaned `ResponseTimeParser`; reconcile redirect patterns

**Background:** `ResponseTimeParser` (`filenamePattern = 'response_time'`) matches no standalone SF export — response time is a column in `internal_all`. Remove its registration. `RedirectsParser` (`'redirects'`) and `RedirectChainsParser` (`'redirect_chains'`): confirm against real SF export filenames and reconcile with the manifest's `all_redirects` entry.

**Files:**
- Modify: `lib/parsers/index.ts`

- [ ] **Step 1: Confirm nothing else depends on the `responsetime` parser key**

Run: `grep -rn "responsetime\|ResponseTimeParser\|response_time" lib app components --include=*.ts --include=*.tsx | grep -v test`
Expected: references only in `lib/parsers/index.ts` (registration), `lib/parsers/performance/responseTime.parser.ts` (definition), and possibly its index re-export. If `responsetime` is read in the aggregator or any results component, STOP and repoint it to read response-time from `internal_all` instead of removing.

- [ ] **Step 2: Remove the registration**

In `lib/parsers/index.ts`:
- Remove `ResponseTimeParser` from the `PARSERS` array (Performance block, the line after `PageSpeedParser`).
- Remove the `responsetime: ResponseTimeParser,` line from `PARSER_MAP`.
- Remove the `ResponseTimeParser` import if it is no longer referenced.

Leave the parser file (`lib/parsers/performance/responseTime.parser.ts`) in place but unregistered, OR delete it — deletion is cleaner since it has no standalone export. If deleting, also remove it from any barrel re-export in `lib/parsers/performance/index.ts`.

- [ ] **Step 3: Reconcile redirect filename patterns against real SF exports**

Run: `ls /Users/kevin/enrollment-resources/sf-crawls/pro-way-hair-school/*/ 2>/dev/null | grep -iE "redirect"`
Then verify:
- `RedirectChainsParser` pattern `'redirect_chains'` matches SF's `Reports → Redirects → Redirect Chains` export filename.
- `RedirectsParser` pattern `'redirects'` matches SF's `Reports → Redirects → All Redirects` export filename. If SF exports it as `all_redirects.csv`, add `'all_redirects'` to `RedirectsParser.filenamePattern` so `static filenamePattern = ['all_redirects', 'redirects'];`, and ensure it does NOT collide with `response_codes_redirection_(3xx).csv` (matched by `responsecodes`) — `'redirects'` does not substring-match `redirection`, so they are distinct.

Align the manifest `all_redirects` entry's `filenamePatterns` (Task 6) with whatever pattern you finalize here.

- [ ] **Step 4: Typecheck + run parser tests**

Run: `npx tsc --noEmit && npx vitest run lib/parsers`
Expected: PASS; no unresolved `ResponseTimeParser` references.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/index.ts lib/parsers/performance lib/parsers/expected-exports.ts
git commit -m "fix(seo): drop orphaned ResponseTimeParser; reconcile redirect export patterns

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Phase 2 verification gate**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green.

---

# Phase 3 — Frontloaded upload checklist + server core gate

## Task 9: Dynamic `UploadChecklist`

Rewrite the static checklist to take the uploaded filenames and render present/missing per expected export, with SF enable-instructions for missing ones and a prominent block when a core export is missing.

**Files:**
- Modify: `components/seo-parser/UploadChecklist.tsx`
- Create: `components/seo-parser/UploadChecklist.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `components/seo-parser/UploadChecklist.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { UploadChecklist } from './UploadChecklist';

describe('UploadChecklist', () => {
  it('shows a blocking core warning when core exports are missing', () => {
    const { container } = render(<UploadChecklist files={['images_missing_alt_text.csv']} />);
    const text = container.textContent ?? '';
    expect(text.toLowerCase()).toContain('internal');
    expect(text.toLowerCase()).toContain('response codes');
    // SF instruction surfaced for a missing core export
    expect(text.toLowerCase()).toContain('bulk export');
  });

  it('clears the core warning when both core files are present', () => {
    const { container } = render(
      <UploadChecklist files={['internal_all.csv', 'response_codes_all.csv']} />
    );
    expect((container.querySelector('[data-testid="core-missing"]'))).toBeNull();
  });

  it('renders with no files (initial state) without throwing', () => {
    const { container } = render(<UploadChecklist files={[]} />);
    expect(container.textContent).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/seo-parser/UploadChecklist.test.tsx`
Expected: FAIL — current `UploadChecklist` takes no props / has no `data-testid`.

- [ ] **Step 3: Rewrite the component**

Overwrite `components/seo-parser/UploadChecklist.tsx`:

```tsx
'use client';
import React from 'react';
import { matchExpectedExports, type ExportTier } from '@/lib/parsers/expected-exports';

const TIER_LABEL: Record<ExportTier, string> = {
  core: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
};

export function UploadChecklist({ files }: { files: string[] }) {
  const coverage = matchExpectedExports(files);
  const missingCore = coverage.filter((c) => c.export.tier === 'core' && !c.present);

  return (
    <div className="text-sm text-gray-600 dark:text-white/60 space-y-3">
      {missingCore.length > 0 && (
        <div
          data-testid="core-missing"
          className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300"
        >
          <p className="font-semibold">
            Missing required export{missingCore.length > 1 ? 's' : ''}:{' '}
            {missingCore.map((c) => c.export.label).join(', ')}
          </p>
          <ul className="mt-1 list-disc ml-5 space-y-1">
            {missingCore.map((c) => (
              <li key={c.export.id}>{c.export.sfInstructions}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">Add these before analyzing — the audit can&apos;t run without them.</p>
        </div>
      )}

      <details>
        <summary className="cursor-pointer font-medium text-[#1c2d4a] dark:text-white">
          Crawl coverage ({coverage.filter((c) => c.present).length}/{coverage.length} expected exports)
        </summary>
        <ul className="mt-2 space-y-1">
          {coverage.map((c) => (
            <li key={c.export.id} className="flex items-start gap-2">
              <span className={c.present ? 'text-green-500' : 'text-gray-400 dark:text-white/30'} aria-hidden>
                {c.present ? '✓' : '○'}
              </span>
              <span>
                <span className="text-[#1c2d4a] dark:text-white">{c.export.label}</span>{' '}
                <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-white/40">
                  {TIER_LABEL[c.export.tier]}
                </span>
                {!c.present && !c.export.notExpectedFromSf && (
                  <span className="block text-xs text-gray-500 dark:text-white/50">{c.export.sfInstructions}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/seo-parser/UploadChecklist.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/seo-parser/UploadChecklist.tsx components/seo-parser/UploadChecklist.test.tsx
git commit -m "feat(seo): dynamic UploadChecklist with per-export coverage + core-missing block

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Wire the checklist into the upload page + disable Analyze on missing core

**Files:**
- Modify: `app/seo-parser/page.tsx`

- [ ] **Step 1: Pass files to the checklist and compute the core-missing gate**

In `app/seo-parser/page.tsx`:

Add the import near the top:

```ts
import { missingCoreExports } from '@/lib/parsers/expected-exports';
```

Inside `SEOParserPage`, after the `error` state declaration, derive the gate from `files`:

```ts
  const coreMissing = files.length > 0 ? missingCoreExports(files) : [];
```

Change the checklist render from `<UploadChecklist />` to:

```tsx
            <UploadChecklist files={files} />
```

- [ ] **Step 2: Disable Analyze when core is missing**

Change the Analyze button's `disabled` prop from:

```tsx
                disabled={isParsing || isUploading}
```

to:

```tsx
                disabled={isParsing || isUploading || coreMissing.length > 0}
```

And give the user a reason near the buttons (after the action row, inside the `files.length > 0` block):

```tsx
              {coreMissing.length > 0 && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  Add {coreMissing.map((c) => c.label).join(' and ')} to enable analysis.
                </p>
              )}
```

(Place the paragraph immediately after the closing `</div>` of the button row but still within the `files.length > 0 && (...)` block — wrap the row + paragraph in a fragment if needed.)

- [ ] **Step 3: Typecheck + manual smoke**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run dev` and visit `/seo-parser`. Drop only `images_missing_alt_text.csv` → checklist shows the red core-missing block and the Analyze button is disabled with the reason line. Add `internal_all.csv` + `response_codes_all.csv` → block clears, Analyze enabled. (Stop the dev server after verifying.)

- [ ] **Step 4: Commit**

```bash
git add app/seo-parser/page.tsx
git commit -m "feat(seo): frontload export coverage on upload; disable Analyze until core present

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Server core gate in the parse route (technical workflow only)

**Background (verified):** The `Session` model has a `workflow` field (`'technical' | 'keyword-research'`, default `'technical'`). `app/api/parse/[sessionId]/route.ts` already reads `session.workflow` to gate pillar analysis. Add the core-export gate after the session fetch and the `status !== 'pending'` check, BEFORE the `updateMany` claim (so a rejected parse leaves the session `pending`, not stranded in `parsing`). Gate applies only to the technical workflow; keyword-research/SEMRush-only sessions are never gated.

**Files:**
- Modify: `app/api/parse/[sessionId]/route.ts`
- Create: `app/api/parse/[sessionId]/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/parse/[sessionId]/route.test.ts` (mirrors `app/api/upload/route.test.ts` mocking style):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionFindUniqueMock = vi.fn();
const sessionUpdateManyMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    session: {
      findUnique: (...a: unknown[]) => sessionFindUniqueMock(...a),
      updateMany: (...a: unknown[]) => sessionUpdateManyMock(...a),
    },
  },
}));

// Keep the heavy parse pipeline + pillar trigger out of the gate test.
vi.mock('@/lib/services/aggregator.service', () => ({ AggregatorService: class {} }));
vi.mock('./pillar-analysis-trigger', () => ({ triggerPillarAnalysis: vi.fn() }));

import { POST } from './route';

const VALID_ID = '64c1a005-40e9-40d8-a62c-e4226cc78c0b';
const ctx = { params: Promise.resolve({ sessionId: VALID_ID }) };

describe('POST /api/parse/[sessionId] — core-export gate', () => {
  beforeEach(() => {
    sessionFindUniqueMock.mockReset();
    sessionUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects a technical session missing core exports without claiming it', async () => {
    sessionFindUniqueMock.mockResolvedValue({
      id: VALID_ID,
      status: 'pending',
      workflow: 'technical',
      files: JSON.stringify(['images_missing_alt_text.csv']),
    });

    const res = await POST({} as never, ctx as never);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.toLowerCase()).toContain('internal');
    expect(body.missingCore).toContain('internal_all');
    expect(sessionUpdateManyMock).not.toHaveBeenCalled(); // not claimed
  });

  it('does NOT gate a keyword-research session', async () => {
    sessionFindUniqueMock.mockResolvedValue({
      id: VALID_ID,
      status: 'pending',
      workflow: 'keyword-research',
      files: JSON.stringify(['semrush_organic_positions.csv']),
    });

    const res = await POST({} as never, ctx as never);
    // Past the gate, it proceeds to claim (status 200/other) — NOT a 400 core-missing rejection.
    expect(res.status).not.toBe(400);
    expect(sessionUpdateManyMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/parse/[sessionId]/route.test.ts`
Expected: FAIL — first test gets a non-400 (no gate yet) / `body.missingCore` undefined. (If unrelated imports in `route.ts` break the test environment, add minimal `vi.mock` stubs for those modules mirroring the example; do not change runtime behavior.)

- [ ] **Step 3: Implement the gate**

In `app/api/parse/[sessionId]/route.ts`:

Add the import at the top:

```ts
import { missingCoreExports } from '@/lib/parsers/expected-exports';
```

After the `if (session.status !== 'pending') { ... }` block and BEFORE the `const claim = await prisma.session.updateMany(...)` call, insert:

```ts
    // Core-export gate (technical workflow only). Keyword-research/SEMRush-only
    // sessions are never gated. Runs before claiming so a rejected parse leaves
    // the session 'pending' (the user can add the missing exports and retry).
    if (session.workflow !== 'keyword-research') {
      let filesForGate: string[] = [];
      try {
        const parsed = JSON.parse(session.files);
        if (Array.isArray(parsed)) {
          filesForGate = parsed.filter((f): f is string => typeof f === 'string');
        }
      } catch {
        /* corrupt manifest is handled by the existing parse below */
      }
      const missing = missingCoreExports(filesForGate);
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `Missing required Screaming Frog export(s): ${missing
              .map((m) => m.label)
              .join(', ')}. ${missing.map((m) => m.sfInstructions).join(' ')}`,
            missingCore: missing.map((m) => m.id),
          },
          { status: 400 }
        );
      }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/api/parse/[sessionId]/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/api/parse/[sessionId]/route.ts app/api/parse/[sessionId]/route.test.ts
git commit -m "feat(seo): server core-export gate in parse route (technical workflow only)

Rejects a technical-workflow parse missing internal_all/response_codes before
claiming the session; keyword-research/SEMRush-only sessions are never gated.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Phase 3 + full verification gate**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green.

---

## Final: deploy

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin feat/seo-roadmap-render-dedup-upload-checklist
gh pr create --fill --base main
```

- [ ] **Step 2: After merge, deploy per CLAUDE.md**

```bash
ssh seo@144.126.213.242 "~/deploy.sh"
```

- [ ] **Step 3: Smoke-test in production**

- Open the nuvani results page roadmap → confirm Duplicate Content and Implementation Order render as real tables.
- Confirm the issue list shows a single `duplicate_title` / `duplicate_meta_description` / `duplicate_h1` (no `_tags`/`_descriptions`/`duplicate_titles` doubles).
- On `/seo-parser`, drop a non-core file → core-missing block + disabled Analyze; add core files → clears.

---

## Open verification items (carry from spec — resolve while implementing)

- Real SF response-code export filenames + whether the core file is internal-only (Tasks 5, 6, 8).
- Actual internal-scope column name in the response-code CSV (Task 5 Step 1).
- Confirm the `missing_h2` curated emitter exists (Task 4 Step 4).
- Confirm `KeywordMemoMarkdown`'s exact export + prop name (Task 2 Step 3).
- Whether `issues_overview` warrants a `recommended` manifest entry (Task 6 — additive, non-blocking; add if desired).
