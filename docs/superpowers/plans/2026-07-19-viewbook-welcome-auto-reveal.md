# Viewbook Welcome Auto-Reveal, Animated Collapse & Per-Viewbook Pacing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the viewbook bookends (welcome/thank-you) collapse like every other section, auto-expand the welcome once per device 3 s after the Getting-Started stage first loads, and give every expand/collapse a smooth cinematic transition whose pace is tunable per viewbook.

**Architecture:** Two new typed `Viewbook` columns (`revealDurationScale`, `firstLoadDelayMs`) flow through the existing `presentation-config` sanitizer → `public-data` loader → `ViewbookPublicData`. `ViewbookShell` injects `--vb-reveal-scale` inline; the local-only `CollapsibleSection` island gains a CSS-driven animated open/close (`data-vb-state`) scaled by that var, plus a once-per-device auto-reveal timer for the welcome. Bookends become collapsible by emptying `COLLAPSE_EXCLUDED_SECTION_KEYS`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind (class dark mode), Prisma + SQLite, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-19-viewbook-welcome-auto-reveal-design.md` (Codex-reviewed). **Mockup:** `docs/superpowers/specs/assets/2026-07-19-viewbook-reveal-mockups.html`.

## Global Constraints

- **Base branch:** `feat/vb-collapse-local` (collapse is PURELY LOCAL / per-device localStorage, default-collapsed). Work branch: `feat/vb-welcome-auto-reveal`. All paths below are repo-relative within the worktree `.claude/worktrees/vb-welcome-auto-reveal`.
- **`revealDurationScale` is a DURATION multiplier** (higher = slower/grander). Default `1.0`, clamp `[0.4, 1.6]`, `Float`. CSS var `--vb-reveal-scale`.
- **`firstLoadDelayMs`** default `3000`, clamp `[0, 6000]`, `Int` (finite integer).
- **Presentation config sanitizer is the ONE home** (`lib/viewbook/presentation-config.ts`): write (`parsePresentationPatch`) is STRICT → `HttpError(400)`; read (`readPresentationConfig`) NEVER throws — finite-out-of-range **clamps**, only malformed/non-finite **defaults**.
- **New settings are typed `Viewbook` columns, NEVER in `themeJson`** (strict whole-object theme validator would reset stored themes).
- **No interactive `$transaction(async …)`** — array-form `$transaction([...])` only (repo invariant).
- **Gates:** `npx tsc --noEmit` + `npx vitest run` must be green before any commit that closes a task; in-build type-check/lint are disabled, so local gates are the only guard.
- **Accessibility:** keep the APG Accordion structure (`<h2><button aria-expanded aria-controls>…</button></h2>`), one stable accessible button name, `inert`/`aria-hidden` from logical collapsed state. Honor `prefers-reduced-motion` (motion off, state still changes).
- **Migration workflow:** `npx prisma migrate dev --name viewbook_reveal_pacing` locally (creates SQL + regenerates client); commit the SQL; prod applies via `prisma migrate deploy` in the deploy command.
- **Commit style:** end messages with the repo's `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and `Claude-Session:` trailer lines.

## File structure (what changes, and why)

**PR1 — config levers**
- `prisma/schema.prisma` (M) — add two `Viewbook` columns.
- `prisma/migrations/<ts>_viewbook_reveal_pacing/migration.sql` (C) — generated.
- `lib/viewbook/presentation-config.ts` (M) — validate + default + clamp the two fields.
- `lib/viewbook/presentation-config.test.ts` (M) — cases for both fields.
- `lib/viewbook/service.ts` (M) — widen `updateViewbookPresentation` patch type.
- `lib/viewbook/public-data.ts` (M) — read + thread the two fields.
- `lib/viewbook/public-types.ts` (M) — add fields to `ViewbookPublicData`.
- `components/viewbook/public/ViewbookShell.tsx` (M) — inject `--vb-reveal-scale`.
- `components/viewbook/admin/PresentationEditor.tsx` (M) + `viewbook-admin-shared.ts` (M if preset lists live there) — two operator controls.
- Tests: `service`/`public-data`/`ViewbookShell`/`PresentationEditor`.

**PR2 — bookend collapse**
- `lib/viewbook/theme.ts` (M) — empty `COLLAPSE_EXCLUDED_SECTION_KEYS`.
- `lib/viewbook/section-display.ts` (M) — drop `pc-intro` from `ALWAYS_OPEN_KEYS`.
- Tests/comments: `section-display.test.ts`, `collapse.test.ts`, `SectionShell.tsx`/`SectionShell.test.tsx`, `PcIntroSection.tsx`/`PcIntroSection.test.tsx`, stale comments in `useCollapseState.ts`/`collapse.ts`.

**PR3 — cinematic transition**
- `components/viewbook/public/CollapsibleSection.tsx` (M) — animated region (`data-vb-state`, grid-rows body, inert-from-logical-state), `<style>` block reading `--vb-reveal-scale`.
- `components/viewbook/public/SectionShell.tsx` (M) — hero "stage" (stacked faces, clamp height, shared image plane) + flourish hooks.
- `components/viewbook/public/viewbook-navigate.ts` (M) — transition-aware scroll.
- Tests: `CollapsibleSection`, `viewbook-navigate`.

**PR4 — welcome auto-reveal**
- `components/viewbook/public/useCollapseState.ts` (M) — `ready` flag + `markInteracted`.
- `components/viewbook/public/useWelcomeAutoReveal.ts` (C) — the once-per-device timer.
- `components/viewbook/public/useWelcomeAutoReveal.test.ts` (C).
- `components/viewbook/public/CollapsibleSection.tsx` (M) — consume auto-reveal + wire `markInteracted` to the button.
- `components/viewbook/public/SectionShell.tsx` (M) — forward `autoRevealMs`.
- `components/viewbook/public/PcIntroSection.tsx` (M) — pass `autoRevealMs`.

---

# PR1 — Per-viewbook config levers

*(No visible behavior change: the CSS var is present but the transition is still instant, and bookends are still excluded. This PR is pure plumbing + operator UI.)*

### Task 1: Schema columns + migration

**Files:**
- Modify: `prisma/schema.prisma` (`model Viewbook`, next to `collapseAffordance`/`heroOverlayStrength`)
- Create: `prisma/migrations/<timestamp>_viewbook_reveal_pacing/migration.sql` (generated)

- [ ] **Step 1: Add the two columns** to `model Viewbook` (immediately after `heroOverlayStrength Int @default(55)`):

```prisma
  revealDurationScale Float @default(1.0)  // 0.4..1.6 animation DURATION multiplier (higher = slower); presentation config
  firstLoadDelayMs    Int   @default(3000) // 0..6000 ms before the welcome auto-expands on first device load
```

- [ ] **Step 2: Generate the migration + client**

Run: `npx prisma migrate dev --name viewbook_reveal_pacing`
Expected: a new `prisma/migrations/<ts>_viewbook_reveal_pacing/migration.sql` containing two `ALTER TABLE "Viewbook" ADD COLUMN` statements with the defaults; Prisma client regenerates.

- [ ] **Step 3: Verify the generated SQL** has both columns with defaults `1.0` and `3000` and does not touch other tables. Confirm existing rows are safe (columns are `NOT NULL DEFAULT`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(viewbook): add revealDurationScale + firstLoadDelayMs columns"
```

---

### Task 2: Presentation-config validation

**Files:**
- Modify: `lib/viewbook/presentation-config.ts`
- Test: `lib/viewbook/presentation-config.test.ts`

**Interfaces:**
- Produces: `PRESENTATION_DEFAULTS` gains `revealDurationScale: 1.0`, `firstLoadDelayMs: 3000`. `parsePresentationPatch(raw)` return type widens to include both optional numbers. `readPresentationConfig(row)` accepts `revealDurationScale: number`, `firstLoadDelayMs: number` and returns them clamped/defaulted.

- [ ] **Step 1: Write the failing tests** — append to `presentation-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parsePresentationPatch, readPresentationConfig, PRESENTATION_DEFAULTS } from './presentation-config'

describe('revealDurationScale', () => {
  it('accepts and clamps a finite value on write', () => {
    expect(parsePresentationPatch({ revealDurationScale: 1.4 })).toEqual({ revealDurationScale: 1.4 })
    expect(parsePresentationPatch({ revealDurationScale: 5 })).toEqual({ revealDurationScale: 1.6 })
    expect(parsePresentationPatch({ revealDurationScale: 0.1 })).toEqual({ revealDurationScale: 0.4 })
  })
  it('rejects non-finite / non-number on write', () => {
    expect(() => parsePresentationPatch({ revealDurationScale: 'fast' })).toThrow()
    expect(() => parsePresentationPatch({ revealDurationScale: NaN })).toThrow()
    expect(() => parsePresentationPatch({ revealDurationScale: Infinity })).toThrow()
  })
  it('clamps finite-out-of-range on read, defaults only on malformed', () => {
    expect(readPresentationConfig({ collapseAffordance: 'chevron', heroOverlayStrength: 55, revealDurationScale: 9, firstLoadDelayMs: 3000 }).revealDurationScale).toBe(1.6)
    expect(readPresentationConfig({ collapseAffordance: 'chevron', heroOverlayStrength: 55, revealDurationScale: NaN, firstLoadDelayMs: 3000 }).revealDurationScale).toBe(1.0)
  })
})

describe('firstLoadDelayMs', () => {
  it('accepts finite integers and clamps on write', () => {
    expect(parsePresentationPatch({ firstLoadDelayMs: 2000 })).toEqual({ firstLoadDelayMs: 2000 })
    expect(parsePresentationPatch({ firstLoadDelayMs: 99999 })).toEqual({ firstLoadDelayMs: 6000 })
    expect(parsePresentationPatch({ firstLoadDelayMs: -5 })).toEqual({ firstLoadDelayMs: 0 })
  })
  it('rejects non-integer / non-finite on write', () => {
    expect(() => parsePresentationPatch({ firstLoadDelayMs: 12.5 })).toThrow()
    expect(() => parsePresentationPatch({ firstLoadDelayMs: 'soon' })).toThrow()
  })
  it('defaults present in PRESENTATION_DEFAULTS', () => {
    expect(PRESENTATION_DEFAULTS.revealDurationScale).toBe(1.0)
    expect(PRESENTATION_DEFAULTS.firstLoadDelayMs).toBe(3000)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/viewbook/presentation-config.test.ts`
Expected: FAIL (fields undefined / no validation).

- [ ] **Step 3: Implement** — edit `presentation-config.ts`:

Extend `PRESENTATION_DEFAULTS`:
```ts
export const PRESENTATION_DEFAULTS = {
  collapseAffordance: 'chevron' as CollapseAffordanceKind,
  heroOverlayStrength: 55,
  revealDurationScale: 1.0,
  firstLoadDelayMs: 3000,
}

const REVEAL_SCALE_MIN = 0.4
const REVEAL_SCALE_MAX = 1.6
const FIRST_LOAD_DELAY_MIN = 0
const FIRST_LOAD_DELAY_MAX = 6000
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
```

Widen `parsePresentationPatch`'s return type and add the two blocks before `return patch`:
```ts
export function parsePresentationPatch(
  raw: Record<string, unknown>,
): Partial<{ collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number; revealDurationScale: number; firstLoadDelayMs: number }> {
  const patch: Partial<{ collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number; revealDurationScale: number; firstLoadDelayMs: number }> = {}
  // ...existing collapseAffordance + heroOverlayStrength blocks unchanged...
  if ('revealDurationScale' in raw) {
    const n = raw.revealDurationScale
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, 'invalid_reveal_scale')
    patch.revealDurationScale = clamp(n, REVEAL_SCALE_MIN, REVEAL_SCALE_MAX)
  }
  if ('firstLoadDelayMs' in raw) {
    const n = raw.firstLoadDelayMs
    if (typeof n !== 'number' || !Number.isInteger(n)) throw new HttpError(400, 'invalid_first_load_delay')
    patch.firstLoadDelayMs = clamp(n, FIRST_LOAD_DELAY_MIN, FIRST_LOAD_DELAY_MAX)
  }
  return patch
}
```

Extend `readPresentationConfig`'s param type + return (finite → clamp, else default):
```ts
export function readPresentationConfig(row: {
  collapseAffordance: string
  heroOverlayStrength: number
  revealDurationScale: number
  firstLoadDelayMs: number
}): { collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number; revealDurationScale: number; firstLoadDelayMs: number } {
  return {
    // ...existing collapseAffordance + heroOverlayStrength unchanged...
    revealDurationScale: Number.isFinite(row.revealDurationScale)
      ? clamp(row.revealDurationScale, REVEAL_SCALE_MIN, REVEAL_SCALE_MAX)
      : PRESENTATION_DEFAULTS.revealDurationScale,
    firstLoadDelayMs: Number.isFinite(row.firstLoadDelayMs)
      ? clamp(Math.round(row.firstLoadDelayMs), FIRST_LOAD_DELAY_MIN, FIRST_LOAD_DELAY_MAX)
      : PRESENTATION_DEFAULTS.firstLoadDelayMs,
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/viewbook/presentation-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/viewbook/presentation-config.ts lib/viewbook/presentation-config.test.ts
git commit -m "feat(viewbook): validate+clamp revealDurationScale & firstLoadDelayMs in presentation-config"
```

---

### Task 3: Service patch type + public-data threading + public-types

**Files:**
- Modify: `lib/viewbook/service.ts` (`updateViewbookPresentation`)
- Modify: `lib/viewbook/public-data.ts`
- Modify: `lib/viewbook/public-types.ts` (`ViewbookPublicData`)
- Test: `lib/viewbook/public-data.test.ts` (thread test), `lib/viewbook/service.test.ts` (persistence)

**Interfaces:**
- Consumes: `readPresentationConfig` (Task 2), the new columns (Task 1).
- Produces: `ViewbookPublicData` gains `revealDurationScale: number`, `firstLoadDelayMs: number`.

- [ ] **Step 1: Write failing threading test** — in `public-data.test.ts`, assert a viewbook row with `revealDurationScale: 1.4, firstLoadDelayMs: 2000` surfaces those on the public data object, and a row with an out-of-range/omitted value degrades to the clamp/default. (Follow the file's existing fixture/mock pattern for `collapseAffordance`/`heroOverlayStrength`.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/viewbook/public-data.test.ts` → FAIL (fields absent).

- [ ] **Step 3: Implement:**
  - `public-types.ts` `ViewbookPublicData` — add `revealDurationScale: number` and `firstLoadDelayMs: number` next to `collapseAffordance`/`heroOverlayStrength`.
  - `public-data.ts` — wherever `readPresentationConfig({ collapseAffordance, heroOverlayStrength })` is called, pass the two new columns too and spread the result onto the emitted data object (add `revealDurationScale`, `firstLoadDelayMs` to the returned shape). Ensure the DB `select`/query includes the two new columns.
  - `service.ts` `updateViewbookPresentation` — widen the `patch` param type to `Partial<{ collapseAffordance: string; heroOverlayStrength: number; revealDurationScale: number; firstLoadDelayMs: number }>`. No logic change (still the atomic `$transaction([syncVersionBump, viewbook.update({ data: patch })])`).

- [ ] **Step 4: Add a service persistence test** in `service.test.ts`: calling `updateViewbookPresentation(id, { revealDurationScale: 0.7, firstLoadDelayMs: 5000 })` persists both and bumps `syncVersion` (mirror the existing overlay/affordance test).

- [ ] **Step 5: Run to verify pass** — `npx vitest run lib/viewbook/public-data.test.ts lib/viewbook/service.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/viewbook/service.ts lib/viewbook/public-data.ts lib/viewbook/public-types.ts lib/viewbook/public-data.test.ts lib/viewbook/service.test.ts
git commit -m "feat(viewbook): thread revealDurationScale & firstLoadDelayMs through service + public-data"
```

---

### Task 4: Inject `--vb-reveal-scale`

**Files:**
- Modify: `components/viewbook/public/ViewbookShell.tsx`
- Test: `components/viewbook/public/ViewbookShell.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `data.revealDurationScale` (Task 3).

- [ ] **Step 1: Write failing test** — render `ViewbookShell` with `data.revealDurationScale = 0.7`; assert the `[data-vb-theme-root]` element's inline style contains `--vb-reveal-scale: 0.7`. (Follow the shell's existing render-with-fixture test setup; if no test file exists, create one mirroring another public-component test's harness.)

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement** — in `ViewbookShell.tsx`, in the `style={{ ...themeCssVars(data.theme), '--vb-sticky-offset': '64px' }}` object on the `data-vb-theme-root` div, add:
```ts
'--vb-reveal-scale': String(data.revealDurationScale),
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/ViewbookShell.tsx components/viewbook/public/ViewbookShell.test.tsx
git commit -m "feat(viewbook): inject --vb-reveal-scale on the theme root"
```

---

### Task 5: Operator UI — reveal pace + first-load delay controls

**Files:**
- Modify: `components/viewbook/admin/PresentationEditor.tsx`
- Modify (if preset/control metadata lives there): `components/viewbook/admin/viewbook-admin-shared.ts`
- Test: `components/viewbook/admin/PresentationEditor.test.tsx`

**Interfaces:**
- Consumes: the PATCH path already runs `parsePresentationPatch`; sending `{ revealDurationScale }` / `{ firstLoadDelayMs }` persists (Tasks 2–3).

- [ ] **Step 1: Write failing tests** — in `PresentationEditor.test.tsx`: (a) selecting the "Brisk" pace preset issues a PATCH containing `revealDurationScale: 0.7`; (b) moving the reveal-pace slider to `1.4` PATCHes `revealDurationScale: 1.4`; (c) moving the delay slider to `2000` (or `2` s) PATCHes `firstLoadDelayMs: 2000`. Mirror the existing affordance/overlay control tests' PATCH-assertion pattern.

- [ ] **Step 2: Run to verify failure** — FAIL (controls absent).

- [ ] **Step 3: Implement** — add two labeled control groups beside the affordance/overlay controls:
  - **Reveal pace:** preset buttons `Grand=1.4`, `Standard=1.0`, `Brisk=0.7`, `Snappy=0.5` (define the list in `viewbook-admin-shared.ts` as `REVEAL_PACE_PRESETS` if that's where affordance options live), plus `<input type="range" min={0.4} max={1.6} step={0.05}>` labeled "Faster ← → Slower". On change, PATCH `{ revealDurationScale: value }` through the same handler the affordance/overlay controls use.
  - **First-load delay (welcome):** `<input type="range" min={0} max={6000} step={250}>` (label the value in seconds, e.g. `${(v/1000).toFixed(2)}s`). On change, PATCH `{ firstLoadDelayMs: value }`.
  Seed both controls from the loaded viewbook's current `revealDurationScale`/`firstLoadDelayMs`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/viewbook/admin/PresentationEditor.test.tsx` → PASS.

- [ ] **Step 5: Full gates + commit**

```bash
npx tsc --noEmit && npx vitest run
git add components/viewbook/admin/PresentationEditor.tsx components/viewbook/admin/PresentationEditor.test.tsx components/viewbook/admin/viewbook-admin-shared.ts
git commit -m "feat(viewbook): operator controls for reveal pace + first-load delay"
```

---

# PR2 — Bookends collapse like the rest

### Task 6: Empty the exclusion set + drop pc-intro from always-open

**Files:**
- Modify: `lib/viewbook/theme.ts`
- Modify: `lib/viewbook/section-display.ts`
- Test: `lib/viewbook/section-display.test.ts`

- [ ] **Step 1: Write/adjust failing tests** — in `section-display.test.ts`, assert `sectionDisplayMode({ sectionKey: 'pc-intro', state: 'active', … }, 'post-contract')` returns `'normal'` (was `'always-open'`). Add/keep an assertion that `sectionSupportsCollapse('pc-intro')` and `sectionSupportsCollapse('pc-thanks')` both return `true`.

- [ ] **Step 2: Run to verify failure** — FAIL (`pc-intro` still `always-open`; helper still `false` for bookends).

- [ ] **Step 3: Implement:**
  - `theme.ts` — change `COLLAPSE_EXCLUDED_SECTION_KEYS` to `new Set<string>()` (empty). Update the banner comment: "All sections are now collapsible; bookends included (2026-07-19 welcome-auto-reveal). The constant + `sectionSupportsCollapse` are retained for a possible future carve-out and for the dormant server path."
  - `section-display.ts` — remove `'pc-intro'` from `ALWAYS_OPEN_KEYS` (leaving `new Set<string>()` or whatever remains). Update the comment noting `pc-intro` is now an ordinary collapsible section.

- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/viewbook/section-display.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/viewbook/theme.ts lib/viewbook/section-display.ts lib/viewbook/section-display.test.ts
git commit -m "feat(viewbook): bookends (pc-intro/pc-thanks) collapse like every other section"
```

---

### Task 7: Ripple — bookend-collapse tests + stale comments

**Files:**
- Modify: `lib/viewbook/collapse.test.ts`
- Modify: `components/viewbook/public/SectionShell.tsx` (comments), `components/viewbook/public/SectionShell.test.tsx`
- Modify: `components/viewbook/public/PcIntroSection.tsx` (comment), `components/viewbook/public/PcIntroSection.test.tsx`
- Modify: `components/viewbook/public/useCollapseState.ts` (comment), `lib/viewbook/collapse.ts` (comment)

- [ ] **Step 1: Update the dormant-guard test** — in `collapse.test.ts`, the case asserting `pc-intro` → `400` (bookend rejected) no longer holds. Retarget it to a genuinely unknown key (e.g. `sectionKey: 'not-a-real-section'` → `400 invalid_section`). Keep the archived/rotated/revoked cases.

- [ ] **Step 2: Update `SectionShell.test.tsx`** (~line 194) — the branch that asserted bookends render WITHOUT a `CollapsibleSection` wrapper now expects them to wrap in `CollapsibleSection` (render a bookend, assert the collapse button / `role="region"` is present). Follow the existing assertion style for a collapsible section.

- [ ] **Step 3: Update `PcIntroSection.test.tsx`** (~line 67) — assert the welcome now renders as collapsible (compact-row + expand control) rather than a permanently-open hero.

- [ ] **Step 4: Fix stale comments** — remove/replace every "bookends are excluded / never collapse" phrasing in: `SectionShell.tsx` (the bookend branch comment), `useCollapseState.ts` (banner line ~14–15: "SectionShell excludes the two bookend sections from this entirely — they never collapse"), and `lib/viewbook/collapse.ts` (bookend-guard comment). Replace with: "All sections are collapsible as of 2026-07-19; the dormant guard's `sectionSupportsCollapse` check now excludes nothing."

- [ ] **Step 5: Run gates** — `npx tsc --noEmit && npx vitest run` → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/viewbook/collapse.test.ts components/viewbook/public/SectionShell.tsx components/viewbook/public/SectionShell.test.tsx components/viewbook/public/PcIntroSection.tsx components/viewbook/public/PcIntroSection.test.tsx components/viewbook/public/useCollapseState.ts lib/viewbook/collapse.ts
git commit -m "test(viewbook): update collapse ripple — bookends now collapsible; refresh stale comments"
```

---

# PR3 — Cinematic expand/collapse transition (all sections)

*Build the PRIMARY approach (D3.2–D3.4). If browser verification (Task 11 close-out) hits any objective trigger — duplicate AT names, wrong anchor landing, bad rapid reversal, mobile long-frame jank, unacceptable first-load CLS — fall back to: instant hero-face swap + animate only the body reveal + hero flourishes. Record which path shipped.*

### Task 8: Animated body region (`data-vb-state`, grid-rows, inert-from-logical-state)

**Files:**
- Modify: `components/viewbook/public/CollapsibleSection.tsx`
- Test: `components/viewbook/public/CollapsibleSection.test.tsx` (create if absent)

**Interfaces:**
- Produces: the `CollapsibleSection` root carries `data-vb-state={collapsed ? 'collapsed' : 'expanded'}`; the body region stays mounted (no `display:none`), animated via grid-rows.

- [ ] **Step 1: Write failing tests** — render `CollapsibleSection` (mock `useCollapseState` or drive via the hero button click): assert (a) root has `data-vb-state="collapsed"` initially and `"expanded"` after clicking the button; (b) the region div is present in the DOM in BOTH states (no `display:none`), with `inert`/`aria-hidden` set only when collapsed; (c) `aria-expanded` on the button flips.

- [ ] **Step 2: Run to verify failure** — FAIL (`data-vb-state` absent; region uses `display:none`).

- [ ] **Step 3: Implement** — replace the region markup + add the state attr + a scoped `<style>`:

```tsx
return (
  <div data-vb-state={collapsed ? 'collapsed' : 'expanded'} className="vb-collapsible">
    <style>{`
      .vb-collapsible .vb-body {
        display: grid;
        grid-template-rows: 1fr;
        transition: grid-template-rows calc(520ms * var(--vb-reveal-scale, 1)) cubic-bezier(.16,1,.3,1);
      }
      .vb-collapsible[data-vb-state="collapsed"] .vb-body { grid-template-rows: 0fr; }
      .vb-collapsible .vb-body-inner { overflow: hidden; min-height: 0; }
      .vb-collapsible .vb-body-lift {
        opacity: 1; transform: none;
        transition: opacity calc(520ms * var(--vb-reveal-scale, 1)) cubic-bezier(.16,1,.3,1),
                    transform calc(520ms * var(--vb-reveal-scale, 1)) cubic-bezier(.16,1,.3,1);
      }
      .vb-collapsible[data-vb-state="collapsed"] .vb-body-lift { opacity: 0; transform: translateY(20px); }
      @media (prefers-reduced-motion: reduce) {
        .vb-collapsible .vb-body, .vb-collapsible .vb-body-lift { transition: none; }
      }
    `}</style>
    <h2>
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={regionId}
        onClick={collapsed ? expand : collapse}
        className="group block w-full appearance-none rounded-xl border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2"
      >
        {collapsed ? heroCollapsed : heroExpanded}
      </button>
    </h2>
    {/* Region ALWAYS present & mounted; grid-rows collapses it (NOT display:none,
        which kills the transition). inert/aria-hidden come from logical state. */}
    <div
      id={regionId}
      role="region"
      aria-label={title}
      aria-hidden={collapsed ? true : undefined}
      inert={collapsed}
      className="vb-body"
    >
      <div className="vb-body-inner">
        <div className="vb-body-lift">{body}</div>
      </div>
    </div>
  </div>
)
```

Remove the old `hidden={collapsed}` and `style={{ display: 'none' }}`. Keep `forceExpand` wiring (the `useEffect`) unchanged for now.

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/viewbook/public/CollapsibleSection.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/CollapsibleSection.tsx components/viewbook/public/CollapsibleSection.test.tsx
git commit -m "feat(viewbook): animate section body reveal (grid-rows, --vb-reveal-scale, reduced-motion)"
```

---

### Task 9: Hero "stage" — stacked faces, clamp height, shared image plane

**Files:**
- Modify: `components/viewbook/public/SectionShell.tsx`
- Modify: `components/viewbook/public/CollapsibleSection.tsx` (render both faces stacked inside the button)
- Test: `components/viewbook/public/SectionShell.test.tsx`, `CollapsibleSection.test.tsx`

**Interfaces:**
- Consumes: `heroExpanded`, `heroCollapsed` from `SectionShell` (unchanged prop names).
- Produces: both faces render simultaneously (stacked, opacity cross-faded); the inactive face is `aria-hidden`.

> **Note:** exact heights/opacities here are STARTING VALUES tuned in Task 11's browser verification. Keep the button's accessible name stable (the expanded title span is the name source; the collapsed row's title span is `aria-hidden` when collapsed is NOT active — i.e. only the active face contributes the name).

- [ ] **Step 1: Write failing test** — assert that inside the button, BOTH a collapsed-face node and an expanded-face node exist in the DOM (query by a `data-vb-face="collapsed"` / `data-vb-face="expanded"` attribute you add), and the inactive one has `aria-hidden="true"`. Assert exactly one accessible name (`getByRole('button', { name: title })` resolves uniquely).

- [ ] **Step 2: Run to verify failure** — FAIL (only one face rendered today).

- [ ] **Step 3: Implement** — in `CollapsibleSection`, render a stage wrapping both faces:

```tsx
// inside the <button>:
<span className="vb-hero-stage">
  <span className="vb-hero-face vb-hero-face--collapsed" data-vb-face="collapsed" aria-hidden={collapsed ? undefined : true}>
    {heroCollapsed}
  </span>
  <span className="vb-hero-face vb-hero-face--expanded" data-vb-face="expanded" aria-hidden={collapsed ? true : undefined}>
    {heroExpanded}
  </span>
</span>
```

Add to the `<style>` block:
```css
.vb-collapsible .vb-hero-stage { position: relative; display: block;
  height: 82px;                 /* collapsed row height incl. py-1 — verify vs rendered row */
  transition: height calc(600ms * var(--vb-reveal-scale, 1)) cubic-bezier(.16,1,.3,1); }
.vb-collapsible[data-vb-state="expanded"] .vb-hero-stage { height: clamp(240px, 38svh, 560px); }
.vb-collapsible .vb-hero-face { position: absolute; inset: 0; display: block;
  transition: opacity calc(400ms * var(--vb-reveal-scale, 1)) ease; }
.vb-collapsible .vb-hero-face--expanded { opacity: 0; }
.vb-collapsible .vb-hero-face--collapsed { opacity: 1; }
.vb-collapsible[data-vb-state="expanded"] .vb-hero-face--expanded { opacity: 1; }
.vb-collapsible[data-vb-state="expanded"] .vb-hero-face--collapsed { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .vb-collapsible .vb-hero-stage, .vb-collapsible .vb-hero-face { transition: none; }
}
```

In `SectionShell.tsx`: `buildExpandedHero()` should no longer set its own `min-h-[38vh]`/`min-h-[30vh]` (the stage owns height now) — change its root to fill the stage (`absolute inset-0` / `h-full`). Confirm the shared section image renders once per face is acceptable for v1; if double-paint shows in Task 11, hoist the `<img>` to a single shared plane behind both faces (documented as the shared-image-plane refinement).

- [ ] **Step 4: Run to verify pass** — PASS. Manually eyeball in `npm run dev` that collapsed shows the row and expanding cross-fades to the hero without a hard jump (full tuning in Task 11).

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/CollapsibleSection.tsx components/viewbook/public/SectionShell.tsx components/viewbook/public/CollapsibleSection.test.tsx components/viewbook/public/SectionShell.test.tsx
git commit -m "feat(viewbook): hero stage with cross-faded collapsed/expanded faces"
```

---

### Task 10: Hero flourishes (Ken-Burns, eyebrow, rule)

**Files:**
- Modify: `components/viewbook/public/SectionShell.tsx` (expanded-hero markup: add hooks), `CollapsibleSection.tsx` (`<style>`)

- [ ] **Step 1:** In `buildExpandedHero()`, ensure the hero image, an eyebrow line, and the gold rule carry stable class hooks (`vb-hero-img`, `vb-hero-eyebrow`, `vb-hero-rule`). (The eyebrow may be new small copy, e.g. an uppercase label; keep it optional/tasteful.)

- [ ] **Step 2:** Add flourish CSS to the `<style>` block, all keyed off `data-vb-state="expanded"` and scaled by `--vb-reveal-scale`:
```css
.vb-collapsible .vb-hero-img { transform: scale(1.06); transform-origin: 60% 40%;
  transition: transform calc(1100ms * var(--vb-reveal-scale, 1)) cubic-bezier(.16,1,.3,1); }
.vb-collapsible[data-vb-state="expanded"] .vb-hero-img { transform: scale(1); }
.vb-collapsible .vb-hero-eyebrow { opacity: 0; transform: translateY(6px);
  transition: opacity calc(600ms * var(--vb-reveal-scale,1)) ease, transform calc(600ms * var(--vb-reveal-scale,1)) ease; }
.vb-collapsible[data-vb-state="expanded"] .vb-hero-eyebrow { opacity: 1; transform: none; }
.vb-collapsible .vb-hero-rule { transform: scaleX(0); transform-origin: left center;
  transition: transform calc(700ms * var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1); }
.vb-collapsible[data-vb-state="expanded"] .vb-hero-rule { transform: scaleX(1); }
@media (prefers-reduced-motion: reduce) {
  .vb-collapsible .vb-hero-img, .vb-collapsible .vb-hero-eyebrow, .vb-collapsible .vb-hero-rule { transition: none; transform: none; opacity: 1; }
}
```

- [ ] **Step 3:** `npm run dev` eyeball: expanding a section plays the Ken-Burns + rule draw; reduced-motion shows the final state instantly. Adjust `transform-origin`/durations to taste.

- [ ] **Step 4: Commit**

```bash
git add components/viewbook/public/SectionShell.tsx components/viewbook/public/CollapsibleSection.tsx
git commit -m "feat(viewbook): cinematic hero flourishes (ken-burns, eyebrow, gold rule) scaled by --vb-reveal-scale"
```

---

### Task 11: Animation-aware navigation + browser verification / primary-vs-fallback decision

**Files:**
- Modify: `components/viewbook/public/viewbook-navigate.ts`
- Test: `components/viewbook/public/viewbook-navigate.test.ts` (create if absent)

- [ ] **Step 1: Write failing test** — simulate a `vb:navigate` to a section that must expand-then-scroll: assert the scroll-into-view fires AFTER the collapse transition resolves (mock `transitionend` or the corrective timeout), not after a single `requestAnimationFrame`. Cover the initial `location.hash` path too.

- [ ] **Step 2: Run to verify failure** — FAIL (current code scrolls after one frame).

- [ ] **Step 3: Implement** — in `viewbook-navigate.ts` (~line 85), replace the single-frame scroll with: after dispatching `vb:navigate`/reading the hash, wait for the target section's hero-stage `transitionend` (listen once, with a `setTimeout` fallback of `~700ms * scale` in case no transition fires, e.g. reduced-motion), then `scrollIntoView`. Apply to both the event path and the initial-hash path.

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: BROWSER VERIFICATION (the primary-vs-fallback gate)** — `npm run dev`, load a viewbook, and check the spec's objective triggers:
  - Chrome + Safari, desktop + narrow-mobile viewport.
  - Reduced motion → instant.
  - Rapid expand→collapse→expand reversal → no stuck/duplicated frames.
  - TOC/search + deep-link (`#section`) into a collapsed nested anchor → lands correctly after the transition.
  - First-load CLS + frame perf on a LARGE Data Source body (record the CLS number; state the accepted budget).
  - Assistive-tech: exactly one accessible name per section button.
  If any trigger fails and can't be tuned out, switch to the fallback (instant hero-face swap; keep body reveal + flourishes) and note it in the commit + spec.

- [ ] **Step 6: Full gates + commit**

```bash
npx tsc --noEmit && npx vitest run
git add components/viewbook/public/viewbook-navigate.ts components/viewbook/public/viewbook-navigate.test.ts
git commit -m "feat(viewbook): animation-aware navigation scroll (transitionend, hash + vb:navigate paths)"
```

---

# PR4 — Welcome auto-reveal (once per device)

### Task 12: `useCollapseState` — `ready` flag + `markInteracted`

**Files:**
- Modify: `components/viewbook/public/useCollapseState.ts`
- Test: `components/viewbook/public/useCollapseState.test.ts` (create if absent)

**Interfaces:**
- Produces: `useCollapseState(...)` return gains `ready: boolean` (false until the mount reconcile effect runs) and `markInteracted: () => void` + `interacted: boolean`.

- [ ] **Step 1: Write failing test** — `ready` is `false` on first render and `true` after the mount effect; calling `expand()`/`collapse()` sets `interacted` true; `markInteracted()` sets `interacted` true without changing `collapsed`.

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement** — add state + wire it:
```ts
const [ready, setReady] = useState(false)
const [interacted, setInteracted] = useState(false)
// in the mount effect, after setCollapsed(...): setReady(true)
// (previewMode branch also sets setReady(true))
const markInteracted = useCallback(() => setInteracted(true), [])
// expand/collapse each also call setInteracted(true)
return { collapsed, expand, collapse, forceExpand, ready, interacted, markInteracted }
```
(In the `previewMode` early-return branch of the effect, also `setReady(true)`.)

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/useCollapseState.ts components/viewbook/public/useCollapseState.test.ts
git commit -m "feat(viewbook): useCollapseState exposes ready + markInteracted for auto-reveal"
```

---

### Task 13: `useWelcomeAutoReveal` hook

**Files:**
- Create: `components/viewbook/public/useWelcomeAutoReveal.ts`
- Test: `components/viewbook/public/useWelcomeAutoReveal.test.ts`

**Interfaces:**
- Consumes: `ready`, `collapsed`, `interacted`, `expand` from `useCollapseState` (Task 12).
- Produces: `useWelcomeAutoReveal({ viewbookId, enabled, ready, collapsed, interacted, expand, delayMs, previewMode })` — arms a once-per-device timer.

- [ ] **Step 1: Write failing tests** (fake timers + a mock `localStorage`):
```ts
// fires once after delayMs when enabled/ready/collapsed/flag-unset:
//   advance delayMs → expand() called once, flag 'vb:welcome-revealed:<id>' set to '1'
// no-op when flag already '1'
// no-op when !ready / !enabled / previewMode
// interacted=true before fire → timer canceled, expand() NOT called, flag set
// delayMs=0 → expands on next frame (RAF), flag set
// already expanded (collapsed=false) at arm time → flag set, expand() NOT called
// unmount before fire → no expand(), no leak (timer cleared)
```

- [ ] **Step 2: Run to verify failure** — FAIL (module absent).

- [ ] **Step 3: Implement:**
```ts
'use client'
import { useEffect } from 'react'

export function welcomeRevealedKey(viewbookId: number): string {
  return `vb:welcome-revealed:${viewbookId}`
}
function readFlag(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function writeFlag(key: string): void {
  try { localStorage.setItem(key, '1') } catch { /* private mode — best effort */ }
}

export function useWelcomeAutoReveal({
  viewbookId, enabled, ready, collapsed, interacted, expand, delayMs, previewMode = false,
}: {
  viewbookId: number
  enabled: boolean
  ready: boolean
  collapsed: boolean
  interacted: boolean
  expand: () => void
  delayMs: number
  previewMode?: boolean
}): void {
  useEffect(() => {
    if (!enabled || previewMode || !ready) return
    const key = welcomeRevealedKey(viewbookId)
    if (readFlag(key)) return
    if (interacted) { writeFlag(key); return }
    if (!collapsed) { writeFlag(key); return } // already open — consume the one-shot

    let timer: ReturnType<typeof setTimeout> | null = null
    let raf: number | null = null
    const fire = () => {
      if (readFlag(key)) return          // another tab revealed first
      writeFlag(key)                     // write BEFORE expand (multi-tab claim, best-effort)
      expand()
    }
    if (delayMs <= 0) { raf = requestAnimationFrame(fire) }
    else { timer = setTimeout(fire, delayMs) }

    // Cross-tab: if another tab sets the flag, cancel our pending reveal.
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue === '1') {
        if (timer) clearTimeout(timer)
        if (raf) cancelAnimationFrame(raf)
      }
    }
    try { window.addEventListener('storage', onStorage) } catch { /* noop */ }

    return () => {
      if (timer) clearTimeout(timer)
      if (raf) cancelAnimationFrame(raf)
      try { window.removeEventListener('storage', onStorage) } catch { /* noop */ }
    }
  }, [viewbookId, enabled, ready, collapsed, interacted, expand, delayMs, previewMode])
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/viewbook/public/useWelcomeAutoReveal.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/useWelcomeAutoReveal.ts components/viewbook/public/useWelcomeAutoReveal.test.ts
git commit -m "feat(viewbook): useWelcomeAutoReveal once-per-device timer hook"
```

---

### Task 14: Wire auto-reveal through the welcome section

**Files:**
- Modify: `components/viewbook/public/CollapsibleSection.tsx`
- Modify: `components/viewbook/public/SectionShell.tsx`
- Modify: `components/viewbook/public/PcIntroSection.tsx`
- Test: `components/viewbook/public/CollapsibleSection.test.tsx`

**Interfaces:**
- Consumes: `useWelcomeAutoReveal` (Task 13), `useCollapseState` `ready`/`interacted`/`markInteracted` (Task 12), `data.firstLoadDelayMs` (Task 3).

- [ ] **Step 1: Write failing test** — render `CollapsibleSection` with `autoRevealMs={0}` and no stored flag: after a frame, the root flips to `data-vb-state="expanded"` and the flag is written. With `autoRevealMs={undefined}`, it never auto-expands. Clicking the button calls `markInteracted` (assert via the state not auto-revealing afterward).

- [ ] **Step 2: Run to verify failure** — FAIL (`autoRevealMs` prop + hook not wired).

- [ ] **Step 3: Implement:**
  - `CollapsibleSection.tsx` — accept `autoRevealMs?: number`; pull `ready, interacted, markInteracted` from `useCollapseState`; call:
    ```ts
    useWelcomeAutoReveal({
      viewbookId, enabled: autoRevealMs != null, ready, collapsed, interacted,
      expand, delayMs: autoRevealMs ?? 0, previewMode,
    })
    ```
    and change the button `onClick` to also mark interaction:
    ```ts
    onClick={() => { markInteracted(); (collapsed ? expand : collapse)() }}
    ```
  - `SectionShell.tsx` — accept optional `autoRevealMs?: number` and pass it to `CollapsibleSection`.
  - `PcIntroSection.tsx` — pass `autoRevealMs={data.stage === 'post-contract' ? data.firstLoadDelayMs : undefined}` to `SectionShell` (alongside the existing `affordance`/`overlayStrength`). No other bookend sets it.

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/viewbook/public/CollapsibleSection.test.tsx` → PASS.

- [ ] **Step 5: BROWSER VERIFICATION** — `npm run dev`, open a `post-contract` viewbook in a fresh browser profile: the welcome auto-expands ~3 s after load with the cinematic transition; reload → it does NOT auto-expand again (flag set); manually collapsing before 3 s cancels it; second tab doesn't double-fire. Check reduced-motion (instant) and zero-delay setting.

- [ ] **Step 6: Full gates + commit**

```bash
npx tsc --noEmit && npx vitest run
git add components/viewbook/public/CollapsibleSection.tsx components/viewbook/public/SectionShell.tsx components/viewbook/public/PcIntroSection.tsx components/viewbook/public/CollapsibleSection.test.tsx
git commit -m "feat(viewbook): welcome auto-reveals once per device after firstLoadDelayMs"
```

---

## Self-review (completed)

- **Spec coverage:** D1 → Tasks 1–5; D2 → Tasks 6–7; D3 → Tasks 8–11 (incl. navigation + CLS gate); D4 → Tasks 12–14. Migration (Task 1), read-clamp semantics (Task 2), `--vb-reveal-scale` (Task 4), ripple inventory (Task 7), reduced-motion (Tasks 8–10), primary/fallback triggers (Task 11), `ready`/`markInteracted`/multi-tab (Tasks 12–14) all mapped.
- **Type consistency:** `revealDurationScale`/`firstLoadDelayMs` (columns → `PRESENTATION_DEFAULTS` → `parsePresentationPatch` → `readPresentationConfig` → `ViewbookPublicData` → `--vb-reveal-scale`/`autoRevealMs`) named identically throughout. `useCollapseState` returns `{ collapsed, expand, collapse, forceExpand, ready, interacted, markInteracted }` consumed verbatim in Tasks 13–14. `data-vb-state`, `.vb-hero-stage/.vb-hero-face/.vb-body/.vb-body-lift/.vb-hero-img/.vb-hero-eyebrow/.vb-hero-rule` consistent across Tasks 8–10.
- **Placeholders:** CSS numeric values in PR3 are explicitly labeled starting values tuned in Task 11's browser gate — not vague TODOs; all logic/test/schema code is complete. Two soft anchors (`SectionShell.test.tsx:194`, `PcIntroSection.test.tsx:67`) are approximate line numbers to locate the existing case, not missing code.

## Execution notes

- Each PR is independently correct and mergeable; land in order (D1→D2→D3→D4) or as one branch.
- After PR4, run `/codex-review` on the branch diff (P1 — touches a public render path + a new hook) before merge, then the standard tsc+vitest gate, then Kevin's ship ritual (tracker/handoff, deploy).
