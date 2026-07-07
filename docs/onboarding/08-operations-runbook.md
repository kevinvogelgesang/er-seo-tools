# 08 — Operations Runbook

*Audience: the Stage 4 developer (`05-milestones.md`) who has just been handed
prod access, or an outside senior helping diagnose an incident. This is a
reference, not a path — return to it whenever something needs operating, not
just once.*

**Re-orientation.** If it's been a while: `04-how-it-runs.md` explained the
machinery in the abstract — the job queue, the audit lifecycle, recovery. This
doc is its companion for the one place that machinery actually lives: the
production VPS. Everything here is about *doing something to prod* — deploying
it, reading it, diagnosing it — so read the next paragraph before anything
else in this file.

## The prime directive: look before you touch

**Every section below assumes you check evidence before you act.** Before any
restart, delete, or config change: read the logs, open `/admin/ops`, check the
queue state. Do this even when — *especially* when — the symptom looks
familiar. A "stuck audit" ten minutes after boot is healthy draining; a "stuck
audit" that's been zero-jobs-stale for thirty minutes is a different animal;
they look identical from the UI. `05-milestones.md`'s Stage 4 gate exists
because this discipline is the whole job — not a preamble to it.

The mechanical form of "look before you touch," repeated throughout this
doc: **read-only inspection first, always** (`pm2 status`, log tails, `sqlite3`
`SELECT`s, `/admin/ops`) — only reach for a mutation once you can say in one
sentence *why* the evidence points at it.

## 1. Deploy

The server pulls from GitHub — it never receives code any other way. An
unpushed commit deploys nothing, so the order below is not optional:

```bash
# 1. Push first. Nothing deploys until this lands on GitHub.
git push

# 2. Then deploy.
ssh seo@144.126.213.242 "~/deploy.sh"
```

**What `deploy.sh` does.** Its body lives only on the server — it is not in
this repo, and this doc does not invent its internals. What we know from
documented, observable effects (`docs/SERVER_SETUP.md` §7.1, corroborated by
`instrumentation.ts`'s comment about `fuser -k` sending SIGTERM): it pulls the
latest code, runs `npm install`, regenerates the Prisma client, rebuilds the
Next.js app, **stops the app before running migrations** (avoids SQLite lock
errors — this ordering must never be reversed if you ever touch the script),
applies pending migrations with `prisma migrate deploy`, and starts the app
again under PM2. Treat every other claim about the script's exact steps as
**server-verified-only** — settle real uncertainty with
`ssh seo@144.126.213.242 "cat ~/deploy.sh"` (read-only, always allowed), not by
guessing.

**Verify the deploy landed** — all four of these, every time:

```bash
# Process is up and the restart counter didn't just climb
ssh seo@144.126.213.242 "pm2 status"

# Boot was clean — no [startup] refusals, recovery ran
ssh seo@144.126.213.242 "pm2 logs seo-tools --lines 80 --nostream | grep -E '\[startup\]|\[shutdown\]|\[jobs\]|\[cleanup\]|Error'"

# The app answers
curl -sI https://<app-domain>/api/health

# Migrations applied
ssh seo@144.126.213.242 "cd /home/seo/webapps/seo-tools && DATABASE_URL='file:/home/seo/data/seo-tools/db.sqlite' npx prisma migrate status"
```

`<app-domain>` isn't recorded in this repo — read `NEXT_PUBLIC_APP_URL` from
the server's `.env` first. A behavior check (one smoke audit against a client
site already in the system, or a domain you control) is the last word: watch
it reach `complete` with no new `[cleanup]`/job errors in the logs.

**Two deploy traps worth knowing before your first one:**

- `npm ci` fails on the server (RunCloud lockfile drift) — the script uses
  `npm install`, and so should you if you're ever debugging by hand. Also see
  `CLAUDE.md`'s "Do not" list.
- Changing a value in `ecosystem.config.js` (pool sizes, concurrency, etc.) and
  then only running `pm2 restart` leaves the **old** env loaded — PM2 doesn't
  re-read the config file on a plain restart. That needs
  `pm2 delete seo-tools && pm2 start ecosystem.config.js`, and it's worth
  confirming with `pm2 env 0 | grep <VAR>` afterward.

## 2. Server layout

Everything runs on one VPS. This is a summary table; `04-how-it-runs.md`'s
"Production topology" section is the fuller narrative of *why* it's shaped
this way — read that first if this is your first time here.

| Thing | Path |
|---|---|
| App code | `/home/seo/webapps/seo-tools` |
| Database | `/home/seo/data/seo-tools/db.sqlite` (plus its `-wal` and `-shm` sidecar files — WAL mode) |
| Uploads | `/home/seo/data/seo-tools/uploads` |
| Generated report PDFs | `/home/seo/data/seo-tools/reports` |
| DB backup snapshots | `/home/seo/data/seo-tools/backups` (see §7) |
| Logs | `/home/seo/logs/` |

The data directory living *outside* the app directory is deliberate — a
deploy replaces the code wholesale without touching the database, uploads, or
backups sitting next to it.

## 3. Health and observability

Three layers, from shallowest to deepest.

**`/api/health`** — a public, unauthenticated endpoint (exact-match public
path in `middleware.ts`, so no cookie needed) meant for an uptime monitor. It
pings the database and returns:

- `503 {"status":"down"}` — the one hard-down signal this route emits (the DB
  ping itself failed).
- `200 {"status":"ok"|"degraded", "uptimeSec", "version"}` otherwise. `degraded`
  is a soft signal — new errored audits, exhausted jobs, a stalled audit, or a
  stale backup within the last 15 minutes — and deliberately stays `200` so a
  monitor doesn't false-page on it. The degraded flag is TTL-cached for 10
  seconds and **fails open to `ok`** on any internal error, by design — this
  endpoint must never itself become the outage.

**`/admin/ops`** — cookie-gated (same login as the rest of the app; it is
*not* in `middleware.ts`'s public-path list), always rendered live
(`dynamic = 'force-dynamic'`), and the deepest read-only view without SSH.
Five panels, each independently fault-isolated (a panel that fails to load
renders "unavailable" and logs the failure — the rest of the page still
renders):

- **System** — disk free and DB footprint (main + WAL combined).
- **Browser pool** — pages in use / pool size, waiting count, draining flag,
  whether the browser process is alive, pages served since last recycle.
- **Health signals** — the same signals `/api/health` summarizes, but with
  the actual counts and IDs: errored site/ADA audits in the last 15 minutes,
  exhausted jobs, a stalled audit (if any, with how many minutes stuck), and
  the newest backup's age in hours.
- **Job queue** — counts by job type × status, the oldest still-`running` job,
  and the ten most recent failures with their error text.
- **Maintenance (last run)** — last completion time, status, and error (if
  any) for each system job type: `cleanup`, `screenshot-sweep`,
  `stale-audit-reset`, `db-backup`, `health-alert`.

This panel is your first stop for "is it stuck?" before you ever open a shell.

**Structured logs.** Every server-side log line is JSON (via `pino`), written
to **stderr** in production — PM2 routes that to
`/home/seo/logs/seo-tools-error.log`, and stdout (`console.log`/`warn`, which
most subsystems still use directly) to `/home/seo/logs/seo-tools-out.log`.
Log lines carry a bracketed subsystem tag (`[jobs]`, `[queue]`, `[findings]`,
`[startup]`, `[cleanup]`, `[db-backup]`, `[health-alert]`, and others) — grep
by tag to isolate one subsystem's story:

```bash
ssh seo@144.126.213.242 "grep '\[findings\]' ~/logs/seo-tools-error.log | tail -20"
ssh seo@144.126.213.242 "grep '<AUDIT_ID>' ~/logs/seo-tools-*.log | tail -40"
```

The full, current tag catalog and what each one means when it fires lives in
`.claude/skills/er-seo-tools-diagnostics-and-tooling/SKILL.md` — that skill
(plus `er-seo-tools-debugging-playbook`) is where the *recipes* live; this doc
only tells you where to look.

One boot-safety detail worth knowing: the logger's own construction is
guarded end to end — an invalid `LOG_LEVEL` value cannot itself crash the
process at startup. If the app won't boot, the logger is never the cause;
look at the fail-fast gates in §5 instead.

## 4. Common diagnoses

Symptom-first. This table is a map to the *right* recipe, not the recipe
itself — the two project skills linked below own the full triage trees, exact
SQL, and log-line vocabulary; don't duplicate them by hand.

| Symptom | What's actually happening | Where to go |
|---|---|---|
| Audit stuck in `queued` | Only one site audit runs at a time (FIFO) — if another audit is `running`/`pdfs-running`/`lighthouse-running`, this is the queue working as designed | Check `/admin/ops`'s Job queue panel, or `er-seo-tools-debugging-playbook`'s "Site audit stuck in `queued`" row |
| Audit stuck in `running`/`pdfs-running`/`lighthouse-running` | Two very different states look the same in the UI: still draining (jobs exist in its group — healthy) vs. orphaned (zero jobs — the finalizer crashed). `SiteAudit.updatedAt` is the heartbeat; anything over 5 minutes stale with zero live jobs gets one finalize attempt then failed by the `stale-audit-reset` sweep, which runs every 10 minutes | `er-seo-tools-diagnostics-and-tooling`'s `audit-state.sh` gives you the WORKING/SETTLING/STUCK verdict directly; if it says STUCK, waiting out the next 10-minute sweep is usually the right first move, not a manual fix |
| 502 Bad Gateway | NGINX can't reach the Node process on port 3000 — almost always the app is down or still starting | `pm2 status`, then `ss -tlnp \| grep 3000`, then the NGINX error log (`docs/SERVER_SETUP.md` §9.2); `pm2 restart seo-tools` if the process is simply down |
| PM2 restart loop (climbing restart count, short uptime) | Either a startup fail-fast gate refused to boot, or a real crash. The three fail-fast gates in `instrumentation.ts` (`PILLAR_TOKEN_SECRET`, auth config, the Chromium egress guard) log `[startup] ... Refusing to start.` and call `process.exit(1)` — deliberately loud rather than silently limping. An **invalid `LOG_LEVEL` cannot cause this** — the logger's construction is fully guarded (see §3) | `pm2 logs seo-tools --err --lines 30 --nostream`, grep for `[startup]`; a missing env var after shipping a new required one is the classic cause |
| OOM / crashes during audits | Chrome pages are memory-heavy (~150–200 MB resident each); PM2's `max_memory_restart` (2400M) kills the process before the kernel OOM-killer would — so `dmesg` can look completely clean while PM2 did the killing | `pm2 describe seo-tools \| grep -E 'restarts\|uptime'`; full decision tree in `er-seo-tools-debugging-playbook`'s "`Audit timed out (server may have restarted)`" section |
| `[findings] dual-write failed` in logs | The findings-layer write failed *after* the legacy audit/session already committed successfully — by design this never fails the audit itself, it just leaves the normalized tables lagging | `npx tsx scripts/findings-rebuild.ts <id>` (prod: `cd /home/seo/webapps/seo-tools && npx tsx scripts/findings-rebuild.ts <id>`) — only works while the origin blob still exists, i.e. before the 90-day prune |
| Share link 404s | 30-day token TTL expired and cleanup nulled the token — or the link was built from request origin instead of `NEXT_PUBLIC_APP_URL` (never do the latter) | Check `shareToken`/`shareExpiresAt` on the row per `er-seo-tools-debugging-playbook`; an expired link just needs re-sharing, it isn't a bug |

For anything not in this table, `er-seo-tools-debugging-playbook`'s "Symptom →
first move" table is the fuller version, and
`er-seo-tools-diagnostics-and-tooling` is where the read-only instruments
(`queue-state.sh`, `audit-state.sh`, `findings-coverage.sh`) live for turning
"it looks stuck" into an actual number.

## 5. What retention deletes

A daily `cleanup` job (seeded as the `system-cleanup` schedule, `daily@09:00`
server-local) runs several independent deletion passes: terminal `Job` rows
age out after 7–30 days; schedule-originated site audits are pruned on a
per-cadence window (manually started audits are **never** touched); and the
big JSON result blobs on origin rows (`Session.result`, `SiteAudit.summary`,
`AdaAudit.result`) are nulled out 90 days after completion — the audit itself
and its normalized findings rows survive, and every read surface degrades to
an "archived" banner view rebuilt from those tables rather than disappearing.
If data looks like it "vanished," check this before suspecting a bug. The full
per-task window table and the fallback-view behavior live in
`04-how-it-runs.md` section 4 and in `CLAUDE.md`'s "Findings layer" bullet;
`.claude/skills/er-seo-tools-run-and-operate/SKILL.md`'s retention table is
the always-current source for the exact day counts.

## 6. Backups

Here is what actually exists today, not what the topology *should* have:

- A daily `system-db-backup` schedule (seeded like any other system schedule,
  `daily@08:00` — an hour before the cleanup pass runs its retention deletes,
  so a fresh snapshot always predates that day's pruning) runs
  `runDbBackup()` (`lib/ops/backup.ts`): a `VACUUM INTO` snapshot of the live
  SQLite database (safe under WAL, no checkpoint required), written to a temp
  file first and atomically renamed on success so an interrupted run can never
  leave a half-written file masquerading as a good backup. Old snapshots are
  pruned to the newest N (`BACKUP_RETENTION_COUNT`, default and prod value 7).
- Snapshots land in `BACKUP_DIR`, which prod sets to
  `/home/seo/data/seo-tools/backups` (`ecosystem.config.js`) — **the same
  disk as the live database.** There is no off-server copy anywhere in this
  system. A disk failure or a `rm -rf` in the wrong directory takes out the
  live DB and every backup of it together.
- The `health-alert` schedule (every 15 minutes) checks the newest backup's
  age against a staleness threshold (`BACKUP_STALE_HOURS`, default 26 hours)
  and surfaces a "backup stale" line — visible in `/admin/ops`'s Health
  signals panel and in `/api/health`'s `degraded` flag — if no recent snapshot
  exists. Whether that alert also reaches a human depends on
  `ALERT_WEBHOOK_URL` being set in the server's `.env` (it posts a
  Slack-incoming-webhook-shaped message if set; if unset, the alert is
  computed and logged, never sent, and nobody is paged). Whether that variable
  is actually configured in prod is **not verifiable from this repo** — check
  with `ssh seo@144.126.213.242 "grep -oE '^ALERT_WEBHOOK_URL' /home/seo/webapps/seo-tools/.env"`
  (names only; never print the value) before assuming anyone gets notified.
- A manual, on-demand snapshot is one command away:
  `npx tsx scripts/db-backup.ts` (same `runDbBackup()` under the hood) — worth
  running before anything risky (a manual migration recovery, a schema change
  you're nervous about).
- **There is no documented or tested restore procedure.** The snapshots exist;
  turning one back into a live database (stop the app, replace `db.sqlite`
  plus its `-wal`/`-shm`, restart, verify) has never been exercised end to end
  in this repo as far as the code or docs show. If you ever need to actually
  restore one, treat it as a first-time drill, not a known-good runbook step —
  and it is Kevin-gated regardless (a DB restore from backup is explicitly
  outside the autonomous-ops gate policy in
  `er-seo-tools-change-control`).

That's the honest picture: automated, same-disk, retained, and monitored for
staleness — but single-point-of-failure and unproven-in-a-real-restore. Don't
let the presence of a backup schedule read as "we have disaster recovery."

## 7. Stage 4 drills

These mirror `05-milestones.md`'s Stage 4 gate exactly — this doc is what you
work through *during* that stage, not a separate checklist.

1. **A supervised deploy.** Push, then run the deploy command, with Kevin
   watching and narrating what he's checking at each step (§1's verification
   list is exactly what he's checking).
2. **A supervised diagnosis of a stuck or failed audit.** Using `/admin/ops`
   and the logs, work out *why* an audit is stuck before touching anything —
   the prime directive at the top of this doc, applied live. Walk through the
   evidence you'd look at in the order you'd look at it (§4's table is the
   map, not the answer).
3. **One unsupervised deploy, and one unsupervised diagnosis**, each narrated
   to Kevin afterward — what you checked, in what order, and why you
   concluded what you concluded.

You own this stage — per `05-milestones.md`'s gate — once both unsupervised
drills are done and narrated, and you can answer "what would you check first?"
for a stuck audit, a 502, and a restart loop without hesitating. Until then:
no production queue operations of any kind, and no server SSH mutations, full
stop — the supervised drills come first, every time, regardless of how
confident a specific fix feels.
