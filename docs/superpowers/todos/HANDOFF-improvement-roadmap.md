# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-02 (A2-f1 verified) · **Updated by:** A2-f1 **MERGED + DEPLOYED + PROD-VERIFIED — COMPLETE.** Next is **C8** (configurable scoring/priority weights + score-explanation panel), chosen by Kevin; the feature pipeline (brainstorm → spec → Codex → plan → Codex → TDD → gates → PR) is beginning.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: A2-f1 (findings-rebuild pruned-ADA guard) is COMPLETE — merged (PR #88,
main 92d10e3), deployed 2026-07-02 (code-only ~/deploy.sh, no migration),
prod-verified to the extent possible (deployed guard source present; clean boot;
behavioral rebuild-refuses check deferred because prod has zero pruned targets
until ~2026-08+, and behavioral correctness is covered by 2 gate-green DB tests).
D0 + C6 Phase 4 + C10 all COMPLETE + PROD-VERIFIED. Work from main.
A 16-skill operator library lives in .claude/skills/.

The NEXT BUILD is C8 — configurable scoring/priority weights + score-explanation
panel (Kevin's roadmap choice, 2026-07-02). Run the full feature pipeline.

1. Load the skill er-seo-tools-change-control first (hard gates: no merge/
   deploy/server mutation without Kevin's explicit go IN THIS conversation; docs
   rituals mandatory; never scan non-client sites).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. C8 is a FEATURE-class change → full pipeline: superpowers:brainstorming →
   spec (docs/superpowers/specs/YYYY-MM-DD-configurable-scoring-weights-design.md)
   → route to Codex (consulting-codex) → apply named fixes → plan
   (docs/superpowers/plans/) → Codex → TDD build on a feature branch → gate-green
   (lint/test/build) → PR → STOP (Kevin merges → deploys → prod-verify).
   Load er-seo-tools-domain-reference for the scoring semantics before speccing:
   `computeHealthScore` (SEO parser, lib/services/scoring.service.ts) and
   `scoreLiveSeo` (lib/findings/live-seo-score.ts) are the two forked scorers;
   C8 is about making their weights configurable + surfacing a per-score
   explanation panel. Confirm scope with Kevin at the brainstorming stage
   (which scores are in scope: SEO health, live SEO, ADA? persisted config vs
   env vs per-run? who can edit weights?).
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

- **COMPLETE 2026-07-02: A2-f1 — findings-rebuild pruned-ADA guard.** PR #88 merged
  (main `92d10e3`), DEPLOYED (plain `~/deploy.sh` — code-only, 2 files, no
  schema/env/ecosystem change → no `pm2 delete/start`; "No pending migrations to
  apply"; prod `6f1c45f`→`92d10e3`, app online, clean boot). PROD-VERIFIED to the
  extent possible: deployed guard source present in `lib/findings/ada-write.ts`
  (both throw sites). **Behavioral rebuild-refuses check DEFERRED** (handoff-authorized):
  a read-only prod query shows 0 pruned targets (0 `complete`+null-`result` AdaAudit,
  0 `complete`+null-`summary` SiteAudit; oldest complete ADA audit 41 d old, prune at
  90 d) — the guard is correctly INERT until the first pruned-audit rebuild (~2026-08+),
  and forcing a target would mutate prod. Behavioral correctness stands on the 2
  gate-green DB tests. Recap of the fix: a `status='complete'` audit/child with a null
  `result` blob (the 90-d prune signature) now makes `writeAdaSiteFindings` /
  `writeAdaSingleFindings` THROW before the delete-and-recreate writer can clobber the
  canonical `Finding`/`Violation` tables; guard defends the rebuild script AND the live
  standalone dual-write hook; errored/redirected audits stay ungated.
- **COMPLETE 2026-07-02: D0 — minimal ops safety (DB backup + failure alert).**
  SHIPPED (PR #86, merged `6f1c45f`) + deployed + PROD-VERIFIED. Two in-app
  durable jobs (db-backup daily@08:00 `VACUUM INTO`+prune; health-alert every:15m
  → optional `ALERT_WEBHOOK_URL`, dark by default) — no schema migration, no
  server cron. Deployed via `pm2 delete && pm2 start` (new `BACKUP_DIR` ecosystem
  var). Slack webhook still unset (alerts log-only until Slack admin approves).
- **PROD-VERIFIED 2026-07-02: C6 Phase 4** (autonomous live SEO source + native
  link graph, PR #85, prod @ `9c07502`→ now within `92d10e3`, migration
  `20260630120000_live_seo_source`). C6 stays `[~]` (hybrid discovery / validation
  / similarity / analytics-remainder still open).
- **COMPLETE 2026-07-02: C10 — SEO Performance Reports** (PR #75, deployed
  2026-06-22, PROD-VERIFIED). Service-account auth; SA key at
  `/home/seo/data/seo-tools/google-sa.json` (0600), SA email
  `er-seo-reports@seo-apps-485618.iam.gserviceaccount.com`.
- **16-skill operator library** under `.claude/skills/` (commit `57ae636`, on main).
- **A1, A2, A2-f1, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE. C10 DONE. D0 DONE.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only,
  null score — by design).
- **⚠ PENDING HUMAN STEPS (Kevin) — none blocking C8:**
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
  (S3/rsync); D0 manual-script BACKUP_DIR warning; C6 SEO-only scan mode (spec §9),
  external-link verification, redirect/canonical/hreflang validation (campaign
  Phase 4), content similarity (campaign Phase 5), daily-cadence supersede-trimming;
  standalone single-page audit CSV/VPAT/report; public share-page export buttons;
  expandable rows on public ADA share view; logo for the PDF; `SessionPage` model
  drop (≥180 d after 2026-06-11); same-URL standalone-audit diffing; fleet
  instance-level diffing; B2 v1 multi-domain limitation; SF-retirement campaign
  Phase 1 (SF-vs-live parity — a MEASUREMENT stream, load
  er-seo-tools-sf-retirement-campaign when ready).

## Next item

**C8 — Configurable scoring/priority weights + score-explanation panel** (0.5–1 wk,
Kevin's roadmap choice 2026-07-02). Feature-class → full pipeline
(brainstorm → spec → Codex → plan → Codex → TDD → gates → PR → Kevin
merges/deploys → prod-verify).

Scope questions to settle at the brainstorming stage (with Kevin):
1. **Which scores are in scope?** SEO health (`computeHealthScore`,
   `lib/services/scoring.service.ts`), live SEO (`scoreLiveSeo`,
   `lib/findings/live-seo-score.ts`), and/or ADA (`lib/ada-audit/scoring.ts`
   `computeScore`)? These are separate scorers with separate weight sets.
2. **Where do weights live?** Persisted DB config (schema migration) vs env vars
   vs per-run override. Persisted config = a schema change = feature-class + the
   migration procedure. Note the "explicit factor availability / renormalize over
   included factors" design in `scoreLiveSeo` — any weight change must preserve
   "perfect inputs → exactly 100".
3. **Who edits weights?** A `/settings` surface (cookie-gated) vs code-only. If UI,
   it's a UI-class change too (dark-mode variants + no hydration mismatch).
4. **Score-explanation panel:** per-score breakdown of which factors contributed
   how much (the renormalized weights make this natural to surface). Read-time on
   results pages; must work on archived audits (relational-first, like the C4
   report layer).

Load **er-seo-tools-domain-reference** for the exact scoring semantics before
writing the spec, and **er-seo-tools-extension-recipes** if a schema migration or
`/settings` route is in scope.

- **C10 non-blocking follow-ups** (defer): GA4 comparison window discards 4 metric
  groups (quota trim — `ga4-provider.ts`); `rollupBatchStatus` duplicated (render
  job vs `lib/services/seo-reports.ts`); `pruneSeoReports` should chunk
  `doomedIds`; stricter date/client validation on `POST /api/reports`.

## Gotchas / decisions already made (don't relitigate)

- **A2-f1 invariants (verified against code + prod 2026-07-02):**
  - Pruned signature = `status='complete'` audit/child with null `result` (the
    finalizer NEVER persists a complete audit without its blob). Errored/redirected
    audits are legitimately blobless — NOT gated.
  - Guard lives in `lib/findings/ada-write.ts`, not the script — it also protects
    the live standalone dual-write hook. Safe there because a just-completed audit
    always has a fresh blob; the guard only fires on a pruned (old) audit.
  - Prod behavioral verify is DEFERRED (no pruned target exists yet, ~2026-08+);
    do not re-attempt by mutating prod. The 2 DB tests are the behavioral evidence.
- **D0 invariants (verified against code + prod 2026-07-02):**
  - **Two in-app durable jobs, NOT a server cron** — no schema migration (dedup =
    an atomic JSON file under `BACKUP_DIR`). Backup = `VACUUM INTO` a `.tmp` then
    atomic rename; bare `$executeRawUnsafe` (VACUUM can't run in a transaction —
    does NOT violate the array-form rule).
  - **`AdaAudit` has NO `updatedAt`** — edge-trigger ADA errors on `completedAt`.
  - **All new env vars OPTIONAL with code defaults** — `ALERT_WEBHOOK_URL` unset =
    dark; nothing `process.exit(1)`s at boot.
  - **`BACKUP_DIR` is an ecosystem.config.js env var** → a deploy that only
    `pm2 restart`s will NOT load it; needs `pm2 delete seo-tools && pm2 start
    ecosystem.config.js`. The manual `scripts/db-backup.ts` in a bare SSH shell
    also lacks it → prefix `BACKUP_DIR=/home/seo/data/seo-tools/backups`.
  - Webhook URL is trusted operator config → plain timed `fetch`, never `safeFetch`.
- **Deploy protocol (re-confirmed on the A2-f1 deploy):** code-only changes deploy
  with plain `ssh seo@144.126.213.242 "~/deploy.sh"` (git pull → npm install →
  prisma generate → build → stop → `migrate deploy` → start). Only ecosystem/env
  changes need `pm2 delete && pm2 start`. Prod has NO `sqlite3` CLI — drive
  read-only prod queries with a throwaway `.mjs` in the app dir using
  `new PrismaClient()` + inline `DATABASE_URL='file:/home/seo/data/seo-tools/db.sqlite'`
  (relative `./lib/...` + `@/` aliases only resolve from a script INSIDE the app dir).
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`). Prod DB at
  `/home/seo/data/seo-tools/db.sqlite` (~456 MB); DATA_HOME=`/home/seo/data/seo-tools`.
  **pm2 process env ≠ login-shell env ≠ .env.**
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only,
  conditionals via SQL `EXISTS`, manual `updatedAt = Date.now()` in raw SQL.
- **Local dev quirk:** prefix prisma CLI + vitest with
  `DATABASE_URL="file:./local-dev.db"` (resolves to `prisma/local-dev.db`).
  `prisma migrate dev` is interactive-only — hand-write migration SQL, apply with
  `migrate deploy`. **vitest module mocks must use `vi.hoisted(() => ({...}))`.**
- **C10 invariants:** SERVICE-ACCOUNT auth (key in `GOOGLE_SA_KEY_FILE`, no
  GoogleConnection model / no OAuth routes); GA4 via `analyticsdata('v1beta')`,
  GSC via `searchconsole('v1')`; per-property 403 → `unmapped`; job group
  `seo-report:<id>` NEVER `site-audit:<id>`; idempotency
  `@@unique([scheduleId,scheduledFor])` + `@@unique([batchId,clientId])`; monthly
  schedule is a NON-system operator row; reports get their own `pruneSeoReports`.
- **C6 Phase 4 invariants:** `seoIntent` is the freshness-gated canonical SEO
  signal (`lib/services/seo-canonical.ts`: fresh sf-upload ≤30 d wins; else newest
  seoIntent live run becomes canonical AND feeds score surfaces); schedules are
  operator-created (NO self-healing auto-creation); `computeLinkGraph` pure/offline;
  canonical page-facts provider is `lib/services/canonical-page-facts.ts`
  (`lib/seo/providers/` does NOT exist); live consumption is pat_/brief only
  (srt_/krt_ stay SF-only); SEO-only scan mode NOT built (spec §9 breadcrumb).
  Canonical selection is merge-state-sensitive.
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
  DB test needs a forced-extreme value to stay deterministic.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (small bugfixes with no spec/plan are exempt).

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
- 2026-07-02 — **C10 PROD-VERIFIED (Kevin). C10 COMPLETE.**
- 2026-07-02 — **D0 SHIPPED (PR #86) + DEPLOYED + PROD-VERIFIED. D0 COMPLETE.** Docs
  PR #87 merged to main `7a487cf`.
- 2026-07-02 — **A2-f1 BUILT + PR #88** — findings-rebuild pruned-ADA guard.
- 2026-07-02 — **A2-f1 MERGED (#88, `92d10e3`) + DEPLOYED + PROD-VERIFIED. A2-f1 COMPLETE.**
  Behavioral rebuild-refuses check deferred (no pruned target until ~2026-08+; covered
  by 2 DB tests). **Roadmap choice = C8** (configurable scoring weights +
  score-explanation panel); feature pipeline beginning.
