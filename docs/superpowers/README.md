# docs/superpowers — folder guide

Design specs and implementation plans, organized by status.

| Folder | What lives here |
|---|---|
| `specs/`, `plans/` | **Active / in-progress** work. New specs and plans land here while being written or implemented. |
| `nyi/specs/`, `nyi/plans/` | **Not yet implemented** — finished, reviewed specs/plans whose code hasn't been built yet (includes `FUTURE-*` ideas). |
| `nyi/improvement-roadmaps/` | **Strategy roadmaps** (2026-06-10) — one big-picture improvement doc per webapp section, Codex-reviewed. Start at `00-overview.md`. |
| `archive/specs/`, `archive/plans/` | **Completed** — specs/plans for features that have shipped. Kept for history. |
| `todos/` | **Tracking files** — lightweight status/next-action docs that reference the specs/plans above. |

## Lifecycle

`specs/` + `plans/` (active) → on ship, move to `archive/`. If written but not built, park in `nyi/` until picked up. Use a `todos/` file to track multi-item efforts and point at the relevant specs/plans.

## Current open work

- `todos/2026-06-10-improvement-roadmap-tracker.md` — master tracker for the improvement roadmaps (`nyi/improvement-roadmaps/`); four tracks, checkbox status per milestone.
- `todos/HANDOFF-improvement-roadmap.md` — **living chat-to-chat handoff** for the roadmap: paste-in pickup prompt + next item + gotchas. Must be updated in the same commit as any tracker change.
- `todos/2026-06-01-ada-accessibility-followups.md` — PSI a11y reframe + independent (IBM ACE) second check. Both in `nyi/` awaiting implementation.

(`HANDOFF-*.md` at this root are point-in-time chat handoffs, left in place as reference.)
