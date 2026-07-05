# C9-B — ADA-Audit Frontend Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the genuine remaining duplication in the ADA-audit UI (two pollers, an inline 172-LOC `PageRow`, and duplicated triage-localStorage + archived-banner logic) with ZERO behavior change.

**Architecture:** Extract a generic callback-only `useAuditPoller<T>` loop hook both pollers wire onto; move `PageRow` to its own file; extract `useTriageMode` hook + `ArchivedAuditBanner` component shared by the single-page and site result views. Existing view/contract tests are the guardrail and must stay green unchanged.

**Tech Stack:** Next.js 15 App Router, React client components, TypeScript, Tailwind (class-based dark mode), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-04-ada-frontend-consolidation-design.md` (Codex-reviewed, ACCEPT-WITH-FIXES).

## Global Constraints

- **Near-zero-behavior-change.** No visible/DOM change when props are held constant; dark-mode variants, copy, layout identical. The two big view tests (`SiteAuditResultsView.test.tsx`, `AuditResultsView.test.tsx`) and `useSiteAuditPages.test.ts` MUST stay green **without edits**.
- **Poll cadences unchanged:** `AuditPoller` 1000 ms; `SiteAuditPoller` 3000 ms.
- **`shareMode` ≠ `readOnly`** — do not normalize or cross-wire (site view uses `shareMode`; single view uses `readOnly`).
- **No migration**, no schema change. Deploy is plain `~/deploy.sh`.
- **Gate commands** (local dev prefixes the DB URL): 
  - `npm run lint` (= `tsc --noEmit`)
  - `DATABASE_URL="file:./local-dev.db" npm test`
  - `NODE_OPTIONS='--max-old-space-size=3072' npm run build`
- **React test files** need `// @vitest-environment jsdom` at the top and `afterEach(cleanup)`.
- **Never `git add -A`** — untracked `pentest-results/`, `googlefc472dc61896519a.html`, `SEO_Report_1st_Draft.pdf` are not gitignored. Add explicit paths only.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY
  ```

---

### Task 1: `useAuditPoller<T>` hook + tests

**Files:**
- Create: `components/ada-audit/useAuditPoller.ts`
- Test: `components/ada-audit/useAuditPoller.test.ts`

**Interfaces:**
- Consumes: `useRouter` from `next/navigation`.
- Produces:
  ```ts
  export interface UseAuditPollerArgs<T> {
    url: string
    intervalMs: number
    initialStatus: string
    enabled?: boolean
    getStatus: (data: T) => string
    isTerminal: (status: string) => boolean
    onData: (data: T) => void
    onTerminal?: (data: T) => void
  }
  export function useAuditPoller<T>(args: UseAuditPollerArgs<T>): void
  ```

- [ ] **Step 1: Write the failing test**

Create `components/ada-audit/useAuditPoller.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuditPoller } from './useAuditPoller'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

type Poll = { status: string }

// A fetch mock whose responses you resolve manually via the returned queue.
function makeFetch() {
  const pending: Array<(v: { ok: boolean; body?: unknown }) => void> = []
  const fn = vi.fn(() =>
    new Promise((resolve) => {
      pending.push((v) =>
        resolve({ ok: v.ok, json: async () => v.body } as Response),
      )
    }),
  )
  return {
    fn,
    // resolve the Nth outstanding fetch (FIFO)
    resolveNext(v: { ok: boolean; body?: unknown }) {
      const p = pending.shift()
      if (!p) throw new Error('no pending fetch')
      p(v)
    },
    pendingCount: () => pending.length,
  }
}

const args = (over: Partial<Parameters<typeof useAuditPoller>[0]>) => ({
  url: '/api/x',
  intervalMs: 1000,
  initialStatus: 'running',
  getStatus: (d: Poll) => d.status,
  isTerminal: (s: string) => s === 'complete' || s === 'error',
  onData: vi.fn(),
  ...over,
})

describe('useAuditPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    refresh.mockClear()
  })
  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('terminal-on-mount does nothing (no fetch, no refresh)', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onData = vi.fn()
    renderHook(() => useAuditPoller(args({ initialStatus: 'complete', onData })))
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.fn).not.toHaveBeenCalled()
    expect(onData).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('enabled:false does nothing', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    renderHook(() => useAuditPoller(args({ enabled: false })))
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.fn).not.toHaveBeenCalled()
  })

  it('polls on interval and calls onData; no refresh while non-terminal', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onData = vi.fn()
    renderHook(() => useAuditPoller(args({ onData })))
    await vi.advanceTimersByTimeAsync(1000)
    f.resolveNext({ ok: true, body: { status: 'running' } })
    await Promise.resolve()
    expect(onData).toHaveBeenCalledWith({ status: 'running' })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('terminal response calls onData then onTerminal then one refresh', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onData = vi.fn()
    const onTerminal = vi.fn()
    renderHook(() => useAuditPoller(args({ onData, onTerminal })))
    await vi.advanceTimersByTimeAsync(1000)
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await Promise.resolve(); await Promise.resolve()
    expect(onData).toHaveBeenCalledWith({ status: 'complete' })
    expect(onTerminal).toHaveBeenCalledWith({ status: 'complete' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('two overlapping terminal responses refresh once', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    renderHook(() => useAuditPoller(args({})))
    await vi.advanceTimersByTimeAsync(1000)   // fetch #1 in flight
    await vi.advanceTimersByTimeAsync(1000)   // fetch #2 in flight (no inFlight guard)
    expect(f.pendingCount()).toBe(2)
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await Promise.resolve(); await Promise.resolve()
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await Promise.resolve(); await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('unmount before fetch resolves calls neither onData nor refresh', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    const onData = vi.fn()
    const { unmount } = renderHook(() => useAuditPoller(args({ onData })))
    await vi.advanceTimersByTimeAsync(1000)
    unmount()
    f.resolveNext({ ok: true, body: { status: 'complete' } })
    await Promise.resolve(); await Promise.resolve()
    expect(onData).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('non-OK and thrown fetch keep polling (no refresh)', async () => {
    const f = makeFetch()
    global.fetch = f.fn as unknown as typeof fetch
    renderHook(() => useAuditPoller(args({})))
    await vi.advanceTimersByTimeAsync(1000)
    f.resolveNext({ ok: false })
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.fn).toHaveBeenCalledTimes(2)
    expect(refresh).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/useAuditPoller.test.ts`
Expected: FAIL — `useAuditPoller` not found / module missing.

- [ ] **Step 3: Write minimal implementation**

Create `components/ada-audit/useAuditPoller.ts`:

```ts
'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

export interface UseAuditPollerArgs<T> {
  /** Endpoint to poll. */
  url: string
  /** Poll cadence in ms (1000 single / 3000 site). */
  intervalMs: number
  /** SSR status; if already terminal the hook is inert (no fetch, no refresh). */
  initialStatus: string
  /** Defaults true; false → hook is inert. */
  enabled?: boolean
  getStatus: (data: T) => string
  isTerminal: (status: string) => boolean
  onData: (data: T) => void
  /** Called once, on the terminal poll, before router.refresh(). */
  onTerminal?: (data: T) => void
}

/**
 * Generic interval-poll loop for audit progress. Callback-only: it drives the
 * loop and does not own poller-specific UI state. Callbacks are stored in refs
 * so inline caller closures don't restart the interval; the effect depends only
 * on [url, intervalMs, enabled, initialStatus, router].
 *
 * Behavior-preserving (C9-B): no inFlight overlap guard (matches the naive
 * setInterval the two pollers used). Guarantees: stale in-flight work after
 * unmount is ignored; router.refresh() fires exactly once per instance.
 */
export function useAuditPoller<T>({
  url,
  intervalMs,
  initialStatus,
  enabled = true,
  getStatus,
  isTerminal,
  onData,
  onTerminal,
}: UseAuditPollerArgs<T>): void {
  const router = useRouter()

  const getStatusRef = useRef(getStatus)
  const isTerminalRef = useRef(isTerminal)
  const onDataRef = useRef(onData)
  const onTerminalRef = useRef(onTerminal)
  getStatusRef.current = getStatus
  isTerminalRef.current = isTerminal
  onDataRef.current = onData
  onTerminalRef.current = onTerminal

  const refreshedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    if (isTerminalRef.current(initialStatus)) return

    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) return
        const data: T = await res.json()
        if (cancelled) return
        onDataRef.current(data)
        if (isTerminalRef.current(getStatusRef.current(data))) {
          clearInterval(timer)
          if (!refreshedRef.current) {
            refreshedRef.current = true
            onTerminalRef.current?.(data)
            router.refresh()
          }
        }
      } catch {
        // network blip — keep polling
      }
    }, intervalMs)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [url, intervalMs, enabled, initialStatus, router])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/useAuditPoller.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/useAuditPoller.ts components/ada-audit/useAuditPoller.test.ts
git commit -m "feat(c9b): generic useAuditPoller<T> loop hook + tests"
```

---

### Task 2: Refactor `AuditPoller` onto the hook

**Files:**
- Modify: `components/ada-audit/AuditPoller.tsx`

**Interfaces:**
- Consumes: `useAuditPoller<AuditDetail>` from Task 1.
- Produces: no new exports; `AuditPoller` default export unchanged in signature.

**Preservation notes:**
- Keep the elapsed-counter `useEffect` EXACTLY as today — **unconditional** (no terminal guard). On terminal-on-mount the current code lets the elapsed timer tick (the poll effect early-returns without clearing the tick); preserve that.
- Wire `onTerminal` to clear the elapsed `tickRef` (the current code clears both `pollRef` and `tickRef` on terminal — `AuditPoller.tsx:63-64`).
- Cadence stays 1000 ms. `isTerminal = complete|error|redirected`.

- [ ] **Step 1: Replace the two polling effects with the hook**

In `components/ada-audit/AuditPoller.tsx`:

1. Update imports (drop nothing needed; add the hook):
```tsx
import { useState, useEffect, useRef, useMemo } from 'react'
import type { AuditDetail } from '@/lib/ada-audit/types'
import { useAuditPoller } from './useAuditPoller'
```
(Remove the `import { useRouter } from 'next/navigation'` line — the hook owns `router` now.)

2. In the component body, remove `const router = useRouter()` and remove `pollRef`. Keep `startRef` and `tickRef`. Add the terminal predicate. Replace the **poll** `useEffect` (the `pollRef` interval, currently lines ~49-73) with a `useAuditPoller` call. Keep the **elapsed** `useEffect` (lines ~39-46) verbatim.

Resulting top of the component (state + effects):
```tsx
  const [progress, setProgress] = useState(initialProgress)
  const [message, setMessage] = useState(initialProgressMessage || 'Starting…')
  const [status, setStatus] = useState(initialStatus)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(new Date(createdAt).getTime())
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isTerminal = (s: string) =>
    s === 'complete' || s === 'error' || s === 'redirected'

  // Live elapsed counter — ticks every second (unchanged)
  useEffect(() => {
    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }
    updateElapsed()
    tickRef.current = setInterval(updateElapsed, 1000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [])

  useAuditPoller<AuditDetail>({
    url: `/api/ada-audit/${id}`,
    intervalMs: 1000,
    initialStatus,
    getStatus: (d) => d.status,
    isTerminal,
    onData: (d) => {
      setProgress(d.progress ?? 0)
      setMessage(d.progressMessage || 'Running…')
      setStatus(d.status)
    },
    onTerminal: () => { if (tickRef.current) clearInterval(tickRef.current) },
  })
```
Leave `estimatedRemaining` (`useMemo`) and the entire JSX return unchanged. `status` is still read by the `estimatedRemaining`/JSX exactly as before.

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: PASS (no unused `useRouter`, no type errors). If `status` is flagged unused, it is still consumed by JSX — verify it is.

- [ ] **Step 3: Run the poller + adjacent tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/useAuditPoller.test.ts components/ada-audit/AuditResultsView.test.tsx`
Expected: PASS (no regressions; AuditPoller has no direct test, `useAuditPoller` covers the loop).

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/AuditPoller.tsx
git commit -m "refactor(c9b): AuditPoller uses useAuditPoller; elapsed timer stays local"
```

---

### Task 3: Refactor `SiteAuditPoller` onto the hook

**Files:**
- Modify: `components/ada-audit/SiteAuditPoller.tsx`

**Interfaces:**
- Consumes: `useAuditPoller<PollData>` from Task 1 (`PollData` is the interface already defined at the top of `SiteAuditPoller.tsx`).

**Preservation notes:**
- Cadence stays 3000 ms. `isTerminal = complete|error|cancelled`.
- No elapsed timer here, so no `onTerminal`.
- All counter/queue/liveChildren setters move verbatim into `onData`. JSX + derivations + `LiveAuditTable` unchanged.

- [ ] **Step 1: Replace the polling effect with the hook**

In `components/ada-audit/SiteAuditPoller.tsx`:

1. Imports:
```tsx
import { useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { LiveAuditChild } from '@/lib/ada-audit/types'
import LiveAuditTable from './LiveAuditTable'
import { useAuditPoller } from './useAuditPoller'
```
(Remove `useEffect`, `useRef` from the react import and remove `import { useRouter } from 'next/navigation'`.)

2. Remove `const router = useRouter()` and `const timerRef = ...`. Replace the poll `useEffect` (currently ~64-98) with:
```tsx
  useAuditPoller<PollData>({
    url: `/api/site-audit/${id}`,
    intervalMs: 3000,
    initialStatus,
    getStatus: (d) => d.status,
    isTerminal: (s) => s === 'complete' || s === 'error' || s === 'cancelled',
    onData: (data) => {
      setPagesTotal(data.pagesTotal)
      setPagesComplete(data.pagesComplete)
      setPagesError(data.pagesError)
      setPdfsTotal(data.pdfsTotal ?? 0)
      setPdfsComplete(data.pdfsComplete ?? 0)
      setPdfsError(data.pdfsError ?? 0)
      setPdfsSkipped(data.pdfsSkipped ?? 0)
      setLighthouseTotal(data.lighthouseTotal ?? 0)
      setLighthouseComplete(data.lighthouseComplete ?? 0)
      setLighthouseError(data.lighthouseError ?? 0)
      setStatus(data.status)
      setQueuePosition(data.queuePosition)
      setActiveAudit(data.activeAudit)
      setLiveChildren(data.liveChildren ?? [])
    },
  })
```
Leave all `useState` declarations, the derived values (`scanned`, `progress`, `discovering`, `isQueued`, etc.), and the entire JSX unchanged.

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: PASS (no unused `useEffect`/`useRef`/`useRouter`).

- [ ] **Step 3: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/`
Expected: PASS (whole ada-audit suite; SiteAuditResultsView + AuditResultsView contract tests green).

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/SiteAuditPoller.tsx
git commit -m "refactor(c9b): SiteAuditPoller uses useAuditPoller"
```

---

### Task 4: `useTriageMode` hook + tests

**Files:**
- Create: `components/ada-audit/useTriageMode.ts`
- Test: `components/ada-audit/useTriageMode.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function useTriageMode(
    id: string | undefined,
    opts?: { enabled?: boolean },
  ): { triageMode: boolean; toggleTriage: () => void }
  ```

**Preservation notes:** read fires when `id` truthy AND `enabled` (default true); write on toggle when `id` truthy. localStorage access is try/catch-guarded (SSR / missing global → no throw). The hook knows nothing of `shareMode`/`readOnly`; callers pass `enabled`.

- [ ] **Step 1: Write the failing test**

Create `components/ada-audit/useTriageMode.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, act, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useTriageMode } from './useTriageMode'

function memStore(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    _map: m,
  }
}

describe('useTriageMode', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('reads seeded localStorage when id present and enabled', () => {
    ;(globalThis as any).localStorage = memStore({ 'er-triage-mode:a1': '1' })
    const { result } = renderHook(() => useTriageMode('a1'))
    expect(result.current.triageMode).toBe(true)
  })

  it('does not read when enabled:false', () => {
    ;(globalThis as any).localStorage = memStore({ 'er-triage-mode:a1': '1' })
    const { result } = renderHook(() => useTriageMode('a1', { enabled: false }))
    expect(result.current.triageMode).toBe(false)
  })

  it('toggle flips state and writes localStorage', () => {
    const store = memStore()
    ;(globalThis as any).localStorage = store
    const { result } = renderHook(() => useTriageMode('a1'))
    act(() => result.current.toggleTriage())
    expect(result.current.triageMode).toBe(true)
    expect(store._map.get('er-triage-mode:a1')).toBe('1')
    act(() => result.current.toggleTriage())
    expect(result.current.triageMode).toBe(false)
    expect(store._map.get('er-triage-mode:a1')).toBe('0')
  })

  it('missing id: no read, no write, no throw', () => {
    const store = memStore({ 'er-triage-mode:undefined': '1' })
    ;(globalThis as any).localStorage = store
    const { result } = renderHook(() => useTriageMode(undefined))
    expect(result.current.triageMode).toBe(false)
    act(() => result.current.toggleTriage())
    expect(store._map.has('er-triage-mode:undefined')).toBe(false)
  })

  it('no localStorage global: does not throw', () => {
    delete (globalThis as any).localStorage
    expect(() => {
      const { result } = renderHook(() => useTriageMode('a1'))
      act(() => result.current.toggleTriage())
    }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/useTriageMode.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `components/ada-audit/useTriageMode.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'

/**
 * Shared triage-mode toggle backed by localStorage, keyed `er-triage-mode:${id}`.
 * Read fires when `id` is truthy AND `enabled` (default true); write on toggle
 * when `id` is truthy. localStorage access is guarded so SSR / missing global
 * never throws. The hook is agnostic to shareMode/readOnly — callers pass
 * `enabled` (site view: `!shareMode`; single view: unconditional, matching
 * AuditResultsView's current behavior).
 */
export function useTriageMode(
  id: string | undefined,
  opts?: { enabled?: boolean },
): { triageMode: boolean; toggleTriage: () => void } {
  const enabled = opts?.enabled ?? true
  const [triageMode, setTriageMode] = useState(false)

  useEffect(() => {
    if (!id || !enabled) return
    try {
      if (localStorage.getItem(`er-triage-mode:${id}`) === '1') setTriageMode(true)
    } catch {
      // no localStorage (SSR / test) — leave default
    }
  }, [id, enabled])

  const toggleTriage = () => {
    setTriageMode((prev) => {
      const next = !prev
      if (id) {
        try {
          localStorage.setItem(`er-triage-mode:${id}`, next ? '1' : '0')
        } catch {
          // ignore write failure
        }
      }
      return next
    })
  }

  return { triageMode, toggleTriage }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/useTriageMode.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/useTriageMode.ts components/ada-audit/useTriageMode.test.ts
git commit -m "feat(c9b): useTriageMode hook (localStorage-backed) + tests"
```

---

### Task 5: `ArchivedAuditBanner` component + test

**Files:**
- Create: `components/ada-audit/ArchivedAuditBanner.tsx`
- Test: `components/ada-audit/ArchivedAuditBanner.test.tsx`

**Interfaces:**
- Produces: `export function ArchivedAuditBanner({ variant }: { variant: 'page' | 'site' }): JSX.Element`

**Preservation notes:** the two copies DIFFER (verified). `variant='page'` must render the single-page string; `variant='site'` the site string. Wrapper markup (amber/flex classes) is identical to both current inline banners.

- [ ] **Step 1: Write the failing test**

Create `components/ada-audit/ArchivedAuditBanner.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { ArchivedAuditBanner } from './ArchivedAuditBanner'

describe('ArchivedAuditBanner', () => {
  afterEach(cleanup)

  it('page variant renders the single-page copy', () => {
    render(<ArchivedAuditBanner variant="page" />)
    expect(screen.getByText(/Archived audit:/)).toBeTruthy()
    expect(
      screen.getByText(/screenshots, complete code snippets/),
    ).toBeTruthy()
  })

  it('site variant renders the per-page copy', () => {
    render(<ArchivedAuditBanner variant="site" />)
    expect(screen.getByText(/full per-page detail was pruned/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/ArchivedAuditBanner.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `components/ada-audit/ArchivedAuditBanner.tsx`:

```tsx
/**
 * Amber "archived audit" banner shared by the single-page and site result
 * views. Copy differs by surface (verified against the two former inline
 * banners) so the exact strings are preserved per `variant`.
 */
export function ArchivedAuditBanner({ variant }: { variant: 'page' | 'site' }) {
  return (
    <div className="flex gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl text-[12px] font-body text-amber-800 dark:text-amber-400 leading-relaxed">
      <span>
        <strong>Archived audit:</strong>{' '}
        {variant === 'page'
          ? 'full detail (screenshots, complete code snippets, pass/incomplete lists) was pruned after 90 days. Violations shown are exact; node samples are capped at 5 per rule.'
          : 'full per-page detail was pruned after 90 days. Violations shown are exact; node samples are capped at 5 per rule.'}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/ArchivedAuditBanner.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/ArchivedAuditBanner.tsx components/ada-audit/ArchivedAuditBanner.test.tsx
git commit -m "feat(c9b): ArchivedAuditBanner shared component (page|site variants) + test"
```

---

### Task 6: `AuditResultsView` uses `useTriageMode` + `ArchivedAuditBanner`

**Files:**
- Modify: `components/ada-audit/AuditResultsView.tsx`
- Test: `components/ada-audit/AuditResultsView.test.tsx` (ADD one case; do NOT alter existing cases)

**Interfaces:**
- Consumes: `useTriageMode` (Task 4), `ArchivedAuditBanner` (Task 5).

**Preservation notes:** current localStorage read is unconditional (not `readOnly`/`archived`-gated) — pass `useTriageMode(auditId)` (enabled default true) to preserve exactly. Archived suppression stays at the consumer (button `!readOnly && !results.archived`, `useChecks` `!results.archived`, `checksContext` `!results.archived`) — do NOT move it into the hook.

- [ ] **Step 1: Add the imports**

In `components/ada-audit/AuditResultsView.tsx`, add:
```tsx
import { useTriageMode } from './useTriageMode'
import { ArchivedAuditBanner } from './ArchivedAuditBanner'
```
Remove `useEffect` from the react import if it becomes unused after this task (verify — `AuditResultsView` has no other `useEffect`). Keep `useState`? It becomes unused (the triage state moves to the hook) — remove `useState` too if nothing else uses it (verify via `npm run lint`).

- [ ] **Step 2: Replace the triage state + effect + handler with the hook**

Delete the current block (lines ~61-75):
```tsx
  const [triageMode, setTriageMode] = useState(false)
  useEffect(() => {
    if (!auditId) return
    const stored = localStorage.getItem(`er-triage-mode:${auditId}`)
    if (stored === '1') setTriageMode(true)
  }, [auditId])
  const onToggleTriage = () => {
    setTriageMode((prev) => {
      const next = !prev
      if (auditId) localStorage.setItem(`er-triage-mode:${auditId}`, next ? '1' : '0')
      return next
    })
  }
```
Replace with:
```tsx
  const { triageMode, toggleTriage } = useTriageMode(auditId)
```
Then update the toggle button's handler (currently `onClick={onToggleTriage}`, line ~151) to `onClick={toggleTriage}`.

- [ ] **Step 3: Replace the inline archived banner**

Replace the current block (lines ~100-108):
```tsx
      {results.archived && (
        <div className="flex gap-3 ...amber...">
          <span><strong>Archived audit:</strong> full detail ...</span>
        </div>
      )}
```
with:
```tsx
      {results.archived && <ArchivedAuditBanner variant="page" />}
```
Leave `checks`, `displayChecks`, the header, scorecard, and everything else unchanged.

- [ ] **Step 4: Add the no-localStorage no-throw test case**

Append to `components/ada-audit/AuditResultsView.test.tsx` (inside the existing top-level `describe`, or a new `describe('localStorage resilience')`), WITHOUT modifying existing cases:

```tsx
  it('renders read-only without a localStorage global and does not throw', () => {
    const saved = (globalThis as any).localStorage
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage
    try {
      expect(() =>
        render(
          <AuditResultsView
            results={{ violations: [], passes: [], incomplete: [] } as any}
            url="https://example.com"
            clientName={null}
            createdAt={new Date(0).toISOString()}
            auditId="a1"
            readOnly
          />,
        ),
      ).not.toThrow()
    } finally {
      ;(globalThis as any).localStorage = saved
    }
  })
```
(Match the existing file's import of `AuditResultsView`, `render`, and the `StoredAxeResults` shape it already uses for archived/live cases — reuse its established fixture/casting pattern rather than the minimal `as any` above if the file provides a helper.)

- [ ] **Step 5: Typecheck + run the view tests**

Run: `npm run lint && DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/AuditResultsView.test.tsx`
Expected: PASS — all pre-existing cases green + the new no-throw case. If `useState`/`useEffect` are flagged unused, remove them from the import.

- [ ] **Step 6: Commit**

```bash
git add components/ada-audit/AuditResultsView.tsx components/ada-audit/AuditResultsView.test.tsx
git commit -m "refactor(c9b): AuditResultsView uses useTriageMode + ArchivedAuditBanner"
```

---

### Task 7: Extract `PageRow` to its own file

**Files:**
- Create: `components/ada-audit/PageRow.tsx`
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`

**Interfaces:**
- Produces: `export default function PageRow(props: PageRowProps)` where
  ```ts
  interface PageRowProps {
    page: SitePageResult
    triageMode: boolean
    readOnly: boolean
    checks: UseChecksReturn
    shareMode: boolean
  }
  ```
- `SiteAuditResultsView` consumes it via `import PageRow from './PageRow'`.

**Preservation notes:** PURE MOVE. Move the `PageRow` function (`SiteAuditResultsView.tsx:56-219`) AND the `ImpactCount` helper (`:43-46`, used only inside `PageRow`) verbatim into `PageRow.tsx`. Preserve the "no fetch in shareMode" contract (the `shareMode` guards at the key `useEffect` and `handleExpand` — do not touch them). The `SiteAuditResultsView.test.tsx` shareMode zero-fetch assertions are the guardrail.

- [ ] **Step 1: Create `PageRow.tsx` with the moved code**

Create `components/ada-audit/PageRow.tsx` starting with `'use client'` and the imports the moved code references:
```tsx
'use client'

import { useState, useEffect } from 'react'
import type { SitePageResult, StoredAxeResults } from '@/lib/ada-audit/types'
import AuditIssueTabs from './AuditIssueTabs'
import type { UseChecksReturn } from './useChecks'
import { keyForPage, keyForPageViolation } from '@/lib/ada-audit/checks-keys-browser'
```
Then paste the `ImpactCount` function (from `SiteAuditResultsView.tsx:43-46`), the `PageRowProps` interface (`:48-54`), and the `PageRow` function (`:56-219`) verbatim. Add `export default` to `PageRow` (`export default function PageRow(...)`).

**Import-completeness check:** the moved body may reference additional symbols (e.g. `safeExternalHref` if the row renders the page URL as a link). `npm run lint` in Step 3 will flag any missing import — add it from the same source `SiteAuditResultsView.tsx` imported it (see its import block, lines 1-21). Do not leave `ImpactCount`/`PageRow` behind in the original file.

- [ ] **Step 2: Remove the moved code from `SiteAuditResultsView.tsx` and import PageRow**

In `components/ada-audit/SiteAuditResultsView.tsx`:
- Delete `ImpactCount` (`:43-46`), `PageRowProps` (`:48-54`), and `PageRow` (`:56-219`).
- Add `import PageRow from './PageRow'` to the import block.
- Remove now-unused imports from `SiteAuditResultsView.tsx` that were ONLY used by the moved code (candidates: `keyForPage`, `keyForPageViolation`; possibly `StoredAxeResults`, `AuditIssueTabs`, `UseChecksReturn` — but these may still be used elsewhere in the file; let `npm run lint` decide). Keep the `<PageRow ... />` render call (`:444-451`) exactly as-is.

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: PASS. Resolve any "unused import" (in `SiteAuditResultsView.tsx`) or "missing import" (in `PageRow.tsx`) that tsc reports.

- [ ] **Step 4: Run the site view contract test (zero-fetch guardrail)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditResultsView.test.tsx`
Expected: PASS — including the shareMode "zero cookie-gated fetches" assertions (proves the moved `shareMode` guards survived intact).

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/PageRow.tsx components/ada-audit/SiteAuditResultsView.tsx
git commit -m "refactor(c9b): extract PageRow from SiteAuditResultsView (pure move)"
```

---

### Task 8: `SiteAuditResultsView` uses `useTriageMode` + `ArchivedAuditBanner`

**Files:**
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`
- Test: `components/ada-audit/SiteAuditResultsView.test.tsx` (must stay green UNCHANGED)

**Interfaces:**
- Consumes: `useTriageMode` (Task 4), `ArchivedAuditBanner` (Task 5).

**Preservation notes:** site view gates the read on `!shareMode` — pass `useTriageMode(siteAuditId, { enabled: !shareMode })`. This exactly reproduces the current `:248-252` early-return-in-shareMode. `checks.enabled` stays `triageMode && !shareMode`.

- [ ] **Step 1: Add imports**

In `components/ada-audit/SiteAuditResultsView.tsx`:
```tsx
import { useTriageMode } from './useTriageMode'
import { ArchivedAuditBanner } from './ArchivedAuditBanner'
```

- [ ] **Step 2: Replace the triage state + effect + handler with the hook**

Delete the block (`:246-260`):
```tsx
  const [triageMode, setTriageMode] = useState(false)
  useEffect(() => {
    if (shareMode) return
    const stored = localStorage.getItem(`er-triage-mode:${siteAuditId}`)
    if (stored === '1') setTriageMode(true)
  }, [siteAuditId, shareMode])
  const onToggleTriage = () => {
    setTriageMode((prev) => {
      const next = !prev
      localStorage.setItem(`er-triage-mode:${siteAuditId}`, next ? '1' : '0')
      return next
    })
  }
```
Replace with:
```tsx
  const { triageMode, toggleTriage } = useTriageMode(siteAuditId, { enabled: !shareMode })
```
Update the toggle button handler (`:357` `onClick={onToggleTriage}`) to `onClick={toggleTriage}`.

- [ ] **Step 3: Replace the inline archived banner**

Replace the block (`:319-326`) with:
```tsx
      {summary.archived && <ArchivedAuditBanner variant="site" />}
```

- [ ] **Step 4: Typecheck**

Run: `npm run lint`
Expected: PASS. If `useEffect` is now unused (the pagination-reset `useEffect` at `:289` and the scorecard scroll `useRef` at `:292` still use `useEffect`/`useRef` — verify), keep them. Remove only genuinely-unused imports.

- [ ] **Step 5: Run the site view contract test UNCHANGED**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditResultsView.test.tsx`
Expected: PASS — every pre-existing case (archived-render contract + shareMode zero-fetch) green with NO test edits.

- [ ] **Step 6: Commit**

```bash
git add components/ada-audit/SiteAuditResultsView.tsx
git commit -m "refactor(c9b): SiteAuditResultsView uses useTriageMode + ArchivedAuditBanner"
```

---

### Task 9: Full gate + branch review

**Files:** none (verification only).

- [ ] **Step 1: Full gate**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
NODE_OPTIONS='--max-old-space-size=3072' npm run build
```
Expected: all three green. Test count should be the prior baseline (3125) + the new tests (useAuditPoller ×7, useTriageMode ×5, ArchivedAuditBanner ×2, AuditResultsView +1) with all pre-existing tests unchanged and green.

- [ ] **Step 2: Grep for stragglers**

```bash
grep -rn "er-triage-mode" components/ada-audit/ | grep -v "useTriageMode\|\.test\."
```
Expected: no matches (the only localStorage triage key usage now lives in `useTriageMode.ts`).

```bash
grep -rn "setInterval" components/ada-audit/AuditPoller.tsx components/ada-audit/SiteAuditPoller.tsx | grep -v tickRef
```
Expected: no poll `setInterval` remains in the pollers (only `AuditPoller`'s elapsed `tickRef` interval).

- [ ] **Step 3: Whole-branch code review**

Request a code review (superpowers:requesting-code-review or a review subagent) focused on: behavior preservation (cadences, terminal-on-mount, refresh-once, shareMode/readOnly non-normalization, PageRow no-fetch-in-shareMode), and that no existing test was modified to pass.

- [ ] **Step 4: Open the PR** (per change-control: push branch, `gh pr create`).

---

## Self-Review (author)

- **Spec coverage:** Unit 1 (useAuditPoller) → Tasks 1-3; Unit 2 (PageRow) → Task 7; Unit 3 (useTriageMode + ArchivedAuditBanner) → Tasks 4-6, 8. Behavior-preservation invariants (§6) → preservation notes in each task + Task 9 grep/review. Testing strategy (§7) → Tasks 1, 4, 5, 6 tests + Task 9 gate. All spec sections covered.
- **Placeholder scan:** none — every new file has complete code; refactor tasks give exact line anchors + before/after blocks; extraction task (7) is a pure move with tsc as the import-completeness check (legitimate for a verbatim move).
- **Type consistency:** `UseAuditPollerArgs<T>`, `useTriageMode(id, {enabled})` return `{triageMode, toggleTriage}`, `ArchivedAuditBanner({variant})`, `PageRowProps` — names identical across producing/consuming tasks and match the verified current code.
