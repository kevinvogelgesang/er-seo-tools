# KS-2 — DataForSEO volume provider + durable cache (design)

**Status:** spec — second increment of the C20 Keyword Strategy capability
(umbrella: `2026-07-10-keyword-strategy-capability-design.md`, gap G2).
**Written:** 2026-07-10, after KS-1 shipped (PR #146); main @ `84c9e9e`.
**Codex review:** ACCEPT-WITH-NAMED-FIXES ×5 (2026-07-10), all applied in
place — tagged "(Codex #N)".
**Scope lock (umbrella Codex #1):** provider + durable volume cache ONLY.
The token-authed billable volume-lookup endpoint is KS-5's (it must bind to
the client-scoped strategy session for budget accounting). **KS-2 ships no
user-facing consumer and no new routes** — it is dark infrastructure with
its own tests; KS-5 consumes it (seam breadcrumbed in §10).
**Standing gates honored:** NO AI API (DataForSEO is a data API — access
confirmed by Kevin 2026-07-10). Zero site fetches. Dark by default.

## 1. Goal

A tested, environment-dark keyword search-volume capability:
`getKeywordVolumes(keywords, locale)` — cache-first against a durable
`KeywordVolumeCache` table (30-d TTL), batch-fetching only misses from
DataForSEO's Google Ads search-volume endpoint, with bounded spend per
invocation, credential-safe logging, and a fixed allowlisted API host.

## 2. Verified provider facts (researched 2026-07-10 — docs.dataforseo.com + dataforseo.com/pricing)

- **Endpoint (chosen):** `POST https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live`
  — HTTP **Basic auth** (`login:password`), JSON body = array of one task
  object: `{ keywords: string[], location_code?: number, language_code?: string, … }`.
- **Batching & billing:** up to **1 000 keywords per request**, billed **per
  request regardless of keyword count** — live mode **$0.09/request**
  (avg ≤7 s); task-based standard queue $0.06 with 1–3 h turnaround (not
  suitable for memo-time enrichment — live mode chosen). DataForSEO moved
  fully pay-as-you-go with a ~20 % price adjustment on 2026-07-01 — prices
  above are post-update page values; treat as current, re-verify at KS-5.
- **Rate limit:** ≤ **12 requests/minute** per account.
- **Keyword constraints:** ≤ 80 characters, ≤ 10 words per phrase.
- **Locale model:** integer `location_code` (e.g. **2840 = United States**;
  state-level codes exist with `location_code_parent: 2840`; full list via
  `GET /v3/keywords_data/google_ads/locations`, free metadata) +
  `language_code` (e.g. `"en"`).
- **Response:** `status_code: 20000` on success (top-level AND per-task);
  per-keyword items: `search_volume` (monthly avg, may be null),
  `competition` (LOW/MEDIUM/HIGH), `competition_index` (0–100), `cpc`,
  `low/high_top_of_page_bid`, `monthly_searches[]` ({year,month,
  search_volume}), `spell`. Response carries the billed `cost`.
- **Labs alternative (rejected for KS-2):** DataForSEO Labs endpoints
  ($0.012/task + $0.00012/item) add difficulty/intent but use a modeled
  volume source; §5 of the memo needs plain Google-sourced volumes, and
  per-request billing favors 1000-keyword batches. Labs stays the KS-6
  candidate (ranked-keywords / domain-intersection for SEMRush retirement).

## 3. Background — verified code facts this builds on

- `lib/keywords/` exists (KS-1): `types.ts` client-safe constants/types,
  `gsc-snapshot.ts` service, `retention.ts` pruner wired into `runCleanup()`
  (`lib/cleanup.ts:22` `Promise.allSettled` list).
- **Dark-env precedent:** `lib/notify/config.ts` — single env home;
  `isNotifyEnabled()` = both env vars present; missing env → feature no-ops,
  NEVER a boot failure (not in `instrumentation.ts` fail-fast).
- **Transport precedent:** `lib/notify/transport.ts` — plain `fetch`, Basic
  auth header, form/JSON body, injectable deps object for tests,
  AbortController timeout, never logs the credential.
- **Migration procedure:** hand-authored SQL (KS-1's
  `20260710150000_gsc_snapshot` is the freshest template).
- KS-1's `GscSnapshotSummary` carries the query lists KS-5 will enrich.

## 4. Scope decisions (proposed; consistent with umbrella §4 KS-2 + Codex #1/#3)

- **D1 — Endpoint:** Google Ads `search_volume/live` (facts + rejection of
  Labs in §2). Provider version constant `PROVIDER_VERSION = 'google_ads_v3'`
  baked into cache keys — bumping it invalidates the cache wholesale.
- **D2 — Dark gate:** `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` env vars,
  read in `lib/keywords/volume-config.ts` (notify-config pattern).
  `isVolumeEnabled()` = both present. Disabled → `getKeywordVolumes` returns
  `{ ok: false, reason: 'disabled' }` without touching the network or DB.
  OPTIONAL vars — no server `.env` prerequisite to deploy; enabling later is
  a Kevin `.env` edit + restart.
- **D3 — Cache:** new `KeywordVolumeCache` model,
  `@@unique([keyword, locationCode, languageCode, providerVersion])`.
  `keyword` stored **normalized** (trim, lowercase, collapse internal
  whitespace — matches how GSC reports queries, which are lowercase).
  **TTL 30 d read-time rule** (`fetchedAt >= now − 30d` counts as a hit);
  rows older than 30 d are pruned by `pruneKeywordVolumeCache()` in
  `runCleanup` (stale rows have no readers — delete, don't keep).
  **Negative caching:** a keyword the API returns with `search_volume: null`
  is cached as a row with null volume — a re-lookup within TTL must NOT
  re-bill for known-unknown keywords.
- **D4 — Locale is an explicit argument** (`{ locationCode: number,
  languageCode: string }`) — KS-3's client profile will supply it later; no
  default locale constant is exported as "the" locale (callers must choose;
  tests use 2840/"en").
- **D5 — Spend bound per invocation (KS-2's own guard, distinct from KS-5's
  ledger):** keywords are deduped post-normalization, then chunked at 1 000;
  an invocation is capped at `VOLUME_MAX_CHUNKS_PER_CALL = 3` chunks
  (≤ 3 000 keywords ≈ $0.27); overflow keywords are returned in a
  `skipped` list, never silently dropped. Chunks go through a
  **module-scoped process-wide throttle (Codex #2)** — a rolling
  ≤ 12-requests-per-60 s window shared by ALL callers (per-invocation
  spacing alone would not protect concurrent KS-5 callers), clock/sleep
  injectable for deterministic tests; single-PM2-process app so in-process
  is sufficient.
- **D6 — Invalid keywords** (empty after normalization, > 80 chars,
  > 10 words) are filtered pre-request into the same `skipped` list with a
  per-keyword reason — the provider must never 40xxx a whole batch over one
  bad keyword.

## 5. Architecture

### 5.1 Config — `lib/keywords/volume-config.ts`

`isVolumeEnabled()`, `dataForSeoAuthHeader()` (Basic, built per call, never
cached in a loggable object), `DATAFORSEO_API_BASE = 'https://api.dataforseo.com'`
(fixed constant — the ONLY host this feature ever contacts; keywords travel
in the body; no user-supplied URLs anywhere; SSRF posture is
allowlist-by-construction), `VOLUME_REQUEST_TIMEOUT_MS = 30_000`.

### 5.2 Transport — `lib/keywords/dataforseo-client.ts`

`fetchSearchVolume(keywords, locale, deps?)` → one live request for ≤ 1 000
keywords. Injectable `deps` ({ fetch }) for tests (notify-transport
pattern). AbortController timeout. Response handling:
- HTTP 401 → `{ ok:false, reason:'auth' }` (bad credentials — message never
  echoes the login).
- top-level or task `status_code !== 20000` → mapped:
  40200-class payment/credit errors → `'payment'`; 40202/429-class
  rate-limit → `'rate_limited'`; everything else →
  `'error'`. **Provider messages are sanitized (Codex #4):** the DataForSEO
  `status_message` is length-capped (≤ 200 chars) and attached only after
  the internal reason is assigned — non-JSON bodies, malformed task arrays,
  and HTTP-level failures all map to stable internal reasons with a bounded
  message, never a raw body dump. The exact per-code taxonomy is pinned by
  transport tests at build time (Kevin-verify note §11).
- ok → **per-REQUEST-key outcomes (Codex #1):** DataForSEO can omit
  requested keywords entirely or group similar terms — a `spell`/similar
  result is NEVER remapped onto the requested keyword. Each requested
  (normalized) keyword resolves to exactly one outcome:
  `returned` (an item matched the requested keyword; carries
  `{ searchVolume: number|null, cpc, competitionIndex, monthlySearches }`
  — null volume is the provider's explicit "no data") or
  `not_returned` (the keyword was absent from the response items). `spell`
  is carried as display-only metadata on `returned` rows. Both outcomes are
  distinguishable downstream — a null volume is never ambiguous with an
  omitted keyword.

### 5.3 Service — `lib/keywords/volume.ts`

```ts
type VolumeAccounting = { fromCache: number; fetched: number; skipped: SkippedKeyword[];
                          attemptedChunks: number; successfulChunks: number;
                          providerCost: number | null };  // sum of provider-reported task costs; null = a successful chunk lacked one (unknown ≠ 0) (Codex plan #3)
getKeywordVolumes(keywords: string[], locale: { locationCode: number; languageCode: string }):
  Promise<
    | ({ ok: true; volumes: KeywordVolume[] } & VolumeAccounting)   // volumes carry outcome 'returned'|'not_returned' (Codex #1)
    | ({ ok: false; reason: 'disabled' | 'auth' | 'payment' | 'rate_limited' | 'error'; message?: string } & VolumeAccounting)>  // accounting on error too (Codex #3)
```

Flow: disabled-gate → **locale validation (Codex #4):** `locationCode` must
be a positive integer and `languageCode` a non-empty 2–8-char code before
any cache/network access (invalid → `reason:'error'`, message
`invalid_locale`) → normalize + dedupe + validate keywords (invalid →
`skipped`) → cache read (TTL rule, exact unique-key match; BOTH `returned`
and `not_returned` rows are hits — negative caching, Codex #1) → misses
chunked (≤ 1 000, ≤ 3 chunks, overflow → `skipped` with reason
`'over_cap'`) → fetches through the **module-scoped process-wide throttle
(Codex #2):** one shared scheduler for ALL `getKeywordVolumes` callers
(rolling ≤ 12-requests-per-60 s window; injectable clock/sleep for
deterministic tests) — per-invocation serial spacing alone would not
protect concurrent KS-5 callers → upsert rows (per-key `upsert` loop —
SQLite house rule: no `createMany skipDuplicates`; each upsert refreshes
`fetchedAt`; `not_returned` outcomes persist as negative rows) → merge
cache hits + fetched. **Partial-failure rule:** if chunk N fails after
chunks 1..N-1 succeeded, the succeeded chunks' rows are already persisted
(cache is a cache — partial persistence is safe and saves money on retry),
but the CALL returns the error reason **carrying full accounting
(Codex #3): `{ fromCache, fetched, skipped, attemptedChunks,
successfulChunks }` ride the error result** so KS-5's ledger can bill the
requests that actually happened; the caller retries idempotently (persisted
rows become cache hits).

### 5.4 Cache retention — `lib/keywords/retention.ts` (extend)

`pruneKeywordVolumeCache()` — `deleteMany({ fetchedAt: { lt: now − 30d } })`
(plain Prisma, no raw SQL needed — no per-group keep rule here), added to
`runCleanup()`'s list beside `pruneGscSnapshots()`.

## 6. Schema change (hand-authored migration, additive)

```prisma
model KeywordVolumeCache {
  id              Int      @id @default(autoincrement())
  keyword         String   // normalized: trim, lowercase, collapsed whitespace
  locationCode    Int
  languageCode    String
  providerVersion String   // 'google_ads_v3' — bump invalidates
  resultStatus    String   // 'returned' | 'not_returned' — omitted-from-response ≠ null volume (Codex #1)
  searchVolume    Int?     // null = provider explicitly returned no volume (only meaningful when resultStatus='returned')
  cpc             Float?
  competitionIndex Int?
  monthlySearchesJson String? // JSON: {year,month,searchVolume}[] — CAPPED at the 12 most recent months (Codex #5)
  spell           String?  // provider spell-correction, display-only, never remapped (Codex #1)
  fetchedAt       DateTime @default(now())

  @@unique([keyword, locationCode, languageCode, providerVersion])
  @@index([fetchedAt])
}
```

No FKs — the cache is client-agnostic shared infrastructure (two clients in
the same market share hits; that is the point of the cache).

## 7. Error handling & invariants

- Missing env is a **feature state, not an error**: no boot-time check, no
  log spam — `reason:'disabled'` only when someone calls the service.
- Credentials NEVER appear in logs, error messages, or thrown errors; the
  auth header is constructed inside the transport call.
- The API host is a fixed constant; no function accepts a URL parameter.
- One invalid keyword never fails a batch (D6); one failed chunk never
  destroys prior chunks' cached rows (§5.3 partial rule).
- Cache upserts are per-key `upsert` (unique-constraint-safe under the
  single-flight-free concurrent case — last writer wins, both writers wrote
  the same provider data).
- All monetary/count metadata (`fromCache`, `fetched`, `attemptedChunks`,
  `successfulChunks`, `skipped`, `providerCost`) is returned on BOTH ok and
  error results (Codex #3, plan #3) so KS-5's ledger can account spend
  precisely — preferring the provider-reported `cost` over any hardcoded
  price, with successful-chunk count as the fallback basis.
- A `spell`/similar-grouped response item is never remapped onto the
  requested keyword; omitted keywords persist as `not_returned` rows —
  null volume is never ambiguous (Codex #1).
- Locale is validated before any cache or network access (Codex #4).
- Persisted monthly history is capped at 12 months per row (Codex #5) —
  unbounded per-key JSON across a shared 30-d cache is material SQLite
  growth on this VPS.

## 8. Retention

30-d TTL enforced at read time; same-window prune in `runCleanup` (§5.4).
No per-client grouping, no keep-latest rule — stale rows are worthless.

## 9. Testing

- `volume-config.test.ts` — enabled/disabled matrix; auth header shape
  (base64 of login:password) without logging.
- `dataforseo-client.test.ts` (mocked fetch, notify-transport conventions) —
  request shape (URL constant, Basic header, task body with keywords/
  location_code/language_code); 20000 happy path incl. null-volume
  `returned` rows; **omitted keyword → `not_returned`** and **spell-corrected
  item NOT remapped to the requested keyword** (Codex #1); monthly history
  capped at 12 entries (Codex #5); 401 → auth; payment status → payment;
  rate-limit status → rate_limited; non-20000 task-level error; non-JSON
  body → error with bounded message (Codex #4); timeout (AbortController) →
  error; credentials absent from every thrown/returned message (assert on
  serialized result).
- `volume.test.ts` (DB-backed, PREFIX-scoped rows) — disabled gate (no DB/
  network); normalization + dedupe ("Nursing  Program" ≡ "nursing program",
  one cache row); cache hit within TTL (zero fetches), stale row (31 d) →
  refetch + `fetchedAt` refreshed; negative-cache hit (null volume, no
  refetch); invalid keywords → `skipped` with reasons, request proceeds for
  the rest; chunking at 1 000 + cap at 3 chunks with `over_cap` skipped
  list; **process-wide throttle** (injected clock: two CONCURRENT
  invocations share the rolling 12/60 s window — 13th request in a window
  waits; Codex #2); partial-failure (chunk 2 fails → chunk 1 rows
  persisted, call returns error **with accounting
  `{attemptedChunks:2, successfulChunks:1, fetched, fromCache}`** (Codex
  #3), immediate retry serves chunk 1 from cache and refetches only
  chunk 2); invalid locale (0, -1, NaN locationCode; empty languageCode) →
  `invalid_locale` before any DB/network (Codex #4); `not_returned`
  negative-cache hit does not refetch (Codex #1); locale keys distinct
  (same keyword, 2840/"en" vs 2124/"en" → two rows).
- `retention.test.ts` (extend) — 31-d-old rows pruned, fresh kept.

## 10. Out of scope (breadcrumbed)

- **KS-5:** the token-authed volume-lookup route (dedicated scope, anchored
  middleware regex + test, persisted per-session usage ledger — conditional
  array-form update) and the krt_-v2 export pre-enrichment consuming
  `getKeywordVolumes` with the client profile's locale (KS-3). Until then
  NOTHING calls this service in production — it ships dark with tests as
  its only exerciser. `// KS-5 consumes this — see spec §10` comment on the
  service export.
- Spend envelope (umbrella §5 Q1) — KS-5 ledger caps; KS-2's only guard is
  the per-invocation chunk cap (D5).
- Labs endpoints (difficulty/intent/ranked-keywords) — KS-6.
- Locations/languages metadata endpoint sync — KS-3 decides how the profile
  UI picks codes (static curated list vs live fetch).

## 11. Kevin-verify notes (from Codex review)

- Re-confirm the $0.09/request live price immediately before KS-5 turns on
  real consumption — it is metadata here, never a code-level invariant.
- The exact `spell`/omitted-item/task-error-code semantics get pinned by
  the transport tests against recorded fixture responses at build time; if
  a live smoke against the real API (one $0.09 request) is wanted before
  KS-5, that is a Kevin call.
- Monthly history: capped at 12 months in KS-2 (seasonality display for the
  memo); if the export never uses it, drop the column at KS-5 cleanup.

## 12. Acceptance criteria

1. With env unset: service returns `disabled`, zero network/DB activity,
   boot unaffected (gates + dev boot prove it).
2. With mocked provider: cache-first behavior — second identical call makes
   zero fetches; stale + negative-cache semantics per D3.
3. Invalid keywords and over-cap overflow surface in `skipped`, never
   silently dropped, never fail the batch.
4. Credential never appears in any log/error/result (asserted in tests).
5. Migration additive; gates green; no new routes, no middleware change, no
   UI change.
