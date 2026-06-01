# docs/superpowers — folder guide

Design specs and implementation plans, organized by status.

| Folder | What lives here |
|---|---|
| `specs/`, `plans/` | **Active / in-progress** work. New specs and plans land here while being written or implemented. |
| `nyi/specs/`, `nyi/plans/` | **Not yet implemented** — finished, reviewed specs/plans whose code hasn't been built yet (includes `FUTURE-*` ideas). |
| `archive/specs/`, `archive/plans/` | **Completed** — specs/plans for features that have shipped. Kept for history. |
| `todos/` | **Tracking files** — lightweight status/next-action docs that reference the specs/plans above. |

## Lifecycle

`specs/` + `plans/` (active) → on ship, move to `archive/`. If written but not built, park in `nyi/` until picked up. Use a `todos/` file to track multi-item efforts and point at the relevant specs/plans.

## Current open work

- `todos/2026-06-01-ada-accessibility-followups.md` — PSI a11y reframe + independent (IBM ACE) second check. Both in `nyi/` awaiting implementation.

(`HANDOFF-*.md` at this root are point-in-time chat handoffs, left in place as reference.)
