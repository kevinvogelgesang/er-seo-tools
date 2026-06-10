# Platform & Cross-Cutting Infrastructure — Improvement Roadmap

**Date:** 2026-06-10 · **Status:** NYI strategy doc
**Scope:** `prisma/schema.prisma` (13 models), `instrumentation.ts`, `lib/auth.ts`, `lib/db.ts`, `lib/cleanup.ts`, `lib/security/safe-url.ts`, 45 API routes, nav/layout/theme, vitest setup, PM2/RunCloud deploy

This is Track A in `00-overview.md` — the enabling work everything else
stands on. None of it is user-visible by itself; all of it determines whether
the user-visible tracks are buildable.

---

## Current state (verified)

- **Data:** 13 models, 6 of which carry their payload as JSON-string blobs
  (`Session.result`, `AdaAudit.result`, `SiteAudit.summary`, PillarAnalysis's
  five JSON columns, `PdfAudit.issues`, `*.structured`). WAL + busy_timeout
  pragmas set at startup. 180-day session TTL is the only DB growth control.
- **Background work:** everything in-process — cleanup interval (24 h), stale
  resetter (10 min), screenshot sweeper, PSI worker pool, site-audit mutex,
  fire-and-forget PDF scans. All state above SQLite dies with the process;
  recovery code exists precisely because of that.
- **API:** 45 route files, no shared helpers — auth checks, JSON parsing,
  error envelopes, and Prisma error mapping are re-implemented per route with
  drift (some routes map P2002→409, others 500 everything). 14 routes have
  zero tests.
- **Auth:** single shared password, HMAC-signed 12 h cookie, operator-name
  cookie for attribution. Middleware allowlists public + token-verified paths.
- **Observability:** `console.error` + PM2 log files. No health endpoint, no
  metrics, no error tracker, no structured logs.
- **Testing:** 146 test files; lib/ is well covered, API routes partially,
  pages/components nearly zero, e2e zero. `fileParallelism: false` serializes
  the whole suite because tests share one dev DB.
- **Frontend platform:** consistent Tailwind/dark-mode discipline, but
  pollers, dropzones, history tables, status pills, and copy-buttons are
  re-implemented per tool; nav is hardcoded.

## Recommendation

### 1. Durable job queue on SQLite (2–2.5 wks) ⭐ unlocks Tracks C/D

A `Job` table — `type, payload JSON, status, priority, attempts, maxAttempts,
runAfter, heartbeatAt, lastError, dedupKey` — and one worker loop in the
existing long-lived process. **Hard requirements, not nice-to-haves:**

- Claim via conditional `UPDATE ... WHERE status='queued'` (no two workers
  take one job).
- Heartbeat while running + stale-heartbeat recovery (re-queue or fail) —
  this generically replaces today's bespoke `resetStaleAudits`/`recoverQueue`.
- Retry policy per type (attempts/maxAttempts, backoff via `runAfter`).
- Idempotency: `dedupKey` per job + idempotent job bodies, so a re-run after
  a crash can't double-write results.
- **Never hold a DB transaction across browser/network work** — claim,
  commit, do the work, then write the outcome.
- Type-keyed concurrency limits (e.g. `psi` gets 6 slots, `site-audit-page`
  respects the browser pool).
- Assumes the PM2 fork-mode single process; if cluster mode is ever enabled,
  this design must be revisited first.

- Migrate, in order: PSI jobs → PDF scans → site-audit page loop → cleanup
  ticks. Each migration deletes bespoke recovery code (`resetStaleAudits`,
  `recoverQueue`, orphan-cascades shrink to a generic "re-queue or fail jobs
  with stale heartbeats").
- Add a `Schedule` table (cron-ish: client, jobType, cadence, nextRunAt) and
  a tick that enqueues due jobs — this single feature is what makes scheduled
  ADA scans, nightly Live SEO, and robots monitoring all possible.
- Deploy behavior changes from "kill and reconcile" to "drain or resume."

### 2. Normalized findings layer (1.5–2 wks, schema shared with docs 01/02)

The cross-tool schema the parser and ADA docs both reference:

- `CrawlRun` / `CrawlPage` / `Finding` (+ `Violation` for axe specifics), all
  keyed to client + run + dedupKey, with raw blobs demoted to archive columns
  and a retention policy (archive pruned at 90 days; findings kept).
  (`CrawlPage`, not `Page` — avoid colliding with the existing derived
  `SessionPage` model and Next.js page nomenclature; `SessionPage` gets
  absorbed or retired.)
- Dual-write first, migrate readers tool by tool, never backfill old blobs.
  Validate parity on 3–5 representative clients before flipping any reader.
- Validate growth assumptions early: project DB size for nightly ADA + Live
  SEO snapshots across the fleet before committing to retention windows.
- This is what makes trends, diffs, the client command center, regression
  alerts, and DB-size control all cheap instead of each being a project.

### 3. API route kit (1 wk)

A small `lib/api/` toolkit: `withRoute()` wrapper providing auth guard,
zod-style payload validation, a uniform error envelope, Prisma-error→HTTP
mapping, and request logging. Adopt incrementally — new routes immediately,
existing routes opportunistically. Pair with route tests for the 14 untested
routes (the wrapper makes them much cheaper to write).

### 4. Observability floor (0.5–1 wk)

- `/api/health`: DB reachable, job-queue depth/oldest-running, browser pool
  state, disk free. Point an uptime monitor at it.
- Structured logging (pino) replacing bare console calls; PM2 already
  handles rotation.
- Error capture: self-hosted Sentry is overkill here — a `logError()` that
  writes structured entries + a daily digest is the right size; revisit if
  the team grows.
- A tiny `/admin/ops` page: job queue view, recent errors, DB size, cleanup
  stats. When a nightly scan misbehaves, this is the difference between five
  minutes and an SSH archaeology session.

### 5. Status hook first, SSE second (0.5 wk, shared with docs 02/03)

Sequencing matters here: first consolidate the per-tool pollers into one
shared status hook (one implementation, DB remains the source of truth).
Then, optionally, add a `/api/events` SSE endpoint (single process makes
this trivial — an in-memory emitter keyed by entity id) as a **notification
layer only**: an event means "refetch now," and reconnect always falls back
to fetching state from the DB. SSE never carries authoritative state. This
deletes the per-second polling load without making liveness load-bearing.

### 6. Frontend platform pass (1 wk, opportunistic)

Extract the genuinely shared primitives into `components/ui/`: status pill,
history table, dropzone, copy button, score ring, poller/SSE hook. Make nav
data-driven from a tools registry (which the home page and client command
center can also render from). Not a design-system project — just stopping
the fourth re-implementation of the same table.

### 7. Auth & testing hardening (1 wk, lowest urgency)

- Auth: keep the single-password model (right size for the team) but add
  per-operator audit attribution to mutating routes via the existing
  operator cookie, and rate-limit login.
- Tests: per-worker SQLite files to restore vitest parallelism; one
  Playwright smoke suite (login → upload tiny fixture crawl → parse → report;
  queue single-page audit against a local fixture server → complete) wired
  into the deploy script as a pre-push gate.

## What I would not do

- **No Postgres/Redis/BullMQ.** A job table + worker in the existing process
  gives durability and scheduling without violating the stack constraints or
  adding ops surface. Revisit only if a second app server ever exists.
- **No PM2 cluster mode** — the browser pool, job worker, and SSE emitter all
  assume one process; horizontal scale is not this app's problem.
- **No auth provider / user accounts** until there's an actual second trust
  level. The shared-password + operator-name model fits an internal team.
- **No tRPC/GraphQL migration.** The route kit fixes the consistency problem
  at 5% of the cost.

## Effort summary

| Item | Effort | Unlocks |
|---|---|---|
| 1. Job queue + schedules | 2–2.5 wks | scheduled scans, deploy-safe audits |
| 2. Findings layer | 2–3 wks | trends, dashboards, alerts, DB control |
| 3. API route kit + route tests | 1 wk | consistency, cheap testing |
| 4. Observability floor | 0.5–1 wk | operating scheduled work safely |
| 5. Status hook + SSE layer | 0.5 wk | kills polling fleet |
| 6. Frontend primitives | 1 wk | faster Track B/C UI work |
| 7. Auth/testing hardening | 1 wk | regression safety |

Total ≈ 8–10 weeks if done as a block — but it shouldn't be. Items 1–2 are
the prerequisite spine (do first, ~4–5.5 wks); items 3–7 interleave with the
feature tracks as their needs arise.
