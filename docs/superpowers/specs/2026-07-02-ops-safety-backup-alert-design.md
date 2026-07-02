# D0 — Minimal Ops Safety: DB Backup + Failure Alert

**Status:** draft (spec) · **Date:** 2026-07-02 · **Roadmap item:** D0 (Track D,
pulled forward, Kevin-approved) · **Class:** feature (multi-file code); **no
schema migration**.

## 1. Problem & goal

The agency-in-a-box goal requires the system to **survive data loss** and
**notice its own failures**. Today neither is true in a verifiable way:

- **No DB backup is recorded in the repo.** The production SQLite file
  (`${DATA_HOME}/db.sqlite`) is the single source of truth for clients, audits,
  findings, schedules, and reports. A disk loss or a bad write with no recent
  snapshot is unrecoverable. (Whether an ad-hoc server-side cron exists is being
  verified out-of-band; this design is additive and version-controlled either
  way.)
- **No monitoring exists.** There is no email/SMTP, webhook, or Slack sender
  anywhere in `lib`/`app`. Audits can error, the queue can stall, or a durable
  job can exhaust its attempts, and nobody is told.

**Goal:** the smallest change that (a) takes an automatic, pruned, consistent DB
backup on a schedule, and (b) sends one alert to the operator when something is
wrong. Full observability (metrics, dashboards, log aggregation) stays
out-of-scope — that is A4/D-track.

## 2. Scope

**In scope**
- A durable `db-backup` job on a system schedule: `VACUUM INTO` a timestamped
  copy under a backups dir, prune to the last N.
- A durable `health-alert` job on a system schedule: evaluate a fixed set of
  failure conditions and POST a message to a configured webhook.
- Both wired into `SYSTEM_SCHEDULES` (seeded idempotently at boot, same pattern
  as `system-cleanup`).
- New **optional** env vars, all with safe defaults (none required-in-prod, so
  no `instrumentation.ts` fail-fast boot brick).

**Out of scope (explicit YAGNI)**
- Off-box backup replication (S3/rsync-to-remote). Local snapshots only in v1;
  document the manual copy-off step in the PR.
- Email/SMTP delivery (Kevin chose webhook).
- Any UI. Alerts and backups are headless.
- Restore automation. Restore is a documented manual step (stop app → copy
  backup over `db.sqlite` → start) in the PR, not code.
- Schema changes. Alert dedup uses a JSON state file, not a new table.

## 3. Decisions (from brainstorming, 2026-07-02)

| Decision | Choice |
|----------|--------|
| Backup mechanism | **In-app durable job** (`db-backup`), not a server cron |
| Alert channel | **Webhook** — `ALERT_WEBHOOK_URL`, Slack-compatible `{text}` POST |
| Alert triggers | **All four:** audits errored · queue stalled · backup failed/stale · jobs exhausted |
| Dedup/state | **JSON state file** under `DATA_HOME` (no schema migration) |

## 4. Backup half

### 4.1 Module boundaries
- `lib/ops/backup.ts` — pure-ish runner. `runDbBackup({ backupDir, retention, now, dbPath? }) → { file, bytes, prunedCount }`. Does the `VACUUM INTO`, then prunes. Reusable from a script.
- `lib/jobs/handlers/db-backup.ts` — the durable job handler: resolves config from env, calls `runDbBackup`, records outcome (see 4.4), logs `[db-backup]`.
- `scripts/db-backup.ts` — thin `npx tsx` wrapper for a manual on-demand backup (calls `runDbBackup`). Documented as the restore-prep tool.

### 4.2 Mechanism
- Backups dir resolved at call time: `process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups')` — mirrors the `REPORTS_DIR` pattern (`lib/report/seo/seo-report-file.ts:8`). In prod set `BACKUP_DIR=${DATA_HOME}/backups` in `ecosystem.config.js`.
- `mkdir -p` the dir (recursive, idempotent).
- Snapshot via `prisma.$executeRawUnsafe(\`VACUUM INTO '<target>'\`)`. `VACUUM INTO`:
  - produces a **consistent single-file snapshot** even under WAL (WAL is on — `lib/db.ts:27`); the output is a compact, checkpointed plain DB.
  - the target is an app-constructed absolute path with a timestamped filename — **no user input**, so string interpolation is safe here. Single-quote the literal.
  - **Constraint:** VACUUM cannot run inside a transaction. Call it as a bare `$executeRawUnsafe`, never inside `$transaction([...])`. This does not conflict with the array-form-only rule (that rule is about interactive transactions; this is a single statement).
- Filename: `db-YYYYMMDD-HHMMSSZ.sqlite` (UTC, from `now`). `Date.now()`/`new Date()` are allowed in app code (only Workflow scripts forbid them).
- Prune: list `db-*.sqlite` in the dir, sort by filename (timestamp sorts lexicographically), delete all but the newest `retention` (default 7). ENOENT-tolerant.

### 4.3 Cadence
- System schedule `system-db-backup`, cadence `daily@08:00` (server UTC; before `system-cleanup` at 09:00 so a fresh snapshot precedes retention deletes), `immediate: false`.
- Job type `db-backup`: concurrency 1, timeout 600_000, 2 attempts, group/dedup `db-backup` (singleton — one at a time).

### 4.4 Recording outcome (for the "backup stale/failed" alert)
The alert job must know whether a recent backup succeeded. Rather than add a
table, it derives freshness from the **filesystem**: the newest `db-*.sqlite`
mtime in `BACKUP_DIR`. A failed VACUUM writes no file, so "no file newer than
the expected window" == "backup is failing or not running". The `db-backup`
handler additionally lets its own failure bubble so the durable-job machinery
records an `error` Job row (which also feeds the "jobs exhausted" trigger).

## 5. Alert half

### 5.1 Module boundaries
- `lib/ops/alert-webhook.ts` — `sendAlert(text) → Promise<{ sent: boolean }>`. Reads `ALERT_WEBHOOK_URL` at call time; **no-op (return `{sent:false}`, log once) when unset** so the feature is dark until configured and never bricks boot. Plain `fetch`, `POST {text}`, 8 s `AbortController` timeout, best-effort (never throws — a webhook failure must not fail the job).
- `lib/ops/alert-state.ts` — `readAlertState()` / `writeAlertState(s)` against `path.join(BACKUP_DIR-sibling or DATA_HOME, 'alert-state.json')`. State: `{ lastCheckAt: number, cooldowns: Record<conditionKey, number> }`. Missing/corrupt file → default empty state (try-catch, never throw).
- `lib/ops/health-check.ts`:
  - `collectHealthSignals(now, state) → HealthSignals` — the only DB-reading part. Runs the queries in 5.3.
  - `evaluateHealth(signals, state, now) → { alerts: string[], nextState }` — **pure**, fully unit-testable. Applies windowing + cooldown, returns human-readable alert lines and the new state.
- `lib/jobs/handlers/health-alert.ts` — handler: read state → collect → evaluate → if alerts, `sendAlert(joined)` → persist `nextState` (only advance `lastCheckAt`/cooldowns after a send attempt). Logs `[health-alert]`.

### 5.2 Cadence
- System schedule `system-health-alert`, cadence `every:15m`, `immediate: true`.
- Job type `health-alert`: concurrency 1, timeout 60_000, 2 attempts, group/dedup `health-alert`.

### 5.3 Conditions
Each condition yields at most one alert line per run and is guarded so it does
not re-fire every 15 minutes.

| Key | Detection | Debounce |
|-----|-----------|----------|
| `audits-errored` | `SiteAudit` or `AdaAudit` with `status='error'` and `updatedAt > lastCheckAt` (edge-triggered on new errors) | natural (window since `lastCheckAt`) |
| `jobs-exhausted` | `Job` with `status='error'` and `updatedAt > lastCheckAt` | natural |
| `queue-stalled` | oldest audit in a transient status (`queued`/`running`/`pdfs-running`/`lighthouse-running`) with `updatedAt` older than `QUEUE_STALL_MINUTES` (default 60) | **cooldown** `ALERT_COOLDOWN_MINUTES` (default 360) on the key |
| `backup-stale` | newest `db-*.sqlite` mtime older than `BACKUP_STALE_HOURS` (default 26), OR no backup file exists | **cooldown** on the key |

- `lastCheckAt` is read from state, then set to `now` after evaluation — this is the window boundary for the edge-triggered conditions. First-ever run (no state) uses a bounded look-back (`now - cadence`) so a cold start doesn't dump the entire error history.
- The alert job is **observe-only**: it never mutates audits/jobs. Stale-audit *recovery* remains `stale-audit-reset`'s job; this only reports what recovery could not fix (hence the 60-min bar, well above the 5-min recovery threshold).

### 5.4 Message format
Slack incoming webhooks accept `{ "text": "..." }`; a plain generic endpoint
gets the same JSON. One POST per run, all firing conditions joined:

```
:rotating_light: er-seo-tools alert (prod)
• 2 audits errored since last check
• queue stalled: audit <id> transient for 74m
• backup stale: newest snapshot 31h old
```

Host/environment label from `NEXT_PUBLIC_APP_URL` or a fixed "prod" string; no
secrets, no IPs, no ops strings in the payload.

## 6. New env vars (all optional, safe defaults)

| Var | Default | Meaning |
|-----|---------|---------|
| `ALERT_WEBHOOK_URL` | *(unset)* | Webhook endpoint. Unset → alerts computed + logged, **not sent**. |
| `BACKUP_DIR` | `${cwd}/data/backups` | Where snapshots + `alert-state.json` live. Prod: `${DATA_HOME}/backups`. |
| `BACKUP_RETENTION_COUNT` | `7` | Snapshots to keep. |
| `QUEUE_STALL_MINUTES` | `60` | Transient-audit age that trips `queue-stalled`. |
| `BACKUP_STALE_HOURS` | `26` | Backup-file age that trips `backup-stale`. |
| `ALERT_COOLDOWN_MINUTES` | `360` | Re-alert suppression for level conditions. |

None are required in prod → no `instrumentation.ts` fail-fast risk. The only
prod config change is adding `BACKUP_DIR` (and later `ALERT_WEBHOOK_URL`) to
`ecosystem.config.js` — flagged in the PR as a Kevin pre-deploy step, and a
`pm2 delete && pm2 start` (env changes are not picked up by `pm2 restart`).

## 7. Testing

- `lib/ops/backup.test.ts` (DB-backed, `DATABASE_URL="file:./local-dev.db"`): `runDbBackup` writes a file, the file opens as a valid SQLite DB, prune keeps exactly `retention` newest. Tmp `BACKUP_DIR` via `vi.stubEnv`.
- `lib/ops/health-check.test.ts` — **pure** `evaluateHealth`: each condition fires/doesn't at the right thresholds; cooldown suppresses a second fire; edge-triggered conditions ignore rows older than `lastCheckAt`; cold-start look-back bound. No DB.
- `lib/ops/alert-webhook.test.ts`: unset URL → `{sent:false}` no fetch; set URL → one POST with `{text}`; fetch rejection swallowed. `fetch` mocked.
- `lib/ops/alert-state.test.ts`: round-trip; missing file → default; corrupt JSON → default.
- Handlers: light integration — `db-backup` calls `runDbBackup` and rethrows on failure; `health-alert` wires read→collect→evaluate→send→persist and never throws. `collectHealthSignals` DB-backed with seeded error/stale rows (unique-prefixed ids, scoped cleanup — house convention).
- Gate-green: `npm run lint` + `npm test` + `npm run build`.

## 8. Prod verification (after Kevin merges + deploys)

1. Confirm `system-db-backup` + `system-health-alert` Schedule rows exist (seeded at boot).
2. Trigger a backup off-cadence (enqueue `db-backup` via `npx tsx` from the app dir) → confirm a `db-*.sqlite` appears in `BACKUP_DIR`, opens in `sqlite`/Prisma, size ≈ live DB.
3. With `ALERT_WEBHOOK_URL` set to a test Slack channel, force a condition (e.g. temporarily lower `BACKUP_STALE_HOURS`) → confirm exactly one message arrives, and a second run within cooldown does not re-fire.
4. Confirm no webhook is sent when `ALERT_WEBHOOK_URL` is unset (dark by default).

## 9. Risks / notes

- `VACUUM INTO` reads the whole DB and holds a shared lock briefly; the prod DB
  is small, backup runs off-peak (08:00 UTC), concurrency 1 — negligible.
- The JSON state file is single-process-safe (one PM2 fork, job concurrency 1).
  A process restart at worst re-alerts a level condition once — acceptable
  (over-alert beats miss). File loss → defaults → same one-time re-alert.
- Webhook URL is **operator-configured trusted config**, not user input, so it
  is not an SSRF surface; a plain timed `fetch` is appropriate (not `safeFetch`,
  which would block legitimately-internal endpoints).
- v1 keeps snapshots **on the same box** as the DB — protects against bad
  writes/logical corruption, not full disk loss. Off-box copy is a documented
  manual step and a named follow-up, not silently omitted.
