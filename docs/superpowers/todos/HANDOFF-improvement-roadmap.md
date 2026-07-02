# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-02 (latest, C10) · **Updated by:** C10 **PROD-VERIFIED** (Kevin) — both outstanding prod-verifications (C6 Phase 4 + C10) are now closed. Next is a **roadmap choice**: recommended buildable = **D0 (minimal backup + alert)**; parallel measurement stream = **SF-retirement campaign Phase 1 (SF-vs-live parity)**
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: Both outstanding prod-verifications are CLOSED. C6 Phase 4 (autonomous
live SEO source + native link graph) is PROD-VERIFIED (2026-07-02, campaign Gate
0.3 on client 12 manhattanschool.edu: live-scan CrawlRun seoIntent=true, score=98,
link graph + findings + canonical both-branches + brief + pillar all green). C10
(SEO Performance Reports) is PROD-VERIFIED + COMPLETE (Kevin: /settings green,
reports look good, SA granted + GA4/GSC mapped for all his accessible clients;
scorecard-#12 resolved as "Key Events"). Work from main. A 16-skill operator
library lives in .claude/skills/.

1. Load the skill er-seo-tools-change-control first (hard gates: no merge/
   deploy/server mutation without Kevin's explicit go; docs rituals mandatory;
   never scan non-client sites).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. There is no pending verification — the next move is a ROADMAP CHOICE. Confirm
   direction with Kevin, then run the full change-control pipeline (spec → Codex
   → plan → Codex → TDD → gates → PR → Kevin merges/deploys → prod-verify). The
   menu, with the recommended buildable first:
   - **D0 (recommended) — minimal ops safety before SF-retirement Phase 2:** a
     prod DB backup cron (VERIFY whether one already exists server-side first —
     none is recorded in the repo) + one failure alert (audits-errored / queue-
     stalled). Kevin-approved, small, serves the agency-in-a-box goal. Feature-
     class; needs a short spec.
   - **A2-f1 — findings-rebuild pruned-ADA guard** (small hardening; data-loss
     trap if a rebuild runs against a pruned ADA audit).
   - **C7 parser consolidation / C8 score-explanation panel / C9 ADA scoring v2 /
     further C6 (SEO-only scan mode, external-link check).**
   - **SF-retirement campaign Phase 1 (SF-vs-live parity)** — now unblocked, but
     it is a MEASUREMENT stream (analysts run SF + upload alongside seoIntent
     live scans over 2–3 cycles), not a single build session. Load
     er-seo-tools-sf-retirement-campaign; the parity script is
     .claude/skills/er-seo-tools-sf-retirement-campaign/scripts/sf-live-parity.ts.
4. After any advance: tracker checkbox + dated status-log line, rewrite this
   handoff, and end your final reply with this doc's updated paste-in prompt in a
   code block.
```

## Current state

- **PROD-VERIFIED 2026-07-02: C6 Phase 4 — autonomous live SEO source + native
  link graph.** Merged (PR #85) + deployed (prod @ `9c07502`, migration
  `20260630120000_live_seo_source`) 2026-07-02; **campaign Gate 0.3 run against
  prod the same day** (Kevin authorized the trigger + the pillar write in-chat).
  Evidence (client 12 manhattanschool.edu, audit `cmr434fsr00026st0i6upoeq1`):
  - live-scan `CrawlRun` `54680dd9` — `seoIntent=true`, **`score=98`**, complete;
    findings = broken_images 34 / broken_internal_links 31 / duplicate_title 3 /
    missing_h1 2 / missing_meta_description 4 / thin_content 6 (unified
    broken-link + on-page run).
  - link graph populated: 66 pages, avg inlinks 23.26, avg outlinks 23.26, avg
    crawlDepth 1.38 (all non-null).
  - canonical selector correct in BOTH branches: a fresh SF upload (2026-06-11,
    21 d, score 78) means `selectCanonicalSeoRun` / `pickCanonicalSeo(window 30)`
    return the **sf-upload** (fresh SF wins — documented-correct), while
    `pickCanonicalSeo(window 0)` returns the **live-scan** run (seoIntent
    supersede path). Don't "restore" a Phase-3 invariant — this is by design.
  - `getCanonicalPageFacts` (93 pages off the SF canonical) + `/api/brief/live`
    (`buildBriefFromCanonical`, 2759-char brief) + session-independent
    `runForCanonical` (PillarAnalysis `cmr43gufj0001y200n9134fjp`,
    `sessionId=null`, keyed by `crawlRunId` — the D3 deliverable) all green.
  - UI "Live scan" badge + seoIntent-filtered history verified at the DB level
    (run `source=live-scan` + `seoIntent=true`); NOT browser-checked because prod
    is OAuth-only (`ALLOW_PASSWORD_LOGIN=false`) and the session was driven over
    SSH via `npx tsx` from the app dir. srt_/krt_ NOT smoked — SF-only per D3.
  - **Prod artifacts:** the audit + live-scan run are a legitimate client scan
    (kept). The PillarAnalysis smoke row `cmr43gufj0001y200n9134fjp` (client 12)
    can be deleted if unwanted — it's a smoke artifact.
  Spec/plan archived: `archive/specs/2026-06-30-autonomous-live-seo-source-design.md`
  · `archive/plans/2026-06-30-autonomous-live-seo-source.md`. C6 stays `[~]`
  (hybrid discovery / validation / similarity / analytics-remainder still open).
- **16-skill operator library** under `.claude/skills/` (commit `57ae636`, now on
  main): change control, debugging, failure archaeology, architecture, domain
  reference, config, build/env, run/operate, diagnostics (4 read-only DB
  scripts), validation, docs style, extension recipes, the SF-retirement campaign
  (+ `sf-live-parity.ts`), proof recipes, research frontier, research
  methodology. New tracker items from its review: A2-f1 (findings-rebuild
  pruned-ADA guard), D0 (minimal backup+alert, pulled forward).
- **COMPLETE: C10 — SEO Performance Reports (NET-NEW).** Merged (PR #75) +
  deployed 2026-06-22; migration applied. Auth = Google **service account**.
  Spec/plan archived. **PROD-VERIFIED 2026-07-02 (Kevin):** `/settings` Test
  connection green, reports render correctly, SA granted + GA4/GSC mapped for
  every client Kevin currently has access to; scorecard-#12 resolved as shipped
  ("Key Events", no change). Delivers the GA4/GSC analytics half of SF-retirement
  Phase 6 (SEMrush/DataForSEO + memo consumption remain — the latter gated on
  Anthropic API billing).
- **A1, A2, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE** (Phase 4 prod-verified
  2026-07-02). C6 stays `[~]` (later phases open).
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. Noindex → broken-link findings only,
  no on-page findings, null score (all by design).
- **⚠ PENDING HUMAN STEPS (Kevin) — no verification pending; these are optional/open:**
  1. **B4 quarter-plan decision still open:** prod has a near-empty QuarterPlan
     (2026-06-11 19:51 UTC) 409-blocking the one-time analyst-browser
     localStorage import. Keep it, or delete QuarterPlan rows server-side and
     re-open `/quarter-grid` holding `seo-quarter-v3`.
  2. **First real qct_ push not yet exercised** (prod plan is all-pool). After
     (1): assign a client to a week, set its Teamwork tasklist ID, push, paste.
  3. **Optional cleanup:** delete PillarAnalysis `cmr43gufj0001y200n9134fjp` (the
     Phase-4 pillar smoke artifact) if you don't want it in the client's history.
  4. **C10 ongoing:** grant the SA + map GA4/GSC for any remaining clients as you
     gain access (Kevin has done all currently-accessible clients).
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3 + SF-retirement
  memo consumption); sitemap miss-rate measurement not yet run; daily/nightly
  cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups (not next items):** C6 — SEO-only scan mode (skip
  axe/screenshots/PSI for seoIntent runs — breadcrumb at both enqueue sites →
  spec §9), per-page on-page snapshots for error/redirect pages, external-link
  verification, CSS/JS/PDF broken-resource checks, redirect-chain/canonical/
  hreflang validation (campaign Phase 4), content similarity (campaign Phase 5),
  daily-cadence supersede-trimming; standalone single-page audit CSV/VPAT/report;
  public share-page export buttons; expandable rows on the public ADA share view;
  logo image for the PDF; `SessionPage` model drop (≥180 d after 2026-06-11);
  same-URL standalone-audit diffing; fleet instance-level diffing; B2 v1
  multi-domain limitation.

## Next item

**No verification pending — this is a roadmap CHOICE.** Confirm direction with
Kevin, then run the full change-control pipeline for whatever is picked (spec →
Codex → plan → Codex → TDD → gates → PR → Kevin merges/deploys → prod-verify).
Menu, recommended buildable first:

1. **D0 (recommended buildable) — minimal ops safety before SF-retirement Phase 2.**
   A prod DB backup cron + one failure alert (audits-errored / queue-stalled).
   **First step is investigation, not code:** verify whether a server-side backup
   already exists (none is recorded in the repo; check cron/RunCloud on prod with
   Kevin) — the alert half is a scheduled job in the existing durable-queue
   pattern (`lib/jobs/`, `system-schedules.ts`). Kevin-approved, small, directly
   serves the agency-in-a-box "notice its own failures" goal. Feature-class →
   short spec first.
2. **A2-f1 — findings-rebuild pruned-ADA guard.** Small hardening:
   `scripts/findings-rebuild.ts` against a pruned ADA audit is a data-loss trap;
   add a guard. Bugfix/small-feature class.
3. **C-track menu:** C7 (parser consolidation + streaming parse + per-file
   failure isolation), C8 (configurable scoring weights + score-explanation
   panel), C9 (ADA scoring v2 + poller/results-view consolidation), or further
   C6 (SEO-only scan mode — spec §9 breadcrumb; external-link verification).
4. **SF-retirement campaign Phase 1 (SF-vs-live parity)** — now unblocked by the
   Phase-4 verification, but it is a MEASUREMENT stream, not a one-session build:
   analysts run SF + upload at `/seo-parser` alongside a `seoIntent:true` live
   scan on the same client+day, over 2–3 reporting cycles; the parity script
   (`.claude/skills/er-seo-tools-sf-retirement-campaign/scripts/sf-live-parity.ts`)
   reports score delta / page-set Jaccard / per-issue-type deltas. Gate to pass:
   N ≥ 5 clients × 2–3 cycles, every deviation explained in a dated parity log
   under `docs/superpowers/todos/`. This ALSO produces the sitemap miss-rate
   evidence that gates SF-retirement Phase 2. Load
   `er-seo-tools-sf-retirement-campaign`.

- **C10 non-blocking follow-ups** (do alongside whatever's next, or defer): GA4
  comparison window fetches 4 metric groups it discards (quota trim —
  `ga4-provider.ts`); `rollupBatchStatus` duplicated between the render job and
  `lib/services/seo-reports.ts` (consolidate); `pruneSeoReports` should chunk
  `doomedIds` for SQLite param limits at scale; stricter date/client validation
  on `POST /api/reports`.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array form
  only, conditional logic via SQL `EXISTS`, manual `updatedAt = Date.now()` in
  raw statements (2026-06-10 production incident; CLAUDE.md "Do not").
- **Prod is OAuth-only** (`ALLOW_PASSWORD_LOGIN=false`; Google OAuth primary
  since PR #83/#84). Break-glass password login is disabled. To drive prod
  verification over SSH, call the app's own functions via `npx tsx` **from
  `/home/seo/webapps/seo-tools`** (relative `./lib/...` imports + the `@/` alias
  only resolve from the app dir — a script in `/tmp` fails MODULE_NOT_FOUND).
  `queueSiteAuditRequest(...)` is the same path POST `/api/site-audit` uses, so a
  seoIntent audit can be triggered without an HTTP session.
- **C10 invariants (SEO Performance Reports):**
  - **Auth = Google SERVICE ACCOUNT (2026-06-22), not user-OAuth.** Key JSON in a
    gitignored file, path in `GOOGLE_SA_KEY_FILE`; never committed/logged.
    `lib/analytics/google/auth.ts` = `google.auth.GoogleAuth({ keyFile, scopes })`.
    NO `GoogleConnection` model, NO `/api/google/connect|callback`, NO
    `GOOGLE_TOKEN_ENC_KEY`. Per-client cost: grant the SA email Viewer on each
    client's GA4 property + GSC site.
  - GA4 Data API via **`googleapis` `google.analyticsdata('v1beta')`**. GSC via
    `google.searchconsole('v1')`. Both take the GoogleAuth client.
  - **Provider error taxonomy:** per-property **`403`/PERMISSION_DENIED** →
    `reason:'unmapped'` (a per-client gap), NOT global `'auth'`. `'auth'` = missing/
    invalid key or `401`. `429`/RESOURCE_EXHAUSTED → `'quota'`. Manual GA4-id/GSC-url
    entry is a HARD fallback, not just convenience.
  - **`gscSiteUrl` stored + sent VERBATIM** (`sc-domain:` vs URL-prefix differ).
  - Job group/dedup = **`seo-report:<id>`**, NEVER `site-audit:<id>`. Render job:
    concurrency 1, timeout 600_000, ALL fetch/build before `acquirePage()`.
  - **Manual prospects entry MUST null `metricsJson`** (+ reset status→queued)
    before re-enqueue, or the re-render keeps the stale snapshot.
  - No SQLite `createMany`/`skipDuplicates`. Idempotency: `@@unique([scheduleId,
    scheduledFor])` (batch) + `@@unique([batchId, clientId])` (report).
  - The monthly schedule is a **non-system** operator-configurable `Schedule` row
    (`name:'seo-report-monthly'`) — NOT in `SYSTEM_SCHEDULES`.
  - Metrics are a per-report `metricsJson` blob (NOT findings); reports get their
    OWN retention sweep (`pruneSeoReports`) — the 90-d findings prune skips them.
- **C6 Phase 4 invariants (verified against plan+code + prod 2026-07-02):**
  - **`seoIntent` is the canonical SEO-source signal, freshness-gated.**
    `pickCanonicalSeo`/`selectCanonicalSeoRun` (`lib/services/seo-canonical.ts`):
    fresh sf-upload (≤30 d, `SEO_SF_CANONICAL_WINDOW_DAYS`) wins unconditionally;
    only when stale/absent does the newest `seoIntent=true` live run become
    canonical — and then it DOES feed the score surfaces (spec §7 reverses Phase
    3's "live never canonical"). Non-seoIntent live run is NEVER canonical.
    Verified in prod: both branches behave correctly (window 30 → SF; window 0 →
    live).
  - **Schedules are operator-created, not autonomous.** `seoIntent:true` schedules
    come from POST `/api/clients/[id]/schedules`; ADA + SEO coexist per D1
    (uniqueness = client+domain+seoIntent). NO self-healing auto-creation — it's a
    tracked frontier item, don't assume it exists.
  - **`computeLinkGraph` is pure + offline.** Reads `CrawlPage.inlinks`/`outlinks`
    persisted during harvest; never triggers a crawl, never re-reads
    `HarvestedLink`. Absent scalars (pre-Phase-4 runs) → empty graph (expected).
  - **Canonical page-facts** (`lib/services/canonical-page-facts.ts` — THE
    provider; `lib/seo/providers/` does not exist): keyed on normalized URL;
    `inlinks` = count of OTHER same-domain pages linking in. Callers treat missing
    facts as graceful degraded state — never throw.
  - **Live consumption is pat_/brief only (D3).** `runForCanonical` (pillar,
    session-independent, keyed by `crawlRunId`) + `/api/brief/live` read the
    canonical run; **srt_/krt_ memos remain session-bound/SF-only in v1**.
    `runForCanonical` has no HTTP trigger and PERSISTS a PillarAnalysis row — on
    prod it's a Kevin-gated DB write.
  - **Task 13 (retention carve-out) intentionally skipped** — redundant with the
    existing 90-d prune paths.
  - **SEO-only scan mode (skip axe/screenshots/PSI) NOT built.** Breadcrumbs at
    both enqueue sites; planned optimization is spec §9. Until it ships every
    seoIntent audit runs the full ADA pipeline (~a few min for ~60–90 pages).
- **C6 Phase 3 invariants (live SEO score):**
  - `scoreLiveSeo` (`lib/findings/live-seo-score.ts`) → `CrawlRun.score`,
    SEGREGATED (sf-upload stays canonical via `selectRuns`; the live score never
    feeds B1/dashboard/fleet). `observed = HarvestedPageSeo row count`, NOT
    `pagesComplete`. Null when `indexableScored===0` (noindex/login) OR
    `observed/attempted < 0.5` OR `attempted===0` — don't "fix" noindex→null into
    a low number. Factors exclude crawl-depth + broken-links.
- **C6 Phase 2 invariants:** one live-scan run, one writer (`broken-link-verify`
  = single builder, owns `runId` + shared `ensurePage`); `statusCode:200`
  load-bearing on `HarvestedPageSeo`; injected `parseSeoFromDocument` must be
  SWC-helper-free (no `typeof`/spread → escaping helper → in-page `ReferenceError`);
  thin type = `thin_content`; duplicate run-scope count = number of GROUPS,
  trimmed-EXACT compare; page identity = audited `job.url` normalized, NEVER
  `page.url()`; `BrokenLinksSection` filters `broken_*`, `OnPageSeoSection` the
  on-page types (disjoint).
- **C6 Phase 1 invariants:** a SiteAudit holds up to TWO CrawlRuns (ada-audit +
  seo-parser live-scan) — `findUnique`/`update` use compound
  `{ siteAuditId_tool: { siteAuditId, tool } }`; `deleteMany`/`count`/`findMany`
  use plain `{ siteAuditId, tool }`. Live-scan run has NO origin blob;
  `pruneArchivedBlobs` (seo-parser) prunes only session-origin runs — never nulls
  the ADA `SiteAudit.summary`.
- **C5 invariants:** `FindingsBundle` is the ingestion contract; degraded
  fallbacks safe-shape (`archived:true`, arrays present, unknowns OMITTED never 0).
- **C4 invariants:** report-render group/dedup `report:<id>` — NEVER
  `site-audit:<id>` (the C6 verifier is the exception, post-terminal only).
  Reports/CSV/VPAT findings-run-only (pre-A2 → 409). Every dynamic report string
  escaped; CSV formula-injection-neutralized.
- **C3 invariants:** instance diffs never render across a wcagLevel mismatch;
  `AuditScorecard` strictly numeric (archived unknowns → "—", never 0).
- **C2 invariants:** scheduled path is ordinary downstream; card scores read
  `CrawlRun.score`; scheduled retention only deletes `scheduleId IS NOT NULL`.
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs
  `SetNull`; subtrees cascade from `CrawlRun` only; never backfill blobs; read
  services scalar/normalized-table only; BOTH prune flags ACTIVE.
- **Handoff-token / public route gotcha (bit us THREE times):** any new
  token-authed or public route MUST be added to `middleware.ts` `isPublicPath`
  + a `middleware.test.ts` case.
- Test gotchas: DB-backed test files use a unique domain/id/name prefix AND scope
  cleanup to tracked ids — never broad `deleteMany` on shared tables; clean
  `CrawlRun` by domain BEFORE origin rows; any test querying a CrawlRun by
  `siteAuditId` as a unique key needs the compound `siteAuditId_tool`; vitest
  jsdom has NO working localStorage; node is the default env.
- **Local dev quirk:** prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is interactive-only
  — write migration SQL by hand, apply with `prisma migrate deploy`.
- **Server has no `sqlite3` CLI** — node + Prisma from
  `/home/seo/webapps/seo-tools`. Prod checks run via `npx tsx` from the app dir
  (see the OAuth-only gotcha above).
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction.

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), production-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), production-verified. **A2 COMPLETE.**
- 2026-06-11 — B1 (#60), B2 (#61), B3 (#62), B4 (#63), B5 (#64 + middleware
  fix) all shipped + production-verified. **TRACK B COMPLETE.**
- 2026-06-11 — **C1 SHIPPED (PR #65)** — standalone ADA audits durable.
- 2026-06-12 — **C2 SHIPPED (PR #66)** — scheduled scans; weekly canary live.
- 2026-06-12 — **C3 SHIPPED (PR #67)** — ADA run diffing; ada-audit prune ACTIVE.
- 2026-06-12 — **C4 SHIPPED (PR #68)** — reporting layer (share/CSV/PDF/VPAT).
- 2026-06-12 — **C5 SHIPPED (PR #69)** — source-agnostic ingestion; seo-parser
  prune ACTIVE; `'live-scan'` reserved.
- 2026-06-16 — **C6 Phase 1 SHIPPED (PR #70), deployed, production-verified.**
- 2026-06-17 — **C6 Phase 2 SHIPPED (PR #71), deployed, production-verified** —
  on-page SEO extraction (findings-native). Prod-verified on manhattanschool.edu.
- 2026-06-17 — **C6 Phase 3 SHIPPED (PR #73), deployed, production-verified** —
  live SEO score. Prod: manhattanschool.edu → 99, noindex canary → null.
- 2026-06-22 — **C10 (SEO Performance Reports) SHIPPED (PR #75) + build-heap fix
  (PR #76), deployed, migration applied.** Service-account auth; 25 tasks
  subagent-driven, 2703 tests. Prod-verification (map a client → generate →
  metric-parity eyeball) is Kevin's pending manual pass.
- 2026-06-30 — **C6 Phase 4 BUILT** — autonomous live SEO source + native link
  graph (15 tasks subagent-driven, gate green). `seoIntent` columns +
  operator-created seoIntent schedules (D1), link graph from harvest scalars,
  canonical-page-facts provider feeding the pat_ pillar memo + live brief (D3 —
  srt_/krt_ stay SF-only). Task 13 skipped. SEO-only-mode breadcrumb (spec §9).
- 2026-07-02 — **Skill library SHIPPED (commit `57ae636`)** — 16 ground-truth
  operator skills under `.claude/skills/`. New tracker items: A2-f1, D0.
- 2026-07-02 (later) — **C6 Phase 4 MERGED + DEPLOYED (PR #85, prod @
  `9c07502`).** Gates re-run pre-merge (tsc / 2,871 tests / build green);
  migration `20260630120000_live_seo_source` applied clean; PM2 online.
- 2026-07-02 (latest) — **C6 Phase 4 PROD-VERIFIED (campaign Gate 0.3).** Drove
  the runbook against prod (Kevin authorized trigger + pillar write in-chat).
  seoIntent audit on client 12 manhattanschool.edu (`cmr434fsr00026st0i6upoeq1`,
  66/67 pages) → live-scan `CrawlRun` `54680dd9`: `seoIntent=true`, `score=98`,
  broken-link + on-page findings, link graph populated (avg inlinks/outlinks
  23.26, crawlDepth 1.38). Canonical selector correct in both branches (fresh
  21-d SF wins at window 30; live supersedes at window 0). `getCanonicalPageFacts`
  + `/api/brief/live` + session-independent `runForCanonical` (PillarAnalysis
  `cmr43gufj`, `sessionId=null`) all green. C6 stays `[~]`.
- 2026-07-02 (latest, C10) — **C10 (SEO Performance Reports) PROD-VERIFIED — Kevin's
  manual pass. C10 COMPLETE.** Kevin confirmed `/settings` Test connection working,
  reports render/look correct, and the SA is granted + GA4/GSC mapped for every
  client he currently has access to. Scorecard-#12 resolved as shipped ("Key
  Events", no change). Infra re-confirmed this session: SA key at
  `/home/seo/data/seo-tools/google-sa.json` (0600), SA email
  `er-seo-reports@seo-apps-485618.iam.gserviceaccount.com`. Both outstanding
  prod-verifications (C6 Phase 4 + C10) are now closed. **Next: roadmap choice —
  recommended D0 (backup+alert); parallel measurement stream = campaign Phase 1.**
