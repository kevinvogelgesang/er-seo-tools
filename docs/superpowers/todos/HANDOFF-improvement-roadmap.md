# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-11 · **Updated by:** B1 close-out (client dashboard MVP shipped)
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
  2026-06-11). `/clients` is now the fleet table (scores × deltas × alerts),
  `/clients/[id]` the client dashboard (header, 3 scorecards with sparklines,
  issue trend, activity timeline), `/clients/manage` the old CRUD page.
  New surface area the next items build on:
  - `lib/services/scorecard-shared.ts` — pure series/delta/alert helpers
    (`buildSeries`, `buildSeoSeries`, `buildAdaSeries`, `computeAlerts`;
    `SCORE_DROP_THRESHOLD=10`, `STALE_DAYS=30`).
  - `lib/services/client-fleet.ts` / `client-dashboard.ts` — scalar-only read
    services (batched findMany + JS aggregation; NO blob reads — keep it that
    way or the A2 `PRUNE_ACTIVATED` flips get pushed out).
  - `components/clients/` — `Scorecard`, `Sparkline`, `FleetTable`,
    `ActivityTimeline`, `ClientHeader`, `IssueTrendCard`.
  - Spec/plan: `../archive/specs/2026-06-11-client-dashboard-mvp-design.md` ·
    `../archive/plans/2026-06-11-client-dashboard-mvp.md`.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run.
- **Parked follow-ups (not next items):**
  - `SessionPage` model drop — ≥180 d after 2026-06-11 (≈ 2026-12).
  - `PRUNE_ACTIVATED` flips — each tool's flag flips in the same PR as that
    tool's last blob reader (see A2 notes in the tracker). B1 added ZERO blob
    readers (verified).
  - Keyword-orphan score ambiguity — once a keyword-research session expires,
    its orphaned `CrawlRun` joins the SEO series (CrawlRun has no workflow
    column). Documented in the B1 spec; proper fix = stamp workflow on
    `CrawlRun` at write time (fold into a future findings PR).
  - Legacy standalone `AdaAudit.score` is 0/119 non-null in prod — the legacy
    fallback path in `buildAdaSeries` is effectively dormant; all ADA scores
    come from `CrawlRun`.

## Next item

**B2 — Findings/action center on the client dashboard** (tracker Track B;
roadmap doc `docs/superpowers/nyi/improvement-roadmaps/04-clients-and-quarter-grid.md`
§ "Phase 1b — findings/action center", 1–1.5 wks). Now unblocked: A2 shipped
the normalized `Finding`/`Violation` tables and B1 shipped the dashboard to
host it. Per doc 04: open-findings panel across tools, issue drill-downs,
regression alerts from scheduled scans surfacing on the fleet table — but note
scheduled scans don't exist yet (C2), so scope the regression-alert slice to
what run-over-run data already supports (`CrawlRun` history per client) and
leave scan-triggered alerting to C2. Read doc 04 Phase 1b AND the A2 spec's
data model before speccing; the dashboard services and `scorecard-shared`
helpers are the integration points. Full flow: brainstorm/spec → Codex →
plan → Codex → implement.

Alternative if Kevin prefers: B3 (Quarter Grid localStorage → DB) is
independent and also unblocked; tracker order says B2 first.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **Findings-layer invariants:** dual-write is best-effort and non-fatal;
  origin FKs are `SetNull`; subtrees cascade from `CrawlRun` only; writer is
  delete-and-recreate in ONE array-form transaction, `createMany` chunked at
  50; never backfill historical blobs. Retention is INERT.
- **B1 dashboard invariants:** read services are scalar-only — adding a blob
  reader to `client-fleet`/`client-dashboard` is a regression against the A2
  retention plan. Timeline renders from ORIGIN rows; scores render from
  `CrawlRun` (orphaned runs = score points without timeline rows). Keyword
  `CrawlRun`s are excluded from the SEO series via the session-workflow join.
  Error alerts come from origin-row statuses (CrawlRun is only
  `complete|partial`). ADA series: scored site-audit points win; else
  page-audit + legacy merge deduped by origin id. Client components define
  LOCAL prop interfaces (don't import server-only service modules).
- Job-queue invariants are load-bearing (see A1 history): attempt-fenced
  heartbeat/settle, finalize-before-fail, `failSiteAudit` never clobbers
  terminal parents, `system-` is a reserved Schedule namespace.
- `finalizeSiteAudit` is the single decision point; the findings hook stays
  LAST in it.
- Test gotchas: DB-backed test files use their own unique domain/id prefix;
  clean `CrawlRun` by domain BEFORE origin rows (SetNull orphans); the
  one-active guard and promoter are GLOBAL over the shared dev DB.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — generate SQL via `prisma migrate diff`, write the
  folder by hand, apply with `prisma migrate deploy`.
- **Server has no `sqlite3` CLI** — verify production DB state via node +
  Prisma from `/home/seo/webapps/seo-tools`; ad-hoc scripts must be COPIED
  INTO the app dir (`scp` + run from there). Authenticated page checks:
  `curl -c jar -X POST localhost:3000/api/auth/login -F password=…`
  (password in the server `.env`).
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction (registry session for this workspace exists; resume it).

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created.
- 2026-06-10 — A1 Phases 0–4 built, merged (PRs #50–#54), production-verified. **A1 COMPLETE.**
- 2026-06-10/11 — A2 Phases 1–4 (PRs #55–#58 + inert retention), production-verified. **A2 COMPLETE.**
- 2026-06-11 — **B1 SHIPPED (PR #60), production-verified. Client command
  center is live.** Next: B2 (findings/action center).
