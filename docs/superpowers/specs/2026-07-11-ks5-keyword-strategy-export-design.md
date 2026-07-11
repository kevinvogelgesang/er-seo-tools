# KS-5 — Client-scoped keyword-strategy export + volume endpoint + skill upgrade

**Status:** design, Codex-reviewed (accept with named fixes ×6, all applied —
annotated `Codex #N` inline). C20 increment 5 of 5 — the capstone; MVP
completes when this ships.
**Umbrella:** `2026-07-10-keyword-strategy-capability-design.md` §4 KS-5
(archived after this ships), umbrella-Codex #1 (volume endpoint binds to the
client-scoped session) + #2 (billable capability, not a read).
**Consumes:** KS-1 (`gsc-snapshot.ts`), KS-2 (`volume.ts`, dark), KS-3
(`keyword-profile.ts`), KS-4 (`page-inventory.ts`, dark). All four
ship-verified; KS-2/KS-4 have had NO consumer until now.
**Written:** 2026-07-11.

---

## 1. Problem

Kevin's 8-section keyword-strategy workflow needs one clipboard handoff that
carries EVERYTHING the skill needs: institution profile + confirmed roster
(KS-3), GSC wins/opportunities/quick-wins/cannibalization (KS-1), the page
inventory with FAQ tri-state (KS-4), the latest live-scan on-page findings, and
— optionally — the latest SEMRush-CSV session's signals. Today the krt_ flow is
session-bound (SF/SEMRush upload only) and none of KS-1..4 reach any export.

Separately, §5 of the strategy doc needs **search volume** for ~100 generated
keywords. The skill generates candidates mid-conversation — the volumes can't be
pre-assembled into the export. That requires a token-authed lookup endpoint,
and it is **billable** (DataForSEO spend), so it needs its own scope, strict
validation, and a persisted spend ledger (umbrella-Codex #1/#2).

## 2. Goals / Non-goals

**Goals**

1. A client-dashboard-minted `kst_` token + export assembling all five data
   blocks, each degrading independently to absent (the skill's "When to Ask"
   rules handle gaps).
2. Memo PATCH-back rendering on the client dashboard (KeywordResearchSession
   *pattern*, new client-scoped model).
3. `POST …/volumes`: the billable volume lookup — dedicated `volume-lookup`
   scope, locale fixed server-side, idempotent per-request spend ledger
   enforced via conditional array-form statements.
4. Skill-side: `er-handoff-memo` gains a `kst_` workflow producing the
   8-section strategy doc; the legacy session-bound krt_ memo keeps working
   untouched.

**Non-goals**

- No new crawling/fetching of client sites; everything reads existing rows +
  the GSC/DataForSEO APIs already built.
- No AI API (standing gate) — generation stays in the skill.
- No retirement of the session-bound krt_ memo flow or the SEMRush CSV upload
  (umbrella §5 Q4: CSV stays optional additive input).
- No KS-6 work (Labs endpoints, contentText export).
- Volume pre-enrichment of the GSC set in the export (the umbrella floated it
  for KS-2; deferred — the endpoint covers §5's need without spending on every
  mint).
- No change to `getKeywordVolumes`' signature (no abort-signal threading —
  see §8 timeout rationale; a 300-keyword request is a single provider chunk).

## 3. Kevin §5 decisions — proposed defaults (ship unless overridden)

| Q | Decision proposed here |
|---|---|
| Q1 spend envelope | Per-session cap **1,500 keywords**, monthly ceiling **25,000 keywords** — both env-tunable (`VOLUME_SESSION_KEYWORD_CAP`, `VOLUME_MONTHLY_KEYWORD_CEILING`), cap stamped on the session row at mint so later env edits never retro-shrink an open session. Keyword-count is the unit (not $) because DataForSEO bills per request batch; the ledger is a runaway-loop guard, not an accounting system. Real spend (`providerCost`) is recorded per request row for observability. |
| Q3 token family | **New `kst_` prefix** (Codex #1 — reverses the umbrella's krt_-v2 lean, which was a proposed default, not a Kevin ruling): audience `keyword-strategy-client`, scopes `['read','memo-write','volume-lookup']`, **same secret env** (`KEYWORD_MEMO_TOKEN_SECRET` — no new prod env var, no Kevin pre-deploy step). Rationale: the skill's `handoff.py` routes by prefix alone and "trust the prefix" is a standing skill invariant; same-prefix krt_-v2 would make the human-readable `Strategy ID:` label load-bearing for routing a *billable* public capability. A distinct prefix keeps prefix = single source of truth at zero cost. If Kevin overrides back to krt_-v2, the skill parser must reject missing/duplicate/conflicting ID labels with tests (Codex #1 fallback). |
| Q6 GSC cadence | **Refresh-on-mint**: the mint route awaits `refreshGscSnapshot(clientId)` (single-flight-protected) best-effort — any failure degrades to the latest stored snapshot and mints anyway; the export's `fetchedAt` keeps staleness visible. One GSC fetch per mint, no schedule. |
| Q7 FAQ phrasing | The KS-4 spec §7 hedged map ships as skill-side wording: `present` → "FAQ detected (schema markup / page structure)", `not-detected` → **"no FAQ detected — verify before recommending"**, `unknown` → "not analyzed". The export carries only the decoded tri-state + signals; phrasing lives in the skill template. |

## 4. Data model

`KeywordResearchSession` cannot host this: it is 1:1 with an SF-upload
`Session` (`sessionId String @unique` FK, cascade) and a client-scoped strategy
has no Session. Two new models (one additive migration, hand-authored SQL per
the local `migrate dev` constraint):

```prisma
model KeywordStrategySession {
  id                 String    @id @default(cuid())
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  clientId           Int
  client             Client    @relation(fields: [clientId], references: [id], onDelete: Cascade)
  status             String    @default("processing") // processing | complete
  tokenMintedAt      DateTime
  gscRefreshed       Boolean   @default(false) // mint-time refresh succeeded
  memoMarkdown       String?
  structured         String?
  memoUpdatedAt      DateTime?
  volumeKeywordCap   Int                        // stamped at mint from env default
  volumeKeywordsUsed Int       @default(0)      // budget counter (fast cap check; request rows are the audit trail)
  volumeRequests     KeywordStrategyVolumeRequest[]

  @@index([clientId, createdAt])
}

model KeywordStrategyVolumeRequest {
  id                String   @id @default(cuid())
  createdAt         DateTime @default(now())            // spend-time — monthly aggregation keys on THIS (Codex #4)
  updatedAt         DateTime @updatedAt
  strategySessionId String
  strategySession   KeywordStrategySession @relation(fields: [strategySessionId], references: [id], onDelete: Cascade)
  idempotencyKey    String
  state             String   // 'reserved' | 'settled' | 'unresolved'
  keywordCount      Int      // reserved: validated, normalized, deduped count
  settledKeywords   Int?     // settled: retained count (fetched work); null while reserved/unresolved
  fetched           Int?
  fromCache         Int?
  providerCost      Float?   // real spend as KS-2 reported it; null = unresolved
  responseJson      String?  // settled: bounded stored response for idempotent replay (plan-Codex #4)

  @@unique([strategySessionId, idempotencyKey])
  @@index([createdAt])
  @@index([strategySessionId])
}
```

- **Every mint creates a new `KeywordStrategySession` row** (clean provenance;
  the per-session ledger resets per mint by design — the cap guards a runaway
  skill loop inside one handoff, the monthly ceiling guards the aggregate;
  Kevin re-minting is the operator choosing to spend).
- `Client` gains the reverse relation `keywordStrategySessions
  KeywordStrategySession[]` (Codex #6); FKs + indexes land in the migration.
- Client linkage is a REAL FK (unlike `KeywordResearchSession.clientId`, a
  bare int) — `onDelete: Cascade` both hops: deleting a client deletes its
  strategy sessions and their request rows.
- **Request rows are the exactly-once seam** (Codex #2): aggregate counters
  alone cannot distinguish retry / partial success / crash / duplicate
  settlement on a billable endpoint fronted by stateless JWTs. See §8.
- **Retention** (Codex #6 wording fix; tiered per plan-Codex #1 so pruning
  never deletes request rows the monthly ceiling still counts): `runCleanup`
  prunes memo-less sessions with **no volume-request rows** at
  `tokenMintedAt < now − 7 d` (abandoned mints), and memo-less sessions WITH
  request rows only at `tokenMintedAt < now − 45 d` (past any UTC-month
  window the ceiling can query). Memo-bearing rows are kept indefinitely
  (they are documents, same posture as `KeywordResearchSession`).
  Additionally, request rows stuck in `reserved` for > 24 h are flipped to
  `unresolved` WITHOUT refunding the session counter (conservative: a crash
  window means spend is unknown; see §8 step 6).

## 5. Token — `lib/keyword-strategy-token.ts`

Clone of the `keyword-memo-token.ts` template (jose HS256, TTL 3600, iss
`er-seo-tools`):

| Field | Value |
|---|---|
| Prefix | `kst_` (Codex #1) |
| AUDIENCE | `keyword-strategy-client` |
| scope | `['read', 'memo-write', 'volume-lookup']` |
| sub | `KeywordStrategySession.id` (cuid) |
| Secret env | `KEYWORD_MEMO_TOKEN_SECRET` (shared with the memo family; prod already has it — Codex: cryptographically sound because both modules hardcode distinct audiences) |

`verifyKeywordStrategyToken(token, expectedSessionId)` — same prefix-strip +
`jwtVerify` + sub-binding contract. A legacy krt_ memo token presented to a
strategy route fails at the prefix check (and would fail aud anyway); a kst_
token on a memo route likewise. Route handlers additionally require the
per-route scope, so even a future audience mistake cannot grant
`volume-lookup` to a memo token — two independent walls (umbrella-Codex #2).

## 6. Routes

All new routes wrap their handlers in `withRoute` and parse JSON bodies with
`parseJsonBody` (house API kit — Codex #6).

### Cookie-gated (dashboard)

**`POST /api/clients/[id]/keyword-strategy/mint-token`**
1. Client exists (404) and `archivedAt === null` (409 `client_archived` —
   matches the KS-3 mutate guard).
2. Best-effort `await refreshGscSnapshot(clientId)` (Q6). Record the outcome
   into `gscRefreshed`; NEVER block the mint on a refresh failure.
3. Create the `KeywordStrategySession` row (`status:'processing'`,
   `tokenMintedAt: now`, `volumeKeywordCap` from env default 1500).
4. Mint against `row.id`. **If minting throws** (secret missing in prod),
   best-effort delete the just-created row before the 500 — the dashboard
   must not poll a token-less `processing` session (Codex #6).
5. Respond `{ token, expiresAt, strategyId }`.

**`GET /api/clients/[id]/keyword-strategy`** — card poll + initial load:
latest session for the client (`createdAt desc, id desc`), shaped
`{ session: { id, status, tokenMintedAt, memoMarkdown, memoUpdatedAt } | null }`.

### Public (token-authed; the middleware allowlist grows by exactly these three)

All three: `Authorization: Bearer kst_…` → `verifyKeywordStrategyToken(token,
id)` → scope check → work. Token-error mapping copies the keyword-memo route's
`tokenErrorCode` taxonomy (`token_expired` / `token_wrong_*` /
`token_invalid_signature` / `token_invalid`, all 401); body validated before
auth on write routes (400 beats 401, matching the memo PATCH).

**`GET /api/keyword-strategy/[id]`** — scope `read`. Assembles the export (§7).

**`PATCH /api/keyword-strategy/[id]/memo`** — scope `memo-write`. Body
`{ memo: string, structured?: object|array }`, caps 50k/200k chars (same
constants as the memo route). Stores `memoMarkdown`/`structured`,
`status:'complete'`, `memoUpdatedAt: now`. Response `{ ok, updatedAt }`.

**`POST /api/keyword-strategy/[id]/volumes`** — scope `volume-lookup`. §8.

### middleware.ts (the 3×-bitten trap — handled at spec level)

Three anchored single-route regexes appended to `isPublicPath`:

```
/^\/api\/keyword-strategy\/[^/]+$/
/^\/api\/keyword-strategy\/[^/]+\/memo$/
/^\/api\/keyword-strategy\/[^/]+\/volumes$/
```

`middleware.test.ts` gains: the three public-true cases, plus gated-false cases
for `/api/clients/1/keyword-strategy` and
`/api/clients/1/keyword-strategy/mint-token` (mint and poll stay behind the
cookie, same posture as the memo family's by-session routes).

## 7. Export payload (GET)

Five independent blocks; each degrades to `null`/absent rather than failing the
fetch — the skill's "When to Ask" instructions own the gap handling. Top level:

```jsonc
{
  "id": "<strategyId>",
  "clientId": 12,
  "siteName": "<Client.name>",
  "generatedAt": "<ISO>",
  "profile": {                      // KS-3 — always present (may be sparse)
    "institutionType": "trade" | null,
    "programs": ProgramEntry[],     // confirmed roster only (parsePrograms)
    "locale": { "locationCode": 2840, "languageCode": "en", "marketLabel": "…" } | null
  },
  "gsc": {                          // KS-1
    "gscMapped": true,
    "refreshedAtMint": true,        // row.gscRefreshed
    "summary": GscSnapshotSummary | null   // verbatim: window/thresholds/counts/atLimit flags/fetchedAt ride along
  },
  "inventory": {                    // KS-4 — null when the client has no live-scan run
    "runId": "…", "runCreatedAt": "<ISO>", "domain": "…",
    "runScore": 82 | null, "pagesTotal": 143, "indexablePages": 120,
    "pages": PageInventoryEntry[]   // buildPageInventory output, verbatim (url-sorted, run-bounded ≤1000)
  } | null,
  "findings": {                     // same run as inventory; null with it
    "onPage":      [{ "type", "severity", "scope", "count", "url" }],  // ONPAGE types
    "brokenLinks": [{ "type", "severity", "scope", "count", "url" }]   // broken_* types, run-scope rows only
  } | null,
  "semrush": KeywordResearchExport | null,  // optional additive (Q4)
  "volumeLookup": {
    "enabled": true,               // isVolumeEnabled() at read time — false while KS-2 stays dark
    "endpoint": "/api/keyword-strategy/<id>/volumes",
    "cap": 1500, "used": 0,
    "locale": { "locationCode": 2840, "languageCode": "en" } | null  // informational; server enforces regardless
  }
}
```

Assembly decisions:

- **Run resolution follows the KS-3 precedent exactly** (`suggestPrograms`):
  newest CrawlRun where `clientId` + `source:'live-scan'` + `tool:'seo-parser'`,
  `orderBy [{createdAt:'desc'},{id:'desc'}]`. **No `seoIntent` filter** — since
  C6 Phase 2 every completed site audit's live-scan run carries the on-page
  harvest, and since KS-4 the FAQ scalar; pre-KS-4 runs simply decode
  `unknown` everywhere (honest, never fabricated). Codex confirmed omitting
  seoIntent is defensible on these grounds.
- **Inventory** = `buildPageInventory(pages, { programEntityUrls })` with
  `programEntityUrls` from the run's `programEntitiesJson` (`{v:1, entities:
  [{name,url}]}` — url is the audited page URL; malformed JSON → no upgrade,
  never a throw). Page rows selected: url, title, h1, wordCount, crawlDepth,
  indexable, faqEvidence — the `InventoryPageInput` contract verbatim.
- **Findings** load from the same run, run-scope rows only, filtered to the
  on-page types (`missing_title`, `duplicate_title`, `missing_meta_description`,
  `duplicate_meta_description`, `missing_h1`, `duplicate_h1`, `thin_content`)
  and broken types (`broken_internal_links`, `broken_images`,
  `broken_external_links`). The type lists move to shared constants in
  `lib/findings/` so the export and the two results-page sections stop
  re-declaring them independently (today `OnPageSeoSection`/`BrokenLinksSection`
  each hold a private copy).
- **semrush block**: latest `Session` for the client with
  `workflow:'keyword-research'`, `status:'complete'`, `result` non-null,
  `orderBy [{createdAt:'desc'},{id:'desc'}]` (deterministic tie-break matching
  the live-scan query — Codex verify item) →
  `buildKeywordResearchExport(result)` (gap keywords already capped 500).
  Pruned/absent/invalid blob → block omitted (no 409 here — unlike the legacy
  krt_ route, this block is additive).
- **GSC block** is `getLatestGscSnapshot(clientId)` verbatim — the summary's
  window/truncation/threshold metadata IS the hedged-semantics carrier
  (umbrella-Codex #4); the skill template phrases absence as "not observed in
  this GSC window".
- Size: worst case ≈ 1000 inventory entries + 150 GSC entries + 500 gap
  keywords ≈ a few hundred KB of JSON — fine for a single skill fetch; no
  extra caps invented.

## 8. Volume endpoint — the billable capability

`POST /api/keyword-strategy/[id]/volumes`, scope `volume-lookup`.

**Request** `{ "idempotencyKey": string, "keywords": string[] }`:

- `idempotencyKey` REQUIRED — a client-generated UUID-ish string (≤ 64 chars).
  The skill's `handoff.py volumes` subcommand generates one per logical call
  and **reuses it on transport retry** (Codex #2 — we control the only
  client). Duplicate-key semantics (plan-Codex #4 — retry RECOVERY, not just
  rejection): if the prior request row is **`settled`**, replay its stored
  `responseJson` with 200 (the retry gets its data back — a lost response is
  the whole point of the key); if it is still `reserved` or `unresolved` →
  409 `duplicate_request` (never double-reserve). `responseJson` is bounded
  (~1 MB guard; over-size stores null and the replay degrades to 409).
- `keywords`: array required, **≤ 300 per request** (bounded per-request work;
  the session cap governs the total). Over-cap → 400 `too_many_keywords`.
- **Route-side candidate filtering** (Codex #5 — one contract, no drift):
  normalize via `normalizeKeyword`, dedupe, drop entries violating the KS-2
  constants (`KEYWORD_MAX_CHARS` 80 / `KEYWORD_MAX_WORDS` 10, imported from
  `volume-config.ts`, never redeclared), reporting drops in the response's
  `skipped` with KS-2's reason vocabulary. **Only the surviving candidates are
  reserved and forwarded** — KS-2 would re-skip identically (same constants),
  so reserve never counts keywords that can't be sent. Empty survivor set →
  400 `no_valid_keywords`.

**Locale is fixed server-side** (umbrella-Codex): read the client profile
through the session's `clientId`; `kwLocationCode`/`kwLanguageCode` null →
409 `locale_not_configured`. The request body carries NO locale field; one
supplied is ignored.

**Dark gate:** `isVolumeEnabled()` false → 409 `volume_disabled` with an
honest message ("volume provider not configured") — checked BEFORE any
reservation. The endpoint ships before Kevin sets
`DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` in prod (his step, not a deploy
prereq).

### Ledger — idempotent reserve → call → settle (Codex #2/#3/#4)

Order: validate body → dark gate → locale → filter/dedupe (`n` survivors) →
monthly precheck → reserve → call → settle. All multi-statement writes are
array-form `$transaction([...])` with conditions expressed IN the SQL
(house rule); raw statements set `updatedAt` manually (integer ms).

1. **Monthly ceiling precheck** (advisory, Codex #4 math): reject when
   `currentMonthUsed + n > VOLUME_MONTHLY_KEYWORD_CEILING` → 429
   `volume_monthly_ceiling`. `currentMonthUsed` =
   `SUM(COALESCE(settledKeywords, keywordCount))` over
   `KeywordStrategyVolumeRequest` rows with `createdAt` in the current UTC
   month — **request-row spend time, NOT session `createdAt`** (a session
   minted near month-end spends into the next month). Read-then-write with a
   documented small race — acceptable for an internal tool guarding pennies;
   the per-session cap is the strict wall.
2. **Reserve** — one array-form `$transaction`, statement order load-bearing
   (plan-Codex #2):
   - `INSERT INTO KeywordStrategyVolumeRequest (id=:rid, …,
     state='reserved', keywordCount=:n) SELECT … WHERE (SELECT
     volumeKeywordsUsed + :n <= volumeKeywordCap FROM KeywordStrategySession
     WHERE id=:sid)`
   - `UPDATE KeywordStrategySession SET volumeKeywordsUsed =
     volumeKeywordsUsed + :n, updatedAt=:nowMs WHERE id=:sid AND
     volumeKeywordsUsed + :n <= volumeKeywordCap AND EXISTS (SELECT 1 FROM
     KeywordStrategyVolumeRequest WHERE id=:rid AND state='reserved')` —
     the session bump is fenced on THAT request row existing, not just the
     cap predicate.
   Affected-count contract: `(1,1)` = reserved. `(0,0)` = probe the
   `(strategySessionId, idempotencyKey)` row FIRST → duplicate flow (settled
   → replay; else 409), otherwise 429 `volume_budget_exhausted` with
   `{ used, cap }`. **Any mismatched pair `(1,0)`/`(0,1)` is an internal
   ledger error** — log + 500, never treated as success. A raw
   unique-constraint violation aborts the WHOLE array txn (rollback — no
   half-reserve possible); catch it and run the same probe.
3. **Call** `getKeywordVolumes(candidates, locale)` — KS-2 owns cache,
   chunking, throttle (process-wide 12/60s singleton), and per-chunk
   AbortController transport timeout (30 s). **No route-level abort** (Codex
   #5): `getKeywordVolumes` accepts no signal, and threading one through the
   service + throttle is out of scope. The realistic bound for ≤300 keywords
   is ONE provider chunk: bounded throttle wait (≤ ~60 s worst case) + 30 s
   transport — the call is self-limiting without route machinery.
4. **Settle** — in a `finally`-safe path (settlement runs whether the call
   returned ok, returned an error union, or threw), one array-form
   `$transaction`, exactly-once via the state fence:
   - `UPDATE KeywordStrategySession SET volumeKeywordsUsed = MAX(0,
     volumeKeywordsUsed - :refund), updatedAt=:nowMs WHERE id=:sid AND
     EXISTS (SELECT 1 FROM KeywordStrategyVolumeRequest WHERE id=:rid AND
     state='reserved')` — where `:refund` is **derived from the STORED row's
     `keywordCount`, never a caller-supplied count** (plan-Codex #3):
     `retained` is clamped to `[0, keywordCount]` in SQL and
     `refund = keywordCount − retained`; floor guard `MAX(0, …)` keeps a
     corrupt counter non-negative.
   - `UPDATE KeywordStrategyVolumeRequest SET state=:newState,
     settledKeywords=:retained, fetched=:fetched, fromCache=:fromCache,
     providerCost=:cost, responseJson=:resp, updatedAt=:nowMs
     WHERE id=:rid AND state='reserved'`
   Statement order matters: the session refund's EXISTS fence reads the
   request row BEFORE the second statement flips it, inside the same txn — a
   duplicate settle attempt finds `state != 'reserved'` and both statements
   no-op (Codex #2 exactly-once).
   **Retention policy** (Codex #3 — never fully refund a partially-successful
   call): `retained = fetched` when KS-2's accounting is trustworthy
   (`ok:true`, or `ok:false` with numeric accounting — KS-2 reports
   `fetched`/`successfulChunks`/`providerCost` even on failure unions, and
   earlier successful chunks were really sent and cache-persisted);
   `refund = n − retained` (cache hits and never-sent keywords come back).
   When the call **threw** or spend is genuinely unresolvable (KS-2's
   poisoned-cost case: a request went out, no accounting came back):
   `retained = n`, `refund = 0`, `state='unresolved'` — the full reservation
   is held (conservative; Codex #3). `providerCost` stores whatever KS-2
   reported, null when unresolved.
5. **Response** `{ ok: true, volumes: KeywordVolume[], accounting: {
   fromCache, fetched, skipped, providerCost }, budget: { used, cap } }`, or
   the KS-2 failure reason mapped to an honest envelope (`auth`/`payment` →
   502 with reason, `rate_limited` → 429, plus the settled budget so the
   skill sees what the failure cost).
6. **Stale-reservation sweeper** (crash window): `runCleanup` flips request
   rows `reserved` for > 24 h to `unresolved` WITHOUT refunding — a crash
   between reserve and settle means spend is unknown; holding the budget is
   the safe direction. (Session rows die with their 7-d memo-less prune or
   live on with the memo; a held reservation on a dead session is inert.)

There is deliberately NO per-provider-request counter on the session row
(Codex #4: `volumeRequests += 1` before a cache-only call measures nothing) —
request counts and cost roll up from the request rows when wanted.

## 9. Dashboard card — `components/clients/KeywordStrategyCard.tsx`

Slots immediately after `KeywordProfileCard` on `/clients/[id]` (the page's
`Promise.all` gains the latest-session read). Client component, KS-3/KS-1 card
conventions (dark-mode variants, mutation-then-refetch):

- **Latest memo**: when the latest session has `memoMarkdown`, render it
  (reuse the `KeywordMemoMarkdown` renderer) with `memoUpdatedAt`.
- **"Generate strategy prompt"** button → mint POST → clipboard payload →
  poll via the existing `memo-poller-machine` (3s / 15-min window anchored to
  `tokenMintedAt` — the machine is reused as-is) against the cookie-gated
  `GET /api/clients/[id]/keyword-strategy`, watching `memoUpdatedAt`.
- Readiness hints, not gates: the card notes missing inputs ("No GSC mapping",
  "No live scan yet", "No locale set") but minting is never blocked by them —
  matching §7's degrade-to-absent posture. Archived client → button disabled
  (server 409s anyway).

Clipboard payload (`lib/keyword-strategy-prompt.ts`):

```
Generate a keyword strategy document for this client.

Webapp: <NEXT_PUBLIC_APP_URL>
Strategy ID: <strategyId>
Access token: kst_<jwt>
(Expires in 1h)

Fetch the keyword strategy export, write the keyword strategy document, and post it back to the dashboard.
```

Routing needs no label tricks: the `kst_` prefix is the discriminator, exactly
like every other family (Codex #1). Server-side audience/sub binding
fail-closes any residual mismatch.

## 10. Skill side (external to this repo — **a release prerequisite, not a
follow-up**)

Plan-Codex #6: the dashboard card exposes a `kst_` clipboard prompt the moment
it deploys — if the skill doesn't recognize `kst_` yet, the visible workflow
is broken. **The skill routing/template work below completes BEFORE the app
deploy** (the repo PR can merge first; deploy waits on the skill).

`~/.claude/skills/er-handoff-memo` changes (versioned with the skill):

1. **Routing**: SKILL.md's family table gains a `kst_` row (Keyword Strategy /
   `Strategy ID:` / 8-section strategy doc / volumes capability). The krt_ row
   is untouched. Skill-side acceptance tests (Codex verify item): legacy krt_
   memo prompt routes to the memo flow, kst_ prompt routes to the strategy
   flow, a payload with a missing or conflicting ID label is rejected with a
   re-copy ask.
2. **`scripts/handoff.py`**: a `kst_` ROUTES entry
   (`GET /api/keyword-strategy/{id}`, `PATCH …/memo`, field `memo`) plus a
   `volumes` subcommand (`POST …/volumes`, `--keywords` JSON list) that
   **generates a UUID idempotency key per logical call and reuses it on
   retry** (§8), with the same error taxonomy
   (WAF/egress/app-gate/token_*/`duplicate_request`/`volume_budget_exhausted`).
3. **New template** `templates/keyword_strategy_structure.md`: Kevin's
   8-section schema (§1 overview / §2 gaps / §3 wins / §4 recommendations /
   §5 100 targets w/ volume+intent / §6 SEMRush import list / §7 article
   topics screened against the inventory / §8 FAQ recommendations restricted
   to `not-detected` pages with the Q7 hedged phrasing). Volume step: generate
   candidates → `handoff.py volumes` → fold returned volumes into §5; respect
   `volumeLookup.enabled:false` by writing §5 without volumes and saying so.
4. **The 4 reference docs** (program categories, BOFU patterns, intent
   definitions, compliance exclusions) move into `references/`. **They exist
   only in Kevin's Claude project** — not in this repo or the skill. This is
   a **Kevin-provides step**: the app+skill work ships without them, and the
   skill falls back to asking (its existing "When to Ask" behavior) until
   they land.

## 11. Config & flags

| Env | Default | Meaning |
|---|---|---|
| `VOLUME_SESSION_KEYWORD_CAP` | `1500` | Stamped onto each session at mint |
| `VOLUME_MONTHLY_KEYWORD_CEILING` | `25000` | Advisory monthly aggregate ceiling |

Neither is required-in-prod (defaults apply; no boot check, no `.env` step).
No new secret: the token family reuses `KEYWORD_MEMO_TOKEN_SECRET`.

## 12. Testing

- **Token module**: mint/verify round-trip; sub binding; expiry; **cross-family
  isolation both directions** (krt_ memo token rejected by strategy verify —
  prefix AND audience; kst_ token rejected by memo verify); scope list content.
- **Mint route**: 404 unknown client; 409 archived; refresh failure still
  mints (`gscRefreshed:false`); row created with stamped cap; **mint-throw
  cleans up the orphan row** (Codex #6); response shape.
- **Export route**: auth matrix (missing/malformed/expired/wrong-sub/legacy
  krt_ token → 401s; wrong scope → `token_missing_scope`); full assembly with
  all five blocks; each degraded case independently (no GSC mapping / no
  live-scan run / no semrush session / pruned semrush blob / empty roster);
  inventory equals `buildPageInventory` output including the programEntityUrls
  upgrade; findings filtered to exactly the shared type constants; semrush
  tie-break deterministic; `volumeLookup.enabled` mirrors the env gate.
- **Volumes route**: scope + audience enforcement (a legacy krt_ token 401s);
  missing/duplicate `idempotencyKey` (409 `duplicate_request`, no
  double-reserve — assert `volumeKeywordsUsed` unchanged); body caps (301
  keywords → 400; an 81-char keyword is **route-filtered into `skipped` and
  excluded from the reservation** — Codex #5's one-contract rule); locale
  fixed server-side (body locale ignored; unset profile → 409); dark gate →
  409 `volume_disabled` before any reservation; **ledger**: reserve boundary
  (cap−n exactly fits, cap−n+1 refused with used/cap), settle refunds cache
  hits (`retained = fetched`), **partial failure retains fetched work**
  (ok:false with accounting → refund only the unfetched share — Codex #3),
  thrown call → `unresolved`, zero refund, double-settle no-ops (state
  fence), floor guard; **monthly ceiling**: `used + n > ceiling` rejected at
  the boundary (Codex #4 math), aggregation keys on request-row `createdAt`
  crossing a month boundary, `settledKeywords` preferred over `keywordCount`;
  concurrent reserves respect the cap (interleaved conditional txns —
  DB-backed test).
- **Middleware**: three public-true cases + two gated-false cases (§6).
- **Card**: renders memo, mint→clipboard flow, poller refresh on
  `memoUpdatedAt` change, readiness hints, archived-disabled. (vitest gotchas:
  `afterEach(cleanup)`, `act()` under fake timers, `getAllBy*` for repeated
  copy.)
- **Retention**: memo-less sessions with `tokenMintedAt < now − 7 d` pruned,
  memo-bearing kept; stale `reserved` requests > 24 h flipped to `unresolved`
  without refund.

Gates: `npx tsc --noEmit` + `DATABASE_URL="file:./local-dev.db" npm test` +
`npm run build`.

## 13. Kevin should verify (Codex hand-offs)

- **DataForSEO billing on timeout**: can a timed-out request still bill? The
  conservative `unresolved` hold assumes yes; if provably no, the sweeper
  could refund instead. Not blocking — the default is the safe direction.
- The §3 defaults (spend envelope, kst_ prefix, refresh-on-mint, FAQ
  phrasing) ship as written unless he overrides.

## 14. Out of scope / deferred

- KS-6 (DataForSEO Labs SEMRush retirement, 1-h contentText export).
- Volume pre-enrichment of the export's GSC set (spend-on-every-mint; the
  endpoint covers the need on demand).
- Abort-signal threading through `getKeywordVolumes` (single-chunk requests
  are self-limiting; revisit if per-request caps ever grow past one chunk).
- Any change to the legacy krt_ session-bound flow, the SEMRush CSV parsers,
  or `selectRuns`/canonical-score selection.
- Competitor-URL analysis, CRM data, E-E-A-T/GEO checks (C14 FUTURE notes).
- A strategy-session history UI (the card shows the latest; rows are queryable
  if a history view is ever wanted).
