# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-02 (D0 built) · **Updated by:** D0 **BUILT + PR #86 opened** (`feat/ops-safety-backup-alert`) — full change-control pipeline (spec→Codex→plan→Codex→TDD→gates) done in one session; **awaiting Kevin merge → deploy → prod-verify**. Next action is a HUMAN step (Kevin), then D0 prod-verification.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: D0 (minimal ops safety — DB backup + failure alert) is BUILT and in PR #86
(branch feat/ops-safety-backup-alert), gates green (tsc / 2891 tests / build),
spec + plan both Codex-reviewed with fixes applied. It is NOT merged/deployed/
prod-verified yet — that is the next action and it is Kevin's. Everything else is
prior state: C6 Phase 4 + C10 are both PROD-VERIFIED + closed. Work from
feat/ops-safety-backup-alert until D0 ships, then main. A 16-skill operator
library lives in .claude/skills/.

1. Load the skill er-seo-tools-change-control first (hard gates: no merge/
   deploy/server mutation without Kevin's explicit go IN THIS conversation; docs
   rituals mandatory; never scan non-client sites).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. NEXT ACTION = D0 ship + prod-verify (needs Kevin):
   - Kevin merges PR #86 and deploys. Deploy gotchas (in the PR body): BACKUP_DIR
     was added to ecosystem.config.js, and ecosystem env changes are NOT picked
     up by `pm2 restart` → deploy needs `pm2 delete seo-tools && pm2 start
     ecosystem.config.js`. Optionally set ALERT_WEBHOOK_URL (Slack incoming
     webhook) in the server .env to turn alerts on (unset = dark, nothing bricks).
   - After deploy, run one manual backup from the app dir so backup-stale doesn't
     fire before the first 08:00 slot: `npx tsx scripts/db-backup.ts` from
     /home/seo/webapps/seo-tools.
   - Prod-verify per spec §8: system-db-backup + system-health-alert Schedule rows
     seeded; a snapshot appears in BACKUP_DIR and opens cleanly in Prisma (no
     .tmp left); force a condition (e.g. temporarily lower BACKUP_STALE_HOURS)
     with ALERT_WEBHOOK_URL set → exactly one message, second run within cooldown
     is suppressed; unset URL → no send. Prod is OAuth-only, so drive checks via
     `npx tsx` from the app dir (see gotchas). Also worth doing: the server-side
     pre-existing-backup check that was never run (crontab -l / ls the data dir) —
     the in-app job is additive either way.
   - Then run the docs ritual (tracker [~]→[x] + status line + handoff rewrite,
     one commit) and give Kevin the updated paste-in prompt.
4. AFTER D0 ships, the roadmap choice resumes (confirm with Kevin):
   - A2-f1 — findings-rebuild pruned-ADA guard (small hardening; data-loss trap).
   - C-track: C7 parser consolidation / C8 score-explanation panel / C9 ADA
     scoring v2 / further C6 (SEO-only scan mode — spec §9 breadcrumb; external-
     link verification).
   - SF-retirement campaign Phase 1 (SF-vs-live parity) — a MEASUREMENT stream
     (analysts run SF + upload alongside seoIntent live scans over 2–3 cycles),
     not a one-session build. Load er-seo-tools-sf-retirement-campaign; parity
     script at .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/
     sf-live-parity.ts.
```

## Current state

- **D0 BUILT — PR #86, branch `feat/ops-safety-backup-alert` (awaiting Kevin
  merge → deploy → prod-verify).** The minimal ops-safety layer, built as two
  in-app durable jobs reusing the existing queue + system-schedule pattern —
  **no schema migration, no server cron.** Spec
  `docs/superpowers/specs/2026-07-02-ops-safety-backup-alert-design.md` + plan
  `docs/superpowers/plans/2026-07-02-ops-safety-backup-alert.md`, both
  Codex-reviewed (accept/ship-with-fixes; all fixes applied). Gates green (tsc /
  2891 tests / build). New code:
  - `lib/ops/backup.ts` — `runDbBackup()` (`VACUUM INTO` a `db-<utc-stamp>.sqlite`
    via a `.tmp` + atomic rename; prune to `BACKUP_RETENTION_COUNT`=7) +
    `newestBackupMtimeMs()`. `scripts/db-backup.ts` = manual/restore-prep wrapper.
  - `lib/ops/alert-state.ts` — atomic JSON dedup store under `BACKUP_DIR`.
  - `lib/ops/alert-webhook.ts` — `sendAlert()` → `{sent, skipped}`; unset URL =
    dark (logs, `skipped:true`); never throws.
  - `lib/ops/health-check.ts` — pure `evaluateHealth()` + DB/FS
    `collectHealthSignals()`; 4 conditions (errored audits [SiteAudit.updatedAt /
    **AdaAudit.completedAt** — ADA has no updatedAt], exhausted jobs, stalled
    queue [all 5 non-terminal SiteAudit statuses, 60-min bar], stale backup).
  - `lib/jobs/handlers/db-backup.ts` (daily@08:00) + `health-alert.ts`
    (every:15m); wired in `register.ts` + `SYSTEM_SCHEDULES`.
  - `ecosystem.config.js` — `BACKUP_DIR=${DATA_HOME}/backups` added.
  - **Delivery-aware commit rule:** dedup state advances only when nothing to
    send / send succeeded / dark — a real webhook failure never loses an alert.
  - **Deploy gotchas (in PR body):** ecosystem env change ⇒ `pm2 delete && pm2
    start` (not `restart`); optional `ALERT_WEBHOOK_URL` in server .env; run one
    manual backup post-deploy. All new env vars optional → no boot-brick.
- **PROD-VERIFIED 2026-07-02: C6 Phase 4 — autonomous live SEO source + native
  link graph.** Merged (PR #85) + deployed (prod @ `9c07502`, migration
  `20260630120000_live_seo_source`). Campaign Gate 0.3 on client 12
  manhattanschool.edu: live-scan `CrawlRun` `54680dd9` seoIntent=true, score=98,
  link graph + findings + canonical both-branches + brief + pillar all green.
  Spec/plan archived. C6 stays `[~]` (hybrid discovery / validation / similarity
  / analytics-remainder still open).
- **COMPLETE 2026-07-02: C10 — SEO Performance Reports.** Merged (PR #75) +
  deployed 2026-06-22; PROD-VERIFIED by Kevin (/settings green, reports correct,
  SA granted + GA4/GSC mapped for all his accessible clients; scorecard-#12 =
  "Key Events", no change). Service-account auth; SA key at
  `/home/seo/data/seo-tools/google-sa.json` (0600), SA email
  `er-seo-reports@seo-apps-485618.iam.gserviceaccount.com`. Delivers the GA4/GSC
  half of SF-retirement Phase 6.
- **16-skill operator library** under `.claude/skills/` (commit `57ae636`, on
  main). New tracker items from its review: A2-f1, D0 (D0 now built).
- **A1, A2, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only,
  null score — by design).
- **⚠ PENDING HUMAN STEPS (Kevin) — optional/open (no verification blocking):**
  1. **D0 ship + prod-verify** — see Next item.
  2. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan
     409-blocking the localStorage import — keep or delete + re-open).
  3. **First real qct_ push** not yet exercised.
  4. **Optional cleanup:** delete PillarAnalysis `cmr43gufj0001y200n9134fjp`
     (Phase-4 pillar smoke artifact) if unwanted.
  5. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is
     gained.
- **Blocked / gated:** Anthropic API billing (03 Phase 3 + SF-retirement memo
  consumption); sitemap miss-rate measurement not yet run; daily/nightly cadences
  still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups (not next items):** D0 off-box backup replication
  (S3/rsync — v1 keeps snapshots on-box only); C6 SEO-only scan mode (spec §9),
  external-link verification, redirect/canonical/hreflang validation (campaign
  Phase 4), content similarity (campaign Phase 5), daily-cadence supersede-
  trimming; standalone single-page audit CSV/VPAT/report; public share-page
  export buttons; expandable rows on public ADA share view; logo for the PDF;
  `SessionPage` model drop (≥180 d after 2026-06-11); same-URL standalone-audit
  diffing; fleet instance-level diffing; B2 v1 multi-domain limitation.

## Next item

**D0 ship + prod-verify — Kevin's step, then the docs ritual.** PR #86 is open on
`feat/ops-safety-backup-alert`, gates green. The next actions:

1. **Kevin merges PR #86 + deploys.** Deploy gotchas (also in the PR body):
   `BACKUP_DIR` was added to `ecosystem.config.js`; ecosystem env changes are NOT
   picked up by `pm2 restart` → deploy needs `pm2 delete seo-tools && pm2 start
   ecosystem.config.js`. Optionally set `ALERT_WEBHOOK_URL` (a Slack incoming
   webhook) in the server `.env` to enable alerts (unset = dark, no boot-brick).
2. **Post-deploy manual backup** so `backup-stale` doesn't fire before the first
   08:00 slot: `npx tsx scripts/db-backup.ts` from `/home/seo/webapps/seo-tools`.
3. **Prod-verify (spec §8):** `system-db-backup` + `system-health-alert` Schedule
   rows seeded at boot; a snapshot lands in `BACKUP_DIR` and opens cleanly in
   Prisma (no `.tmp` left); with `ALERT_WEBHOOK_URL` set, force a condition (e.g.
   temporarily lower `BACKUP_STALE_HOURS`) → exactly one message, a second run
   within cooldown is suppressed; unset URL → no send. Prod is OAuth-only — drive
   checks via `npx tsx` from the app dir. Also worth doing: the server-side
   pre-existing-backup check that was never run (`crontab -l`, `ls` the data dir).
4. **Docs ritual:** flip tracker D0 `[~]`→`[x]`, add a dated status line, rewrite
   this handoff, one commit; end the chat reply with the updated paste-in prompt.

**After D0 ships**, the roadmap choice resumes (confirm with Kevin): A2-f1
(findings-rebuild pruned-ADA guard), the C-track menu (C7/C8/C9 or further C6),
or the SF-retirement campaign Phase 1 measurement stream.

- **C10 non-blocking follow-ups** (defer): GA4 comparison window discards 4 metric
  groups (quota trim — `ga4-provider.ts`); `rollupBatchStatus` duplicated
  (render job vs `lib/services/seo-reports.ts`); `pruneSeoReports` should chunk
  `doomedIds`; stricter date/client validation on `POST /api/reports`.

## Gotchas / decisions already made (don't relitigate)

- **D0 invariants (verified against code + gates 2026-07-02):**
  - **Two in-app durable jobs, NOT a server cron** — deploys with the app,
    testable, visible in job introspection. No schema migration (dedup = an
    atomic JSON file under `BACKUP_DIR`, not a table — fine under single PM2 fork
    + concurrency 1).
  - **Backup = `VACUUM INTO` a `.tmp` then atomic rename** — a crashed/partial
    VACUUM never leaves a `db-*.sqlite` that fools staleness detection. Runs as a
    bare `$executeRawUnsafe` (VACUUM cannot run in a transaction — does NOT
    violate the array-form rule, which is about interactive transactions). Safe
    consistent snapshot under WAL, no checkpoint/serialization needed.
  - **`AdaAudit` has NO `updatedAt`** — edge-trigger ADA errors on `completedAt`
    (its error paths set it). SiteAudit + Job use `updatedAt`.
  - **All new env vars OPTIONAL with code defaults** — `ALERT_WEBHOOK_URL` unset
    = dark (compute + log, don't send); nothing `process.exit(1)`s at boot.
  - **Webhook URL is trusted operator config, not user input** → plain timed
    `fetch`, never `safeFetch` (which would block internal endpoints).
  - **Delivery-aware dedup:** advance state only on no-alerts / sent / dark; a
    genuine delivery failure leaves state so the next 15-min tick retries.
  - `db-backup` maxAttempts 2 (next daily slot is the ultimate retry);
    `health-alert` maxAttempts 1 (next 15-min slot is the retry) and its handler
    swallows all throws so monitoring never becomes a failed job.
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`). Drive prod checks via
  `npx tsx` from `/home/seo/webapps/seo-tools` (relative `./lib/...` + `@/` alias
  only resolve from the app dir). Server has no `sqlite3` CLI — node + Prisma.
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
  operator-created (NO self-healing auto-creation — frontier item); `computeLinkGraph`
  pure/offline off `CrawlPage.inlinks/outlinks`; canonical page-facts provider is
  `lib/services/canonical-page-facts.ts` (`lib/seo/providers/` does NOT exist);
  live consumption is pat_/brief only (srt_/krt_ stay SF-only); SEO-only scan mode
  NOT built (spec §9 breadcrumb). Canonical selection is merge-state-sensitive.
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
- 2026-07-02 — **C10 PROD-VERIFIED (Kevin). C10 COMPLETE.** Both outstanding prod-verifications closed.
- 2026-07-02 — **D0 BUILT + PR #86 opened** (`feat/ops-safety-backup-alert`) — DB
  backup + failure alert, two in-app durable jobs, no schema migration. Spec+plan
  Codex-reviewed; gates green (tsc / 2891 tests / build). Awaiting Kevin merge →
  deploy → prod-verify.
