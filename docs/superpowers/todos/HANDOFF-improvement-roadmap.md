# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-11 · **Updated by:** B2 close-out (findings/action center shipped)
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

- **A1 is DONE** (durable job queue, PRs #50–#54, production-verified).
- **A2 is DONE** (normalized findings layer, PRs #55–#58 + Phase 4 retention
  shipped inert; spec `../archive/specs/2026-06-10-findings-layer-design.md`).
- **B1 is DONE** (client dashboard MVP, PR #60, production-verified
  2026-06-11). `/clients` fleet table, `/clients/[id]` dashboard,
  `/clients/manage` CRUD.
- **B2 is DONE** (findings/action center, PR #61, production-verified
  2026-06-11). The dashboard now has an Open Findings panel (cross-tool,
  type-level run-over-run trends, expandable URL drill-downs capped at 25);
  the fleet table has a sortable Issues column (`openCritical`/`openWarning`
  distinct-type counts) and a purple `regression` alert (new critical types
  vs the previous comparable run). New surface area:
  - `lib/services/findings-shared.ts` — pure helpers: `selectRuns` (current +
    domain-matched previous, id-desc tie-break, keyword exclusion, ADA
    site-class precedence, page-class never gets a previous),
    `aggregateSeoTypes`/`aggregateAdaTypes`/`collapseTypeGroups` (max-severity
    collapse), `diffTypes` (type-level only — by design), `newCriticalTypes`,
    `URLS_PER_FINDING=25`.
  - `lib/services/client-findings.ts` — dashboard read service
    (`getClientFindings`); `client-fleet.ts` now 8 batched queries.
  - `components/clients/FindingsPanel.tsx` — local prop interfaces mirror the
    service types structurally.
  - `computeAlerts` (scorecard-shared) takes required `newCriticalTypes:
    string[]`; `AlertKind` includes `'regression'`.
  - Spec/plan: `../archive/specs/2026-06-11-findings-action-center-design.md`
    · `../archive/plans/2026-06-11-findings-action-center.md` (each Codex ×5).
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run.
- **Parked follow-ups (not next items):**
  - `SessionPage` model drop — ≥180 d after 2026-06-11 (≈ 2026-12).
  - `PRUNE_ACTIVATED` flips — same-PR-as-last-blob-reader rule. B2 added
    ZERO blob readers (the findings tables are the blessed read surface).
  - B2 documented v1 gaps: multi-domain clients show only the latest-run
    domain's findings (per-(tool,domain) grouping deferred); URL-level
    dedupKey diffing deferred to C3; critical-count *increases* don't fire
    regression alerts (new types only); 25-URL cap may want a full-export
    follow-up if analysts ask.
  - Keyword-orphan score ambiguity (B1) — unchanged, fix = stamp workflow on
    `CrawlRun` in a future findings PR.

## Next item

**B3 — Quarter Grid state localStorage → DB** (tracker Track B; roadmap doc
`docs/superpowers/nyi/improvement-roadmaps/04-clients-and-quarter-grid.md`
§ Phase 2, 1–1.5 wks). Schema: `QuarterPlan` (quarter, startDate,
slotsPerWeek, layouts) + `QuarterAssignment` (plan, client FK, week,
priority, status, note, completedAt). One-time importer reads the analyst's
localStorage payload (`seo-quarter-v3`) and writes it to the DB; localStorage
demoted to offline cache at most. Last-write-wins semantics initially. Read
doc 04 Phase 2 AND the current `app/quarter-grid/` page (1,215-LOC monolith —
do NOT split it in B3; that's B4) before speccing. Schema change = migration:
remember the local-dev migration quirk below. Full flow: brainstorm/spec →
Codex → plan → Codex → implement.

Note: B4 (grid component split) is "best after 2" per doc 04 — B3 first is
both tracker order and dependency order.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **Findings-layer invariants:** dual-write is best-effort and non-fatal;
  origin FKs are `SetNull`; subtrees cascade from `CrawlRun` only; never
  backfill historical blobs. Retention is INERT.
- **B1/B2 dashboard invariants:** read services are scalar/normalized-table
  only — adding an origin-BLOB reader to `client-fleet`/`client-dashboard`/
  `client-findings` is a regression against the A2 retention plan. Findings
  reads come from `CrawlRun`/`Finding`/`Violation` (that's the point of A2).
  Keyword runs excluded via session-workflow join. Deep links never dangle
  (origin-expired rows render link-less). Client components define LOCAL
  prop interfaces. B2 diffs are TYPE-level (URL-level lies for
  `parser-sample` types); previous-run shape is type+count only (no
  severity); ADA groupBys carry `scope: 'page'` guards.
- Job-queue invariants are load-bearing (see A1 history): attempt-fenced
  heartbeat/settle, finalize-before-fail, `failSiteAudit` never clobbers
  terminal parents, `system-` is a reserved Schedule namespace.
- `finalizeSiteAudit` is the single decision point; the findings hook stays
  LAST in it.
- Test gotchas: DB-backed test files use their own unique domain/id prefix;
  clean `CrawlRun` by domain BEFORE origin rows (SetNull orphans); the
  one-active guard and promoter are GLOBAL over the shared dev DB. Component
  tests: vitest `globals: false` → testing-library auto-cleanup is OFF; add
  `afterEach(cleanup)` (see `FindingsPanel.test.tsx`). SSR HTML interleaves
  `<!-- -->` between text nodes — production curl-greps need tolerant
  patterns.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — generate SQL via `prisma migrate diff`, write the
  folder by hand, apply with `prisma migrate deploy`.
- **Server has no `sqlite3` CLI** — verify production DB state via node +
  Prisma from `/home/seo/webapps/seo-tools`. Authenticated page checks:
  `curl -c jar -X POST localhost:3000/api/auth/login -F password=…`
  (password in the server `.env`, `AUTH_PASSWORD`).
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (registry session for this workspace exists; resume it).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created.
- 2026-06-10 — A1 Phases 0–4 built, merged (PRs #50–#54), production-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), production-verified. **A2 COMPLETE.**
- 2026-06-11 — B1 shipped (PR #60), production-verified. Client command center live.
- 2026-06-11 — **B2 SHIPPED (PR #61), production-verified. Findings/action
  center live on dashboard + fleet.** Next: B3 (Quarter Grid → DB).
