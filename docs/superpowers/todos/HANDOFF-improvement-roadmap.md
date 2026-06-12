# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-12 · **Updated by:** C5 close-out (source-agnostic ingestion)
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

- **A1, A2, B1–B5, C1–C5 are DONE** (durable job queue #50–#54; findings
  layer #55–#58; client dashboard #60; findings/action center #61; Quarter
  Grid → DB #62; grid split #63; grid closure #64; standalone ADA durable #65;
  scheduled scans #66; ADA run diffing + blob-archive activation #67;
  reporting layer #68; **source-agnostic ingestion #69, deployed +
  production-verified 2026-06-12**).
- **C5 shipped:** (1) `lib/findings/types.ts` is THE documented
  source-agnostic ingestion contract (`FindingsBundle`; `source` includes
  `'live-scan'`; adapter rules in the module header); (2)
  `lib/findings/seo-findings-fallback.ts` rebuilds a degraded
  `AggregatedResult` from findings rows (`archived: true`, safe shape,
  unknowns omitted never 0) — served by results page, share page/API,
  parse GET, format exports; (3) diff + claude/srt_/krt_ memo exports 409
  `session_archived` (ONLY when `CrawlRun.archivePrunedAt` is stamped);
  (4) history reads `CrawlRun.score` + `Session.totalUrls` (blob only
  pre-A2); (5) **`PRUNE_ACTIVATED['seo-parser']` is ACTIVE** — both flags
  are now true; first eligible prunes ~2026-09-08 (watch the cleanup tick
  log for `[findings] pruned …`). Suite 2,370 green (243 files).
- **Weekly canary schedule still LIVE in prod:** client 31 "ER Staging Canary"
  → proway.erstaging.site, `weekly:1@06:00`.
- **⚠ PENDING HUMAN STEPS (Kevin) — unchanged from B5:**
  1. **B4 quarter-plan decision still open:** prod has a near-empty QuarterPlan
     (2026-06-11 19:51 UTC) 409-blocking the one-time analyst-browser
     localStorage import. Keep it, or delete QuarterPlan rows server-side and
     re-open `/quarter-grid` in the browser holding `seo-quarter-v3`.
  2. **First real qct_ push not yet exercised** (prod plan is all-pool). After
     (1): assign a client to a week, set its Teamwork tasklist ID, push, paste.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run; daily/nightly cadences gated until C6
  supersede-trimming (decided in C3).
- **Parked follow-ups (not next items):** standalone single-page audit
  CSV/VPAT/report; public share-page export buttons; expandable rows on the
  public ADA share view; logo image asset for the PDF; `SessionPage` model
  drop (≥180 d after 2026-06-11); same-URL standalone-audit diffing; fleet
  instance-level diffing; B2 v1 multi-domain limitation; findings-shared
  run-selection source-awareness (matters once live-scan runs coexist with
  sf-upload on the same domain — C6 presentation decision).

## Next item

**C6 — Live SEO phases** (tracker Track C; roadmap doc
`docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md` —
**Phase 1 broken-link verifier first**, its decision gates apply; needs C5 ✓).
Key context for the brainstorm:

- **Scope-reconcile first as always.** The pre-A2 live-seo MVP plan was moved
  to `docs/superpowers/nyi/plans/2026-06-02-live-seo-on-ada.md` (spec in
  `nyi/specs/`): it predates the findings layer and proposes its own
  `PageSeoSnapshot`/`SiteSeoResult` models + forked scorer. C6 must land in
  the **findings model instead** — a live run is a `CrawlRun` with
  `source: 'live-scan'`, pages are `CrawlPage` rows (they carry `statusCode`,
  which the C5 fallback already turns into status buckets), issues are
  `Finding` rows. The old plan's extraction code (`extractPageSeo`,
  `parseSeoFromDocument`) is still the right harvest layer — keep it; replace
  its persistence layer.
- **The named C6 migration (decided in C5, ships in the C6 PR that
  introduces the second run, BEFORE any live-scan dual-write):** remove
  `@unique` from `CrawlRun.siteAuditId`, add `@@unique([siteAuditId, tool])`,
  re-key `writer.ts` delete-and-recreate + every
  `findUnique({ where: { siteAuditId } })` reader to `{ siteAuditId, tool }`.
  The adapter-readiness test (`lib/findings/adapter-readiness.test.ts`) pins
  the current clobber limitation — it flips when the migration lands.
- **Phase 1 = out-of-band broken-link verifier** (SF-retirement doc §2):
  deduped queue over harvested internal links + resources, run AFTER the
  crawl, same-domain first, throttled, HEAD-with-GET-fallback, capped,
  confidence-labeled. It unlocks the TOP roadmap weights
  (`broken_pages:100/broken_internal_links:90/broken_images:85` in
  `priority.service.ts`). Risks named in the doc: WAF/CDN bans from the VPS
  IP, third-party false positives, SQLite growth — mitigation strategies are
  listed there; honor them in the spec.
- The verifier needs harvested links — decide in the brainstorm whether C6
  starts with the live-extraction phase (rendered-DOM harvest inside the ADA
  scan, findings-native) or whether Phase 1 can ride sitemap-discovered URLs
  alone first. The A1 durable job queue is the natural home for verifier jobs
  (new job type, per-type concurrency/backoff).
- **Daily cadence gate (from C3):** C6's supersede-trimming design space —
  if C6 adds retention that trims superseded within-window scheduled audits,
  the `daily@` cadence can unlock in `/api/clients/[id]/schedules`.

Full flow: brainstorm/spec → Codex → plan → Codex → implement.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **C5 invariants:** the `FindingsBundle` is the ingestion contract — adapters
  follow the rules in the `lib/findings/types.ts` header (normalized URLs,
  keys.ts dedup keys, 3-severity vocabulary, adapter-computed score, exactly
  one origin FK). Degraded fallback objects are safe-shape (`archived: true`,
  UI-assumed arrays present, unknowns OMITTED never 0); completeness is never
  recomputed on archived data; status buckets only from `CrawlPage.statusCode`;
  `session_archived` 409s require the `archivePrunedAt` stamp; degraded diffs
  are refused (diff.service coalesces `?? 0` → false deltas); parity/rebuild
  require the blob and say so explicitly.
- **C4 invariants:** report-render jobs use group/dedup `report:<id>` — NEVER
  `site-audit:<id>` (recovery treats that group as audit liveness). Report
  data loads BEFORE `acquirePage()`. Reports/CSV/VPAT are findings-run-only
  (pre-A2 → 409 `no_findings_run`). Every dynamic report string escaped; CSV
  formula-injection-neutralized; `safeFilenamePart` on Content-Disposition.
  Report `ready` requires stamp AND file. `shareMode` never issues a
  cookie-gated fetch (fetch-spy-pinned).
- **C3 invariants:** instance diffs never render across a wcagLevel mismatch;
  `AuditScorecard` strictly numeric — archived unknowns travel in
  `archivedCounts` and render "—", never 0; triage off on archived data;
  blob-first, findings-fallback; artifact deletion snapshot-based.
- **C2 invariants:** scheduled path is ordinary downstream; handler resolves
  its Schedule via the Job row; config rot disables, DB errors retry; card
  scores read `CrawlRun.score`; scheduled retention only deletes
  `scheduleId IS NOT NULL` terminal rows.
- **Standalone-ADA invariants (C1):** status-fenced writes, first terminal
  writer wins, `dispatchPdfScans` BEFORE the complete settle, group-liveness
  death signal.
- Job-queue invariants (A1): attempt-fenced heartbeat/settle,
  finalize-before-fail, `system-` reserved namespace,
  `@@unique([scheduleId, scheduledFor])`.
- `finalizeSiteAudit` single decision point; hook order carry-forward THEN
  findings — **the findings hook stays LAST**.
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs
  `SetNull`; subtrees cascade from `CrawlRun` only; never backfill blobs;
  read services scalar/normalized-table only; BOTH prune flags ACTIVE.
- **Quarter-grid invariants (B3/B4/B5):** singleton plan facade; mere
  page-opens never write; push metadata written ONLY by the receipt route.
- **Handoff-token / public route gotcha (bit us THREE times):** any new
  token-authed or public route MUST be added to `middleware.ts` `isPublicPath`
  + a `middleware.test.ts` case.
- Test gotchas: DB-backed test files use their own unique domain/id/name
  prefix AND scope cleanup to tracked ids — never broad `deleteMany` on
  shared tables; pre-clean prefixes in `beforeAll`; clean `CrawlRun` by
  domain BEFORE origin rows; vitest jsdom has NO working localStorage; the
  default vitest env is node — component tests need
  `// @vitest-environment jsdom` AND explicit `afterEach(cleanup)`
  (globals:false ⇒ no auto-cleanup); `waitFor` can't see fake timers under
  `globals:false`; if an existing route test file is mock-based, extend in
  its style or add a DB-backed sibling.
- **Parallel-agent execution note (C4):** a session usage limit can cut a
  whole agent wave mid-task; stagger waves if budget looks tight; commit each
  agent's verified files as soon as it reports. (C5 ran inline — fine for
  sweep-shaped work over shared modules.)
- **Local dev quirk:** prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — write migration SQL by hand, apply with
  `prisma migrate deploy`. Local dev runs auth-free (`npx next dev`;
  `next start` refuses to boot without prod secrets).
- **Server has no `sqlite3` CLI** — node + Prisma from
  `/home/seo/webapps/seo-tools` (run .mjs scripts from INSIDE the app dir —
  module resolution fails from /tmp). Authenticated prod checks: source the
  server `.env` in the SSH session, then **form-POST**
  `--data-urlencode "password=$APP_AUTH_PASSWORD"` to `/api/auth/login`
  (it reads formData, NOT JSON; 303 + cookie jar), and reuse the jar.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (registry session for this workspace exists; resume it).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created.
- 2026-06-10 — A1 Phases 0–4 (PRs #50–#54), production-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), production-verified. **A2 COMPLETE.**
- 2026-06-11 — B1 (#60), B2 (#61), B3 (#62), B4 (#63), B5 (#64 + middleware
  fix) all shipped + production-verified. **TRACK B COMPLETE.** B4 keep-or-reset
  decision + first real qct_ push still pending on Kevin.
- 2026-06-11 — **C1 SHIPPED (PR #65)**, deployed, production-verified incl.
  restart drill. Standalone ADA audits durable.
- 2026-06-12 — **C2 SHIPPED (PR #66), deployed, production-verified** — two
  live scheduled runs end-to-end; weekly canary schedule live on client 31.
- 2026-06-12 — **C3 SHIPPED (PR #67), deployed, production-verified** — live
  diff panel on the canary pair; `PRUNE_ACTIVATED['ada-audit']` ACTIVE.
- 2026-06-12 — **C4 SHIPPED (PR #68), deployed, production-verified** — share
  links + CSV + branded PDF report + VPAT scaffold; all relational-first.
- 2026-06-12 — **C5 SHIPPED (PR #69), deployed, production-verified** —
  ingestion contract formalized (`'live-scan'` reserved), findings fallback on
  every SEO read surface, `PRUNE_ACTIVATED['seo-parser']` ACTIVE (both flags
  now true; first prunes ~2026-09-08). Next: C6 (live SEO phases —
  broken-link verifier first).
