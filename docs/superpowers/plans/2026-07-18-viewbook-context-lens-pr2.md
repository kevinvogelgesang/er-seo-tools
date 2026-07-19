# PR2 — Section outline + navigation (detailed TDD plan)

> Lane: `feat/vb-lens-pr2` (Codex). Depends on: PR1 (merged, `0d68d12`). Parallel with PR3 ∥ PR5.
> Owns exclusively this phase: `inspector/SectionOutline.tsx` (fill `buildOutlineRows` + the component body) + a small nav helper if needed + their tests. **Touches NO pane/editor/wrapper file.** `HiddenSectionsList.tsx` stays functional and UNTOUCHED (PR4 retires it atomically — never stub/adapt it here).
> Program: `2026-07-18-viewbook-context-lens-program.md` (§PR2). Spec: `…-design.md` §3.2 (SectionOutline), §3.5 (navigation).

## Goal

Turn the placeholder `SectionOutline` into the single findability surface: a searchable inventory of the current stage's sections (primary + carried + reinserted hidden), each row showing state pills + current-stage marker, clicking a row selects its section (`select(key,'manual-nav')`) and navigates the canvas to it (`navigateToAnchor`). Future-stage sections appear in a clearly non-current group.

## Frozen contracts consumed (do NOT modify)

- `buildOutlineRows(operatorData, stage, pcCompletedAt): OutlineRow[]` — PR1 froze the SEAM (currently `return []`); PR2 fills the body. `OutlineRow = { sectionKey; title; state:'active'|'hidden'|'done'; acknowledged:boolean; group:'primary'|'carried'|'future' }`.
- `SectionOutlineProps = { operatorData; stage; pcCompletedAt; viewbookId }` (frozen).
- `useSelectionContext().select(key,'manual-nav')` — returns `true` even on the currently-hard-pinned section but (post-PR1 M1 fix) will NOT downgrade that hard pin. Do NOT add a competing pin guard in the outline — pin policy stays solely in `SelectionContext`.
- `SECTION_TITLES: Record<SectionKey,string>` from `@/components/viewbook/public/section-titles`.
- `navigateToAnchor(sectionKey, anchor)` from `@/components/viewbook/public/viewbook-navigate` — dispatches `vb:navigate` (expands `SectionReveal`), then rAF scroll + flash. Calling it while the target is hidden/unmounted is a no-op (deferred navigation is automatic — the section reveal listener only fires for mounted targets).

## `buildOutlineRows` derivation (replicate `lib/viewbook/public-data.ts` ordering — but stay client-safe)

Source of truth: `STAGE_LINEUPS[stage] = { primary: SectionKey[], carried: SectionKey[] }` (`lib/viewbook/stages.ts` — client-safe) + a **LOCAL** pc-thanks predicate.

> **Codex fix #1 — do NOT import `public-data.ts`.** `SectionOutline.tsx` is a `'use client'` component; `lib/viewbook/public-data.ts` imports Prisma/server loaders (its `gatePcThanks` also takes `PublicSection[]`, not keys). Importing it drags the server graph into the client bundle — `npm run build` fails. Implement the gate as a local key predicate: `showPcThanks = (key: SectionKey) => key !== 'pc-thanks' || pcCompletedAt !== null`. `stages.ts` is client-safe (imports only `./theme` types) — import `STAGE_LINEUPS`/`VIEWBOOK_STAGES` from there.

Algorithm:
1. `sectionByKey = new Map(operatorData.sections.map(s => [s.sectionKey, s]))`.
2. `lineup = STAGE_LINEUPS[stage]`.
3. Build **primary** rows: iterate `lineup.primary` in order; for each key present in `sectionByKey` and passing the local pc-thanks predicate, emit a row `group:'primary'` — include it whether or not `state==='hidden'` (unlike public-data which drops hidden). Hidden sections are thus reinserted **in lineup order**, not appended. State pill reflects `state`.
4. Build **carried** rows: same for `lineup.carried`, `group:'carried'` (also apply the pc-thanks predicate).
5. Build **future** rows (**Codex fix #2 — unambiguous + deduped**):
   - Seed `seen = new Set([...lineup.primary, ...lineup.carried])` so any section that recurs in a later stage is NOT shown as future.
   - Iterate `VIEWBOOK_STAGES` strictly AFTER the current stage, in order; for each, iterate its `primary` then `carried`. For a key present in `sectionByKey`, NOT in `seen`, passing the pc-thanks predicate: emit `group:'future'` and add to `seen` (so each future key appears exactly once, at its EARLIEST later occurrence).
   - Never mark a future row with the current-stage marker.
6. `state`: map `OperatorSectionData.state` (`'active'|'hidden'|'done'`) straight through. `acknowledged = section.acknowledgedAt != null`.
7. `title = SECTION_TITLES[key]`.
- A key present in the DB but in NO stage lineup (current or later) does not render (matches public-data "absent from both lists → does not render").

## Bite-sized TDD steps

Run gates via log-file + Monitor (never inline vitest).

### Step 1 — `buildOutlineRows` pure unit (`SectionOutline.test.tsx`)
- **Tests (multiple stages — Codex fix #2):** cover `post-contract`, `kickoff`, AND `building`, not just one:
  - `building`: rows in `primary` order (`welcome,milestones,data-source,brand,assessment,strategy,materials`) then `carried` (`pc-setup,pc-invite`); a `state:'hidden'` primary section is REINSERTED in its lineup slot (not dropped, not appended); future group holds keys only in later-than-building stages (building is last → future empty).
  - `post-contract`: `pc-thanks` excluded when `pcCompletedAt===null`, included when set; future group holds `kickoff`/`website-specifics`/`building` keys NOT already in post-contract's lineup, each once, at earliest occurrence.
  - `kickoff`: a section carried in a LATER stage (already in kickoff's primary/carried, e.g. `welcome`) does NOT reappear as future (seed `seen` with current lineup).
  - A DB key absent from all lineups (current + later) → not present.
- **Impl:** fill `buildOutlineRows` per the derivation. Import `STAGE_LINEUPS`, `VIEWBOOK_STAGES` from `@/lib/viewbook/stages`; use the LOCAL pc-thanks predicate (never import `public-data.ts` — fix #1).

### Step 2 — `SectionOutline` renders rows + pills + current marker
- **Tests:** renders a `nav[data-vb-section-outline]`; one row per `buildOutlineRows` entry with its `SECTION_TITLES` title; state pills Visible/Hidden/Complete + Acknowledged when acked; a `primary`/`carried` grouping is visually distinguishable from `future` (assert a group label or data attr); current-stage rows carry a marker, future rows do not.
- **Impl:** render grouped rows. Each row is a `<button>` (or role) with an accessible name = the title. Pills reuse `StatusPill`.

### Step 3 — search filter
- **Tests:** typing in the search box filters rows by title (case-insensitive substring); empty query shows all; no-match shows an empty-state.
- **Impl:** controlled search input + client filter over rows.

### Step 4 — click selects + navigates
- **Tests:** clicking a VISIBLE row calls `select(row.sectionKey,'manual-nav')` (spy the context) AND `navigateToAnchor(row.sectionKey, <anchor>)` (mock the module). Clicking a HIDDEN row calls `select(row.sectionKey,'manual-nav','status')` (Codex fix #3 — focuses the Status group where PR4's Show lives) and the `navigateToAnchor` call is allowed to fire and NO-OP (the target isn't mounted, so `navigateToAnchor` finds nothing — assert it does not throw; do not assert scroll). PR4 owns the post-Show navigation once the refreshed props mount the target. Do NOT render `SectionQuickControls` or any show/hide mutation here — outline is selection-only (single mutation owner lands in PR4).
- **Impl:** onClick: for a hidden row `select(key,'manual-nav','status')`; for a visible row `select(key,'manual-nav')`; then `navigateToAnchor(key, anchor)` in both cases (hidden no-ops harmlessly). Match the anchor convention `TocRail`/`SectionReveal` already use (`'#'+key` per `viewbook-navigate`) — no second navigation path.

> **Codex fix #3 note:** `navigateToAnchor` dispatches `vb:navigate` and attempts lookup ONCE (`viewbook-navigate.ts:24`) — it is NOT auto-deferred. A hidden section has no canvas node, so the call simply finds nothing. Correct post-Show navigation (after refresh mounts the target) is PR4's responsibility, not an automatic effect.

### Step 5 — gate
- Per-task: `npx tsc --noEmit` + `npx vitest run "components/viewbook/public/OperatorLayer/inspector/SectionOutline"` → log + Monitor.
- **Pre-PR full gate (Codex fix #17):** `npx tsc --noEmit`, the full `npx vitest run` suite, and **`npm run build`** (the ONLY gate that catches a client/server-graph import leak — fix #1) all GREEN. (Repo disables in-build tsc/lint per CLAUDE.md, so these LOCAL gates are the only net.)

## Constraints
- **C1** SectionOutline renders only inside `OperatorInspector` (already gated). No outline markup in anon/preview.
- **C6** `pc-thanks` gating honored; the outline surfaces hidden sections for orientation but creates NO mutation (single owner = PR4). Do not render a second Show/Hide controller.
- Touch ONLY `SectionOutline.tsx` (+ optional nav helper) and its test. `HiddenSectionsList` remains live and untouched.

## Gotchas
- Outline click uses `select(key,'manual-nav')`; it returns `true` even on the currently hard-pinned section but won't downgrade that pin — do not treat the return value as "switched." `observe()` intentionally doesn't set `selectedGroup`. For HIDDEN rows pass `group:'status'` (fix #3) so the Status group (PR4's Show owner) is focused; visible rows leave group undefined.
- `navigateToAnchor` fires ONCE and does not auto-defer (fix #3) — for hidden sections it harmlessly no-ops; do NOT claim deferred navigation is automatic. Reuse `navigateToAnchor` — never write a second scroll/expand path.
- **Never import `lib/viewbook/public-data.ts`** (fix #1) — it pulls Prisma into the client bundle. Use `STAGE_LINEUPS`/`VIEWBOOK_STAGES` from client-safe `stages.ts` + a local pc-thanks predicate.
- `buildOutlineRows` must be PURE + deterministic (no Date/Math.random) so its unit tests are stable.
