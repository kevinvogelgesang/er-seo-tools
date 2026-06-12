# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-11 · **Updated by:** C1 close-out (standalone ADA audits onto the durable queue — Track C opened)
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

- **A1, A2, B1–B5, C1 are DONE** (durable job queue PRs #50–#54; findings
  layer #55–#58; client dashboard #60; findings/action center #61; Quarter
  Grid → DB #62; grid split #63; grid closure #64; **standalone ADA audits
  durable #65, deployed + production-verified 2026-06-11 incl. restart
  drill**). Track B complete; Track C opened.
- **C1 shipped (scope-reconciled):** A1 had already absorbed ~90% of the
  02-doc's Phase 1; the remainder was the standalone single-page ADA audit
  path. Now: durable `ada-audit` job type (`lib/jobs/handlers/ada-audit.ts`,
  `ADA_AUDIT_CONCURRENCY` default 2), POST awaits enqueue (dedup/group
  `ada-audit:<id>`), `lib/ada-audit/standalone-recovery.ts` (job-group
  liveness + 5-min createdAt guard; covers stale standalone PDF rows) wired
  into `resetStaleAudits()` + `recoverQueue()`. Zero schema/UI changes.
  Suite 2,050 green (201 files).
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
  miss-rate measurement not yet run.
- **Parked follow-ups (not next items):** `SessionPage` model drop (≥180 d
  after 2026-06-11); `PRUNE_ACTIVATED` flips (same-PR-as-last-blob-reader);
  B2 v1 gaps (URL-level diffing → C3 etc.); keyword-orphan score ambiguity;
  archived-client name uniqueness.

## Next item

**C2 — Scheduled recurring audits + score-level deltas** (tracker Track C;
roadmap doc `docs/superpowers/nyi/improvement-roadmaps/02-ada-audit.md`
Phase 2, 1.5–2 wks; needs C1 ✓). Key context for the brainstorm:

- **Scope honestly (the 02 doc's own warning):** run scheduling +
  score-level deltas ONLY. Real run-over-run violation diffing (new /
  resolved / unchanged) needs relational violations and is C3 — don't
  promise regression analysis off blob comparisons. Note B2 already ships
  type-level diffing + `newCriticalTypes` regression chips from the A2
  findings tables — C2's delta surface should build on that, not duplicate it.
- **The generic `Schedule` table already exists** (A1: cadence parsing,
  exactly-once-per-slot tick, `system-*` namespace is RESERVED for
  code-owned rows). Design question: client scan schedules as domain rows
  that seed/own `Schedule` rows (likely), vs a parallel scheduler (NO).
  A scheduled site audit presumably enqueues via the existing
  `queueSiteAuditRequest()` path so the one-active-at-a-time claim holds.
- **DB-growth gate (decided 2026-06-10, recorded in tracker):** nightly
  fleet scans are NOT safe with current retention defaults — C2 must add a
  cadence-aware retention class for scheduled-run artifacts before enabling
  anything nightly. Weekly/monthly human-cadence scans are fine.
- Carry triage checks (`AdaAuditCheck`) forward across runs by dedup key so
  analysts don't re-dismiss the same finding monthly (02-doc Phase 2 bullet).
- This phase is the substrate the Live-SEO MVP rides on (C6) — build once.

Full flow: brainstorm/spec → Codex → plan → Codex → implement.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **Standalone-ADA invariants (C1):** every handler write is fenced by
  `status='running'` + the claim by `siteAuditId: null` — first terminal
  writer wins; zombie attempts no-op. `dispatchPdfScans` BEFORE the complete
  settle (idempotent re-dispatch). AdaAudit/PdfAudit have NO `updatedAt` —
  standalone recovery's death signal is zero-active-jobs-in-group
  (`ada-audit:<id>`, shared with PDF dispatch) + `createdAt` >5 min; the
  threshold only guards the create→enqueue race. A2 dual-write stays
  fire-and-forget LAST. A job-count read error skips the row (never bias
  destructive).
- Job-queue invariants are load-bearing (A1): attempt-fenced
  heartbeat/settle, finalize-before-fail, `failSiteAudit` never clobbers
  terminal parents, `system-` is a reserved Schedule namespace, `Schedule`
  exactly-once-per-slot via `@@unique([scheduleId, scheduledFor])`.
- `finalizeSiteAudit` is the single decision point; findings hook stays LAST.
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs
  `SetNull`; subtrees cascade from `CrawlRun` only; never backfill blobs;
  retention INERT until per-tool `PRUNE_ACTIVATED` flips. Read services stay
  scalar/normalized-table only.
- **Quarter-grid invariants (B3/B4/B5):** singleton plan facade; mere
  page-opens never write; localStorage `seo-quarter-v3` read-only legacy;
  push metadata written ONLY by the receipt route; `persistPlan` validates
  against `archivedAt: null`.
- **Handoff-token route gotcha (bit us THREE times):** any new token-authed
  route the external skill calls MUST be added to `middleware.ts`
  `isPublicPath` + a `middleware.test.ts` case. Production smoke: garbage
  token → `token_invalid` (route), not `auth_required` (middleware).
- Test gotchas: DB-backed test files use their own unique domain/id/name
  prefix; every QuarterPlan-table test lives in
  `app/api/quarter-plan/route.test.ts`; clean `CrawlRun` by domain BEFORE
  origin rows; vitest jsdom has NO working localStorage; `waitFor` can't see
  fake timers under `globals:false`; `queue-manager.test.ts` mocks
  `standalone-recovery` (and neutralizes stray transient SiteAudits) — keep
  that mock when extending it.
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
- 2026-06-11 — **C1 SHIPPED (PR #65), deployed, production-verified incl.
  restart drill (mid-audit `pm2 restart` → job attempt 2 → completed).**
  Scope-reconciled: A1 had absorbed ~90%; the remainder (standalone ADA
  audits + recovery) took ~1 day. Next: C2 (scheduling + score deltas, with
  the cadence-aware-retention gate).
