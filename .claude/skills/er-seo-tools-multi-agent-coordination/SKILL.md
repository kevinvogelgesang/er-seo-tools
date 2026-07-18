---
name: er-seo-tools-multi-agent-coordination
description: "Use whenever more than one coding agent may be working er-seo-tools at once — Claude and Codex in tandem, parallel features, relay/handoff, or implementer+reviewer. Run its pre-flight BEFORE starting feature work: it prevents two agents editing the same files on different branches and clobbering each other. Also use when Kevin says another agent is working something, when creating a worktree, or when picking up in-flight work you did not start."
metadata:
  short-description: Two-agent worktree protocol — check lanes before you touch code
---

# er-seo-tools Multi-Agent Coordination

Claude and Codex are peers on this repo: same context (`AGENTS.md` → `CLAUDE.md`
+ the shared `er-seo-tools-*` skills), same discipline (`er-seo-tools-workflow`
→ `er-seo-tools-change-control`). Either can design, implement, review, and land
changes. This skill is the one rule that makes that safe: **know what lane the
other agent is in before you take one.**

## The one hard insight

**A tracked file cannot coordinate agents across branches.** If Claude is on
`feat/a` and Codex on `feat/b`, each has its own copy of any committed
`LANES.md` — neither sees the other's edits until merge, which is exactly too
late. So the coordination surface must be **branch-independent**:

- **`git worktree list`** — repo-global metadata, identical from every worktree.
  This is the source of truth for what lanes exist.
- **Branch names** — the intent signal. Name them so the feature is legible
  (`feat/gsc-cannibalization`, not `feat/wip`).
- **Kevin's spoken direction** — "Codex has the sales report, you take keywords."
  Highest authority; overrides inference.

Do not invent a committed registry file. Read git; it never drifts.

## Pre-flight — run before ANY feature-class work

```bash
git worktree list                       # every active lane, branch + HEAD
git branch -a --sort=-committerdate | head -20   # recent branches (merged or not)
git -C <repo-root> log --oneline -5     # what main last moved on
```

Then:

1. **Identify the other agent's lane.** Any worktree under
   `.claude/worktrees/` on a non-`main`, non-`docs/*-shipped` branch is
   potentially live work. A `docs/<x>-shipped` / `docs/<x>-ship` branch is a
   *finished* lane (this repo tags shipped work that way) — safe to ignore.
2. **Check for file overlap with your intended change.** If another live lane
   touches the files you need:
   ```bash
   git diff --name-only main...<their-branch>
   ```
   Overlap → **stop and coordinate** (ask Kevin, or pick non-overlapping work).
   Never edit files another lane is actively changing. No overlap → proceed.
3. **If picking up in-flight work you did not start**, read that branch's last
   commits and any `docs/superpowers/todos/HANDOFF-*.md` before touching it —
   the handoff doc is the relay contract (`er-seo-tools-docs-and-writing`).

## Take your lane

Both agents use the **same** isolation dir the repo already uses,
`.claude/worktrees/`, so lanes are visible to each other via `git worktree list`:

```bash
git worktree add .claude/worktrees/<feature-slug> -b feat/<feature-slug>
```

- **Name the worktree = the feature slug** so intent reads straight out of
  `git worktree list`. This IS your claim — no separate file needed.
- One agent, one worktree, one feature at a time. Do not work two features in
  one worktree.
- Run all gates **inside your worktree** (`er-seo-tools-validation-and-qa`) —
  each lane verifies independently before its PR.
- **Announce in your reply to Kevin**: which worktree, which branch, which files
  — one line. That is how the human stays the router across both harnesses.

## Launching Codex so it can self-verify

Launch a Codex tandem lane with a **network-enabled** workspace-write sandbox so
it can run the FULL gate set (test + build) itself. The default sandbox blocks
loopback listeners and outbound DNS, which left Codex unable to run `npm test`
cleanly or `npm run build` at all:

```bash
codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" \
  -s workspace-write -c sandbox_workspace_write.network_access=true
```

- `network_access=true` is what unblocks the 4 loopback SSRF tests in
  `lib/security/safe-url.test.ts` (they bind `127.0.0.1`); without it Codex
  reports them as false failures. Keep the flag on the invocation rather than
  globally in `~/.codex/config.toml`, so your other (potentially untrusted)
  Codex projects keep the strict default. Flip it globally — a
  `[sandbox_workspace_write]` table with `network_access = true` — only if you
  want it always-on everywhere.
- The Vitest cache is already relocated off `node_modules/.vite` (a worktree's
  symlinked `node_modules` sits outside the sandbox's writable root), and the
  app's fonts are self-hosted (no build-time Google Fonts fetch) — so with
  network on, both gates run offline-clean. No `--cache=false` needed.
- Codex still cannot `git commit`/`push` (the worktree's `.git` file points
  outside the sandbox) — the Claude-commits-after-review relay stands.

## Adapt to the situation

The operating model is not fixed — read the state and fit it:

- **Parallel features** — separate slugs, zero file overlap, independent gates
  and PRs. The pre-flight overlap check is what keeps this safe.
- **Relay / handoff** — same branch, sequential. The handoff doc
  (`docs/superpowers/todos/HANDOFF-*.md`) is the baton; the picking-up agent
  reads it first, works, rewrites it (change-control hard gate 2).
- **Implementer + reviewer** — one lands the branch gate-green; the other runs
  an adversarial pass (Codex via `consulting-codex` / `codex-review`; Claude via
  a review skill) BEFORE merge. Review is advisory, not an approval channel —
  merge/deploy authority stays with `er-seo-tools-change-control` rule 1.
- **Kevin drives both directly** — he assigns per task; you still run the
  pre-flight so you never assume you are alone.

When Kevin's direction and the git state disagree, **ask** — do not guess which
is stale.

## On finishing

- Merge per `er-seo-tools-change-control` (gate-green), then remove your lane so
  `git worktree list` stays truthful:
  ```bash
  git worktree remove .claude/worktrees/<feature-slug>
  ```
- If the branch shipped, this repo's convention is a `docs/<slug>-shipped`
  marker branch (visible in the worktree list) — leave finished lanes legible so
  the next agent's pre-flight can tell live from done.

## Red flags

| Thought | Reality |
|---------|---------|
| "I'll edit `main` directly, just a quick fix" | Never work `main`; take a lane. The other agent may be mid-merge. |
| "I'll drop a LANES.md so we coordinate" | Committed files don't cross branches. Use `git worktree list`. |
| "No worktrees listed, so I'm alone" | Also check recent branches and ask Kevin — an agent may be about to start. |
| "Their branch is `docs/x-shipped`, I'll avoid it" | Shipped branches are DONE — safe. Live lanes are the non-shipped feature branches. |
| "We're both touching `findings-shared.ts`, but carefully" | Shared-file edits across lanes = merge pain + clobber risk. Serialize them. |
