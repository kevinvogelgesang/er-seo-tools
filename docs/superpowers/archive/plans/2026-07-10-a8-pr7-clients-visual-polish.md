# A8 PR 7 — /clients Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt shared `components/ui/` primitives (new `SeverityBadge`, existing `StatusPill`) on every hand-rolled chip in `/clients`, normalize ~81 raw hex classes to Tailwind tokens, and drop the two redundant page wrappers — visual-only, zero behavior/data/API change.

**Architecture:** One new pure presentational primitive (`SeverityBadge`, color-named tones) + one testable tone-mapping helper (`alert-tone.ts`, mirroring the PR 5/6 `status-tone.ts` precedent); everything else is in-place JSX/className replacement inside `app/(app)/clients/` and `components/clients/`.

**Tech Stack:** Next.js 15 App Router, React server+client components, Tailwind (class-based dark mode), Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-07-10-a8-pr7-clients-visual-polish-design.md` (Codex ACCEPT-WITH-NAMED-FIXES ×4, applied).

## Global Constraints

- **Visual-only.** No behavior, data, API, scoring, or route change anywhere in this PR.
- **Dark-mode variants on every touched element** (house rule; all tone tables below include them).
- **Color-preserving except the documented canonicalizations** (spec §2.1/§2.3/§4): alert-pill bg `*-100`→`*-50`, gray text `gray-500`→`gray-600`, padding `px-2`→`px-1.5` on badge sites, `#e09415`→`orange-dark` hover shift, StatusPill shape canonicalization on the four lifecycle chips.
- **Hex swap rule** (className strings only): `[#1c2d4a]`→`navy` · `[#f5a623]`→`orange` · `[#e09415]`→`orange-dark` · `[#0f1d30]`→`navy-deep` · `[#0f1e30]`→`navy-deep` (typo fix). NEVER touch `SeoHistoryChart.tsx` / `Sparkline.tsx` (SVG/Recharts props, not classes).
- **Never `git add -A`** (untracked `pentest-results/` etc. at repo root). Add files explicitly.
- Gates (all three, verbatim): `npx tsc --noEmit` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.
- Branch: `feat/a8-pr7-clients-polish` off current `main`.

---

### Task 1: `SeverityBadge` primitive

**Files:**
- Create: `components/ui/SeverityBadge.tsx`
- Test: `components/ui/SeverityBadge.test.tsx`

**Interfaces:**
- Produces: `SeverityBadge({ label: string; tone: BadgeTone; uppercase?: boolean; title?: string })` and `export type BadgeTone = 'red' | 'orange' | 'amber' | 'blue' | 'purple' | 'gray'`. Later tasks import both from `@/components/ui/SeverityBadge`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// components/ui/SeverityBadge.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SeverityBadge } from './SeverityBadge'

describe('SeverityBadge', () => {
  it('renders the label', () => {
    render(<SeverityBadge label="critical" tone="red" />)
    expect(screen.getByText('critical')).toBeTruthy()
  })

  it.each([
    ['red', 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'],
    ['orange', 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400'],
    ['amber', 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'],
    ['blue', 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'],
    ['purple', 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400'],
    ['gray', 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60'],
  ] as const)('tone %s maps to its documented classes', (tone, classes) => {
    render(<SeverityBadge label={tone} tone={tone} />)
    const el = screen.getByText(tone)
    for (const c of classes.split(' ')) expect(el.className).toContain(c)
  })

  it('applies the compact badge shape incl. shrink-0', () => {
    render(<SeverityBadge label="shape" tone="gray" />)
    const el = screen.getByText('shape')
    for (const c of ['inline-flex', 'shrink-0', 'items-center', 'rounded', 'px-1.5', 'py-0.5', 'text-[10px]', 'font-body', 'font-semibold']) {
      expect(el.className).toContain(c)
    }
    expect(el.className).not.toContain('uppercase')
  })

  it('supports uppercase and title passthrough', () => {
    render(<SeverityBadge label="drop" tone="amber" uppercase title="score dropped 12" />)
    const el = screen.getByText('drop')
    expect(el.className).toContain('uppercase')
    expect(el.getAttribute('title')).toBe('score dropped 12')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ui/SeverityBadge.test.tsx`
Expected: FAIL — cannot resolve `./SeverityBadge`

- [ ] **Step 3: Write the implementation**

```tsx
// components/ui/SeverityBadge.tsx
//
// Compact square-rounded severity/count badge — the palette companion to
// StatusPill (which is the rounded-full LIFECYCLE pill). Tones are
// color-named, not semantic-named: severity vocabularies differ per tool
// (clients: critical/warning/notice; ada-audit: critical/serious/moderate/
// minor), so semantics→tone mapping lives in the adopting component.
// shrink-0 is part of the contract: badges sit in flex rows and must never
// compress at narrow widths.

export type BadgeTone = 'red' | 'orange' | 'amber' | 'blue' | 'purple' | 'gray'

const TONES: Record<BadgeTone, string> = {
  red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  orange: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
  gray: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}

export function SeverityBadge({ label, tone, uppercase, title }: {
  label: string
  tone: BadgeTone
  uppercase?: boolean
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-body font-semibold ${uppercase ? 'uppercase ' : ''}${TONES[tone]}`}
    >
      {label}
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/ui/SeverityBadge.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/ui/SeverityBadge.tsx components/ui/SeverityBadge.test.tsx
git commit -m "feat(a8-pr7): SeverityBadge ui primitive — compact color-named palette badge"
```

---

### Task 2: `alert-tone.ts` + FleetTable adoption

**Files:**
- Create: `components/clients/alert-tone.ts`
- Create: `components/clients/alert-tone.test.ts`
- Modify: `components/clients/FleetTable.tsx`
- Test: `components/clients/FleetTable.test.tsx` (extend)

**Interfaces:**
- Consumes: `SeverityBadge`, `BadgeTone` from `@/components/ui/SeverityBadge` (Task 1).
- Produces: `alertTone(kind: 'score-drop' | 'error' | 'stale' | 'regression'): BadgeTone`.

- [ ] **Step 1: Write the failing helper test**

```ts
// components/clients/alert-tone.test.ts
import { describe, it, expect } from 'vitest'
import { alertTone } from './alert-tone'

describe('alertTone', () => {
  it.each([
    ['error', 'red'],
    ['score-drop', 'amber'],
    ['stale', 'gray'],
    ['regression', 'purple'],
  ] as const)('%s → %s', (kind, tone) => {
    expect(alertTone(kind)).toBe(tone)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/alert-tone.test.ts`
Expected: FAIL — cannot resolve `./alert-tone`

- [ ] **Step 3: Write the helper**

```ts
// components/clients/alert-tone.ts
//
// Fleet-alert kind → SeverityBadge tone, BY COLOR — a canonical palette
// mapping (hue-preserving; bg/text strength canonicalizes to the badge's
// palette), same pattern as ada-audit/status-tone.ts. Kept as a module so
// the mapping is unit-testable.
import type { BadgeTone } from '@/components/ui/SeverityBadge'

export type FleetAlertKind = 'score-drop' | 'error' | 'stale' | 'regression'

export function alertTone(kind: FleetAlertKind): BadgeTone {
  switch (kind) {
    case 'error':
      return 'red'
    case 'score-drop':
      return 'amber'
    case 'regression':
      return 'purple'
    case 'stale':
      return 'gray'
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/alert-tone.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Add failing FleetTable assertions**

Append to `components/clients/FleetTable.test.tsx` (inside the existing `describe`):

```tsx
  it('renders alert chips via SeverityBadge tones (color-preserving)', () => {
    render(<FleetTable rows={[row({ id: 5, name: 'Tone Co', alerts: [{ kind: 'error', detail: 'x' }, { kind: 'regression', detail: 'y' }] })]} />)
    expect(screen.getByText('error').className).toContain('bg-red-50')
    expect(screen.getByText('regression').className).toContain('bg-purple-50')
  })
  it('renders open-issue count pills with red/orange when non-zero, gray when zero', () => {
    render(<FleetTable rows={[row({ id: 6, name: 'Issues Co', openCritical: 3, openWarning: 0 })]} />)
    expect(screen.getByText('3C').className).toContain('text-red-700')
    expect(screen.getByText('0W').className).toContain('text-gray-600')
  })
  it('renders the page-audit suffix as a gray uppercase SeverityBadge', () => {
    render(<FleetTable rows={[row({ id: 7, name: 'Suffix Co', adaSource: 'page', ada: series(75, null) })]} />)
    const el = screen.getByText('page')
    expect(el.className).toContain('px-1.5')
    expect(el.className).toContain('uppercase')
    expect(el.className).toContain('text-gray-600')
  })
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/FleetTable.test.tsx`
Expected: the two new tests FAIL (current classes are `bg-red-100` / `text-gray-500`), existing tests PASS.

- [ ] **Step 6: Adopt in FleetTable**

In `components/clients/FleetTable.tsx`:

a. Add imports:

```tsx
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { alertTone } from './alert-tone'
```

b. Delete the `ALERT_CLASSES` record entirely (lines ~38–43).

c. Replace the alert render (the `r.alerts.map` body):

```tsx
{r.alerts.map((a, i) => (
  <SeverityBadge key={i} title={a.detail} uppercase tone={alertTone(a.kind)} label={a.kind === 'score-drop' ? 'drop' : a.kind} />
))}
```

d. Replace the open-issue count pills (the `openCritical !== null` branch):

```tsx
<span className="inline-flex gap-1 tabular-nums">
  <SeverityBadge tone={r.openCritical > 0 ? 'red' : 'gray'} label={`${r.openCritical}C`} title="open critical issue types" />
  <SeverityBadge tone={(r.openWarning ?? 0) > 0 ? 'orange' : 'gray'} label={`${r.openWarning ?? 0}W`} title="open warning issue types" />
</span>
```

e. In `ScoreCell`, replace the suffix badge `<span className="ml-1 px-1 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50">{suffix}</span>` with:

```tsx
<span className="ml-1 inline-flex"><SeverityBadge tone="gray" uppercase label={suffix} /></span>
```

f. Apply the hex swap rule to the whole file (3× `[#1c2d4a]`→`navy`, 5× `[#f5a623]`→`orange`, 1× `[#e09415]`→`orange-dark`).

- [ ] **Step 7: Run FleetTable tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/FleetTable.test.tsx components/clients/alert-tone.test.ts`
Expected: PASS (all, incl. the pre-existing `renders alert chips` / `page-audit suffix` tests — labels are unchanged text).

- [ ] **Step 8: Commit**

```bash
git add components/clients/alert-tone.ts components/clients/alert-tone.test.ts components/clients/FleetTable.tsx components/clients/FleetTable.test.tsx
git commit -m "feat(a8-pr7): FleetTable adopts SeverityBadge (alerts, issue counts, suffix) + token swap"
```

---

### Task 3: FindingsPanel adoption

**Files:**
- Modify: `components/clients/FindingsPanel.tsx`
- Test: `components/clients/FindingsPanel.test.tsx` (extend)

**Interfaces:**
- Consumes: `SeverityBadge`, `BadgeTone` from `@/components/ui/SeverityBadge`.

- [ ] **Step 1: Add failing assertions**

Append inside the existing `describe` in `components/clients/FindingsPanel.test.tsx` (it already has `row()`/`meta()` fixture builders and explicit `afterEach(cleanup)`):

```tsx
  it('renders severity chips via SeverityBadge tones (critical red, warning orange, notice blue)', () => {
    render(
      <FindingsPanel
        rows={[row(), row({ type: 'b_warn', severity: 'warning' }), row({ type: 'c_notice', severity: 'notice' })]}
        seo={meta()}
        ada={null}
      />,
    )
    expect(screen.getByText('critical').className).toContain('bg-red-50')
    expect(screen.getByText('critical').className).toContain('px-1.5')
    expect(screen.getByText('warning').className).toContain('bg-orange-50')
    expect(screen.getByText('notice').className).toContain('bg-blue-50')
  })

  it('sample badge is gray-600 with the explanatory title', () => {
    render(<FindingsPanel rows={[row({ isSample: true, urls: [], totalUrls: 0 })]} seo={meta()} ada={null} />)
    const sample = screen.getByText('sample')
    expect(sample.className).toContain('text-gray-600')
    expect(sample.getAttribute('title')).toContain('sample/partial')
  })

  it('tool badge is a gray-600 uppercase SeverityBadge', () => {
    render(<FindingsPanel rows={[row()]} seo={meta()} ada={null} />)
    // "SEO" appears in the source-meta line too — pick the badge by its bg class.
    const badge = screen.getAllByText('SEO').find((el) => el.className.includes('bg-gray-100'))
    expect(badge).toBeTruthy()
    expect(badge!.className).toContain('text-gray-600')
    expect(badge!.className).toContain('uppercase')
  })
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/FindingsPanel.test.tsx`
Expected: both new tests FAIL — the severity chip is `px-2` today and the sample badge is `text-gray-500` (critical's `bg-red-50` already passes; `px-1.5` is the failing-first anchor). Existing tests PASS.

- [ ] **Step 2: Adopt in FindingsPanel**

In `components/clients/FindingsPanel.tsx`:

a. Add import + local severity→tone map (replacing the `SEV_CHIP` record):

```tsx
import { SeverityBadge, type BadgeTone } from '@/components/ui/SeverityBadge'

const SEV_TONE: Record<FindingRowProp['severity'], BadgeTone> = {
  critical: 'red',
  warning: 'orange',
  notice: 'blue',
}
```

b. Replace the severity chip `<span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold ${SEV_CHIP[row.severity]}`}>{row.severity}</span>` with:

```tsx
<SeverityBadge tone={SEV_TONE[row.severity]} label={row.severity} />
```

c. Replace the tool badge `<span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/50">{row.tool === 'seo' ? 'SEO' : 'ADA'}</span>` with:

```tsx
<SeverityBadge tone="gray" uppercase label={row.tool === 'seo' ? 'SEO' : 'ADA'} />
```

d. Replace the sample badge (keep its `title` text verbatim):

```tsx
<SeverityBadge
  tone="gray"
  label="sample"
  title="URL list is a sample/partial — the count is authoritative"
/>
```

e. Leave the `NEW` badge and `DeltaBadge` untouched (spec exclusions).

f. Apply the hex swap rule to the whole file (2× `[#1c2d4a]`→`navy`, 3× `[#f5a623]`→`orange`, 3× `[#e09415]`→`orange-dark`).

- [ ] **Step 3: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/FindingsPanel.test.tsx`
Expected: PASS (all).

- [ ] **Step 4: Commit**

```bash
git add components/clients/FindingsPanel.tsx components/clients/FindingsPanel.test.tsx
git commit -m "feat(a8-pr7): FindingsPanel adopts SeverityBadge (severity/tool/sample) + token swap"
```

---

### Task 4: Scorecard sourceNote + seoCounts chips + page wrappers

**Files:**
- Modify: `components/clients/Scorecard.tsx`
- Modify: `app/(app)/clients/[id]/page.tsx`
- Modify: `app/(app)/clients/page.tsx`
- Test: `components/clients/Scorecard.test.tsx` (extend)

**Interfaces:**
- Consumes: `SeverityBadge` from `@/components/ui/SeverityBadge`.

- [ ] **Step 1: Add failing Scorecard assertion**

Append inside the existing `describe` in `components/clients/Scorecard.test.tsx` (props shape matches its existing "shows the source note" test):

```tsx
  it('renders sourceNote as a gray uppercase SeverityBadge', () => {
    render(<Scorecard label="ADA" score={75} max={100} delta={null} asOf={null} href={null} points={[]} sourceNote="page audits" />)
    const el = screen.getByText('page audits')
    expect(el.className).toContain('text-gray-600')
    expect(el.className).toContain('uppercase')
    expect(el.className).toContain('px-1.5')
  })
```

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/Scorecard.test.tsx`
Expected: new test FAILS on `px-1.5` (current chip is `px-2`).

- [ ] **Step 2: Adopt in Scorecard**

In `components/clients/Scorecard.tsx`:

a. `import { SeverityBadge } from '@/components/ui/SeverityBadge'`

b. Replace the sourceNote chip `<span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60">{sourceNote}</span>` with:

```tsx
<SeverityBadge tone="gray" uppercase label={sourceNote} />
```

c. Leave `scoreColor()`, the big number, and the delta chip untouched (spec exclusions).

d. Apply the hex swap rule (1× `[#f5a623]`→`orange`, 1× `[#e09415]`→`orange-dark` — the "View →" link).

- [ ] **Step 3: seoCounts chips in the client dashboard page**

In `app/(app)/clients/[id]/page.tsx`:

a. `import { SeverityBadge } from '@/components/ui/SeverityBadge'`

b. Replace the three seoCounts chips:

```tsx
<div className="mt-2 flex flex-wrap gap-1.5 tabular-nums">
  <SeverityBadge tone="red" label={`${dash.seoCounts.criticalCount} critical`} />
  <SeverityBadge tone="orange" label={`${dash.seoCounts.warningCount} warnings`} />
  <SeverityBadge tone="blue" label={`${dash.seoCounts.noticeCount} notices`} />
</div>
```

(The wrapper's `text-[11px] font-semibold` moves into the badges at their canonical 10px — documented canonicalization.)

c. Drop the page wrapper: replace

```tsx
return (
  <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
    <div className="max-w-6xl mx-auto px-6 py-10">
      …
    </div>
  </div>
)
```

with the inner div as the root:

```tsx
return (
  <div className="max-w-6xl mx-auto px-6 py-10">
    …
  </div>
)
```

d. Apply the hex swap rule to the remaining occurrence (1× `[#1c2d4a]`→`navy`).

- [ ] **Step 4: Fleet page wrapper**

In `app/(app)/clients/page.tsx`: same wrapper drop (remove the `min-h-screen bg-[#f4f6f9] dark:bg-navy-deep` outer div, inner `max-w-6xl mx-auto px-6 py-10` becomes root), then hex swap rule (2× `[#1c2d4a]`→`navy`, 1× `[#0f1d30]`→`navy-deep`).

- [ ] **Step 5: Run tests + typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/ && npx tsc --noEmit`
Expected: PASS / no errors.

- [ ] **Step 6: Commit**

```bash
git add components/clients/Scorecard.tsx components/clients/Scorecard.test.tsx "app/(app)/clients/[id]/page.tsx" "app/(app)/clients/page.tsx"
git commit -m "feat(a8-pr7): Scorecard sourceNote + seoCounts SeverityBadges; drop redundant page wrappers"
```

---

### Task 5: StatusPill lifecycle adoptions (timeline, Paused, Archived, ✓ Done)

**Files:**
- Modify: `components/clients/ActivityTimeline.tsx`
- Modify: `components/clients/ScheduledScansCard.tsx`
- Modify: `components/clients/ClientHeader.tsx`
- Modify: `components/clients/QuarterContextCard.tsx`
- Test: `components/clients/ActivityTimeline.test.tsx`, `components/clients/QuarterContextCard.test.tsx`, `components/clients/ScheduledScansCard.test.tsx` (extend as needed)

**Interfaces:**
- Consumes: `StatusPill`, `type Tone` from `@/components/ui/StatusPill`.

- [ ] **Step 1: Add failing ActivityTimeline assertion**

Append inside the existing `describe` in `components/clients/ActivityTimeline.test.tsx` (it already has an `item()` fixture builder):

```tsx
  it('renders the status chip as a StatusPill (lifecycle tones)', () => {
    render(<ActivityTimeline items={[item({}), item({ id: 'x3', status: 'error' })]} />)
    expect(screen.getByText('complete').className).toContain('rounded-full')
    expect(screen.getByText('complete').className).toContain('bg-green-100')
    expect(screen.getByText('error').className).toContain('bg-red-100')
  })
```

(The existing "error status gets the red badge classes" test asserts `className` contains `red` — StatusPill's `error` tone keeps that assertion passing.)

Also add red tests for the other three replacements (Codex plan-fix #1):

a. In `components/clients/ScheduledScansCard.test.tsx`, extend the existing `'shows Paused instead of next-run for disabled schedules'` test with:

```tsx
    expect(screen.getByText('Paused').className).toContain('rounded-full')
```

(fails today — the chip is square `rounded`).

b. In `components/clients/QuarterContextCard.test.tsx`, extend the existing `'renders the done chip when completed'` test with:

```tsx
    expect(screen.getByText(/✓ Done/).className).toContain('rounded-full')
    expect(screen.getByText(/✓ Done/).className).toContain('bg-green-100')
```

(fails today — `rounded` + `bg-green-50`).

c. Create `components/clients/ClientHeader.test.tsx` (no test exists yet):

```tsx
// @vitest-environment jsdom
// components/clients/ClientHeader.test.tsx
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { ClientHeader } from './ClientHeader'

afterEach(cleanup)

describe('ClientHeader', () => {
  it('renders the Archived StatusPill for archived clients', () => {
    render(
      <ClientHeader
        name="Acme College"
        domains={['acme.example']}
        seedUrls={[]}
        teamworkTasklistId={null}
        schedules={[]}
        archivedAt="2026-06-01T00:00:00.000Z"
      />,
    )
    const el = screen.getByText('ARCHIVED')
    expect(el.className).toContain('rounded-full')
    expect(el.className).toContain('bg-gray-100')
  })
})
```

(fails today — the DOM text is `Archived`; the caps come from CSS `uppercase`, which StatusPill doesn't apply.)

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/ScheduledScansCard.test.tsx components/clients/QuarterContextCard.test.tsx components/clients/ClientHeader.test.tsx`
Expected: the three new/extended assertions FAIL, everything else PASSES.

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/ActivityTimeline.test.tsx`
Expected: new test FAILS (`rounded-full` absent today).

- [ ] **Step 2: Adopt in ActivityTimeline**

a. Add import:

```tsx
import { StatusPill, type Tone } from '@/components/ui/StatusPill'
```

b. Replace `statusClasses()` with a tone mapper (same colors, `/20`→`/15` dark canonicalization comes from StatusPill):

```tsx
function timelineStatusTone(status: string): Tone {
  if (status === 'complete') return 'success'
  if (status === 'error') return 'error'
  if (status === 'cancelled') return 'neutral'
  return 'running' // in-flight
}
```

c. Replace the status chip render `<span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${statusClasses(it.status)}`}>{it.status}</span>` with:

```tsx
<StatusPill label={it.status} tone={timelineStatusTone(it.status)} />
```

d. Leave `TYPE_CLASSES` chips untouched (spec exclusion — categorical palette).

e. Hex swap rule (1× `[#1c2d4a]`→`navy`, 2× `[#f5a623]`→`orange` in the title link).

- [ ] **Step 3: Adopt Paused, Archived, ✓ Done**

a. `components/clients/ScheduledScansCard.tsx` — add `import { StatusPill } from '@/components/ui/StatusPill'`; replace `<span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50 font-semibold">Paused</span>` with:

```tsx
<StatusPill label="Paused" tone="neutral" />
```

b. `components/clients/ClientHeader.tsx` — add the same import; replace the Archived badge `<span className="px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-white/50">Archived</span>` with:

```tsx
<StatusPill label="ARCHIVED" tone="neutral" />
```

(Codex plan-fix #2: the caps live in the label now — the visible text stays ARCHIVED; only `tracking-wide` and the gray step change.)

Then hex swap rule (1× `[#1c2d4a]`→`navy`, 3× `[#f5a623]`→`orange`, 2× `[#e09415]`→`orange-dark`). Domain chips stay untouched (spec exclusion).

c. `components/clients/QuarterContextCard.tsx` — add the same import; replace the ✓ Done chip `<span className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400">✓ Done{…}</span>` with:

```tsx
<StatusPill label={`✓ Done${context.completedAt ? ` ${fmtDate(context.completedAt)}` : ''}`} tone="success" />
```

Priority/status inline-hex chips stay untouched (spec exclusion — quarter-grid theme). Hex swap rule (1× `[#1c2d4a]`→`navy`, 1× `[#f5a623]`→`orange`, 1× `[#e09415]`→`orange-dark`).

d. `components/clients/IssueTrendCard.tsx` — hex swap rule only (1× `[#1c2d4a]`→`navy`, 1× `[#f5a623]`→`orange`, 1× `[#e09415]`→`orange-dark`).

- [ ] **Step 4: Run the clients component tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/`
Expected: PASS. If `ScheduledScansCard.test.tsx` or `QuarterContextCard.test.tsx` pin the old chip classes, update those assertions to the StatusPill classes (`rounded-full`, `bg-gray-100`/`bg-green-100`) — text content is unchanged so `getByText` queries keep working.

- [ ] **Step 5: Commit**

```bash
git add components/clients/ActivityTimeline.tsx components/clients/ActivityTimeline.test.tsx components/clients/ScheduledScansCard.tsx components/clients/ScheduledScansCard.test.tsx components/clients/ClientHeader.tsx components/clients/ClientHeader.test.tsx components/clients/QuarterContextCard.tsx components/clients/QuarterContextCard.test.tsx components/clients/IssueTrendCard.tsx
git commit -m "feat(a8-pr7): StatusPill lifecycle chips (timeline/Paused/Archived/Done) + token swaps"
```

---

### Task 6: manage-page token sweep + hex guard + gates

**Files:**
- Modify: `app/(app)/clients/manage/page.tsx`
- Test: none new (mechanical class swaps; the guard is a grep)

- [ ] **Step 1: Token sweep on manage page**

Apply the hex swap rule to `app/(app)/clients/manage/page.tsx`: 14× `[#1c2d4a]`→`navy`, 22× `[#f5a623]`→`orange`, 6× `[#e09415]`→`orange-dark`, 1× `[#0f1e30]`→`navy-deep` (typo fix). All are className occurrences; no other change.

- [ ] **Step 2: Hex guard sweep**

Run:

```bash
grep -rn "1c2d4a\|f5a623\|e09415\|0f1d30\|0f1e30\|f4f6f9" "app/(app)/clients" components/clients
```

Expected: exactly one hit — `components/clients/Sparkline.tsx:10` (`color = '#f5a623'`, an SVG prop default, documented exclusion). `SeoHistoryChart.tsx`'s hex values are different colors and don't match this pattern. Any other hit = a missed swap; fix it.

- [ ] **Step 3: Full gates**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```

Expected: all green. (Build also proves the new tone class literals survive Tailwind scanning — they're static strings in `components/`, inside the content globs.)

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/clients/manage/page.tsx"
git commit -m "feat(a8-pr7): manage-page hex→token sweep (navy/orange/orange-dark, fixes #0f1e30 typo)"
```

---

### Task 7: PR + ship

- [ ] **Step 1: Push + open PR**

```bash
git push -u origin feat/a8-pr7-clients-polish
gh pr create --title "feat(a8-pr7): /clients visual polish — SeverityBadge primitive + tokens + wrappers" --body "<summary per house style; MUST list the documented visible canonicalizations for Kevin's eyeball: alert-pill bg *-100→*-50, gray-500→gray-600 text step, px-2→px-1.5 badge padding, #e09415→orange-dark hover shift, four StatusPill shape canonicalizations (timeline status, Paused, Archived, ✓ Done)>"
```

- [ ] **Step 2: Merge per change-control rule 1** (gates re-run green in this session → merge), deploy (`git push` then `ssh $PROD_SSH "pm2 stop seo-tools && ~/deploy.sh"`), post-deploy verify: `/api/health` ok, `/clients` → 307 login gate, new tone classes (`bg-purple-50`, `text-orange-700`) present in the shipped CSS bundle (PR 5 recipe), clean boot log.

- [ ] **Step 3: Docs ritual** — tracker A8 entry + dated status-log line + rewritten handoff doc in the same commit; spec + plan → `docs/superpowers/archive/`; reply ends with the paste-in prompt.
