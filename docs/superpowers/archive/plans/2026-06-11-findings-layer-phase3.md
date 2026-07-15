# Findings Layer Phase 3 — SessionPage Reader Flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip `SessionPage`'s only reader to the normalized findings tables (`CrawlPage` + page-level `Finding` join) and stop writing `SessionPage` in the parse route, with a `SessionPage` fallback for pre-A2 sessions.

**Architecture:** `GET /api/seo-parser/[sessionId]/pages` looks up the session's `CrawlRun`; when present it queries `CrawlPage` with a `findings` relation join (issueTypes = the page's finding types ordered severity-then-type; issueCount = findings count; filter via `findings: { some: { type } }`; "most issues" sort via `orderBy: { findings: { _count: 'desc' } }`), keeping the response shape identical. When absent (pre-A2 session) it falls back to the existing `SessionPage` query verbatim. `PageDetailModal` switches to normalized-URL matching (the table now serves `normalizeFindingUrl`-normalized URLs, and the modal must match them against raw blob URLs) — which requires extracting `normalizeFindingUrl` into a client-safe module, since `lib/findings/keys.ts` imports node `crypto` and the modal is a `'use client'` component. The parse route keeps computing the Session scalar columns but no longer inserts `SessionPage` rows (the `deleteMany` stays for idempotence). The `SessionPage` model itself is NOT dropped — that lands ≥180 d post-flip, out of A2 scope.

**Codex review (2026-06-11, accept-with-fixes ×4, applied):** (1) `PageDetailModal` normalized-URL matching — Tasks 2–3; (2) one real-DB test for the `CrawlPage` relation query (`orderBy findings._count` + `findings.some` + include) — Task 4; (3) findings-write failure mode in deploy verification + log watch for `[findings] dual-write failed` — Task 6; (4) legacy fallback tests keep the quoted-JSON `contains` assertion — already in Task 1.

**Tech Stack:** Next.js 15 App Router route handler, Prisma 5 + SQLite, Vitest (mock-based route tests).

**Gate already passed (2026-06-11):** fresh-run production parity OK on 4 live-hook parses (glow, nuvani, manhattanschool, proway) — see tracker status log. ADA-side fresh site audits + standalone are part of the same Phase 3 verification but do not gate this flip (they have no reader change in this PR).

**Deliberate behavior deltas (not regressions — call out in PR):**
1. `issueTypes`/`issueCount` get richer for CrawlRun-backed sessions: `SessionPage` only ever carried the 4 derivable types (`missing_title`, `missing_h1`, `missing_meta_description`, `thin_content`); page-level `Finding` rows attribute every issue type whose affected-URL set includes the page. The UI's issue-type dropdown already lists all types — filtering by a non-derivable type currently returns 0 rows and will now actually work.
2. URLs are `normalizeFindingUrl`-normalized on `CrawlPage` (fragment dropped, bare-root trailing slash stripped) — cosmetic display change.
3. Literal duplicate `page_index` URLs are keep-first-deduped in `CrawlPage`, so `total` can be slightly lower for blobs that carried dups (nuvani had 1).

---

### Task 1: Flip the reader route (TDD)

**Files:**
- Modify: `app/api/seo-parser/[sessionId]/pages/route.ts`
- Test: `app/api/seo-parser/[sessionId]/pages/route.test.ts`

- [ ] **Step 1: Rewrite the test file with new mocks + both paths**

Replace the mock block and add a `crawlRun`/`crawlPage` mock set. Keep ALL existing legacy-path assertions (they now run with `crawlRun.findUnique → null`); add a CrawlRun-backed describe block.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionPageFindManyMock = vi.fn();
const sessionPageCountMock = vi.fn();
const crawlRunFindUniqueMock = vi.fn();
const crawlPageFindManyMock = vi.fn();
const crawlPageCountMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: {
    sessionPage: {
      findMany: (...args: unknown[]) => sessionPageFindManyMock(...args),
      count: (...args: unknown[]) => sessionPageCountMock(...args),
    },
    crawlRun: {
      findUnique: (...args: unknown[]) => crawlRunFindUniqueMock(...args),
    },
    crawlPage: {
      findMany: (...args: unknown[]) => crawlPageFindManyMock(...args),
      count: (...args: unknown[]) => crawlPageCountMock(...args),
    },
  },
}));

import { GET } from './route';
import { NextRequest } from 'next/server';

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}
function makeRequest(url: string) {
  return new NextRequest(url);
}

const SESSION_ID = 's1';
const RUN_ID = 'run-1';

const legacyRow = {
  id: 'page_1',
  sessionId: SESSION_ID,
  url: 'https://example.com/page',
  title: 'Test Page',
  h1: 'Test H1',
  metaDescription: 'A test page',
  wordCount: 300,
  crawlDepth: 1,
  indexable: true,
  issueTypes: '["missing_title"]',
  issueCount: 1,
};

const crawlRow = {
  id: 'cp_1',
  runId: RUN_ID,
  url: 'https://example.com/page',
  status: null,
  error: null,
  finalUrl: null,
  statusCode: null,
  title: 'Test Page',
  h1: 'Test H1',
  metaDescription: 'A test page',
  wordCount: 300,
  crawlDepth: 1,
  indexable: true,
  score: null,
  adaAuditId: null,
  findings: [
    { type: 'thin_content', severity: 'warning' },
    { type: 'missing_title', severity: 'critical' },
    { type: 'broken_pages', severity: 'critical' },
  ],
};

describe('GET /api/seo-parser/[sessionId]/pages — CrawlRun-backed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crawlRunFindUniqueMock.mockResolvedValue({ id: RUN_ID });
    crawlPageFindManyMock.mockResolvedValue([crawlRow]);
    crawlPageCountMock.mockResolvedValue(1);
  });

  it('queries CrawlPage by runId with findings include and identical response shape', async () => {
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    expect(res.status).toBe(200);
    expect(crawlRunFindUniqueMock).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID },
      select: { id: true },
    });
    expect(crawlPageFindManyMock).toHaveBeenCalledWith({
      where: { runId: RUN_ID },
      orderBy: [{ findings: { _count: 'desc' } }, { url: 'asc' }],
      take: 50,
      skip: 0,
      include: { findings: { select: { type: true, severity: true } } },
    });
    expect(sessionPageFindManyMock).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.pages).toEqual([
      {
        id: 'cp_1',
        sessionId: SESSION_ID,
        url: 'https://example.com/page',
        title: 'Test Page',
        h1: 'Test H1',
        metaDescription: 'A test page',
        wordCount: 300,
        crawlDepth: 1,
        indexable: true,
        // severity rank (critical < warning < notice), then type asc
        issueTypes: ['broken_pages', 'missing_title', 'thin_content'],
        issueCount: 3,
      },
    ]);
  });

  it('filters by issueType via findings.some without narrowing the included findings', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?issueType=broken_pages`),
      makeParams(SESSION_ID),
    );
    expect(crawlPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: RUN_ID, findings: { some: { type: 'broken_pages' } } },
        include: { findings: { select: { type: true, severity: true } } },
      }),
    );
    expect(crawlPageCountMock).toHaveBeenCalledWith({
      where: { runId: RUN_ID, findings: { some: { type: 'broken_pages' } } },
    });
  });

  it('sort=wordCount / sort=crawlDepth use scalar orderBy with url tiebreaker', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=wordCount`),
      makeParams(SESSION_ID),
    );
    expect(crawlPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ wordCount: 'asc' }, { url: 'asc' }] }),
    );
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=crawlDepth`),
      makeParams(SESSION_ID),
    );
    expect(crawlPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ crawlDepth: 'desc' }, { url: 'asc' }] }),
    );
  });

  it('coalesces null indexable to true and handles zero findings', async () => {
    crawlPageFindManyMock.mockResolvedValue([{ ...crawlRow, indexable: null, findings: [] }]);
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.pages[0].indexable).toBe(true);
    expect(body.pages[0].issueTypes).toEqual([]);
    expect(body.pages[0].issueCount).toBe(0);
  });

  it('clamps limit and passes offset (CrawlRun path)', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?limit=9999&offset=5`),
      makeParams(SESSION_ID),
    );
    expect(crawlPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200, skip: 5 }),
    );
  });
});

describe('GET /api/seo-parser/[sessionId]/pages — legacy SessionPage fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crawlRunFindUniqueMock.mockResolvedValue(null);
    sessionPageFindManyMock.mockResolvedValue([legacyRow]);
    sessionPageCountMock.mockResolvedValue(1);
  });

  it('uses defaults: take=50, skip=0, orderBy issueCount desc + url tiebreaker, no issueType filter', async () => {
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    expect(res.status).toBe(200);
    expect(sessionPageFindManyMock).toHaveBeenCalledWith({
      where: { sessionId: SESSION_ID },
      orderBy: [{ issueCount: 'desc' }, { url: 'asc' }],
      take: 50,
      skip: 0,
    });
    expect(crawlPageFindManyMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.pages[0].issueTypes).toEqual(['missing_title']);
  });

  it('passes quoted issueType to where.issueTypes.contains', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?issueType=missing_title`),
      makeParams(SESSION_ID),
    );
    const callWhere = sessionPageFindManyMock.mock.calls[0][0].where;
    expect(callWhere.issueTypes.contains).toBe('"missing_title"');
  });

  it('sort variants map to SessionPage orderBy', async () => {
    await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=wordCount`),
      makeParams(SESSION_ID),
    );
    expect(sessionPageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ wordCount: 'asc' }, { url: 'asc' }] }),
    );
  });

  it('returns [] for malformed issueTypes JSON and non-array JSON', async () => {
    sessionPageFindManyMock.mockResolvedValue([
      { ...legacyRow, issueTypes: 'not-json{{' },
      { ...legacyRow, id: 'page_2', url: 'https://example.com/2', issueTypes: '{"key":"val"}' },
    ]);
    const res = await GET(
      makeRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.pages[0].issueTypes).toEqual([]);
    expect(body.pages[1].issueTypes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify the new block fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/seo-parser/[sessionId]/pages/route.test.ts"`
Expected: CrawlRun-backed describe FAILS (route never calls `crawlRun.findUnique`); legacy describe may also fail until the route is updated.

- [ ] **Step 3: Implement the flipped route**

Replace `app/api/seo-parser/[sessionId]/pages/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Reader flip (A2 Phase 3): CrawlRun-backed sessions read CrawlPage + page-level
// Finding rows; sessions without a CrawlRun (pre-A2) fall back to SessionPage.
// Response shape is identical in both paths.

interface Query {
  limit: number;
  offset: number;
  issueType?: string;
  sort: string;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, notice: 2 };

export async function GET(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const sp = req.nextUrl.searchParams;
  const q: Query = {
    limit: Math.min(Math.max(parseInt(sp.get('limit') ?? '50', 10) || 50, 1), 200),
    offset: Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0),
    issueType: sp.get('issueType') ?? undefined,
    sort: sp.get('sort') ?? 'issues',
  };

  const run = await prisma.crawlRun.findUnique({ where: { sessionId }, select: { id: true } });
  if (!run) return legacySessionPages(sessionId, q);

  const where = {
    runId: run.id,
    ...(q.issueType ? { findings: { some: { type: q.issueType } } } : {}),
  };
  const orderBy =
    q.sort === 'wordCount' ? [{ wordCount: 'asc' as const }, { url: 'asc' as const }]
    : q.sort === 'crawlDepth' ? [{ crawlDepth: 'desc' as const }, { url: 'asc' as const }]
    : [{ findings: { _count: 'desc' as const } }, { url: 'asc' as const }];

  const [rows, total] = await Promise.all([
    prisma.crawlPage.findMany({
      where,
      orderBy,
      take: q.limit,
      skip: q.offset,
      // Findings are NOT narrowed by the filter: issueTypes/issueCount always
      // describe the whole page, matching the old denormalized columns.
      include: { findings: { select: { type: true, severity: true } } },
    }),
    prisma.crawlPage.count({ where }),
  ]);

  return NextResponse.json({
    pages: rows.map((r) => ({
      id: r.id,
      sessionId,
      url: r.url,
      title: r.title,
      h1: r.h1,
      metaDescription: r.metaDescription,
      wordCount: r.wordCount,
      crawlDepth: r.crawlDepth,
      indexable: r.indexable ?? true,
      issueTypes: orderedIssueTypes(r.findings),
      issueCount: r.findings.length,
    })),
    total,
  });
}

/** Page findings are unique per type (dedupKey is scope+type+url), so the
 *  types list needs no dedupe — just a stable, severity-first presentation
 *  order for the UI chips. */
function orderedIssueTypes(findings: { type: string; severity: string }[]): string[] {
  return [...findings]
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        a.type.localeCompare(b.type),
    )
    .map((f) => f.type);
}

async function legacySessionPages(sessionId: string, q: Query) {
  const where = {
    sessionId,
    // Match the QUOTED JSON token so 'missing_title' matches the array element
    // "missing_title" and NOT a substring like "missing_title_something".
    ...(q.issueType ? { issueTypes: { contains: JSON.stringify(q.issueType) } } : {}),
  };
  // Secondary `url` sort is a deterministic tiebreaker: ordering by a single
  // non-unique column lets offset pagination duplicate/skip rows across pages
  // when many rows tie. `url` is unique per session, so it fully orders the set.
  const orderBy =
    q.sort === 'wordCount' ? [{ wordCount: 'asc' as const }, { url: 'asc' as const }]
    : q.sort === 'crawlDepth' ? [{ crawlDepth: 'desc' as const }, { url: 'asc' as const }]
    : [{ issueCount: 'desc' as const }, { url: 'asc' as const }];

  const [rows, total] = await Promise.all([
    prisma.sessionPage.findMany({ where, orderBy, take: q.limit, skip: q.offset }),
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

- [ ] **Step 4: Run the route tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/seo-parser/[sessionId]/pages/route.test.ts"`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/seo-parser/[sessionId]/pages/route.ts" "app/api/seo-parser/[sessionId]/pages/route.test.ts"
git commit -m "feat(findings): flip SessionPage reader to CrawlPage + Finding join"
```

### Task 2: Extract `normalizeFindingUrl` into a client-safe module

**Files:**
- Create: `lib/findings/normalize-url.ts`
- Modify: `lib/findings/keys.ts`

- [ ] **Step 1: Create the pure module**

`lib/findings/keys.ts` imports node `crypto` at module top; a `'use client'` component cannot import it. Move the function verbatim into `lib/findings/normalize-url.ts`:

```ts
// lib/findings/normalize-url.ts
//
// Client-safe URL normalization (no node imports) shared by the findings
// mappers/keys AND client components that must match CrawlPage.url values.

/**
 * Normalization shared by CrawlPage.url, Finding.url, and the page dedup
 * key: lowercase host, drop fragment, strip the trailing slash on a bare
 * root path. Non-URLs pass through unchanged.
 */
export function normalizeFindingUrl(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  u.hash = ''
  let out = u.toString()
  if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
  return out
}
```

In `lib/findings/keys.ts`, delete the `normalizeFindingUrl` function body and re-export so every existing import keeps working:

```ts
export { normalizeFindingUrl } from './normalize-url'
```

(Keep the import used inside `pageFindingKey` — change it to import from `./normalize-url`.)

- [ ] **Step 2: Typecheck + findings tests**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings`
Expected: clean; `keys.test.ts` still green (it exercises `normalizeFindingUrl` through the re-export).

- [ ] **Step 3: Commit**

```bash
git add lib/findings/normalize-url.ts lib/findings/keys.ts
git commit -m "refactor(findings): extract client-safe normalizeFindingUrl module"
```

### Task 3: PageDetailModal — normalized URL matching

**Files:**
- Modify: `components/seo-parser/PageDetailModal.tsx:27-55`

- [ ] **Step 1: Normalize both sides of the match**

The table now passes normalized `CrawlPage.url` values to `onUrlClick`, but `findIssuesForUrl` exact-matches against raw blob URLs (`issue.urls` / rehydrated refs) — a root URL like `https://example.edu` would no longer match `https://example.edu/`. Also add `issue.groups[*].urls` to the affected set: the seo-mapper attributes page findings from groups too (duplicate title/meta/H1 carry URLs ONLY there), so without it a chip shown in the table opens a modal claiming "no issues".

In `components/seo-parser/PageDetailModal.tsx` replace `findIssuesForUrl` with:

```ts
import { normalizeFindingUrl } from '@/lib/findings/normalize-url';

function findIssuesForUrl(url: string, result: AggregatedResult): MatchedIssue[] {
  const matched: MatchedIssue[] = [];

  const registry = result.url_registry;
  const target = normalizeFindingUrl(url);

  const checkIssue = (issue: Issue, severity: 'critical' | 'warning' | 'notice') => {
    // issue.urls is a CAPPED sample. Pages recovered via affectedUrlRefs would
    // wrongly show "no issues" unless we also rehydrate the refs through the
    // url_registry. Old sessions without a registry fall back to urls only.
    // groups[*].urls carry the membership for duplicate-* issues. Everything
    // is compared in normalizeFindingUrl form because the Crawled Pages table
    // serves normalized CrawlPage.url values post-flip (legacy SessionPage
    // URLs are unnormalized, and normalizing both sides matches them too).
    const affected = new Set<string>((issue.urls ?? []).map(normalizeFindingUrl));
    if (registry) {
      for (const ref of issue.affectedUrlRefs ?? []) {
        affected.add(normalizeFindingUrl(rehydrate(registry, ref)));
      }
    }
    for (const group of issue.groups ?? []) {
      for (const u of group.urls ?? []) affected.add(normalizeFindingUrl(u));
    }
    if (affected.has(target)) {
      matched.push({ issue, severity });
    }
  };

  result.issues.critical.forEach((issue) => checkIssue(issue, 'critical'));
  result.issues.warnings.forEach((issue) => checkIssue(issue, 'warning'));
  result.issues.notices.forEach((issue) => checkIssue(issue, 'notice'));

  // Sort by severity order
  matched.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return matched;
}
```

(If `Issue.groups` lacks a type for `urls`, check `lib/types/index.ts` — `groups[*].urls` is already read the same way in `lib/findings/seo-mapper.ts:143`.)

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean — in particular NO "node:crypto" / module-not-found error from the client bundle (that's what Task 2 prevents).

- [ ] **Step 3: Commit**

```bash
git add components/seo-parser/PageDetailModal.tsx
git commit -m "fix(seo-parser): match page-detail issues on normalized URLs incl. group membership"
```

### Task 4: DB-backed integration test for the CrawlPage relation query

**Files:**
- Create: `app/api/seo-parser/[sessionId]/pages/route.db.test.ts`

The mock tests can't catch Prisma/SQLite gotchas in `orderBy: { findings: { _count } }` + `findings: { some } }` + `include`. One real-DB test seeds a run with two pages and asserts ordering, filtering, and response shape. Follow the findings-test gotchas: unique test domain, delete `CrawlRun`s by BOTH origin id and test domain in cleanup.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { GET } from './route';
import { NextRequest } from 'next/server';

const SESSION_ID = randomUUID();
const TEST_DOMAIN = 'pages-route-db-test.example';

function makeParams(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
}

async function clearTestState() {
  await prisma.crawlRun.deleteMany({
    where: { OR: [{ sessionId: SESSION_ID }, { domain: TEST_DOMAIN }] },
  });
  await prisma.session.deleteMany({ where: { id: SESSION_ID } });
}

beforeAll(async () => {
  await clearTestState();
  await prisma.session.create({
    data: { id: SESSION_ID, files: '[]', status: 'complete' },
  });
  const runId = randomUUID();
  await prisma.crawlRun.create({
    data: {
      id: runId,
      tool: 'seo-parser',
      source: 'sf-upload',
      domain: TEST_DOMAIN,
      sessionId: SESSION_ID,
      status: 'complete',
      pagesTotal: 2,
    },
  });
  const busyId = randomUUID();
  const quietId = randomUUID();
  await prisma.crawlPage.createMany({
    data: [
      { id: busyId, runId, url: `https://${TEST_DOMAIN}/busy`, title: 'Busy', indexable: true, wordCount: 100 },
      { id: quietId, runId, url: `https://${TEST_DOMAIN}/quiet`, title: 'Quiet', indexable: true, wordCount: 900 },
    ],
  });
  await prisma.finding.createMany({
    data: [
      { id: randomUUID(), runId, pageId: busyId, scope: 'page', type: 'missing_title', severity: 'critical', url: `https://${TEST_DOMAIN}/busy`, dedupKey: 'k1' },
      { id: randomUUID(), runId, pageId: busyId, scope: 'page', type: 'thin_content', severity: 'warning', url: `https://${TEST_DOMAIN}/busy`, dedupKey: 'k2' },
      { id: randomUUID(), runId, pageId: quietId, scope: 'page', type: 'temporary_redirects', severity: 'notice', url: `https://${TEST_DOMAIN}/quiet`, dedupKey: 'k3' },
      // run-scope row with NULL pageId must not join to any page
      { id: randomUUID(), runId, pageId: null, scope: 'run', type: 'missing_title', severity: 'critical', dedupKey: 'k4' },
    ],
  });
});

afterAll(clearTestState);

describe('pages route against the real DB (CrawlRun-backed)', () => {
  it('orders by findings count desc with url tiebreaker and shapes the response', async () => {
    const res = await GET(
      new NextRequest(`http://t/api/seo-parser/${SESSION_ID}/pages`),
      makeParams(SESSION_ID),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.pages.map((p: { url: string }) => p.url)).toEqual([
      `https://${TEST_DOMAIN}/busy`,
      `https://${TEST_DOMAIN}/quiet`,
    ]);
    expect(body.pages[0]).toMatchObject({
      sessionId: SESSION_ID,
      issueTypes: ['missing_title', 'thin_content'],
      issueCount: 2,
      indexable: true,
    });
  });

  it('filters via findings.some without narrowing issueTypes', async () => {
    const res = await GET(
      new NextRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?issueType=thin_content`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.pages[0].url).toBe(`https://${TEST_DOMAIN}/busy`);
    expect(body.pages[0].issueTypes).toEqual(['missing_title', 'thin_content']);
  });

  it('sort=wordCount orders ascending', async () => {
    const res = await GET(
      new NextRequest(`http://t/api/seo-parser/${SESSION_ID}/pages?sort=wordCount`),
      makeParams(SESSION_ID),
    );
    const body = await res.json();
    expect(body.pages.map((p: { wordCount: number }) => p.wordCount)).toEqual([100, 900]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/seo-parser/[sessionId]/pages/route.db.test.ts"`
Expected: PASS — this is the proof Prisma 5/SQLite accepts the relation `_count` orderBy combined with skip/take.

- [ ] **Step 3: Commit**

```bash
git add "app/api/seo-parser/[sessionId]/pages/route.db.test.ts"
git commit -m "test(findings): DB-backed coverage for the flipped pages reader"
```

### Task 5: Stop writing SessionPage in the parse route

**Files:**
- Modify: `app/api/parse/[sessionId]/route.ts:223-235`

- [ ] **Step 1: Drop the page inserts, keep scalars + deleteMany**

In `app/api/parse/[sessionId]/route.ts`, replace:

```ts
    const { pages, scalars } = buildSessionPages(sessionId, result);

    // Chunk createMany — a 1000-row insert can hit SQLite's bound-variable limit.
    const chunk = <T,>(arr: T[], size: number): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };
    const pageChunks = chunk(pages, 75);

    await prisma.$transaction([
      prisma.sessionPage.deleteMany({ where: { sessionId } }),
      ...pageChunks.map((data) => prisma.sessionPage.createMany({ data })),
```

with:

```ts
    // A2 Phase 3: SessionPage rows are no longer written — the pages reader
    // joins CrawlPage + Finding for sessions with a CrawlRun. The deleteMany
    // stays so a retried parse can't leave stale legacy rows behind. The
    // scalar columns on Session are still denormalized here. If the findings
    // dual-write below fails, this session has no per-page data until
    // `npx tsx scripts/findings-rebuild.ts <sessionId>` is run.
    const { scalars } = buildSessionPages(sessionId, result);

    await prisma.$transaction([
      prisma.sessionPage.deleteMany({ where: { sessionId } }),
```

(The `prisma.session.update({...})` entry in the transaction array is unchanged.)

- [ ] **Step 2: Typecheck + full suite**

Run: `npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npx vitest run`
Expected: tsc clean; full suite green (1,787+). If any parse-route test asserts `sessionPage.createMany`, update it to assert the rows are NOT created.

- [ ] **Step 3: Commit**

```bash
git add "app/api/parse/[sessionId]/route.ts"
git commit -m "feat(findings): stop writing SessionPage rows in the parse route"
```

### Task 6: Build, PR, deploy, production verification

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean Next.js build.

- [ ] **Step 2: Capture a pre-deploy response snapshot for one CrawlRun-backed session**

On the server (authenticated curl, cookie jar from the parity work):
`curl -s -b /tmp/parity-jar "https://seo.erstaging.site/api/seo-parser/77005092-a6a7-4de0-bc70-28140a9d5260/pages?limit=200" > /tmp/pages-pre.json`

- [ ] **Step 3: PR + merge + deploy**

```bash
git push -u origin feat/findings-layer-phase3
gh pr create --title "feat(findings): A2 Phase 3 — SessionPage reader flip" --body "..."
# after merge:
ssh $PROD_SSH "~/deploy.sh"
```

- [ ] **Step 4: Post-deploy verification**

- `curl -s -b /tmp/parity-jar ".../api/seo-parser/77005092-.../pages?limit=200" > /tmp/pages-post.json` — compare to pre: same URLs (modulo normalizeFindingUrl), same title/h1/meta/wordCount/crawlDepth/indexable per URL, issueTypes a superset of the old derivable-4 values.
- Filter check: `?issueType=missing_meta_description` returns the same membership pre/post; a non-derivable type (e.g. `temporary_redirects`) returns >0 rows post-flip where it returned 0 pre-flip (if the session has that issue).
- Legacy fallback: hit the pages route for a session with no CrawlRun (or rely on unit tests if none exists in prod).
- Modal check (Codex fix 1): in the UI, click the root/homepage URL in Crawled Pages — the modal must list its issues (normalized match), and a duplicate-* chip's page must show that issue in the modal (groups membership).
- Failure-mode watch (Codex fix 3): `grep "\[findings\] dual-write failed" $LOG_HOME/*` after the next few real parses — with SessionPage gone, a failed dual-write means NO per-page data for that session until `npx tsx scripts/findings-rebuild.ts <sessionId>` is run. That's the documented recovery path.
- Boot log error-free.

</content>
</invoke>
