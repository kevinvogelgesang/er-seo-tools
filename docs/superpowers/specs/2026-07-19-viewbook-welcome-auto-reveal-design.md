# Viewbook welcome auto-reveal, animated collapse & per-viewbook pacing — design

**Date:** 2026-07-19
**Status:** spec (pre-plan)
**Base branch:** `feat/vb-collapse-local` (the local-override viewer-collapse program; not yet merged to `main`). Work branch: `feat/vb-welcome-auto-reveal`.
**Approved mockup:** `scratchpad/viewbook-reveal-mockups.html` (Artifact — Cinematic treatment #01 + pacing console).

## Goal

Building on the collapse-local model (every collapsible section renders default-collapsed to a compact row and expands on click, purely local per-device), add three things:

1. **The bookends collapse like the rest.** Today `pc-intro` (welcome) and `pc-thanks` (thank-you) are excluded from collapse and render full-height. They should become ordinary collapsible sections — default-collapsed compact rows in the stack.
2. **The welcome auto-expands on first load.** The first time the "Getting Started" (`post-contract`) stage loads **on a given device**, the welcome section (`pc-intro`) waits a configurable delay (default 3 s) and then smoothly expands on its own. Once per browser.
3. **A smooth, premium (cinematic) expand/collapse transition** — applied to **all** section expand/collapse, not just the welcome — replacing today's instant swap. Its pace is tunable **per viewbook** via two operator levers.

Two per-viewbook levers govern the motion:
- **Reveal speed** — an animation multiplier (default `1.0`). Presets Grand `1.4` / Standard `1.0` / Brisk `0.7` / Snappy `0.5`, plus a fine slider `0.4×–1.6×`.
- **First-load delay** — how long after first load the welcome auto-expands (default `3000 ms`), slider `0–6000 ms`.

## Decisions locked in brainstorming

- **Treatment:** the Cinematic mockup (#01) — Ken-Burns hero image, eyebrow/title/gold-rule reveal, body lift; everything scaled by one multiplier so the choreography never drifts.
- **Collapsed resting look:** the standard **compact ~74px row** for both bookends (consistent with every other section on this branch). The welcome blooms from its row into the full hero + body. *Not* the hero-band collapsed look from `main`.
- **Motion scope:** the cinematic transition applies to **all** expand/collapse; the speed lever is therefore meaningful on every interaction.
- **Speed lever UI:** presets **and** slider. **Delay lever UI:** slider only.
- **Auto-expand target:** the **welcome only** (`pc-intro`, and only in the `post-contract` stage). The thank-you (`pc-thanks`) collapses like the rest and never auto-expands (it is also gated behind `pcCompletedAt` and only appears once the engagement completes).

## Non-goals / out of scope

- Reviving the dormant server-side shared-collapse path (`lib/viewbook/collapse.ts`, `POST /api/viewbook/[token]/collapse` — currently 410). Untouched except where its **tests** must change (see D2).
- Re-enabling the dormant inner `SectionReveal` toggle (`SECTION_TOGGLE_ENABLED = false`). The cinematic animation is added to `CollapsibleSection` (the outer, live collapse island), not to `SectionReveal`.
- Per-child staggered cascade of arbitrary section body content. The cinematic weight lives in the hero flourishes + a unified body lift (see D3); a per-child stagger is a possible future enhancement.
- Any AI/LLM API work; any change to scoring, findings, or the share view beyond what the animation naturally touches.

---

## Architecture overview

Four units, each independently shippable (suggested PR order in Rollout):

| Unit | Concern | Primary files |
|---|---|---|
| **D1 Config levers** | Two per-viewbook settings, stored + validated + threaded + operator UI + CSS var | `prisma/schema.prisma`, `lib/viewbook/presentation-config.ts`, `lib/viewbook/service.ts`, `lib/viewbook/public-data.ts`, `lib/viewbook/public-types.ts`, `components/viewbook/public/ViewbookShell.tsx`, `components/viewbook/admin/PresentationEditor.tsx` |
| **D2 Bookend collapse** | Make `pc-intro`/`pc-thanks` collapsible like the rest | `lib/viewbook/theme.ts`, `lib/viewbook/section-display.ts`, `lib/viewbook/collapse.test.ts` (dormant-path test) |
| **D3 Cinematic transition** | Animate all expand/collapse, scaled by `--vb-reveal-speed`, reduced-motion safe | `components/viewbook/public/CollapsibleSection.tsx`, `components/viewbook/public/SectionShell.tsx` (hero/body markup hooks) |
| **D4 Welcome auto-reveal** | 3 s once-per-device auto-expand of the welcome | new `components/viewbook/public/useWelcomeAutoReveal.ts`, `CollapsibleSection.tsx`, `SectionShell.tsx`, `PcIntroSection.tsx` |

Data flows: **DB columns → `presentation-config` sanitizer → `service`/`public-data` loader → `ViewbookPublicData` → (a) `ViewbookShell` injects `--vb-reveal-speed` inline on the theme-root, inherited by every `CollapsibleSection`; (b) `firstLoadDelayMs` passes as a prop to the welcome's `CollapsibleSection` for the auto-reveal timer.** The operator sets both values on the options page via the existing `PATCH /api/viewbooks/[id]` presentation path.

---

## D1 — Per-viewbook config levers

### D1.1 Schema (`prisma/schema.prisma`, `model Viewbook`)

Add two typed columns adjacent to `collapseAffordance` / `heroOverlayStrength` (~line 882):

```prisma
revealSpeed      Float @default(1.0)  // 0.4..1.6 animation-pace multiplier (presentation config)
firstLoadDelayMs Int   @default(3000) // 0..6000 ms before the welcome auto-expands on first device load
```

Typed columns, **not** `themeJson` (its strict whole-object validator would reset every stored theme — the exact reason presentation config lives in columns). Migration `npx prisma migrate dev --name viewbook_reveal_pacing`. Defaults make the migration safe for existing rows (they read as Standard/3 s, i.e. current-feeling behavior once the animation ships).

### D1.2 Sanitizer (`lib/viewbook/presentation-config.ts`)

`presentation-config.ts` is the ONE home for per-viewbook presentation config; write is strict (`parsePresentationPatch` → `HttpError(400)`), read never throws (`readPresentationConfig` degrades to defaults). Extend both sides equally strictly (repo convention — never loosen one side):

- `PRESENTATION_DEFAULTS` gains `revealSpeed: 1.0`, `firstLoadDelayMs: 3000`.
- `parsePresentationPatch`: for each key present in `raw`:
  - `revealSpeed` — must be a **finite number** (reject `NaN`/`Infinity`/`"fast"` → `400 invalid_reveal_speed`), then **clamp to `[0.4, 1.6]`** (matches the mockup slider range; presets 0.5–1.4 sit inside).
  - `firstLoadDelayMs` — must be a **finite integer** (reject non-integer/non-finite → `400 invalid_first_load_delay`), then **clamp to `[0, 6000]`**.
- `readPresentationConfig` degrades each field to its default when malformed/out of type.

Mirror the existing `heroOverlayStrength` integer-validation + clamp precedent exactly. Add cases to `presentation-config.test.ts` (finite/integer rejection *not* coercion; clamp at both ends; degrade-on-read).

### D1.3 Service + loader threading

- `lib/viewbook/service.ts` `updateViewbookPresentation` — widen the `patch` type to include `revealSpeed?: number` and `firstLoadDelayMs?: number`. No other change (same atomic array-form `$transaction([syncVersionBump, viewbook.update])`).
- `lib/viewbook/public-data.ts` — read the two new columns and emit them on the public data object (alongside `collapseAffordance`/`heroOverlayStrength`), passing through `readPresentationConfig` so a corrupt DB value degrades.
- `lib/viewbook/public-types.ts` `ViewbookPublicData` (~line 153) — add `revealSpeed: number` and `firstLoadDelayMs: number`.

### D1.4 CSS variable injection (`components/viewbook/public/ViewbookShell.tsx`)

On the `data-vb-theme-root` div (~line 47–55), add inline alongside `--vb-sticky-offset`:

```ts
'--vb-reveal-speed': String(data.revealSpeed),
```

It inherits to every descendant `CollapsibleSection`, whose animation CSS reads `var(--vb-reveal-speed, 1)` (D3). `firstLoadDelayMs` is **not** a CSS var — it is passed as a React prop to the welcome section (D4), since it drives a JS timer.

### D1.5 Operator UI (`components/viewbook/admin/PresentationEditor.tsx`)

Add two controls beside the existing affordance + overlay controls, PATCHed through the same `/api/viewbooks/[id]` presentation path (the route already runs `parsePresentationPatch`; the extra keys flow through once D1.2 lands):

- **Reveal speed** — preset chips (Grand 1.4 / Standard 1.0 / Brisk 0.7 / Snappy 0.5) + a `0.4–1.6` step-`0.05` range input. Live readout "≈ Xs" is nice-to-have, not required.
- **First-load delay** — a `0–6000` step-`250` (or `0–6` s) range input, labeled in seconds.

Extend `PresentationEditor.test.tsx` to cover the two new controls submitting valid patches. Copy: "Reveal speed" / "First-load delay (welcome)".

---

## D2 — Bookends collapse like the rest

### D2.1 Collapse eligibility (`lib/viewbook/theme.ts`)

`SectionShell` decides whether to wrap a section in `CollapsibleSection` purely via `collapsible = sectionSupportsCollapse(sectionKey)`, which is `!COLLAPSE_EXCLUDED_SECTION_KEYS.has(key)`. Today the set is `{'pc-intro','pc-thanks'}`.

**Change:** remove both bookends from `COLLAPSE_EXCLUDED_SECTION_KEYS` (the set becomes empty). Keep the constant + `sectionSupportsCollapse` in place (the mechanism stays; only the membership changes) so the dormant server path and any future carve-out still compile. Update the file banner to record that all sections are now collapsible.

Once collapsible, the bookends automatically route through `CollapsibleSection` (default-collapsed compact row, click-to-expand, per-device local state) with **no per-component change** — `PcIntroSection.tsx:39-40` and `PcThanksSection.tsx:36-37` already forward `affordance`/`overlayStrength` to `SectionShell`.

### D2.2 Reconcile `ALWAYS_OPEN_KEYS` (`lib/viewbook/section-display.ts`)

`pc-intro` is currently in `ALWAYS_OPEN_KEYS`, which makes `sectionDisplayMode` return `'always-open'`. That mode only feeds the **dormant** inner `SectionReveal` (`alwaysOpen`/`sectionInitiallyOpen`); it does **not** gate the outer `CollapsibleSection`. With `pc-intro` now a normal collapsible section, `always-open` is contradictory and inert.

**Change:** remove `pc-intro` from `ALWAYS_OPEN_KEYS` so the display-mode model stays coherent (it falls to `normal`; `sectionInitiallyOpen` still returns `true` for it via the default branch, so no dormant-reveal behavior change). Update `section-display.test.ts`. *Flag for Codex: confirm nothing else keys off `'always-open'` for `pc-intro`.*

### D2.3 Dormant server-path tests (`lib/viewbook/collapse.test.ts`)

`collapse.test.ts` asserts that setting `pc-intro` collapsed → `400` (via the bookend guard in `lib/viewbook/collapse.ts`, which calls `sectionSupportsCollapse`). Since the exclusion set is now empty, that guard no longer rejects bookends. The route itself is 410 (dormant), so this is test-only: update the assertion to reflect that bookends are no longer specially rejected (or retarget the "unsupported key" case to a genuinely unknown key). No production behavior rides on this path.

---

## D3 — Cinematic expand/collapse transition (all sections)

Today `CollapsibleSection` swaps `heroCollapsed`⇄`heroExpanded` and toggles the body region via `hidden`/`inert`/`display:none` — instant. Replace that with a smooth, `--vb-reveal-speed`-scaled transition, keeping the APG accordion semantics.

### D3.1 State model

Drive all animation from a single `data-vb-state="collapsed" | "expanded"` attribute on the `CollapsibleSection` root, toggled by `useCollapseState`'s `collapsed` boolean. All animation is CSS keyed off that attribute — no JS animation loop.

### D3.2 The three coordinated motions (all scaled by `var(--vb-reveal-speed, 1)`)

1. **Hero grow + cross-fade.** The hero container height transitions between the compact-row height (~74 px) and the expanded hero height (`min-h-[38vh]`/`min-h-[30vh]`). The compact-row content and the expanded-hero content are both present and cross-fade (opacity) so there is no hard pop. *(Implementation risk — see D3.5.)*
2. **Body reveal.** The body region uses the `grid-template-rows: 0fr → 1fr` technique (the same one the dormant `SectionReveal` already uses) with `overflow:hidden` inner, transitioned. The body content gets a **unified lift** — `opacity 0→1` + `translateY(~20px→0)` + a slight `blur(4px→0)` — as one block (not per-child).
3. **Hero flourishes (expanded only).** On the expanded hero: the background image does a gentle Ken-Burns `scale(1.06→1)`; the eyebrow rises + fades in; the gold rule draws (`scaleX(0→1)`, origin left). These are the "cinematic" signature and are consistent across all sections because they live on the shared hero.

Base durations (tuned in implementation; scaled by the multiplier), e.g. `--vb-reveal-base` ≈ `520ms` body, hero grow ≈ `600ms`, Ken-Burns ≈ `1100ms`, all as `calc(<base> * var(--vb-reveal-speed, 1))`. Collapse runs the same transitions in reverse.

### D3.3 CSS var wiring

`CollapsibleSection` emits its own `<style>` block (or Tailwind arbitrary values) reading `var(--vb-reveal-speed, 1)` — the var is injected once on the theme-root (D1.4) and inherits. The `, 1` fallback keeps the component correct if rendered outside a theme-root (tests, storybook).

### D3.4 Accessibility & reduced motion

- Keep `aria-expanded` on the hero button and `aria-controls={regionId}`; keep the APG accordion structure (`<h2>` wrapping the `<button>`).
- `inert`/`aria-hidden` on the collapsed region: apply on the logical collapsed state. On expand, remove `inert` at the **start** of the animation (content becomes focusable as it reveals); on collapse, the region is animating away so `inert` at collapse-start is acceptable. Verify no focus is trapped mid-animation.
- `@media (prefers-reduced-motion: reduce)` → all transitions `none` (instant show/hide), mirroring the existing `.vb-reveal` reduced-motion rule. State still changes; only the motion is removed.

### D3.5 Implementation risk (flag for Codex + plan)

Cross-fading two structurally different hero forms while animating a fixed-px↔`vh` height can jank. **Primary approach:** height transition + opacity cross-fade of the two hero forms + grid-rows body + flourishes. **Fallback if janky:** keep an instant hero-form swap but animate (a) the body grid-rows reveal + lift and (b) the expanded-hero flourishes — this still reads as a smooth premium reveal because the eye is on the body opening and the hero image settling. The plan should build the primary and keep the fallback as a named contingency.

---

## D4 — Welcome auto-reveal (once per device)

### D4.1 Per-device flag (`components/viewbook/public/useWelcomeAutoReveal.ts`, new)

A small hook mirroring `useCollapseState`'s hydration-safe localStorage pattern (SSR-safe seed + mount `useEffect`, try/catch-wrapped read/write for private-mode safety):

- **Key:** `vb:welcome-revealed:${viewbookId}` (per-device, per-viewbook), value `'1'` once fired.
- **Inputs:** `{ viewbookId, enabled, collapsed, expand, delayMs, previewMode }` where `enabled = stage === 'post-contract'` and `expand`/`collapsed` come from the section's `useCollapseState`.
- **Behavior (mount effect, client only):**
  - If `!enabled` or `previewMode` → do nothing.
  - Read the flag. If already set → do nothing (never auto-reveal again — respects a user who later re-collapsed).
  - If the section is already expanded (stored `'expanded'`) → set the flag, do nothing.
  - Else arm `setTimeout(delayMs)`. On fire, if still collapsed and the user hasn't interacted → call `expand()` (persists `'expanded'`, so it stays open and the flourish plays via D3). Set the flag regardless of interaction.
  - If the user manually toggles before the timer fires → clear the timer and set the flag (they've engaged; don't yank the UI).
  - `delayMs === 0` → expand on the next frame (no timer), still set the flag.
- Cleanup clears the timer on unmount.

Isolated and unit-testable with fake timers + a mock storage.

### D4.2 Wiring

- `PcIntroSection.tsx` passes `autoRevealMs={data.firstLoadDelayMs}` (and relies on `stage`, already available) down through `SectionShell` to `CollapsibleSection`.
- `SectionShell.tsx` forwards an optional `autoRevealMs?: number` prop to `CollapsibleSection` (only `PcIntroSection` sets it; all other callers omit → `undefined` → no auto-reveal).
- `CollapsibleSection.tsx` calls `useWelcomeAutoReveal({ viewbookId, enabled: autoRevealMs != null && stage === 'post-contract', collapsed, expand, delayMs: autoRevealMs ?? 0, previewMode })`. (Thread `stage` into `CollapsibleSection`, or gate `enabled` upstream so `CollapsibleSection` stays stage-agnostic — plan's call; gating upstream in `PcIntroSection` is cleaner.)

### D4.3 Interaction with reduced motion

Auto-expand still fires under `prefers-reduced-motion` (it is a content reveal, not decoration); the transition is simply instant per D3.4.

---

## Data flow (end to end)

```
Viewbook.revealSpeed / firstLoadDelayMs  (DB columns)
  → public-data loader (readPresentationConfig degrade)
  → ViewbookPublicData { revealSpeed, firstLoadDelayMs }
  → ViewbookShell: style={{ '--vb-reveal-speed': String(data.revealSpeed), ... }}   (inherits to all sections)
  → PcIntroSection: autoRevealMs={data.firstLoadDelayMs}
      → SectionShell → CollapsibleSection
          → CSS reads var(--vb-reveal-speed) for all expand/collapse motion (D3)
          → useWelcomeAutoReveal(delayMs=firstLoadDelayMs) arms the 3s once-per-device timer (D4)

Operator: PresentationEditor → PATCH /api/viewbooks/[id] { revealSpeed?, firstLoadDelayMs? }
  → parsePresentationPatch (validate+clamp) → updateViewbookPresentation (atomic, syncVersion bump)
```

## Error handling / edge cases

- **Corrupt DB value** (e.g. legacy row, out-of-range) → `readPresentationConfig` degrades to the default; the viewer always gets a sane multiplier/delay.
- **localStorage unavailable** (private mode) → try/catch swallows; auto-reveal still runs in-memory for the session (flag just isn't persisted; worst case it re-reveals next visit — harmless).
- **`revealSpeed = 0` or negative** → impossible post-clamp (min `0.4`); `calc()` never produces a `0ms`/negative duration.
- **Multiple tabs** → each tab reads/sets the flag independently; the first to fire persists it; others see it set. No coordination needed.
- **User expands the welcome manually within the 3 s** → timer canceled, flag set (D4.1). No double-expand.
- **Stage not `post-contract`** → welcome section may not even be in the lineup; auto-reveal disabled by `enabled` gate regardless.
- **SSR/hydration** → initial render is always collapsed (matches SSR default-collapsed); the flag read + timer live in a mount effect, so no hydration mismatch.

## Testing

- **Unit — `presentation-config.test.ts`:** revealSpeed/firstLoadDelayMs reject non-finite/non-integer (no coercion), clamp at both ends, degrade-on-read. (D1.2)
- **Unit — `section-display.test.ts`:** `pc-intro` no longer `always-open`; bookends resolve `normal`. (D2.2)
- **Unit — `collapse.test.ts`:** bookends no longer specially rejected by the dormant guard. (D2.3)
- **Unit — `useWelcomeAutoReveal` (new test):** fires once after `delayMs`; never fires with the flag set; canceled by manual interaction; `delayMs=0` immediate; `previewMode`/`!enabled` no-op. Fake timers + mock storage. (D4.1)
- **Component — `PresentationEditor.test.tsx`:** the two new controls submit valid patches. (D1.5)
- **Component/interaction — `CollapsibleSection`:** `data-vb-state` flips on toggle; reduced-motion path; accessibility (`aria-expanded`, `inert`) preserved across the animation. (D3)
- **Gates:** `npx tsc --noEmit` + `vitest` green before any merge (in-build checks are disabled — local gates are the only type-check gate).
- **Manual verify:** run the viewbook viewer locally; confirm (a) bookends default to compact rows, (b) welcome auto-expands ~3 s after first load and not on reload, (c) speed lever visibly changes pace, (d) reduced-motion makes it instant.

## Migration & rollout

- One additive migration (`viewbook_reveal_pacing`), safe defaults; production migration runs via `prisma migrate deploy` in the deploy command.
- **Suggested PR sequence** (finalized by the plan):
  1. **D1** — config levers plumbing + operator UI + `--vb-reveal-speed` injection (no visible behavior change yet; var present, transition still instant, bookends still excluded).
  2. **D2** — bookends collapse like the rest (+ dormant-path/section-display test updates).
  3. **D3** — cinematic animated transition on all expand/collapse (consumes `--vb-reveal-speed`).
  4. **D4** — welcome auto-reveal timer + per-device flag.
- No deploy exposes anything dark-gated; all four ship together or in sequence with each independently correct.

## Open implementation risks (for Codex review + plan)

1. **D3.5** hero cross-fade/height-morph jank — primary vs fallback approach.
2. **D2.2** confirm no other consumer keys off `'always-open'` for `pc-intro`.
3. **D4** exact seam for threading `stage`/`autoRevealMs` into `CollapsibleSection` (gate `enabled` in `PcIntroSection` vs inside the island).
