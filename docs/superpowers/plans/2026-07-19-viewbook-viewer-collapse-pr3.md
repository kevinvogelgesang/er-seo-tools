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
    collapsed: boolean;           // effective, for rendering
    setPersonalExpanded(): void;  // client expand: localStorage override='expanded'
    clearPersonalOverride(): void;// on any collapse: remove the key
    pendingRef: React.MutableRefObject<boolean>; // guards prop-reconciliation while a write is in flight
  }
  ```
- localStorage key helper `collapseKey(viewbookId, sectionKey) = \`vb:collapse:${viewbookId}:${sectionKey}\``.

- [ ] **Step 1: Failing tests** (jsdom; stub localStorage like `PresentationToggle.test.tsx`):

```ts
it('effective = collapsedShared when no override', () => { /* renderHook, collapsedShared:true → collapsed true */ })
it('personal expanded override wins over shared collapse', () => { /* set override, collapsed=false */ })
it('clearPersonalOverride removes the key so shared applies again', () => { /* … */ })
it('a changed collapsedShared prop flips an override-less viewer', () => { /* rerender with new prop */ })
it('a changed collapsedShared prop does NOT flip an override-holder', () => { /* override present */ })
it('prop change is ignored while pendingRef.current is true', () => { /* set pending, rerender, no flip */ })
```

Run: FAIL.

- [ ] **Step 2: Implement.**

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
  // SSR-safe seed: shared default (no window read in the initializer).
  const [collapsed, setCollapsed] = useState(collapsedShared)
  const pendingRef = useRef(false)
  const overrideRef = useRef<'expanded' | null>(null)

  // Mount: read the personal override; override wins.
  useEffect(() => {
    overrideRef.current = readOverride(key)
    setCollapsed(overrideRef.current === 'expanded' ? false : collapsedShared)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Reconcile a refetched shared prop — unless a write we issued is pending,
  // and never overriding a personal expand.
  useEffect(() => {
    if (pendingRef.current) return
    setCollapsed(overrideRef.current === 'expanded' ? false : collapsedShared)
  }, [collapsedShared])

  const setPersonalExpanded = useCallback(() => {
    try { localStorage.setItem(key, 'expanded') } catch {}
    overrideRef.current = 'expanded'
    setCollapsed(false)
  }, [key])

  const clearPersonalOverride = useCallback(() => {
    try { localStorage.removeItem(key) } catch {}
    overrideRef.current = null
  }, [key])

  return { collapsed, setPersonalExpanded, clearPersonalOverride, pendingRef, setCollapsed }
}
```

(Expose `setCollapsed` too — the island uses it for the optimistic collapse flip.)

- [ ] **Step 3: Run + commit.** `npx vitest run components/viewbook/public/useCollapseState.test.ts` → PASS; `tsc` → 0.

```bash
git add components/viewbook/public/useCollapseState.ts components/viewbook/public/useCollapseState.test.ts
git commit -m "feat(viewbook): useCollapseState (personal override + reconciliation reducer)"
```

---

### Task 2: `CollapseAffordanceKind` home + `CollapseAffordance` presentational component (3 variants)

**Files:**
- Create: `lib/viewbook/presentation-config.ts` (type + const ONLY here in PR3; PR4 adds the sanitizer functions to the same file)
- Create: `components/viewbook/public/CollapseAffordance.tsx`
- Test: `components/viewbook/public/CollapseAffordance.test.tsx`

**Interfaces:**
- Produces (`lib/viewbook/presentation-config.ts` — the ONE home of the affordance type, client-safe, no server imports):
  ```ts
  export const COLLAPSE_AFFORDANCES = ['bar', 'pill', 'chevron'] as const
  export type CollapseAffordanceKind = (typeof COLLAPSE_AFFORDANCES)[number]
  export const PRESENTATION_DEFAULTS = { collapseAffordance: 'bar' as CollapseAffordanceKind, heroOverlayStrength: 55 }
  ```
- Produces (`CollapseAffordance.tsx`, importing the type from `presentation-config.ts`):
  ```ts
  export function CollapseAffordance(props: {
    kind: CollapseAffordanceKind; regionId: string; accessibleName: string;
    onExpand(): void; disabled: boolean;
  }): JSX.Element
  ```
- `accessibleName` is actor-specific text supplied by the island (FIX-ACTOR-AFFORDANCE).

- [ ] **Step 0: Create `lib/viewbook/presentation-config.ts`** with exactly the `COLLAPSE_AFFORDANCES` / `CollapseAffordanceKind` / `PRESENTATION_DEFAULTS` exports above (no functions yet — PR4 Task 2 adds `parsePresentationPatch`/`readPresentationConfig` to this same file). `CollapseAffordance.tsx` and `CollapsibleSection.tsx` import `CollapseAffordanceKind` from here — never redeclare it.

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
- Produces (client island; ALL props serializable, body passed as `children` node):
  ```ts
  export function CollapsibleSection(props: {
    viewbookId: number; token: string; sectionKey: string;
    collapsedShared: boolean; isOperator: boolean;
    affordance: CollapseAffordanceKind;
    hero: ReactNode;      // server-rendered hero band (image+overlay+title+done check)
    heroCollapsed: ReactNode; // shrunken hero variant
    body: ReactNode;      // server-rendered header strip + SectionReveal body
    regionId: string;
  }): JSX.Element
  ```

- [ ] **Step 1: Failing tests.**

```ts
it('renders collapsed (heroCollapsed + affordance, no body) when effective collapsed', () => { /* collapsedShared:true, no override */ })
it('client expand: localStorage override set, body shown, NO fetch', async () => {
  const fetchSpy = vi.spyOn(global, 'fetch')
  // click expand as non-operator → override written, fetch NOT called with /collapse
})
it('client collapse: POSTs {collapsed:true}, clears override, optimistic collapse', async () => { /* assert fetch body */ })
it('operator expand: POSTs {collapsed:false} (shared)', async () => { /* isOperator, assert fetch body */ })
it('affordance accessible name is actor-specific', () => {
  // isOperator=false → "Expand (just for you)"; isOperator=true → "Expand (visible to everyone)"
})
it('controls disabled while a write is pending', async () => { /* slow fetch, button disabled mid-flight */ })
it('vb:navigate for this sectionKey force-expands even when collapsed', () => {
  // dispatch window CustomEvent('vb:navigate',{detail:{sectionKey}}), assert body shown, no fetch, no override write
})
```

Run: FAIL.

- [ ] **Step 2: Implement.** Core behavior:

```tsx
'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { CollapseAffordance } from './CollapseAffordance'
import type { CollapseAffordanceKind } from '@/lib/viewbook/presentation-config'
import { useCollapseState } from './useCollapseState'

export function CollapsibleSection({
  viewbookId, token, sectionKey, collapsedShared, isOperator, affordance, hero, heroCollapsed, body, regionId,
}: { /* …types above… */ }) {
  const { collapsed, setCollapsed, setPersonalExpanded, clearPersonalOverride, pendingRef } =
    useCollapseState({ viewbookId, sectionKey, collapsedShared })
  const [busy, setBusy] = useState(false)

  // vb:navigate force-open (local view only; never writes shared)
  useEffect(() => {
    function onNav(e: Event) {
      const d = (e as CustomEvent).detail as { sectionKey?: string } | null
      if (d?.sectionKey === sectionKey) setPersonalExpanded() // local expand + scroll handled by nav util
    }
    window.addEventListener('vb:navigate', onNav)
    if (window.location.hash === `#${sectionKey}`) setPersonalExpanded()
    return () => window.removeEventListener('vb:navigate', onNav)
  }, [sectionKey, setPersonalExpanded])

  async function writeShared(nextCollapsed: boolean) {
    setBusy(true); pendingRef.current = true
    try {
      const res = await fetch(`/api/viewbook/${token}/collapse`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKey, collapsed: nextCollapsed }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } finally { setBusy(false); pendingRef.current = false }
  }

  async function onCollapse() {
    setCollapsed(true); clearPersonalOverride()  // optimistic + clear personal
    try { await writeShared(true) } catch { /* revert */ setCollapsed(false) }
  }
  async function onExpand() {
    if (isOperator) {
      setCollapsed(false)
      try { await writeShared(false); clearPersonalOverride() } catch { setCollapsed(true) }
    } else {
      setPersonalExpanded() // personal only, no fetch
    }
  }

  const expandName = isOperator ? 'Expand (visible to everyone)' : 'Expand (just for you)'
  if (collapsed) {
    return (
      <section id={sectionKey} data-operator-section={sectionKey}>
        {heroCollapsed}
        <CollapseAffordance kind={affordance} regionId={regionId} accessibleName={expandName} onExpand={onExpand} disabled={busy} />
      </section>
    )
  }
  return (
    <section id={sectionKey} data-operator-section={sectionKey}>
      {hero}
      {/* Collapse control lives in the header strip inside `body`; wire it via a
          context or a render-prop. Simplest: render a "Collapse for everyone"
          button here above the body, disabled={busy}, onClick={onCollapse}. */}
      <button type="button" onClick={onCollapse} disabled={busy}
        className="mx-auto flex w-full max-w-5xl items-center gap-2 px-6 pt-3 text-sm font-semibold text-black/60 hover:text-black/80 disabled:opacity-50">
        <span aria-hidden>▴</span> Collapse for everyone
      </button>
      {body}
    </section>
  )
}
```

Notes for the implementer:
- The `data-operator-section` attribute must stay on the outer `<section>` in BOTH branches so the inspector scroll-spy (`useSectionSelection`) keeps working.
- The collapsed body is NOT rendered here (structural simplification — the transitional PR1 render already hides it). Because the body is absent while collapsed, the `inert`/`aria-hidden`/older-browser-visibility concern (FIX-7) is moot in this branch. `vb:navigate` sets the personal expand which re-renders the body branch, satisfying "navigate → open."
- Keep this island free of any function-prop crossing the RSC boundary: `hero`, `heroCollapsed`, `body` are server-rendered nodes; the rest are scalars.

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
it('renders the large done-check on the hero when state==="done" (collapsed AND expanded)', () => { /* both branches */ })
it('retains the body "Completed {date}" badge when expanded and done', () => { /* summary face present */ })
it('applies --vb-hero-overlay from heroOverlayStrength with the minimum scrim floor', () => {
  // heroOverlayStrength=0 → the style var resolves but a min-scrim layer is present
})
it('collapsed section still exposes data-operator-section for the scroll-spy', () => { /* … */ })
```

Run: FAIL.

- [ ] **Step 2: Implement.**
  - Add props `affordance: CollapseAffordanceKind = 'bar'`, `overlayStrength: number = 55`, `isOperator: boolean`, `viewbookId: number`, `token: string` to `SectionShell`.
  - Build TWO hero nodes: `hero` (full, `min-h-[38vh]`) and `heroCollapsed` (shrunken, `min-h-[150px]`, title stepped down). Both share the image + overlay + big done-check.
  - **Done-check on hero:** when `section.state === 'done'`, render the badge (reuse the `vb-done-badge` class + `vb-pop` keyframes) sized `h-11 w-11 text-lg` in the hero's top-right (`absolute right-4 top-4 z-[2]`). Keep the existing body summary-face badge (with `Completed {date}`) unchanged — it shows when expanded.
  - **Overlay + min scrim:** set `style={{ ['--vb-hero-overlay' as string]: String(clamp01(overlayStrength/100)) }}` on the hero container; the gradient div becomes:
    ```tsx
    <div aria-hidden className="absolute inset-0" style={{
      background: `linear-gradient(to top,
        var(--vb-primary) calc(15% + var(--vb-hero-overlay) * 45%),
        transparent calc(60% + var(--vb-hero-overlay) * 25%))`,
    }} />
    <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/5" style={{
      background: 'linear-gradient(to top, color-mix(in srgb, var(--vb-primary) 55%, transparent), transparent)',
    }} /> {/* non-configurable minimum title scrim (FIX-6) */}
    ```
  - Wrap the whole thing: SectionShell (server) computes `regionId`, `summaryFace`, both hero nodes, and the body node (the existing `!heroOnly` TickDivider strip + SectionReveal), then returns `<CollapsibleSection … hero={hero} heroCollapsed={heroCollapsed} body={bodyNode} />`. Remove the old `heroOnly`/`{!heroOnly && …}` server gate — collapse is now the island's job.

- [ ] **Step 3: Thread props from the page.** In `app/(public)/viewbook/[token]/page.tsx`, pass `viewbookId`, `token`, `isOperator` (`operatorEmail != null`), and (PR4) `affordance`/`overlayStrength` from `data` into the section renderers → SectionShell. For PR3, default affordance/overlay in SectionShell so the page compiles before PR4 lands.

- [ ] **Step 4: Run + gate + commit.**

Run: `npx vitest run components/viewbook app/api/viewbook lib/viewbook` → PASS; `tsc` → 0; `npm run build` → OK.

```bash
git add components/viewbook/public/SectionShell.tsx "app/(public)/viewbook/[token]/page.tsx" components/viewbook/public/SectionShell.test.tsx
git commit -m "feat(viewbook): hero done-check + overlay + delegate collapse to CollapsibleSection"
```

---

## PR3 self-check
- Effective = override ?? shared; client expand local (no fetch), client collapse + operator both write; operator expand writes shared-false.
- Prop reconciliation flips override-less viewers on refetch, suppressed while pending.
- `vb:navigate` force-opens a collapsed section; `data-operator-section` preserved for scroll-spy.
- Done-check on hero (collapsed + expanded) + body badge retained; overlay var + min scrim.
- No function prop crosses the RSC boundary. Gates green incl. build.
