# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-02 (D0 complete) · **Updated by:** D0 **SHIPPED + DEPLOYED + PROD-VERIFIED** (PR #86). No verification pending — next is a **roadmap choice** again (A2-f1 / C-track / SF-retirement campaign Phase 1).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: D0 (minimal ops safety — DB backup + failure alert) is SHIPPED + DEPLOYED
+ PROD-VERIFIED (PR #86, 2026-07-02): two in-app durable jobs — db-backup
(daily@08:00, VACUUM INTO + prune) and health-alert (every:15m → optional
ALERT_WEBHOOK_URL; dark by default). Slack webhook NOT yet set (Kevin's request
pending admin approval — alerts currently log-only). C6 Phase 4 + C10 also
PROD-VERIFIED + closed. Work from main. A 16-skill operator library lives in
.claude/skills/.

1. Load the skill er-seo-tools-change-control first (hard gates: no merge/
   deploy/server mutation without Kevin's explicit go IN THIS conversation; docs
   rituals mandatory; never scan non-client sites).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. There is no pending verification — the next move is a ROADMAP CHOICE. Confirm
   direction with Kevin, then run the full change-control pipeline (spec → Codex
   → plan → Codex → TDD → gates → PR → Kevin merges/deploys → prod-verify). Menu:
   - A2-f1 — findings-rebuild pruned-ADA guard (small hardening; data-loss trap
     if scripts/findings-rebuild.ts runs against a pruned ADA audit).
   - C-track: C7 (parser consolidation + streaming parse + per-file failure
     isolation), C8 (configurable scoring weights + score-explanation panel),
     C9 (ADA scoring v2 + poller/results-view consolidation), or further C6
     (SEO-only scan mode — spec §9 breadcrumb; external-link verification).
   - SF-retirement campaign Phase 1 (SF-vs-live parity) — a MEASUREMENT stream
     (analysts run SF + upload alongside seoIntent live scans over 2–3 cycles),
     not a one-session build. Load er-seo-tools-sf-retirement-campaign; parity
     script at .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/
     sf-live-parity.ts.
4. Small open D0 follow-ups (not blocking, do when convenient): set
   ALERT_WEBHOOK_URL in the server .env once Slack admin approves; the manual
   scripts/db-backup.ts must be run as `BACKUP_DIR=/home/seo/data/seo-tools/
   backups npx tsx scripts/db-backup.ts` (a bare SSH shell lacks BACKUP_DIR →
   writes to the release dir) — consider adding a warning when BACKUP_DIR is
   unset; a stray 444 MB backup + alert-state.json may still sit in
   /home/seo/webapps/seo-tools/data/backups/ (safe to rm).
5. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **COMPLETE 2026-07-02: D0 — minimal ops safety (DB backup + failure alert).**
  SHIPPED (PR #86, merged to main `6f1c45f`) + deployed + PROD-VERIFIED. Two
  in-app durable jobs reusing the queue + system-schedule pattern — **no schema
  migration, no server cron.** Spec/plan Codex-reviewed (fixes applied),
  archived under `docs/superpowers/archive/`. Code:
  - `lib/ops/backup.ts` — `runDbBackup()` (`VACUUM INTO` a `.tmp` + atomic
    rename; prune to `BACKUP_RETENTION_COUNT`=7) + `newestBackupMtimeMs()`.
  - `lib/ops/alert-state.ts` — atomic JSON dedup store under `BACKUP_DIR`.
  - `lib/ops/alert-webhook.ts` — `sendAlert()` → `{sent, skipped}`; unset URL =
    dark; never throws.
  - `lib/ops/health-check.ts` — pure `evaluateHealth()` + DB/FS
    `collectHealthSignals()`; 4 conditions (errored audits [SiteAudit.updatedAt /
    **AdaAudit.completedAt**], exhausted jobs, stalled queue [5 non-terminal
    SiteAudit statuses, 60-min bar], stale backup).
  - `lib/jobs/handlers/{db-backup,health-alert}.ts`; wired in `register.ts` +
    `SYSTEM_SCHEDULES`; `scripts/db-backup.ts` manual/restore-prep.
  - `ecosystem.config.js` — `BACKUP_DIR=${DATA_HOME}/backups`.
  - **Prod-verified:** PM2 online 0 restarts; `BACKUP_DIR` loaded in the running
    env; both Schedule rows seeded; boot health-alert ran + correctly detected
    "no snapshot" + dark (webhook unset); a 444 MB snapshot in the persistent dir
    opens as valid SQLite (29 tables); disk 63 GB free.
  - **Open follow-ups (small):** set `ALERT_WEBHOOK_URL` once Slack admin
    approves (alerts log-only until then); manual-script `BACKUP_DIR` footgun
    (run with `BACKUP_DIR=…`); optional cleanup of a stray release-dir backup.
- **PROD-VERIFIED 2026-07-02: C6 Phase 4 — autonomous live SEO source + native
  link graph.** Merged (PR #85) + deployed (prod @ `9c07502`, migration
  `20260630120000_live_seo_source`). Campaign Gate 0.3 on client 12
  manhattanschool.edu: live-scan `CrawlRun` `54680dd9` seoIntent=true, score=98,
  link graph + findings + canonical both-branches + brief + pillar all green.
  Spec/plan archived. C6 stays `[~]` (hybrid discovery / validation / similarity
  / analytics-remainder still open).
- **COMPLETE 2026-07-02: C10 — SEO Performance Reports.** Merged (PR #75) +
  deployed 2026-06-22; PROD-VERIFIED by Kevin. Service-account auth; SA key at
  `/home/seo/data/seo-tools/google-sa.json` (0600), SA email
  `er-seo-reports@seo-apps-485618.iam.gserviceaccount.com`. Delivers the GA4/GSC
  half of SF-retirement Phase 6.
- **16-skill operator library** under `.claude/skills/` (commit `57ae636`, on
  main).
- **A1, A2, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE. C10 DONE. D0 DONE.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only,
  null score — by design).
- **⚠ PENDING HUMAN STEPS (Kevin) — optional/open, none blocking:**
  1. **D0:** set `ALERT_WEBHOOK_URL` in server `.env` once Slack admin approves;
     optional `rm -rf /home/seo/webapps/seo-tools/data/backups` (stray files).
  2. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan
     409-blocking the localStorage import — keep or delete + re-open).
  3. **First real qct_ push** not yet exercised.
  4. **Optional cleanup:** delete PillarAnalysis `cmr43gufj0001y200n9134fjp`
     (C6 Phase-4 pillar smoke artifact) if unwanted.
  5. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is
     gained.
- **Blocked / gated:** Anthropic API billing (03 Phase 3 + SF-retirement memo
  consumption); sitemap miss-rate measurement not yet run; daily/nightly cadences
  still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups (not next items):** D0 off-box backup replication
  (S3/rsync — v1 keeps snapshots on-box only); D0 manual-script BACKUP_DIR
  warning; C6 SEO-only scan mode (spec §9), external-link verification,
  redirect/canonical/hreflang validation (campaign Phase 4), content similarity
  (campaign Phase 5), daily-cadence supersede-trimming; standalone single-page
  audit CSV/VPAT/report; public share-page export buttons; expandable rows on
  public ADA share view; logo for the PDF; `SessionPage` model drop (≥180 d after
  2026-06-11); same-URL standalone-audit diffing; fleet instance-level diffing;
  B2 v1 multi-domain limitation.

## Next item

**No verification pending — this is a roadmap CHOICE.** Confirm direction with
Kevin, then run the full change-control pipeline for whatever is picked (spec →
Codex → plan → Codex → TDD → gates → PR → Kevin merges/deploys → prod-verify).
Menu:

1. **A2-f1 — findings-rebuild pruned-ADA guard.** Small hardening:
   `scripts/findings-rebuild.ts` against a pruned ADA audit is a data-loss trap;
   add a guard. Bugfix/small-feature class.
2. **C-track menu:** C7 (parser consolidation + streaming parse + per-file
   failure isolation), C8 (configurable scoring weights + score-explanation
   panel), C9 (ADA scoring v2 + poller/results-view consolidation), or further C6
   (SEO-only scan mode — spec §9 breadcrumb; external-link verification).
3. **SF-retirement campaign Phase 1 (SF-vs-live parity)** — unblocked, but it is a
   MEASUREMENT stream, not a one-session build: analysts run SF + upload at
   `/seo-parser` alongside a `seoIntent:true` live scan on the same client+day
   over 2–3 reporting cycles; the parity script
   (`.claude/skills/er-seo-tools-sf-retirement-campaign/scripts/sf-live-parity.ts`)
   reports score delta / page-set Jaccard / per-issue-type deltas. Gate: N ≥ 5
   clients × 2–3 cycles, every deviation explained in a dated parity log under
   `docs/superpowers/todos/`. Also produces the sitemap miss-rate evidence that
   gates SF-retirement Phase 2. Load `er-seo-tools-sf-retirement-campaign`.

- **C10 non-blocking follow-ups** (defer): GA4 comparison window discards 4 metric
  groups (quota trim — `ga4-provider.ts`); `rollupBatchStatus` duplicated (render
  job vs `lib/services/seo-reports.ts`); `pruneSeoReports` should chunk
  `doomedIds`; stricter date/client validation on `POST /api/reports`.

## Gotchas / decisions already made (don't relitigate)

- **D0 invariants (verified against code + prod 2026-07-02):**
  - **Two in-app durable jobs, NOT a server cron** — no schema migration (dedup =
    an atomic JSON file under `BACKUP_DIR`). Backup = `VACUUM INTO` a `.tmp` then
    atomic rename (a partial VACUUM never fools staleness); bare `$executeRawUnsafe`
    (VACUUM can't run in a transaction — does NOT violate the array-form rule).
  - **`AdaAudit` has NO `updatedAt`** — edge-trigger ADA errors on `completedAt`.
  - **All new env vars OPTIONAL with code defaults** — `ALERT_WEBHOOK_URL` unset =
    dark (log, don't send); nothing `process.exit(1)`s at boot.
  - **`BACKUP_DIR` is an ecosystem.config.js env var** → a deploy that only
    `pm2 restart`s will NOT load it; needs `pm2 delete seo-tools && pm2 start
    ecosystem.config.js`. The manual `scripts/db-backup.ts` in a bare SSH shell
    also lacks it → prefix `BACKUP_DIR=/home/seo/data/seo-tools/backups`.
  - **Delivery-aware dedup:** advance state only on no-alerts / sent / dark; a
    genuine delivery failure retries next tick.
  - Webhook URL is trusted operator config (not user input) → plain timed `fetch`,
    never `safeFetch`. Job POSTs `{text}` (Slack/Google-Chat native).
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`). Drive prod checks via
  `npx tsx` from `/home/seo/webapps/seo-tools` (relative `./lib/...` + `@/` alias
  only resolve from the app dir). Server has no `sqlite3` CLI. **pm2 process env
  ≠ login-shell env ≠ .env:** ecosystem `env:` vars are injected into the pm2
  process only (visible via `pm2 env <id>` / jlist), NOT into an SSH shell; `.env`
  vars are read by the app at startup (any restart reloads them). Prod DB is at
  `/home/seo/data/seo-tools/db.sqlite` (~456 MB); DATA_HOME=`/home/seo/data/seo-tools`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only,
  conditionals via SQL `EXISTS`, manual `updatedAt = Date.now()` in raw SQL.
- **Local dev quirk:** prefix prisma CLI + vitest with
  `DATABASE_URL="file:./local-dev.db"` (resolves to `prisma/local-dev.db`).
  `prisma migrate dev` is interactive-only — hand-write migration SQL, apply with
  `migrate deploy`. **vitest module mocks must use `vi.hoisted(() => ({...}))`**
  (top-level `const fn = vi.fn()` referenced in a `vi.mock` factory throws
  "Cannot access before initialization").
- **C10 invariants:** SERVICE-ACCOUNT auth (key in `GOOGLE_SA_KEY_FILE`, no
  GoogleConnection model / no OAuth routes); GA4 via `analyticsdata('v1beta')`,
  GSC via `searchconsole('v1')`; per-property 403 → `unmapped` (not global auth);
  `gscSiteUrl` verbatim; job group `seo-report:<id>` NEVER `site-audit:<id>`;
  manual prospects entry must null `metricsJson` before re-enqueue; idempotency
  `@@unique([scheduleId,scheduledFor])` + `@@unique([batchId,clientId])`; monthly
  schedule is a NON-system operator row; reports get their own `pruneSeoReports`.
- **C6 Phase 4 invariants:** `seoIntent` is the freshness-gated canonical SEO
  signal (`lib/services/seo-canonical.ts`: fresh sf-upload ≤30 d wins; else newest
  seoIntent live run becomes canonical AND feeds score surfaces); schedules are
  operator-created (NO self-healing auto-creation — frontier item);
  `computeLinkGraph` pure/offline off `CrawlPage.inlinks/outlinks`; canonical
  page-facts provider is `lib/services/canonical-page-facts.ts` (`lib/seo/providers/`
  does NOT exist); live consumption is pat_/brief only (srt_/krt_ stay SF-only);
  SEO-only scan mode NOT built (spec §9 breadcrumb). Canonical selection is
  merge-state-sensitive.
- **C6 Phases 1–3 invariants:** a SiteAudit holds up to TWO CrawlRuns (compound
  `{siteAuditId_tool}` for findUnique/update); live-scan run has no origin blob;
  one builder (`broken-link-verify`) owns runId + shared ensurePage; injected
  `parseSeoFromDocument` must be SWC-helper-free (no `typeof`); `scoreLiveSeo`
  segregated (never displaces sf-upload canonical); null for noindex/login or
  <50% observed coverage; `observed`=HarvestedPageSeo row count.
- **Handoff-token / public route gotcha (bit us THREE times):** any new
  token-authed or public route MUST get a `middleware.ts` `isPublicPath` entry +
  a `middleware.test.ts` case.
- Test gotchas: DB-backed tests use a unique domain/id/name prefix + scoped
  cleanup (never broad `deleteMany`); clean `CrawlRun` by domain before origin
  rows; CrawlRun-by-`siteAuditId` unique reads need compound `siteAuditId_tool`;
  vitest jsdom has NO localStorage; node is the default env; a GLOBAL query in a
  DB test (e.g. `findFirst` over shared rows) needs a forced-extreme value to
  stay deterministic.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction.

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, handoff created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), prod-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), prod-verified. **A2 COMPLETE.**
- 2026-06-11 — B1 (#60), B2 (#61), B3 (#62), B4 (#63), B5 (#64 + middleware fix) shipped + prod-verified. **TRACK B COMPLETE.**
- 2026-06-11 — **C1 SHIPPED (PR #65)** — standalone ADA audits durable.
- 2026-06-12 — **C2 SHIPPED (PR #66)** — scheduled scans; weekly canary live.
- 2026-06-12 — **C3 SHIPPED (PR #67)** — ADA run diffing; ada-audit prune ACTIVE.
- 2026-06-12 — **C4 SHIPPED (PR #68)** — reporting layer (share/CSV/PDF/VPAT).
- 2026-06-12 — **C5 SHIPPED (PR #69)** — source-agnostic ingestion; seo-parser prune ACTIVE.
- 2026-06-16 — **C6 Phase 1 SHIPPED (PR #70), prod-verified.**
- 2026-06-17 — **C6 Phase 2 SHIPPED (PR #71), prod-verified** — on-page SEO extraction.
- 2026-06-17 — **C6 Phase 3 SHIPPED (PR #73), prod-verified** — live SEO score.
- 2026-06-22 — **C10 SHIPPED (PR #75) + build-heap fix (#76), deployed, migration applied.**
- 2026-06-30 — **C6 Phase 4 BUILT** — autonomous live SEO source + native link graph.
- 2026-07-02 — **Skill library SHIPPED (`57ae636`)** — 16 operator skills. New items: A2-f1, D0.
- 2026-07-02 — **C6 Phase 4 MERGED + DEPLOYED (PR #85) + PROD-VERIFIED** (campaign Gate 0.3).
- 2026-07-02 — **C10 PROD-VERIFIED (Kevin). C10 COMPLETE.** Both prior prod-verifications closed.
- 2026-07-02 — **D0 SHIPPED (PR #86) + DEPLOYED + PROD-VERIFIED. D0 COMPLETE.** DB
  backup + failure alert, two in-app durable jobs, no schema migration. Deployed
  via `pm2 delete && pm2 start` (new `BACKUP_DIR` ecosystem var). Prod: PM2 online,
  schedules seeded, 444 MB snapshot opens clean, alert pipeline correct + dark
  (Slack webhook pending admin approval). Spec/plan archived.
