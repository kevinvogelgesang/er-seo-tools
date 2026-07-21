# Continuous-reading viewer — design spec

**Date:** 2026-07-21
**Worktree/branch:** `.claude/worktrees/continuous-reading-viewer` / `feat/continuous-reading-viewer` (cut off `origin/main` @ `a1ad6c3`, 0 behind — freshness verified).
**Decision owner:** Kevin (locked). **Mode:** autonomous — spec → Codex → plan → Codex → TDD → one PR → deploy.
**Scope:** public viewbook viewer only (`components/viewbook/public/*` + a few pure `lib/viewbook/*` modules); Phase 2 adds ONE additive Prisma column + one admin control. Light-only (the public viewbook never participates in app dark mode — no `dark:` classes, all color via `--vb-*` tokens).

Design reference (NOT a merge source): the shelved `feat/vb-reading-experience` (PR #242) built this against an OLD viewer; this spec re-fits the idea to CURRENT main.

---

## 1. Problem & goal

**The decision (locked by Kevin):** make the public viewbook read as **one continuous, hierarchy-driven reading experience**, and make the current **collapse-first viewer (collapse / morph / welcome-auto-reveal) DORMANT** — kept in code, gated off the active path, not deleted.

- **Default experience = continuous-reading** for every viewbook.
- **Collapse-first goes dormant** — same spirit as prior dormant reversals (`collapsedShared` column, retired client schedules): the code stays, gated off by a mode check.
- **STRETCH (Phase 2, a SEPARATE follow-up PR): a per-viewbook `viewerMode` toggle** (`'continuous' | 'collapse'`, default `'continuous'`) so an operator can switch a single viewbook back to collapse-first. **Phase 1 (continuous default) ships and deploys FIRST as its own PR + prod-verify; Phase 2 is a separate optional PR built only after Phase 1 is live and only if it stays clean** (Codex fix #4 — resolves the earlier "one PR" contradiction; matches the decision doc's "separable second phase" language). This is the disciplined interpretation of Kevin's locked decision.

**Today's viewer (what continuous replaces as the active path):** every section renders through `SectionShell` (server) which builds two hero faces and delegates to the `CollapsibleSection` client island (a spread/morph collapse-to-hero card, per-machine `localStorage`, default collapsed, welcome auto-reveal once/device) wrapping `SectionReveal` (state-only body; `SECTION_TOGGLE_ENABLED = false`, so bodies always render expanded). `ViewbookShell` renders `ProgressNav` + `primarySections.map(renderSection)` + one outer `EarlierSteps` band (carried sections) + `TocRail` + `StickyOffsetProbe`. Sections read as a stack of equally-heavy morph cards with no reading hierarchy and no sense of place.

**Goal — continuous-reading (design intent):**
- one substantial **full hero** (~55–65vh) for the current stage's **lead** section (index 0 of the rendered primary lineup),
- an **"In this stage" overview** strip below the lead,
- the remaining sections as sequential chapters with short (~220px) **chapter heroes**,
- a **hero-exit sticky label** per section (appears only after the section's hero scrolls past the activation line),
- a left/right **rail with a strong scroll-driven active marker**,
- **"Previous stages"** (carried sections) as compact, expandable rows grouped by origin stage,
- ~**68ch** prose measure, the already-shipped **guidance panel** ("What this is / What we need") + **Next-Steps** action summary + CTA,
- a labeled mobile **"Sections"** affordance (the existing TOC FAB/sheet).

---

## 2. Non-goals

- **No deletion of the collapse-first viewer.** `CollapsibleSection`, `CollapseAffordance`, `useCollapseState`, `useWelcomeAutoReveal`, `EarlierSteps`, the morph CSS, and the presentation-config morph/affordance/pacing controls all remain, gated behind `viewerMode === 'collapse'`.
- **No re-introduction of the per-section collapse toggle** in continuous mode (`SECTION_TOGGLE_ENABLED` stays `false`; continuous bodies are always expanded).
- **No new operator-authored copy.** All new reading copy is code-owned (`SECTION_COPY`, already shipped in PR #243) keyed by `sectionKey`.
- **No change to sync / ack / amendment / feedback / any mutation flow**, and **no change to the operator (Context Lens) editing layer** beyond the Phase-2 `viewerMode` control.
- **No AI/LLM API.** (House rule.)
- The scroll controller must **never** drive collapse/height/React state (the documented "blink bug" — see §8).
- Phase 1 ships **no migration** (dormancy is a code default). Phase 2 adds exactly ONE additive nullable-defaulted column.

---

## 3. Fixed facts this builds on (current main)

- **Section catalog** (`lib/viewbook/theme.ts` `SECTION_KEYS`, 13): `welcome, milestones, data-source, brand, assessment, strategy, materials, pc-intro, pc-setup, pc-invite, pc-thanks, kickoff-next, ws-intro`.
- **`PublicSection.state` is `'active' | 'done'` ONLY** (`public-types.ts`). The `'collapsed'` enum the shelved branch used is **retired** — no continuous-mode logic keys off it.
- **Stages & lineups** (`lib/viewbook/stages.ts` `STAGE_LINEUPS`): 4 stages, each with ordered `primary[]` + `carried[]`. `STAGE_LABELS` maps stage→label. The **first entry of the rendered primary lineup** is the continuous "lead".
- **Already shipped in PR #243, reused unchanged:** `lib/viewbook/section-copy.ts` (`SECTION_COPY` for all 13 keys incl. `whatThis`/`whatWeNeed`/`INPUT_EXPECTING_KEYS`, and a `cta` on `pc-setup`), `components/viewbook/public/SectionSummaryPanel.tsx` (the guidance panel, currently `{whatThis, whatWeNeed}`), `ChapterCtaButton.tsx` (client CTA leaf → `navigateToAnchor`), and the `KickoffNextSection` action-summary + CTA.
- **`StickyOffsetProbe`** already measures `#vb-progress-nav` + `#vb-operator-bar` and publishes `--vb-progress-nav-height`/`--vb-operator-bar-height`/`--vb-sticky-offset` to the theme root + `documentElement`. It does **not** yet emit a change event (this spec adds one — §5.6).
- **`SectionReveal`** is deliberately observer-free (the blink-bug fix) — a regression test guards against ever constructing an `IntersectionObserver` there.
- **`TocRail`** renders top-level entries with `data-vb-toc-entry` + `data-anchor` (NO `data-vb-toc-section` yet), a done/acked glyph, desktop rail + mobile FAB/sheet, and has **no scroll-driven active state** today.
- **`navigateToAnchor(sectionKey, anchor)`** (`viewbook-navigate.ts`) is the shared click-to-scroll primitive (dispatches `vb:navigate`, rAF-scrolls, flashes). Unchanged.
- **Presentation config** (`lib/viewbook/presentation-config.ts`) is the established pattern for per-viewbook viewer knobs: `PRESENTATION_DEFAULTS` + strict `parsePresentationPatch` (400 on malformed) + fail-soft `readPresentationConfig` (degrades to defaults). Spread into `ViewbookPublicData` by `public-data.ts` and into the operator read model by `operator-data.ts`; edited via `components/viewbook/admin/PresentationEditor.tsx` → PATCH `app/api/viewbooks/[id]/route.ts`.
- **Gate:** `npx tsc --noEmit` && `npx vitest run` (viewbook scope at minimum) — in-build type-check/lint stay disabled (CLAUDE.md); local gates are the only gate. Baseline on this worktree is green (tsc clean; full viewbook suite passes).

---

## 4. Architecture — mode-gated composition

`viewerMode: 'continuous' | 'collapse'` is a first-class field on `ViewbookPublicData` **from Phase 1**, resolved by `readPresentationConfig` with **default `'continuous'`**. In Phase 1 there is no DB column, so the loader always yields `'continuous'`; Phase 2 adds the `Viewbook.viewerMode` column and the read-side (already wired) picks it up. This makes dormancy a real, testable code path from day one and makes the toggle a thin additive follow-up.

**`ViewerMode` type** lives in `presentation-config.ts` (`export const VIEWER_MODES = ['continuous','collapse'] as const; export type ViewerMode = ...`) alongside the other presentation kinds.

**`SectionShell` branches on `viewerMode`:**
- `'continuous'` (default, active) → the new render path: hero band sized by `meta.heroSize` (full/chapter/none), a chapter header strip (number · purpose · status pill · optional CTA), and a `SectionReveal` body (always expanded) that opens with `SectionSummaryPanel` + intro note (~68ch) + `children`. **No `CollapsibleSection`.**
- `'collapse'` (dormant) → the **existing** code, byte-for-byte: `CollapsibleSection`(morph)→`SectionReveal`, `heroExpanded`/`heroCollapsed`, `autoRevealMs`, the `collapsible ? … : …` seam. `meta` is ignored in this branch.

**`ViewbookShell` branches on `data.viewerMode`:**
- `'continuous'` → mounts `ReadingProgressController` (once); renders the **lead** section (meta `heroSize:'full'`, `isLead:true`, `chapterNumber:1`), then `StageOverview`, then the remaining primaries as chapters (`heroSize:'chapter'`), then `PreviousStages` (carried, `heroSize:'none'`).
- `'collapse'` (dormant) → the **existing** layout: `primarySections.map(renderSection)` + `EarlierSteps`, no controller/overview/previous-stages. `renderSection` still receives a (collapse-mode) meta so the uniform signature holds; the collapse `SectionShell` branch ignores it.

`StickyOffsetProbe` mounts once in **both** modes (it drives sticky offsets for the header/anchors regardless).

**`renderSection` widens to `(s: PublicSection, meta: SectionRenderMeta) => ReactNode`** (uniform across modes). `page.tsx`'s `baseRenderSection`/`wrappedRenderSection` gain the `meta` param and forward it to the section component; each of the 13 section components accepts `meta` and forwards it to `SectionShell`. The operator wrapper composes at the rendered-node level and does **not** consume `meta` (Codex fix from the shelved design — only `page.tsx`'s two callbacks change, not `OperatorLayer/*`).

**Dormant-mode carried rendering:** `ViewbookShell` passes `EarlierSteps` a one-arg `renderSection={(s) => renderSection(s, carriedMeta(s))}` adapter, so `EarlierSteps` is untouched.

**One canonical rendered lineup (Codex fix #6).** `ViewbookShell` MUST derive rendering, status computation, `StageOverview`, `PreviousStages`, and the TOC from the **same** arrays — `data.primarySections` / `data.carriedSections`. The lead is always `data.primarySections[0]`; `computeSectionStatuses(data.primarySections.map(s=>s.sectionKey), data.primarySections, {pcCompletedAt})` feeds both the chapter meta AND the overview; `buildTocIndex(data)` reads `data.primarySections`. The `primarySections`/`carriedSections` component props (passed by `page.tsx`) are exactly `data.primarySections`/`data.carriedSections` — to remove any drift risk, `ViewbookShell` reads them off `data` directly and the redundant props are dropped (or asserted equal). Lead / status / rail can never diverge.

---

## 5. Frozen interfaces (the contracts the build holds)

### 5.1 `lib/viewbook/section-status.ts` (new, pure, client-safe)

```ts
export type SectionStatus = 'complete' | 'current' | 'upcoming' | 'needs-input'

export interface SectionRenderMeta {
  heroSize: 'full' | 'chapter' | 'none'
  chapterNumber: number | null   // 1-based position in the rendered primary lineup; null for carried
  status: SectionStatus
  isLead: boolean                // the one full-hero lead section
}

export function computeSectionStatuses(
  renderedPrimaryOrder: SectionKey[],
  sections: Pick<PublicSection,'sectionKey'|'state'|'acknowledgedAt'>[],
  ctx: { pcCompletedAt: string | null },
): Partial<Record<SectionKey, SectionStatus>>

export function carriedStatus(section: Pick<PublicSection,'state'>): SectionStatus
```

**`SectionRenderMeta` is defined HERE** (not `public-types.ts`) to keep `public-types.ts` cycle-free; all consumers import it from `section-status`.

`computeSectionStatuses` rules (iterate `renderedPrimaryOrder`, look each key up in a map of `sections`; a single `currentAssigned` flag → the FIRST non-terminal section is `'current'`, every later non-terminal is `'upcoming'`, so there is exactly one `current`):
- `pc-intro`: `ctx.pcCompletedAt != null` → `'complete'`; else runs the current/upcoming progression (consumes the single current slot).
- `pc-thanks`: runs the progression (only rendered when `pcCompletedAt != null`).
- `state === 'done'` → `'complete'`.
- `state === 'active' && acknowledgedAt != null` → `'complete'` (a settled input section never keeps saying needs-input).
- `state === 'active' && INPUT_EXPECTING_KEYS.has(key)` → `'needs-input'` (import from `./section-copy`).
- otherwise (any other active section) → progression (`current`/`upcoming`).
- An all-complete lineup fabricates **no** `current`. Returns a **partial** map — a key not in `sections` is absent, never defaulted.

`carriedStatus`: `state === 'done' ? 'complete' : 'current'`.

> Adapted from the shelved branch: the retired `'collapsed'` value simply doesn't exist on main, so the "collapsed informational section" case collapses into the ordinary `active` progression. No hard branch on `'collapsed'` anywhere. Test fixtures use `'active' | 'done'` only.
>
> **Intended behavior (Codex verify item):** a `needs-input` section does NOT consume the single `current` slot — so a stage can legitimately read "Needs input" (an input-expecting section) followed by "Current" (the first non-input active section). This is deliberate: `needs-input` is a call-to-action status distinct from "where you are in the flow". Keep this semantics (it matches the shelved, previously-Codex-reviewed logic). If Kevin wants needs-input to instead swallow the current slot, that's a one-line change here — flag it, don't assume.

### 5.2 `lib/viewbook/section-origin.ts` (new, pure, client-safe)

```ts
export function originStageOf(key: SectionKey): ViewbookStage | null
export function groupCarriedByOrigin(sections: PublicSection[]): { stageLabel: string; sections: PublicSection[] }[]
```
`originStageOf` returns the first stage (canonical `VIEWBOOK_STAGES` order) whose `STAGE_LINEUPS[stage].primary` includes the key, else `null`. `groupCarriedByOrigin` buckets by origin (skipping no-origin keys), emits buckets in canonical stage order, maps to `{ stageLabel: STAGE_LABELS[stage], sections }`, preserving input order within a bucket. No `'collapsed'` coupling.

### 5.3 `lib/viewbook/section-copy.ts` (exists — reuse as-is)

Already provides `SECTION_COPY` (all 13 keys, `purpose`/`whatThis`/`whatWeNeed`, `cta` on `pc-setup`) + `INPUT_EXPECTING_KEYS`. No change needed. (If a chapter-header CTA for another key is wanted later it is a copy-only edit here.)

### 5.4 DOM contract (published by `SectionShell` / `SectionReveal` / `TocRail`, consumed by `ReadingProgressController`)

Section root (continuous mode) `<section>`:
```
id="{sectionKey}"  data-vb-section="{sectionKey}"  data-vb-status="{status}"  data-vb-hero-visible="{seed}"
style="scroll-margin-top: calc(var(--vb-sticky-offset,0px) + 12px)"
```
- `data-vb-status` ∈ `complete | current | upcoming | needs-input`.
- `data-vb-hero-visible` **seed**: `"true"` when the section HAS a hero (`heroSize !== 'none'`), `"false"` when it has none (nothing to observe → its sticky label must be usable immediately). The controller flips a real hero to `"false"` once it exits.
- Hero band gets `data-vb-hero` on the observed `<div>`; no-hero sections emit no `[data-vb-hero]`.

Sticky-label (continuous mode, in `SectionReveal`): a **fixed-height** sticky bar whose only title content is a dedicated inner **duplicate label** `data-vb-sticky-label` — `aria-hidden="true"`, text-only, NO links/buttons. CSS fades ONLY that inner node off the ancestor's attribute, so the bar box never changes height (zero CLS) and nothing focusable is ever hidden:
```css
[data-vb-sticky-label] { opacity: 0; transition: opacity 200ms ease; }
[data-vb-hero-visible="false"] [data-vb-sticky-label] { opacity: 1; }
```
(reduced-motion: no transition, same end states). Seeded `data-vb-hero-visible="true"` ⇒ label hidden while the hero is in view; controller flips to `"false"` on hero exit ⇒ label fades in. A no-hero section seeds `"false"` ⇒ label visible.

TOC rail top-level buttons carry `data-vb-toc-section="{sectionKey}"` (child/verbose sub-entries do NOT). The controller matches on it and sets/removes BOTH `data-vb-active="true"` and `aria-current="location"` on the LIVE matching node.

### 5.5 New component props + Phase-1 stubs

Phase 1 creates minimal compiling **stubs** of the three new lane-ish components first (so `ViewbookShell` wires + compiles green), then fills them in:

```ts
// StageOverview.tsx — 'use client' leaf ('In this stage' strip)
StageOverview({ items: { sectionKey: SectionKey; label: string; status: SectionStatus; anchor: string }[] })
//   returns null when items empty; each item → a <button> onClick navigateToAnchor(sectionKey, anchor)
//   with a numbered badge, truncated label, and <StatusPill status/>. nav[aria-label="In this stage"].

// PreviousStages.tsx — SERVER component (takes a renderSection FUNCTION prop → must NOT be 'use client')
PreviousStages({ groups: { stageLabel: string; sections: PublicSection[] }[];
                 renderSection: (s: PublicSection, meta: SectionRenderMeta) => ReactNode })
//   returns null when groups empty; section[aria-label="Previous stages"]; per group an <h3> stageLabel;
//   per section an ExpandableRow: <details> summary (✓ when done · title · <StatusPill status={carriedStatus(s)}/>
//   · chevron) whose body = renderSection(s, { heroSize:'none', chapterNumber:null, status:carriedStatus(s), isLead:false }).
//   (No CompactRow — the shelved compact/expandable split keyed on the retired 'collapsed'; all carried are expandable.)

// SectionSummaryPanel.tsx (EXTEND the shipped file): add optional `status?: SectionStatus` +
//   export a `StatusPill({ status })` (visible text label, never color-alone) reused by StageOverview + PreviousStages + the chapter header.

// ReadingProgressController.tsx — 'use client', returns null, NO props (queries the DOM).
```

### 5.6 `StickyOffsetProbe` event seam (extend the shipped file)

After each `recompute()`, dispatch a window event so the controller can rebuild its observer when the sticky offset changes (e.g. the operator bar mounts, or the nav wraps to two rows on narrow viewports — `rootMargin` cannot consume a CSS var live):
```ts
window.dispatchEvent(new CustomEvent('vb:sticky-offset-change', { detail: { offset } }))  // offset = summed sticky px; wrapped in try/catch, never throws
```
CSS-var publishing is unchanged. This is purely additive (existing tests keep passing; one new test asserts the event fires with `detail.offset`).

---

## 6. Scroll controller — `ReadingProgressController` (blink-bug avoidance, §8 critical)

`'use client'`, returns `null`, mounted once by `ViewbookShell` in continuous mode. Writes **only** presentational attributes; never React state, never height/collapse.

- Selectors: `[data-vb-section]`, `[data-vb-hero]`, `[data-vb-toc-section]`.
- `stickyOffset()` reads `--vb-sticky-offset` off `documentElement` (float, ≥0, else 0).
- **No `IntersectionObserver`** available (or SSR) → `setFallbackVisibility()` sets every section `data-vb-hero-visible="false"` (labels usable) and bails (no active tracking).
- **`buildObserver()`**: `activationLine = stickyOffset()`; disconnect any prior observer; `heroes = [...querySelectorAll('[data-vb-hero]')]`; `new IntersectionObserver(() => commit(heroes, activationLine), { rootMargin: `-${activationLine}px 0px 0px 0px`, threshold: [0,1] })`; observe each hero; `commit(...)` immediately.
- **`commit(heroes, activationLine)`**: rAF-coalesced (keep only newest snapshot). For each hero read `getBoundingClientRect()`; set that hero's section `data-vb-hero-visible = rect.bottom > activationLine ? 'true' : 'false'`; if `rect.top <= activationLine`, promote its section to `activeSection` (the LAST hero whose top crossed the line wins; before any cross → first section). Then re-query ALL `[data-vb-toc-section]` fresh, clear `data-vb-active`/`aria-current` from all, and set `data-vb-active="true"` + `aria-current="location"` on the one whose `data-vb-toc-section` equals the active section key. **The rail node is LIVE-QUERIED every commit** (never cached — `TocRail` may swap desktop rail ↔ mobile sheet).
- **`vb:sticky-offset-change`**: read `detail.offset`; if finite AND `=== lastBuiltOffset`, no-op (dedup); else `buildObserver()`.
- **Rail-replacement invalidation (Codex fix #2):** live-querying the rail *only inside IO-triggered commits* leaves the active marker stale when `TocRail` swaps its desktop rail ↔ mobile sheet on a viewport change **without** any scroll/IO callback firing. The controller therefore also mounts a `MutationObserver` on `document.body` (`subtree:true, childList:true`, the same pattern `StickyOffsetProbe` uses for the operator bar) that schedules a rAF-coalesced re-commit whenever `[data-vb-toc-section]` nodes are added/removed — so a rail swap (or a re-mount) re-applies `data-vb-active`/`aria-current` to the live node without requiring a scroll. Debounced through the same rAF path as `commit`.
- **Empty-lineup safety (Codex fix #2):** `commit()` must be a safe no-op when there are zero `[data-vb-hero]` and/or zero `[data-vb-section]` (an operator can hide every primary section): it clears `data-vb-active`/`aria-current` from all rail nodes and returns without dereferencing a missing "first hero". No throw, no active marker.
- Cleanup: disconnect the IntersectionObserver AND the MutationObserver, clear pending rAF, remove the `vb:sticky-offset-change` listener.

**Active algorithm is deterministic** (last-hero-crossed-the-line), so the controller and rail never disagree. It observes `[data-vb-hero]` (a stable element it never mutates) and writes only `data-vb-*`/`aria-current` — never `expanded`, `grid-template-rows`, or any layout property.

---

## 7. Feature areas → files

**New pure modules (`lib/viewbook/`):** `section-status.ts`, `section-origin.ts`.

**New components (`components/viewbook/public/`):** `StageOverview.tsx`, `PreviousStages.tsx`, `ReadingProgressController.tsx`.

**Extended:** `SectionSummaryPanel.tsx` (+`status`/`StatusPill`), `presentation-config.ts` (+`VIEWER_MODES`/`ViewerMode`, default `'continuous'` in `PRESENTATION_DEFAULTS`/`readPresentationConfig`; Phase 2 adds parse validation), `public-types.ts` (`ViewbookPublicData.viewerMode`), `StickyOffsetProbe.tsx` (event). **`toc-index.ts` is NOT changed** — the `TocEntry.status` addition is dropped (decision, post-Codex): the rail keeps its existing done/acked glyphs; the ONLY rail change is `data-vb-toc-section` + the active-marker (`data-vb-active`) styling, which need no `TocEntry` field. This removes the fixture churn Codex fix #3 flagged for `TocEntry`.

**Mode-branched (spine):** `SectionShell.tsx` (meta + `viewerMode`; continuous branch, existing collapse branch preserved), `SectionReveal.tsx` (add a continuous sticky-label mode via a prop, default = current collapse behavior so the dormant path is untouched), `ViewbookShell.tsx` (branch; continuous wiring), `app/(public)/viewbook/[token]/page.tsx` (widen both render callbacks — pass `meta`), **all 13 section components** (accept + forward `meta`), and **`components/viewbook/admin/ThemePreview.tsx`** (Codex fix #3 — the ONE non-section direct `SectionShell` caller: it previews the collapse-affordance/morph controls, so it must pass `viewerMode='collapse'` + an explicit `meta` (`{heroSize:'chapter', chapterNumber:1, status:'current', isLead:false}`) to keep previewing the dormant path; `SAMPLE_SECTION` + `previewMode` unchanged).

**Untouched (dormant path, kept):** `CollapsibleSection.tsx`, `CollapseAffordance.tsx`, `useCollapseState.ts`, `useWelcomeAutoReveal.ts`, `EarlierSteps.tsx`, `section-display.ts`.

**Phase 2 only (Codex fix #1 — the FULL `viewerMode` write/persist lifecycle, not just the read side):**
- `prisma/schema.prisma` (`Viewbook.viewerMode String @default("continuous")`) + migration (`npx prisma migrate dev`).
- `presentation-config.ts` — `parsePresentationPatch` validates `viewerMode` (strict: `400 invalid_viewer_mode` on a non-member). (`readPresentationConfig`/`PRESENTATION_DEFAULTS` already handle read + default from Phase 1.)
- `lib/viewbook/service.ts` — `updateViewbookPresentation` patch type/persist path must accept `viewerMode` (grep how `collapseMorph` threads through it) so a PATCH actually writes the column and bumps `syncVersion`.
- `operator-data.ts` — add `viewerMode` to the explicit Prisma `select` AND the operator read-model interface (the public loader gets the full row via `requireViewbookToken` and needs no select change; the operator read model uses an explicit select and DOES).
- `components/viewbook/admin/PresentationEditor.tsx` (+ `viewbook-admin-shared.ts` config) — the operator control (a 2-option toggle), single atomic PATCH + sync bump, mirroring the other presentation fields.
- `app/api/viewbooks/[id]/route.ts` — already routes presentation patches through `parsePresentationPatch`; inherits `viewerMode` once the parser validates it (verify the PATCH path persists via `updateViewbookPresentation`).
- **Tests:** strict-read (unknown/absent → `'continuous'`), strict-write (`400` on bad value), persistence (PATCH writes the column + bumps `syncVersion`), and the operator-read-model select exposing it.

---

## 8. Blink-bug avoidance (why this controller is safe)

The prior observer flipped `expanded` (a height-mutating collapse state) on the element whose height it changed → self-oscillation. This controller:
- observes `[data-vb-hero]` (stable, never mutated),
- writes only `data-vb-hero-visible` (section root) + `data-vb-active`/`aria-current` (rail node),
- never touches `expanded`/`grid-template-rows`/any layout property,
- rAF-batches, respects `prefers-reduced-motion` (the sticky-label fade is a CSS transition with a reduced-motion override),
- rebuilds (not live-mutates) `rootMargin` on `vb:sticky-offset-change`.

`SectionReveal`'s "never construct an IntersectionObserver" regression test stays green — the controller is a **separate** component.

---

## 9. Accessibility & correctness

- Exactly one `<h1>` (`ViewbookShell`, sr-only). Section titles stay `<h2>`; chapter number is decorative (`aria-hidden`); status is a **visible text** `StatusPill`, never color-alone.
- Rail stays `role="navigation"` with roving tabindex; the active marker is visual + `aria-current="location"` on the live node (set/removed by the controller).
- The faded sticky label is an `aria-hidden` duplicate with **no focusable controls**, so nothing tabbable is ever hidden and the title is announced once (the real interactive header keeps a constant box and is never faded).
- `PreviousStages` uses native `<details>/<summary>` (no client JS); `navigateToAnchor` already opens ancestor `<details>` and force-opens the target `SectionReveal`.
- Continuous bodies are always expanded (`SECTION_TOGGLE_ENABLED=false`), so there is no collapsed-but-tabbable region in continuous mode.

---

## 10. Testing & gate

- **Pure units:** `section-status` (done→complete, first-active→current/later→upcoming, `acknowledgedAt`→complete, `INPUT_EXPECTING_KEYS`→needs-input, pc-intro/pc-thanks via `pcCompletedAt`, all-complete fabricates no current, partial map, `carriedStatus`); `section-origin` (`originStageOf` + `groupCarriedByOrigin` ordering by canonical stage). Fixtures use `'active' | 'done'` only.
- **Components:** `StageOverview` (nav, one button/item, number+status text, click→navigate, empty→null); `PreviousStages` (grouping + heading, `renderSection` called with `heroSize:'none'` meta, empty→null); extended `SectionSummaryPanel`/`StatusPill`; `SectionShell` continuous mode (hero sizing full/chapter/none, `data-vb-*` contract, chapter header + CTA, body) **and** collapse mode (existing assertions, now with explicit `viewerMode='collapse'`); `SectionReveal` continuous sticky-label (`data-vb-sticky-label` inert, no `a`/`button` inside) **and** default collapse behavior (existing tests unchanged); `ViewbookShell` continuous wiring (lead + overview + previous-stages + controller mount) and collapse wiring (EarlierSteps); `TocRail` (`data-vb-toc-section` on top-level buttons + active-marker styling); `StickyOffsetProbe` new event; `page.test.tsx` (meta signature).
- **Controller:** jsdom with a faked `IntersectionObserver` + `getBoundingClientRect` + synchronous rAF — IO-unavailable fallback, hero-visible flip, last-crossed active pick (exactly one active), live rail re-query after node replacement, `rootMargin` from offset + dedup on repeat `vb:sticky-offset-change`, **rail-swap re-commit via `MutationObserver` WITHOUT an IO callback (Codex fix #2)**, and **zero-hero / zero-section no-op** (clears active, no throw).
- **Dormant-caller fixtures (Codex fix #3):** `ThemePreview.test.tsx` continues to assert the collapse preview (now via explicit `viewerMode='collapse'` + `meta`); any section-component/`SectionShell` fixture that asserts collapse behavior passes an explicit `viewerMode='collapse'`. New continuous fixtures are the default (no `viewerMode` → resolves to `'continuous'`).
- **House rules:** NO jest-dom (DOM-native asserts: `querySelector` + `.toBeTruthy()`/`.toBeNull()`, `textContent`, `getAttribute`); RTL/jsdom test files start with `// @vitest-environment jsdom`; light-only; `'use client'` components never receive a function prop (`PreviousStages` is a server component; `StageOverview`/`ReadingProgressController` are client leaves with serializable props); array-form `$transaction` only (Phase-2 PATCH goes through the existing route kit — no new transaction).
- **Gate every step:** `npx tsc --noEmit` && `npx vitest run` green (viewbook scope at minimum; full run before PR).

---

## 11. Dormancy — what stays and how it's gated

- The collapse-first viewer is reached **only** when `viewerMode === 'collapse'`. In Phase 1 `readPresentationConfig` always returns `'continuous'` (no column), so the collapse branch is dormant but **compiled and unit-tested** (SectionShell/ViewbookShell collapse-mode tests pass an explicit `'collapse'`). This satisfies "kept in code, gated off, not deleted" and keeps the dormant path from bit-rotting.
- Phase 2 makes `'collapse'` **reachable** per-viewbook via the `viewerMode` column + `PresentationEditor` control. Existing rows default to `'continuous'` (Kevin wants continuous to be THE experience). Read degrades strictly (unknown stored value → `'continuous'`), mirroring the other presentation fields; write is strict (`400 invalid_viewer_mode`).
- **Dormant-path assurance at the exposure point (Codex fix #5):** because the collapse path does not run in production during Phase 1, **before the Phase-2 toggle ships** it must be proven end-to-end, not just unit-tested: (a) a component/integration test that renders a public viewbook with `viewerMode='collapse'` and asserts the `CollapsibleSection` island + `EarlierSteps` render (expand + `vb:navigate` deep-link force-open still work); and (b) a **browser eyeball** of a real collapse-mode viewbook (Kevin's, post-deploy of Phase 2). This prevents the new toggle from surfacing a silently stale path to a client. The `ThemePreview` collapse render (which stays collapse-mode) also exercises the dormant path continuously in the admin.

---

## 12. Risks & mitigations

- **Wide mechanical change** (renderSection signature + 13 sections + several tests) → do it as ONE atomic spine task with `tsc` as the tripwire; the 13-section edit is pure prop-forwarding.
- **Existing collapse tests break under a continuous default** → each collapse-specific test explicitly passes `viewerMode='collapse'`; new continuous tests are added alongside. `SectionReveal`'s new mode defaults to current behavior so its existing suite is untouched.
- **Layout shift from the sticky label** → eliminated by design: fixed-height bar, only an inner duplicate label fades (§5.4).
- **Controller churn on fast scroll** → rAF-batched, attribute-only.
- **Lead is `pc-intro` (always-open)** → simply becomes the full hero; fine.
- **No local `/verify` for viewbook** → prod verification is a browser eyeball (Kevin's) after deploy; this spec's automated gate is tsc + vitest.

---

## 13. Prod verification (post-deploy)

`git push` FIRST, then `ssh $PROD_SSH "~/deploy.sh"` (source `.claude/ops-secrets.local.sh`). Verify: app health 200; deployed HEAD == merge commit; migration applied (Phase 2). Eyeball: pull a live token on the server (`node -e` + prisma `viewbook.findFirst({ where: { revokedAt: null } })`) and fetch `http://localhost:3000/viewbook/<token>` — confirm continuous render (full lead hero, In-this-stage strip, chapter heroes, previous-stages rows, active-rail marker, hero-exit sticky label). Animation/CLS/active-rail feel is Kevin's browser eyeball.

---

## 14. Sequence

**Phase 1 — continuous default (ships first, no migration):**
1. Pure modules: `section-status.ts`, `section-origin.ts` (+ tests). Extend `section-copy` — none needed (reuse).
2. `presentation-config.ts` `VIEWER_MODES`/`ViewerMode` + default; `public-types.ts` `viewerMode`; `public-data.ts` already spreads `readPresentationConfig`.
3. Extend `SectionSummaryPanel` (`status` + `StatusPill`); stubs for `StageOverview`/`PreviousStages`/`ReadingProgressController`; `StickyOffsetProbe` event.
4. Spine: widen `renderSection` (`page.tsx` + 13 sections), `SectionShell` (meta + `viewerMode` continuous branch + preserved collapse branch), `SectionReveal` (continuous sticky-label mode), `ViewbookShell` (branch + continuous wiring), `toc-index` `status`, `TocRail` (`data-vb-toc-section` + active styling). Fill in the three stub components + the controller.
5. Update existing tests for the mode branch; add continuous tests. Gate green.

**Ship Phase 1 (Codex fix #4):** ONE PR (Phase 1 only) → main → push → `ssh $PROD_SSH "~/deploy.sh"` → prod-verify (§13) → browser eyeball. Update memory `project_viewbook_reading_experience` + `docs/superpowers` on ship. **Phase 1 is the shipping increment; do NOT block it on Phase 2.**

**Phase 2 — `viewerMode` toggle (stretch; a SEPARATE follow-up PR, only after Phase 1 is live + verified, only if clean):**
6. Migration `Viewbook.viewerMode`; `parsePresentationPatch` validation; `service.ts updateViewbookPresentation`; `operator-data.ts` select+interface; `PresentationEditor` control (§7 Phase-2 list). Full lifecycle tests (§10) + the dormant-path assurance render (§11 fix #5). Gate green → its own PR → deploy → collapse-mode browser eyeball before relying on the toggle.

Per Kevin's global CLAUDE.md: route this spec AND the plan through Codex (`consulting-codex`) — notify, apply named fixes, proceed; don't gate on Kevin. Codex consults ≤5 min else subagent.
