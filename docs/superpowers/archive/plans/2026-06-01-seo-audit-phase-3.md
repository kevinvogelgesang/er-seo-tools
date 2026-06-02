# SEO Audit Overhaul — Phase 3 Implementation Plan (Persist the page index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Promote the in-memory page index to a queryable `SessionPage` table + denormalized scalar columns on `Session`, written at parse-finalize — and add a per-URL "Crawled Pages" drill-down that reads the table, so the dashboard finally surfaces per-page detail without deserializing the result blob.

**Architecture:** Phase 1 already builds `result.page_index` (PageIndexEntry[] with refs into `result.url_registry`) and the per-issue `affectedUrlRefs`. Phase 3 (1) at parse-finalize, **rehydrates each page ref → absolute URL** and writes one `SessionPage` row per crawled URL (metadata + `issueTypes` + `issueCount`), plus denormalized scalars on `Session`, in a single transaction (delete-then-insert for re-parse idempotency); (2) exposes a paginated read API; (3) renders a sortable/filterable Pages table that opens the existing `PageDetailModal`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-seo-audit-overhaul-design.md` (Phase 3 + §5a). Builds on Phase 1/2 (branch stacked on `feat/seo-audit-phase-2`).

**Verify:** `npx tsc --noEmit` · `npx vitest run <path>` · `npm run build` · migrations via `npx prisma migrate dev --name <name>`.

---

## Design decisions (locked)

- **`SessionPage` = one row per CRAWLED page** (from `result.page_index`). Refs are **rehydrated to absolute URLs at write time** (via `rehydrate()` from `lib/services/url-registry.ts`), so the read path never needs the registry.
- **No separate `urlRegistry` column.** The full registry (incl. external/resource/redirect refs that aren't crawled pages) already rides in `result` (the blob). Resolving crawled-page URLs into `SessionPage.url` satisfies Phase 3's drill-down without a redundant column. *(Flagged for Codex review — if P4 Teamwork later needs the registry out-of-blob, add it then. YAGNI now.)*
- **Denormalized scalars on `Session`:** `siteHost`, `totalUrls`, `criticalCount`, `warningCount`, `noticeCount` (power history/trends in P5 without parsing the blob). The composite health score stays dropped (Phase 1 D8).
- **`issueCount Int` on `SessionPage`** for cheap server-side sorting; `issueTypes` stored as a JSON string (filter via Prisma `contains`).
- **Idempotent on re-parse:** delete existing `SessionPage` rows for the session, then `createMany`.
- **Historical tolerance:** no backfill. Old sessions have no `SessionPage` rows / null scalars; the Pages view shows an empty/"re-parse to populate" state, never errors.
- **Drill-down reuse:** the new Pages table opens the existing `PageDetailModal` (which reads the in-memory `result` already passed to `ResultsView`) — no modal rewrite.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `prisma/schema.prisma` + migration | `SessionPage` model + `Session` scalar columns + relation | 1 |
| `lib/services/session-page-builder.ts` (+ test) | pure: `buildSessionPages(sessionId, result)` → `{ pages, scalars }` (rehydrate, issueCount, scalars) | 2 |
| `app/api/parse/[sessionId]/route.ts` | persist pages + scalars at finalize (transaction) | 3 |
| `app/api/seo-parser/[sessionId]/pages/route.ts` (+ test) | paginated/filtered/sorted read | 4 |
| `components/seo-parser/PagesTable.tsx` + `ResultsView.tsx` | Crawled Pages drill-down section | 5 |

---

## Task 1: `SessionPage` model + `Session` scalars + migration

**Files:** Modify `prisma/schema.prisma`; generate migration.

- [ ] **Step 1: Add the `SessionPage` model:**

```prisma
model SessionPage {
  id              String   @id @default(cuid())
  sessionId       String
  session         Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  url             String
  title           String?
  h1              String?
  metaDescription String?
  wordCount       Int?
  crawlDepth      Int?
  indexable       Boolean  @default(true)
  issueTypes      String   @default("[]") // JSON string[]
  issueCount      Int      @default(0)

  @@index([sessionId])
  @@index([sessionId, issueCount])
}
```

- [ ] **Step 2: Add scalar columns + relation to `Session`** (additive; all nullable so old rows are fine):

```prisma
  siteHost        String?
  totalUrls       Int?
  criticalCount   Int?
  warningCount    Int?
  noticeCount     Int?
  pages           SessionPage[]
```

- [ ] **Step 3: Migrate**

Run: `npx prisma migrate dev --name session_page` (use the same local-dev DATABASE_URL override pattern the `seo_roadmap` migration used if the default path needs root). Verify the SQL creates `SessionPage` with the two indexes and `ALTER TABLE "Session" ADD COLUMN` for the five scalars. If it wants interactive input or the dev DB is unreachable, STOP and report BLOCKED.

- [ ] **Step 4:** `npx tsc --noEmit` → PASS (client now exposes `prisma.sessionPage` + `Session` scalars).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(seo): SessionPage table + denormalized Session scalars"
```
(End each commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task 2: `session-page-builder.ts` (pure builder + test)

**Files:** Create `lib/services/session-page-builder.ts`, `lib/services/session-page-builder.test.ts`. Pure transform — no Prisma — so it's fully unit-testable; Task 3 does the DB write.

- [ ] **Step 1: Write the failing test:**

```typescript
import { describe, it, expect } from 'vitest';
import { buildSessionPages } from './session-page-builder';
import type { AggregatedResult } from '@/lib/types';

function makeResult(): AggregatedResult {
  // Minimal shape with a url_registry + page_index + issues.
  return {
    crawl_summary: { total_urls: 2 } as AggregatedResult['crawl_summary'],
    issues: {
      critical: [{ type: 'missing_title', severity: 'critical', count: 1, description: '' }],
      warnings: [{ type: 'thin_content', severity: 'warning', count: 1, description: '' }],
      notices: [],
    },
    site_structure: {} as AggregatedResult['site_structure'],
    resources: {} as AggregatedResult['resources'],
    technical_seo: {} as AggregatedResult['technical_seo'],
    performance: {} as AggregatedResult['performance'],
    recommendations: [],
    metadata: { files_processed: [], parsers_used: [], total_parsers_available: 0, site_name: 'x.edu' },
    url_registry: {
      sessionOrigin: { scheme: 'https', host: 'x.edu' },
      hosts: ['x.edu'],
      urls: [
        { id: 0, kind: 'page', scheme: 'https', hostId: 0, path: '/a' },
        { id: 1, kind: 'page', scheme: 'https', hostId: 0, path: '/b' },
      ],
    },
    page_index: [
      { ref: 0, title: null, h1: 'A', metaDescription: 'm', wordCount: 100, crawlDepth: 0, indexable: true, issueTypes: ['missing_title'] },
      { ref: 1, title: 'B', h1: 'B', metaDescription: 'm', wordCount: 50, crawlDepth: 1, indexable: true, issueTypes: ['thin_content'] },
    ],
  } as AggregatedResult;
}

describe('buildSessionPages', () => {
  it('builds one row per page with rehydrated url, issueTypes and issueCount', () => {
    const { pages } = buildSessionPages('sess1', makeResult());
    expect(pages).toHaveLength(2);
    const a = pages.find(p => p.url === 'https://x.edu/a')!;
    expect(a.sessionId).toBe('sess1');
    expect(a.issueCount).toBe(1);
    expect(JSON.parse(a.issueTypes)).toEqual(['missing_title']);
    expect(a.title).toBeNull();
  });
  it('computes scalars from crawl summary + issue counts', () => {
    const { scalars } = buildSessionPages('sess1', makeResult());
    expect(scalars).toEqual({ siteHost: 'x.edu', totalUrls: 2, criticalCount: 1, warningCount: 1, noticeCount: 0 });
  });
  it('returns empty pages + scalars when no page_index/url_registry (no internal_all uploaded)', () => {
    const r = makeResult(); delete (r as Record<string, unknown>).page_index; delete (r as Record<string, unknown>).url_registry;
    const { pages, scalars } = buildSessionPages('s', r);
    expect(pages).toEqual([]);
    expect(scalars.totalUrls).toBe(2);        // still from crawl_summary
    expect(scalars.criticalCount).toBe(1);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run lib/services/session-page-builder.test.ts`; FAIL.

- [ ] **Step 3: Implement:**

```typescript
import type { AggregatedResult, Prisma } from '@/lib/types-or-prisma'; // see note
import { rehydrate } from './url-registry';

export interface SessionPageScalars {
  siteHost: string | null;
  totalUrls: number;
  criticalCount: number;
  warningCount: number;
  noticeCount: number;
}

export interface SessionPageRow {
  sessionId: string;
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  wordCount: number | null;
  crawlDepth: number | null;
  indexable: boolean;
  issueTypes: string;  // JSON
  issueCount: number;
}

export function buildSessionPages(
  sessionId: string,
  result: AggregatedResult,
): { pages: SessionPageRow[]; scalars: SessionPageScalars } {
  const reg = result.url_registry;
  const pageIndex = result.page_index ?? [];

  const pages: SessionPageRow[] = reg
    ? pageIndex.map((p) => {
        const issueTypes = p.issueTypes ?? [];
        return {
          sessionId,
          url: rehydrate(reg, p.ref),
          title: p.title,
          h1: p.h1,
          metaDescription: p.metaDescription,
          wordCount: p.wordCount,
          crawlDepth: p.crawlDepth,
          indexable: p.indexable,
          issueTypes: JSON.stringify(issueTypes),
          issueCount: issueTypes.length,
        };
      })
    : [];

  const scalars: SessionPageScalars = {
    // Prefer the detected site_name; the registry origin can be a 'localhost' placeholder
    // when no internal_all was uploaded (empty registry before site_name detection).
    siteHost: result.metadata.site_name ?? reg?.sessionOrigin.host ?? null,
    totalUrls: result.crawl_summary?.total_urls ?? pageIndex.length,
    // NOTE: these are ISSUE-TYPE counts (issues.*.length), NOT affected-page counts.
    // Label them as such wherever P5 trends consume them, to avoid confusion.
    criticalCount: result.issues.critical.length,
    warningCount: result.issues.warnings.length,
    noticeCount: result.issues.notices.length,
  };

  return { pages, scalars };
}
```
**Note on the import:** use the existing `AggregatedResult` type from `@/lib/types`. Drop the `Prisma` import in the snippet above — `SessionPageRow` is a plain DTO (the persist step in Task 3 maps it to `prisma.sessionPage.createMany({ data })`, which accepts this shape since every field matches a column). Don't import Prisma types here. Read `lib/types/index.ts` to confirm `AggregatedResult.crawl_summary.total_urls` is the right path; adjust if the field is nested differently.

- [ ] **Step 4:** Test PASS; `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/services/session-page-builder.ts lib/services/session-page-builder.test.ts
git commit -m "feat(seo): pure session-page builder (rehydrate + scalars)"
```

---

## Task 3: Persist at parse-finalize

**Files:** Modify `app/api/parse/[sessionId]/route.ts` (the finalize block at ~line 180, `prisma.session.update`).

- [ ] **Step 1: Implement** — replace the existing single `prisma.session.update({...})` finalize with: compute pages+scalars, then a transaction that (a) deletes old SessionPage rows, (b) createMany the new rows, (c) updates the Session with status/result/siteName/clientId **plus the scalars**. Read the current block (lines ~180-188) first.

```typescript
import { buildSessionPages } from '@/lib/services/session-page-builder';
// ...
const { pages, scalars } = buildSessionPages(sessionId, result);

// Chunk createMany — a single 1000-row insert can hit SQLite's bound-variable limit
// (each row binds ~10 params). 75 rows/chunk keeps us well under it.
const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
const pageChunks = chunk(pages, 75);

await prisma.$transaction([
  prisma.sessionPage.deleteMany({ where: { sessionId } }),
  ...pageChunks.map((data) => prisma.sessionPage.createMany({ data })),
  prisma.session.update({
    where: { id: sessionId },
    data: {
      status: 'complete',
      result: JSON.stringify(result),
      siteName: result.metadata.site_name ?? null,
      clientId,
      siteHost: scalars.siteHost,
      totalUrls: scalars.totalUrls,
      criticalCount: scalars.criticalCount,
      warningCount: scalars.warningCount,
      noticeCount: scalars.noticeCount,
    },
  }),
]);
```

Keep the subsequent `triggerPillarAnalysis(sessionId)` fire-and-forget exactly as-is, AFTER the transaction. (`pageChunks` is `[]` when there are no pages, so the spread contributes nothing — the deleteMany + update still run.)

- [ ] **Step 2: Verify no existing parse test breaks.** Run `npx vitest run app/api/parse` (if such tests exist) and `npx tsc --noEmit`. If there's a parse-route test that asserts the exact `session.update` call shape, update it to the transaction shape. Report what you found.

- [ ] **Step 3: Manual sanity (optional but recommended):** note in your report that full end-to-end persistence is verified in the Phase 3 exit checklist (it needs a real upload). Do not block on it here.

- [ ] **Step 4: Commit**

```bash
git add "app/api/parse/[sessionId]/route.ts"
git commit -m "feat(seo): persist SessionPage rows + Session scalars at parse finalize"
```

---

## Task 4: Paginated read API

**Files:** Create `app/api/seo-parser/[sessionId]/pages/route.ts` + `route.test.ts`.

- [ ] **Step 1: Implement** — `GET` with query params `limit` (default 50, max 200), `offset` (default 0), `issueType` (optional filter), `sort` (`issues` default | `wordCount` | `crawlDepth`). Returns `{ pages, total }`.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0);
  const issueType = sp.get('issueType') ?? undefined;
  const sort = sp.get('sort') ?? 'issues';

  const where = {
    sessionId,
    // Match the QUOTED JSON token so 'missing_title' matches the array element
    // "missing_title" and NOT a substring like "missing_title_something".
    ...(issueType ? { issueTypes: { contains: JSON.stringify(issueType) } } : {}),
  };
  const orderBy =
    sort === 'wordCount' ? { wordCount: 'asc' as const }
    : sort === 'crawlDepth' ? { crawlDepth: 'desc' as const }
    : { issueCount: 'desc' as const };

  const [rows, total] = await Promise.all([
    prisma.sessionPage.findMany({ where, orderBy, take: limit, skip: offset }),
    prisma.sessionPage.count({ where }),
  ]);

  return NextResponse.json({
    pages: rows.map((r) => ({ ...r, issueTypes: safeParse(r.issueTypes) })),
    total,
  });
}

function safeParse(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}
```
The `issueType` filter uses the QUOTED token (`{ issueTypes: { contains: JSON.stringify(issueType) } }`), which embeds the surrounding double-quotes, so `missing_title` matches the JSON element `"missing_title"` and NOT a substring like `missing_title_something`. Add a test proving that distinction. `wordCount` ascending puts NULLs first in SQLite — for the "Fewest words" sort, either filter `wordCount: { not: null }` or note that null-word pages sort first (acceptable; document the choice in the component).

- [ ] **Step 2: Test** `route.test.ts` — mock `@/lib/db` prisma. Cover: default pagination returns `{ pages, total }` with `issueTypes` parsed to arrays; `limit`/`offset` clamping; `issueType` filter passes a quoted-contains `where`; `sort=wordCount` vs default `issues` sets the right `orderBy`. (Assert the `where`/`orderBy`/`take`/`skip` passed to the mocked `findMany`.)

- [ ] **Step 3:** Test PASS; `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/seo-parser/[sessionId]/pages"
git commit -m "feat(seo): paginated SessionPage read API"
```

---

## Task 5: "Crawled Pages" drill-down table

**Files:** Create `components/seo-parser/PagesTable.tsx`; modify `components/seo-parser/ResultsView.tsx`.

- [ ] **Step 1: `PagesTable.tsx`** (client). Props: `{ sessionId: string; issueTypeOptions: string[]; onUrlClick: (url: string) => void }`.
  - Fetches `/api/seo-parser/${sessionId}/pages?limit=50&offset=${offset}&issueType=${filter}&sort=${sort}` (SWR or a `useEffect` + `useState`; follow whatever data-fetch pattern the codebase already uses in seo-parser components — check existing components; a plain `useEffect`+fetch is fine).
  - Renders a table: columns URL (truncated, clickable → `onUrlClick(url)`), Indexable (✓/✗), Words, Depth, Issues (the `issueCount` + small chips of `issueTypes`).
  - Controls: an issue-type `<select>` (options from `issueTypeOptions` + "All"), a sort `<select>` (Most issues / Fewest words / Deepest), and Prev/Next pagination using `total`.
  - Empty state: "No crawled-page data for this session — re-run the analysis with an internal_all.csv to populate per-page detail." (covers historical/blob-less sessions).
  - Match the existing seo-parser table styling (look at `IssueTabs`/`KeywordSignalsPanel` for the card/table classes + dark-mode variants).

- [ ] **Step 1b: Fix `PageDetailModal` issue matching (required — else the drill-down lies).** `components/seo-parser/PageDetailModal.tsx`'s `findIssuesForUrl` currently matches only `issue.urls?.includes(url)` — but `issue.urls` is the CAPPED sample. A page recovered via `affectedUrlRefs` (Phase 1) will then show "no tracked issues" even though `SessionPage.issueTypes` lists issues. Fix `findIssuesForUrl(url, result)` to ALSO match when the url is in the issue's `affectedUrlRefs` rehydrated through `result.url_registry`:
  - Build a `Set<string>` of affected URLs per issue: `(issue.affectedUrlRefs ?? []).map(ref => rehydrate(result.url_registry!, ref))` (guard when `url_registry` is absent), unioned with `issue.urls ?? []`.
  - Match if `url` is in that set.
  - Import `rehydrate` from `@/lib/services/url-registry`. Keep the existing `issue.urls` fallback for old sessions with no registry. Add/adjust a `PageDetailModal` test if one exists; otherwise this is covered by the exit checklist.

- [ ] **Step 2: Wire into `ResultsView.tsx`** — add a collapsible "Crawled Pages" section (a `<details>` or a section card) BELOW the charts row. Compute `issueTypeOptions` from the in-memory result (union of `result.issues.{critical,warnings,notices}[].type`). Pass `onUrlClick={(url) => setSelectedUrl(url)}` so it reuses the existing `PageDetailModal` (already wired to `selectedUrl`). Do not disturb existing sections.

- [ ] **Step 3:** `npx tsc --noEmit && npm run build`. Both PASS.

- [ ] **Step 4: Commit**

```bash
git add components/seo-parser/PagesTable.tsx components/seo-parser/ResultsView.tsx
git commit -m "feat(seo): Crawled Pages drill-down table (reads SessionPage)"
```

---

## Phase 3 Exit Verification

- [ ] `npx tsc --noEmit` clean; `npx vitest run lib app/api/seo-parser` green; `npm run build` succeeds; migration applies.
- [ ] Manual: re-parse a real session with an `internal_all.csv` → `SessionPage` rows exist (`prisma.sessionPage.count`), `Session` scalars populated → results page "Crawled Pages" section lists URLs, sorts by issues, filters by issue type, and clicking a row opens the per-URL modal.
- [ ] Re-parse the same session → no duplicate rows (delete-then-insert).
- [ ] A session with no `internal_all.csv` → empty Pages state, no error; scalars still set from crawl summary/issue counts.
- [ ] An OLD session (pre-Phase-3, no rows) → Pages section shows the empty/re-parse state gracefully.

## Out of scope (later phases)
- P4: structured recommendations + Teamwork push (will query `SessionPage` for affected URLs and/or the blob's `affectedUrlRefs`).
- P5: per-client history/trend using the new scalar columns; cross-crawl diff.
- P6: keyword research route.

## Notes / risk
- **No `urlRegistry` column** (resolved URLs live in `SessionPage.url`; full registry stays in the blob). Flagged for Codex — revisit if P4 needs the registry without the blob.
- **Bulk insert:** crawl cap is 1000 pages, so `createMany` is one batched insert — fine. The transaction (deleteMany + createMany + update) keeps finalize atomic; confirm the SQLite/Prisma `$transaction` array form is already used elsewhere (it is in ADA queue code) — mirror that style.
- **`issueTypes` per page** reflects the aggregator's `page_index` derivation (the 4 derivable types from Phase 1), not every parser issue touching the page. That's the per-page drill-down truth for now; richer per-page issue membership is a later enhancement.
