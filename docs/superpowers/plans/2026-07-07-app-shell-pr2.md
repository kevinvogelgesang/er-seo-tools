# App-Shell PR 2 — Dashboard v1 (fixed layout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brochure homepage at `app/(app)/page.tsx` with a fixed-layout quick-start dashboard — a widget registry + CSS-grid renderer showing seven verified-data-source widgets at default sizes, so every tool is startable inline and lands the user in its live flow.

**Architecture:** A pure widget model (`lib/widgets/`: types, span-class helper, shared queue poller, registry) drives a client-side `DashboardGrid` that maps a fixed `DEFAULT_LAYOUT` array to registered widget components, each wrapped in a fault-isolating frame. Widgets are thin clients of existing routes — quick-start widgets POST and redirect into live flows; data widgets fetch-and-render with degraded fallbacks. No edit mode, no drag, no persistence, no aggregate widgets (all deferred to PR 3 / PR 3.5).

**Tech Stack:** Next.js 15 App Router, React 19 client components, TypeScript, Tailwind (class-based dark mode), Vitest + @testing-library/react (jsdom). No new dependencies; icons are hand-inlined SVG.

## Global Constraints

- **No new dependencies.** Icons are hand-inlined SVG (spec §9). Native everything.
- **Dark mode on every element.** Tailwind `dark:` variants; the app maps `bg-white`→`dark:bg-navy-card`, `text-gray-*`→`dark:text-white/*`, `border-gray-*`→`dark:border-navy-border`, canvas `#f4f6f9`→`dark:bg-navy-deep` (UI-change class requirement, change-control skill).
- **No hydration-mismatch patterns.** Any client-only value (fetched data, `Date.now()`) must not diverge server vs first client render; widgets render a stable loading state first, then hydrate data in `useEffect` (mirror `ThemeToggle`'s `mounted` guard).
- **Fault isolation per widget** (spec §6): a failed fetch or render throw degrades ONE card (degraded body), never blanks the dashboard — same principle as `loadOpsSnapshot`.
- **Shared pollers** (spec §9): multiple widgets polling the same endpoint share ONE module-level fetcher/interval; cadence stays at existing rates (queue = 5s).
- **Extract `components/ui/` primitives only as needed** (spec §5), not speculatively.
- **The shell is already live** and wraps every `(app)` page. PR 2 only replaces the `app/(app)/page.tsx` body and adds a param-read to the robots page. Do NOT re-touch `components/shell/`.
- **AppShell `<main>` has no padding/container** (`components/shell/AppShell.tsx:93` is bare `flex-1`). The dashboard page owns its own `max-w-* mx-auto px-* py-*`.
- **Deferred to later PRs — do NOT build here:** edit mode, size stepper, drag/keyboard reorder, `localStorage('er-home-layout')` persistence, reset (PR 3); KPI strip + Needs-attention aggregate widgets (PR 3.5 — their B1/B2 loaders are unverified).
- **Test conventions:** colocated `*.test.tsx`/`*.test.ts` with a `// @vitest-environment jsdom` first line for component tests; `import { render, screen, fireEvent, cleanup } from '@testing-library/react'`; mock `next/navigation` with `vi.mock`; `afterEach(cleanup)`. Full-suite command per change-control: `DATABASE_URL="file:./local-dev.db" npm test`. Single-file: `npx vitest run <path>`.

---

## File Structure

**Created — pure model (`lib/widgets/`):**
- `lib/widgets/types.ts` — `WidgetSize`, `LayoutItem`, `WidgetDef` (no React import beyond `ComponentType`).
- `lib/widgets/grid.ts` — `spanClass(size): string` (pure; span classes per size).
- `lib/widgets/queue-poll.ts` — module-level ref-counted `/api/site-audit/queue` store + `useQueueStatus()` hook.
- `lib/widgets/registry.tsx` — `WIDGETS: WidgetDef[]` + `DEFAULT_LAYOUT: LayoutItem[]`.

**Created — pure helpers (co-located with their domain):**
- `lib/quarter-grid/current-week.ts` — `resolveCurrentWeek(startDate, now): number | null`.
- `lib/seo-parser/client-upload.ts` — `uploadAndParse(files, opts): Promise<{ sessionId: string }>`.

**Created — shared primitives (`components/ui/`):**
- `components/ui/StatusPill.tsx` — small status chip (tone by status).
- `components/ui/ScoreRing.tsx` — inline-SVG score dial 0–100.
- `components/ui/DropZone.tsx` — drag/click file input for CSVs.

**Created — widget framework + widgets (`components/widgets/`):**
- `components/widgets/WidgetFrame.tsx` — card chrome (title + body slot) AND `WidgetErrorBoundary` (render-throw safety net).
- `components/widgets/DashboardGrid.tsx` — client grid mapping `DEFAULT_LAYOUT`.
- `components/widgets/LiveNowWidget.tsx`
- `components/widgets/RecentParsesWidget.tsx`
- `components/widgets/QuarterWeekWidget.tsx`
- `components/widgets/QuickSiteAuditWidget.tsx`
- `components/widgets/QuickParserWidget.tsx`
- `components/widgets/QuickReportWidget.tsx`
- `components/widgets/QuickRobotsWidget.tsx`
- (colocated `*.test.tsx`/`*.test.ts` per source file)

**Modified:**
- `app/(app)/page.tsx` — delete brochure content; render header + `<DashboardGrid />`.
- `app/(app)/robots-validator/page.tsx` — `useSearchParams()` param-read + auto-run in `RobotsSection`, wrapped in a `<Suspense>` boundary.

**Verified data-source contracts (do not re-derive):**
- Site audit: `POST /api/site-audit` `{ domain, wcagLevel, clientId }` → **202** `{ id, status }`; **409** `{ error, id }`. Redirect `/ada-audit/site/[id]`.
- Parser: `POST /api/upload` (multipart, key `files`, batch ≤40MB) → `{ sessionId, files }`; then `POST /api/parse/[sessionId]`; redirect `/seo-parser/results/[sessionId]`.
- Report: `POST /api/reports` `{ clientId, periodStart, periodEnd, comparisonMode }` → **201** `{ batchId, reportIds }`; **422** `{ error:'ineligible_clients', ineligibleClients }` (bypass with `confirm:true`). Redirect `/reports`.
- Robots: client-side `router.push('/robots-validator?url='+encodeURIComponent(url))`.
- Queue: `GET /api/site-audit/queue` → `{ active, queued, batch }` (helper `computeActivePhaseSummary(active)` in `lib/ada-audit/queue-ui-helpers`).
- Parse history: `GET /api/parse/history` → flat array `{ id, kind, source, createdAt, status, files, siteName, clientId, clientName, healthScore, urlCount }[]`.
- Quarter plan: `GET /api/quarter-plan` → `{ plan, assignments } | { plan:null }`; client names via `GET /api/clients` → `{ id, name, ... }[]`. Week helpers `getWeekDates`/`getWeekRange` in `lib/quarter-grid/grid-ops.ts`, `NUM_WEEKS=13` in `lib/quarter-grid/state.ts`.

---

## Task 1: Widget model — types + span-class helper

**Files:**
- Create: `lib/widgets/types.ts`
- Create: `lib/widgets/grid.ts`
- Test: `lib/widgets/grid.test.ts`

**Interfaces:**
- Produces: `type WidgetSize = 'sm' | 'wide' | 'lg' | 'xl'`; `interface LayoutItem { id: string; size: WidgetSize }`; `interface WidgetDef { id: string; title: string; sizes: WidgetSize[]; defaultSize: WidgetSize; Component: ComponentType<{ size: WidgetSize }> }`; `spanClass(size: WidgetSize): string`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/widgets/grid.test.ts
import { describe, it, expect } from 'vitest'
import { spanClass } from './grid'

describe('spanClass', () => {
  it('sm is a single cell at every breakpoint', () => {
    expect(spanClass('sm')).toBe('col-span-1 row-span-1')
  })
  it('wide spans two columns from md up, one row', () => {
    expect(spanClass('wide')).toBe('col-span-1 row-span-1 md:col-span-2')
  })
  it('lg spans two columns and two rows from md/lg up', () => {
    expect(spanClass('lg')).toBe('col-span-1 row-span-1 md:col-span-2 lg:row-span-2')
  })
  it('xl spans the full four columns on lg and two rows', () => {
    expect(spanClass('xl')).toBe('col-span-1 row-span-1 md:col-span-2 lg:col-span-4 lg:row-span-2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/widgets/grid.test.ts`
Expected: FAIL — `Cannot find module './grid'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/widgets/types.ts
import type { ComponentType } from 'react'

// sm = 1×1, wide = 2×1, lg = 2×2, xl = 4×2 (desktop grid units); spec §3.3.
export type WidgetSize = 'sm' | 'wide' | 'lg' | 'xl'

export interface LayoutItem {
  id: string
  size: WidgetSize
}

export interface WidgetDef {
  id: string
  title: string
  sizes: WidgetSize[]
  defaultSize: WidgetSize
  Component: ComponentType<{ size: WidgetSize }>
}
```

```ts
// lib/widgets/grid.ts
// Pure size → Tailwind grid-span class map. Base (mobile) is always a single
// column; wider spans switch on md:/lg: so mobile stays one-column (spec §3.3).
import type { WidgetSize } from './types'

const SPANS: Record<WidgetSize, string> = {
  sm: 'col-span-1 row-span-1',
  wide: 'col-span-1 row-span-1 md:col-span-2',
  lg: 'col-span-1 row-span-1 md:col-span-2 lg:row-span-2',
  xl: 'col-span-1 row-span-1 md:col-span-2 lg:col-span-4 lg:row-span-2',
}

export function spanClass(size: WidgetSize): string {
  return SPANS[size]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/widgets/grid.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/widgets/types.ts lib/widgets/grid.ts lib/widgets/grid.test.ts
git commit -m "feat(widgets): widget model types + grid span-class helper"
```

---

## Task 2: Shared primitives — StatusPill, ScoreRing, DropZone

**Files:**
- Create: `components/ui/StatusPill.tsx`
- Create: `components/ui/ScoreRing.tsx`
- Create: `components/ui/DropZone.tsx`
- Test: `components/ui/StatusPill.test.tsx`
- Test: `components/ui/ScoreRing.test.tsx`
- Test: `components/ui/DropZone.test.tsx`

**Interfaces:**
- Produces: `StatusPill({ label, tone }: { label: string; tone?: 'neutral' | 'running' | 'success' | 'error' | 'warning' })`; `ScoreRing({ score, size }: { score: number | null; size?: number })`; `DropZone({ onFiles, accept, disabled, label }: { onFiles: (files: File[]) => void; accept?: string; disabled?: boolean; label?: string })`.

- [ ] **Step 1: Write the failing tests**

```tsx
// components/ui/StatusPill.test.tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { StatusPill } from './StatusPill'

afterEach(cleanup)

describe('StatusPill', () => {
  it('renders the label', () => {
    render(<StatusPill label="running" tone="running" />)
    expect(screen.getByText('running')).toBeTruthy()
  })
  it('defaults to neutral tone without throwing', () => {
    render(<StatusPill label="queued" />)
    expect(screen.getByText('queued')).toBeTruthy()
  })
})
```

```tsx
// components/ui/ScoreRing.test.tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { ScoreRing } from './ScoreRing'

afterEach(cleanup)

describe('ScoreRing', () => {
  it('shows the score number', () => {
    render(<ScoreRing score={82} />)
    expect(screen.getByText('82')).toBeTruthy()
  })
  it('renders a dash when score is null', () => {
    render(<ScoreRing score={null} />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})
```

```tsx
// components/ui/DropZone.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DropZone } from './DropZone'

afterEach(cleanup)

describe('DropZone', () => {
  it('calls onFiles with dropped files', () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} label="Drop CSVs" />)
    const zone = screen.getByText('Drop CSVs').closest('div')!
    const file = new File(['a,b'], 'x.csv', { type: 'text/csv' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).toHaveBeenCalledWith([file])
  })
  it('does not fire onFiles when disabled', () => {
    const onFiles = vi.fn()
    render(<DropZone onFiles={onFiles} disabled label="Drop CSVs" />)
    const zone = screen.getByText('Drop CSVs').closest('div')!
    const file = new File(['a,b'], 'x.csv', { type: 'text/csv' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFiles).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/ui/StatusPill.test.tsx components/ui/ScoreRing.test.tsx components/ui/DropZone.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```tsx
// components/ui/StatusPill.tsx
type Tone = 'neutral' | 'running' | 'success' | 'error' | 'warning'

const TONES: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
}

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-body font-semibold ${TONES[tone]}`}>
      {label}
    </span>
  )
}
```

```tsx
// components/ui/ScoreRing.tsx
// Inline-SVG 0–100 score dial. Colour tracks the health bands used elsewhere
// (≥80 green, ≥50 amber, else red). Null → dashed grey ring with an em dash.
export function ScoreRing({ score, size = 44 }: { score: number | null; size?: number }) {
  const r = (size - 6) / 2
  const c = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))
  const offset = c - (pct / 100) * c
  const color =
    score == null ? '#9ca3af' : pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={score == null ? 'no score' : `score ${pct}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="stroke-gray-200 dark:stroke-white/10" />
      {score != null && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} stroke={color}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-navy dark:fill-white font-display font-bold" fontSize={size * 0.3}>
        {score == null ? '—' : pct}
      </text>
    </svg>
  )
}
```

```tsx
// components/ui/DropZone.tsx
'use client'
import { useRef, useState } from 'react'

export function DropZone({
  onFiles,
  accept = '.csv,.txt,text/csv',
  disabled = false,
  label = 'Drop CSV files or click to browse',
}: {
  onFiles: (files: File[]) => void
  accept?: string
  disabled?: boolean
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const emit = (list: FileList | null) => {
    if (disabled || !list || list.length === 0) return
    onFiles(Array.from(list))
  }

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); emit(e.dataTransfer.files) }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
        disabled
          ? 'cursor-not-allowed border-gray-200 dark:border-navy-border opacity-50'
          : over
          ? 'border-orange bg-orange/5'
          : 'border-gray-300 hover:border-orange dark:border-navy-border dark:hover:border-orange'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        disabled={disabled}
        className="hidden"
        onChange={(e) => emit(e.target.files)}
      />
      <span className="text-[13px] font-body text-gray-500 dark:text-white/60">{label}</span>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/ui/StatusPill.test.tsx components/ui/ScoreRing.test.tsx components/ui/DropZone.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/StatusPill.tsx components/ui/ScoreRing.tsx components/ui/DropZone.tsx components/ui/*.test.tsx
git commit -m "feat(ui): StatusPill, ScoreRing, DropZone primitives for dashboard widgets"
```

---

## Task 3: WidgetFrame + WidgetErrorBoundary

**Files:**
- Create: `components/widgets/WidgetFrame.tsx`
- Test: `components/widgets/WidgetFrame.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `WidgetFrame({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode })`; `WidgetErrorBoundary({ title, children }: { title: string; children: ReactNode })` (class component; render-throw → degraded card body).

- [ ] **Step 1: Write the failing test**

```tsx
// components/widgets/WidgetFrame.test.tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { WidgetFrame, WidgetErrorBoundary } from './WidgetFrame'

afterEach(cleanup)

describe('WidgetFrame', () => {
  it('renders its title and children', () => {
    render(<WidgetFrame title="Live now"><p>body</p></WidgetFrame>)
    expect(screen.getByText('Live now')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })
})

describe('WidgetErrorBoundary', () => {
  it('renders a degraded card when a child throws', () => {
    const Boom = () => { throw new Error('nope') }
    // Silence the expected React error log for this render.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<WidgetErrorBoundary title="Recent parses"><Boom /></WidgetErrorBoundary>)
    expect(screen.getByText('Recent parses')).toBeTruthy()
    expect(screen.getByText(/couldn.t load/i)).toBeTruthy()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/widgets/WidgetFrame.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/widgets/WidgetFrame.tsx
'use client'
import { Component, type ReactNode } from 'react'

export function WidgetFrame({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-navy-border dark:bg-navy-card">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="truncate font-display text-[13px] font-bold uppercase tracking-wide text-navy/70 dark:text-white/70">
          {title}
        </h2>
        {action}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

// Render-throw safety net: a widget body that throws degrades to a single card,
// never blanks the grid (spec §6, mirrors loadOpsSnapshot fault isolation).
export class WidgetErrorBoundary extends Component<
  { title: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <WidgetFrame title={this.props.title}>
          <p className="text-[13px] font-body text-gray-400 dark:text-white/40">
            Couldn&apos;t load this widget.
          </p>
        </WidgetFrame>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/widgets/WidgetFrame.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/widgets/WidgetFrame.tsx components/widgets/WidgetFrame.test.tsx
git commit -m "feat(widgets): WidgetFrame chrome + WidgetErrorBoundary fault isolation"
```

---

## Task 4: Shared queue poller

**Files:**
- Create: `lib/widgets/queue-poll.ts`
- Test: `lib/widgets/queue-poll.test.ts`

**Interfaces:**
- Consumes: `GET /api/site-audit/queue` → `QueueStatusWithBatch` from `@/lib/ada-audit/types`.
- Produces: `useQueueStatus(): { data: QueueStatusWithBatch | null; error: boolean; loading: boolean }`. Internally a module-level ref-counted external store read via `useSyncExternalStore` (Codex fix 1 — React-correct external-store contract, no tearing): first subscriber starts a 5s interval + immediate fetch; last unsubscribe clears the interval; all subscribers share one in-flight fetch per tick, and an `inFlight` guard drops a tick that fires while a fetch is still pending (so a slow endpoint can't stack requests).

- [ ] **Step 1: Write the failing test**

```ts
// lib/widgets/queue-poll.test.ts
// @vitest-environment jsdom
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useQueueStatus } from './queue-poll'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
beforeEach(() => { vi.restoreAllMocks() })

const snapshot = { active: null, queued: [], batch: null }

describe('useQueueStatus', () => {
  it('fetches once and shares the result across two subscribers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot })
    vi.stubGlobal('fetch', fetchMock)

    const a = renderHook(() => useQueueStatus())
    const b = renderHook(() => useQueueStatus())

    await waitFor(() => expect(a.result.current.data).toEqual(snapshot))
    expect(b.result.current.data).toEqual(snapshot)
    // Two mounts in the same tick share ONE fetch (module-level store).
    expect(fetchMock).toHaveBeenCalledTimes(1)

    a.unmount(); b.unmount()
  })

  it('reports error=true when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const { result } = renderHook(() => useQueueStatus())
    await waitFor(() => expect(result.current.error).toBe(true))
  })

  it('does not stack requests when a tick fires while a fetch is still pending', async () => {
    // A fetch that never resolves within the test: the interval must not
    // launch a second request while the first is in flight (Codex fix 1).
    vi.useFakeTimers()
    let resolveFetch: (v: unknown) => void = () => {}
    const fetchMock = vi.fn(() => new Promise((res) => { resolveFetch = res }))
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = renderHook(() => useQueueStatus())
    // Immediate fetch on first subscriber.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Advance past the 5s interval twice while the first fetch is still pending.
    await vi.advanceTimersByTimeAsync(11000)
    expect(fetchMock).toHaveBeenCalledTimes(1) // inFlight guard dropped both ticks

    resolveFetch({ ok: true, json: async () => snapshot })
    unmount()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/widgets/queue-poll.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/widgets/queue-poll.ts
'use client'
// Module-level, ref-counted shared poller for /api/site-audit/queue so that
// multiple homepage widgets share ONE 5s interval + one in-flight fetch
// (spec §9 — don't multiply queue-poll load). Cadence matches AuditIndexTabs.
// Exposed via useSyncExternalStore — the React-correct external-store contract
// (Codex fix 1). An inFlight guard drops ticks while a fetch is still pending.
import { useSyncExternalStore } from 'react'
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'

const POLL_MS = 5000

type Snapshot = { data: QueueStatusWithBatch | null; error: boolean; loading: boolean }

let current: Snapshot = { data: null, error: false, loading: true }
let timer: ReturnType<typeof setInterval> | null = null
let refCount = 0
let inFlight = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

async function tick() {
  if (inFlight) return // don't stack requests on a slow endpoint (Codex fix 1)
  inFlight = true
  try {
    const res = await fetch('/api/site-audit/queue')
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as QueueStatusWithBatch
    current = { data, error: false, loading: false }
  } catch {
    // Keep the last good data; flag error for a degraded badge.
    current = { data: current.data, error: true, loading: false }
  } finally {
    inFlight = false
  }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  refCount++
  if (refCount === 1 && !timer) {
    void tick()
    timer = setInterval(() => void tick(), POLL_MS)
  }
  return () => {
    listeners.delete(listener)
    refCount--
    if (refCount === 0 && timer) { clearInterval(timer); timer = null }
  }
}

function getSnapshot(): Snapshot {
  return current
}

export function useQueueStatus(): Snapshot {
  // Server snapshot === client snapshot (same module-level `current`), so no
  // hydration mismatch: both render the stable loading state first.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/widgets/queue-poll.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/widgets/queue-poll.ts lib/widgets/queue-poll.test.ts
git commit -m "feat(widgets): shared ref-counted /api/site-audit/queue poller hook"
```

---

## Task 5: LiveNowWidget

**Files:**
- Create: `components/widgets/LiveNowWidget.tsx`
- Test: `components/widgets/LiveNowWidget.test.tsx`

**Interfaces:**
- Consumes: `useQueueStatus()` (Task 4); `computeActivePhaseSummary(active)` from `@/lib/ada-audit/queue-ui-helpers` → `{ label, complete, total, pct, unit }`; `WidgetSize` (Task 1).
- Produces: `LiveNowWidget({ size }: { size: WidgetSize })`.

- [ ] **Step 1: Write the failing test**

```tsx
// components/widgets/LiveNowWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const queueMock = vi.hoisted(() => ({ value: { data: null as any, error: false, loading: false } }))
vi.mock('@/lib/widgets/queue-poll', () => ({ useQueueStatus: () => queueMock.value }))

import { LiveNowWidget } from './LiveNowWidget'

afterEach(cleanup)

describe('LiveNowWidget', () => {
  it('shows an idle state when nothing is running or queued', () => {
    queueMock.value = { data: { active: null, queued: [], batch: null }, error: false, loading: false }
    render(<LiveNowWidget size="lg" />)
    expect(screen.getByText(/no scans running/i)).toBeTruthy()
  })

  it('renders the active audit domain and progress', () => {
    queueMock.value = {
      data: {
        active: { id: 'a1', domain: 'example.com', status: 'running', pagesTotal: 10, pagesComplete: 4, pagesError: 0, pdfsTotal: 0, pdfsComplete: 0, pdfsError: 0, pdfsSkipped: 0, lighthouseTotal: 0, lighthouseComplete: 0, lighthouseError: 0, clientId: null },
        queued: [{ id: 'q1', domain: 'two.com', position: 1, clientId: null }],
        batch: null,
      },
      error: false, loading: false,
    }
    render(<LiveNowWidget size="lg" />)
    expect(screen.getByText('example.com')).toBeTruthy()
    expect(screen.getByText(/1 queued/i)).toBeTruthy()
  })

  it('renders a degraded note on fetch error with no prior data', () => {
    queueMock.value = { data: null, error: true, loading: false }
    render(<LiveNowWidget size="sm" />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/widgets/LiveNowWidget.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/widgets/LiveNowWidget.tsx
'use client'
import Link from 'next/link'
import { useQueueStatus } from '@/lib/widgets/queue-poll'
import { computeActivePhaseSummary } from '@/lib/ada-audit/queue-ui-helpers'
import { StatusPill } from '@/components/ui/StatusPill'
import type { WidgetSize } from '@/lib/widgets/types'

export function LiveNowWidget({ size }: { size: WidgetSize }) {
  const { data, error } = useQueueStatus()

  if (error && !data) {
    return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Live queue unavailable.</p>
  }
  if (!data) {
    return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Loading…</p>
  }

  const { active, queued } = data
  const detailed = size !== 'sm'

  if (!active && queued.length === 0) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-2">
        <p className="text-[14px] font-body text-gray-500 dark:text-white/60">No scans running.</p>
        <Link href="/ada-audit" className="text-[13px] font-body font-semibold text-orange hover:underline">
          Start a site audit →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {active && (() => {
        const p = computeActivePhaseSummary(active)
        return (
          <Link href={`/ada-audit/site/${active.id}`} className="block rounded-lg border border-gray-100 p-2 hover:border-orange/50 dark:border-navy-border">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="truncate font-display text-[14px] font-bold text-navy dark:text-white">{active.domain}</span>
              <StatusPill label={active.status} tone="running" />
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
              <div className="h-full rounded-full bg-orange transition-all" style={{ width: `${p.pct}%` }} />
            </div>
            <p className="mt-1 text-[11px] font-body text-gray-400 dark:text-white/40">
              {p.label}: {p.complete}/{p.total} {p.unit}
            </p>
          </Link>
        )
      })()}

      <p className="text-[12px] font-body text-gray-500 dark:text-white/50">{queued.length} queued</p>

      {detailed && queued.length > 0 && (
        <ul className="space-y-1 overflow-auto">
          {queued.slice(0, 6).map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-2 text-[12px] font-body">
              <span className="truncate text-gray-600 dark:text-white/60">{q.domain}</span>
              <span className="shrink-0 text-gray-400 dark:text-white/30">#{q.position}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/widgets/LiveNowWidget.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/widgets/LiveNowWidget.tsx components/widgets/LiveNowWidget.test.tsx
git commit -m "feat(widgets): LiveNowWidget (shared queue poll, active progress + queued)"
```

---

## Task 6: RecentParsesWidget

**Files:**
- Create: `components/widgets/RecentParsesWidget.tsx`
- Test: `components/widgets/RecentParsesWidget.test.tsx`

**Interfaces:**
- Consumes: `GET /api/parse/history` → `{ id, kind, source, createdAt, status, siteName, clientName, healthScore, urlCount }[]`; `ScoreRing` (Task 2); `StatusPill` (Task 2); `WidgetSize` (Task 1).
- Produces: `RecentParsesWidget({ size }: { size: WidgetSize })`.

- [ ] **Step 1: Write the failing test**

```tsx
// components/widgets/RecentParsesWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { RecentParsesWidget } from './RecentParsesWidget'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const rows = [
  { id: 's1', kind: 'session', source: 'sf-upload', createdAt: '2026-07-06T10:00:00Z', status: 'complete', files: ['a.csv'], siteName: 'Example', clientId: 1, clientName: 'Acme', healthScore: 82, urlCount: 120 },
  { id: 'r1', kind: 'run', source: 'live-scan', createdAt: '2026-07-05T10:00:00Z', status: 'complete', files: [], siteName: 'Two', clientId: null, clientName: null, healthScore: 55, urlCount: 40 },
]

describe('RecentParsesWidget', () => {
  it('renders fetched parse rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => rows }))
    render(<RecentParsesWidget size="lg" />)
    await waitFor(() => expect(screen.getByText('Example')).toBeTruthy())
    expect(screen.getByText('82')).toBeTruthy()
  })

  it('shows an empty state when there are no parses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    render(<RecentParsesWidget size="sm" />)
    await waitFor(() => expect(screen.getByText(/no recent parses/i)).toBeTruthy())
  })

  it('shows a degraded note on fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    render(<RecentParsesWidget size="sm" />)
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/widgets/RecentParsesWidget.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/widgets/RecentParsesWidget.tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { StatusPill } from '@/components/ui/StatusPill'
import type { WidgetSize } from '@/lib/widgets/types'

interface ParseRow {
  id: string
  kind: 'session' | 'run'
  source: 'sf-upload' | 'live-scan'
  createdAt: string
  status: string
  siteName: string | null
  clientName: string | null
  healthScore?: number
  urlCount?: number
}

function hrefFor(row: ParseRow): string {
  return row.kind === 'session' ? `/seo-parser/results/${row.id}` : '/seo-parser'
}

export function RecentParsesWidget({ size }: { size: WidgetSize }) {
  const [rows, setRows] = useState<ParseRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/parse/history')
      .then((r) => { if (!r.ok) throw new Error(`status ${r.status}`); return r.json() })
      .then((d: unknown) => { if (live) setRows(Array.isArray(d) ? (d as ParseRow[]) : []) })
      .catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [])

  if (error) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Couldn&apos;t load recent parses.</p>
  if (!rows) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Loading…</p>
  if (rows.length === 0) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">No recent parses yet.</p>

  const limit = size === 'sm' ? 3 : 8

  return (
    <ul className="space-y-2 overflow-auto">
      {rows.slice(0, limit).map((row) => (
        <li key={`${row.kind}-${row.id}`}>
          <Link href={hrefFor(row)} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-gray-50 dark:hover:bg-white/5">
            <ScoreRing score={row.healthScore ?? null} size={size === 'sm' ? 34 : 40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-[13px] font-semibold text-navy dark:text-white">
                {row.siteName ?? row.clientName ?? 'Untitled'}
              </p>
              <div className="flex items-center gap-2">
                <StatusPill label={row.source === 'live-scan' ? 'live scan' : 'SF upload'} tone={row.source === 'live-scan' ? 'warning' : 'neutral'} />
                {row.urlCount != null && (
                  <span className="text-[11px] font-body text-gray-400 dark:text-white/40">{row.urlCount} URLs</span>
                )}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/widgets/RecentParsesWidget.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/widgets/RecentParsesWidget.tsx components/widgets/RecentParsesWidget.test.tsx
git commit -m "feat(widgets): RecentParsesWidget (/api/parse/history, score rings, degraded state)"
```

---

## Task 7: Current-week helper + QuarterWeekWidget

**Files:**
- Create: `lib/quarter-grid/current-week.ts`
- Create: `components/widgets/QuarterWeekWidget.tsx`
- Test: `lib/quarter-grid/current-week.test.ts`
- Test: `components/widgets/QuarterWeekWidget.test.tsx`

**Interfaces:**
- Consumes: `getWeekRange(startDate, weekNum)` from `@/lib/quarter-grid/grid-ops`; `NUM_WEEKS` from `@/lib/quarter-grid/state`; `GET /api/quarter-plan` → `{ plan, assignments } | { plan:null }`; `GET /api/clients` → `{ id, name }[]`; `WidgetSize` (Task 1).
- Produces: `resolveCurrentWeek(startDate: string, now: Date): number | null` (1..NUM_WEEKS, or null if startDate invalid/empty or today is outside the 13-week window); `QuarterWeekWidget({ size }: { size: WidgetSize })`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/quarter-grid/current-week.test.ts
import { describe, it, expect } from 'vitest'
import { resolveCurrentWeek } from './current-week'

describe('resolveCurrentWeek', () => {
  it('returns null for an empty start date', () => {
    expect(resolveCurrentWeek('', new Date('2026-07-07T12:00:00'))).toBeNull()
  })
  it('returns week 1 for a date inside the first week', () => {
    // startDate is a Monday; +2 days is still week 1.
    expect(resolveCurrentWeek('2026-07-06', new Date('2026-07-08T12:00:00'))).toBe(1)
  })
  it('returns week 2 for a date seven days after start', () => {
    expect(resolveCurrentWeek('2026-07-06', new Date('2026-07-14T12:00:00'))).toBe(2)
  })
  it('returns null when today is past the 13-week window', () => {
    expect(resolveCurrentWeek('2026-07-06', new Date('2026-11-01T12:00:00'))).toBeNull()
  })
  it('returns null when today is before the start date', () => {
    expect(resolveCurrentWeek('2026-07-06', new Date('2026-07-01T12:00:00'))).toBeNull()
  })
})
```

```tsx
// components/widgets/QuarterWeekWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { QuarterWeekWidget } from './QuarterWeekWidget'

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-08T12:00:00')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function stubFetch(plan: any, assignments: any[], clients: any[]) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/api/quarter-plan')) return Promise.resolve({ ok: true, json: async () => ({ plan, assignments }) })
    if (url.includes('/api/clients')) return Promise.resolve({ ok: true, json: async () => clients })
    return Promise.reject(new Error('unexpected url'))
  }))
}

describe('QuarterWeekWidget', () => {
  it('lists clients scheduled in the current week with names', async () => {
    stubFetch(
      { name: 'Q3', startDate: '2026-07-06', slotsPerWeek: 2, layouts: {}, updatedAt: '', teamworkPushedAt: null, teamworkPushSummary: null },
      [{ clientId: 1, week: 1, position: 0, priority: 1, status: 'in_progress', note: '', completed: false }],
      [{ id: 1, name: 'Acme' }],
    )
    render(<QuarterWeekWidget size="wide" />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy())
  })

  it('shows a no-plan state when plan is null', async () => {
    stubFetch(null, [], [])
    render(<QuarterWeekWidget size="sm" />)
    await waitFor(() => expect(screen.getByText(/no quarter plan/i)).toBeTruthy())
  })

  it('shows a degraded note when the plan fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    render(<QuarterWeekWidget size="sm" />)
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/quarter-grid/current-week.test.ts components/widgets/QuarterWeekWidget.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```ts
// lib/quarter-grid/current-week.ts
// Which of the 13 plan weeks contains `now`, or null if the plan has no start
// date or today falls outside the window. startDate is 'YYYY-MM-DD' = Monday of
// week 1, parsed at local midnight to match grid-ops.getWeekDates.
import { NUM_WEEKS } from './state'

export function resolveCurrentWeek(startDate: string, now: Date): number | null {
  if (!startDate) return null
  const start = new Date(startDate + 'T00:00:00')
  if (Number.isNaN(start.getTime())) return null
  const dayMs = 24 * 60 * 60 * 1000
  const diffDays = Math.floor((now.getTime() - start.getTime()) / dayMs)
  if (diffDays < 0) return null
  const week = Math.floor(diffDays / 7) + 1
  if (week < 1 || week > NUM_WEEKS) return null
  return week
}
```

```tsx
// components/widgets/QuarterWeekWidget.tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { resolveCurrentWeek } from '@/lib/quarter-grid/current-week'
import { getWeekRange } from '@/lib/quarter-grid/grid-ops'
import { StatusPill } from '@/components/ui/StatusPill'
import type { WidgetSize } from '@/lib/widgets/types'

// Mirrors the QuarterPlanGetResponse contract: startDate is string | null
// (lib/quarter-grid/state.ts) and assignments carry a nullable slot position
// (Codex fix 3).
interface Assignment { clientId: number; week: number | null; position: number | null; priority: number; status: string; completed: boolean }
interface Plan { startDate: string | null }

const STATUS_TONE: Record<string, 'neutral' | 'running' | 'success' | 'error' | 'warning'> = {
  not_started: 'neutral', in_progress: 'running', on_hold: 'warning', blocked: 'error', complete: 'success',
}

export function QuarterWeekWidget({ size }: { size: WidgetSize }) {
  const [state, setState] = useState<
    { plan: Plan | null; assignments: Assignment[]; names: Map<number, string> } | null
  >(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([
      fetch('/api/quarter-plan').then((r) => { if (!r.ok) throw new Error('plan'); return r.json() }),
      fetch('/api/clients').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ])
      .then(([planRes, clientsRes]: [{ plan: Plan | null; assignments?: Assignment[] }, Array<{ id: number; name: string }>]) => {
        if (!live) return
        const names = new Map<number, string>()
        if (Array.isArray(clientsRes)) for (const c of clientsRes) names.set(c.id, c.name)
        setState({ plan: planRes.plan, assignments: planRes.assignments ?? [], names })
      })
      .catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [])

  if (error) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Couldn&apos;t load the quarter plan.</p>
  if (!state) return <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Loading…</p>
  if (!state.plan) {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-2">
        <p className="text-[13px] font-body text-gray-400 dark:text-white/40">No quarter plan yet.</p>
        <Link href="/quarter-grid" className="text-[13px] font-body font-semibold text-orange hover:underline">Open Quarter Grid →</Link>
      </div>
    )
  }

  const startDate = state.plan.startDate
  const week = startDate ? resolveCurrentWeek(startDate, new Date()) : null
  const range = week && startDate ? getWeekRange(startDate, week) : null
  // Preserve the planned slot order: sort by grid position first (nulls last),
  // then priority, then clientId for a stable tiebreak (Codex fix 3).
  const clients =
    week == null
      ? []
      : state.assignments
          .filter((a) => a.week === week)
          .sort(
            (a, b) =>
              (a.position ?? Infinity) - (b.position ?? Infinity) ||
              a.priority - b.priority ||
              a.clientId - b.clientId,
          )
  const detailed = size !== 'sm'

  return (
    <div className="flex h-full flex-col gap-2">
      <p className="text-[12px] font-body text-gray-500 dark:text-white/50">
        {week == null ? 'Outside the planned quarter' : `Week ${week}${range ? ` · ${range}` : ''}`}
      </p>
      {clients.length === 0 ? (
        <p className="text-[13px] font-body text-gray-400 dark:text-white/40">Nothing scheduled this week.</p>
      ) : (
        <ul className="space-y-1 overflow-auto">
          {(detailed ? clients : clients.slice(0, 3)).map((a) => (
            <li key={a.clientId} className="flex items-center justify-between gap-2 text-[13px] font-body">
              <span className="truncate text-navy dark:text-white">{state.names.get(a.clientId) ?? `Client #${a.clientId}`}</span>
              <StatusPill label={a.status.replace('_', ' ')} tone={STATUS_TONE[a.status] ?? 'neutral'} />
            </li>
          ))}
        </ul>
      )}
      <Link href="/quarter-grid" className="mt-auto text-[12px] font-body font-semibold text-orange hover:underline">Open Quarter Grid →</Link>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/quarter-grid/current-week.test.ts components/widgets/QuarterWeekWidget.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/quarter-grid/current-week.ts lib/quarter-grid/current-week.test.ts components/widgets/QuarterWeekWidget.tsx components/widgets/QuarterWeekWidget.test.tsx
git commit -m "feat(widgets): QuarterWeekWidget + resolveCurrentWeek helper"
```

---

## Task 8: QuickSiteAuditWidget

**Files:**
- Create: `components/widgets/QuickSiteAuditWidget.tsx`
- Test: `components/widgets/QuickSiteAuditWidget.test.tsx`

**Interfaces:**
- Consumes: `POST /api/site-audit` `{ domain, wcagLevel, clientId }` → 202 `{ id }` / 409 `{ error, id }` / 400 `{ error }`; `useRouter` from `next/navigation`; `WidgetSize` (Task 1).
- Produces: `QuickSiteAuditWidget({ size }: { size: WidgetSize })`.

- [ ] **Step 1: Write the failing test**

```tsx
// components/widgets/QuickSiteAuditWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

import { QuickSiteAuditWidget } from './QuickSiteAuditWidget'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); pushMock.mockReset() })

describe('QuickSiteAuditWidget', () => {
  it('POSTs the domain and redirects to the live audit page on 202', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 202, ok: true, json: async () => ({ id: 'abc', status: 'queued' }) }))
    render(<QuickSiteAuditWidget size="wide" />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ada-audit/site/abc'))
  })

  it('redirects to the existing audit on a 409 duplicate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 409, ok: false, json: async () => ({ error: 'in flight', id: 'dup' }) }))
    render(<QuickSiteAuditWidget size="wide" />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/ada-audit/site/dup'))
  })

  it('shows an inline error on a 400 and does not redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 400, ok: false, json: async () => ({ error: 'bad domain' }) }))
    render(<QuickSiteAuditWidget size="wide" />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))
    await waitFor(() => expect(screen.getByText(/bad domain/i)).toBeTruthy())
    expect(pushMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/widgets/QuickSiteAuditWidget.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/widgets/QuickSiteAuditWidget.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WidgetSize } from '@/lib/widgets/types'

export function QuickSiteAuditWidget({ size }: { size: WidgetSize }) {
  const router = useRouter()
  const [domain, setDomain] = useState('')
  const [wcagLevel, setWcagLevel] = useState<'wcag21aa' | 'wcag22aa'>('wcag21aa')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    const value = domain.trim()
    if (!value || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/site-audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: value, wcagLevel, clientId: null }),
      })
      const data = await res.json().catch(() => ({}))
      // 202 → queued; 409 → existing in-flight audit (still land in the flow).
      if ((res.status === 202 || res.status === 409) && data.id) {
        router.push(`/ada-audit/site/${data.id}`)
        return
      }
      setError(data.error || 'Could not start the audit.')
    } catch {
      setError('Could not start the audit.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex h-full flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void start() }}>
      <input
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="example.com"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white"
      />
      {size !== 'sm' && (
        <select
          value={wcagLevel}
          onChange={(e) => setWcagLevel(e.target.value as 'wcag21aa' | 'wcag22aa')}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white"
        >
          <option value="wcag21aa">WCAG 2.1 AA (Required)</option>
          <option value="wcag22aa">WCAG 2.2 AA (Aspirational)</option>
        </select>
      )}
      {error && <p className="text-[12px] font-body text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !domain.trim()}
        className="mt-auto rounded-lg bg-orange px-4 py-2 text-[14px] font-display font-bold text-navy hover:bg-orange-light disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Start audit'}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/widgets/QuickSiteAuditWidget.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/widgets/QuickSiteAuditWidget.tsx components/widgets/QuickSiteAuditWidget.test.tsx
git commit -m "feat(widgets): QuickSiteAuditWidget (POST /api/site-audit → live flow, 409 reuse)"
```

---

## Task 9: CSV upload helper + QuickParserWidget

**Files:**
- Create: `lib/seo-parser/client-upload.ts`
- Create: `components/widgets/QuickParserWidget.tsx`
- Test: `lib/seo-parser/client-upload.test.ts`
- Test: `components/widgets/QuickParserWidget.test.tsx`

**Interfaces:**
- Consumes: `POST /api/upload` (multipart, key `files`, optional `sessionId`) → `{ sessionId, files }`; `POST /api/parse/[sessionId]`; `DropZone` (Task 2); `useRouter`; `WidgetSize` (Task 1).
- Produces: `uploadAndParse(files: File[]): Promise<{ sessionId: string }>` (uploads in ≤40MB batches carrying the sessionId forward — mirrors `app/(app)/seo-parser/page.tsx` handleDrop lines 31–46 — then POSTs `/api/parse/[sessionId]`); `QuickParserWidget({ size }: { size: WidgetSize })`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/seo-parser/client-upload.test.ts
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadAndParse } from './client-upload'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('uploadAndParse', () => {
  it('uploads files then triggers parse and returns the sessionId', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      calls.push(url)
      if (url === '/api/upload') return Promise.resolve({ ok: true, json: async () => ({ sessionId: 'sess1', files: ['a.csv'] }) })
      if (url === '/api/parse/sess1') return Promise.resolve({ ok: true, json: async () => ({}) })
      return Promise.reject(new Error('unexpected'))
    }))
    const file = new File(['a,b'], 'a.csv', { type: 'text/csv' })
    const out = await uploadAndParse([file])
    expect(out.sessionId).toBe('sess1')
    expect(calls).toContain('/api/upload')
    expect(calls).toContain('/api/parse/sess1')
  })

  it('splits into batches over 40MB and carries the sessionId into the next upload (Codex fix 5)', async () => {
    const uploadBodies: FormData[] = []
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, opts?: { body?: FormData }) => {
      calls.push(url)
      if (url === '/api/upload') {
        if (opts?.body instanceof FormData) uploadBodies.push(opts.body)
        return Promise.resolve({ ok: true, json: async () => ({ sessionId: 's1', files: ['x.csv'] }) })
      }
      if (url === '/api/parse/s1') return Promise.resolve({ ok: true, json: async () => ({}) })
      return Promise.reject(new Error('unexpected'))
    }))
    // Two files whose sizes each exceed half the 40MB batch cap force a split.
    const big = () => {
      const f = new File(['a,b'], 'big.csv', { type: 'text/csv' })
      Object.defineProperty(f, 'size', { value: 30 * 1024 * 1024 })
      return f
    }
    const out = await uploadAndParse([big(), big()])
    expect(out.sessionId).toBe('s1')
    // Two upload requests (one per batch); the second carries the first session.
    expect(calls.filter((c) => c === '/api/upload')).toHaveLength(2)
    expect(uploadBodies[1].get('sessionId')).toBe('s1')
    // Parse fires exactly once, for the final session.
    expect(calls.filter((c) => c === '/api/parse/s1')).toHaveLength(1)
  })

  it('throws with the API error message on a failed upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'too big' }) }))
    const file = new File(['a,b'], 'a.csv', { type: 'text/csv' })
    await expect(uploadAndParse([file])).rejects.toThrow(/too big/)
  })
})
```

```tsx
// components/widgets/QuickParserWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))
const uploadMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/seo-parser/client-upload', () => ({ uploadAndParse: uploadMock }))

import { QuickParserWidget } from './QuickParserWidget'

afterEach(() => { cleanup(); vi.restoreAllMocks(); pushMock.mockReset(); uploadMock.mockReset() })

describe('QuickParserWidget', () => {
  it('uploads dropped files and redirects to the results page', async () => {
    uploadMock.mockResolvedValue({ sessionId: 'sess9' })
    render(<QuickParserWidget size="wide" />)
    const zone = screen.getByText(/drop screaming frog/i).closest('div')!
    const file = new File(['a,b'], 'internal.csv', { type: 'text/csv' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/seo-parser/results/sess9'))
  })

  it('shows an inline error when the upload fails', async () => {
    uploadMock.mockRejectedValue(new Error('too big'))
    render(<QuickParserWidget size="wide" />)
    const zone = screen.getByText(/drop screaming frog/i).closest('div')!
    const file = new File(['a,b'], 'internal.csv', { type: 'text/csv' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    await waitFor(() => expect(screen.getByText(/too big/i)).toBeTruthy())
    expect(pushMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/seo-parser/client-upload.test.ts components/widgets/QuickParserWidget.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```ts
// lib/seo-parser/client-upload.ts
// Client helper mirroring app/(app)/seo-parser/page.tsx handleDrop + handleAnalyze:
// upload CSVs in ≤40MB batches (carry the sessionId forward so all files land in
// one session; Nginx caps the body at ~50MB), then trigger the parse. Returns the
// session id for a results redirect.
const MAX_BATCH_BYTES = 40 * 1024 * 1024

function batchFiles(files: File[]): File[][] {
  const batches: File[][] = []
  let current: File[] = []
  let bytes = 0
  for (const f of files) {
    if (current.length > 0 && bytes + f.size > MAX_BATCH_BYTES) {
      batches.push(current); current = []; bytes = 0
    }
    current.push(f); bytes += f.size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export async function uploadAndParse(files: File[]): Promise<{ sessionId: string }> {
  if (files.length === 0) throw new Error('No files selected.')
  let sessionId: string | undefined
  for (const batch of batchFiles(files)) {
    const form = new FormData()
    if (sessionId) form.append('sessionId', sessionId)
    for (const f of batch) form.append('files', f)
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Upload failed.')
    sessionId = data.sessionId
  }
  if (!sessionId) throw new Error('Upload failed.')
  const parseRes = await fetch(`/api/parse/${sessionId}`, { method: 'POST' })
  if (!parseRes.ok) {
    const data = await parseRes.json().catch(() => ({}))
    throw new Error(data.error || 'Parse failed.')
  }
  return { sessionId }
}
```

```tsx
// components/widgets/QuickParserWidget.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DropZone } from '@/components/ui/DropZone'
import { uploadAndParse } from '@/lib/seo-parser/client-upload'
import type { WidgetSize } from '@/lib/widgets/types'

export function QuickParserWidget({ size }: { size: WidgetSize }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(files: File[]) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const { sessionId } = await uploadAndParse(files)
      router.push(`/seo-parser/results/${sessionId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <DropZone
        onFiles={handleFiles}
        disabled={busy}
        label={busy ? 'Uploading…' : 'Drop Screaming Frog CSVs or click to browse'}
      />
      {error && <p className="text-[12px] font-body text-red-600 dark:text-red-400">{error}</p>}
      {size !== 'sm' && !error && (
        <p className="text-[11px] font-body text-gray-400 dark:text-white/40">
          internal_all.csv, page_titles, meta_description, h1, response_codes…
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/seo-parser/client-upload.test.ts components/widgets/QuickParserWidget.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/seo-parser/client-upload.ts lib/seo-parser/client-upload.test.ts components/widgets/QuickParserWidget.tsx components/widgets/QuickParserWidget.test.tsx
git commit -m "feat(widgets): QuickParserWidget + uploadAndParse helper (upload→parse→results)"
```

---

## Task 10: QuickReportWidget

**Files:**
- Create: `components/widgets/QuickReportWidget.tsx`
- Test: `components/widgets/QuickReportWidget.test.tsx`

**Interfaces:**
- Consumes: `GET /api/clients` → `{ id, name }[]`; `POST /api/reports` `{ clientId, periodStart, periodEnd, comparisonMode }` → 201 `{ batchId, reportIds }` / 422 `{ error:'ineligible_clients', ineligibleClients }`; `useRouter`; `WidgetSize` (Task 1).
- Produces: `QuickReportWidget({ size }: { size: WidgetSize })`. Period defaults to the last complete calendar month; `comparisonMode` defaults to `'prev_period'` (mirrors `GenerateReportForm`).

- [ ] **Step 1: Write the failing test**

```tsx
// components/widgets/QuickReportWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

import { QuickReportWidget } from './QuickReportWidget'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); pushMock.mockReset() })

function stubClientsThenReport(reportResponse: { status: number; body: any }) {
  vi.stubGlobal('fetch', vi.fn((url: string, opts?: any) => {
    if (url === '/api/clients' && (!opts || opts.method === undefined)) {
      return Promise.resolve({ ok: true, json: async () => [{ id: 1, name: 'Acme' }] })
    }
    if (url === '/api/reports') {
      return Promise.resolve({ ok: reportResponse.status < 400, status: reportResponse.status, json: async () => reportResponse.body })
    }
    return Promise.reject(new Error('unexpected ' + url))
  }))
}

describe('QuickReportWidget', () => {
  it('generates a report and redirects to /reports on 201', async () => {
    stubClientsThenReport({ status: 201, body: { batchId: 'b1', reportIds: ['r1'] } })
    render(<QuickReportWidget size="wide" />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/client/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reports'))
  })

  it('surfaces the ineligible-clients message on 422', async () => {
    stubClientsThenReport({ status: 422, body: { error: 'ineligible_clients', ineligibleClients: [{ id: 1, name: 'Acme', reason: 'no GA4' }] } })
    render(<QuickReportWidget size="wide" />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText(/client/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /generate/i }))
    await waitFor(() => expect(screen.getByText(/no GA4|not eligible/i)).toBeTruthy())
    expect(pushMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/widgets/QuickReportWidget.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/widgets/QuickReportWidget.tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WidgetSize } from '@/lib/widgets/types'

interface ClientItem { id: number; name: string }
interface Period { periodStart: string; periodEnd: string }

// Last complete calendar month, computed in UTC to match GenerateReportForm
// (GenerateReportForm.tsx:38 uses Date.UTC). NOT called during render — a
// render-time `new Date()` would risk a server/client hydration divergence
// across a month boundary (Codex fix 2); computed once on mount instead.
function lastCompleteMonthUTC(): Period {
  const now = new Date()
  // First day of the previous month, and the last day of the previous month.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { periodStart: iso(start), periodEnd: iso(end) }
}

export function QuickReportWidget({ size }: { size: WidgetSize }) {
  const router = useRouter()
  const [clients, setClients] = useState<ClientItem[]>([])
  const [clientId, setClientId] = useState('')
  const [comparisonMode, setComparisonMode] = useState<'prev_period' | 'prev_year'>('prev_period')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Period is computed after mount (stable null placeholder for SSR/first paint).
  const [period, setPeriod] = useState<Period | null>(null)

  useEffect(() => { setPeriod(lastCompleteMonthUTC()) }, [])

  useEffect(() => {
    let live = true
    fetch('/api/clients')
      .then((r) => (r.ok ? r.json() : []))
      .then((d: unknown) => {
        if (!live || !Array.isArray(d)) return
        setClients((d as ClientItem[]).filter((c) => typeof c.id === 'number' && typeof c.name === 'string'))
      })
      .catch(() => {})
    return () => { live = false }
  }, [])

  async function generate() {
    if (!clientId || !period || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: Number(clientId), periodStart: period.periodStart, periodEnd: period.periodEnd, comparisonMode }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 201) { router.push('/reports'); return }
      if (res.status === 422 && Array.isArray(data.ineligibleClients)) {
        const reasons = data.ineligibleClients.map((c: { name: string; reason: string }) => `${c.name}: ${c.reason}`).join('; ')
        setError(`Not eligible — ${reasons}`)
      } else {
        setError(data.error || 'Could not generate the report.')
      }
    } catch {
      setError('Could not generate the report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex h-full flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void generate() }}>
      <label className="sr-only" htmlFor="qr-client">Client</label>
      <select
        id="qr-client"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white"
      >
        <option value="">Select a client…</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {size !== 'sm' && (
        <select
          aria-label="Comparison"
          value={comparisonMode}
          onChange={(e) => setComparisonMode(e.target.value as 'prev_period' | 'prev_year')}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white"
        >
          <option value="prev_period">vs previous period</option>
          <option value="prev_year">vs previous year</option>
        </select>
      )}
      <p className="text-[11px] font-body text-gray-400 dark:text-white/40">
        {period ? `${period.periodStart} → ${period.periodEnd}` : '—'}
      </p>
      {error && <p className="text-[12px] font-body text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !clientId || !period}
        className="mt-auto rounded-lg bg-orange px-4 py-2 text-[14px] font-display font-bold text-navy hover:bg-orange-light disabled:opacity-50"
      >
        {busy ? 'Generating…' : 'Generate report'}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/widgets/QuickReportWidget.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/widgets/QuickReportWidget.tsx components/widgets/QuickReportWidget.test.tsx
git commit -m "feat(widgets): QuickReportWidget (client+period → POST /api/reports → /reports)"
```

---

## Task 11: QuickRobotsWidget

**Files:**
- Create: `components/widgets/QuickRobotsWidget.tsx`
- Test: `components/widgets/QuickRobotsWidget.test.tsx`

**Interfaces:**
- Consumes: `useRouter`; `WidgetSize` (Task 1).
- Produces: `QuickRobotsWidget({ size }: { size: WidgetSize })`. Pure client-side redirect to `/robots-validator?url=<encoded>` — no fetch.

- [ ] **Step 1: Write the failing test**

```tsx
// components/widgets/QuickRobotsWidget.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const pushMock = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

import { QuickRobotsWidget } from './QuickRobotsWidget'

afterEach(() => { cleanup(); pushMock.mockReset() })

describe('QuickRobotsWidget', () => {
  it('redirects to the validator with the encoded url', () => {
    render(<QuickRobotsWidget size="sm" />)
    fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'https://a.com' } })
    fireEvent.click(screen.getByRole('button', { name: /check/i }))
    expect(pushMock).toHaveBeenCalledWith('/robots-validator?url=' + encodeURIComponent('https://a.com'))
  })

  it('does nothing on an empty url', () => {
    render(<QuickRobotsWidget size="sm" />)
    fireEvent.click(screen.getByRole('button', { name: /check/i }))
    expect(pushMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/widgets/QuickRobotsWidget.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// components/widgets/QuickRobotsWidget.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WidgetSize } from '@/lib/widgets/types'

export function QuickRobotsWidget(_props: { size: WidgetSize }) {
  const router = useRouter()
  const [url, setUrl] = useState('')

  function check() {
    const value = url.trim()
    if (!value) return
    router.push('/robots-validator?url=' + encodeURIComponent(value))
  }

  return (
    <form className="flex h-full flex-col gap-2" onSubmit={(e) => { e.preventDefault(); check() }}>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="example.com"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white"
      />
      <button
        type="submit"
        disabled={!url.trim()}
        className="mt-auto rounded-lg bg-navy px-4 py-2 text-[14px] font-display font-bold text-white hover:bg-navy-light disabled:opacity-50 dark:bg-white/10"
      >
        Check robots.txt
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/widgets/QuickRobotsWidget.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/widgets/QuickRobotsWidget.tsx components/widgets/QuickRobotsWidget.test.tsx
git commit -m "feat(widgets): QuickRobotsWidget (client-side redirect to validator with ?url=)"
```

---

## Task 12: Robots validator — `?url=` param-read + auto-run

**Files:**
- Modify: `app/(app)/robots-validator/page.tsx` (add `useSearchParams` read in `RobotsSection`; wrap the page's default-export tree in `<Suspense>`).
- Test: `app/(app)/robots-validator/param-autorun.test.tsx`

**Interfaces:**
- Consumes: `useSearchParams` from `next/navigation`; existing `fetchFromUrl(targetUrl, 'robots')` local to `RobotsSection`; existing `GET /api/fetch-url?url=`.
- Produces: on mount, if `?url=` is present, `RobotsSection` prefills its URL input and runs `fetchFromUrl(url, 'robots')` once.

**Note on Suspense (build-gate risk):** `useSearchParams()` in a statically-rendered route triggers a Next 15 build error unless it is under a `<Suspense>` boundary. The page's default export must wrap its returned tree in `<Suspense fallback={null}>`. Verify at `npm run build` (Task 14).

- [ ] **Step 1: Write the failing test**

```tsx
// app/(app)/robots-validator/param-autorun.test.tsx
// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const searchMock = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchMock.params,
  useRouter: () => ({ push: vi.fn() }),
}))

import RobotsValidatorPage from './page'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('robots-validator ?url= auto-run', () => {
  it('fetches the robots.txt for the url param on mount', async () => {
    searchMock.params = new URLSearchParams('url=https%3A%2F%2Fexample.com')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: 'User-agent: *\nDisallow:' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<RobotsValidatorPage />)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/fetch-url?url=')),
    )
    expect(fetchMock.mock.calls[0][0]).toContain(encodeURIComponent('https://example.com'))
  })

  it('does not auto-fetch when no url param is present', async () => {
    searchMock.params = new URLSearchParams()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<RobotsValidatorPage />)
    // give any mount effect a tick
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(app)/robots-validator/param-autorun.test.tsx"`
Expected: FAIL — no auto-run wired yet (fetch not called with the param).

- [ ] **Step 3: Write minimal implementation**

Read the current file first to find the exact `RobotsSection` signature and `fetchFromUrl`/`setUrlInput` locations (verified: `fetchFromUrl(targetUrl, 'robots')` and a `urlInput` state exist in `RobotsSection`). Add, at the top of `RobotsSection`'s body, a mount effect:

```tsx
// Inside RobotsSection, alongside the other hooks:
import { useRef } from 'react' // add if not already imported
import { useSearchParams } from 'next/navigation' // add to the existing next/navigation import if present

const searchParams = useSearchParams()
const autoRanRef = useRef(false)

// Auto-run when arriving from the homepage Quick-Robots widget (?url=…).
// The ref guard makes it fire exactly once — React 19 dev StrictMode double-
// invokes mount effects, which would otherwise fetch twice (Codex fix 4).
useEffect(() => {
  if (autoRanRef.current) return
  const initial = searchParams.get('url')
  if (initial) {
    autoRanRef.current = true
    setUrlInput(initial)
    void fetchFromUrl(initial, 'robots')
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

Then wrap the default export's returned tree in a Suspense boundary so `useSearchParams` is legal during static generation:

```tsx
import { Suspense } from 'react'

export default function RobotsValidatorPage() {
  return (
    <Suspense fallback={null}>
      <RobotsValidatorContent />
    </Suspense>
  )
}
```

Rename the existing default-export body to `function RobotsValidatorContent()` (it already renders `RobotsSection`/`SitemapSection`/`BotReferenceSection`). If `RobotsSection` is where `useSearchParams` lives, the `<Suspense>` at the page root covers it. Match the surrounding file's import style and keep every existing `dark:` class.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "app/(app)/robots-validator/param-autorun.test.tsx"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/robots-validator/page.tsx" "app/(app)/robots-validator/param-autorun.test.tsx"
git commit -m "feat(robots-validator): read ?url= and auto-run on mount (Suspense-wrapped)"
```

---

## Task 13: Widget registry + DashboardGrid + homepage swap

**Files:**
- Create: `lib/widgets/registry.tsx`
- Create: `components/widgets/DashboardGrid.tsx`
- Modify: `app/(app)/page.tsx` (delete brochure content; render header + `<DashboardGrid />`)
- Test: `lib/widgets/registry.test.tsx`
- Test: `components/widgets/DashboardGrid.test.tsx`

**Interfaces:**
- Consumes: all seven widget components (Tasks 5–11); `WidgetDef`, `LayoutItem`, `WidgetSize` (Task 1); `spanClass` (Task 1); `WidgetFrame`, `WidgetErrorBoundary` (Task 3).
- Produces: `WIDGETS: WidgetDef[]`; `DEFAULT_LAYOUT: LayoutItem[]`; `DashboardGrid()` (client) renders `DEFAULT_LAYOUT` in order, each widget wrapped in `WidgetErrorBoundary` → `spanClass` div → `WidgetFrame` → `<Component size />`.

- [ ] **Step 1: Write the failing tests**

```tsx
// lib/widgets/registry.test.tsx
import { describe, it, expect } from 'vitest'
import { WIDGETS, DEFAULT_LAYOUT } from './registry'

describe('widget registry', () => {
  it('every widget has a valid shape and defaultSize ∈ sizes', () => {
    for (const w of WIDGETS) {
      expect(typeof w.id).toBe('string')
      expect(typeof w.title).toBe('string')
      expect(w.sizes.length).toBeGreaterThan(0)
      expect(w.sizes).toContain(w.defaultSize)
      expect(typeof w.Component).toBe('function')
    }
  })
  it('widget ids are unique', () => {
    const ids = WIDGETS.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every DEFAULT_LAYOUT item references a registered widget and a supported size', () => {
    for (const item of DEFAULT_LAYOUT) {
      const w = WIDGETS.find((x) => x.id === item.id)
      expect(w, `layout id ${item.id} must be registered`).toBeTruthy()
      expect(w!.sizes).toContain(item.size)
    }
  })
  it('does NOT register deferred aggregate widgets (PR 3.5)', () => {
    const ids = WIDGETS.map((w) => w.id)
    expect(ids).not.toContain('kpi-strip')
    expect(ids).not.toContain('needs-attention')
  })
})
```

```tsx
// components/widgets/DashboardGrid.test.tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

// Stub all data/router deps so the grid renders without real fetches.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/widgets/queue-poll', () => ({ useQueueStatus: () => ({ data: { active: null, queued: [], batch: null }, error: false, loading: false }) }))

import { DashboardGrid } from './DashboardGrid'
import { WIDGETS } from '@/lib/widgets/registry'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('DashboardGrid', () => {
  it('renders a frame titled for every widget in the default layout', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    render(<DashboardGrid />)
    // Titles come from the registry; at least the fixed set should be present.
    for (const title of ['Live now', 'Start a site audit', 'Recent parses']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0)
    }
    // Sanity: registry has exactly the seven PR-2 widgets.
    expect(WIDGETS.length).toBe(7)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/widgets/registry.test.tsx components/widgets/DashboardGrid.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```tsx
// lib/widgets/registry.tsx
// Authoritative list of homepage widgets + the PR-2 fixed default layout.
// PR 3 adds edit/persistence; PR 3.5 adds the KPI strip + Needs-attention
// aggregate widgets (deliberately absent here — their loaders are unverified).
import type { WidgetDef, LayoutItem } from './types'
import { LiveNowWidget } from '@/components/widgets/LiveNowWidget'
import { RecentParsesWidget } from '@/components/widgets/RecentParsesWidget'
import { QuarterWeekWidget } from '@/components/widgets/QuarterWeekWidget'
import { QuickSiteAuditWidget } from '@/components/widgets/QuickSiteAuditWidget'
import { QuickParserWidget } from '@/components/widgets/QuickParserWidget'
import { QuickReportWidget } from '@/components/widgets/QuickReportWidget'
import { QuickRobotsWidget } from '@/components/widgets/QuickRobotsWidget'

export const WIDGETS: WidgetDef[] = [
  { id: 'live-now', title: 'Live now', sizes: ['sm', 'wide', 'lg'], defaultSize: 'lg', Component: LiveNowWidget },
  { id: 'quick-site-audit', title: 'Start a site audit', sizes: ['sm', 'wide'], defaultSize: 'wide', Component: QuickSiteAuditWidget },
  { id: 'quick-parser', title: 'Parse a Screaming Frog export', sizes: ['sm', 'wide'], defaultSize: 'wide', Component: QuickParserWidget },
  { id: 'quick-report', title: 'Generate a performance report', sizes: ['sm', 'wide'], defaultSize: 'wide', Component: QuickReportWidget },
  { id: 'quarter-week', title: 'Quarter Grid — this week', sizes: ['sm', 'wide'], defaultSize: 'wide', Component: QuarterWeekWidget },
  { id: 'recent-parses', title: 'Recent parses', sizes: ['sm', 'lg'], defaultSize: 'lg', Component: RecentParsesWidget },
  { id: 'quick-robots', title: 'Check robots.txt', sizes: ['sm'], defaultSize: 'sm', Component: QuickRobotsWidget },
]

// Fixed PR-2 order (no persistence). Grid auto-flow packs the spans.
export const DEFAULT_LAYOUT: LayoutItem[] = [
  { id: 'live-now', size: 'lg' },
  { id: 'quick-site-audit', size: 'wide' },
  { id: 'quick-parser', size: 'wide' },
  { id: 'quick-report', size: 'wide' },
  { id: 'quarter-week', size: 'wide' },
  { id: 'recent-parses', size: 'lg' },
  { id: 'quick-robots', size: 'sm' },
]
```

```tsx
// components/widgets/DashboardGrid.tsx
'use client'
import { WIDGETS, DEFAULT_LAYOUT } from '@/lib/widgets/registry'
import { spanClass } from '@/lib/widgets/grid'
import { WidgetFrame, WidgetErrorBoundary } from './WidgetFrame'

export function DashboardGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 auto-rows-[minmax(190px,auto)]">
      {DEFAULT_LAYOUT.map((item) => {
        const widget = WIDGETS.find((w) => w.id === item.id)
        if (!widget) return null
        const Body = widget.Component
        return (
          <div key={item.id} className={spanClass(item.size)}>
            <WidgetErrorBoundary title={widget.title}>
              <WidgetFrame title={widget.title}>
                <Body size={item.size} />
              </WidgetFrame>
            </WidgetErrorBoundary>
          </div>
        )
      })}
    </div>
  )
}
```

Now replace `app/(app)/page.tsx` entirely (delete the brochure `tools` array, all local icon components, `HeroVisual`, `ToolCard`, `stats`, and the marketing sections):

```tsx
// app/(app)/page.tsx
import { DashboardGrid } from '@/components/widgets/DashboardGrid'

export const metadata = { title: 'Dashboard' }

export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-extrabold text-navy dark:text-white">Dashboard</h1>
        <p className="font-body text-[14px] text-gray-500 dark:text-white/50">
          Start any tool inline — you&apos;ll land right in the live flow.
        </p>
      </header>
      <DashboardGrid />
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/widgets/registry.test.tsx components/widgets/DashboardGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/widgets/registry.tsx lib/widgets/registry.test.tsx components/widgets/DashboardGrid.tsx components/widgets/DashboardGrid.test.tsx "app/(app)/page.tsx"
git commit -m "feat(widgets): registry + DashboardGrid; replace brochure homepage with dashboard"
```

---

## Task 14: Full gates + dead-code sweep

**Files:**
- (no new source) — verification + any fixup the gates surface.

- [ ] **Step 1: Dead-reference sweep for the deleted homepage exports**

Run: `grep -rn "HeroVisual\|ToolCard" app components lib --include=*.ts --include=*.tsx`
Expected: only historical references, none importing from `app/(app)/page.tsx`. If any test or component imported symbols from the old homepage, fix or delete it. (Verified during planning: no `*.test.*` referenced `HomePage`/`(app)/page`.)

- [ ] **Step 2: Typecheck**

Run: `npm run lint`
Expected: PASS (`tsc --noEmit`, no errors). Fix any type errors before proceeding.

- [ ] **Step 3: Full test suite**

Run: `DATABASE_URL="file:./local-dev.db" npm test`
Expected: PASS — all prior tests green (the shell wraps, doesn't alter, existing pages) plus the new widget/primitive/registry/robots tests.

- [ ] **Step 4: Production build (catches the Suspense/useSearchParams gate + minification)**

Run: `npm run build`
Expected: PASS with no `useSearchParams() should be wrapped in a suspense boundary` error for `/robots-validator` and no other build errors.

- [ ] **Step 5: Commit any gate fixups**

```bash
git add -A -- ':!pentest-results' ':!googlefc472dc61896519a.html' ':!SEO_Report_1st_Draft.pdf'
git commit -m "chore(widgets): gate fixups (tsc/test/build green)" || echo "nothing to commit"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage (§3.3, §4, §5, §8 PR 2):**
- Widget model (WidgetSize/WidgetDef, sizes) → Task 1. ✓
- CSS-grid 4/2/1 columns, size→span, `size`-driven density → Task 1 (spanClass) + Task 13 (grid) + per-widget size branches. ✓
- v1 verified-source widget set (7 widgets, PR-2 column) → Tasks 5–11. ✓
- Aggregate widgets DEFERRED (not registered) → Task 13 registry test asserts absence. ✓
- Quick-start → live-flow routing (§4): site audit→`/ada-audit/site/[id]`, parser→`/seo-parser/results/[sessionId]`, report→`/reports`, robots→`/robots-validator?url=` + new param-read → Tasks 8–12. ✓
- Shared primitives extracted as needed (§5): StatusPill, ScoreRing, DropZone → Task 2 (KpiTile/CopyButton/HistoryTable NOT needed in PR 2, correctly omitted). ✓
- Fault isolation (§6) → WidgetErrorBoundary (Task 3) + per-widget degraded states (Tasks 5–7). ✓
- Shared poller (§9) → Task 4. ✓
- Old homepage deleted, deployable, no edit mode → Task 13 + Task 14. ✓
- Testing (§7): registry shape, widget render per size + degraded, quick-start POST→redirect, existing tests stay green → Tasks 1–14. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N"; every code step shows complete code. ✓

**3. Type consistency:** `WidgetSize`/`WidgetDef`/`LayoutItem` defined in Task 1 and used verbatim in Tasks 5–13; `useQueueStatus()` return shape defined in Task 4 and consumed in Task 5; `uploadAndParse` signature defined in Task 9 and consumed in Task 9's widget; `resolveCurrentWeek` defined + consumed in Task 7. ✓

**Codex review (2026-07-07, session turn 28): ACCEPT-WITH-FIXES ×6 — all applied in place:**
1. Task 4 — shared queue store now uses `useSyncExternalStore` + an `inFlight` guard (dropped-tick test added).
2. Task 10 — report period moved out of render into a mount `useEffect`, computed in UTC (parity with `GenerateReportForm`); button/display guard the null placeholder.
3. Task 7 — `Plan.startDate` widened to `string | null`, `Assignment.position` added; current-week clients sorted by `position ?? Infinity` then priority then clientId.
4. Task 12 — robots auto-run gets a `useRef` one-shot guard against React 19 StrictMode double-invoke; Codex confirmed the page-root `<Suspense>` is the correct minimal Next-15 fix.
5. Task 9 — added a two-batch split test asserting the second `/api/upload` carries the first `sessionId` and parse fires once.
6. Tests — `vi.unstubAllGlobals()` added to `afterEach` in every test that stubs global `fetch` (repo convention).

Codex confirmed all seven data-contract claims against the live route handlers. Default layout sizes/order (Task 13 `DEFAULT_LAYOUT`) remain a Kevin-tunable judgment call.
