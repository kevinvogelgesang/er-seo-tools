---
name: er-seo-tools-run-and-operate
description: Use when deploying er-seo-tools, touching the production server, or diagnosing prod behavior — "deploy this", "is prod healthy", 502 Bad Gateway, PM2 restart loop, OOM kills, stuck audits in prod, "did the migration apply", tailing server logs, checking what retention deleted, restart semantics after SIGTERM, server .env / secrets questions, or post-deploy verification.
---

# Run and Operate er-seo-tools in Production

## Overview

One production system: a single PM2-managed Node 22 process on one RunCloud VPS, SQLite on disk, Chrome for audits, Cloudflare + NGINX in front. Deploys pull from GitHub — nothing deploys that isn't pushed. AI sessions deploy autonomously when gate-green and verify immediately after (2026-07-03 ruling); destructive server ops stay Kevin-gated.

## GATE POLICY (owner ruling 2026-07-02, amended 2026-07-03)

Canonical policy: `er-seo-tools-change-control` rule 1. Summary:

**Autonomous when gate-green** (lint/test/build re-run in this session):
- Merging roadmap-pipeline PRs (a pasted "Continue the improvement roadmap"
  prompt is standing authorization to merge pending ones at session start)
- Running `~/deploy.sh` when the work needs it — ALWAYS followed immediately by
  the post-deploy verification checklist below; report the outcome either way
- Operational recovery: `pm2 restart`, failed-migration `migrate resolve`
- Benign single-row prod writes that a documented verification runbook requires
  (e.g. the pillar smoke via `runForCanonical`)
- Read-only SSH inspection (log tails, `pm2 status`, `sqlite3 SELECT`,
  `prisma migrate status`, `curl` against the app) — always allowed

**Still Kevin-gated, current conversation only:** destructive/irreversible ops —
deleting prod data, `rm -rf`, editing the server `.env`/secrets or
`ecosystem.config.js` values, DB restore from backup, `pkill`, installing
packages, force-push — and anything not covered by a documented runbook.

## When to use / When NOT to use

Use this skill for: deploy protocol, prod topology and paths, PM2/logs, migrations in prod, restart/recovery semantics, scheduled retention jobs, secrets locations, post-deploy verification.

Use a sibling instead for:
- **er-seo-tools-change-control** — how changes get classified, reviewed (Codex), and gated before they ever reach a deploy
- **er-seo-tools-build-and-env** — local clone → dev server → passing tests; local env traps
- **er-seo-tools-debugging-playbook** — symptom→triage for app bugs (prod-only bug class included)
- **er-seo-tools-config-and-flags** — the full env-var catalog with defaults vs prod values
- **er-seo-tools-diagnostics-and-tooling** — deeper DB queries and measurement scripts
- **er-seo-tools-proof-and-analysis-toolkit** — how to prove a fix worked, not just eyeball it

## Production topology (as of 2026-07-02)

| Thing | Value |
|---|---|
| Server | DigitalOcean VPS `$PROD_HOST`, Ubuntu 24.04, 2-core AMD, 3.82 GB RAM, 80 GB disk (docs/SERVER_SETUP.md) |
| Management | RunCloud; native NGINX reverse proxy → `127.0.0.1:3000`; Cloudflare in front |
| Process | PM2, app name `seo-tools`, **fork mode, 1 instance** (`ecosystem.config.js`) — cluster mode would break the in-process browser pool, job worker, and upload-quota singletons |
| SSH user | `$PROD_SSH` |
| App dir | `$APP_HOME` |
| DB | `$DATA_HOME/db.sqlite` (SQLite, WAL mode) |
| Uploads / screenshots / reports | `$DATA_HOME/{uploads,screenshots,reports}` (set via `UPLOADS_DIR`/`SCREENSHOTS_DIR`/`REPORTS_DIR` in ecosystem.config.js) |
| Backups dir | `$DATA_HOME/backups` (see Open unknowns) |
| Logs | `$LOG_HOME/seo-tools-out.log` and `$LOG_HOME/seo-tools-error.log` (`merge_logs: true`, dated lines) |
| NGINX error log | `/var/log/nginx/seo-tools-error.log` (root access) |
| Chrome | `/usr/bin/google-chrome` (required for ADA audits) |

`ecosystem.config.js` (committed to the repo) is the **source of truth for prod tuning**: `max_memory_restart: '2400M'` (do NOT lower — 1200M caused mid-audit SIGKILLs, 2026-05-14 fei.edu incident), `kill_timeout: 10000` (SIGTERM grace so Chrome closes cleanly), `NODE_OPTIONS=--max-old-space-size=2048`, `BROWSER_POOL_SIZE=4`, `SITE_AUDIT_CONCURRENCY=2`, `SITE_AUDIT_BROWSER_RECYCLE_PAGES=15`, `LIGHTHOUSE_PROVIDER=pagespeed`, `PSI_CONCURRENCY=15`, `PAGESPEED_TIMEOUT_MS=150000`, SEO-report retention 730/90 days. Where README.md disagrees with ecosystem.config.js (pool size, old paths, `nohup`), **ecosystem.config.js and docs/SERVER_SETUP.md win** — README's deploy section is partially stale.

Cloudflare implications: client IP comes from `CF-Connecting-IP` (used for upload-quota keying, `lib/upload-helpers.ts`); some security headers (X-Frame-Options etc.) are managed at Cloudflare, not the app; the app ships CSP **Report-Only** (`next.config.ts`). NGINX sets `proxy_read_timeout 300s`, `client_max_body_size 50m`, `proxy_buffering off` (polling responses must not be buffered).

## Deploy protocol

### The two-step (step 2: autonomous when gate-green — see Gate policy)

```bash
# 1. AI session: push. The server pulls from GitHub — unpushed commits never deploy.
git push

# 2. Autonomous when gate-green (2026-07-03 ruling) — verify immediately after:
ssh $PROD_SSH "~/deploy.sh"
```

`~/deploy.sh` lives **only on the server** — its body is not in the repo. Do not invent its internals. Per docs/SERVER_SETUP.md §7.1, the documented-equivalent sequence is:

```
git pull && npm install
  && DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma generate
  && npm run build
  && pm2 stop seo-tools
  && DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate deploy
  && pm2 start seo-tools
```

Observable effects to rely on: code is pulled, deps installed, Prisma client regenerated, Next.js rebuilt, **app stopped before `migrate deploy`** (avoids SQLite lock errors — never reorder), migrations applied, app restarted. One hint the real script differs: a comment in `instrumentation.ts` says "fuser -k in the deploy command sends SIGTERM" — only `ssh $PROD_SSH "cat ~/deploy.sh"` (read-only, allowed) settles it.

### Deploy traps

1. **Never `npm ci` on the server.** RunCloud environments have lockfile drift; `npm ci` fails. Always `npm install` (docs/SERVER_SETUP.md §5.2, CLAUDE.md Do-not).
2. **Server package-lock drift.** The `npm install` during each deploy leaves small local modifications (~3-line additions) to the server's `package-lock.json`; the next deploy's `git pull` then refuses to overwrite it and the deploy fails at step 1. Documented workaround (deploy-recovery runbook — autonomous under the 2026-07-03 ruling; it only discards the drifted lockfile): `cd $APP_HOME && git checkout -- package-lock.json`, then re-run the deploy. Source: `docs/pillar-analysis-handoff.md` ("worth investigating root cause when there's downtime; deploy works fine with the workaround" — that is the accepted state as of 2026-07-02).
3. **`pm2 restart` does NOT pick up `ecosystem.config.js` env changes.** Any deploy that changes values in ecosystem.config.js requires `pm2 delete seo-tools && pm2 start ecosystem.config.js` — a plain restart silently runs stale env/config (documented at `docs/superpowers/archive/plans/2026-05-15-lighthouse-pagespeed-provider.md:948` and `2026-05-14-audit-stability.md:722`, which notes even `max_memory_restart` is not re-read by a plain restart). Verify with `pm2 env 0 | grep <VAR>`.
4. **Startup fail-fast can brick a deploy.** `instrumentation.ts` calls `process.exit(1)` in production if any of these is missing: `PILLAR_TOKEN_SECRET`, auth config (`APP_AUTH_SECRET` + at least one login path), or the Chromium egress guard (`CHROME_PROXY_SERVER` or `CHROMIUM_NETWORK_ISOLATED=true`). Shipping a new required-in-prod env var without first adding it to the server `.env` = PM2 crash-loop after an otherwise clean build. Always call out new required env vars in the PR body.
5. **New/changed `.env` values must land BEFORE the deploy** — Next.js reads `.env` at process start.

## Read-only prod inspection (allowed without the gate)

```bash
# Process health + restart counter (high restart count = crash loop)
ssh $PROD_SSH "pm2 status"

# Tail logs (merged out+error; --err for stderr only)
ssh $PROD_SSH "pm2 logs seo-tools --lines 100 --nostream"
ssh $PROD_SSH "pm2 logs seo-tools --err --lines 50 --nostream"

# Prove what env the worker actually runs with
ssh $PROD_SSH "pm2 env 0 | grep -E 'LIGHTHOUSE|PSI|BROWSER_POOL|SITE_AUDIT'"

# Migration state (read-only)
ssh $PROD_SSH "cd $APP_HOME && DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate status"

# Memory / disk / OOM evidence
ssh $PROD_SSH "free -h && df -h / && du -sh $DATA_HOME/"
ssh $PROD_SSH "dmesg | grep -i oom | tail -10"   # may need root

# Chrome processes (should only exist during active audits)
ssh $PROD_SSH "ps aux | grep chrome | grep -v grep | wc -l"

# SQLite health + WAL size (large WAL = checkpointing stalled)
ssh $PROD_SSH "sqlite3 $DATA_HOME/db.sqlite 'PRAGMA integrity_check;' && ls -lh $DATA_HOME/db.sqlite*"

# Stuck / transient audits (table names = Prisma model names; no @@map in schema.prisma)
ssh $PROD_SSH "sqlite3 $DATA_HOME/db.sqlite \"SELECT id, status, pagesTotal, pagesComplete, pdfsTotal, pdfsComplete, updatedAt FROM SiteAudit WHERE status NOT IN ('complete','error','cancelled') ORDER BY updatedAt DESC LIMIT 10;\""
# (SiteAudit has no `progress` column — progress is the counters above; the 0-100 `progress` field lives on AdaAudit)

# Job queue state
ssh $PROD_SSH "sqlite3 $DATA_HOME/db.sqlite \"SELECT type, status, COUNT(*) FROM Job GROUP BY type, status;\""
ssh $PROD_SSH "sqlite3 $DATA_HOME/db.sqlite \"SELECT id, type, attempts, lastError FROM Job WHERE status='error' ORDER BY updatedAt DESC LIMIT 10;\""

# Schedule tick health (nextRunAt far in the past = worker not ticking)
ssh $PROD_SSH "sqlite3 $DATA_HOME/db.sqlite \"SELECT name, jobType, cadence, enabled, nextRunAt, lastRunAt FROM Schedule;\""
```

Log line prefixes worth grepping: `[startup]` (fail-fast refusals), `[shutdown]`, `[cleanup]` (retention task failures), `[jobs]` (worker/schedules), `[findings] dual-write failed` (needs `scripts/findings-rebuild.ts`).

## Migrations in prod

- **Normal path: automatic.** `prisma migrate deploy` runs inside the deploy, with the app stopped. Local flow stays: edit `prisma/schema.prisma` → `npx prisma migrate dev --name <name>` (if it prompts/hangs in a non-interactive session, hand-author the migration SQL and apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy` — see er-seo-tools-change-control) → commit the migration dir → push → merge → deploy (autonomous when gate-green).
- **Manual path (failed-migration recovery only — autonomous under the 2026-07-03 ruling, but report it and check the D0 backup exists first):**
  ```bash
  cd $APP_HOME
  DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate status
  DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate resolve --applied <migration_name>
  ```
  Always pass `DATABASE_URL` inline ("belt and suspenders" — the CLI may not load the app's `.env`), and only run migrations with the app stopped.
- 39 migrations as of 2026-07-02 (latest: `20260630120000_live_seo_source`, on the feature branch — not on main/prod yet).

## Restart semantics

**Shutdown (SIGTERM/SIGINT, `instrumentation.ts`):** stop the job worker → `closeBrowser()` (so Chrome doesn't orphan) → exit. PM2's `kill_timeout: 10000` gives this 10 s before SIGKILL.

**Boot order (`instrumentation.ts`, strict):**
1. Fail-fast env gates (`PILLAR_TOKEN_SECRET`, auth config, Chromium egress guard) — missing = `process.exit(1)`
2. `initPragmas()` — WAL, busy_timeout, foreign_keys
3. Inline `runCleanup()` (fire-and-forget — "at boot" is not a cadence, so cleanup also runs right after every deploy)
4. `registerBuiltInJobHandlers()` → `recoverJobsOnStartup()` → `recoverQueue()` → `seedSystemSchedules()` → `startJobWorker()`

**What survives a restart:** everything durable. Running site audits, standalone ADA audits, PDF scans, PSI, report renders are all Job rows; `recoverQueue()` resumes transient parent audits that still have outstanding jobs in their `site-audit:<id>` group, finalizes drained-but-unfinalized ones, and only fails a parent that is still transient with **zero** jobs. Manual DB disables of `system-*` Schedule rows do NOT survive — the seed re-enables them at next boot (kill switch would be an env flag, not DB mutation).

**What does not survive:** the in-memory upload quota map (resets, by design), in-flight HTTP requests, and any Chrome pages (recreated on demand).

So the first-line fix for "stuck in running" is `pm2 restart seo-tools` (autonomous under the 2026-07-03 ruling — report that you did it) — startup recovery does the triage. The same recovery also runs every 10 min via `stale-audit-reset`, so often waiting 10 minutes is enough.

## Scheduled jobs and what retention deletes

System schedules (code-owned, `lib/jobs/system-schedules.ts`, seeded at every boot; `system-` is a reserved namespace):

| Schedule | Cadence | Does |
|---|---|---|
| `system-cleanup` | daily@09:00 server-local (server runs UTC) | `runCleanup()` — full retention pass (below) |
| `system-screenshot-sweep` | every 30 m | screenshot artifact sweep |
| `system-stale-audit-reset` | every 10 m | `resetStaleAudits()` — resume/finalize/fail stale transient audits; re-enqueue stranded broken-link verifiers |

Non-system: `seo-report-monthly` (operator-configured Schedule row, NOT seeded in code — `lib/jobs/handlers/seo-report-monthly-run.ts`) fires the monthly client SEO-report batch. Client scan schedules are `name: NULL` Schedule rows managed via `/api/clients/[id]/schedules`.

`runCleanup()` (`lib/cleanup.ts`) deletes, each task independent:

| What | Window |
|---|---|
| Never-analyzed uploads + orphan upload dirs + consumed complete-session upload dirs | 24 h |
| Sessions (+ upload dirs, cascade ShareLinks) and expired screenshots | 180 d |
| Expired `ShareLink` rows; expired AdaAudit/SiteAudit share tokens (nulled) | share TTL 30 d |
| Terminal Job rows (`lib/jobs/retention.ts`) | complete/cancelled 7 d, error 30 d |
| Archived blobs (`pruneArchivedBlobs`) — `Session.result`, `SiteAudit.summary`, `AdaAudit.result` + screenshot artifacts | 90 d after completion (findings tables remain; UIs degrade to archived views) |
| Schedule-originated terminal SiteAudits (`pruneScheduledSiteAudits`) | daily 14 d / weekly 90 d / monthly 365 d; latest 2 completed per schedule always kept; manual + orphaned audits never pruned |
| Stranded `HarvestedLink` / `HarvestedPageSeo` rows | 7 d |
| `SeoReport` rows past `retainUntil` | scheduled 730 d / ad-hoc 90 d (env-configurable) |

If data "disappeared", check this table before suspecting a bug — then check `[cleanup]` log lines for task failures.

## Secrets handling

Secrets live in the server's gitignored `.env` at `$APP_HOME/.env` — NOT in `ecosystem.config.js` (which deliberately holds only non-secret tuning knobs so `pm2 env` can prove them). Never print secret **values**; names only:

- `APP_AUTH_SECRET`, `APP_AUTH_PASSWORD` (break-glass; disable via `ALLOW_PASSWORD_LOGIN=false`)
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ALLOWED_HD`
- `PILLAR_TOKEN_SECRET`, `SEO_ROADMAP_TOKEN_SECRET`, `KEYWORD_MEMO_TOKEN_SECRET`, `QUARTER_PUSH_TOKEN_SECRET` (skill-handoff JWT signing; all required in prod)
- `GOOGLE_SA_KEY_FILE` → points at the service-account JSON: `$DATA_HOME/google-sa.json`, `chmod 0600`, owned by `seo` (docs/google-service-account-setup.md)
- `PAGESPEED_API_KEY` (optional, raises PSI quota)
- `NEXT_PUBLIC_APP_URL` (share-link base — never derive from request origin)
- `CHROME_PROXY_SERVER` or `CHROMIUM_NETWORK_ISOLATED=true` (egress guard — one is required in prod)

Checking which names are set (read-only, values redacted): `ssh $PROD_SSH "grep -oE '^[A-Z_]+' $APP_HOME/.env"`.

Never put ops/infra strings (IPs, SSH commands, paths) in client components — the 2026-06-29 pentest's top finding was the deploy command shipped in the public JS footer. Regression check: `rg "144\.126|ssh seo|deploy\.sh" app components lib`.

## Post-deploy verification checklist

Run after EVERY deploy — it is the mandatory second half of an autonomous deploy (all read-only). Get the app's base URL from `NEXT_PUBLIC_APP_URL` in the server `.env` first — the repo does not record the prod domain.

```bash
# 1. Process up, restart counter not climbing
ssh $PROD_SSH "pm2 status"

# 2. Boot was clean — no [startup] refusals, recovery ran
ssh $PROD_SSH "pm2 logs seo-tools --lines 80 --nostream | grep -E '\[startup\]|\[shutdown\]|\[jobs\]|\[cleanup\]|Error'"

# 3. App answers; security headers present (CSP-Report-Only yes, X-Powered-By no)
curl -sI https://<app-domain>/login | grep -iE 'HTTP|content-security-policy-report-only|x-powered-by'

# 4. Migrations applied
ssh $PROD_SSH "cd $APP_HOME && DATABASE_URL='file:$DATA_HOME/db.sqlite' npx prisma migrate status"

# 5. Job worker ticking (schedules' nextRunAt should be in the future / lastRunAt recent)
ssh $PROD_SSH "sqlite3 $DATA_HOME/db.sqlite \"SELECT name, nextRunAt, lastRunAt FROM Schedule WHERE name LIKE 'system-%';\""
```

6. **One smoke audit:** in the UI, run a single-page ADA audit against a client site already in the system or a domain you control (owner ruling: never scan third-party sites casually), watch it reach `complete`, and confirm no new `[cleanup]`/job errors in the logs. For deeper evidence standards (proving a fix, not just observing green), use **er-seo-tools-proof-and-analysis-toolkit**.

## Open unknowns (do not paper over these)

- **`~/deploy.sh` internals** — server-only; SERVER_SETUP.md §7.1 is the documented approximation; the `fuser -k` comment in instrumentation.ts hints at drift. Settle with `ssh $PROD_SSH "cat ~/deploy.sh"`.
- **Backups are documented, not verified.** SERVER_SETUP.md §8.6 describes a daily 2 AM `sqlite3 .backup` cron keeping 7 days — on the SAME disk, no off-server copy, and whether the cron is actually installed is unverifiable from the repo (`ssh $PROD_SSH "crontab -l"` to check). There is no documented restore procedure.
- **No monitoring/alerting.** No Sentry/APM, no `/api/health` endpoint. Health = manual PM2/SSH checks. A dead app is discovered by humans.
- **Prod domain** is not in the repo (the 2026-06-29 pentest targeted `seo.erstaging.site`; whether that IS prod is unconfirmed) — read `NEXT_PUBLIC_APP_URL` from the server `.env`.
- **Cloudflare config** (WAF, origin lockdown, which headers it injects) is not in the repo; whether the origin accepts non-Cloudflare traffic is unverified.
- **Merged ≠ deployed.** Whether main's tip is what prod runs must be checked (`ssh $PROD_SSH "cd $APP_HOME && git log -1 --oneline"`), not assumed from git history.

## Common mistakes

- Deploying without `git push` first — the server pulls from GitHub; your local commits do nothing.
- Deploying without re-running the gates, or skipping the post-deploy verification checklist afterwards — autonomous deploy (2026-07-03 ruling) is a package deal: gates → deploy → verify → report.
- Running a mutating `sqlite3` statement, editing the server `.env`, or any destructive op without Kevin's explicit go in the current conversation (those stay gated).
- `npm ci` on the server (fails on RunCloud lockfile drift).
- Changing `ecosystem.config.js` env and only `pm2 restart`-ing — stale env; needs `pm2 delete` + `pm2 start`.
- Shipping a new required-in-prod env var without pre-adding it to the server `.env` — startup fail-fast crash-loops PM2.
- Lowering `max_memory_restart` below 2400M or raising `BROWSER_POOL_SIZE` above 4 "to tidy up" — both values are incident-derived (2026-05-14 SIGKILLs; ~150–200 MB per Chrome page on a 3.82 GB box).
- Reordering the deploy so migrations run while the app is up — SQLite lock errors.
- Treating vanished old data as a bug without checking the retention table and `[cleanup]` logs.
- Assuming CLAUDE.md's prod defaults are live values — `PSI_CONCURRENCY` is 15 in ecosystem.config.js though older docs say 6; `pm2 env 0` is truth.
- Smoke-testing audits against arbitrary third-party sites (owner ruling: client sites or domains you control only).

## Provenance and maintenance

Written 2026-07-02 against branch `feat/autonomous-live-seo-source` (23 commits ahead of main, main tip `6679993`, PR #84). Everything here is merge-state-neutral: topology, deploy protocol, boot/shutdown, schedules, and retention are identical on main and the branch as of this date (the branch adds migration `20260630120000_live_seo_source` and canonical-run changes that do not alter ops). Sources verified directly: `ecosystem.config.js`, `instrumentation.ts`, `docs/SERVER_SETUP.md`, `lib/cleanup.ts`, `lib/jobs/system-schedules.ts`, `lib/jobs/retention.ts`, `lib/findings/retention.ts`, `lib/ada-audit/scheduled-retention.ts`, `lib/seo-report-retention.ts`, `lib/auth.ts`, `lib/ada-audit/browser-egress.ts`, `docs/google-service-account-setup.md`, `prisma/schema.prisma`, `next.config.ts`, `README.md`.

Re-verify volatile facts:

| Fact | Command |
|---|---|
| PM2 tuning values (pool 4, PSI 15, 2400M, kill_timeout) | `cat ecosystem.config.js` |
| System schedule cadences | `sed -n '29,37p' lib/jobs/system-schedules.ts` |
| Retention windows | `grep -n 'DAY_MS\|TTL_MS\|RETENTION' lib/cleanup.ts lib/jobs/retention.ts lib/findings/retention.ts lib/ada-audit/scheduled-retention.ts` |
| Fail-fast startup gates | `grep -n 'process.exit(1)' instrumentation.ts` |
| Deploy one-liner + troubleshooting recipes | `sed -n '437,720p' docs/SERVER_SETUP.md` |
| Secret env-var names | `grep -rn 'process.env' lib/auth.ts lib/*token*.ts lib/ada-audit/browser-egress.ts lib/analytics/google/auth.ts` |
| Migration count / latest | `ls -d prisma/migrations/*/ \| wc -l && ls prisma/migrations \| tail -2` (count dirs only — `migration_lock.toml` is not a migration) |
| package-lock drift workaround still current | `grep -n 'package-lock' docs/pillar-analysis-handoff.md` |
| Branch-vs-main drift | `git log main..HEAD --oneline \| wc -l` |
| What prod actually runs | `ssh $PROD_SSH "cd $APP_HOME && git log -1 --oneline && pm2 env 0 \| grep -E 'PSI\|POOL'"` (read-only) |
