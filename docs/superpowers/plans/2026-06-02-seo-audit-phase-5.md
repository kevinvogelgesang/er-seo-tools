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
  it('strips a path on scheme-less input', () => {
    expect(normalizeHost('www.example.edu/foo')).toBe('example.edu');
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
  // Strip any path/query on scheme-less input ("www.example.edu/foo" → "www.example.edu").
  host = host.split('/')[0].split('?')[0];
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

- [ ] **Step 4b: Use `normalizeHost` in parse-time client matching.** In `app/api/parse/[sessionId]/route.ts` (~line 167-178, the `siteHostname` vs client-domain loop), normalize BOTH sides before comparing so `www.`/case variants match consistently:
```typescript
import { normalizeHost } from '@/lib/services/normalize-host';
// ...
const normHost = normalizeHost(siteHostname);
const matched = clientDomains.some((d) => {
  const nd = normalizeHost(d);
  return !!normHost && !!nd && (normHost === nd || normHost.endsWith('.' + nd) || nd.endsWith('.' + normHost));
});
```
Keep the existing behavior otherwise. (This makes future client grouping more robust without changing the clientId grouping key.)

- [ ] **Step 5:** `npx vitest run lib/services/` + `npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/normalize-host.ts lib/services/normalize-host.test.ts lib/services/session-page-builder.ts lib/services/session-page-builder.test.ts "app/api/parse/[sessionId]/route.ts"
git commit -m "feat(seo): normalizeHost util — siteHost scalar + parse-time client matching"
```
(End each commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task 2: Shared `getClientSeoHistory` helper + SEO-history API

**Files:** Create `lib/services/client-seo-history.ts` (+ test); `app/api/clients/[id]/seo-history/route.ts` (+ test). **Both the API (Task 2) and the `/clients/[id]` server page (Task 3) call this ONE helper** so the scalar query/shape can't drift (Codex fix #2).

- [ ] **Step 1: Shared helper** `lib/services/client-seo-history.ts` (server-only; reads ONLY scalar columns, never `result`):

```typescript
import { prisma } from '@/lib/db';

export interface ClientSeoHistorySession {
  id: string;
  createdAt: string;   // ISO (serialized for client components)
  siteName: string | null;
  siteHost: string | null;
  totalUrls: number | null;
  criticalCount: number | null;
  warningCount: number | null;
  noticeCount: number | null;
}
export interface ClientSeoHistory {
  client: { id: number; name: string } | null;
  sessions: ClientSeoHistorySession[];
  latestTwo: [string, string] | null;
  lastAuditedAt: string | null;
}

export async function getClientSeoHistory(clientId: number): Promise<ClientSeoHistory> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, name: true } });
  if (!client) return { client: null, sessions: [], latestTwo: null, lastAuditedAt: null };

  const rows = await prisma.session.findMany({
    where: { clientId, status: 'complete' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, createdAt: true, siteName: true, siteHost: true,
      totalUrls: true, criticalCount: true, warningCount: true, noticeCount: true,
    },
  });

  const sessions: ClientSeoHistorySession[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),   // serialize Date → string (Codex fix #3)
    siteName: r.siteName,
    siteHost: r.siteHost,
    totalUrls: r.totalUrls,
    criticalCount: r.criticalCount,
    warningCount: r.warningCount,
    noticeCount: r.noticeCount,
  }));

  const latestTwo = sessions.length >= 2
    ? [sessions[sessions.length - 2].id, sessions[sessions.length - 1].id] as [string, string]
    : null;
  const lastAuditedAt = sessions.length ? sessions[sessions.length - 1].createdAt : null;

  return { client, sessions, latestTwo, lastAuditedAt };
}
```

- [ ] **Step 2: API route** `app/api/clients/[id]/seo-history/route.ts` — thin wrapper over the helper:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getClientSeoHistory } from '@/lib/services/client-seo-history';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clientId = Number(id);
  if (!Number.isInteger(clientId) || clientId <= 0) return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 });
  const data = await getClientSeoHistory(clientId);
  if (!data.client) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(data);
}
```

- [ ] **Step 3: Tests.** `lib/services/client-seo-history.test.ts` — mock `@/lib/db` prisma; assert: null client → `{client:null,...}`; sessions mapped with `createdAt` as ISO string; `findMany` `where: { clientId, status:'complete' }` and a `select` that does NOT include `result`; `latestTwo` null with <2 and last-two with ≥2. `app/api/clients/[id]/seo-history/route.test.ts` — 400 for non-integer/≤0 id, 404 when helper returns null client, 200 passes through the helper data (mock the helper or prisma).

- [ ] **Step 4:** `npx vitest run lib/services app/api/clients` + `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/client-seo-history.ts lib/services/client-seo-history.test.ts "app/api/clients/[id]/seo-history"
git commit -m "feat(seo): shared getClientSeoHistory helper + SEO-history API (scalar only)"
```

---

## Task 3: `/clients/[id]` detail page (trend + sessions + diff link)

**Files:** Create `app/clients/[id]/page.tsx`, `components/clients/SeoHistoryView.tsx`, `components/clients/SeoHistoryChart.tsx`; modify `app/clients/page.tsx` (link to detail).

- [ ] **Step 1: `SeoHistoryChart.tsx`** (client) — a Recharts line chart, lazy-loaded the way the existing seo-parser charts are (look at `components/seo-parser/charts/StatusCodeBarChart.tsx` for the `'use client'` + Recharts import pattern; ResultsView lazy-loads charts via `next/dynamic`). Props: `{ sessions: Array<{ createdAt: string; criticalCount: number|null; warningCount: number|null; noticeCount: number|null }> }`. Plot three lines (critical=red, warning=orange, notice=blue) over a date X-axis. Skip/representation for null counts (filter them out or render gaps). Empty state when 0 sessions with scalar data.

- [ ] **Step 2: `SeoHistoryView.tsx`** (client) — receives `{ sessions, latestTwo, lastAuditedAt }` as PROPS from the server page (no fetch — the server page already loaded it via the shared helper). Renders:
  - a header line "Last audited: {relative time}" (reuse `lib/relative-time` if present),
  - the lazy `<SeoHistoryChart>` (via `next/dynamic`, `ssr:false`),
  - a session table: Date · Total URLs · Critical · Warnings · Notices · link to `/seo-parser/results/{id}`,
  - a "Compare latest two crawls" button (shown when `latestTwo`) linking to `/seo-parser/diff?a=${latestTwo[0]}&b=${latestTwo[1]}`,
  - an empty state ("No completed SEO audits for this client yet").
  Match the dark-mode card styling used across the app.

- [ ] **Step 3: `app/clients/[id]/page.tsx`** (server component) — `const { id } = await params; const clientId = Number(id);` then **validate `Number.isInteger(clientId) && clientId > 0` → `notFound()` otherwise** (Codex fix #4, before any Prisma call). Call the SHARED helper `await getClientSeoHistory(clientId)` (NOT a duplicate query — Codex fix #2); `notFound()` if `data.client` is null. Pass the helper's already-ISO-serialized `{ sessions, latestTwo, lastAuditedAt }` to `<SeoHistoryView>` as props (one round trip, no Date objects crossing into client components — Codex fix #3). Render a page shell (heading = client name) + `<SeoHistoryView ... />`.

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

- [ ] **Step 1:** Read `app/seo-parser/diff/page.tsx`. It is ALREADY a `'use client'` component with two session pickers (A and B) that POSTs to `/api/diff`. **Do NOT introduce `useSearchParams`** (it would force a Suspense boundary in Next 15 and risk a build error — Codex fix #5). Instead, in a mount `useEffect`, read `window.location.search` (e.g. `new URLSearchParams(window.location.search)`), pull `a`/`b`, and if both look like valid session ids, pre-select them into the A/B state and auto-run the diff. **Auto-run must call `/api/diff` directly with the ids** — do NOT require `a`/`b` to be present in the global recent-history dropdown options (the latest two for a client may fall outside the global cap; `/api/diff` accepts any valid complete ids — Codex fix #6). Keep manual selection fully working; if the dropdown doesn't contain the preselected id, still run the diff (and it's fine if the select shows a placeholder).

- [ ] **Step 2:** `npx tsc --noEmit && npm run build` → PASS (the build specifically confirms no `useSearchParams`/Suspense issue). Reason through: visiting `/seo-parser/diff?a=X&b=Y` pre-selects + runs the diff even if X/Y aren't in the dropdown.

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
