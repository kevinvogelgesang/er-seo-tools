# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-11 · **Updated by:** A2 Phase 3 close-out (PR #58 merged, deployed, production-verified)
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
  The residual next-day check passed 2026-06-11: the `cleanup` job completed
  at its 09:00 UTC slot (attempts 1) and no terminal Job rows >7 d remain.
- **A2 is IN PROGRESS — Phases 1+2+3 of 4 SHIPPED.**
  - Spec: `../specs/2026-06-10-findings-layer-design.md` (Codex ×10).
    Phase 1 plan: `../plans/2026-06-10-findings-layer-phase1.md` (Codex ×8).
    Phase 2 plan: `../plans/2026-06-10-findings-layer-phase2.md` (Codex ×5).
    Phase 3 plan: `../plans/2026-06-11-findings-layer-phase3.md` (Codex ×4).
  - **Phase 1** (PRs #55+#56): 4-table schema, `lib/findings/`, parser
    dual-write, rebuild + parity CLIs.
  - **Phase 2** (PR #57): ADA dual-write (mappers, finalizer + standalone
    hooks, ADA parity, CLI id auto-detect).
  - **Phase 3** (PR #58, 2026-06-11): fresh-run production parity gate
    PASSED, then the cheap flips. Fresh live-hook runs all PARITY OK:
    4 fresh parses (glowcollegecanada.ca 311 pages, nuvani.edu,
    manhattanschool.edu, proway.erstaging.site — re-uploaded SF exports from
    `~/enrollment-resources/sf-crawls/` through the real upload+parse API),
    4 fresh site audits (glowcollegecanada.ca 290 pages, nuvani.edu 122,
    manhattanschool.edu 67, innovatesalonacademy.com 102 — all 0 errors),
    and 1 fresh standalone ADA audit (innovatesalonacademy.com — that closed
    the last untested live hook). PARITY OK on all 9 runs. Ships: pages reader flipped to `CrawlPage` +
    page-level `Finding` join with `SessionPage` fallback for sessions
    without a `CrawlRun`; parse route no longer writes `SessionPage` rows
    (deleteMany kept); `normalizeFindingUrl` extracted to client-safe
    `lib/findings/normalize-url.ts`; `PageDetailModal` matches normalized
    URLs incl. `groups[*].urls`. 15 new tests (incl. 4 DB-backed proving the
    relation-`_count` orderBy on real SQLite); suite 1,790 green; tsc +
    build clean.
  - **Phase 3 production verification (2026-06-11):** pre/post response
    comparison on the glow session — 0 scalar mismatches, old issueTypes
    always a subset, 105/200 pages richer, total 312→311 (one dup URL
    deduped); `?issueType=duplicate_h1` returns exactly the 38 Finding-backed
    pages (was 0 pre-flip — non-derivable filters now work); legacy session
    without CrawlRun (`029341ef…`) still serves via SessionPage fallback;
    modal fix proven on prod data (root URLs: old logic 0 matches, new logic
    2–4 matches; non-root unchanged 5=5); boot log error-free; restart
    mid-run resumed the in-flight site audit (122 durable jobs).
- **DB-growth projection: DONE** (2026-06-10, prod).
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run.

## Next item

**A2 Phase 4 — retention** (spec § Retention + § Phasing item 4). Ships the
machinery INERT:

1. `pruneArchivedBlobs()` registered in `runCleanup()`: for each tool with
   pruning **activated**, find `CrawlRun`s with `completedAt < now − 90 d`,
   `archivePrunedAt IS NULL`, origin row present → null the origin blob
   (`Session.result` / `AdaAudit.result` / `SiteAudit.summary`), keep all
   scalar columns, set `archivePrunedAt`.
2. Activation is per-tool via code constants (e.g. `PRUNE_ACTIVATED =
   { 'seo-parser': false, 'ada-audit': false }`) that flip **in the same PR
   as that tool's last blob reader** — in A2 both ship `false`.
3. Rows with no `CrawlRun` (pre-A2) are untouched — they expire via the
   existing 180-day session TTL or live on.
4. CLAUDE.md + roadmap updates (document the findings layer in CLAUDE.md
   Key files / Architecture patterns; move the A2 spec + the four phase
   plans to `docs/superpowers/archive/` per the folder taxonomy).
5. Then flip **A2 → `[x]`** in the tracker. (`SessionPage` model drop stays
   a post-A2 follow-up, ≥180 d after the 2026-06-11 flip.)

Phase 4 needs only a light plan; still route it through Codex per the
standing instruction.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **Findings-layer invariants (Phases 1–3):** dual-write is best-effort and
  non-fatal — the legacy blob path must never be affected by a findings
  failure; origin FKs are `SetNull`; subtrees cascade from `CrawlRun` only;
  writer is delete-and-recreate in ONE array-form transaction, `createMany`
  chunked at **50**; exactly-one-origin validated; dedup keys are sha256 of
  canonical JSON (`lib/findings/keys.ts`); `Finding.scope` is explicit;
  **never backfill historical blobs**.
- **Post-flip failure mode (new in Phase 3):** `SessionPage` is no longer
  written, so a session whose findings dual-write fails has NO per-page data
  until `npx tsx scripts/findings-rebuild.ts <sessionId>` is run — watch
  `[findings] dual-write failed` in the logs (0 occurrences so far).
  `normalizeFindingUrl` now lives in `lib/findings/normalize-url.ts`
  (client-safe, no node imports — `keys.ts` re-exports it; don't move it
  back, `PageDetailModal` imports it into the client bundle).
- **ADA mapping invariants (Phase 2):** severity critical/serious →
  `critical`, moderate → `warning`, minor → `notice`; `Violation.impact`
  keeps the exact axe impact with `'unknown'` sentinel for null; scores are
  mapper-computed, never read from scalar columns; malformed result blob on
  a complete child → `score: null`, no findings; keep-first URL dedupe of
  children with `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]` at every
  child load site; redirected standalone → CrawlRun + one redirected
  CrawlPage, no findings; run is `'partial'` iff `pagesError > 0`.
- Job-queue invariants are load-bearing (see A1 history): attempt-fenced
  heartbeat/settle, finalize-before-fail, `failSiteAudit` never clobbers
  terminal parents, `system-` is a reserved code-owned Schedule namespace,
  boot order register → recover → seed → start worker.
- `finalizeSiteAudit` is the single decision point; the Phase-2 findings
  hook lives at its very end, AFTER the terminal update + batch close +
  promoter kick, as `void writeFindingsRun(bundle).catch(log)` — keep it
  last if the finalizer changes.
- Test gotchas: the one-active guard and promoter are GLOBAL over the shared
  dev DB — test files touching promotion neutralize stray audits in
  `clearTestState`; findings tests delete `CrawlRun`s by BOTH origin id AND
  test domain (SetNull orphans); `route.db.test.ts` (pages reader) uses the
  `pages-route-db-test.example` domain.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — generate SQL via `prisma migrate diff`, write the
  folder by hand, apply with `prisma migrate deploy`.
- **Server has no `sqlite3` CLI** — verify production DB state via node +
  Prisma from `/home/seo/webapps/seo-tools` (`bash -lc` for the node PATH);
  ad-hoc scripts must be COPIED INTO the app dir (`scp` + run from there)
  or `require("@prisma/client")` won't resolve. `npx tsx` works there for
  the findings scripts (id type auto-detected). Authenticated API calls:
  log in with `curl -c jar -X POST $BASE/api/auth/login -F password=…`
  (password in the server `.env`); uploads >10 MB must be split into
  multiple `/api/upload` POSTs sharing a `sessionId` (Next middleware body
  cap), and `all_inlinks`/`all_outlinks` SF exports are unparsed — skip them.
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction.

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created.
- 2026-06-10 — A1 Phases 0–4 built, merged (PRs #50–#54), production-verified. **A1 COMPLETE.**
- 2026-06-10 — **A2 started.** DB-growth projection; spec (Codex ×10); Phase 1 (PRs #55+#56) shipped + parity OK on 2 sessions.
- 2026-06-10 — **A2 Phase 2 SHIPPED** (PR #57): ADA dual-write; parity OK on 2 site audits + 1 standalone (rebuild path).
- 2026-06-11 — Phase 2 live-hook parity passed (fresh nyinstituteofmassage site audit, finalizer hook 9 ms after terminal update).
- 2026-06-11 — **A2 Phase 3 SHIPPED** (PR #58): fresh-run parity gate passed (4 live parses + fresh site audits + 1 standalone, all PARITY OK), SessionPage reader flipped (CrawlPage + Finding join, legacy fallback), SessionPage writes stopped, PageDetailModal normalized matching. Production-verified same day. A1 residual cleanup-slot check also passed. Next: Phase 4 (retention, inert).
