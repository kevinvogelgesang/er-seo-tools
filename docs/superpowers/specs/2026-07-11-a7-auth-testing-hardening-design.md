# A7 — Auth & Testing Hardening (Design)

**Status:** Draft (brainstormed 2026-07-11)
**Roadmap item:** A7 (Track A infra, "1 wk, lowest urgency")
**Tracker:** `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` line 79
**Author:** Claude (session 2026-07-11), scoped with Kevin

## 1. Context & problem

The June 2026 roadmap (`docs/superpowers/nyi/improvement-roadmaps/06-platform.md` §7)
scoped A7 as three loosely-coupled deliverables:

1. **Auth:** keep the single-password model, add per-operator audit attribution,
   **rate-limit login**.
2. **Tests:** per-worker SQLite files to restore vitest parallelism.
3. **One Playwright smoke suite** (login → upload → parse → report; single-page
   audit → complete) wired in as a pre-push gate.

Since that doc was written, the pentest-era work **already shipped** most of the
auth intent: Google OAuth with hosted-domain restriction + a signed HMAC v2
session cookie (`lib/auth.ts`), and per-operator attribution
(`getOperatorLabel`, the `er-operator-name` cookie, `requestedBy` on audits).

**What is genuinely still open:**

- **Login rate-limiting.** `POST /api/auth/login` (`app/api/auth/login/route.ts`)
  verifies the break-glass shared password with **no throttle** — an online
  brute-force of a single shared secret is unbounded.
- **vitest parallelism.** `vitest.config.mts` forces `fileParallelism: false`
  because all test files share the one dev SQLite DB and the `AuditBatch` partial
  unique index (`audit_batches_one_open`) collides under concurrent open-batch
  writes. 3358 tests / 368 files run fully serialized.
- **No end-to-end smoke.** Nothing exercises the real login → upload → parse →
  report and single-page-audit → complete flow through a browser; every incident
  class this repo has hit (minification, PM2 OOM, reverse proxy, build heap) is
  invisible to unit tests.

**Scope decisions (Kevin, 2026-07-11):**

- Auth pillar is narrowed to **login rate-limiting only** (a real audit-log model
  is explicitly out of scope — attribution infra already exists and there is no
  second trust level).
- Delivered as **three sequential, independently gate-green PRs**, smallest blast
  radius first.
- Playwright smoke runs as a **local pre-merge gate** (`npm run smoke`),
  **not** inside `~/deploy.sh` (prod box is OOM-sensitive) and not in CI.
- Smoke covers the **full roadmap path** (SEO upload→parse→report AND single-page
  ADA audit→complete).

## 2. Non-goals

- No audit-log / activity-log model (deferred; attribution already covered by
  `requestedBy` + operator cookie).
- No change to the OAuth flow, session cookie, or password model itself.
- No Redis / external store — the in-process fork-mode + local SQLite stack is
  frozen (CLAUDE.md stack constraints); an in-memory limiter is correct here.
- No CI test job, no git-hook (husky) infra — the repo's gate model is
  documented local commands, and this design keeps it that way.
- No rate-limiting of the OAuth start/callback routes (Google-mediated,
  state-signed) or of other authed routes.

---

## PR1 — Login rate-limiting

> **Codex review (2026-07-11): accept-with-named-fixes.** Fixes #1–#6 folded in
> below (boundary semantics, proxy-trust/reset contracts, absolute per-worker DB
> paths + idempotent copy, parallelism canary + shared-resource audit, the PR3
> SSRF resolution, and full prod-mode smoke env). The PR3 SSRF item touches a
> security boundary (`lib/security/safe-url.ts`) — flagged for Kevin at the
> spec-review gate.

### 3.1 Component: `lib/rate-limit.ts` (new)

A small, generic, in-memory **fixed-window** limiter, extracted so it is pure and
unit-testable (the existing `uploadSizeByIP` limiter in `app/api/upload/route.ts`
is the precedent — same shape, but inlined and untested).

```ts
export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number   // 0 when allowed
  remaining: number           // attempts left in the window
}

export interface FixedWindowLimiter {
  // Record + evaluate one hit against `key`. Returns allowed=false once the
  // window count exceeds `max`.
  hit(key: string): RateLimitResult
  // Clear a key's window (called on successful login).
  reset(key: string): void
}

export function createFixedWindowLimiter(opts: {
  max: number
  windowMs: number
  now?: () => number          // injectable clock for tests; defaults Date.now
  maxKeys?: number            // hard cap on Map size (LRU-ish prune); default 10_000
}): FixedWindowLimiter
```

**Semantics:**
- `Map<string, { count: number; windowStart: number }>`.
- On `hit`: if no entry or **`now - windowStart >= windowMs`** (Codex #3 — use
  `>=`, NOT `>`; with `>` a request landing exactly on the boundary stays blocked
  while `retryAfterSeconds` computes to 0), start a fresh window (`count = 0`).
  Increment, then `allowed = count <= max`.
- `retryAfterSeconds` = `max(0, ceil((windowStart + windowMs - now) / 1000))` when
  blocked (never negative under clock skew).
- **Prune (Codex #3):** on `hit`, if the Map exceeds `maxKeys`, drop expired
  entries first; if still over, drop the oldest `windowStart` entries — but
  **never evict the key currently being evaluated** (guard so a prune can't drop
  the very entry we just wrote). Bounds memory so a rotating-IP flood can't grow
  the Map without limit.
- **Config validation (Codex #3):** `createFixedWindowLimiter` coerces
  non-finite / non-positive `max` and `windowMs` to their defaults, so a
  malformed env override (see §3.2) degrades safely instead of disabling the
  limiter or throwing.
- Fully deterministic under an injected `now()` — no `Date.now()`/`Math.random()`
  in the tested paths.

### 3.2 Login route change (`app/api/auth/login/route.ts`)

- Module-scope singleton: `const loginLimiter = createFixedWindowLimiter({ max:
  LOGIN_MAX_FAILURES, windowMs: LOGIN_WINDOW_MS })`.
- Key = `getClientIp(request)` (reuse `lib/upload-helpers.ts` — `cf-connecting-ip`
  → `x-real-ip` → first XFF; Cloudflare is the trusted front so the key is not
  attacker-spoofable).
- **Flow:**
  1. Before verifying: `const rl = loginLimiter.hit(ip)`. If `!rl.allowed` →
     `303` redirect to `/login?error=too_many_attempts&next=<path>` with a
     `Retry-After: <rl.retryAfterSeconds>` header. (303 keeps the existing
     form-POST redirect UX; the header aids any programmatic client.)
  2. On **invalid** password → existing `303 ?error=invalid` (the failed `hit`
     already counted it).
  3. On **valid** password → `loginLimiter.reset(ip)` before setting cookies, so
     a legitimate operator who fat-fingered a few times isn't left throttled.
- **Config:** `LOGIN_MAX_FAILURES` default **10**, `LOGIN_WINDOW_MS` default
  **15 min**. Env-overridable (`LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MS`)
  following the repo's `getMaxUploadBodyBytes()` precedent — **no new
  required-in-prod env var** (defaults apply when unset, so no `instrumentation.ts`
  fail-fast risk).
- The `ALLOW_PASSWORD_LOGIN=false` short-circuit stays **above** the limiter (a
  disabled password path shouldn't consume the limiter budget).
- **Proxy-trust contract (Codex #4):** `getClientIp` trusts `cf-connecting-ip`
  first, then `x-real-ip`, then the (spoofable) first `X-Forwarded-For` value.
  The keying is only sound if the origin accepts traffic **exclusively** through
  Cloudflare — otherwise a direct-to-origin caller forges `cf-connecting-ip` and
  rotates the key at will. This is a documented deployment invariant (Cloudflare
  origin firewall / authenticated-origin-pull), not something the code enforces;
  the spec states it and Kevin verifies it (see §8 Things to verify). This limiter
  is **best-effort brute-force friction, not an account-level lockout** — a single
  shared password means one key space, so it caps per-source attempt rate and
  raises attacker cost; it does not, and cannot, prevent a distributed / IP-rotated
  campaign or survive a process restart (in-memory).
- **Test-reset seam (Codex #4):** the module-scope `loginLimiter` singleton needs
  a deterministic reset between route tests or cases leak into each other. Expose
  a tiny test-only `__resetLoginLimiter()` (or construct the limiter behind a
  getter the test can replace) so `route.test.ts` starts each case clean.

### 3.3 Login page copy (`app/(public)/login/page.tsx`)

- Add a case for `error=too_many_attempts` → friendly "Too many attempts. Please
  wait a few minutes and try again." message. Dark-mode variants required (UI
  change class). No hydration-sensitive patterns (server component / static).

### 3.4 Tests (PR1)

- `lib/rate-limit.test.ts`: window rollover, block-after-max, `reset`, prune at
  `maxKeys`, `retryAfterSeconds` math — all with an injected clock.
- `app/api/auth/login/route.test.ts` (extend existing): (a) N+1 rapid failures →
  redirect carries `error=too_many_attempts` + `Retry-After`; (b) successful
  login resets the counter; (c) `ALLOW_PASSWORD_LOGIN=false` still short-circuits
  without consuming budget.
- **No middleware change** (login is already public) → no `middleware.test.ts`
  delta.

### 3.5 PR1 acceptance

Gate-green (lint/test/build); prod-verify by confirming a burst of bad passwords
against prod `/api/auth/login` returns the throttle redirect and a good login
still works. (Benign, non-destructive prod verification — allowed under rule 1.)

---

## PR2 — Per-worker test DBs

### 4.1 The mechanism

vitest defaults to the `forks` pool; each worker process exposes
`process.env.VITEST_WORKER_ID`. Give each worker its **own migrated SQLite file**
so concurrent files never share write state.

- **Absolute, canonical `file:` URLs (Codex #1):** Prisma resolves a relative
  SQLite URL against the **schema directory** (`prisma/`), which is exactly why
  the dev DB lives at `prisma/local-dev.db` and vitest excludes
  `prisma/local-dev.db*`. A relative `.test-dbs/...` URL would therefore resolve
  under `prisma/`, not repo root — a silent mismatch between where migrate writes
  and where the copy reads. **Use one absolute path** (repo-root
  `<root>/.test-dbs/...`, resolved from `import.meta.url` / `process.cwd()`) for
  the migrate target, the copy source/dest, and the worker `DATABASE_URL`
  (`file:/abs/.test-dbs/worker-<id>.db`).
- **`test/global-setup.ts`** (`globalSetup`): delete any stale `.test-dbs/` first,
  then build one **template DB** once — `<root>/.test-dbs/template.db` via
  `prisma migrate deploy` (spawned with the absolute `DATABASE_URL`). Pays the
  migration cost exactly once per run.
- **`test/setup-worker.ts`** (added to `test.setupFiles`): sets
  `process.env.DATABASE_URL` to the absolute per-worker `file:` URL and ensures
  the worker DB exists. **`setupFiles` runs per test-file context, not as a
  guaranteed once-per-worker hook (Codex #1)** — so the copy is **idempotent:
  copy the template → `worker-${VITEST_WORKER_ID}.db` only if that file does not
  already exist**, and **never overwrite a worker DB that may already be open**
  under a live Prisma connection. Copy the WAL sidecars too — `lib/db.ts` runs
  `PRAGMA journal_mode = WAL`, so a copied DB has `-wal`/`-shm` companions; copy
  all three (or checkpoint the template to a clean single file before copying).
  Because `lib/db.ts` constructs its Prisma singleton lazily at first import and
  `setupFiles` run before test modules load, the singleton binds to the
  per-worker URL. File-copy is instant (no per-worker migration).
- **`setup-worker.ts` import hygiene (Codex #2):** it must NOT transitively import
  `lib/db.ts` (or anything that does) before it sets `DATABASE_URL`, or the
  singleton binds to the wrong URL. Keep the setup file dependency-free of app
  modules — raw `fs`/`path`/`node:process` only.

### 4.2 Config change (`vitest.config.mts`)

- Remove `fileParallelism: false` (revert to the default `true`).
- **Explicitly pin `pool: 'forks'` and a conservative `maxWorkers` (Codex #2)** —
  do not inherit CPU-count default parallelism, which could spawn many Prisma
  connections (and, in any test that touches the browser pool, Chrome-adjacent
  processes) on the dev machine. Start at e.g. `maxWorkers: 4` and tune up only
  if the full suite stays green and faster.
- Add `globalSetup: './test/global-setup.ts'` and
  `setupFiles: ['./test/setup-worker.ts']`.
- Keep the existing `exclude` globs; add `.test-dbs/**`.

### 4.3 Why this is safe — and the shared-resource audit (Codex #2)

- Files **within** one worker still run sequentially → no concurrent writers on
  one DB. Files **across** workers hit different DBs → the `AuditBatch`
  `audit_batches_one_open` singleton collision (the original reason for
  `fileParallelism: false`) cannot occur.
- **Per-worker DBs isolate database state ONLY** — not filesystem, ports, env, or
  module-level state. Before claiming "strictly no worse," the plan must **audit
  the suite for non-DB shared resources** that parallelism could now collide on:
  - direct references to `local-dev.db` (must be none — everything goes through
    `DATABASE_URL`);
  - shared filesystem dirs written by tests (`UPLOADS_DIR`/`uploads/`,
    `REPORTS_DIR`, `local-uploads/`, any fixed temp path) — parallel workers must
    not write the same path;
  - fixed ports / servers bound by tests;
  - module-level in-memory singletons that assume serial execution (each fork is
    a fresh process, so module state is per-worker and reset — but a test that
    reaches out to a *shared external* resource is the risk).
- **Binding canary (Codex #2):** add a test that runs `PRAGMA database_list` and
  asserts the active DB path contains this worker's id — proves each worker is on
  its own file, not silently sharing one.
- Cross-file state accumulation within a worker DB is **no worse** than today for
  DB state (today all 368 files share one DB serially; per-worker is strictly
  fewer files per DB). The audit above covers the non-DB dimensions the "no
  worse" claim doesn't automatically cover.

### 4.4 Housekeeping

- `.test-dbs/` added to `.gitignore` and to the vitest `exclude`.
- `DATABASE_URL="file:./local-dev.db" npm test` still works: the worker setup
  **overrides** `DATABASE_URL` per worker, so the caller's value only matters for
  the (now-unused-by-tests) default. Document the new behavior in
  `er-seo-tools-validation-and-qa` if it changes the canonical command.

### 4.5 PR2 acceptance (the empirical risk)

- **All 3358 tests green** under restored parallelism — this is the real
  verification, run in-session.
- Record wall-clock before/after in the tracker status line.
- No prod deploy needed for PR2 alone (test-infra only, no shipped-code change);
  it still rides the next deploy but changes no runtime behavior.

---

## PR3 — Playwright smoke suite

### 5.1 Harness

- Add `@playwright/test` (dev dep) + `playwright.config.ts`.
- **`npm run smoke`**: build once (`next build`), then Playwright's `webServer`
  boots `next start` on a test port.
- A **local fixture HTTP server** (tiny static server on another loopback port)
  serves the single-page-audit target — **never a third-party site (rule 3)**.
  The app's ADA path drives system Chrome via puppeteer-core (present in dev at
  `/usr/bin/google-chrome` / macOS Chrome); Playwright drives the app UI with its
  own bundled Chromium. Two distinct browsers, by design.

#### 5.1a Full prod-mode smoke env (Codex #6)

`next start` runs the app in **production mode**, so `instrumentation.ts`'s
fail-fast startup checks apply. The smoke harness must supply the complete set,
or the server refuses to boot:

- **`APP_AUTH_SECRET`** — disposable value (required in prod; signs the session
  cookie). Not just `APP_AUTH_PASSWORD`.
- **`APP_AUTH_PASSWORD`** — known value so the smoke drives the real break-glass
  login form.
- **`NEXT_PUBLIC_APP_URL`** — set **at `next build` time**, not only at
  `next start`: it is a `NEXT_PUBLIC_` var, compile-time-inlined into the bundle.
  The smoke's build step must set it to the test base URL.
- **Chromium egress guard** — `instrumentation.ts` requires the production
  egress guard (`CHROMIUM_NETWORK_ISOLATED=true` acknowledging host firewall
  rules); the smoke sets it, and see §5.1b for how the loopback target coexists
  with it.
- **`CHROME_EXECUTABLE`** — per-host (macOS Chrome path vs `/usr/bin/google-chrome`).
- **`UPLOADS_DIR`** + a **dedicated smoke SQLite DB** (its own `DATABASE_URL`,
  migrated like PR2's template) + `REPORTS_DIR` — all pointed at disposable,
  smoke-only paths so a run never touches dev/prod data.
- Controlled worker/browser concurrency and explicit teardown (kill the server +
  fixture, delete the smoke DB/dirs).

#### 5.1b SSRF resolution — the security-sensitive crux (Codex #5)

**Problem:** the single-page ADA audit calls `assertSafeHttpUrl` (`lib/security/
safe-url.ts`) before `page.goto`, and that guard **rejects loopback/private
destinations**. A smoke audit against `http://127.0.0.1:<fixturePort>` therefore
fails at submission — the current design cannot work as written.

**Resolution — an exact-host-and-port loopback allowlist, not a bypass:**

- Introduce a narrowly-scoped allowance in `safe-url.ts` keyed on a new env var
  **`SMOKE_LOOPBACK_TARGET`** naming **one exact `host:port`** (e.g.
  `127.0.0.1:41xxx`). When set, `assertSafeHttpUrl` permits **that exact
  authority only** — matched by exact string, never a range, prefix, or wildcard.
- This is provably **not a production-capable SSRF bypass**: the value must be a
  loopback address (validated), so it can never be turned into an external target
  or a link-local metadata endpoint (`169.254.169.254`); the blast radius is a
  single self-loopback port.
- **`instrumentation.ts` guard:** at startup, if `SMOKE_LOOPBACK_TARGET` is set,
  assert it resolves to a loopback address (else `process.exit(1)`, mirroring the
  existing fail-fast pattern) and log a prominent warning that a loopback audit
  target is allowlisted. **Documented invariant: production deploys never set
  `SMOKE_LOOPBACK_TARGET`.** Because the allowlist is loopback-exact, even an
  accidental prod set cannot reach anything but the box's own loopback port.
- `lib/security/safe-url.ts` is a "never weaken" file (change-control,
  security-sensitive class). This change is **additive and default-off** (unset →
  identical behavior to today), covered by new `safe-url.test.ts` cases proving:
  unset → loopback still rejected; set → only the exact authority allowed; a
  different loopback port / any private / any external still rejected.
- **Kevin sign-off:** this modifies the SSRF boundary; it is flagged for explicit
  review at the spec-review gate. If Kevin prefers to avoid touching `safe-url.ts`
  entirely, the fallback is to **drop the ADA-audit leg from the smoke** (keep
  login → upload → parse → report only) — a smaller PR3 that needs no SSRF change.

### 5.2 Smoke path (full roadmap coverage)

1. **Login** — visit a gated page, get redirected to `/login`, submit the
   break-glass password, land back on the app.
2. **Upload → parse → report** — go to `/ada-audit` (Scan Type = SEO / SF upload),
   upload a **tiny SF-crawl fixture** (a minimal valid multi-CSV export — locate
   or trim one from the existing parser fixtures / the Manhattan SF crawl), wait
   for the parse session to complete, assert the results/report renders with
   non-empty parsed data.
3. **Single-page ADA audit → complete** — submit a single-page audit against the
   local fixture URL, poll the UI until the audit reaches `complete`, assert a
   score renders.

Assertions are on **user-visible outcomes** (headings, score text, completed
state), not internal DOM, so the smoke survives UI refactors.

### 5.3 Gate placement (deliberate deviation)

Documented **local pre-merge gate**, added to `er-seo-tools-change-control`
alongside lint/test/build:

> `npm run smoke` — Playwright happy-path E2E; run before merging any PR that
> touches auth, upload/parse, or the audit pipeline.

**Not** wired into `~/deploy.sh` (runs on the 3.9 GB OOM-sensitive prod box —
Playwright + browsers there re-invites the PM2 SIGKILL incident class) and **not**
a CI job (no CI-test infra today; app-boot + Chrome in CI is out of scope for a
"lowest-urgency" item). Same protective intent, zero prod-memory / new-infra risk.

### 5.4 PR3 acceptance

- `npm run smoke` passes locally end-to-end.
- The three lint/test/build gates unaffected (smoke is separate).
- change-control skill updated to list the gate.
- **PR3 does touch runtime code** (the default-off `SMOKE_LOOPBACK_TARGET`
  allowlist in `safe-url.ts` + the `instrumentation.ts` boot guard) — but with the
  var **unset** (prod default) behavior is byte-identical to today, proven by
  `safe-url.test.ts`. Security-sensitive class: `middleware.test.ts` unaffected
  (no route gating change), `safe-url.test.ts` gains the allowlist cases,
  `audit:ci` stays green. Prod-verify after deploy: `SMOKE_LOOPBACK_TARGET` unset
  in prod `.env` (it must never be set there), boot clean, a normal single-page
  audit against a public client URL still SSRF-guards as before.

---

## 6. Cross-cutting

- **Docs ritual (hard gate 2):** each PR ships its tracker checkbox + dated
  status-log line + rewritten handoff doc in the same commit; the A7 spec/plan
  move to `docs/superpowers/archive/` when the last PR ships. A7 stays `[~]`
  until all three land.
- **Env vars:** PR1 adds only optional, defaulted vars (`LOGIN_RATE_LIMIT_*`) —
  none required-in-prod. PR3 adds `SMOKE_LOOPBACK_TARGET`, **default-off and never
  set in prod** (a set-in-prod value is loopback-exact so it can't cause external
  SSRF, and `instrumentation.ts` fail-fasts on a non-loopback value). No new
  *required-in-prod* var → no boot-brick risk, no Kevin pre-deploy `.env` step.
- **Security class (PR1 + PR3):** PR1 login is auth-surface; PR3 touches
  `lib/security/safe-url.ts`. Both follow the security-sensitive pipeline;
  `audit:ci` stays green; the SSRF change is additive/default-off with new
  `safe-url.test.ts` coverage and explicit Kevin sign-off (§5.1b).

## 7. Sequencing & risks

| PR | Risk | Mitigation |
|----|------|-----------|
| PR1 rate-limit | Locking out legitimate operators | Generous default (10 fails / 15 min), reset on success, env-tunable; `>=` boundary avoids a stuck `Retry-After: 0` |
| PR1 rate-limit | Key forgery if origin is reachable directly (not via Cloudflare) | Documented Cloudflare-only-origin invariant (§3.2, §8); best-effort framing — not an account lockout |
| PR2 test DBs | A test relied on cross-file shared DB state and breaks under parallelism | Run full suite in-session; if a file is order-dependent, pin it (`test.sequential` / shared-DB opt-out) rather than reverting |
| PR2 test DBs | Non-DB shared-resource collision (fs dirs, ports) under parallelism | Shared-resource audit (§4.3) + `PRAGMA database_list` binding canary + conservative `maxWorkers` before scaling up |
| PR3 smoke | SSRF guard rejects the loopback fixture | Exact-loopback `SMOKE_LOOPBACK_TARGET` allowlist, default-off, prod-guarded (§5.1b); fallback = drop the ADA leg |
| PR3 smoke | Flaky / slow E2E, prod-mode boot env friction | Full prod env set (§5.1a); assert on stable user-visible outcomes; one happy path; local-only so flakiness never blocks deploy |

Overall: three small, reversible, independently shippable changes. PR2 carries the
"will everything stay green under parallelism" unknown (verified empirically +
canary); PR3's SSRF change is the security-sensitive one (default-off, Kevin
sign-off).

## 8. Things Kevin should verify (Codex)

- **Cloudflare-only origin (PR1):** the prod origin actually rejects direct
  requests, so `cf-connecting-ip` can't be forged by a direct-to-origin caller.
  If the origin is reachable directly, the per-IP key is spoofable and the limiter
  is weaker than it looks.
- **Full parallel run is clean (PR2):** after the binding canary passes, the whole
  suite is green under parallelism with no hidden shared-resource (fs/port)
  failures — this is the empirical gate.
- **SSRF strategy is acceptable (PR3):** the exact-loopback allowlist in
  `safe-url.ts` is the right call vs dropping the ADA-audit leg — Kevin's sign-off
  at the spec-review gate.
- **Smoke hosts (PR3):** any machine running `npm run smoke` has BOTH Playwright's
  bundled Chromium AND a compatible system Chrome for the ADA path.
