# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-12 · **Updated by:** C2 close-out (scheduled recurring site audits + score deltas)
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

- **A1, A2, B1–B5, C1, C2 are DONE** (durable job queue PRs #50–#54; findings
  layer #55–#58; client dashboard #60; findings/action center #61; Quarter
  Grid → DB #62; grid split #63; grid closure #64; standalone ADA durable #65;
  **scheduled scans #66, deployed + production-verified 2026-06-12 with two
  live end-to-end scheduled runs**).
- **C2 shipped:** client scan schedules as plain `Schedule` rows firing a
  `scheduled-site-audit` wrapper job into `queueSiteAuditRequest()`;
  `SiteAudit.scheduleId` (SetNull) attribution; `monthly:` cadence +
  `cadenceClass()`; CRUD under `/api/clients/[id]/schedules` (weekly/monthly
  only — daily gated until C3); triage-check carry-forward by content key
  (finalizer, before the still-LAST findings hook); cadence-aware retention
  (`pruneScheduledSiteAudits`, ACTIVE, weekly 90 d / monthly 365 d, keep
  latest 2 completed; CrawlRun findings survive); `ScheduledScansCard` on
  `/clients/[id]` with last-run score + Δ from `CrawlRun.score`. Suite 2,137
  green (207 files).
- **A standing weekly canary schedule is LIVE in prod:** client 31
  "ER Staging Canary" → proway.erstaging.site, `weekly:1@06:00` (Mon 06:00
  UTC). Two drill runs completed (score 94, Δ 0). Leave it, repoint it, or
  delete it via the card — it's the live proof the tick keeps working.
- **⚠ PENDING HUMAN STEPS (Kevin) — unchanged from B5:**
  1. **B4 quarter-plan decision still open:** prod has a near-empty
     QuarterPlan (created 2026-06-11 19:51 UTC) that 409-blocks the one-time
     analyst-browser localStorage import. Keep it, or delete QuarterPlan rows
     server-side (node + Prisma from `/home/seo/webapps/seo-tools`) and
     re-open `/quarter-grid` in the browser holding `seo-quarter-v3`.
  2. **First real qct_ push not yet exercised** (mint 409s `nothing_planned`
     — the prod plan is all-pool). After (1): assign a client to a week,
     ensure its Teamwork tasklist ID is set, click "⇪ Push to Teamwork",
     paste into Claude.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run; **daily/nightly scan cadences gated on
  C3** (child `AdaAudit.result` blobs make nightly volume unsafe; the C2
  retention table already prices daily at 14 d — flipping it on is a
  one-constant change once blobs are prunable).
- **Parked follow-ups (not next items):** `SessionPage` model drop (≥180 d
  after 2026-06-11); `PRUNE_ACTIVATED` flips (same-PR-as-last-blob-reader);
  B2 v1 gaps (URL-level diffing → C3); keyword-orphan score ambiguity;
  archived-client name uniqueness; schedule (client,domain) uniqueness is
  best-effort app-level (documented in the C2 spec §7).

## Next item

**C3 — Relational ADA violations → real run-over-run diffing + regression
alerts** (tracker Track C; roadmap doc
`docs/superpowers/nyi/improvement-roadmaps/02-ada-audit.md` Phase 3,
1–1.5 wks; needs A2 ✓). Key context for the brainstorm:

- **Scope-reconcile FIRST (the C1 lesson — the 02-doc predates A2/B2/C2):**
  A2 already ships relational `Violation` rows (runId, pageId, ruleId, exact
  axe impact, wcagTags, nodes capped 5×300 chars, dedup keys) on every
  completed audit, and B2 already ships TYPE-level diffing +
  `newCriticalTypes` regression chips. What Phase 3 still wants that doesn't
  exist: **URL+rule-level run-over-run diffing (new / resolved / unchanged
  violation instances)**, regression surfacing beyond type-level chips,
  `SiteAudit.summary` / `common-issues.ts` (354 LOC) recomputed from
  Violation rows instead of blobs, and the **ada-audit `PRUNE_ACTIVATED`
  flip** (must land in the same PR as that tool's last blob reader — the
  site-audit results view still reads child `AdaAudit.result` blobs).
- Diff baseline selection should reuse `selectRuns()` (`findings-shared.ts`)
  semantics — domain-matched previous, id-desc tie-break.
- C2's carry-forward keys (`SiteAuditCheck` content hashes) and the findings
  `Finding`/`Violation` dedup keys are different key spaces — don't conflate.
- Flipping daily cadences on (C2 gate) becomes possible once the last blob
  reader is gone; decide in this phase whether to actually enable it or
  leave it for C6 (Live-SEO substrate).
- DB note: Violation rows are kept forever by design (trends); the 90-d blob
  archive (`pruneArchivedBlobs`, currently INERT) is the thing the reader
  flip activates.

Full flow: brainstorm/spec → Codex → plan → Codex → implement.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **C2 invariants:** the scheduled path is ordinary everywhere downstream —
  wrapper job → `queueSiteAuditRequest()`; never a parallel scheduler. The
  handler resolves its Schedule via the Job row (`JobHandlerContext` has no
  scheduleId). Config rot disables the schedule; DB errors throw/retry;
  duplicate slots are consumed, never queued behind. Schedule-card scores
  read `CrawlRun.score` joined by `siteAuditId` — `SiteAudit.score` is never
  persisted by the finalizer. Scheduled retention only ever deletes
  `scheduleId IS NOT NULL` terminal rows (manual + orphaned audits are
  untouchable); deleting a schedule SetNulls its history to manual-class.
- **Standalone-ADA invariants (C1):** handler writes fenced by
  `status='running'` + `siteAuditId: null` claim; first terminal writer wins;
  `dispatchPdfScans` BEFORE the complete settle; standalone recovery's death
  signal is zero-active-jobs-in-group + `createdAt` >5 min.
- Job-queue invariants (A1): attempt-fenced heartbeat/settle,
  finalize-before-fail, `failSiteAudit` never clobbers terminal parents,
  `system-` is a reserved Schedule namespace, exactly-once-per-slot via
  `@@unique([scheduleId, scheduledFor])`.
- `finalizeSiteAudit` is the single decision point; hook order is
  carry-forward THEN findings — **the findings hook stays LAST** (both
  fire-and-forget; order is invocation-only).
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs
  `SetNull`; subtrees cascade from `CrawlRun` only; never backfill blobs;
  retention INERT until per-tool `PRUNE_ACTIVATED` flips (the ada flip is
  C3's job, same PR as the last blob reader). Read services stay
  scalar/normalized-table only.
- **Quarter-grid invariants (B3/B4/B5):** singleton plan facade; mere
  page-opens never write; push metadata written ONLY by the receipt route.
- **Handoff-token route gotcha (bit us THREE times):** any new token-authed
  route the external skill calls MUST be added to `middleware.ts`
  `isPublicPath` + a `middleware.test.ts` case. (C2's CRUD routes are
  cookie-gated — correctly NOT in the allowlist, pinned by test.)
- Test gotchas: DB-backed test files use their own unique domain/id/name
  prefix AND scope cleanup to tracked ids — never broad `deleteMany` on
  shared tables (Job/Schedule); pre-clean prefixes in `beforeAll`; clean
  `CrawlRun` by domain BEFORE origin rows; vitest jsdom has NO working
  localStorage; `waitFor` can't see fake timers under `globals:false`;
  `queue-manager.test.ts` mocks `standalone-recovery` and neutralizes stray
  transient SiteAudits; `site-audit-finalizer.test.ts` neutralizes
  `carry-forward-checks` (ordering lives in the `.findings` test file).
- **Local dev quirk:** prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — write migration SQL by hand, apply with
  `prisma migrate deploy`. Local dev runs auth-free.
- **Server has no `sqlite3` CLI** — node + Prisma from
  `/home/seo/webapps/seo-tools`. Authenticated prod checks: source the
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
  live scheduled runs end-to-end (tick → wrapper job → audit → score 94 →
  carry-forward → card Δ); weekly canary schedule live on client 31. Next:
  C3 (relational diffing — scope-reconcile against A2/B2 first).
