# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-21 — SF-retirement **Phase 2 under-expansion fix is CODE-COMPLETE + fully ACCEPTED.** L1+L2+L3 all SHIPPED + DEPLOYED (`8a271c3`), and the **L2 worst-case rendered-BFS memory drill is now DONE — Kevin-accepted PASS** (2026-07-21). No open acceptance items remain on the fix. Remaining Phase-7 work is **(a) monitoring** — the Mon 2026-07-27 sweep (first fleet-wide run on L1+L2+L3) → fleet residuals + N=8 clocks — and **(b) two unbuilt Phase-7 code blockers** (anchor-text capture; graph-signal "ER authority" labeling). · **Updated by:** the L2-drill session.
**Rule:** whoever completes (or advances) a tracker item updates this file *and* the tracker in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. Roadmap spine is otherwise [x]; active work is
the SF-retirement campaign toward Kevin's Phase-7 retirement bar (SET 2026-07-20: N=8 qualifying
weekly seoIntent sweeps / discovery residualMiss ≤ 5% STRICT policy-filtered / fleet-wide /
SF-as-crawler only). Bar + status live in docs/superpowers/todos/2026-07-05-sf-live-parity-log.md
(read the "🎯 2026-07-20 — SF RETIREMENT BAR SET" + "L3" + "2026-07-21 — L2 memory drill" sections).

DONE — the Phase-2 hybrid-crawler under-expansion fix is CODE-COMPLETE, DEPLOYED, and fully ACCEPTED:
  L1 (metric noise filter, PR #235) · L2 (JS-blind rendered-DOM discovery, PR #238/#239) ·
  L3 (raise raw-crawl caps 800/600, PR #241 → 8a271c3). Prod re-measure 2026-07-21: healthcarecareer
  14.9%→0%, beal 6.9%→0.96%, discovery 40.8%→2.37% filtered (all cleared-watch); soma → HARD_CAP
  1000 = sf-required. L2 worst-case memory DRILL: DONE, Kevin-accepted PASS 2026-07-21 — min free
  2224 MB (bar 1400), 0 PM2 restarts; summed tree RSS hit 2889 but that double-counts chrome shared
  pages (PSS peak 1425, used 1692); the rendered BFS is pool-bound (size-4 acquirePage) + subresource-
  blocked, so a triggered BFS is a strict subset of the measured 4-page saturation. cambria + glow both
  no-delta (couldn't force a literal 'triggered' — rendered BFS is a rare fleet path). NO code items left
  on the fix.

NEXT (two tracks toward Phase 7):
  (A) MONITORING — the PRIMARY remaining work. The Mon 2026-07-27 01:00 UTC weekly sweep is the FIRST
  fleet-wide run on L1+L2+L3 (the 2026-07-20 sweep predated all three). After it (read-only prod-DB
  probe): read every client's discoveryCoverageJson.residualMissRate (policy-filtered) + discoverySources
  Json (stoppedBy/renderProbe/renderStoppedBy/discovered vs HARD_CAP). Record fleet residuals in the
  parity log; for each client first reaching ≤5% STRICT, START its N=8 consecutive-weekly-qualifying-sweeps
  clock; label >1000-page / router-only / isolated-cluster clients 'sf-required' (fail-closed, never a
  silent pass). Especially check the 5 JS-blind candidates (cambria/glow/nuvani/brownson/federico) — the
  drill showed cambria+glow no-delta, so confirm whether ANY fleet client's rendered BFS actually triggers —
  and the ~6 under-expanders from cycles 3-4.
  (B) UNBUILT Phase-7 code blockers (buildable now, before the sweep, if you want to advance code):
  anchor-text capture (roadmap pre-Phase-7 prerequisite) and graph-signal "ER authority" labeling +
  consumer acceptance (brief.service.ts still says "Orphaned pages"). Both = full change-control cycles
  (spec → Codex P0 → plan → Codex P0 → TDD → gates → PR → deploy). See the parity log's "Gate criteria
  status against the locked bar" for the full BLOCKING list.

FIRST STEPS: (1) er-seo-tools-multi-agent-coordination pre-flight (vb-* lanes + other sessions share the
checkout — take an isolated worktree for any code work; docs commits too if a session is active). (2) prod
health: source .claude/ops-secrets.local.sh from the MAIN checkout (gitignored, absent in worktrees) →
ssh $PROD_SSH pm2 status + curl /api/health. (3) er-seo-tools-sf-retirement-campaign skill. If it's before
2026-07-27 there's no sweep to read yet — either start a track-(B) code blocker or check the running-audit /
queue state.

OPS: prod DB probes = node + PrismaClient (scp a temp .cjs INTO $APP_HOME so @prisma/client resolves —
NOT /tmp; run node from there; rm after; tsx importing app source hits the 'server-only' guard, so
`new PrismaClient()` directly + replicate raw logic inline). NOTE: discovery provenance fields
discoveryMode/discoveryCapped/discoverySourcesJson live on SiteAudit; discoveryCoverageJson lives on
CrawlRun. Triggering seoIntent audits needs a UI cookie (no autonomous cookie/password in ops-secrets) —
POST /api/site-audit {domain,clientId,seoOnly:true} with -H "Cookie: er_auth=<value>"; seoOnly is render-only
(fast) + forces seoIntent + hybrid. APP_URL is NOT in ops-secrets — use https://seo.erstaging.site. Codex =
gpt-5.6-sol (5h<75% used) else terra, high; spec/plan review = P0, risky-diff pre-merge = P1; run Codex as a
BACKGROUND bash job (foreground times out; even background review jobs have hung ~24min on a tiny diff — cap
your patience, self-verify behavior-preservation). Claude commits (Codex can't). ALWAYS git push before gh pr
merge + verify merged tip + prod source (L2 merge-slip lesson). Background poll monitors get KILLED ~30-60min —
re-launch. Gates are the ONLY type-check gate: npm run lint (tsc) / npm test (vitest — components/viewbook/admin/
ViewbookEditor.test.tsx "copies the public URL…" is a KNOWN parallel-run flake, passes in isolation) / npm run
build (heap-capped, never bare next build) / npm run smoke needs CHROME_EXECUTABLE on macOS. Gate-green deploy +
pm2 restart AUTONOMOUS; destructive/prod-memory-stressing server ops Kevin-gated. STANDING GATE: NO AI API.

NON-BLOCKING carryovers (need a UI-authed session — no autonomous cookie): (a) manual sweep "Queue all" →
WeeklySweep(origin='manual') + /issues manual snapshot, no email, one-in-flight 409; (b) sweep error triage
(PR #227) → dead_page + DeadPagesSection on a 404-bearing client. The Mon 2026-07-27 sweep auto-exercises both.
RESOLVED 2026-07-21: proway.erstaging.site = intentional noindex canary (client 31); sales MethodExplainer
copy honest/OK as-is; D3 robots-validator "URLs" tile mislabels index child-count → docs/superpowers/nyi/
FUTURE-d3-sitemap-url-count-label.md (fix-later). Memory-drill metric lesson: state memory bars in PSS or
MemTotal−MemAvailable, NOT summed process-tree RSS (double-counts chrome shared pages).
```

---

## Current state (one paragraph)

Roadmap spine complete (A/B/C through C21, D0–D8). Active work is the **SF-retirement
campaign, Phase 2 (hybrid discovery)** — the under-expansion fix Kevin's Phase-7 bar gates
on (N=8 / residualMiss ≤ 5% strict policy-filtered / fleet-wide, set 2026-07-20). A 29-domain
prod probe split the blocked clients into **JS-blind** (client-rendered nav), **bound-capped**,
and **metric noise**; the fix was 3 phased increments under one Codex-reviewed spec, and **all
three are SHIPPED + DEPLOYED: L1 (policy-filtered coverage metric, PR #235), L2 (rendered-DOM
adaptive discovery, PR #238/#239), L3 (raise raw-crawl count caps 800/600, PR #241 → `8a271c3`).**
L3's prod re-measure (2026-07-21): **healthcarecareer 14.9%→0%** (direct L3 win), **beal 6.9%→0.96%**,
**discovery 40.8%→2.37% filtered** (L1 win) — all `cleared-watch`; **soma → HARD_CAP 1000 =
`sf-required`**. The **L2 worst-case rendered-BFS memory drill is DONE — Kevin-accepted PASS
(2026-07-21):** at full size-4 browser-pool saturation (rendered-BFS/page-scan + concurrent full-axe
standalone audits) the 3.9 GB prod box held **min free 2224 MB (bar 1400), 0 PM2 restarts**; the
literal `2200` summed-RSS sub-metric was exceeded only because summed RSS double-counts chrome's
shared pages (true footprint PSS ≤1425 MB / used ≤1692 MB), and the rendered BFS is provably
pool-bound + subresource-blocked so a triggered run is a strict subset of the measured peak. cambria
+ glow both `no-delta` (the rendered BFS is a rare/dormant fleet path). Ledger: `2026-07-05-sf-live-
parity-log.md` → "L3 — bound adaptivity" + "2026-07-21 — L2 memory drill: PASS". **No code items
remain on the under-expansion fix.** Remaining toward Phase 7: **(A) monitoring** — the **Mon
2026-07-27 sweep** (first fleet-wide run on L1+L2+L3) → record fleet residuals, start N=8 clocks on
clients reaching ≤5%, label `sf-required` (fail-closed); **(B) two unbuilt Phase-7 code blockers** —
anchor-text capture + graph-signal "ER authority" labeling (see the parity log's gate-criteria list).
Non-blocking UI-authed carryovers (manual-sweep queue-all, sweep error triage) ride the 2026-07-27 sweep.
