# Viewbook — Process & Milestones expansion — Design

**Date:** 2026-07-17
**Status:** Codex-reviewed (accept-with-named-fixes ×8, all applied 2026-07-17); ready for implementation plan
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
- **Most wiring is automatic** (verified — Codex fix 2): `GlobalContentEditor`
  iterates `BLOCK_KEYS = GLOBAL_CONTENT_KEYS.filter(k ≠ team, pc-intro)` → the
  **global default editor** (admin `/viewbooks/settings`) gains a Blocks editor
  for it; `ContentTab` iterates `OVERRIDE_ELIGIBLE_KEYS` → the **per-viewbook
  override** editor gains a row; `public-data.ts` loads all `GLOBAL_CONTENT_KEYS`
  into `data.global.blocks[key]` and per-viewbook `data.overrides[key]`;
  `validateGlobalContent` falls to `validateBlocks` (default branch); the content
  write + override routes validate via the shared key lists. No count assertion
  breaks (verified).
- **NON-automatic bits to fix explicitly (Codex fix 2):** ContentTab groups
  override rows under a **strategy-specific heading** ("Client-specific strategy
  adjustments / 'your plan'"); generalize that heading + any strategy-specific
  placeholder copy so a non-strategy key reads correctly (e.g. "Client-specific
  content overrides"). Update the stale "all five override rows" comment and the
  enumerated-key comment in `prisma/schema.prisma` (~:987). Add EXPLICIT
  enumeration tests that `process-milestones` appears in `BLOCK_KEYS`,
  `OVERRIDE_ELIGIBLE_KEYS`, and is loaded into `data.global.blocks`/`data.overrides`.
- Admin editors show the **raw key** (as for `seo-base` etc.) — acceptable,
  ER-facing; a friendly-label map is out of scope.
- **No migration** for this key — global content is the existing
  `ViewbookGlobalContent` table (upsert-by-key) + existing override storage.

### 3b. Render the info area in Process & Milestones

In `MilestonesSection.tsx`, above the milestone list, render the block
**mirroring `StrategySection` EXACTLY** (Codex fix 1):

```
const blocks = data.global.blocks['process-milestones']?.blocks ?? []
const override = data.overrides['process-milestones']
```

**Semantics = APPEND, not replace (Codex fix 1):** the platform override model
(`putContentOverride`, single bounded string) is additive — `StrategySection`
renders the global `blocks` (shared default) AND, when present, the per-viewbook
`override` text appended below. Reusing "the existing block system" (Kevin's
choice) therefore means **append**: the shared default always shows; the
per-viewbook override adds client-specific text beneath it. Match Strategy's
rendering exactly. **Welcome's `Blocks` is a PRIVATE component (Codex fix 1)** —
replicate Strategy's block+override rendering inline (or extract a shared leaf if
cleaner), do NOT import Welcome's `Blocks`. Render nothing when BOTH the default
blocks and the override are empty (no empty-heading leak). Tests: global-only,
override-only, both-present, both-empty.

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

- **Schema (Codex fix 7):** `prisma/schema.prisma` `ViewbookMilestone.description
  String?` (nullable, additive). Migration SQL exactly `ALTER TABLE
  "ViewbookMilestone" ADD COLUMN "description" TEXT;`. Pick a full timestamp
  STRICTLY AFTER the current latest `20260717231842_viewbook_assessment_content`
  (recheck immediately before merge). Plan runs `prisma migrate dev` (generates
  client) + verifies BOTH fresh-DB full-chain apply AND pre-migration→upgraded
  apply on a copy of the current DB. No backfill.
- **Public type:** `PublicMilestone.description: string | null` (`public-types.ts`),
  threaded in the milestone serializer `loadMilestones` in `public-data.ts:210`
  (alongside `blurb`).
- **Exact write path + REAL validation (Codex fix 3):** the update path is
  `app/api/viewbooks/[id]/milestones/[milestoneId]/route.ts` → `updateMilestone`
  in `service.ts:488`; creation is `createMilestone` (`service.ts:474`). NOTE:
  `blurb` currently has NO length validation, so "validate like blurb" is wrong —
  ADD real validation for `description`: accept only `string | null`, enforce a
  **2000-char cap** (longer than the short `blurb`), reject over-cap with 400 and
  **no `syncVersion` bump**. Extend BOTH `updateMilestone` AND `createMilestone`
  (+ their routes) to accept `description`. Rides the existing milestone
  `syncVersion` bump; array-form `$transaction` only.
- **Operator edit (Codex fix 4 — both editors, not "if"):** add a `description`
  textarea to BOTH the inline `MilestoneQuickEditor` (`OperatorLayer/InlineEditors.tsx`)
  AND the admin `MilestonesEditor.tsx` (it edits milestone fields). Update the
  admin milestone type `ViewbookDetail.milestones` in
  `components/viewbook/admin/viewbook-admin-shared.ts` + `operator-data.ts`.
- **Render:** in the new vertical row (3c), show `description` under `blurb`.
- **Search (Codex fix 5):** the new visible `description` joins the milestone
  search haystack in `toc-index.ts:93` (building-stage search indexes title +
  blurb today) — add `description`, with a test.

## 4. File touch set (exact, Codex-reviewed)

- `lib/viewbook/global-content-keys.ts` — add `'process-milestones'` key.
- `components/viewbook/public/MilestonesSection.tsx` — vertical list + info block (global default + appended override, mirror StrategySection) + `description` render.
- `components/viewbook/public/StrategySection.tsx` — READ-ONLY reference for the block+override rendering (replicate; do not import Welcome's private `Blocks`).
- `lib/viewbook/public-types.ts` — `PublicMilestone.description`.
- `lib/viewbook/public-data.ts` — thread milestone `description` in `loadMilestones` (:210).
- `lib/viewbook/operator-data.ts` — milestone `description` in operator data.
- `components/viewbook/admin/viewbook-admin-shared.ts` — `ViewbookDetail.milestones` type gains `description` (Codex fix 4).
- `components/viewbook/public/OperatorLayer/InlineEditors.tsx` — `description` field in `MilestoneQuickEditor`.
- `components/viewbook/admin/MilestonesEditor.tsx` — `description` field (Codex fix 4).
- `components/viewbook/admin/ContentTab.tsx` — generalize the strategy-specific override group heading/placeholder + stale "five rows" comment (Codex fix 2).
- `lib/viewbook/toc-index.ts` — add `description` to the milestone search haystack (:93, Codex fix 5).
- `lib/viewbook/service.ts` — `updateMilestone` (:488) + `createMilestone` (:474) accept + validate `description` (2000 cap, string|null); the milestone routes (`app/api/viewbooks/[id]/milestones/route.ts` + `.../[milestoneId]/route.ts`) thread it. **`service.ts` IS this feature's to edit** (no concurrent lane owns it — the other live session is `sweep-error-triage`, disjoint).
- `prisma/schema.prisma` + new migration — `ViewbookMilestone.description` + the enumerated-key comment (~:987).
- Tests for each.

**Not touched:** `WelcomeSection.tsx` (its `process` block), the Review &
feedback block.

## 4a. Public-share + operator visibility (Codex fix 6 — intended)

The token page renders the SAME `MilestonesSection` for BOTH anonymous clients
and authenticated operators, so the info block AND per-milestone descriptions are
**client-visible** in kickoff, website-specifics (carried), and building — this
is DESIRED (it is client-facing viewbook content, like the milestone titles).
The inline `MilestoneQuickEditor` mounts ONLY on the verified-operator branch
(operator-gated); the separate admin Milestones tab (`MilestonesEditor`) remains
the other supported edit surface. Nothing here is operator-only leaked to clients.

## 5. Testing (Codex fix 8)

- Global-content: `process-milestones` validates as blocks; write + override routes accept it; EXPLICIT enumeration tests that it appears in `BLOCK_KEYS`, `OVERRIDE_ELIGIBLE_KEYS`, and `data.global.blocks`/`data.overrides`.
- MilestonesSection: info block renders global-default-only, override-only, both-present (default THEN appended override), both-empty → no heading. **New structural regression test:** the milestone container is a VERTICAL stack and the cards no longer carry `overflow-x-auto`/`min-w-56` (NOTE: no existing test asserts those classes today — this is a NEW guard, nothing to "update"). Each milestone renders its `description`.
- Milestone `description`: round-trips through `updateMilestone` + `createMilestone` and their routes; an over-2000-char write is rejected 400 with NO `syncVersion` bump; serializer surfaces it on `PublicMilestone`; both the inline `MilestoneQuickEditor` AND admin `MilestonesEditor` payloads include it; `toc-index` search matches on `description`.
- Migration applies clean on a FRESH DB (full chain) AND on an upgraded copy of the current DB.
- Repo invariants: array-form `$transaction([...])` only; `syncVersion` bump on the mutation; **serial tests against `DATABASE_URL="file:./local-dev.db"`** (the repo convention); NO jest-dom matchers.

## 6. Non-goals

- No change to the Review & feedback block, the Welcome `process` block, or any
  other section.
- No friendly-label map for content keys (raw key display, as today).
- No rich-text for the info area (heading/body blocks, consistent with the other
  base blocks). Per-milestone `description` is plain text (like `blurb`).
