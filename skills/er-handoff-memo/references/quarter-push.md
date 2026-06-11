# Quarter Cycle Push (qct_) — Contract Reference

The `qct_` flow pushes the er-seo-tools Quarter Grid's planned-week
assignments into Teamwork as dated tasks — one task per client per planned
week, in that client's own tasklist. Unlike `srt_` (where the push is an
opt-in extra after a roadmap), **the push IS the purpose of a qct_ handoff** —
no separate confirmation is needed beyond the pasted prompt itself.

The actual push is executed at runtime via the `mcp__claude_ai_Teamwork__*`
MCP tools — no code runs from this file.

## Flow

1. Fetch the export: `python3 scripts/handoff.py fetch --webapp <Webapp> --token <qct_…> --id <planId>`
2. For each assignment, apply the skip rules below; create tasks for the rest.
3. Post the receipt: `python3 scripts/handoff.py receipt --webapp <Webapp> --token <qct_…> --id <planId> --counts '<json>'`
4. Reply with a one-screen summary table (created / skipped and why).

## Export shape (GET response)

| Field | Purpose |
|---|---|
| `planId`, `planName`, `startDate` | Plan identity; `startDate` null ⇒ no dates on tasks |
| `assignments[]` | Planned-week rows only, active clients only (see fields below) |
| `teamwork.taskType` | Always `'task'` — top-level task in the tasklist, NOT a subtask |
| `teamwork.rules` | `addTimeEstimates: false`, `usePriorityFlags: false` — never set those fields |
| `teamwork.titleFormat` | `[SEO] Quarter Cycle — Week {week} ({range})`, or without `({range})` when `startDate` is null |
| `teamwork.markerFormat` | `quarter-cycle:{planId}:{clientId}:{week}` — idempotency marker |

Each assignment: `{ clientId, clientName, week, weekStart, weekEnd, priority,
status, note, completed, tasklistId }`. `weekStart`/`weekEnd` are ISO
`yyyy-mm-dd` (Monday/Friday of the planned week) or null.

## Task shape

- **Tasklist:** the assignment's `tasklistId` (each client has its own).
- **Title:** `teamwork.titleFormat` with `{week}` = week number and `{range}` =
  `M/D–M/D` rendered from `weekStart`/`weekEnd` (e.g. `7/20–7/24`).
- **Dates:** `startDate` = `weekStart`, `dueDate` = `weekEnd` — omit both when null.
- **Description**, in order:
  1. `**Priority:** P{priority}`
  2. `**Status:** {status label}` (not_started → Not Started, etc.)
  3. The `note` as a paragraph (only when non-empty)
  4. Last line, plain text: the marker — `quarter-cycle:{planId}:{clientId}:{week}`
- **Never set:** time estimates, effort fields, priority flags.

## Skip rules (count each category for the receipt)

| Rule | Receipt count |
|---|---|
| `completed: true` — a done cycle doesn't need a fresh task | `skippedCompleted` |
| `tasklistId: null` — client has no Teamwork tasklist configured | `skippedNoTasklist` |
| Marker already present in ANY task description in that tasklist (paginate the tasklist's tasks to exhaustion before deciding) | `skippedExisting` |
| Otherwise → create the task | `created` |

## Receipt

```bash
python3 scripts/handoff.py receipt --webapp <Webapp> --token <qct_…> --id <planId> \
  --counts '{"created": N, "skippedExisting": N, "skippedNoTasklist": N, "skippedCompleted": N}'
```

The dashboard shows "Last pushed {date} · {created} tasks" from this. Post it
even when `created` is 0.

## Known limitations (deferred, mirrors srt_)

- Moving a client to a new week creates a NEW task; the old one is not
  auto-closed or updated.
- Deleting a pushed task in Teamwork → recreated on the next push (intended).
- Marker line removed by hand → duplicate on next push (acceptable).
- One-way push: Teamwork task completion does not flow back to the grid.
