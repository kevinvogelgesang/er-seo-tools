# ADA Audit Dashboard — Queue Access Redesign Implementation Plan (PR 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two persistent, always-visible status cards between the "New Audit" card and the "Clients" section on `/ada-audit` — Current Scan + Queue — so operators can navigate to the active site detail page or the dedicated queue page with one click, regardless of which tab they're on. Lift the existing `/api/site-audit/queue` poll out of `SiteAuditForm` and `SiteAuditHistory` into the shared parent `AuditIndexTabs`, so there's only one queue poll on the dashboard.

**Architecture:** `AuditIndexTabs` owns the 5s queue poll and passes `queueStatus: QueueStatusWithBatch | null` down to three children: the new `DashboardQueueStatus` cards, the existing `SiteAuditForm` banner, and `SiteAuditHistory`. Phase-label logic (pages vs pdfs vs lighthouse) is extracted from the inline IIFE in `SiteAuditForm` into a pure helper `computeActivePhaseSummary(active)` in `lib/ada-audit/queue-ui-helpers.ts`, unit-tested with vitest. `DashboardQueueStatus` is presentational and verified manually.

**Tech Stack:** Next.js 15 App Router · TypeScript · Tailwind CSS · vitest

**Companion spec:** `docs/superpowers/specs/2026-05-20-ada-dashboard-queue-access-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/ada-audit/queue-ui-helpers.ts` | Create | Pure `computeActivePhaseSummary(active)` returning `{ label, complete, total, pct, unit }`. No imports beyond the active-row type from `lib/ada-audit/types.ts`. |
| `lib/ada-audit/queue-ui-helpers.test.ts` | Create | Vitest unit tests for the helper — covers `running`, `pdfs-running`, `lighthouse-running`, `pending`, `total === 0`, and pct computation including error counts. |
| `components/ada-audit/DashboardQueueStatus.tsx` | Create | Two-card grid (Current Scan + Queue). Pure render, no internal fetch. Branches across pre-first-poll skeleton, idle, and active states. |
| `components/ada-audit/AuditIndexTabs.tsx` | Modify | Owns the 5s queue poll, holds `queueStatus` state, renders `<DashboardQueueStatus>` between New Audit and `<ClientsAuditSummary>`, passes `queueStatus` to `<SiteAuditForm>` and `<SiteAuditHistory>`. |
| `components/ada-audit/SiteAuditForm.tsx` | Modify | Accepts `queueStatus` prop. Removes local `QueueStatus` interface, internal `useEffect` poll, and `queueTimerRef`. Banner now calls `computeActivePhaseSummary` instead of the inline IIFE. |
| `components/ada-audit/SiteAuditHistory.tsx` | Modify | Accepts `queueStatus` prop. Removes its own `/api/site-audit/queue` 5s polling loop. Reuses the lifted status to drive its audit-list refresh decisions. |
| `components/ada-audit/QueueActiveView.tsx` | Modify | Cosmetic: swap `<a href="/ada-audit">` to `<Link href="/ada-audit">` in the empty-state line. |
| `lib/ada-audit/types.ts` | No change | `QueueStatusWithBatch` is already a structural superset of the local `QueueStatus` interface being deleted. |

---

### Task 1: Branch + working tree

**Files:** none

- [ ] **Step 1: Pull latest main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feat/ada-dashboard-queue-access
```

---

### Task 2: Create `computeActivePhaseSummary` helper — TDD

**Files:**
- Create: `lib/ada-audit/queue-ui-helpers.ts`
- Test: `lib/ada-audit/queue-ui-helpers.test.ts`

**Why first:** the helper is consumed by both the new `DashboardQueueStatus` card (Task 4) and the existing `SiteAuditForm` banner (Task 6). Landing it first as a pure, tested unit avoids duplicating the phase logic and makes the later component edits straightforward.

- [ ] **Step 1: Write the failing tests**

Create `lib/ada-audit/queue-ui-helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeActivePhaseSummary } from './queue-ui-helpers'
import type { QueueStatusWithBatch } from './types'

type Active = NonNullable<QueueStatusWithBatch['active']>

function active(overrides: Partial<Active> = {}): Active {
  return {
    id: 'sa-1',
    domain: 'example.edu',
    status: 'running',
    pagesTotal: 0,
    pagesComplete: 0,
    pagesError: 0,
    pdfsTotal: 0,
    pdfsComplete: 0,
    pdfsError: 0,
    lighthouseTotal: 0,
    lighthouseComplete: 0,
    lighthouseError: 0,
    clientId: null,
    ...overrides,
  }
}

describe('computeActivePhaseSummary', () => {
  it('returns the pages phase for status=running', () => {
    const a = active({ status: 'running', pagesTotal: 30, pagesComplete: 12, pagesError: 0 })
    const out = computeActivePhaseSummary(a)
    expect(out.label).toBe('Scanning pages')
    expect(out.unit).toBe('pages')
    expect(out.complete).toBe(12)
    expect(out.total).toBe(30)
    expect(out.pct).toBe(40)
  })

  it('returns the pdfs phase for status=pdfs-running', () => {
    const a = active({ status: 'pdfs-running', pdfsTotal: 10, pdfsComplete: 5, pdfsError: 0 })
    const out = computeActivePhaseSummary(a)
    expect(out.label).toBe('Scanning PDFs')
    expect(out.unit).toBe('PDFs')
    expect(out.complete).toBe(5)
    expect(out.total).toBe(10)
    expect(out.pct).toBe(50)
  })

  it('returns the lighthouse phase for status=lighthouse-running', () => {
    const a = active({ status: 'lighthouse-running', lighthouseTotal: 20, lighthouseComplete: 14, lighthouseError: 1 })
    const out = computeActivePhaseSummary(a)
    expect(out.label).toBe('Running Lighthouse')
    expect(out.unit).toBe('pages')
    expect(out.complete).toBe(15)   // includes errors
    expect(out.total).toBe(20)
    expect(out.pct).toBe(75)
  })

  it('falls through to pages phase for status=pending', () => {
    const a = active({ status: 'pending', pagesTotal: 0, pagesComplete: 0 })
    const out = computeActivePhaseSummary(a)
    expect(out.label).toBe('Scanning pages')
    expect(out.unit).toBe('pages')
    expect(out.total).toBe(0)
  })

  it('returns pct=0 when total is 0 (discovery phase, not divide-by-zero)', () => {
    const a = active({ status: 'running', pagesTotal: 0, pagesComplete: 0, pagesError: 0 })
    expect(computeActivePhaseSummary(a).pct).toBe(0)
  })

  it('counts errors toward complete when computing pct', () => {
    const a = active({ status: 'running', pagesTotal: 10, pagesComplete: 7, pagesError: 3 })
    const out = computeActivePhaseSummary(a)
    expect(out.complete).toBe(10)
    expect(out.pct).toBe(100)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-ui-helpers.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

Create `lib/ada-audit/queue-ui-helpers.ts`:

```typescript
import type { QueueStatusWithBatch } from './types'

type Active = NonNullable<QueueStatusWithBatch['active']>

export interface ActivePhaseSummary {
  label: string
  complete: number
  total: number
  pct: number
  unit: 'pages' | 'PDFs'
}

/**
 * Pure derivation of the active scan's current phase + progress, mirroring
 * the inline IIFE in SiteAuditForm's queue banner. Consumed by:
 *   - DashboardQueueStatus (Current Scan card progress bar)
 *   - SiteAuditForm        (queue banner copy)
 *
 * `pending` falls through to the pages-phase branch — the queue manager can
 * briefly publish active.status='pending' between enqueue and runner pickup;
 * a page-phase label with zeros is the right user-facing shape.
 */
export function computeActivePhaseSummary(active: Active): ActivePhaseSummary {
  const phase: 'pages' | 'pdfs' | 'lighthouse' =
    active.status === 'lighthouse-running' ? 'lighthouse'
    : active.status === 'pdfs-running' ? 'pdfs'
    : 'pages'

  if (phase === 'lighthouse') {
    const complete = active.lighthouseComplete + active.lighthouseError
    const total = active.lighthouseTotal
    return {
      label: 'Running Lighthouse',
      complete,
      total,
      pct: total > 0 ? Math.round((complete / total) * 100) : 0,
      unit: 'pages',
    }
  }

  if (phase === 'pdfs') {
    const complete = active.pdfsComplete + active.pdfsError
    const total = active.pdfsTotal
    return {
      label: 'Scanning PDFs',
      complete,
      total,
      pct: total > 0 ? Math.round((complete / total) * 100) : 0,
      unit: 'PDFs',
    }
  }

  const complete = active.pagesComplete + active.pagesError
  const total = active.pagesTotal
  return {
    label: 'Scanning pages',
    complete,
    total,
    pct: total > 0 ? Math.round((complete / total) * 100) : 0,
    unit: 'pages',
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-ui-helpers.test.ts
```

Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/queue-ui-helpers.ts lib/ada-audit/queue-ui-helpers.test.ts
git commit -m "feat(ada-audit): pure computeActivePhaseSummary helper + tests"
```

---

### Task 3: Build `<DashboardQueueStatus>` component

**Files:**
- Create: `components/ada-audit/DashboardQueueStatus.tsx`

**Why now:** the component is presentational and prop-only. Building it before the wiring in `AuditIndexTabs` makes the wiring step trivial. Manual verification happens in Task 8 against the running dev server (no React testing stack in the repo).

- [ ] **Step 1: Create the component**

The JSX below is intentionally complete — copy-paste verbatim, then adjust only if a Tailwind class or copy string is wrong.

```tsx
'use client'

import Link from 'next/link'
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'
import { computeActivePhaseSummary } from '@/lib/ada-audit/queue-ui-helpers'

interface Props {
  queueStatus: QueueStatusWithBatch | null
}

const CARD_CHROME =
  'bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm overflow-hidden'

const HEADER_CHROME =
  'px-5 py-3.5 border-b border-gray-100 dark:border-navy-border bg-gray-50 dark:bg-navy-deep flex items-center justify-between'

const BODY_CHROME = 'px-5 py-4'

const MUTED_TEXT = 'text-[13px] font-body text-navy/40 dark:text-white/40'

/**
 * Two-card grid surfacing the live queue state at the top of /ada-audit.
 * Pure presentational — does not fetch. `AuditIndexTabs` owns the 5s poll
 * and passes the resulting `QueueStatusWithBatch | null` down.
 *
 * Render states:
 *   - queueStatus === null              → pre-first-poll skeleton
 *   - active === null && queued === []  → idle (non-link headers, opacity-40)
 *   - active !== null                   → Current Scan card live
 *   - queued.length > 0                 → Queue card live (with count + preview)
 */
export default function DashboardQueueStatus({ queueStatus }: Props) {
  // Pre-first-poll skeleton — don't lie about idle state before we know.
  if (queueStatus === null) {
    return (
      <div className="grid grid-cols-2 gap-4">
        <SkeletonCard title="Current Scan" />
        <SkeletonCard title="Queue" />
      </div>
    )
  }

  const { active, queued } = queueStatus

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Current Scan card */}
      {active ? (
        <Link href={`/ada-audit/site/${active.id}`} className={`${CARD_CHROME} hover:border-orange/40 transition-colors block`}>
          <div className={HEADER_CHROME}>
            <h3 className="font-display font-bold text-[14px] text-navy dark:text-white">Current Scan</h3>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-orange">Live</span>
          </div>
          <CurrentScanBody active={active} />
        </Link>
      ) : (
        <div className={`${CARD_CHROME} opacity-40`}>
          <div className={HEADER_CHROME}>
            <h3 className="font-display font-bold text-[14px] text-navy dark:text-white">Current Scan</h3>
          </div>
          <div className={BODY_CHROME}>
            <p className={MUTED_TEXT}>No scans running or queued</p>
          </div>
        </div>
      )}

      {/* Queue card */}
      {queued.length > 0 ? (
        <Link href="/ada-audit/queue" className={`${CARD_CHROME} hover:border-orange/40 transition-colors block`}>
          <div className={HEADER_CHROME}>
            <h3 className="font-display font-bold text-[14px] text-navy dark:text-white">Queue ({queued.length})</h3>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-orange">View all</span>
          </div>
          <QueueBody queued={queued} />
        </Link>
      ) : active ? (
        <Link href="/ada-audit/queue" className={`${CARD_CHROME} hover:border-orange/40 transition-colors block`}>
          <div className={HEADER_CHROME}>
            <h3 className="font-display font-bold text-[14px] text-navy dark:text-white">Queue</h3>
          </div>
          <div className={BODY_CHROME}>
            <p className={MUTED_TEXT}>No audits waiting</p>
          </div>
        </Link>
      ) : (
        <div className={`${CARD_CHROME} opacity-40`}>
          <div className={HEADER_CHROME}>
            <h3 className="font-display font-bold text-[14px] text-navy dark:text-white">Queue</h3>
          </div>
          <div className={BODY_CHROME}>
            <p className={MUTED_TEXT}>No scans running or queued</p>
          </div>
        </div>
      )}
    </div>
  )
}

function SkeletonCard({ title }: { title: string }) {
  return (
    <div className={CARD_CHROME}>
      <div className={HEADER_CHROME}>
        <h3 className="font-display font-bold text-[14px] text-navy dark:text-white">{title}</h3>
      </div>
      <div className={BODY_CHROME}>
        <div className="space-y-2 animate-pulse">
          <div className="h-3 w-2/3 bg-gray-100 dark:bg-navy-light rounded" />
          <div className="h-2 w-full bg-gray-100 dark:bg-navy-light rounded" />
        </div>
      </div>
    </div>
  )
}

function CurrentScanBody({ active }: { active: NonNullable<QueueStatusWithBatch['active']> }) {
  const { label, complete, total, pct, unit } = computeActivePhaseSummary(active)
  return (
    <div className={BODY_CHROME}>
      <p className="font-display font-bold text-[14px] text-navy dark:text-white truncate">{active.domain}</p>
      <p className="text-[12px] font-body text-navy/60 dark:text-white/60 mt-1">
        {label}
        {total > 0
          ? <> · {complete} / {total} ({pct}%)</>
          : <> · Discovering {unit}…</>
        }
      </p>
      {total > 0 && (
        <div className="mt-2 w-full bg-gray-100 dark:bg-navy-light rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-orange h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

function QueueBody({ queued }: { queued: QueueStatusWithBatch['queued'] }) {
  const n = queued.length
  const previewDomains = queued.slice(0, 3).map((q) => q.domain).join(', ')
  const overflow = n > 3 ? `, …and ${n - 3} more` : ''
  return (
    <div className={BODY_CHROME}>
      <p className="font-body font-semibold text-[14px] text-navy dark:text-white">
        {n} audit{n !== 1 ? 's' : ''} waiting
      </p>
      <p className="text-[12px] font-body text-navy/50 dark:text-white/50 mt-1 truncate">
        {previewDomains}{overflow}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run lint
```

Expected: PASS — component is self-contained and has no callers yet.

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/DashboardQueueStatus.tsx
git commit -m "feat(ada-audit): add DashboardQueueStatus two-card status component"
```

---

### Task 4: Lift the queue poll into `AuditIndexTabs`

**Files:**
- Modify: `components/ada-audit/AuditIndexTabs.tsx`

**Why:** `SiteAuditForm` and `SiteAuditHistory` each currently run a 5s `/api/site-audit/queue` poll. With the new dashboard cards joining the page, that would be three pollers for the same data. Lifting the fetch to the shared parent and prop-threading the result eliminates the duplication and gives the new cards data without yet another timer.

- [ ] **Step 1: Read the current file**

```bash
sed -n '1,100p' components/ada-audit/AuditIndexTabs.tsx
```

Confirm the imports already include `SiteAuditForm`, `AuditHistory`, `SiteAuditHistory`, `ClientsAuditSummary`, and that the rendered tree is the `space-y-8` stack described in the spec.

- [ ] **Step 2: Add imports + queue state + 5s poller**

At the top of the file, add (next to existing imports):

```typescript
import { useEffect, useState } from 'react'
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'
import DashboardQueueStatus from './DashboardQueueStatus'
```

(If `useEffect`/`useState` are already imported from `react`, merge — don't double-import.)

Inside the component body, **mirror the existing pattern in `SiteAuditForm.tsx`** for the polling loop. The current SiteAuditForm pattern (which we're lifting verbatim, then deleting from SiteAuditForm in Task 5) is:

```typescript
const [queueStatus, setQueueStatus] = useState<QueueStatusWithBatch | null>(null)

useEffect(() => {
  let cancelled = false
  const fetchQueue = async () => {
    try {
      const res = await fetch('/api/site-audit/queue')
      if (!cancelled && res.ok) {
        setQueueStatus(await res.json())
      }
    } catch { /* ignore */ }
  }
  void fetchQueue()
  const timer = setInterval(fetchQueue, 5000)
  return () => {
    cancelled = true
    clearInterval(timer)
  }
}, [])
```

Notes on what changed vs. the original `SiteAuditForm` pattern:

- Uses a local `timer` const + `cancelled` flag instead of a `useRef<ReturnType<typeof setInterval>>`. Semantically equivalent and simpler at the parent level — no other code in this file needs the timer ref.
- The `cancelled` flag guards against a late-resolving fetch firing `setState` after unmount.
- Empty deps array — mount-once, single interval, single cleanup. No double-fire on mount.

- [ ] **Step 3: Render `<DashboardQueueStatus>` and pass `queueStatus` down**

Locate the JSX block that renders the New Audit card → `<ClientsAuditSummary />` → `<AuditHistory />` → `<SiteAuditHistory />`. Insert the new cards between the New Audit card and `<ClientsAuditSummary />`, and pass the prop through to the two existing children:

```tsx
{tab === 'single' ? <AuditForm /> : <SiteAuditForm queueStatus={queueStatus} />}

{/* … New Audit card closing tag, then … */}

<DashboardQueueStatus queueStatus={queueStatus} />

<ClientsAuditSummary />

<AuditHistory />
<SiteAuditHistory queueStatus={queueStatus} />
```

The exact placement: `DashboardQueueStatus` goes inside the existing `space-y-8` stack at the same nesting depth as `<ClientsAuditSummary />`, just above it. Don't wrap it in any extra container — the parent stack handles spacing.

- [ ] **Step 4: Typecheck**

```bash
npm run lint
```

Expected: FAIL — TS will complain that `SiteAuditForm` and `SiteAuditHistory` don't accept `queueStatus` props yet. That gets fixed in Tasks 5 and 6.

To unblock the build mid-task, you can temporarily skip the prop pass-through and re-add it after Tasks 5–6, **but** the cleaner path is to land Tasks 4 → 5 → 6 in sequence with one commit each; the intermediate `npm run lint` will be red on the SiteAuditForm/SiteAuditHistory props until those files are updated. That is expected.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/AuditIndexTabs.tsx
git commit -m "feat(ada-audit): lift queue poll into AuditIndexTabs and render dashboard status cards"
```

---

### Task 5: Update `SiteAuditForm` to consume the lifted prop

**Files:**
- Modify: `components/ada-audit/SiteAuditForm.tsx`

- [ ] **Step 1: Replace the local `QueueStatus` interface and add the prop**

In `components/ada-audit/SiteAuditForm.tsx`, around lines 15–31, delete the local `QueueStatus` interface entirely.

At the top of the file (next to other imports) add:

```typescript
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'
import { computeActivePhaseSummary } from '@/lib/ada-audit/queue-ui-helpers'
```

Update the component signature:

```typescript
interface SiteAuditFormProps {
  queueStatus: QueueStatusWithBatch | null
}

export default function SiteAuditForm({ queueStatus }: SiteAuditFormProps) {
```

- [ ] **Step 2: Delete the internal poll**

Remove the block (currently lines ~71–85) that owns the local state, the `queueTimerRef`, and the `useEffect` calling `/api/site-audit/queue`. Specifically delete:

```typescript
// Queue status polling
const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
const queueTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

useEffect(() => {
  const fetchQueue = async () => {
    try {
      const res = await fetch('/api/site-audit/queue')
      if (res.ok) setQueueStatus(await res.json())
    } catch { /* ignore */ }
  }
  void fetchQueue()
  queueTimerRef.current = setInterval(fetchQueue, 5000)
  return () => { if (queueTimerRef.current) clearInterval(queueTimerRef.current) }
}, [])
```

Also remove the now-unused `useRef` import if no other code in the file uses it (the prefill effect uses `useRef`, so leave it in unless you've verified the only remaining ref is unused).

- [ ] **Step 3: Replace the inline phase IIFE with the shared helper**

Locate the queue banner block (currently around lines 322–396) that opens with:

```tsx
{queueStatus && (queueStatus.active || queueStatus.queued.length > 0) && (
  <div className="bg-blue-50 dark:bg-blue-500/10 …">
    {queueStatus.active && (() => {
      const a = queueStatus.active
      // Phase-aware banner …
      const phase: 'pages' | 'pdfs' | 'lighthouse' = …
      const { label, complete, total, pct } = phase === 'lighthouse' ? { … } : phase === 'pdfs' ? { … } : { … }
      const unit = phase === 'pages' ? 'pages' : phase === 'pdfs' ? 'PDFs' : 'pages'
      return ( … )
    })()}
```

Replace the IIFE body so it calls the shared helper:

```tsx
{queueStatus.active && (() => {
  const a = queueStatus.active
  const { label, complete, total, pct, unit } = computeActivePhaseSummary(a)
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-body font-semibold text-blue-800 dark:text-blue-300">
        {label}: {a.domain}
        <span className="font-normal text-blue-600/60 dark:text-blue-400/60 ml-2">
          {total > 0
            ? `${complete}/${total} ${unit} (${pct}%)`
            : unit === 'pages' ? 'Discovering pages…' : `Awaiting ${unit}…`}
        </span>
      </p>
      {total > 0 && (
        <div className="w-full bg-blue-200/50 dark:bg-blue-500/20 rounded-full h-1.5 overflow-hidden">
          <div className="bg-blue-500 dark:bg-blue-400 h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
})()}
```

The outer render guard (`queueStatus && (queueStatus.active || queueStatus.queued.length > 0)`) stays unchanged — banner stays hidden when `queueStatus === null` or fully empty.

- [ ] **Step 4: Typecheck**

```bash
npm run lint
```

Expected: PASS (assuming Task 4 already added the `queueStatus={queueStatus}` prop in `AuditIndexTabs`).

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/SiteAuditForm.tsx
git commit -m "refactor(ada-audit): consume lifted queueStatus prop in SiteAuditForm"
```

---

### Task 6: Update `SiteAuditHistory` to consume the lifted prop

**Files:**
- Modify: `components/ada-audit/SiteAuditHistory.tsx`

- [ ] **Step 1: Add the prop**

At the top of `components/ada-audit/SiteAuditHistory.tsx`, add:

```typescript
import type { QueueStatusWithBatch } from '@/lib/ada-audit/types'
```

Update the component signature:

```typescript
interface SiteAuditHistoryProps {
  queueStatus: QueueStatusWithBatch | null
}

export default function SiteAuditHistory({ queueStatus }: SiteAuditHistoryProps) {
```

- [ ] **Step 2: Replace the internal `/api/site-audit/queue` poll with the lifted prop**

Locate the smart-polling effect (currently around line 103) that hits `/api/site-audit/queue` every ~5s to detect whether any rows are active/queued. The current shape is:

```typescript
const timer = setInterval(async () => {
  try {
    const res = await fetch('/api/site-audit/queue')
    if (!res.ok) return
    const queue = await res.json()
    // merge queue.active and queue.queued into the local audits state…
  } catch { /* ignore */ }
}, 5000)
```

Two things change:

1. The component no longer fetches `/api/site-audit/queue` directly — it reads `queueStatus` from the prop instead.
2. Audit-list refresh polling (the part that re-queries the audit table itself) stays intact; only the queue lookup is replaced.

Refactor the effect so it reacts to `queueStatus` changes. The real component (`SiteAuditHistory.tsx`) stores paginated data in `data` / `setData` (a `PaginatedResponse<SiteAuditDetail> | null`), NOT `audits` / `setAudits`. The merge must update `data.items`. The current code at lines 103–145 has a critical "completion-edge refresh" branch that calls `fetchPage(true)` when a previously-active row is no longer in `/api/site-audit/queue` — this is what pulls the completed audit's final scorecard data into the table. That branch must be preserved.

```typescript
const previousQueueStatusRef = useRef<QueueStatusWithBatch | null>(null)

useEffect(() => {
  if (!queueStatus) {
    previousQueueStatusRef.current = queueStatus
    return
  }

  const activeIds = new Set<string>()
  if (queueStatus.active) activeIds.add(queueStatus.active.id)
  for (const q of queueStatus.queued) activeIds.add(q.id)

  // Completion-edge refresh: if a row that was active in the LAST snapshot
  // is no longer in the current snapshot, the audit completed — pull fresh
  // data from /api/site-audit so the scorecard, violations, and status flip
  // to their terminal values.
  const current = itemsRef.current
  const wasActive = current.filter((a) => (ACTIVE_STATUSES as readonly string[]).includes(a.status))
  const needsReload = wasActive.some((a) => !activeIds.has(a.id))
  if (needsReload) {
    void fetchPage(true)
    previousQueueStatusRef.current = queueStatus
    return
  }

  // Otherwise: merge live queue counts into the existing rows without
  // re-fetching — preserves the existing per-tick optimisation.
  setData((prev) => {
    if (!prev) return prev
    return {
      ...prev,
      items: prev.items.map((a) => {
        if (queueStatus.active && a.id === queueStatus.active.id) {
          // Preserve `pdfs-running` or `lighthouse-running` if the row already
          // has it — the queue endpoint doesn't return status, and forcing
          // 'running' would visually demote a row that's moved on to PDFs/LH.
          const liveStatus =
            a.status === 'pdfs-running' || a.status === 'lighthouse-running'
              ? a.status
              : 'running'
          return {
            ...a,
            status: liveStatus,
            pagesTotal: queueStatus.active.pagesTotal,
            pagesComplete: queueStatus.active.pagesComplete,
            pagesError: queueStatus.active.pagesError,
          }
        }
        const queuedItem = queueStatus.queued.find((q) => q.id === a.id)
        if (queuedItem && a.status !== 'queued') {
          return { ...a, status: 'queued' }
        }
        return a
      }),
    }
  })

  previousQueueStatusRef.current = queueStatus
}, [queueStatus, fetchPage])
```

Notes:

- The `setInterval` for `/api/site-audit/queue` is **deleted entirely** along with its cleanup. The 5s tick now lives in `AuditIndexTabs`.
- The page-load `useEffect` calling `fetchPage(false)` on mount stays.
- The completion-edge refresh (`needsReload` → `fetchPage(true)`) is preserved verbatim — without it, completed audits stay frozen at "running" in the table until the user navigates pages.
- `itemsRef.current` is already maintained by the existing code at line 107; reuse it.

- [ ] **Step 3: Typecheck**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/SiteAuditHistory.tsx
git commit -m "refactor(ada-audit): consume lifted queueStatus prop in SiteAuditHistory"
```

---

### Task 7: Cosmetic — swap `<a>` for `<Link>` in `QueueActiveView`

**Files:**
- Modify: `components/ada-audit/QueueActiveView.tsx`

- [ ] **Step 1: Confirm the existing line**

```bash
grep -n 'href="/ada-audit"' components/ada-audit/QueueActiveView.tsx
```

Should report the empty-state line: `No audits in flight. Queue some from <a href="/ada-audit" …>/ada-audit</a>.`

- [ ] **Step 2: Replace the anchor**

If `Link` isn't yet imported, add:

```typescript
import Link from 'next/link'
```

Change:

```tsx
No audits in flight. Queue some from <a href="/ada-audit" className="text-orange hover:underline">/ada-audit</a>.
```

to:

```tsx
No audits in flight. Queue some from <Link href="/ada-audit" className="text-orange hover:underline">/ada-audit</Link>.
```

No other functional change.

- [ ] **Step 3: Typecheck**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/QueueActiveView.tsx
git commit -m "refactor(ada-audit): use Link for QueueActiveView empty-state anchor"
```

---

### Task 8: Manual verification + full suite + build

**Files:** none — runtime check.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify pre-first-poll skeleton**

Navigate to `/ada-audit` and use DevTools throttling (or a hard reload) to inspect the first ~250ms. Both cards should render with the pulsing skeleton placeholder bars described in spec §4.3. No "No scans running or queued" text yet.

- [ ] **Step 3: Verify the idle state**

Once the first poll resolves with no active/queued rows: both cards render at `opacity-40`, headers are non-clickable `<div>` elements (try Tab — no focus stop), and the body text reads "No scans running or queued".

- [ ] **Step 4: Trigger an audit and verify the active state**

Queue a small (~10–30 page) site audit from the dashboard. Within 5s, the Current Scan card should:

- Switch to full opacity
- Header becomes a `<Link>` to `/ada-audit/site/[id]`
- Body shows the domain (bold, 14px), the phase label + counts, and the orange progress bar
- Click the header → lands on the detail page

- [ ] **Step 5: Verify the queue card with multiple audits**

Queue 4+ audits in quick succession. The Queue card header should read "Queue (N)", body shows "N audits waiting" and the first three domains with "…and N more" overflow. Click the header → lands on `/ada-audit/queue`.

- [ ] **Step 6: Verify phase transitions**

Watch the Current Scan card across the page-scan → PDF-scan → lighthouse phases of a single audit. The label should change from "Scanning pages" → "Scanning PDFs" → "Running Lighthouse" without the progress bar visually jumping back to 0%. (Each phase reports its own complete/total.)

- [ ] **Step 7: Verify only one queue poll on the wire**

Open DevTools → Network → filter for `queue`. Across a 20-second window with the Full Site tab active, only one `/api/site-audit/queue` request should fire every 5s (vs. two before this PR — one from `SiteAuditForm`, one from `SiteAuditHistory`).

- [ ] **Step 8: Verify `SiteAuditForm` banner still renders**

The blue banner in the Full Site form should continue showing "Scanning pages: example.edu · 12/30 pages (40%)" with the progress bar, identical to today's behaviour — just now fed by the lifted prop.

- [ ] **Step 9: Verify `SiteAuditHistory` still updates live**

Watch the history table while an audit is in flight. Rows for the active audit should still update status pill + counts every 5s as before — just now driven by the prop change instead of an internal fetch.

- [ ] **Step 10: Lint + full test suite + production build**

```bash
npm run lint
DATABASE_URL='file:./local-dev.db' npx vitest run
rm -rf .next && npm run build
```

Expected: PASS, PASS (+6 new tests for `computeActivePhaseSummary`), clean build.

---

### Task 9: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/ada-dashboard-queue-access
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(ada-audit): dashboard queue access cards + lifted poll" --body "$(cat <<'EOF'
## Summary
Adds two persistent status cards (Current Scan + Queue) between the New Audit card and the Clients section on `/ada-audit`, giving operators one-click navigation to the active site detail page or the dedicated `/ada-audit/queue` page regardless of which tab is active. Also lifts the `/api/site-audit/queue` 5s poll out of `SiteAuditForm` and `SiteAuditHistory` into the shared parent `AuditIndexTabs`, so the dashboard runs one queue poll instead of two (now three with the new cards).

## What changed
- New `components/ada-audit/DashboardQueueStatus.tsx` — two-card grid, prop-only render. Pre-first-poll skeleton, idle (non-link headers + opacity-40), and active states per spec §4.3–4.5.
- New `lib/ada-audit/queue-ui-helpers.ts` exporting `computeActivePhaseSummary(active)` — pure function returning `{ label, complete, total, pct, unit }` covering pages / pdfs / lighthouse phases. Unit-tested with vitest (6 cases including `pending` fallback and divide-by-zero guard).
- `AuditIndexTabs.tsx` now owns the 5s queue poll, holds `queueStatus` state, renders `<DashboardQueueStatus>` above `<ClientsAuditSummary>`, and threads `queueStatus` into `<SiteAuditForm>` + `<SiteAuditHistory>`.
- `SiteAuditForm.tsx` accepts `queueStatus` as a prop, drops its local `QueueStatus` interface + `useEffect` poll + `queueTimerRef`, and replaces its inline phase IIFE with `computeActivePhaseSummary`. Banner render unchanged user-facing.
- `SiteAuditHistory.tsx` accepts `queueStatus` as a prop and drops its internal `/api/site-audit/queue` polling loop. Audit-list refresh polling is unaffected; only the queue lookup is replaced with a `useEffect` keyed on the lifted prop.
- `QueueActiveView.tsx` cosmetic: empty-state `<a href="/ada-audit">` → `<Link>` for codebase consistency.

## Test plan
- [x] `computeActivePhaseSummary` unit tests: running, pdfs-running, lighthouse-running, pending fallback, total=0 → pct=0, error counts in pct
- [x] Manual: pre-first-poll skeleton renders briefly; idle state non-clickable + opacity-40; active state shows domain + phase label + progress; phase transitions across pages → pdfs → lighthouse; queue card shows count badge + 3-domain preview + overflow
- [x] DevTools network: one `/api/site-audit/queue` request every 5s on the dashboard (was two)
- [x] Existing SiteAuditForm banner + SiteAuditHistory live status pills still update
- [x] Full test suite passes (+6 new)
- [x] Production build passes

## Out of scope
- Redesigning queue page content (`QueueActiveView`, `QueueHistoryView`, `QueuePageTabs` unchanged)
- Queue management actions from the dashboard (cancel, reorder, priority bump)
- Replacing the `SiteAuditForm` banner — kept as contextual reminder; new cards are primary nav

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return PR URL**

---

## Self-review checklist

- [x] **Spec coverage**: every spec section maps to a task. Helper extraction → Task 2. New component → Task 3. Lifted poll → Task 4. SiteAuditForm refactor → Task 5. SiteAuditHistory refactor → Task 6. QueueActiveView cosmetic → Task 7.
- [x] **No placeholders**: code blocks are complete and ready to paste. The `<DashboardQueueStatus>` JSX is shown in full per the user's instruction.
- [x] **TDD where applicable**: pure helper is tested in Task 2 before consumers wire to it. Presentational component is manually verified per the constraint.
- [x] **Type consistency**: `QueueStatusWithBatch | null` is the prop type across `DashboardQueueStatus`, `SiteAuditForm`, and `SiteAuditHistory`. Already a structural superset of the old `SiteAuditForm`-local `QueueStatus` interface (extra `clientId` + `batch` fields), so banner render logic is unchanged.
- [x] **Polling pattern shown verbatim**: Task 4 inlines the lifted `useEffect`, including the `cancelled` flag and empty deps array. No double-fire on mount, single cleanup on unmount.
- [x] **One queue poll on the dashboard**: Tasks 5 and 6 explicitly delete the per-component pollers; Task 8 step 7 verifies this in DevTools.
- [x] **Commit conventions**: `feat(ada-audit):` for new functionality, `refactor(ada-audit):` for the prop-lift commits.
- [x] **Run commands match constraints**: dev `npm run dev`, test `DATABASE_URL='file:./local-dev.db' npx vitest run`, lint `npm run lint`, build `rm -rf .next && npm run build`.
