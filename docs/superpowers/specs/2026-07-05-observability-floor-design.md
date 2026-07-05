# A4 — Observability Floor · Design

**Date:** 2026-07-05 · **Roadmap item:** A4 (platform roadmap §4) · **Class:** feature (multi-file) + one UI page + one security-sensitive touch (a new public route)

## Problem

Operating scheduled and queued work today means SSH + `pm2 logs` archaeology. There
is no health endpoint for an uptime monitor, no single place to see queue state,
and logging is 132 bare (but consistently tagged) `console.*` calls read only via
SSH. The roadmap's A4 "observability floor" closes the gap needed to *operate*
scheduled scans safely: a liveness endpoint, an ops page, and a structured logger.

## Goal / Non-goals

**Goal:** ship three deliverables that let an operator answer "is it up?" and
"what is the queue doing?" without SSH — reusing the groundwork already built for
A4 (`lib/jobs/introspection.ts`, `lib/ops/health-check.ts`) and the A3 route kit.

**Non-goals this round (explicitly deferred):**
- Full `console.*` → pino migration (132 sites). Adopt the logger at seams only;
  migrate the rest opportunistically later. The existing lines are already tagged
  and PM2 already rotates them; a big-bang migration is churn without a log
  aggregator to consume JSON.
- SSE / status-hook consolidation (A5), shared UI primitives (A6), auth hardening (A7).
- Ops **action** buttons on `/admin/ops` (trigger cleanup, retry job, etc.) — a
  mutation surface; v1 is read-only.
- An authed JSON metrics route (`/api/health?detail`) — the `/admin/ops` server
  component renders the detail directly; add a JSON route later only if scripting needs it.

## Existing groundwork (reuse, do not rebuild)

- `lib/jobs/introspection.ts` → `getJobQueueState()`: job counts by type→status,
  oldest-running job, 10 most-recent failures. Header comment says it was written
  *for* this A4 page, "No UI in this phase."
- `lib/ops/health-check.ts` → `collectHealthSignals()` (DB/FS reads: errored
  audits, exhausted jobs, stalled audit, newest-backup age) + `evaluateHealth()`
  (pure windowing/cooldown decision). D0 built these for the alert job.
- `lib/ops/backup.ts` → `newestBackupMtimeMs()`, `BACKUP_DIR` resolution.
- `lib/api/` (A3) → `withRoute`, `HttpError`, `parseJsonBody`.
- `lib/auth.ts` → `AUTH_COOKIE_NAME = 'er_auth'`, `isValidAuthCookie`. Middleware
  is the single cookie gate; `isPublicPath` currently allows only `/api/auth/` +
  `/api/share/`.

## Deliverable 1 — `/api/health` (two-tier liveness, public shallow)

A new **public** GET route. The unauthenticated tier exists so an external uptime
monitor can poll it; it must NOT leak operational internals (queue depth,
audit IDs, disk, pool state stay behind auth on `/admin/ops`).

**Contract:**
- `200 { status: 'ok' | 'degraded', uptimeSec, version }` when the app + DB are up.
  - `version` from `package.json` (`0.2.0`).
  - `uptimeSec` from `process.uptime()` (rounded).
  - `status: 'degraded'` (still **200**, so the monitor does not false-page on a
    soft issue) when `evaluateHealth(collectHealthSignals())` produces any alert
    line (errored audits, exhausted jobs, stalled queue, stale backup). The alert
    *text* is NOT included in the public body — only the `degraded` flag.
  - **`since` window (Codex #2 — correctness):** call
    `collectHealthSignals(now, now - healthEvalOpts().lookbackMs)`. Do **not** pass
    `since: 0` / a zero-time "fresh" state — that would count *all historical*
    errored audits/jobs and pin `/api/health` to `degraded` forever. Pass a fresh
    zero-cooldown `AlertState` only so the read stays stateless (it never mutates
    the alert job's dedup file), but the `since` must be the lookback window.
  - **Guardrails for an unauthenticated poller (Codex #1):** the degraded
    computation does real Prisma + FS reads, so (a) wrap it in a short in-memory
    TTL cache (e.g. 10 s) keyed nowhere — one module-level cached result — so a
    sub-minute uptime poll doesn't hammer the DB; (b) run it under a short timeout
    and **fail open** to `status:'ok'` if it exceeds it or throws; (c) the cheap
    `SELECT 1` DB ping stays separate and uncached (it is the only hard-down
    signal). Response always sets `Cache-Control: no-store`.
- `503 { status: 'down' }` when a `SELECT 1` DB ping throws.
- The route owns its own try/catch and returns explicit `Response`s for every path
  (200 and 503). `withRoute` (A3) passes a returned `Response` through untouched,
  so wrapping is optional; the route must never let the health check itself throw a
  500 — a failed/timed-out signal collection **fails open** to
  `status:'ok'`-with-DB-up rather than crashing the endpoint (DB reachability is
  the only hard-down condition).

**Security-sensitive requirements (the "bit us three times" rule):**
- Add `/api/health` to `middleware.ts` `isPublicPath` as an **exact** match, not a
  broad prefix (Codex #8) — a future `/api/health/detail` must stay gated.
- Add a `middleware.test.ts` case asserting `isPublicPath('/api/health') === true`,
  `isPublicPath('/api/health/detail') === false`, and that `/admin/ops` (and
  `/api/…` generally) still 401/redirects without a cookie.

## Deliverable 2 — `/admin/ops` (cookie-gated ops page, the detail tier)

A **server component** page. It is NOT in `isPublicPath`, so middleware enforces the
cookie gate; the page queries directly (no intermediate API route). Read-only v1.

**Per-section fault isolation (Codex #5):** `/admin/ops` is most needed *during*
failures, so a single throwing loader must not blank the page. Load each panel's
data with `Promise.allSettled` (or an isolated try/catch per loader) and render
"unavailable" for any section whose loader rejected — never a whole-page 500.

**Renders:**
- **Job queue** — `getJobQueueState()`: a type×status count grid, oldest-running
  job (id/type/age), and the 10 most-recent failures (id/type/`lastError`/age).
- **Health signals** — `collectHealthSignals()` rendered as labeled rows (errored
  site/ada audits since window, exhausted jobs, stalled audit, newest-backup age),
  with an overall ok/degraded banner from `evaluateHealth`.
- **Disk free** — new `lib/ops/disk.ts` `getDiskFree(path)` via Node 22
  `fs.promises.statfs` (`bavail * bsize`), measured on the **data volume** (the DB
  file's directory). Returns `null` on failure → UI shows "—".
- **DB size** — new `lib/ops/db-size.ts` `getDbSizeBytes()`: resolve the SQLite
  file from `DATABASE_URL` and report the **full WAL footprint** (Codex #3):
  `main + -wal + -shm` (each `fs.stat`'d best-effort; missing sidecar files
  contribute 0). Label the panel row "DB footprint (main+WAL)". **Hardened path
  parsing (Codex #4):** handle `file:/absolute/path`, `file:./rel`, `file:../rel`,
  and any `?…` query suffix; Prisma resolves a **relative** SQLite path against the
  `prisma/` schema directory (NOT process cwd), so resolve the same way. `null` on
  any failure → "—". Defensive: never throw. Tests cover prod's
  `file:/home/.../db.sqlite` (absolute) and local `file:./local-dev.db` (relative).
- **Browser pool** — new `getPoolState()` accessor on `browser-pool.ts` (below).
- **Cleanup stats** — last-run summary line for the daily `cleanup` /
  `screenshot-sweep` system schedules, read from their `Job`/`Schedule` rows
  (last `completedAt` + `lastError`) via a small read in `introspection.ts` or the
  page. If no structured cleanup metric exists, show last-run timestamp + status
  only (do not fabricate counts).

**UI-change gate:** every element gets Tailwind `dark:` variants (map `bg-white`→
`dark:bg-navy-card`, `text-gray-*`→`dark:text-white/*`, borders→`dark:border-navy-border`).
Server-rendered → negligible hydration-mismatch risk; no client `mounted` guard
needed unless a client subcomponent reads theme. A small discoverable link is added
from `/settings` (dark-mode compliant). No auto-refresh/polling in v1 (a manual
reload is fine; SSE is A5).

## Deliverable 3 — `lib/log/` (structured logger, adopted at seams)

- `lib/log/index.ts`: a `pino` logger — pretty transport in dev, JSON to stdout in
  prod (PM2 rotates stdout). A `logError(context: Record<string, unknown>, err:
  unknown)` helper that emits a structured error entry (`err.message` + stack +
  context; never a full Gaxios/Prisma object — same sanitization discipline as C10).
- **Adopt at seams only:**
  - the new `/api/health` route (its 503/degraded paths),
  - the `/admin/ops` page (data-load failures),
  - the **job-worker error seam** (`lib/jobs/worker.ts`): when a job settles to
    `error`/exhausted (line ~149/158), emit `logError({ jobId, type, attempt }, err)`
    alongside the existing DB write; and replace the two existing
    `console.warn`/`console.error` worker lines (tick-failed, settle-failed) with
    the logger. This is the highest-signal seam for "what failed overnight."
    **Retain the original error object (Codex #6):** the worker currently collapses
    the caught handler failure into `error: string | null` before settling, which
    loses the stack. Keep the caught `unknown` (e.g. a parallel `caughtErr`
    variable) alongside the string so `logError` gets the real `Error` (message +
    stack + context), not just the pre-flattened message.
- The other ~130 tagged `console.*` calls are left as-is (opportunistic later).
- **Constraint:** the logger is server-only and never `.toString()`-injected into an
  audited page, so the SWC-helper hazard (`parse-seo-dom.ts` rule) does not apply.
- **Boot safety / runtime-safe transport (Codex #7):** `pino` is a normal
  dependency, needs no env var, and must not add a `process.exit(1)` boot
  dependency. **Prod = plain JSON to stdout with NO transport** (no worker thread).
  `pino-pretty` is a **devDependency**, referenced only on the dev branch and
  loaded lazily — never statically `require`d/imported in a path that runs in prod
  (prod installs without dev deps, so a static import would throw at boot). Any
  transport-construction failure falls back to plain pino/console.

## Browser-pool accessor

Add to `lib/ada-audit/browser-pool.ts`:

```ts
export function getPoolState(): {
  poolSize: number; inUse: number; free: number;
  waiting: number; draining: boolean; browserAlive: boolean; pagesServed: number
} {
  return {
    poolSize: POOL_SIZE,
    inUse: POOL_SIZE - slots,
    free: slots,
    waiting: waiters.length,
    draining,
    // Codex #9: browser !== null overstates health during a disconnect edge;
    // prefer the live connectivity flag.
    browserAlive: browser?.connected === true,
    pagesServed,
  }
}
```

Synchronous module-state read — no `await`, no lock acquisition, cannot perturb the
pool. Pure getter.

## Files

**New**
- `app/api/health/route.ts` — public GET, two-tier.
- `app/admin/ops/page.tsx` (+ small presentational subcomponents as needed).
- `lib/log/index.ts` — pino logger + `logError`.
- `lib/ops/disk.ts` — `getDiskFree(path)`.
- `lib/ops/db-size.ts` — `getDbSizeBytes()`.
- Test files for each of the above and the middleware change.

**Changed**
- `lib/ada-audit/browser-pool.ts` — `getPoolState()`.
- `middleware.ts` + `middleware.test.ts` — public `/api/health` + tests.
- `lib/jobs/worker.ts` — `logError` at the error/exhausted + tick/settle seams.
- `lib/jobs/introspection.ts` — optional small cleanup-stats read (if not done in the page).
- `package.json` — add `pino` (+ `pino-pretty` as a devDependency for the dev transport).
- `app/settings/page.tsx` — a link to `/admin/ops`.

## Testing

- **`/api/health`** (route unit test, mocked prisma): 200 ok when DB ping resolves +
  no signals; 200 degraded when a signal trips (public body carries only the flag,
  no alert text); 503 down when the ping rejects; the signal collection
  throwing/slow **fails open to 200 ok** (does not 500 or 503). Assert no
  alert-state file is written, `Cache-Control: no-store` is set, and the degraded
  read uses a lookback-window `since` (historical errors outside the window do NOT
  force degraded).
- **middleware**: `isPublicPath('/api/health') === true`,
  `isPublicPath('/api/health/detail') === false`; `/admin/ops` gated cookie-less.
- **`lib/ops/disk.ts` / `db-size.ts`**: happy path + `null` on stat failure (mock `fs`).
  db-size path resolution covers prod `file:/home/.../db.sqlite` (absolute) and
  local `file:./local-dev.db` (relative → `prisma/` dir), plus a `?…` query suffix,
  and sums the `-wal`/`-shm` sidecars when present (Codex #3/#4).
- **`getPoolState()`**: reflects `slots`/`waiters`/`draining`/`browser` transitions
  (acquire → inUse++, release → inUse--). **Mock `puppeteer.launch`** (or drive the
  pure state seam only) — A4 tests must never launch real Chrome (Codex #10).
- **`logError`**: emits structured fields; sanitizes error objects (no raw object leak).
- **`/admin/ops` page**: renders the queue grid + health rows from mocked loaders;
  degraded banner shows; "—" for null disk/db-size. (`// @vitest-environment jsdom`
  + `afterEach(cleanup)` per house convention.)

## Gates & landing

`npm run lint` + `npm test` + `npm run build` green → PR → merge (rule 1, gate-green)
→ `~/deploy.sh` (no migration; plain deploy) → **prod verification:** hit
`https://seo.erstaging.site/api/health` unauthenticated (expect 200 ok/degraded),
confirm it 503s only on DB-down (do not force this in prod — assert via test), load
`/admin/ops` behind login and eyeball the queue/health/disk/pool rows, `pm2 logs`
shows a JSON `logError` line after a deliberate no-op. Tracker + handoff ritual.

## Risks / mitigations

- **Public route info leak** — mitigated by the two-tier split; public body is
  `{status, uptimeSec, version}` only.
- **`statfs` availability** — Node 22 has `fs.promises.statfs`; guarded with a
  `null` fallback regardless.
- **DB-path resolution for db-size** — Prisma resolves `file:` relative to the
  schema dir; the helper must resolve the same way, and returns `null` (never
  throws) if the file is not found, so a wrong path degrades gracefully to "—".
- **pino transport in prod** — write JSON to stdout directly (no worker-thread
  transport) to avoid PM2/fork-mode transport issues; `pino-pretty` is dev-only.
- **`degraded` read cost** — `collectHealthSignals` runs a handful of indexed
  counts; acceptable for a health poll. If an uptime monitor polls sub-minute,
  the DB-ping-only path stays cheap and the signal collection can be made
  best-effort (skip on its own timeout) — noted for the plan, not required v1.
```

## Codex review

Routed through Codex (session `019f2b57`, 2026-07-05). Verdict: **"the design is
sound"** — accept with 10 named fixes, all applied in place above (tagged `Codex
#1`–`#10`): public-health TTL/timeout/fail-open + `no-store` (#1), lookback-window
`since` not `0` (#2), WAL+shm DB footprint (#3), hardened `DATABASE_URL` parsing (#4),
per-section fault isolation on `/admin/ops` (#5), retain the original error object at
the worker seam (#6), runtime-safe pino transport / dev-only `pino-pretty` (#7),
exact `/api/health` allowlist entry (#8), `browser?.connected` for `browserAlive`
(#9), mock puppeteer in pool tests (#10). No rewrite requested; no contradiction with
prior decisions.
