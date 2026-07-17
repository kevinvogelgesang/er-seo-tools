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
- Produces: `sectionInitiallyOpen(section: PublicSection, stage: ViewbookStage): boolean`. **Keep `sectionStartsCollapsed` and `sectionLocksAutoReveal` exported for now** (their callers are rewritten in Task 2 — deleting them here would break `tsc` at this commit; Codex plan-fix 4). Keep `sectionDisplayMode` for `done`/`ack-collapsed`/`always-open` classification.

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

- [ ] **Step 3: Implement.** ADD `sectionInitiallyOpen` (do NOT remove the old exports — they still have callers until Task 2):

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

- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit` stays green (old exports intact).

- [ ] **Step 5: Commit** `feat(viewbook-l1): stage-driven sectionInitiallyOpen policy`.

---

### Task 2: Sticky-header rewrite — `SectionReveal` (client) owns everything; `SectionShell` (server) composes — ATOMIC

> **Codex plan-fix 3:** `SectionShell` is a **server component** — it cannot own
> `useState` or pass callbacks into a client island. So `SectionReveal` (client)
> owns `expanded`, the sticky-header `<button>`, AND the collapsible region.
> `SectionShell` only passes serializable props. Rewrite BOTH files in ONE
> gate-green commit (and delete the old `section-display` exports here — Codex fix 4).

**Files:**
- Modify: `components/viewbook/public/SectionReveal.tsx`, `components/viewbook/public/SectionShell.tsx`, `lib/viewbook/section-display.ts` (delete `sectionStartsCollapsed`/`sectionLocksAutoReveal` now that callers are rewritten)
- Test: `components/viewbook/public/SectionReveal.test.tsx`

**Interfaces:**
- Consumes: `sectionInitiallyOpen` (Task 1).
- Produces: `SectionReveal` props `{ regionId: string; title: ReactNode; alwaysOpen: boolean; initiallyOpen: boolean; children }` — all serializable (title/summary are server-rendered nodes passed as children/props). `SectionReveal` (client) renders the compact sticky header `<button aria-expanded aria-controls={regionId}>` (omitted for `alwaysOpen` → non-interactive heading) + the region. No observer, no scroll listener, no `manuallyToggledRef`. `SectionShell` (server) computes `initiallyOpen = sectionInitiallyOpen(section, stage)` and renders `<SectionReveal …>` with the hero band as a child; section `<section>` uses inline `style={{ scrollMarginTop: 'calc(var(--vb-sticky-offset) + 12px)' }}` (replacing `scroll-mt-24`).

- [ ] **Step 1: Write failing tests** (`SectionReveal.test.tsx`) — use `getAttribute`, NOT `toHaveAttribute` (repo has no jest-dom matchers):

```ts
const spy = vi.fn(); (global as any).IntersectionObserver = class { constructor(){ spy() } observe(){} disconnect(){} }
const { getByRole, getByTestId } = render(<SectionReveal regionId="r" title="Data Source" alwaysOpen={false} initiallyOpen={false}>body</SectionReveal>)
expect(spy).not.toHaveBeenCalled()
const btn = getByRole('button')
expect(btn.getAttribute('aria-expanded')).toBe('false')
expect(btn.getAttribute('aria-controls')).toBe('r')
await user.click(btn)
expect(getByTestId('vb-region').getAttribute('data-vb-expanded')).toBe('true')
// always-open → no button
const ao = render(<SectionReveal regionId="r2" title="Intro" alwaysOpen initiallyOpen>body</SectionReveal>)
expect(ao.queryByRole('button')).toBeNull()
// vb:navigate force-opens (detail.sectionKey — see Task 8)
```

- [ ] **Step 2: Run — expect FAIL.** `DATABASE_URL="file:./local-dev.db" npx vitest run components/viewbook/public/SectionReveal.test.tsx`

- [ ] **Step 3: Implement `SectionReveal`.** `const [expanded, setExpanded] = useState(initiallyOpen)`. Remove the entire observer `useEffect`, `manuallyToggledRef`, `REVEAL_THRESHOLD`, `hasActiveEditorActivity`/`lockAutoReveal`. Render: compact sticky header (`position: sticky; top: var(--vb-sticky-offset); z-index: 30`) with the `<button>` (for non-`alwaysOpen`) toggling `setExpanded(v => !v)` + `title`; then the region (`data-testid="vb-region"`, `data-vb-expanded`, `inert`/`aria-hidden` when collapsed, `grid-template-rows 1fr/0fr` CSS) wrapping `children`. Add a `vb:navigate` listener that force-opens when `event.detail.sectionKey` matches this section (Task 8 contract).

- [ ] **Step 4: Implement `SectionShell`.** Compute `initiallyOpen`; pass serializable props + hero-band children into `SectionReveal`; set the section `scrollMarginTop`. Then delete `sectionStartsCollapsed`/`sectionLocksAutoReveal` from `section-display.ts` and their (now-rewritten) call sites.

- [ ] **Step 5: Run — expect PASS.** `npx tsc --noEmit` green. Manual: a section header pins under the nav; the next section pushes it up; NO blink on Data Source.

- [ ] **Step 6: Commit** `fix(viewbook-l1): sticky-header state-only sections — remove scroll-collapse observer (blink bug)`.

---

### Task 3: (folded into Task 2)

The sticky header + toggle now lives entirely in the client `SectionReveal` (Task 2)
because `SectionShell` is a server component. No separate task.

---

### Task 4: `StickyOffsetProbe` — ResizeObserver measurement leaf

**Files:**
- Create: `components/viewbook/public/StickyOffsetProbe.tsx`
- Test: `components/viewbook/public/StickyOffsetProbe.test.tsx`

**Interfaces:**
- Produces: `<StickyOffsetProbe />` — a client `'use client'` island (mounted EXACTLY ONCE, in `ViewbookShell` — Codex plan-fix 2) that measures `#vb-progress-nav` and (if present) `#vb-operator-bar` and sets `--vb-progress-nav-height`, `--vb-operator-bar-height`, and `--vb-sticky-offset` (sum) on the nearest `[data-vb-theme-root]`. Uses **`ResizeObserver`** for height changes AND a **`MutationObserver`** on the DOM to rebind when `#vb-operator-bar` appears/disappears (presentation-mode toggle) → operator height 0 when absent.

- [ ] **Step 1: Write failing test:** with a jsdom fixture containing `[data-vb-theme-root]`, `#vb-progress-nav` (mock `getBoundingClientRect` height 64), no operator bar → after mount, `root.style.getPropertyValue('--vb-sticky-offset')` is `64px` and `--vb-operator-bar-height` is `0px`. (Mock `ResizeObserver` to fire once with the elements; mock `getBoundingClientRect`.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `ResizeObserver` on the two ids (guarded — element may be absent) + a `MutationObserver` on `document.body` (subtree childList) that re-queries `#vb-operator-bar` and rebinds/zeroes the operator height when it appears/disappears; fallback to `getBoundingClientRect().height`; write the three CSS vars on `[data-vb-theme-root]`; disconnect both observers on unmount. Provide a CSS fallback default in the shell (`--vb-sticky-offset: 64px`) so pre-hydration pinning is sane.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** `feat(viewbook-l1): ResizeObserver sticky-offset probe`.

---

### Task 5: Chrome ids, z-index, `data-vb-theme-root` marker, probe mount

**Files:**
- Modify: `components/viewbook/public/OperatorLayer/OperatorBar.tsx` (add `id="vb-operator-bar"`, `sticky top-0 z-50`, positioning ONLY)
- Modify: `components/viewbook/public/ProgressNav.tsx` (add `id="vb-progress-nav"`; change `top-0` → `style top: var(--vb-operator-bar-height, 0px)`, `z-40` — so it sits BELOW the operator bar, no overlap — Codex plan-fix 2)
- Modify: `components/viewbook/public/ViewbookShell.tsx` (add `data-vb-theme-root` to the themed root `<div>`; mount `<StickyOffsetProbe />` **exactly once** here — ViewbookShell renders in BOTH the anonymous and operator branches; add `--vb-sticky-offset: 64px` fallback to the inline style)
- Test: extend `ViewbookShell.test.tsx` — themed root has `data-vb-theme-root`; exactly one probe; `#vb-progress-nav` present.

> **Do NOT** mount the probe in `OperatorViewbookLayer` — the single `ViewbookShell`
> mount covers operator mode too (the operator branch renders `ViewbookShell` as a
> child). Two probes = double writes (Codex plan-fix 2).

- [ ] **Step 1: Write failing test:** `ViewbookShell` render → `container.querySelector('[data-vb-theme-root]')` is non-null and carries the `--vb-*` inline vars; `#vb-progress-nav` present.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** the ids, the `data-vb-theme-root` attribute, the z-index order (OperatorBar z-50 > ProgressNav z-40 > headers z-30), ProgressNav's `top: var(--vb-operator-bar-height, 0px)`, and the SINGLE probe mount. Do NOT change the theme var *values* (that's Lane 2's live-store target); keep the inline `--vb-*` plain (no `!important`) so the store can override them.

- [ ] **Step 4: Run — expect PASS.** `tsc --noEmit`.

- [ ] **Step 5: Commit** `feat(viewbook-l1): sticky-chrome ids, z-index order, theme-root marker + probe mount`.

---

### Task 6: (folded into Task 9)

Codex plan-fix 7: don't pre-commit a speculative footer restructure. The footer
whitespace is fixed in the root-cause-driven Task 9, which owns any
`ViewbookShell`/`EarlierSteps` change and adds the real failing assertion once the
cause is identified.

---

### Task 7: `TocRail` — default expanded, left, hamburger toggle

**Files:**
- Modify: `components/viewbook/public/TocRail.tsx`
- Test: `components/viewbook/public/TocRail.test.tsx`

- [ ] **Step 1: Write failing tests:** desktop rail defaults `open=true` (nav width expanded); it is positioned on the LEFT (assert the class/style `left-*`, not `right-*`); the ☰ button toggles `open` (aria-expanded flips); a `done` section shows the filled green glyph, an `acked`-not-done shows the hollow ring (existing `Glyph` logic — assert it still holds).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** `useState(true)` for `open`; change `fixed right-3` → `fixed left-3`; keep hamburger `onClick={() => setOpen(v => !v)}`; leave the `done`/`acked` `Glyph` logic intact (green circles already fill on ack — re-verify). **Codex verify item:** the existing `activate()` (on TOC item click) currently *closes* the desktop rail — since the rail now defaults OPEN, `activate()` must NOT collapse it (only the hamburger toggles). Fix `activate()` to leave `open` unchanged on desktop. Keep the mobile FAB/sheet branch (may move left if it reads better; do not regress).

- [ ] **Step 4: Run — expect PASS.** Manual: rail opens on the left by default, hamburger collapses it.

- [ ] **Step 5: Commit** `feat(viewbook-l1): TOC rail default-expanded, left-anchored, hamburger toggle`.

---

### Task 8: Navigation force-open + offset (`viewbook-navigate.ts`, `SectionAccents.tsx`)

**Files:**
- Modify: `components/viewbook/public/viewbook-navigate.ts`
- Modify: `components/viewbook/public/SectionAccents.tsx`
- Test: `components/viewbook/public/viewbook-navigate.test.ts`

> **Codex plan-fix 7:** preserve the ACTUAL contract — `navigateToAnchor(sectionKey, anchor)` and `detail.sectionKey` (NOT a fictional `navigateToSection(id)`). Dispatch-before-scroll already works (`viewbook-navigate.ts:19`), so this is a **characterization** test (locks current behaviour), not RED.

- [ ] **Step 1: Write a characterization test:** `navigateToAnchor(sectionKey, anchor)` dispatches the `vb:navigate` `CustomEvent` (with `detail.sectionKey`) BEFORE `scrollIntoView` (assert dispatch-then-scroll order via spies). Confirm the Task-2 `SectionReveal` listener keys off `detail.sectionKey` to force-open.

- [ ] **Step 2: Run — expect PASS** (characterization). If it fails, the Task-2 listener's key is wrong — fix the listener to match `detail.sectionKey`.

- [ ] **Step 3: Implement/verify.** Ensure the section relies on its `scroll-margin-top` (Task 2) for the offset — remove any hard-coded `-24`/`scroll-mt` compensation in `viewbook-navigate.ts`/`SectionAccents.tsx`.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** `fix(viewbook-l1): nav offset via scroll-margin; force-open keyed on detail.sectionKey`.

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
