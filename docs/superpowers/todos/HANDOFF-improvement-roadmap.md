# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-21 — SF-retirement **Phase-7 blocker #3 (anchor-text capture) now has a Codex-P0-approved spec + implementation plan, ready to build.** The Phase-2 under-expansion fix (L1+L2+L3) stays CODE-COMPLETE + ACCEPTED (`8a271c3`, L2 memory drill PASS). The **single next action is to EXECUTE the anchor-text plan** (branch `feat/anchor-text-capture`, docs-only commits pushed) via subagent-driven TDD → gates → PR → deploy. Monitoring track (A) is still blocked until the **Mon 2026-07-27** first-fleet-wide sweep. · **Updated by:** the anchor-text spec+plan session.
**Rule:** whoever completes (or advances) a tracker item updates this file *and* the tracker/parity-log in the same commit.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools SF-retirement campaign (Phase-7). Roadmap spine is [x]; the Phase-7 bar
is SET (2026-07-20: N=8 qualifying weekly seoIntent sweeps / discovery residualMiss ≤ 5% STRICT
policy-filtered / fleet-wide / SF-as-crawler only). Bar + status live in
docs/superpowers/todos/2026-07-05-sf-live-parity-log.md.

YOUR TASK THIS SESSION: implement Phase-7 blocking code item #3 — anchor-text capture — from the
ready, Codex-P0-approved spec + plan. This is IMPLEMENTATION (TDD execution), not design.
  - Spec:  docs/superpowers/specs/2026-07-21-live-anchor-text-capture-design.md  (Codex ACCEPT +7 fixes, applied)
  - Plan:  docs/superpowers/plans/2026-07-21-live-anchor-text-capture.md         (Codex ACCEPT +8 fixes, applied; 9 TDD tasks)
  - Branch: feat/anchor-text-capture (already on origin, cut off origin/main; docs commits only so far)
  - Worktree: .claude/worktrees/anchor-text-capture (may already exist locally — reuse it)

WHAT IT BUILDS (findings-parity-only, MEASUREMENT-ONLY — no scoreLiveSeo change): the live-scan builder
emits SF's 3 anchor findings (empty_anchor_text / non_descriptive_anchor_text / single_anchor_variation)
from a new nullable HarvestedLink.anchorText, aggregated via a bounded O(1)-per-target reducer folded into
the EXISTING keyset stream in broken-link-verify.ts; a durable CrawlRun.anchorSummaryJson marker
distinguishes analyzed-clean from legacy; IssueUnit gains 'links'; a shared lib/findings/anchor-text-shared.ts
keeps the live rule identical to the SF parser. HARD INVARIANTS (Codex-enforced): HarvestedLink dedup/cap
UNCHANGED; broken-link-verify.characterization.test.ts + anchortext.golden.test.ts stay FROZEN byte-identical;
null anchorText = skip, '' = empty-finding. Rich aggregate stats were REJECTED (unrendered on the SF path).

FIRST STEPS: (1) er-seo-tools-multi-agent-coordination pre-flight (vb-* + other sessions may share the
checkout). The feat/anchor-text-capture lane already exists — reuse .claude/worktrees/anchor-text-capture;
if absent, `git worktree add .claude/worktrees/anchor-text-capture feat/anchor-text-capture` (or re-cut off
origin/main and cherry-pick the 4 docs commits). (2) Plan Task 0: symlink node_modules (../../../node_modules)
+ copy .env (../../../.env, NEVER .env.local) into the worktree — prisma + smoke need both. (3) Execute the
plan task-by-task with superpowers:subagent-driven-development (recommended) or executing-plans. (4) Gate-green
before PR: npm run lint (tsc) / npm test (vitest) / npm run build (heap-capped) / npm run smoke (needs
CHROME_EXECUTABLE on macOS). (5) PR → merge (push first, verify merged tip + prod source) → deploy autonomous.

PROD VERIFY: the Mon 2026-07-27 fleet-wide sweep auto-exercises the harvest → read a real client's live-scan
CrawlRun anchor findings + anchorSummaryJson (read-only Prisma probe). No manual scan needed, but if you want
an earlier check, trigger a seoIntent scan (needs a UI cookie — none autonomous): POST /api/site-audit
{domain,clientId,seoOnly:true} -H "Cookie: er_auth=<value>" to https://seo.erstaging.site.

OPS: prod DB probes = node + PrismaClient (scp a temp .cjs INTO $APP_HOME so @prisma/client resolves — NOT
/tmp; rm after). ssh via `source .claude/ops-secrets.local.sh` from the MAIN checkout (gitignored, absent in
worktrees). Codex = gpt-5.6-sol (5h<75% used) else terra, high; run as a BACKGROUND bash job (foreground times
out; stdin must be /dev/null — verify it's progressing, not hung). Claude commits (Codex can't). ALWAYS git push
before gh pr merge + verify merged tip + prod source. Gates are the ONLY type-check gate (in-build tsc/lint
DISABLED). Gate-green deploy + pm2 restart AUTONOMOUS; destructive/prod-memory-stressing ops Kevin-gated.
STANDING GATE: NO AI API.

AFTER ANCHOR-TEXT SHIPS — remaining Phase-7 blockers (each a full change-control cycle): (#4) graph-signal
"ER authority" labeling + consumer acceptance (brief.service.ts still says "Orphaned pages"); (#5) broken-link
false-positive-rate evidence; (#6) §7 dashboards/roadmap/Teamwork default-to-live (srt_/qct_ still Session-bound).
Plus track (A) monitoring once the 2026-07-27 sweep lands (fleet residuals + N=8 clocks). See the parity log's
"Gate criteria status against the locked bar".
```

---

## Current state (one paragraph)

Roadmap spine complete (A/B/C through C21, D0–D8). Active work is the **SF-retirement campaign toward
Kevin's Phase-7 bar** (N=8 / residualMiss ≤ 5% strict policy-filtered / fleet-wide, set 2026-07-20). The
**Phase-2 hybrid-discovery under-expansion fix is CODE-COMPLETE + ACCEPTED** — L1 (policy-filtered coverage,
PR #235) · L2 (rendered-DOM discovery, PR #238/#239) · L3 (raise raw caps 800/600, PR #241 → `8a271c3`), plus
the L2 memory-drill PASS (2026-07-21, min free 2224 MB / 0 restarts). **This session** produced the
Codex-P0-approved **spec + implementation plan for Phase-7 blocker #3, anchor-text capture** (branch
`feat/anchor-text-capture`, docs-only), ready for TDD execution — the single next action. Design:
findings-parity-only, measurement-only; the live builder emits SF's 3 anchor findings from a new nullable
`HarvestedLink.anchorText` aggregated in the existing keyset stream, with a durable `CrawlRun.anchorSummaryJson`
marker and `IssueUnit: 'links'`; `HarvestedLink` dedup/cap + the frozen characterization/golden tests are
untouched. Remaining toward Phase 7 after anchor-text: **(A) monitoring** the Mon 2026-07-27 first-fleet-wide
sweep (fleet residuals + N=8 clocks, `sf-required` fail-closed), and **(B) blockers #4 graph-signal ER-authority
labeling, #5 broken-link FP-rate, #6 default-to-live**. Ledgers: `2026-07-05-sf-live-parity-log.md`
(campaign status of record) + the campaign skill `er-seo-tools-sf-retirement-campaign`.
