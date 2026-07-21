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

### 4.0 Render-metadata threading (Codex fix #1 — spine)

Today `renderSection` is one-argument (`baseRenderSection`/`wrappedRenderSection` in `app/(public)/viewbook/[token]/page.tsx`), and each leaf section component owns its own `SectionShell` internally — so the shell cannot inject hero size / status / chapter number without a threading contract. Widen it:

```ts
export interface SectionRenderMeta {
  heroSize: 'full' | 'chapter' | 'none'
  chapterNumber: number | null   // 1-based position in the current stage's RENDERED primary lineup; null for carried/bookend
  status: SectionStatus
  isLead: boolean                // the one full-hero lead section
}
// renderSection widens: (section: PublicSection, meta: SectionRenderMeta) => ReactNode
```

`ViewbookShell` computes `meta` per section and passes it. **Every leaf section component forwards `meta` to `SectionShell`.** The operator wrapper (`wrappedRenderSection` + `OperatorLayer`) forwards `meta` unchanged. Wave-1 therefore owns `page.tsx` (both render callbacks), **all 13 section components**, and the `OperatorLayer` wrapper — see the §6 file list. This is the change that makes the Wave-2 lanes genuinely disjoint.

### 4.1 DOM contract (published by `SectionShell` / `SectionReveal`)

Every section root element:
```
<section id="{sectionKey}" data-vb-section="{sectionKey}" data-vb-status="{status}" data-vb-hero-visible="{seed}">
```
- `data-vb-status` ∈ `complete | current | upcoming | needs-input` (from §4.3).
- `data-vb-hero-visible` **seed (Codex fix #6):** `"true"` when the section HAS a hero (`heroSize !== 'none'`); `"false"` when it has none — a no-hero section has no observed hero, so seeding `"true"` would leave its sticky label permanently faded. The controller (lane A) flips a real hero to `"false"` once it leaves the viewport. Presentational only.

Hero band gets a stable hook: `data-vb-hero` on the hero `<div>` (the element the controller observes). No-hero sections emit no `[data-vb-hero]`.

**Sticky-label bar (Codex fix #9 — fixed box, inert inner label).** `SectionReveal` renders a **fixed-height** sticky bar carrying the visible interactive header. The hero-exit reveal fades ONLY a dedicated inner **duplicate label** element (`data-vb-sticky-label`, `aria-hidden="true"`, text-only — NO links/buttons; all CTAs live in the chapter header/body, never here). This keeps the bar's box constant (zero CLS), never hides a focusable control, and never double-announces the title to AT. CSS drives the fade off the section ancestor's attribute:
```css
[data-vb-hero-visible="true"] [data-vb-sticky-label] { opacity: 0; }
```
(reduced-motion: no transition, same end states). No `pointer-events` toggle is needed — the faded node is `aria-hidden` prose with no controls.

### 4.2 `lib/viewbook/section-copy.ts` (new, pure, client-safe)

```ts
export interface SectionCopy {
  purpose: string        // one sentence — chapter header + rail tooltip
  whatThis: string       // "What this is" — 1–2 sentences
  whatWeNeed: string | null  // "What we need from you" — null = nothing needed
  // Optional primary action (Codex fix #10). `anchor` is REQUIRED and must be a
  // real in-page target OTHER than the section's own hero (a self-target just
  // scrolls to where you already are). `sectionKey` is the owning SectionReveal
  // to force-open before scroll (navigateToAnchor contract). null = no CTA this pass.
  cta?: { label: string; sectionKey: SectionKey; anchor: string } | null
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

// Derived from the RENDERED current-stage primary lineup (the keys ViewbookShell
// actually renders, in order) + each section's state. No scroll state.
// "active" means state === 'active' explicitly. Rules, applied per section in
// rendered-primary order:
//   state === 'done'                                          -> 'complete'
//   bookends: pc-intro  -> 'complete' when pcCompletedAt != null, else 'current'
//             pc-thanks -> only renders when pcCompletedAt != null; -> 'current'
//   active && acknowledgedAt != null                          -> 'complete'
//       (an acknowledged input section is settled — never keeps saying needs-input)
//   active && INPUT_EXPECTING_KEYS.has(key)                   -> 'needs-input'
//   FIRST remaining active non-needs-input section            -> 'current'
//   any LATER remaining active non-needs-input section        -> 'upcoming'
// An all-complete lineup has NO fabricated 'current' — every entry is 'complete'.
// Carried (previous-stage) sections: 'complete' if done, else 'current'.
//
// Returns a partial map because only VISIBLE sections are supplied; a missing key
// means "not in this render", never a defaulted status.
export function computeSectionStatuses(
  renderedPrimaryOrder: SectionKey[],
  sections: Pick<PublicSection,'sectionKey'|'state'|'acknowledgedAt'>[],
  ctx: { pcCompletedAt: string | null },
): Partial<Record<SectionKey, SectionStatus>>
```

### 4.4 `lib/viewbook/toc-index.ts` + rail-entry identity (spine extends; lanes A/B consume)

`TocEntry` gains `status: SectionStatus`. `buildTocIndex(data)` populates it via `computeSectionStatuses`. This is the ONLY status source the rail reads (lane B never recomputes).

**Rail-entry identity (Codex fix #3).** The current rail only emits boolean `data-vb-toc-entry` + `data-anchor`, which lane A cannot reliably map to a section. Wave 1 freezes the requirement that **top-level** rail buttons carry `data-vb-toc-section="{sectionKey}"` (child/verbose sub-entries do NOT). Lane B (TocRail) emits it; lane A matches on it and sets/removes BOTH `data-vb-active` and `aria-current="location"` on the live matching node (see §7 for live-query).

### 4.5 New component props + Wave-1 stubs (Codex fix #2)

**Wave 1 creates and mounts minimal stub implementations** of the three new lane components below, so `ViewbookShell` imports and wires them and compiles green. Wave-2 lanes then replace ONLY the component internals — never `ViewbookShell`.

```ts
// StageOverview.tsx (new) — the "In this stage" strip
StageOverview({ items: { sectionKey: SectionKey; label: string; status: SectionStatus; anchor: string }[] })

// PreviousStages.tsx (new, replaces EarlierSteps) — SERVER component
//   (takes a `renderSection` FUNCTION prop, so it must NOT be 'use client').
PreviousStages({ groups: { stageLabel: string; sections: PublicSection[] }[]; renderSection: (s, meta) => ReactNode })

// SectionSummaryPanel.tsx (new)
SectionSummaryPanel({ whatThis: string; whatWeNeed: string | null; status: SectionStatus })
```

`ReadingProgressController.tsx` (new, lane A) takes **no props** — it queries `[data-vb-section]`/`[data-vb-hero]` and the live rail node by `[data-vb-toc-section]` from the DOM and sets `data-vb-hero-visible` + `data-vb-active` + `aria-current`.

## 5. Feature areas → files

1. **Hero hierarchy** — `SectionShell` gains `heroSize: 'full' | 'chapter' | 'none'` (full ≈ `min-h-[60vh]`, chapter ≈ `h-[220px]`, none = no hero band). `ViewbookShell` passes `'full'` to the current stage's lead primary section, `'chapter'` to the rest, `'none'` to carried sections rendered inside Previous stages.
2. **"In this stage" overview** — `StageOverview` below the lead hero; items = current stage primary sections (number · title · status glyph), click → `navigateToAnchor`.
3. **Chapter header + summary panel** — `SectionShell` renders a chapter-header block (number · title · one-sentence purpose · status pill · optional CTA) in the `TickDivider` strip zone; body opens with `SectionSummaryPanel`. Copy from `section-copy.ts`; status pill from `section-status.ts`.
4. **Status taxonomy** — `section-status.ts` (§4.3); `data-vb-status` on section root; pill in header; glyph in rail + overview.
5. **Scroll controller** — `ReadingProgressController` (§7).
6. **Rail active state** — `TocRail`: accent bar + filled marker on `[data-vb-active="true"]`; glyphs map to status (✓ complete · ring current/needs-input · dot upcoming); mobile FAB upgraded to a labeled "Sections" pill.
7. **Previous stages** — rename `EarlierSteps` → `PreviousStages`; group carried sections by origin stage (earliest stage where the key is `primary`, via the pure `lib/viewbook/section-origin.ts` helper over `STAGE_LINEUPS`); compact rows, expand to full content with `heroSize='none'`. **Collapsed carried sections (Codex fix #8):** a section with `state='collapsed'` (operator hero-only) rendered at `heroSize='none'` would be an expandable row with an empty interior. Render collapsed carried sections as **non-expandable compact rows** (title + status + origin stage, no toggle) — no empty expander.
8. **Welcome cards** — `WelcomeSection` split into labeled editorial cards: philosophy (`why` blocks) · credentials (code-owned ER copy) · contact (CSM) · team (roster) · process (`process` blocks).
9. **Next Steps CTA** — `KickoffNextSection` becomes an action summary with one clear CTA.
10. **Typography** — body prose containers constrained to ~68ch.

## 6. Delivery plan — spine, then 5 disjoint lanes

**Wave 1 — Spine (me, solo, lands first).** Publishes every §4 contract and compiles + tests green standalone. Files:

- **Render-meta threading (§4.0):** `app/(public)/viewbook/[token]/page.tsx` (both render callbacks), **all 13 section components** (forward `meta` → `SectionShell`): `WelcomeSection`, `MilestonesSection`, `DataSourceSection`, `BrandSection`, `AssessmentSection`, `StrategySection`, `MaterialsSection`, `PcIntroSection`, `PcSetupSection`, `PcInviteSection`, `PcThanksSection`, `KickoffNextSection`, `WsIntroSection`, plus the `OperatorLayer` wrapper (forwards `meta` unchanged).
- **Shell/reveal:** `SectionShell.tsx` (`heroSize`, chapter header, summary-panel slot, DOM contract), `SectionReveal.tsx` (fixed-box sticky bar + inert inner label + `~68ch` measure), `ViewbookShell.tsx` (lead promotion, mount controller + overview + previous-stages, compute per-section `meta`).
- **New pure/leaf files:** `lib/viewbook/section-copy.ts`, `lib/viewbook/section-status.ts`, `lib/viewbook/section-origin.ts` (origin-stage helper), `components/viewbook/public/SectionSummaryPanel.tsx`, and **minimal stubs** for `ReadingProgressController.tsx`, `StageOverview.tsx`, `PreviousStages.tsx` (Codex fix #2 — so the spine mounts + compiles; Wave-2 replaces internals only).
- **Extend:** `lib/viewbook/toc-index.ts` (add `status`).
- `SummaryStat.tsx` is UNCHANGED by the spine (ambiguity removed — the summary panel is the new `SectionSummaryPanel`).

**Wave 2 — 5 lanes, exclusive files, built on Wave 1's contracts:**

| Lane | Exclusive files (impl + test) | Owner |
|------|-----------------|-------|
| A. Scroll controller | `ReadingProgressController.tsx` + `.test.tsx` (replace stub) | **Codex (Sol)** |
| B. Rail | `TocRail.tsx` + `TocRail.test.tsx` | **Codex (Sol)** |
| C. Welcome cards | `WelcomeSection.tsx` + `.test.tsx` (+ welcome copy const if any) | **Codex (Sol)** |
| D. Overview + Previous stages | `StageOverview.tsx`(+test), `PreviousStages.tsx`(+test), **delete `EarlierSteps.tsx` + `EarlierSteps.test.tsx`** | **me** |
| E. Next Steps CTA | `KickoffNextSection.tsx` (+test) | **me** |

Lane A ↔ B share only the frozen `data-vb-active`/`aria-current` attributes + `[data-vb-toc-section]` selector. Everything else is independent.

**Integration rule (Codex fix #11):** the end-of-wave integration pass runs `tsc --noEmit` + vitest and may fix only genuine merge/wiring conflicts — it may NOT repair a broken shared contract by editing a lane-owned file. If a lane needs a shared-contract change, that goes back to a spine follow-up, not into the lane. Each lane is its own PR onto the spine branch.

## 7. Scroll controller — blink-bug avoidance (critical)

The prior observer flipped `expanded` (a **height-mutating** collapse state) while observing the element whose height it changed → self-oscillation. The new controller:
- observes **`[data-vb-hero]`** (a stable element it never mutates),
- writes **only** presentational attributes: `data-vb-hero-visible` on the section root, and `data-vb-active` + `aria-current="location"` on the matching rail node,
- **never touches** `expanded`, `grid-template-rows`, or any layout-affecting property,
- batches writes in `requestAnimationFrame`, respects `prefers-reduced-motion`.

**Deterministic active algorithm (Codex fix #5)** — no "most fills the viewport" ambiguity, so lanes A and B never disagree on "active":
- Define an **activation line** at `y = --vb-sticky-offset` (top of the reading area, below the fixed nav).
- **Active section = the last primary section whose hero top has crossed the activation line** (i.e. scrolled above it). Before any hero crosses → the first section; after the last hero crosses → the last section. A long body naturally stays active until the next hero arrives.
- Implementation: observe each `[data-vb-hero]` with an `IntersectionObserver` whose `rootMargin` top is derived from the CURRENT `--vb-sticky-offset` value read at build time; recompute (disconnect + rebuild) whenever `StickyOffsetProbe` republishes a changed offset (`rootMargin` cannot consume a CSS var live). Maintain a crossed/not-crossed flag per hero from `boundingClientRect.top` vs the line; pick the last crossed.

**Hero-visibility (Codex fix #6):** flip `data-vb-hero-visible` to `"false"` when a hero's bottom crosses the activation line, `"true"` while it is below. No-hero sections keep their seeded `"false"`.

**Rail node is LIVE-QUERIED (Codex fix #4):** `TocRail` renders the desktop rail, then may REPLACE it with the mobile sheet after `matchMedia` settles. The controller therefore re-queries `document.querySelector('[data-vb-toc-section="..."]')` on every active-state commit — it NEVER caches button references.

**No-observer fallback (Codex fix #6):** if `IntersectionObserver` is unavailable (or SSR), set every section's `data-vb-hero-visible="false"` (so sticky labels are usable) rather than no-op, and skip active tracking.

## 8. Accessibility & correctness

- Exactly one `<h1>` (unchanged). Section titles stay `<h2>`; chapter number is decorative (`aria-hidden`), status conveyed by a visible text label, not color alone.
- Rail stays `role="navigation"` with roving tabindex; active marker is visual — the current item also gets `aria-current="location"` (set/removed by the controller on the live node).
- Collapsed Previous-stages content stays `inert`/`aria-hidden` per existing pattern; `navigateToAnchor` already opens ancestor `<details>`. Non-expandable collapsed carried rows (§5 item 7) have no region to gate.
- The faded reveal element is an `aria-hidden` **duplicate label** with NO focusable controls (§4.1) — the real interactive header keeps a constant box and is never faded, so nothing tabbable is ever hidden and the title is announced once.

## 9. Testing

- Pure units: `section-status.ts` (all four states, rendered-order progression, `acknowledgedAt`→complete, pc-intro/pc-thanks via `pcCompletedAt`, all-complete lineup fabricates no current, carried), `section-origin.ts` helper, `section-copy.ts` completeness (every `SECTION_KEYS` present).
- Component: `SectionShell` hero-size modes + `data-vb-*` attributes; `StageOverview`; `PreviousStages` grouping + rename; `TocRail` active marker + glyph mapping + mobile pill; `WelcomeSection` cards; `KickoffNextSection` CTA.
- Controller: jsdom-guarded no-op + attribute-write behavior with a mocked `IntersectionObserver`.
- Gate: `npx tsc --noEmit` + `vitest` green before each PR merges (in-build checks stay disabled per CLAUDE.md).

## 10. Risks

- **Layout shift** from the sticky label — eliminated by design: the sticky bar keeps a FIXED height and only a duplicate inner label fades (§4.1). A brief empty strip on a 220px hero is a visual nicety, not CLS. Verify the reveal timing (hero-bottom crossing the activation line) on chapter heroes with a tall viewport.
- **Controller churn** on fast scroll — rAF-batched, attribute-only; acceptable.
- **Lead-section identity** when the current stage's first primary is `pc-intro` (always-open) — it simply becomes the full hero; fine.
- Recommend a browser eyeball for animation feel / CLS before ship (no local `/verify` for viewbook per prior passes).
