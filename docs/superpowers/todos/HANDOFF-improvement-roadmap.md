# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-17 · **Updated by:** C6 Phase 2 ship close-out (on-page SEO extraction — deployed + production-verified)
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

- **A1, A2, B1–B5, C1–C5 are DONE.** **C6 Phase 1 (broken-link verifier)** DONE
  (PR #70, 2026-06-16). **C6 Phase 2 (on-page SEO extraction MVP, findings-native)
  DONE** (PR #71, deployed + production-verified 2026-06-17). C6 stays `[~]`
  (multi-phase track — see Next item for remaining phases).
- **C6 Phase 2 — what shipped:** per-page on-page SEO (title/meta/H1/canonical/
  schema/word-count/images) is harvested inside the EXISTING rendered-DOM harvest
  `page.evaluate` (zero extra round-trips) → one transient `HarvestedPageSeo` row
  per successfully-settled page → the post-terminal `broken-link-verify` job
  (now the **single live-scan run builder**) reads both transient tables,
  populates `CrawlPage` scalars, and emits duplicate/missing/thin `Finding`s into
  the SAME live-scan `CrawlRun` as the broken-link findings (`tool:'seo-parser'`,
  `source:'live-scan'`, **`score:null`** — live SEO score deferred to Phase 3).
  Results page has an `OnPageSeoSection`; `BrokenLinksSection` scoped to
  `broken_*` (disjoint type sets, no cross-leak). Spec/plan archived. 2,413
  tests; subagent-driven (13 tasks). **Prod-verified:** canary
  (proway.erstaging.site) is site-wide noindex so it correctly emits zero on-page
  findings (every page excluded by the indexability rule — scalars still
  populated); the on-page path was demonstrated on an INDEXABLE site
  (manhattanschool.edu, 67/67 indexable → duplicate_title/missing_h1/
  missing_meta_description/thin_content + broken_internal_links, both sources in
  one live-scan run coexisting with ada-audit, transient tables cleared).
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`. NOTE: the canary is **noindex**, so
  its weekly live-scan run shows broken-link findings but NO on-page findings (by
  design) — use an indexable client domain to exercise the on-page path.
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
- **Parked follow-ups (not next items):** C6 — live SEO score (forked scorer),
  on-page snapshots for error/redirect/non-HTML pages (needs the score's coverage
  denominators), inlink/authority graph + crawl depth (roadmap Phase 3a),
  external-link verification, CSS/JS/PDF broken-resource checks, redirect-chain/
  canonical/hreflang validation, content similarity, daily-cadence
  supersede-trimming, the analyst SF-vs-Live parallel-run gate; standalone
  single-page audit CSV/VPAT/report; public share-page export buttons; expandable
  rows on the public ADA share view; logo image for the PDF; `SessionPage` model
  drop (≥180 d after 2026-06-11); same-URL standalone-audit diffing; fleet
  instance-level diffing; B2 v1 multi-domain limitation.

## Next item

**Decision point — pick one (both valid). C6 Phase 2 is shipped; choose the next
chunk:**

- **C6 Phase 3 — live SEO score (forked scorer).** `nyi` plan
  `docs/superpowers/nyi/plans/2026-06-02-live-seo-on-ada.md` §6 has the forked
  `computeHealthScore` design (explicit factor-availability map, null-below-coverage).
  This is the deferred piece: it needs the coverage denominators, which in turn
  need on-page rows for error/redirect/non-HTML pages (runner-path capture) — so
  it's a real next chunk, not a tweak. Store on the live-scan `CrawlRun.score`
  (still segregated by `selectRuns` from the sf-upload score).
- **C7 — parser consolidation + streaming parse + per-file failure isolation**
  (~1 wk; infra cleanup of `lib/parsers/`, no roadmap-doc section). Independent
  of C6.

Full flow either way: brainstorm/spec → Codex → plan → Codex → implement.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array form
  only, conditional logic via SQL `EXISTS`, manual `updatedAt = Date.now()` in
  raw statements (2026-06-10 production incident; CLAUDE.md "Do not").
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
  instruction (registry session for this workspace exists; resume it — at turn 67).

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
  no on-page findings. C6 stays `[~]`. Next: C6 Phase 3 (live SEO score) or C7.
