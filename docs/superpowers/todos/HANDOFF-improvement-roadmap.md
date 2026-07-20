# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-20 (**SF-RETIREMENT PHASE-7 RETIREMENT BAR SET by Kevin**
— N=8 qualifying weekly sweeps / discovery `residualMiss` ≤ 5% strict / fleet-wide /
split crawler-vs-keyword-joiner gate. Codex correctness review reclassified 3
over-marked criteria → OPEN and corrected the fleet-wide/coverage interaction.
**NEXT (recommended): the hybrid-crawler under-expansion fix** — the single
buildable code item the bar now gates on; C12 topic-overlap is the independent
alternative.) · **Updated by:** the SF-retirement-bar decision session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. STATE (2026-07-20): the SF-RETIREMENT
CAMPAIGN's Phase-7 RETIREMENT BAR IS NOW SET (Kevin's judgment call, this session).
The SF-parity data gate was over-satisfied (cycles 1–4; the weekly sweep now
self-generates parity data — 11 SF-vs-live pairs + 29-client live-vs-live 26/29
reproducibility), so the campaign moved from measurement to Kevin locking the four
Phase-7 policy knobs:
  • N = 8 consecutive QUALIFYING weekly seoIntent sweeps per client (non-null score,
    no recovery-path rescue, stable ±3/timing, AND meets coverage).
  • Discovery coverage residualMiss ≤ 5% STRICT, per run (no capped/blocked escape).
  • Scope FLEET-WIDE (SF stays routine until the whole in-scope fleet clears).
  • SPLIT gate: this retires SF-as-CRAWLER; SF-as-KEYWORD-JOINER (DataForSEO) is a
    separate, deferred gate.
The decision + Codex-reviewed criteria mapping live in
docs/superpowers/todos/2026-07-05-sf-live-parity-log.md → "🎯 2026-07-20 — SF
RETIREMENT BAR SET"; the campaign skill Phase 7 + roadmap §4 are annotated.
Codex (gpt-5.6-sol, extend) reclassified 3 criteria I'd over-marked MET → OPEN
(graph-signal "ER authority" labeling — brief still says "Orphaned pages";
broken-link false-positive-rate never measured; anchor-text capture — a roadmap
pre-Phase-7 prerequisite, still unbuilt), corrected the fleet-wide/per-run-coverage
interaction (an under-expander's N=8 clock starts only AFTER its coverage reaches
≤5%), and stopped an unsupported pre-exclusion of healthcarecareercollege.edu
(non-null score 76 → in-scope). NET: the gate is further from clearing than the raw
data suggested — the long pole is CODE, not the calendar.

Your job THIS session: pick up the next roadmap item. The whole roadmap is otherwise
[x]. Two buildable code tracks exist; ask Kevin which (or take the recommended one):

  (A, RECOMMENDED) HYBRID-CRAWLER UNDER-EXPANSION FIX — the single code item the bar
  Kevin just set now GATES ON. Under fleet-wide + ≤5%-strict, 6 INDEXABLE clients
  currently block the whole-fleet gate: discovery (41% residual — 1287-page frontier
  overrun), cambria (19.5%), brownson (18.1%), federico (14.5%), glow (12.9%), nuvani
  (11.5%) — glow/cambria/nuvani are sitemap-mode "crawler declined to expand". This is
  Phase 2 (hybrid discovery) frontier/depth tuning: extend the capped same-domain BFS
  in lib/ada-audit/sitemap-crawler.ts + the discovery/coverage path so these close to
  ≤5% residual. Memory-sensitive (BROWSER_POOL_SIZE stays ≤4; the 2026-06-22 build-OOM
  + the 2026-07-16 verifier crash-loop are the scars). Full brainstorm→spec(Codex)→
  plan(Codex)→TDD→gate loop on its OWN worktree; discoveryCoverageJson is the falsifiable
  before/after number. START by invoking er-seo-tools-sf-retirement-campaign (Phase 2/3).

  (B, alternative) C12 TOPIC-OVERLAP RE-ENABLE — the ONNX child-process embed-worker
  follow-up (VERIFIER_TOPIC_OVERLAP_ENABLED is DEFAULT OFF; re-enabling needs the ONNX
  memory work first: a child-process embed worker / dispose fencing / chunk-size
  benchmark — see CLAUDE.md broken-link-verify note + the 2026-07-16 status-log entry).
  Independent of the retirement bar. Real memory-sensitive verifier infra (the
  2026-07-16 crash-loop is the cautionary tale) → same full loop, RSS guard +
  broken-link-verify.characterization.test.ts FROZEN as hard constraints.

  Smaller OPEN items feeding the bar (not full features): (c) FREEZE THE IN-SCOPE COHORT
  LEDGER — a read-only prod probe enumerating all ~29 sweep domains with per-domain
  residualMiss / scoreLiveSeo-null? / discoveryCapped + in-scope-vs-carved-out + reason
  (the fleet-wide gate can't be evaluated without it); (d) anchor-text capture; (e)
  graph-signal "ER authority" relabel in brief.service.ts; (f) broken-link FP-rate audit.

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
  (a) MANUAL SWEEP: click "Queue all clients" in the authed UI → confirm a
      WeeklySweep(origin='manual') row + a manual-sweep job → after the cohort's
      audits finish, /issues shows the manual snapshot (origin label "Manual
      refresh", streak label suppressed, delta "vs last Sunday") with NO email
      sent, and the Monday digest still reflects the Sunday scheduled sweep. The
      partial index enforces one-in-flight (a second "Queue all" while one runs →
      409). Compute-on-drain latency ≤10 min after the LAST audit finishes.
  (b) SWEEP ERROR TRIAGE (PR #227): scan a 404-bearing client (e.g.
      healthcarecareercollege.edu) → no /cdn-cgi/ in the audited set, a dead_page
      finding + DeadPagesSection render, null CrawlPage.statusCode, 'pages-errored'
      coverage reason. The Mon 2026-07-27 sweep auto-exercises the sweep-side
      unit-map/label changes for BOTH features.

KEVIN QUESTIONS STILL OUTSTANDING (non-blocking): (a) proway.erstaging.site
(staging) in the weekly sweep cohort — intentional? (also carved out of the
retirement cohort by the noindex→score:null predicate). (b) sales MethodExplainer
beside the SEO-unavailable note (copy call). (c) D3 optional page-count glance on
the next real audit.

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
- A DOCS-ONLY lane (like the bar-set session) needs none of the above — no
  node_modules/.env/prisma; just edit markdown, branch, PR, merge (no deploy).

PROD ACCESS: source .claude/ops-secrets.local.sh (gitignored). Live DB path
file:/home/seo/data/seo-tools/db.sqlite. NO sqlite3 CLI on the server — prod DB
probes via node + the app's PrismaClient (write the script to a temp file + scp;
inline ssh quoting mangles nested quotes). Gate policy: read-only inspection +
gate-green deploy + pm2 restart AUTONOMOUS; destructive ops Kevin-gated per
conversation.

CODEX MODEL: budget-gated — gpt-5.6-sol when the 5h window has >25% remaining
(5h used <75%), else gpt-5.6-terra; both high effort. This session used sol-high
(5h ~71% used). Spec/plan/decision-doc review = P0 (always route); pre-merge
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
- Never weaken safeFetch/SSRF guards. lib/seo-fetch is FROZEN — consume only.
- Tests self-provision per-worker SQLite DBs, run PARALLEL; save/restore any env
  a suite sets. A far-future slot range per test file avoids scheduledFor
  @unique collisions across sweep suites.
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
sweep — DEPLOYED + TEST-PROVEN 2026-07-16)**, D0-D7 all [x]; D6 FROZEN [x]. Shipped
this week and deployed (behavioral prod-verifies still open — see (a)/(b) in the
paste-in prompt): **Sweep Error Triage** (PR #227) and **Manual full-cohort sweep →
/issues** (PR #231). The **SF-parity campaign** advanced 2026-07-20 (autonomous,
read-only): the weekly sweep now auto-generates parity data (cycles 3 & 4, 29 clients
each), the cycle-2→3 live-score drop was root-caused to the C19 recalibration (not a
regression), 26/29 scores reproduced across the two sweeps, and the Phase-1 parity
gate is over-satisfied. **This session set the Phase-7 RETIREMENT BAR** (Kevin's four
locked knobs: N=8 / residualMiss ≤ 5% strict / fleet-wide / split crawler-vs-joiner
gate), routed the decision doc through Codex for a correctness review (extend — 3
over-marked criteria moved to OPEN, fleet-wide/coverage interaction corrected, an
unsupported healthcare pre-exclusion removed), and recorded it in the parity log +
campaign skill Phase 7 + roadmap §4 + this handoff. Docs-only, branch
`docs/sf-retirement-bar`, no deploy. **NEXT:** with the bar set, the campaign's next
*buildable* item is the **hybrid-crawler under-expansion fix** (6 indexable clients
>5% residual now block the fleet-wide gate — recommended), with **C12 topic-overlap
re-enable** as the independent alternative; smaller feeder items are the frozen
in-scope cohort ledger, anchor-text capture, graph-signal relabeling, and the
broken-link false-positive-rate audit. See `2026-07-05-sf-live-parity-log.md` →
`🎯 2026-07-20 — SF RETIREMENT BAR SET`.
