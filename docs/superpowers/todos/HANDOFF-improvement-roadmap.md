# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-22 · **Updated by:** C10 (SEO Performance Reports) kickoff — spec + plan written + Codex-reviewed; subagent-driven build starting
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap.

1. Read docs/superpowers/todos/HANDOFF-improvement-roadmap.md (current state + next item).
2. Read docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md (full plan).
3. Read the roadmap doc section named under "Next item" below.
4. Follow the normal flow: brainstorm/spec if the item needs one, write the plan,
   implement, test, commit. When the item is done: check it off in the tracker,
   add a status-log line, rewrite this handoff doc for the next item, and end
   your final reply with this doc's updated paste-in prompt in a code block.
```

## Current state

- **ACTIVE: C10 — SEO Performance Reports (NET-NEW, greenlit 2026-06-22).** Spec +
  plan written and Codex-reviewed (3 passes: design, spec ×9 fixes, plan ×14 fixes).
  Automated branded per-client PDF (GA4 + Search Console + CRM "Prospects"),
  period-over-period, on-demand + monthly schedule — replaces the manual Looker
  export. Spec: `specs/2026-06-22-seo-performance-reports-design.md`; Plan (26
  tasks, 2 phases): `plans/2026-06-22-seo-performance-reports.md`. **Build is
  subagent-driven, starting now.** Doubles as SF-retirement Phase 6's GA4/GSC
  analytics-ingestion foundation (`lib/analytics/` provider layer). **Blocked only
  on Kevin's one-time Google Cloud OAuth setup + 4 env vars** (runbook delivered
  2026-06-22); all TDD-with-mocks work proceeds without him.
- **A1, A2, B1–B5, C1–C5 are DONE.** **C6 Phases 1–3 DONE:** broken-link verifier
  (PR #70), on-page SEO extraction (PR #71), live SEO score (PR #73) — all
  deployed + production-verified (Phase 3 on 2026-06-17). C6 stays `[~]`
  (multi-phase track).
- **C6 Phase 3 — what shipped:** the live-scan `CrawlRun` now carries a real SEO
  health `score` (was `null`). Pure `scoreLiveSeo` (`lib/findings/live-seo-score.ts`)
  — forked `computeHealthScore` with explicit factor availability (indexability,
  error rate, missing title/meta/H1, thin, schema; crawl-depth + broken-links
  excluded), computed in the `broken-link-verify` builder, written to
  `CrawlRun.score`. **null** when no indexable content (noindex/login-walled) or
  <50% observed coverage; a partially-noindex site scores (indexability factor
  drags it). Surfaced on `OnPageSeoSection` (score + coverage line, read-time
  recompute). NO migration, `selectRuns` unchanged (live score never displaces the
  sf-upload canonical score). **Prod-verified:** manhattanschool.edu (67/67
  indexable) → score 99; proway.erstaging.site (noindex canary) → score null.
- **C6 Phase 2 recap:** on-page SEO (title/meta/H1/canonical/schema/word-count)
  harvested in the existing harvest `page.evaluate` → transient `HarvestedPageSeo`
  → the post-terminal `broken-link-verify` job is the **single live-scan run
  builder** (on-page + broken findings in ONE live-scan `CrawlRun`). `OnPageSeoSection`
  + `BrokenLinksSection` (scoped to `broken_*`).
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. NOTE: the canary is **noindex**, so
  its weekly live-scan run shows broken-link findings, **no on-page findings, and a
  null score** (all by design) — use an indexable client domain to exercise the
  on-page + score paths.
- **⚠ PENDING HUMAN STEPS (Kevin) — unchanged from B5:**
  1. **B4 quarter-plan decision still open:** prod has a near-empty QuarterPlan
     (2026-06-11 19:51 UTC) 409-blocking the one-time analyst-browser
     localStorage import. Keep it, or delete QuarterPlan rows server-side and
     re-open `/quarter-grid` in the browser holding `seo-quarter-v3`.
  2. **First real qct_ push not yet exercised** (prod plan is all-pool). After
     (1): assign a client to a week, set its Teamwork tasklist ID, push, paste.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3 + SF-retirement
  analytics integrations); sitemap miss-rate measurement not yet run;
  daily/nightly cadences still gated (C6 supersede-trimming NOT built).
- **Parked follow-ups (not next items):** C6 — per-page on-page snapshots for
  error/redirect/non-HTML pages (runner-path capture — would give precise per-page
  coverage; the Phase-3 score derives coverage from SiteAudit counters instead),
  inlink/authority graph + crawl depth (roadmap Phase 3a),
  external-link verification, CSS/JS/PDF broken-resource checks, redirect-chain/
  canonical/hreflang validation, content similarity, daily-cadence
  supersede-trimming, the analyst SF-vs-Live parallel-run gate; standalone
  single-page audit CSV/VPAT/report; public share-page export buttons; expandable
  rows on the public ADA share view; logo image for the PDF; `SessionPage` model
  drop (≥180 d after 2026-06-11); same-URL standalone-audit diffing; fleet
  instance-level diffing; B2 v1 multi-domain limitation.

## Next item

**C10 — SEO Performance Reports. Execute the plan (`plans/2026-06-22-seo-performance-reports.md`),
subagent-driven, Phase 1 (Tasks 0–20) then Phase 2 (Tasks 21–25).** Spec + plan
are done and Codex-reviewed — no more brainstorm/spec/plan step; go straight to
implementation per `superpowers:subagent-driven-development`.

- **Human-in-the-loop gates (do not block coding — queue them):** (1) Kevin's
  Google Cloud OAuth setup + the 4 env vars must exist before the Task 19 live
  smoke and Task 20 metric-parity check; (2) the one-time "Connect Google" consent
  click (only the company-account holder can do it); (3) per-client GA4/GSC
  mapping; (4) metric-parity eyeball vs the live Looker report. Everything else is
  TDD with mocked Google clients.
- **After C10 ships:** resume the C-track menu — C7 (parser consolidation), C6
  Phase 3a (audited-set link graph), or C8 (score-explanation). C10 also clears the
  analytics half of SF-retirement Phase 6 (SEMRush/DataForSEO + memo consumption
  remain, the latter gated on Anthropic/API billing).

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
