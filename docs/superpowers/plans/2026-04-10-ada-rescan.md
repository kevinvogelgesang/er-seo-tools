# ADA Audit Re-scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Re-scan" button to the ADA audit per-page view that creates a new audit record with the same URL/WCAG settings, and shows a dismissable comparison banner on the new audit page with the before/after score.

**Architecture:** A small `ReScanButton` client component handles the POST + redirect. A `RescanBanner` client component displays on the new audit page when a `?from=<oldId>` query param is present, comparing the previous audit's score to the current one. The existing `POST /api/ada-audit` endpoint is reused unchanged. No schema migration needed.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS (class-based dark mode), Prisma + SQLite, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `components/ada-audit/ReScanButton.tsx` | **Create** | Client button — POSTs new audit, redirects to `?from=` URL |
| `components/ada-audit/RescanBanner.tsx` | **Create** | Client banner — shows "Re-scan complete" + score delta, dismissable |
| `components/ada-audit/AuditResultsView.tsx` | **Modify** | Accepts new optional props; renders `RescanBanner` + `ReScanButton` |
| `app/ada-audit/[id]/page.tsx` | **Modify** | Reads `searchParams.from`, fetches previous score, passes to view; replaces error state link |

---

## Task 1: Create `ReScanButton`

**Files:**
- Create: `components/ada-audit/ReScanButton.tsx`

No unit-testable logic — this is a pure UI/network component. Manual verification in Task 3.

- [ ] **Step 1: Create the component**

```tsx
// components/ada-audit/ReScanButton.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '@/components/Spinner'

interface Props {
  url: string
  wcagLevel: string
  auditId: string
}

type State = 'idle' | 'loading' | 'error'

export default function ReScanButton({ url, wcagLevel, auditId }: Props) {
  const router = useRouter()
  const [state, setState] = useState<State>('idle')

  async function handleClick() {
    if (state === 'loading') return
    setState('loading')

    try {
      const res = await fetch('/api/ada-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, wcagLevel }),
      })
      const data = await res.json()

      if (!res.ok) {
        setState('error')
        setTimeout(() => setState('idle'), 3000)
        return
      }

      router.push(`/ada-audit/${data.id}?from=${auditId}`)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  const colorClass: Record<State, string> = {
    idle: 'bg-white dark:bg-navy-card border-gray-300 dark:border-navy-border text-navy dark:text-white hover:border-orange hover:text-orange',
    loading: 'bg-white dark:bg-navy-card border-gray-200 dark:border-navy-border text-navy/50 dark:text-white/50 cursor-not-allowed',
    error: 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-700 dark:text-red-400',
  }

  const label: Record<State, string> = {
    idle: 'Re-scan',
    loading: 'Starting\u2026',
    error: 'Error',
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'loading'}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body font-semibold border rounded-lg transition-colors disabled:cursor-not-allowed ${colorClass[state]}`}
    >
      {state === 'loading' ? (
        <Spinner className="w-3 h-3" />
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      )}
      {label[state]}
    </button>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/ReScanButton.tsx
git commit -m "feat: add ReScanButton client component"
```

---

## Task 2: Create `RescanBanner`

**Files:**
- Create: `components/ada-audit/RescanBanner.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/ada-audit/RescanBanner.tsx
'use client'

import { useState } from 'react'

interface Props {
  previousScore: number | null
  currentScore: number | null
}

export default function RescanBanner({ previousScore, currentScore }: Props) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const scoreText = (() => {
    if (previousScore === null || currentScore === null) return null
    if (previousScore === currentScore) return `Score unchanged at ${currentScore}`
    const direction = currentScore > previousScore ? 'improved' : 'decreased'
    return `Score ${direction}: ${previousScore} \u2192 ${currentScore}`
  })()

  return (
    <div className="flex items-start gap-3 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 rounded-xl px-4 py-3">
      <svg
        className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <div className="flex-1">
        <p className="text-[13px] font-body font-semibold text-green-800 dark:text-green-400">
          Re-scan complete
        </p>
        {scoreText && (
          <p className="text-[12px] font-body text-green-700 dark:text-green-400/80 mt-0.5">
            {scoreText}
          </p>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="flex-shrink-0 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/RescanBanner.tsx
git commit -m "feat: add RescanBanner client component"
```

---

## Task 3: Update `AuditResultsView`

**Files:**
- Modify: `components/ada-audit/AuditResultsView.tsx`

- [ ] **Step 1: Add new props and imports**

Add `previousScore` and `fromAuditId` to the `Props` interface, and import the two new components.

Replace the top of the file (lines 1–17) with:

```tsx
import type { StoredAxeResults, AuditScorecard } from '@/lib/ada-audit/types'
import AuditScorecardComponent from './AuditScorecard'
import AuditIssueTabs from './AuditIssueTabs'
import ComplianceBanner from './ComplianceBanner'
import ShareAuditButton from './ShareAuditButton'
import ReScanButton from './ReScanButton'
import RescanBanner from './RescanBanner'
import { KnownLimitationsNotice } from './KnownLimitationsNotice'

interface Props {
  results: StoredAxeResults
  url: string
  clientName: string | null
  createdAt: string
  auditId?: string
  wcagLevel?: string
  score?: number
  compliant?: boolean
  previousScore?: number | null
  fromAuditId?: string | null
}
```

- [ ] **Step 2: Update the function signature and render `RescanBanner`**

Replace the `export default function` line and the opening of the JSX (the `<div className="space-y-6">` and the `<ComplianceBanner />` line):

Old:
```tsx
export default function AuditResultsView({ results, url, clientName, createdAt, auditId, wcagLevel, score, compliant }: Props) {
  const scorecard = buildScorecard(results)
  const wcagLabel = wcagLevel === 'wcag22aa' ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'

  return (
    <div className="space-y-6">
      <ComplianceBanner />
```

New:
```tsx
export default function AuditResultsView({ results, url, clientName, createdAt, auditId, wcagLevel, score, compliant, previousScore, fromAuditId }: Props) {
  const scorecard = buildScorecard(results)
  const wcagLabel = wcagLevel === 'wcag22aa' ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'

  return (
    <div className="space-y-6">
      {fromAuditId && (
        <RescanBanner previousScore={previousScore ?? null} currentScore={score ?? null} />
      )}
      <ComplianceBanner />
```

- [ ] **Step 3: Add `ReScanButton` to the header next to `ShareAuditButton`**

Find the existing `ShareAuditButton` block (lines 72–76):

```tsx
          {auditId && (
            <div className="flex-shrink-0">
              <ShareAuditButton auditId={auditId} />
            </div>
          )}
```

Replace with:

```tsx
          {auditId && (
            <div className="flex-shrink-0 flex items-center gap-2">
              <ReScanButton url={url} wcagLevel={wcagLevel ?? 'wcag21aa'} auditId={auditId} />
              <ShareAuditButton auditId={auditId} />
            </div>
          )}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/AuditResultsView.tsx
git commit -m "feat: wire ReScanButton and RescanBanner into AuditResultsView"
```

---

## Task 4: Update `app/ada-audit/[id]/page.tsx`

**Files:**
- Modify: `app/ada-audit/[id]/page.tsx`

This task wires up the `?from=` query param on the server side (fetches previous audit score) and replaces the error state link with `ReScanButton`.

- [ ] **Step 1: Add imports and update `Props`**

Replace the top of the file (lines 1–13) with:

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import AuditResultsView from '@/components/ada-audit/AuditResultsView'
import AuditPoller from '@/components/ada-audit/AuditPoller'
import ReScanButton from '@/components/ada-audit/ReScanButton'
import type { StoredAxeResults } from '@/lib/ada-audit/types'
import { computeScore } from '@/lib/ada-audit/scoring'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string }>
}
```

- [ ] **Step 2: Read `searchParams` and fetch previous score**

Replace the function signature and the initial DB fetch (lines 15–23) with:

```tsx
export default async function AdaAuditResultPage({ params, searchParams }: Props) {
  const { id } = await params
  const { from } = await searchParams

  const audit = await prisma.adaAudit.findUnique({
    where: { id },
    include: { client: { select: { name: true } } },
  })

  if (!audit) notFound()

  // Fetch previous audit score when this page was reached via Re-scan
  let previousScore: number | null = null
  if (from) {
    const prev = await prisma.adaAudit.findUnique({
      where: { id: from },
      select: { result: true, wcagLevel: true },
    })
    if (prev?.result) {
      try {
        const prevResults = JSON.parse(prev.result) as StoredAxeResults
        previousScore = computeScore(prevResults.violations, prev.wcagLevel ?? 'wcag21aa').score
      } catch { /* malformed result — leave null */ }
    }
  }
```

- [ ] **Step 3: Update the error state to use `ReScanButton`**

Find the existing error state block. Replace the `<Link href="/ada-audit" ...>Try again</Link>` with `ReScanButton`:

Old:
```tsx
          <Link
            href="/ada-audit"
            className="mt-2 px-4 py-2 bg-orange hover:bg-orange-light text-white font-body font-semibold text-[13px] rounded-lg transition-colors"
          >
            Try again
          </Link>
```

New:
```tsx
          <div className="mt-2">
            <ReScanButton url={audit.url} wcagLevel={audit.wcagLevel} auditId={id} />
          </div>
```

- [ ] **Step 4: Pass `previousScore` and `fromAuditId` to `AuditResultsView`**

Find the `<AuditResultsView ... />` call at the bottom of the file and add the two new props:

Old:
```tsx
      <AuditResultsView
        results={results}
        url={audit.url}
        clientName={audit.client?.name ?? null}
        createdAt={audit.createdAt.toISOString()}
        auditId={id}
        wcagLevel={audit.wcagLevel}
        score={score}
        compliant={compliant}
      />
```

New:
```tsx
      <AuditResultsView
        results={results}
        url={audit.url}
        clientName={audit.client?.name ?? null}
        createdAt={audit.createdAt.toISOString()}
        auditId={id}
        wcagLevel={audit.wcagLevel}
        score={score}
        compliant={compliant}
        previousScore={previousScore}
        fromAuditId={from ?? null}
      />
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 7: Manual smoke test**

Start the dev server:
```bash
npm run dev
```

1. Go to `/ada-audit`, scan any URL
2. On the completed results page, verify the **Re-scan** button appears to the left of the Share button
3. Click **Re-scan** — button shows spinner briefly, then navigates to `/ada-audit/<newId>?from=<oldId>`
4. Verify the AuditPoller progress bar appears while the new scan runs
5. When the scan completes, verify the green **"Re-scan complete"** banner appears above the compliance banner with a score delta (or "unchanged")
6. Click ✕ on the banner — verify it dismisses
7. Navigate to an audit that is in error state — verify the **Re-scan** button replaces the old "Try again" link

- [ ] **Step 8: Commit**

```bash
git add app/ada-audit/[id]/page.tsx
git commit -m "feat: wire re-scan searchParams and ReScanButton into audit page"
```
