# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-30 · **Updated by:** C6 Phase 4 (autonomous live SEO source + native link graph) BUILT on branch `feat/autonomous-live-seo-source` — pending merge + prod verification
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

Current branch: feat/autonomous-live-seo-source (C6 Phase 4 built, gate-green,
pending merge + prod-verification).

1. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state + next item).
2. Read docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (full plan).
3. The immediate next action is to merge the branch and prod-verify C6 Phase 4,
   then complete C10 prod-verification (Kevin's manual pass).
4. After verification: check off the tracker items, add status-log lines, archive
   the spec/plan to docs/superpowers/archive/, rewrite this handoff doc for the
   next item, and end your final reply with this doc's updated paste-in prompt in
   a code block.
```

## Current state

- **BUILT (pending merge + prod-verification): C6 Phase 4 — autonomous live SEO
  source + native link graph.** Branch `feat/autonomous-live-seo-source`, 15-task
  subagent-driven build, 2026-06-30. Gate green (tsc / vitest / build). Spec:
  `docs/superpowers/specs/2026-06-30-autonomous-live-seo-source-design.md` ·
  Plan: `docs/superpowers/plans/2026-06-30-autonomous-live-seo-source.md`.
  Key deliverables:
  - `CrawlRun.seoIntent` flag on the live-scan run; `seoIntent:true` Schedules
    created autonomously (weekly cadence, self-healing) when a client has a
    linked domain — no manual wiring required.
  - `selectCanonicalSeoRun` exposes the most recent `seoIntent=true` live run as
    the canonical SEO baseline (still segregated — never displaces sf-upload score).
  - `computeLinkGraph` / `CanonicalPageFact(s)` derive a relational in/outlink
    graph from `CrawlPage.inlinks`/`outlinks` scalars persisted during the harvest.
  - Provider layer (`lib/seo/providers/`) feeds live SEO score + pillar brief into
    srt_/krt_/pat_ memo handoffs so SF upload is no longer required.
  - Task 13 (retention carve-out) intentionally skipped — redundant with existing
    pruning paths.
  - SEO-only-mode breadcrumb at both enqueue sites (`app/api/site-audit/route.ts`
    + `lib/jobs/handlers/scheduled-site-audit.ts`) pointing to spec §9 for the
    planned ADA-skip optimization.
- **SHIPPED: C10 — SEO Performance Reports (NET-NEW).** Merged (PR #75) + deployed
  to prod 2026-06-22; migration applied. Built subagent-driven, 25 tasks/2 phases,
  gate green (2703 tests / tsc / build). Auth = Google **service account** (Tasks
  3 & 6 dropped). Spec/plan archived: `archive/specs/2026-06-22-seo-performance-reports-design.md` ·
  `archive/plans/2026-06-22-seo-performance-reports.md`. **⚠ PROD-VERIFICATION
  PENDING (Kevin)** — see Next item below. C10 is the analytics foundation for
  SF-retirement Phase 6.
- **A1, A2, B1–B5, C1–C5 are DONE.** **C6 Phases 1–3 DONE:** broken-link verifier
  (PR #70), on-page SEO extraction (PR #71), live SEO score (PR #73) — all
  deployed + production-verified (Phase 3 on 2026-06-17). C6 Phase 4 built but not
  yet merged. C6 stays `[~]`.
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. Canary is noindex → broken-link
  findings only, no on-page findings, null score (all by design).
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **Merge + deploy `feat/autonomous-live-seo-source`** — prod-verify: trigger
     one site audit with `seoIntent:true`, confirm the canonical live-scan run is
     selected, smoke-test an srt_ memo on an indexable client domain.
  2. **C10 prod-verification (still pending from 2026-06-22):** grant SA on a
     client → map → generate → metric-parity eyeball vs `SEO_Report_1st_Draft.pdf`;
     resolve the scorecard-#12 open question (Key Events vs spec's duplicate
     Avg Position). See Gotchas → C10 invariants.
  3. **B4 quarter-plan decision still open:** prod has a near-empty QuarterPlan
     (2026-06-11 19:51 UTC) 409-blocking the one-time analyst-browser
     localStorage import. Keep it, or delete QuarterPlan rows server-side and
     re-open `/quarter-grid` in the browser holding `seo-quarter-v3`.
  4. **First real qct_ push not yet exercised** (prod plan is all-pool). After
     (3): assign a client to a week, set its Teamwork tasklist ID, push, paste.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3 + SF-retirement
  analytics integrations); sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups (not next items):** C6 — SEO-only scan mode (skip
  axe/screenshots/PSI for seoIntent runs — breadcrumb at both enqueue sites →
  spec §9), per-page on-page snapshots for error/redirect pages, external-link
  verification, CSS/JS/PDF broken-resource checks, redirect-chain/canonical/
  hreflang validation, content similarity, daily-cadence supersede-trimming, the
  analyst SF-vs-Live parallel-run gate; standalone single-page audit CSV/VPAT/
  report; public share-page export buttons; expandable rows on the public ADA
  share view; logo image for the PDF; `SessionPage` model drop (≥180 d after
  2026-06-11); same-URL standalone-audit diffing; fleet instance-level diffing;
  B2 v1 multi-domain limitation.

## Next item

**Two sequential actions:**

**1. Merge + prod-verify `feat/autonomous-live-seo-source` (C6 Phase 4).**
Branch is gate-green (tsc / vitest / build). Steps:

1. Open a PR from `feat/autonomous-live-seo-source` → `main` and merge it.
2. `git push && ssh seo@144.126.213.242 "~/deploy.sh"` — migration
   `20260630_autonomous_live_seo_source` (or however it was named) applies via
   `prisma migrate deploy`.
3. Smoke-test: trigger one site audit with `seoIntent:true` on an indexable
   client domain. Confirm the completed audit has a live-scan `CrawlRun` with
   `seoIntent=true` and a non-null `score`. Open an srt_ memo for that client
   — it should populate the brief from the live run (no SF upload required).
4. Mark C6 Phase 4 complete in the tracker (change `[~]` → `[~]` or annotate
   as appropriate; add a status-log line); archive the spec + plan to
   `archive/specs/` + `archive/plans/`; update this handoff doc.

**2. C10 prod-verification (Kevin's manual pass — unchanged from 2026-06-22):**

1. **Confirm the SA key on prod:** `GOOGLE_SA_KEY_FILE` set, key at
   `/home/seo/data/seo-tools/google-sa.json` (mode 0600, PM2-user-owned). Open
   `/settings` → "Test connection": should show the SA email
   (`er-seo-reports@seo-apps-485618.iam.gserviceaccount.com`) and GA4/GSC counts.
2. **Grant + map one low-risk client first** (Nuvani was the build's reference):
   grant the SA email on its GA4 property (Property Access Management) + GSC site
   (Users & permissions), then map it in `/clients/[id]` → Analytics IDs.
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
- **After both verifications:** resume the C-track menu — C7 (parser
  consolidation), C8 (score-explanation), C9 (ADA scoring v2), or further C6
  (SEO-only scan mode / external-link check). C10 cleared the analytics half of
  SF-retirement Phase 6 (SEMRush/DataForSEO + memo consumption remain, the latter
  gated on Anthropic/API billing).

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array form
  only, conditional logic via SQL `EXISTS`, manual `updatedAt = Date.now()` in
  raw statements (2026-06-10 production incident; CLAUDE.md "Do not").
- **C10 invariants (NEW — SEO Performance Reports, from the Codex spec+plan passes):**
  - **Auth = Google SERVICE ACCOUNT (decided 2026-06-22), not user-OAuth.** Sensitive
    scopes force OAuth verification (Production) or a 7-day token (Testing) — both bad.
    Service account: no consent screen, no verification, no token expiry. Key JSON in a
    gitignored file, path in `GOOGLE_SA_KEY_FILE`; never committed/logged. `lib/analytics/google/auth.ts`
    = `google.auth.GoogleAuth({ keyFile, scopes })`. NO `GoogleConnection` model, NO
    `/api/google/connect|callback`, NO `GOOGLE_TOKEN_ENC_KEY`. Plan Tasks 3 & 6 are REMOVED.
    Per-client cost: grant the SA email Viewer on each client's GA4 property + GSC site.
  - GA4 Data API via **`googleapis` `google.analyticsdata('v1beta')`** — NOT
    `@google-analytics/data`. GSC via `google.searchconsole('v1')`. Both take the GoogleAuth client.
  - **Provider error taxonomy (Codex auth-review):** a per-property **`403`/PERMISSION_DENIED**
    (SA not granted on THAT GA4 property / GSC site) → `reason:'unmapped'` (a per-client gap),
    NOT a global `'auth'` failure. `'auth'` is only for a missing/invalid key or a `401`.
    `429`/RESOURCE_EXHAUSTED (even on a 403) → `'quota'`. A valid SA with no access to one
    client must render that client's gap, not fail the whole batch. **Manual GA4-id/GSC-url
    entry is a HARD fallback** (Admin listing can be narrow), not just convenience.
  - **`gscSiteUrl` stored + sent VERBATIM** (`sc-domain:` vs URL-prefix are
    different GSC properties — never normalize).
  - Job group/dedup = **`seo-report:<id>`**, NEVER `site-audit:<id>`. Render job:
    concurrency 1, timeout 600_000, ALL fetch/build before `acquirePage()`.
  - **Manual prospects entry MUST null `metricsJson`** (+ reset status→queued) before
    re-enqueue, or the re-render keeps the stale snapshot.
  - **No SQLite `createMany`/`skipDuplicates`** — individual creates guarded by
    P2002 (see `site-audit-discover.ts`). Idempotency: `@@unique([scheduleId,
    scheduledFor])` (batch) + `@@unique([batchId, clientId])` (report).
  - The monthly schedule is a **non-system** operator-configurable `Schedule` row
    (`name:'seo-report-monthly'`) — NOT in `SYSTEM_SCHEDULES` (no boot re-enable).
  - No new public middleware paths (no OAuth callback in the SA model). `/privacy`,
    `/about`, and the Google site-verification file already shipped to main + deployed.
  - Metrics are a per-report `metricsJson` blob (NOT findings); reports get their
    OWN retention sweep (`pruneSeoReports`) — the 90-d findings prune does not cover them.
- **C6 Phase 4 invariants (NEW — autonomous live SEO source + native link graph):**
  - **`seoIntent` flag is the canonical SEO-source signal.** `CrawlRun.seoIntent`
    marks the run as the system's autonomous SEO baseline. `selectCanonicalSeoRun`
    picks the most recent `seoIntent=true` seo-parser live-scan run; it NEVER
    displaces the sf-upload score for B1/dashboard/fleet — `selectRuns` is
    unchanged and the sf-upload path is still the canonical score for those surfaces.
  - **Autonomous schedules are self-healing.** The system creates/updates a
    `scheduled-site-audit` Schedule row with `seoIntent:true` in the payload
    whenever a client's first domain is set; no manual wiring. If the schedule
    already exists it is left alone (idempotent). If a domain is removed, the
    schedule is disabled. NEVER remove or circumvent this auto-management.
  - **`computeLinkGraph` is pure + offline.** It reads `CrawlPage.inlinks`/
    `outlinks` that were persisted during the harvest (by the page job's settle
    fence). It NEVER triggers a live crawl and NEVER re-reads `HarvestedLink`.
    If the scalars are absent (pre-Phase-4 runs), the graph is empty — that is
    the expected degraded state.
  - **`CanonicalPageFact(s)` contract:** keyed on normalized URL; `inlinks` is the
    count of OTHER pages on the same domain that link to this page (from the
    `CrawlPage.inlinks` scalar). Callers (pillar brief, providers) MUST treat
    missing facts as graceful degraded state — never throw on absent graph data.
  - **Provider layer is additive.** `lib/seo/providers/` feeds live data into memo
    handoffs. A provider that finds no canonical run MUST return a degraded
    shape (empty arrays, null scores) — never throw. The sf-upload path continues
    to work unchanged as a fallback.
  - **Task 13 (retention carve-out) was intentionally skipped** — it would have
    added per-seoIntent prune logic that is redundant with the existing 90-d prune
    paths. Do not add it retroactively unless a concrete DB-growth concern arises.
  - **SEO-only scan mode (skip axe/screenshots/PSI) is NOT yet built.** Breadcrumb
    comments are at both enqueue sites. The planned optimization is spec §9. Until
    it ships, every seoIntent audit runs the full ADA pipeline.
- **C6 Phase 3 invariants (NEW — live SEO score):**
  - The live score is computed in the builder by the pure `scoreLiveSeo`
    (`lib/findings/live-seo-score.ts`) and written to `CrawlRun.score`. It is
    SEGREGATED — `selectRuns` keeps the sf-upload run canonical; the live score
    NEVER feeds B1/dashboard/fleet. Don't change that.
  - **`observed = HarvestedPageSeo row count`, NOT `pagesComplete`** (the counter
    bumps in the settle txn; `persistPageSeo` is best-effort after → a harvest
    failure leaves a completed page with no row).
  - **null when `indexableScored === 0`** (noindex/login-walled → unscoreable) OR
    `observed/attempted < 0.5` OR `attempted === 0`. A partially-noindex site
    still scores (indexability factor drags it). Don't "fix" noindex→null into a
    low number — it's intentional.
  - Factors exclude crawl-depth (no graph) and broken-links (keep live-vs-SF
    comparable). Schema coverage is computed in the builder BEFORE the transient
    `HarvestedPageSeo` rows are deleted (CrawlPage has no schema scalar).
  - No persisted coverage/reason-codes (read-time recompute). If factor
    breakdowns are wanted later, that's C8 (add a detail column then).
- **C6 Phase 2 invariants (NEW):**
  - **One live-scan run, one writer.** On-page + broken-link findings share ONE
    `CrawlRun` (writer delete-and-recreates on `{siteAuditId, tool:'seo-parser'}`;
    compound unique allows only one seo-parser run per SiteAudit). The
    `broken-link-verify` job is that single builder — it owns the `runId` + a
    shared `ensurePage(url, scalars?)` map; both mappers (`mapOnPageSeoFindings`,
    `mapBrokenLinkFindings`) return `FindingInput[]` against it. NEVER write the
    live-scan run from two jobs.
  - **`statusCode:200` is load-bearing.** `HarvestedPageSeo` rows persist
    `statusCode:200` (the row only exists on the successful 2xx settle path). The
    builder's `indexableOf` requires statusCode∈[200,300); a null would emit ZERO
    findings. (Codex plan-fix; do not "clean up" to null.)
  - **Injected pure functions must be SWC-helper-free.** `parseSeoFromDocument`
    is `.toString()`-injected into the page; any module-scope SWC helper it
    references (`_type_of` from `typeof`, `_to_consumable_array`, …) → runtime
    `ReferenceError` in the page. Verified clean at es2017 with Next's own SWC
    bindings. If you add to it, avoid `typeof`/spread/etc. that emit escaping
    helpers and re-verify.
  - thin type = **`thin_content`** (NOT `low_content_pages`); reuse
    `deriveIssueTypesForPage` (`lib/services/issue-membership.ts`) for missing/thin.
    Duplicate run-scope `count` = number of duplicate GROUPS (SF
    `pageTitles.parser` semantics), not affected pages. Duplicate compare =
    trimmed-EXACT, not case-folded.
  - page identity = audited `job.url` normalized, NEVER `page.url()`.
  - on-page `harvestTruncated` is always `false` (no per-page cap) — decoupled
    from the LINK truncation flag.
  - `OnPageSeoSection` "clean" = no on-page findings among successfully-audited
    HTML pages (NOT whole-site). An `analyzed` probe (`pages where statusCode
    != null`) prevents pre-Phase-2 live-scan runs from showing a false "clean".
  - `BrokenLinksSection` filters to `broken_*`; `OnPageSeoSection` to the on-page
    types — disjoint sets, no cross-leak.
- **C6 Phase 1 invariants:** a SiteAudit holds up to TWO CrawlRuns (ada-audit +
  seo-parser live-scan) — `findUnique`/`update` use the compound
  `{ siteAuditId_tool: { siteAuditId, tool } }`; `deleteMany`/`count`/`findMany`
  use plain `{ siteAuditId, tool }`. The verifier reuses the `site-audit:<id>`
  job group ONLY because it's enqueued post-terminal. A live-scan run has
  `score:null` and NO origin blob — it must NEVER displace the sf-upload SEO
  score (source-aware `selectRuns` + B1 series filters) and `pruneArchivedBlobs`
  must NEVER null the ADA `SiteAudit.summary` for it (seo-parser prunes only
  session-origin runs).
- **C5 invariants:** the `FindingsBundle` is the ingestion contract — adapters
  follow `lib/findings/types.ts` (normalized URLs, keys.ts dedup keys,
  3-severity vocab, adapter-computed score, exactly one origin FK). Degraded
  fallbacks safe-shape (`archived:true`, arrays present, unknowns OMITTED never 0).
- **C4 invariants:** report-render uses group/dedup `report:<id>` — NEVER
  `site-audit:<id>` (the C6 verifier is the exception, allowed only post-terminal).
  Reports/CSV/VPAT findings-run-only (pre-A2 → 409). Every dynamic report string
  escaped; CSV formula-injection-neutralized.
- **C3 invariants:** instance diffs never render across a wcagLevel mismatch;
  `AuditScorecard` strictly numeric (archived unknowns → "—", never 0).
- **C2 invariants:** scheduled path is ordinary downstream; card scores read
  `CrawlRun.score`; scheduled retention only deletes `scheduleId IS NOT NULL`.
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs
  `SetNull`; subtrees cascade from `CrawlRun` only; never backfill blobs; read
  services scalar/normalized-table only; BOTH prune flags ACTIVE.
- `finalizeSiteAudit` single decision point; the findings hook stays LAST among
  DB writes; the broken-link enqueue is the trailing no-DB-write step after it.
- **Handoff-token / public route gotcha (bit us THREE times):** any new
  token-authed or public route MUST be added to `middleware.ts` `isPublicPath`
  + a `middleware.test.ts` case. (No new public routes in Phase 2.)
- Test gotchas: DB-backed test files use a unique domain/id/name prefix AND
  scope cleanup to tracked ids — never broad `deleteMany` on shared tables;
  clean `CrawlRun` by domain BEFORE origin rows; any test querying a CrawlRun by
  `siteAuditId` as a unique key needs the compound `siteAuditId_tool` input;
  vitest jsdom has NO working localStorage; node is the default env.
- **Local dev quirk:** prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is interactive-only
  — write migration SQL by hand, apply with `prisma migrate deploy`.
- **Server has no `sqlite3` CLI** — node + Prisma from
  `/home/seo/webapps/seo-tools`. Authed prod checks: source the server `.env`,
  then **form-POST** `--data-urlencode "password=$APP_AUTH_PASSWORD"` to
  `/api/auth/login` (formData not JSON; 303 + cookie jar), reuse the jar. A site
  audit is triggered by `POST /api/site-audit {domain,wcagLevel}` (202 + queued id).
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (registry session for this workspace exists; resume it — at turn 71).

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
- 2026-06-16 — **C6 Phase 1 SHIPPED (PR #70), deployed, production-verified** —
  out-of-band broken-link verifier; named C6 migration
  (`@@unique([siteAuditId, tool])`); live-scan run coexists with ada-audit.
- 2026-06-17 — **C6 Phase 2 SHIPPED (PR #71), deployed, production-verified** —
  on-page SEO extraction (findings-native): on-page findings (duplicate/missing/
  thin) ride the existing harvest into the unified live-scan run. Spec Codex ×6,
  plan Codex ×8, 13 tasks subagent-driven, 2,413 tests. Prod-verified on an
  indexable site (manhattanschool.edu); canary is noindex so it correctly emits
  no on-page findings. C6 stays `[~]`.
- 2026-06-17 — **C6 Phase 3 SHIPPED (PR #73), deployed, production-verified** —
  live SEO score (forked coverage-aware `scoreLiveSeo` → `CrawlRun.score`; null
  for noindex/low-coverage; crawl-depth + broken-links excluded). Spec Codex ×3,
  plan Codex accept, 4 tasks subagent-driven, 2,426 tests. Prod: manhattanschool.edu
  → 99, noindex canary → null. C6 stays `[~]`. Next: C7, C6 Phase 3a (link graph),
  or C8 (score-explanation) — analytics gated on API billing.
- 2026-06-22 — **C10 (SEO Performance Reports) STARTED** — net-new initiative,
  greenlit to build now. Brainstorm → spec (Codex ×9) → plan (Codex ×14), all
  reviewed. Spec `specs/2026-06-22-seo-performance-reports-design.md`; plan (26
  tasks, 2 phases) `plans/2026-06-22-seo-performance-reports.md`. Subagent-driven
  build starting; blocked only on Kevin's one-time Google Cloud OAuth setup +
  env vars (runbook delivered). Delivers SF-retirement Phase 6's GA4/GSC half.
- 2026-06-22 — **C10 SHIPPED (PR #75) + build-heap fix (PR #76), deployed,
  migration applied.** Service-account pivot held (Tasks 3 & 6 dropped); 25 tasks
  subagent-driven, 2703 tests. Whole-branch (opus) + Codex merge reviews passed;
  Codex caught one must-fix (full Gaxios error objects logged in Google routes →
  sanitized, 3b3ab8d). Prod deploy first OOM'd on `next build` (server ~2 GB Node
  heap; C10's ~40 new files the tipping point) → baked `--max-old-space-size=3072`
  into the `build` script. Spec/plan archived. **Prod-verification (map a client →
  generate → metric-parity eyeball, + scorecard-#12 question) is Kevin's pending
  manual pass** — see Next item. C10 stays the analytics foundation for SF-Phase 6.
- 2026-06-30 — **C6 Phase 4 BUILT** — autonomous live SEO source + native link
  graph (branch `feat/autonomous-live-seo-source`, 15 tasks subagent-driven, gate
  green). `CrawlRun.seoIntent`, autonomous self-healing Schedule creation, link
  graph from harvest scalars, provider layer feeding memo handoffs without SF
  upload. Task 13 (retention carve-out) intentionally skipped. SEO-only-mode
  breadcrumb at both enqueue sites (spec §9). **Pending merge + prod-verification.**
