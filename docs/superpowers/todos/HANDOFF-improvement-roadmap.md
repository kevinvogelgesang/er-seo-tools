# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-10 (KS-1 shipped; **KS-2 spec + plan Codex-reviewed** — spec ×5,
plan ×6, applied. Next: KS-2 TDD build.) · **Updated by:** the KS-1/KS-2 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: C20/KS-1 (GSC query×page
keyword snapshot) SHIPPED — PR #146 merged (40b6a45), deployed + prod-verified 2026-07-10
(migration 20260710150000_gsc_snapshot applied, GscSnapshot table live, route 401-gated,
clean boot, 4196 tests / 475 files green). New lib/keywords/ module + fetchGscQueryPage
provider + GET/POST /api/clients/[id]/gsc-snapshot + GscKeywordCard on the client
dashboard + keep-latest-3 retention. Spec/plan archived. C20 stays [~] (KS-1 of 5 MVP
increments done).

NEXT ITEM: KS-2 TDD BUILD, branch feat/ks2-volume-provider, from plan
docs/superpowers/plans/2026-07-10-ks2-dataforseo-volume-provider.md (Codex ×6 applied;
spec docs/superpowers/specs/2026-07-10-ks2-dataforseo-volume-provider-design.md, Codex
×5 applied). 7 tasks in order: 1 schema KeywordVolumeCache + hand-authored migration
20260710200000_keyword_volume_cache (unique [keyword,locationCode,languageCode,
providerVersion], resultStatus column, NO FKs) · 2 volume-config env gate
(DATAFORSEO_LOGIN/PASSWORD read at CALL time; empty string = unset) + SHARED
volume-normalize.ts (normalizeKeyword + normalizeLocale; EN≡en) · 3 volume-throttle
(module-scoped rolling 12/60s; entry recorded at grant; re-check clock after wake;
tail recovers from rejected sleeps; injected now/sleep, NO vi.useFakeTimers) · 4
dataforseo-client transport (POST /v3/keywords_data/google_ads/search_volume/live,
Basic auth built in-call, ≤200-char sanitized messages; per-request-key outcomes
returned|not_returned — spell/similar items NEVER remapped; empty result array = all
not_returned ok; missing/null result = unparseable_response; (year,month)-sort then
12-month slice; ok carries task cost verbatim; abort-aware timeout mock in tests,
never a real 30s wait) · 5 volume.ts service (disabled gate → normalizeLocale →
dedupe first-seen order → validate → cache read in ≤500-key IN batches → chunk ≤1000
cap 3 → attemptedChunks++ BEFORE transport → throttle.acquire per chunk → per-key
upsert (never negative-cache unparseable chunks) → providerCost accumulation →
accounting {fromCache,fetched,skipped,attemptedChunks,successfulChunks,providerCost}
on OK AND ERROR results; output first-seen order; PREFIX ks2test- hygiene beforeAll+
afterAll) · 6 retention pruneKeywordVolumeCache 30-d in runCleanup · 7 gates → PR →
merge → deploy → prod-verify (dark posture: clean boot with zero volume-module
output; read-only Prisma probe of the new table) → ritual + archive. NOTHING calls
the service in production — ships dark, tests are the only exerciser (KS-5 consumes).

AFTER KS-2: KS-3 (client institution profile + structured program roster + locale
codes) · KS-4 (FAQ tri-state + page inventory; parse-seo-dom is string-injected —
SWC-helper-free, no typeof) · KS-5 (krt_-v2 client-scoped export + billable
volume-lookup endpoint + er-handoff-memo skill upgrade). MVP = KS-1..5.
Kevin §5 decisions (spend envelope, roster UX, token family, SEMRush role, profile
shape, GSC cadence, FAQ phrasing) — none block KS-2/KS-3 spec work; ask only if he
engages.

READ FIRST: the umbrella doc's KS-2 section + the tracker's top status-log entry
(2026-07-10 KS-1 shipped). Trust ranking: code > plan/spec > tracker/handoff.

Kevin eyeballs outstanding (authed-UI): NEW — GscKeywordCard on a GSC-mapped client
dashboard (hit Refresh once; first snapshot populates the card) · C15 Mine-filter ·
C16 Audits page · C17 seoOnly auto-flip · C18 results tabs · C14 /sales + real
/sales/[token] report · re-scan Bellus (v4 badge + deduction invoice; expect ≈68) ·
post-C19: /settings SEO card + ADA card + /score-lab · post-A8-PR7: /clients fleet +
client dashboard (weightsHash suppression on first real ScoringWeights save — observe
only).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/qct_ clipboard flow.
(DataForSEO is a DATA API, not an AI API — access confirmed by Kevin 2026-07-10;
it does not touch this gate.)

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health").

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): standing
authorization to merge gate-green roadmap PRs (re-run gates in-session) + deploy with
post-deploy verify; destructive server ops Kevin-gated; spec→plan ungated (Codex each
artifact, notify Kevin one line + path, don't wait). Docs ritual in the same commit as
any ship. ⚠ KS-2 adds env vars — DATAFORSEO_LOGIN/PASSWORD are OPTIONAL (dark
feature), so no server .env prerequisite for deploy; but when Kevin wants it live,
the server .env edit is HIS (rule 1 carve-out).

ENV NOTE: gates = npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm
run build. Migrations: hand-author SQL (migrate dev is interactive-only here), apply
with DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate;
SQLite: no ALTER COLUMN nullability (PRAGMA rebuild). Never git add -A. Test gotchas:
vitest globals:false → add afterEach(cleanup) to component tests rendering repeated
text; act() not waitFor under fake timers; getAllBy* for repeated copy; route files
export only handlers+config.
⚠ DEPLOY RECIPE: git push && ssh seo@144.126.213.242 "pm2 stop seo-tools && ~/deploy.sh"
then verify .next/BUILD_ID + health + boot log.
```

---

## Current state (2026-07-10, post-KS-1-ship)

- **Main** @ `40b6a45` (PR #146 merge) + this ritual commit. **Prod on `40b6a45`**,
  deployed + verified 2026-07-10 (fresh BUILD_ID, health ok, migration applied —
  GscSnapshot table probed read-only, 0 rows until first refresh, 0 unstable restarts).
- **C20 `[~]`** — KS-1 SHIPPED (1 of 5 MVP increments). Umbrella Codex ×7 · KS-1 spec
  Codex ×7 · KS-1 plan Codex ×4 · build: 7 tasks + 1 Critical fix loop (unhandled
  rejection on the single-flight cleanup's derived promise — crash-class, caught in
  per-task review) + 1 withRoute correction; final opus review 0 Critical/Important.
- **What KS-1 gives the next increments:** `lib/keywords/types.ts` summary types are
  designed to embed in KS-5's export verbatim; the snapshot's derived signals
  (wins/opportunities/quickWins/cannibalization) are the §2/§3/§4 memo inputs;
  `GscKeywordCard` is the dashboard surface KS-5's "mint memo" action will sit beside.
- **KS-2 spec + plan done (2026-07-10, same session):** spec Codex ×5, plan Codex ×6,
  all applied; DataForSEO facts researched live (Google Ads search_volume/live,
  $0.09/request ≤1000 keywords, 12 req/min, location_code ints, status 20000; Labs
  rejected for KS-2). Committed `559a1df` + `f0edbbf`.
- All other tracker state unchanged.

## The single next item

**KS-2 TDD build** — `../plans/2026-07-10-ks2-dataforseo-volume-provider.md` (7 tasks,
exact test assertions + commit commands inline). Branch `feat/ks2-volume-provider`.
Additive migration; NEW OPTIONAL env vars (dark — no `.env` prerequisite to deploy);
no routes/middleware/UI; nothing calls the service until KS-5.

## Gotchas for the next session

- DataForSEO facts (pricing, endpoints, location codes, rate limits) MUST be verified
  at spec time — the umbrella records this as Codex #1's explicit hedge; never spec
  from memory.
- `lib/keywords/gsc-snapshot.ts` single-flight: the derived `.finally()` chain carries
  its own no-op `.catch` — do not "simplify" it away (unhandled rejection = process
  crash; regression test pins it).
- Derive-layer semantics are contractual (raw-decimal bands, observed-impressions
  denominator, unclamped coverage) — KS-5's export must consume them as-is, not
  re-derive with different rules.
- `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf`
  untracked at repo root — NEVER `git add -A`.
- vitest `globals:false` → explicit `afterEach(cleanup)` in component tests.
- Every new public/token route: middleware `isPublicPath` + `middleware.test.ts` case
  (bit prod 3×). KS-2 adds NO routes; KS-5's volume-lookup needs exactly one anchored
  regex.
- Array-form `$transaction([...])` only; KS-5's usage ledger = conditional update /
  EXISTS predicate, never interactive.
- Codex consults: er-seo-tools session at turn ~54, healthy; budget-check before calls.
- Prod deploy uses the interim OOM recipe (`pm2 stop seo-tools && ~/deploy.sh`).
- A stale `running` example.com SiteAudit can linger in local-dev.db from DB-backed
  test runs — recovery drains it on next dev boot; harmless.
