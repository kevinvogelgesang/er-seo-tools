# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-11 (**A7 (auth & testing hardening) — COMPLETE**: all 3
PRs shipped. PR1 login rate-limiting (#155, prod-verified), PR2 per-worker vitest
DBs (#156), PR3 Playwright smoke + default-off SSRF allowlist (#157, prod-verified).
A7 → `[x]`. Next: **roadmap menu**.) · **Updated by:** the A7 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: A7 (auth & testing
hardening) — COMPLETE, all three sequential PRs shipped, gate-green, and (for the
two runtime PRs) deployed + prod-verified. A7 → [x].
- PR1 (#155, 9740478, prod-verified): login rate-limiting on the break-glass
  password POST — lib/rate-limit.ts (generic in-memory fixed-window limiter) +
  lib/login-rate-limiter.ts (module-scope singleton; extracted out of route.ts
  because a Next App Router route.ts may only export handlers + config symbols) +
  the route wiring (throttle per getClientIp after the ALLOW_PASSWORD_LOGIN
  short-circuit, before verifyPassword; reset on success) + login-page copy.
  Dormant-but-correct in prod (OAuth-only → password path short-circuits above
  the limiter); activates if break-glass is ever re-enabled.
- PR2 (#156, d87036a, test-infra/no deploy): per-worker vitest SQLite DBs
  (globalSetup migrated template DB → per-worker file copy, DATABASE_URL set in a
  setupFiles entry before any app import) restored fileParallelism — 4596 tests
  now run ~36s vs ~115s serial (~3.2x).
- PR3 (#157, 4a03c82, prod-verified): Playwright happy-path smoke (login → SF
  upload → parse → report → single-page ADA audit → complete) as a LOCAL
  pre-merge gate (npm run smoke; NOT deploy-script, NOT CI) + a default-off
  exact-loopback SSRF allowlist in lib/security/safe-url.ts (Kevin-signed-off,
  opus-security-reviewed: boundary holds). SMOKE_LOOPBACK_TARGET is unset in prod
  → allowlist inert (verified). Spec+plan archived.

NEXT ITEM: roadmap menu — pick one (or take Kevin's steer):
- SF-retirement parity cycles (er-seo-tools-sf-retirement-campaign skill).
- Track A infra: A5 shared status hook/SSE (replace polling with push) — unblocks
  D2. (A6 was absorbed into A8, which is done. A7 is now done.)
- Track D remaining (D1 handoff-engine consolidation, D3 lib/seo-fetch, D4/D5
  robots/sitemap monitoring, D6 RankMath redirect generator — check the tracker;
  D2 needs A5).
- C12 D2 (recall-first claim-sentence filter + a MEASURED recall eval on labeled
  real client pages) — the deferred optimization on the cat_ bridge; or C12
  Tier-2 AI data-correctness (GATED OFF — Kevin decision to reopen).
All start: brainstorm → spec → Codex → plan → Codex → build, rule 4 ungated.

A7 NON-BLOCKING FOLLOW-UP (Minor, fail-safe — do NOT treat as urgent):
- The instrumentation.ts smoke boot guard omits the pathname check that
  safe-url.ts's parseLoopbackAuthority enforces. This makes the guard only MORE
  permissive in the fail-SAFE direction (it can let a boot proceed while the
  allowlist itself stays inactive) — no security impact. May align for clarity if
  ever back in that file.

GOTCHAS FOR THE NEXT SESSION:
- A Next App Router route.ts may ONLY export HTTP handlers + known config symbols
  (dynamic, revalidate, …). Put test-reset seams / shared singletons in a sibling
  lib module (see lib/login-rate-limiter.ts) — an extra named export on route.ts
  fails the generated .next/types/**/route.ts tsc check (our lint gate), invisible
  until tsc runs.
- Tests now self-provision a per-worker SQLite DB (PR2). `npm test` runs PARALLEL
  (pool:'forks', minForks:1/maxForks:4); the old `DATABASE_URL="file:./local-dev.db"
  npm test` prefix still works but is now a harmless no-op (setup-worker.ts
  overrides DATABASE_URL). `.test-dbs/` is gitignored + rebuilt each run.
- Prisma resolves relative sqlite file: URLs against the SCHEMA dir (prisma/), not
  repo root — use ABSOLUTE file: paths for test/tooling DBs.
- Local gates are the ONLY type-check gate (in-build tsc/eslint disabled since the
  2026-07-11 OOM fix). npx tsc --noEmit + npm test + npm run build, all green,
  before EVERY merge. For PRs touching auth / SF upload-parse / the ADA audit
  pipeline, ALSO run `npm run smoke` (macOS: export CHROME_EXECUTABLE first).
- DateTime columns are stored INTEGER ms; any raw-SQL DateTime comparison binds
  ${x.getTime()}, never a bare Date.
- er-handoff-memo skill lives INSIDE this repo (skills/er-handoff-memo, symlinked
  to ~/.claude/skills). Never git add -A/-u at repo root (pentest-results/ +
  .playwright-mcp/ deletions + SEO_Report_1st_Draft.pdf + googlefc*.html are
  untracked/pre-existing) — stage explicit paths.
- Component tests: NO jest-dom → // @vitest-environment jsdom + afterEach(cleanup)
  + getByRole/getAllByText + .toBeTruthy()/.getAttribute().
- Migrations: hand-author SQL (migrate dev is interactive-only), apply with
  DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate.
- sqlite3 is NOT on the server — verify prod schema via a read-only Prisma probe.
- COMMIT MESSAGES: no backticks in -m strings via the Bash tool (shell command
  substitution).

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow. (DataForSEO is a DATA API. The LOCAL MiniLM embedding model is
on-box, zero network — not an AI API.)

FIRST STEP — confirm main clean + prod healthy (git log origin/main; ssh
seo@144.126.213.242 "curl -s localhost:3000/api/health"). Then take Kevin's steer
on the roadmap menu (or brainstorm the chosen item).

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): standing
authorization to merge gate-green roadmap PRs (re-run gates in-session) + deploy
with post-deploy verify; destructive server ops Kevin-gated; spec→plan ungated
(Codex each artifact, notify Kevin one line + path, don't wait). Docs ritual in
the same commit as any ship.
```

---

## Current state (2026-07-11, post-A7)

- **Main** @ `4a03c82` (PR #157 merge) + this finalize commit. **Prod on
  `4a03c82`** (PR3 deployed — runtime touched `safe-url.ts` + `instrumentation.ts`);
  clean boot (`✓ Ready in 640ms`), health ok, no "SMOKE MODE" startup line
  (`SMOKE_LOOPBACK_TARGET` unset → allowlist inert), no boot refusal, restart
  count stable.
- **A7 → `[x]` COMPLETE.** All three PRs shipped; runtime PRs deployed +
  prod-verified. Spec/plan archived under `docs/superpowers/archive/`.
- **C12 `[~]`:** Tier-0 (A+B) + Tier-1 (MiniLM topic-overlap) + D1 (`cat_` bridge)
  shipped. Tier-2 AI data-correctness = future scope, OFF per the no-AI-API gate.
  D2 (claim filter + recall eval) + D3 (incremental exports) deferred.
- **C20 `[x]`:** KS-1..5 MVP complete. Volume endpoint dark until DataForSEO creds
  land in prod `.env` (Kevin).
- **Kevin manual checks:** canonical tracker =
  `todos/2026-07-11-kevin-manual-checks-tracker.md` (TopicOverlap +
  ContentAuditCard + cat_ end-to-end run + KS-5 items + C14–C19/A8 eyeballs).
  Sessions tick + log there.

## The single next item

**Roadmap menu** — nothing is pre-committed after A7. Candidates: SF-retirement
parity cycles, A5 (status hook/SSE), Track D remaining, C12 D2 (claim filter +
recall eval), or Kevin's steer. Each starts brainstorm → spec → Codex → plan →
Codex → build (rule 4 ungated).

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — authoritative this cycle
(route.ts-export restriction → sibling lib module; tests self-provision per-worker
DBs & run parallel; Prisma schema-relative SQLite URLs → absolute paths;
local-gates-only + `npm run smoke` for auth/upload/audit PRs; integer-ms DateTime
raw binds; in-repo skill + pre-existing untracked clutter → explicit staging;
no-jest-dom component convention; hand-authored migrations; no backticks in Bash
`-m` commit messages).

## C12 D1 follow-ups (still non-blocking)

- I2 (Low): a manual `npx tsx scripts/findings-rebuild.ts <id>` on a run-bearing
  audit would wipe an ingested `contentAuditJson`. Unreachable in normal flow;
  flag if any D-series work adds AUTOMATED rebuilds of run-bearing audits.
- Retention canary: observe retained-`HarvestedPageSeo` count + DB-size delta +
  `sweepExpiredContentAudit` duration over a busy 2-hour window.
