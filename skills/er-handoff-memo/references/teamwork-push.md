# Teamwork Push — Contract Reference

This document describes the Teamwork push stage (SKILL.md §8) in prose form.
The actual push is executed at runtime via the `mcp__claude_ai_Teamwork__*`
MCP tools — no code runs from this file. It exists as a human-readable
reference for analysts and maintainers.

## Trigger

The push is **always opt-in**. After posting the roadmap (step 7), the skill
offers a single confirmation line. The user must explicitly reply "yes" (or
equivalent). If the `teamwork` key is absent from the GET response, the offer
is never shown.

## Input data required from the GET response

| Field | Location | Purpose |
|---|---|---|
| `structured_recommendations` | `audit.structured_recommendations[]` | One subtask per entry |
| `url_registry` | `audit.url_registry` | Rehydrate `affectedUrlRefs` into full URLs |
| `tasklistId` | `teamwork.tasklistId` | Target tasklist (or null → ask user) |
| `parentTaskName` | `teamwork.parentTaskName` | Name of the parent task to attach subtasks to |
| `taskType` | `teamwork.taskType` | Always `'subtask'` |
| `rules.matchParentAssignee` | `teamwork.rules` | Always true — copy parent assignee |
| `rules.addTimeEstimates` | `teamwork.rules` | Always false — never set time/effort fields |
| `rules.usePriorityFlags` | `teamwork.rules` | Always false — never set priority |

## Subtask shape

### Title

```
[SEO] {Humanized Issue Type} — {count}
```

Humanization: replace `_` and `-` with spaces, title-case each word.

### Description structure (in order)

1. Fix guidance (`entry.fixGuidance` verbatim)
2. Affected URLs block (rehydrated; labeled "complete" or "sample of N" per
   `affectedUrlComplete` / `affectedUrlSource`)
3. Grouped sub-sections (only if `entry.groups` is present and non-empty)
4. Source → target pairs (only if `entry.sampleUrls` entries contain `->`)
5. Effort note: `**Effort:** {entry.effort}` (body text only — no Teamwork effort field)
6. Two plain-text marker lines (last lines of description):
   ```
   seo-hash:{entry.affectedSetHash}
   seo-issue-type:{entry.issueType}
   ```

### Fields NOT set

- Time estimate / duration
- Effort (Teamwork field — effort goes in description body only)
- Priority flag

## Idempotency algorithm

1. Fetch ALL subtasks of the parent task (paginate until exhausted).
2. Collect all description strings into a set.
3. For each `structured_recommendations` entry: skip if any collected
   description contains `seo-hash:{entry.affectedSetHash}` (exact substring).
4. Create subtasks only for non-skipped entries.

## URL rehydration

For each `affectedUrlRef` (integer index into `url_registry.urls`):

```
entry = url_registry.urls[ref]
url   = entry.originalUrl
      ?? `${entry.scheme}://${url_registry.hosts[entry.hostId]}${entry.path}${entry.query ? '?' + entry.query : ''}`
```

## Known limitations (deferred)

- Marker removal → duplicate on next push (acceptable)
- Deleted subtasks → recreated on next push (intended)
- Parent renamed/deleted → manual fix required
- Changed affected set → new subtask added; old subtask not auto-closed
