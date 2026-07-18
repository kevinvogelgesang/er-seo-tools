# Viewbook — Process & Milestones expansion — Design

**Date:** 2026-07-17
**Status:** brainstorming-approved (Kevin answered the 4 shaping questions); pending Codex spec review
**Base:** viewbook shipped (v1 + v2 + UX pass, all on main)

## 1. What this is

A focused pass on the **Process & Milestones** section (the milestone timeline /
non-review overview). Three changes:

1. **Un-trap the milestones** from the horizontal scroll strip → a vertical
   stacked list with room to breathe.
2. **A customizable section info area** — a **global default applied to all
   viewbooks**, **overridable per viewbook** by ER employees.
3. **Per-milestone detail** — a longer, ER-editable description on each milestone.

The building-stage **"Review & feedback" block is untouched** (this is the
"non-review" overview pass). The Welcome section's existing `process` block is
**untouched** (Kevin chose a NEW, independent block for this section).

## 2. Decisions locked (brainstorm)

| # | Decision |
|---|---|
| D1 | Info area = **a NEW global-content block key** (not reuse of `process`, not shown in both). Own global default + per-viewbook override. |
| D2 | Milestone layout = **vertical stacked list** (replaces `overflow-x-auto`). |
| D3 | "More info" = **section-level info area AND per-milestone detail** (new `description` field). |
| D4 | Welcome's `process` block stays as-is; Review & feedback block stays as-is. |

## 3. Design

### 3a. New global-content key `process-milestones`

Reuse the existing global-content + per-viewbook-override system (the same one
behind `process`/`why`/`seo-base`/`geo-base`/`eeat-base`). Add ONE new key:

- `lib/viewbook/global-content-keys.ts`: add `'process-milestones'` to
  `GLOBAL_CONTENT_KEYS`. It is NOT `team`/`pc-intro`, so it is automatically
  **override-eligible** (`OVERRIDE_ELIGIBLE_KEYS` derives from the same list) and
  validated as heading/body **`ContentBlocks`** (`validateGlobalContent` →
  `validateBlocks`, the default branch — no validator change).
- **Everything else is automatic** (verified): `GlobalContentEditor` iterates
  `BLOCK_KEYS = GLOBAL_CONTENT_KEYS.filter(k ≠ team, pc-intro)` → the **global
  default editor** (admin `/viewbooks/settings`) gains a Blocks editor for it;
  `ContentTab` iterates `OVERRIDE_ELIGIBLE_KEYS` → the **per-viewbook override**
  editor gains a row; `public-data.ts` loads all `GLOBAL_CONTENT_KEYS` into
  `data.global.blocks[key]` and per-viewbook `data.overrides[key]`; the content
  write route validates via `isKnownKey` (the same list). Admin editors show the
  **raw key** (as they do for `seo-base` etc.) — acceptable, ER-facing; a
  friendly-label map is out of scope.
- **No migration** for this key — global content is the existing
  `ViewbookGlobalContent` table (upsert-by-key) + existing override storage.

### 3b. Render the info area in Process & Milestones

In `MilestonesSection.tsx`, above the milestone list, render the block **with
the per-viewbook override applied**, mirroring `StrategySection`'s resolve:

```
const blocks = data.global.blocks['process-milestones']?.blocks ?? []
const override = data.overrides['process-milestones']
```

Render `override` (per-viewbook text) when present, else the global `blocks`
(shared default), using the same `<Blocks>` presentation used by Strategy/Welcome.
Render nothing when both are empty (no empty heading leak). This also makes the
`process-milestones` override **live** (Strategy already applies overrides; the
new render follows that correct pattern, unlike Welcome's global-only `process`).

The info area renders in **every stage** the section appears (kickoff / building /
carried) — it is section context, above the timeline; it does not touch the
building-stage Review & feedback block below.

### 3c. Vertical stacked milestone list (D2)

Replace the current `<div className="flex gap-4 overflow-x-auto pb-2">` +
`min-w-56` cards with a **vertical stack** (`space-y-3`/`flex-col`): each
milestone is a full-width row/card showing status dot · title · "Current stage"
chip (when current) · `blurb` (short) · **`description`** (new, longer) ·
target/completed date. No horizontal scroll; the row has room for the longer
description. `StageDot`/status semantics unchanged; anchor id (`milestoneAnchor`)
preserved so TOC/nav still targets each milestone.

### 3d. Per-milestone `description` (D3)

Additive, nullable — mirrors existing `ViewbookMilestone` string fields (`blurb`).

- **Schema:** `prisma/schema.prisma` `ViewbookMilestone.description String?`
  (nullable, additive). New migration `2026071x…_viewbook_milestone_description`
  (pick an `HHMMSS` greater than any same-day migration; verify at
  execution + before merge). Applies clean fresh + on the current DB; no backfill.
- **Public type:** `PublicMilestone.description: string | null` (`public-types.ts`),
  threaded in the milestone serializer in `public-data.ts` (alongside `blurb`).
- **Operator edit:** add a `description` textarea to the milestone editor — the
  inline `MilestoneQuickEditor` (`OperatorLayer/InlineEditors.tsx`) and, if it
  edits the same fields, the admin `MilestonesEditor`. Persist via the existing
  milestone update route/service (extend its accepted body with `description`,
  bounded length, validated like `blurb`). Rides the existing `syncVersion` bump
  (no new bump path). Array-form `$transaction` only.
- **Render:** in the new vertical row (3c), show `description` under `blurb`.

## 4. File touch set

- `lib/viewbook/global-content-keys.ts` — add `'process-milestones'` key.
- `components/viewbook/public/MilestonesSection.tsx` — vertical list + info block (override-aware) + description render.
- `lib/viewbook/public-types.ts` — `PublicMilestone.description`.
- `lib/viewbook/public-data.ts` — thread milestone `description` (serializer).
- `lib/viewbook/operator-data.ts` — milestone `description` in operator data.
- `components/viewbook/public/OperatorLayer/InlineEditors.tsx` — `description` field in `MilestoneQuickEditor`.
- `prisma/schema.prisma` + migration — `ViewbookMilestone.description`.
- The milestone update route/service (`app/api/viewbooks/[id]/milestones/**` or the milestones service) — accept + validate `description`.
- Tests for each.

**Not touched:** `WelcomeSection.tsx` (its `process` block), the Review &
feedback block, `service.ts` ONLY if the milestone update lives elsewhere (use
the existing milestone write path; if it's in `service.ts`, that's this feature's
to edit — no concurrent lane owns it now).

## 5. Testing

- Global-content: `process-milestones` validates as blocks; write route accepts it; global editor + override tab enumerate it (covered by their existing key-driven tests — extend the count/fixture).
- MilestonesSection: info block renders the global default; a per-viewbook override replaces it; both-empty → no heading; the milestone list is a vertical stack (no `overflow-x-auto`); each milestone renders its `description`.
- Milestone `description`: round-trips through the operator editor + update route (bounded length); serializer surfaces it on `PublicMilestone`; migration applies fresh + upgraded.
- Repo invariants: array-form `$transaction`, no jest-dom, per-worker test DB.

## 6. Non-goals

- No change to the Review & feedback block, the Welcome `process` block, or any
  other section.
- No friendly-label map for content keys (raw key display, as today).
- No rich-text for the info area (heading/body blocks, consistent with the other
  base blocks). Per-milestone `description` is plain text (like `blurb`).
