---
name: er-seo-tools-architecture-contract
description: Use when working on er-seo-tools and you need to know WHY the code is shaped the way it is — job queue/claim/fencing questions, site-audit status flow, "why is this transaction array-form", "why does AdaAudit have no updatedAt", findings dual-write or blob-pruning behavior, canonical SEO run selection (sf-upload vs live-scan), auth cookie mechanics, cascade/SetNull deletion, or browser-pool design. Consult before changing lib/jobs, lib/findings, prisma/schema.prisma, auth, or recovery code.
---

# ER SEO Tools — Architecture Contract

Overview: this skill states the load-bearing design decisions of er-seo-tools, WHY each holds (most were bought with a production incident), the invariants that must not break, and the known weak points. Every invariant carries a `file:line` citation so you can re-read the source before touching it.

**Merge-state warning:** written 2026-07-02 on branch `feat/autonomous-live-seo-source` (23 commits ahead of main, not merged, not deployed). One section — canonical-run selection — differs between main and this branch; both states are documented. Everything else was verified identical in spirit on the branch checkout. Re-verify commands are in the final section.

## When to use
- Before modifying anything under `lib/jobs/`, `lib/ada-audit/`, `lib/findings/`, `lib/auth*`, `middleware.ts`, or `prisma/schema.prisma`.
- When a review comment or bug hypothesis touches concurrency, recovery, retention, or run selection.
- When you need the "why" behind a pattern you're tempted to simplify.

## When NOT to use
- Step-by-step "add a route / job type / migration" checklists → `er-seo-tools-extension-recipes`.
- Symptom-first triage of a live bug → `er-seo-tools-debugging-playbook`.
- The incident history behind these rules in narrative form → `er-seo-tools-failure-archaeology`.
- Env vars and prod tuning values → `er-seo-tools-config-and-flags`.
- Deploy/PM2/logs/migrations on the server → `er-seo-tools-run-and-operate`.

---

## 1. SQLite concurrency contract (the ground everything stands on)

The stack is Prisma + SQLite with ONE write lock, WAL mode, and `busy_timeout = 5000` (`lib/db.ts:20-34`, PRAGMAs applied via `$queryRawUnsafe` because some PRAGMAs return rows). Consequences, all non-negotiable:

| Rule | Why | Where enforced |
|---|---|---|
| Array-form `$transaction([...])` ONLY — never `prisma.$transaction(async tx => ...)` | Interactive txns hold the write lock across event-loop round-trips; concurrent pdfjs parsing starved the loop and every other writer timed out ("Operations timed out", 2026-06-10 prod incident) | CLAUDE.md "Do not"; warning comments embedded in `lib/jobs/handlers/psi.ts`, `pdf-scan.ts`, `site-audit-page.ts` |
| Conditional logic goes in SQL (`EXISTS` predicates inside raw statements), not in app code between reads and writes | You cannot hold a lock across awaits, so read-then-write is always racy; the SQL predicate makes the write self-guarding | e.g. discover claim `lib/jobs/handlers/site-audit-discover.ts:73-81`; page settle `site-audit-page.ts:171-186` |
| Raw SQL must set `"updatedAt" = ${Date.now()}` manually (integer ms) | Raw SQL bypasses Prisma's `@updatedAt`, and `SiteAudit.updatedAt` is the staleness heartbeat — forgetting it makes healthy long audits get killed by the 5-min stale sweep | every raw counter bump, e.g. `site-audit-page.ts:172-175`, `site-audit-discover.ts:73-75` |
| `createMany` has no `skipDuplicates` on SQLite → per-row `create` with P2002 catch | SQLite connector limitation | `site-audit-discover.ts` child creation, `lib/ada-audit/carry-forward-checks.ts` |
| Chunk bulk inserts at 50 rows | 999 bound-variable limit; CrawlPage has ~17 columns (50×17=850) | `lib/findings/writer.ts:13` |
| Multiple NULLs are allowed in unique indexes | Relied on by `@@unique([siteAuditId, tool])` (session-origin runs have NULL siteAuditId) and `@@unique([scheduleId, scheduledFor])` (ad-hoc jobs have NULLs) | `prisma/schema.prisma:340,374` |

## 2. Durable job queue

All background work — ADA audits, site-audit pages, PDFs, PSI, reports, maintenance — runs through a single in-process worker over the `Job` table (`lib/jobs/worker.ts`). It replaced in-memory pools and fire-and-forget loops after real incidents; the payoff is that every phase survives a restart.

**Mechanics (each is an invariant):**

- **Conditional-update claim** — `findFirst` best queued candidate, then `updateMany WHERE {id, status:'queued'}` setting `status:'running'`, `attempts:{increment:1}`; `count===1` wins, 0 loops to the next candidate (`worker.ts:87-109`).
- **Attempt fencing** — the post-claim `attempts` value is a fencing token. EVERY later write (15 s heartbeat, settle) is fenced `WHERE {id, status:'running', attempts:token}`; a fenced write matching 0 rows means the lease was lost and is silently discarded (`worker.ts:5-18,112-118`). This is what makes zombie attempts (timed-out handlers that keep running — `runAxeAudit` ignores the abort signal) harmless at the queue layer. The domain layer must ALSO be idempotent and fence its own writes (see §3).
- **Heartbeat / stale sweep** — heartbeat every `HEARTBEAT_MS=15s`; `sweepStaleJobs` (60 s) re-queues or errors `running` rows with heartbeat older than `STALE_HEARTBEAT_MS=2min` (`lib/jobs/config.ts:12-13`, `lib/jobs/recovery.ts`).
- **Settle + backoff** — success→`complete`; failure at `attempts>=maxAttempts`→`error` + best-effort `onExhausted` domain hook (invoked from ALL THREE error-flip paths — final settle, stale sweep, startup recovery — and only when the fenced error write matched 1 row); else re-queue with `min(base·2^(attempt−1), 15min)` backoff (`worker.ts:56-58`, cap in `config.ts:10`).
- **Per-type config** — concurrency/maxAttempts/timeout/backoff registered per handler; `lib/jobs/handlers/register.ts:22-36` is the single truthful catalog of all 13 job types. **The schema comment on `Job.type` (`schema.prisma:322`) is stale and lists 1 of 13 — never trust schema comments for unions; there are no enums in this schema at all.**
- **Active-window dedup** — partial unique index `jobs_active_dedup ON Job(type, dedupKey) WHERE ... status IN ('queued','running')`, raw SQL because Prisma cannot express partial indexes (`prisma/migrations/20260610173014_job_queue_and_schedule/migration.sql:63-64`). P2002 on enqueue does NOT guarantee a visible twin (it can go terminal between create and lookup) — `enqueueJob` retries the create once (`lib/jobs/queue.ts`).
- **Exactly-once-per-slot schedules** — `@@unique([scheduleId, scheduledFor])` on Job survives terminal status (`schema.prisma:340`). `tickSchedules` enqueues the due slot, then CONDITIONALLY advances `nextRunAt WHERE nextRunAt unchanged` (`lib/jobs/scheduler.ts:111-147`); a crash between the two replays the slot into the unique index harmlessly. Missed slots collapse because `nextRun()` computes from now.
- **Group-key semantics** — `site-audit:<id>` MEANS "this audit is alive" to recovery. `report-render` deliberately uses `report:<id>` instead (`lib/jobs/handlers/report-render.ts:5-8`); `broken-link-verify` is the one sanctioned reuse of the audit group because it is enqueued strictly post-terminal (`broken-link-verify.ts:1-16`). Attaching a long-lived job to `site-audit:<id>` on a non-terminal audit makes recovery resume it forever.
- **Single-process assumption** — concurrency accounting is an in-memory Map; a second Node process would be over-concurrent but not corrupt (`worker.ts:16-18,33`). PM2 must never run this app in cluster mode.
- **Boot order is a dependency chain** (`instrumentation.ts`): register handlers → `recoverJobsOnStartup` (may run `onExhausted`, needs the registry) → `recoverQueue` (awaited; needs orphaned jobs already re-queued so parents with jobs resume) → `seedSystemSchedules` → `startJobWorker`.
- **Handler modules use dynamic imports** to break the cycle worker → handlers → queue-manager → jobs/queue → worker (finalizer's promoter kick, `site-audit-finalizer.ts:95-100`). A new handler that statically imports queue-manager will likely recreate the cycle.

## 3. Site-audit phase model

`queued → running → (pdfs-running | lighthouse-running) → complete` (or `error`/`cancelled`).

| Invariant | Statement | Where |
|---|---|---|
| One-active-audit | Enforced at the DB, not in memory: the discover job's raw claim is `UPDATE ... WHERE status='queued' AND NOT EXISTS (any SiteAudit IN transient statuses)` | `site-audit-discover.ts:73-81` |
| Stateless promoter | `processNext()` is deliberately mutex-free; it may race, and that is safe ONLY because the claim above is the real enforcement. Do not "fix" it with in-memory locking, and never remove the claim guard | `lib/ada-audit/queue-manager.ts` |
| Discovery guard | A `running` audit with `discoveredUrls === null` is NEVER finalized — all counters are legitimately 0 and the drain predicate would lie. `discoveredUrls` + `pagesTotal` are always written together (first-writer-wins) so every retry fans out the same URL set | `site-audit-finalizer.ts:43-48`; persist in `site-audit-discover.ts` |
| pdfsTotal-before-pagesComplete | `dispatchPdfScans` commits PdfAudit rows + `pdfsTotal++` BEFORE the page settle bumps `pagesComplete`; otherwise the finalizer can observe pages drained while `pdfsTotal` is missing rows and complete early | `site-audit-page.ts:261-270`; same shape in `handlers/ada-audit.ts:19-21` |
| Atomic page settle | One array-form txn: raw parent counter bump guarded by `EXISTS` over the pre-flip child state (+ manual `updatedAt`), plus conditional child flip; caller finalizes OUTSIDE the txn only when `flipped.count===1` | `site-audit-page.ts:164-186` |
| First terminal writer wins | Every standalone-audit write after the claim — progress included — is fenced by `status='running'`; a zombie attempt can never clobber a settled row | `handlers/ada-audit.ts:8-13,67-119` |
| Single decision point | `finalizeSiteAudit` alone flips terminal state: scalar-first read, early-return on terminal/queued, drain predicates over counters (`>=`), pdfs-running priority, children loaded ONCE at completion with deterministic `orderBy [{createdAt:'asc'},{id:'asc'}]` (findings keep-first dedupe must pick the same child everywhere) | `lib/ada-audit/site-audit-finalizer.ts:25-88` |
| Hook order in the finalizer | complete write → batch close → promoter kick → carry-forward (fire-and-forget) → findings dual-write (fire-and-forget) → `enqueueBrokenLinkVerify` LAST (group reuse is only safe post-terminal) | `site-audit-finalizer.ts:90-139` |
| Domain vs infrastructure errors | `runAxeAudit` throwing is a DOMAIN result (child settles `error`, job completes, no retry); DB failures THROW so the queue retries. Never conflate the two | header comments, `site-audit-page.ts` / `handlers/ada-audit.ts:15-18` |
| Finalize-failure = warn-and-continue | If finalize fails after a committed settle, do NOT retry the job — a retried handler matches 0 rows on its claim and never reaches finalize. Another settle or stale recovery picks it up | `handlers/psi.ts` header |

## 4. Recovery model

One generic treatment for all transient parents, applied from two hooks — `resetStaleAudits` (10-min schedule; `updatedAt` older than 5 min) and `recoverQueue` (boot, all transient audits) — in `queue-manager.ts:267-424`:

1. Count active jobs in `site-audit:<id>`. **A read error SKIPS the row this pass** — a transient SQLITE_BUSY must never bias toward destruction. Never "treat error as 0 jobs".
2. `>0` jobs → resume (leave alone; active includes queued-in-backoff).
3. `0` jobs → ONE `finalizeSiteAudit` attempt (drained-but-unfinalized audits complete here).
4. Still transient → `failSiteAudit`: a conditional flip `WHERE status notIn terminal` (never clobbers complete/cancelled), then orphan child/PDF fail, `cancelJobsByGroup` (queued only — running jobs finish and their fenced writes no-op), batch close, promoter kick.

**Why the heartbeat is `updatedAt`:** every Prisma write auto-bumps it, and every raw counter bump sets it manually — so a healthy audit of any length never looks stale, without a dedicated heartbeat column.

**Why AdaAudit deliberately has NO `updatedAt`** (`schema.prisma:81-117` — the model carries none; SiteAudit's is at `:122`): standalone-audit liveness comes from durable-job state instead — orphan = zero active jobs in group `ada-audit:<id>` AND `createdAt` older than a 5-min race guard (covers the seconds-wide create→enqueue window) (`lib/ada-audit/standalone-recovery.ts:1-18`). Adding `@updatedAt` "for consistency" changes nothing recovery uses; copying SiteAudit's stale logic there without the column would silently never fire.

**Satellite recoveries ride the same two hooks** (`queue-manager.ts:370-424`): standalone audits, stranded broken-link verifiers (`lib/ada-audit/broken-link-recovery.ts:12-54` — complete audit + surviving transient rows + no live-scan run + no active verify job → AWAITED re-enqueue), and stranded SeoReports. All are guarded catches: a satellite failure never blocks site-audit recovery.

## 5. Findings layer (A2, plus the C3 diffing and C5 ingestion phases)

Three data tiers: **origin blobs** (`Session.result`, `SiteAudit.summary`, `AdaAudit.result` — JSON strings, 90-day convenience archive), **normalized findings subtree** (`CrawlRun → CrawlPage/Finding/Violation` — the durable canonical record), and **transient C6 (broken-link verifier) tables** (`HarvestedLink`, `HarvestedPageSeo` — deleted by their consumer, 7-day sweep backstop).

- **Dual-write is fire-and-forget AFTER the legacy commit** and must never fail or delay the legacy path: `void writeFindingsRun(bundle).catch(log)` (`site-audit-finalizer.ts:111-130`; parse route; `handlers/ada-audit.ts`). A failure logs `[findings] ... dual-write failed`; the repair is `npx tsx scripts/findings-rebuild.ts <id>` (id type auto-detected; refuses pruned blobs). `scripts/findings-parity.ts <id>` verifies blob-vs-tables.
- **Writer is idempotent delete-and-recreate** in ONE array-form txn, chunked at 50, and enforces exactly one origin FK (`lib/findings/writer.ts:21-45`). Safe to re-run; this is the backbone of retry safety and the rebuild script.
- **Cascade topology**: origin FKs on CrawlRun (`sessionId`, `siteAuditId`, `adaAuditId`) are `onDelete: SetNull` — deleting an origin never destroys findings history; the subtree cascades from CrawlRun down only (`schema.prisma:357-361` region; CrawlPage/Finding/Violation FKs). Never backfill pre-A2 historical blobs into findings rows (house rule).
- **Identity discipline**: dedup keys are sha256 of canonical JSON, never hand-joined strings (`lib/findings/keys.ts`); URLs go through `normalizeFindingUrl`; severity is exactly `critical|warning|notice`.
- **Blob archival**: `pruneArchivedBlobs` (in `runCleanup`) nulls origin blobs 90 days after completion, gated by `PRUNE_ACTIVATED` (both tools `true` as of 2026-07-02), stamping `CrawlRun.archivePrunedAt` (`lib/findings/retention.ts:30-70`). It is **tool-origin-aware**: seo-parser prunes ONLY session-origin runs, because a live-scan seo-parser run carries `siteAuditId` but owns no blob — matching on siteAuditId would null `SiteAudit.summary`, which belongs to the ADA run (`retention.ts:52-65`). Breaking this destroys ADA summaries 90 days early.
- **Read-time degradation contract**: after pruning, every read surface serves a findings-table fallback (`lib/ada-audit/findings-fallback.ts`, `lib/findings/seo-findings-fallback.ts`) with `archived: true` and unknowns OMITTED — rendered as "—", never fabricated as 0. Four routes refuse degraded operation with 409 `session_archived` — diff (`app/api/diff/route.ts:61`), claude export (`app/api/export/[sessionId]/claude/route.ts:35`), seo-roadmap and keyword-memo (`:37` each) — and ONLY when `archivePrunedAt` exists; a null blob without the stamp keeps legacy errors. Never treat "null blob" alone as "archived".
- **Compound-unique access split** (C6, `schema.prisma:374`): one SiteAudit carries up to TWO runs (ada-audit + seo-parser live-scan). `findUnique`/`update` need `{ siteAuditId_tool: { siteAuditId, tool } }`; `deleteMany`/`findMany`/`count` take the plain `{ siteAuditId, tool }` filter (`writer.ts:30-36`). Getting the `tool` wrong silently reads the OTHER run.

## 6. C6 live-scan architecture + canonical-run selection

**Pipeline:** the ADA page job harvests links + on-page SEO in one `page.evaluate` and persists them to the transient tables ONLY after a WON settle (a zombie attempt writes none — `site-audit-page.ts:298-301`). On terminal `complete`, the finalizer fire-and-forget enqueues `broken-link-verify` — the **single live-scan run builder**: one `runId`, one shared `ensurePage` map, reads both transient tables, verifies deduped internal targets (deterministic order so the 2000-target cap is stable across retries), computes `scoreLiveSeo` BEFORE deleting the transient rows, writes ONE run `{tool:'seo-parser', source:'live-scan'}` via `writeFindingsRun`, THEN deletes both tables (`lib/jobs/handlers/broken-link-verify.ts:232-256`). Crash-before-write → rows linger → retry redoes it; crash-after-write → the 7-day sweep cleans up while a retry is a harmless delete-and-recreate. Do not "optimize" by deleting earlier.

**`scoreLiveSeo` null rules** (`lib/findings/live-seo-score.ts:28-32`): null when `attempted <= 0`, when `observed/attempted < 0.5`, or when `indexableScored <= 0` (noindex/login-walled → unscoreable). `observed` = HarvestedPageSeo row count, NOT `pagesComplete` (the best-effort persist runs after the counter bump; using the counter would let an under-observed site score). Crawl-depth and broken-links are NEVER in the denominator — the live audit has no comparable crawl graph.

**Canonical-run selection — TWO states exist as of 2026-07-02:**

| State | Behavior | Evidence |
|---|---|---|
| **main** (deployed lineage) | A live-scan run can NEVER be canonical: `selectRuns` keeps the newest sf-upload as the SEO health run and exposes the latest live-scan separately ("the … run must not displace the sf-upload health run") | `git show main:lib/services/findings-shared.ts` lines ~62-78 |
| **branch `feat/autonomous-live-seo-source`** (checked out, unmerged) | `selectRuns` delegates to `pickCanonicalSeo` (`lib/services/seo-canonical.ts:46-68`): a fresh sf-upload (≤ `SEO_SF_CANONICAL_WINDOW_DAYS`, default 30, env-overridable) wins unconditionally; a NEWER `seoIntent=true` live-scan supersedes a stale/absent SF; a non-seoIntent live-scan (ordinary verifier run) can still NEVER be canonical; `seo.liveScan` is populated only when it is not the canonical (no double-count) | `lib/services/findings-shared.ts:8,66-86` |

CLAUDE.md's "a live-scan run NEVER displaces the score" describes **main**. Before relying on either behavior, run:

```
git branch --show-current && grep -n pickCanonicalSeo lib/services/findings-shared.ts
```

(hits → branch semantics; no hits → main semantics). `seoIntent` columns live at `schema.prisma:148` (SiteAudit) and `:352` (CrawlRun), added by migration `20260630120000_live_seo_source` — branch-only until merged. seoIntent schedules are operator-created via `POST /api/clients/[id]/schedules`; there is no self-healing auto-creation in the code (a handoff-doc fabrication — see er-seo-tools-failure-archaeology entry 16).

## 7. Auth model

- **Cookie**: `er_auth` = base64url(JSON `{v,sub,email,hd,name,exp}`) + `.` + HMAC-SHA256 (WebCrypto), TTL 12 h (`lib/auth.ts:1-4`). `SESSION_VERSION = 2` (`lib/auth.ts:3`) is checked on every read (`:178`) — bumping the constant is the instant global-logout lever, no DB change.
- **Signing secret**: `APP_AUTH_SECRET` required in prod; the code explicitly REFUSES to fall back to `APP_AUTH_PASSWORD` in production (a leaked password must not also forge cookies) (`lib/auth.ts:81-90`). Rotating it invalidates all cookies AND in-flight OAuth handshake tokens.
- **OAuth**: Google ID token verified with clientId audience; hosted-domain gate + per-`User.active` revocation (`lib/auth/identity.ts:52-54` — deactivate without deleting history). Handshake state/nonce/code_verifier ride a short-lived signed token (`createSignedToken`, `lib/auth.ts`).
- **Break-glass**: password login mints synthetic identity `sub='password:break-glass'` (`lib/auth.ts:7-8` region).
- **Operator cookie**: `er-operator-name`, unsigned, JS-readable, 1-year, 64-char cap — attribution only, never a credential; `getOperatorLabel` prefers the VERIFIED session identity over it (`lib/auth.ts:24-52`).
- **Dev trap**: the dev bypass keys on `APP_AUTH_PASSWORD` being UNSET (`isAuthBypassedInDev`, `lib/auth.ts`) — setting it in a local `.env` silently turns the login gate ON.
- **Middleware ordering is load-bearing** (`middleware.ts`): public-path/token-route check returns BEFORE the CSRF same-site check (`:60-71`), so token-authed skill-handoff routes never see it. The allowlist (`PUBLIC_PATH_PREFIXES :5-13`, exact paths `:15-25`, token-route regexes `:34-50`) has been missed three times historically — any `isPublicPath` change must update `middleware.test.ts`. Matcher: `['/((?!.*\\..*).*)', '/api/:path*']` (`:87-89`).

## 8. Schema topology (27 models, zero enums)

- All status/type unions are comments, and **schema comments lie** (see `Job.type` at `schema.prisma:322`). Truth sources: `lib/jobs/handlers/register.ts` for job types; the owning module for status vocab.
- `Client.domains` is a JSON-string array, not a relation (`schema.prisma:19`).
- Compound uniques that ENCODE idempotency — treat as API, not just constraints: `Job @@unique([scheduleId, scheduledFor])` (:340, exactly-once slots), `CrawlRun @@unique([siteAuditId, tool])` (:374, two runs per audit), `Finding @@unique([runId, dedupKey])` (:478), `AdaAudit @@unique([siteAuditId, url])` (:110), `SeoReportBatch @@unique([scheduleId, scheduledFor])` (:579), `SeoReport @@unique([batchId, clientId])` (:610), `ProspectsEntry @@unique([clientId, periodStart, periodEnd])` (:628).
- Deletion semantics: children Cascade from parents (AdaAudit→SiteAudit, PdfAudit, checks, Harvested*→SiteAudit, subtree→CrawlRun); origin/history FKs SetNull (CrawlRun's three origins, SiteAudit→Schedule, →Client everywhere). `PillarAnalysis` is dual-keyed on this branch: `sessionId` Cascades, `crawlRunId` SetNulls (`schema.prisma:174-179`).
- `SessionPage` (:242) still exists but is no longer written — legacy read fallback only; model drop planned ≥180 d after 2026-06-11.

## 9. Browser pool contract

One singleton Chrome behind a semaphore of `BROWSER_POOL_SIZE` slots (code default 2 `lib/ada-audit/browser-pool.ts:6`; prod 4 `ecosystem.config.js:26`). Recycle gate drains the pool and restarts Chrome every `SITE_AUDIT_BROWSER_RECYCLE_PAGES` pages (default 25 `:81`, prod 15); idle close after 60 s (`:78`).

- **Cardinal rule: never hold a page across awaits you don't control.** Build ALL data and HTML first, then `acquirePage()`, do only `setContent`/`pdf`/`evaluate` while holding, `releasePage()` in `finally`. A leaked page is a permanently lost slot, and the recycle drain parks ALL new acquirers until every active page releases. Pattern to copy: `lib/jobs/handlers/report-render.ts`.
- **Sizing**: each Chrome page is ~150-200 MB resident; prod Node runs at 2048 MB max-old-space with PM2 restart at 2400 M (`ecosystem.config.js:15,23`). CLAUDE.md forbids `BROWSER_POOL_SIZE > 4` without checking VPS headroom.
- In production, browser launch THROWS without an egress guard (`CHROME_PROXY_SERVER` or `CHROMIUM_NETWORK_ISOLATED=true`, `lib/ada-audit/browser-egress.ts`).
- Fragile spot: `lib/ada-audit/seo/parse-seo-dom.ts` is injected into pages via `.toString()` and must stay perfectly self-contained — no module-scope references, no constructs SWC compiles to escaping helpers (a `typeof` once compiled to an out-of-scope `_type_of` that would ReferenceError in-page). Re-check compiled output after any edit.

## 10. Known weak points (stated plainly, as of 2026-07-02)

1. **First-match-wins bidirectional client-domain matching** — inline in `app/api/parse/[sessionId]/route.ts:210-221`, no shared service: `normHost === nd || normHost.endsWith('.'+nd) || nd.endsWith('.'+normHost)`, first non-archived client in default findMany order wins. A client registered with `campus.example.edu` claims sessions for `example.edu` and sibling subdomains; overlaps resolve silently. Source of "wrong client" attribution bugs.
2. **In-memory upload rate limit** — 500 MB/hr/IP in a process-local `Map` (`app/api/upload/route.ts:21-29`); every deploy/PM2 restart zeroes it. Do not claim it is durable.
3. **Single-process assumption** — the job worker's concurrency accounting is in-memory (`worker.ts:16-18,33`). PM2 cluster mode or a second instance would be over-concurrent (blowing the Chrome/memory budget), though not corrupt. There is no multi-instance safety design.
4. **No monitoring/alerting** — failures surface only in `/home/seo/logs/` greps and the UI; a dead schedule or repeated dual-write failure is silent until someone looks.
5. **Backup state unverified** — no backup tooling exists in the repo; whether the prod SQLite file is backed up is unknowable from here. Treat `/home/seo/data/seo-tools/db.sqlite` as precious.
6. **SessionPage legacy fallback** — pre-A2 sessions read `SessionPage` verbatim; the model drop is planned ≥180 d after 2026-06-11 and someone must actually do it.
7. **README staleness** — `README.md` (last touched 2026-05-14) still lists quarter-grid v1/v2/v3 as live tools (all three are 4-line redirects) and omits `/reports` and `/settings`. CLAUDE.md is the better map; the branch diverges from even that on canonical-run selection (§6).
8. **Handoff-doc overclaims** — tracker/handoff docs describe three unbuilt C6 Phase 4 features (self-healing schedules, `lib/seo/providers/`, live srt_/krt_ memos); plan + code are ground truth — see er-seo-tools-failure-archaeology entry 16 for the claim-vs-truth table.

## Common mistakes

- Writing an interactive `$transaction(async tx => ...)` because "it's just one small write" — this is the exact shape of the 2026-06-10 outage. Array-form only, always.
- Forgetting manual `updatedAt` in a raw SQL bump → healthy audits killed by the 5-min stale sweep.
- Treating a job-count read error as "0 jobs" in recovery code → healthy audits destroyed on a transient SQLITE_BUSY.
- Using `{ siteAuditId }` alone to find a CrawlRun post-C6 → compile error or silently reading the wrong tool's run.
- Putting a new long-lived job in group `site-audit:<id>` for a non-terminal audit → recovery resumes the audit forever.
- Adding retry logic at the wrong layer of the runner (HTTP-5xx retry vs fresh-page transient retry vs PSI backoff are three deliberately narrow, separate layers).
- Quoting CLAUDE.md's canonical-run invariant without checking the merge state (§6).
- "Cleaning up" the mutex-free promoter, the fake-Chrome sitemap User-Agent, the missing AdaAudit `updatedAt`, or the seo-parser prune filter — each looks like an oversight and is a decision.

## Provenance and maintenance

Written 2026-07-02 against branch `feat/autonomous-live-seo-source` at commit `36de2cb` (23 commits ahead of main tip `6679993`; unmerged, undeployed). Sections 1-5, 7-9 were verified byte-level identical in intent on this checkout and match CLAUDE.md's description of main; §6 documents both merge states explicitly. All `file:line` citations were read directly from this checkout — line numbers may drift; the grep commands below survive drift.

Re-verification one-liners:

| Volatile fact | Command |
|---|---|
| Merge state / canonical selection | `git branch --show-current && grep -n pickCanonicalSeo lib/services/findings-shared.ts` |
| SF freshness window (30 d default) | `grep -n SEO_SF_CANONICAL_WINDOW_DAYS lib/services/seo-canonical.ts` |
| Job-type catalog (13) + per-type config | `grep -rn 'registerJobHandler({' -A6 lib/jobs/handlers/ --include='*.ts' \| grep -v test` |
| Queue timing constants | `cat lib/jobs/config.ts` |
| Prod tuning values | `grep -n 'BROWSER_POOL\|CONCURRENCY\|LIGHTHOUSE\|RECYCLE\|memory' ecosystem.config.js` |
| PRUNE_ACTIVATED flags | `grep -n -A4 PRUNE_ACTIVATED lib/findings/retention.ts` |
| 409 session_archived surfaces | `grep -rn session_archived app --include='*.ts' \| grep -v test` |
| Model count / uniques / seoIntent | `grep -c '^model ' prisma/schema.prisma && grep -n 'seoIntent\|@@unique' prisma/schema.prisma` |
| Middleware allowlist | `sed -n '5,50p' middleware.ts` |
| SESSION_VERSION + cookie TTL | `sed -n '1,5p' lib/auth.ts` |
| scoreLiveSeo null rules | `sed -n '28,35p' lib/findings/live-seo-score.ts` |
| Finalizer hook order | `sed -n '90,140p' lib/ada-audit/site-audit-finalizer.ts` |
| Recovery treatment | `sed -n '300,360p' lib/ada-audit/queue-manager.ts` |
| SessionPage still present | `grep -n 'model SessionPage' prisma/schema.prisma` |
| Latest migration | `ls prisma/migrations \| tail -3` |

If any command's output contradicts this skill, trust the code and update this file in the same PR.
