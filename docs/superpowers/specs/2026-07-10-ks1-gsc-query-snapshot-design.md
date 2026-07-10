# KS-1 — GSC query×page keyword snapshot (design)

**Status:** spec — first increment of the C20 Keyword Strategy capability
(umbrella: `2026-07-10-keyword-strategy-capability-design.md`, gap G1).
**Written:** 2026-07-10, from a code recon of main @ `2a0a1b4`.
**Codex review:** ACCEPT-WITH-NAMED-FIXES ×7 (2026-07-10), all applied in
place — tagged "(Codex #N)" where they land.
**Doubles as:** C12 content-auditing **Tier-0 Increment A** (GSC query×page
cannibalization — `../nyi/FUTURE-content-auditing.md` §6.1). One fetch, one
snapshot, both consumers.
**Standing gates honored:** NO AI API (pure data join, zero LLM calls). Zero
site fetches — this reads Google's API about the site, never the site itself.

## 1. Goal

Give every GSC-mapped client a durable, client-scoped **keyword snapshot**:
raw Search Console `[query]` and `[query, page]` rows over a trailing window,
plus pure read-time derivations — **wins (avg position 1–10), opportunities
(11–30), quick wins (11–20), and query×page cannibalization (≥2 pages
splitting one query's impressions)**. Surfaced as a client-dashboard card;
consumed later by KS-5's krt_-v2 export. Refresh is operator-on-demand in
KS-1; KS-5 adds refresh-on-memo-mint.

## 2. Background — verified code facts this builds on

- `lib/analytics/google/gsc-provider.ts` — `fetchGsc(siteUrl, period,
  comparison)` issues 6 `searchanalytics.query` calls (totals / date /
  query-only ×2 windows, query rowLimit 100). Its **only caller** is
  `lib/jobs/handlers/seo-report-render.ts:176`. `classifyApiError` maps
  googleapis failures into the `SourceResult` reason taxonomy
  (`unmapped | auth | quota | error`) — quota (RESOURCE_EXHAUSTED/429)
  checked first, 401→auth, 403→unmapped. The siteUrl is passed **verbatim,
  never normalized** (`sc-domain:` vs `https://` are different properties).
- `lib/analytics/google/auth.ts` — `getAuthClient()` service-account auth
  (`GOOGLE_SA_KEY_FILE`), scope `webmasters.readonly` already granted;
  C10 prod-verified. Missing/invalid key → `{ok:false, reason:'auth'}`,
  never a throw.
- `lib/analytics/types.ts` — `SourceResult<T>` union; `lib/analytics/dates.ts`
  — pure UTC `DateWindow`/`formatYmd` helpers.
- `Client.gscSiteUrl` (`prisma/schema.prisma:25`) — nullable verbatim GSC
  property string, editable via the dashboard's `AnalyticsIdsPanel`.
- Client dashboard (`app/(app)/clients/[id]/page.tsx`) — server component
  Promise.all-loading per-card services; card precedents:
  `ScheduledScansCard` (client component seeded with server-loaded
  `initial`, mutates via cookie-gated `/api/clients/[id]/…` routes) and
  `AnalyticsIdsPanel`.
- Route kit: `withRoute()` + `parseJsonBody()` (`lib/api/`); `/api/clients/*`
  is cookie-gated by default middleware — **no `isPublicPath` change, no new
  public surface** in KS-1.
- Retention seam: `runCleanup()` (`lib/cleanup.ts:22`) — `Promise.allSettled`
  list of pruners; house pattern for new table retention.
- Prior art for the derivation semantics: `computeKeywordSignals()`
  (`lib/services/aggregator.service.ts:788`) — SEMRush-CSV-bound
  cannibalization/quick-wins. **Untouched by KS-1**; the GSC derivations are
  a parallel source with hedged semantics (below), not a replacement.

### GSC API facts (Search Console `searchanalytics.query`, v1 — stable)

- Dimensions may include `query` and `page`; `rowLimit` max 25 000 per
  request with `startRow` pagination. KS-1 issues **one request per shape**
  (no pagination) and flags **at-limit** when `rows.length === rowLimit`
  ("possibly truncated" — never claimed as definite truncation; Codex #7).
- Query data is **sampled and privacy-thresholded**; `position` is an
  impression-weighted average over the window. Fresh data lags ~2–3 days.

## 3. Completeness semantics (umbrella Codex #4 — inherited verbatim)

A keyword absent from the snapshot is **"not observed in this GSC window"**,
never proof of not ranking. Every snapshot carries explicit metadata — date
window, per-shape row limit + truncation flag, minimum-impression threshold,
fetchedAt — and every consumer (card, KS-5 export, skill memo) phrases
gap/cannibalization claims with that hedge. Derivations additionally exclude
sub-threshold queries rather than treating them as signal.

## 4. Scope decisions (proposed; none contradict umbrella §5 — Kevin can override)

- **D1 — Snapshot home: a new `GscSnapshot` model**, not run-metadata JSON.
  GSC data has no natural CrawlRun to ride (it isn't a crawl); the snapshot
  must survive the memo window and be findable as "latest per client".
  Raw rows stored as two JSON text columns (query rows / query×page rows);
  metadata as real columns. Derivations are **computed at read time by pure
  functions** — never persisted — so thresholds/classifications can evolve
  without refetching.
- **D2 — Fetch shape: 2 API calls, one window.** `['query']` rowLimit
  **2 500** and `['query','page']` rowLimit **5 000**, single window
  (no comparison window — trend is KS-5+ territory). Window default:
  **trailing 91 days (13 weeks) ending 3 days before fetch** (UTC), sidestepping
  GSC's fresh-data lag. **At-limit flagged per shape (Codex #7):**
  `rows.length === rowLimit` proves only "at limit / possibly truncated",
  never definite truncation — fields are named `…AtLimit` and every UI/export
  surface phrases it "may be truncated".
- **D3 — Refresh owner: operator-on-demand, single-flight.** A "Refresh"
  action on the dashboard card POSTs a cookie-gated route that fetches
  **inline** (2 API calls, seconds — no durable job, no recovery path needed;
  a failed refresh leaves the previous snapshot untouched). **Single-flight
  per client (Codex #7):** a module-level in-flight promise map coalesces
  concurrent refreshes for the same client (sufficient in this single-PM2-
  process architecture) — two tabs spend 2 API calls and create 1 row, not 4
  and 2. Refresh **errors are ephemeral** (component state only — not
  persisted; a reload shows the last good snapshot with no error banner;
  Codex #6). No scheduled sweep in KS-1 (umbrella §5 Q6 stays open; recorded
  default = refresh again at memo mint, KS-5). Per-call gaxios timeout 30 s
  so a hung Google call can't hang the route indefinitely.
- **D4 — Derivation thresholds (constants in `lib/keywords/`, recorded in
  snapshot metadata):** minimum **10 impressions** per query in-window to
  participate in any derivation. **Bands are raw-decimal comparisons on the
  aggregate position (Codex #2)** — GSC positions are decimals; no rounding:
  wins = `position <= 10`; opportunities = `position > 10 && position <= 30`;
  quick wins = `position > 10 && position <= 20` (subset of opportunities,
  umbrella semantics). Rows with invalid or non-positive positions (the
  provider's numeric fallback is `0`) are **discarded**, never classified —
  a `0` must not become a false win. Cannibalization = a ≥-threshold query
  where **≥2 pages each hold ≥20% impression share and ≥10 impressions**,
  computed from the query×page rows; **the share denominator is the sum of
  *observed* query×page impressions for that query (Codex #3)** — page rows
  are privacy-filtered/limited and need not sum to the query-only total.
  The result exposes observed-page coverage + the at-limit flag, and a query
  without qualifying page rows is **"no cannibalization observed"**, never
  "not cannibalized". All other derivations use the query-only rows.
- **D5 — New `lib/keywords/` directory starts here** (the umbrella already
  assigns KS-2's provider to it): `gsc-snapshot.ts` (fetch+persist service),
  `derive.ts` (pure derivations), `types.ts`.

## 5. Architecture

### 5.1 Provider addition — `fetchGscQueryPage()` (`gsc-provider.ts`)

New exported function alongside `fetchGsc` (existing function untouched):

```ts
fetchGscQueryPage(siteUrl: string | null, window: DateWindow):
  Promise<SourceResult<{
    queryRows: GscQueryRow[];        // { query, clicks, impressions, ctr, position }
    queryPageRows: GscQueryPageRow[]; // { query, page, clicks, impressions, position }
    queryAtLimit: boolean;           // rows.length === rowLimit — "possibly truncated"
    queryPageAtLimit: boolean;
  }>>
```

Reuses `getAuthClient`, `classifyApiError`, verbatim-siteUrl rule, and the
null-siteUrl→`unmapped` short-circuit. Two `Promise.all`'d
`searchanalytics.query` calls with `{ timeout: 30_000 }` request options.
**The local-null `unmapped` and the API-403 `unmapped` are different facts
(Codex #5):** the function distinguishes them for the caller (e.g. a
`detail: 'not_mapped' | 'access_denied'` alongside the reason) so the route
never tells the operator to configure a property that is already configured.

### 5.2 Snapshot service — `lib/keywords/gsc-snapshot.ts`

- `refreshGscSnapshot(clientId)` — loads the client (404 upstream if
  missing), calls `fetchGscQueryPage(client.gscSiteUrl, window)`; on
  `ok:false` returns the SourceResult (route maps it to an honest error
  envelope, previous snapshot untouched). **Publication is atomic
  (Codex #4):** the payload is parsed, validated, and derived **before**
  `prisma.gscSnapshot.create` — a fetch/derive failure publishes nothing;
  a partial snapshot is never written. Stamps the **verbatim `gscSiteUrl`
  used for the fetch** on the row (Codex #1). Returns the derived summary.
  **Single-flight (Codex #7):** a module-level `Map<clientId, Promise>`
  coalesces concurrent refreshes; entry removed in `finally`.
- `getLatestGscSnapshot(clientId)` — newest rows ordered
  `fetchedAt DESC, id DESC` (concurrent-timestamp determinism, Codex #1)
  **filtered to the client's current `gscSiteUrl`** — after a mapping change,
  data from the prior property is never surfaced (Codex #1). JSON.parse
  wrapped; a **corrupt newest row is skipped (+ `logError`) and the next
  newest valid, mapping-matched snapshot is served** instead of hiding prior
  data behind a null (Codex #4; bounded scan of the ≤3 retained rows).
  Returns `{ gscMapped, summary | null }` so the card can distinguish
  unmapped from mapped-but-never-fetched (Codex #6).

### 5.3 Pure derivations — `lib/keywords/derive.ts`

`deriveKeywordSignals(queryRows, queryPageRows, { minImpressions })` →
`{ wins, opportunities, quickWins, cannibalization, counts, thresholds }`.
Band membership and cannibalization exactly per D4 (raw-decimal comparisons,
invalid/non-positive positions discarded, observed-impressions share
denominator). Wins/opportunities/quick-wins sorted by clicks desc then
impressions desc; cannibalization entries carry the query, its observed
query×page impressions (the denominator), and the competing pages with
per-page share. Pure, no I/O, fully unit-tested.

### 5.4 Routes (cookie-gated, `withRoute`)

- `POST /api/clients/[id]/gsc-snapshot` — refresh. 404 unknown client;
  409 `gsc_not_mapped` when `gscSiteUrl` is null (configure a property);
  409 `gsc_access_denied` when the API 403s on a **configured** property
  (grant the service account access — a distinct operator action, Codex #5);
  502 `gsc_auth` / 429 `gsc_quota` / 502 `gsc_error` for the remaining
  SourceResult reasons; 200 with `{ summary }` on success.
- `GET /api/clients/[id]/gsc-snapshot` — `{ gscMapped, summary | null }`
  (card re-poll without page reload).

### 5.5 UI — `components/clients/GscKeywordCard.tsx`

Client component seeded with server-loaded `initial` (dashboard page adds
`getLatestGscSnapshot` to its `Promise.all` — its `{ gscMapped, summary }`
shape carries the mapping state the dashboard service doesn't currently
select; Codex #6), rendered near `ScheduledScansCard`. States: **unmapped**
(`gscMapped:false` — "Map a GSC property" hint pointing at AnalyticsIdsPanel;
no API call) · **empty** (mapped, never fetched — Refresh CTA) · **loaded**
(fetchedAt + window line, counts row — wins / opportunities / quick wins /
cannibalized queries — top-5 cannibalization list with hedged caption
"observed in this GSC window", "may be truncated" notice when an at-limit
flag is set) · **error** (this-session refresh failure reason, previous data
kept — **ephemeral component state, not persisted**; a reload shows the last
good snapshot; Codex #6). `gsc_access_denied` renders its own copy (grant SA
access) distinct from `gsc_not_mapped`. Refresh button disables while in
flight. Dark-mode variants on every element; follows the
SeverityBadge/StatusPill token conventions (A8).

## 6. Data flow

Operator clicks Refresh → POST route → `refreshGscSnapshot` →
`fetchGscQueryPage` (2 GSC calls) → `GscSnapshot` row created (raw rows +
metadata) → derived summary returned → card re-renders. Dashboard load →
`getLatestGscSnapshot` → derive at read time → card `initial`.
KS-5 (later) reads the same latest snapshot into the krt_-v2 export and
refreshes at memo mint.

## 7. Schema change (hand-authored migration, house procedure)

```prisma
model GscSnapshot {
  id                Int      @id @default(autoincrement())
  clientId          Int
  client            Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  gscSiteUrl        String   // verbatim property this snapshot was fetched from (Codex #1)
  fetchedAt         DateTime @default(now())
  windowStart       DateTime
  windowEnd         DateTime
  queryRowLimit     Int
  queryPageRowLimit Int
  queryAtLimit      Boolean  // rows hit the limit — "possibly truncated" (Codex #7)
  queryPageAtLimit  Boolean
  minImpressions    Int
  queryRowsJson     String   // JSON: GscQueryRow[]
  queryPageRowsJson String   // JSON: GscQueryPageRow[]

  @@index([clientId, fetchedAt])
}
```

Additive migration `20260710…_gsc_snapshot`; `Client` gains the back-relation.
Cascade is correct: snapshots are pure derived data, worthless without the
client. Blob size bounded by the row limits (~1–2 MB worst case, typical far
smaller for these clients).

## 8. Retention

`pruneGscSnapshots()` in `runCleanup()`: keep the **latest 3 per client**,
delete older rows (single `deleteMany` with a NOT-IN-latest-3 predicate per
client, or the house raw-SQL `EXISTS` idiom — plan decides the exact SQL).
No age-based rule needed; 3 rows bound the size regardless of cadence.

## 9. Error handling & invariants

- A failed refresh **never** deletes or mutates the previous snapshot, and a
  partial payload is **never** published — parse/validate/derive precede the
  create (Codex #4).
- SourceResult reasons map to route error codes (§5.4) with the
  not-mapped/access-denied distinction preserved (Codex #5); messages never
  include the service-account key or file path.
- `JSON.parse` of stored blobs is try-caught; a corrupt newest row is skipped
  (+ `logError`) in favor of the next valid retained row (Codex #4).
- Reads only ever serve snapshots whose stamped `gscSiteUrl` matches the
  client's current mapping (Codex #1).
- No interactive `$transaction` anywhere (single-row create; retention is a
  deleteMany — no transaction needed).
- The verbatim-siteUrl rule is preserved; no URL normalization on `page`
  values either (GSC returns canonical URLs; consumers match loosely later —
  KS-5's concern, breadcrumbed).
- No change to `computeKeywordSignals`, the krt_ export, `fetchGsc`, or any
  report path.

## 10. Out of scope (breadcrumbed)

- Volume enrichment (KS-2), roster/profile (KS-3), export/memo integration
  (KS-5 — the snapshot summary shape in `lib/keywords/types.ts` is written
  to be embeddable in the KS-5 package verbatim).
- Scheduled refresh cadence + threshold tuning (umbrella §5 Q6).
- Pagination past the row limits; comparison windows / trend.
- Any Finding/score integration (measurement-first house pattern).

## 11. Testing

- `derive.test.ts` — pure derivation cases: band edges as raw decimals
  (10.4 → opportunity/quick-win, 10.0 → win; Codex #2), position-`0`/negative
  rows discarded (never a false win; Codex #2), threshold exclusion,
  cannibalization share math against the observed-impressions denominator
  (page rows summing to less than the query total; Codex #3), query with no
  qualifying page rows → "no cannibalization observed", empty rows.
- `gsc-provider.test.ts` additions — `fetchGscQueryPage` happy path,
  at-limit flags, null siteUrl (`not_mapped`) vs API-403 (`access_denied`)
  distinction (Codex #5), error classification passthrough (mocked
  googleapis, existing test conventions).
- `gsc-snapshot.test.ts` — service create/latest; **mapping-change test**
  (snapshot exists for property A, client remapped to B → latest returns
  null, never A's data; Codex #1); **corrupt-newest fallback** (corrupt
  newest → next valid row served; Codex #4); `fetchedAt DESC, id DESC`
  ordering; **single-flight** (two concurrent refreshes → one fetch, one
  row; Codex #7). DB-backed, house test env
  `DATABASE_URL="file:./local-dev.db"`.
- Route tests — 404 / 409 `gsc_not_mapped` / 409 `gsc_access_denied` /
  429 / 502 / 200 envelope per reason.
- `GscKeywordCard.test.tsx` — the states incl. access-denied copy and the
  "may be truncated" notice, `afterEach(cleanup)` (globals:false convention).
- Retention test — 5 snapshots ×2 clients → latest 3 each survive.

## 12. Acceptance criteria

1. A GSC-mapped client's dashboard shows the card; Refresh produces a
   snapshot row and the card shows counts + fetchedAt within seconds.
2. Unmapped client → hint state; no API call made.
3. Derivations match the D4 definitions on a fixture; every list the UI or
   export shows carries the window/hedge metadata.
4. Quota/auth failures surface honestly on the card; prior snapshot intact.
5. Retention keeps exactly 3 per client.
6. Gates green (tsc / vitest / build); zero changes to report rendering,
   krt_ flow, middleware, or any public surface.
