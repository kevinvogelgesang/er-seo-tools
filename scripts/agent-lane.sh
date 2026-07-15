#!/usr/bin/env bash
# agent-lane — spin up a watchable agent "lane": a git worktree on its own
# branch, with a VSCode window that auto-launches the chosen agent (claude or
# codex) in a dedicated terminal. Implements the er-seo-tools-multi-agent
# coordination model — one worktree = one window = one agent.
#
# Usage:
#   scripts/agent-lane.sh <slug> [claude|codex] [--branch <name>] [--base <ref>] [--here|--no-open]
#
# Presentation (the lane's worktree is the same either way — only the window differs):
#   default   opens a NEW VSCode window on the lane; the agent auto-starts there.
#   --here    stays in THIS window: adds the lane as a second workspace folder and
#             prints the one-liner to launch the agent in a split terminal.
#   --no-open touches no windows; just prints how to open it.
#
# Examples:
#   scripts/agent-lane.sh keywords codex          # feat/keywords off origin/main, new window
#   scripts/agent-lane.sh gsc-fix claude --here   # same window, split-terminal lane
#   scripts/agent-lane.sh keywords codex --no-open # generate files, don't pop a window
#   scripts/agent-lane.sh hotfix claude --base origin/release  # fork from a different base
#
# New lanes fork from a freshly-fetched origin/main by default, so parallel
# lanes stay independent (no other agent's in-flight commits ride along).
# Override with --base. Reusing an existing branch ignores --base.
#
# Worktrees land under .claude/worktrees/<slug> (already gitignored). The
# .vscode/ config written into the lane is kept out of git via the repo's
# shared local exclude, so a lane's `git status` stays clean.
set -euo pipefail

SLUG="${1:-}"
if [[ -z "$SLUG" ]]; then
  echo "usage: scripts/agent-lane.sh <slug> [claude|codex] [--branch <name>] [--no-open]" >&2
  exit 1
fi
shift

AGENT="claude"
BRANCH=""
BASE=""
MODE="window"   # window | here | none
while [[ $# -gt 0 ]]; do
  case "$1" in
    claude|codex) AGENT="$1"; shift ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --here) MODE="here"; shift ;;
    --no-open) MODE="none"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done
BRANCH="${BRANCH:-feat/$SLUG}"
BASE="${BASE:-origin/main}"

# Main working tree (first entry of `git worktree list`), so lanes always nest
# under the primary repo even when this script is invoked from another lane.
MAIN_ROOT="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
WT_DIR="$MAIN_ROOT/.claude/worktrees/$SLUG"

# Create (or reuse) the worktree + branch.
if git worktree list --porcelain | grep -qxF "worktree $WT_DIR"; then
  echo "→ reusing existing worktree: $WT_DIR"
elif git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "→ worktree on existing branch $BRANCH (--base ignored)"
  git worktree add "$WT_DIR" "$BRANCH"
else
  # Fresh lane: fork from a current base so parallel lanes stay independent.
  if [[ "$BASE" == origin/* ]]; then
    echo "→ fetching ${BASE#origin/} for a current base…"
    git fetch origin "${BASE#origin/}" --quiet
  fi
  echo "→ new worktree + branch $BRANCH (base: $BASE)"
  git worktree add "$WT_DIR" -b "$BRANCH" "$BASE"
fi

# Keep the lane's .vscode/ out of git (local-only, uncommitted, shared exclude).
EXCLUDE="$(git -C "$WT_DIR" rev-parse --git-path info/exclude)"
grep -qxF '.vscode/' "$EXCLUDE" 2>/dev/null || echo '.vscode/' >> "$EXCLUDE"

# Write the VSCode task that auto-launches the agent on folder open, and is also
# bound to Cmd+Shift+B (default build task) as a manual fallback.
mkdir -p "$WT_DIR/.vscode"
cat > "$WT_DIR/.vscode/tasks.json" <<JSON
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "agent: $AGENT ($BRANCH)",
      "type": "shell",
      "command": "$AGENT",
      "presentation": { "reveal": "always", "panel": "dedicated", "focus": true, "clear": true },
      "runOptions": { "runOn": "folderOpen" },
      "group": { "kind": "build", "isDefault": true },
      "problemMatcher": []
    }
  ]
}
JSON

# Ask VSCode to allow the auto-run task in this workspace.
cat > "$WT_DIR/.vscode/settings.json" <<'JSON'
{
  "task.allowAutomaticTasks": "on",
  "window.title": "${rootName} · agent lane"
}
JSON

echo "✓ lane ready:"
echo "    worktree : $WT_DIR"
echo "    branch   : $BRANCH"
echo "    agent    : $AGENT (auto-starts on window open; Cmd+Shift+B to (re)launch)"

case "$MODE" in
  window)
    echo "→ opening a new VSCode window…"
    code -n "$WT_DIR"
    echo "  (first time only: if the agent doesn't auto-start, run"
    echo "   'Tasks: Allow Automatic Tasks' from the command palette, then reload.)"
    ;;
  here)
    echo "→ staying in this window: adding the lane as a workspace folder…"
    code --add "$WT_DIR" 2>/dev/null || echo "  (couldn't auto-add; File → Add Folder to Workspace → $WT_DIR)"
    echo "  Now split a terminal (Ctrl+\` then the split icon) and run:"
    echo "      cd \"$WT_DIR\" && $AGENT"
    ;;
  none)
    echo "→ new window:      code -n \"$WT_DIR\""
    echo "→ or same window:  cd \"$WT_DIR\" && $AGENT"
    ;;
esac
