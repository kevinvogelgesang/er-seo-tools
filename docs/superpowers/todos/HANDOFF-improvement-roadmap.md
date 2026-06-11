# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-11 · **Updated by:** A2 Phase 4 close-out (retention shipped inert — A2 COMPLETE)
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

- **A1 is DONE** (durable job queue, PRs #50–#54, production-verified;
  residual next-day check passed 2026-06-11).
- **A2 is DONE** (normalized findings layer, PRs #55–#58 + Phase 4,
  2026-06-10/11). All four phases shipped and production-verified:
  - **Phase 1** (PRs #55+#56): 4-table schema (`CrawlRun`/`CrawlPage`/
    `Finding`/`Violation`), `lib/findings/`, parser dual-write, rebuild +
    parity CLIs.
  - **Phase 2** (PR #57): ADA dual-write (mappers, finalizer + standalone
    hooks, ADA parity).
  - **Phase 3** (PR #58): fresh-run production parity gate PASSED (9/9 live
    runs PARITY OK), SessionPage reader flipped to `CrawlPage` + `Finding`
    join with `SessionPage` fallback, SessionPage writes stopped.
  - **Phase 4** (2026-06-11): `pruneArchivedBlobs()` 90-d blob retention in
    `lib/findings/retention.ts`, registered in `runCleanup()`, **INERT** —
    `PRUNE_ACTIVATED = { 'seo-parser': false, 'ada-audit': false }`.
    Spec + all four plans archived to `docs/superpowers/archive/`.
  - Docs: spec `../archive/specs/2026-06-10-findings-layer-design.md`;
    CLAUDE.md now documents the layer (Key files + Architecture patterns).
- **DB-growth projection: DONE** (2026-06-10, prod). 90-d archive +
  findings-forever safe for human-triggered volume; nightly fleet scans
  gated on C2 cadence-aware retention.
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run.
- **Parked follow-ups (not next items):**
  - `SessionPage` model drop — ≥180 d after the 2026-06-11 flip (≈ 2026-12),
    only once no non-expired session lacks a `CrawlRun`.
  - `PRUNE_ACTIVATED` flips — each tool's flag flips **in the same PR as that
    tool's last blob reader**. Before flipping `'seo-parser'`: confirm every
    SEO/keyword-research blob reader is gone (report page, exports, shares,
    memo payload builders, rebuild/parity scripts' assumptions). Before
    `'ada-audit'`: same for standalone ADA + site-audit summary readers; note
    site-audit child `AdaAudit.result` blobs are NOT covered by the A2
    machinery — extending to children is that PR's decision (post-C3/C4).

## Next item

**B1 — Client dashboard MVP from existing scalar data** (tracker Track B;
roadmap doc `docs/superpowers/nyi/improvement-roadmaps/04-clients-and-quarter-grid.md`
§ "Phase 1a — read-only dashboard from existing data"). The roadmap spine is
job queue → findings layer → **client command center**; B1 has no Track-A
dependency and 1a needs no new data collection:

- Rebuild `/clients/[id]` as the platform's de-facto home: header (domains,
  seed URLs, Teamwork link), scorecards (latest SEO health / ADA / pillar
  scores with sparkline + delta — all from scalar columns already on
  `Session`/`SiteAudit`/`AdaAudit`), reverse-chron activity timeline linking
  into tool detail views.
- `/clients` index becomes a fleet table (~30 clients × latest scores ×
  alerts — the "Monday morning" screen).
- Findings/action center is **B2** (Phase 1b), a separate later item — now
  unblocked since A2 shipped, but don't fold it into B1.

Unlike Phase 4, this is a real feature: full brainstorming → spec → Codex
review → plan → Codex review → implement flow. Read doc 04's Phase 1
section in full before speccing (it carries UI intent the tracker line
doesn't).

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **Findings-layer invariants:** dual-write is best-effort and non-fatal —
  the legacy blob path must never be affected by a findings failure; origin
  FKs are `SetNull`; subtrees cascade from `CrawlRun` only; writer is
  delete-and-recreate in ONE array-form transaction, `createMany` chunked at
  **50**; exactly-one-origin validated; dedup keys are sha256 of canonical
  JSON (`lib/findings/keys.ts`); `Finding.scope` is explicit; **never
  backfill historical blobs**. Retention is INERT — see parked follow-ups.
- **Post-flip failure mode:** `SessionPage` is no longer written, so a
  session whose findings dual-write fails has NO per-page data until
  `npx tsx scripts/findings-rebuild.ts <sessionId>` is run — watch
  `[findings] dual-write failed` in the logs (0 occurrences so far).
  `normalizeFindingUrl` lives in `lib/findings/normalize-url.ts`
  (client-safe — `PageDetailModal` imports it into the client bundle).
- Job-queue invariants are load-bearing (see A1 history): attempt-fenced
  heartbeat/settle, finalize-before-fail, `failSiteAudit` never clobbers
  terminal parents, `system-` is a reserved code-owned Schedule namespace,
  boot order register → recover → seed → start worker.
- `finalizeSiteAudit` is the single decision point; the findings hook lives
  at its very end, AFTER the terminal update + batch close + promoter kick,
  as `void writeFindingsRun(bundle).catch(log)` — keep it last if the
  finalizer changes.
- Test gotchas: the one-active guard and promoter are GLOBAL over the shared
  dev DB — test files touching promotion neutralize stray audits in
  `clearTestState`; findings tests delete `CrawlRun`s by BOTH origin id AND
  test domain (SetNull orphans); each DB-backed test file uses its own
  unique domain/id prefix.
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
- 2026-06-11 — **A2 Phase 3 SHIPPED** (PR #58): fresh-run parity gate passed (9/9 live runs PARITY OK), SessionPage reader flipped, SessionPage writes stopped. Production-verified same day.
- 2026-06-11 — **A2 Phase 4 SHIPPED — A2 COMPLETE.** `pruneArchivedBlobs()` retention registered in `runCleanup()`, inert (Codex clean accept); CLAUDE.md findings docs; A2 docs archived. Next: B1 (client dashboard MVP).
