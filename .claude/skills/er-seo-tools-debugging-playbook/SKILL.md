---
name: er-seo-tools-debugging-playbook
description: Use when something in er-seo-tools is failing and you need the cause — audits stuck in queued/running, "Operations timed out", "Audit timed out (server may have restarted)", works-in-dev-but-not-prod bugs, new routes returning 401, hollow SEO audits / empty page_index, PSI failures or suspicious accessibility results, "[findings] dual-write failed" in logs, 409 session_archived / archived banners, an unexpected login wall in dev, Chrome/browser-pool hangs, or share links that 404.
---

# er-seo-tools Debugging Playbook

## Overview

Every recurring failure in this app has a known signature and ONE discriminating check
that splits the hypothesis space. Start at the symptom table, run the first move, and
only then read code. The worst bugs in this repo's history were all **prod-only and
invisible to dev + tests** (minification, PM2 memory kills, reverse proxy, WAF, env
divergence) — so "it works locally" eliminates almost nothing.

Two ground rules before touching anything:
- **Gate policy (2026-07-03 ruling — canonical in `er-seo-tools-change-control` rule 1):**
  read-only SSH (logs, `pm2 status`, `sqlite3 SELECT`) is always fine; `pm2 restart`
  and gate-green deploys are autonomous (verify + report after); SQL UPDATEs, server
  `.env` edits, and destructive ops stay Kevin-gated.
- **Prefer letting recovery self-heal** (see "Recovery behaviors" below) before any
  manual intervention. Most "stuck" states resolve within 10 minutes on their own.

## When to use / When NOT to use

Use this skill when something is broken, stuck, erroring, or behaving differently in
prod than in dev.

Use a sibling instead when:
- You want the full incident history behind a trap → **er-seo-tools-failure-archaeology**
- You need measurement scripts, DB queries, log-grep recipes as tools → **er-seo-tools-diagnostics-and-tooling**
- You need deploy/PM2/migration/restart operations → **er-seo-tools-run-and-operate**
- You need env-var defaults and prod values → **er-seo-tools-config-and-flags**
- You're changing code and need gates/review rules → **er-seo-tools-change-control**
- You need WHY an invariant exists → **er-seo-tools-architecture-contract**

## Symptom → first move

| Symptom | Most likely cause | First move (exact command) |
|---|---|---|
| Site audit stuck in `queued` | Another audit holds the one-active slot, or the promoter never enqueued discovery | `sqlite3 <DB> "SELECT id,status FROM SiteAudit WHERE status IN ('running','pdfs-running','lighthouse-running');"` — if a row exists, the queue is working as designed (FIFO, one at a time) |
| Site audit stuck in `running`/`pdfs-running`/`lighthouse-running` | Jobs still draining (healthy) vs orphaned (crash) | Count live jobs in its group: `sqlite3 <DB> "SELECT type,status,attempts FROM Job WHERE groupKey='site-audit:<ID>' AND status IN ('queued','running');"` — rows present = draining, leave it; zero rows = wait ≤10 min for `stale-audit-reset` to finalize-or-fail it |
| `Operations timed out` (Prisma, many writers at once) | SQLite write lock held across event-loop turns — an interactive transaction snuck in | `grep -rn '\$transaction(async' lib app --include='*.ts'` — any hit in executable code is the bug (4 comment-line hits that warn against the pattern are expected today; array-form only) |
| Audit failed: `Audit timed out (server may have restarted)` | PM2 `max_memory_restart` SIGKILL mid-audit, or a real crash | `ssh $PROD_SSH "pm2 describe seo-tools \| grep -E 'restarts\|uptime'"` — restart counter bumped + short uptime = memory kill. **Not dmesg** (fei.edu incident: kernel OOM log was clean; PM2 did the killing) |
| Works in dev, broken in prod | One of the four prod-only classes | See "The four prod-only bug classes" below — run the minification grep first, it's cheapest |
| New route returns 401 in prod | Missing from `middleware.ts` `isPublicPath` allowlist | `grep -n "your-route" middleware.ts` — this has bitten the team three times; every public/token route needs an allowlist entry + a `middleware.test.ts` case |
| SEO audit "hollow" — empty page_index, blank keyword/duplicate joins | Parser key or filename-routing miss | Check the parser has a static `parserKey` (`lib/parsers/base.parser.ts:18` pattern) and that `lib/parsers/index.routing.test.ts` covers the filename; then check the completeness panel (`lib/services/completeness.ts`) for which CSVs were absent |
| PSI failures / accessibility scores that contradict axe | WAF/CDN serving Google's data-center IPs a challenge page | Trust axe, not PSI — per-page PSI failures fail only the Lighthouse portion by design. Full analysis: `docs/superpowers/nyi/specs/2026-05-29-psi-a11y-reframe-design.md` |
| `[findings] dual-write failed` in logs | Findings-layer write failed after the legacy commit (by design, never fails the audit) | `npx tsx scripts/findings-rebuild.ts <sessionId\|siteAuditId\|adaAuditId>` (prod: `cd $APP_HOME && npx tsx scripts/findings-rebuild.ts <id>` — Kevin runs it) |
| 409 `session_archived`, archived banners, "—" counts | 90-day blob pruning — **expected behavior, not a bug** | Verify `CrawlRun.archivePrunedAt` is set; read surfaces degrade via findings-table fallbacks. Do not try to "fix" it |
| Login wall appears in local dev | `APP_AUTH_PASSWORD` set in a local `.env*` file | `grep -rn APP_AUTH_PASSWORD .env* 2>/dev/null` — dev bypass requires it UNSET (`lib/auth.ts` `isAuthBypassedInDev`) |
| ADA audit hangs, no progress | Browser-pool starvation (dev pool = 2) or a page held across an uncontrolled await | Check for code holding `acquirePage()` results across awaits; dev default `BROWSER_POOL_SIZE=2` (`lib/ada-audit/browser-pool.ts:6`), prod 4 |
| Share link 404s | 30-day token TTL expired (cleanup nulls it), or URL built from request origin | `sqlite3 <DB> "SELECT shareToken,shareExpiresAt FROM SiteAudit WHERE id='<ID>';"` — expired = re-share; also confirm URLs come from `NEXT_PUBLIC_APP_URL`, never request origin |
| App won't start after deploy | Startup fail-fast env gate (`process.exit(1)`) | `ssh $PROD_SSH "pm2 logs seo-tools --err --lines 30 --nostream"` — look for missing `PILLAR_TOKEN_SECRET` / auth config / Chromium egress guard |

`<DB>` = `$DATA_HOME/db.sqlite` on prod (read-only SELECTs only),
`./local-dev.db` or your local `DATABASE_URL` in dev.

## Logging conventions

All server-side logs use **bracketed subsystem tags**. Verified tag list (as of
2026-07-02, branch `feat/autonomous-live-seo-source`):

`[queue]` `[jobs]` `[findings]` `[ada-audit]` `[stale-audit-reset]`
`[site-audit-finalizer]` `[pdf-orchestrator]` `[lighthouse-queue]` `[live-seo]`
`[broken-link-verify]` `[pillar-analysis]` `[checks]` `[retention]` `[upload]`
`[pillar-token]` `[seo-roadmap-token]` `[keyword-memo-token]` `[quarter-push-token]`

Prod log files (from `ecosystem.config.js`, pm2-logrotate 50MB×5):
- `$LOG_HOME/seo-tools-error.log` — stderr (console.error)
- `$LOG_HOME/seo-tools-out.log` — stdout (console.log/warn; `merge_logs: true`)

Triage greps (read-only SSH):

```bash
# Everything a subsystem said recently
ssh $PROD_SSH "grep '\[queue\]' ~/logs/seo-tools-out.log | tail -30"
ssh $PROD_SSH "grep '\[findings\]' ~/logs/seo-tools-error.log | tail -20"
# Recovery decisions for one audit (resume vs finalize vs fail)
ssh $PROD_SSH "grep '<AUDIT_ID>' ~/logs/seo-tools-*.log | tail -40"
# Re-derive the tag list after code changes
grep -rh "console\.\(error\|warn\|log\)('\[" lib app --include='*.ts' | grep -o "\[[a-z-]*\]" | sort -u
```

Recovery messages worth knowing verbatim (all in `lib/ada-audit/queue-manager.ts`):
- `Stale check: resuming audit <id> (N durable job(s) outstanding)` — healthy, jobs draining
- `Stale check: finalized drained audit <id>` — self-healed a drained-but-unfinalized audit
- `Stale check: failing audit <id>` — destructive path taken (no jobs, finalize didn't complete it)
- `job count failed for <id>, skipping this pass` — transient DB error; recovery deliberately did nothing

## The four prod-only bug classes

Every major incident in this repo passed local tests. When prod diverges from dev,
check these in order (cheapest first):

### 1. Minification / compilation artifacts (SWC)

Prod builds minify class names and inject SWC helpers; dev and vitest do not.
Two real incidents: aggregator keys derived from `ParserClass.name` broke every prod
SEO audit silently (fixed by static `parserKey`, 2026-06-02), and `typeof` inside a
`.toString()`-injected page function emitted an escaping `_type_of` helper that
ReferenceError'd inside audited pages (C6 — the broken-link verifier — Phase 2).

**Discriminating experiment** — build locally and grep the compiled output for the
literal you expect to survive:

```bash
npm run build
grep -rl "expected-literal-or-key" .next/server | head
```

If your literal is absent (or a class/function name you depend on is minified), you
have this class. Rules: never key logic off `Function.name` / `Class.name`; any
function injected into a page via `.toString()` must be fully self-contained (no
module-scope refs, no `typeof` — see the header of `lib/ada-audit/seo/parse-seo-dom.ts`).

### 2. Reverse proxy: `request.url` is localhost

Behind RunCloud/NGINX, `request.url` resolves to `localhost:3000`. Any absolute URL
(redirects, share links, OAuth callbacks) must come from `NEXT_PUBLIC_APP_URL`
(pattern: `getAuthRedirectBase` in `lib/auth.ts`). Symptom: redirects/links pointing
at `localhost:3000` in prod only.

```bash
grep -rn "request.url\|req.url" app --include='*.ts' | grep -v test   # audit new code
```

### 3. WAF-blocked outbound fetches

Client education sites sit behind WAF/CDN bot mitigation. Plain `fetch()` gets
challenge pages or blocks that a browser doesn't. The codebase sends browser-shaped
headers (`USER_AGENT` in `lib/ada-audit/sitemap-crawler.ts:19`); new outbound fetch
code must do the same. This is also why PSI (Google data-center IPs) produces false
a11y failures — axe (real Chrome from our IP) is the authority.

**Discriminating experiment**: fetch the target from the server with and without
browser headers and compare status/content — a 403/challenge only on the bare fetch
confirms WAF.

### 4. Env divergence

Prod values live in `ecosystem.config.js` (committed) + the server-only `.env`. Key
prod values as of 2026-07-02: `BROWSER_POOL_SIZE=4`, `SITE_AUDIT_CONCURRENCY=2`,
`PSI_CONCURRENCY=15`, `LIGHTHOUSE_PROVIDER=pagespeed`,
`NODE_OPTIONS=--max-old-space-size=2048`, `max_memory_restart: 2400M`. Dev defaults
differ (pool 2, site-audit concurrency 1, PSI 6, lighthouse `local`).

```bash
grep -nE "POOL|CONCURRENCY|LIGHTHOUSE|memory" ecosystem.config.js
ssh $PROD_SSH "pm2 env 0 | grep -E 'POOL|CONCURRENCY|LIGHTHOUSE'"   # what's actually loaded
```

Trap: `pm2 restart` does NOT reload `ecosystem.config.js` env changes — that needs
`pm2 delete seo-tools && pm2 start ecosystem.config.js` (Kevin action).

## Deep triage runbooks

### Stuck audit — the full decision tree

The heartbeat is `SiteAudit.updatedAt`: every Prisma write auto-bumps it, and the
raw-SQL counter bumps set it manually (`Date.now()`, integer ms). Liveness truth is
the **durable Job table**, not wall-clock.

1. Is anything transient? `SELECT id,status,pagesComplete,pagesTotal,pdfsComplete,pdfsTotal,lighthouseComplete,lighthouseTotal,updatedAt FROM SiteAudit WHERE status NOT IN ('complete','error','cancelled');`
2. For each transient audit, count its live jobs:
   `SELECT type,status,attempts,runAfter FROM Job WHERE groupKey='site-audit:<ID>' AND status IN ('queued','running');`
   - **Jobs exist** → it's draining. `queued` rows with future `runAfter` are in
     retry backoff (up to 15-min cap) — still healthy. Do nothing.
   - **Zero jobs, counters look drained** → the finalizer crashed after the last
     settle. `resetStaleAudits` (every 10 min) will call `finalizeSiteAudit` and
     complete it. Self-heals.
   - **Zero jobs, counters NOT drained** → recovery's finalize attempt will fail
     and it will `failSiteAudit` (cascade-fails child AdaAudit/PdfAudit rows,
     cancels queued jobs, kicks the promoter). Also self-heals — into `error`.
3. `queued` audits never trip staleness (recovery only looks at transient statuses
   including running/pdfs-running/lighthouse-running; queued waits for the promoter).
   A queued audit only moves when no other audit is transient — check step 1 output.
4. Standalone ADA audits (`siteAuditId IS NULL`) have **no `updatedAt` column** —
   liveness = jobs in group `ada-audit:<id>` plus a 5-min `createdAt` race guard
   (`lib/ada-audit/standalone-recovery.ts`). Note: `docs/SERVER_SETUP.md` §9.4's
   example SQL selects `updatedAt` from AdaAudit — that column does not exist; use
   `createdAt`.
5. Only if a row is still transient >15 min with zero jobs and two `stale-audit-reset`
   passes logged: that's a genuine bug — capture the Job rows + log lines and dig in.

### "Operations timed out" — the write-lock signature

Canonical incident 2026-06-10: an interactive `prisma.$transaction(async tx => ...)`
holds SQLite's single write lock across event-loop round-trips; concurrent pdfjs
parsing starved the loop; the lock outlived `busy_timeout` (5000 ms, `lib/db.ts:30`)
for every other writer. The repo rule is **array-form `$transaction([...])` only**,
conditional logic expressed as SQL `EXISTS`, and raw SQL setting
`"updatedAt" = ${Date.now()}` manually (raw SQL bypasses `@updatedAt`, and updatedAt
is the recovery heartbeat — forget it and healthy long audits get stale-killed).

Checks, in order:
```bash
grep -rn '\$transaction(async' lib app --include='*.ts'          # expect ONLY comment-line hits (4 as of 2026-07-02, all warnings against the pattern); any hit in executable code is the bug
grep -rn '\$executeRaw' lib app --include='*.ts' | grep -vi updatedAt   # raw writes missing the manual bump (review hits)
```
If both are clean, look for any new long-held write (large `createMany` without
chunking — SQLite's 999-bind limit forces chunk size 50 here).

### "Audit timed out (server may have restarted)"

That exact string is written by `resetStaleAudits` → `recoverOrFailTransient`
(`lib/ada-audit/queue-manager.ts:369`) when a transient audit went ≥5 min without a
heartbeat AND had no live jobs AND couldn't be finalized. It means the process died
mid-audit. Discriminate the cause:

```bash
ssh $PROD_SSH "pm2 describe seo-tools | grep -E 'restarts|uptime|created'"
ssh $PROD_SSH "grep -i 'sigterm\|sigkill\|restart' ~/logs/seo-tools-*.log | tail -10"
```
- Restart counter bumped, short uptime, no SIGTERM log → **PM2 `max_memory_restart`
  SIGKILL** (2400M ceiling). The fei.edu incident (2026-05-14) proved dmesg shows
  nothing — PM2 kills before the kernel would. Memory peaks are legitimate during
  Lighthouse trace processing; if this recurs, it's a memory-budget conversation
  (Kevin decision), not a code bug per se.
- SIGTERM logged around a deploy time → expected deploy restart; durable jobs should
  have resumed. If the audit still failed, investigate recovery logs instead.
- No restart at all → the audit's jobs genuinely stalled; go back to the stuck-audit
  tree.

### Hollow SEO audits

"Hollow" = the parse completes but the roadmap/report has empty page_index, no
keyword or duplicate joins. Causes seen in the wild:
1. **Parser key drift** — aggregator lookups key off each parser's static
   `parserKey` (`lib/parsers/base.parser.ts:18`). A parser missing it (or code
   re-deriving keys from class names) breaks ONLY in prod (minification class 1).
2. **Filename-routing collision** — parser matching is substring-based; at least
   three historical collisions (PageSpeedOpportunities vs PageSpeed ordering,
   Security stealing `security_form_url_insecure.csv` from InsecureContent).
   `lib/parsers/index.routing.test.ts` is the regression net — add a case for any
   new SF export name.
3. **Missing CSVs** — the completeness layer (`lib/services/completeness.ts`)
   distinguishes "site is clean" from "you never uploaded that report". Check the
   completeness output before blaming the code.

### Findings layer: dual-write failed / parity doubts

The findings dual-write is fire-and-forget AFTER the legacy commit — a failure never
fails the audit, it just logs `[findings] ... dual-write failed` (sites:
`lib/ada-audit/site-audit-finalizer.ts:126`, `lib/jobs/handlers/ada-audit.ts:55`,
plus the SEO hooks). Repair and verify:

```bash
npx tsx scripts/findings-rebuild.ts <id>     # id type auto-detected; rebuilds from the origin blob
npx tsx scripts/findings-parity.ts <id>      # blob-vs-tables comparator
```
Local runs need `DATABASE_URL="file:./local-dev.db"` (or your dev DB) prefixed.
Rebuild only works while the origin blob exists (pre-90-day pruning); it is NOT a
historical backfill tool.

### Archived sessions / audits (409s and dashes are features)

`pruneArchivedBlobs()` nulls origin blobs 90 days after completion. After that:
results/share/export surfaces serve degraded findings-table fallbacks with an
archived banner; diff and the claude/srt_/krt_ memo exports return
**409 `session_archived`** (`app/api/diff/route.ts:61`,
`app/api/export/[sessionId]/claude/route.ts:35`) — but only when
`CrawlRun.archivePrunedAt` is stamped; a null blob WITHOUT the stamp keeps legacy
error behavior. Archived ADA counts render "—", never 0. None of this is a bug; do
not attempt to regenerate blobs.

## Recovery behaviors — self-heal vs intervene

Two recovery entry points apply ONE generic treatment (`recoverOrFailTransient`):

| Mechanism | When it runs | What it does |
|---|---|---|
| `recoverQueue()` | Once at boot (after durable-job startup recovery re-queues orphaned `running` jobs) | Treats ALL transient site audits; re-queues legacy `pending`; then standalone + broken-link + seo-report recovery |
| `resetStaleAudits()` | Every 10 min (`system-stale-audit-reset` schedule) | Treats transient site audits with `updatedAt` >5 min stale; then standalone recovery |

The treatment per audit: count active jobs in `site-audit:<id>` →
**read error: skip this pass** (never destroy on a transient error) →
**>0 jobs: resume** (leave alone) → **0 jobs: one `finalizeSiteAudit` attempt**
(drained-but-unfinalized completes) → **still transient: `failSiteAudit`**.

Self-heals without you (wait ≤10 min):
- Drained-but-unfinalized audits (finalizer crash window)
- Orphaned transient audits after a restart (resume if jobs re-queued, else fail cleanly)
- Stranded broken-link verifiers (complete audit + leftover `HarvestedLink`/`HarvestedPageSeo`
  rows + no verify job + no live-scan run → re-enqueued at boot and every 10 min)
- Stranded standalone ADA audits and SEO reports (job-group liveness checks)

Needs intervention (Kevin for anything prod-mutating):
- A transient audit with zero jobs that survives two 10-minute passes (real bug — collect evidence first)
- Failed findings dual-writes (run `findings-rebuild.ts` — the sweep does not retry them)
- Repeated PM2 memory restarts (budget/config decision)
- Env-file or `ecosystem.config.js` drift (requires `pm2 delete` + `start`, a Kevin action)

Group-key rule while debugging: `site-audit:<id>` MEANS liveness to recovery. If you
see a long-lived job parked in that group on a non-terminal audit, that's a bug
pattern (recovery will "resume" forever). `report-render` deliberately uses
`report:<id>`; `broken-link-verify` may use the audit group only because it is
enqueued post-terminal.

## Traps that cost real time

One line each; full accounts in **er-seo-tools-failure-archaeology**.

- **PM2 killed it, dmesg is innocent** (fei.edu, 2026-05-14): audit died at page 8/34, kernel OOM log clean — `max_memory_restart: 1200M` was the killer; now 2400M, don't "tidy" it down.
- **Green tests, hollow prod audits** (2026-06-02): SWC minified `ParserClass.name`, every aggregator key missed; static `parserKey` is the fix and the lesson.
- **One interactive transaction froze every writer** (2026-06-10): `$transaction(async ...)` + concurrent pdfjs = "Operations timed out" across the app; array-form only, forever.
- **`typeof` broke inside audited pages** (C6 Phase 2): SWC's `_type_of` helper escapes `.toString()`-injected functions; injected code must be self-contained.
- **New route 401s, three separate times**: token/public routes must be in `middleware.ts` `isPublicPath` + covered in `middleware.test.ts` — no exceptions.
- **`pm2 restart` kept stale env**: ecosystem env changes need `pm2 delete seo-tools && pm2 start ecosystem.config.js`.
- **Two memory ceilings, two incidents**: runtime (PM2 2400M, fei.edu) vs build-time (`--max-old-space-size=3072` baked into `npm run build` after the 2026-06-22 deploy OOM) — raising one doesn't fix the other.
- **PSI blamed the wrong party**: WAF challenge pages to Google IPs produced false a11y failures; axe is the authority, PSI failures degrade gracefully by design.
- **"Treat error as zero jobs" would nuke healthy audits**: recovery deliberately skips a pass on job-count read errors — don't "simplify" that.

## Common mistakes

- Manually flipping a stuck audit's status in SQL before letting one 10-minute
  recovery pass run — you'll race the sweep and orphan child rows.
- Grepping only `seo-tools-error.log`: recovery decisions (`[queue]`, resume/fail
  lines) are `console.warn`/`log` → they land in `seo-tools-out.log`.
- Treating 409 `session_archived` or "—" counts as data loss — it's 90-day blob
  retention working; findings tables retain the queryable data.
- Debugging prod scoring/canonical-run behavior from this branch's code:
  canonical-run selection is merge-state-sensitive (branch vs main) — see
  er-seo-tools-architecture-contract §6; verify: `git branch --show-current &&
  grep -n pickCanonicalSeo lib/services/findings-shared.ts`.
- Copying `docs/SERVER_SETUP.md` SQL verbatim — its AdaAudit query references a
  nonexistent `updatedAt` column; README's deploy section is also stale (nohup, old
  paths). `ecosystem.config.js` + this repo's code are authoritative.
- Scanning arbitrary external sites to reproduce an audit bug — only client sites or
  domains you control (owner rule).
- Running `~/deploy.sh`, `pm2 restart`, or prod SQL UPDATEs yourself — diagnosis is
  read-only; mutations are Kevin's.

## Provenance and maintenance

Authored 2026-07-02 against branch `feat/autonomous-live-seo-source` (HEAD 36de2cb,
23 commits ahead of main; main tip 6679993). Facts marked "prod" describe
`ecosystem.config.js` in this tree plus docs — actual server state can drift and is
verifiable only over read-only SSH.

Re-verification one-liners for volatile facts:

| Fact | Re-verify |
|---|---|
| Log tag list | `grep -rh "console\.\(error\|warn\|log\)('\[" lib app --include='*.ts' \| grep -o "\[[a-z-]*\]" \| sort -u` |
| Stale threshold 5 min / sweep every 10 min | `grep -n "STALE_MS" lib/ada-audit/queue-manager.ts && grep -n "stale-audit-reset" lib/jobs/system-schedules.ts` |
| Recovery decision logic | `sed -n '305,380p' lib/ada-audit/queue-manager.ts` |
| No interactive transactions | `grep -rn '\$transaction(async' lib app --include='*.ts'` (expect only comment-line warnings — 4 as of 2026-07-02; executable hits = bug) |
| Prod tuning env (pool 4, PSI 15, 2400M) | `grep -nE "POOL\|CONCURRENCY\|memory_restart\|LIGHTHOUSE" ecosystem.config.js` |
| Dev browser-pool default 2 | `sed -n '6p' lib/ada-audit/browser-pool.ts` |
| Middleware allowlist | `sed -n '1,55p' middleware.ts` |
| Share TTL 30 d | `grep -rn SHARE_TTL "app/api/site-audit/[id]/share/route.ts" "app/api/ada-audit/[id]/share/route.ts"` (quote both paths — `[id]` globs in zsh) |
| Dev auth bypass condition | `sed -n '/isAuthBypassedInDev/,+2p' lib/auth.ts && sed -n '/export function isAuthConfigured/,+2p' lib/auth.ts` |
| 409 session_archived sites | `grep -rn session_archived app/api --include='*.ts' \| grep -v test` |
| Rebuild/parity scripts exist | `ls scripts/findings-rebuild.ts scripts/findings-parity.ts` |
| Branch-vs-main canonical divergence | `git branch --show-current && grep -n pickCanonicalSeo lib/services/findings-shared.ts` |
| AdaAudit has no updatedAt | `awk '/^model AdaAudit \{/{f=1} f&&/^\}/{f=0} f' prisma/schema.prisma \| grep -c updatedAt` (expect 0; don't match AdaAuditCheck) |
| Whether S1 (pentest quick-wins) remediation is deployed | `curl -sI https://<prod-host>/ \| grep -i 'content-security-policy-report-only\|x-powered-by'` — prod host is not recorded in the repo; read `NEXT_PUBLIC_APP_URL` from the server `.env` (see er-seo-tools-run-and-operate) |
