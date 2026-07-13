# D4 — Client-Attached Robots/Sitemap Checks + History — Design

**Date:** 2026-07-12 · **Status:** Draft (pending Codex review)
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
export const ROBOTS_CHECK_HISTORY_LIMIT = 20    // list cap AND retention keep-count

export type RobotsFetchStatus = 'ok' | 'missing' | 'unreachable'
// 'ok'          — 2xx, body parsed
// 'missing'     — HTTP 404/410 (a real, common state: "no robots.txt")
// 'unreachable' — everything else (other http-error, dns, timeout, unsafe-url, …)

export interface SitemapCheckEntry {
  url: string
  source: 'robots' | 'convention'   // declared in robots.txt vs /sitemap.xml fallback probe
  ok: boolean
  httpStatus: number | null
  failure: string | null            // SeoFetchFailure when !ok
  isIndex: boolean
  urlCount: number | null           // total page locs (one-level index expansion), null when !ok
  childrenTotal: number
  childrenFailed: number            // real fetch failures among expanded children
  childrenSkipped: number           // children beyond ROBOTS_CHECK_MAX_CHILDREN / time budget
  contentHash: string | null        // sha256 hex of the fetched XML text, null when !ok
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

`runRobotsCheck(domain: string, deps?: RunnerDeps): Promise<RobotsCheckDetail>`

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
  `/sitemap_index.xml`, `/wp-sitemap.xml` in order, first `ok` wins, recorded
  with `source: 'convention'` (failed probes are NOT recorded as entries; if
  none succeed, record the LAST probe's failure as a single entry so the
  check is honest about having looked).
- **Per-sitemap:** `fetchSitemapXml` → on ok: `parseSitemapXml` (validation
  issues, top-level counts) + `sha256(text)`; if `isSitemapIndex`, expand via
  `collectSitemapPageUrls` with a **budget-capped fetcher wrapper**: the
  injected `fetchXml` counts calls and returns `null` once
  `ROBOTS_CHECK_MAX_CHILDREN` is reached or the time budget is exhausted.
  Because every skipped child registers as a `null` (= failed) inside the
  frozen `collectSitemapPageUrls`, the runner derives
  `childrenSkipped = wrapper.skippedCount` and
  `childrenFailed = result.childrenFailed - childrenSkipped` — reuses the
  frozen D3 function unchanged while keeping the honest-flags contract
  (no silent caps).
- **Time budget:** `ROBOTS_CHECK_TIME_BUDGET_MS = 60_000` from `deps.now()`
  at start. Checked before each sitemap fetch and inside the child-fetcher
  wrapper; on exhaustion remaining work is skipped and
  `timeBudgetExhausted: true`. Individual fetches keep `lib/seo-fetch`'s
  own 15 s timeout.
- `totals.sitemapUrlTotal` = sum of `urlCount` over ok entries; `null` when
  no sitemap was successfully fetched (absence ≠ zero — house rule).
- Fully deterministic given deps; no `Date.now`/`Math.random` outside
  `deps.now`.

**`service.ts` (server-only):**

- `runAndStoreRobotsCheck(clientId, domain)` — synchronous **single-flight**
  per `clientId:domain` key (Map of in-flight promises, following
  `gsc-snapshot.ts`, including the lesson that every derived `.finally()`
  cleanup chain carries its own no-op `.catch` — an unhandled rejection
  there crashes the process). Runs the runner, then a single `create` with
  scalars + `detailJson` (`{v:1,…}`). Returns `{ summary, detail }`.
  Concurrent second caller awaits the same promise and gets the same row.
- `listRobotsChecks(clientId, domain?)` — newest-first, cap
  `ROBOTS_CHECK_HISTORY_LIMIT`, mapped to `RobotsCheckSummary`. `changed` is
  computed at read time against the chronologically-previous row for the
  same `(clientId, domain)`: robots hash differs OR robotsStatus differs OR
  the ordered list of sitemap `(url, contentHash)` pairs differs (read from
  `detailJson`; corrupt/unparseable detail → `changed: null`, never a throw).
  Read-time computation means D5 can later refine "changed" semantics without
  a backfill.
- `getRobotsCheckDetail(clientId, checkId)` — the full stored detail;
  ownership enforced (`checkId` AND `clientId` must match); corrupt JSON →
  `null` (route 404s), never a throw.
- `retention.ts` — `pruneRobotsChecks()`: keep newest
  `ROBOTS_CHECK_HISTORY_LIMIT` rows per `(clientId, domain)`, tagged
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
  `runAndStoreRobotsCheck` synchronously → 200 `{ summary, detail }`.
  Fetch failures are NOT HTTP errors — an unreachable domain is a
  successfully-recorded observation.
- **`GET /api/clients/[id]/robots-checks?domain=`** → 200
  `{ checks: RobotsCheckSummary[] }` (domain optional filter; validated the
  same way when present).
- **`GET /api/clients/[id]/robots-checks/[checkId]`** → 200
  `{ summary, detail }`; 404 when not found / not this client's / corrupt.

### 4. UI — `components/clients/RobotsCheckCard.tsx`

Client component on `/clients/[id]`, placed after `ScheduledScansCard`
(it is scan-adjacent). The server page preloads
`listRobotsChecks(clientId)` and passes it as `initial` (GscKeywordCard
pattern).

- **Domain selector** (client's registered domains; hidden when exactly one;
  empty-domains state: "Add a domain to this client to run checks").
- **Run Check** button → POST, spinner while running (checks take seconds;
  button disabled during flight), result replaces latest.
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
  taxonomy; declared-sitemap cap + `sitemapsSkipped`; convention fallback
  order and single-failure entry; index expansion with children cap and the
  `childrenFailed`-minus-skipped derivation; time-budget exhaustion via fake
  `now`; hash stability (same text → same hash); `sitemapUrlTotal` null vs 0.
- **Service** (test DB, per-worker SQLite): create+read round-trip;
  `changed` flag across hash change / status change / sitemap-set change /
  first row null / corrupt detail null; single-flight (two concurrent calls,
  one runner invocation, one row); retention keep-latest-20 per (client,
  domain) — cross-domain and cross-client isolation.
- **Routes:** id/domain validation matrix, archived 409, unknown 404,
  domain_not_listed 400, detail ownership 404.
- **Card** (`// @vitest-environment jsdom` + `afterEach(cleanup)`, no
  jest-dom): empty-domains state, run-check happy path (mocked fetch),
  changed badge rendering incl. `null` → "—", honest-truncation line.
- **Migration:** applied to the local dev DB before the test run
  (per-worker DBs self-provision from the schema).

## Open items for Kevin (non-blocking, defaults chosen)

- History depth 20 per (client, domain) — with D5 weekly checks that is
  ~5 months of history. Bump later = one constant.
- Card placement after ScheduledScansCard — trivially movable.
