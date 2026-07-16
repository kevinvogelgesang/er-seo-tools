#!/bin/bash
# SessionStart lane check (er-seo-tools-multi-agent-coordination pre-flight).
# Injects the current worktree/lane state into context and warns when another
# interactive Claude Code session is running in the SAME directory as this one.
set -u

command -v jq >/dev/null 2>&1 || exit 0
git rev-parse --show-toplevel >/dev/null 2>&1 || exit 0

here=$(pwd -P)
worktrees=$(git worktree list 2>/dev/null)

# PIDs in our own ancestor chain, so this session never counts itself.
self_chain=" $$ "
p=$$
for _ in 1 2 3 4 5 6 7 8; do
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null || break
  self_chain="$self_chain$p "
done

# Interactive claude CLI processes: first word of the command is `claude` or a
# path ending in /claude; daemon and bg-pty helpers excluded.
candidates=$(ps -axo pid=,command= | awk '{ if ($2 == "claude" || $2 ~ /\/claude$/) print }' \
  | grep -vE 'bg-pty-host|bg-spare|daemon run' | awk '{print $1}')

same_dir=""
other_lanes=""
for pid in $candidates; do
  case "$self_chain" in *" $pid "*) continue ;; esac
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  [ -n "$cwd" ] || continue
  if [ "$cwd" = "$here" ]; then
    same_dir="$same_dir  - PID $pid (cwd: $cwd)\n"
  elif printf '%s\n' "$worktrees" | grep -qF "$cwd"; then
    other_lanes="$other_lanes  - PID $pid (cwd: $cwd)\n"
  fi
done

ctx="[lane-check] Multi-agent pre-flight (er-seo-tools-multi-agent-coordination):\n\nActive worktrees:\n$worktrees\n"
if [ -n "$other_lanes" ]; then
  ctx="$ctx\nOther Claude Code sessions in OTHER worktrees of this repo (their lanes — do not touch their branches/files):\n$other_lanes"
fi
if [ -n "$same_dir" ]; then
  ctx="$ctx\nWARNING: other Claude Code session(s) are running in THIS SAME directory:\n$same_dir\nBefore editing or committing ANYTHING, coordinate lanes: if this session is starting feature-class work, take an isolated worktree first (git worktree add .claude/worktrees/<slug> -b feat/<slug>) and tell Kevin which lane you took. Never assume you are alone in this checkout."
else
  ctx="$ctx\nNo other session shares this directory. Still run the pre-flight (git worktree list + overlap check) before feature-class work."
fi

printf '%b' "$ctx" | jq -Rs '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: .}}'
