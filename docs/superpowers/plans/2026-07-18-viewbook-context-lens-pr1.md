# Context Lens — PR1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Checkbox steps track progress. Read the program plan (`2026-07-18-viewbook-context-lens-program.md`) and spec (`2026-07-18-viewbook-context-lens-design.md`) first. This plan already incorporates Codex's plan-review fixes #1–#11.

**Goal:** Land the frozen tandem contracts + a composed-but-inert docked inspector wired behind the presentation gate, with the dual-scope sticky-offset publish. Nothing user-visible changes except an empty desktop inspector rail; the existing inline sandwich still renders.

**Architecture:** New `components/viewbook/public/OperatorLayer/inspector/` module: a selection context (pin state machine), a reactive per-section activity registry + a lifecycle bridge hook, a visible-pixel scroll-spy hook, an inspector shell, and typed placeholders (with a frozen data seam) for the outline + panes. `OperatorViewbookLayer` mounts the providers OUTSIDE the visual presentation gate and renders the inspector inside the operator branch. `StickyOffsetProbe` also publishes to `document.documentElement`.

**Tech stack:** Next.js 15, React 19, TS, Tailwind, Vitest (`globals:false`, jsdom per-file header, NO jest-dom) + Testing Library.

## Global Constraints

See the program plan's Global Constraints (C1–C6, gates, change boundary). PR1-critical: **C1** providers OUTSIDE the early-return + safe no-op context defaults so wrapper hooks are unconditional. **C2** one `#vb-operator-bar`; probe dual-publish, no second measurement path. **C3** inspector only in the verified-operator branch; extend the anonymous `OPERATOR_MARKERS` guard.

**Test conventions (this repo — Codex fix #10):** every new test file starts with `// @vitest-environment jsdom`, imports `{ afterEach, describe, expect, it, vi }` from `'vitest'` and `{ cleanup, render, screen, act }` from `'@testing-library/react'`, ends effects with `afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })`, and there is **no jest-dom** — assert with `.toBeTruthy()` / `container.querySelector(...) === null`, never `.toBeInTheDocument()`. Tests stubbing `IntersectionObserver` must delete it in teardown.

**Lane:** `git worktree add .claude/worktrees/vb-lens-pr1 -b feat/vb-lens-pr1`; announce it. Gate inside the worktree: `npx tsc --noEmit` + `npx vitest run "components/viewbook/public/OperatorLayer" "app/(public)/viewbook"`.

---

### Task 1: SelectionContext — pin state machine (Codex fix #1, #6)

**Files:** Create `inspector/SelectionContext.tsx` + `inspector/SelectionContext.test.tsx`

**Interfaces produced:** `InspectorGroup`, `PinReason`, `PinKind`, `SelectionState`, `SelectionProvider`, `useSelectionContext()` (program §Interface freeze).

**Behavior (spec §3.2):** hard ('activity') pin from dirty/focus **fails closed** — `select()` on a *different* section returns `false` and does not swap the pane. Soft ('manual-nav') pin releases on target-dominance (via `useSectionSelection`) OR a bounded timeout. `release(key, kind)` is **scoped** — a stale release of a non-matching key/kind is a no-op.

- [ ] **Step 1: Failing tests** (fake timers for the soft-pin timeout)

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import { SelectionProvider, useSelectionContext } from './SelectionContext'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

function Probe() {
  const s = useSelectionContext()
  return (
    <div>
      <span data-testid="sel">{s.selectedKey ?? 'none'}</span>
      <span data-testid="kind">{s.pinnedKind ?? 'none'}</span>
      <button onClick={() => s.select('brand', 'dirty')}>hard-brand</button>
      <button onClick={() => { const ok = s.select('welcome', 'focus'); (globalThis as any).__ok = ok }}>hard-welcome</button>
      <button onClick={() => s.select('milestones', 'manual-nav')}>nav-milestones</button>
      <button onClick={() => s.release('brand', 'activity')}>rel-brand-activity</button>
      <button onClick={() => s.release('brand', 'manual-nav')}>rel-brand-wrongkind</button>
    </div>
  )
}

describe('SelectionContext', () => {
  it('no-op default outside a provider does not throw', () => {
    render(<Probe />)
    expect(screen.getByTestId('sel').textContent).toBe('none')
    act(() => { screen.getByText('nav-milestones').click() })
    expect(screen.getByTestId('sel').textContent).toBe('none')
  })

  it('hard pin blocks a switch to another section (fail closed)', () => {
    render(<SelectionProvider><Probe /></SelectionProvider>)
    act(() => { screen.getByText('hard-brand').click() })
    expect(screen.getByTestId('sel').textContent).toBe('brand')
    expect(screen.getByTestId('kind').textContent).toBe('activity')
    act(() => { screen.getByText('hard-welcome').click() })
    expect((globalThis as any).__ok).toBe(false)           // blocked
    expect(screen.getByTestId('sel').textContent).toBe('brand') // pane unchanged
  })

  it('scoped release ignores a wrong-kind release, honors the matching one', () => {
    render(<SelectionProvider><Probe /></SelectionProvider>)
    act(() => { screen.getByText('hard-brand').click() })
    act(() => { screen.getByText('rel-brand-wrongkind').click() })
    expect(screen.getByTestId('kind').textContent).toBe('activity') // still pinned
    act(() => { screen.getByText('rel-brand-activity').click() })
    expect(screen.getByTestId('kind').textContent).toBe('none')     // released
  })

  it('manual-nav soft pin auto-releases after the timeout', () => {
    vi.useFakeTimers()
    render(<SelectionProvider><Probe /></SelectionProvider>)
    act(() => { screen.getByText('nav-milestones').click() })
    expect(screen.getByTestId('kind').textContent).toBe('manual-nav')
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.getByTestId('kind').textContent).toBe('none')
  })
})
```

- [ ] **Step 2: Run → fails** (`Cannot find module './SelectionContext'`).

- [ ] **Step 3: Implement**

```tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'

export type InspectorGroup = 'content' | 'status' | 'assets' | 'data' | 'documents'
export type PinReason = 'dirty' | 'focus' | 'manual-nav'
export type PinKind = 'activity' | 'manual-nav'

const MANUAL_NAV_PIN_MS = 4000

export interface SelectionState {
  selectedKey: SectionKey | null
  selectedGroup: InspectorGroup | null
  select: (key: SectionKey, reason?: PinReason, group?: InspectorGroup) => boolean
  observe: (key: SectionKey) => void
  release: (key: SectionKey, kind: PinKind) => void
  isPinned: boolean
  pinnedKey: SectionKey | null
  pinnedKind: PinKind | null
}

const NOOP: SelectionState = {
  selectedKey: null, selectedGroup: null,
  select: () => false, observe: () => {}, release: () => {},
  isPinned: false, pinnedKey: null, pinnedKind: null,
}

const Ctx = createContext<SelectionState | null>(null)

interface Pin { key: SectionKey; kind: PinKind }

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedKey, setSelectedKey] = useState<SectionKey | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<InspectorGroup | null>(null)
  const [pin, setPin] = useState<Pin | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }

  const release = useCallback((key: SectionKey, kind: PinKind) => {
    setPin((cur) => (cur && cur.key === key && cur.kind === kind ? (clearTimer(), null) : cur))
  }, [])

  const select = useCallback((key: SectionKey, reason: PinReason = 'manual-nav', group?: InspectorGroup) => {
    const kind: PinKind = reason === 'dirty' || reason === 'focus' ? 'activity' : 'manual-nav'
    let ok = true
    setPin((cur) => {
      // A HARD pin on a DIFFERENT section fails closed.
      if (cur && cur.kind === 'activity' && cur.key !== key && kind !== 'activity') { ok = false; return cur }
      if (cur && cur.kind === 'activity' && cur.key !== key && kind === 'activity') { ok = false; return cur }
      return { key, kind }
    })
    if (!ok) return false
    setSelectedKey(key)
    if (group) setSelectedGroup(group)
    clearTimer()
    if (kind === 'manual-nav') {
      timer.current = setTimeout(() => release(key, 'manual-nav'), MANUAL_NAV_PIN_MS)
    }
    return true
  }, [release])

  const observe = useCallback((key: SectionKey) => {
    setPin((cur) => cur) // read-only; scroll-spy yields to ANY pin
    setSelectedKey((curSel) => (/* yield when pinned */ null !== null ? curSel : curSel))
    // The authoritative yield: only move selection when nothing is pinned.
    setPinAwareSelection(key)
  }, [])

  // helper closed over state via functional updates
  const setPinAwareSelection = useCallback((key: SectionKey) => {
    setPin((cur) => {
      if (cur === null) setSelectedKey(key)
      return cur
    })
  }, [])

  useEffect(() => clearTimer, [])

  const value = useMemo<SelectionState>(() => ({
    selectedKey, selectedGroup, select, observe, release,
    isPinned: pin !== null, pinnedKey: pin?.key ?? null, pinnedKind: pin?.kind ?? null,
  }), [selectedKey, selectedGroup, select, observe, release, pin])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSelectionContext(): SelectionState {
  return useContext(Ctx) ?? NOOP
}
```

> Implementer note: simplify `observe` to a single functional `setPin((cur) => { if (cur === null) setSelectedKey(key); return cur })` — the scaffolding above shows the intent (yield to any pin); collapse it to that one call and drop the dead lines before committing.

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `feat(viewbook): Context Lens selection pin state machine (PR1)`

---

### Task 2: useSectionActivity — reactive registry + lifecycle bridge (Codex fix #2, #3)

**Files:** Create `inspector/useSectionActivity.tsx` + `inspector/useSectionActivity.test.tsx`

**Interfaces produced:** `SectionActivitySnapshot`, `SectionActivityApi` (incl. `remove` + `version`), `SectionActivityProvider`, `useSectionActivityContext()`, `useReportSectionActivity()` (program §Interface freeze). Independent of `useEditorActivity` (C4).

- [ ] **Step 1: Failing tests**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import { SectionActivityProvider, useSectionActivityContext } from './useSectionActivity'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const IDLE = { dirty: false, busy: false, conflict: false, focused: false }

function Probe() {
  const reg = useSectionActivityContext()
  return (
    <div>
      <span data-testid="active">{String(reg.anyActive('brand'))}</span>
      <button onClick={() => reg.report('brand', 'copy', { ...IDLE, dirty: true })}>dirty-copy</button>
      <button onClick={() => reg.report('brand', 'theme', { ...IDLE, busy: true })}>busy-theme</button>
      <button onClick={() => reg.report('brand', 'copy', IDLE)}>clear-copy</button>
      <button onClick={() => reg.remove('brand', 'theme')}>remove-theme</button>
    </div>
  )
}

describe('useSectionActivity', () => {
  it('re-renders consumers on change and OR-reduces across editors', () => {
    render(<SectionActivityProvider><Probe /></SectionActivityProvider>)
    expect(screen.getByTestId('active').textContent).toBe('false')
    act(() => screen.getByText('dirty-copy').click())
    expect(screen.getByTestId('active').textContent).toBe('true')      // reactive (version bump)
    act(() => screen.getByText('busy-theme').click())
    act(() => screen.getByText('clear-copy').click())
    expect(screen.getByTestId('active').textContent).toBe('true')      // theme still busy
    act(() => screen.getByText('remove-theme').click())
    expect(screen.getByTestId('active').textContent).toBe('false')     // remove clears it
  })

  it('no-op default outside a provider does not throw', () => {
    render(<Probe />)
    act(() => screen.getByText('dirty-copy').click())
    expect(screen.getByTestId('active').textContent).toBe('false')
  })
})
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement**

```tsx
'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'

export interface SectionActivitySnapshot { dirty: boolean; busy: boolean; conflict: boolean; focused: boolean }
const IDLE: SectionActivitySnapshot = { dirty: false, busy: false, conflict: false, focused: false }
const same = (a: SectionActivitySnapshot, b: SectionActivitySnapshot) =>
  a.dirty === b.dirty && a.busy === b.busy && a.conflict === b.conflict && a.focused === b.focused

export interface SectionActivityApi {
  report: (sectionKey: SectionKey, editorId: string, snap: SectionActivitySnapshot) => void
  remove: (sectionKey: SectionKey, editorId: string) => void
  aggregateFor: (sectionKey: SectionKey) => SectionActivitySnapshot
  anyActive: (sectionKey: SectionKey) => boolean
  version: number
}
const NOOP: SectionActivityApi = { report: () => {}, remove: () => {}, aggregateFor: () => IDLE, anyActive: () => false, version: 0 }

const Ctx = createContext<SectionActivityApi | null>(null)
type Store = Record<string, Record<string, SectionActivitySnapshot>>

export function SectionActivityProvider({ children }: { children: ReactNode }) {
  const store = useRef<Store>({})
  const [version, setVersion] = useState(0)

  const report = useCallback((sectionKey: SectionKey, editorId: string, snap: SectionActivitySnapshot) => {
    const sec = store.current[sectionKey] ?? (store.current[sectionKey] = {})
    if (sec[editorId] && same(sec[editorId], snap)) return
    sec[editorId] = snap
    setVersion((v) => v + 1)
  }, [])

  const remove = useCallback((sectionKey: SectionKey, editorId: string) => {
    const sec = store.current[sectionKey]
    if (!sec || !(editorId in sec)) return
    delete sec[editorId]
    setVersion((v) => v + 1)
  }, [])

  const aggregateFor = useCallback((sectionKey: SectionKey): SectionActivitySnapshot => {
    const sec = store.current[sectionKey]
    if (!sec) return IDLE
    return Object.values(sec).reduce<SectionActivitySnapshot>((acc, s) => ({
      dirty: acc.dirty || s.dirty, busy: acc.busy || s.busy, conflict: acc.conflict || s.conflict, focused: acc.focused || s.focused,
    }), IDLE)
  }, [])

  const anyActive = useCallback((sectionKey: SectionKey) => {
    const a = aggregateFor(sectionKey)
    return a.dirty || a.busy || a.conflict || a.focused
  }, [aggregateFor])

  // `version` IS in the value so consumers re-render on every change (Codex fix #3).
  const value = useMemo<SectionActivityApi>(() => ({ report, remove, aggregateFor, anyActive, version }), [report, remove, aggregateFor, anyActive, version])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSectionActivityContext(): SectionActivityApi {
  return useContext(Ctx) ?? NOOP
}
```

- [ ] **Step 4: Add the lifecycle bridge to the same file + a test.** Each relocated controller (PR3) calls this once.

```tsx
import { useEffect } from 'react'
import { useSelectionContext } from './SelectionContext'

export function useReportSectionActivity(sectionKey: SectionKey, editorId: string, snap: SectionActivitySnapshot): void {
  const activity = useSectionActivityContext()
  const selection = useSelectionContext()
  useEffect(() => { activity.report(sectionKey, editorId, snap) },
    [activity, sectionKey, editorId, snap.dirty, snap.busy, snap.conflict, snap.focused])
  useEffect(() => {
    if (activity.anyActive(sectionKey)) selection.select(sectionKey, 'focus')
    else selection.release(sectionKey, 'activity')
  }, [activity, activity.version, sectionKey, selection])
  useEffect(() => () => activity.remove(sectionKey, editorId), [activity, sectionKey, editorId])
}
```

Bridge test: mount two `useReportSectionActivity` probes (brand active, welcome idle) inside both providers; assert selection hard-pins `brand`; flip brand idle → assert pin releases. (Use the `SelectionProvider` + `SectionActivityProvider` wrapper.)

- [ ] **Step 5: Run → passes. Commit** — `feat(viewbook): reactive section-activity registry + lifecycle bridge (PR1)`

---

### Task 3: useSectionSelection — visible-pixel scroll-spy (Codex fix #4, #5)

**Files:** Create `inspector/useSectionSelection.ts` + `inspector/useSectionSelection.test.tsx`

**Interface produced:** `useSectionSelection(orderedKeys: readonly SectionKey[]): void`. Passive `IntersectionObserver` over `[data-operator-section]`; scores **visible pixels** (`intersectionRect.height`), lineup-order tie-break, hysteresis before replacing the current selection, calls `observe(best)` (context yields to any pin), and releases a `manual-nav` pin when its target becomes dominant. Stable across re-renders via a serialized-key effect dep.

- [ ] **Step 1: Failing test** (stub IntersectionObserver; assert `observe` called with the max-visible-pixels key, NOT the max-ratio key)

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, act } from '@testing-library/react'
import { useSectionSelection } from './useSectionSelection'
import * as sel from './SelectionContext'

let ioCb: (entries: any[]) => void
beforeEach(() => {
  ;(globalThis as any).IntersectionObserver = class {
    constructor(fn: any) { ioCb = fn }
    observe() {} ; unobserve() {} ; disconnect() {}
  }
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (globalThis as any).IntersectionObserver })

function Host({ keys }: { keys: readonly ('welcome'|'brand')[] }) { useSectionSelection(keys); return null }

describe('useSectionSelection', () => {
  it('selects the section with the most VISIBLE PIXELS, not the highest ratio', () => {
    const observe = vi.fn()
    vi.spyOn(sel, 'useSelectionContext').mockReturnValue({ ...(sel as any), observe, isPinned: false, selectedKey: null, pinnedKind: null, release: vi.fn(), select: vi.fn(), pinnedKey: null, selectedGroup: null } as any)
    document.body.innerHTML = '<div data-operator-section="welcome"></div><div data-operator-section="brand"></div>'
    const keys = ['welcome', 'brand'] as const
    render(<Host keys={keys} />)
    act(() => ioCb([
      // welcome: small but fully visible (high ratio, few px); brand: tall, more visible px
      { target: document.querySelector('[data-operator-section="welcome"]'), isIntersecting: true, intersectionRatio: 1, intersectionRect: { height: 120 } },
      { target: document.querySelector('[data-operator-section="brand"]'), isIntersecting: true, intersectionRatio: 0.4, intersectionRect: { height: 400 } },
    ]))
    expect(observe).toHaveBeenCalledWith('brand')
  })
})
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement**

```ts
'use client'

import { useEffect } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'
import { useSelectionContext } from './SelectionContext'

const HYSTERESIS_PX = 24

// Passive scroll-spy. Scores VISIBLE PIXELS per section, breaks ties in lineup
// order, and applies a hysteresis margin before replacing the current
// selection. Calls observe() — SelectionContext is the authoritative pin guard,
// so this never overrides a section the operator is editing. Reads geometry
// only; never mutates height/collapse/<details> state.
export function useSectionSelection(orderedKeys: readonly SectionKey[]): void {
  const { observe, selectedKey, pinnedKey, pinnedKind, release } = useSelectionContext()
  const sig = orderedKeys.join('|') // stable effect dep — avoids disconnect/reconnect churn (fix #5)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const keys = sig.split('|') as SectionKey[]
    const visible = new Map<SectionKey, number>()

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.operatorSection as SectionKey | undefined
        if (!key) continue
        visible.set(key, e.isIntersecting ? (e.intersectionRect?.height ?? 0) : 0)
      }
      let best: SectionKey | null = null
      let bestPx = 0
      for (const key of keys) { // iteration order = lineup order → deterministic ties
        const px = visible.get(key) ?? 0
        if (px > bestPx) { bestPx = px; best = key }
      }
      if (!best) return
      // manual-nav pin releases once its target is dominant
      if (pinnedKind === 'manual-nav' && best === pinnedKey) release(pinnedKey, 'manual-nav')
      // hysteresis: keep current selection unless the challenger clears the margin
      const currentPx = selectedKey ? (visible.get(selectedKey) ?? 0) : 0
      if (best !== selectedKey && bestPx < currentPx + HYSTERESIS_PX) return
      observe(best)
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] })

    document.querySelectorAll<HTMLElement>('[data-operator-section]').forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [sig, observe, selectedKey, pinnedKey, pinnedKind, release])
}
```

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `feat(viewbook): visible-pixel scroll-spy selection hook (PR1)`

---

### Task 4: SectionOutline + InspectorPanes placeholders with frozen data seam (Codex fix #7)

**Files:** Create `inspector/SectionOutline.tsx`, `inspector/InspectorPanes.tsx` + `inspector/inspector-placeholders.test.tsx`

**Interfaces produced:** `OutlineGroup`, `OutlineRow`, `buildOutlineRows(...)`, `SectionOutlineProps`, `InspectorPanesProps` (program §Interface freeze). `buildOutlineRows` + the props are the seam so PR2 fills bodies without changing signatures; PR3 fills panes.

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SectionOutline, buildOutlineRows } from './SectionOutline'
import { InspectorPanes } from './InspectorPanes'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const od: any = { theme: DEFAULT_THEME, sections: [], fields: [], milestones: [], docs: { global: [], own: [] }, welcomeNote: null, dataLockedAt: null, dataLockedBy: null, pcCompletedAt: null, clientNotifyEmails: [], teamMembers: [] }

describe('inspector placeholders', () => {
  it('outline renders its navigation landmark and buildOutlineRows is callable', () => {
    expect(Array.isArray(buildOutlineRows(od, 'kickoff' as any, null))).toBe(true)
    render(<SectionOutline operatorData={od} stage={'kickoff' as any} pcCompletedAt={null} viewbookId={1} />)
    expect(screen.getByRole('navigation', { name: /section outline/i })).toBeTruthy()
  })
  it('panes render their region landmark', () => {
    render(<InspectorPanes viewbookId={1} operatorData={od} />)
    expect(screen.getByRole('region', { name: /section editors/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** (PR1 bodies are minimal; PR2/PR3 fill them)

```tsx
// SectionOutline.tsx
'use client'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import type { SectionKey } from '@/lib/viewbook/theme'

export type OutlineGroup = 'primary' | 'carried' | 'future'
export interface OutlineRow {
  sectionKey: SectionKey
  title: string
  state: 'active' | 'hidden' | 'done'
  acknowledged: boolean
  group: OutlineGroup
}
export interface SectionOutlineProps {
  operatorData: OperatorViewbookData
  stage: ViewbookStage
  pcCompletedAt: string | null
  viewbookId: number
}

// PR2 fills this from public-data lineups (primary+carried, hidden reinserted
// in lineup order, pc-thanks gated by pcCompletedAt, future-stage → 'future').
export function buildOutlineRows(_operatorData: OperatorViewbookData, _stage: ViewbookStage, _pcCompletedAt: string | null): OutlineRow[] {
  return []
}

export function SectionOutline(_props: SectionOutlineProps) {
  return <nav aria-label="Section outline" data-vb-section-outline /> // PR2 renders rows from buildOutlineRows
}
```

```tsx
// InspectorPanes.tsx
'use client'
import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'

export interface InspectorPanesProps { viewbookId: number; operatorData: OperatorViewbookData }

export function InspectorPanes(_props: InspectorPanesProps) {
  return <div role="region" aria-label="Section editors" data-vb-inspector-panes /> // PR3 mounts all section panes
}
```

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `feat(viewbook): outline data seam + panes placeholder (PR1)`

---

### Task 5: OperatorInspector shell (Codex fix #7, #8)

**Files:** Create `inspector/OperatorInspector.tsx`, `inspector/index.ts` + `inspector/OperatorInspector.test.tsx`

**Interface produced:** `OperatorInspectorProps`. Passes REAL `operatorData`/`stage`/`pcCompletedAt` to `SectionOutline`; REAL `operatorData` to `InspectorPanes`. Dock: `hidden lg:fixed lg:block` (no inline height — a below-`lg` inline height would create an empty viewport-tall block); `top` from the published offset; `lg:bottom-0` gives the height.

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { OperatorInspector } from './OperatorInspector'
import { SelectionProvider } from './SelectionContext'
import { SectionActivityProvider } from './useSectionActivity'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const od: any = { theme: DEFAULT_THEME, sections: [], fields: [], milestones: [], docs: { global: [], own: [] }, welcomeNote: null, dataLockedAt: null, dataLockedBy: null, pcCompletedAt: null, clientNotifyEmails: [], teamMembers: [] }

it('composes a complementary dock with outline + panes; not fixed below lg', () => {
  const { container } = render(
    <SelectionProvider><SectionActivityProvider>
      <OperatorInspector viewbookId={1} operatorData={od} pcCompletedAt={null} stage={'kickoff' as any} />
    </SectionActivityProvider></SelectionProvider>,
  )
  expect(screen.getByRole('complementary', { name: /viewbook editing inspector/i })).toBeTruthy()
  expect(screen.getByRole('navigation', { name: /section outline/i })).toBeTruthy()
  expect(screen.getByRole('region', { name: /section editors/i })).toBeTruthy()
  const aside = container.querySelector('[data-vb-inspector]') as HTMLElement
  expect(aside.className.includes('hidden')).toBe(true)      // hidden below lg (no empty block)
  expect(aside.className.includes('lg:fixed')).toBe(true)
})
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement**

```tsx
'use client'

import type { OperatorViewbookData } from '@/lib/viewbook/operator-data'
import type { ViewbookStage } from '@/lib/viewbook/stages'
import { InspectorPanes } from './InspectorPanes'
import { SectionOutline } from './SectionOutline'

export interface OperatorInspectorProps {
  viewbookId: number
  operatorData: OperatorViewbookData
  pcCompletedAt: string | null
  stage: ViewbookStage
}

// PR5 adds the mobile bottom sheet, collapse/expand, and canvas-fit toggle.
// PR1: a desktop-only rail (hidden below lg — no inline height so there is no
// empty viewport block on mobile), docked below the published sticky offset.
export function OperatorInspector({ viewbookId, operatorData, pcCompletedAt, stage }: OperatorInspectorProps) {
  return (
    <aside
      aria-label="Viewbook editing inspector"
      data-vb-inspector
      style={{ top: 'var(--vb-sticky-offset, 0px)' }}
      className="hidden font-body lg:fixed lg:right-0 lg:bottom-0 lg:z-40 lg:block lg:w-96 lg:overflow-y-auto lg:border-l lg:border-gray-200 lg:bg-white/95 lg:backdrop-blur-md lg:dark:border-navy-border lg:dark:bg-navy-deep/95"
    >
      <SectionOutline operatorData={operatorData} stage={stage} pcCompletedAt={pcCompletedAt} viewbookId={viewbookId} />
      <InspectorPanes viewbookId={viewbookId} operatorData={operatorData} />
    </aside>
  )
}
```

```ts
// inspector/index.ts
export * from './SelectionContext'
export * from './useSectionActivity'
export * from './useSectionSelection'
export * from './SectionOutline'
export * from './InspectorPanes'
export * from './OperatorInspector'
```

- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `feat(viewbook): Context Lens inspector shell (PR1)`

---

### Task 6: StickyOffsetProbe dual-scope publish (Codex fix #1 spec / #9 test)

**Files:** Modify `components/viewbook/public/StickyOffsetProbe.tsx:48-56` + add a case to its test.

- [ ] **Step 1: Failing test — clear all three props on BOTH roots first, mock a real height, assert the exact sum on both targets.**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { StickyOffsetProbe } from './StickyOffsetProbe'

const PROPS = ['--vb-progress-nav-height', '--vb-operator-bar-height', '--vb-sticky-offset']
afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  for (const p of PROPS) document.documentElement.style.removeProperty(p)
})

it('publishes the sticky offset to BOTH the theme root and documentElement', () => {
  document.body.innerHTML = '<div data-vb-theme-root><div id="vb-progress-nav"></div></div>'
  const nav = document.getElementById('vb-progress-nav')!
  vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({ height: 40 } as DOMRect)
  const themeRoot = document.querySelector('[data-vb-theme-root]') as HTMLElement
  for (const p of PROPS) { document.documentElement.style.removeProperty(p); themeRoot.style.removeProperty(p) }

  render(<StickyOffsetProbe />)

  expect(document.documentElement.style.getPropertyValue('--vb-sticky-offset')).toBe('40px')
  expect(themeRoot.style.getPropertyValue('--vb-sticky-offset')).toBe('40px')
})
```

- [ ] **Step 2: Run → fails** (today only the resolved root — the theme root — is written; `documentElement` stays empty).

- [ ] **Step 3: Implement** — replace the `recompute()` body to publish to a deduped set of both targets:

```tsx
    function recompute() {
      const navEl = document.getElementById(PROGRESS_NAV_ID)
      const navHeight = measuredHeight(navEl)
      const operatorHeight = measuredHeight(operatorEl)
      const sticky = navHeight + operatorHeight
      // Publish to BOTH the nearest theme root (existing SectionReveal/SectionShell
      // consumers) AND document.documentElement, so operator chrome mounted OUTSIDE
      // the theme root (the Context Lens inspector) inherits the offset. CSS vars
      // resolve once — the theme root simply overrides the inherited doc-root value,
      // never double-applied.
      const targets = new Set<HTMLElement>([resolveThemeRoot(), document.documentElement])
      for (const root of targets) {
        root.style.setProperty('--vb-progress-nav-height', `${navHeight}px`)
        root.style.setProperty('--vb-operator-bar-height', `${operatorHeight}px`)
        root.style.setProperty('--vb-sticky-offset', `${sticky}px`)
      }
    }
```

Also update the file header comment (lines 8-16) to say the vars are published to both the nearest `[data-vb-theme-root]` and `document.documentElement`.

- [ ] **Step 4: Run → passes; re-run the existing probe tests — all green.**
- [ ] **Step 5: Commit** — `feat(viewbook): publish sticky offset to documentElement for the inspector (PR1)`

---

### Task 7: Wire providers + inspector into OperatorViewbookLayer (Codex fix #8, #11)

**Files:** Modify `OperatorViewbookLayer.tsx`; extend `OperatorViewbookLayer.test.tsx`; extend the anonymous `OPERATOR_MARKERS` in `app/(public)/viewbook/[token]/page.test.tsx:39-44`.

- [ ] **Step 1: Failing tests** (harness is `renderLayer()`; presentation ON via `stored = 'true'`)

Add to `OperatorViewbookLayer.test.tsx`:

```tsx
it('renders the inspector rail in edit mode', async () => {
  const { container } = renderLayer()
  await screen.findByText('ER editing')
  expect(container.querySelector('[data-vb-inspector]')).toBeTruthy()
})

it('renders NO inspector while presenting, but the providers still wrap children', async () => {
  stored = 'true'
  const { container } = renderLayer()
  await screen.findByRole('button', { name: 'Return to editing' })
  expect(container.querySelector('[data-vb-inspector]')).toBeNull()
})
```

Provider-availability probe (proves providers are OUTSIDE the gate — inspector-absence alone doesn't prove it). Add a dedicated test rendering the layer with a probe child that reads `useSelectionContext()` and flips selection on click; assert it works even with `stored='true'`:

```tsx
import { SelectionProvider as _SP } from './inspector' // for type only; probe uses the real context via children
function SelectionProbe() {
  const s = useSelectionContext()
  return <button onClick={() => s.select('brand', 'manual-nav')} data-testid="probe">{s.selectedKey ?? 'none'}</button>
}
it('providers remain available to children while presenting', async () => {
  stored = 'true'
  render(
    <OperatorViewbookLayer viewbookId={22} operatorEmail="o@e.com" stage="kickoff" pcCompletedAt={null} operatorData={operatorData}>
      <SelectionProbe />
    </OperatorViewbookLayer>,
  )
  const probe = await screen.findByTestId('probe')
  expect(probe.textContent).toBe('none')
  act(() => probe.click())
  expect(probe.textContent).toBe('brand') // real provider present despite presentation mode
})
```
(Add `import { useSelectionContext } from './inspector'` and `act` to the test imports.)

Extend `OPERATOR_MARKERS` in `page.test.tsx`:
```tsx
  'data-operator-inline-editor',
  'data-vb-inspector',
  'data-vb-section-outline',
  'data-vb-inspector-panes',
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** — providers OUTSIDE the visual gate; inspector rendered AFTER the bar but BEFORE `children` (keyboard order, fix #8):

```tsx
import { OperatorInspector, SelectionProvider } from './inspector'
import { SectionActivityProvider } from './inspector'
// ...
function OperatorViewbookLayerContent({ viewbookId, operatorEmail, stage, pcCompletedAt, operatorData, children }: OperatorViewbookLayerProps) {
  const { initialized, presenting } = usePresentationMode()
  return (
    <SelectionProvider>
      <SectionActivityProvider>
        {!initialized || presenting ? (
          <>
            {children}
            <PresentationToggle />
          </>
        ) : (
          <div data-operator-viewbook-layer>
            <OperatorBar viewbookId={viewbookId} operatorEmail={operatorEmail} stage={stage} pcCompletedAt={pcCompletedAt} />
            <HiddenSectionsList viewbookId={viewbookId} operatorData={operatorData} pcCompletedAt={pcCompletedAt} />
            <OperatorInspector viewbookId={viewbookId} operatorData={operatorData} pcCompletedAt={pcCompletedAt} stage={stage} />
            {children}
          </div>
        )}
      </SectionActivityProvider>
    </SelectionProvider>
  )
}
```

`HiddenSectionsList` + the inline motion stay for now (PR3 relocates editors; PR4 retires `HiddenSectionsList`). The inspector is `hidden lg:fixed` so it does not shift the canvas on mobile.

- [ ] **Step 4: Run → passes,** especially `page.test.tsx` anonymous guard (the new `data-vb-*` markers must be absent — they only render inside `OperatorViewbookLayerContent`, never the anonymous branch).
- [ ] **Step 5: Commit** — `feat(viewbook): mount Context Lens providers + inspector behind the gate (PR1)`

---

### Task 8: Gate + anonymous-guard + manual verification

- [ ] **Step 1:** `npx tsc --noEmit` — clean.
- [ ] **Step 2:** `npx vitest run "components/viewbook/public/OperatorLayer" "app/(public)/viewbook"` — all green (incl. the extended anonymous guard).
- [ ] **Step 3:** Manual (`/verify`): open an operator viewbook — empty inspector rail docks below the bar on desktop, NOT present on mobile, and Preview-as-client shows the bare tree with no inspector.
- [ ] **Step 4:** Open the PR for `feat/vb-lens-pr1`. This freezes the contracts and unblocks PR2 ∥ PR3 ∥ PR5.

---

## Self-review

- Frozen interfaces (program §Interface freeze, post-fix) all created: `SelectionState` w/ observe+scoped release+pinnedKind+selectedGroup (Task 1), `SectionActivityApi` w/ remove+version + `useReportSectionActivity` (Task 2), scroll-spy (Task 3), `buildOutlineRows`+`SectionOutlineProps`+`InspectorPanesProps` seam (Task 4), `OperatorInspectorProps` (Task 5). ✓
- Codex plan-review fixes: #1 pin machine (T1), #2 bridge (T2), #3 reactive+remove (T2), #4 visible-pixel+authoritative guard (T3), #5 stable observer dep (T3), #6/#7 interfaces+seam (T4/T5), #8 dock layout + DOM order (T5/T7), #9 fail-first probe test (T6), #10 vitest conventions (all tests), #11 real harness + provider probe + anon markers (T7). ✓
- C1/C2/C3 enforced (T7/T6). No behavior change to existing editors (untouched in PR1). ✓
