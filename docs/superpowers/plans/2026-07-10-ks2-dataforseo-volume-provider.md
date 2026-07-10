# KS-2 — DataForSEO volume provider + durable cache (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `../specs/2026-07-10-ks2-dataforseo-volume-provider-design.md` (Codex
ACCEPT-WITH-NAMED-FIXES ×5, applied — tags cited below). Umbrella:
`../specs/2026-07-10-keyword-strategy-capability-design.md` (C20/KS-2).
**Plan Codex review:** ACCEPT-WITH-NAMED-FIXES ×6 (2026-07-10), applied —
tagged "(Codex plan #N)".

**Goal:** environment-dark keyword volume infrastructure — `getKeywordVolumes(
keywords, locale)` cache-first against a durable `KeywordVolumeCache` (30-d TTL,
negative caching with `returned`/`not_returned` provenance), batch-fetching
misses from DataForSEO's Google Ads `search_volume/live` endpoint through a
process-wide rolling throttle, with full spend accounting on ok AND error
results. **NO routes, NO UI, NO consumer wired** — KS-5 consumes it.

**Architecture:** `lib/keywords/volume-config.ts` (env gate + fixed API host),
`dataforseo-client.ts` (transport, injectable deps, per-request-key outcomes),
`volume-throttle.ts` (module-scoped rolling 12/60s scheduler, injectable
clock), `volume.ts` (service: validate → dedupe → cache-read → chunk ≤1000 cap
3 → throttled serial fetch → per-key upsert → merge), retention extension.
New Prisma model + hand-authored migration.

**Tech stack:** existing — plain `fetch` (notify-transport pattern), Prisma+
SQLite, vitest (fake timers for throttle tests).

## Resolved decisions (from the spec — restated)

- **D1** Endpoint = `POST https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live`
  (Basic auth; ≤1000 keywords/request billed per-request $0.09 live; 12 req/min;
  keyword ≤80 chars ≤10 words; `location_code` int + `language_code`; success
  `status_code` 20000 top-level AND per-task). `PROVIDER_VERSION='google_ads_v3'`.
- **D2** Dark gate `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` (both → enabled);
  missing → `reason:'disabled'`, zero network/DB; NEVER a boot check.
- **D3** Cache unique `[keyword, locationCode, languageCode, providerVersion]`;
  keyword normalized (trim/lowercase/collapse-ws); 30-d read-time TTL + prune;
  negative caching via `resultStatus 'returned'|'not_returned'` (Codex #1).
- **D4** Locale = explicit `{ locationCode: positive int, languageCode:
  non-empty 2–8 chars }`, validated BEFORE cache/network (Codex #4). No
  exported default locale.
- **D5** Per-invocation: dedupe → chunk ≤1000 → cap `VOLUME_MAX_CHUNKS_PER_CALL=3`
  (overflow → `skipped` `'over_cap'`); fetches via the process-wide throttle
  (Codex #2).
- **D6** Invalid keywords (empty post-normalize, >80 chars, >10 words) →
  `skipped` with per-keyword reason; never fail the batch.

## Global constraints (house rules — verbatim)

- SQLite: per-key `upsert` loop, NO `createMany`+`skipDuplicates`; array-form
  `$transaction([...])` only (none needed here); migrations hand-authored,
  applied `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy &&
  … generate`.
- Credentials NEVER in logs/errors/results — assert in tests.
- Fixed API host constant; no function accepts a URL.
- Tests: `DATABASE_URL="file:./local-dev.db"`; vitest globals:false; fake
  timers use `act()`-free pure async (no components in KS-2).
- Never `git add -A`. Gates: `npm run lint` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`.

## File structure

```
prisma/schema.prisma                            (modify: +KeywordVolumeCache)
prisma/migrations/20260710200000_keyword_volume_cache/migration.sql  (create)
lib/keywords/volume-config.ts + .test.ts        (create: env gate, host, timeout const)
lib/keywords/volume-normalize.ts + .test.ts     (create: SHARED normalizeKeyword/normalizeLocale — Codex plan #1)
lib/keywords/volume-throttle.ts + .test.ts      (create: rolling 12/60s scheduler)
lib/keywords/dataforseo-client.ts + .test.ts    (create: transport)
lib/keywords/volume.ts + .test.ts               (create: service)
lib/keywords/retention.ts + retention.test.ts   (modify: +pruneKeywordVolumeCache)
lib/cleanup.ts                                  (modify: wire pruner)
```

---

## Task 1: Schema — `KeywordVolumeCache` + migration

**Files:** `prisma/schema.prisma`,
`prisma/migrations/20260710200000_keyword_volume_cache/migration.sql`

- [ ] **Step 1:** Add the model exactly per spec §6 (incl. `resultStatus
  String` (Codex #1), `monthlySearchesJson` comment "capped 12 months"
  (Codex #5), `@@unique([keyword, locationCode, languageCode,
  providerVersion])`, `@@index([fetchedAt])`, NO FKs — client-agnostic).
- [ ] **Step 2:** Hand-author migration SQL (template:
  `prisma/migrations/20260710150000_gsc_snapshot/migration.sql` — quoted
  identifiers; unique via `CREATE UNIQUE INDEX`).
- [ ] **Step 3:** `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`; drift-check
  `npx prisma migrate diff --from-url file:prisma/local-dev.db --to-schema-datamodel prisma/schema.prisma --script` → empty.
- [ ] **Step 4:** `npm run lint` green.
- [ ] **Commit:** `git add prisma/schema.prisma prisma/migrations/20260710200000_keyword_volume_cache && git commit -m "feat(schema): KeywordVolumeCache model (KS-2)"`

## Task 2: Config — `volume-config.ts`

**Files:** `lib/keywords/volume-config.ts(+test)`
**Interface:** `isVolumeEnabled(): boolean` (both env vars non-empty);
`dataForSeoAuthHeader(): string` (`'Basic ' + base64(login:password)`,
throws if disabled — callers gate first); constants
`DATAFORSEO_API_BASE = 'https://api.dataforseo.com'`,
`VOLUME_REQUEST_TIMEOUT_MS = 30_000`, `PROVIDER_VERSION = 'google_ads_v3'`,
`VOLUME_MAX_CHUNKS_PER_CALL = 3`, `VOLUME_CHUNK_SIZE = 1000`,
`VOLUME_CACHE_TTL_DAYS = 30`, `KEYWORD_MAX_CHARS = 80`, `KEYWORD_MAX_WORDS = 10`.

**Also in this task (Codex plan #1): `lib/keywords/volume-normalize.ts`** —
the ONE shared canonicalizer imported by BOTH transport (response matching)
and service (cache keys): `normalizeKeyword(s)` = trim, lowercase, collapse
internal whitespace; `normalizeLocale({locationCode, languageCode})` =
validate (positive integer code; languageCode `trim().toLowerCase()`,
2–8 chars `/^[a-z]{2}(-[a-z]{2,4})?$/`-ish) → canonical locale or null.
Language code is canonicalized BEFORE request/cache-key construction —
`EN` ≡ `en` (one cache row).

- [ ] **Step 1: Failing tests** (env stubbed via `vi.stubEnv`, restored
  afterEach): enabled matrix (both/one/neither set — note empty-string env
  counts as unset); auth header = correct base64; header function throws
  when disabled; normalize: keyword trim/case/whitespace cases;
  `EN`/`en` → same canonical locale (Codex plan #1); invalid locale
  variants → null.
- [ ] **Step 2:** Fail. **Step 3:** Implement (read env at CALL time, not
  module load — PM2 restart semantics + testability). **Step 4:** Green.
- [ ] **Commit:** `git add lib/keywords/volume-config.ts lib/keywords/volume-config.test.ts lib/keywords/volume-normalize.ts lib/keywords/volume-normalize.test.ts && git commit -m "feat(keywords): DataForSEO volume env gate + shared normalizer (KS-2)"`

## Task 3: Throttle — `volume-throttle.ts`

**Files:** `lib/keywords/volume-throttle.ts(+test)`
**Interface:**

```ts
export function createThrottle(opts: { maxRequests: number; windowMs: number;
  now?: () => number; sleep?: (ms: number) => Promise<void> }): { acquire(): Promise<void> }
export const volumeThrottle: { acquire(): Promise<void> }  // module singleton, 12/60_000
```

Rolling window: keep timestamps of the last `maxRequests` acquisitions; if
full, sleep until the oldest falls out of the window, **re-check the clock
after waking** (sleep may under-deliver), and **record the timestamp at
permit-grant time** (Codex plan #5). Serialize concurrent acquires via a
promise chain whose **tail recovers from a rejected acquire/sleep** — one
rejected sleeper must never poison later process-wide acquires
(Codex plan #5, Codex #2).

- [ ] **Step 1: Failing tests** (injected `now`/`sleep` — a controllable
  fake clock with manual advancement, NO vi.useFakeTimers): 12 acquires
  pass without sleeping; 13th sleeps until the window frees; rolling (not
  fixed) window semantics; re-check-after-wake (sleep advances clock less
  than requested → second sleep, no early grant); two CONCURRENT acquire
  streams share one window (interleave and count total sleeps); **tail
  recovery — a rejected sleep fails ITS acquire but the next acquire
  succeeds** (Codex plan #5); singleton exported.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Commit:** `git add lib/keywords/volume-throttle.ts lib/keywords/volume-throttle.test.ts && git commit -m "feat(keywords): process-wide rolling request throttle (KS-2)"`

## Task 4: Transport — `dataforseo-client.ts`

**Files:** `lib/keywords/dataforseo-client.ts(+test)`
**Interface:**

```ts
export type VolumeOutcome =
  | { keyword: string; outcome: 'returned'; searchVolume: number | null; cpc: number | null;
      competitionIndex: number | null; monthlySearches: { year: number; month: number; searchVolume: number | null }[] | null;
      spell: string | null }
  | { keyword: string; outcome: 'not_returned' };
export type FetchVolumesResult =
  | { ok: true; outcomes: VolumeOutcome[]; cost: number | null }   // provider-reported task cost, verbatim (Codex plan #3)
  | { ok: false; reason: 'auth' | 'payment' | 'rate_limited' | 'error'; message?: string };
export async function fetchSearchVolume(keywords: string[], locale: { locationCode: number; languageCode: string },
  deps?: { fetch?: typeof fetch }): Promise<FetchVolumesResult>
```

Body: `[{ keywords, location_code, language_code }]` (array of ONE task).
Match response items to requested keywords by normalized equality of the
item's `keyword` field; **an item whose keyword ≠ any requested keyword
(spell/similar grouping) does NOT satisfy the requested keyword** — the
requested one becomes `not_returned`; `spell` on a matched item is carried
verbatim, display-only (Codex #1). Both sides of the match go through the
SHARED `normalizeKeyword` (Codex plan #1). **Response-validity rules
(Codex plan #4):** a well-formed task with an EMPTY `result` array is a
VALID response — every requested keyword becomes `not_returned`; a missing/
null/malformed `result` or malformed items → `error` `unparseable_response`
(a transport error — the service writes NO rows, nothing is
negative-cached off garbage); duplicate returned items normalizing to the
same keyword → first item wins, deterministically. `monthlySearches` sorted
by `(year, month)` ascending BEFORE slicing the newest 12 (Codex #5 /
plan #4). The task-level `cost` field is carried verbatim on ok results
(null when absent; Codex plan #3). Status mapping (Codex #4): HTTP 401 →
`auth`; top-level or task `status_code` 40200-class → `payment`,
40202/rate-class → `rate_limited`, other non-20000 → `error` with
`status_message` capped at 200 chars. AbortController timeout
`VOLUME_REQUEST_TIMEOUT_MS` → `error` `timeout`. Credentials built inside
the call, never attached to errors.

- [ ] **Step 1: Failing tests** (deps.fetch mocked; fixture JSON modeled on
  the documented response shape): request assertions (URL = constant base +
  path, method POST, Basic header present, body task fields); happy path
  with a null-volume `returned` item; **omitted keyword → `not_returned`**;
  **spell-grouped item (response keyword differs) → requested keyword
  `not_returned`, item not remapped** (Codex #1); >12 monthlySearches →
  sliced to 12 most recent **after (year,month) sort of shuffled input**
  (Codex #5 / plan #4); valid EMPTY result array → all requested keywords
  `not_returned`, ok:true (Codex plan #4); missing/null result →
  `unparseable_response` (Codex plan #4); duplicate returned items for one
  normalized keyword → first wins deterministically (Codex plan #4); ok
  result carries the task `cost` verbatim, null when absent (Codex plan
  #3); 401 → auth; task status 40200 → payment; 40202 → rate_limited;
  other → error w/ message ≤200 chars; non-JSON body →
  `unparseable_response` (Codex #4); **timeout via an abort-aware fetch
  mock (rejects with AbortError when the signal fires; injectable/short
  timeout — NEVER a real 30 s wait; Codex plan #6)** → error `timeout`; NO
  credential substring in any serialized error result.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Commit:** `git add lib/keywords/dataforseo-client.ts lib/keywords/dataforseo-client.test.ts && git commit -m "feat(keywords): DataForSEO search-volume transport (KS-2)"`

## Task 5: Service — `volume.ts`

**Files:** `lib/keywords/volume.ts(+test)`
**Interface:** per spec §5.3 —
`getKeywordVolumes(keywords, locale)` returning ok/error unions BOTH
carrying `VolumeAccounting { fromCache, fetched, skipped, attemptedChunks,
successfulChunks, providerCost }` (Codex #3 / plan #3) — `providerCost` =
sum of provider-reported task costs from successful chunks (`null` when any
successful chunk lacked a cost field: unknown ≠ 0); `attemptedChunks` is
incremented IMMEDIATELY BEFORE each transport invocation, so a
timeout/network failure counts as attempted-but-uncertain (Codex plan #3).
`KeywordVolume` = normalized keyword + outcome fields + `fromCache:
boolean`; **output preserves first-seen input order** (reproducible exports
— Codex plan review note). `SkippedKeyword = { keyword, reason: 'empty' |
'too_long' | 'too_many_words' | 'over_cap' }`.
`// KS-5 consumes this — see spec §10` comment on the export.

Flow (spec §5.3, order is contractual): disabled gate → locale validation
via the shared `normalizeLocale` (`invalid_locale` error before ANY
cache/DB/network; Codex #4 / plan #1) → normalize + dedupe (preserve
first-seen order) → keyword validation → `skipped` → cache read **in
bounded `keyword IN (...)` batches of ≤500 with fixed locale/provider
predicates, merged into a Map** — a single findMany over up to 3 000
keywords risks SQLite bind-variable limits (Codex plan #2) → TTL rule
`fetchedAt >= now-30d`, both result statuses are hits → miss chunking
(≤1000, ≤3 chunks, overflow → `over_cap`) → per chunk: increment
`attemptedChunks` → `volumeThrottle.acquire()` → `fetchSearchVolume` →
per-key `upsert` (unique tuple; update refreshes all fields + `fetchedAt`;
`unparseable_response` writes NOTHING — never negative-cache off garbage,
Codex plan #4) → accumulate `providerCost` → merge in first-seen input
order. Partial failure: return the transport error reason + accounting
reflecting attempted/successful chunks + persisted rows (Codex #3/plan #3).

- [ ] **Step 1: Failing DB-backed tests** (transport + throttle mocked via
  vi.mock; prisma real; test rows PREFIX-scoped by keyword prefix
  `ks2test-` and cleaned in **beforeAll AND afterAll** (KS-1 convention;
  Codex plan #6) via `deleteMany({ keyword: { startsWith: 'ks2test-' } })`):
  disabled gate (no DB/network, accounting
  zeros); invalid locale variants (0 / -1 / 1.5 / NaN locationCode; ''
  languageCode) → `invalid_locale`, no DB call; normalization+dedupe
  ("Ks2Test-Nursing  Program" ≡ "ks2test-nursing program" → one row, one
  outcome); cache hit in TTL → zero transport calls, `fromCache` counted;
  stale row (fetchedAt 31 d ago) → refetch + `fetchedAt` refreshed;
  `not_returned` negative-cache hit → zero transport calls (Codex #1);
  invalid keywords → `skipped` reasons, valid remainder still fetched
  (Codex/D6); chunking: 1001 keywords → 2 transport calls; 3001 → 3 calls +
  overflow `over_cap` skipped **and output order = first-seen input order
  (deterministic on the 3001 case; Codex plan #6)**; cache-read batching:
  >500 misses still resolve correctly (assert findMany batch predicate ≤500
  keywords per call; Codex plan #2); throttle acquired once per chunk
  (assert mock call count); `providerCost` = sum of chunk costs, null when
  a successful chunk had no cost (Codex plan #3); partial failure: chunk 2
  transport error → chunk 1 rows persisted, result `{ok:false, reason,
  attemptedChunks:2, successfulChunks:1}` (Codex #3/plan #3), immediate
  retry → chunk 1 all cache hits, only chunk 2 refetched;
  `unparseable_response` chunk → zero rows written for that chunk (Codex
  plan #4); locale-distinct rows (2840 vs 2124); `EN` vs `en` locale → same
  cache row (Codex plan #1).
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** Green + whole
  `lib/keywords/` suite green.
- [ ] **Commit:** `git add lib/keywords/volume.ts lib/keywords/volume.test.ts && git commit -m "feat(keywords): cache-first keyword volume service (KS-2)"`

## Task 6: Retention + wiring

**Files:** `lib/keywords/retention.ts(+test)`, `lib/cleanup.ts`

- [ ] **Step 1: Failing test** (extend retention.test.ts): rows fetchedAt
  31 d ago pruned, 29 d kept; other suites' fresh rows untouched
  (PREFIX-scoped assertions).
- [ ] **Step 2:** Fail.
- [ ] **Step 3:** `pruneKeywordVolumeCache()` = plain
  `prisma.keywordVolumeCache.deleteMany({ where: { fetchedAt: { lt: … } } })`
  (house pruner logging convention); add to `runCleanup()` list.
- [ ] **Step 4:** Green (`retention` + `lib/cleanup.test.ts`).
- [ ] **Commit:** `git add lib/keywords/retention.ts lib/keywords/retention.test.ts lib/cleanup.ts && git commit -m "feat(keywords): 30-d KeywordVolumeCache prune in runCleanup (KS-2)"`

## Task 7: Gates, PR, ship ritual

- [ ] `npm run lint` && `DATABASE_URL="file:./local-dev.db" npm test` &&
  `npm run build` — all green.
- [ ] Dev boot check: `npm run dev` briefly WITHOUT the env vars — no
  errors/warnings from the volume module (dark = silent).
- [ ] Push `feat/ks2-volume-provider`, PR noting: additive migration; NEW
  OPTIONAL env vars `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` (dark feature —
  NOT a pre-deploy `.env` requirement; enabling is Kevin's `.env` edit +
  restart later); no routes/middleware/UI; nothing calls the service yet.
- [ ] Merge when gate-green (rule 1); deploy (stop-first recipe);
  post-deploy verify: BUILD_ID fresh, health ok, migration applied
  (read-only Prisma probe of `KeywordVolumeCache`), clean boot with zero
  volume-module output (dark posture proven in prod).
- [ ] Tracker + handoff ritual same commit; `git mv` spec+plan → archive.

## Error handling & invariants (restated)

Missing env = feature state, not error; credentials never in
logs/errors/results; fixed host constant, no URL params; one invalid keyword
never fails a batch; failed chunk never destroys persisted rows; accounting
on ok AND error; `not_returned` ≠ null volume; monthly history ≤12 entries;
throttle is process-wide.

## Out of scope

KS-5's route/scope/ledger + krt_-v2 enrichment; KS-3 profile locale; Labs
endpoints (KS-6); locations-metadata sync; any consumer wiring.
