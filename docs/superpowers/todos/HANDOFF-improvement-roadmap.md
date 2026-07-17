# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-17 (**Sweep Error Triage spec + plan authored and
Codex-reviewed twice, both accept-with-fixes; all fixes applied. PAUSED at
Kevin's request before implementation. NEXT: implement the plan TDD.**) ·
**Updated by:** the sweep-error-triage spec+plan session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE (2026-07-17): the SWEEP
ERROR TRIAGE spec + implementation plan are DONE and Codex-reviewed (both
accept-with-fixes; all fixes applied). Your job THIS session: IMPLEMENT the
plan, TDD, task by task. No new design — the design is settled.

WHERE THE WORK IS: branch feat/sweep-error-triage already exists with the
spec + plan committed, in the worktree
.claude/worktrees/sweep-error-triage.
  - Spec:  docs/superpowers/specs/2026-07-17-sweep-error-triage-design.md
  - Plan:  docs/superpowers/plans/2026-07-17-sweep-error-triage.md  (12 TDD tasks)
READ BOTH IN FULL FIRST. The plan has real code + exact file:line seams per task.

WHAT IT DOES (one cohesive feature-class change, buckets interdependent):
  - Spine: lib/ada-audit/runner-errors.ts classifyRunnerError taxonomy.
  - B2: exclude /cdn-cgi/ paths at discovery + harvest (crawl-exclude.ts).
  - B3: one 750ms retry for transient Chrome acquire (Target.createTarget);
    site-audit-page rethrows ONLY infrastructure-kind.
  - B4: Location-bearing 3xx classified 'redirected' not error (reuse
    normalizeForRedirect; no-progress loop stays an error).
  - B1 (Kevin-approved scope growth): capture dead 404/410 audited URLs into a
    NEW transient HarvestedPageError table (migration) at page-settle, live-scan
    builder emits a 'dead_page' finding (dead-page-mapper.ts) + new
    DeadPagesSection UI (results + share). CrawlPage.statusCode stays NULL for
    dead rows (don't inflate observed coverage).
  - B5: complete the sweep unit map via findingUnit() in finding-type-sets.ts
    (all 11 validation types + dead_page); snapshot.ts delegates.
  - Label fix: pagesError>0 becomes a conservative 'partial' cause in
    classify.ts + honest 'pages-errored' reason in snapshot.ts reasonFor
    (retires the false 'timed-out').

IMPLEMENTATION ORDER (Codex ruling — DO NOT reorder): Task 1 (B2) -> 2 (spine)
-> 3 (B3) -> 4 (B4) -> 5 (provider scope) -> 6-10 (B1: schema, capture, mapper,
builder, UI) -> 11 (B5) -> 12 (label). B1 capture must land AFTER B2/B3/B4 so it
never records noise as a dead_page.

CRITICAL CODEX-CAUGHT POINTS baked into the plan (don't undo them):
  - Task 3: transfer page ownership BEFORE re-acquire (page=null) so a failed
    re-acquire can't double-release + corrupt browser-pool slots. Test with fake
    timers, not a real 750ms wait.
  - Task 7: captureDeadPage runs AFTER the winning settlePage but BEFORE
    finalizeWarn (finalize can enqueue the verifier and race the error row).
  - Task 9: the FROZEN broken-link-verify.characterization.test.ts stays
    byte-identical (empty HarvestedPageError). Add a SEPARATE dead-page test;
    NEVER re-pin the frozen fixture.
  - Task 5: B1/B4 status observation only works in runner-owned-nav modes
    (prod = LIGHTHOUSE_PROVIDER=pagespeed). local mode delegates nav to
    Lighthouse -> documented dev-only limitation, NOT a bug. (Kevin: confirm or
    ask for local-mode parity.)
  - Task 6: pruneHarvestedPageErrors must be wired into runCleanup in
    lib/cleanup.ts (Promise<void> shape), and HarvestedPageError added to the
    recovery OR-set with the crawlRuns:{none:{tool:'seo-parser'}} fence.
  - Task 12: pagesError is a REQUIRED field -> update EVERY PairObservation /
    AuditLoad fixture in lib/sweep/*.test.ts with pagesError:0 or tsc fails.

FIRST STEPS:
  1. Pre-flight (er-seo-tools-multi-agent-coordination): git worktree list;
     the client-viewbook lanes move fast — pull main. The sweep branch may need
     a rebase onto main if main advanced (viewbook edits different files, so
     expect a clean rebase). cd into .claude/worktrees/sweep-error-triage (it
     already exists) — do NOT git worktree add a second one.
  2. Confirm main clean + prod healthy (source .claude/ops-secrets.local.sh;
     queue empty; pm2 restarts ~0).
  3. Load er-seo-tools-change-control + superpowers:executing-plans (or
     subagent-driven-development). Read spec + plan. Implement TDD in order.
  4. Gate-green EVERY merge: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db"
     npm test + npm run build. npm run smoke IS MANDATORY (ADA pipeline touched:
     runner + site-audit-page) — export CHROME_EXECUTABLE=
     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" on macOS.
  5. PR -> merge (gate-green, autonomous) -> deploy (ssh $PROD_SSH "~/deploy.sh";
     the HarvestedPageError migration applies automatically) -> prod-verify
     (plan's post-deploy checklist: scan a client with known sitemap 404s, e.g.
     healthcarecareercollege.edu had 35; confirm no /cdn-cgi/ in the set, a
     dead_page finding + DeadPagesSection, null CrawlPage.statusCode, and on the
     next sweep / manual recompute the 'pages-errored' reason with no
     sweep_unmapped_issue_unit for validation types).
  6. On ship: tracker checkbox + status-log line + rewrite THIS handoff, same
     commit; move spec + plan to docs/superpowers/archive/. End the reply with
     the next paste-in prompt.

AFTER THE TRIAGE SHIPS: the SF-parity campaign resumes
(er-seo-tools-sf-retirement-campaign skill) + the two campaign-gated [~] items
(C6 hybrid-discovery Increment 2; C12 tier promotions).

KEVIN QUESTIONS STILL OUTSTANDING (from the first-sweep report, not blocking the
triage): (a) proway.erstaging.site (staging) in the weekly sweep cohort as
client 31 — intentional? (b) sales MethodExplainer beside the SEO-unavailable
note (copy call). (c) D3 optional page-count glance on the next real audit.

THE REAL WEEKLY SWEEP is untouched by all of this: it fires automatically Mon
2026-07-20 01:00 UTC, digest 14:00 UTC. Needs no babysitting (the 2026-07-16
test run proved it end-to-end). Optional glance at the digest email ~14:00 UTC;
D5's first robots sweep fires 06:30 UTC same morning (in-app "changed" badge;
notify dark for robots alerts). NOTE: the triage will likely NOT be deployed
before Mon 2026-07-20 — that's fine; the first real sweep runs on current prod
and the triage improves subsequent weeks.

VERIFIER-FIX FACTS (shipped 2026-07-16, PR #186): exhausted verifiers write a
terminal placeholder run (lib/findings/exhausted-placeholder.ts); recovery never
re-enqueues one; VERIFIER_TOPIC_OVERLAP_ENABLED DEFAULT OFF (Codex ONNX ruling);
broken-link-verify.characterization.test.ts is FROZEN byte-identical.

PROD ACCESS: source .claude/ops-secrets.local.sh (gitignored). Live paths
/home/seo/... NO sqlite3 CLI on the server — prod DB probes via node + the app's
PrismaClient from $APP_HOME. Gate policy: read-only inspection + gate-green
deploy + pm2 restart autonomous; destructive ops Kevin-gated per conversation.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. NOTE 2026-07-17: the 5h window was ~93% used at
the end of this session — the next session may find it reset (check the budget
guard). Codex session for this repo: 019f2b57 (turns 105).

GOTCHAS:
- Local gates are the ONLY type-check gate. Schema changes are hand-authored
  migration SQL; array-form $transaction ONLY; DateTime columns are INTEGER ms
  in raw SQL.
- New cookie-gated routes need NO middleware change; public needs anchored
  matchers + middleware.test.ts (the triage adds NO new routes).
- Never weaken safeFetch/SSRF guards. lib/seo-fetch is FROZEN — consume only.
- Tests self-provision per-worker SQLite DBs, run PARALLEL; save/restore any env
  a suite sets.
- Never git add -A/-u at repo root. No backticks in Bash -m commit messages.
- UI: dark: variants on every element + the mounted-guard hydration pattern.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.
```

---

## Current state (one paragraph)

Roadmap spine complete: A1-A8, B-series, C-series through **C21 (weekly client
sweep — DEPLOYED + TEST-PROVEN 2026-07-16)**, D0-D7 all [x]; D6 FROZEN [x]. The
**Sweep Error Triage** (Kevin's follow-up from the first-sweep report) has a
committed, twice-Codex-reviewed spec + 12-task TDD plan on branch
`feat/sweep-error-triage`; scope grew to include Bucket 1 (surface dead 404/410
URLs as `dead_page` findings) + honest coverage-reason labels. **This session
stopped at Kevin's request before implementation** — the next session implements
the plan TDD, ships, and archives the docs. After the triage: the two
campaign-gated [~] items (C6 hybrid-discovery Increment 2; C12 tier promotions)
via the SF-retirement parity campaign.
