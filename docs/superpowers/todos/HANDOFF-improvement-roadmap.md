# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-11 · **Updated by:** B3 close-out (Quarter Grid → DB shipped)
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

- **A1 is DONE** (durable job queue, PRs #50–#54). **A2 is DONE** (findings
  layer, PRs #55–#58 + inert retention). **B1 is DONE** (client dashboard,
  PR #60). **B2 is DONE** (findings/action center, PR #61).
- **B3 is DONE** (Quarter Grid state → DB, PR #62, deployed 2026-06-11,
  server-side production-verified). `QuarterPlan` (singleton-in-practice) +
  `QuarterAssignment` (one row per client; week/position null = pool;
  `completedAt`); `GET/PUT /api/quarter-plan` (last-write-wins full-state
  save) + guarded `POST /api/quarter-plan/import` (409 if any plan exists);
  `lib/quarter-grid/state.ts` (client-safe parse/build/apply/sanitize) +
  `lib/quarter-grid/persist.ts` (conditional raw INSERT…WHERE NOT EXISTS,
  delete-and-recreate in one array-form txn). Page got plumbing-only edits:
  debounced 800 ms PUT (scheduling-time generation guard), pagehide
  keepalive flush, `canPersist` gate, **skip-first-persist guard (mere
  page-opens never write)**, sanitized `applyLayout`, save indicator.
  localStorage is read once by the importer, never written again.
  Spec/plan: `../archive/specs/2026-06-11-quarter-grid-db-design.md` (Codex
  ×7) · `../archive/plans/2026-06-11-quarter-grid-db.md` (Codex ×3).
- **⚠ ONE HUMAN STEP OUTSTANDING (Kevin):** open `/quarter-grid` in the
  browser that holds the real `seo-quarter-v3` localStorage — BEFORE editing
  the grid in any other browser — to fire the one-time import (toast
  "Imported quarter plan from this browser"). Then check a second browser
  shows the same grid. Import window confirmed armed (prod GET →
  `{plan:null}`). If a wrong/empty plan ever gets created first: delete the
  `QuarterPlan` rows (node+Prisma on the server) and re-open in the right
  browser — the localStorage backup is never destroyed.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run.
- **Parked follow-ups (not next items):** `SessionPage` model drop (≥180 d
  after 2026-06-11); `PRUNE_ACTIVATED` flips (same-PR-as-last-blob-reader);
  B2 v1 gaps (multi-domain latest-run-domain-only, URL-level diffing → C3,
  count-increase regressions, 25-URL cap); keyword-orphan score ambiguity
  (stamp workflow on `CrawlRun` in a future findings PR); client-dashboard
  "quarter context" card — now unblocked by B3's tables, lands with B5.

## Next item

**B4 — Quarter Grid monolith split** (tracker Track B; roadmap doc
`docs/superpowers/nyi/improvement-roadmaps/04-clients-and-quarter-grid.md`
§ Phase 3, 1 wk). Break the now-1,365-LOC `app/quarter-grid/page.tsx` into a
`useQuarterPlan` data hook (load/save/derive — the B3 init/persist plumbing
moves into it) plus grid/pool/chip/layout-manager components and keyboard
handling. **No behavior change** — this is pure structure. The hook gets
unit tests (B3's `canPersist`/skip-first-persist/import logic is currently
untested at the page level — the split is what makes it testable); drag
logic gets isolated. Component-test gotcha: vitest `globals: false` →
testing-library auto-cleanup OFF → `afterEach(cleanup)` (see
`FindingsPanel.test.tsx`). Reuse types from `lib/quarter-grid/state.ts`
(components define LOCAL prop interfaces per B1/B2 convention). Full flow:
brainstorm/spec → Codex → plan → Codex → implement.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **B3 quarter-grid invariants:** the API is a singleton facade (latest plan;
  PUT never creates a second plan; import 409s if any exists). Assignment
  ordering is JS-side (SQLite sorts NULLs first — pool-last is inexpressible
  in Prisma orderBy). Mere page-opens must never write (skip-first-persist);
  failed GET/clients fetches leave `canPersist` false (read-only session).
  `applyLayout` goes through `sanitizeSnapshotForApply` — stale snapshots
  must not resurrect deleted clients. localStorage `seo-quarter-v3` is
  read-only legacy: never write it, never delete it.
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs
  `SetNull`; subtrees cascade from `CrawlRun` only; never backfill blobs;
  retention INERT. Dashboard read services stay scalar/normalized-table only.
- Job-queue invariants are load-bearing (A1 history): attempt-fenced
  heartbeat/settle, finalize-before-fail, `failSiteAudit` never clobbers
  terminal parents, `system-` is a reserved Schedule namespace.
- `finalizeSiteAudit` is the single decision point; findings hook stays LAST.
- Test gotchas: DB-backed test files use their own unique domain/id/name
  prefix; **quarter-plan API tests live in ONE file**
  (`app/api/quarter-plan/route.test.ts`) because the plan is a global
  singleton over the shared dev DB and vitest parallelizes files — keep any
  new quarter-plan API tests in that file. Clean `CrawlRun` by domain BEFORE
  origin rows. Component tests: `afterEach(cleanup)`. SSR HTML interleaves
  `<!-- -->` — production curl-greps need tolerant patterns.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — generate SQL via `prisma migrate diff`, write the
  folder by hand, apply with `prisma migrate deploy`.
- **Server has no `sqlite3` CLI** — verify production DB via node + Prisma
  from `/home/seo/webapps/seo-tools`. Authenticated checks:
  `curl -c jar -X POST localhost:3000/api/auth/login -F password=…` — the
  password env var is **`APP_AUTH_PASSWORD`** in the server `.env` (NOT
  `AUTH_PASSWORD`; B3 burned 10 minutes on this).
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (registry session for this workspace exists; resume it).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created.
- 2026-06-10 — A1 Phases 0–4 built, merged (PRs #50–#54), production-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), production-verified. **A2 COMPLETE.**
- 2026-06-11 — B1 shipped (PR #60), production-verified. Client command center live.
- 2026-06-11 — B2 shipped (PR #61), production-verified. Findings/action center live.
- 2026-06-11 — **B3 SHIPPED (PR #62), deployed, server-side
  production-verified. Quarter Grid state now lives in the DB; one-time
  localStorage import armed, waiting on Kevin's browser.** Next: B4
  (grid monolith split).
