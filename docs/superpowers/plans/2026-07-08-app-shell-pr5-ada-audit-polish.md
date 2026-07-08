# A8 PR 5 — ada-audit Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the `components/ui/` primitives `ScoreRing` (0–100 score dial) and `StatusPill` (lifecycle status pill) across the ada-audit tool's score displays and lifecycle/compliance/diff status pills, unifying them with the rest of the "Navy Command Deck" app — visual/primitive-adoption only, no behavior/data/API change.

**Architecture:** A new pure helper `auditStatusTone()` maps ada-audit lifecycle statuses to `StatusPill` tones **by color** (running→`warning`/amber, redirected→`running`/blue) so operational surfaces stay pixel-stable. Six components swap hand-rolled score numbers / status pills for the primitives; `StatusPill`'s `Tone` union gets a type-only `export`. No wrappers are stripped (ada-audit page roots are already shell-clean), so shared authed+public-share components are safe.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Tailwind (class-based dark mode), Vitest + @testing-library/react (jsdom).

## Global Constraints

- **Visual/primitive-adoption only** — no change to tool behavior, data, API, routes, audit logic, or scoring.
- **Do NOT modify `StatusPill`'s tone set, markup, or runtime.** The only touch is a **type-only `export`** of its `Tone` union (it is shared with the Home widgets).
- **Existing tests stay green.** The changed markup is asserted by no existing test (all assert text content, which the primitives preserve).
- **House test conventions:** jsdom tests start with `// @vitest-environment jsdom`. **No jest-dom** — use `.getAttribute()`, `.toBeTruthy()`, `queryBy…() === null` / `toBeNull()`, `container.querySelector(...)`; never `toBeInTheDocument`/`toHaveAttribute`.
- **Dark mode:** every touched element keeps its `dark:` variant (the primitives ship them).
- **Tone mapping is color-preserving for the dominant statuses** (spec §5): `complete`→`success`, `error`→`error`, `running`/`pdfs-running`/`lighthouse-running`→`warning` (amber), `redirected`→`running` (blue), everything else→`neutral`. **Two documented, deliberate shifts:** `pending`→`neutral` **canonicalizes** it to the gray it already has in `QueueMemberRow`/`LiveAuditTable` (only `ClientsAuditSummary` showed it amber, via a coarse shortcut — this fixes that inconsistency); `cancelled`→`neutral` is a negligible slate→gray shift. Both are intentional; do not special-case them.
- **Test command:** `DATABASE_URL="file:./local-dev.db" npx vitest run <path>` for a single file; gates use `npm run lint` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`.
- **Out of scope (do not touch):** impact-severity tiles/filter chips/badges (`AuditScorecard` tiles, `SiteAuditToolbar`, `AuditIssueCard`, `GroupedViolationsView`, `CommonIssueCallout`, `AuditIssueTabs`), `LighthouseSection` (band mismatch), `RecentsTable` type/status/score, `QueueMemberRow` score column, progress bars/spinners.

---

### Task 1: `Tone` export + `auditStatusTone` helper (foundation)

**Files:**
- Modify: `components/ui/StatusPill.tsx:1` (add `export` to the `Tone` type)
- Create: `components/ada-audit/status-tone.ts`
- Test: `components/ada-audit/status-tone.test.ts`

**Interfaces:**
- Consumes: `Tone` from `@/components/ui/StatusPill`.
- Produces: `auditStatusTone(status: string): Tone` — used by Tasks 5, 6, 7.

- [ ] **Step 1: Write the failing test**

Create `components/ada-audit/status-tone.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { auditStatusTone } from './status-tone'

describe('auditStatusTone (color-preserving map, PR5 spec §5)', () => {
  it('maps lifecycle statuses to the tone matching their current color', () => {
    expect(auditStatusTone('complete')).toBe('success')          // green
    expect(auditStatusTone('error')).toBe('error')                // red
    expect(auditStatusTone('running')).toBe('warning')            // amber (preserved)
    expect(auditStatusTone('pdfs-running')).toBe('warning')       // amber
    expect(auditStatusTone('lighthouse-running')).toBe('warning') // amber
    expect(auditStatusTone('redirected')).toBe('running')         // blue (preserved)
  })

  it('falls back to neutral for queued/pending/cancelled/unknown', () => {
    expect(auditStatusTone('queued')).toBe('neutral')
    expect(auditStatusTone('pending')).toBe('neutral')
    expect(auditStatusTone('cancelled')).toBe('neutral')
    expect(auditStatusTone('something-else')).toBe('neutral')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/status-tone.test.ts`
Expected: FAIL — `Failed to resolve import "./status-tone"` (file not created yet).

- [ ] **Step 3: Export `Tone` from StatusPill**

In `components/ui/StatusPill.tsx`, change line 1 from:

```ts
type Tone = 'neutral' | 'running' | 'success' | 'error' | 'warning'
```

to:

```ts
export type Tone = 'neutral' | 'running' | 'success' | 'error' | 'warning'
```

(Type-only change — no runtime/markup/behavior difference; the Home widgets are unaffected.)

- [ ] **Step 4: Create the helper**

Create `components/ada-audit/status-tone.ts`:

```ts
import type { Tone } from '@/components/ui/StatusPill'

/**
 * Maps an ada-audit lifecycle status to a StatusPill tone BY COLOR, not by word,
 * so operational surfaces stay pixel-stable: a running audit keeps its amber via
 * the `warning` tone, and LiveAuditTable's `redirected` keeps its blue via the
 * `running` tone. See docs/superpowers/…/2026-07-08-app-shell-pr5… §5.
 *
 * `pending` and `cancelled` fall to `neutral` (gray) deliberately: `pending` is
 * already gray in QueueMemberRow/LiveAuditTable (canonicalized — the amber-pending
 * in ClientsAuditSummary was an inconsistency); `cancelled`'s slate→gray is
 * negligible. See spec §5.
 */
export function auditStatusTone(status: string): Tone {
  switch (status) {
    case 'complete':
      return 'success'
    case 'error':
      return 'error'
    case 'running':
    case 'pdfs-running':
    case 'lighthouse-running':
      return 'warning'
    case 'redirected':
      return 'running'
    default:
      return 'neutral'
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/status-tone.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add components/ui/StatusPill.tsx components/ada-audit/status-tone.ts components/ada-audit/status-tone.test.ts
git commit -m "feat(ada-audit): add color-preserving auditStatusTone helper + export StatusPill Tone"
```

---

### Task 2: `AuditScorecard` — ScoreRing + compliance StatusPill

**Files:**
- Modify: `components/ada-audit/AuditScorecard.tsx` (imports; score block `:53-79`; remove `scoreColor` `:38-42`)
- Test: `components/ada-audit/AuditScorecard.test.tsx` (add a new describe block)

**Interfaces:**
- Consumes: `ScoreRing` from `@/components/ui/ScoreRing`, `StatusPill` from `@/components/ui/StatusPill`.
- Produces: nothing new (internal restyle of a shared component).

- [ ] **Step 1: Write the failing test**

Append to `components/ada-audit/AuditScorecard.test.tsx` (after the existing describe block, before EOF):

```tsx
describe('AuditScorecard — ScoreRing + compliance pill (PR5)', () => {
  it('renders a ScoreRing and a compliant StatusPill when score + compliant are provided', () => {
    const { container } = render(
      <AuditScorecard scorecard={scorecard} score={87} compliant={true} wcagLevel="wcag21aa" />,
    )
    const ring = container.querySelector('svg[role="img"]')
    expect(ring).toBeTruthy()
    expect(ring?.getAttribute('aria-label')).toContain('score 87')
    expect(container.textContent).toContain('Compliant')
  })

  it('renders a non-compliant label when compliant is false', () => {
    const { container } = render(
      <AuditScorecard scorecard={scorecard} score={30} compliant={false} wcagLevel="wcag21aa" />,
    )
    expect(container.textContent).toContain('Non-compliant')
  })

  it('renders no score ring when score is omitted (the score != null guard is unchanged)', () => {
    const { container } = render(<AuditScorecard scorecard={scorecard} />)
    expect(container.querySelector('svg[role="img"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/AuditScorecard.test.tsx`
Expected: FAIL — **only the first new test** fails (`ring` is null: today the score is a `<span>`, not `svg[role="img"]`). The second new test ("Non-compliant") and third ("no ring when omitted") already **pass** against current markup (the current compliant badge already renders the literal "Non-compliant" text, and no score → no SVG). The four original tests also pass. (Codex plan-review fix — earlier draft wrongly said two new tests fail.)

- [ ] **Step 3: Add imports**

At the top of `components/ada-audit/AuditScorecard.tsx`, add after the existing imports (after line 3):

```tsx
import { ScoreRing } from '@/components/ui/ScoreRing'
import { StatusPill } from '@/components/ui/StatusPill'
```

- [ ] **Step 4: Remove the now-unused `scoreColor` helper**

Delete lines 38-42 (the whole function):

```tsx
function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600 dark:text-green-400'
  if (score >= 50) return 'text-amber-500 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}
```

- [ ] **Step 5: Swap the score number for a ScoreRing and the compliant badge for a StatusPill**

Replace the score block (currently `:53-79`):

```tsx
      {score != null && (
        <div className="flex items-center gap-3 mb-1">
          <span className={`text-5xl font-display font-bold leading-none ${scoreColor(score)}`}>
            {score}
          </span>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-body font-semibold text-navy/40 dark:text-white/40 uppercase tracking-wider">Score</span>
            {scoreMeta && (
              <ScoreVersionBadge
                version={scoreMeta.version}
                fromFallback={scoreMeta.fromFallback}
                passCount={scoreMeta.passCount}
                incompleteCount={scoreMeta.incompleteCount}
              />
            )}
            {compliant != null && (
              <span className={`inline-flex items-center gap-1 text-[11px] font-body font-semibold px-2 py-0.5 rounded border ${
                compliant
                  ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/30'
                  : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30'
              }`}>
                {wcagLevel === 'wcag22aa' ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'}
                {compliant ? ': Compliant ✓' : ': Non-compliant ✗'}
              </span>
            )}
          </div>
        </div>
      )}
```

with:

```tsx
      {score != null && (
        <div className="flex items-center gap-3 mb-1">
          <ScoreRing score={score} size={72} />
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-body font-semibold text-navy/40 dark:text-white/40 uppercase tracking-wider">Score</span>
            {scoreMeta && (
              <ScoreVersionBadge
                version={scoreMeta.version}
                fromFallback={scoreMeta.fromFallback}
                passCount={scoreMeta.passCount}
                incompleteCount={scoreMeta.incompleteCount}
              />
            )}
            {compliant != null && (
              <StatusPill
                tone={compliant ? 'success' : 'error'}
                label={`${wcagLevel === 'wcag22aa' ? 'WCAG 2.1 AA + Best Practices' : 'WCAG 2.1 AA'}${compliant ? ': Compliant ✓' : ': Non-compliant ✗'}`}
              />
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/AuditScorecard.test.tsx`
Expected: PASS — all 7 tests (4 original + 3 new).

- [ ] **Step 7: Commit**

```bash
git add components/ada-audit/AuditScorecard.tsx components/ada-audit/AuditScorecard.test.tsx
git commit -m "refactor(ada-audit): AuditScorecard adopts ScoreRing + compliance StatusPill"
```

---

### Task 3: `ScoreVersionBadge` — v1/v2 tag → StatusPill

**Files:**
- Modify: `components/ada-audit/ScoreVersionBadge.tsx`
- Test: `components/ada-audit/ScoreVersionBadge.test.tsx` (existing — must stay green)

**Interfaces:**
- Consumes: `StatusPill` from `@/components/ui/StatusPill`.

- [ ] **Step 1: Confirm the existing test is green (baseline)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/ScoreVersionBadge.test.tsx`
Expected: PASS (2 tests) — the pre-change baseline.

- [ ] **Step 2: Swap the tag span for a StatusPill**

Replace the whole file body's `return` (keep the signature, `label`, and `title` logic). New `components/ada-audit/ScoreVersionBadge.tsx`:

```tsx
import { StatusPill } from '@/components/ui/StatusPill'

export function ScoreVersionBadge({ version, fromFallback, passCount, incompleteCount }: {
  version: number
  fromFallback: boolean
  passCount: number | null
  incompleteCount: number | null
}) {
  const label = version >= 2 ? 'v2' : 'v1'
  const title = version >= 2
    ? 'Score v2 — size-normalized, WCAG-aware; passes & needs-review shown'
    : fromFallback
      ? 'Score v1 (formula label unavailable for this run)'
      : 'Score v1 (legacy formula)'
  return (
    <span className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-white/60">
      <span title={title}>
        <StatusPill label={label} tone="neutral" />
      </span>
      {passCount != null && <span>{passCount} passed</span>}
      {incompleteCount != null && <span>{incompleteCount} needs review</span>}
    </span>
  )
}
```

(The `title` tooltip moves onto a wrapper span because `StatusPill` takes no `title` prop.)

- [ ] **Step 3: Run the test to verify it stays green**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/ScoreVersionBadge.test.tsx`
Expected: PASS (2 tests) — `getByText(/v2/i)`, `/40/`, `/3/`, `/v1/i` all still match (StatusPill renders the label + the counts stay as text).

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/ScoreVersionBadge.tsx
git commit -m "refactor(ada-audit): ScoreVersionBadge tag adopts StatusPill (neutral)"
```

---

### Task 4: `SiteAuditDiffPanel` — severity pill + count chips → StatusPill

**Files:**
- Modify: `components/ada-audit/SiteAuditDiffPanel.tsx` (remove `SEV_PILL` `:13-17`; severity pill `:25`; headline chips `:76-90`)
- Test: `components/ada-audit/SiteAuditDiffPanel.test.tsx` (existing — must stay green)

**Interfaces:**
- Consumes: `StatusPill` from `@/components/ui/StatusPill`.

- [ ] **Step 1: Confirm the existing test is green (baseline)**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditDiffPanel.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 2: Add the import + `sevTone`, remove `SEV_PILL`**

At the top of `components/ada-audit/SiteAuditDiffPanel.tsx`, add to the imports:

```tsx
import { StatusPill } from '@/components/ui/StatusPill'
```

Replace the `SEV_PILL` const (`:13-17`):

```tsx
const SEV_PILL: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  notice: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}
```

with:

```tsx
function sevTone(sev: string): 'error' | 'warning' | 'neutral' {
  return sev === 'critical' ? 'error' : sev === 'warning' ? 'warning' : 'neutral'
}
```

- [ ] **Step 3: Swap the per-rule severity pill**

Replace (`:25`):

```tsx
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${SEV_PILL[rule.severity]}`}>{rule.severity}</span>
```

with:

```tsx
        <StatusPill label={rule.severity} tone={sevTone(rule.severity)} />
```

- [ ] **Step 4: Swap the headline count chips**

Replace the four headline chips (`:76-90`):

```tsx
          <span className={`px-2 py-1 rounded-lg ${diff.newCount > 0 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50'}`}>
            {diff.newCount} new{diff.newCount > 0 ? ` (${diff.regressedCount} regressed · ${diff.newPageCount} on new pages)` : ''}
          </span>
          <span className={`px-2 py-1 rounded-lg ${diff.resolvedCount > 0 ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50'}`}>
            {diff.resolvedCount} resolved
          </span>
          <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50">{diff.unchangedCount} unchanged</span>
          {diff.notRescannedCount > 0 && (
            <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50" title="Violations on pages that were not part of this crawl — neither new nor resolved.">
              {diff.notRescannedCount} not re-scanned
            </span>
          )}
```

with:

```tsx
          <StatusPill
            tone={diff.newCount > 0 ? 'error' : 'neutral'}
            label={`${diff.newCount} new${diff.newCount > 0 ? ` (${diff.regressedCount} regressed · ${diff.newPageCount} on new pages)` : ''}`}
          />
          <StatusPill tone={diff.resolvedCount > 0 ? 'success' : 'neutral'} label={`${diff.resolvedCount} resolved`} />
          <StatusPill tone="neutral" label={`${diff.unchangedCount} unchanged`} />
          {diff.notRescannedCount > 0 && (
            <span title="Violations on pages that were not part of this crawl — neither new nor resolved.">
              <StatusPill tone="neutral" label={`${diff.notRescannedCount} not re-scanned`} />
            </span>
          )}
```

- [ ] **Step 5: Run the test to verify it stays green**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/SiteAuditDiffPanel.test.tsx`
Expected: PASS (7 tests). All assertions are text-content (`getByText('critical')`, `'1 resolved'`, `/5 unchanged/`, `/2 not re-scanned/`, `/0 new$/`, `/2 new \(1 regressed · 1 on new pages\)/`), which the StatusPill labels reproduce exactly. The `NEW` emphasis badge and the per-rule `+N new` / `−N resolved` texts are untouched.

- [ ] **Step 6: Commit**

```bash
git add components/ada-audit/SiteAuditDiffPanel.tsx
git commit -m "refactor(ada-audit): SiteAuditDiffPanel severity + count chips adopt StatusPill"
```

---

### Task 5: `QueueMemberRow` — status pill → StatusPill

**Files:**
- Modify: `components/ada-audit/QueueMemberRow.tsx` (imports; remove `STATUS_COLOR` `:20-29`; pill `:78-80`) — line refs in this worktree (has an `IntentChip` import at `:7`); match by the snippet, not the line number.

**Interfaces:**
- Consumes: `StatusPill`, `auditStatusTone`.

- [ ] **Step 1: Add imports**

At the top of `components/ada-audit/QueueMemberRow.tsx`, add after the existing imports:

```tsx
import { StatusPill } from '@/components/ui/StatusPill'
import { auditStatusTone } from './status-tone'
```

- [ ] **Step 2: Remove the `STATUS_COLOR` map**

Delete the whole `const STATUS_COLOR: Record<string, string> = { … }` block (≈`:20-29`). Keep `STATUS_LABEL`.

- [ ] **Step 3: Swap the pill**

Replace (`:74-76`):

```tsx
        <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ${STATUS_COLOR[member.status] ?? STATUS_COLOR.queued}`}>
          {STATUS_LABEL[member.status] ?? member.status}
        </span>
```

with:

```tsx
        <StatusPill label={STATUS_LABEL[member.status] ?? member.status} tone={auditStatusTone(member.status)} />
```

- [ ] **Step 4: Verify no compile/test breakage**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/` (there is no QueueMemberRow test; confirm the suite still passes) and `npx tsc --noEmit` (spot-check this file compiles — full gate is Task 8).
Expected: PASS / no type errors in `QueueMemberRow.tsx`.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/QueueMemberRow.tsx
git commit -m "refactor(ada-audit): QueueMemberRow status pill adopts StatusPill"
```

---

### Task 6: `LiveAuditTable` — replace local StatusPill with the primitive

**Files:**
- Modify: `components/ada-audit/LiveAuditTable.tsx` (imports; delete local `StatusPill` `:10-25`; call site `:93`) — match by the snippet, not the line number.

**Interfaces:**
- Consumes: `StatusPill`, `auditStatusTone`.

- [ ] **Step 1: Add imports**

At the top of `components/ada-audit/LiveAuditTable.tsx`, add after the existing imports:

```tsx
import { StatusPill } from '@/components/ui/StatusPill'
import { auditStatusTone } from './status-tone'
```

- [ ] **Step 2: Delete the local `StatusPill` component**

Delete the whole local `function StatusPill({ status }: { status: LiveAuditChild['status'] }) { … }` block (≈`:10-25`). Leave `ImpactCounts` untouched.

- [ ] **Step 3: Update the call site**

Replace (`:98`):

```tsx
                <td className="px-6 py-2.5"><StatusPill status={c.status} /></td>
```

with:

```tsx
                <td className="px-6 py-2.5"><StatusPill label={c.status} tone={auditStatusTone(c.status)} /></td>
```

- [ ] **Step 4: Verify no compile/test breakage**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/` and `npx tsc --noEmit` (spot-check).
Expected: PASS / no type errors. `redirected` now maps to the blue `running` tone (preserved); `pending` → `neutral` (gray, preserved); `running` → amber `warning` (preserved).

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/LiveAuditTable.tsx
git commit -m "refactor(ada-audit): LiveAuditTable uses the shared StatusPill primitive"
```

---

### Task 7: `ClientsAuditSummary` — ChipForStatus → StatusPill; ScoreBadge → ScoreRing (Extended)

**Files:**
- Modify: `components/ada-audit/ClientsAuditSummary.tsx` (imports; `ScoreBadge` `:32-40`; `ChipForStatus` `:42-54`)

**Interfaces:**
- Consumes: `StatusPill`, `ScoreRing`, `auditStatusTone`.

- [ ] **Step 1: Add imports**

At the top of `components/ada-audit/ClientsAuditSummary.tsx`, add after the existing imports:

```tsx
import { StatusPill } from '@/components/ui/StatusPill'
import { ScoreRing } from '@/components/ui/ScoreRing'
import { auditStatusTone } from './status-tone'
```

- [ ] **Step 2: Swap `ScoreBadge` for a compact ScoreRing**

Replace the `ScoreBadge` function (`:32-40`):

```tsx
function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-navy/25 dark:text-white/25">—</span>
  const color = score >= 80
    ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400'
    : score >= 50
      ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
      : 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400'
  return <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ${color}`}>{score}</span>
}
```

with:

```tsx
function ScoreBadge({ score }: { score: number | null }) {
  // ScoreRing handles null (dashed em-dash ring); bands (≥80/≥50) already match.
  return <ScoreRing score={score} size={32} />
}
```

- [ ] **Step 3: Swap `ChipForStatus` for a StatusPill**

Replace the `ChipForStatus` function (`:42-54`):

```tsx
function ChipForStatus({ status }: { status: string | undefined }) {
  if (!status) return null
  const label = status === 'queued' ? 'Queued' : status === 'running' ? 'Running' : status === 'pdfs-running' ? 'Scanning PDFs' : status === 'lighthouse-running' ? 'Running Lighthouse' : status
  const color =
    status === 'queued'
      ? 'bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300'
      : 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
  return (
    <span className={`text-[11px] font-body font-semibold px-2 py-0.5 rounded ml-2 ${color}`}>
      {label}
    </span>
  )
}
```

with:

```tsx
function ChipForStatus({ status }: { status: string | undefined }) {
  if (!status) return null
  const label = status === 'queued' ? 'Queued' : status === 'running' ? 'Running' : status === 'pdfs-running' ? 'Scanning PDFs' : status === 'lighthouse-running' ? 'Running Lighthouse' : status
  return (
    <span className="ml-2">
      <StatusPill label={label} tone={auditStatusTone(status)} />
    </span>
  )
}
```

- [ ] **Step 4: Verify no compile/test breakage**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ada-audit/` and `npx tsc --noEmit` (spot-check).
Expected: PASS / no type errors. The Score cell now shows a compact ring (null → dashed em-dash ring, replacing the plain `—`).

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/ClientsAuditSummary.tsx
git commit -m "refactor(ada-audit): ClientsAuditSummary adopts ScoreRing + StatusPill"
```

---

### Task 8: Full gate + PR prep

**Files:** none (verification only).

- [ ] **Step 1: Lint (tsc)**

Run: `npm run lint`
Expected: PASS — no type errors (confirms the `Tone` export, `auditStatusTone` signature, and all new prop usages compile).

- [ ] **Step 2: Full test suite**

Run: `DATABASE_URL="file:./local-dev.db" npm test`
Expected: PASS — the full suite green, including the new `status-tone.test.ts` + `AuditScorecard.test.tsx` cases and the unchanged `ScoreVersionBadge`/`SiteAuditDiffPanel`/`AuditResultsView`/`SiteAuditResultsView` tests.

- [ ] **Step 3: Production build (purge guard)**

Run: `npm run build`
Expected: PASS — confirms no purged-CSS regression (all classes are primitive-owned or static literals in scanned `components/` files; the helper returns tone string literals, constructs no class names).

- [ ] **Step 4: Grep for stragglers (self-check)**

Run:
```bash
grep -rn "STATUS_COLOR\|SEV_PILL\|scoreColor" components/ada-audit/ | grep -v ".test."
```
Expected: `scoreColor` still appears ONLY in `LighthouseSection.tsx` (out of scope). No `STATUS_COLOR` or `SEV_PILL` remain. (If `AuditScorecard.tsx` still shows `scoreColor`, Task 2 Step 4 was skipped.)

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/app-shell-pr5-ada-audit
gh pr create --title "A8 PR 5 — ada-audit visual polish (ScoreRing + StatusPill adoption)" \
  --body "$(cat <<'BODY'
Second per-tool polish pass of A8 (spec §8 PR 4+). Visual/primitive-adoption only — no behavior/data/API/scoring change.

- `AuditScorecard`: flat score number → `ScoreRing`; compliant badge → `StatusPill`.
- `ScoreVersionBadge`, `SiteAuditDiffPanel`, `QueueMemberRow`, `LiveAuditTable`, `ClientsAuditSummary`: hand-rolled status pills → `StatusPill` via a color-preserving `auditStatusTone()` helper.
- `ClientsAuditSummary` score badge → compact `ScoreRing`.
- `StatusPill` gains a type-only `export` of its `Tone` union (no runtime change).

Excluded (documented non-goals): impact-severity tiles/chips/badges (interactive + 4-level palette), `LighthouseSection` (band mismatch ≥90 vs ≥80), plain-text/dense-numeric columns.

Spec: `docs/superpowers/specs/2026-07-08-app-shell-pr5-ada-audit-polish-design.md`
Plan: `docs/superpowers/plans/2026-07-08-app-shell-pr5-ada-audit-polish.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 6: Post-deploy prod verification** (after merge + `~/deploy.sh`)

Per spec §8 — drive the **authed** ada-audit surfaces via Playwright and MEASURE layout (server health is insufficient):
- Single-page audit result (`/ada-audit/[id]`, complete) — `AuditScorecard` `ScoreRing` SVG present + sized (`getBoundingClientRect` ≈ 72), compliant `StatusPill` renders, no CSS collapse.
- Site audit result (`/ada-audit/site/[id]`) — scorecard + (if a baseline exists) `SiteAuditDiffPanel` StatusPills.
- Clients tab (`/ada-audit`) — compact `ScoreRing` (size 32) renders in the Score cell without breaking row height.
- If the Playwright MCP session is **not** authed (Google-OAuth-only), verify a public share surface (`/ada-audit/site/share/[token]`) + HTTP/redirect health, and flag the authed spot-checks for Kevin.

---

## Self-Review

**Spec coverage:** Core §4.1 — AuditScorecard (Task 2), ScoreVersionBadge (Task 3), SiteAuditDiffPanel (Task 4), QueueMemberRow (Task 5), LiveAuditTable (Task 6), ClientsAuditSummary ChipForStatus (Task 7). Extended §4.2 — ClientsAuditSummary ScoreBadge (Task 7). Tone helper + Tone export §5 (Task 1). Testing §8 (Tasks 1–2 new tests, all others baseline-green, Task 8 gates + prod verify). Non-goals §2 — respected (no LighthouseSection, no impact-severity, no plain-text columns). No gaps.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows the assertion + command + expected result.

**Type consistency:** `auditStatusTone(status: string): Tone` defined in Task 1, consumed identically in Tasks 5/6/7. `Tone` exported (Task 1) and imported by the helper. `StatusPill` props (`label`, `tone`) and `ScoreRing` props (`score`, `size`) match the primitives' real signatures (verified against `components/ui/StatusPill.tsx` / `ScoreRing.tsx`).
