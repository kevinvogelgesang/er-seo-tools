# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-20 — SF-retirement **Phase 2 under-expansion fix: L2
(rendered-DOM adaptive discovery) SHIPPED + DEPLOYED (PR #238)**. Remaining before L2
acceptance = the **worst-case process-tree RSS drill (Kevin-gated)**. Next code item =
**L3 (bounds)**. · **Updated by:** the L2 session.
**Rule:** whoever completes (or advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. Roadmap spine is otherwise [x]; active
work is the SF-retirement campaign's Phase-2 hybrid-crawler under-expansion fix — the
one code item Kevin's Phase-7 retirement bar gates on (bar: N=8 qualifying weekly
seoIntent sweeps / discovery residualMiss ≤ 5% STRICT / fleet-wide / SF-as-crawler only).

THE FIX = 3 phased increments; ONE Codex-reviewed spec covers all three:
docs/superpowers/specs/2026-07-20-hybrid-discovery-under-expansion-design.md.
  L1 = metric noise (param/pagination/taxonomy/thank-you/account) → DONE (PR #235).
  L2 = JS-blind crawler (rendered-DOM adaptive discovery) → DONE (PR #238), memory-verify pending.
  L3 = bound hits (large raw-HTML sites: healthcarecareer/soma/beal) → YOUR JOB.

DONE — L2 (rendered-DOM adaptive discovery): PR #238 (code) + PR #239 (Codex-P1 fixes
that a merge-slip left out of #238 — always push before gh pr merge; verify the merged
tip) → origin/main 6ed4672, deployed, health-verified (/api/health 200, 0 restarts, 491MB;
prod source confirmed carrying all 4 fixes). Raw-HTTP crawl runs
first (unchanged) → its output = knownUrls; a novelty-based probe renders homepage + ≤2
shallow hubs; if ≥HYBRID_RENDER_PROBE_MIN_NOVEL (5) admissible URLs are novel, a bounded
rendered BFS (hybridCrawl w/ knownKeys dedup-not-fetched, candidates through robots/trap
filters, novel-hub priority) expands; raw+rendered merge by coverage key (mergeCrawlResults).
ONE absolute discovery deadline + cancellable acquirePage (no slot leak); shared
browser-request-guard (SSRF + off-domain-redirect-before-render + subresource block +
anchor cap); v2 discoverySourcesJson + status:'running' persist guards. Codex P0 plan
review (6 fixes) + P1 diff review (blocked → 4 unbounded-await-holds-a-slot fixes → cleared).
New env: HYBRID_RENDER_{MAX_DEPTH 2, MAX_FETCHES 40, MAX_ADDED 300, CONCURRENCY 2,
PROBE_MIN_NOVEL 5, PROBE_MAX_HUBS 2, MAX_ANCHORS_PER_PAGE 1500} (all default-safe, no
prod .env step needed).

** BEFORE anything else — two Kevin-gated L2 acceptance items (do these first if Kevin
is available; they are the only things standing between L2-deployed and L2-accepted): **
  (1) WORST-CASE MEMORY DRILL (Codex-F1 mandated; MUST happen before the Mon 2026-07-27
      sweep runs render-discovery fleet-wide). Needs a UI cookie (no autonomous cookie)
      OR Kevin's sign-off to deliberately load the memory-scarred prod box to its
      4-Chrome ceiling. Runbook: trigger a seoIntent site audit on a JS-blind client
      (cambria) via the UI/authed POST /api/site-audit {seoIntent:true} WHILE 2 standalone
      ADA audits run; on the server sample TOTAL PROCESS-TREE RSS every ~2s for the
      discovery window: e.g.
        ssh $PROD_SSH 'for i in $(seq 1 90); do ps -o rss= --ppid $(pgrep -f "seo-tools") -p $(pgrep -f "seo-tools") 2>/dev/null | awk "{s+=\$1} END{print s/1024\" MB\"}"; sleep 2; done'
      (better: pstree/ps that sums the node parent + ALL chrome descendants — pm2 status
      MISSES Chromium descendants + short peaks). PASS = peak tree RSS <2200 MB, ≥1400 MB
      free, 0 PM2 restarts. Fail → lower HYBRID_RENDER_CONCURRENCY / investigate.
  (2) L2 RESIDUAL RE-MEASURE — after cambria/glow/nuvani/brownson/federico get a
      post-deploy seoIntent audit (the Mon 2026-07-27 sweep does this fleet-wide), read
      each run's discoveryCoverageJson.residualMissRate (policy-filtered) → expect <5% on
      the JS-blind five (probe should trigger; renderedAdded>0). RECORD before/after +
      renderProbe/renderedAdded/renderStoppedBy per client in the parity log
      (2026-07-05-sf-live-parity-log.md). Clients still >5% because >1000 pages /
      router-only / isolated clusters = label 'sf-required' in the log, N=8 clock does
      not start (fail-closed, never a silent pass).

YOUR JOB (code): build L3 — bound adaptivity for large raw-HTML sites (healthcarecareer
maxAdded@300, soma maxFetches@400; beal is time-budget-bound, NOT cap-bound — see Codex
F6). Read spec §L3 (settled + Codex-reviewed). Two parts: (1) raise HYBRID_CRAWL_MAX_FETCHES
400→800 + HYBRID_CRAWL_MAX_ADDED 300→600 with the wave-arithmetic headroom check; (2) keep
stoppedBy/capped honestly reported. Beal: do NOT claim the cap raises help it — either let
a raw-only crawl consume the freed rendered-pass budget under the single deadline (preferred,
option a) or drop beal from L3's expected effect (option b) — decide in the plan. Flow:
writing-plans for L3 → Codex P0 review → TDD → gates → PR → merge → deploy → prod re-measure
→ tracker+handoff ritual.

WORKTREE: .claude/worktrees/hybrid-discovery-expansion exists (node_modules symlinked,
.env copied, prisma/local-dev.db migrated). feat/hybrid-discovery-L2 is MERGED — for L3:
`git fetch && git checkout -b feat/hybrid-discovery-L3 origin/main` in that worktree.

FIRST STEPS: (1) er-seo-tools-multi-agent-coordination pre-flight (vb-* lanes + other
sessions may share the checkout). (2) prod health: `source .claude/ops-secrets.local.sh`
from the MAIN checkout (gitignored, absent in the worktree) → `ssh $PROD_SSH pm2 status`.
(3) er-seo-tools-sf-retirement-campaign, then (do the L2 Kevin-gated items above if he's
around) → writing-plans for L3.

OPS: prod DB probes = node + PrismaClient (scp a temp script; tsx importing app source
hits the 'server-only' guard when it pulls lib/seo-fetch/fetch.ts — replicate raw logic
inline). Codex = gpt-5.6-sol (5h<75% used) else terra, high; spec/plan review = P0,
risky-diff pre-merge review = P1; run Codex as a BACKGROUND bash job (foreground times
out ~2min); Claude commits (Codex can't). Gates are the ONLY type-check gate: npm run
lint (tsc) / npm test (vitest — NOTE: components/viewbook/admin/ViewbookEditor.test.tsx
> "copies the public URL from the secondary masthead action" is a KNOWN parallel-run
flake, passes 12/12 in isolation, unrelated to discovery — don't chase it) / npm run
build (heap-capped — never bare next build). Gate-green deploy + pm2 restart AUTONOMOUS;
destructive/prod-memory-stressing server ops Kevin-gated. STANDING GATE: NO AI API.

NON-BLOCKING carryovers (need a UI-authed session — no autonomous cookie): (a) manual
sweep "Queue all" → WeeklySweep(origin='manual') + /issues manual snapshot, no email,
one-in-flight 409; (b) sweep error triage (PR #227) → dead_page + DeadPagesSection on a
404-bearing client. Mon 2026-07-27 sweep auto-exercises both. Kevin questions:
proway.erstaging.site in the cohort intentional? · sales MethodExplainer copy · D3
page-count glance.
```

---

## Current state (one paragraph)

Roadmap spine complete (A/B/C through C21, D0–D8). Active work is the **SF-retirement
campaign, Phase 2 (hybrid discovery)** — the under-expansion fix Kevin's Phase-7 bar
gates on (N=8 / residualMiss ≤ 5% strict / fleet-wide / split gate, set 2026-07-20). A
29-domain prod probe split the blocked clients into **JS-blind** (raw-HTTP can't see
client-rendered nav — the dominant cause), **bound-capped**, and **metric noise**; the
fix is 3 phased increments under one Codex-reviewed spec. **L1 (policy-filtered coverage
metric) SHIPPED (PR #235). L2 (rendered-DOM adaptive discovery — the JS-blind fix)
SHIPPED + DEPLOYED (PR #238)**: raw crawl first → probe (novel-admissible-URL trigger) →
bounded rendered BFS → merge; one absolute deadline + cancellable `acquirePage`; shared
SSRF/subresource/redirect guard; all memory bounds (`BROWSER_POOL_SIZE`≤4,
`HYBRID_RENDER_CONCURRENCY`=2) Codex-verified through a P0 plan review + a P1 diff review
that initially blocked on 4 unbounded-await-holds-a-Chrome-slot bugs (all fixed → cleared).
Health-verified in prod (200, 0 restarts, 489 MB). **Two L2 acceptance items remain, both
Kevin-gated:** the worst-case process-tree RSS drill (needs a cookie or sign-off to stress
prod; MUST precede the Mon 2026-07-27 sweep) and the residual re-measure on the five
JS-blind clients (lands from that sweep — record in the parity log). **Next code item =
L3 (bounds)** — spec §L3 written + Codex-reviewed, so the next session writes the L3 plan
(Codex P0) → TDD → deploy → prod re-measure. Work lives in worktree
`.claude/worktrees/hybrid-discovery-expansion`. See `2026-07-05-sf-live-parity-log.md` →
`🔧 2026-07-20 — Hybrid-discovery under-expansion fix`.
