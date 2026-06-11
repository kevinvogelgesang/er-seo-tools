# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-06-10 · **Updated by:** A2 Phase 2 close-out (PR #57 merged, deployed, production-verified)
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
- **A2 is IN PROGRESS — Phases 1+2 of 4 SHIPPED.**
  - Spec: `../specs/2026-06-10-findings-layer-design.md` (Codex ×10).
    Phase 1 plan: `../plans/2026-06-10-findings-layer-phase1.md` (Codex ×8).
    Phase 2 plan: `../plans/2026-06-10-findings-layer-phase2.md` (Codex ×5).
  - **Phase 1** (PRs #55+#56): 4-table schema, `lib/findings/` (keys,
    seo-mapper, writer, seo-write, parity), parser dual-write, rebuild +
    parity CLIs. PARITY OK on both current-format sessions (nuvani.edu
    146/433/81; proway 4/56/86).
  - **Phase 2** (PR #57, 2026-06-10): ADA dual-write. `ada-mapper.ts`
    (`mapAdaChildren` + `mapAdaSingle`), `ada-write.ts`, finalizer hook
    (fire-and-forget after terminal update + batch close + promoter kick),
    standalone route hook (complete + redirected),
    `compareAdaParity`/`compareAdaSingleParity`, CLI id auto-detect.
    34 new tests; suite 1,787 green; tsc + build clean.
  - **Phase 2 production verification:** boot error-free; rebuild + parity →
    PARITY OK on proway.erstaging.site site audit (24 pages / 2 violations),
    nyinstituteofmassage.com site audit (23 pages incl. 1 redirected child /
    4 violations), and 1 standalone audit. The independent
    Violation-rows-vs-summary.aggregate cross-check passed on both.
  - **Live-hook verification (2026-06-11): DONE for site audits.** Kevin ran
    a fresh www.nyinstituteofmassage.com site audit (23 pages incl. 1
    redirected, 11/11 PDFs, 22/22 LH, 0 errors); the finalizer hook wrote
    the CrawlRun 9 ms after the terminal update (score 88, 4 findings /
    4 violations) and `findings-parity.ts` → **PARITY OK** incl. the
    summary.aggregate cross-check. Still untested live: the standalone
    route hook (same `writeAdaSingleFindings` path that passed via rebuild;
    check one fresh standalone audit during Phase 3 step 1).
- **DB-growth projection: DONE** (2026-06-10, prod). 90-d archive +
  findings-forever safe for human-triggered + weekly volume; nightly fleet
  scans gated on a C2 cadence-aware retention class.
- **Residual checks (non-blocking):** confirm a `cleanup` job completes at
  the 2026-06-11 09:00 UTC slot and terminal Job rows >7 d are pruned (A1
  leftover).
- **Blocked / gated:** Anthropic API billing (gates 03 Phase 3); sitemap
  miss-rate measurement not yet run.

## Next item

**A2 Phase 3 — production parity + cheap flips** (spec § Phasing item 3 +
§ SessionPage absorption). In order:

1. **Production parity on 3–5 representative clients**: fresh parse + fresh
   site audit each (real human-triggered runs through the live hooks, not
   rebuilds), then `npx tsx scripts/findings-parity.ts <id>` for each on the
   server. Include at least one standalone audit and, if available, one site
   audit with a redirected/errored child. Fix any divergences (each fix =
   its own small PR, like #56).
2. **Flip the SessionPage reader**:
   `app/api/seo-parser/[sessionId]/pages/route.ts` (SessionPage's ONLY
   reader) → query `CrawlPage` + page-level `Finding` rows (issueTypes/
   issueCount become a join/group), keeping the response shape identical;
   fall back to `SessionPage` when the session has no `CrawlRun` (pre-A2
   sessions).
3. **Stop writing SessionPage** in the parse route (the model itself drops
   no earlier than 180 d post-flip — out of A2 scope).
4. Phase 3 likely needs only a light plan (the spec section is precise);
   still route it through Codex per the standing instruction.

Then **Phase 4** — `pruneArchivedBlobs()` retention machinery, shipped inert
(per-tool activation constants flip only with each tool's last blob reader).
Then A2 → `[x]`.

## Gotchas / decisions already made (don't relitigate)

- Stack stays: SQLite + single PM2 process + Next.js. No Postgres/Redis/BullMQ.
- **NEVER use interactive `prisma.$transaction(async tx => ...)`** — array
  form only, conditional logic via SQL `EXISTS`, manual `updatedAt =
  Date.now()` in raw statements (2026-06-10 production incident; CLAUDE.md
  "Do not").
- **Findings-layer invariants (from the A2 spec + Phases 1–2):** dual-write
  is best-effort and non-fatal — the legacy blob path must never be affected
  by a findings failure; origin FKs are `SetNull`; subtrees cascade from
  `CrawlRun` only; writer is delete-and-recreate in ONE array-form
  transaction, `createMany` chunked at **50**; exactly-one-origin validated;
  dedup keys are sha256 of canonical JSON (`lib/findings/keys.ts`);
  `Finding.scope` is explicit, never inferred from `pageId`; **never
  backfill historical blobs**; **no reader flips until production parity
  passes on 3–5 clients** (that's this phase's gate — flip only after step 1
  passes).
- **ADA mapping invariants (new, Phase 2):** severity critical/serious →
  `critical`, moderate → `warning`, minor → `notice`; `Violation.impact`
  keeps the exact axe impact with the literal sentinel `'unknown'` for null
  (coalescing to 'minor' would falsify the aggregate cross-check); scores
  are mapper-computed, never read from scalar columns — site runs via
  `computeScoreFromCounts` (violation counts), pages + standalone runs via
  `computeScore` (node-based); malformed result blob on a complete child →
  `score: null`, no findings (never a fake 100); keep-first URL dedupe of
  children, and **every child load that feeds `mapAdaChildren` must use
  `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`** (finalizer,
  `writeAdaSiteFindings`, `compareAdaParity`) or keep-first picks different
  children in different code paths; redirected standalone → CrawlRun
  (`status: 'complete'`) + one redirected CrawlPage, no findings; run is
  `'partial'` iff `pagesError > 0`.
- **SessionPage reader flip (step 2) details from the spec:** response shape
  must stay identical; `SessionPage` fallback for sessions without a
  `CrawlRun`; the `SessionPage` model drop is explicitly out of A2 (lands
  ≥180 d after the flip).
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
  test domain (SetNull orphans); `site-audit-finalizer.test.ts` and
  `site-audit-finalizer.findings.test.ts` use distinct domain prefixes
  (`finalize-test-` / `finalize-findings-`) and both clear `CrawlRun`s.
- **Local dev quirk:** `.env` points at `file:/var/lib/er-seo-tools/db.sqlite`
  (doesn't exist on the Mac). Prefix prisma CLI and vitest with
  `DATABASE_URL="file:./local-dev.db"`. `prisma migrate dev` is
  interactive-only — generate SQL via `prisma migrate diff
  --from-migrations prisma/migrations --to-schema-datamodel
  prisma/schema.prisma --shadow-database-url "file:./shadow-migrate.db"
  --script`, write the folder by hand, apply with `prisma migrate deploy`.
- **Server has no `sqlite3` CLI** — verify production DB state via node +
  Prisma from `/home/seo/webapps/seo-tools` (`bash -lc` for the node PATH).
  `npx tsx` works there for the findings scripts (id type auto-detected:
  session / site audit / standalone ada audit).
- Codex reviews: route new specs/plans through Codex per Kevin's standing
  instruction.

## History

- 2026-06-10 — Roadmap docs (00–06), tracker, and this handoff doc created. No implementation started.
- 2026-06-10 — A1 Phases 0–1 built (job queue core + PSI migration behind flag); PR #50 merged + parity passed; legacy pool deleted.
- 2026-06-10 — A1 Phase 2 (PDF scans) PRs #51/#52 merged + verified after the interactive-transaction SQLite incident (rule now in CLAUDE.md).
- 2026-06-10 — A1 Phase 3 (page loop) PR #53 merged + production-verified (restart mid-`running` resumes).
- 2026-06-10 — A1 Phase 4 (cleanup ticks) PR #54 merged + verified; **A1 COMPLETE.**
- 2026-06-10 — **A2 started.** DB-growth projection run on prod; spec written + Codex-reviewed (×10 fixes); Phase 1 plan written + Codex-reviewed (×8 fixes); Phase 1 built — PR #55.
- 2026-06-10 — **A2 Phase 1 SHIPPED.** PR #55 merged + deployed; production parity surfaced a duplicate-page_index-URL bug → fix PR #56 (keep-first dedupe by normalized URL) merged + deployed. PARITY OK on both current-format sessions (nuvani.edu 146/433, proway 4/56); cross-run SQL queries verified. 1,753 tests green.
- 2026-06-10 — **A2 Phase 2 SHIPPED.** Plan Codex-reviewed (×5 fixes incl. deterministic child ordering + vi.hoisted). PR #57 merged + deployed. ADA mappers/hooks/parity/CLI auto-detect; 34 new tests, suite 1,787 green. Production verification: PARITY OK on 2 site audits (24-page proway; 23-page nyinstituteofmassage incl. redirected child) + 1 standalone. Next: Phase 3 (fresh-run parity on 3–5 clients → SessionPage reader flip).
