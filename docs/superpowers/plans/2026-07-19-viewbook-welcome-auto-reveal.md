# Viewbook Welcome Auto-Reveal, Animated Collapse & Per-Viewbook Pacing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the viewbook bookends (welcome/thank-you) collapse like every other section, auto-expand the welcome once per device 3 s after the Getting-Started stage first loads, and give every expand/collapse a smooth cinematic transition whose pace is tunable per viewbook.

**Architecture:** Two new typed `Viewbook` columns (`revealDurationScale`, `firstLoadDelayMs`) flow through the existing `presentation-config` sanitizer → the `public-data` + `operator-data` loaders → `ViewbookPublicData`/`OperatorViewbookData`. `ViewbookShell` injects `--vb-reveal-scale` inline; the local-only `CollapsibleSection` island gains a CSS-driven animated open/close (`data-vb-state`) scaled by that var, plus a once-per-device auto-reveal timer for the welcome. Bookends become collapsible by emptying `COLLAPSE_EXCLUDED_SECTION_KEYS`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind (class dark mode), Prisma + SQLite, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-19-viewbook-welcome-auto-reveal-design.md` (Codex-reviewed). **Mockup:** `docs/superpowers/specs/assets/2026-07-19-viewbook-reveal-mockups.html`. **This plan is Codex-reviewed (2026-07-19, accept-with-named-fixes, applied).**

## Global Constraints

- **Base branch:** `feat/vb-collapse-local` (collapse is PURELY LOCAL / per-device localStorage, default-collapsed). Work branch: `feat/vb-welcome-auto-reveal`. Paths are repo-relative within the worktree `.claude/worktrees/vb-welcome-auto-reveal`.
- **`revealDurationScale`** = DURATION multiplier (higher = slower/grander). `Float`, default `1.0`, clamp `[0.4, 1.6]`. CSS var `--vb-reveal-scale`.
- **`firstLoadDelayMs`** `Int`, default `3000`, clamp `[0, 6000]`, must be a finite integer.
- **Presentation config is the ONE home** (`lib/viewbook/presentation-config.ts`): write (`parsePresentationPatch`) STRICT → `HttpError(400)`; read (`readPresentationConfig`) NEVER throws — finite-out-of-range **clamps**, only malformed/non-finite **defaults**.
- **New settings are typed `Viewbook` columns, NEVER `themeJson`.**
- **No interactive `$transaction(async …)`** — array-form only.
- **Migration workflow (matches this repo — recent migrations use real `migrate dev` timestamps):** `npx prisma migrate dev --name viewbook_reveal_pacing` locally (creates SQL + regenerates client); commit the generated migration; prod applies via `prisma migrate deploy` in the deploy command. *(NB: Codex suggested hand-authored SQL; rejected — this repo's `prisma/migrations` use real `migrate dev` timestamps.)*
- **Gates (per CLAUDE.md; `npm run lint` IS `tsc --noEmit`, `npm test` IS `vitest run`):** `npm run lint && npm test` green before every task-closing commit. At each PR's close also run `npm run build` (this is a UI-touching change). If a DB-backed test fails with SQLite "Error code 14: Unable to open the database file", the test env DB isn't migrated — resolve via the `er-seo-tools-build-and-env` guidance, don't skip the test.
- **Accessibility:** keep the APG Accordion structure (`<h2><button aria-expanded aria-controls>…</button></h2>`), ONE stable accessible button name (only the active hero face + only the visible title contribute the name; decorative/eyebrow/rule nodes are `aria-hidden`), `inert`/`aria-hidden` from logical collapsed state. Honor `prefers-reduced-motion` (motion off, state still changes).
- **Commit trailer:** end messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and the `Claude-Session:` line.

## File structure

**PR1 — config levers:** `prisma/schema.prisma` + migration; `lib/viewbook/presentation-config.ts`(+test); `lib/viewbook/public-data.ts`+`public-types.ts`; `lib/viewbook/operator-data.ts`(+`OperatorViewbookData`, fixtures/tests); `components/viewbook/admin/viewbook-admin-shared.ts`; `lib/viewbook/service.ts`; `components/viewbook/public/ViewbookShell.tsx`(+test); `components/viewbook/admin/PresentationEditor.tsx`(+test); `app/api/viewbooks/routes.test.ts`.

**PR2 — bookend collapse (single commit):** `lib/viewbook/theme.ts`, `lib/viewbook/section-display.ts`(+test), `lib/viewbook/collapse.test.ts`, `SectionShell.tsx`(+test), `PcIntroSection.tsx`(+test), stale comments in `useCollapseState.ts`/`lib/viewbook/collapse.ts`.

**PR3 — cinematic transition:** `CollapsibleSection.tsx`(+test), `SectionShell.tsx`(+test), `viewbook-navigate.ts`(+test).

**PR4 — welcome auto-reveal:** `useCollapseState.ts`(+test), `useWelcomeAutoReveal.ts`(+test), `CollapsibleSection.tsx`(+test), `SectionShell.tsx`, `PcIntroSection.tsx`(+test).

---

# PR1 — Per-viewbook config levers

*(No visible behavior change: the var is present, the transition is still instant, bookends still excluded.)*

### Task 1: Schema columns + migration

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/<ts>_viewbook_reveal_pacing/migration.sql` (generated).

- [ ] **Step 1:** In `model Viewbook`, after `heroOverlayStrength Int @default(55)`:
```prisma
  revealDurationScale Float @default(1.0)  // 0.4..1.6 animation DURATION multiplier (higher = slower); presentation config
  firstLoadDelayMs    Int   @default(3000) // 0..6000 ms before the welcome auto-expands on first device load
```
- [ ] **Step 2:** Run `npx prisma migrate dev --name viewbook_reveal_pacing`. Expected: new migration with two `ALTER TABLE "Viewbook" ADD COLUMN … DEFAULT …`; client regenerated.
- [ ] **Step 3:** Verify the SQL touches only `Viewbook`, both columns `NOT NULL DEFAULT` (safe for existing rows).
- [ ] **Step 4:** `npm run lint` (tsc) passes. Commit:
```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(viewbook): add revealDurationScale + firstLoadDelayMs columns"
```

### Task 2: Presentation-config sanitizer

**Files:** Modify `lib/viewbook/presentation-config.ts`; Test `lib/viewbook/presentation-config.test.ts`.

**Interfaces — Produces:** `PRESENTATION_DEFAULTS` gains `revealDurationScale: 1.0`, `firstLoadDelayMs: 3000`. `parsePresentationPatch` return widens with both optional numbers. `readPresentationConfig(row)` param + return widen with both numbers.

- [ ] **Step 1: Failing tests** — append (fixes existing read-test inputs too, which now need the two extra row fields):
```ts
import { describe, it, expect } from 'vitest'
import { parsePresentationPatch, readPresentationConfig, PRESENTATION_DEFAULTS } from './presentation-config'
const ROW = { collapseAffordance: 'chevron', heroOverlayStrength: 55, revealDurationScale: 1.0, firstLoadDelayMs: 3000 }
describe('revealDurationScale', () => {
  it('write: accepts + clamps finite', () => {
    expect(parsePresentationPatch({ revealDurationScale: 1.4 })).toEqual({ revealDurationScale: 1.4 })
    expect(parsePresentationPatch({ revealDurationScale: 5 })).toEqual({ revealDurationScale: 1.6 })
    expect(parsePresentationPatch({ revealDurationScale: 0.1 })).toEqual({ revealDurationScale: 0.4 })
  })
  it('write: rejects non-finite/non-number', () => {
    expect(() => parsePresentationPatch({ revealDurationScale: 'x' })).toThrow()
    expect(() => parsePresentationPatch({ revealDurationScale: NaN })).toThrow()
    expect(() => parsePresentationPatch({ revealDurationScale: Infinity })).toThrow()
  })
  it('read: clamps finite-out-of-range, defaults on malformed', () => {
    expect(readPresentationConfig({ ...ROW, revealDurationScale: 9 }).revealDurationScale).toBe(1.6)
    expect(readPresentationConfig({ ...ROW, revealDurationScale: NaN }).revealDurationScale).toBe(1.0)
  })
})
describe('firstLoadDelayMs', () => {
  it('write: accepts int + clamps', () => {
    expect(parsePresentationPatch({ firstLoadDelayMs: 2000 })).toEqual({ firstLoadDelayMs: 2000 })
    expect(parsePresentationPatch({ firstLoadDelayMs: 99999 })).toEqual({ firstLoadDelayMs: 6000 })
    expect(parsePresentationPatch({ firstLoadDelayMs: -5 })).toEqual({ firstLoadDelayMs: 0 })
  })
  it('write: rejects non-integer/non-finite', () => {
    expect(() => parsePresentationPatch({ firstLoadDelayMs: 12.5 })).toThrow()
    expect(() => parsePresentationPatch({ firstLoadDelayMs: 'soon' })).toThrow()
  })
  it('defaults present', () => {
    expect(PRESENTATION_DEFAULTS.revealDurationScale).toBe(1.0)
    expect(PRESENTATION_DEFAULTS.firstLoadDelayMs).toBe(3000)
  })
})
```
- [ ] **Step 2:** `npx vitest run lib/viewbook/presentation-config.test.ts` → FAIL.
- [ ] **Step 3: Implement** — extend `PRESENTATION_DEFAULTS`, add constants + `clamp`, extend `parsePresentationPatch` (reject non-finite → `400 invalid_reveal_scale`; reject non-integer → `400 invalid_first_load_delay`; clamp), extend `readPresentationConfig` param + return (finite → clamp, else default; round the delay). *(Exact code as written in the prior plan revision — validate finite, clamp `[0.4,1.6]` / `[0,6000]`.)*
- [ ] **Step 4:** `npx vitest run lib/viewbook/presentation-config.test.ts` → PASS.
- [ ] **Step 5:** Commit:
```bash
git add lib/viewbook/presentation-config.ts lib/viewbook/presentation-config.test.ts
git commit -m "feat(viewbook): validate+clamp revealDurationScale & firstLoadDelayMs"
```

### Task 3: Thread through ALL consumers (one green commit)

> **Codex fix 7:** widening `readPresentationConfig` breaks every caller — they must land together so `npm run lint` stays green at this commit.

**Files:** Modify `lib/viewbook/public-data.ts`, `lib/viewbook/public-types.ts` (`ViewbookPublicData`), `lib/viewbook/operator-data.ts` (+ `OperatorViewbookData` type), `components/viewbook/admin/viewbook-admin-shared.ts`, `lib/viewbook/service.ts` (`updateViewbookPresentation` patch type). Tests: `lib/viewbook/public-data.test.ts`, `lib/viewbook/operator-data.test.ts` (+ fixtures), `lib/viewbook/service.test.ts`, `app/api/viewbooks/routes.test.ts`.

**Interfaces — Produces:** `ViewbookPublicData` + `OperatorViewbookData` each gain `revealDurationScale: number`, `firstLoadDelayMs: number`.

- [ ] **Step 1: Failing tests** — (a) `public-data.test.ts`: a row with `revealDurationScale:1.4, firstLoadDelayMs:2000` surfaces both; an out-of-range/omitted value clamps/defaults. (b) `operator-data.test.ts`: same threading onto `OperatorViewbookData` (+ update any fixtures that construct a viewbook row to include the two columns). (c) `service.test.ts`: `updateViewbookPresentation(id, { revealDurationScale:0.7, firstLoadDelayMs:5000 })` persists both + bumps `syncVersion`. (d) `app/api/viewbooks/routes.test.ts`: `PATCH` with valid values persists + one sync bump; `PATCH { revealDurationScale: 'x' }` → 400.
- [ ] **Step 2:** Run those test files → FAIL.
- [ ] **Step 3: Implement:**
  - `public-types.ts` `ViewbookPublicData` + `operator-data.ts` `OperatorViewbookData`: add both fields.
  - `public-data.ts` + `operator-data.ts`: include the two columns in the Prisma `select`, pass them into `readPresentationConfig`, spread the result onto the emitted object.
  - `viewbook-admin-shared.ts`: add both fields wherever the presentation-config shape is declared/defaulted (Codex: **mandatory**, not optional).
  - `service.ts` `updateViewbookPresentation`: widen the `patch` type to include `revealDurationScale?: number; firstLoadDelayMs?: number` (no logic change).
  - Update existing `readPresentationConfig` call sites/fixtures to pass the two new row fields.
- [ ] **Step 4:** `npx vitest run lib/viewbook/public-data.test.ts lib/viewbook/operator-data.test.ts lib/viewbook/service.test.ts app/api/viewbooks/routes.test.ts` → PASS. `npm run lint` → clean.
- [ ] **Step 5:** Commit:
```bash
git add lib/viewbook/public-data.ts lib/viewbook/public-types.ts lib/viewbook/operator-data.ts components/viewbook/admin/viewbook-admin-shared.ts lib/viewbook/service.ts lib/viewbook/*.test.ts app/api/viewbooks/routes.test.ts
git commit -m "feat(viewbook): thread reveal pacing through public-data, operator-data, service, admin-shared"
```

### Task 4: Inject `--vb-reveal-scale`

**Files:** Modify `components/viewbook/public/ViewbookShell.tsx`; Test `ViewbookShell.test.tsx` (create if absent).

- [ ] **Step 1: Failing test** — render with `data.revealDurationScale = 0.7`; assert the `[data-vb-theme-root]` inline style contains `--vb-reveal-scale: 0.7`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** In the theme-root `style` object add `'--vb-reveal-scale': String(data.revealDurationScale),`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(viewbook): inject --vb-reveal-scale on the theme root`.

### Task 5: Operator controls (save-on-blur/Enter)

**Files:** Modify `components/viewbook/admin/PresentationEditor.tsx` (+ `viewbook-admin-shared.ts` for preset list); Test `PresentationEditor.test.tsx`.

> **Codex fix 7:** sliders are **local-state on drag, PATCH on blur/Enter** (mirror the existing overlay control) — not a PATCH per drag event.

- [ ] **Step 1: Failing tests** — (a) selecting the "Brisk" pace preset PATCHes `revealDurationScale: 0.7`; (b) dragging the pace slider then blurring PATCHes the final `revealDurationScale`; (c) dragging the delay slider then blurring PATCHes `firstLoadDelayMs`. Assert **no PATCH mid-drag**.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** — add `REVEAL_PACE_PRESETS = [{label:'Grand',v:1.4},{label:'Standard',v:1.0},{label:'Brisk',v:0.7},{label:'Snappy',v:0.5}]` in `viewbook-admin-shared.ts`. In `PresentationEditor`: a preset button row + `<input type="range" min={0.4} max={1.6} step={0.05}>` ("Faster ← → Slower") for pace, and `<input type="range" min={0} max={6000} step={250}>` (value shown as seconds) for delay. Hold slider value in local state; call the existing PATCH handler `onBlur`/on Enter/on preset-click only. Seed from the loaded `revealDurationScale`/`firstLoadDelayMs`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** `npm run lint && npm test && npm run build`. Commit `feat(viewbook): operator controls for reveal pace + first-load delay`.

---

# PR2 — Bookends collapse like the rest

### Task 6: Flip collapse eligibility + all ripple (SINGLE green commit)

> **Codex fix 8:** the policy flip fails existing SectionShell/PcIntro/collapse tests until they're updated — do it all in one commit so `npm test` never goes red at a boundary.

**Files:** Modify `lib/viewbook/theme.ts`, `lib/viewbook/section-display.ts` (+`section-display.test.ts`), `lib/viewbook/collapse.test.ts`, `components/viewbook/public/SectionShell.tsx` (+`SectionShell.test.tsx`), `components/viewbook/public/PcIntroSection.tsx` (+`PcIntroSection.test.tsx`), comments in `useCollapseState.ts` + `lib/viewbook/collapse.ts`.

- [ ] **Step 1: Update tests first (they define the new truth):**
  - `section-display.test.ts`: `sectionDisplayMode({sectionKey:'pc-intro', state:'active'}, 'post-contract')` → `'normal'`; `sectionSupportsCollapse('pc-intro')` and `('pc-thanks')` → `true`.
  - `collapse.test.ts`: replace the obsolete "bookend → 400" case with a **positive** guard — `setSectionCollapsedShared` for `pc-intro`/`pc-thanks` **succeeds** (bumps `syncVersion`); keep the existing unknown-key `400` case as-is.
  - `SectionShell.test.tsx` (~:194): bookends now render **wrapped in `CollapsibleSection`** — assert the collapse button / `role="region"` is present for a bookend.
  - `PcIntroSection.test.tsx` (~:67): the welcome renders as collapsible (compact-row + expand control), not a permanently-open hero.
- [ ] **Step 2:** Run the four test files → FAIL.
- [ ] **Step 3: Implement:**
  - `theme.ts`: `COLLAPSE_EXCLUDED_SECTION_KEYS = new Set<string>()`; update banner ("all sections collapsible as of 2026-07-19 welcome-auto-reveal; constant + helper retained for future carve-out / dormant path").
  - `section-display.ts`: remove `'pc-intro'` from `ALWAYS_OPEN_KEYS`; update comment.
  - `SectionShell.tsx`: update the bookend-branch comments (bookends are no longer the non-collapsible special case; they now flow through `CollapsibleSection` via `sectionSupportsCollapse`).
  - Stale comments: `useCollapseState.ts` banner (~:14–15 "SectionShell excludes the two bookend sections … they never collapse") and `lib/viewbook/collapse.ts` bookend-guard comment → "all sections collapsible; the guard excludes nothing now."
- [ ] **Step 4:** `npx vitest run lib/viewbook/section-display.test.ts lib/viewbook/collapse.test.ts components/viewbook/public/SectionShell.test.tsx components/viewbook/public/PcIntroSection.test.tsx` → PASS; then `npm run lint && npm test` → green.
- [ ] **Step 5:** Commit:
```bash
git add lib/viewbook/theme.ts lib/viewbook/section-display.ts lib/viewbook/section-display.test.ts lib/viewbook/collapse.test.ts lib/viewbook/collapse.ts components/viewbook/public/SectionShell.tsx components/viewbook/public/SectionShell.test.tsx components/viewbook/public/PcIntroSection.tsx components/viewbook/public/PcIntroSection.test.tsx components/viewbook/public/useCollapseState.ts
git commit -m "feat(viewbook): bookends collapse like every other section (+ripple)"
```

---

# PR3 — Cinematic expand/collapse transition

*Build PRIMARY. Fall back (instant hero-face swap; keep body reveal + flourishes) only if Task 13's browser gate hits an objective trigger.*

### Task 7: Animated body region (`data-vb-state`, grid-rows, inert-from-logical-state)

**Files:** Modify `components/viewbook/public/CollapsibleSection.tsx`; Test `CollapsibleSection.test.tsx` (create if absent — use **`<span>`** hero fixtures, not `<div>`, matching the phrasing-content rule).

- [ ] **Step 1: Failing tests** — root has `data-vb-state="collapsed"` initially, `"expanded"` after clicking the button; the region div is present in BOTH states (no `display:none`); `inert`/`aria-hidden` only when collapsed; `aria-expanded` flips.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** — root `<div data-vb-state=… className="vb-collapsible">` with a scoped `<style>` (grid-rows `1fr↔0fr` on `.vb-body`, `.vb-body-inner{overflow:hidden;min-height:0}`, `.vb-body-lift` opacity+translateY, all `calc(520ms * var(--vb-reveal-scale,1))`, reduced-motion `transition:none`). Region div keeps `id/role/aria-label/aria-hidden/inert` from logical `collapsed`, **drops `hidden` + `display:none`**, gains `className="vb-body"` wrapping `.vb-body-inner > .vb-body-lift > {body}`. (Full CSS as in the prior revision's Task 8.)
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(viewbook): animate body reveal (grid-rows, --vb-reveal-scale, reduced-motion)`.

### Task 8: Hero "stage" — stacked faces + clamp height

**Files:** Modify `CollapsibleSection.tsx`, `SectionShell.tsx`; Tests `CollapsibleSection.test.tsx`, `SectionShell.test.tsx`.

> **Codex fixes 1–2:** stage gets `width:100%;overflow:hidden`; faces `width/height:100%`; `buildExpandedHero()` root becomes `relative flex h-full items-end` (the face supplies the absolute containing block — do NOT add another `absolute inset-0`); **preserve the no-image `30vh` variant** (don't force `38svh` on image-less heroes); test fixtures use `<span>`. The image is rendered **once per face** (two `<img>` nodes) — acceptable for the primary attempt; do NOT claim prop-level hoisting.

- [ ] **Step 1: Failing test** — inside the button, BOTH `data-vb-face="collapsed"` and `data-vb-face="expanded"` nodes exist; the inactive one has `aria-hidden="true"`; `getByRole('button', { name: title })` resolves **uniquely** (one accessible name).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** — in `CollapsibleSection`, wrap the two faces in `<span className="vb-hero-stage">` with `<span className="vb-hero-face vb-hero-face--collapsed" data-vb-face="collapsed" aria-hidden={collapsed?undefined:true}>{heroCollapsed}</span>` + the expanded equivalent (`aria-hidden={collapsed?true:undefined}`). Add stage/face CSS:
```css
.vb-collapsible .vb-hero-stage{position:relative;display:block;width:100%;overflow:hidden;height:82px;transition:height calc(600ms*var(--vb-reveal-scale,1)) cubic-bezier(.16,1,.3,1)}
.vb-collapsible[data-vb-state="expanded"] .vb-hero-stage{height:clamp(240px,38svh,560px)}
.vb-collapsible .vb-hero-face{position:absolute;inset:0;width:100%;height:100%;display:block;transition:opacity calc(400ms*var(--vb-reveal-scale,1)) ease}
.vb-collapsible .vb-hero-face--expanded{opacity:0}
.vb-collapsible[data-vb-state="expanded"] .vb-hero-face--expanded{opacity:1}
.vb-collapsible[data-vb-state="expanded"] .vb-hero-face--collapsed{opacity:0}
@media (prefers-reduced-motion:reduce){.vb-collapsible .vb-hero-stage,.vb-collapsible .vb-hero-face{transition:none}}
```
  In `SectionShell.tsx`: `buildExpandedHero()` root → `relative flex h-full items-end` (drop its own `min-h-[38vh]`/`min-h-[30vh]`); the **no-image** case keeps its shorter feel — set the stage's expanded height to `clamp(180px,30svh,420px)` for image-less sections (pass a `hasHeroImage` flag into `CollapsibleSection` or set a `data-vb-hero="none"` attr the CSS keys off). Update the `<div>`→`<span>` test fixtures.
- [ ] **Step 4:** PASS; `npm run dev` eyeball the cross-fade (tune in Task 13).
- [ ] **Step 5:** Commit `feat(viewbook): hero stage with cross-faded collapsed/expanded faces`.

### Task 9: Hero flourishes (test-first, aria-hidden, locked copy)

**Files:** Modify `SectionShell.tsx`, `CollapsibleSection.tsx`; Test `SectionShell.test.tsx`.

> **Codex fix 3:** RED step first; the eyebrow + rule MUST be `aria-hidden` (else the button name becomes "eyebrow + title"). **Locked eyebrow copy:** the static uppercase label `"A note from your team"` for `pc-intro`; for all other sections **no eyebrow** (rule + Ken-Burns only) — do not leave it to implementer taste.

- [ ] **Step 1: Failing tests** — (a) the expanded hero contains `.vb-hero-img`, `.vb-hero-rule`, and (for `pc-intro`) a `.vb-hero-eyebrow` with text "A note from your team"; (b) `.vb-hero-eyebrow` and `.vb-hero-rule` carry `aria-hidden`; (c) `getByRole('button', { name })` still equals `title` (unchanged by the eyebrow).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** — add the class hooks + `aria-hidden` on eyebrow/rule in `buildExpandedHero()` (eyebrow only when `sectionKey==='pc-intro'`); add flourish CSS keyed off `data-vb-state="expanded"` scaled by `--vb-reveal-scale` (`.vb-hero-img scale(1.06→1)`; `.vb-hero-eyebrow` opacity/translateY; `.vb-hero-rule scaleX(0→1)`), with reduced-motion resetting to final state. (Full CSS as in the prior revision's Task 10.)
- [ ] **Step 4:** PASS; `npm run dev` eyeball.
- [ ] **Step 5:** Commit `feat(viewbook): cinematic hero flourishes (ken-burns, eyebrow, gold rule)`.

### Task 10: Animation-aware navigation (shared helper)

**Files:** Modify `components/viewbook/public/viewbook-navigate.ts` (+ `CollapsibleSection.tsx` initial-hash path); Test `viewbook-navigate.test.ts` (create if absent).

> **Codex fix 4:** `viewbook-navigate.ts` has NO initial-hash mount path today (that lives in `CollapsibleSection`'s effect). Introduce **one shared helper** both paths call. Open any enclosing native `<details>` before waiting; **skip the wait** when the target is already expanded or `prefers-reduced-motion`; filter `transitionend` to `e.target===stageEl && e.propertyName==='height'`; keep a computed-duration `setTimeout` fallback. First-load CLS is measured in Task 13 (PR3 has no auto-reveal, so it can't measure the real no-input shift here).

- [ ] **Step 1: Failing test** — a `vb:navigate` to a collapsed section scrolls **after** the hero-stage height `transitionend` (mock it) or the duration fallback, not after one RAF; when the section is already expanded or reduced-motion, it scrolls immediately (no wait). Cover the initial-`#hash` path via the shared helper.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** — export `scrollToSectionAfterReveal(sectionKey)` from `viewbook-navigate.ts`: resolve the section element, open any ancestor `<details>`, dispatch/ensure expand, then if the target's `.vb-hero-stage` is mid-transition wait for `transitionend` filtered on `height` (once) with a `~700ms * scale` fallback, else scroll now; honor reduced-motion by scrolling immediately. Route both the `vb:navigate` handler and the initial-hash mount (move `CollapsibleSection`'s hash branch to call this helper, keeping `forceExpand`).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** `npm run lint && npm test && npm run build`. Commit `feat(viewbook): animation-aware navigation scroll (shared helper; hash + vb:navigate)`.

---

# PR4 — Welcome auto-reveal (once per device)

### Task 11: `useCollapseState` — key-scoped `ready` flag (NO `interacted`)

**Files:** Modify `components/viewbook/public/useCollapseState.ts`; Test `useCollapseState.test.ts` (create if absent).

> **Codex fixes 5–6:** do NOT add `interacted`/`setInteracted` into `expand()/collapse()` (misclassifies programmatic auto-expand + churns ThemePreview). Only add a **key-scoped** `ready` flag so a re-keyed/reused component can't expose stale `ready=true`.

- [ ] **Step 1: Failing test** — `ready` is `false` on first render, `true` after the mount reconcile effect; when `viewbookId`/`sectionKey` (the key) changes, `ready` returns to `false` until the effect re-reconciles for the new key.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** — add `const [reconciledKey, setReconciledKey] = useState<string | null>(null)`; in the mount effect (both the previewMode branch and the normal branch) call `setReconciledKey(key)` after setting collapsed; derive `const ready = reconciledKey === key`. Return `{ collapsed, expand, collapse, forceExpand, ready }` (no `interacted`).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(viewbook): useCollapseState exposes key-scoped ready flag`.

### Task 12: `useWelcomeAutoReveal` hook (owns one-shot consume)

**Files:** Create `components/viewbook/public/useWelcomeAutoReveal.ts`; Test `useWelcomeAutoReveal.test.ts`.

> **Codex fixes 5–6:** the hook returns a **synchronous `consume()`** that writes the flag and cancels its own timer/RAF (the button + navigation call it before toggling — no async React-state cancellation). Module-level fallback `Set` when localStorage throws. `timer !== null`/`raf !== null` guards (RAF id `0` is valid). Re-read the flag inside `fire()`; write-flag-before-`expand()`; `storage`-event cancel.

**Interfaces — Produces:** `useWelcomeAutoReveal(opts): { consume: () => void }`.

- [ ] **Step 1: Failing tests** (fake timers + mock localStorage): fires once after `delayMs` (enabled/ready/collapsed/flag-unset) → `expand()` once + flag `'1'`; no-op when flag set / `!ready` / `!enabled` / `previewMode`; `consume()` before fire cancels the timer, writes the flag, and `expand()` is NOT called; `delayMs=0` → RAF fire; already-expanded at arm → flag set, no `expand()`; unmount cancels timer+RAF; a `storage` event setting the flag cancels a pending timer; when localStorage throws, the module-level `Set` prevents a second arm in the same session.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement:**
```ts
'use client'
import { useCallback, useEffect, useRef } from 'react'
export function welcomeRevealedKey(viewbookId: number): string { return `vb:welcome-revealed:${viewbookId}` }
const memoryFlags = new Set<string>()
function readFlag(key: string): boolean { try { return localStorage.getItem(key) === '1' } catch { return memoryFlags.has(key) } }
function writeFlag(key: string): void { try { localStorage.setItem(key, '1') } catch { memoryFlags.add(key) } }

export function useWelcomeAutoReveal({
  viewbookId, enabled, ready, collapsed, expand, delayMs, previewMode = false,
}: {
  viewbookId: number; enabled: boolean; ready: boolean; collapsed: boolean
  expand: () => void; delayMs: number; previewMode?: boolean
}): { consume: () => void } {
  const key = welcomeRevealedKey(viewbookId)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const raf = useRef<number | null>(null)
  const cancel = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null }
  }, [])
  const consume = useCallback(() => { writeFlag(key); cancel() }, [key, cancel])

  useEffect(() => {
    if (!enabled || previewMode || !ready) return
    if (readFlag(key)) return
    if (!collapsed) { writeFlag(key); return } // already open — consume the one-shot
    const fire = () => {
      timer.current = null; raf.current = null
      if (readFlag(key)) return       // another tab won
      writeFlag(key)                  // claim BEFORE expand (best-effort, non-atomic)
      expand()
    }
    if (delayMs <= 0) raf.current = requestAnimationFrame(fire)
    else timer.current = setTimeout(fire, delayMs)
    const onStorage = (e: StorageEvent) => { if (e.key === key && e.newValue === '1') cancel() }
    try { window.addEventListener('storage', onStorage) } catch { /* noop */ }
    return () => { cancel(); try { window.removeEventListener('storage', onStorage) } catch { /* noop */ } }
  }, [key, enabled, ready, collapsed, expand, delayMs, previewMode, cancel])

  return { consume }
}
```
- [ ] **Step 4:** `npx vitest run components/viewbook/public/useWelcomeAutoReveal.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(viewbook): useWelcomeAutoReveal once-per-device timer with synchronous consume()`.

### Task 13: Wire auto-reveal + first-load CLS gate

**Files:** Modify `CollapsibleSection.tsx`, `SectionShell.tsx`, `PcIntroSection.tsx`; Tests `CollapsibleSection.test.tsx`, `PcIntroSection.test.tsx`.

> **Codex fixes 4/5/10:** the hero button calls `consume()` **before** toggling; the navigation helper (Task 10) also calls `consume()` before `forceExpand`. Real wiring test lives in `PcIntroSection.test.tsx`. First-load CLS is measured **here** (auto-reveal exists now). Browser step: "manually **expanding** before 3 s" (welcome begins collapsed).

- [ ] **Step 1: Failing tests** — (a) `CollapsibleSection` with `autoRevealMs={0}` + no flag → after a frame flips to `data-vb-state="expanded"` + flag written; with `autoRevealMs={undefined}` never auto-expands; clicking the button before the timer calls `consume()` (assert no later auto-expand). (b) `PcIntroSection.test.tsx`: rendering the welcome with `data.stage==='post-contract'` and `data.firstLoadDelayMs=0` reaches the island and auto-expands; with `data.stage!=='post-contract'` it does not — proving the `PcIntroSection → SectionShell → CollapsibleSection` prop seam.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement:**
  - `CollapsibleSection.tsx`: accept `autoRevealMs?: number`; pull `ready` from `useCollapseState`; `const { consume } = useWelcomeAutoReveal({ viewbookId, enabled: autoRevealMs != null, ready, collapsed, expand, delayMs: autoRevealMs ?? 0, previewMode })`; button `onClick={() => { consume(); (collapsed ? expand : collapse)() }}`. Pass `consume` into the initial-hash/`vb:navigate` path so the shared nav helper (Task 10) can call it before `forceExpand` (or call `consume()` inside the `onNav`/hash effect before `forceExpand`).
  - `SectionShell.tsx`: accept optional `autoRevealMs?: number`, forward to `CollapsibleSection`.
  - `PcIntroSection.tsx`: pass `autoRevealMs={data.stage === 'post-contract' ? data.firstLoadDelayMs : undefined}`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: BROWSER VERIFICATION (primary-vs-fallback + CLS gate)** — `npm run dev`, fresh browser profile, `post-contract` viewbook:
  - Welcome auto-expands ~3 s after load with the cinematic transition; **reload → does NOT auto-expand again**; manually **expanding** before 3 s cancels the timer; a second tab doesn't double-fire; reduced-motion → instant; zero-delay setting works.
  - Chrome + Safari, desktop + narrow mobile; rapid expand→collapse→expand reversal; focus during collapse; TOC/deep-link into a collapsed nested anchor lands correctly; **measure first-load CLS + frame perf on a large Data Source body — record the number and state the accepted budget.** If any objective trigger fails un-tunably, switch PR3 to the fallback (instant hero-face swap; keep body reveal + flourishes) and note it in the commit + spec.
- [ ] **Step 6:** `npm run lint && npm test && npm run build`. Commit:
```bash
git add components/viewbook/public/CollapsibleSection.tsx components/viewbook/public/SectionShell.tsx components/viewbook/public/PcIntroSection.tsx components/viewbook/public/CollapsibleSection.test.tsx components/viewbook/public/PcIntroSection.test.tsx
git commit -m "feat(viewbook): welcome auto-reveals once per device after firstLoadDelayMs"
```

---

## Self-review (completed)

- **Spec coverage:** D1 → Tasks 1–5; D2 → Task 6 (merged for green boundary); D3 → Tasks 7–10 (navigation shared-helper; CLS deferred to Task 13); D4 → Tasks 11–13. All Codex plan-review fixes 1–10 folded in (fix 9 adapted to this repo's real `migrate dev` + `npm run lint`=tsc conventions).
- **Type consistency:** `revealDurationScale`/`firstLoadDelayMs` named identically column→defaults→patch→read→`ViewbookPublicData`/`OperatorViewbookData`→`--vb-reveal-scale`/`autoRevealMs`. `useCollapseState` returns `{ collapsed, expand, collapse, forceExpand, ready }` (no `interacted`); `useWelcomeAutoReveal` returns `{ consume }` consumed in Task 13. CSS hooks `.vb-collapsible/.vb-hero-stage/.vb-hero-face/.vb-body/.vb-body-lift/.vb-hero-img/.vb-hero-eyebrow/.vb-hero-rule` consistent across Tasks 7–10. `data-vb-state`/`data-vb-face` consistent.
- **Green boundaries:** Task 3 bundles all `readPresentationConfig` callers; Task 6 bundles the collapse flip + all its ripple — neither leaves `npm test` red at its commit.
- **Placeholders:** PR3 CSS values are explicitly starting values tuned in Task 13's browser gate; `SectionShell.test.tsx:194` / `PcIntroSection.test.tsx:67` are approximate locate-anchors, not missing code.

## Execution notes

- Land D1→D2→D3→D4 in order (each an independently green commit / mergeable slice).
- After PR4: run `/codex-review` on the branch diff (P1 — public render path + new hook), then `npm run lint && npm test && npm run build`, then Kevin's ship ritual (tracker/handoff, deploy).
