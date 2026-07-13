# D4 — Client-Attached Robots/Sitemap Checks + History — Design

**Date:** 2026-07-12 · **Status:** Codex-reviewed (ACCEPT WITH NAMED FIXES ×8, all applied — marked "Codex #N" below)
**Roadmap:** `docs/superpowers/nyi/improvement-roadmaps/05-small-tools.md` steps 2 + 4
**Depends on:** D3 (`lib/seo-fetch/` — shipped, PR #165)
**Sets up:** D5 (scheduled monitoring with change-only alerts)

## Problem

The robots validator is a polished one-shot checker whose results evaporate on
refresh. Nothing ties a robots.txt/sitemap state to a client, so there is no
history, no "what changed since last month", and no foundation for D5's
scheduled change-alerting. A silently-broken robots.txt or sitemap costs a
client rankings for weeks before anyone notices.

## Goal

"Check a client's domain" runs **server-side**, stores a `RobotsCheck`
snapshot (content hash, parsed result, issues, sitemap inventory), and
surfaces latest state + history on the client page. Only client-registered
domains get rows (roadmap: never persist anonymous validator-page runs).

**Non-goals (explicitly out of D4):** scheduling/alerting (D5); `Finding`
rows or any score impact (measurement-first house pattern — D5 decides
alerting semantics); per-URL verification that sitemap URLs resolve;
persisting anonymous one-shot validations; any change to the existing
`/robots-validator` page flow beyond a deep link into it.

## Rejected approaches

- **Persist the browser-parsed validator result** (POST the client-side parse
  to be saved): snapshots wouldn't be reproducible (browser fetch bypasses the
  server's hash-of-observed-bytes), parse versions could drift per tab, and
  D5's scheduler needs a server runner regardless.
- **Durable job runner now:** a manual check is a handful of bounded fetches
  (seconds); the GSC snapshot POST is the synchronous precedent. D5 wraps the
  same service function in a scheduled job when recurrence actually needs
  durability.

## Architecture

Three units: a pure-ish **runner** (compute), a **service** (persist/list/
prune), and a **card** (UI). Routes are thin `withRoute` wrappers over the
service.

### 1. `lib/robots-check/` (new module)

**`types.ts` (client-safe — imported by the card):**

```ts
export const ROBOTS_CHECK_DETAIL_VERSION = 1
export const ROBOTS_CHECK_MAX_SITEMAPS = 5      // declared sitemaps fetched per check
export const ROBOTS_CHECK_MAX_CHILDREN = 20     // index children expanded per sitemap
export const ROBOTS_CHECK_HISTORY_LIMIT = 20    // list/display cap
// Retention keeps HISTORY_LIMIT + 1 rows per (client, domain): one hidden
// predecessor so the oldest VISIBLE row's `changed` flag never flips to null
// when retention prunes its comparison target (Codex #3).

export type RobotsFetchStatus = 'ok' | 'missing' | 'unreachable'
// 'ok'          — 2xx, body parsed
// 'missing'     — HTTP 404/410 (a real, common state: "no robots.txt")
// 'unreachable' — everything else (other http-error, dns, timeout, unsafe-url, …)

export interface SitemapChildObservation {
  url: string
  contentHash: string | null        // sha256 of the child XML actually fetched; null = fetch failed
}

export interface SitemapCheckEntry {
  url: string
  source: 'robots' | 'convention'   // declared in robots.txt vs /sitemap.xml fallback probe
  ok: boolean
  httpStatus: number | null
  failure: string | null            // SeoFetchFailure when !ok
  isIndex: boolean
  urlCount: number | null           // total page locs (one-level index expansion), null when !ok
  childrenTotal: number             // ELIGIBLE children (post host-filter — the frozen
                                    // collector filters BEFORE counting; Codex #6)
  childrenExcluded: number          // child declarations dropped by the host filter (Codex #6)
  childrenFailed: number            // real fetch failures among expanded children
  childrenSkipped: number           // children beyond ROBOTS_CHECK_MAX_CHILDREN / time budget
  contentHash: string | null        // sha256 hex of the fetched XML text, null when !ok
  // Child-level change evidence (Codex #2): an index's children can change
  // while the index XML itself is byte-identical. The budget wrapper records
  // (url, hash) for every child it actually fetched (bounded by MAX_CHILDREN),
  // in fetch order; childrenHash = sha256 over the ordered "url\n(hash|failed)"
  // lines — the cheap aggregate the changed-comparator uses.
  children: SitemapChildObservation[]
  childrenHash: string | null       // null when not an index / nothing expanded
  issues: SitemapIssue[]            // parseSitemapXml issues (top-level doc only)
}

export interface RobotsCheckDetail {
  v: 1
  domain: string
  robots: {
    status: RobotsFetchStatus
    httpStatus: number | null
    failure: string | null          // SeoFetchFailure when status !== 'ok'
    contentHash: string | null      // sha256 hex of body, null unless ok
    issues: RobotsIssue[]
    blockedBots: string[]           // KNOWN_AI_BOTS blocked (from parseRobotsTxt)
    sitemapUrls: string[]           // declared Sitemap: directives (parseRobotsTxt)
  }
  sitemaps: SitemapCheckEntry[]
  sitemapsSkipped: number           // declared sitemaps beyond ROBOTS_CHECK_MAX_SITEMAPS
  timeBudgetExhausted: boolean      // honest flag: some work was skipped for time
  totals: { sitemapUrlTotal: number | null; errors: number; warnings: number }
}

export interface RobotsCheckSummary {
  id: number
  domain: string
  source: string                    // 'manual' (D5 adds 'scheduled')
  robotsStatus: RobotsFetchStatus
  sitemapUrlTotal: number | null
  errorCount: number
  warningCount: number
  changed: boolean | null           // vs previous row same (client,domain); null = first check
  createdAt: string
}
```

`errors`/`warnings` aggregate severity counts across robots issues + all
sitemap issues, PLUS synthetic entries so the summary numbers never read
"0 errors" when the fetch itself failed: robots `unreachable` and each
failed sitemap entry each add one error; robots `missing` adds one warning
(a real but common state, not an error). `info`-severity issues are not
counted in either bucket (they render in the detail view only).

**`runner.ts` (server-only — imports `lib/seo-fetch/fetch.ts`):**

`runRobotsCheck(domain: string, deps?: RunnerDeps): Promise<RobotsCheckRunResult>`

- Returns `{ detail: RobotsCheckDetail, robotsContent: string | null }` — the
  raw fetched robots body rides OUTSIDE the detail so the service can persist
  it to the `robotsContent` column without bloating `detailJson`; only
  `detail` is ever exposed through API responses (Codex #1).
- `RunnerDeps = { fetchRobotsTxt, fetchSitemapXml, now }` — defaults to the
  real `lib/seo-fetch` functions + `Date.now`; tests inject fixtures (house
  `realDeps` pattern). The runner itself never touches the DB.
- Base URL is `https://<domain>` (client domains are normalized bare domains
  via `normalizeClientDomain`; https-only v1 — an http-only site reads
  `unreachable`, which is honest and itself a finding-worthy state).
- **Robots phase:** `fetchRobotsTxt` → classify: ok → `parseRobotsTxt(text)`
  (issues, blockedBots, sitemapUrls); http-error with status 404/410 →
  `missing`; anything else → `unreachable` with the `SeoFetchFailure` recorded
  verbatim. Content hash = sha256 hex of the exact fetched text.
- **Sitemap target selection:** declared `sitemapUrls` from the parse, in
  declaration order, capped at `ROBOTS_CHECK_MAX_SITEMAPS`
  (`sitemapsSkipped` = overflow). Declared URLs are used as-is (cross-host
  declarations still go through `safeFetch` — SSRF guard is the boundary,
  not same-domain-ness). When robots is missing/unreachable OR declares no
  sitemaps: probe the crawler's convention paths `/sitemap.xml`,
  `/sitemap_index.xml`, `/wp-sitemap.xml` in order. A probe "wins" only when
  the fetch is ok AND `parseSitemapXml` recognizes a sitemap document
  (`isSitemapIndex || urlCount > 0 || valid`) — a 200 text/plain or
  malformed body does NOT win, because `fetchSitemapXml` only rejects HTML
  content types (Codex #4). The winner is recorded with
  `source: 'convention'`; non-winning probes are not recorded as entries.
  If no probe qualifies, record the most informative single outcome: the
  last fetch-ok-but-unrecognized probe (with its parse issues) if one
  exists, else the last probe's fetch failure — so the check is honest
  about having looked.
- **Per-sitemap:** `fetchSitemapXml` → on ok: `parseSitemapXml` (validation
  issues, top-level counts) + `sha256(text)`; if `isSitemapIndex`, expand via
  `collectSitemapPageUrls` with a **budget-capped fetcher wrapper**: the
  injected `fetchXml` counts calls and returns `null` once
  `ROBOTS_CHECK_MAX_CHILDREN` is reached or the time budget is exhausted.
  Because every skipped child registers as a `null` (= failed) inside the
  frozen `collectSitemapPageUrls`, the runner derives
  `childrenSkipped = wrapper.skippedCount` and
  `childrenFailed = max(0, result.childrenFailed - childrenSkipped)`
  (clamped defensively — Codex reasoning) — reuses the frozen D3 function
  unchanged while keeping the honest-flags contract (no silent caps). The
  wrapper ALSO records a `SitemapChildObservation` (url + sha256-of-XML, or
  null hash on failure) per child it actually fetched, in fetch order —
  the child-level change evidence (Codex #2); `childrenHash` aggregates them.
  NOTE the collector runs children in concurrent batches of 5, so wrapper
  counters/observations must be safe under concurrent invocation (plain
  synchronous mutation is fine — no awaits inside the wrapper's accounting).
- **Child host filter (Codex #6):** the `isSameDomain` predicate passed to
  the collector accepts children whose host matches the PARENT sitemap's
  final URL host, www-insensitively (a cross-host declared sitemap thus
  expands its own children rather than dropping them all). The frozen
  collector filters BEFORE counting, so `childrenTotal` = eligible children;
  the runner separately computes
  `childrenExcluded = extractChildSitemapLocs(xml).length - childrenTotal`
  (pure re-parse, cheap) so dropped declarations remain visible.
- **Time budget (Codex #5):** `ROBOTS_CHECK_TIME_BUDGET_MS = 60_000` from
  `deps.now()` at start. Checked before EVERY fetch (each sitemap fetch and
  each child-fetcher call); on exhaustion remaining work is skipped and
  `timeBudgetExhausted: true`. Individual fetches keep `lib/seo-fetch`'s
  frozen 15 s timeout, so the documented worst case is
  `budget + FETCH_TIMEOUT_MS` (≈75 s): fetches already in flight at the
  deadline (one batch runs concurrently) still get their full 15 s. This
  hard bound must sit under the RunCloud/NGINX proxy timeout with margin
  (Kevin-verify item below).
- `totals.sitemapUrlTotal` = sum of `urlCount` over ok entries; `null` when
  no sitemap was successfully fetched (absence ≠ zero — house rule).
- Fully deterministic given deps; no `Date.now`/`Math.random` outside
  `deps.now`.

**`service.ts` (server-only):**

- `runAndStoreRobotsCheck(clientId, domain, { source })` — `source` is
  validated `'manual' | 'scheduled'` (D5's scheduled caller uses the same
  entry point — Codex #7). Synchronous **single-flight** per
  `clientId:domain` key (Map of in-flight promises, following
  `gsc-snapshot.ts`, including the lesson that every derived `.finally()`
  cleanup chain carries its own no-op `.catch` — an unhandled rejection
  there crashes the process). A second caller that joins an in-flight run
  awaits the same promise and gets the same row — the FIRST caller's
  `source` is what gets stored; documented, acceptable (both callers
  observe identical data either way). Runs the runner, then a single
  `create` with scalars (incl. `robotsContent` from the runner's
  server-only return — Codex #1) + `detailJson` (`{v:1,…}`).
  Returns `{ summary, detail }` with `changed` computed (see below).
- `listRobotsChecks(clientId, domain?)` — ordered
  `(createdAt DESC, id DESC)` (this exact order everywhere: list,
  predecessor lookup, retention — Codex #3), cap
  `ROBOTS_CHECK_HISTORY_LIMIT`, mapped to `RobotsCheckSummary`. `changed`
  is computed at read time against the previous row for the same
  `(clientId, domain)`: robots hash differs OR robotsStatus differs OR the
  ordered list of sitemap `(url, contentHash, childrenHash)` triples
  differs — `childrenHash` catches child-sitemap churn under a
  byte-identical index (Codex #2). Read from `detailJson`;
  corrupt/unparseable detail → `changed: null`, never a throw. Read-time
  computation means D5 can later refine "changed" semantics without a
  backfill.
- `getRobotsCheck(clientId, checkId)` — ONE method returning
  `{ summary, detail }` with `changed` computed the same way (the routes
  and the POST return path share it — no summary/detail shape drift,
  Codex #8); ownership enforced (`checkId` AND `clientId` must match);
  not-found or corrupt JSON → `null` (route 404s), never a throw.
- `retention.ts` — `pruneRobotsChecks()`: keep newest
  `ROBOTS_CHECK_HISTORY_LIMIT + 1` rows per `(clientId, domain)` by
  `(createdAt DESC, id DESC)` — the +1 hidden predecessor keeps the oldest
  VISIBLE row's `changed` flag stable across pruning (Codex #3); tagged
  `$executeRaw` (KS-1 `lib/keywords/retention.ts` precedent), wired into
  `runCleanup()`.

### 2. Prisma model (hand-authored migration)

```prisma
model RobotsCheck {
  id                Int      @id @default(autoincrement())
  clientId          Int
  client            Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  domain            String   // normalized bare domain the check ran against
  source            String   @default("manual") // 'manual' | 'scheduled' (D5)
  robotsStatus      String   // RobotsFetchStatus
  robotsContentHash String?  // sha256 hex, null unless robots ok
  robotsContent     String?  // raw robots.txt body (≤500 KB by fetch cap) — D5 diff rendering
  sitemapUrlTotal   Int?     // null = no sitemap observed (absence ≠ 0)
  errorCount        Int
  warningCount      Int
  detailJson        String   // {v:1,…} RobotsCheckDetail
  createdAt         DateTime @default(now())

  @@index([clientId, domain, createdAt])
}
```

(`Client` gains the back-relation `robotsChecks RobotsCheck[]`.)

- Raw robots body IS stored (typically a few KB, hard-capped 500 KB by the
  fetch layer; ≤20 rows per domain by retention) — D5 renders "what changed"
  diffs from it. Sitemap XML is NOT stored (5 MB cap would bloat SQLite);
  sitemaps get hash + counts + issues only, so D5 sitemap alerts are
  hash/count/issue-diff based, not text-diff based. This is a deliberate
  D5-facing contract.
- Migration is hand-authored SQL (`migrate dev` is interactive-only here),
  applied with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy`.
  Additive table — no rebuild pattern needed.

### 3. API routes (cookie-gated; NO middleware change)

All under `/api/clients/[id]/…` (already behind the auth cookie), wrapped in
`withRoute`, JSON bodies via `parseJsonBody`.

- **`POST /api/clients/[id]/robots-checks`** body `{domain}` —
  strict `^[1-9][0-9]*$` id parse; client lookup (404 unknown); archived
  client → 409 `client_archived` (schedules-route precedent); domain
  re-validated server-side with `normalizeClientDomain` (400
  `invalid_domain`) and membership in the client's `domains` JSON (400
  `domain_not_listed`) — the schedules route's exact pattern. Then
  `runAndStoreRobotsCheck(clientId, domain, { source: 'manual' })`
  synchronously → 200 `{ summary, detail }`.
  Fetch failures are NOT HTTP errors — an unreachable domain is a
  successfully-recorded observation.
- **`GET /api/clients/[id]/robots-checks?domain=`** → 200
  `{ checks: RobotsCheckSummary[] }` (domain optional filter; validated the
  same way when present).
- **`GET /api/clients/[id]/robots-checks/[checkId]`** → 200
  `{ summary, detail }`; 404 when not found / not this client's / corrupt.

### 4. UI — `components/clients/RobotsCheckCard.tsx`

Client component on `/clients/[id]`, placed after `ScheduledScansCard`
(it is scan-adjacent). **Preload contract (Codex #8):** the server page
preloads `listRobotsChecks(clientId)` (summaries, all domains) AND the
latest check's `{ summary, detail }` for the client's FIRST registered
domain, passed as `initial`; switching domains or expanding a history row
fetches detail lazily via the GET detail route. The card renders the
latest-state block only when it has a detail in hand (summary-only rows
show the history line).

- **Domain selector** (client's registered domains; hidden when exactly one;
  empty-domains state: "Add a domain to this client to run checks").
- **Run Check** button → POST, spinner while running (checks take seconds;
  button disabled during flight), result replaces latest. **On POST failure
  or client-side timeout, the card refetches the history list** — the row
  may still have committed server-side (the check keeps running after a
  dropped connection; Codex #5).
- **Latest state block:** robots status badge (ok green / missing amber /
  unreachable red), error+warning counts, blocked AI bots (count, expandable
  names — `KNOWN_AI_BOTS` from the client-safe parse module), sitemap total
  URL count + per-sitemap rows (status, URL count, children diagnostics,
  truncation flags rendered honestly — "possibly incomplete" when
  `sitemapsSkipped`/`childrenSkipped`/`timeBudgetExhausted`).
- **History list:** date, source, changed/unchanged badge (`changed: null`
  renders as "—" — never a fake "unchanged"), error/warning counts;
  expanding a row fetches the detail route lazily.
- **Deep link** "Open in Robots Validator" →
  `/robots-validator?url=https://<domain>` (existing autorun param).
- Dark-mode variants on every element; no hydration-mismatch patterns
  (initial data is server-provided; no `Date`-dependent render branches).

Share views, sales views, and the public surface are untouched.

## Error handling

- Runner: every fetch outcome is data, never a throw (`SeoFetchResult` is
  already a discriminated union); parse functions are pure on strings.
  A thrown bug inside the runner rejects the service promise → `withRoute`
  500 envelope; no row is written (no partial snapshots).
- Service: single-flight cleanup chain crash-proofed (see above); JSON
  parse of `detailJson` always try-caught.
- Card: POST/GET failures render an inline error line (house card pattern),
  never a blank card.

## Testing

- **Runner** (`runner.test.ts`): injected-deps fixtures — robots ok with
  issues + blocked bots; 404 → `missing`; dns/timeout → `unreachable` with
  taxonomy; raw body returned beside detail; declared-sitemap cap +
  `sitemapsSkipped`; convention probe recognition (200-text/plain and
  malformed-XML probes do NOT win; ok-but-unrecognized recorded with parse
  issues when nothing qualifies); index expansion with children cap, the
  clamped `childrenFailed`-minus-skipped derivation, child observations +
  `childrenHash` determinism, `childrenExcluded` from the parent-host
  filter; time-budget exhaustion via fake `now`; hash stability (same text
  → same hash); `sitemapUrlTotal` null vs 0.
- **Service** (test DB, per-worker SQLite): create+read round-trip incl.
  `robotsContent` persisted; `changed` flag across robots-hash change /
  status change / sitemap-set change / childrenHash-only change (index
  byte-identical, child churn) / first row null / corrupt detail null;
  `source` validation + stored value; single-flight (two concurrent calls,
  one runner invocation, one row); retention keeps LIMIT+1 per (client,
  domain) with `(createdAt DESC, id DESC)` ordering and the oldest visible
  row's `changed` surviving a prune — cross-domain and cross-client
  isolation.
- **Routes:** id/domain validation matrix, archived 409, unknown 404,
  domain_not_listed 400, detail ownership 404.
- **Card** (`// @vitest-environment jsdom` + `afterEach(cleanup)`, no
  jest-dom): empty-domains state, run-check happy path (mocked fetch),
  changed badge rendering incl. `null` → "—", honest-truncation line.
- **Migration:** applied to the local dev DB before the test run
  (per-worker DBs self-provision from the schema).

## Open items for Kevin (non-blocking, defaults chosen)

- History depth 20 **per (client, domain)** (not global per client) — with
  D5 weekly checks that is ~5 months of history. Bump later = one constant.
- Card placement after ScheduledScansCard — trivially movable.

## Kevin-verify items (from Codex review)

- RunCloud/NGINX proxy request timeout must exceed the ~75 s worst case
  (budget 60 s + one in-flight 15 s fetch window) with margin — verify
  before deploy; if it doesn't, lower `ROBOTS_CHECK_TIME_BUDGET_MS`.
- Cross-host declared sitemaps among real clients: the child filter keys on
  the parent sitemap's host (spec default) — flag if any client needs
  different policy.
- D5 design note (not D4): decide whether issue-set changes caused by
  parser upgrades (hashes unchanged) should alert.
- D5 design note: diff rendering of stored `robotsContent` must escape it —
  never inject raw content as HTML.
