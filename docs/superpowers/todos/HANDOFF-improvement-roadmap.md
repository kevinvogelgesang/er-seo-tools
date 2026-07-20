# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-20 (**Manual full-cohort sweep → /issues IMPLEMENTED +
MERGED (PR #231) + DEPLOYED (migration `20260721000000_manual_sweep_origin`
applied, PM2 online 0 restarts). NEXT: the SF-parity campaign + the two
campaign-gated `[~]` items.**) · **Updated by:** the manual-sweep implementation session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE (2026-07-20): the MANUAL
FULL-COHORT SWEEP → /issues feature shipped — implemented (12 TDD tasks), merged
(PR #231 `a4685d5`), deployed (migration 20260721000000_manual_sweep_origin
applied, PM2 online 0 restarts, clean boot, HTTP 307). "Queue all clients" now
runs a true full ADA+SEO sweep of every registered domain, freezes a
WeeklySweep(origin='manual') row, and refreshes /issues silently (NO email) on
drain; the Monday support email stays the Sunday scheduled digest. Reused the
existing WeeklySweep/computeSweepSnapshot layer (only additive schema =
WeeklySweep.origin + a partial in-flight-manual unique index).

Your job THIS session: pick up the next roadmap item —

  THE SF-PARITY CAMPAIGN (er-seo-tools-sf-retirement-campaign) + the two
  campaign-gated [~] items: (1) C6 hybrid-discovery Increment 2 PROD-VERIFY
  (needs an authed seoIntent audit on a high-miss client, Kevin's er_auth
  cookie); (2) C12 tier promotions (topic-overlap ONNX re-enable is gated on
  the child-process embed-worker follow-up — see CLAUDE.md broken-link-verify
  note). START by invoking the `er-seo-tools-sf-retirement-campaign` skill — it
  owns the campaign's state, parity method, and next concrete step. If that
  campaign is a research/parity task rather than a code feature, follow its
  methodology (measure SF-vs-live parity per client, log the numbers); if it
  surfaces a concrete build, run the full brainstorm→spec→plan→TDD loop on its
  own branch/worktree.

FIRST STEPS:
  1. Multi-agent pre-flight (invoke er-seo-tools-multi-agent-coordination): git
     worktree list; other Claude/Codex sessions may share this checkout; the
     viewbook (vb-*) lanes move fast + touch schema.prisma but only the
     Viewbook/ViewbookSection models. Take your OWN worktree for any feature work.
  2. Confirm prod healthy (source .claude/ops-secrets.local.sh; ssh $PROD_SSH
     pm2 status → seo-tools online, restarts ~0).
  3. Invoke er-seo-tools-sf-retirement-campaign (and, for a new code feature,
     superpowers:brainstorming FIRST). Then spec (Codex review) → plan (Codex
     review) → TDD build, gate-green, PR, merge, deploy, prod-verify,
     tracker+handoff ritual.

TWO OPEN BEHAVIORAL PROD-VERIFICATIONS (non-blocking; both need a UI-triggered
authed session — no autonomous prod session has Kevin's cookie):
  (a) MANUAL SWEEP (this session): click "Queue all clients" in the authed UI →
      confirm a WeeklySweep(origin='manual') row is created + a manual-sweep job
      runs → after the cohort's audits finish, /issues shows the manual snapshot
      (origin label "Manual refresh", streak label suppressed, delta "vs last
      Sunday") with NO email sent, and the Monday digest still reflects the
      Sunday scheduled sweep. The partial index enforces one-in-flight (a second
      "Queue all" while one runs → 409). Compute-on-drain latency ≤10 min after
      the LAST audit finishes (folded into stale-audit-reset).
  (b) SWEEP ERROR TRIAGE (prior session, PR #227): scan a 404-bearing client
      (e.g. healthcarecareercollege.edu) → no /cdn-cgi/ in the audited set, a
      dead_page finding + DeadPagesSection render, null CrawlPage.statusCode,
      'pages-errored' coverage reason. The Mon 2026-07-27 sweep auto-exercises
      the sweep-side unit-map/label changes for BOTH features.

KEVIN QUESTIONS STILL OUTSTANDING (non-blocking): (a) proway.erstaging.site
(staging) in the weekly sweep cohort as client 31 — intentional? (b) sales
MethodExplainer beside the SEO-unavailable note (copy call). (c) D3 optional
page-count glance on the next real audit.

WORKTREE SETUP GOTCHAS (a fresh worktree is NOT self-contained):
- `.env`/`.env.local` are gitignored → copy `.env` from the main checkout into
  the worktree so `prisma migrate deploy`/`generate` and the dev server have a
  DATABASE_URL. (Do NOT copy `.env.local` — it points at the prod DB path.)
- `npm run smoke` needs `ln -s ../../../node_modules node_modules` in the
  worktree (the runner's absolute AXE_PATH doesn't resolve upward). tsc/test/
  build work via the node_modules symlink too — create it early.
- `npx prisma generate` writes into the SHARED node_modules/.prisma (symlinked);
  it reflects YOUR worktree schema. Low-risk while other lanes touch disjoint
  models, but re-generate from the right schema if in doubt.

PROD ACCESS: source .claude/ops-secrets.local.sh (gitignored). Live DB path
file:/home/seo/data/seo-tools/db.sqlite. NO sqlite3 CLI on the server — prod DB
probes via node + the app's PrismaClient (write the script to a temp file + scp;
inline ssh quoting mangles nested quotes). Gate policy: read-only inspection +
gate-green deploy + pm2 restart AUTONOMOUS; destructive ops Kevin-gated per
conversation.

CODEX MODEL: budget-gated — gpt-5.6-sol when the 5h window has >25% remaining
(5h used <75%), else gpt-5.6-terra; both high effort. This session used sol-high
throughout (5h ~64-68% used). Spec/plan review = P0 (always route); pre-merge
`codex exec review` of risky diffs (jobs/findings/schema/auth/recovery) = P1,
run network-enabled so the sandbox build/test pass works:
  codex exec review --base origin/main -c model='"gpt-5.6-sol"' \
    -c model_reasoning_effort='"high"' \
    -c sandbox_workspace_write.network_access=true
Codex CANNOT commit (worktree .git outside its sandbox) — Claude commits after review.

GOTCHAS:
- Local gates are the ONLY type-check gate (npm run lint = tsc; npm test =
  vitest; npm run build = next build WITH the build-heap cap — never bare
  `npx next build`). Schema changes are hand-authored migration SQL (pick a ts
  LATER than any live lane's migrations, re-check `ls prisma/migrations | tail`
  at build time); array-form $transaction ONLY; DateTime columns are INTEGER ms
  in raw SQL; Prisma partial indexes live in migration SQL only (schema.prisma
  can't express them).
- New cookie-gated routes need NO middleware change; public needs anchored
  matchers + middleware.test.ts.
- logError takes a RECORD context, never a string: logError({subsystem,scope}, err).
- Env ints via parsePositiveInt(process.env.X, fallback) from @/lib/jobs/config
  (never Number(env)||fallback — accepts negatives).
- Tests that create an unsnapshotted manual WeeklySweep MUST clear it in
  beforeEach — the partial unique index makes a leftover row fail the next
  test's create (test-isolation lesson from this session).
- Never weaken safeFetch/SSRF guards. lib/seo-fetch is FROZEN — consume only.
- Tests self-provision per-worker SQLite DBs, run PARALLEL; save/restore any env
  a suite sets. A far-future slot range per test file avoids scheduledFor
  @unique collisions across sweep suites (retention +60y, digest/client-sweep
  +10y, read +70y — mind the day-offset span when adding a case).
- Never git add -A/-u at repo root. No backticks in Bash -m commit messages.
- UI: dark: variants on every element + the mounted-guard hydration pattern (for
  CLIENT components; server-rendered sections need none).
- broken-link-verify.characterization.test.ts is FROZEN byte-identical.

STANDING GATE: NO AI API — all AI stays the pat_/srt_/krt_/kst_/cat_/qct_
clipboard flow.
```

---

## Current state (one paragraph)

Roadmap spine complete: A1-A8, B-series, C-series through **C21 (weekly client
sweep — DEPLOYED + TEST-PROVEN 2026-07-16)**, D0-D7 all [x]; D6 FROZEN [x]. The
**Sweep Error Triage** shipped 2026-07-20 (PR #227, deployed; behavioral
live-scan verification still open — see prod-verify (b) above). The **Manual
full-cohort sweep → /issues** feature shipped 2026-07-20 (PR #231, deployed):
"Queue all clients" now runs a full ADA+SEO sweep-equivalent over every
registered domain, freezes a `WeeklySweep(origin='manual')` row, and refreshes
`/issues` silently on drain (no email); it takes precedence over the last
scheduled sweep, while the Monday support email stays the Sunday scheduled digest
(both the digest exact-slot lookup and the −7d baseline hardened to
`origin='scheduled'`). Reused the existing WeeklySweep/computeSweepSnapshot layer
verbatim (Kevin's hard constraint); the only schema change is additive
`WeeklySweep.origin` + a partial one-in-flight-manual unique index. Built via the
full brainstorm→spec(Codex ×15)→plan(Codex ×14)→12-task TDD→Codex branch-review
(×2 P2) loop; gates green (738 files / 6727 passing, 1 pre-existing KS-2 flake);
deploy health verified, behavioral verification open (see prod-verify (a) above).
**NEXT: the SF-parity campaign (`er-seo-tools-sf-retirement-campaign`) + the two
campaign-gated `[~]` items — C6 hybrid-discovery Increment 2 prod-verify, and
C12 tier promotions.**
