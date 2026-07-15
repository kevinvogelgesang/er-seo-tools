# Explainer Hover-Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline-disclosure `Explainer` with a floating, non-interactive hover card (ⓘ trigger, `@floating-ui/react`) and adopt it across all 17 sites with richer per-section content.

**Architecture:** One `'use client'` component rewrite preserving export names (`Explainer`, `ExplainerSummary`, `ExplainerTags`, `ExplainerColumns`, `ExplainerNote`). Floating card rendered via `FloatingPortal`, positioned by `@floating-ui/react` middleware, opened by composed hover+focus+click interactions, unmounted when closed. Adopters change from content authoring, not rewiring.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind (class dark mode), Vitest + Testing Library (jsdom per-file), `@floating-ui/react`.

## Global Constraints

- **Card is strictly non-interactive** — no links/buttons/inputs inside; prose, chips, ✓/✗ lists, notes, static tables only. Keeps `role="tooltip"` valid.
- **Interaction config (verbatim):** `useHover(ctx,{mouseOnly:true, move:false, delay:{open:120,close:80}, handleClose:safePolygon()})`, `useFocus(ctx,{visibleOnly:true})`, `useClick(ctx,{stickIfOpen:true})`, `useDismiss(ctx)`, `useRole(ctx,{role:'tooltip'})`.
- **Middleware (verbatim):** `offset(8)`, `flip()`, `shift({padding:8})`, `size(...)` capping max-w/max-h to viewport with body `overflow-y:auto`, `arrow({element:arrowRef})`; `whileElementsMounted: autoUpdate`.
- **Positioning transform and animation transform on separate elements.** Entrance-only animation; immediate unmount on close (no exit transition).
- **Trigger hit area ≥28px** even though the icon is 16px (`w-4 h-4` icon inside a `p-1.5`/`min-h-7 min-w-7` button).
- **Only invariant methodology** goes in the card; all run-specific status/coverage/freshness/honesty lines stay visible outside.
- **Remove `variant` and `defaultOpen` props**; fix both call sites (`components/sales/sections.tsx`, `app/(app)/robots-validator/page.tsx`).
- **17 production adoption files** — visually audit every placement (no orphaned icons), contextual accessible labels (not "What is this?").
- **Gates:** `tsc --noEmit` + `npx vitest run` + `npm run build` (RSC/client-boundary dep change). Node 22.
- Dark mode via `dark:` variants; `.dark` class lives on `<html>`, so portaling to `<body>` preserves dark variants.

---

## File Structure

- `components/ui/Explainer.tsx` — rewritten container + 4 subcomponents (one file, as today).
- `components/ui/Explainer.test.tsx` — rewritten behavior suite.
- `test/setup-jsdom-observers.ts` — NEW tiny stub for `ResizeObserver`/`IntersectionObserver` imported by the Explainer test (jsdom lacks them; `autoUpdate`+`size` need them).
- `package.json` — add `@floating-ui/react`.
- 17 adopter files (listed in Phase 2) — content + placement changes.
- Adopter tests: `ScoreExplanation.test.tsx`, `AdaScoreExplanation.test.tsx`, `KeywordProfileCard.test.tsx`, `BrokenLinksSection.test.tsx` — updated to ⓘ trigger.

---

## Phase 1 — Component foundation

### Task 1: Install `@floating-ui/react`

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

Run: `npm install @floating-ui/react`
Expected: adds `@floating-ui/react` to `dependencies`; lockfile updated.

- [ ] **Step 2: Verify import resolves**

Run: `node -e "require.resolve('@floating-ui/react'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @floating-ui/react for hover-card Explainer"
```

### Task 2: jsdom observer stubs for tests

**Files:**
- Create: `test/setup-jsdom-observers.ts`

**Interfaces:**
- Produces: side-effect import that defines `globalThis.ResizeObserver` and `globalThis.IntersectionObserver` if absent.

- [ ] **Step 1: Write the stub**

```ts
// test/setup-jsdom-observers.ts — jsdom lacks Resize/IntersectionObserver,
// which @floating-ui's autoUpdate + size middleware call. Import at the top
// of any Explainer-bearing jsdom test.
class Noop {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  // @ts-expect-error test stub
  globalThis.ResizeObserver = Noop
}
if (typeof globalThis.IntersectionObserver === 'undefined') {
  // @ts-expect-error test stub
  globalThis.IntersectionObserver = Noop
}
export {}
```

- [ ] **Step 2: Commit** (committed together with Task 3)

### Task 3: Rewrite `Explainer.test.tsx` (failing)

**Files:**
- Test: `components/ui/Explainer.test.tsx` (replace)

**Interfaces:**
- Consumes: `Explainer`, `ExplainerSummary`, `ExplainerTags`, `ExplainerColumns`, `ExplainerNote` from `./Explainer` (new API: `label`, `title?`, `children`; NO `variant`/`defaultOpen`).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '../../test/setup-jsdom-observers'
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Explainer, ExplainerSummary, ExplainerTags, ExplainerColumns, ExplainerNote,
} from './Explainer'

afterEach(cleanup)

const sample = (
  <Explainer title="SEO Health Score" label="What is the SEO health score?">
    <ExplainerSummary>Methodology prose.</ExplainerSummary>
    <ExplainerTags tags={['Indexability', 'Errors']} />
    <ExplainerNote>Lab data, not field.</ExplainerNote>
  </Explainer>
)

describe('Explainer hover card', () => {
  it('is closed by default: trigger present, no panel in the DOM', () => {
    render(sample)
    const trigger = screen.getByRole('button', { name: 'What is the SEO health score?' })
    expect(trigger).toBeTruthy()
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.queryByText('Methodology prose.')).toBeNull()
  })

  it('opens on pointer hover and closes when dismissed with Escape', async () => {
    render(sample)
    const trigger = screen.getByRole('button', { name: 'What is the SEO health score?' })
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
    fireEvent.mouseEnter(trigger)
    await act(() => vi.advanceTimersByTime(150) as unknown as Promise<void>)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    expect(screen.getByText('Methodology prose.')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('opens on focus (keyboard path)', async () => {
    render(sample)
    const trigger = screen.getByRole('button', { name: 'What is the SEO health score?' })
    act(() => trigger.focus())
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
  })

  it('pins open: hover-open then click keeps it open; second click closes', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    render(sample)
    const trigger = screen.getByRole('button', { name: 'What is the SEO health score?' })
    await user.hover(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    await user.click(trigger)
    await user.unhover(trigger)
    expect(screen.getByRole('tooltip')).toBeTruthy() // still open (stickIfOpen)
    await user.click(trigger)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('renders subcomponent structure inside the open card', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    render(
      <Explainer label="cols">
        <ExplainerColumns good={{ label: 'Do', items: ['aa'] }} bad={{ label: "Don't", items: ['bb'] }} />
      </Explainer>,
    )
    await user.click(screen.getByRole('button', { name: 'cols' }))
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    expect(screen.getByText('Do')).toBeTruthy()
    expect(screen.getByText("Don't")).toBeTruthy()
    expect(screen.getByText('aa')).toBeTruthy()
    expect(screen.getByText('bb')).toBeTruthy()
  })
})

beforeAll(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
```

- [ ] **Step 2: Run — expect fail** (old component still inline; `title` prop unknown, no `role="tooltip"`).

Run: `npx vitest run components/ui/Explainer.test.tsx`
Expected: FAIL.

### Task 4: Rewrite `Explainer.tsx`

**Files:**
- Modify: `components/ui/Explainer.tsx` (replace container; keep subcomponents, drop `variant`/`defaultOpen`)

**Interfaces:**
- Produces: `Explainer({label, title?, children, className?})`; subcomponents unchanged signatures: `ExplainerSummary({children})`, `ExplainerTags({tags})`, `ExplainerColumns({good,bad})`, `ExplainerNote({children})`.

- [ ] **Step 1: Implement the container** (see full code in the spec's Design section; key shape below)

```tsx
'use client'
import { useRef, useState, useId } from 'react'
import {
  useFloating, autoUpdate, offset, flip, shift, size, arrow,
  useHover, useFocus, useClick, useDismiss, useRole, useInteractions,
  safePolygon, FloatingPortal, FloatingArrow,
} from '@floating-ui/react'

export function Explainer({ label, title, children, className = '' }: {
  label: string; title?: string; children: React.ReactNode; className?: string
}) {
  const [open, setOpen] = useState(false)
  const arrowRef = useRef<SVGSVGElement>(null)
  const labelId = useId()
  const { refs, floatingStyles, context, middlewareData, placement } = useFloating({
    open, onOpenChange: setOpen, placement: 'bottom',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8), flip(), shift({ padding: 8 }),
      size({ padding: 8, apply({ availableWidth, availableHeight, elements }) {
        Object.assign(elements.floating.style, {
          maxWidth: `${Math.min(360, availableWidth)}px`,
          maxHeight: `${availableHeight}px`,
        })
      } }),
      arrow({ element: arrowRef }),
    ],
  })
  const hover = useHover(context, { mouseOnly: true, move: false, delay: { open: 120, close: 80 }, handleClose: safePolygon() })
  const focus = useFocus(context, { visibleOnly: true })
  const click = useClick(context, { stickIfOpen: true })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, click, dismiss, role])

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        aria-label={label}
        {...getReferenceProps()}
        className={`inline-flex items-center justify-center rounded-full p-1.5 min-h-7 min-w-7 text-navy/40 dark:text-white/40 hover:text-navy dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors ${className}`.trim()}
      >
        <InfoIcon className="w-4 h-4" />
      </button>
      {open && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-50">
            <div
              aria-labelledby={title ? labelId : undefined}
              className="motion-safe:animate-[explainer-in_120ms_ease-out] max-w-sm overflow-y-auto rounded-xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card shadow-lg p-4"
            >
              <FloatingArrow ref={arrowRef} context={context} className="fill-white dark:fill-navy-card [&>path:first-of-type]:stroke-gray-200 dark:[&>path:first-of-type]:stroke-navy-border" />
              {title && <p id={labelId} className="font-heading font-semibold text-[13px] text-navy dark:text-white mb-2">{title}</p>}
              <div className="space-y-3">{children}</div>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
```

Notes for implementer:
- `InfoIcon` = small inline circled-i SVG (add alongside the existing `ChevronIcon`/`FlagIcon`; remove `ChevronIcon` if now unused).
- Add the `explainer-in` keyframes (opacity+scale) to `tailwind.config` or an inline `<style>` in the component; respect `motion-safe:`.
- `floatingStyles` (positioning transform) is on the OUTER div; the animation class is on the INNER div — separate elements, per the constraint.
- Keep `ExplainerSummary/Tags/Columns/Note` bodies as they are today.

- [ ] **Step 2: Run the test — expect pass**

Run: `npx vitest run components/ui/Explainer.test.tsx`
Expected: PASS.

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: errors ONLY in adopter files passing `variant`/`defaultOpen` (fixed in Task 5) — note them.

- [ ] **Step 4: Commit**

```bash
git add components/ui/Explainer.tsx components/ui/Explainer.test.tsx test/setup-jsdom-observers.ts
git commit -m "feat(ui): Explainer becomes a floating hover card (non-interactive, a11y)"
```

### Task 5: Fix the two prop-breaking call sites + keep tree green

**Files:**
- Modify: `components/sales/sections.tsx` (drop `variant="plain"`)
- Modify: `app/(app)/robots-validator/page.tsx` (drop `variant`/any `defaultOpen`)

- [ ] **Step 1: Remove dropped props** from both files (grep `variant=`/`defaultOpen` in each; delete the attribute only).
- [ ] **Step 2: tsc clean**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors).

- [ ] **Step 3: Full test + build gate**

Run: `npx vitest run && npm run build`
Expected: tests PASS; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(ui): drop removed Explainer props (variant/defaultOpen) at call sites"
```

---

## Phase 2 — Convert + enrich adopters

**Conversion recipe (applies to every adopter):**
1. Move the ⓘ next to the heading/label it explains (no standalone orphan row). Wrap in a flex row with the heading if needed.
2. Add a contextual `title` and a contextual `label` (accessible name), replacing generic "What is this?".
3. Author content per the spec mapping using `ExplainerSummary` + `ExplainerTags` + (where it fits) `ExplainerColumns` + `ExplainerNote`. **Invariant methodology only** — leave run-specific coverage/status/freshness lines rendered outside the card exactly where they are.
4. Reuse existing copy sources: `lib/sales/copy.ts` `SCORE_METHOD`, `lib/scoring/weights.ts` factor names, the `ISSUE_WHY` map.
5. Update the adopter's test if it queried the old inline trigger.

### Task 6 (2a): Site-audit score + SEO sections
**Files:** `components/scoring/ScoreExplanation.tsx`, `AdaScoreExplanation.tsx`, `components/site-audit/{OnPageSeoSection,BrokenLinksSection,ContentSimilaritySection,ContentSignalsSection,TopicOverlapSection,DiscoveryCoverageSection,ContentAuditCard}.tsx`; tests `ScoreExplanation.test.tsx`, `AdaScoreExplanation.test.tsx`, `BrokenLinksSection.test.tsx`.
- [ ] Apply recipe to each; the score explanations keep their static factor tables inside the card (non-interactive) with the visible legacy-breakdown fallback OUTSIDE.
- [ ] Run: `npx vitest run components/scoring components/site-audit && npx tsc --noEmit`
- [ ] Commit: `feat(site-audit): SEO/score sections adopt hover-card Explainer`

### Task 7 (2b): Client dashboard cards
**Files:** `components/clients/{GscKeywordCard,GscCannibalizationCard,KeywordProfileCard,KeywordStrategyCard,RobotsCheckCard}.tsx`; test `KeywordProfileCard.test.tsx`.
- [ ] Apply recipe; honesty caveats that are INVARIANT (GSC "absence = not observed") go in the card; run-specific `…AtLimit` stays outside.
- [ ] Run: `npx vitest run components/clients && npx tsc --noEmit`
- [ ] Commit: `feat(clients): dashboard cards adopt hover-card Explainer`

### Task 8 (2c): Public prospect sales report
**Files:** `components/sales/sections.tsx`.
- [ ] Apply recipe to the four `MethodExplainer` sites; verify mobile hit area + that server-rendered children still pass through the client component; no run-specific claims added.
- [ ] Run: `npx tsc --noEmit && npm run build`
- [ ] Commit: `feat(sales): report methodology adopts hover-card Explainer`

### Task 9 (2d): Standalone pages
**Files:** `app/(app)/reports/page.tsx`, `app/(app)/robots-validator/page.tsx`.
- [ ] Apply recipe to the page intros.
- [ ] Run: `npx tsc --noEmit`
- [ ] Commit: `feat(pages): reports + robots-validator intros adopt hover-card Explainer`

### Task 10: Full gate + visual verification
- [ ] Run: `npx tsc --noEmit && npx vitest run && npm run build` — all green.
- [ ] Start dev server, drive a site-audit results page + a client dashboard + `/sales/[token]`: hover opens, gap-travel keeps open, click pins, Esc/outside closes, tap works, dark mode correct, no orphaned icons.
- [ ] Commit any placement fixes: `fix(ui): Explainer placement polish from visual audit`

---

## Phase 3 — Extend app-wide (deferred, needs candidate approval)

Inventory ⓘ candidates with no explainer today (nav tool descriptions, form fields: WCAG level / scan type / notify checkbox, queue/status terms), present the list for Kevin's approval before building. No open-ended sweep.

---

## Self-Review

- **Spec coverage:** dependency (T1), component rewrite w/ full interaction+middleware+unmount+hit-area (T4), non-interactive rule (T4 + recipe), tightened honesty rule (recipe step 3 + T6/T7 notes), 17-file audit (Phase 2 tasks enumerate all 17), prop removal + both call sites (T5), test expansion + observer stubs (T2/T3), build gate (T5/T8/T10). Playwright smoke: noted in spec; folded into T10 manual drive for this pass (a formal Playwright spec is optional follow-up — flagged, not silently dropped).
- **Placeholder scan:** none — component code is concrete; recipe is explicit.
- **Type consistency:** `Explainer({label,title?,children,className?})` used consistently; subcomponent signatures unchanged.
