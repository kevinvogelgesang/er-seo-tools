# Codex Capacity Expansion — Options 3–5 (NYI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Scope note:** unlike most plans in this folder, the deliverables here are NOT er-seo-tools code. They are edits to Kevin's user-scope Claude harness files (`~/.claude/skills/consulting-codex/SKILL.md`, `~/.claude/commands/*.md`) plus their portable mirrors under `~/.claude/docs/portable/`. The plan lives in this repo because `docs/superpowers/` is the doc home and er-seo-tools is the primary workspace these workflows serve. No repo code, schema, or deploy surface changes. Standard repo gates (tsc/vitest/build) do not apply; each task carries its own smoke-test verification instead.

> **Review record:** Codex ACCEPT WITH FIXES ×9 (2026-07-09), all applied inline — tagged "(Codex #N)" where they land.

**Goal:** Expand Codex CLI from opinion-giver to working peer — parallel implementer (option 3), adversarial checkpoint reviewer (option 4), and iterative spec reviewer (option 5) — without ever letting ChatGPT Plus rate limits stall the main workflow. Options 1–2 (slim `AGENTS.md`, `/codex-review` native review command) shipped 2026-07-09 and are the foundation this builds on.

**Architecture:** all three options extend the existing `consulting-codex` skill (`~/.claude/skills/consulting-codex/SKILL.md`) and its budget guard rather than creating parallel machinery. Every new surface: (a) runs the Budget guard first with an assigned priority class, (b) pins `gpt-5.6-terra` (effort per the guard's tiering), (c) reuses the pre-render secret scan, and (d) appends to the consultation ledger with a distinct `mode` value so calibration queries can judge each capability separately.

**Tech stack:** Codex CLI ≥ v0.144.0 (`codex exec`, `codex exec resume`, `--sandbox`, `-c` overrides), git worktrees, bash + python3 snippets embedded in skill markdown. No new dependencies.

## Resolved decisions (locked with Kevin, 2026-07-09)

- **D1 — Model:** `gpt-5.6-terra` is the pinned default at `high` reasoning effort. P2-class calls may downshift to `medium` when the 5h window is >50% used; P0/P1 always stay `high`.
- **D2 — Budget posture:** Kevin is on ChatGPT Plus; Codex tokens are the scarce resource vs the Claude Team seat. The budget guard (priority classes P0–P2, thresholds at weekly 75%/90% and 5h 80%) is a hard gate on every new surface in this plan. Nothing here may bypass it.
- **D3 — Rollout order:** option 4 (adversarial checkpoints) first — cheapest, immediate value; option 5 (spec ping-pong) second; option 3 (parallel implementer) last — it is the heavy token spender and needs the most careful guardrails.
- **D4 — Option 3 trigger:** Codex-as-implementer is **explicit-opt-in per use** ("have codex implement task N"), never auto-routed. Auto-routing an implementation run could silently burn most of a weekly window.

## Global constraints

- **Budget guard is unconditional.** Every invocation added by this plan runs the "Budget guard (ChatGPT Plus)" check from `consulting-codex` SKILL.md first, with the priority class assigned below. At weekly ≥ 90%, everything — including P0 — asks Kevin first.
- **Read-only remains the default.** The skill's read-only consultation guarantee stays intact for consult/patch/review modes. Option 3 is the ONLY exception, and it is confined to a disposable git worktree (see the "deliberately extends" callout in Task 5).
- **Secret scan before rendering** any Codex output verbatim, using the skill's existing patterns. No new escape hatches.
- **Ledger every call.** New `mode` values: `implement` (option 3), `checkpoint` (option 4), `spec-loop` (option 5 re-review rounds; round 1 stays `consult`). Best-effort, never blocking.
- **Smoke tests are real invocations (Codex #9).** Every smoke test in this plan runs the budget guard with its parent task's priority class, captures rate-limit snapshots, and writes a ledger entry like any other call — no exemption.
- **Cost is measured by rate-limit deltas, not proxies (Codex #8).** For every call added by this plan (resumed rounds included), capture the rate-limit snapshot immediately before and after and record the `used_percent` deltas + reset timestamps. `elapsed_ms`/`response_bytes` remain output-size diagnostics only. Never assume a resumed call is cheaper — resumed context grows; the deltas are the truth.
- **Portable mirrors stay in sync.** Any edit to `~/.claude/skills/consulting-codex/SKILL.md` or `~/.claude/commands/*.md` is copied to `~/.claude/docs/portable/` in the same task.
- **House rules outrank Codex.** Findings or diffs that contradict CLAUDE.md/AGENTS.md invariants are decided by the house rules; Codex output never overrides them.

## File structure

All paths are user-scope (`~/.claude/`), not repo paths:

- `skills/consulting-codex/SKILL.md` — Modify: add "Adversarial checkpoints" section (Task 1–3), "Spec review loop" section (Task 4), "Implement mode" section + ledger mode values (Task 5–6)
- `commands/codex-implement.md` — Create: explicit-opt-in implementer command (Task 5)
- `docs/portable/skills/consulting-codex/SKILL.md`, `docs/portable/commands/codex-implement.md` — Mirror copies (each task)
- er-seo-tools repo (this file only): `docs/superpowers/nyi/plans/2026-07-09-codex-capacity-expansion.md`

---

## Option 4 — Adversarial checkpoints (P2 class; ship first)

Three checkpoint types, one shared mechanism: a **checkpoint consult** is a P2 consultation whose prompt is built to *refute*, with all evidence pasted inline (never "explore the repo" — token thrift), invoked via the normal registry/resume flow, ledgered as `mode: "checkpoint"`.

### Task 1: Debugging hypothesis refutation

**Files:** Modify `SKILL.md` — new "Adversarial checkpoints" section, subsection "Debug refutation".

- [ ] **Step 1: Define the trigger.** During `superpowers:systematic-debugging`, after a root-cause hypothesis is formed and BEFORE applying the fix, when (a) the fix touches the change-control risky set (lib/jobs, lib/findings, schema, auth, recovery) or (b) the hypothesis explains only some of the symptoms. Trivial/obvious bugs skip the checkpoint.
- [ ] **Step 2: Define the prompt shape.** Inline: the symptom, the hypothesis, the evidence for it, the proposed fix diff (or description), and the instruction "Your job is to refute this hypothesis. What observations would this explanation NOT account for? What alternative cause fits the same evidence? Answer REFUTED (with the alternative) or STANDS (with what to verify before applying)."
- [ ] **Step 3: Define the outcome handling.** REFUTED → back to hypothesis formation with the alternative; STANDS → run Codex's named verifications, then apply. Either way the synthesis states the verdict in one line.
- [ ] **Step 4: Smoke test.** Manufacture a known-cause bug scenario from a past incident (e.g. the 2026-06-10 interactive-transaction lockup), present a deliberately wrong hypothesis, confirm Codex refutes it and names the real mechanism. Verify the ledger entry has `mode: "checkpoint"`.
- [ ] **Step 5: Sync the portable mirror.**

### Task 2: Verification poke-holes

**Files:** Modify `SKILL.md` — subsection "Completion verification".

- [ ] **Step 1: Define the trigger.** During `superpowers:verification-before-completion`, when about to claim done/fixed on a risky-set change or a multi-file feature. Docs-only and mechanical changes skip it.
- [ ] **Step 2: Define the prompt shape.** Inline: the claim, the evidence gathered (test output, gate results, manual checks), and "What would you check before believing this claim? Name the weakest piece of evidence and the failure mode it would miss."
- [ ] **Step 3: Define the outcome handling.** Named gaps get checked before the completion claim is made; the completion report cites the checkpoint verdict.
- [ ] **Step 4: Smoke test** on a real completed change with deliberately thin evidence; confirm Codex names the gap.
- [ ] **Step 5: Sync the portable mirror.**

### Task 3: Test-gap analysis

**Files:** Modify `SKILL.md` — subsection "Test gaps".

- [ ] **Step 1: Define the trigger.** On request, or before `/codex-review` on a risky-set diff when the diff adds logic without matching test files. Not auto-run on every diff (budget).
- [ ] **Step 2: Define the prompt shape.** Inline: the diff (or its logic-bearing excerpts) + the existing test file list, and "List the untested behaviors as concrete test cases: name, setup, assertion. Rank by the cost of the bug each would catch."
- [ ] **Step 3: Define the outcome handling.** Cases are triaged into write-now vs defer; write-now cases follow the house TDD conventions (`er-seo-tools-validation-and-qa`).
- [ ] **Step 4: Smoke test** on a recent merged diff with known-thin coverage; confirm at least one named case is real and actionable.
- [ ] **Step 5: Sync the portable mirror.**

## Option 5 — Multi-round spec ping-pong (P0 class, bounded)

### Task 4: Spec review loop

**Files:** Modify `SKILL.md` — new "Spec review loop" section.

- [ ] **Step 1: Define the trigger.** Only for large/risky specs: schema changes, new subsystems, security-adjacent work, or when round 1 returns "ACCEPT WITH FIXES" with ≥ 5 named fixes. Ordinary specs keep the existing single-pass flow — the ledger's ~85% flat-agree rate says one pass usually suffices.
- [ ] **Step 2: Define the loop mechanics.** Round 1 starts a **dedicated fresh Codex session for this spec** (Codex #7 — do NOT reuse the workspace's `active_sessions` UUID: that session carries unrelated prior consultations that would contaminate later rounds). Store the loop session's UUID keyed by canonical spec path + content hash for the loop's lifetime (a small `spec_loops` map alongside `active_sessions` if the loop must outlive a single Claude turn; otherwise in-turn state suffices). Round 1 is ledgered `mode: "consult"`. Rounds 2+ = `codex exec resume <loop-UUID>` with a prompt containing ONLY the applied fixes and changed sections: "These are the fixes applied since your last review. Re-review the changed sections only. Reply ACCEPT CLEAN or list remaining/new issues." Ledger `mode: "spec-loop"`, with per-round rate-limit deltas recorded (Codex #8).
- [ ] **Step 3: Define the exit conditions.** ACCEPT CLEAN, or **max 3 total rounds**, or budget guard trips (5h ≥ 80% → stop looping, note remaining issues in the spec, proceed per Kevin's auto-route rule). On max-rounds exit with open issues, stop and surface to Kevin — this is the existing "send back for rewrite" exception in his CLAUDE.md.
- [ ] **Step 4: Record pass counts.** Each round increments the "Codex ×N" count the tracker convention already records.
- [ ] **Step 5: Smoke test** on the next real large spec; confirm rounds 2+ resume the session (same UUID in ledger) rather than starting fresh.
- [ ] **Step 6: Sync the portable mirror.**

## Option 3 — Codex as parallel implementer (P1 class, explicit opt-in; ship last)

> **Deliberately extends a prior invariant:** the consulting-codex skill's read-only sandbox guarantee ("read-only at the OS level", enforced on both first-consult and resume) remains the default for ALL consultation modes. Implement mode is a deliberate, per-invocation, Kevin-initiated exception — `workspace-write` confined to a disposable git worktree that the main checkout never shares. Without this callout, future sessions will "fix" the write sandbox back to read-only mid-implementation.

### Task 5: `/codex-implement` command

**Files:** Create `~/.claude/commands/codex-implement.md`; Modify `SKILL.md` — "Implement mode" section documenting the invariant exception above.

- [ ] **Step 1: Define the contract.** Input: a scoped plan task (from a reviewed plan doc) with acceptance criteria, OR a tightly-described standalone task. Kevin must invoke it explicitly (D4) — never auto-routed. Budget precondition: weekly < 50% AND 5h < 50%, else decline and say why (an implementation run can consume a large fraction of a window).
- [ ] **Step 2: Define the flow.**
  1. Claude captures the base: `BASE_SHA=$(git rev-parse HEAD)` on the target branch, plus `git status --short` as the pre-run snapshot. Create the worktree on a **dedicated branch pinned to that SHA** (Codex #1 — plain `git worktree add <path> <branch>` fails when the branch is already checked out in the main worktree): `git worktree add -b codex/<task-slug> <scratch>/codex-<task-slug> "$BASE_SHA"` (or `--detach` for throwaway runs).
  2. Claude composes the task prompt: goal, acceptance criteria, relevant file excerpts pasted inline, house invariants that apply (from AGENTS.md), the exact test command, and "Run the tests before finishing; do not commit."
  3. Invoke: `codex exec --cd <worktree> --sandbox workspace-write -m gpt-5.6-terra -c model_reasoning_effort='"high"' --json --output-last-message <tmp> "<PROMPT>"` — note NO `--skip-git-repo-check` in implement mode (Codex #2: the worktree is intentionally a git repo; the check is a containment preflight, keep it).
  4. While Codex runs, Claude may continue its own task in the main checkout **only if the two tasks own disjoint file sets** (Codex #4). Before import, record Codex's changed paths (`git -C <worktree> status --porcelain`) and diff them against main's changes since `$BASE_SHA`; any overlap → stop and escalate to Kevin, never auto-resolve.
  5. On completion: Claude reviews the full change set line by line (`git -C <worktree> diff` AND untracked files from `status --porcelain` — plain `diff` misses them), runs the repo gates in the worktree (for er-seo-tools: `tsc --noEmit`, targeted vitest, build if warranted). To import (Codex #3 — `git diff | git apply` drops untracked files and has no base/overlap protection): **Claude authors an import commit in the worktree** (`git -C <worktree> add -A && git -C <worktree> commit` — Claude-made, preserving the "Codex never commits" rule), then `git cherry-pick -n <import-sha>` onto the target branch. Binary-safe, untracked-safe. Conflicts are never auto-resolved — reject and report.
  6. Cleanup (Codex #6): imported worktrees are removed immediately (`git worktree remove --force` + delete the `codex/<slug>` branch); rejected worktrees are retained through the review discussion, then removed unless Kevin asks to preserve them.
- [ ] **Step 3: Define the guardrails.** Never point `--cd` at the main checkout; never let Codex commit or push. **Explicit command policy in the prompt** (Codex #5 — `--cd` selects the workspace but is not a complete policy guarantee; worktrees share the repo's common `.git` directory): no package installs, no migrations, no deploys, no dev servers or background processes, no global config changes, no `git worktree`/`git config` operations, no sandbox-bypass flags. Post-run verification: confirm the worktree root is intact, check `git status` in BOTH the worktree and the main checkout (main must be untouched), and terminate any child processes Codex started for tests. Diff review + gates are mandatory before importing; a rejected diff is reported with reasons. Ledger `mode: "implement"` with before/after rate-limit deltas (Codex #8) as the cost record; response bytes kept as an output-size diagnostic only.
- [ ] **Step 4: Dry-run smoke test.** A deliberately trivial task in a scratch repo (not er-seo-tools): run it with the base branch **checked out in the main worktree** to prove the `-b codex/<slug>` + pinned-SHA creation path (Codex #1 verification), confirm worktree isolation — including that the sandbox blocks writes outside the worktree via absolute paths and shared `.git` metadata — the import-commit + `cherry-pick -n` round-trip (tracked, untracked, and binary files), and both cleanup paths. Record the before/after rate-limit `used_percent` delta in the SKILL.md section as the calibration baseline (Codex #8).
- [ ] **Step 5: First real use** on a small, well-scoped er-seo-tools plan task chosen by Kevin, with the full review-and-gates pass. Record the verdict in the ledger and the rate-limit delta next to the baseline.
- [ ] **Step 6: Sync the portable mirrors.**

### Task 6: Ledger + calibration follow-through

**Files:** Modify `SKILL.md` — ledger schema field rule for the new `mode` values; extend the calibration queries.

- [ ] **Step 1:** Add `checkpoint`, `spec-loop`, `implement` to the ledger `mode` field rule.
- [ ] **Step 2:** Add rate-limit `used_percent` before/after deltas as ledger fields for the new modes (Codex #8), plus one calibration query: cost (delta) and stance by mode, so after ~a month Kevin can see which capability earns its keep and which to throttle. `elapsed_ms`/`response_bytes` stay as secondary diagnostics only.
- [ ] **Step 3: Sync the portable mirror.**

## Acceptance criteria

- All three checkpoint types (Task 1–3) documented in SKILL.md with trigger, prompt shape, outcome handling; each smoke-tested once against real material; ledger entries carry `mode: "checkpoint"`.
- Spec loop (Task 4) exercised on one real spec with a resumed session across rounds; max-3-rounds and budget-trip exits documented.
- `/codex-implement` (Task 5) has completed one dry run in a scratch repo (including the branch-already-checked-out creation path and an untracked-file import) AND one real scoped task with diff review + gates, without ever writing to a main checkout; rate-limit deltas recorded for both.
- Budget guard demonstrably gates every new surface (each section names its priority class inline).
- Portable mirrors identical to live files at the end of each task.
- No change to er-seo-tools code, schema, or deploy surfaces.

## Out of scope / future work

- **Codex MCP transport** (`codex mcp-server`) — revisit if exec-based invocation becomes limiting; breadcrumb: the skill's v2 backlog already lists it.
- **Codex Cloud / remote tasks** (`codex cloud`) — experimental upstream; not until stable.
- **Auto-routing implement mode** — explicitly rejected (D4). Reopening is a Kevin decision.
- **Score/effort auto-tuning from ledger data** — collect a month of mode-tagged entries first (Task 6), then decide.
- **Plan-upgrade trigger:** if Kevin upgrades off Plus, the budget thresholds in the guard are the only knob that needs retuning — the priority classes stay.
