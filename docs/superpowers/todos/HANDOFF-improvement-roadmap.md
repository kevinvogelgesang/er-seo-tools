# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-02 (A2-f1 built) · **Updated by:** A2-f1 **BUILT + PR #88** (`fix/a2-f1-rebuild-pruned-ada-guard`). **Pending human step: Kevin merges → deploys → prod-verifies.** After that, next is a **roadmap choice** again (C-track / SF-retirement campaign Phase 1).
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: A2-f1 (findings-rebuild pruned-ADA guard) is BUILT + PR #88 open
(fix/a2-f1-rebuild-pruned-ada-guard), gate-green, NOT yet merged/deployed.
It's a small bugfix: a status='complete' ADA audit/child with a null result
blob (the 90-d prune signature) now makes writeAdaSiteFindings /
writeAdaSingleFindings THROW before the delete-and-recreate writer can clobber
the canonical Finding/Violation tables. Guard lives in lib/findings/ada-write.ts
(defends both the rebuild script AND the live standalone dual-write hook);
errored/redirected audits stay ungated. Two DB-backed tests (refuse + no-clobber).
D0 (DB backup + failure alert) + C6 Phase 4 + C10 all COMPLETE + PROD-VERIFIED.
Work from main. A 16-skill operator library lives in .claude/skills/.

1. Load the skill er-seo-tools-change-control first (hard gates: no merge/
   deploy/server mutation without Kevin's explicit go IN THIS conversation; docs
   rituals mandatory; never scan non-client sites).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. PENDING VERIFICATION: PR #88 (A2-f1) awaits Kevin merge → deploy → prod-verify.
   Prod-verify is light for this one (no schema/env change): after deploy, on
   prod confirm that `npx tsx scripts/findings-rebuild.ts <a-pruned-ADA-id>`
   now REFUSES with the "result blob was pruned" message instead of silently
   writing an empty run. If no pruned ADA audit exists yet in prod (first prune
   ~2026-09-08 for ada-audit), a synthetic check is fine, or defer verification
   with a tracker note — the guard is inert until a pruned audit is rebuilt.
   Once verified: tracker [~]→[x] + status-log line + rewrite this handoff.
4. THEN the next move is a ROADMAP CHOICE. Confirm direction with Kevin, then run
   the full change-control pipeline (spec → Codex → plan → Codex → TDD → gates →
   PR → Kevin merges/deploys → prod-verify). Menu:
   - C-track: C7 (parser consolidation + streaming parse + per-file failure
     isolation), C8 (configurable scoring weights + score-explanation panel),
     C9 (ADA scoring v2 + poller/results-view consolidation), or further C6
     (SEO-only scan mode — spec §9 breadcrumb; external-link verification).
   - SF-retirement campaign Phase 1 (SF-vs-live parity) — a MEASUREMENT stream
     (analysts run SF + upload alongside seoIntent live scans over 2–3 cycles),
     not a one-session build. Load er-seo-tools-sf-retirement-campaign; parity
     script at .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/
     sf-live-parity.ts.
5. Small open D0 follow-ups (not blocking, do when convenient): set
   ALERT_WEBHOOK_URL in the server .env once Slack admin approves; the manual
   scripts/db-backup.ts must be run as `BACKUP_DIR=/home/seo/data/seo-tools/
   backups npx tsx scripts/db-backup.ts` (a bare SSH shell lacks BACKUP_DIR →
   writes to the release dir) — consider adding a warning when BACKUP_DIR is
   unset; a stray 444 MB backup + alert-state.json may still sit in
   /home/seo/webapps/seo-tools/data/backups/ (safe to rm).
6. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **BUILT (awaiting merge/deploy/prod-verify) 2026-07-02: A2-f1 — findings-rebuild
  pruned-ADA guard.** PR #88 (`fix/a2-f1-rebuild-pruned-ada-guard`), gate-green
  (tsc / 2893 vitest / build). Small bugfix, TDD:
  - The trap: `scripts/findings-rebuild.ts` guarded only the Session branch
    against a pruned blob; the ADA branches did not. On a 90-d-pruned ADA audit,
    `parseAxe(null)` → violation-free pages → the writer's delete-and-recreate
    silently replaced the canonical `Finding`/`Violation` tables with an empty run.
  - The fix: guard in `lib/findings/ada-write.ts` (both `writeAdaSiteFindings`
    and `writeAdaSingleFindings`), scoped to the prune signature — a
    `status='complete'` audit/child with a null `result` blob. Both throw before
    the writer runs. Placed at the write functions (not the script) so it defends
    the rebuild script AND the live standalone dual-write hook
    (`lib/jobs/handlers/ada-audit.ts`); no live-path regression (a
    freshly-completed audit always has its blob). Errored/redirected audits are
    legitimately blobless and stay ungated (the redirected-standalone rebuild test
    still passes).
  - Tests: 2 DB-backed cases in `lib/findings/ada-write.test.ts` (site +
    standalone) that build a canonical run, simulate the prune, and assert the
    rebuild REFUSES and the pre-existing findings survive.
  - **Prod-verify is light:** no schema/env change. After deploy, confirm on prod
    that rebuilding a pruned ADA audit id now refuses (message: "result blob was
    pruned … Findings rows are the canonical record now.") rather than writing an
    empty run. First real ada-audit prune is ~2026-09-08, so a pruned target may
    not exist in prod yet — a synthetic/deferred check is acceptable (the guard is
    inert until someone rebuilds a pruned audit).
- **COMPLETE 2026-07-02: D0 — minimal ops safety (DB backup + failure alert).**
  SHIPPED (PR #86, merged `6f1c45f`) + deployed + PROD-VERIFIED. Two in-app
  durable jobs (db-backup daily@08:00 `VACUUM INTO`+prune; health-alert every:15m
  → optional `ALERT_WEBHOOK_URL`, dark by default) — no schema migration, no
  server cron. Deployed via `pm2 delete && pm2 start` (new `BACKUP_DIR` ecosystem
  var). Slack webhook still unset (alerts log-only until Slack admin approves).
  Spec/plan archived. Docs PR #87 (D0 prod-verified tracker/handoff) merged to
  main `7a487cf`.
- **PROD-VERIFIED 2026-07-02: C6 Phase 4** (autonomous live SEO source + native
  link graph, PR #85, prod @ `9c07502`, migration `20260630120000_live_seo_source`).
  C6 stays `[~]` (hybrid discovery / validation / similarity / analytics-remainder
  still open).
- **COMPLETE 2026-07-02: C10 — SEO Performance Reports** (PR #75, deployed
  2026-06-22, PROD-VERIFIED). Service-account auth; SA key at
  `/home/seo/data/seo-tools/google-sa.json` (0600), SA email
  `er-seo-reports@seo-apps-485618.iam.gserviceaccount.com`.
- **16-skill operator library** under `.claude/skills/` (commit `57ae636`, on main).
- **A1, A2, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE. C10 DONE. D0 DONE. A2-f1 BUILT.**
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00` (noindex → broken-link findings only,
  null score — by design).
- **⚠ PENDING HUMAN STEPS (Kevin) — none blocking new work except A2-f1's own verify:**
  1. **A2-f1:** merge PR #88 → deploy → light prod-verify (see above).
  2. **D0:** set `ALERT_WEBHOOK_URL` in server `.env` once Slack admin approves;
     optional `rm -rf /home/seo/webapps/seo-tools/data/backups` (stray files).
  3. **B4 quarter-plan decision** still open (near-empty prod QuarterPlan
     409-blocking the localStorage import — keep or delete + re-open).
  4. **First real qct_ push** not yet exercised.
  5. **Optional cleanup:** delete PillarAnalysis `cmr43gufj0001y200n9134fjp`
     (C6 Phase-4 pillar smoke artifact) if unwanted.
  6. **C10 ongoing:** grant SA + map GA4/GSC for remaining clients as access is
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
  instance-level diffing; B2 v1 multi-domain limitation.

## Next item

**PENDING: PR #88 (A2-f1) → Kevin merge/deploy/prod-verify** (light verify — no
schema/env change; confirm a pruned-ADA rebuild now refuses). Once verified, flip
the tracker `[~]`→`[x]`, add a status-log line, rewrite this handoff.

**THEN a roadmap CHOICE.** Confirm direction with Kevin, then the full pipeline
(spec → Codex → plan → Codex → TDD → gates → PR → Kevin merges/deploys →
prod-verify). Menu:

1. **C-track menu:** C7 (parser consolidation + streaming parse + per-file
   failure isolation), C8 (configurable scoring weights + score-explanation
   panel), C9 (ADA scoring v2 + poller/results-view consolidation), or further C6
   (SEO-only scan mode — spec §9 breadcrumb; external-link verification).
2. **SF-retirement campaign Phase 1 (SF-vs-live parity)** — unblocked, but a
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

- **A2-f1 invariants (verified against code 2026-07-02):**
  - Pruned signature = `status='complete'` audit/child with null `result` (the
    finalizer NEVER persists a complete audit without its blob). Errored/redirected
    audits are legitimately blobless — do NOT gate them (the redirected-standalone
    rebuild path must keep working).
  - Guard lives in `lib/findings/ada-write.ts`, not the script — it also protects
    the live standalone dual-write hook. Safe there because a just-completed audit
    always has a fresh blob; the guard only fires on a pruned (old) audit.
  - The SEO/Session branch already had its own guard in `findings-rebuild.ts:44-46`
    (unchanged). `archivePrunedAt` on the CrawlRun is the authoritative prune stamp,
    but the blob-null-at-complete heuristic is sufficient and mirrors the Session
    check.
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
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`). Drive prod checks via
  `npx tsx` from `/home/seo/webapps/seo-tools` (relative `./lib/...` + `@/` alias
  only resolve from the app dir). Server has no `sqlite3` CLI. **pm2 process env
  ≠ login-shell env ≠ .env.** Prod DB is at `/home/seo/data/seo-tools/db.sqlite`
  (~456 MB); DATA_HOME=`/home/seo/data/seo-tools`.
- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER interactive `prisma.$transaction(async tx => ...)`** — array form only,
  conditionals via SQL `EXISTS`, manual `updatedAt = Date.now()` in raw SQL.
- **Local dev quirk:** prefix prisma CLI + vitest with
  `DATABASE_URL="file:./local-dev.db"` (resolves to `prisma/local-dev.db`).
  `prisma migrate dev` is interactive-only — hand-write migration SQL, apply with
  `migrate deploy`. **vitest module mocks must use `vi.hoisted(() => ({...}))`.**
- **C10 invariants:** SERVICE-ACCOUNT auth (key in `GOOGLE_SA_KEY_FILE`, no
  GoogleConnection model / no OAuth routes); GA4 via `analyticsdata('v1beta')`,
  GSC via `searchconsole('v1')`; per-property 403 → `unmapped`; `gscSiteUrl`
  verbatim; job group `seo-report:<id>` NEVER `site-audit:<id>`; idempotency
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
- 2026-07-02 — **A2-f1 BUILT + PR #88** — findings-rebuild pruned-ADA guard
  (`lib/findings/ada-write.ts`; 2 DB-backed tests; gate-green). Awaiting Kevin
  merge/deploy/prod-verify.
