# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-21 — SF-retirement **Phase-7 blocking code item #3 (anchor-text capture) SHIPPED + prod-deployed** (PR #255, main `55365da`, migration `20260721174318_anchor_text_capture` applied; pm2 online 0 restarts; `/api/health` 200). Measurement-only, findings-parity; Codex review clean; frozen characterization/golden byte-identical. Behavioral prod-verify pending the **Mon 2026-07-27** fleet-wide sweep. The **single next action is to DESIGN Phase-7 blocker #4 — graph-signal "ER audited-set authority" labeling + consumer acceptance** (no ready spec/plan yet → brainstorm→spec→plan). Monitoring track (A) opens 2026-07-27. · **Updated by:** the anchor-text implementation session.
**Rule:** whoever completes (or advances) a tracker item updates this file *and* the tracker/parity-log in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools SF-retirement campaign (Phase-7). Roadmap spine is [x]; the Phase-7 bar
is SET (2026-07-20: N=8 qualifying weekly seoIntent sweeps / discovery residualMiss ≤ 5% STRICT
policy-filtered / fleet-wide / SF-as-crawler only). Bar + status live in
docs/superpowers/todos/2026-07-05-sf-live-parity-log.md ("Gate criteria status against the locked bar").

DONE LAST SESSION: Phase-7 blocking code item #3 — anchor-text capture — SHIPPED + prod-deployed
(PR #255, main 55365da, migration 20260721174318_anchor_text_capture applied, pm2 online 0 restarts,
/api/health 200). The live-scan builder now captures <a href> anchor text (nullable HarvestedLink.anchorText,
internal-only) and emits SF's 3 anchor findings (empty_anchor_text / non_descriptive_anchor_text /
single_anchor_variation, >10 gate) on the live-scan CrawlRun; durable CrawlRun.anchorSummaryJson marks
analyzed-vs-legacy; IssueUnit gained 'links'; shared lib/findings/anchor-text-shared.ts keeps the live rule
identical to the SF parser. Measurement-only (no scoreLiveSeo change). Behavioral prod-verify = read a real
client's live-scan CrawlRun anchor findings + anchorSummaryJson AFTER the Mon 2026-07-27 fleet-wide sweep
(read-only Prisma probe — see OPS). Frozen characterization + anchortext golden stayed byte-identical.

YOUR TASK THIS SESSION: DESIGN Phase-7 blocking code item #4 — graph-signal "ER audited-set authority"
labeling + consumer acceptance. This is a DESIGN session (brainstorm → spec → plan), NOT implementation —
there is no ready spec/plan yet. The concrete anchor: the reachability graph (CrawlRun.reachabilityJson,
inlinks/outlinks/orphans/depth) is computed over the ER-AUDITED page set only, but brief.service.ts still
surfaces it as plain "Orphaned pages" / "inlinks" with no "within the pages ER audited" qualification — a
correctness/honesty gap the Phase-7 bar gates on. Scope: (a) relabel the graph signals in every consumer
(brief.service.ts + any pillar/roadmap surface) to make the audited-set boundary explicit, and (b) get
consumer (brief/pillar) sign-off that the qualified signal is analyst-actionable. Follow the user-CLAUDE.md
auto-route: brainstorm → write spec → route to Codex (consulting-codex) → apply named fixes → write plan →
route to Codex → apply fixes → END with /handoff-prep before implementation (do NOT implement this session).

FIRST STEPS: (1) er-seo-tools-multi-agent-coordination pre-flight — the vb-* worktrees + other sessions may
share the checkout; verify origin/main freshness (git rev-list --count HEAD..origin/main) and take a NEW lane
(git worktree add .claude/worktrees/graph-authority-labeling -b feat/graph-authority-labeling origin/main).
The anchor-text lane is DONE (branch docs/anchor-text-shipped exists as the shipped marker; remove its worktree
if still present). (2) Read the parity log §"Gate criteria status" item #4 + grep brief.service.ts for the
graph-signal wording to ground the spec. (3) Brainstorm → spec → plan per the auto-route.

REMAINING PHASE-7 BLOCKERS (each a full change-control cycle; #4 is this session's design target):
  #4 graph-signal "ER authority" labeling + consumer acceptance (brief.service.ts "Orphaned pages")  ← DESIGN NOW
  #5 broken-link false-positive-rate evidence (measure the verifier's FP rate on real targets)
  #6 §7 dashboards/roadmap/Teamwork default-to-live (srt_/qct_ still Session-bound — partly implementation)
Plus TRACK (A) monitoring, which OPENS Mon 2026-07-27: after the fleet-wide sweep lands, record per-client
qualifying status (score / recovery / stability / residualMiss ≤5% strict) + advance the N=8 clocks in the
parity log. Under-expansion fix (L1+L2+L3) is CODE-COMPLETE + ACCEPTED; residuals re-measured at fleet scale.

OPS: prod DB probes = node + PrismaClient (scp a temp .cjs INTO $APP_HOME so @prisma/client resolves — NOT
/tmp; rm after). ssh via `source .claude/ops-secrets.local.sh` from the MAIN checkout (gitignored, absent in
worktrees). Codex = gpt-5.6-sol (5h<75% used) else terra, high; run as a BACKGROUND bash job (foreground times
out; stdin must be /dev/null — verify it's progressing, not hung). Claude commits (Codex can't). ALWAYS git push
before gh pr merge + verify merged tip + prod source. Gates are the ONLY type-check gate (in-build tsc/lint
DISABLED): npm run lint / npm test (inline DATABASE_URL="file:./local-dev.db") / npm run build / npm run smoke
(CHROME_EXECUTABLE on macOS). Gate-green deploy + pm2 restart AUTONOMOUS; destructive/prod-memory-stressing ops
Kevin-gated. STANDING GATE: NO AI API.
```

---

## Current state (one paragraph)

Roadmap spine complete (A/B/C through C21, D0–D8). Active work is the **SF-retirement campaign toward
Kevin's Phase-7 bar** (N=8 / residualMiss ≤ 5% strict policy-filtered / fleet-wide, set 2026-07-20). The
**Phase-2 hybrid-discovery under-expansion fix is CODE-COMPLETE + ACCEPTED** — L1 (policy-filtered coverage,
PR #235) · L2 (rendered-DOM discovery, PR #238/#239) · L3 (raise raw caps 800/600, PR #241 → `8a271c3`), plus
the L2 memory-drill PASS. **Phase-7 blocker #3 (anchor-text capture) SHIPPED + prod-deployed this session**
(PR #255, main `55365da`): the live builder now emits SF's 3 anchor findings from a new nullable
`HarvestedLink.anchorText` aggregated in the existing keyset stream, with a durable `CrawlRun.anchorSummaryJson`
marker and `IssueUnit: 'links'`; `HarvestedLink` dedup/cap + the frozen characterization/golden tests untouched;
measurement-only (no `scoreLiveSeo` change). Remaining toward Phase 7: **(A) monitoring** the Mon 2026-07-27
first-fleet-wide sweep (fleet residuals + N=8 clocks, `sf-required` fail-closed), and blockers **#4 graph-signal
ER-authority labeling (next design target), #5 broken-link FP-rate evidence, #6 default-to-live**
(srt_/qct_ still Session-bound). Ledgers: `2026-07-05-sf-live-parity-log.md` (campaign status of record) + the
campaign skill `er-seo-tools-sf-retirement-campaign`.
