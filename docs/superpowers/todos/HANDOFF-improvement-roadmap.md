# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-21 — SF-retirement **Phase 2 under-expansion fix is now CODE-COMPLETE: L1 + L2 + L3 all SHIPPED + DEPLOYED.** L3 (bounds) shipped (PR #241 → `8a271c3`) and prod-re-measured: **3/4 clients cleared ≤5%, Soma `sf-required` (>1000 pages).** Remaining work is **monitoring/acceptance, not code**: the Kevin-gated L2 worst-case memory drill, and the Mon 2026-07-27 sweep (first fleet-wide run on L1+L2+L3) → fleet residuals + N=8 clocks. · **Updated by:** the L3 session.
**Rule:** whoever completes (or advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. Roadmap spine is otherwise [x]; active work
is the SF-retirement campaign's Phase-2 hybrid-crawler under-expansion fix — the one thing
Kevin's Phase-7 retirement bar gates on (bar: N=8 qualifying weekly seoIntent sweeps /
discovery residualMiss ≤ 5% STRICT policy-filtered / fleet-wide / SF-as-crawler only).

THE FIX = 3 phased increments; ONE Codex-reviewed spec covers all three:
docs/superpowers/specs/2026-07-20-hybrid-discovery-under-expansion-design.md.
  L1 = metric noise (param/pagination/taxonomy/thank-you/account)  → SHIPPED (PR #235).
  L2 = JS-blind crawler (rendered-DOM adaptive discovery)          → SHIPPED (PR #238/#239).
  L3 = bound hits (large raw-HTML sites)                           → SHIPPED (PR #241, 8a271c3).
**All three are DEPLOYED to prod.** The under-expansion fix is CODE-COMPLETE. What remains is
acceptance + monitoring, below.

DONE — L3 (bound adaptivity): raise HYBRID_CRAWL_MAX_FETCHES 400→800 + HYBRID_CRAWL_MAX_ADDED
300→600 (via extracted testable resolveRawCrawlBounds; time budget + HARD_CAP untouched). Beal
= option (b) (count caps only; freed-budget option-a deferred as a data-gated follow-up — not
needed, beal cleared without it). Codex P0 plan review (7 fixes applied) + P1 self-verified.
Gates green (lint/6792 tests/build/smoke). Deployed 8a271c3, prod source+defaults verified,
health 200/0 restarts. PROD RE-MEASURE 2026-07-21 (authed via Kevin cookie, seoOnly⇒seoIntent):
the Mon 2026-07-20 sweep baselines predated L1+L2+L3, so fresh runs measured all three combined:
  · healthcarecareercollege.edu 14.9%→0%  (direct L3 win: maxAdded 300→600, discovered 330→420)
  · beal.edu                    6.9%→0.96%
  · discoverycommunitycollege.com 40.8%→2.37% filtered (L1 win: raw 40.9% was pagination/param
      noise; sitemap covers content; renderProbe no-delta = NOT JS-blind for content)
  → all 3 cleared ≤5% but 'cleared-watch' (depth/timeBudget-bound, not exhausted) → N=8 clock may start.
  · soma.edu → filled HARD_CAP 1000 (discoveryCapped:true, renderStoppedBy hardCapPrefull) =
      SF-REQUIRED (>1000 pages, masking caveat exactly as predicted; N=8 clock does NOT start).
Ledger: docs/superpowers/todos/2026-07-05-sf-live-parity-log.md → "L3 — bound adaptivity".

** BEFORE new code — the ONE remaining Kevin-gated acceptance item (L2): **
  WORST-CASE MEMORY DRILL (Codex-F1 mandated; still NOT done — the L3 re-measure did NOT exercise
  it, because all 4 L3 clients were renderProbe no-delta/skipped so the full rendered BFS never
  force-triggered). Needs a genuinely JS-BLIND client (cambria/glow/nuvani) whose probe triggers a
  full rendered BFS, run WHILE 2 standalone ADA audits run, sampling TOTAL PROCESS-TREE RSS (node
  parent + ALL chrome descendants; pm2 status MISSES descendants + short peaks) every ~2s for the
  discovery window. PASS = peak tree RSS <2200 MB, ≥1400 MB free, 0 PM2 restarts. Needs a UI cookie
  (no autonomous cookie/password) OR Kevin sign-off to stress the memory-scarred prod box. SHOULD
  precede relying on render-discovery fleet-wide. Fail → lower HYBRID_RENDER_CONCURRENCY / investigate.

THE MONITORING WORK (this is the bulk of what's left toward Phase 7):
  The Mon 2026-07-27 01:00 UTC weekly sweep is the FIRST fleet-wide run on L1+L2+L3 (the 2026-07-20
  sweep predated all three). After it: read every client's discoveryCoverageJson.residualMissRate
  (policy-filtered) + discoverySourcesJson (stoppedBy/renderProbe/renderStoppedBy/discoveredCount vs
  HARD_CAP). Record fleet residuals in the parity log; for each client first reaching ≤5% STRICT,
  START its N=8 consecutive-weekly-qualifying-sweeps clock; label >1000-page / router-only / isolated-
  cluster clients 'sf-required' (fail-closed, never a silent pass). Especially check the 5 JS-blind
  clients (cambria/glow/nuvani/brownson/federico) — does L2's rendered BFS trigger + clear them? — and
  the ~6 under-expanders from cycles 3-4. This is a read-only prod-DB-probe activity per weekly sweep.

FIRST STEPS: (1) er-seo-tools-multi-agent-coordination pre-flight (vb-* lanes share the checkout —
the vb-reading-experience session merged PR #243 mid-L3). (2) prod health: source .claude/ops-secrets.local.sh
from the MAIN checkout (gitignored, absent in worktrees) → ssh $PROD_SSH pm2 status + /api/health. (3)
er-seo-tools-sf-retirement-campaign. Then do the L2 memory drill if Kevin's around, else the monitoring.

OPS: prod DB probes = node + PrismaClient (scp a temp script INTO $APP_HOME so @prisma/client resolves —
NOT /tmp; run node from there; rm after; tsx importing app source hits the 'server-only' guard, so
`new PrismaClient()` directly + replicate raw logic inline). Triggering seoIntent audits needs a UI
cookie (no autonomous cookie/password in ops-secrets) — POST /api/site-audit {domain,clientId,seoOnly:true}
with -H "Cookie: er_auth=<value>"; seoOnly is render-only (fast) + forces seoIntent + hybrid. App host =
seo.erstaging.site. Codex = gpt-5.6-sol (5h<75% used) else terra, high; spec/plan review = P0, risky-diff
pre-merge = P1; run Codex as a BACKGROUND bash job (foreground times out; NB even background review jobs
have hung ~24min on a tiny diff — cap your patience, self-verify behavior-preservation). Claude commits
(Codex can't). ALWAYS git push before gh pr merge + verify merged tip + prod source (L2 merge-slip lesson).
Background poll monitors get KILLED ~30-60min — re-launch; they make progress each round. Gates are the
ONLY type-check gate: npm run lint (tsc) / npm test (vitest — components/viewbook/admin/ViewbookEditor.test.tsx
"copies the public URL…" is a KNOWN parallel-run flake, passes in isolation, unrelated — re-run in isolation
to confirm, don't blanket-ignore) / npm run build (heap-capped, never bare next build) / npm run smoke needs
CHROME_EXECUTABLE on macOS. Gate-green deploy + pm2 restart AUTONOMOUS; destructive/prod-memory-stressing
server ops Kevin-gated. STANDING GATE: NO AI API.

NON-BLOCKING carryovers (need a UI-authed session — no autonomous cookie): (a) manual sweep "Queue all" →
WeeklySweep(origin='manual') + /issues manual snapshot, no email, one-in-flight 409; (b) sweep error triage
(PR #227) → dead_page + DeadPagesSection on a 404-bearing client. The Mon 2026-07-27 sweep auto-exercises both.
RESOLVED 2026-07-21 (were open Kevin questions): proway.erstaging.site = intentional noindex canary (client 31);
sales MethodExplainer copy reviewed, honest/OK as-is; D3 robots-validator "URLs" tile mislabels index child-count
as page count → logged as docs/superpowers/nyi/FUTURE-d3-sitemap-url-count-label.md (fix-later).
```

---

## Current state (one paragraph)

Roadmap spine complete (A/B/C through C21, D0–D8). Active work is the **SF-retirement
campaign, Phase 2 (hybrid discovery)** — the under-expansion fix Kevin's Phase-7 bar gates
on (N=8 / residualMiss ≤ 5% strict policy-filtered / fleet-wide, set 2026-07-20). A 29-domain
prod probe split the blocked clients into **JS-blind** (client-rendered nav), **bound-capped**,
and **metric noise**; the fix is 3 phased increments under one Codex-reviewed spec, and **all
three are now SHIPPED + DEPLOYED: L1 (policy-filtered coverage metric, PR #235), L2 (rendered-DOM
adaptive discovery, PR #238/#239), L3 (raise raw-crawl count caps 800/600, PR #241 → `8a271c3`).**
L3's prod re-measure (2026-07-21, all three increments combined since the Mon 2026-07-20 sweep
baselines predated them): **healthcarecareer 14.9%→0%** (direct L3 win), **beal 6.9%→0.96%**,
**discovery 40.8%→2.37% filtered** (L1 win — sitemap covers content, the 40% was pagination/param
noise) — all three `cleared-watch` (≤5%, depth/time-bound); **soma → HARD_CAP 1000 = `sf-required`**
(>1000 pages, the masking caveat exactly as predicted). Ledger in `2026-07-05-sf-live-parity-log.md`
→ "L3 — bound adaptivity". **Remaining is acceptance + monitoring, not code:** (1) the Kevin-gated
**worst-case rendered-BFS memory drill** on a genuinely JS-blind client (cambria) — still not done
(the L3 clients were all `no-delta`/`skipped`, so the full rendered BFS never fired); (2) the **Mon
2026-07-27 sweep** — the first fleet-wide run on L1+L2+L3 — from which to record fleet residuals,
start N=8 clocks on clients that reach ≤5%, and label `sf-required` clients (fail-closed). Non-blocking
UI-authed carryovers (manual-sweep queue-all, sweep error triage) ride that sweep. Work lives in
worktree `.claude/worktrees/hybrid-discovery-expansion` (branch `docs/l3-shipped` for this ritual;
`feat/hybrid-discovery-L3` merged).
