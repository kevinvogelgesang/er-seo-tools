# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-10 · **Updated by:** A2 Phase 1 close-out (PRs #55+#56 merged, deployed, production-verified)
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
- **A2 is IN PROGRESS — Phase 1 of 4 SHIPPED** (PRs #55 + #56 merged,
  deployed, production-verified 2026-06-10).
  - Spec: `../specs/2026-06-10-findings-layer-design.md` (Codex-reviewed,
    ×10 fixes applied). Phase 1 plan:
    `../plans/2026-06-10-findings-layer-phase1.md` (Codex ×8, applied).
  - Shipped: `CrawlRun`/`CrawlPage`/`Finding`/`Violation` tables (full
    schema; ADA writes come in Phase 2), `lib/findings/` (keys, seo-mapper,
    writer, seo-write, parity), parser dual-write hook,
    `scripts/findings-rebuild.ts` + `scripts/findings-parity.ts`.
    27 new tests; suite 1,753 green; tsc + build clean.
  - **Production verification:** migration applied cleanly, boot error-free.
    Parity surfaced one real bug (duplicate `page_index` URL under two refs
    on nuvani.edu → `@@unique([runId, url])` violation), fixed in PR #56
    (keep-first dedupe by normalized URL). After the fix: **PARITY OK on
    both current-format sessions** (nuvani.edu 146 pages / 433 findings /
    score 81; proway.erstaging.site 4 pages / 56 findings / score 86), and
    cross-run SQL queries work (severity/scope rollups; "domains with
    broken_pages" via `Finding`+`CrawlRun` join).
  - The live hook (`writeSeoFindings` in the parse route) is the exact code
    path the rebuild script exercised; still, **re-run
    `scripts/findings-parity.ts` after the next real human-triggered parse**
    as a belt-and-braces check.
- **DB-growth projection: DONE** (2026-06-10, prod): DB 309 MB (~249 MB is
  blobs); 27 clients; site audits avg 153 pages; 0.78 violations/page.
  Verdict: 90-d archive window + findings-kept-forever are safe for
  human-triggered + weekly scheduled volume. **Nightly fleet scans are NOT
  safe with these defaults — C2 must add a cadence-aware retention class
  first** (recorded in the tracker's gated decisions).
- **Residual checks (non-blocking):** confirm a `cleanup` job completes at
  the 2026-06-11 09:00 UTC slot and terminal Job rows >7 d are pruned (A1
  leftover).
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run.

## Next item

**A2 continuation.** In order:

1. **Phase 2 — ADA dual-write** (needs its own plan via writing-plans →
   Codex review, then implement): ADA mappers (`mapAdaChildren` from the
   finalizer's already-loaded children, `mapAdaSingle` for standalone
   audits), hooks in `lib/ada-audit/site-audit-finalizer.ts` (AFTER terminal
   update + closeBatchIfDrained + promoter kick, as `void
   write...().catch(log)`; widen the parent select for mapper fields) and
   `app/api/ada-audit/route.ts` (incl. redirected-standalone → run + one
   redirected CrawlPage, no findings), ADA parity (`compareAdaParity`),
   severity mapping critical/serious→critical, moderate→warning,
   minor→notice; scores computed by the mapper (`computeScore`), never read
   from scalar columns. See the spec's "Row mapping" + "Hook points".
2. **Phase 3** — production parity on 3–5 representative clients (fresh
   parse + fresh site audit each), then flip the SessionPage reader
   (`app/api/seo-parser/[sessionId]/pages/route.ts`, with SessionPage
   fallback for pre-A2 sessions) and stop writing SessionPage.
3. **Phase 4** — `pruneArchivedBlobs()` retention machinery, shipped inert
   (per-tool activation constants flip only with each tool's last blob
   reader). Then A2 → `[x]`.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **Findings-layer invariants (new, from the A2 spec):** dual-write is
  best-effort and non-fatal — the legacy blob path must never be affected by
  a findings failure; origin FKs are `SetNull` (findings must survive
  Session TTL deletion at 180 d), subtrees cascade from `CrawlRun` only;
  writer is delete-and-recreate in ONE array-form transaction, `createMany`
  chunked at **50** (bound-variable headroom), exactly-one-origin validated;
  dedup keys are sha256 of canonical JSON (`lib/findings/keys.ts`), never
  raw `type:url` strings; `Finding.scope` is explicit ('run' | 'page') —
  never inferred from `pageId` (page-scope external URLs have `pageId`
  null); page-scope rows carry their issue's
  `affectedComplete`/`affectedSource` flags; URL extraction order is
  affectedUrlRefs → groups[*].urls → sampled issue.urls (deduped);
  `CrawlRun.score` for SEO = `metadata.health_score ??
  computeHealthScore(result)` (fresh blobs do NOT carry health_score);
  **never backfill historical blobs** — the rebuild script is recovery for
  failed dual-writes of new runs only; **no reader flips until production
  parity passes on 3–5 clients**.
- **Test cleanup for findings tests:** delete `CrawlRun`s by BOTH origin id
  AND test domain — SetNull origins orphan runs from origin-id lookups once
  the origin row is deleted.
- Job-queue invariants are load-bearing (see A1 history): attempt-fenced
  heartbeat/settle, finalize-before-fail, `failSiteAudit` never clobbers
  terminal parents, `system-` is a reserved code-owned Schedule namespace,
  Job retention slot-record guard, boot order register → recover → seed →
  start worker.
- Phase 3 (A1) invariants: one-active enforced by the discover claim's
  `NOT EXISTS`; `discoveredUrls`+`pagesTotal` written together; PDFs
  dispatch BEFORE the page settle; `finalizeSiteAudit` is the single
  decision point — the Phase-2 ADA findings hook goes AFTER its terminal
  update + batch close + promoter kick, as fire-and-forget.
- Standalone single-page audits: own POST-driven runner, `ada-audit:<id>`
  PDF groups, NULL `siteAuditId`. Standalone `redirected` runs return early
  without an axe blob — they still get a CrawlRun + one redirected
  CrawlPage, no findings.
- Test gotchas: the one-active guard and promoter are GLOBAL over the shared
  dev DB — test files touching promotion neutralize stray audits in
  `clearTestState`; `system-schedules.test.ts` deletes real `system-*` rows
  in beforeEach AND afterEach.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — generate SQL via `prisma migrate diff
  --from-migrations prisma/migrations --to-schema-datamodel
  prisma/schema.prisma --shadow-database-url "file:./shadow-migrate.db"
  --script`, write the folder by hand, apply with `prisma migrate deploy`
  (this exact flow worked for `20260611014502_findings_layer`).
- **Server has no `sqlite3` CLI** — verify production DB state via node +
  Prisma from `/home/seo/webapps/seo-tools` (`bash -lc` for the node PATH).
  `npx tsx` works there for the findings scripts.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction.

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created. No implementation started.
- 2026-06-10 — A1 Phases 0–1 built (job queue core + PSI migration behind flag); PR #50 merged + parity passed; legacy pool deleted.
- 2026-06-10 — A1 Phase 2 (PDF scans) PRs #51/#52 merged + verified after the interactive-transaction SQLite incident (rule now in CLAUDE.md).
- 2026-06-10 — A1 Phase 3 (page loop) PR #53 merged + production-verified (restart mid-`running` resumes).
- 2026-06-10 — A1 Phase 4 (cleanup ticks) PR #54 merged + verified; **A1 COMPLETE.**
- 2026-06-10 — **A2 started.** DB-growth projection run on prod; spec written + Codex-reviewed (×10 fixes); Phase 1 plan written + Codex-reviewed (×8 fixes); **Phase 1 built — PR #55 open** (4-table schema, lib/findings/, parser dual-write, parity/rebuild CLIs; 1,752 tests green). Next: merge/deploy + production parity, then Phase 2 (ADA dual-write).
- 2026-06-10 — **A2 Phase 1 SHIPPED.** PR #55 merged + deployed; production parity surfaced a duplicate-page_index-URL bug → fix PR #56 (keep-first dedupe by normalized URL) merged + deployed. PARITY OK on both current-format sessions (nuvani.edu 146/433, proway 4/56); cross-run SQL queries verified. 1,753 tests green. Next: Phase 2 (ADA dual-write).
