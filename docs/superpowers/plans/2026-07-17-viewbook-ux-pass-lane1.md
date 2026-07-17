# Viewbook UX Pass — Lane 1 (Reading Experience) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or superpowers:executing-plans. Steps use `- [ ]` checkboxes. Work in worktree
> `.claude/worktrees/viewbook-l1` on branch `feat/viewbook-l1`. **Never edit on `main`
> (a second Claude session shares this checkout).**

**Goal:** Replace the self-oscillating scroll-collapse with sticky section headers
(fixes the blink + "abduction" + editor truncation), reposition the TOC rail
(left, expanded, hamburger toggle), fix the footer-whitespace bug, and link the
admin viewbook name to open the public page in a new tab.

**Architecture:** Delete the `IntersectionObserver` from `SectionReveal`; each
section renders a compact `position: sticky` header bar whose native `<button>`
toggles the body (state-only, never scroll-driven). Initial open/closed is a pure
stage policy. A `ResizeObserver` measurement leaf publishes `--vb-sticky-offset`
so headers pin under the (responsive, possibly two-tier) top chrome.

**Tech Stack:** Next.js 15 App Router (server + client components), React,
Tailwind (class dark mode), Vitest + Testing Library (jsdom).

## Global Constraints

- **jsdom can't test scroll/sticky/IntersectionObserver/ResizeObserver.** Tests assert pure logic, component state on click, aria attributes, and the *absence* of a scroll listener/observer. Scroll feel + footer height are verified manually (note in each task).
- **Array-form `$transaction` only** (repo rule) — Lane 1 is UI-only, no DB writes.
- **CSS var contract (verbatim):** headers pin at `top: var(--vb-sticky-offset)`; `scroll-margin-top: calc(var(--vb-sticky-offset) + 12px)`. Probe publishes `--vb-progress-nav-height`, `--vb-operator-bar-height`, `--vb-sticky-offset` on the themed root.
- **Seam for Lane 2:** `ViewbookShell` themed root `<div>` gets attribute `data-vb-theme-root` and must keep its inline `--vb-*` overridable (do not `!important` them).
- **z-index order:** `OperatorBar` (z-50) > `ProgressNav` (z-40) > section sticky headers (z-30) > TocRail (z-40 rail / z-50 mobile). Pin these.
- Gates before every commit: `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` (scoped is fine locally, full before merge).

---

### Task 1: Stage-driven initial-open policy (`section-display.ts`)

**Files:**
- Modify: `lib/viewbook/section-display.ts`
- Test: `lib/viewbook/section-display.test.ts`

**Interfaces:**
- Produces: `sectionInitiallyOpen(section: PublicSection, stage: ViewbookStage): boolean`, `SECTION_ALWAYS_OPEN(sectionKey): boolean`. Removes `sectionStartsCollapsed` and `sectionLocksAutoReveal` (auto-reveal is deleted with the observer). Keep `sectionDisplayMode` for `done`/`ack-collapsed`/`always-open` classification (still used for styling).

- [ ] **Step 1: Write failing tests** in `section-display.test.ts`:

```ts
import { sectionInitiallyOpen } from './section-display'
const S = (o: Partial<PublicSection>) => ({ sectionKey: 'welcome', state: 'active', acknowledgedAt: null, ...o } as PublicSection)

// always-open
expect(sectionInitiallyOpen(S({ sectionKey: 'pc-intro' }), 'post-contract')).toBe(true)
// done / acked collapse
expect(sectionInitiallyOpen(S({ state: 'done' }), 'building')).toBe(false)
expect(sectionInitiallyOpen(S({ sectionKey: 'data-source', acknowledgedAt: new Date() as any }), 'post-contract')).toBe(false)
// Now Building: only milestones + materials open
expect(sectionInitiallyOpen(S({ sectionKey: 'milestones' }), 'building')).toBe(true)
expect(sectionInitiallyOpen(S({ sectionKey: 'materials' }), 'building')).toBe(true)
expect(sectionInitiallyOpen(S({ sectionKey: 'welcome' }), 'building')).toBe(false)
expect(sectionInitiallyOpen(S({ sectionKey: 'brand' }), 'building')).toBe(false)
// other stages: non-collapsed sections open
expect(sectionInitiallyOpen(S({ sectionKey: 'welcome' }), 'kickoff')).toBe(true)
```

- [ ] **Step 2: Run — expect FAIL** (`sectionInitiallyOpen` undefined).
  `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/section-display.test.ts`

- [ ] **Step 3: Implement.** Replace `sectionStartsCollapsed`/`sectionLocksAutoReveal` with:

```ts
const BUILDING_OPEN = new Set<string>(['milestones', 'materials'])

export function sectionInitiallyOpen(section: PublicSection, stage: ViewbookStage): boolean {
  const mode = sectionDisplayMode(section, stage)
  if (mode === 'always-open') return true
  if (mode === 'done' || mode === 'ack-collapsed') return false
  if (stage === 'building') return BUILDING_OPEN.has(section.sectionKey)
  return true
}
```

- [ ] **Step 4: Run — expect PASS.** Then `grep -rn "sectionStartsCollapsed\|sectionLocksAutoReveal" components lib` → must be only the SectionReveal/SectionShell call sites you rewrite in Tasks 2–3 (fix them there).

- [ ] **Step 5: Commit** `feat(viewbook-l1): stage-driven sectionInitiallyOpen policy`.

---

### Task 2: Gut the observer — `SectionReveal` becomes state-only

**Files:**
- Modify: `components/viewbook/public/SectionReveal.tsx`
- Test: `components/viewbook/public/SectionReveal.test.tsx`

**Interfaces:**
- Consumes: `sectionInitiallyOpen` (Task 1) via the `initiallyOpen: boolean` prop (SectionShell passes it — Task 3).
- Produces: `SectionReveal` props `{ regionId: string; alwaysOpen: boolean; initiallyOpen: boolean; children }`. No observer, no scroll listener, no `manuallyToggledRef`. Exposes `data-vb-expanded` + responds to the `vb:navigate` force-open event (Task 8).

- [ ] **Step 1: Write failing tests:** clicking the toggle flips `data-vb-expanded`; `alwaysOpen` renders no toggle button; a dispatched `vb:navigate` `CustomEvent` with the matching id force-opens a collapsed section; assert NO `IntersectionObserver` is constructed (spy `global.IntersectionObserver` and assert not called).

```ts
const spy = vi.fn(); (global as any).IntersectionObserver = class { constructor(){ spy() } observe(){} disconnect(){} }
render(<SectionReveal regionId="r" alwaysOpen={false} initiallyOpen={false}>body</SectionReveal>)
expect(spy).not.toHaveBeenCalled()
await user.click(screen.getByRole('button', { name: /show|expand|details/i }))
expect(screen.getByTestId('vb-region')).toHaveAttribute('data-vb-expanded', 'true')
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Remove the entire `useEffect` observer block (old `SectionReveal.tsx:59-87`), `manuallyToggledRef`, `REVEAL_THRESHOLD`, `hasActiveEditorActivity`/`lockAutoReveal` paths. Keep: `const [expanded, setExpanded] = useState(initiallyOpen)`, the `grid-template-rows 1fr/0fr` collapse CSS (now driven ONLY by clicks + `vb:navigate`), `inert`/`aria-hidden` on the collapsed region. Keep a `vb:navigate` listener that force-opens when `event.detail.id` targets this section (set `expanded=true`). The toggle `<button>` lives in the compact header (rendered by SectionShell — SectionReveal receives it or exposes `expanded`/`onToggle`; keep the region + collapse here, move the button to SectionShell in Task 3, wiring `aria-controls={regionId}` + `aria-expanded`).

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** `fix(viewbook-l1): remove scroll-collapse observer (blink bug) — SectionReveal state-only`.

---

### Task 3: `SectionShell` — compact sticky header + native toggle

**Files:**
- Modify: `components/viewbook/public/SectionShell.tsx`
- Test: `components/viewbook/public/SectionShell.test.tsx`

**Interfaces:**
- Consumes: `sectionInitiallyOpen` (Task 1); `SectionReveal` region (Task 2).
- Produces: a compact sticky header bar (`position: sticky; top: var(--vb-sticky-offset); z-index: 30`) containing the section title + a native `<button aria-expanded aria-controls={regionId}>` (omitted for `always-open`). The large hero band stays as-is but is NOT sticky. Section `<section>` gets `scroll-margin-top: calc(var(--vb-sticky-offset) + 12px)` (replace `scroll-mt-24`).

- [ ] **Step 1: Write failing tests:** header renders a `<button>` with `aria-expanded="false"` and `aria-controls` equal to the region id when `initiallyOpen=false`; `always-open` sections render a heading with NO button; clicking toggles `aria-expanded`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Compute `initiallyOpen = sectionInitiallyOpen(section, stage)`. Render the compact sticky header (with the button for non-always-open) + hero band + `<SectionReveal regionId alwaysOpen initiallyOpen>`. Wire the button to the reveal's expand state (lift `expanded`/`onToggle` into SectionShell, pass down, or use a shared id + `vb:navigate`-style callback — keep it simple: SectionShell owns `expanded` state, passes `expanded` + `onToggle` to SectionReveal for the region, and renders the button). Replace `scroll-mt-24` with the inline `style={{ scrollMarginTop: 'calc(var(--vb-sticky-offset) + 12px)' }}`.

- [ ] **Step 4: Run — expect PASS.** Manual: verify a section header pins under the nav and the next section pushes it up (no blink).

- [ ] **Step 5: Commit** `feat(viewbook-l1): sticky section header as accessible toggle`.

---

### Task 4: `StickyOffsetProbe` — ResizeObserver measurement leaf

**Files:**
- Create: `components/viewbook/public/StickyOffsetProbe.tsx`
- Test: `components/viewbook/public/StickyOffsetProbe.test.tsx`

**Interfaces:**
- Produces: `<StickyOffsetProbe />` — a client `'use client'` island that, on mount, measures `#vb-progress-nav` and (if present) `#vb-operator-bar` via `ResizeObserver`, and sets `--vb-progress-nav-height`, `--vb-operator-bar-height`, and `--vb-sticky-offset` (their sum) on the nearest `[data-vb-theme-root]`. Presentation mode (operator bar absent/hidden) → operator height 0.

- [ ] **Step 1: Write failing test:** with a jsdom fixture containing `[data-vb-theme-root]`, `#vb-progress-nav` (mock `getBoundingClientRect` height 64), no operator bar → after mount, `root.style.getPropertyValue('--vb-sticky-offset')` is `64px` and `--vb-operator-bar-height` is `0px`. (Mock `ResizeObserver` to fire once with the elements; mock `getBoundingClientRect`.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `ResizeObserver` on the two ids (guarded — element may be absent), fallback to `getBoundingClientRect().height`; write the three CSS vars; cleanup on unmount. Provide a CSS fallback default in the shell (`--vb-sticky-offset: 64px`) so pre-hydration pinning is sane.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** `feat(viewbook-l1): ResizeObserver sticky-offset probe`.

---

### Task 5: Chrome ids, z-index, `data-vb-theme-root` marker, probe mount

**Files:**
- Modify: `components/viewbook/public/ProgressNav.tsx` (add `id="vb-progress-nav"`, keep `sticky top-0 z-40`)
- Modify: `components/viewbook/public/OperatorLayer/OperatorBar.tsx` (add `id="vb-operator-bar"`, `sticky top-0 z-50`, positioning ONLY)
- Modify: `components/viewbook/public/OperatorLayer/OperatorViewbookLayer.tsx` (mount `<StickyOffsetProbe />`)
- Modify: `components/viewbook/public/ViewbookShell.tsx` (add `data-vb-theme-root` to the themed root `<div>`, mount `<StickyOffsetProbe />` for the anonymous branch, add `--vb-sticky-offset: 64px` fallback to the inline style)
- Test: extend `ViewbookShell.test.tsx` — themed root has `data-vb-theme-root`; probe mounted.

- [ ] **Step 1: Write failing test:** `ViewbookShell` render → `container.querySelector('[data-vb-theme-root]')` is non-null and carries the `--vb-*` inline vars; `#vb-progress-nav` present.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the id/attribute/z-index edits + probe mounts. Do NOT change the theme var *values* (that's Lane 2's live store target). Ensure inline vars are plain (no `!important`).

- [ ] **Step 4: Run — expect PASS.** `tsc --noEmit`.

- [ ] **Step 5: Commit** `feat(viewbook-l1): sticky-chrome ids, z-index order, theme-root marker + probe mount`.

---

### Task 6: `ViewbookShell` footer + TocRail placement cleanup

**Files:**
- Modify: `components/viewbook/public/ViewbookShell.tsx`
- Test: `ViewbookShell.test.tsx`

- [ ] **Step 1: Write failing test:** footer renders exactly once, is the last flow child before the fixed `TocRail` island, and no empty sibling block is rendered after it (assert the element after `<footer>` is the TocRail island or nothing).

- [ ] **Step 2: Run — expect FAIL** (if current structure leaves a gap) or adjust assertion to lock the intended DOM order.

- [ ] **Step 3: Implement.** Ensure the `TocRail` fixed island is not contributing flow height (it's `fixed`), and that no stage-conditional wrapper leaves an empty `min-h` block below the footer. (Full root-cause in Task 9.)

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** `refactor(viewbook-l1): normalize shell footer/TocRail DOM order`.

---

### Task 7: `TocRail` — default expanded, left, hamburger toggle

**Files:**
- Modify: `components/viewbook/public/TocRail.tsx`
- Test: `components/viewbook/public/TocRail.test.tsx`

- [ ] **Step 1: Write failing tests:** desktop rail defaults `open=true` (nav width expanded); it is positioned on the LEFT (assert the class/style `left-*`, not `right-*`); the ☰ button toggles `open` (aria-expanded flips); a `done` section shows the filled green glyph, an `acked`-not-done shows the hollow ring (existing `Glyph` logic — assert it still holds).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `useState(true)` for `open`; change `fixed right-3` → `fixed left-3`; keep hamburger `onClick={() => setOpen(v => !v)}`; leave the `done`/`acked` `Glyph` logic intact (green circles already fill on ack — this task just re-verifies). Keep mobile FAB branch but move to left if it reads better (optional; do not regress).

- [ ] **Step 4: Run — expect PASS.** Manual: rail opens on the left by default, hamburger collapses it.

- [ ] **Step 5: Commit** `feat(viewbook-l1): TOC rail default-expanded, left-anchored, hamburger toggle`.

---

### Task 8: Navigation force-open + offset (`viewbook-navigate.ts`, `SectionAccents.tsx`)

**Files:**
- Modify: `components/viewbook/public/viewbook-navigate.ts`
- Modify: `components/viewbook/public/SectionAccents.tsx`
- Test: `components/viewbook/public/viewbook-navigate.test.ts`

- [ ] **Step 1: Write failing test:** `navigateToSection(id)` dispatches a `vb:navigate` `CustomEvent` with `detail.id` BEFORE calling `scrollIntoView` (assert order via spies); the target element receives the event that force-opens it (Task 2 listener).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Keep the `vb:navigate` dispatch; ensure force-open fires, then `scrollIntoView({ behavior })`. Rely on the section's `scroll-margin-top` (Task 3) for the offset — remove any hard-coded `-24`/`scroll-mt` compensation in navigate.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** `fix(viewbook-l1): nav force-opens target before scroll, offset via scroll-margin`.

---

### Task 9: Footer-whitespace bug — root-cause + fix

> Use **superpowers:systematic-debugging**. The agent-map candidates: the
> post-footer `TocRail` island, `min-h-[30/38vh]` hero bands, the removed
> grid-collapse artifact, `EarlierSteps` toggling in/out between Getting Started
> and later stages.

**Files:** likely `ViewbookShell.tsx` and/or `SectionShell.tsx`/`EarlierSteps.tsx`.

- [ ] **Step 1: Reproduce** in the running app: create a viewbook, advance to Now Building, return to Getting Started, observe whitespace under the footer (presentation AND edit mode).
- [ ] **Step 2: Bisect** the suspects (temporarily null each) to identify the empty-height source. Write down the confirmed cause.
- [ ] **Step 3: Add a regression assertion** where testable (e.g. no stage-conditional wrapper renders a non-empty `min-h` block with no children; or a Playwright document-height check if the repo has a browser harness — else document a manual check).
- [ ] **Step 4: Fix** the confirmed cause (most likely: with the observer gone, the residual is a stage-conditional empty block or the hero `min-h` on a collapsed section — collapse the hero band to header height when the section is collapsed, or drop the empty wrapper).
- [ ] **Step 5: Run tests + manual re-verify. Commit** `fix(viewbook-l1): footer-whitespace on stage round-trip (<root cause>)`.

---

### Task 10: Admin — open viewbook name in new tab

**Files:**
- Modify: `components/viewbook/admin/ViewbookIndex.tsx`, `ViewbookCard.tsx`, `ViewbookEditor.tsx`
- Test: `components/viewbook/admin/ViewbookCard.test.tsx` (+ index/editor as they have tests)

- [ ] **Step 1: Write failing test:** the viewbook name renders as `<a href="/viewbook/{token}" target="_blank" rel="noopener">` (public page URL). If the admin list lacks the token, link to the public page via the token from the row data (confirm the shape carries `token`; if not, thread it through — read-only).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the anchor in the card/index name + the editor header title.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** `feat(viewbook-l1): admin viewbook name opens public page in new tab`.

---

## Self-review checklist (run before opening the PR)

- [ ] `grep -rn "IntersectionObserver" components/viewbook/public` → gone (except the Task-2 test spy).
- [ ] `grep -rn "sectionStartsCollapsed\|sectionLocksAutoReveal" lib components` → gone.
- [ ] Full gates green in the worktree: `tsc --noEmit` · `lint` · `npm test` · `build`.
- [ ] Manual: no blink on Data Source; sticky headers stack; TOC left+expanded; no footer gap across stage round-trips; operator mode offset correct (two-tier chrome).
- [ ] `data-vb-theme-root` present + `--vb-*` overridable (Lane 2 seam).
- [ ] `/codex-review` (P1) on the branch diff before merge.
