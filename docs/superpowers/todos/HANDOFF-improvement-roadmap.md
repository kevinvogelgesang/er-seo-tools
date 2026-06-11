# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-11 · **Updated by:** B4 close-out (Quarter Grid monolith split shipped)
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

- **A1, A2, B1, B2, B3 are DONE** (durable job queue PRs #50–#54; findings
  layer PRs #55–#58; client dashboard PR #60; findings/action center PR #61;
  Quarter Grid → DB PR #62).
- **B4 is DONE** (Quarter Grid monolith split, PR #63, deployed +
  production-verified 2026-06-11). `app/quarter-grid/page.tsx` is now a
  198-LOC composition; data/persistence live in
  `components/quarter-grid/useQuarterPlan.ts` (B3's init/persist/pagehide
  effects transplanted VERBATIM — skip-first-persist, canPersist gate,
  debounced 800 ms PUT with scheduling-time generation guard), keyboard in
  `usePoolKeyboard.ts`, pure schedule math in `lib/quarter-grid/grid-ops.ts`,
  presentation in `components/quarter-grid/{Chip,GridHeader,LayoutManager,
  WeekGrid,PoolSection,AssignedSection,GanttView,NoteModal}.tsx`. Zero
  behavior change; 53 new tests (suite 1,962 green / 191 files). The B3
  plumbing is finally unit-tested: confirmed-empty-DB page-opens write
  nothing, import success doesn't echo-save, 409 → re-GET, generation guard,
  pagehide keepalive flush.
- **⚠ QUARTER-PLAN IMPORT WINDOW IS NOW CLOSED — KEVIN DECIDES:** production
  has a `QuarterPlan` created **2026-06-11 19:51 UTC** that is near-empty
  (every client in the pool, one client at P4, no weeks/notes). Someone
  opened `/quarter-grid` in a browser WITHOUT the legacy `seo-quarter-v3`
  localStorage and made an edit — the first PUT created the plan, which now
  409-blocks the one-time analyst-browser import. Options: (a) keep the
  near-empty plan and rebuild manually; (b) delete the `QuarterPlan` rows
  server-side (node + Prisma from `/home/seo/webapps/seo-tools` — no sqlite3
  CLI) and re-open `/quarter-grid` in the browser that holds the real
  localStorage → import re-arms and fires. The localStorage backup is never
  written or deleted, so (b) is fully safe.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run.
- **Parked follow-ups (not next items):** `SessionPage` model drop (≥180 d
  after 2026-06-11); `PRUNE_ACTIVATED` flips (same-PR-as-last-blob-reader);
  B2 v1 gaps (multi-domain latest-run-domain-only, URL-level diffing → C3,
  count-increase regressions, 25-URL cap); keyword-orphan score ambiguity;
  client-dashboard "quarter context" card — unblocked by B3's tables,
  **lands with B5**.

## Next item

**B5 — Grid ↔ tools ↔ Teamwork closure** (tracker Track B; roadmap doc
`docs/superpowers/nyi/improvement-roadmaps/04-clients-and-quarter-grid.md`
§ Phase 4, 1–1.5 wks). Three strands: (1) tool completions (scan/roadmap/
memo) can mark progress on the client's grid assignment for the cycle;
(2) "Push cycle to Teamwork" — planned-week assignments become Teamwork
tasks via `Client.teamworkTasklistId` (the er-handoff-memo skill already
proves the Teamwork integration pattern); (3) cascade-protection — deleting
a client should archive, not orphan, its grid state (B3 made both
`QuarterAssignment` FKs cascade; revisit whether delete should soft-archive
instead). Also fold in the parked client-dashboard "quarter context" card
(client's grid status/priority/note/week on `/clients/[id]`, read from
`QuarterPlan`/`QuarterAssignment`). Scope decisions to make at brainstorm
time: which tool events count as "progress", what a Teamwork task looks like
(title/description/due date from week + startDate), one-way push vs sync.
Full flow: brainstorm/spec → Codex → plan → Codex → implement.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **B3/B4 quarter-grid invariants:** the API is a singleton facade (latest
  plan; PUT never creates a second plan; import 409s if any exists).
  Assignment ordering is JS-side (SQLite sorts NULLs first). Mere page-opens
  must never write (skip-first-persist lives in `useQuarterPlan` — set
  BEFORE `setLoaded(true)`; persist-effect deps are exactly
  `[clients, schedule, completed, slotsPerWeek, layouts, startDate, loaded,
  canPersist]`). Failed GET/clients fetches leave `canPersist` false.
  `applyLayout` goes through `sanitizeSnapshotForApply`. localStorage
  `seo-quarter-v3` is read-only legacy: never write it, never delete it.
  `setPriority`/`assignHoveredToFrontier`/`setStatus` must stay stable
  `useCallback`s (usePoolKeyboard's effect deps are `[hoveredPoolChipId]`
  only; memo(Chip) identity).
- **Findings-layer invariants:** dual-write best-effort/non-fatal; origin FKs
  `SetNull`; subtrees cascade from `CrawlRun` only; never backfill blobs;
  retention INERT. Dashboard read services stay scalar/normalized-table only.
- Job-queue invariants are load-bearing (A1 history): attempt-fenced
  heartbeat/settle, finalize-before-fail, `failSiteAudit` never clobbers
  terminal parents, `system-` is a reserved Schedule namespace.
- `finalizeSiteAudit` is the single decision point; findings hook stays LAST.
- Test gotchas: DB-backed test files use their own unique domain/id/name
  prefix; **quarter-plan API tests live in ONE file**
  (`app/api/quarter-plan/route.test.ts`). Clean `CrawlRun` by domain BEFORE
  origin rows. Component tests: `afterEach(cleanup)` (`globals:false`).
  **NEW (B4):** the vitest jsdom environment exposes NO working
  `localStorage` (`window.localStorage` is undefined) — stub an in-memory
  one with `vi.stubGlobal` per test; and testing-library `waitFor` cannot
  detect vitest fake timers under `globals:false` (no `jest` global) — it
  hangs; use an explicit advance-until-condition loop
  (`useQuarterPlan.test.tsx` has the pattern). SSR HTML interleaves
  `<!-- -->` — production curl-greps need tolerant patterns.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — generate SQL via `prisma migrate diff`, write the
  folder by hand, apply with `prisma migrate deploy`. Local dev runs auth-free
  (no `APP_AUTH_PASSWORD` in local `.env` → dev bypass).
- **Server has no `sqlite3` CLI** — verify production DB via node + Prisma
  from `/home/seo/webapps/seo-tools`. Authenticated checks: source the
  server `.env` inside the SSH session and POST `password="$APP_AUTH_PASSWORD"`
  (NEVER extract the password into a local shell arg).
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (registry session for this workspace exists; resume it).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created.
- 2026-06-10 — A1 Phases 0–4 built, merged (PRs #50–#54), production-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), production-verified. **A2 COMPLETE.**
- 2026-06-11 — B1 shipped (PR #60), production-verified. Client command center live.
- 2026-06-11 — B2 shipped (PR #61), production-verified. Findings/action center live.
- 2026-06-11 — B3 shipped (PR #62), production-verified. Quarter Grid state in DB.
- 2026-06-11 — **B4 SHIPPED (PR #63), deployed, production-verified. Quarter
  Grid monolith split; B3 plumbing unit-tested. ⚠ A near-empty QuarterPlan
  was created in prod at 19:51 UTC by a localStorage-less browser edit —
  the one-time import is 409-blocked pending Kevin's keep-or-reset call.**
  Next: B5 (grid ↔ tools ↔ Teamwork closure).
