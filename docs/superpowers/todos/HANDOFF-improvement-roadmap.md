# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-10 · **Updated by:** roadmap setup session
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
   add a status-log line, and rewrite this handoff doc for the next item.
```

## Current state

- **Done:** nothing yet — roadmap docs + tracker created and committed 2026-06-10.
- **In progress:** nothing.
- **Blocked / gated:** Anthropic API billing decision (gates 03 Phase 3);
  DB-growth projection and sitemap miss-rate measurement not yet run.

## Next item

**A1 — Durable job queue + Schedule table** (Track A, `06-platform.md` item 1, 2–2.5 wks)

Why first: it's the spine — C1/C2 (scheduled ADA), D5 (robots monitoring), and
deploy-safe audits all depend on it. Alternative if a quicker win is wanted:
**B1 — Client dashboard MVP** has zero dependencies and ships in 1.5–2 wks.

Key context for A1:
- Hard requirements are listed in `../nyi/improvement-roadmaps/06-platform.md`
  (conditional-update claim, heartbeat + stale recovery, retries via
  `runAfter`, dedupKey idempotency, **no DB transactions across browser
  work**, type-keyed concurrency, single-process assumption).
- Migrate one job type at a time: PSI jobs → PDF scans → site-audit page
  loop → cleanup ticks. Keep the old path behind a flag until parity proven.
- The code being replaced: `lib/ada-audit/lighthouse-queue.ts` (in-memory
  PSI pool), the `processing` mutex in `lib/ada-audit/queue-manager.ts`,
  fire-and-forget dispatch in `lib/ada-audit/pdf-orchestrator.ts`, and most
  of `resetStaleAudits` / `recoverQueue` / orphan-cascade recovery.
- Schema changes go through the normal Prisma migration flow (CLAUDE.md).

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- Findings tables are named `CrawlRun` / `CrawlPage` / `Finding` / `Violation`
  (`CrawlPage`, not `Page` — existing `SessionPage` is derived and will be
  absorbed/retired).
- Dual-write + parity check on 3–5 clients before any reader flips off blobs.
- SSE is a notification layer only, added *after* poller consolidation.
- Codex reviewed all seven roadmap docs (accept-with-fixes; fixes applied
  2026-06-10). Route new specs/plans through Codex per Kevin's standing
  instruction.

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created. No implementation started.
