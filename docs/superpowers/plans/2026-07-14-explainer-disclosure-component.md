# Explainer Disclosure Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-14-explainer-disclosure-component-design.md` (Codex-reviewed; all three named fixes are implemented by this plan: useId `aria-controls`, `inert`/`aria-hidden` collapsed panel + focusability test, methodology-vs-operational-truth rule, corrected share-page inventory, exactly-two extra candidates).

**Goal:** One reusable inline explanation-disclosure primitive (`components/ui/Explainer.tsx`) adopted across score explanations, the site-audit SEO sections, five client dashboard cards, and the two named page intros — with all operational-truth copy left visible.

**Architecture:** `Explainer` is a pure `'use client'` presentational component (single `useState(open)`, `useId()` for `aria-controls`, CSS `grid-template-rows: 0fr→1fr` animation, collapsed panel `aria-hidden` + `inert`). Four presentational subcomponents live in the same file. Adopting surfaces keep their data loading and all state/error/coverage copy untouched; only static methodology prose moves (or is newly added) behind the disclosure. The component makes no fetches, so it is safe on the public share page (which renders BrokenLinksSection, OnPageSeoSection, DiscoveryCoverageSection, ContentSimilaritySection — verified in `app/(public)/ada-audit/site/share/[token]/page.tsx` lines 79–92).

**Tech Stack:** Next.js 15 App Router, React 19 (`inert` is a native boolean prop; `@types/react` `^19` types it), TypeScript, Tailwind (class-based dark mode, house tokens), vitest + @testing-library/react (jsdom via per-file pragma, `fireEvent`, no jest-dom matchers — `toBeTruthy()`/`toBeNull()` house style).

## Global Constraints

- Local gates are `npx tsc --noEmit` + `npx vitest run` ONLY — in-build type-check/lint are disabled in `next.config.ts`; never merge without both green.
- The component holds no state beyond `useState(open)`, no fetches, no context, no portals — inline expansion only.
- **Operational truth never moves behind a disclosure:** status lines, error states, "as of"/fetched lines, coverage & truncation warnings, honesty qualifiers, archived banners, action guidance. Each adoption task below quotes the exact strings that stay visible.
- House Tailwind vocabulary: `dark:bg-navy-card`, `dark:border-navy-border`, `font-body`/`font-heading` (note: `font-heading` is used by sibling sections though only `font-display`/`font-body` are in `tailwind.config.ts` — follow the sibling convention, don't "fix" it here), 11–13px bracket sizes, semantic status colors with `dark:` opacity variants.
- `'use client'` on `Explainer.tsx` (it has state). Adopting server components (ScoreExplanation, the site-audit sections, `app/(app)/reports/page.tsx`) may import it freely — a server component rendering a client component with serializable JSX children is the supported RSC pattern.
- New explainer copy must not collide with existing test regex assertions (each task lists its forbidden phrases — `getByText(regex)` throws on multiple matches and several suites assert `queryByText(...) === null`).
- Branch name: `feat/explainer-component`. Create it from `main` before Task 1: `git checkout -b feat/explainer-component`.

---

### Task 1: `Explainer` component + subcomponents + full test suite

**Files:**
- Create: `components/ui/Explainer.tsx`
- Test: `components/ui/Explainer.test.tsx` (create)

**Interfaces:**
- Consumes: `react` (`useId`, `useState`) only.
- Produces:
  - `Explainer(props: { label: string; children: React.ReactNode; defaultOpen?: boolean; variant?: 'card' | 'plain'; className?: string }): JSX.Element`
  - `ExplainerSummary(props: { children: React.ReactNode }): JSX.Element`
  - `ExplainerTags(props: { tags: string[] }): JSX.Element | null`
  - `ExplainerColumns(props: { good: { label: string; items: string[] }; bad: { label: string; items: string[] } }): JSX.Element`
  - `ExplainerNote(props: { children: React.ReactNode }): JSX.Element`

**Steps:**

- [ ] Write the failing test suite at `components/ui/Explainer.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  Explainer,
  ExplainerSummary,
  ExplainerTags,
  ExplainerColumns,
  ExplainerNote,
} from './Explainer'

afterEach(cleanup)

function panelFor(trigger: HTMLElement): HTMLElement {
  const id = trigger.getAttribute('aria-controls')
  expect(id).toBeTruthy()
  const panel = document.getElementById(id!)
  expect(panel).toBeTruthy()
  return panel!
}

describe('Explainer', () => {
  it('renders collapsed by default: trigger aria-expanded=false, panel aria-hidden + inert', () => {
    render(
      <Explainer label="What does this measure?">
        <ExplainerSummary>Methodology prose.</ExplainerSummary>
      </Explainer>,
    )
    const trigger = screen.getByRole('button', { name: 'What does this measure?' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    const panel = panelFor(trigger)
    expect(panel.getAttribute('aria-hidden')).toBe('true')
    expect(panel.hasAttribute('inert')).toBe(true)
  })

  it('expands on click: aria-expanded flips, aria-hidden/inert removed; collapses again on second click', () => {
    render(
      <Explainer label="What is this?">
        <ExplainerSummary>Prose.</ExplainerSummary>
      </Explainer>,
    )
    const trigger = screen.getByRole('button', { name: 'What is this?' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const panel = panelFor(trigger)
    expect(panel.getAttribute('aria-hidden')).toBeNull()
    expect(panel.hasAttribute('inert')).toBe(false)
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(panel.hasAttribute('inert')).toBe(true)
  })

  it('defaultOpen renders expanded', () => {
    render(
      <Explainer label="How this score is calculated" defaultOpen>
        <ExplainerSummary>Open from the start.</ExplainerSummary>
      </Explainer>,
    )
    const trigger = screen.getByRole('button', { name: 'How this score is calculated' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(panelFor(trigger).hasAttribute('inert')).toBe(false)
  })

  it('collapsed panel is genuinely inaccessible: an interactive child is not in the a11y tree until expanded', () => {
    render(
      <Explainer label="Details">
        <a href="https://example.com">docs link</a>
      </Explainer>,
    )
    // Collapsed: role queries respect aria-hidden — the link must be unreachable.
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByRole('link', { name: 'docs link' })).toBeTruthy()
  })

  it('ExplainerTags renders a chip per tag and null for empty', () => {
    const { container } = render(<ExplainerTags tags={['Density-based', 'Severity-weighted']} />)
    expect(screen.getByText('Density-based')).toBeTruthy()
    expect(screen.getByText('Severity-weighted')).toBeTruthy()
    expect(container.querySelectorAll('li')).toHaveLength(2)
    const { container: empty } = render(<ExplainerTags tags={[]} />)
    expect(empty.firstChild).toBeNull()
  })

  it('ExplainerColumns renders both labelled lists with check/cross markers', () => {
    const { container } = render(
      <ExplainerColumns
        good={{ label: 'Helps the score', items: ['Unique titles'] }}
        bad={{ label: 'Hurts the score', items: ['Thin content'] }}
      />,
    )
    expect(screen.getByText('Helps the score')).toBeTruthy()
    expect(screen.getByText('Hurts the score')).toBeTruthy()
    expect(screen.getByText('Unique titles')).toBeTruthy()
    expect(screen.getByText('Thin content')).toBeTruthy()
    expect(container.textContent).toContain('✓')
    expect(container.textContent).toContain('✗')
  })

  it('ExplainerNote renders the flagged footer callout text', () => {
    render(<ExplainerNote>Weights as scored; current weights may differ.</ExplainerNote>)
    expect(screen.getByText(/Weights as scored/)).toBeTruthy()
  })

  it('card variant applies the bordered panel chrome; plain does not', () => {
    const { container: card } = render(
      <Explainer label="About" variant="card">
        <ExplainerSummary>x</ExplainerSummary>
      </Explainer>,
    )
    expect((card.firstChild as HTMLElement).className).toMatch(/border/)
    const { container: plain } = render(
      <Explainer label="About2" variant="plain">
        <ExplainerSummary>x</ExplainerSummary>
      </Explainer>,
    )
    expect((plain.firstChild as HTMLElement).className).not.toMatch(/border/)
  })
})
```

- [ ] Run it and confirm the expected failure:

```
npx vitest run components/ui/Explainer.test.tsx
```

Expected output (import resolution failure — the component doesn't exist yet):

```
 ❯ components/ui/Explainer.test.tsx (0 tests)
Error: Failed to resolve import "./Explainer" from "components/ui/Explainer.test.tsx". Does the file exist?
 Test Files  1 failed (1)
```

- [ ] Implement `components/ui/Explainer.tsx` in full:

```tsx
'use client'

// components/ui/Explainer.tsx — reusable inline explanation disclosure (2026-07-14 spec).
//
// One consistent home for "what does this measure / how is this computed" prose:
// a button trigger (label + rotating chevron) that expands an inline panel.
// Structured subcomponents mirror the "Social Style" mock's visual language
// (summary paragraph, tag chips, two-column do/don't lists, flagged footer note)
// WITHOUT its popover behavior — expansion is inline, below the trigger.
//
// Accessibility contract (Codex fixes 1):
//  - `aria-expanded` on the trigger, `aria-controls` wired via useId()
//    (unique + hydration-safe).
//  - Collapsed panel is `aria-hidden` AND `inert` (React 19 boolean prop) so
//    links/buttons inside the zero-height grid can never receive keyboard
//    focus. The panel stays mounted (the grid-rows animation needs real
//    content height), but it is removed from both the a11y tree and the tab
//    order.
//  - Animation: grid-template-rows 0fr→1fr wrapped in motion-safe: variants —
//    prefers-reduced-motion users get an instant toggle.
//
// House rule (Codex fix 2, spec §"methodology-vs-operational-truth"): only
// STATIC explanatory prose belongs inside an Explainer. Status lines, errors,
// freshness lines, coverage/truncation warnings, and honesty qualifiers must
// stay visible in the adopting surface at all times.
//
// No state beyond useState(open), no fetches, no context — safe on public
// token-gated pages and inside server-component trees (RSC children pattern).

import { useId, useState } from 'react'

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 21V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </svg>
  )
}

export function Explainer({
  label,
  children,
  defaultOpen = false,
  variant = 'plain',
  className = '',
}: {
  label: string
  children: React.ReactNode
  defaultOpen?: boolean
  /** 'card' = bordered rounded panel for standalone placement; 'plain' = borderless for embedding inside an existing card. */
  variant?: 'card' | 'plain'
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const chrome =
    variant === 'card'
      ? 'bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-xl px-4 py-3'
      : ''
  return (
    <div className={`${chrome} ${className}`.trim()}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[12px] font-body font-semibold text-navy/60 dark:text-white/60 hover:text-navy dark:hover:text-white transition-colors"
      >
        {label}
        <ChevronIcon
          className={`w-3.5 h-3.5 motion-safe:transition-transform motion-safe:duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200 motion-safe:ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div
          id={panelId}
          aria-hidden={open ? undefined : true}
          inert={!open}
          className="min-h-0 overflow-hidden"
        >
          <div className="pt-2 pb-1 space-y-3">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function ExplainerSummary({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-body text-navy/70 dark:text-white/70 leading-relaxed">
      {children}
    </p>
  )
}

export function ExplainerTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <li
          key={t}
          className="rounded-full bg-gray-100 dark:bg-white/10 px-2 py-0.5 text-[11px] font-body font-semibold text-gray-600 dark:text-white/60"
        >
          {t}
        </li>
      ))}
    </ul>
  )
}

interface ExplainerColumn {
  label: string
  items: string[]
}

export function ExplainerColumns({ good, bad }: { good: ExplainerColumn; bad: ExplainerColumn }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <p className="text-[11px] font-body font-semibold uppercase tracking-wider text-green-700 dark:text-green-400 mb-1">
          {good.label}
        </p>
        <ul className="space-y-1">
          {good.items.map((item) => (
            <li
              key={item}
              className="flex items-start gap-1.5 text-[12px] font-body text-navy/70 dark:text-white/70"
            >
              <span aria-hidden className="text-green-600 dark:text-green-400 font-semibold">
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-[11px] font-body font-semibold uppercase tracking-wider text-red-700 dark:text-red-400 mb-1">
          {bad.label}
        </p>
        <ul className="space-y-1">
          {bad.items.map((item) => (
            <li
              key={item}
              className="flex items-start gap-1.5 text-[12px] font-body text-navy/70 dark:text-white/70"
            >
              <span aria-hidden className="text-red-600 dark:text-red-400 font-semibold">
                ✗
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function ExplainerNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2">
      <FlagIcon className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
      <p className="text-[12px] font-body text-amber-800 dark:text-amber-400 leading-relaxed">
        {children}
      </p>
    </div>
  )
}
```

Implementation notes:
  - `aria-hidden={open ? undefined : true}` (not `aria-hidden={!open}`) — React would otherwise render `aria-hidden="false"`, which is harmless but the test asserts attribute absence when open.
  - `inert={!open}` — React 19 renders the attribute only when true; jsdom can't enforce inert focus semantics, so the test asserts the attribute AND uses `queryByRole` (role queries exclude `aria-hidden` subtrees) for the accessible-tree assertion.
  - Chevron rotation via `rotate-180` on open; the panel animation is `grid-rows-[0fr]` ↔ `grid-rows-[1fr]` with `motion-safe:transition-[grid-template-rows]`; the row child needs `min-h-0 overflow-hidden` for the collapse to actually clip.

- [ ] Run the suite and confirm green:

```
npx vitest run components/ui/Explainer.test.tsx
```

Expected output:

```
 ✓ components/ui/Explainer.test.tsx (8 tests)
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

- [ ] Commit:

```
git add components/ui/Explainer.tsx components/ui/Explainer.test.tsx
git commit -m "feat(ui): Explainer inline disclosure component + subcomponents

useId aria-controls, inert/aria-hidden collapsed panel, grid-rows
motion-safe animation, card/plain variants; full jsdom suite incl.
collapsed-focusability assertion.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0166sVCTWUMeNuetJKqZzRCD"
```

---

### Task 2: ScoreExplanation + AdaScoreExplanation adoption

**Files:**
- Modify: `components/scoring/ScoreExplanation.tsx` (import block line 3; replace the `<details>` return, lines 23–52)
- Modify: `components/scoring/AdaScoreExplanation.tsx` (import block line 6; replace the `<details>` return, lines 69–105)
- Test: `components/scoring/ScoreExplanation.test.tsx` (rewrite, 17 lines), `components/scoring/AdaScoreExplanation.test.tsx` (lines 23–29 and 38–42)

**Interfaces:**
- Consumes: `Explainer` from `@/components/ui/Explainer`.
- Produces: unchanged signatures — `ScoreExplanation({ breakdown }: { breakdown: string | null })`, `AdaScoreExplanation({ breakdown }: { breakdown: string | null })`.

**Copy classification (spec rule):**
- STAYS OUTSIDE the disclosure (operational truth): `ScoreExplanation`'s legacy fallback `"Score breakdown unavailable (scored before breakdowns were recorded)."` (lines 14–20) and the empty-factors `return null` (line 21). `AdaScoreExplanation`'s legacy no-op (`return null` for non-v4, line 64). The `lowCoverage` line `"Partial coverage — {n} of {m} pages scored."` is operational BUT it currently lives inside the bespoke `<details>` — it moves into the Explainer panel VERBATIM because it is part of the breakdown content the spec says to keep verbatim; it was already behind a disclosure today, so no visibility regresses. Same for the deduction invoice and factor table.
- Trigger label changes from the current `"How this score was calculated"` (past tense, `ScoreExplanation.tsx` line 26 / `AdaScoreExplanation.tsx` line 72) to the spec's `"How this score is calculated"`.

**Steps:**

- [ ] Update `components/scoring/ScoreExplanation.test.tsx` to the new trigger semantics (failing first):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ScoreExplanation } from './ScoreExplanation'

afterEach(cleanup)

const bd = JSON.stringify({ version: 1, scorer: 'health', score: 72, factors: [{ key: 'indexability', label: 'Indexability', weight: 20, earned: 18, possible: 20 }] })
describe('ScoreExplanation', () => {
  it('renders a collapsed Explainer trigger and factor rows on expand', () => {
    render(<ScoreExplanation breakdown={bd} />)
    const trigger = screen.getByRole('button', { name: 'How this score is calculated' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Indexability')).toBeTruthy()
    expect(screen.getByText(/Weights as scored/)).toBeTruthy()
  })
  it('renders unavailable for null (fallback stays OUTSIDE the disclosure — no trigger)', () => {
    render(<ScoreExplanation breakdown={null} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('renders unavailable on malformed JSON', () => { render(<ScoreExplanation breakdown={'{'} />); expect(screen.getByText(/unavailable/i)).toBeTruthy() })
  it('renders nothing when factors are empty (live null-score case)', () => {
    const { container } = render(<ScoreExplanation breakdown={JSON.stringify({ version: 1, scorer: 'live-seo', score: null, factors: [] })} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] Update `components/scoring/AdaScoreExplanation.test.tsx` — replace the first test (lines 23–29) and the lowCoverage test (lines 38–42); the other two tests are unchanged:

```tsx
  it('renders the deduction invoice for a v4 breakdown behind the Explainer trigger', () => {
    render(<AdaScoreExplanation breakdown={v4} />)
    const trigger = screen.getByRole('button', { name: 'How this score is calculated' })
    fireEvent.click(trigger)
    expect(screen.getByText(/−12/)).toBeTruthy()
    expect(screen.getByText(/image-alt/)).toBeTruthy()
    expect(screen.getByText(/61 of 204 pages/)).toBeTruthy()
  })
```

```tsx
  it('shows the partial-coverage qualifier when lowCoverage', () => {
    const low = JSON.parse(v4); low.lowCoverage = true; low.inputsSummary.pagesAudited = 80
    render(<AdaScoreExplanation breakdown={JSON.stringify(low)} />)
    fireEvent.click(screen.getByRole('button', { name: 'How this score is calculated' }))
    expect(screen.getByText(/partial coverage — 80 of 204 pages scored/i)).toBeTruthy()
  })
```

Also add `fireEvent` to the testing-library import on line 2: `import { render, screen, cleanup, fireEvent } from '@testing-library/react'`.

- [ ] Run both and confirm the expected failures:

```
npx vitest run components/scoring/ScoreExplanation.test.tsx components/scoring/AdaScoreExplanation.test.tsx
```

Expected: `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "How this score is calculated"` in the updated tests (the components still render `<details>`).

- [ ] Modify `components/scoring/ScoreExplanation.tsx` — add the import and replace the `<details>` block (lines 24–51) with an `Explainer`; the parsing, fallback paragraph, empty-factors null, table, and footer are byte-identical content:

```tsx
// components/scoring/ScoreExplanation.tsx — read-only breakdown panel (C8).
// Reads ONLY the persisted `scoreBreakdown` string; never recomputes.
import type { PersistedBreakdown } from '@/lib/scoring/weights'
import { Explainer } from '@/components/ui/Explainer'

export function ScoreExplanation({ breakdown }: { breakdown: string | null }) {
  let parsed: PersistedBreakdown | null = null
  if (breakdown) {
    try {
      parsed = JSON.parse(breakdown) as PersistedBreakdown
    } catch {
      parsed = null
    }
  }
  if (!parsed || !Array.isArray(parsed.factors)) {
    return (
      <p className="text-[12px] font-body text-navy/45 dark:text-white/45">
        Score breakdown unavailable (scored before breakdowns were recorded).
      </p>
    )
  }
  if (parsed.factors.length === 0) return null // live null-score: ScoreLine already explains it
  const totalPossible = parsed.factors.reduce((a, x) => a + x.possible, 0)
  return (
    <Explainer label="How this score is calculated" className="mt-2">
      <table className="w-full text-[12px] font-body text-navy dark:text-white">
        <thead>
          <tr className="text-navy/45 dark:text-white/45 text-left">
            <th className="py-1">Factor</th>
            <th>Weight</th>
            <th>Earned</th>
            <th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {parsed.factors.map((f) => (
            <tr key={f.key} className="border-t border-gray-100 dark:border-navy-border/50">
              <td className="py-1">{f.label}</td>
              <td>{f.weight}</td>
              <td>{Math.round(f.earned * 10) / 10}/{f.possible}</td>
              <td>{totalPossible > 0 ? Math.round((f.earned / totalPossible) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] font-body text-navy/40 dark:text-white/40">
        Weights as scored; current weights may differ.
      </p>
    </Explainer>
  )
}
```

- [ ] Modify `components/scoring/AdaScoreExplanation.tsx` — add `import { Explainer } from '@/components/ui/Explainer'` after line 6, then replace the return block (lines 69–105) with:

```tsx
  return (
    <Explainer label="How this score is calculated" className="mt-2">
      <div className="space-y-2 text-[12px] font-body text-navy dark:text-white">
        {lowCoverage && (
          <p className="text-[11px] font-body text-navy/50 dark:text-white/50">
            Partial coverage — {inputsSummary.pagesAudited} of {inputsSummary.pagesTotal} pages scored.
          </p>
        )}
        {lines.length === 0 ? (
          <p className="text-navy/60 dark:text-white/60">No deductions — clean run.</p>
        ) : (
          <ul className="space-y-1.5">
            {lines.map((d) => (
              <li key={d.category}>
                <span className={`font-semibold ${CATEGORY_CLASS[d.category]}`}>
                  {CATEGORY_LABEL[d.category]} −{d.points}
                </span>
                {d.contributions.length > 0 && (
                  <ul className="mt-0.5 ml-4 list-disc space-y-0.5 text-navy/60 dark:text-white/60">
                    {d.contributions.map((c, i) => (
                      <li key={`${c.ruleId}-${i}`}>{contributionLine(c, inputsSummary.pagesAudited)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] font-body text-navy/40 dark:text-white/40">
        Weights as scored ({weightsHash ?? 'unhashed'}); current weights may differ.
      </p>
    </Explainer>
  )
```

(The `mt-2` that was on `<details>` moves to `className="mt-2"`; the inner `mt-2` spacing is handled by the Explainer panel's `space-y-3`/`pt-2`.)

- [ ] Run and confirm green:

```
npx vitest run components/scoring/ScoreExplanation.test.tsx components/scoring/AdaScoreExplanation.test.tsx
```

Expected: `Test Files  2 passed (2)`, `Tests  8 passed (8)`.

- [ ] Commit:

```
git add components/scoring/
git commit -m "refactor(scoring): ScoreExplanation + AdaScoreExplanation adopt Explainer

Bespoke <details> chrome replaced; breakdown content verbatim; legacy
unavailable-fallback and non-v4 no-op stay outside the disclosure.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0166sVCTWUMeNuetJKqZzRCD"
```

---

### Task 3: Site-audit SEO sections adoption (7 components)

**Files:**
- Modify: `components/site-audit/BrokenLinksSection.tsx` (Card wrapper, lines 37–46)
- Modify: `components/site-audit/OnPageSeoSection.tsx` (Card wrapper, lines 12–19)
- Modify: `components/site-audit/ContentSimilaritySection.tsx` (heading area, lines 40–41; imports line 1)
- Modify: `components/site-audit/ContentSignalsSection.tsx` (NotAnalyzed lines 23–30 + main heading lines 66–67)
- Modify: `components/site-audit/TopicOverlapSection.tsx` (NotAnalyzed lines 27–34 + main lines 49–61 — the static paragraph at lines 58–61 MOVES)
- Modify: `components/site-audit/DiscoveryCoverageSection.tsx` (Card lines 11–17, `heading` const lines 48–52 and its four `{heading}` usages at lines 59, 98, 110, 122)
- Modify: `components/site-audit/ContentAuditCard.tsx` (intro paragraph lines 153–155 MOVES)
- Test: `components/site-audit/BrokenLinksSection.test.tsx` (add one disclosure test — this satisfies the spec's "one section test updated"; note: no `OnPageSeoSection.test.tsx` exists, so BrokenLinksSection's existing suite is the section test we extend)

**Interfaces:**
- Consumes: `Explainer`, `ExplainerSummary` from `@/components/ui/Explainer`. No prop/signature changes to any section.

**Copy classification — quoted verbatim so the implementer does not judge.** Finding: contrary to the spec's premise, six of the seven surfaces have NO always-visible static intro paragraph — nearly all their copy is operational (state/coverage/result). For those, the adoption ADDS new methodology copy behind the disclosure (nothing deleted); only TopicOverlapSection and ContentAuditCard have static prose that MOVES.

**STAYS VISIBLE (operational truth — do not touch):**
- BrokenLinksSection: `"Broken links not yet verified — the out-of-band check runs shortly after the audit completes."` · CoverageLine: `"Checked {n} unique target(s)."`, `"{n} could not be confirmed (timeout/blocked) and are excluded."`, `"Results are partial (capped or budget/harvest-truncated)."` · `"Verified — no broken links or images found."` · `" Some links could not be fully checked — results are partial."`
- OnPageSeoSection: `"On-page SEO not yet analyzed — the live scan runs shortly after the audit completes."` · `"This audit predates on-page SEO analysis — re-run the audit to populate it."` · ScoreLine: `"Live SEO score:"`, `"not enough coverage to score"`, `"{observed} of {attempted} page(s) analyzed · {indexable} indexable · rendered, sitemap-bounded (not Screaming Frog parity)"` (the parenthetical is an honesty qualifier — stays) · `"No on-page issues found among the successfully audited HTML pages."`
- ContentSimilaritySection: `"No duplicate or near-duplicate content detected across {n} analyzed pages."` · footer coverage line `"{n} pages analyzed · {n} boilerplate fragments excluded · {n} truncated · results capped"`
- ContentSignalsSection: `"Content signals were not analyzed for this audit."` · `"No stale date references detected."` · `"Showing top {n} of {m} pages with stale date references."` · `"Some page text was truncated at 30k characters, so this is not a full-content guarantee."` · `"Readability — English-calibrated (Flesch)"` (heading with honesty qualifier — stays) · `"Not enough page text to score readability."` · `"Median reading ease … across {n} scored pages."` · `"Showing top {n} of {m} scored pages."`
- TopicOverlapSection: `"Topic overlap was not analyzed for this audit."` · `"No topic-overlap networks detected across {n} analyzed pages."` · `"Showing the largest {n} networks; more were detected."` · the `"and {n} more"` member truncation.
- DiscoveryCoverageSection: `"Discovery coverage not measured (no sitemap was used, or the sitemap exceeded the 1,000-URL cap)."` · `"No off-sitemap URLs found — every internally-linked URL was in the sitemap ({n} listed)."` · both miss-rate result sentences (they carry live numbers) · `"The sitemap miss-rate was not measurable for this run."`
- ContentAuditCard: `"Could not start a content audit."` · `"Retained page text expired — the analysis will fetch pages live."` · `"Waiting for the skill to post findings back…"` · all findings rendering.

**MOVES into the Explainer:**
- TopicOverlapSection lines 58–61: `"Pages that appear to target the same topic — related pages that may compete. Review for consolidation or differentiation."`
- ContentAuditCard lines 153–155: `"Hand off this audit's page content to a Claude session for consistency, stale-claim, and quality review."`

**Forbidden phrases in new explainer copy** (existing regex assertions that must stay unique/absent): BrokenLinksSection copy must not contain `partial` (its test asserts `queryByText(/partial/i)` null and `getAllByText(/partial/i)` length 1); ContentSimilarity copy must not contain `no duplicate`; ContentSignals copy must not contain `were not analyzed`, `truncated at 30k`, `showing top`, `No stale date references detected`; TopicOverlap copy must not contain `not analyzed`, `no topic-overlap`, `and 3 more`, `showing the largest`; DiscoveryCoverage copy must not contain `not measured`; ContentAuditCard's Explainer trigger label must not match `/content audit/i` (its test does `getByRole('button', { name: /content audit/i })` — use `"What is this?"`). The drafted copy below has been checked against every one of these.

**Steps:**

- [ ] Add the failing disclosure test to `components/site-audit/BrokenLinksSection.test.tsx` (append inside the describe block; also add `fireEvent` to the import on line 3):

```tsx
  it('renders methodology behind a collapsed Explainer in every state', () => {
    render(<BrokenLinksSection run={null} />)
    const trigger = screen.getByRole('button', { name: 'What does this measure?' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    // Methodology prose is inert until expanded (not in the a11y tree via role queries).
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/re-requested to confirm it still resolves/i)).toBeTruthy()
    // Operational status copy stayed visible OUTSIDE the disclosure.
    expect(screen.getByText(/not yet verified/i)).toBeTruthy()
  })
```

- [ ] Run and confirm the expected failure:

```
npx vitest run components/site-audit/BrokenLinksSection.test.tsx
```

Expected: `Unable to find an accessible element with the role "button" and name "What does this measure?"` — 1 failed, 6 passed.

- [ ] Modify `components/site-audit/BrokenLinksSection.tsx` — add imports after line 13 and replace the Card wrapper (lines 37–46) so the Explainer renders in all three states:

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

```tsx
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">
        Broken links &amp; images
      </h2>
      <Explainer label="What does this measure?" className="mb-3">
        <ExplainerSummary>
          After the audit completes, every same-domain link and image collected from the rendered
          pages is re-requested to confirm it still resolves (a lightweight request first, then a
          full one to avoid false positives). External links get a lighter probe and are reported
          as amber warnings, since many sites block automated requests. Targets that time out or
          refuse the check are excluded from the broken counts rather than guessed at.
        </ExplainerSummary>
      </Explainer>
      {children}
    </section>
  )
}
```

- [ ] Modify `components/site-audit/OnPageSeoSection.tsx` — add the import after line 10 and replace the Card wrapper (lines 12–19):

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

```tsx
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">On-page SEO</h2>
      <Explainer label="What does this measure?" className="mb-3">
        <ExplainerSummary>
          On-page fundamentals read from the fully rendered pages: missing or duplicate titles,
          meta descriptions and H1s, plus thin content — evaluated over indexable HTML pages only
          (redirects, errors, noindex and login-style pages are skipped). The live SEO score weighs
          these signals together with crawl coverage; duplicate counts are groups of pages sharing
          a value, matching Screaming Frog semantics.
        </ExplainerSummary>
      </Explainer>
      {children}
    </section>
  )
}
```

- [ ] Modify `components/site-audit/ContentSimilaritySection.tsx` — add the import at the top (after the file's comment block; this file currently has no imports) and insert the Explainer directly after the `<h3>` on line 41:

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

```tsx
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">Content similarity</h3>
      <Explainer label="What does this measure?" className="mt-1">
        <ExplainerSummary>
          Flags pages whose main text is identical after normalization, or nearly identical
          (at least 90% overlapping five-word phrases, with common boilerplate like navigation and
          footers filtered out first). This is a lexical comparison of wording — pages covering the
          same topic in different words are the Topic overlap section&apos;s job — and a measurement
          only: it never changes any score.
        </ExplainerSummary>
      </Explainer>
```

- [ ] Modify `components/site-audit/ContentSignalsSection.tsx` — add the import (this file currently has no imports), add a shared explainer element, and render it in BOTH the `NotAnalyzed` card and the main card so the disclosure is present in every state:

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

Add after the `KIND_LABEL` const (line 19):

```tsx
function SignalsExplainer() {
  return (
    <Explainer label="What does this measure?" className="mt-1">
      <ExplainerSummary>
        Two read-time signals from each page&apos;s main text: stale date references (old copyright
        years, past terms or semesters, and passed enrollment deadlines — a bare year on its own
        never flags) and Flesch readability (reading ease and U.S. grade level, calibrated for
        English prose). Only the first 30,000 characters of a page&apos;s main content are examined.
        Measurement only — no score impact.
      </ExplainerSummary>
    </Explainer>
  )
}
```

In `NotAnalyzed` (lines 23–30), insert `<SignalsExplainer />` between the `<h3>` and the `<p>`. In the main return, insert `<SignalsExplainer />` immediately after the `<h3>` on line 67.

- [ ] Modify `components/site-audit/TopicOverlapSection.tsx` — add the import (no existing imports), add the shared explainer (the moved static sentence becomes its first summary), render it in `NotAnalyzed` and the main card, and DELETE the static paragraph at lines 58–61:

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

```tsx
function OverlapExplainer() {
  return (
    <Explainer label="What does this measure?" className="mt-1">
      <ExplainerSummary>
        Pages that appear to target the same topic — related pages that may compete. Review for
        consolidation or differentiation.
      </ExplainerSummary>
      <ExplainerSummary>
        Titles, H1s, meta descriptions and body introductions are embedded locally and compared
        for semantic similarity; pages joined by strong pairwise links form an overlap network,
        graded strong / moderate / weak by the weakest direct link. This complements Content
        similarity (which compares exact wording). Measurement only — no score impact.
      </ExplainerSummary>
    </Explainer>
  )
}
```

In `NotAnalyzed` (lines 27–34), insert `<OverlapExplainer />` between the `<h3>` and the `<p>`. In the main return, insert `<OverlapExplainer />` after the `<h3>` (line 50), and replace lines 56–61 (the fragment opening plus the static `<p className="mt-2 text-sm text-gray-600 dark:text-white/60">Pages that appear to target the same topic…</p>`) so the clusters branch begins directly with the `<ul className="mt-3 space-y-2">`.

- [ ] Modify `components/site-audit/DiscoveryCoverageSection.tsx` — fold the heading + Explainer into the Card wrapper and delete the `heading` const. Replace lines 11–17 with:

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'

// Local Card wrapper — matches BrokenLinksSection/OnPageSeoSection exactly
// (there is no shared components/ui/Card in this repo). Owns the heading +
// methodology Explainer so every state renders both.
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6">
      <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">
        Discovery coverage
      </h2>
      <Explainer label="What does this measure?" className="mt-1">
        <ExplainerSummary>
          Compares two lists the audit already produced: the URLs the sitemap advertised, and the
          same-domain URLs actually linked from the audited pages. Anything linked internally but
          absent from the sitemap is &ldquo;off-sitemap&rdquo; — content search engines can only
          find by crawling. Computed entirely from data already collected; nothing extra is
          fetched.
        </ExplainerSummary>
      </Explainer>
      {children}
    </section>
  )
}
```

Then delete the `heading` const (lines 48–52) and remove all four `{heading}` usages (lines 59, 98, 110, 122). The `import React from 'react'` on line 7 stays.

- [ ] Modify `components/site-audit/ContentAuditCard.tsx` — add the import after line 25 and replace the intro paragraph (lines 153–155):

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

Replace:

```tsx
      <p className="mt-1 text-sm text-gray-600 dark:text-white/70">
        Hand off this audit&apos;s page content to a Claude session for consistency, stale-claim, and quality review.
      </p>
```

with:

```tsx
      <Explainer label="What is this?" className="mt-1">
        <ExplainerSummary>
          Hand off this audit&apos;s page content to a Claude session for consistency, stale-claim,
          and quality review. Starting mints a one-hour access token and copies a prompt for the
          er-handoff-memo skill; the skill reads the audited page text and posts structured
          findings back to this card. Findings are advisory — they never change audit scores.
        </ExplainerSummary>
      </Explainer>
```

- [ ] Run the affected suites and confirm green (existing operational-copy assertions all still pass because that copy did not move; text queries also still find panel content since collapsed panels stay mounted):

```
npx vitest run components/site-audit/BrokenLinksSection.test.tsx components/site-audit/ContentSimilaritySection.test.tsx components/site-audit/ContentSignalsSection.test.tsx components/site-audit/TopicOverlapSection.test.tsx components/site-audit/DiscoveryCoverageSection.test.tsx components/site-audit/ContentAuditCard.test.tsx
```

Expected: `Test Files  6 passed (6)` (BrokenLinks now 7 tests).

- [ ] Commit:

```
git add components/site-audit/
git commit -m "feat(site-audit): SEO sections adopt Explainer methodology disclosures

All 7 C6/C12 sections + ContentAuditCard get a collapsed 'What does this
measure?' explainer; TopicOverlap's static intro sentence and
ContentAuditCard's intro line move behind it; all operational copy
(status/coverage/truncation/honesty) stays visible.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0166sVCTWUMeNuetJKqZzRCD"
```

---

### Task 4: Client dashboard cards adoption (5 cards)

**Files:**
- Modify: `components/clients/GscKeywordCard.tsx` (insert after the header div closing on line 82)
- Modify: `components/clients/GscCannibalizationCard.tsx` (insert after the header div closing on line 74)
- Modify: `components/clients/RobotsCheckCard.tsx` (insert after the header div closing on line 284 — main card only; the zero-domains early-return card at lines 237–244 is untouched)
- Modify: `components/clients/KeywordProfileCard.tsx` (insert after the header div closing on line 178)
- Modify: `components/clients/KeywordStrategyCard.tsx` (insert after the header div closing on line 204)
- Test: none new — these are additive explainers with distinct trigger names (`"What is this?"`); every existing role query in the five suites is name-filtered (verified: `Refresh`, `Run Check`, `Generate strategy prompt`, `Suggest from latest scan`, `Confirm`, `Dismiss`, `Remove`, `Add`, date-named history rows) so nothing collides. Run the suites to prove it.

**Interfaces:**
- Consumes: `Explainer`, `ExplainerSummary` from `@/components/ui/Explainer` (all five files are already `'use client'`). No prop changes.

**Existing explainer-ish copy check (performed):** none of the five cards has a static intro paragraph today — all current prose is operational (unmapped/empty/error/freshness/truncation states) and stays exactly where it is, e.g. GscKeywordCard's `"Map a GSC property in the Analytics IDs panel above…"`, `"Query data hit the Search Console API row limit for this window — results may be truncated."`, the cannibalization honesty note `"…was not observed splitting impressions across pages, not proof it isn't."`; RobotsCheckCard's `"Results possibly incomplete (check hit a size or time cap)."`; KeywordStrategyCard's readiness hints (`"No GSC mapping — GSC signals will be absent"` etc.). All new copy below is additive.

**Forbidden phrases** (regex assertions in the five suites — the drafted copy below avoids all of them): GscKeywordCard: `observed in this GSC window`, `may be truncated`, `service account`, `Fetched`, `Map a GSC property`, `No keyword snapshot yet`. GscCannibalizationCard: `No cannibalized queries observed`, `may be truncated`, `No GSC property is mapped`. RobotsCheckCard: `unchanged`, `robots ok`, `add a domain`, `could not load`, `possibly incomplete`, `Changed vs previous`, `formatting only`, `line diff unavailable`, `issue(s) recorded`, `excluded`, `AI bot blocked`. KeywordProfileCard: `No programs yet`, `run a site seo scan first`, `no completed site seo scan`, `could not save`. KeywordStrategyCard: `Updated`, `No GSC mapping`, `No live scan yet`, `No locale set`, `No keyword strategy yet`.

**Steps:**

- [ ] `GscKeywordCard.tsx` — add the import after line 16 (`import { SeverityBadge } …`):

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

Insert between line 82 (`      </div>`, end of the header flex row) and line 84 (`      {!initial.gscMapped && (`):

```tsx
      <Explainer label="What is this?" className="mb-3">
        <ExplainerSummary>
          Ranking signals pulled from Google Search Console over a trailing 91-day window ending
          three days back: wins (average position in the top 10), opportunities (positions 11–30),
          quick wins (positions 11–20), and queries where two or more pages split the same
          query&apos;s impressions (cannibalization). A keyword that does not appear was simply not
          reported by GSC in the window — never proof the site isn&apos;t ranking for it.
        </ExplainerSummary>
      </Explainer>
```

- [ ] `GscCannibalizationCard.tsx` — add the import after line 13 (`import type { CannibalizationReport } …`):

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

Insert between line 74 (`      </div>`) and line 76 (`      {!gscMapped && (`):

```tsx
      <Explainer label="What is this?" className="mb-3">
        <ExplainerSummary>
          The full keyword-cannibalization list from the latest Search Console snapshot: queries
          where two or more pages each captured at least 20% of the query&apos;s impressions,
          splitting click potential between them. Refreshing here pulls a fresh snapshot and
          rebuilds this report independently of the keyword snapshot card above. A query missing
          from this list wasn&apos;t seen splitting in the window — not proof it can&apos;t be.
        </ExplainerSummary>
      </Explainer>
```

- [ ] `RobotsCheckCard.tsx` — add the import after line 14 (`import type { RobotsChangeSummary } …`):

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

Insert between line 284 (`      </div>`, end of the main card's header row) and line 286 (`      {error && …`):

```tsx
      <Explainer label="What is this?" className="mb-3">
        <ExplainerSummary>
          Point-in-time checks of this domain&apos;s robots.txt and sitemaps: syntax problems,
          AI-crawler blocking, and whether each listed sitemap resolves and how many URLs it
          declares. A weekly scheduled check compares against the previous one and emails an alert
          only when something changed — checks run manually from this card never send alerts.
          Sitemap XML itself is never stored, so history rows carry counts and hashes rather than
          full copies.
        </ExplainerSummary>
      </Explainer>
```

- [ ] `KeywordProfileCard.tsx` — add the import after line 21 (`import { SeverityBadge } …`):

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

Insert between line 178 (`      </div>`, end of the header row) and line 180 (`      {error && …`):

```tsx
      <Explainer label="What is this?" className="mb-3">
        <ExplainerSummary>
          The curated targeting profile that feeds keyword-strategy exports: institution type, the
          confirmed program roster, and the market/language locale used for search-volume lookups.
          Suggested programs are derived from the latest site SEO scan (page URLs, headings, and
          structured data) — confirm the real ones and dismiss the rest. Edits save immediately;
          if two people edit at once, the most recent save wins.
        </ExplainerSummary>
      </Explainer>
```

- [ ] `KeywordStrategyCard.tsx` — add the import after line 23 (`import { KeywordMemoMarkdown } …`; note this file uses semicolons):

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer';
```

Insert between line 204 (`      </div>`, end of the header row) and line 206 (`      {hints.length > 0 && (`):

```tsx
      <Explainer label="What is this?" className="mb-3">
        <ExplainerSummary>
          Builds a clipboard prompt that hands this client&apos;s data — keyword profile, Search
          Console signals, page inventory, and audit findings — to the er-handoff-memo Claude
          skill, which writes an eight-section keyword strategy document back into this card.
          Search-volume lookups during that session use the profile&apos;s locale and are capped
          per session. Regenerating starts a fresh session; the previous document remains until
          the new one arrives.
        </ExplainerSummary>
      </Explainer>
```

- [ ] Run the five suites and confirm green:

```
npx vitest run components/clients/GscKeywordCard.test.tsx components/clients/GscCannibalizationCard.test.tsx components/clients/RobotsCheckCard.test.tsx components/clients/KeywordProfileCard.test.tsx components/clients/KeywordStrategyCard.test.tsx
```

Expected: `Test Files  5 passed (5)` with the same test counts as before this task (no assertions touched).

- [ ] Commit:

```
git add components/clients/
git commit -m "feat(clients): dashboard cards get 'What is this?' Explainers

Additive header-level explainers on GSC keyword/cannibalization, robots
checks, keyword profile, and keyword strategy cards — honest caveats
included; all existing warnings/limits copy untouched.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0166sVCTWUMeNuetJKqZzRCD"
```

---

### Task 5: robots-validator + /reports page intros (both adopted)

**Finding (spec §Adoptions item 4 condition):** both candidates' intro copy IS purely static, so BOTH are adopted.
- `app/(app)/robots-validator/page.tsx` lines 831–833: `"Validate robots.txt syntax, check AI bot access status, test URLs against rules, and validate sitemap structure — all client-side, nothing uploaded."` — unconditional static prose, no data interpolation. The page's header band is ALWAYS `bg-navy` (line 818/820) regardless of theme, so the Explainer goes into the content area as a `variant="card"` (the page's other cards are already white-on-navy in light mode — a card-variant Explainer matches them exactly). The `param-autorun.test.tsx` suite makes no copy assertions on this paragraph (verified).
- `app/(app)/reports/page.tsx` lines 14–16: `"Generate branded GA4 + Search Console performance reports. Pick a client, date range, and comparison period."` — unconditional static prose. Server component; rendering the client `Explainer` from it is fine.

**Files:**
- Modify: `app/(app)/robots-validator/page.tsx` (delete lines 831–833; insert into the content area at line 838)
- Modify: `app/(app)/reports/page.tsx` (replace lines 14–16)
- Test: none (neither page has copy-level tests; behavior covered by the Explainer suite)

**Interfaces:**
- Consumes: `Explainer`, `ExplainerSummary` from `@/components/ui/Explainer`.

**Steps:**

- [ ] `app/(app)/robots-validator/page.tsx` — add to the import block (after line 13, `import { safeExternalHref } …`):

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

Delete the subtitle paragraph (lines 831–833):

```tsx
          <p className="font-body text-[14px] text-white/50 max-w-xl">
            Validate robots.txt syntax, check AI bot access status, test URLs against rules, and validate sitemap structure — all client-side, nothing uploaded.
          </p>
```

Then make the Explainer the first element of the content area — change lines 837–839 from:

```tsx
      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <RobotsSection onFetchSitemap={handleFetchSitemapFromRobots} />
```

to:

```tsx
      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <Explainer label="What does this tool do?" variant="card">
          <ExplainerSummary>
            Validate robots.txt syntax, check AI bot access status, test URLs against rules, and
            validate sitemap structure — all client-side, nothing uploaded. Paste content, upload a
            file, or fetch straight from a URL; the parsers flag syntax problems, blocked AI
            crawlers, and sitemap metadata gaps without storing anything.
          </ExplainerSummary>
        </Explainer>
        <RobotsSection onFetchSitemap={handleFetchSitemapFromRobots} />
```

(The first sentence is the original subtitle verbatim — relocated, not deleted.)

- [ ] `app/(app)/reports/page.tsx` — add the import after line 3:

```tsx
import { Explainer, ExplainerSummary } from '@/components/ui/Explainer'
```

Replace lines 14–16:

```tsx
        <p className="text-sm font-body text-gray-500 dark:text-white/50">
          Generate branded GA4 + Search Console performance reports. Pick a client, date range, and comparison period.
        </p>
```

with:

```tsx
        <Explainer label="What is this?" className="mt-1">
          <ExplainerSummary>
            Generate branded GA4 + Search Console performance reports. Pick a client, date range,
            and comparison period. Data comes from the Google connection configured in Settings;
            each report snapshots its metrics at generation time, and finished PDFs collect in the
            library below.
          </ExplainerSummary>
        </Explainer>
```

- [ ] Sanity-run the robots-validator suite (it mounts the page):

```
npx vitest run "app/(app)/robots-validator/param-autorun.test.tsx"
```

Expected: `Test Files  1 passed (1)`.

- [ ] Commit:

```
git add "app/(app)/robots-validator/page.tsx" "app/(app)/reports/page.tsx"
git commit -m "feat(pages): robots-validator + /reports intros move behind Explainers

Both intros verified purely static per the spec's condition; original
sentences relocated verbatim with brief additions.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0166sVCTWUMeNuetJKqZzRCD"
```

---

### Task 6: Full-suite gates

**Files:** none (verification only).

**Steps:**

- [ ] Type gate (the ONLY type-check gate — in-build checks are disabled):

```
npx tsc --noEmit
```

Expected output: none (exit 0). If `inert` errors surface, `@types/react` must be `^19` (it is, per `package.json` line 57) — do NOT cast; fix the types.

- [ ] Full test gate:

```
npx vitest run
```

Expected: all test files pass (the repo suite includes DB-backed tests via `test/global-setup.ts`; runtime several minutes). If any failure appears, compare against a fresh `main` run before assuming this branch caused it — but every file this plan touches has its suite explicitly run in Tasks 1–5, so failures here should be unrelated flake or a genuine regression in an untouched consumer (check `components/seo-parser/ResultsView`, `components/score-lab/ScoreLabClient`, `components/ada-audit/AuditResultsView`, `components/ada-audit/SiteAuditResultsShell` — the other ScoreExplanation/AdaScoreExplanation consumers; their props are unchanged so only render-shape assumptions could break).

- [ ] Visual spot-check (optional but recommended): `npm run dev`, verify (a) a completed site audit's SEO tab shows collapsed "What does this measure?" triggers on all sections with smooth expand, (b) a client page shows the five card explainers, (c) `/robots-validator` shows the card-variant explainer above the first section in both themes, (d) reduced-motion (OS setting) toggles instantly.

- [ ] Final commit if anything was adjusted, then the branch is ready for review/PR per `er-seo-tools-change-control` (no merge or deploy from this plan).

---

## Deviations from the spec (recorded)

1. **Six of seven site-audit sections have no static intro paragraph to move.** The spec assumed "always-visible intro paragraphs that crowd sections"; in the code, almost all section copy is operational (states, coverage, truncation, results). Only TopicOverlapSection (one sentence) and ContentAuditCard (one sentence) had genuinely static prose. For the rest, the adoption ADDS drafted methodology copy behind the disclosure — consistent with the spec's "nothing is deleted, only relocated" plus the client-card precedent of writing new copy.
2. **`OnPageSeoSection.test.tsx` does not exist.** The spec's "one section test updated (e.g. OnPageSeoSection)" is satisfied by extending the existing `BrokenLinksSection.test.tsx` instead (Task 3), which proves the same contract: methodology behind a collapsed trigger, operational copy still visible.
3. **Trigger label tense change:** existing bespoke expanders say "How this score **was** calculated"; the spec mandates "How this score **is** calculated". The spec wins; both scoring test suites are updated accordingly.
4. **`OnPageSeoSection`'s ScoreLine qualifier "rendered, sitemap-bounded (not Screaming Frog parity)" stays visible** even though it reads like methodology — it is an honesty qualifier attached to live coverage numbers, which the spec's operational-truth rule explicitly keeps visible.
