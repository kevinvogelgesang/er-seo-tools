# KS-5 — Client-Scoped Keyword-Strategy Export + Volume Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-dashboard-minted `kst_` token whose export assembles KS-3
profile/roster + KS-1 GSC signals + KS-4 page inventory + live-scan findings +
optional SEMRush block; a memo PATCH-back rendered on the client dashboard; and
the billable `POST …/volumes` endpoint with an idempotent reserve→call→settle
spend ledger. C20's capstone — KS-2 and KS-4 get their first consumers.

**Architecture:** New `KeywordStrategySession` (client-FK) + `KeywordStrategyVolumeRequest`
(idempotency + exactly-once settle) models; `kst_`-prefix jose token (audience
`keyword-strategy-client`, scopes read/memo-write/volume-lookup, SAME secret env
as the memo family); three public token routes behind anchored middleware
regexes; assembly service in `lib/keywords/strategy-export.ts`; ledger service
in `lib/keywords/strategy-volume-ledger.ts` (conditional array-form raw SQL);
`KeywordStrategyCard` on `/clients/[id]`. Skill-side work is external (§Task 12
note) and not part of this repo's PR.

**Tech Stack:** Next.js 15 / TypeScript / Prisma + SQLite / jose / vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-ks5-keyword-strategy-export-design.md`
(Codex-reviewed, fixes #1–#6 applied — annotations referenced per task).

## Global Constraints

- **Array-form `$transaction([...])` only**; conditions expressed in SQL
  (`EXISTS`/predicates); raw statements set `updatedAt` manually
  (`Date.now()`, integer ms).
- **Migration is hand-authored SQL** (`migrate dev` is interactive-only
  here); apply locally with `DATABASE_URL="file:./local-dev.db" npx prisma
  migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`.
- **Middleware discipline:** exactly three new anchored public regexes + test
  cases (the 3×-bitten trap) — Task 8 is a standalone task, never folded in.
- **No new required-in-prod env vars.** Token secret reuses
  `KEYWORD_MEMO_TOKEN_SECRET`; the two cap envs have code defaults.
- New API routes wrap handlers in `withRoute` + `parseJsonBody` (Codex #6).
- KS-2 constants (`KEYWORD_MAX_CHARS`, `KEYWORD_MAX_WORDS`) are imported from
  `lib/keywords/volume-config.ts`, never redeclared (Codex #5).
- **Never `git add -A`** — add named files only.
- Test env: `DATABASE_URL="file:./local-dev.db" npx vitest run <path>`;
  vitest `globals: false` (import from `vitest`); component tests need
  `afterEach(cleanup)`; Prisma client is a proxy — mock modules, not
  `vi.spyOn` on model methods.
- Gate commands (final task): `npx tsc --noEmit` ·
  `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.
- Branch: `feat/ks5-keyword-strategy-export` off current `main`.

## File Structure

| File | Role |
|---|---|
| `prisma/schema.prisma` + `prisma/migrations/20260711120000_keyword_strategy_sessions/migration.sql` | the two new models + Client reverse relation |
| `lib/keyword-strategy-token.ts` (create) | kst_ jose module (mint/verify) |
| `lib/findings/finding-type-sets.ts` (create) | shared ONPAGE_FINDING_TYPES / BROKEN_FINDING_TYPES constants |
| `lib/keywords/strategy-export.ts` (create) | `loadStrategyExport(session)` — five-block assembly |
| `lib/keywords/strategy-volume-ledger.ts` (create) | reserve / settle / monthly-precheck / sweeper |
| `lib/keyword-strategy-prompt.ts` (create) | clipboard payload composer |
| `app/api/clients/[id]/keyword-strategy/route.ts` (create) | cookie-gated poll GET |
| `app/api/clients/[id]/keyword-strategy/mint-token/route.ts` (create) | cookie-gated mint POST |
| `app/api/keyword-strategy/[id]/route.ts` (create) | public export GET |
| `app/api/keyword-strategy/[id]/memo/route.ts` (create) | public memo PATCH |
| `app/api/keyword-strategy/[id]/volumes/route.ts` (create) | public billable volumes POST |
| `middleware.ts` + `middleware.test.ts` (modify) | 3 public regexes + 5 test cases |
| `lib/cleanup.ts` (modify — `runCleanup` at line 23) | session prune + stale-reservation sweeper |
| `components/clients/KeywordStrategyCard.tsx` (create) + `app/(app)/clients/[id]/page.tsx` (modify) | dashboard card |
| `components/site-audit/OnPageSeoSection.tsx`, `BrokenLinksSection.tsx` (modify) | import shared type sets |

---

### Task 1: Schema + migration

**Files:** `prisma/schema.prisma`,
`prisma/migrations/20260711120000_keyword_strategy_sessions/migration.sql`

- [ ] Add both models exactly per spec §4 (`KeywordStrategySession` with
  `clientId` FK `onDelete: Cascade`, `volumeKeywordCap`,
  `volumeKeywordsUsed @default(0)`; `KeywordStrategyVolumeRequest` with
  `responseJson String?` (plan-Codex #4 replay column),
  `@@unique([strategySessionId, idempotencyKey])`, `@@index([createdAt])`,
  `@@index([strategySessionId])`, cascade from session). Add
  `keywordStrategySessions KeywordStrategySession[]` to `Client` (Codex #6).
- [ ] Hand-author the migration SQL: two `CREATE TABLE`s (TEXT ids, INTEGER
  ms datetimes matching house convention — copy column affinities from the
  `KeywordVolumeCache`/`GscSnapshot` migrations), the unique index, the two
  plain indexes, FKs with `ON DELETE CASCADE`.
- [ ] Apply locally (`migrate deploy` + `generate`); verify with a read-only
  probe (`npx tsx -e` insert/rollback not needed — `prisma.keywordStrategySession.count()`).
- [ ] `npx tsc --noEmit` green.

### Task 2: Token module

**Files:** `lib/keyword-strategy-token.ts` (create),
`lib/keyword-strategy-token.test.ts` (create)

Clone `lib/keyword-memo-token.ts` structurally: `TOKEN_PREFIX = 'kst_'`,
`AUDIENCE = 'keyword-strategy-client'`, scope
`['read','memo-write','volume-lookup']`, secret from
`KEYWORD_MEMO_TOKEN_SECRET` (same prod-throw / dev-fallback-with-warning
behavior), `mintKeywordStrategyToken(sessionId)` → `{ token, expiresAt }`,
`verifyKeywordStrategyToken(token, expectedSessionId)`.

- [ ] Failing tests first: round-trip mint/verify; sub mismatch throws; missing
  `kst_` prefix throws; expiry (mint with a mocked clock or accept jose's
  `exp` behavior via a pre-expired token); **cross-family isolation both
  directions** — a real `mintKeywordMemoToken` output is rejected by
  `verifyKeywordStrategyToken` (prefix) and, with the prefix swapped manually,
  by audience; scope array contains exactly the three scopes.
- [ ] Implement; run the module's tests green.

### Task 3: Shared finding-type sets

**Files:** `lib/findings/finding-type-sets.ts` (create + test),
`components/site-audit/OnPageSeoSection.tsx`,
`components/site-audit/BrokenLinksSection.tsx` (modify)

- [ ] Create `ONPAGE_FINDING_TYPES` (the 7 on-page ids) and
  `BROKEN_FINDING_TYPES` (3 broken ids) as exported `ReadonlySet<string>`/
  arrays with the label maps. Client-safe module (no server imports).
- [ ] Failing test: sets match the mapper sources of truth — assert against
  the literal ids (guards drift; `onpage-seo-mapper.ts` severity map and
  `broken-link-mapper.ts` TYPE_OF stay the write-side truth).
- [ ] Refactor the two components to import (labels included); their existing
  tests stay green (`npx vitest run` on both component test files).

### Task 4: Volume ledger service

**Files:** `lib/keywords/strategy-volume-ledger.ts` (create),
`lib/keywords/strategy-volume-ledger.test.ts` (create — DB-backed)

Exports (all raw-SQL, array-form; ids for request rows generated with
`crypto.randomUUID()` since raw INSERT bypasses Prisma's cuid default):

```ts
export const VOLUME_SESSION_KEYWORD_CAP_DEFAULT = 1500
export const VOLUME_MONTHLY_KEYWORD_CEILING_DEFAULT = 25000
export function sessionKeywordCap(): number            // env override, call-time read
export function monthlyKeywordCeiling(): number

export async function monthlyUsedKeywords(now: Date): Promise<number>
// SUM(COALESCE(settledKeywords, keywordCount)) over request rows with
// createdAt >= UTC month start of `now` (Codex #4: request-row spend time)

export type ReserveResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: 'budget_exhausted'; used: number; cap: number }
  | { ok: false; reason: 'duplicate_request'; priorState: 'reserved' | 'unresolved' }
  | { ok: false; reason: 'duplicate_settled'; responseJson: string | null }  // plan-Codex #4 replay
export async function reserveVolumeBudget(args: {
  sessionId: string; idempotencyKey: string; keywordCount: number
}): Promise<ReserveResult>

export async function settleVolumeRequest(args: {
  sessionId: string; requestId: string
  outcome:
    | { kind: 'accounted'; fetched: number; fromCache: number; providerCost: number | null; responseJson: string | null }
    | { kind: 'unresolved' }
}): Promise<void>
// plan-Codex #3: settle NEVER takes a caller keyword count — retained/refund
// derive from the stored row's keywordCount in SQL, retained clamped to
// [0, keywordCount]; refund = keywordCount − retained. responseJson stored
// only when ≤ ~1 MB (over-size → null, replay degrades to 409).

export async function sweepStaleReservations(now: Date): Promise<number>
// reserved rows older than 24h → 'unresolved', NO refund (spec §8.6)
```

Reserve = one `$transaction([...])`, statement order load-bearing
(plan-Codex #2): stmt 1 `INSERT … SELECT … WHERE (cap predicate)`; stmt 2
session `UPDATE` fenced on BOTH the cap predicate AND
`EXISTS(request row :rid, state='reserved')`. Affected-count contract:
`(1,1)` = ok; `(0,0)` → probe the `(sessionId, idempotencyKey)` row FIRST
(exists+settled → `duplicate_settled` with its responseJson; exists otherwise
→ `duplicate_request`; absent → `budget_exhausted` with used/cap read);
**mismatched `(1,0)`/`(0,1)` → throw an internal ledger error (route maps to
500), never success**. A raw unique-constraint violation aborts the whole
array txn (rollback, no half-reserve) → catch and run the same probe.
Settle = spec §8.4: session refund `UPDATE` with `EXISTS(state='reserved')`
fence FIRST (`MAX(0, …)` floor guard, refund derived in SQL from the stored
`keywordCount` with retained clamped to `[0, keywordCount]` — plan-Codex #3),
then the request-row state flip fenced on `state='reserved'` — same txn,
exactly-once.

- [ ] Failing tests (DB-backed, real local SQLite — create a client + session
  row per test, clean up):
  - reserve success decrements headroom; boundary: `cap−n` exactly fits,
    `n+1` more refused with `{used, cap}`.
  - duplicate idempotencyKey while prior row `reserved` → `duplicate_request`,
    `volumeKeywordsUsed` unchanged; prior row `settled` →
    `duplicate_settled` carrying the stored responseJson (plan-Codex #4).
  - **duplicate precedence over budget exhaustion** (Codex verify item): a
    duplicate key against an exhausted session still reports the duplicate
    flow, not `budget_exhausted`.
  - settle `accounted` (fetched 3 of 10) → used drops by 7, row state
    `settled`, `settledKeywords=3`, cost + responseJson stored.
  - **wrong-count immunity** (plan-Codex #3 / Codex verify item): settle with
    `fetched` wildly larger than the stored keywordCount clamps — refund
    never exceeds the reservation, counter never over-refunds.
  - settle `accounted` with `providerCost: null` stores null (poisoned-cost
    passthrough).
  - settle `unresolved` → no refund, state `unresolved`.
  - **double-settle no-ops** (second call leaves counters + row untouched).
  - floor guard: refund larger than counter cannot go negative.
  - monthly aggregation: rows straddling a UTC month boundary — only the
    current month counts; `settledKeywords` preferred over `keywordCount`.
  - concurrent reserves: fire two `reserveVolumeBudget` calls with
    `Promise.all` where only one fits under the cap — exactly one succeeds.
  - sweeper: 25h-old reserved row flips to unresolved, fresh reserved row
    untouched, counter unchanged.
- [ ] Implement; tests green.

### Task 5: Export assembly service

**Files:** `lib/keywords/strategy-export.ts` (create),
`lib/keywords/strategy-export.test.ts` (create)

`loadStrategyExport(sessionId: string): Promise<StrategyExport | null>` —
loads the FULL session row itself (id, clientId, gscRefreshed,
volumeKeywordCap, volumeKeywordsUsed) plus the client's name for `siteName`
(plan-Codex #5: a `{id, clientId}`-only input cannot populate those fields);
null when the row is gone. Assembles the five blocks per spec §7:

- profile: `getKeywordProfile(clientId)` → institutionType / programs / locale.
- gsc: `getLatestGscSnapshot(clientId)` + `gscRefreshed` from the row.
- inventory + findings: newest run
  (`clientId + source:'live-scan' + tool:'seo-parser'`, `createdAt desc, id
  desc`); pages selected on the `InventoryPageInput` fields →
  `buildPageInventory(pages, { programEntityUrls })` (entity URLs parsed
  fail-soft from `programEntitiesJson`); findings = run-scope rows filtered by
  the Task-3 sets, split into `onPage`/`brokenLinks`.
- semrush: latest client `Session` (`workflow:'keyword-research'`,
  `status:'complete'`, `result != null`, `createdAt desc, id desc` — Codex
  tie-break) → `buildKeywordResearchExport(JSON.parse(result))`; any
  parse/absence → block omitted.
- volumeLookup: `isVolumeEnabled()`, cap/used off the session row, locale from
  the profile.

- [ ] Failing tests (DB-backed): full assembly with all blocks; **the framing
  fields are pinned** — `siteName` = Client.name, `gsc.refreshedAtMint` =
  row.gscRefreshed, `volumeLookup.cap/used` = row values (plan-Codex #5);
  each degraded case independently (no gsc mapping / no live-scan run / no
  semrush / corrupt semrush JSON / corrupt programEntitiesJson still yields
  inventory without upgrades); findings split matches the shared sets exactly
  (a stray `technical_*` finding appears in neither); semrush tie-break (two
  complete sessions same createdAt → higher id wins); `volumeLookup.enabled`
  follows env (set/unset `DATAFORSEO_LOGIN/PASSWORD` around the call).
- [ ] Implement; tests green.

### Task 6: Cookie-gated routes (mint + poll)

**Files:** `app/api/clients/[id]/keyword-strategy/mint-token/route.ts`,
`app/api/clients/[id]/keyword-strategy/route.ts`, tests alongside.

- [ ] Failing tests: mint → 404 unknown client; 409 `client_archived`;
  success creates a session row (`status:'processing'`, stamped cap from env
  default) and returns `{ token: /^kst_/, expiresAt, strategyId }`;
  `refreshGscSnapshot` failure (mock the module) still mints with
  `gscRefreshed:false`; **mint-throw path**: mock
  `mintKeywordStrategyToken` to throw → 500 AND the just-created row is
  gone (Codex #6). Poll GET → latest session by `createdAt desc, id desc`,
  `{ session: null }` when none.
- [ ] Implement with `withRoute` (routes export only handlers + config).
  Mint order: guards → GSC refresh (try/catch) → create row → mint (try/catch
  → best-effort delete + rethrow as 500) → respond.

### Task 7: Public token routes (export GET + memo PATCH + volumes POST)

**Files:** `app/api/keyword-strategy/[id]/route.ts`,
`app/api/keyword-strategy/[id]/memo/route.ts`,
`app/api/keyword-strategy/[id]/volumes/route.ts`, tests alongside.

Shared auth helper inside each route (copy the keyword-memo pattern):
Bearer regex `^Bearer\s+(kst_\S+)$`, `verifyKeywordStrategyToken`,
`tokenErrorCode` taxonomy, scope check per route.

- [ ] **Export GET** failing tests: auth matrix (missing header /
  malformed / expired / wrong sub / a REAL legacy krt_ memo token → 401;
  token minus `read` scope → hand-craft a jose token with the right
  audience but reduced scope → 401 `token_missing_scope`); 404 when the
  session row is gone; success returns `loadStrategyExport` payload with
  `id`/`clientId`/`siteName`/`generatedAt` framing.
- [ ] **Memo PATCH** failing tests: body-before-auth (malformed JSON → 400
  `invalid_json` even with no header); `memo` required / too long (50k) /
  `structured` non-object rejected / too long (200k); wrong scope → 401;
  success stores memoMarkdown + structured, flips `status:'complete'`,
  stamps `memoUpdatedAt`, returns `{ ok, updatedAt }`.
- [ ] **Volumes POST** failing tests (mock `getKeywordVolumes` +
  `isVolumeEnabled`; real DB for ledger):
  - scope wall: legacy krt_ token → 401; strategy token verified but scope
    check still runs (hand-crafted reduced-scope token → 401).
  - `idempotencyKey` required (400), > 64 chars (400); duplicate while
    prior `reserved`/`unresolved` → 409 `duplicate_request`, counter
    unchanged; **duplicate of a `settled` request → 200 replaying the stored
    responseJson** (plan-Codex #4); settled-with-null-responseJson → 409.
  - `keywords` required; 301 entries → 400 `too_many_keywords`; all-invalid →
    400 `no_valid_keywords`; an 81-char keyword route-filters into response
    `skipped` and is EXCLUDED from the reservation (assert reserved count).
  - dark gate: `isVolumeEnabled` false → 409 `volume_disabled`, NO request
    row created.
  - locale: profile locale null → 409 `locale_not_configured`; body-supplied
    locale ignored (assert `getKeywordVolumes` called with the profile
    locale).
  - happy path: reserve → call (mock returns 2 fetched / 3 fromCache of 5) →
    settle refunds 3 → response `{ volumes, accounting, budget:{used,cap} }`.
  - KS-2 `ok:false` with accounting (fetched 2, providerCost 0.01) → settle
    retains 2, response is the mapped error envelope (`auth`/`payment` → 502,
    `rate_limited` → 429) INCLUDING `budget`.
  - `getKeywordVolumes` THROWS → settle `unresolved` (full retention), 500,
    request row state `unresolved` (finally-path test).
  - budget exhaustion → 429 `volume_budget_exhausted` with used/cap.
  - monthly ceiling: pre-seed request rows to `ceiling − n + 1` this month →
    429 `volume_monthly_ceiling` (Codex #4 `used + n > ceiling` boundary).
- [ ] Implement. Route order per spec §8: validate body → dark gate → locale
  → filter/dedupe → monthly precheck → reserve → call. The settle posture is
  correct ONLY if the `try` begins immediately after a successful reserve
  (plan-Codex reasoning — no early return may sit between reserve and try):

  ```ts
  const reserved = await reserveVolumeBudget(...)
  if (!reserved.ok) return mapReserveFailure(reserved)
  let outcome: SettleOutcome = { kind: 'unresolved' }
  try {
    const result = await getKeywordVolumes(candidates, locale)
    outcome = outcomeFor(result)          // accounted (even on ok:false with numbers)
    return responseFor(result, budget)
  } finally {
    await settleVolumeRequest({ sessionId, requestId: reserved.requestId, outcome })
      .catch((err) => logError('volumes.settle', err))  // sweeper is the backstop
  }
  ```

### Task 8: Middleware allowlist (standalone — the 3×-bitten trap)

**Files:** `middleware.ts`, `middleware.test.ts`

- [ ] Failing tests first: `isPublicPath` true for
  `/api/keyword-strategy/abc123`, `/api/keyword-strategy/abc123/memo`,
  `/api/keyword-strategy/abc123/volumes`; false for
  `/api/clients/1/keyword-strategy` and
  `/api/clients/1/keyword-strategy/mint-token`.
- [ ] Add exactly the three anchored regexes from spec §6. Full
  `middleware.test.ts` run green.

### Task 9: Retention

**Files:** `lib/cleanup.ts` (`runCleanup`), test alongside; ledger sweeper from Task 4.

Tiered rule (plan-Codex #1 — pruning must never delete request rows the
monthly ceiling still counts): memo-less + NO request rows → prune at 7 d;
memo-less WITH request rows → prune at 45 d; memo-bearing → kept.

- [ ] Failing tests: memo-less/no-requests 8 d old pruned; memo-less WITH a
  request row 8 d old KEPT (and its spend still counted by
  `monthlyUsedKeywords`); memo-less with requests 46 d old pruned (cascade);
  memo-bearing 46 d old kept; memo-less 6 d old kept. Sweeper wired:
  `sweepStaleReservations` invoked by `runCleanup`.
- [ ] Implement `pruneKeywordStrategySessions()` (tagged `$executeRaw` delete
  with `NOT EXISTS`/`EXISTS` request-row predicates, KS-1 retention
  precedent) + call both from `runCleanup`.

### Task 10: Prompt composer + dashboard card

**Files:** `lib/keyword-strategy-prompt.ts` (create + test),
`components/clients/KeywordStrategyCard.tsx` (create + test),
`app/(app)/clients/[id]/page.tsx` (modify)

- [ ] Prompt test: exact payload lines (`Webapp:` / `Strategy ID:` /
  `Access token: kst_…` / `(Expires in 1h)`).
- [ ] Card failing tests (jsdom; `afterEach(cleanup)`; fake timers need
  `act()`): renders latest memo markdown + updatedAt; "Generate strategy
  prompt" → POSTs mint, writes clipboard (mock `navigator.clipboard`),
  enters polling; poll sees changed `memoUpdatedAt` → refetch renders new
  memo; readiness hints shown when initial props lack gsc/live-scan/locale;
  archived → button disabled. Copy the `GenerateKeywordMemoButton` +
  `KeywordMemoCard` wiring (`createPollingMachine` with 15-min lifetime, 3s
  interval, visibilitychange pause) against
  `GET /api/clients/[id]/keyword-strategy`. Reuse
  `components/keyword-research/KeywordMemoMarkdown.tsx` for the memo body;
  ALL elements get `dark:` variants.
- [ ] Page integration: add the latest-session read + readiness derivation to
  the page's `Promise.all`, render `KeywordStrategyCard` immediately after
  `KeywordProfileCard`.

### Task 11: Gates + PR

- [ ] Fresh full run: `npx tsc --noEmit` ·
  `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.
- [ ] Sweep: `rg "144\.126|ssh seo|deploy\.sh" app components lib` (no ops
  strings in client code); grep that no route redeclares KS-2 constants.
- [ ] Push branch, open PR (named files only), whole-branch review, merge when
  gate-green (rule 1). **DO NOT DEPLOY YET** — Task 12 (skill routing) is a
  release prerequisite (plan-Codex #6): a deployed card mints `kst_` prompts
  the skill can't route.
- [ ] AFTER Task 12: deploy (stop-first recipe), prod-verify: migration
  applied (read-only Prisma probe of both tables), health ok, clean boot,
  mint→export round-trip on a real client via authed UI or curl with the
  session cookie, volumes route returns `volume_disabled` (KS-2 still dark).
- [ ] Tracker + handoff ritual in the same commit; archive spec + plan.

### Task 12 (EXTERNAL — **release prerequisite: lands between merge and
deploy**; not in this repo's PR/gates)

`~/.claude/skills/er-handoff-memo`: add the `kst_` family row to SKILL.md
(routing table + workflow notes), the `kst_` ROUTES entry + `volumes`
subcommand (UUID idempotency key generated per logical call, reused on retry)
to `scripts/handoff.py`, and `templates/keyword_strategy_structure.md` (Kevin's
8-section schema; §8 FAQ recommendations use ONLY `not-detected` pages with the
hedged phrasing "no FAQ detected — verify before recommending"; honor
`volumeLookup.enabled:false`). The 4 reference docs are a **Kevin-provides
step** (they live in his Claude project) — the skill ships without them and
falls back to asking. Bump the skill version; note the acceptance checks from
spec §10.1 in the skill README.
