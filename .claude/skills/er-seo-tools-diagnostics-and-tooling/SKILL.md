---
name: er-seo-tools-diagnostics-and-tooling
description: Use when you need current-state numbers from er-seo-tools before (or without) diagnosing — queue depth and drain state, heartbeat/staleness ages, whether an audit is stuck or working, findings coverage and blob-archive state, whether the prod build survived minification, odd scores, inspecting db.sqlite, findings-rebuild/parity usage, or log grepping by subsystem tag. Triggers: "is it stuck", "check the queue", "did the dual-write land", "what state is this in".
---

# ER SEO Tools — Diagnostics and Tooling

## Overview

The instrument panel for this app: read-only scripts, SQL, and log-grep recipes that turn "it looks stuck" into numbers. Every fact the recovery machinery uses (job heartbeats, `updatedAt` staleness, job-group liveness, findings coverage) is queryable — measure it before touching anything.

Core principle: **the DB and logs already know the answer.** SiteAudit staleness, job liveness, dual-write success, and archive state are all persisted signals; these tools read exactly the signals the code itself acts on.

## When to use / When NOT to use

**Use when** you need current-state facts: queue depth, heartbeat ages, whether an audit will be resumed or failed by the next sweep, which runs are scored/archived, whether a dual-write failed, whether the prod build carries the parser keys.

**Do NOT use for:**
- Symptom → root-cause triage ("audit failed with X error") → `er-seo-tools-debugging-playbook`. This skill tells you *what state things are in*; that one tells you *why* and what experiment discriminates.
- Deploy/PM2/restart/migration operations → `er-seo-tools-run-and-operate`.
- "What counts as evidence for a PR" / test conventions → `er-seo-tools-validation-and-qa`.
- Historical incidents behind these instruments → `er-seo-tools-failure-archaeology`.

## Ground rules (non-negotiable)

- **Read-only always.** Every script opens SQLite with both `-readonly` and `file:...?mode=ro`. Never run mutating SQL against any DB, dev or prod. Repairs go through the app's own tools (`scripts/findings-rebuild.ts`) or code changes, never hand-written UPDATEs.
- **Prod DB access is via SSH read commands only** (`ssh seo@144.126.213.242`). Reading logs and running these read-only scripts on the server is fine; any mutation (deploy, PM2, DB writes) requires Kevin — see `er-seo-tools-change-control`.
- **DateTime columns are integer epoch-milliseconds** in this SQLite schema (Prisma storage format; verified against `prisma/local-dev.db`). Compare with `strftime('%s','now')*1000`, render with `datetime(col/1000,'unixepoch')`. A comparison against a datetime *string* silently matches nothing.
- **SQLite `||` binds tighter than `+`**: `a + b || '/' || c` computes `a + (b||'/'||c)` and coerces to a number. Parenthesize arithmetic before concatenating.

## DB paths

| Environment | Path | Notes |
|---|---|---|
| Local dev | `prisma/local-dev.db` | `DATABASE_URL=file:./local-dev.db` resolves relative to `prisma/` |
| Production | `/home/seo/data/seo-tools/db.sqlite` | WAL mode; read-only opens never block the app |
| Stale local | `prisma/dev.db`, `prisma/prisma/*` | Leftovers — ignore |

Table names equal Prisma model names verbatim (no `@@map` anywhere): `Job`, `Schedule`, `SiteAudit`, `AdaAudit`, `Session`, `CrawlRun`, `CrawlPage`, `Finding`, `Violation`, `HarvestedLink`, `HarvestedPageSeo`, `Client`, …

## The four instruments

All live in `.claude/skills/er-seo-tools-diagnostics-and-tooling/scripts/`. All take the DB path as first argument (default `prisma/local-dev.db`); all are read-only and safe on a live prod DB or a copy. `findings-coverage.sh` probes for the branch-only `CrawlRun.seoIntent` column (migration `20260630120000_live_seo_source`) and falls back to a `0` literal on a main/prod schema, so it runs anywhere.

```bash
bash .claude/skills/er-seo-tools-diagnostics-and-tooling/scripts/queue-state.sh        [db]
bash .claude/skills/er-seo-tools-diagnostics-and-tooling/scripts/audit-state.sh        [db]
bash .claude/skills/er-seo-tools-diagnostics-and-tooling/scripts/findings-coverage.sh  [db] [clientId]
bash .claude/skills/er-seo-tools-diagnostics-and-tooling/scripts/prod-build-check.sh   [build-dir]   # after npm run build
```

### 1. queue-state.sh — durable Job queue snapshot

Sections: counts by type+status → queued backlog (age, ready vs backoff) → running (heartbeat age) → recent errors (attempts, lastError) → schedules (next slot, OVERDUE flag).

**Reading heartbeat age.** The worker heartbeats every 15 s (`HEARTBEAT_MS`, `lib/jobs/config.ts`); the 60 s stale sweep requeues/fails any running job whose heartbeat is older than 2 min (`STALE_HEARTBEAT_MS`). So: `hb_age_s` ≤ ~20 s = healthy; 20–120 s = worker busy or process just died; > 120 s = will be swept within a minute — if it *stays* > 120 s across passes, the worker loop itself is down (check PM2 / `[jobs] worker tick failed`).

**Reading runtime against timeout.** A handler is killed at its `timeoutMs`; runtime approaching the budget predicts a retry, and a job repeatedly swept near the same runtime is a handler that structurally exceeds its budget, not a flaky one. Rough anchors: audit-shaped jobs run on 300 s budgets, PSI/PDF/report renders 120 s, the broken-link verifier 900 s. The full per-type table (concurrency, maxAttempts, timeoutMs for all 13 job types) lives in er-seo-tools-config-and-flags.

**Backoff:** requeued failures wait `min(30s × 2^(attempt−1), 15 min)` (`backoffBaseMs` varies: 15 s report renders, 60 s verifier). A queued job showing `gate=backoff` is *waiting on purpose* — not stuck.

**Retention:** terminal Job rows are pruned at 7 d (complete/cancelled) / 30 d (error) — an empty error section only proves the last 30 days.

**Schedules:** the tick runs every 60 s; `OVERDUE` (> 2 min past `nextRunAt` while enabled) on a healthy box means the worker isn't ticking. The three `system-*` rows (cleanup `daily@09:00`, screenshot-sweep `every:30m`, stale-audit-reset `every:10m`) are reseeded at every boot — a manual DB disable will not stick.

### 2. audit-state.sh — "stuck or working?"

Joins transient `SiteAudit`/`AdaAudit` rows against the exact liveness signals recovery uses, and prints a verdict:

| Verdict | Meaning | What happens next (no action needed) |
|---|---|---|
| WORKING | active jobs in group `site-audit:<id>` | recovery leaves it alone (this count includes queued-in-backoff) |
| SETTLING | 0 jobs but `updatedAt` < 5 min old | a settle just landed; finalizer or promoter is imminent |
| STUCK | 0 jobs, `updatedAt` ≥ 5 min stale | the 10-min `stale-audit-reset` sweep tries ONE finalize, then fails the audit |

Key facts encoded (verified `lib/ada-audit/queue-manager.ts`, 2026-07-02): `STALE_MS` = 5 min; sweep cadence 10 min; `SiteAudit.updatedAt` is the heartbeat (every job settle bumps it — raw-SQL bumps set it manually); transient statuses are `running | pdfs-running | lighthouse-running`. Standalone `AdaAudit` has **no `updatedAt` column by design** — job-group liveness (`ada-audit:<id>`) plus a 5-min `createdAt` race guard is its truth (`lib/ada-audit/standalone-recovery.ts`).

Reading the site-audit row: `discovered=no` with `status=running` means the discovery guard is active — the finalizer will never complete it; it needs its `site-audit-discover` job (WORKING) or it is failure-bound (STUCK). `pages 3+1/10` = 3 complete + 1 error of 10. Only one site audit runs at a time (DB-level `NOT EXISTS` claim), so several queued rows behind one WORKING row is normal FIFO, not a fault.

The last section surfaces **stranded broken-link verifiers** (complete audit + surviving harvest rows + no live-scan run + no job): non-empty means the fire-and-forget enqueue crash window was hit; boot recovery and the 10-min sweep re-enqueue automatically — persistent rows across sweeps are the actual anomaly.

### 3. findings-coverage.sh — findings-layer inventory

Sections: `CrawlRun` rollup (tool × source × seoIntent: runs / scored / archived) → recent-20 run listing with client, score, origin-blob state → dual-write gap candidates → transient harvest backlog.

**Interpreting scores on CrawlRun** (`CrawlRun.score`): seo-parser sf-upload = health score 0–100; ada-audit = weighted axe penalty score 0–100; seo-parser live-scan = live SEO score 0–100 **or NULL by design** — `scoreLiveSeo` returns null when observed coverage < 50% of attempted pages, or zero indexable non-login pages (`lib/findings/live-seo-score.ts`). A null live-scan score is a statement ("unscoreable"), not a bug. Sanity ranges: healthy marketing sites usually land 60–95 on both scales; a flood of 0s or exact-100s across runs is a mapper regression, not a real signal.

**Blob column:** `present` = origin JSON blob intact; `null` + `archived=yes` = the 90-day prune ran (read surfaces serve the degraded findings fallback — expected); `null` *without* the archived stamp = broken write or pre-A2 anomaly — investigate. `n/a` = live-scan run (never owns a blob; the `SiteAudit.summary` blob belongs to the sibling ada-audit run — one SiteAudit carries up to two runs via `@@unique([siteAuditId, tool])`).

**Dual-write gaps:** completed origins with no findings run. Pre-A2 (pre-findings-layer) rows created before 2026-06-11 are expected and must NEVER be backfilled (house rule). A *post*-A2 gap = a failed fire-and-forget dual-write; confirm in logs (`[findings] ... dual-write failed`) and repair:

```bash
# Rebuild findings rows from the origin blob (id type auto-detected:
# sessionId | siteAuditId | adaAuditId). Refuses pruned blobs. For a
# siteAuditId it rebuilds ONLY the ada-audit run — the live-scan run is
# owned by the verifier job, never this script.
DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-rebuild.ts <id>
# prod: cd /home/seo/webapps/seo-tools && npx tsx scripts/findings-rebuild.ts <id>

# Blob-vs-tables parity check (same id auto-detection; exit 1 + diff lines
# on mismatch; a pruned blob is a parity failure by design):
DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-parity.ts <id>
```

**seoIntent column:** branch-only as of 2026-07-02 (migration `20260630120000_live_seo_source`, NOT merged/deployed). Canonical-run selection is merge-state-sensitive (branch vs main) — see er-seo-tools-architecture-contract §6; verify: `git branch --show-current && grep -n pickCanonicalSeo lib/services/findings-shared.ts`.

### 4. prod-build-check.sh — the minification discriminator

**The incident it guards:** the parse route once derived each parser's aggregator key from `ParserClass.name`. The production SWC build minifies class names to single letters, so the aggregator's hardcoded `parsedData.internal` (etc.) lookups missed and page_index/keyword data came out **empty in prod only** — dev, tests, and `tsc` were all green. The fix is an explicit `static parserKey = '<literal>'` on every parser (45 as of 2026-07-02) consumed at `app/api/parse/[sessionId]/route.ts:144`; `lib/parsers/parser-key.test.ts` guards the source side.

This script closes the loop on the *built artifact*: after `npm run build` it greps `.next/server/app/api/parse/[sessionId]/route.js` for every `parserKey` literal found in `lib/parsers` source, plus the `.parserKey` property name itself, and exits 1 listing anything missing. Run it whenever you add a parser or touch the build pipeline — it is the only check that runs where the bug lives. Note the route still has a `ParserClass.name` *fallback* (route.ts:145), so a parser missing its literal compiles clean and passes dev testing while being broken in prod — exactly the class of bug this catches.

## Log-grep recipes

Prod logs (via read-only SSH): `/home/seo/logs/seo-tools-error.log` + `/home/seo/logs/seo-tools-out.log` (PM2, `merge_logs`, dated lines). All subsystem logs use a bracketed prefix. Verified tag catalog (2026-07-02):

```bash
ssh seo@144.126.213.242 "grep -F '[findings]' ~/logs/seo-tools-error.log | tail -20"
```

| Tag | Subsystem | What a hit means / first response |
|---|---|---|
| `[findings]` | dual-write + retention | `dual-write failed for session/ada audit/site audit <id>` = legacy path SUCCEEDED, findings tables lag. Fix: `findings-rebuild.ts <id>`. Also logs prune counts (informational). |
| `[jobs]` | worker internals | `stale heartbeat on job=` = a sweep recovered a job (one-off = restart/timeout, chronic = handler exceeding timeoutMs). `worker tick failed` / `settle failed` = queue-layer DB trouble — check disk/locks. `onExhausted hook ... failed` = domain settle lost; parent-level stale recovery cleans up. |
| `[queue]` | site-audit recovery/promoter | `resuming audit` (benign), `finalized drained audit` (recovery completed a done audit), `failing audit <id>` (destructive path taken — find WHY it drained without finalizing), `job count failed ... skipping this pass` (benign: read error never destroys). |
| `[ada-recovery]` | standalone orphan sweep | `failing orphaned standalone audit` = audit lost its job group (usually a deploy mid-run). |
| `[broken-link-verify]` | live-scan builder | `capping N -> 2000 checks` (informational), `exhausted after N attempts` (verifier gave up **this job**; unless a live-scan run was already written, the boot/10-min recovery sweep re-enqueues a fresh verifier — repeated exhaust/re-enqueue cycles are the signal to investigate; harvest rows fall to the 7-d sweep only when a run exists so recovery skips them), `recovery re-enqueued N verifier(s)` (crash-window healed). |
| `[c6]` | harvest persist | `harvest persist failed` / `page-seo persist failed` = best-effort transient write lost — a few unchecked links, not a failure. |
| `[lighthouse-queue]` / `[pdf-orchestrator]` | PSI/PDF fan-out | `durable ... enqueue failed` = child settled as error immediately (counters stay consistent); chronic = queue-layer trouble. |
| `[checks]` | triage carry-forward | carry-forward copy failures — cosmetic, next audit retries. |
| `[schedule]` | scheduled scans | `slot skipped — audit ... already in flight` = duplicate suppression working as designed (no catch-up). |
| `[retention]` | scheduled-audit pruning | deletion counts — informational. |
| `[ada-audit]`, `[live-seo]`, `[upload]`, `[parse]`, `[pillar-analysis]`, `[*-token]`, `[quarter-grid]`, `[stale-audit-reset]`, `[site-audit-finalizer]` | feature-local | grep the tag, read the message — they are written to be self-explanatory. |

## Ad-hoc SQL cheatsheet

```bash
Q() { sqlite3 -readonly -header -column "file:prisma/local-dev.db?mode=ro" "$1"; }

# Everything about one site audit and its job group:
Q "SELECT status, pagesComplete, pagesTotal, pdfsTotal, lighthouseTotal,
          datetime(updatedAt/1000,'unixepoch') AS updated_utc
   FROM SiteAudit WHERE id='<id>';"
Q "SELECT type, status, attempts, substr(COALESCE(lastError,''),1,60)
   FROM Job WHERE groupKey='site-audit:<id>' ORDER BY createdAt;"

# The two runs one SiteAudit can carry (ada-audit + seo-parser live-scan).
# NOTE: the seoIntent column is branch-only (migration 20260630120000_live_seo_source);
# drop it from the SELECT on a main/prod schema:
Q "SELECT tool, source, seoIntent, score, status, pagesTotal
   FROM CrawlRun WHERE siteAuditId='<id>';"

# Finding counts by severity for a run:
Q "SELECT severity, scope, COUNT(*), SUM(count) FROM Finding
   WHERE runId='<runId>' GROUP BY severity, scope;"
```

## Common mistakes

- **Comparing DateTime columns to strings.** Every timestamp is integer ms. `WHERE createdAt > '2026-06-01'` matches nothing; use `> strftime('%s','2026-06-01')*1000`.
- **Calling a `gate=backoff` job stuck.** It is waiting out its retry delay by design; check `runAfter`.
- **Treating a null live-scan score as a bug.** It means < 50% coverage or zero indexable pages — deliberate "unscoreable".
- **Reading the wrong CrawlRun.** Since C6 (the broken-link verifier) a SiteAudit carries up to two runs; always filter by `tool` (`'ada-audit'` vs `'seo-parser'`) or you silently analyze the other one. (In Prisma code: `findUnique` needs `{ siteAuditId_tool: {...} }`.)
- **"Fixing" pre-A2 dual-write gaps.** Origins created before 2026-06-11 legitimately have no findings run. Never backfill.
- **Trusting `SiteAudit.score` / `AdaAudit.score` scalar columns.** The finalizer never persists `SiteAudit.score`; canonical scores live on `CrawlRun.score` (mappers recompute from evidence).
- **Trusting schema comments for type unions.** `Job.type`'s comment lists 4 types; 13 handlers are registered. `lib/jobs/handlers/register.ts` is the only truthful catalog.
- **Running the sweep's logic by hand with writes.** If audit-state says STUCK, the 10-min sweep already handles it. Manual UPDATEs to "unstick" rows bypass first-terminal-writer fencing and can clobber a concurrent settle.
- **Forgetting both read-only guards.** `sqlite3 file.db` (no flags) takes a write lock on first write and can hold the app's writer at `busy_timeout`. Always `-readonly` + `?mode=ro`.

## Provenance and maintenance

Authored 2026-07-02 against branch `feat/autonomous-live-seo-source` (HEAD 36de2cb, unmerged/undeployed, 23 commits ahead of main tip 6679993). Everything except the `seoIntent` COLUMN (branch-only migration `20260630120000_live_seo_source`) and its canonical-selection semantics also holds on main — the cheatsheet's seoIntent query needs the column dropped on a main/prod schema; `findings-coverage.sh` self-adapts via a pragma probe. All SQL validated read-only against `prisma/local-dev.db` AND a main-schema copy (seoIntent columns dropped); `prod-build-check.sh` validated against an existing local `.next` build.

Re-verify volatile facts (run from the repo root):

```bash
# Job-type table (13 handlers) + concurrency/attempts/timeouts
grep -n -A8 'registerJobHandler({' lib/jobs/handlers/*.ts | grep -E 'type:|concurrency|maxAttempts|timeoutMs'
# Heartbeat 15s / stale 2min / backoff cap 15min / poll+sweep intervals
cat lib/jobs/config.ts
# STALE_MS 5 min + transient site-audit statuses
grep -n 'STALE_MS\|TRANSIENT_STATUSES' lib/ada-audit/queue-manager.ts
# System schedule cadences (cleanup daily@09:00, sweep 30m, stale-reset 10m)
sed -n '29,37p' lib/jobs/system-schedules.ts
# Parser key count (45 as of 2026-07-02)
grep -rhoE "static parserKey = '[a-z0-9]+'" lib/parsers | sort -u | wc -l
# Log-tag catalog (single- and backtick-quoted messages)
grep -rhoE "console\.(error|warn|log)\(.\[[a-z0-9-]+\]" lib app --include='*.ts' | grep -oE '\[[a-z0-9-]+\]' | sort | uniq -c
# Branch vs main canonical-SEO semantics (hit = seoIntent branch semantics)
git branch --show-current && grep -n pickCanonicalSeo lib/services/findings-shared.ts
# Live-score null rules (coverage floor, indexable floor)
sed -n '1,40p' lib/findings/live-seo-score.ts
# Blob-prune activation flags + 90-d window
grep -n 'PRUNE_ACTIVATED' -A4 lib/findings/retention.ts
# Terminal-job retention (7 d complete/cancelled, 30 d error)
grep -n 'RETENTION_MS' lib/jobs/retention.ts
# Rebuild/parity script invocations (header comments are authoritative)
head -10 scripts/findings-rebuild.ts scripts/findings-parity.ts
# Prod log filenames
grep -n 'log' ecosystem.config.js
# DateTime storage = integer epoch-ms
sqlite3 -readonly "file:prisma/local-dev.db?mode=ro" "SELECT createdAt FROM Job LIMIT 1;"
```
