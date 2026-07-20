# Viewbook welcome auto-reveal, animated collapse & per-viewbook pacing — design

**Date:** 2026-07-19
**Status:** spec (Codex-reviewed 2026-07-19 — accept with named fixes, applied inline)
**Base branch:** `feat/vb-collapse-local` (the local-override viewer-collapse program; not yet merged to `main`). Work branch: `feat/vb-welcome-auto-reveal`.
**Approved mockup:** Cinematic treatment #01 + pacing console — committed at `docs/superpowers/specs/assets/2026-07-19-viewbook-reveal-mockups.html` (also published as an Artifact). It is the canonical visual/transition reference for D3/D1.

## Goal

Building on the collapse-local model (every collapsible section renders default-collapsed to a compact row and expands on click, purely local per-device), add three things:

1. **The bookends collapse like the rest.** Today `pc-intro` (welcome) and `pc-thanks` (thank-you) are excluded from collapse and render full-height. They become ordinary collapsible sections — default-collapsed compact rows in the stack. **This deliberately reverses the prior invariant** (spec `2026-07-19-viewbook-collapse-local-revision.md` §"bookends never collapse", and `pc-intro` ∈ `ALWAYS_OPEN_KEYS`).
2. **The welcome auto-expands on first load.** The first time the "Getting Started" (`post-contract`) stage loads **on a given device**, the welcome (`pc-intro`) waits a configurable delay (default 3 s) then smoothly expands on its own. Once per browser.
3. **A smooth, premium (cinematic) expand/collapse transition** — applied to **all** section expand/collapse, replacing today's instant swap. Its pace is tunable **per viewbook**.

Two per-viewbook levers govern the motion:
- **Reveal pace** (`revealDurationScale`) — a **duration multiplier** (default `1.0`; **higher = slower/grander**, lower = snappier). Presets Grand `1.4` / Standard `1.0` / Brisk `0.7` / Snappy `0.5`, plus a fine slider `0.4×–1.6×` (labeled "Faster ← → Slower"). *Named `revealDurationScale`, not "revealSpeed", precisely because the number scales duration — a "speed" named field where 1.4 is the slowest reads backwards (Codex fix 8).*
- **First-load delay** (`firstLoadDelayMs`) — how long after first load the welcome auto-expands (default `3000 ms`), slider `0–6000 ms`.

## Decisions locked in brainstorming

- **Treatment:** the Cinematic mockup (#01) — Ken-Burns hero image, eyebrow/title/gold-rule reveal, body lift; everything scaled by one multiplier so the choreography never drifts.
- **Collapsed resting look:** the standard **compact row** (~82 px incl. `py-1`) for both bookends, consistent with every other section on this branch. The welcome blooms from its row into the full hero + body. *Not* the hero-band collapsed look from `main`.
- **Motion scope:** the cinematic transition applies to **all** expand/collapse; the pace lever is meaningful on every interaction.
- **Pace lever UI:** presets **and** slider. **Delay lever UI:** slider only.
- **Auto-expand target:** the **welcome only** (`pc-intro`, `post-contract` stage). The thank-you (`pc-thanks`) collapses like the rest, never auto-expands (also gated behind `pcCompletedAt`).

## Non-goals / out of scope

- Reviving the dormant server-side shared-collapse path (`lib/viewbook/collapse.ts`, `POST /api/viewbook/[token]/collapse` — 410). Untouched except **stale comments + tests** (D2).
- Re-enabling the dormant inner `SectionReveal` toggle (`SECTION_TOGGLE_ENABLED = false`). The cinematic animation is added to `CollapsibleSection` (the live outer collapse island).
- Per-child staggered cascade of arbitrary section body content — the cinematic weight lives in the hero flourishes + a unified body lift; per-child stagger is possible future work.
- Any AI/LLM API work; any change to scoring/findings/share view beyond what the animation naturally touches.

---

## Architecture overview

Four units, each independently shippable (PR order in Rollout):

| Unit | Concern | Primary files |
|---|---|---|
| **D1 Config levers** | Two per-viewbook settings: store + validate + thread + operator UI + CSS var | `prisma/schema.prisma`, `lib/viewbook/presentation-config.ts`, `lib/viewbook/service.ts`, `lib/viewbook/public-data.ts`, `lib/viewbook/public-types.ts`, `components/viewbook/public/ViewbookShell.tsx`, `components/viewbook/admin/PresentationEditor.tsx`, `components/viewbook/admin/viewbook-admin-shared.ts` |
| **D2 Bookend collapse** | Make `pc-intro`/`pc-thanks` collapsible like the rest | `lib/viewbook/theme.ts`, `lib/viewbook/section-display.ts`, + tests/comments (see D2.3) |
| **D3 Cinematic transition** | Animate all expand/collapse, scaled by `--vb-reveal-scale`, reduced-motion & navigation safe | `components/viewbook/public/CollapsibleSection.tsx`, `SectionShell.tsx`, `viewbook-navigate.ts` |
| **D4 Welcome auto-reveal** | 3 s once-per-device auto-expand of the welcome | new `useWelcomeAutoReveal.ts`, `useCollapseState.ts` (ready flag + interaction cb), `CollapsibleSection.tsx`, `PcIntroSection.tsx` |

Data flow: **DB columns → `presentation-config` sanitizer → `service`/`public-data` loader → `ViewbookPublicData` → (a) `ViewbookShell` injects `--vb-reveal-scale` inline on the theme-root, inherited by every `CollapsibleSection`; (b) `firstLoadDelayMs` passes as a prop to the welcome's `CollapsibleSection` for the auto-reveal timer.** Operator sets both via `PATCH /api/viewbooks/[id]` (existing presentation path).

---

## D1 — Per-viewbook config levers

### D1.1 Schema (`prisma/schema.prisma`, `model Viewbook`)

Add two typed columns next to `collapseAffordance` / `heroOverlayStrength`:

```prisma
revealDurationScale Float @default(1.0)  // 0.4..1.6 animation DURATION multiplier (higher = slower/grander)
firstLoadDelayMs    Int   @default(3000) // 0..6000 ms before the welcome auto-expands on first device load
```

Typed columns, **not** `themeJson` (its strict whole-object validator would reset every stored theme). **Migration:** author the migration via `npx prisma migrate dev --name viewbook_reveal_pacing` locally (creates the migration SQL + regenerates the client — the repo's documented workflow); commit the generated migration; production applies it via `prisma migrate deploy` in the deploy command. Defaults make it safe for existing rows (read as Standard / 3 s).

### D1.2 Sanitizer (`lib/viewbook/presentation-config.ts`)

`presentation-config.ts` is the ONE home for per-viewbook presentation config; write is strict (`parsePresentationPatch` → `HttpError(400)`), read degrades. Extend both sides (never loosen one side):

- `PRESENTATION_DEFAULTS` gains `revealDurationScale: 1.0`, `firstLoadDelayMs: 3000`.
- **`parsePresentationPatch`** (write) — for each key present in `raw`:
  - `revealDurationScale` — must be a **finite number** (reject `NaN`/`Infinity`/strings → `400 invalid_reveal_scale`), then **clamp to `[0.4, 1.6]`**.
  - `firstLoadDelayMs` — must be a **finite integer** (reject non-integer/non-finite → `400 invalid_first_load_delay`), then **clamp to `[0, 6000]`**.
- **`readPresentationConfig`** (read) — mirror the `heroOverlayStrength` precedent exactly: a **finite but out-of-range** stored value is **clamped** to range (not defaulted); only a **malformed/non-finite** value falls back to the default.

Add `presentation-config.test.ts` cases: write rejects non-finite/non-integer (no coercion) + clamps at both ends; read clamps finite-out-of-range and defaults only on malformed.

### D1.3 Service + loader threading

- `lib/viewbook/service.ts` `updateViewbookPresentation` — widen the `patch` type to include `revealDurationScale?: number` and `firstLoadDelayMs?: number` (same atomic array-form `$transaction([syncVersionBump, viewbook.update])`). Add/extend a **service persistence test**.
- `lib/viewbook/public-data.ts` — read the two columns and emit them on the public data object through `readPresentationConfig` (degrade/clamp). Add a **public-data default/threading test** (missing columns → defaults; set columns → passthrough).
- `lib/viewbook/public-types.ts` `ViewbookPublicData` — add `revealDurationScale: number` and `firstLoadDelayMs: number`.

### D1.4 CSS variable injection (`ViewbookShell.tsx`)

On the `data-vb-theme-root` div, add inline alongside `--vb-sticky-offset`:

```ts
'--vb-reveal-scale': String(data.revealDurationScale),
```

Inherits to every descendant `CollapsibleSection`, whose CSS reads `var(--vb-reveal-scale, 1)` (D3). Add a `ViewbookShell` test asserting the var is emitted. `firstLoadDelayMs` is **not** a CSS var — it's a React prop to the welcome section (D4), since it drives a JS timer.

### D1.5 Operator UI (`PresentationEditor.tsx` + `viewbook-admin-shared.ts`)

Add two controls beside the affordance + overlay controls, PATCHed through the same `/api/viewbooks/[id]` presentation path (extra keys flow once D1.2 lands). If preset lists / control metadata live in `components/viewbook/admin/viewbook-admin-shared.ts`, add them there:

- **Reveal pace** — preset chips (Grand 1.4 / Standard 1.0 / Brisk 0.7 / Snappy 0.5) + a `0.4–1.6` step-`0.05` range labeled "Faster ← → Slower".
- **First-load delay (welcome)** — a `0–6000` step-`250` range labeled in seconds.

Extend `PresentationEditor.test.tsx` to cover both controls submitting valid patches.

---

## D2 — Bookends collapse like the rest

### D2.1 Collapse eligibility (`lib/viewbook/theme.ts`)

`SectionShell` decides collapse-wrapping purely via `collapsible = sectionSupportsCollapse(sectionKey)` = `!COLLAPSE_EXCLUDED_SECTION_KEYS.has(key)`. **Change:** empty the set (`COLLAPSE_EXCLUDED_SECTION_KEYS = new Set()`). Keep the constant + helper (mechanism stays; only membership changes) so the dormant path and any future carve-out still compile. Update the file banner. Once collapsible, the bookends route through `CollapsibleSection` with no per-component change (`PcIntroSection`/`PcThanksSection` already forward `affordance`/`overlayStrength` to `SectionShell`).

### D2.2 Reconcile `ALWAYS_OPEN_KEYS` (`lib/viewbook/section-display.ts`)

`pc-intro` ∈ `ALWAYS_OPEN_KEYS` makes `sectionDisplayMode` return `'always-open'`, which feeds only the **dormant** inner `SectionReveal` — it does not gate the outer `CollapsibleSection`. **Change:** remove `pc-intro` from `ALWAYS_OPEN_KEYS` so the model is coherent (falls to `normal`; `sectionInitiallyOpen` still returns `true` via the default branch — no dormant-reveal behavior change). **Codex-confirmed blast radius:** the only production consumers of `sectionSupportsCollapse` are `SectionShell` + dormant `collapse.ts`; `ALWAYS_OPEN_KEYS` is private to `section-display.ts`; `'always-open'` reaches only `SectionShell` → generic `SectionReveal` (whose generic always-open capability stays). No change needed in `EarlierSteps`, `toc-index`, or operator controls.

### D2.3 Ripple: tests + stale comments

- `lib/viewbook/section-display.test.ts` — `pc-intro` now resolves `normal`, not `always-open`.
- `lib/viewbook/collapse.test.ts` — the dormant guard no longer specially rejects bookends; retarget the "unsupported key" assertion to a genuinely unknown key (route is 410, so test-only).
- `components/viewbook/public/SectionShell.tsx` — update the bookend-branch **comments/assumptions** (bookends are no longer the non-collapsible special case).
- `components/viewbook/public/SectionShell.test.tsx` (~:194) — the bookend branch now wraps in `CollapsibleSection`.
- `components/viewbook/public/PcIntroSection.tsx` + `PcIntroSection.test.tsx` (~:67) — welcome is now collapsible + carries auto-reveal (D4).
- Stale **"bookends excluded"** comments in `useCollapseState.ts` and `collapse.ts` — update to reflect the reversal.

---

## D3 — Cinematic expand/collapse transition (all sections)

Today `CollapsibleSection` swaps `heroCollapsed`⇄`heroExpanded` and toggles the body via `hidden`/`inert`/`display:none` — instant. Replace with a smooth, `--vb-reveal-scale`-scaled transition, keeping APG accordion semantics.

### D3.1 State model

Drive all animation from a single `data-vb-state="collapsed" | "expanded"` on the `CollapsibleSection` root, toggled by `useCollapseState`'s `collapsed`. All animation is CSS keyed off that attribute — no JS animation loop.

### D3.2 Executable hero layout (Codex fix 1)

Use an **explicit-height "stage" wrapper** with the two hero faces absolutely stacked — today's `min-h-*` nodes cannot provide a reliable cross-fade height contract:

- **Stage height** transitions between the **collapsed row height (~82 px, incl. `py-1` — verify against the rendered row, not the 74 px `min-h`)** and the **expanded hero height as a bounded `clamp(240px, 38svh, 560px)`** (use `svh`, not the raw `min-h-[38vh]`, and bound it so the animation target is deterministic and mobile-safe).
- **Two faces** (compact-row face, expanded-hero face) absolutely positioned, opacity cross-faded on `data-vb-state`. The **inactive face carries `aria-hidden`**; the hero **button keeps one stable accessible name** across states (don't let the name flip between row-title and hero-title).
- **Share the image plane** — render the section hero image once behind both faces rather than two persistent `<img>`s (avoids double paint + double alt).

### D3.3 Body reveal (Codex fix 2)

The body region must **stay mounted** (no `hidden`/`display:none` — those kill transitions). Use `display:grid; grid-template-rows: 0fr → 1fr` with an inner `min-height:0; overflow:hidden`, transitioned. Content gets a **unified lift** — `opacity 0→1` + `translateY(~20px→0)`. **No default full-body blur** (expensive on large Data Source bodies; opacity/translate is sufficient). `inert`/`aria-hidden` are applied from the **logical collapsed state** (see D3.5), not by hiding the box.

### D3.4 Hero flourishes (expanded only)

On the expanded face: background image gentle Ken-Burns `scale(1.06→1)`; eyebrow rises + fades in; gold rule draws (`scaleX(0→1)`, origin left). Shared across all sections because they live on the hero. All durations `calc(<base> * var(--vb-reveal-scale, 1))` (bases tuned in impl, e.g. body ≈ `520ms`, hero-stage ≈ `600ms`, Ken-Burns ≈ `1100ms`). Collapse runs the transitions in reverse.

### D3.5 Accessibility, reduced motion, navigation

- Keep `aria-expanded` on the hero button + `aria-controls={regionId}` + the APG `<h2>`>`<button>` structure. One stable button name (D3.2).
- `inert`/`aria-hidden` bound to logical collapsed state. On **expand**, drop `inert` at animation start (content focusable as it reveals); on **collapse**, `inert` at collapse start is fine. Verify no focus trap mid-animation.
- `@media (prefers-reduced-motion: reduce)` → all transitions `none` (instant), mirroring the existing `.vb-reveal` rule. State still changes; only motion is removed.
- **Navigation must be animation-aware (Codex fix 3):** `components/viewbook/public/viewbook-navigate.ts` scrolls after one frame — adequate for an instant reveal but can target a still-moving nested anchor. Change to scroll on `transitionend` (or a corrective post-transition scroll), covering both the `vb:navigate` event path **and** the initial `location.hash` path. Add tests.

### D3.6 Primary vs fallback (Codex fix 4)

Build the **primary** (D3.2–D3.4). **Fall back** (instant hero-face swap; animate only the body grid-rows reveal + hero flourishes) if browser verification finds any of these **objective triggers**: duplicate assistive-tech names, incorrect anchor landing after navigation, bad rapid expand→collapse reversal, mobile long-frame jank, or unacceptable first-load CLS. **CLS is inherent:** the delayed auto-expand shifts layout; **measure it and explicitly accept the budget** in verification — the fallback reduces hero complexity but does not eliminate body-induced shift.

---

## D4 — Welcome auto-reveal (once per device)

### D4.1 Collapse-state readiness (Codex fix 6) — `useCollapseState.ts`

Extend `useCollapseState` to expose a **`ready`** flag (true once the mount `useEffect` has reconciled the stored value) and a **`markInteracted()`** (or `cancelAutoReveal`) callback. The hero button calls `markInteracted()` on any manual toggle. Do **not** rely on effect ordering between `useCollapseState`'s reconciliation and the welcome hook.

### D4.2 Per-device flag hook (`useWelcomeAutoReveal.ts`, new)

Mirror `useCollapseState`'s hydration-safe localStorage pattern (SSR-safe seed + mount effect, try/catch read/write). Inputs `{ viewbookId, enabled, ready, collapsed, expand, interacted, delayMs, previewMode }`.

- **Key:** `vb:welcome-revealed:${viewbookId}`, value `'1'` once fired.
- **Arming (effect, client only):** only when `enabled` (stage `post-contract`) && `ready` && !`previewMode` && flag-unset && currently `collapsed` && !`interacted`. If the section is already `expanded` (stored) → set the flag, do nothing. Else `setTimeout(delayMs)` (or `requestAnimationFrame` when `delayMs === 0`).
- **On fire:** **re-read the flag** (multi-tab). If still unset && still collapsed && !interacted → **write the flag first, then `expand()`** (persists `'expanded'` — the right call; ephemeral `forceExpand()` would leave it collapsed next visit despite the flag being consumed). Set the flag regardless of whether expand happened.
- **Interaction during the window:** `interacted` flips (via `markInteracted`) → the effect's cleanup cancels the pending timer/RAF and the flag is set (they engaged; don't yank the UI).
- **Cleanup:** clear **both** the timeout and any RAF on unmount so React StrictMode double-invoke is deterministic.
- **Cross-tab (Codex fix 7, best-effort):** optionally listen for the `storage` event on the flag key to cancel this tab's pending timer when another tab reveals first. localStorage offers no atomic cross-tab claim — document as best-effort. If storage throws (private mode), fall back to a module-level/session flag; accept that it may reveal again on the next mount.

### D4.3 Wiring

- `PcIntroSection.tsx` gates upstream (keeps `CollapsibleSection` stage-agnostic): pass `autoRevealMs={data.stage === 'post-contract' ? data.firstLoadDelayMs : undefined}` down through `SectionShell` → `CollapsibleSection`.
- `SectionShell.tsx` forwards optional `autoRevealMs?: number` (only `PcIntroSection` sets it; others omit → no auto-reveal).
- `CollapsibleSection.tsx` calls `useWelcomeAutoReveal` with `enabled: autoRevealMs != null`, its own `useCollapseState` `{ collapsed, expand, ready, interacted, markInteracted }`, `delayMs: autoRevealMs ?? 0`, `previewMode`. The hero button calls `markInteracted()`.
- Auto-expand still fires under `prefers-reduced-motion` (content reveal, not decoration); transition is instant per D3.5.

---

## Data flow (end to end)

```
Viewbook.revealDurationScale / firstLoadDelayMs  (DB columns)
  → public-data loader (readPresentationConfig clamp/degrade)
  → ViewbookPublicData { revealDurationScale, firstLoadDelayMs }
  → ViewbookShell: style={{ '--vb-reveal-scale': String(data.revealDurationScale), ... }}  (inherits to all sections)
  → PcIntroSection: autoRevealMs = stage==='post-contract' ? firstLoadDelayMs : undefined
      → SectionShell → CollapsibleSection
          → CSS reads var(--vb-reveal-scale) for all expand/collapse motion (D3)
          → useWelcomeAutoReveal(delayMs=firstLoadDelayMs) arms the once-per-device timer (D4)

Operator: PresentationEditor → PATCH /api/viewbooks/[id] { revealDurationScale?, firstLoadDelayMs? }
  → parsePresentationPatch (validate+clamp) → updateViewbookPresentation (atomic, syncVersion bump)
```

## Error handling / edge cases

- **Corrupt/out-of-range DB value** → read clamps finite-out-of-range; defaults only on malformed. Viewer always gets a sane multiplier/delay.
- **localStorage unavailable** (private mode) → try/catch; module/session fallback; worst case re-reveal next mount (harmless).
- **`revealDurationScale ≤ 0`** → impossible post-clamp (min `0.4`); `calc()` never yields `0`/negative.
- **Multiple tabs** → re-read flag on fire + write-before-expand + optional `storage`-event cancel (best-effort; no atomic claim).
- **Manual expand/collapse within the delay** → `markInteracted` cancels the timer; flag set; no double-expand.
- **StrictMode double-invoke / unmount** → cleanup cancels timeout + RAF.
- **Stage ≠ `post-contract`** → `autoRevealMs` undefined → auto-reveal disabled.
- **SSR/hydration** → initial render always collapsed (matches SSR default); flag read + timer live in the mount effect gated on `ready` → no hydration mismatch.

## Testing

- **Unit — `presentation-config.test.ts`:** write rejects non-finite/non-integer (no coercion) + clamps; read clamps finite-out-of-range, defaults only on malformed. (D1.2)
- **Unit — `service` persistence + `public-data` threading tests:** patch persists; missing columns → defaults; set → passthrough. (D1.3)
- **Unit — `section-display.test.ts`:** `pc-intro` resolves `normal`. **`collapse.test.ts`:** unsupported-key assertion retargeted. (D2.3)
- **Unit — `useWelcomeAutoReveal` (new):** fires once after `delayMs`; no-op when flag set / `!ready` / `!enabled` / `previewMode`; canceled by `markInteracted`; `delayMs=0` RAF path; re-reads flag on fire; StrictMode/unmount cancels timeout+RAF; stored-`expanded` reconciliation; `storage`-event cancel. Fake timers + mock storage. (D4)
- **Component — `PresentationEditor.test.tsx`:** both new controls submit valid patches. (D1.5)
- **Component — `SectionShell.test.tsx`:** bookends now wrap `CollapsibleSection`. **`ViewbookShell` test:** `--vb-reveal-scale` emitted. (D1.4/D2.3)
- **Component — `CollapsibleSection`:** `data-vb-state` flips; reduced-motion path; `aria-expanded`/`inert`/one-stable-name preserved across animation. **`viewbook-navigate` test:** scroll lands after transition for both event + initial-hash paths. (D3)
- **Gates:** `npx tsc --noEmit` + `vitest` green before any merge (in-build checks disabled — local gates are the only type-check gate).
- **Manual/browser verify (Codex "verify during implementation"):** Chrome + Safari, desktop + narrow mobile; reduced motion; rapid expand↔collapse reversal; focus during collapse; TOC/search navigation into a previously-collapsed nested anchor; **first-load CLS + frame perf on a large Data Source body**; StrictMode; two-tab; storage failure; zero-delay reveal; existing-row migration defaults (`1.0`, `3000`). Confirm (a) bookends default to compact rows, (b) welcome auto-expands ~3 s on first load and not on reload, (c) pace lever visibly changes speed, (d) reduced-motion is instant.

## Migration & rollout

- One additive migration (`viewbook_reveal_pacing`), safe defaults; `prisma migrate dev` locally (commit the generated SQL), `prisma migrate deploy` in prod.
- **Suggested PR sequence** (finalized by the plan):
  1. **D1** — config levers plumbing + operator UI + `--vb-reveal-scale` injection (no visible behavior change yet; var present, transition still instant, bookends still excluded).
  2. **D2** — bookends collapse like the rest (+ ripple tests/comments).
  3. **D3** — cinematic animated transition on all expand/collapse (consumes `--vb-reveal-scale`; navigation + CLS work here).
  4. **D4** — welcome auto-reveal timer + per-device flag.
- Each PR is independently correct; all ship together or in sequence.

## Open implementation risks (for the plan)

1. **D3.2/D3.6** hero cross-fade/height-morph — build primary; fall back on the objective triggers; measure & accept the CLS budget.
2. **D3.5** navigation-into-collapsed-anchor timing.
3. **D4.1** `useCollapseState` `ready`/`markInteracted` surface must land before the auto-reveal hook consumes it.
