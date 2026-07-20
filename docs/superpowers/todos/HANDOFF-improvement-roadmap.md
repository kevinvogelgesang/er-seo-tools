# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-20 (**Sweep Error Triage IMPLEMENTED + MERGED (PR #227)
+ DEPLOYED (migration applied, PM2 healthy). NEXT: Kevin's new feature — a manual
full-cohort scan takes precedence over the weekly sweep on `/issues`.**) ·
**Updated by:** the sweep-error-triage implementation session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE (2026-07-20): the SWEEP
ERROR TRIAGE shipped — implemented (12 TDD tasks), merged (PR #227), deployed
(migration 20260720160000_harvested_page_error applied, PM2 online 0 restarts).
Your job THIS session: the NEW feature Kevin set as next priority —

  A completed MANUAL full-cohort client scan ("queue all") takes precedence over
  the most recent weekly sweep on the /issues page, IF it completed after that
  sweep. Manual queue-alls update /issues SILENTLY (NO email). The Monday support
  email always stays the SUNDAY SCHEDULED sweep's digest.

Kevin's scenario: Sun sweep -> Mon email = Sun sweep. Wed queue-all -> /issues
updates (no email). Fri queue-all -> /issues updates (no email). Sun sweep ->
Mon email = that Sun sweep.

THIS IS A NEW FEATURE -> full pipeline: brainstorm -> spec -> plan -> Codex review
-> TDD build, on its OWN branch/lane (NOT folded into anything). Per Kevin's
standing instruction, run brainstorm->spec->plan ungated (notify him with the file
path as each lands; he stops the flow himself). Take an isolated worktree
(.claude/worktrees/<slug>) after the multi-agent pre-flight.

KEVIN'S DESIGN LEAN (approved 2026-07-20, confirm in brainstorm):
  - A manual full-cohort run produces a WeeklySweep-like snapshot row tagged
    origin:'manual' (same cohort-freeze + computeSweepSnapshot). HARD CONSTRAINT
    (Kevin): REUSE the existing findings/sweep snapshot layer — NO separate
    handoff/token/export path.
  - /issues serves the NEWEST snapshot of ANY origin (manual or scheduled).
  - The sweep-digest job already resolves the SUNDAY sweep by exact-slot lookup,
    so scoping the Monday email to the scheduled sweep is natural — it ignores
    manual snapshots by construction. Verify this holds.
  - OPEN DECISION for the brainstorm: the change-state/streak BASELINE for a
    manual snapshot on /issues. issue-groups.ts today diffs the strict -7d
    predecessor SWEEP (Sunday-to-Sunday, right for the email). Kevin's lean:
    /issues diffs a manual snapshot vs the most recent SCHEDULED sweep (mid-week
    fixes read as "resolved since Sunday"); the email keeps strict Sun-to-Sun.

KEY FACTS TO GROUND THE SPEC (verify in code — lib/sweep + lib/jobs):
  - Today ONLY the `client-sweep` fan-out job creates a WeeklySweep row; a manual
    "queue all" currently makes NO snapshot. So this feature = give a manual
    full-cohort run a snapshot that /issues can serve.
  - WeeklySweep.scheduledFor is @unique (the slot key). A manual snapshot needs
    its own identity that doesn't collide with the Sunday slot.
  - system-client-sweep (weekly:1@01:00 UTC) + system-sweep-digest (weekly:1@14:00
    UTC) in lib/jobs/system-schedules.ts. Digest resolves the sweep by the digest
    job's OWN scheduledFor with setHours(1,0,0,0) server-local.
  - /issues + GET /api/issues serve the newest VALID snapshot (read.ts).
  - The C21 spec/plan are in docs/superpowers/archive/ (weekly-client-sweep-*).

FIRST STEPS:
  1. Multi-agent pre-flight (er-seo-tools-multi-agent-coordination): git worktree
     list; viewbook lanes (vb-*) move fast + touch schema.prisma — if your feature
     needs a schema change, region-check for disjointness (they only touch the
     Viewbook/ViewbookSection models). Take your own worktree.
  2. Confirm prod healthy (source .claude/ops-secrets.local.sh; pm2 restarts ~0).
  3. superpowers:brainstorming FIRST (it's a new feature). Then spec (Codex
     review) -> plan (Codex review) -> TDD build, gate-green, PR, merge, deploy,
     prod-verify, tracker+handoff ritual.

LOOSE END from the triage (do opportunistically, not blocking): the triage's
BEHAVIORAL prod verification is still open — deploy health was verified, but the
full live-scan check (scan a 404-bearing client e.g. healthcarecareercollege.edu
-> confirm no /cdn-cgi/ in the audited set, a dead_page finding + DeadPagesSection
render, null CrawlPage.statusCode, and 'pages-errored' coverage reason) needs a
UI-triggered client scan (no autonomous prod session exists to trigger it). Next
week's sweep (Mon 2026-07-27) auto-exercises the sweep-side unit-map/label changes.

AFTER THIS FEATURE: the SF-parity campaign (er-seo-tools-sf-retirement-campaign)
+ the two campaign-gated [~] items (C6 hybrid-discovery Increment 2; C12 tier
promotions).

KEVIN QUESTIONS STILL OUTSTANDING (non-blocking): (a) proway.erstaging.site
(staging) in the weekly sweep cohort as client 31 — intentional? (b) sales
MethodExplainer beside the SEO-unavailable note (copy call). (c) D3 optional
page-count glance on the next real audit.

WORKTREE + SMOKE GOTCHA (learned this session): `npm run smoke` from a worktree
fails at the single-page audit with ENOENT node_modules/axe-core/axe.min.js —
the runner uses a LITERAL path.join(process.cwd(),'node_modules/...') AXE_PATH
that doesn't resolve upward. Fix: `ln -s ../../../node_modules node_modules` in
the worktree first (gitignored; tsc/test/build don't need it, only the runtime).

PROD ACCESS: source .claude/ops-secrets.local.sh (gitignored). Live paths
/home/seo/... NO sqlite3 CLI on the server — prod DB probes via node + the app's
PrismaClient from $APP_HOME. Gate policy: read-only inspection + gate-green
deploy + pm2 restart autonomous; destructive ops Kevin-gated per conversation.

CODEX MODEL: budget-gated — gpt-5.6-sol when 5h window >25% remaining, else
gpt-5.6-terra; both high effort. This session used terra-high throughout (the
prior session ended ~93% into the 5h window). Launch tandem lanes network-enabled
so Codex can self-verify: codex exec -m gpt-5.6-terra -c model_reasoning_effort=
"high" -s workspace-write -c sandbox_workspace_write.network_access=true. Codex
CANNOT commit (worktree .git is outside its sandbox) — Claude-commits-after-review.

GOTCHAS:
- Local gates are the ONLY type-check gate. Schema changes are hand-authored
  migration SQL (pick a ts LATER than any live lane's migrations); array-form
  $transaction ONLY; DateTime columns are INTEGER ms in raw SQL.
- New cookie-gated routes need NO middleware change; public needs anchored
  matchers + middleware.test.ts.
- Never weaken safeFetch/SSRF guards. lib/seo-fetch is FROZEN — consume only.
- Tests self-provision per-worker SQLite DBs, run PARALLEL; save/restore any env
  a suite sets.
- Never git add -A/-u at repo root. No backticks in Bash -m commit messages.
- UI: dark: variants on every element + the mounted-guard hydration pattern (for
  CLIENT components; server-rendered sections like BrokenLinksSection need none).
- broken-link-verify.characterization.test.ts is FROZEN byte-identical.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.
```

---

## Current state (one paragraph)

Roadmap spine complete: A1-A8, B-series, C-series through **C21 (weekly client
sweep — DEPLOYED + TEST-PROVEN 2026-07-16)**, D0-D7 all [x]; D6 FROZEN [x]. The
**Sweep Error Triage** (Kevin's follow-up from the first-sweep report) is
**SHIPPED** (2026-07-20): all 12 TDD tasks implemented in a Claude+Codex tandem,
merged as PR #227, deployed (migration `20260720160000_harvested_page_error`
applied, PM2 online 0 restarts). It filters `/cdn-cgi/` noise, retries transient
Chrome acquires, reclassifies Location-bearing 3xx as redirected, surfaces dead
404/410 audited URLs as `dead_page` findings (transient `HarvestedPageError`
table → builder → `DeadPagesSection` on results + share), completes the sweep
unit map via `findingUnit`, and makes `pagesError>0` an honest `pages-errored`
partial cause. Deploy health verified; the full behavioral live-scan verification
is the one open loose end (needs a UI-triggered client scan). **NEXT (Kevin-set):
a manual full-cohort scan takes precedence over the sweep on `/issues`** (silent,
no email; reuse the WeeklySweep snapshot layer) — its own brainstorm→spec→plan.
After that: the SF-parity campaign + the two campaign-gated [~] items (C6
hybrid-discovery Increment 2; C12 tier promotions).
