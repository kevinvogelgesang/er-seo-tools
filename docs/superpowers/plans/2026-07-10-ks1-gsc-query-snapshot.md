# KS-1 — GSC query×page keyword snapshot (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `../specs/2026-07-10-ks1-gsc-query-snapshot-design.md` (Codex
ACCEPT-WITH-NAMED-FIXES ×7, applied — fix tags cited below where they land).
**Plan Codex review:** ACCEPT-WITH-NAMED-FIXES ×4 (2026-07-10), applied —
tagged "(Codex plan #N)".
Umbrella: `../specs/2026-07-10-keyword-strategy-capability-design.md` (C20/KS-1,
doubles as C12 Tier-0 Increment A).

**Goal:** durable client-scoped GSC keyword snapshot — raw `[query]` +
`[query,page]` rows over a trailing 91-day window with explicit completeness
metadata — plus pure read-time derivations (wins ≤10 / opportunities >10–≤30 /
quick wins >10–≤20 / cannibalization on observed-impressions share), an
operator-on-demand refresh, and a client-dashboard card. Zero site fetches,
zero LLM calls, zero public-surface changes.

**Architecture:** new `GscSnapshot` model (raw rows as two JSON text columns +
metadata columns incl. the verbatim `gscSiteUrl` stamp); new
`fetchGscQueryPage()` beside `fetchGsc` in the existing provider; new
`lib/keywords/` (types + pure derive + pure window + snapshot service with
single-flight refresh and mapping-filtered/corrupt-tolerant reads + retention);
cookie-gated `GET/POST /api/clients/[id]/gsc-snapshot`; `GscKeywordCard`
client component seeded server-side on the dashboard page.

**Tech stack:** existing — googleapis (service-account, `webmasters.readonly`),
Prisma+SQLite, Next 15 App Router routes, vitest.

## Resolved decisions (from the spec — restated)

- **D1** Snapshot home = new `GscSnapshot` model; raw rows persisted;
  derivations pure at read time, never persisted.
- **D2** 2 API calls: query rowLimit 2 500, query×page rowLimit 5 000; one
  window, trailing 91 days ending 3 days before fetch (UTC); at-limit flags
  mean "possibly truncated" only (Codex #7).
- **D3** Refresh = operator-on-demand inline route fetch, single-flight per
  client (Codex #7), 30 s gaxios timeout, errors ephemeral (Codex #6); no
  scheduled sweep (umbrella §5 Q6 open).
- **D4** minImpressions 10; raw-decimal bands, invalid/non-positive positions
  discarded (Codex #2); cannibalization ≥2 pages each ≥20% share of the
  query's **observed** query×page impressions and ≥10 impressions (Codex #3).
- **D5** `lib/keywords/` starts here.

## Global constraints (house rules — verbatim)

- Array-form `$transaction([...])` only; conditionals as SQL `EXISTS`/
  correlated subqueries; raw SQL sets `updatedAt` manually where a model has
  one (`GscSnapshot` has none — deletes only).
- No SQLite `createMany` + `skipDuplicates`; no `ALTER COLUMN` nullability.
- Migration SQL hand-authored (migrate dev is interactive-only here); apply
  with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy &&
  DATABASE_URL="file:./local-dev.db" npx prisma generate`.
- Tests: `DATABASE_URL="file:./local-dev.db" npm test`; vitest globals:false —
  component tests rendering repeated text add `afterEach(cleanup)`; route
  files export only handlers + config.
- `gscSiteUrl` is verbatim, NEVER normalized (provider header comment).
- Never `git add -A`. Gates: `npm run lint` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`.

## File structure

```
prisma/schema.prisma                                    (modify: +GscSnapshot, Client back-relation)
prisma/migrations/20260710150000_gsc_snapshot/migration.sql   (create, hand-authored)
lib/analytics/google/gsc-provider.ts                    (modify: +fetchGscQueryPage + row types)
lib/analytics/google/gsc-provider.test.ts               (modify: +fetchGscQueryPage suite)
lib/keywords/types.ts                                   (create: rows, summary, constants)
lib/keywords/window.ts + window.test.ts                 (create: pure trailing-window math)
lib/keywords/derive.ts + derive.test.ts                 (create: pure derivations)
lib/keywords/gsc-snapshot.ts + gsc-snapshot.test.ts     (create: service)
lib/keywords/retention.ts + retention.test.ts           (create: pruneGscSnapshots)
lib/cleanup.ts                                          (modify: wire pruneGscSnapshots)
app/api/clients/[id]/gsc-snapshot/route.ts + route.test.ts   (create)
components/clients/GscKeywordCard.tsx + .test.tsx       (create)
app/(app)/clients/[id]/page.tsx                         (modify: load + render card)
```

---

## Task 1: Schema — `GscSnapshot` model + migration

**Files:** `prisma/schema.prisma`,
`prisma/migrations/20260710150000_gsc_snapshot/migration.sql`

- [ ] **Step 1:** Add the model exactly per spec §7 (incl. `gscSiteUrl String`
  stamp (Codex #1), `queryAtLimit`/`queryPageAtLimit` Booleans (Codex #7),
  `@@index([clientId, fetchedAt])`, `onDelete: Cascade`); add `gscSnapshots
  GscSnapshot[]` to `Client`.
- [ ] **Step 2:** Hand-author the migration SQL (CREATE TABLE + index +
  FK ON DELETE CASCADE, matching Prisma's SQLite dialect — copy the style of
  `20260709120000_prospect_sales_view`).
- [ ] **Step 3:** `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate` — clean apply.
- [ ] **Step 4:** `npm run lint` green.
- [ ] **Commit:** `git add prisma/schema.prisma prisma/migrations/20260710150000_gsc_snapshot && git commit -m "feat(schema): GscSnapshot client keyword snapshot model (KS-1)"`

## Task 2: Provider — `fetchGscQueryPage()`

**Files:** `lib/analytics/google/gsc-provider.ts`,
`lib/analytics/google/gsc-provider.test.ts`
**Interface:**

```ts
export type GscQueryRow = { query: string; clicks: number; impressions: number; ctr: number; position: number };
export type GscQueryPageRow = { query: string; page: string; clicks: number; impressions: number; position: number };
export type GscQueryPageResult =
  | { ok: true; data: { queryRows: GscQueryRow[]; queryPageRows: GscQueryPageRow[]; queryAtLimit: boolean; queryPageAtLimit: boolean } }
  | { ok: false; reason: 'not_mapped' | 'access_denied' | 'auth' | 'quota' | 'error'; message?: string };
export async function fetchGscQueryPage(siteUrl: string | null, window: DateWindow): Promise<GscQueryPageResult>
```

Own result union (NOT the shared `SourceResult`): the shared `unmapped` reason
conflates local-null with API-403; here they are distinct facts —
`not_mapped` (siteUrl null, short-circuit before auth) vs `access_denied`
(`classifyApiError` → `unmapped` on a **configured** property) (Codex #5).
`fetchGsc` and the shared union are untouched. **Task 2 OWNS and exports
`GscQueryRow`/`GscQueryPageRow`/`GscQueryPageResult` from the provider;
`lib/keywords/types.ts` (Task 3) imports/re-exports them — never redeclares
them (Codex plan #1; spec §5.1 updated to match).**

- [ ] **Step 1: Failing tests** appended to `gsc-provider.test.ts` (reuse the
  existing `vi.hoisted` mock harness): happy path (2 `mockQuery` calls —
  assert dimensions `['query']` rowLimit 2500 and `['query','page']` rowLimit
  5000, dates from `formatYmd`, siteUrl verbatim, and the 30 s timeout passed
  as the second `query()` argument `{ timeout: 30_000 }`); at-limit flags
  (rows.length === rowLimit → true, one less → false); null siteUrl →
  `not_mapped` with zero API calls; 403 PERMISSION_DENIED on non-null
  siteUrl → `access_denied`; 429 → `quota`; auth failure passthrough.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/analytics/google/gsc-provider.test.ts` — new suite fails.
- [ ] **Step 3:** Implement (Promise.all of 2 `runQuery`-style calls with the
  options arg; map rows discarding null keys; flags; error mapping).
- [ ] **Step 4:** Suite green (existing `fetchGsc` cases untouched).
- [ ] **Commit:** `git add lib/analytics/google/gsc-provider.ts lib/analytics/google/gsc-provider.test.ts && git commit -m "feat(keywords): fetchGscQueryPage provider fetch (KS-1)"`

## Task 3: Pure window + derivations

**Files:** `lib/keywords/types.ts`, `lib/keywords/window.ts(+test)`,
`lib/keywords/derive.ts(+test)`
**Interfaces:** constants `GSC_QUERY_ROW_LIMIT=2500`,
`GSC_QUERY_PAGE_ROW_LIMIT=5000`, `GSC_MIN_IMPRESSIONS=10`,
`GSC_WINDOW_DAYS=91`, `GSC_WINDOW_LAG_DAYS=3`, `CANNIBALIZATION_MIN_SHARE=0.2`,
`CANNIBALIZATION_MIN_PAGE_IMPRESSIONS=10`;
`computeSnapshotWindow(now: Date): DateWindow` (UTC, end = now−3d, start =
end−90d → 91 inclusive days, reuses `dayCount` semantics);
`deriveKeywordSignals(queryRows, queryPageRows, { minImpressions }): KeywordSignals`
(`{ wins, opportunities, quickWins, cannibalization, counts, thresholds }` —
cannibalization entries
`{ query, queryImpressions: number | null, observedPageImpressions, observedPageCoverage: number | null, pages: [{ page, impressions, clicks, share }] }`
— `observedPageImpressions` is the share **denominator**;
`observedPageCoverage` = observedPageImpressions / queryImpressions, `null`
when the query is absent from the query-only rows, and **NOT clamped ≤ 1**
(GSC aggregation/privacy can put page sums above the query total)
(Codex plan #2)).

- [ ] **Step 1: Failing tests.** `window.test.ts`: fixed `now` →
  exact start/end dates, 91-day inclusive span, UTC-only. `derive.test.ts`:
  band edges as raw decimals — position 10.0 → win, 10.4 → opportunity AND
  quick win, 20.4 → opportunity only, 30.1 → neither (Codex #2); position 0
  and negative rows discarded entirely (Codex #2); query below 10 impressions
  excluded from every list; cannibalization share uses the observed query×page
  sum as denominator — fixture where page rows sum to less than the query
  total still yields shares summing to 1 (Codex #3); coverage fields — page
  sums below AND above the query total (coverage > 1 preserved, not
  clamped), query missing from query-only rows → `queryImpressions` and
  `observedPageCoverage` null (Codex plan #2); ≥2 pages each ≥20% and
  ≥10 impressions required; a ≥-threshold query with zero qualifying page
  rows is absent from `cannibalization` (reported as "no cannibalization
  observed" downstream, never "not cannibalized"); sort orders (clicks desc,
  impressions desc tiebreak); empty inputs → empty lists + zero counts.
- [ ] **Step 2:** Run both test files — fail.
- [ ] **Step 3:** Implement (pure, no I/O).
- [ ] **Step 4:** Green.
- [ ] **Commit:** `git add lib/keywords/types.ts lib/keywords/window.ts lib/keywords/window.test.ts lib/keywords/derive.ts lib/keywords/derive.test.ts && git commit -m "feat(keywords): pure snapshot window + keyword signal derivations (KS-1)"`

## Task 4: Snapshot service

**Files:** `lib/keywords/gsc-snapshot.ts(+test)`
**Interfaces:**

```ts
export type GscSnapshotSummary = { fetchedAt, gscSiteUrl, window: {start,end}, thresholds, counts, queryAtLimit, queryPageAtLimit, wins, opportunities, quickWins, cannibalization };  // lists capped: 50/50/50/20 (card+route payload bound; KS-5 re-derives from raw rows)
export async function refreshGscSnapshot(clientId: number): Promise<
  | { ok: true; summary: GscSnapshotSummary }
  | { ok: false; reason: 'client_not_found' | GscQueryPageResult-error-reasons; message?: string }>
export async function getLatestGscSnapshot(clientId: number): Promise<{ gscMapped: boolean; summary: GscSnapshotSummary | null }>
```

- [ ] **Step 1: Failing DB-backed tests** (`gsc-snapshot.test.ts`, provider
  mocked via `vi.mock`, house DB test conventions + row cleanup):
  refresh happy path → one `GscSnapshot` row with verbatim `gscSiteUrl` stamp,
  metadata columns, parseable blobs, returned summary counts (Codex #1);
  **publication atomicity** — provider ok but payload failing the concrete
  validator publishes NO row, **and an already-valid latest snapshot remains
  readable after the failed refresh** (Codex #4, Codex plan #3). Validator
  contract: `queryRows`/`queryPageRows` must be arrays; every row has a
  non-empty `query` (and non-empty `page` for page rows); clicks/impressions
  finite and ≥ 0; position finite (zero/non-positive positions are KEPT at
  storage — discarding them is the derivation contract's job, Codex #2);
  provider error → no row + reason passthrough; unknown client →
  `client_not_found`; **single-flight (deterministic, Codex plan #4)** —
  provider mocked with a **deferred promise**; call `refreshGscSnapshot`
  twice BEFORE resolving; assert exactly one provider invocation; resolve;
  assert one row (requires the service to install the in-flight Map entry
  **synchronously** before any awaited DB/provider work); different clients
  not coalesced (Codex #7); **summary caps** — 51/51/51/21 derived entries →
  lists capped 50/50/50/20 while `counts` stay full (cap lives at the
  service/API boundary, NEVER in `derive`) (Codex plan #4);
  **latest ordering** —
  same `fetchedAt`, higher id wins (`fetchedAt DESC, id DESC`) (Codex #1);
  **mapping-change** — snapshot stamped property A, client now maps B →
  `{ gscMapped: true, summary: null }`, A's data never surfaced (Codex #1);
  **corrupt-newest fallback** — corrupt newest blob → next valid
  mapping-matched row served + `logError`, all-corrupt → null (Codex #4);
  unmapped client → `{ gscMapped: false, summary: null }` (Codex #6).
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** Implement: module-level `Map<number, Promise>` single-flight
  — the entry is set **synchronously on call** (before the first `await`;
  Codex plan #4), deleted in `finally`; parse→validate (contract above)→
  derive BEFORE `create`; summary list caps applied here; read path
  `findMany({ where: { clientId, gscSiteUrl: current }, orderBy: [{fetchedAt:'desc'},{id:'desc'}], take: 3 })`
  scanning for the first valid blob pair.
- [ ] **Step 4:** Green.
- [ ] **Commit:** `git add lib/keywords/gsc-snapshot.ts lib/keywords/gsc-snapshot.test.ts && git commit -m "feat(keywords): GSC snapshot service — single-flight refresh, mapping-filtered reads (KS-1)"`

## Task 5: Routes

**Files:** `app/api/clients/[id]/gsc-snapshot/route.ts(+test)`
**Interface:** `export const dynamic = 'force-dynamic'`; `GET`/`POST` per the
client-route idiom (`app/api/clients/[id]/analytics/route.ts` — Promise
params, parseInt guard). Cookie-gated by global middleware — **no middleware
change** (assert nothing added to `isPublicPath`).

- [ ] **Step 1: Failing route tests** (service mocked): invalid id → 400;
  POST unknown client → 404; `not_mapped` → 409 `{error code
  'gsc_not_mapped'}`; `access_denied` → 409 `gsc_access_denied` (Codex #5);
  `quota` → 429; `auth`/`error` → 502; ok → 200 `{ summary }`;
  GET → 200 `{ gscMapped, summary }`.
- [ ] **Step 2:** Run — fail. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Commit:** `git add "app/api/clients/[id]/gsc-snapshot/route.ts" "app/api/clients/[id]/gsc-snapshot/route.test.ts" && git commit -m "feat(keywords): client gsc-snapshot refresh + read routes (KS-1)"`

## Task 6: Retention

**Files:** `lib/keywords/retention.ts(+test)`, `lib/cleanup.ts`

- [ ] **Step 1: Failing test:** 5 snapshots ×2 clients (staggered fetchedAt) →
  `pruneGscSnapshots()` leaves the latest 3 per client (by
  `fetchedAt DESC, id DESC`), other clients' rows untouched.
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** Implement — single correlated-subquery raw delete (house
  EXISTS/subquery idiom; no transaction needed, no `updatedAt` on this model):
  ```sql
  DELETE FROM GscSnapshot WHERE id NOT IN (
    SELECT id FROM GscSnapshot AS keep WHERE keep.clientId = GscSnapshot.clientId
    ORDER BY keep.fetchedAt DESC, keep.id DESC LIMIT 3)
  ```
  via Prisma's tagged `$executeRaw` template with quoted identifiers — never
  `$executeRawUnsafe`/string interpolation (Codex plan review). Wire
  `pruneGscSnapshots()` into `runCleanup()`'s `Promise.allSettled` list.
- [ ] **Step 4:** Green; full `DATABASE_URL="file:./local-dev.db" npm test` still green.
- [ ] **Commit:** `git add lib/keywords/retention.ts lib/keywords/retention.test.ts lib/cleanup.ts && git commit -m "feat(keywords): keep-latest-3 GscSnapshot retention in runCleanup (KS-1)"`

## Task 7: Dashboard card + page wiring

**Files:** `components/clients/GscKeywordCard.tsx(+test)`,
`app/(app)/clients/[id]/page.tsx`

- [ ] **Step 1: Failing component tests** (`afterEach(cleanup)`; fetch
  mocked): unmapped state (hint copy, no fetch call); empty state (Refresh
  CTA); loaded state (counts row, fetchedAt + window line, hedged caption
  "observed in this GSC window", top-5 cannibalization, "may be truncated"
  notice only when an at-limit flag set); refresh click → POST + re-render
  from response; error state shows reason copy, keeps prior data, and
  `gsc_access_denied` copy ≠ `gsc_not_mapped` copy (Codex #5/#6); button
  disabled in flight.
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** Implement card (client component, `initial` prop =
  `{ gscMapped, summary }`; ephemeral error state; dark-mode variants on
  every element; SeverityBadge/StatusPill token conventions). Wire the page:
  add `getLatestGscSnapshot(clientId)` to the `Promise.all`, render
  `<GscKeywordCard clientId={…} initial={…} />` after `AnalyticsIdsPanel`.
- [ ] **Step 4:** Green.
- [ ] **Commit:** `git add components/clients/GscKeywordCard.tsx components/clients/GscKeywordCard.test.tsx "app/(app)/clients/[id]/page.tsx" && git commit -m "feat(keywords): GSC keyword snapshot dashboard card (KS-1)"`

## Task 8: Gates, PR, ship ritual

- [ ] `npm run lint` && `DATABASE_URL="file:./local-dev.db" npm test` &&
  `npm run build` — all green.
- [ ] Push branch `feat/ks1-gsc-snapshot`, open PR (`gh pr create`) noting:
  additive migration (auto-applies on deploy), no new env vars, no middleware
  change, no public surface.
- [ ] Merge when gate-green (change-control rule 1); deploy
  (`git push` + `ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"`);
  post-deploy verify: BUILD_ID fresh, `/api/health` ok, migration applied
  (read-only schema check), clean boot log.
- [ ] Prod verification of the changed path: dashboard card on a GSC-mapped
  client (Refresh → snapshot lands; counts render) — client sites are NOT
  fetched (GSC API only, gate 3 satisfied).
- [ ] Tracker + handoff ritual in the same commit; `git mv` spec+plan to
  `docs/superpowers/archive/`.

## Error handling & invariants (restated)

Failed refresh never mutates prior data; partial payloads never published;
corrupt newest row skipped in favor of next valid; reads filtered to the
current `gscSiteUrl` stamp; at-limit ≠ truncated in every surface's copy;
absence hedged as "not observed in this GSC window"; no key/path leakage in
error messages.

## Out of scope

KS-2+ (volume, roster, export), scheduled refresh cadence, pagination,
Finding/score integration, any `computeKeywordSignals`/krt_/report changes.
