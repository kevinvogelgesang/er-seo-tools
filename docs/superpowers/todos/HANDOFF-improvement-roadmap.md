# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-11 · **Updated by:** B5 close-out (grid ↔ tools ↔ Teamwork closure shipped — Track B complete)
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

- **A1, A2, B1–B5 are DONE** (durable job queue PRs #50–#54; findings layer
  PRs #55–#58; client dashboard #60; findings/action center #61; Quarter Grid
  → DB #62; grid split #63; **grid closure #64 + middleware fix 0b4b5e3,
  deployed + production-verified 2026-06-11**). **Track B is complete.**
- **B5 shipped:** derived tool activity on grid chips (read-time service
  `lib/services/quarter-activity.ts`, `GET /api/quarter-plan/activity`, ⚡
  glyph); qct_ Teamwork push handoff (`lib/quarter-push-token.ts`,
  mint/export/receipt under `/api/quarter-plan/push/`, `PushToTeamworkButton`,
  er-handoff-memo skill v2.1.0 — the skill lives IN this repo at `skills/`
  and is symlinked from `~/.claude/skills/`); client soft-archive
  (`Client.archivedAt`, PATCH `{archived}` + schedule-disable txn, DELETE
  409s `archive_first`, 9-surface active filter sweep incl. `persistPlan`,
  manage-page Archive/Restore UI, grid `removeClient` now archives);
  `QuarterContextCard` on `/clients/[id]`. Suite 2,015 green (197 files).
- **⚠ PENDING HUMAN STEPS (Kevin):**
  1. **B4 quarter-plan decision still open:** prod has a near-empty
     QuarterPlan (created 2026-06-11 19:51 UTC) that 409-blocks the one-time
     analyst-browser localStorage import. Keep it, or delete QuarterPlan rows
     server-side (node + Prisma from `/home/seo/webapps/seo-tools`) and
     re-open `/quarter-grid` in the browser holding `seo-quarter-v3`.
  2. **First real qct_ push not yet exercised** (mint correctly 409s
     `nothing_planned` — the prod plan is all-pool). After (1): assign a
     client to a week, ensure its Teamwork tasklist ID is set, click
     "⇪ Push to Teamwork", paste into Claude. Skill-side edge cases to watch
     on first run: marker dedupe pagination, no-start-date title, receipt
     posts even when created=0. `QUARTER_PUSH_TOKEN_SECRET` is already in the
     server `.env`.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run.
- **Parked follow-ups (not next items):** `SessionPage` model drop (≥180 d
  after 2026-06-11); `PRUNE_ACTIVATED` flips (same-PR-as-last-blob-reader);
  B2 v1 gaps (multi-domain latest-run-domain-only, URL-level diffing → C3,
  count-increase regressions, 25-URL cap); keyword-orphan score ambiguity;
  archived-client name uniqueness (`Client.name @unique` — archive-then-
  recreate-same-name 409s; rename the archived row if it bites).

## Next item

**C1 — ADA orchestration onto the job queue** (tracker Track C; roadmap doc
`docs/superpowers/nyi/improvement-roadmaps/02-ada-audit.md`, 2–3 wks; needs
A1 ✓). **Scope reconciliation required at brainstorm time:** A1 Phases 3–4
already moved the site-audit page loop, PDF scans, PSI, and maintenance ticks
onto the durable queue — re-read the 02 doc against what shipped and spec
only the remainder (likely: standalone single-page ADA audits still run via
the in-process `runAuditInBackground` path in `app/api/ada-audit/route.ts`,
plus whatever C1 lists that A1 didn't absorb). If C1 turns out to be mostly
absorbed, say so in the tracker and move to C2 (scheduled recurring audits +
score-level deltas — note the DB-growth gate: nightly fleet scans need a
cadence-aware retention class first). Alternatively Kevin may prefer
interleave items A3–A7 (route kit, observability floor, SSE, UI primitives,
auth hardening) — the tracker treats those as non-blocking interleaves;
default to C1 unless he redirects. Full flow: brainstorm/spec → Codex → plan
→ Codex → implement.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **Quarter-grid invariants (B3/B4/B5):** singleton plan facade (PUT never
  creates a second plan; import 409s; only the LATEST plan is push-exportable).
  Mere page-opens never write (skip-first-persist + canPersist gate in
  `useQuarterPlan` — persist-effect deps are exactly `[clients, schedule,
  completed, slotsPerWeek, layouts, startDate, loaded, canPersist]`; the B5
  activity fetch and pushMeta are separate state and MUST stay out of that
  list). localStorage `seo-quarter-v3` is read-only legacy. Push metadata
  (`teamworkPushedAt`/`teamworkPushSummary`) is written ONLY by the receipt
  route — never part of `QuarterPlanPayload`. `persistPlan` validates
  clientIds against `archivedAt: null` (server-side archive enforcement).
  Stable callbacks for `usePoolKeyboard` (`setPriority`/`setStatus`/
  `assignHoveredToFrontier`); memo(Chip) — its `activity` prop is a primitive
  string.
- **Soft-archive invariants (B5):** archiving disables schedules (one
  array-form txn); restore does NOT re-enable them. DELETE requires archived
  (409 `archive_first`) — the grid's `removeClient` therefore PATCHes
  `{archived: true}`, never DELETEs. Active-client surfaces filter
  `archivedAt: null`; `findUnique` can't take the filter — use `findFirst`.
  Dashboard/detail reads keep archived clients readable.
- **Handoff-token route gotcha (bit us TWICE — srt_/krt_ era and again in
  B5):** any new token-authed route the external skill calls MUST be added to
  the middleware allowlist in `middleware.ts` (`isPublicPath`) + a
  `middleware.test.ts` case, or the cookie gate 401s before the token
  verifier runs. Mint routes stay cookie-gated. Production smoke: a garbage
  token must return `token_invalid` (route), not `auth_required` (middleware)
  — and that same check proves the token secret is loaded (missing secret →
  500 `token_service_unavailable`).
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs
  `SetNull`; subtrees cascade from `CrawlRun` only; never backfill blobs;
  retention INERT. Dashboard read services stay scalar/normalized-table only
  (B5's activity + quarter services follow this).
- Job-queue invariants are load-bearing (A1 history): attempt-fenced
  heartbeat/settle, finalize-before-fail, `failSiteAudit` never clobbers
  terminal parents, `system-` is a reserved Schedule namespace.
- `finalizeSiteAudit` is the single decision point; findings hook stays LAST.
- Test gotchas: DB-backed test files use their own unique domain/id/name
  prefix; **every test touching the QuarterPlan table lives in ONE file**
  (`app/api/quarter-plan/route.test.ts` — B5 put the push-route AND
  `getClientQuarterContext` tests there for this reason). Clean `CrawlRun`
  by domain BEFORE origin rows. Component tests: `afterEach(cleanup)`
  (`globals:false`); vitest jsdom has NO working localStorage (stub
  in-memory per test); testing-library `waitFor` can't see vitest fake
  timers under `globals:false` — use advance-until-condition loops
  (`useQuarterPlan.test.tsx` has the pattern). SSR HTML interleaves
  `<!-- -->` — production curl-greps need tolerant patterns.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — write migration SQL by hand, apply with
  `prisma migrate deploy`. Local dev runs auth-free (no `APP_AUTH_PASSWORD`).
- **Server has no `sqlite3` CLI** — verify production DB via node + Prisma
  from `/home/seo/webapps/seo-tools`. Authenticated checks: source the
  server `.env` inside the SSH session and POST `password="$APP_AUTH_PASSWORD"`
  (NEVER extract the password into a local shell arg). Token secrets live in
  the server `.env` (not ecosystem.config.js).
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (registry session for this workspace exists; resume it).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created.
- 2026-06-10 — A1 Phases 0–4 built, merged (PRs #50–#54), production-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), production-verified. **A2 COMPLETE.**
- 2026-06-11 — B1 shipped (PR #60), production-verified. Client command center live.
- 2026-06-11 — B2 shipped (PR #61), production-verified. Findings/action center live.
- 2026-06-11 — B3 shipped (PR #62), production-verified. Quarter Grid state in DB.
- 2026-06-11 — B4 shipped (PR #63), production-verified. Grid monolith split.
  ⚠ Near-empty prod QuarterPlan 409-blocks the localStorage import — Kevin's
  keep-or-reset call still open.
- 2026-06-11 — **B5 SHIPPED (PR #64 + middleware fix), deployed,
  production-verified. TRACK B COMPLETE.** Derived activity, qct_ Teamwork
  push, client soft-archive, dashboard quarter card. First real qct_ push
  pending a pushable assignment (see human steps). Next: C1 (scope-reconciled
  against A1) or A3–A7 interleaves.
