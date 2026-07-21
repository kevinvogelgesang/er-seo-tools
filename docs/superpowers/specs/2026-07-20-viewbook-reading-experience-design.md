# Viewbook reading-experience redesign — design spec

**Date:** 2026-07-20
**Branch/worktree:** `feat/vb-reading-experience`
**Scope:** public viewbook viewer only (`components/viewbook/public/*`, plus two pure files in `lib/viewbook/`). **No schema changes, no editor/admin changes, no new API routes.** Light-only (the public viewbook never participates in app dark mode). No new operator-authored data — all new copy is code-owned, keyed by `sectionKey`.

## 1. Problem & goal

Today every section renders through `SectionShell` as a **large brand photo hero (30–38vh) + an always-visible sticky header + a fully-expanded body**. With 4–7 sections per stage plus carried "Earlier steps", the page reads as a stack of equally-heavy full-bleed banners with no hierarchy and no sense of place.

Goal: **one continuous reading experience** with clear hierarchy —
- one substantial opening hero (~55–65vh) for the current stage's lead section,
- a compact "In this stage" overview of the current stage's sections,
- sequential sections with short (~220px) chapter heroes,
- a sticky section label that appears only after a section's hero scrolls away,
- a left rail with a strong active-chapter marker,
- "Previous stages" collapsed at the bottom as compact rows.

This is deliberately the **least-disruptive technical direction**: the page already renders sections sequentially through one `renderSection`, keeps the desktop rail open, and forces bodies expanded (`SECTION_TOGGLE_ENABLED = false`). Most of the work is hierarchy, sizing, active-state tracking, and code-owned copy.

## 2. Non-goals

- No Prisma migration; `PublicSection` gains no new fields.
- No operator-editable per-section purpose / "what we need" copy (explicitly deferred — code-owned this pass).
- No change to sync, ack, amendment, feedback, or any mutation flow.
- No re-introduction of the per-section collapse toggle (`SECTION_TOGGLE_ENABLED` stays `false`).
- The scroll controller must **never** drive collapse/height state (that was the blink bug — see §7).

## 3. Fixed facts this builds on

- **Section catalog** (`lib/viewbook/theme.ts` `SECTION_KEYS`, 13 keys): `welcome, milestones, data-source, brand, assessment, strategy, materials, pc-intro, pc-setup, pc-invite, pc-thanks, kickoff-next, ws-intro`.
- **Bookends** (`COLLAPSE_EXCLUDED_SECTION_KEYS`): `pc-intro`, `pc-thanks`.
- **Stages & lineups** (`lib/viewbook/stages.ts` `STAGE_LINEUPS`): each of the 4 stages has an ordered `primary[]` and `carried[]`. The **first entry of the current stage's `primary[]`** is the "lead" that gets the full hero.
- **Global content blocks** (`lib/viewbook/global-content-keys.ts`): `why`, `process` exist as operator content; **`credentials` does not** → code-owned.
- `SectionShell` (server) renders hero + `TickDivider` strip + `SectionReveal`. `SectionReveal` (client) is the sticky-header + body island, **state-only, no observer**. `TocRail` (client) already has a mobile FAB + bottom-sheet and done/acked glyphs but **no scroll-driven active state**. `EarlierSteps` (server) renders carried sections inside nested `<details>`.
- `navigateToAnchor(sectionKey, anchor)` (`viewbook-navigate.ts`) is the shared click-to-scroll primitive (dispatches `vb:navigate`, then rAF-scrolls + flashes). Unchanged.

## 4. Frozen interfaces (the contract lanes build against)

These MUST be implemented by Wave 1 (spine) exactly as written so Wave-2 lanes can build concurrently.

### 4.1 DOM contract (published by `SectionShell` / `SectionReveal`)

Every section root element:
```
<section id="{sectionKey}" data-vb-section="{sectionKey}" data-vb-status="{status}" data-vb-hero-visible="true">
```
- `data-vb-status` ∈ `complete | current | upcoming | needs-input` (from §4.3).
- `data-vb-hero-visible` seeds `"true"` server-side; the controller (lane A) flips it to `"false"` when the hero leaves the viewport. Presentational only.

Hero band gets a stable hook: `data-vb-hero` on the hero `<div>` (the element the controller observes).

Sticky-label bar (in `SectionReveal`) gets `data-vb-sticky-label`. Its **content fades** (opacity + `pointer-events`) while the owning section's `data-vb-hero-visible="true"`, and appears when `"false"`. The bar keeps its box (no layout shift); CSS drives the fade off the section ancestor's attribute:
```css
[data-vb-hero-visible="true"] [data-vb-sticky-label] { opacity: 0; pointer-events: none; }
```
(reduced-motion: no transition, same end states).

### 4.2 `lib/viewbook/section-copy.ts` (new, pure, client-safe)

```ts
export interface SectionCopy {
  purpose: string        // one sentence — chapter header + rail tooltip
  whatThis: string       // "What this is" — 1–2 sentences
  whatWeNeed: string | null  // "What we need from you" — null = nothing needed
  cta?: { label: string; sectionKey?: SectionKey } | null // optional primary action; scrolls to sectionKey (default self)
}
export const SECTION_COPY: Record<SectionKey, SectionCopy>
export const INPUT_EXPECTING_KEYS: ReadonlySet<SectionKey>
  // = { pc-setup, pc-invite, data-source, brand, assessment, materials }
```
Representative copy (final wording tuned in impl; every one of the 13 keys MUST be present):

| key | purpose | whatWeNeed |
|-----|---------|------------|
| pc-intro | Welcome to your viewbook. | null |
| pc-setup | Confirm your school's core details. | Fill in the org-basics fields. |
| pc-invite | Bring your team into the viewbook. | Invite the people who should collaborate. |
| data-source | Connect the analytics we'll report on. | Grant access to your analytics. |
| pc-thanks | You're all set for kickoff. | null |
| welcome | Meet your team and how we work. | null |
| milestones | The plan and where we are in it. | null |
| strategy | How we'll grow your enrollment. | null |
| brand | Your brand guidelines for the new site. | Share logos, colors, and brand rules. |
| assessment | What we found on your current site. | Review and add notes. |
| materials | Shared links and working files. | Add any links or files we should have. |
| ws-intro | What we build in this stage. | null |
| kickoff-next | Your next actions. | Complete the highlighted items. |

### 4.3 `lib/viewbook/section-status.ts` (new, pure, client-safe)

```ts
export type SectionStatus = 'complete' | 'current' | 'upcoming' | 'needs-input'

// Derived from the ORDERED current-stage primary lineup + each section's state.
// No scroll state. Rules, applied per section in primary order:
//   state === 'done'                                   -> 'complete'
//   active && INPUT_EXPECTING_KEYS.has(key)            -> 'needs-input'
//   first remaining non-complete, non-needs-input      -> 'current'
//   any later non-complete, non-needs-input            -> 'upcoming'
// Carried (previous-stage) sections: 'complete' if done, else 'current'.
export function computeSectionStatuses(
  primaryOrder: SectionKey[],
  sections: Pick<PublicSection,'sectionKey'|'state'>[],
): Record<SectionKey, SectionStatus>
```

### 4.4 `lib/viewbook/toc-index.ts` (spine extends; lanes A/B consume)

`TocEntry` gains `status: SectionStatus`. `buildTocIndex(data)` populates it via `computeSectionStatuses`. This is the ONLY status source the rail reads (lane B never recomputes).

### 4.5 New component props (spine declares import sites; lane D implements the files)

```ts
// StageOverview.tsx (new) — the "In this stage" strip
StageOverview({ items: { sectionKey; label; status; anchor }[] })

// PreviousStages.tsx (new, replaces EarlierSteps)
PreviousStages({ groups: { stageLabel: string; sections: PublicSection[] }[]; renderSection })

// SectionSummaryPanel.tsx (new)
SectionSummaryPanel({ whatThis: string; whatWeNeed: string | null; status: SectionStatus })
```

`ReadingProgressController.tsx` (new, lane A) takes **no props** — it queries `[data-vb-section]`/`[data-vb-hero]`/`[data-vb-toc-entry]` from the DOM and sets `data-vb-hero-visible` + `data-vb-active`.

## 5. Feature areas → files

1. **Hero hierarchy** — `SectionShell` gains `heroSize: 'full' | 'chapter' | 'none'` (full ≈ `min-h-[60vh]`, chapter ≈ `h-[220px]`, none = no hero band). `ViewbookShell` passes `'full'` to the current stage's lead primary section, `'chapter'` to the rest, `'none'` to carried sections rendered inside Previous stages.
2. **"In this stage" overview** — `StageOverview` below the lead hero; items = current stage primary sections (number · title · status glyph), click → `navigateToAnchor`.
3. **Chapter header + summary panel** — `SectionShell` renders a chapter-header block (number · title · one-sentence purpose · status pill · optional CTA) in the `TickDivider` strip zone; body opens with `SectionSummaryPanel`. Copy from `section-copy.ts`; status pill from `section-status.ts`.
4. **Status taxonomy** — `section-status.ts` (§4.3); `data-vb-status` on section root; pill in header; glyph in rail + overview.
5. **Scroll controller** — `ReadingProgressController` (§7).
6. **Rail active state** — `TocRail`: accent bar + filled marker on `[data-vb-active="true"]`; glyphs map to status (✓ complete · ring current/needs-input · dot upcoming); mobile FAB upgraded to a labeled "Sections" pill.
7. **Previous stages** — rename `EarlierSteps` → `PreviousStages`; group carried sections by origin stage (earliest stage where the key is `primary`, via a pure helper over `STAGE_LINEUPS`); compact rows, expand to full content with `heroSize='none'`.
8. **Welcome cards** — `WelcomeSection` split into labeled editorial cards: philosophy (`why` blocks) · credentials (code-owned ER copy) · contact (CSM) · team (roster) · process (`process` blocks).
9. **Next Steps CTA** — `KickoffNextSection` becomes an action summary with one clear CTA.
10. **Typography** — body prose containers constrained to ~68ch.

## 6. Delivery plan — spine, then 5 disjoint lanes

**Wave 1 — Spine (me, solo, lands first).** Publishes every §4 contract. Files: `ViewbookShell.tsx`, `SectionShell.tsx`, `SectionReveal.tsx`, `SummaryStat.tsx` (if reused), new `SectionSummaryPanel.tsx`, new `lib/viewbook/section-copy.ts`, new `lib/viewbook/section-status.ts`, `lib/viewbook/toc-index.ts` (add `status`), and the origin-stage helper. Wave 1 renders `StageOverview`/`PreviousStages` via their frozen props (lane D fills the component internals). Ships with everything green.

**Wave 2 — 5 lanes, exclusive files, built on Wave 1's contracts:**

| Lane | Exclusive files | Owner |
|------|-----------------|-------|
| A. Scroll controller | `ReadingProgressController.tsx` (new) | **Codex (Sol)** |
| B. Rail | `TocRail.tsx` | **Codex (Sol)** |
| C. Welcome cards | `WelcomeSection.tsx` (+ welcome copy const if any) | **Codex (Sol)** |
| D. Overview + Previous stages | `StageOverview.tsx` (new), `PreviousStages.tsx` (new) | **me** |
| E. Next Steps CTA | `KickoffNextSection.tsx` | **me** |

Lane A ↔ B share only the frozen `data-vb-active` attribute + rail-button selectors. Everything else is independent. Integration pass + `tsc --noEmit` + vitest at wave end. Each lane is its own PR onto the spine branch.

## 7. Scroll controller — blink-bug avoidance (critical)

The prior observer flipped `expanded` (a **height-mutating** collapse state) while observing the element whose height it changed → self-oscillation. The new controller:
- observes **`[data-vb-hero]`** (a stable element it never mutates),
- writes **only** presentational attributes: `data-vb-hero-visible` on the section root and `data-vb-active` on the matching rail button,
- **never touches** `expanded`, `grid-template-rows`, or any layout-affecting property,
- batches writes in `requestAnimationFrame`, respects `prefers-reduced-motion`, and no-ops under SSR / missing `IntersectionObserver`.
- Active section = the section whose hero/body most fills the viewport (rootMargin biased to the sticky offset). Falls back to the last section scrolled past.

## 8. Accessibility & correctness

- Exactly one `<h1>` (unchanged). Section titles stay `<h2>`; chapter number is decorative (`aria-hidden`), status conveyed by a visible text label, not color alone.
- Rail stays `role="navigation"` with roving tabindex; active marker is visual — the current item also gets `aria-current="true"`.
- Collapsed Previous-stages content stays `inert`/`aria-hidden` per existing pattern; `navigateToAnchor` already opens ancestor `<details>`.
- Sticky-label fade must not remove focusable controls from the tab order (it's opacity, not `display`); when hero-visible the bar carries `pointer-events:none` only.

## 9. Testing

- Pure units: `section-status.ts` (all four states, ordering, carried), origin-stage helper, `section-copy.ts` completeness (every `SECTION_KEYS` present).
- Component: `SectionShell` hero-size modes + `data-vb-*` attributes; `StageOverview`; `PreviousStages` grouping + rename; `TocRail` active marker + glyph mapping + mobile pill; `WelcomeSection` cards; `KickoffNextSection` CTA.
- Controller: jsdom-guarded no-op + attribute-write behavior with a mocked `IntersectionObserver`.
- Gate: `npx tsc --noEmit` + `vitest` green before each PR merges (in-build checks stay disabled per CLAUDE.md).

## 10. Risks

- **Layout shift** from the sticky-label fade — mitigated by fading content, not box (§4.1). Verify on chapter (220px) heroes with a tall viewport.
- **Controller churn** on fast scroll — rAF-batched, attribute-only; acceptable.
- **Lead-section identity** when the current stage's first primary is `pc-intro` (always-open) — it simply becomes the full hero; fine.
- Recommend a browser eyeball for animation feel / CLS before ship (no local `/verify` for viewbook per prior passes).
