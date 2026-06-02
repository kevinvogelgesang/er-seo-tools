# SEO Audit Overhaul — Phase 5 Implementation Plan (Per-client history / trends / diff)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Turn the per-crawl islands into a per-client story: a client detail page showing the SEO health trend over time (from the Phase 3 denormalized scalar columns — no blob parsing), a session list, "last audited" recency, and a one-click "compare the latest two crawls" diff.

**Architecture:** Sessions already carry `clientId` (auto-matched at parse) and, since Phase 3, denormalized scalars (`siteHost`, `totalUrls`, `criticalCount`, `warningCount`, `noticeCount`). Phase 5 (1) normalizes `siteHost` for consistent display/matching, (2) adds a read-only client SEO-history API that reads ONLY the scalar columns (the whole point of Phase 3), (3) adds a `/clients/[id]` detail page with a Recharts trend + session list + diff link, and (4) lets the existing diff page pre-select two sessions via query params. Grouping is by `clientId` (robust to www/non-www because client domain matching already handles that).

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Recharts (lazy via `next/dynamic`, per CLAUDE.md), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-seo-audit-overhaul-design.md` (Phase 5). Stacked on `feat/seo-audit-phase-4`.

**Verify:** `npx tsc --noEmit` · `npx vitest run <path>` · `npm run build`.

---

## Design decisions (locked)

- **Group history by `clientId`** (not raw host) — client domain matching already collapses www/non-www, so this is the robust key. Only `status: 'complete'` sessions count.
- **Trend data comes from the Phase 3 scalar columns** (`criticalCount`/`warningCount`/`noticeCount`/`totalUrls` + `createdAt`). No `Session.result` blob deserialization. Old sessions (null scalars) are simply excluded from the trend (historical tolerance).
- **Normalize `siteHost`** (lowercase, strip leading `www.`) where it's set in the Phase 3 builder — cheap consistency win the spec called for. Does not change `clientId` grouping.
- **No new `Client.lastSeoAuditAt` column** — "last audited" is derived from the latest session's `createdAt` (YAGNI; avoids a write path to keep in sync).
- **Auto-diff = pre-fill the existing diff page** via `/seo-parser/diff?a=<prev>&b=<latest>` (reuse, don't rebuild). The diff page learns to read those query params.
- **Quarter-grid health badge + "persistent issues" table: OUT OF SCOPE** for Phase 5 (noted as light follow-ups) — keep this phase to the trend + list + diff, which is the "is this client improving?" payoff.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `lib/services/normalize-host.ts` (+ test) | `normalizeHost()` (lowercase, strip `www.`) | 1 |
| `lib/services/session-page-builder.ts` | apply `normalizeHost` to `siteHost` scalar | 1 |
| `app/api/clients/[id]/seo-history/route.ts` (+ test) | client sessions w/ scalars, ordered; latest-two ids | 2 |
| `app/clients/[id]/page.tsx` (new) + `components/clients/SeoHistoryChart.tsx` + `SeoHistoryView.tsx` | client detail: trend + session list + diff link + last-audited | 3 |
| `app/clients/page.tsx` | link each client to `/clients/[id]` | 3 |
| `app/seo-parser/diff/page.tsx` | pre-select sessions from `?a=&b=` query params | 4 |

---

## Task 1: `normalizeHost` util + apply to the `siteHost` scalar

**Files:** Create `lib/services/normalize-host.ts` + test; modify `lib/services/session-page-builder.ts`.

- [ ] **Step 1: Failing test** `lib/services/normalize-host.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeHost } from './normalize-host';

describe('normalizeHost', () => {
  it('lowercases and strips leading www.', () => {
    expect(normalizeHost('WWW.Example.EDU')).toBe('example.edu');
    expect(normalizeHost('example.edu')).toBe('example.edu');
  });
  it('strips a scheme/path if a full URL sneaks in', () => {
    expect(normalizeHost('https://www.example.edu/a')).toBe('example.edu');
  });
  it('handles null/empty', () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost('')).toBeNull();
  });
  it('only strips a leading www., not embedded', () => {
    expect(normalizeHost('wwwx.example.edu')).toBe('wwwx.example.edu');
  });
});
```

- [ ] **Step 2:** Run `npx vitest run lib/services/normalize-host.test.ts`; FAIL.

- [ ] **Step 3: Implement** `lib/services/normalize-host.ts`:

```typescript
export function normalizeHost(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim();
  // If a full URL sneaks in, extract the host.
  if (host.includes('://')) {
    try { host = new URL(host).host; } catch { /* fall through */ }
  }
  host = host.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  return host || null;
}
```

- [ ] **Step 4: Apply in the builder.** In `lib/services/session-page-builder.ts`, wrap the `siteHost` scalar:
```typescript
import { normalizeHost } from './normalize-host';
// ...
siteHost: normalizeHost(result.metadata.site_name ?? reg?.sessionOrigin.host ?? null),
```
Update the `session-page-builder.test.ts` scalar expectation if needed (`siteHost` for `site_name: 'x.edu'` stays `'x.edu'`; if a test used `www.` it'd now strip — adjust to match).

- [ ] **Step 5:** `npx vitest run lib/services/` + `npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/normalize-host.ts lib/services/normalize-host.test.ts lib/services/session-page-builder.ts lib/services/session-page-builder.test.ts
git commit -m "feat(seo): normalizeHost util applied to siteHost scalar"
```
(End each commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task 2: Client SEO-history API

**Files:** Create `app/api/clients/[id]/seo-history/route.ts` + `route.test.ts`.

- [ ] **Step 1: Implement** — reads ONLY scalar columns (no `result` blob):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clientId = parseInt(id, 10);
  if (Number.isNaN(clientId)) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sessions = await prisma.session.findMany({
    where: { clientId, status: 'complete' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, createdAt: true, siteName: true, siteHost: true,
      totalUrls: true, criticalCount: true, warningCount: true, noticeCount: true,
    },
  });

  // latest two (chronological) for a one-click compare
  const latestTwo = sessions.length >= 2
    ? [sessions[sessions.length - 2].id, sessions[sessions.length - 1].id]
    : null;
  const lastAuditedAt = sessions.length ? sessions[sessions.length - 1].createdAt : null;

  return NextResponse.json({ client, sessions, latestTwo, lastAuditedAt });
}
```

- [ ] **Step 2: Test** `route.test.ts` — mock `@/lib/db` prisma. Cover: 400 invalid id; 404 unknown client; 200 returns `{ client, sessions (ordered, scalar fields only), latestTwo, lastAuditedAt }`; `latestTwo` is null with <2 sessions and the last two ids with ≥2; confirm `findMany` is called with `where: { clientId, status: 'complete' }` and a `select` that does NOT include `result`.

- [ ] **Step 3:** Test PASS; `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add "app/api/clients/[id]/seo-history"
git commit -m "feat(seo): client SEO-history API (scalar columns, no blob)"
```

---

## Task 3: `/clients/[id]` detail page (trend + sessions + diff link)

**Files:** Create `app/clients/[id]/page.tsx`, `components/clients/SeoHistoryView.tsx`, `components/clients/SeoHistoryChart.tsx`; modify `app/clients/page.tsx` (link to detail).

- [ ] **Step 1: `SeoHistoryChart.tsx`** (client) — a Recharts line chart, lazy-loaded the way the existing seo-parser charts are (look at `components/seo-parser/charts/StatusCodeBarChart.tsx` for the `'use client'` + Recharts import pattern; ResultsView lazy-loads charts via `next/dynamic`). Props: `{ sessions: Array<{ createdAt: string; criticalCount: number|null; warningCount: number|null; noticeCount: number|null }> }`. Plot three lines (critical=red, warning=orange, notice=blue) over a date X-axis. Skip/representation for null counts (filter them out or render gaps). Empty state when 0 sessions with scalar data.

- [ ] **Step 2: `SeoHistoryView.tsx`** (client) — orchestrates the client detail body: fetches `/api/clients/${clientId}/seo-history` (plain `fetch` + `useState`, or accept the data as props from the server page — prefer props from the server page to avoid an extra round trip; see Step 3). Renders:
  - a header line "Last audited: {relative time}" (reuse `lib/relative-time` if present),
  - the lazy `<SeoHistoryChart>` (via `next/dynamic`, `ssr:false`),
  - a session table: Date · Total URLs · Critical · Warnings · Notices · link to `/seo-parser/results/{id}`,
  - a "Compare latest two crawls" button (shown when `latestTwo`) linking to `/seo-parser/diff?a=${latestTwo[0]}&b=${latestTwo[1]}`,
  - an empty state ("No completed SEO audits for this client yet").
  Match the dark-mode card styling used across the app.

- [ ] **Step 3: `app/clients/[id]/page.tsx`** (server component) — `const clientId = Number(params.id)`; load the client (`prisma.client.findUnique`) and the same scalar-only session query as the API (or call the API). Prefer querying prisma directly in the server component and passing `{ client, sessions, latestTwo, lastAuditedAt }` to `<SeoHistoryView>` as props (one round trip). `notFound()` if the client doesn't exist. Render a page shell (heading = client name, its domains) + `<SeoHistoryView ... />`.

- [ ] **Step 4: Link from the list.** In `app/clients/page.tsx`, make each client row/name link to `/clients/${client.id}` (add a link/anchor; don't disturb the existing edit controls — read the page and add a "View SEO history" link or make the name a link).

- [ ] **Step 5:** `npx tsc --noEmit && npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/clients/[id]/page.tsx" components/clients/SeoHistoryView.tsx components/clients/SeoHistoryChart.tsx app/clients/page.tsx
git commit -m "feat(seo): per-client SEO history page (trend + sessions + compare)"
```

---

## Task 4: Diff page pre-selects from query params

**Files:** Modify `app/seo-parser/diff/page.tsx`.

- [ ] **Step 1:** Read `app/seo-parser/diff/page.tsx`. It has two session pickers (A and B) and POSTs to `/api/diff`. Add support for reading `?a=<id>&b=<id>` from the URL (via `useSearchParams` in the client component, or `searchParams` prop if it's a server component) and pre-selecting those sessions on mount (and optionally auto-running the diff if both are present and valid). Keep manual selection working. If the page is a server component wrapping a client picker, thread the params down.

- [ ] **Step 2:** `npx tsc --noEmit && npm run build` → PASS. Manually reason: visiting `/seo-parser/diff?a=X&b=Y` pre-selects X and Y.

- [ ] **Step 3: Commit**

```bash
git add "app/seo-parser/diff/page.tsx"
git commit -m "feat(seo): diff page pre-selects sessions from ?a=&b= query params"
```

---

## Phase 5 Exit Verification

- [ ] `npx tsc --noEmit` clean; `npx vitest run lib app/api/clients` green; `npm run build` succeeds.
- [ ] `/clients/[id]` shows a trend chart (critical/warning/notice over time) built from scalar columns, a session list linking to each result, "last audited" recency, and a "Compare latest two" button when ≥2 audits.
- [ ] The compare button opens the diff page with both sessions pre-selected.
- [ ] A client with 0 completed audits shows a clean empty state; old sessions with null scalars don't crash the chart (excluded).
- [ ] The history API `select` never includes `result` (verified by test) — no blob deserialization.

## Out of scope (later)
- Persistent-issue table (issue types recurring across crawls) — light follow-up.
- Quarter-grid health badge / overdue-audit indicator.
- `Client.lastSeoAuditAt` column (derived from sessions instead).

## Notes / risk
- **Old sessions have null scalars** (Phase 3 only populates new parses). The chart/table must treat null gracefully (filter from the trend; show "—" in the table). Re-parsing an old session repopulates them.
- **Grouping by `clientId`** depends on parse-time auto-matching; sessions that didn't match a client (clientId null) won't appear under any client — acceptable (they're visible in the global history).
- Recharts must stay lazy (`next/dynamic`, `ssr:false`) per CLAUDE.md to avoid SSR issues.
