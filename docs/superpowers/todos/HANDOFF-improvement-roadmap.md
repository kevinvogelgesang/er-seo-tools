# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-11 (**A7 PR1 (login rate-limiting) SHIPPED+DEPLOYED+
PROD-VERIFIED (PR #155/`9740478`); A7 PR2 (per-worker vitest DBs) SHIPPED (PR
#156/`d87036a`, test-infra/no deploy).** A7 stays `[~]`. Next: **A7 PR3 —
Playwright smoke — NEEDS KEVIN SSRF SIGN-OFF**.) · **Updated by:** the A7-PR1/PR2 session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. LAST COMPLETED: A7 PR2 (per-worker
vitest DBs) — SHIPPED (PR #156, merge d87036a; test-infra, no deploy needed).
A7 PR1 (login rate-limiting) shipped+deployed+prod-verified earlier (PR #155,
9740478). A7 stays [~]. A7 was scoped with Kevin into THREE sequential,
independently gate-green PRs:
- PR1 (DONE): login rate-limiting on the break-glass password POST.
- PR2 (DONE): per-worker vitest SQLite DBs restored fileParallelism (4588 tests
  ~36s vs ~115s serial, ~3.2x). Test-infra only — zero runtime surface.
- PR3 (NEXT — NEEDS KEVIN SSRF SIGN-OFF before Task 3.1): one Playwright smoke
  suite as a LOCAL pre-merge gate.
THE REMAINING WORK IS PR3 ONLY. Before building Task 3.1, get Kevin's explicit
sign-off on the SSRF approach (spec §5.1b) — it modifies lib/security/safe-url.ts,
a never-weaken file. If Kevin declines, use the fallback: drop the ADA-audit leg
(login->upload->parse->report only) and skip Task 3.1 (no safe-url change).
Auth hardening was narrowed to login rate-limiting ONLY — OAuth domain-restriction
+ per-operator attribution already shipped in the pentest work. Spec + plan for
all three PRs are written and Codex-reviewed (accept-with-fixes ×6 / ×7, applied):
  spec: docs/superpowers/specs/2026-07-11-a7-auth-testing-hardening-design.md
  plan: docs/superpowers/plans/2026-07-11-a7-auth-testing-hardening.md

WHAT SHIPPED IN PR1:
- lib/rate-limit.ts — generic in-memory fixed-window limiter (injectable clock,
  >= window boundary so a boundary hit never returns Retry-After:0 while blocked,
  bounded Map with a prune that never evicts the key under evaluation, invalid-
  config coercion to safe defaults). Correct for this single fork-mode/SQLite/
  no-Redis stack.
- lib/login-rate-limiter.ts — module-scope singleton wrapping it. EXTRACTED OUT
  of route.ts because a Next App Router route.ts may ONLY export HTTP handlers +
  known config symbols (dynamic, revalidate, …); a test-reset export there fails
  the generated .next/types/**/route.ts tsc check even though it's fine at
  runtime. Mirrors lib/ops/health-summary.ts's __resetHealthSummaryCache.
- app/api/auth/login/route.ts — throttle per getClientIp (cf-connecting-ip;
  Cloudflare is the trusted front) AFTER the ALLOW_PASSWORD_LOGIN=false short-
  circuit and BEFORE verifyPassword; block → 303 /login?error=too_many_attempts
  + Retry-After; successful login resets the IP counter.
- login page renders the too_many_attempts message (shared ERROR_MESSAGES record,
  dark-mode inherited).
- Defaults 10 failures / 15 min, env-tunable (LOGIN_RATE_LIMIT_MAX /
  LOGIN_RATE_LIMIT_WINDOW_MS). NO new required-in-prod env var.

PROD NOTE: the throttle is DORMANT-BUT-CORRECT in prod — prod runs
ALLOW_PASSWORD_LOGIN=false (OAuth-only), so the short-circuit returns
password_login_disabled ABOVE the limiter (this confirmed the ordering invariant
in prod). The limiter activates only if break-glass password login is ever
re-enabled. Nothing to brute-force = nothing to throttle; safest posture.

PR2 — per-worker vitest DBs (SHIPPED PR #156 — reference for how the harness works):
- globalSetup builds ONE migrated template DB at an ABSOLUTE file: path (Prisma
  resolves relative SQLite URLs against prisma/, NOT repo root — that's why the
  dev DB is prisma/local-dev.db). Assert the migrate subprocess left NO
  template -wal/-shm (checkpointed single file); do NOT copy WAL sidecars.
- A setupFiles entry copies template.db → .test-dbs/worker-${VITEST_WORKER_ID}.db
  (idempotent: only if absent; never overwrite an open DB) and sets
  process.env.DATABASE_URL BEFORE any app import. That file MUST NOT transitively
  import lib/db.ts (raw node builtins only) or the Prisma singleton binds the
  wrong URL.
- vitest.config.mts: remove fileParallelism:false; pin pool:'forks' +
  poolOptions.forks.maxForks:4; add globalSetup + setupFiles; exclude .test-dbs/**.
- Binding canary test: PRAGMA database_list asserts the active file contains
  worker-<id>.db. Type rows as {seq,name,file}.
- Shared-resource audit (Codex): per-worker DBs isolate DB state ONLY — grep the
  suite for fixed fs paths (UPLOADS_DIR/REPORTS_DIR/local-uploads) + bound ports;
  isolate any per worker (describe.sequential does NOT stop cross-file
  concurrency — it only serializes within one file). Acceptance = FULL suite green
  under parallelism (baseline 4587 tests / 519 files, ~115s serialized) + record
  wall-clock delta.

PR3 — Playwright smoke (NEEDS KEVIN SSRF SIGN-OFF before Task 3.1):
- The single-page ADA audit leg targets a LOCAL loopback fixture server, but
  lib/security/safe-url.ts (a NEVER-WEAKEN file) rejects loopback before the
  audit runs. Resolution: a default-OFF exact-loopback allowlist keyed on
  SMOKE_LOOPBACK_TARGET, honored ONLY in smoke mode (SMOKE_MODE=true AND a
  loopback NEXT_PUBLIC_APP_URL AND an exact loopback host:port with explicit
  port). instrumentation.ts FAIL-CLOSES: in production it refuses to boot if
  SMOKE_LOOPBACK_TARGET is set outside that exact smoke combination — so a real
  RunCloud deploy (public base URL) can never widen SSRF. Additive, byte-
  identical when unset, new safe-url.test.ts coverage. Fallback if Kevin declines
  touching safe-url.ts: drop the ADA-audit leg (login→upload→parse→report only).
- next start = PRODUCTION mode → the smoke webServer env must include the full
  required-in-prod set or the boot fail-fasts: PILLAR_TOKEN_SECRET, APP_AUTH_SECRET
  (+ APP_AUTH_PASSWORD + ALLOW_PASSWORD_LOGIN=true), CHROMIUM_NETWORK_ISOLATED=true,
  CHROME_EXECUTABLE (set per host — Linux default won't work on a macOS
  workstation), NEXT_PUBLIC_APP_URL at BUILD time (compile-time inlined), dedicated
  UPLOADS_DIR/REPORTS_DIR + smoke DB.
- Verified UI locators (Codex): single-page URL input is #audit-url (type="text",
  NOT name/type=url); SF upload = components/seo-parser/SeoUploadCard.tsx →
  FileDropzone (hidden input[type=file]); tabs/scan-type in AuditIndexTabs.tsx /
  SiteAuditForm.tsx.
- npm run smoke = a LOCAL pre-merge gate documented in er-seo-tools-change-control;
  NOT wired into ~/deploy.sh (prod OOM) and NOT CI.

Each PR: TDD build → gates (tsc + DATABASE_URL="file:./local-dev.db" npm test +
build) → whole-branch review → merge (rule 1, gate-green) → deploy + prod-verify →
docs ritual (tracker + this handoff, same commit). On A7 completion move spec+plan
to docs/superpowers/archive/. Progress ledger: .superpowers/sdd/progress.md.

GOTCHAS FOR THE NEXT SESSION:
- NEW (PR1): a Next App Router route.ts may only export HTTP handlers + known
  config symbols. Put test-reset seams / shared singletons in a sibling lib module
  (see lib/login-rate-limiter.ts) — an extra named export on route.ts fails the
  generated .next/types tsc check (our lint gate), invisible until tsc runs.
- Local gates are the ONLY type-check gate (in-build tsc/eslint disabled since the
  2026-07-11 OOM fix). npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm
  test + npm run build, all green, before EVERY merge — no exceptions.
- Prisma resolves relative SQLite file: URLs against the SCHEMA dir (prisma/), not
  repo root. Use absolute file: paths for the per-worker test DBs (PR2).
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
seo@144.126.213.242 "curl -s localhost:3000/api/health"). Then GET KEVIN'S SSRF
SIGN-OFF for PR3 (spec §5.1b) before building; on sign-off, branch
feat/a7-pr3-playwright-smoke from main and build PR3 from the plan. On PR3 ship,
A7 -> [x] and move spec+plan to docs/superpowers/archive/.

Load skill er-seo-tools-change-control FIRST. Gate policy (rules 1 & 4): standing
authorization to merge gate-green roadmap PRs (re-run gates in-session) + deploy
with post-deploy verify; destructive server ops Kevin-gated; spec→plan ungated
(Codex each artifact, notify Kevin one line + path, don't wait). Docs ritual in
the same commit as any ship.
```

---

## Current state (2026-07-11, post-A7-PR2)

- **Main** @ `d87036a` (PR #156 merge) + this finalize commit. **Prod on the PR1
  state (`9740478`)** — PR2 is test-infra with zero runtime surface, so it was
  NOT deployed (rides a future deploy; functionally identical prod). Prod health
  ok, login endpoint verified (303; OAuth-only → password path short-circuits
  above the dormant limiter).
- **A7 → `[~]`:** PR1 (login rate-limiting) shipped+deployed+prod-verified; PR2
  (per-worker vitest DBs, 4588 tests ~36s vs ~115s serial) shipped. **PR3
  (Playwright smoke) is the single remaining item — gated on Kevin's SSRF
  sign-off (spec §5.1b).** Spec + plan cover all three and are Codex-reviewed
  (×6/×7).
- **C12 `[~]`:** Tier-0 (A+B) + Tier-1 (MiniLM topic-overlap) + D1 (`cat_` bridge)
  shipped. Tier-2 AI data-correctness = future scope, OFF per the no-AI-API gate.
  D2 (claim filter + recall eval) + D3 (incremental exports) deferred.
- **C20 `[x]`:** KS-1..5 MVP complete. Volume endpoint dark until DataForSEO creds
  land in prod `.env` (Kevin).
- **Kevin manual checks:** canonical tracker =
  `todos/2026-07-11-kevin-manual-checks-tracker.md` (TopicOverlap + ContentAuditCard
  + cat_ end-to-end run + KS-5 items + C14–C19/A8 eyeballs). Sessions tick + log
  there.

## The single next item

**A7 PR3 — Playwright smoke suite (local pre-merge gate).** GATED: get Kevin's
explicit SSRF sign-off (spec §5.1b — the default-off exact-loopback allowlist in
`lib/security/safe-url.ts`, a never-weaken file) BEFORE building Task 3.1. On
sign-off, branch `feat/a7-pr3-playwright-smoke` from `main` and build from the
plan's PR3 section. Fallback if Kevin declines the safe-url change: drop the
ADA-audit leg (login→upload→parse→report only), skip Task 3.1. On PR3 ship, A7 →
`[x]` and `git mv` spec+plan to `docs/superpowers/archive/`.

## Gotchas for the next session

See the paste-in prompt's GOTCHAS block above — authoritative this cycle
(route.ts-export restriction → sibling lib module; local-gates-only; Prisma
schema-relative SQLite URLs → absolute test-DB paths; integer-ms DateTime raw
binds; in-repo skill + pre-existing uncommitted clutter → explicit staging;
no-jest-dom component convention; hand-authored migrations; no backticks in Bash
`-m` commit messages).

## C12 D1 follow-ups (still non-blocking)

- I2 (Low): a manual `npx tsx scripts/findings-rebuild.ts <id>` on a run-bearing
  audit would wipe an ingested `contentAuditJson`. Unreachable in normal flow;
  flag if any D-series work adds AUTOMATED rebuilds of run-bearing audits.
- Retention canary: observe retained-`HarvestedPageSeo` count + DB-size delta +
  `sweepExpiredContentAudit` duration over a busy 2-hour window (tuning gate for
  `CONTENT_AUDIT_BASE_TTL_MS`, not a ship blocker).
