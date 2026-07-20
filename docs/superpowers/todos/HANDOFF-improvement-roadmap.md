# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-20 — SF-retirement **Phase 2 hybrid-crawler under-expansion
fix: L1 SHIPPED + DEPLOYED + PROD-VERIFIED (PR #235)**. Next = **L2 (rendered-DOM
adaptive discovery — the JS-blind fix)**, then L3 (bounds). · **Updated by:** the L1 session.
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
Root causes (empirical, 29-domain prod probe 2026-07-20):
  1. JS-BLIND crawler (dominant) — raw-HTTP discovery can't see client-rendered nav;
     cambria/glow/nuvani/brownson/federico homepages return 60-120KB HTML but 0
     same-host <a href>. BFS tuning can't help → fixed by L2.
  2. Bound hits (discovery/soma/healthcarecareer/beal) → L3.
  3. Metric noise (param/pagination/taxonomy/thank-you/account URLs) → L1 (done).
Kevin locked: all three levers, phased; L1 = fuller normalization.

DONE — L1 (policy-filtered coverage metric): PR #235 merged, deployed, prod-verified.
residualMissRate now content-only (the gate) + residualMissRateRaw companion +
two-sided attribution. Pure coverage-local change (contentNormalize/classifyExclusion
on the UNTOUCHED shared normalizeCoverageUrl; frozen char test re-pinned additively).
Authoritative fleet re-baseline lands from the Mon 2026-07-27 sweep — RECORD the
filtered per-domain numbers in the parity log (2026-07-05-sf-live-parity-log.md) then.

YOUR JOB: build L2 — rendered-DOM adaptive discovery. Read the spec §L2 (design is
settled + Codex-reviewed — don't re-derive it), then: writing-plans for L2 → Codex P0
review of the plan → TDD build → gates → PR → merge → deploy → PROD MEMORY-VERIFY →
tracker+handoff ritual. Then L3 (bounds). The 5 load-bearing L2 constraints most
likely to bite (all detailed in the spec):
  - CORRECTED seed model: hybridCrawl takes knownUrls (dedup, NEVER fetched) +
    homepage publisher seed + rendered candidates (through robots/filters). Do NOT
    pass the existing discovered set as seeds (they'd bypass robots + waste the render
    budget re-fetching known URLs).
  - ABSOLUTE discovery deadline + cancellable acquirePage (zombie-handler guard) —
    one deadline across all phases; a waiter blocked past it must not leak a pool slot.
  - Extract the SSRF interceptor (shared, not re-copied); abort off-domain main-frame
    redirect BEFORE render; block image/media/font/stylesheet subresources; cap anchors.
  - Adaptive probe triggers on NOVEL admissible rendered URLs vs the raw crawl (not a
    raw-count delta); record probe FAILURE distinctly from no-delta.
  - MEMORY (L2 is the memory-sensitive one; scars: 2026-06-22 build-OOM, 2026-07-16
    verifier crash-loop): BROWSER_POOL_SIZE stays ≤4; discovery runs before this
    audit's page-jobs fan out so the pool is free of THIS audit (worst case =
    render-discovery 2 + a standalone ADA audit 2 = full pool). Prod verify = run
    render-discovery WHILE 2 standalone audits run; record total PROCESS-TREE RSS
    (pm2 status misses Chromium descendants) vs a numeric threshold. Never weaken
    safeFetch/SSRF; lib/seo-fetch is FROZEN; array-form $transaction only.
FAIL-CLOSED: clients no lever can solve (>1000 pages; JS-click/form/router-only
routes with no rendered href; isolated clusters) stay on SF/manual — label it, never
a silent sub-5% pass; their N=8 clock never starts.

WORKTREE: .claude/worktrees/hybrid-discovery-expansion exists (node_modules symlinked,
.env copied). feat/hybrid-discovery-expansion is MERGED — for L2:
`git fetch && git checkout -b feat/hybrid-discovery-L2 origin/main` in that worktree.

FIRST STEPS: (1) er-seo-tools-multi-agent-coordination pre-flight (vb-* lanes + other
sessions may share the checkout). (2) prod health: `source .claude/ops-secrets.local.sh`
from the MAIN checkout (gitignored, absent in the worktree) → `ssh $PROD_SSH pm2 status`.
(3) er-seo-tools-sf-retirement-campaign, then writing-plans for L2.

OPS: prod DB probes = node + PrismaClient (scp a temp script; tsx importing app source
hits the 'server-only' guard when it pulls lib/seo-fetch/fetch.ts — replicate raw logic
inline). Codex = gpt-5.6-sol (5h<75% used) else terra, high; spec/plan review = P0;
run Codex as a BACKGROUND bash job (foreground times out ~2min); Claude commits (Codex
can't). Gates are the ONLY type-check gate: npm run lint (tsc) / npm test (vitest) /
npm run build (heap-capped — never bare next build). Gate-green deploy + pm2 restart
AUTONOMOUS; destructive server ops Kevin-gated. STANDING GATE: NO AI API (skill-handoff
clipboard flow only).

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
campaign, Phase 2 (hybrid discovery)**. Kevin set the Phase-7 retirement bar 2026-07-20
(N=8 / residualMiss ≤ 5% strict / fleet-wide / split gate); this session picked up the
buildable code item it gates on. A 29-domain prod probe overturned the "tune the BFS"
framing — the blocked clients are mostly **JS-blind** (raw-HTTP discovery can't see
client-rendered nav), plus a few bound-capped, plus metric noise; the fix is 3 phased
increments under one Codex-reviewed spec. **L1 (policy-filtered coverage metric) SHIPPED
+ DEPLOYED + PROD-VERIFIED (PR #235)** — `residualMissRate` now content-only with a raw
companion + two-sided attribution; pure coverage-local, shared normalizer untouched,
frozen char test re-pinned additively; spec + plan both Codex P0-reviewed. **NEXT = L2
(rendered-DOM adaptive discovery — the JS-blind fix, memory-sensitive)**, then **L3
(bounds)**; their spec sections are already written + Codex-reviewed, so the next session
writes the L2 *plan* (Codex P0) → TDD → deploy → prod memory-verify. Work lives in
worktree `.claude/worktrees/hybrid-discovery-expansion`; L1 fleet re-baseline lands from
the Mon 2026-07-27 sweep. See `2026-07-05-sf-live-parity-log.md` →
`🔧 2026-07-20 — Hybrid-discovery under-expansion fix`.
