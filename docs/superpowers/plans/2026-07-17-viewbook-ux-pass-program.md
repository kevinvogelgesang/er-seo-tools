# Viewbook UX Pass — Program Plan (4-lane, 2-wave tandem)

> **For agentic workers:** this is the COORDINATION contract, not a task list.
> Per-lane task plans: Lane 1 plan + Lane 2 Codex brief exist now
> (`2026-07-17-viewbook-ux-pass-lane1.md`, `…-lane2-codex-brief.md`). Lane 3
> brief + Lane 4 plan are cut when Wave 1 merges (interfaces copied from MERGED
> code, never memory).

**Spec:** `docs/superpowers/specs/2026-07-17-viewbook-ux-pass-design.md`
(Codex-reviewed, 11 fixes applied — read it BEFORE any lane plan).

**Goal:** fix the viewbook blink + scroll bugs, make operator edits live/save-less,
adjust stage content, and add rich-text assessment notes — in 4 file-disjoint lanes
across 2 tandem waves (Claude ∥ Codex). Version control is a separate later spec.

## Lane / wave map

| Lane | Owner · Wave | Theme | Plan |
|---|---|---|---|
| L1 — Reading experience | **Claude** · W1 | blink fix, sticky-header scroll, TOC left/expanded, footer bug, open-in-new-tab | `…-lane1.md` |
| L2 — Operator editing UX | **Codex** · W1 | no save buttons/autosave, live theme+contrast, AA-only, Google-Fonts search | `…-lane2-codex-brief.md` |
| L3 — Stage flow & content | **Codex** · W2 | Data Source greyed+propose, milestone kickoff/building, ack fix | cut at W1 merge |
| L4 — Rich-text + Assessment | **Claude** · W2 | reusable WYSIWYG, assessment notes+images, perf decimals, schema | cut at W1 merge |

**Wave 1:** L1 (Claude) ∥ L2 (Codex) → both merge. **Wave 2:** L4 (Claude) ∥ L3
(Codex), rebased on W1 → both merge.

## File ownership (exact — from spec §10; the overlap contract)

**L1 (Claude, W1)** — C: `components/viewbook/public/StickyOffsetProbe.tsx`.
M: `SectionReveal.tsx`, `SectionShell.tsx`, `ViewbookShell.tsx` (+`data-vb-theme-root`
marker + single probe mount), `TocRail.tsx`, `SectionAccents.tsx`, `viewbook-navigate.ts`,
`ProgressNav.tsx` (top offset), `EarlierSteps.tsx` (Task 9 footer fix),
`lib/viewbook/section-display.ts`,
`OperatorLayer/OperatorBar.tsx` (id + z-50, positioning only),
admin `ViewbookIndex.tsx`/`ViewbookCard.tsx`/`ViewbookEditor.tsx` + tests.
(Probe mounts ONCE in `ViewbookShell`; `OperatorViewbookLayer` is NOT edited.)

**L2 (Codex, W1)** — C: `lib/viewbook/font-manifest.ts`,
`OperatorLayer/theme-store.ts`, `OperatorLayer/ThemeDraftWriter.tsx` (mounted by
`ThemeInlineEditor`, NOT by any Lane-1 file). M: `OperatorLayer/InlineEditors.tsx`,
`operator-api.ts`, `useViewbookSync.ts`, `ThemeStyle.tsx`, `ContrastTester.tsx`,
`BrandSection.tsx`, `lib/viewbook/theme.ts`, `lib/viewbook/contrast.ts`,
admin `ThemeEditor.tsx` + tests.

**L3 (Codex, W2)** — M: `DataSourceSection.tsx`, `MilestonesSection.tsx`,
`OperatorLayer/SectionQuickControls.tsx`, `PcThanksSection.tsx`, `lib/viewbook/ack.ts`,
`lib/viewbook/service.ts` (sole owner — `setSectionState` ack fix) + tests.

**L4 (Claude, W2)** — C: `components/richtext/*`, assessment operator-note leaves,
`app/api/viewbooks/[id]/assessment/**`, `lib/viewbook/assessment-notes.ts`.
M: `prisma/schema.prisma` + migration, `AssessmentSection.tsx`,
`lib/viewbook/assessment.ts`, `lib/viewbook/public-types.ts`, `lib/viewbook/retention.ts`,
`app/api/clients/[id]/route.ts`, `app/api/viewbook/[token]/assets/[filename]/route.ts` + tests.

**No file is in two concurrently-running lanes.** `middleware.ts` is untouched.

## Cross-lane seams (agreed constants — put verbatim in both plans)

1. **`--vb-sticky-offset`** (+ `--vb-progress-nav-height`, `--vb-operator-bar-height`): published by L1's `StickyOffsetProbe` (ResizeObserver) on the themed root. Section headers pin at `top: var(--vb-sticky-offset)`; `scroll-margin-top: calc(var(--vb-sticky-offset) + 12px)`. Presentation mode → operator-bar height 0.
2. **Live-theme seam (Wave-1 L1↔L2 — Codex plan-fix, concrete split):**
   - **L1:** `ViewbookShell` adds ONLY `data-vb-theme-root` on the themed root `<div>` and keeps its inline `--vb-*` overridable (no `!important`). **No Lane-2 imports, no writer mounted by L1.**
   - **L2:** `ThemeStyle` marks its Google-Fonts `<link>` with `data-vb-theme-font`.
   - **L2:** `theme-store.ts` is an external store **keyed by `viewbookId`** (never a single module-global draft).
   - **L2:** `ThemeInlineEditor` mounts a `ThemeDraftWriter` client leaf (Lane 2 owns it — mounted from the editor, NOT from `OperatorViewbookLayer`). It subscribes to the draft and imperatively writes `--vb-*` onto `[data-vb-theme-root]` + updates `link[data-vb-theme-font]`.
   - **L2:** `BrandSection` passes `data.viewbookId` into `ContrastTester`, which subscribes to that viewbook's draft (else uses the persisted `theme` prop).
   - **Cleanup restores the last COMMITTED theme** (not the initial), avoiding stale previews across presentation toggles / client nav.
   - React-safe: the editor-activity registry blocks `router.refresh()` while dirty/saving; after the final PATCH, `commitThemeDraft(response)` runs BEFORE refresh so the server re-render writes the same values. **No merge-order dependency** — both build against the attribute/marker names.
3. **CSS var names** (canonical, unchanged): `--vb-primary`, `--vb-secondary`, `--vb-tertiary`, `--vb-on-primary/secondary/tertiary`, `--vb-heading-font`, `--vb-body-font`.
4. **`renderSection`/`SectionShell` props + `PublicSection` shape**: frozen for the duration.

## Coordination rules (er-seo-tools-multi-agent-coordination)

- **One worktree per lane** under `.claude/worktrees/` — `viewbook-l1`…`l4` on branches `feat/viewbook-l1`…`l4`. `git worktree list` pre-flight before opening any lane. **A second Claude session is live in this checkout — NEVER edit feature files on `main`; always in the lane worktree.**
- **Cross-review before every merge:** Codex branch → Claude reviews the diff; Claude branch → `/codex-review` (P1). Advisory; merge stays gate-green-only.
- **Gates per lane (inside its worktree):** `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`. L4 also runs `npx prisma migrate dev` locally; L2 runs `npm run audit:ci` if it changes deps/manifest generation.

## Codex budget posture (this push)

- Codex runs **full strength (`gpt-5.6-sol`, high)** for ALL work this push — reviews AND Lane 2/3 implementation — overriding the usual ≤25%-budget downgrade, **until usage is exhausted**. Kevin holds a reset (expires ~tonight) and resets on exhaustion; Codex then resumes the same lane.
- **Out-of-usage protocol (required):** every Codex invocation must detect the usage-exhausted/limit error and, on hit, **immediately PAUSE that lane and notify Kevin in one line** ("Codex out of usage — reset to resume Lane N"). NEVER silently retry, and NEVER downgrade the model. Goal: minimal dead time — Kevin resets, we re-fire the same lane brief. Claude does NOT take over Codex lanes.

## Post-Wave-1 integration gate (Codex plan-fix 9)

Each Wave-1 branch can pass its own gates while the OTHER half of the
marker/store contract is absent. So **after both L1 and L2 merge**, run one
integration pass on `main`: full gates + a browser check covering (a) live theme
colour change, (b) live font replacement, (c) presentation-mode offset change
(operator bar hidden → headers re-pin, no overlap), (d) sticky headers + no blink.
Only then open Wave 2.

## Definition of done (program)

All 4 lanes merged gate-green + cross-reviewed; the post-Wave-1 integration gate
passed; spec §13 test matrix covered;
migration applied (L4); docs moved to `archive/` per superpowers taxonomy; handoff
doc retired. Then: write the deferred **version-control** spec (spec §14).
