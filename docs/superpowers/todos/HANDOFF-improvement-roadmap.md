# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-02 (latest) · **Updated by:** C6 Phase 4 **PROD-VERIFIED** (campaign Gate 0.3, manhattanschool.edu) — the single next action is now **C10 prod-verification** (Kevin's manual pass)
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

State: C6 Phase 4 (autonomous live SEO source + native link graph) is MERGED
(PR #85), DEPLOYED (prod @ 9c07502), and now PROD-VERIFIED (2026-07-02, campaign
Gate 0.3 on client 12 manhattanschool.edu: live-scan CrawlRun seoIntent=true,
score=98, link graph + findings + canonical both-branches + brief + pillar all
green). Work from main. A 16-skill operator library lives in .claude/skills/.

1. Load the skill er-seo-tools-change-control first (hard gates: no merge/
   deploy/server mutation without Kevin's explicit go; docs rituals mandatory;
   never scan non-client sites).
2. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state +
   next item) and docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md
   (full plan). Trust ranking when docs disagree: code > plan/spec >
   tracker/handoff.
3. The immediate next action is C10 (SEO Performance Reports) PROD-VERIFICATION —
   Kevin's manual pass (needs GA4/GSC service-account grants + a client mapping,
   which are Kevin's to do). See this handoff's "Next item" section. Note client
   12 (manhattanschool.edu) is ALREADY GA4/GSC-mapped (ga4=398445527,
   gsc=sc-domain:manhattanschool.edu) — it is a ready C10 test client if the SA
   is granted on its properties. Resolve the scorecard-#12 open question (Key
   Events vs the spec's duplicate Avg Position).
4. After C10 verification: resume the C-track menu (C7 parser consolidation, C8
   score-explanation, C9 ADA scoring v2, or further C6 — SEO-only scan mode /
   external-link check), and/or SF-retirement campaign Phase 1 (SF-vs-live
   parity measurement — now unblocked; load er-seo-tools-sf-retirement-campaign).
5. After any verification/advance: tracker checkbox + dated status-log line,
   rewrite this handoff, and end your final reply with this doc's updated
   paste-in prompt in a code block.
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
- **SHIPPED: C10 — SEO Performance Reports (NET-NEW).** Merged (PR #75) + deployed
  2026-06-22; migration applied. Auth = Google **service account**. Spec/plan
  archived. **⚠ PROD-VERIFICATION STILL PENDING (Kevin)** — now the single next
  action; see Next item. C10 is the analytics foundation for SF-retirement Phase 6.
- **A1, A2, B1–B5, C1–C5 DONE. C6 Phases 1–4 DONE** (Phase 4 prod-verified
  2026-07-02). C6 stays `[~]` (later phases open).
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. Noindex → broken-link findings only,
  no on-page findings, null score (all by design).
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **C10 prod-verification** (still pending from 2026-06-22): grant SA on a
     client → map → generate → metric-parity eyeball vs `SEO_Report_1st_Draft.pdf`;
     resolve scorecard-#12 (Key Events vs the spec's duplicate Avg Position). See
     Next item. Client 12 (manhattanschool.edu) is already mapped and a ready
     test target once the SA is granted on its GA4 property + GSC site.
  2. **B4 quarter-plan decision still open:** prod has a near-empty QuarterPlan
     (2026-06-11 19:51 UTC) 409-blocking the one-time analyst-browser
     localStorage import. Keep it, or delete QuarterPlan rows server-side and
     re-open `/quarter-grid` holding `seo-quarter-v3`.
  3. **First real qct_ push not yet exercised** (prod plan is all-pool). After
     (2): assign a client to a week, set its Teamwork tasklist ID, push, paste.
  4. **Optional cleanup:** delete PillarAnalysis `cmr43gufj0001y200n9134fjp` (the
     Phase-4 pillar smoke artifact) if you don't want it in the client's history.
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

**C10 (SEO Performance Reports) prod-verification — Kevin's manual pass**
(unchanged from 2026-06-22; this is now the single next action since Phase 4 is
verified):

1. **Confirm the SA key on prod:** `GOOGLE_SA_KEY_FILE` set, key at
   `/home/seo/data/seo-tools/google-sa.json` (mode 0600, PM2-user-owned). Open
   `/settings` → "Test connection": should show the SA email
   (`er-seo-reports@seo-apps-485618.iam.gserviceaccount.com`) and GA4/GSC counts.
2. **Grant + map one low-risk client first.** Client 12 (manhattanschool.edu) is
   **already mapped** (ga4=398445527, gsc=sc-domain:manhattanschool.edu) — grant
   the SA email Viewer on its GA4 property (Property Access Management) + GSC site
   (Users & permissions) and it is ready. (Nuvani was the build's reference if
   you'd rather start there.)
3. **Generate one report** for last month at `/reports` → download the PDF.
4. **Metric-parity eyeball** vs `SEO_Report_1st_Draft.pdf` (repo root). **Resolve
   the open question:** scorecard #12 renders "Key Events" where spec §5's list has
   a duplicate "Avg Position" (a Looker artifact) — confirm which to show. If
   GA4/GSC metric names are off, fix is in the providers
   (`lib/analytics/google/ga4-provider.ts` / `gsc-provider.ts`) +
   `lib/report/seo/report-data.ts`.
5. Only after parity holds: grant/map the rest + (optionally) set the monthly
   schedule in `/settings`.

- **C10 non-blocking follow-ups:** GA4 comparison window fetches 4 metric groups
  it discards (quota trim — `ga4-provider.ts`); `rollupBatchStatus` duplicated
  between the render job and `lib/services/seo-reports.ts` (consolidate);
  `pruneSeoReports` should chunk `doomedIds` for SQLite param limits at scale;
  stricter date/client validation on `POST /api/reports`.
- **After C10 verification:** resume the C-track menu — C7 (parser
  consolidation), C8 (score-explanation), C9 (ADA scoring v2), or further C6
  (SEO-only scan mode / external-link check) — and/or start SF-retirement
  campaign **Phase 1** (SF-vs-live parity measurement — now unblocked by Phase 0;
  `.claude/skills/er-seo-tools-sf-retirement-campaign` + `scripts/sf-live-parity.ts`).

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
  `cmr43gufj`, `sessionId=null`) all green. C6 stays `[~]`. **Next: C10
  prod-verification (Kevin manual).**
