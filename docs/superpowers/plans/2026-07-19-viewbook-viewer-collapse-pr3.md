# Viewbook viewer-collapse — PR3: CollapsibleSection island + SectionShell restructure

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Read the program overview + spec first. Global Constraints apply. Depends on PR1 + PR2.

**Goal:** Replace the transitional server-only collapse render with a client island that gives every viewer an in-hero expand/collapse control (three operator-selected affordances), a large hero done-check, the configurable overlay + minimum scrim, a sticky personal `expanded` override, a prop-reconciliation effect, and `vb:navigate` force-open.

**Architecture:** `SectionShell` stays a server component that computes serializable props + renders the body as a server node, and delegates the hero + body to the `CollapsibleSection` client island. Effective collapse = `(override === 'expanded') ? false : collapsedShared`. Writes go to PR2's route; expand is personal (client) or shared (operator) per §4.

**Tech Stack:** Next 15 RSC + client island, Vitest + Testing Library.

---

### Task 1: `useCollapseState` hook (override + reconciliation reducer)

**Files:**
- Create: `components/viewbook/public/useCollapseState.ts`
- Test: `components/viewbook/public/useCollapseState.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function useCollapseState(args: {
    viewbookId: number; sectionKey: string; collapsedShared: boolean;
  }): {
    collapsed: boolean;                 // effective, for rendering
    pending: boolean;                   // a write this island issued is in flight
    beginPending(): boolean;            // synchronous guard: false if already pending (caller aborts)
    endPending(): void;                 // clears pending → reconcile effect reruns with latest prop
    setPersonalExpanded(): void;        // client expand: localStorage override='expanded' (persisted)
    forceExpandedLocal(): void;         // vb:navigate: expand in-memory only, NOT persisted
    clearPersonalOverride(): 'expanded' | null; // remove key, RETURN prior value (for rollback)
    restorePersonalOverride(prev: 'expanded' | null): void; // rollback on failed collapse
    setCollapsedOptimistic(next: boolean): void; // optimistic view flip
  }
  ```
- localStorage key helper `collapseKey(viewbookId, sectionKey) = \`vb:collapse:${viewbookId}:${sectionKey}\``.

- [ ] **Step 1: Failing tests** (jsdom; stub localStorage like `PresentationToggle.test.tsx`):

```ts
it('effective = collapsedShared when no override', () => {})
it('personal expanded override wins over shared collapse', () => {})
it('clearPersonalOverride removes the key AND returns the prior value', () => {})
it('restorePersonalOverride re-persists the prior value', () => {})
it('a changed collapsedShared prop flips an override-less viewer', () => {})
it('a changed collapsedShared prop does NOT flip an override-holder', () => {})
it('prop change while pending is deferred, then APPLIED on endPending (not dropped)', () => {
  // begin pending; rerender with new collapsedShared (no flip); endPending() → latest prop applies
})
it('forceExpandedLocal expands without writing localStorage (survives rerender, not reload)', () => {})
it('beginPending returns false if already pending', () => {})
```

Run: FAIL.

- [ ] **Step 2: Implement.** Pending is STATE (not just a ref) so clearing it reruns the reconcile effect and applies any prop that arrived mid-flight (Codex FIX-5). `beginPending` uses a ref for a synchronous double-fire guard (rendered `disabled` doesn't serialize two pre-commit events). `forceExpandedLocal` sets the in-memory override only (Codex FIX-6).

```ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export function collapseKey(viewbookId: number, sectionKey: string): string {
  return `vb:collapse:${viewbookId}:${sectionKey}`
}
function readOverride(key: string): 'expanded' | null {
  try { return localStorage.getItem(key) === 'expanded' ? 'expanded' : null } catch { return null }
}

export function useCollapseState({ viewbookId, sectionKey, collapsedShared }: {
  viewbookId: number; sectionKey: string; collapsedShared: boolean;
}) {
  const key = collapseKey(viewbookId, sectionKey)
  const [collapsed, setCollapsed] = useState(collapsedShared) // SSR-safe seed, no window read
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)          // synchronous double-fire guard
  const overrideRef = useRef<'expanded' | null>(null) // in-memory truth (persisted OR nav-forced)

  useEffect(() => { // mount: read persisted override; override wins
    overrideRef.current = readOverride(key)
    setCollapsed(overrideRef.current === 'expanded' ? false : collapsedShared)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Reconcile whenever the shared prop changes OR pending clears — suppressed
  // while pending; personal expand always wins. Depending on `pending` is what
  // makes a mid-flight prop apply on settle instead of being dropped (FIX-5).
  useEffect(() => {
    if (pending) return
    setCollapsed(overrideRef.current === 'expanded' ? false : collapsedShared)
  }, [collapsedShared, pending])

  const beginPending = useCallback(() => {
    if (pendingRef.current) return false
    pendingRef.current = true; setPending(true); return true
  }, [])
  const endPending = useCallback(() => { pendingRef.current = false; setPending(false) }, [])

  const setPersonalExpanded = useCallback(() => {
    try { localStorage.setItem(key, 'expanded') } catch {}
    overrideRef.current = 'expanded'; setCollapsed(false)
  }, [key])

  const forceExpandedLocal = useCallback(() => { // vb:navigate — NOT persisted
    overrideRef.current = 'expanded'; setCollapsed(false)
  }, [])

  const clearPersonalOverride = useCallback((): 'expanded' | null => {
    const prev = overrideRef.current
    try { localStorage.removeItem(key) } catch {}
    overrideRef.current = null
    return prev
  }, [key])

  const restorePersonalOverride = useCallback((prev: 'expanded' | null) => {
    overrideRef.current = prev
    try { prev ? localStorage.setItem(key, prev) : localStorage.removeItem(key) } catch {}
  }, [key])

  const setCollapsedOptimistic = useCallback((next: boolean) => setCollapsed(next), [])

  return {
    collapsed, pending, beginPending, endPending,
    setPersonalExpanded, forceExpandedLocal, clearPersonalOverride, restorePersonalOverride, setCollapsedOptimistic,
  }
}
```

- [ ] **Step 3: Run + commit.** `npx vitest run components/viewbook/public/useCollapseState.test.ts` → PASS; `tsc` → 0.

```bash
git add components/viewbook/public/useCollapseState.ts components/viewbook/public/useCollapseState.test.ts
git commit -m "feat(viewbook): useCollapseState (personal override + reconciliation reducer)"
```

---

### Task 2: `CollapseAffordance` presentational component (3 variants)

**Files:**
- Create: `components/viewbook/public/CollapseAffordance.tsx`
- Test: `components/viewbook/public/CollapseAffordance.test.tsx`

**Interfaces:**
- Consumes: `CollapseAffordanceKind` from `@/lib/viewbook/presentation-config` (**created and owned by PR4** — PR3 depends on PR4, per the reordered map). Never redeclare the type.
- Produces (`CollapseAffordance.tsx`):
  ```ts
  export function CollapseAffordance(props: {
    kind: CollapseAffordanceKind; regionId: string; accessibleName: string;
    onExpand(): void; disabled: boolean;
  }): JSX.Element
  ```
- `accessibleName` is actor-specific text supplied by the island (FIX-ACTOR-AFFORDANCE).

- [ ] **Step 1: Failing tests.**

```ts
it.each(['bar','pill','chevron'] as const)('%s renders a button with the accessible name + aria-controls', (kind) => {
  render(<CollapseAffordance kind={kind} regionId="r1" accessibleName="Expand (just for you)" onExpand={()=>{}} disabled={false} />)
  const btn = screen.getByRole('button', { name: 'Expand (just for you)' })
  expect(btn).toHaveAttribute('aria-controls', 'r1')
  expect(btn).toHaveAttribute('aria-expanded', 'false')
})
it('bar and pill show a visible label; chevron is icon-only with aria-label', () => { /* … */ })
it('disabled prevents onExpand', () => { /* click while disabled → not called */ })
```

Run: FAIL.

- [ ] **Step 2: Implement.** All three are one `<button aria-expanded={false} aria-controls={regionId} disabled={disabled} onClick={onExpand}>`; only the inner presentation differs. `bar`/`pill` render the visible label text; `chevron` renders the `⌄` glyph with `aria-hidden` and relies on the button's `aria-label={accessibleName}`. Use `dark:` variants. Keep it self-contained — no external assets. Example skeleton:

```tsx
'use client'
import type { CollapseAffordanceKind } from '@/lib/viewbook/presentation-config'
export function CollapseAffordance({ kind, regionId, accessibleName, onExpand, disabled }: {
  kind: CollapseAffordanceKind; regionId: string; accessibleName: string; onExpand(): void; disabled: boolean;
}) {
  const common = { 'aria-expanded': false as const, 'aria-controls': regionId, disabled, onClick: onExpand, type: 'button' as const }
  if (kind === 'bar') return (
    <button {...common} aria-label={accessibleName}
      className="relative z-[3] flex w-full items-center justify-center gap-2 border-t border-white/25 bg-white/15 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/25 disabled:opacity-50">
      <span aria-hidden>⌄</span><span>{accessibleName}</span>
    </button>
  )
  if (kind === 'pill') return (
    <button {...common} aria-label={accessibleName}
      className="absolute left-4 top-4 z-[3] inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3.5 py-1.5 text-xs font-semibold text-[color:var(--vb-primary)] shadow-md transition hover:bg-white disabled:opacity-50">
      <span>{accessibleName}</span><span aria-hidden>⌄</span>
    </button>
  )
  return (
    <button {...common} aria-label={accessibleName}
      className="absolute bottom-4 right-4 z-[3] flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/20 text-2xl leading-none text-white transition hover:bg-white/30 disabled:opacity-50">
      <span aria-hidden>⌄</span>
    </button>
  )
}
```

(Match the accepted mockup at `scratchpad/collapse-mockup.html` for spacing/feel.)

- [ ] **Step 3: Run + commit.** vitest → PASS; tsc → 0.

```bash
git add components/viewbook/public/CollapseAffordance.tsx components/viewbook/public/CollapseAffordance.test.tsx
git commit -m "feat(viewbook): CollapseAffordance (bar/pill/chevron, labeled + accessible)"
```

---

### Task 3: `CollapsibleSection` island

**Files:**
- Create: `components/viewbook/public/CollapsibleSection.tsx`
- Test: `components/viewbook/public/CollapsibleSection.test.tsx`

**Interfaces:**
- Consumes: `useCollapseState`, `CollapseAffordance`, PR2's route.
- Produces (client island; ALL props serializable, hero/body passed as server-rendered `ReactNode`s):
  ```ts
  export function CollapsibleSection(props: {
    viewbookId: number; token: string; sectionKey: string;
    collapsedShared: boolean; isOperator: boolean;
    affordance: CollapseAffordanceKind;
    heroExpanded: ReactNode;  // full hero (image+overlay+title+done check) + header-strip collapse control
    heroCollapsed: ReactNode; // shrunken hero variant
    body: ReactNode;          // SectionReveal body — ALWAYS rendered, hidden when collapsed
    regionId: string;
    previewMode?: boolean;    // ThemePreview: no POSTs
  }): JSX.Element
  ```

- [ ] **Step 1: Failing tests.**

```ts
it('collapsed: shows heroCollapsed + affordance; region present but hidden+inert', () => {
  // collapsedShared:true, no override → region exists (aria-controls target) with hidden/inert set
})
it('client expand: localStorage override set, region shown, NO fetch', async () => {
  const fetchSpy = vi.spyOn(global, 'fetch')
  // non-operator expand → override written, fetch NOT called
})
it('client collapse: POSTs {collapsed:true}, clears override, optimistic collapse; restores override on failure', async () => {})
it('operator expand: POSTs {collapsed:false}', async () => {})
it('affordance accessible name is actor-specific (just for you / visible to everyone)', () => {})
it('controls disabled while pending; a second collapse click mid-flight is a no-op (beginPending guard)', async () => {})
it('vb:navigate force-expands via forceExpandedLocal — region shown, NO fetch, NO localStorage write', () => {})
it('previewMode flips visuals but NEVER calls fetch', async () => {})
```

Run: FAIL.

- [ ] **Step 2: Implement.** ALWAYS render the controlled region (Codex FIX-7); collapse toggles `hidden`/`inert`/`aria-hidden`, never DOM presence, so `aria-controls` always resolves. Do NOT add `data-operator-section` here — `OperatorSectionWrapper` already owns the outer section marker (Codex FIX-8); this island renders a plain wrapper. `vb:navigate` uses `forceExpandedLocal` (non-persisted). Collapse snapshots + restores the override on failure.

```tsx
'use client'
import { useEffect, type ReactNode } from 'react'
import { CollapseAffordance } from './CollapseAffordance'
import type { CollapseAffordanceKind } from '@/lib/viewbook/presentation-config'
import { useCollapseState } from './useCollapseState'

export function CollapsibleSection({
  viewbookId, token, sectionKey, collapsedShared, isOperator, affordance,
  heroExpanded, heroCollapsed, body, regionId, previewMode = false,
}: {
  viewbookId: number; token: string; sectionKey: string; collapsedShared: boolean;
  isOperator: boolean; affordance: CollapseAffordanceKind;
  heroExpanded: ReactNode; heroCollapsed: ReactNode; body: ReactNode; regionId: string;
  previewMode?: boolean; // ThemePreview: render collapsed/expanded visuals but NEVER POST (FIX-8)
}) {
  const {
    collapsed, pending, beginPending, endPending,
    setPersonalExpanded, forceExpandedLocal, clearPersonalOverride, restorePersonalOverride, setCollapsedOptimistic,
  } = useCollapseState({ viewbookId, sectionKey, collapsedShared })

  useEffect(() => { // vb:navigate / hash → force-open (in-memory, not persisted)
    function onNav(e: Event) {
      const d = (e as CustomEvent).detail as { sectionKey?: string } | null
      if (d?.sectionKey === sectionKey) forceExpandedLocal()
    }
    window.addEventListener('vb:navigate', onNav)
    if (window.location.hash === `#${sectionKey}`) forceExpandedLocal()
    return () => window.removeEventListener('vb:navigate', onNav)
  }, [sectionKey, forceExpandedLocal])

  async function writeShared(nextCollapsed: boolean): Promise<boolean> {
    const res = await fetch(`/api/viewbook/${token}/collapse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionKey, collapsed: nextCollapsed }),
    })
    return res.ok
  }

  async function onCollapse() {
    if (previewMode) { setCollapsedOptimistic(true); return }
    if (!beginPending()) return               // synchronous double-fire guard (FIX-5)
    setCollapsedOptimistic(true)
    const prevOverride = clearPersonalOverride() // snapshot for rollback (FIX-6)
    try {
      if (!(await writeShared(true))) throw new Error('collapse_failed')
    } catch {
      setCollapsedOptimistic(false); restorePersonalOverride(prevOverride) // restore localStorage too
    } finally { endPending() }
  }

  async function onExpand() {
    if (previewMode) { setCollapsedOptimistic(false); return }
    if (!isOperator) { setPersonalExpanded(); return } // client expand = personal, no fetch
    if (!beginPending()) return
    setCollapsedOptimistic(false)
    try {
      if (!(await writeShared(false))) throw new Error('expand_failed')
      clearPersonalOverride()
    } catch { setCollapsedOptimistic(true) }
    finally { endPending() }
  }

  const expandName = isOperator ? 'Expand (visible to everyone)' : 'Expand (just for you)'
  return (
    <div>
      {collapsed ? (
        <>
          {heroCollapsed}
          <CollapseAffordance kind={affordance} regionId={regionId} accessibleName={expandName} onExpand={onExpand} disabled={pending} />
        </>
      ) : (
        heroExpanded /* the expanded hero includes the header-strip "Collapse for everyone" control — see Task 4 */
      )}
      {/* Region ALWAYS present; hidden+inert while collapsed so aria-controls resolves (FIX-7). */}
      <div id={regionId} role="region" aria-hidden={collapsed ? true : undefined} inert={collapsed}
           hidden={collapsed} style={collapsed ? { display: 'none' } : undefined}>
        {body}
      </div>
    </div>
  )
}
```

Notes for the implementer:
- The expanded "Collapse for everyone" control lives in the header-strip (Task 4 wires `onCollapse` into it via a small context or by rendering the control in this island above `body` — keep it in the real header-strip layout with `aria-expanded="true"` + `aria-controls={regionId}`). Do NOT invent a second `data-operator-section`.
- `heroExpanded`/`heroCollapsed`/`body` are server-rendered nodes; no function prop crosses the RSC boundary. `onCollapse`/`onExpand` are client-side within this island.
- `previewMode` (ThemePreview) flips visuals locally and NEVER calls `writeShared` (FIX-8).
- `inert` (React 19 boolean) + `aria-hidden` + `display:none` are the tab-order/a11y guard incl. older engines (FIX-7).

- [ ] **Step 3: Run + commit.** vitest → PASS; tsc → 0.

```bash
git add components/viewbook/public/CollapsibleSection.tsx components/viewbook/public/CollapsibleSection.test.tsx
git commit -m "feat(viewbook): CollapsibleSection island (viewer collapse/expand, actor-aware)"
```

---

### Task 4: `SectionShell` restructure — delegate to the island; done-check on hero; overlay var

**Files:**
- Modify: `components/viewbook/public/SectionShell.tsx`
- Modify: `components/viewbook/public/SectionReveal.tsx` (only if the collapse control needs a hook point — otherwise untouched)
- Test: `components/viewbook/public/SectionShell.test.tsx`

**Interfaces:**
- Consumes: `CollapsibleSection`, `collapseAffordance` + `heroOverlayStrength` (props threaded from the page; PR4 supplies real values — PR3 accepts them with safe defaults `'bar'` / `55`), `isOperator`.
- Produces: SectionShell renders the hero (with large done-check + overlay driven by `--vb-hero-overlay`) and delegates collapse to `CollapsibleSection`.

- [ ] **Step 1: Update tests.**

```ts
it('renders the large done-check on the hero when state==="done" (collapsed AND expanded)', () => {})
it('retains the body "Completed {date}" badge when expanded and done', () => {})
it('computes concrete gradient stops from heroOverlayStrength (0→15%/60%, 100→60%/85%) — no calc(var()*%)', () => {})
it('always renders the minimum scrim layer, even at heroOverlayStrength=0', () => {})
it('does NOT emit its own data-operator-section (OperatorSectionWrapper owns it)', () => {})
it('bookend sections (pc-intro/pc-thanks) render with NO collapse affordance/control', () => {})
```

Run: FAIL.

- [ ] **Step 2: Implement.**
  - Add props to `SectionShell`: `affordance: CollapseAffordanceKind`, `overlayStrength: number`, `isOperator: boolean`, `viewbookId: number`, `token: string`, `previewMode?: boolean`. (PR4 owns `presentation-config`; these are real props now — no defaults needed since PR3 lands after PR4.)
  - **Concrete overlay stops computed in TS (Codex FIX-9 — NO `calc()` with `var()*%`, unsupported on the project's older targets).** In the server component:
    ```ts
    function clamp01(n: number) { return Math.max(0, Math.min(1, n)) }
    const t = clamp01((Number.isFinite(overlayStrength) ? overlayStrength : 55) / 100)
    const brandStop = Math.round(15 + t * 45)     // 15%..60%
    const fadeStop = Math.round(60 + t * 25)      // 60%..85%
    ```
    then use literal percentages in the gradient (no `var()` arithmetic):
    ```tsx
    <div aria-hidden className="absolute inset-0" style={{
      background: `linear-gradient(to top, var(--vb-primary) ${brandStop}%, transparent ${fadeStop}%)`,
    }} />
    {/* non-configurable MINIMUM title scrim (Codex FIX-PRESENTATION-CONFIG) — always present so
        overlayStrength=0 can't render on-primary text illegibly over a photo */}
    <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/5" style={{
      background: 'linear-gradient(to top, color-mix(in srgb, var(--vb-primary) 55%, transparent), transparent)',
    }} />
    ```
    Test the concrete stops (0 → 15/60, 100 → 60/85) and that the scrim layer exists at overlayStrength=0.
  - Build TWO hero nodes sharing image + overlay + big done-check: `heroExpanded` (full, `min-h-[38vh]`, includes the header-strip "Collapse for everyone" control with `aria-expanded="true"` + `aria-controls={regionId}` wired to the island's `onCollapse`) and `heroCollapsed` (shrunken `min-h-[150px]`, title stepped down, positioned wrapper so the whole hero is pointer-clickable to expand).
  - **Done-check on hero:** when `section.state === 'done'`, render `vb-done-badge` (+ `vb-pop` keyframes) `h-11 w-11 text-lg` at `absolute right-4 top-4 z-[2]`. Keep the existing body summary-face "Completed {date}" badge unchanged (shows when expanded).
  - **Bookend gate (FIX-8):** for `pc-intro`/`pc-thanks` (`!sectionSupportsCollapse(sectionKey)`) render the section WITHOUT collapse — no affordance, no collapse control, body always shown. Simplest: SectionShell returns the plain hero + body (today's layout) for bookends, and only wraps collapsible sections in `CollapsibleSection`.
  - Wrap: SectionShell (server) computes `regionId`, `summaryFace`, both hero nodes, the body node (TickDivider strip + SectionReveal), then returns `<CollapsibleSection heroExpanded={…} heroCollapsed={…} body={bodyNode} regionId={regionId} … />`. Remove the old `heroOnly`/`{!heroOnly && …}` server gate — collapse is the island's job. Do NOT add `data-operator-section` (OperatorSectionWrapper owns it — FIX-8).

- [ ] **Step 3: Thread props through ALL section components (Codex FIX-8 — enumerate; the page cannot pass them automatically).** SectionShell is rendered inside each of the 13 section components. Add `affordance`, `overlayStrength`, `isOperator`, `viewbookId`, `token` to each SectionShell call. `token` + `data` (→ `data.viewbookId`, `data.collapseAffordance`, `data.heroOverlayStrength`) are already in each section component's props; add `isOperator` to the shared `props` object in `app/(public)/viewbook/[token]/page.tsx` (`isOperator: operatorEmail != null`) and thread it. The 13 components: `WelcomeSection`, `MilestonesSection`, `DataSourceSection`, `BrandSection`, `AssessmentSection`, `StrategySection`, `MaterialsSection`, `KickoffNextSection`, `WsIntroSection`, `PcIntroSection`, `PcSetupSection`, `PcInviteSection`, `PcThanksSection`. (Prefer a single shared prop-passthrough: extend the `props` object once and spread it, so this is one edit per component, not five.)
  - **ThemePreview (FIX-8):** `components/viewbook/admin/ThemePreview.tsx` renders `SectionShell` for the admin preview — pass `previewMode` so the island never issues public collapse POSTs, and supply placeholder `viewbookId/token/isOperator`. Its `SAMPLE_SECTION` gets `collapsedShared:false` (also required by PR1's type change).

- [ ] **Step 4: Run + gate + commit.**

Run: `npx vitest run components/viewbook app/api/viewbook lib/viewbook` → PASS; `tsc` → 0; `npm run build` → OK.

```bash
git add components/viewbook/public/SectionShell.tsx "app/(public)/viewbook/[token]/page.tsx" components/viewbook/public/SectionShell.test.tsx
git commit -m "feat(viewbook): hero done-check + overlay + delegate collapse to CollapsibleSection"
```

---

## PR3 self-check
- Effective = override ?? shared; client expand local (no fetch), client collapse + operator both write; operator expand writes shared-false.
- Prop reconciliation flips override-less viewers on refetch, suppressed while pending AND applied on `endPending` (not dropped — FIX-5).
- Collapse failure restores localStorage override (FIX-6); `vb:navigate` uses `forceExpandedLocal` (non-persisted).
- Region ALWAYS rendered (hidden+inert when collapsed) so `aria-controls` resolves (FIX-7); no duplicate `data-operator-section` (FIX-8).
- Concrete overlay stops in TS, no `calc(var()*%)`; minimum scrim always present (FIX-9).
- Bookends render with no collapse; ThemePreview `previewMode` never POSTs.
- Done-check on hero (collapsed + expanded) + body badge retained. No function prop crosses the RSC boundary. Gates green incl. build.
