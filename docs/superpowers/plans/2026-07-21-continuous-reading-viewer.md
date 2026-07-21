# Continuous-reading viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public viewbook viewer a continuous, hierarchy-driven reading experience by default (full lead hero + chapter heroes + "In this stage" overview + scroll-driven active rail + hero-exit sticky label + "Previous stages" rows), with the current collapse-first viewer preserved but dormant behind a `viewerMode` gate.

**Architecture:** `viewerMode: 'continuous' | 'collapse'` is a `ViewbookPublicData` field resolved by `readPresentationConfig` (default `'continuous'`, no DB column in Phase 1). `SectionShell` and `ViewbookShell` branch on it — continuous is the new active path; the existing `CollapsibleSection`/morph + `EarlierSteps` path is preserved verbatim under `'collapse'`. `renderSection` widens to `(section, meta)` so `ViewbookShell` can drive hero-sizing/status/lead per section. A single `ReadingProgressController` drives active state by writing only presentational DOM attributes (never height/collapse — the documented blink-bug rule).

**Tech Stack:** Next.js 15 App Router (RSC), TypeScript, Tailwind (LIGHT-ONLY for the public viewbook — no `dark:`, color via `--vb-*` vars), Vitest + Testing Library (jsdom, NO jest-dom).

Spec: `docs/superpowers/specs/2026-07-21-continuous-reading-viewer-design.md` — read §4–§8 before any task; it is the contract. Codex-reviewed (accept-with-named-fixes; all 6 applied).

## Global Constraints

- **Public viewbook is LIGHT-ONLY** — never emit `dark:` classes; all color via `--vb-*` CSS vars or explicit literals.
- **NO jest-dom** — no `toBeInTheDocument`. Every test uses DOM-native assertions: `container.querySelector(...)` + `.toBeTruthy()`/`.toBeNull()`, `el.textContent`, `el.getAttribute(...)`. `screen.getByText(...)` is a valid existence check (throws when absent); never chain `.toBeInTheDocument()`.
- **RTL/jsdom test files start with `// @vitest-environment jsdom` as line 1.**
- **No RSC boundary violations** — a `'use client'` component must not receive a function prop. `PreviousStages` takes `renderSection` (a function) → it MUST be a server component. `StageOverview`/`ReadingProgressController`/`SectionReveal` are client leaves with serializable props (+ server-rendered node children).
- **`SectionRenderMeta`** = `{ heroSize: 'full'|'chapter'|'none'; chapterNumber: number|null; status: SectionStatus; isLead: boolean }`, exported from `lib/viewbook/section-status.ts` (NOT `public-types.ts` — cycle-free).
- **`renderSection` signature:** `(section: PublicSection, meta: SectionRenderMeta) => ReactNode`, uniform across both modes. `page.tsx`'s two callbacks widen; `OperatorSectionWrapper` composes the rendered node and does NOT consume `meta`.
- **Section catalog (13):** `welcome, milestones, data-source, brand, assessment, strategy, materials, pc-intro, pc-setup, pc-invite, pc-thanks, kickoff-next, ws-intro`. `PublicSection.state` is `'active' | 'done'` ONLY (no `'collapsed'`).
- **DOM contract:** section root `data-vb-section`/`data-vb-status`/`data-vb-hero-visible` + `scroll-margin-top: calc(var(--vb-sticky-offset,0px) + 12px)`; hero `data-vb-hero`; sticky duplicate label `data-vb-sticky-label` (`aria-hidden`, text-only); rail top-level buttons `data-vb-toc-section="{sectionKey}"`; controller writes `data-vb-active="true"` + `aria-current="location"` on the active rail node.
- **Event seam:** `StickyOffsetProbe` dispatches `window` `CustomEvent('vb:sticky-offset-change', { detail: { offset } })`; `ReadingProgressController` listens + dedups on `detail.offset === lastBuiltOffset`.
- **Gate before every commit:** `npx tsc --noEmit` && `npx vitest run <affected suites>` green; full `npx vitest run` before the PR. In-build type-check/lint stay disabled (CLAUDE.md).
- **Array-form `$transaction` only** (only relevant in Phase 2's PATCH, which routes through the existing kit — no new transaction).
- **Commit trailers** (repo convention): end each commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01QjQ4gmMazysLuzSGWe7Bd6`.
- **`ViewbookShell` derives rendering + status + overview + previous-stages + TOC from the SAME arrays** (`data.primarySections` / `data.carriedSections`) — lead/status/rail can never diverge (Codex fix #6).

## File Structure

**New pure modules (`lib/viewbook/`):**
- `section-status.ts` — `SectionStatus` + `SectionRenderMeta` + `computeSectionStatuses(...)` + `carriedStatus(...)`.
- `section-origin.ts` — `originStageOf(key)` + `groupCarriedByOrigin(sections)`.

**New components (`components/viewbook/public/`):**
- `StageOverview.tsx` — client leaf ("In this stage" strip).
- `PreviousStages.tsx` — server component (carried sections grouped by origin, all expandable rows).
- `ReadingProgressController.tsx` — client leaf, no props, returns null (scroll controller).

**Extended:** `presentation-config.ts` (+`VIEWER_MODES`/`ViewerMode`/default), `public-types.ts` (`viewerMode`), `SectionSummaryPanel.tsx` (+`status`/`StatusPill`), `StickyOffsetProbe.tsx` (event).

**Mode-branched:** `SectionShell.tsx`, `SectionReveal.tsx`, `ViewbookShell.tsx`, `app/(public)/viewbook/[token]/page.tsx`, all 13 section components, `components/viewbook/admin/ThemePreview.tsx`, `TocRail.tsx`.

**Untouched (dormant, kept):** `CollapsibleSection.tsx`, `CollapseAffordance.tsx`, `useCollapseState.ts`, `useWelcomeAutoReveal.ts`, `EarlierSteps.tsx`, `section-display.ts`, `toc-index.ts`.

---

# PHASE 1 — continuous default (THE shipping PR)

### Task 1: `section-status.ts` — pure status derivation

**Files:**
- Create: `lib/viewbook/section-status.ts`
- Test: `lib/viewbook/section-status.test.ts`

**Interfaces:**
- Consumes: `INPUT_EXPECTING_KEYS` (`./section-copy`), `PublicSection` (`./public-types`), `SectionKey` (`./theme`).
- Produces: `type SectionStatus = 'complete'|'current'|'upcoming'|'needs-input'`; `interface SectionRenderMeta { heroSize: 'full'|'chapter'|'none'; chapterNumber: number|null; status: SectionStatus; isLead: boolean }`; `computeSectionStatuses(renderedPrimaryOrder: SectionKey[], sections: Pick<PublicSection,'sectionKey'|'state'|'acknowledgedAt'>[], ctx: { pcCompletedAt: string|null }): Partial<Record<SectionKey, SectionStatus>>`; `carriedStatus(section: Pick<PublicSection,'state'>): SectionStatus`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/viewbook/section-status.test.ts
import { describe, it, expect } from 'vitest'
import { computeSectionStatuses, carriedStatus } from './section-status'
import type { SectionKey } from './theme'

const sec = (sectionKey: string, state: 'active' | 'done', acknowledgedAt: string | null = null) =>
  ({ sectionKey, state, acknowledgedAt }) as unknown as Parameters<typeof computeSectionStatuses>[1][number]
const order = (...keys: string[]) => keys as unknown as SectionKey[]

describe('computeSectionStatuses', () => {
  it('done → complete; first active informational → current; later active → upcoming', () => {
    const r = computeSectionStatuses(
      order('welcome', 'milestones', 'strategy'),
      [sec('welcome', 'done'), sec('milestones', 'active'), sec('strategy', 'active')],
      { pcCompletedAt: null },
    )
    expect(r.welcome).toBe('complete')
    expect(r.milestones).toBe('current')
    expect(r.strategy).toBe('upcoming')
  })
  it('active input-expecting → needs-input; acknowledged input → complete', () => {
    const r = computeSectionStatuses(
      order('pc-setup', 'data-source'),
      [sec('pc-setup', 'active'), sec('data-source', 'active', '2026-07-01T00:00:00Z')],
      { pcCompletedAt: null },
    )
    expect(r['pc-setup']).toBe('needs-input')
    expect(r['data-source']).toBe('complete')
  })
  it('needs-input does NOT consume the single current slot', () => {
    const r = computeSectionStatuses(
      order('pc-setup', 'welcome'),
      [sec('pc-setup', 'active'), sec('welcome', 'active')],
      { pcCompletedAt: null },
    )
    expect(r['pc-setup']).toBe('needs-input')
    expect(r.welcome).toBe('current')
  })
  it('pc-intro: complete once pcCompletedAt set, else current', () => {
    const active = computeSectionStatuses(order('pc-intro', 'pc-setup'), [sec('pc-intro', 'active'), sec('pc-setup', 'active')], { pcCompletedAt: null })
    expect(active['pc-intro']).toBe('current')
    const done = computeSectionStatuses(order('pc-intro', 'pc-setup'), [sec('pc-intro', 'active'), sec('pc-setup', 'done')], { pcCompletedAt: '2026-07-01T00:00:00Z' })
    expect(done['pc-intro']).toBe('complete')
  })
  it('all-complete lineup fabricates no current', () => {
    const r = computeSectionStatuses(order('welcome', 'milestones'), [sec('welcome', 'done'), sec('milestones', 'done')], { pcCompletedAt: null })
    expect(Object.values(r)).toEqual(['complete', 'complete'])
  })
  it('returns a partial map — missing keys are absent', () => {
    const r = computeSectionStatuses(order('welcome'), [sec('welcome', 'active')], { pcCompletedAt: null })
    expect('milestones' in r).toBe(false)
  })
  it('exactly one current across a mixed lineup', () => {
    const r = computeSectionStatuses(
      order('welcome', 'milestones', 'strategy'),
      [sec('welcome', 'active'), sec('milestones', 'active'), sec('strategy', 'active')],
      { pcCompletedAt: null },
    )
    expect(Object.values(r).filter((v) => v === 'current')).toHaveLength(1)
    expect(r.welcome).toBe('current')
    expect(r.milestones).toBe('upcoming')
  })
  it('pc-thanks runs the progression (consumes current when first non-terminal)', () => {
    const r = computeSectionStatuses(
      order('pc-thanks', 'welcome'),
      [sec('pc-thanks', 'active'), sec('welcome', 'active')],
      { pcCompletedAt: '2026-07-01T00:00:00Z' },
    )
    expect(r['pc-thanks']).toBe('current')
    expect(r.welcome).toBe('upcoming')
  })
  it('an acknowledged NON-input active section reads complete', () => {
    const r = computeSectionStatuses(
      order('welcome'),
      [sec('welcome', 'active', '2026-07-01T00:00:00Z')],
      { pcCompletedAt: null },
    )
    expect(r.welcome).toBe('complete')
  })
})

describe('carriedStatus', () => {
  it('done → complete, else current', () => {
    expect(carriedStatus({ state: 'done' })).toBe('complete')
    expect(carriedStatus({ state: 'active' })).toBe('current')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run lib/viewbook/section-status.test.ts` → "Cannot find module './section-status'".

- [ ] **Step 3: Implement**

```ts
// lib/viewbook/section-status.ts
// Pure, client-safe section-status derivation for the continuous-reading viewer
// (spec §5.1). No scroll state; no server imports. Also the home of
// SectionRenderMeta (kept out of public-types.ts to stay cycle-free).
import type { SectionKey } from './theme'
import type { PublicSection } from './public-types'
import { INPUT_EXPECTING_KEYS } from './section-copy'

export type SectionStatus = 'complete' | 'current' | 'upcoming' | 'needs-input'

export interface SectionRenderMeta {
  heroSize: 'full' | 'chapter' | 'none'
  chapterNumber: number | null // 1-based position in the rendered primary lineup; null for carried
  status: SectionStatus
  isLead: boolean
}

// Derived from the RENDERED primary lineup order + each section's state. There
// is exactly ONE 'current' (the first non-terminal section); needs-input is a
// distinct call-to-action status that does NOT consume that slot. Returns a
// partial map — a key not in `sections` is absent, never defaulted.
export function computeSectionStatuses(
  renderedPrimaryOrder: SectionKey[],
  sections: Pick<PublicSection, 'sectionKey' | 'state' | 'acknowledgedAt'>[],
  ctx: { pcCompletedAt: string | null },
): Partial<Record<SectionKey, SectionStatus>> {
  const byKey = new Map(sections.map((s) => [s.sectionKey, s]))
  const out: Partial<Record<SectionKey, SectionStatus>> = {}
  let currentAssigned = false
  const progress = (key: SectionKey) => {
    if (!currentAssigned) {
      out[key] = 'current'
      currentAssigned = true
    } else {
      out[key] = 'upcoming'
    }
  }
  for (const key of renderedPrimaryOrder) {
    const s = byKey.get(key)
    if (!s) continue
    if (key === 'pc-intro') {
      if (ctx.pcCompletedAt != null) out[key] = 'complete'
      else progress(key)
      continue
    }
    if (key === 'pc-thanks') {
      progress(key)
      continue
    }
    if (s.state === 'done') {
      out[key] = 'complete'
      continue
    }
    if (s.acknowledgedAt != null) {
      out[key] = 'complete'
      continue
    }
    if (INPUT_EXPECTING_KEYS.has(key)) {
      out[key] = 'needs-input'
      continue
    }
    progress(key)
  }
  return out
}

export function carriedStatus(section: Pick<PublicSection, 'state'>): SectionStatus {
  return section.state === 'done' ? 'complete' : 'current'
}
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run lib/viewbook/section-status.test.ts`
- [ ] **Step 5: Commit** — `feat(viewbook): pure section-status derivation + SectionRenderMeta`

---

### Task 2: `section-origin.ts` — carried-section origin grouping

**Files:**
- Create: `lib/viewbook/section-origin.ts`
- Test: `lib/viewbook/section-origin.test.ts`

**Interfaces:**
- Consumes: `STAGE_LINEUPS`, `STAGE_LABELS`, `VIEWBOOK_STAGES`, `ViewbookStage` (`./stages`), `PublicSection` (`./public-types`), `SectionKey` (`./theme`).
- Produces: `originStageOf(key: SectionKey): ViewbookStage | null`; `groupCarriedByOrigin(sections: PublicSection[]): { stageLabel: string; sections: PublicSection[] }[]`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/viewbook/section-origin.test.ts
import { describe, it, expect } from 'vitest'
import { originStageOf, groupCarriedByOrigin } from './section-origin'
import type { PublicSection } from './public-types'

const sec = (sectionKey: string, state: 'active' | 'done' = 'done') =>
  ({ sectionKey, state, doneAt: null, acknowledgedAt: null, introNote: null, narrative: null }) as PublicSection

describe('originStageOf', () => {
  it('maps a key to the first stage whose primary lineup contains it', () => {
    expect(originStageOf('pc-setup')).toBe('post-contract')
    expect(originStageOf('welcome')).toBe('kickoff')
    expect(originStageOf('brand')).toBe('website-specifics')
  })
})

describe('groupCarriedByOrigin', () => {
  it('buckets sections by origin stage in canonical order', () => {
    const groups = groupCarriedByOrigin([sec('welcome'), sec('pc-setup')])
    expect(groups.map((g) => g.stageLabel)).toEqual(['Getting Started', 'Kickoff'])
    expect(groups[0].sections[0].sectionKey).toBe('pc-setup')
  })
  it('returns [] for no carried sections', () => {
    expect(groupCarriedByOrigin([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// lib/viewbook/section-origin.ts
// Pure, client-safe: which stage a carried section "belongs" to, and grouping
// carried sections by that origin for the continuous viewer's "Previous stages"
// (spec §5.2).
import type { SectionKey } from './theme'
import type { PublicSection } from './public-types'
import { STAGE_LINEUPS, STAGE_LABELS, VIEWBOOK_STAGES, type ViewbookStage } from './stages'

export function originStageOf(key: SectionKey): ViewbookStage | null {
  for (const stage of VIEWBOOK_STAGES) {
    if (STAGE_LINEUPS[stage].primary.includes(key)) return stage
  }
  return null
}

export function groupCarriedByOrigin(
  sections: PublicSection[],
): { stageLabel: string; sections: PublicSection[] }[] {
  const buckets = new Map<ViewbookStage, PublicSection[]>()
  for (const s of sections) {
    const origin = originStageOf(s.sectionKey)
    if (!origin) continue
    const arr = buckets.get(origin) ?? []
    arr.push(s)
    buckets.set(origin, arr)
  }
  const out: { stageLabel: string; sections: PublicSection[] }[] = []
  for (const stage of VIEWBOOK_STAGES) {
    const arr = buckets.get(stage)
    if (arr && arr.length) out.push({ stageLabel: STAGE_LABELS[stage], sections: arr })
  }
  return out
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(viewbook): carried-section origin grouping helper`

---

### Task 3: `viewerMode` in presentation-config + public-types

**Files:**
- Modify: `lib/viewbook/presentation-config.ts`
- Modify: `lib/viewbook/public-types.ts`
- Test: `lib/viewbook/presentation-config.test.ts` (extend the existing suite)

**Interfaces:**
- Produces: `VIEWER_MODES` (`readonly ['continuous','collapse']`), `type ViewerMode`; `readPresentationConfig` return gains `viewerMode: ViewerMode` (default `'continuous'`); `ViewbookPublicData.viewerMode: ViewerMode`.
- Consumed by: `SectionShell`/`ViewbookShell` (Task 10) via `data.viewerMode`.

- [ ] **Step 1: Update existing full-object expectations + add failing tests** (Codex plan-fix #3). First, any existing test in `presentation-config.test.ts` that asserts a full `readPresentationConfig(...)`/`PRESENTATION_DEFAULTS` object via `.toEqual({...})` MUST gain `viewerMode: 'continuous'` in the expected object — adding the field without this makes the existing equality test fail. `readPresentationConfig` is already imported in that file — reuse the existing import, do NOT add a duplicate binding. Then append:

```ts
// (readPresentationConfig already imported at the top of this file — do not re-import)

describe('viewerMode', () => {
  it('defaults to continuous when the field is absent', () => {
    const r = readPresentationConfig({ collapseAffordance: 'chevron', heroOverlayStrength: 55 } as never)
    expect(r.viewerMode).toBe('continuous')
  })
  it('accepts a valid collapse value', () => {
    const r = readPresentationConfig({ collapseAffordance: 'chevron', heroOverlayStrength: 55, viewerMode: 'collapse' } as never)
    expect(r.viewerMode).toBe('collapse')
  })
  it('degrades an unknown value to continuous', () => {
    const r = readPresentationConfig({ collapseAffordance: 'chevron', heroOverlayStrength: 55, viewerMode: 'weird' } as never)
    expect(r.viewerMode).toBe('continuous')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`viewerMode` undefined on the result).

- [ ] **Step 3: Implement in `presentation-config.ts`**

Add after the `COLLAPSE_MORPHS` block:

```ts
// Viewer render mode (spec §4). Continuous-reading is the default active viewer;
// 'collapse' re-activates the dormant collapse-first path. The Phase-1 read side
// defaults absent/invalid → 'continuous'; the DB column + strict write land in
// Phase 2 (parsePresentationPatch validation).
export const VIEWER_MODES = ['continuous', 'collapse'] as const
export type ViewerMode = (typeof VIEWER_MODES)[number]

function isViewerMode(v: unknown): v is ViewerMode {
  return typeof v === 'string' && (VIEWER_MODES as readonly string[]).includes(v)
}
```

Add `viewerMode: 'continuous' as ViewerMode,` to `PRESENTATION_DEFAULTS`.

Add `viewerMode?: string` to the `readPresentationConfig` `row` parameter type, add `viewerMode: ViewerMode` to its return type, and add to the returned object:

```ts
    viewerMode: isViewerMode(row.viewerMode) ? row.viewerMode : PRESENTATION_DEFAULTS.viewerMode,
```

(Do NOT touch `parsePresentationPatch` in Phase 1 — there is no writer yet.)

- [ ] **Step 4: Implement in `public-types.ts`** — add the import + field.

At the top import block add `ViewerMode`:
```ts
import type { CollapseAffordanceKind, CollapseMorphKind, ViewerMode } from './presentation-config'
```
In `ViewbookPublicData`, after `firstLoadDelayMs`:
```ts
  viewerMode: ViewerMode // 'continuous' (default active reading viewer) | 'collapse' (dormant collapse-first path); resolved by readPresentationConfig
```

`public-data.ts` already spreads `...readPresentationConfig(vb)` (line ~144), so `viewerMode` flows in with no loader change.

- [ ] **Step 5: Run — expect PASS.** `npx vitest run lib/viewbook/presentation-config.test.ts` && `npx tsc --noEmit`
- [ ] **Step 6: Commit** — `feat(viewbook): viewerMode presentation field (default continuous, read-only Phase 1)`

---

### Task 4: `SectionSummaryPanel` gains `status` + `StatusPill`

**Files:**
- Modify: `components/viewbook/public/SectionSummaryPanel.tsx`
- Test: `components/viewbook/public/SectionSummaryPanel.test.tsx` (extend)

**Interfaces:**
- Produces: `StatusPill({ status: SectionStatus })` (named export); `SectionSummaryPanel` gains optional `status?: SectionStatus`.
- Consumed by: `StageOverview` (Task 6), `PreviousStages` (Task 7), `SectionShell` chapter header (Task 10).

- [ ] **Step 1: Add failing tests** (append)

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { StatusPill } from './SectionSummaryPanel'

describe('StatusPill', () => {
  it('renders a visible text label per status (never color-alone)', () => {
    const { container } = render(<StatusPill status="needs-input" />)
    expect(container.textContent).toContain('Needs input')
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`StatusPill` not exported).

- [ ] **Step 3: Implement** — replace the file with:

```tsx
// A plain-language "what / why" panel a section renders at the top of its
// expanded body (spec §5.5). Server component; LIGHT-ONLY (color via --vb-*).
// Extended for the continuous viewer: an optional status pill + a shared
// StatusPill export reused by StageOverview / PreviousStages / the chapter header.
import type { SectionStatus } from '@/lib/viewbook/section-status'

const STATUS_LABEL: Record<SectionStatus, string> = {
  complete: 'Complete',
  current: 'Current',
  upcoming: 'Upcoming',
  'needs-input': 'Needs input',
}

// Visible TEXT label always present (status is never conveyed by color alone).
export function StatusPill({ status }: { status: SectionStatus }) {
  const filled = status === 'complete' || status === 'needs-input'
  const bg = status === 'complete' ? 'var(--vb-secondary)' : status === 'needs-input' ? 'var(--vb-primary)' : 'transparent'
  // Codex plan-fix #1: on-secondary for the secondary-bg 'complete' pill; on-primary for the primary-bg 'needs-input' pill.
  const color = status === 'complete' ? 'var(--vb-on-secondary)' : status === 'needs-input' ? 'var(--vb-on-primary)' : 'rgba(0,0,0,0.6)'
  return (
    <span
      data-vb-status-pill={status}
      className="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
      style={{ background: bg, color, borderColor: filled ? 'transparent' : 'rgba(0,0,0,0.15)' }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

export function SectionSummaryPanel({
  whatThis,
  whatWeNeed,
  status,
}: {
  whatThis: string
  whatWeNeed: string | null
  status?: SectionStatus
}) {
  return (
    <div data-vb-summary-panel className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vb-secondary)' }}>
              What this is
            </p>
            {status && <StatusPill status={status} />}
          </div>
          <p className="mt-1 max-w-[68ch] text-sm text-black/70">{whatThis}</p>
        </div>
        {whatWeNeed != null && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vb-primary)' }}>
              What we need from you
            </p>
            <p className="mt-1 max-w-[68ch] text-sm text-black/70">{whatWeNeed}</p>
          </div>
        )}
      </div>
    </div>
  )
}
```

(The existing `SectionShell` collapse-body call passes `{ whatThis, whatWeNeed }` with no `status` — still valid, `status` is optional.)

- [ ] **Step 4: Run — expect PASS.** `npx vitest run components/viewbook/public/SectionSummaryPanel.test.tsx`
- [ ] **Step 5: Commit** — `feat(viewbook): StatusPill + optional status on SectionSummaryPanel`

---

### Task 5: `StickyOffsetProbe` emits `vb:sticky-offset-change`

**Files:**
- Modify: `components/viewbook/public/StickyOffsetProbe.tsx`
- Test: `components/viewbook/public/StickyOffsetProbe.test.tsx` (extend)

**Interfaces:**
- Produces: a `window` `CustomEvent('vb:sticky-offset-change', { detail: { offset: number } })` after every recompute.
- Consumed by: `ReadingProgressController` (Task 8).

- [ ] **Step 1: Add failing test** (append — reuse the file's existing imports/`beforeEach` mocks; do NOT re-import `render`/`StickyOffsetProbe`). Render inside the existing mocked 64px-nav + theme-root scene the suite already sets up so the asserted offset is concrete (Codex plan-fix #3):

```tsx
it('dispatches vb:sticky-offset-change with the summed offset (64px nav)', async () => {
  const events: number[] = []
  const handler = (e: Event) => events.push((e as CustomEvent).detail.offset)
  window.addEventListener('vb:sticky-offset-change', handler)
  // Rebuild the same scene the existing tests use: a #vb-progress-nav whose
  // mocked getBoundingClientRect().height is 64, inside a [data-vb-theme-root].
  // (If the suite provides a scene() helper, call it; otherwise mirror its setup.)
  const { unmount } = render(<StickyOffsetProbe />)
  await waitFor(() => expect(events.length).toBeGreaterThan(0))
  expect(events[0]).toBe(64)
  window.removeEventListener('vb:sticky-offset-change', handler)
  unmount()
})
```

(Import `waitFor` from `@testing-library/react` alongside the file's existing `render` import — merge, don't duplicate.)

- [ ] **Step 2: Run — expect FAIL** (no event fired).

- [ ] **Step 3: Implement** — add near the other constants in `StickyOffsetProbe.tsx`:

```ts
function dispatchStickyOffsetChange(offset: number): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('vb:sticky-offset-change', { detail: { offset } }))
  } catch {
    /* CustomEvent unavailable — never throw */
  }
}
```

At the END of `recompute()` (after the `for (const root of targets)` loop):

```ts
      dispatchStickyOffsetChange(sticky)
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run components/viewbook/public/StickyOffsetProbe.test.tsx`
- [ ] **Step 5: Commit** — `feat(viewbook): StickyOffsetProbe emits vb:sticky-offset-change`

---

### Task 6: `StageOverview` — "In this stage" strip

**Files:**
- Create: `components/viewbook/public/StageOverview.tsx`
- Test: `components/viewbook/public/StageOverview.test.tsx`

**Interfaces:**
- Consumes: `navigateToAnchor` (`./viewbook-navigate`), `StatusPill` (`./SectionSummaryPanel`), `SectionStatus` (`@/lib/viewbook/section-status`), `SectionKey` (`@/lib/viewbook/theme`).
- Produces: `StageOverview({ items: { sectionKey: SectionKey; label: string; status: SectionStatus; anchor: string }[] })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

const navigateSpy = vi.fn()
vi.mock('./viewbook-navigate', () => ({ navigateToAnchor: (k: string, a: string) => navigateSpy(k, a) }))

import { StageOverview } from './StageOverview'

const items = [
  { sectionKey: 'welcome' as const, label: 'Welcome & Team', status: 'complete' as const, anchor: '#welcome' },
  { sectionKey: 'milestones' as const, label: 'Milestones', status: 'current' as const, anchor: '#milestones' },
]

describe('StageOverview', () => {
  it('renders a nav with one button per item', () => {
    const { container } = render(<StageOverview items={items} />)
    expect(container.querySelector('nav[aria-label="In this stage"]')).toBeTruthy()
    expect(container.querySelectorAll('button').length).toBe(2)
    expect(container.textContent).toContain('Welcome & Team')
    expect(container.textContent).toContain('Milestones')
  })
  it('click navigates to the item anchor', () => {
    const { container } = render(<StageOverview items={items} />)
    fireEvent.click(container.querySelectorAll('button')[1])
    expect(navigateSpy).toHaveBeenCalledWith('milestones', '#milestones')
  })
  it('renders nothing for empty items', () => {
    const { container } = render(<StageOverview items={[]} />)
    expect(container.querySelector('nav')).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```tsx
'use client'

// "In this stage" overview strip (spec §5.5): a compact index of the current
// stage's primary sections, each a click-to-scroll into the flow. Client leaf,
// serializable props only; LIGHT-ONLY.
import type { SectionKey } from '@/lib/viewbook/theme'
import type { SectionStatus } from '@/lib/viewbook/section-status'
import { navigateToAnchor } from './viewbook-navigate'
import { StatusPill } from './SectionSummaryPanel'

export function StageOverview({
  items,
}: {
  items: { sectionKey: SectionKey; label: string; status: SectionStatus; anchor: string }[]
}) {
  if (items.length === 0) return null
  return (
    <nav aria-label="In this stage" className="mx-auto w-full max-w-5xl px-6 py-6">
      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--vb-secondary)' }}>
          In this stage
        </p>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((item, i) => (
            <li key={`${item.sectionKey}-${item.anchor}`}>
              <button
                type="button"
                onClick={() => navigateToAnchor(item.sectionKey, item.anchor)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-black/5"
              >
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  style={{ background: 'color-mix(in srgb, var(--vb-secondary) 14%, transparent)', color: 'var(--vb-secondary)' }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-black/80">{item.label}</span>
                <StatusPill status={item.status} />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  )
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(viewbook): StageOverview "In this stage" strip`

---

### Task 7: `PreviousStages` — carried sections grouped by origin

**Files:**
- Create: `components/viewbook/public/PreviousStages.tsx`
- Test: `components/viewbook/public/PreviousStages.test.tsx`

**Interfaces:**
- Consumes: `carriedStatus`, `SectionRenderMeta` (`@/lib/viewbook/section-status`), `PublicSection` (`@/lib/viewbook/public-types`), `SECTION_TITLES` (`./section-titles`), `StatusPill` (`./SectionSummaryPanel`), `DotStack` (`./SectionAccents`).
- Produces: `PreviousStages({ groups: { stageLabel: string; sections: PublicSection[] }[]; renderSection: (s: PublicSection, meta: SectionRenderMeta) => ReactNode })`. **Server component** (function prop).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PreviousStages } from './PreviousStages'
import type { PublicSection } from '@/lib/viewbook/public-types'

const sec = (sectionKey: string, state: 'active' | 'done' = 'done') =>
  ({ sectionKey, state, doneAt: null, acknowledgedAt: null, introNote: null, narrative: null }) as PublicSection

describe('PreviousStages', () => {
  it('renders nothing for empty groups', () => {
    const { container } = render(<PreviousStages groups={[]} renderSection={() => null} />)
    expect(container.textContent).toBe('')
  })
  it('renders each stage label and calls renderSection with heroSize none', () => {
    const calls: { key: string; heroSize: string }[] = []
    const { container } = render(
      <PreviousStages
        groups={[{ stageLabel: 'Kickoff', sections: [sec('welcome')] }]}
        renderSection={(s, meta) => {
          calls.push({ key: s.sectionKey, heroSize: meta.heroSize })
          return <div data-testid={`body-${s.sectionKey}`}>body</div>
        }}
      />,
    )
    expect(container.textContent).toContain('Previous stages')
    expect(container.textContent).toContain('Kickoff')
    expect(container.querySelector('details')).toBeTruthy()
    expect(container.querySelector('[data-testid="body-welcome"]')).toBeTruthy()
    expect(calls).toEqual([{ key: 'welcome', heroSize: 'none' }])
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```tsx
// "Previous stages" (spec §5.5): carried sections grouped by origin stage,
// each an expandable compact row that opens to its full content rendered
// through the SAME renderSection (heroSize:'none'). Replaces EarlierSteps in
// the continuous viewer. SERVER component (takes a function prop); LIGHT-ONLY.
// (No compact/expandable split — the shelved 'collapsed' state is retired on
// main, so every carried section is an expandable row.)
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { carriedStatus, type SectionRenderMeta } from '@/lib/viewbook/section-status'
import { SECTION_TITLES } from './section-titles'
import { StatusPill } from './SectionSummaryPanel'
import { DotStack } from './SectionAccents'

function ExpandableRow({
  section,
  renderSection,
}: {
  section: PublicSection
  renderSection: (s: PublicSection, meta: SectionRenderMeta) => ReactNode
}) {
  return (
    <details className="vb-prev-step rounded-lg border border-black/10 bg-white transition-colors open:border-black/15">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-black/70 select-none hover:bg-black/[0.02]">
        {section.state === 'done' && (
          <span
            aria-hidden
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
            style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
          >
            ✓
          </span>
        )}
        <span className="min-w-0 truncate">{SECTION_TITLES[section.sectionKey]}</span>
        <StatusPill status={carriedStatus(section)} />
        <span aria-hidden className="vb-chevron ml-auto text-xs" style={{ color: 'var(--vb-tertiary)' }}>
          ▶
        </span>
      </summary>
      <div className="border-t border-black/5">
        {renderSection(section, { heroSize: 'none', chapterNumber: null, status: carriedStatus(section), isLead: false })}
      </div>
    </details>
  )
}

export function PreviousStages({
  groups,
  renderSection,
}: {
  groups: { stageLabel: string; sections: PublicSection[] }[]
  renderSection: (s: PublicSection, meta: SectionRenderMeta) => ReactNode
}) {
  if (groups.length === 0) return null
  return (
    <section aria-label="Previous stages" className="mx-auto w-full max-w-5xl px-6 py-8">
      <style>{`
        .vb-prev-step summary::-webkit-details-marker { display: none; }
        .vb-prev-step > summary .vb-chevron { transition: transform 160ms ease; }
        .vb-prev-step[open] > summary .vb-chevron { transform: rotate(90deg); }
        @media (prefers-reduced-motion: reduce) { .vb-prev-step > summary .vb-chevron { transition: none; } }
      `}</style>
      <div className="flex items-center gap-3">
        <DotStack className="hidden shrink-0 sm:block" />
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-black/60" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            Previous stages
          </h2>
          <p className="text-xs text-black/40">Everything we&apos;ve already worked through together.</p>
        </div>
      </div>
      <div className="mt-4 space-y-5">
        {groups.map((group) => (
          <div key={group.stageLabel}>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--vb-tertiary)' }}>
              {group.stageLabel}
            </h3>
            <div className="space-y-2">
              {group.sections.map((s) => (
                <ExpandableRow key={s.sectionKey} section={s} renderSection={renderSection} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(viewbook): PreviousStages carried-section band`

---

### Task 8: `ReadingProgressController` — scroll-driven active state

**Files:**
- Create: `components/viewbook/public/ReadingProgressController.tsx`
- Test: `components/viewbook/public/ReadingProgressController.test.tsx`

**Interfaces:**
- Consumes (DOM): `[data-vb-section]` (+ its value), `[data-vb-hero]`, `[data-vb-toc-section]`, `--vb-sticky-offset`, `vb:sticky-offset-change`.
- Writes (DOM): `data-vb-hero-visible` on sections; `data-vb-active="true"` + `aria-current="location"` on the active rail node.
- Produces: `ReadingProgressController()` — no props, returns `null`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { ReadingProgressController } from './ReadingProgressController'

// Fake IntersectionObserver capturing the callback + options; commits are
// triggered by invoking the stored callback manually.
let ioCallback: (() => void) | null = null
let ioOptions: IntersectionObserverInit | undefined
let disconnectCount = 0
class FakeIO {
  constructor(cb: () => void, opts?: IntersectionObserverInit) { ioCallback = cb; ioOptions = opts }
  observe() {}
  unobserve() {}
  disconnect() { disconnectCount++ }
}

function scene() {
  document.body.innerHTML = `
    <section data-vb-section="welcome" data-vb-hero-visible="true"><div data-vb-hero></div></section>
    <section data-vb-section="milestones" data-vb-hero-visible="true"><div data-vb-hero></div></section>
    <nav>
      <button data-vb-toc-section="welcome"></button>
      <button data-vb-toc-section="milestones"></button>
    </nav>`
  document.documentElement.style.setProperty('--vb-sticky-offset', '64px')
}

beforeEach(() => {
  disconnectCount = 0; ioCallback = null; ioOptions = undefined
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; delete (window as unknown as Record<string, unknown>).IntersectionObserver })

function setRects(map: Record<string, { top: number; bottom: number }>) {
  for (const el of Array.from(document.querySelectorAll('[data-vb-hero]'))) {
    const key = (el.closest('[data-vb-section]') as HTMLElement).dataset.vbSection!
    el.getBoundingClientRect = () => ({ top: map[key].top, bottom: map[key].bottom }) as DOMRect
  }
}

describe('ReadingProgressController', () => {
  it('with no IntersectionObserver, seeds every section hero-visible false', () => {
    scene()
    const { unmount } = render(<ReadingProgressController />)
    expect(document.querySelector('[data-vb-section="welcome"]')!.getAttribute('data-vb-hero-visible')).toBe('false')
    expect(document.querySelector('[data-vb-active]')).toBeNull()
    unmount()
  })
  it('marks the last hero whose top crossed the line active on the live rail node', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
    scene()
    const { unmount } = render(<ReadingProgressController />)
    setRects({ welcome: { top: -80, bottom: 20 }, milestones: { top: 300, bottom: 500 } })
    ioCallback!()
    expect(document.querySelector('[data-vb-section="welcome"]')!.getAttribute('data-vb-hero-visible')).toBe('false')
    const active = document.querySelectorAll('[data-vb-active="true"]')
    expect(active.length).toBe(1)
    expect((active[0] as HTMLElement).dataset.vbTocSection).toBe('welcome')
    expect(active[0].getAttribute('aria-current')).toBe('location')
    unmount()
  })
  it('rebuilds the observer on a changed sticky offset and dedups a repeat', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
    scene()
    const { unmount } = render(<ReadingProgressController />)
    expect(ioOptions!.rootMargin).toBe('-64px 0px 0px 0px')
    document.documentElement.style.setProperty('--vb-sticky-offset', '72px')
    window.dispatchEvent(new CustomEvent('vb:sticky-offset-change', { detail: { offset: 72 } }))
    expect(disconnectCount).toBe(1)
    expect(ioOptions!.rootMargin).toBe('-72px 0px 0px 0px')
    window.dispatchEvent(new CustomEvent('vb:sticky-offset-change', { detail: { offset: 72 } }))
    expect(disconnectCount).toBe(1) // dedup: no rebuild
    unmount()
  })
  it('re-applies active on a rail node replacement via MutationObserver', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
    scene()
    const { unmount } = render(<ReadingProgressController />)
    setRects({ welcome: { top: -80, bottom: 20 }, milestones: { top: 300, bottom: 500 } })
    ioCallback!()
    // Replace the welcome rail node (simulates desktop↔mobile rail swap — no IO fires).
    const old = document.querySelector('[data-vb-toc-section="welcome"]')!
    const fresh = document.createElement('button')
    fresh.setAttribute('data-vb-toc-section', 'welcome')
    old.replaceWith(fresh)
    // MutationObserver delivery is a microtask/task boundary — waitFor polls it.
    await waitFor(() => expect(fresh.getAttribute('data-vb-active')).toBe('true'))
    unmount()
  })
  it('no-ops safely with zero heroes and zero sections (all sections hidden)', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
    document.body.innerHTML = `<nav><button data-vb-toc-section="welcome" data-vb-active="true" aria-current="location"></button></nav>`
    document.documentElement.style.setProperty('--vb-sticky-offset', '64px')
    const { unmount } = render(<ReadingProgressController />)
    ioCallback!()
    // no heroes → active cleared, no throw
    expect(document.querySelector('[data-vb-active]')).toBeNull()
    unmount()
  })
  it('disconnects both observers on unmount', () => {
    vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
    scene()
    const { unmount } = render(<ReadingProgressController />)
    const before = disconnectCount
    unmount()
    expect(disconnectCount).toBe(before + 1) // IntersectionObserver disconnected (MutationObserver.disconnect is separate + also called)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```tsx
'use client'

// The scroll-driven active-rail + hero-exit controller (spec §6, §8). Writes
// ONLY presentational DOM attributes — never React state, never height/collapse
// (the documented blink-bug rule). Mounted once by ViewbookShell in continuous
// mode. Returns null.
import { useEffect } from 'react'

const SECTION_SELECTOR = '[data-vb-section]'
const HERO_SELECTOR = '[data-vb-hero]'
const RAIL_SELECTOR = '[data-vb-toc-section]'

function stickyOffset(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--vb-sticky-offset')
  const n = parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function setFallbackVisibility(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(SECTION_SELECTOR))) {
    el.setAttribute('data-vb-hero-visible', 'false')
  }
}

export function ReadingProgressController() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.IntersectionObserver !== 'function') {
      setFallbackVisibility()
      return
    }

    let observer: IntersectionObserver | null = null
    let lastBuiltOffset = -1
    let framePending = false
    let pending: { heroes: HTMLElement[]; line: number } | null = null
    let disposed = false
    let currentHeroes: HTMLElement[] = []
    let currentLine = 0

    function nodeTouches(nodes: NodeList, selector: string): boolean {
      for (const n of Array.from(nodes)) {
        if (!(n instanceof Element)) continue
        if (n.matches(selector) || n.querySelector(selector)) return true
      }
      return false
    }

    function applyActive(sectionKey: string | null): void {
      for (const node of Array.from(document.querySelectorAll<HTMLElement>(RAIL_SELECTOR))) {
        node.removeAttribute('data-vb-active')
        node.removeAttribute('aria-current')
      }
      if (!sectionKey) return
      const node = document.querySelector<HTMLElement>(`[data-vb-toc-section="${sectionKey}"]`)
      if (node) {
        node.setAttribute('data-vb-active', 'true')
        node.setAttribute('aria-current', 'location')
      }
    }

    function runCommit(heroes: HTMLElement[], line: number): void {
      if (disposed) return
      if (heroes.length === 0) {
        applyActive(null)
        return
      }
      let activeKey: string | null = (heroes[0].closest(SECTION_SELECTOR) as HTMLElement | null)?.dataset.vbSection ?? null
      for (const hero of heroes) {
        const section = hero.closest(SECTION_SELECTOR) as HTMLElement | null
        if (!section) continue
        const rect = hero.getBoundingClientRect()
        section.setAttribute('data-vb-hero-visible', rect.bottom > line ? 'true' : 'false')
        if (rect.top <= line) activeKey = section.dataset.vbSection ?? activeKey
      }
      applyActive(activeKey)
    }

    function commit(heroes: HTMLElement[], line: number): void {
      pending = { heroes, line }
      if (framePending) return
      framePending = true
      requestAnimationFrame(() => {
        framePending = false
        const snap = pending
        pending = null
        if (snap) runCommit(snap.heroes, snap.line)
      })
    }

    function buildObserver(): void {
      const line = stickyOffset()
      lastBuiltOffset = line
      currentLine = line
      observer?.disconnect()
      const heroes = Array.from(document.querySelectorAll<HTMLElement>(HERO_SELECTOR))
      currentHeroes = heroes
      observer = new IntersectionObserver(() => commit(heroes, line), {
        rootMargin: `-${line}px 0px 0px 0px`,
        threshold: [0, 1],
      })
      for (const hero of heroes) observer.observe(hero)
      commit(heroes, line)
    }

    function onStickyOffsetChange(event: Event): void {
      const offset = (event as CustomEvent).detail?.offset
      if (typeof offset === 'number' && Number.isFinite(offset) && offset === lastBuiltOffset) return
      buildObserver()
    }

    buildObserver()
    window.addEventListener('vb:sticky-offset-change', onStickyOffsetChange)

    // DOM-refresh invalidation (spec §6, Codex fix #2 + #4): a desktop↔mobile
    // rail swap or a live re-render changes the [data-vb-toc-section] / hero
    // nodes WITHOUT an IO callback. Distinguish the two: if the HERO set
    // changed, REBUILD the IntersectionObserver (so it observes the live hero
    // nodes, not stale ones); if only RAIL nodes changed, just re-commit with
    // the current heroes (re-applies data-vb-active to the fresh rail node).
    // The controller only ever writes ATTRIBUTES (not childList), so it never
    // triggers this observer on itself.
    let mutationObserver: MutationObserver | null = null
    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver((records) => {
        let heroChanged = false
        let railChanged = false
        for (const r of records) {
          if (nodeTouches(r.addedNodes, HERO_SELECTOR) || nodeTouches(r.removedNodes, HERO_SELECTOR)) heroChanged = true
          if (nodeTouches(r.addedNodes, RAIL_SELECTOR) || nodeTouches(r.removedNodes, RAIL_SELECTOR)) railChanged = true
        }
        if (heroChanged) buildObserver()
        else if (railChanged) commit(currentHeroes, currentLine)
      })
      mutationObserver.observe(document.body, { subtree: true, childList: true })
    }

    return () => {
      disposed = true
      pending = null
      observer?.disconnect()
      mutationObserver?.disconnect()
      window.removeEventListener('vb:sticky-offset-change', onStickyOffsetChange)
    }
  }, [])

  return null
}
```

- [ ] **Step 4: Run — expect PASS.** (If the rail-replacement test's microtask timing is flaky, the MutationObserver fires async — the test returns a resolved Promise to flush the microtask queue; keep it as written.)
- [ ] **Step 5: Commit** — `feat(viewbook): ReadingProgressController scroll-driven active state`

---

### Task 9: `SectionReveal` — continuous sticky-label mode

**Files:**
- Modify: `components/viewbook/public/SectionReveal.tsx`
- Test: `components/viewbook/public/SectionReveal.test.tsx` (extend)

**Interfaces:**
- Produces: `SectionReveal` gains `stickyLabel?: 'continuous' | 'collapse'` (default `'collapse'` = current behavior). In `'continuous'`, the sticky bar's title is an inert `data-vb-sticky-label` (aria-hidden, text-only) that CSS fades off the ancestor `data-vb-hero-visible`.
- Consumed by: `SectionShell` continuous branch (Task 10).

- [ ] **Step 1: Add failing tests** (append)

```tsx
it('continuous mode renders an inert data-vb-sticky-label with no links/buttons', () => {
  const { container } = render(
    <SectionReveal sectionKey="brand" regionId="r" title="Brand Guidelines" alwaysOpen={false} initiallyOpen stickyLabel="continuous">
      <p>body</p>
    </SectionReveal>,
  )
  const label = container.querySelector('[data-vb-sticky-label]')
  expect(label).toBeTruthy()
  expect(label!.getAttribute('aria-hidden')).toBe('true')
  expect(label!.querySelector('a,button')).toBeNull()
  expect(label!.textContent).toContain('Brand Guidelines')
})
it('collapse mode (default) renders the plain visible title, no sticky-label node', () => {
  const { container } = render(
    <SectionReveal sectionKey="brand" regionId="r" title="Brand Guidelines" alwaysOpen={false} initiallyOpen>
      <p>body</p>
    </SectionReveal>,
  )
  expect(container.querySelector('[data-vb-sticky-label]')).toBeNull()
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — add the prop + branch the sticky header's title node. In the `SectionReveal` signature add `stickyLabel = 'collapse'` (`stickyLabel?: 'continuous' | 'collapse'`). Add to the inline `<style>` block:

```
[data-vb-sticky-label] { opacity: 0; transition: opacity 200ms ease; }
[data-vb-hero-visible="false"] [data-vb-sticky-label] { opacity: 1; }
@media (prefers-reduced-motion: reduce) { [data-vb-sticky-label] { transition: none; } }
```

Replace the current sticky-header title `<div className="min-w-0 text-xl font-bold ...">{title}</div>` with a mode branch:

```tsx
{stickyLabel === 'continuous' ? (
  <div
    data-vb-sticky-label
    aria-hidden="true"
    className="min-w-0 text-xl font-bold tracking-tight text-black/80 sm:text-2xl"
    style={{ fontFamily: 'var(--vb-heading-font)' }}
  >
    {title}
  </div>
) : (
  <div
    className="min-w-0 text-xl font-bold tracking-tight text-black/80 sm:text-2xl"
    style={{ fontFamily: 'var(--vb-heading-font)' }}
  >
    {title}
  </div>
)}
```

(Continuous mode's summary is not shown in the sticky bar — omit the `{summary && ...}` render when `stickyLabel === 'continuous'`, since the summary face already lives in the chapter body; keep it for collapse mode.)

- [ ] **Step 4: Run — expect PASS.** `npx vitest run components/viewbook/public/SectionReveal.test.tsx` (existing tests unchanged — default is `'collapse'`).
- [ ] **Step 5: Commit** — `feat(viewbook): SectionReveal continuous sticky-label mode`

---

### Task 10: SPINE — meta-threading + continuous `SectionShell`/`ViewbookShell`

> This is the atomic spine: `renderSection` widens to `(section, meta)`, `SectionShell` gains `meta` + `viewerMode` (continuous branch, collapse branch preserved), `ViewbookShell` branches, `page.tsx` + all 13 sections + `ThemePreview` forward `meta`. It compiles green only as a unit — `tsc` is the tripwire. Tests for `SectionShell`/`ViewbookShell`/`page`/`ThemePreview` are updated here.

**Files:**
- Modify: `components/viewbook/public/SectionShell.tsx`
- Modify: `components/viewbook/public/ViewbookShell.tsx`
- Modify: `app/(public)/viewbook/[token]/page.tsx`
- Modify: all 13 section components (see list in Step 5)
- Modify: `components/viewbook/admin/ThemePreview.tsx`
- Tests: `components/viewbook/public/SectionShell.test.tsx`, `ViewbookShell.test.tsx`, `app/(public)/viewbook/[token]/page.test.tsx`, `components/viewbook/admin/ThemePreview.test.tsx`

**Interfaces:**
- `SectionShell` gains required `meta: SectionRenderMeta` and required `viewerMode: ViewerMode`.
- `renderSection: (section: PublicSection, meta: SectionRenderMeta) => ReactNode` (page.tsx + ViewbookShell).

- [ ] **Step 1: Write failing SectionShell continuous tests** (add to `SectionShell.test.tsx`; keep existing tests but pass `viewerMode="collapse"` + a `meta` to each — see Step 6). New continuous tests:

```tsx
// helper at top of file:
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'
const meta = (over: Partial<SectionRenderMeta> = {}): SectionRenderMeta =>
  ({ heroSize: 'chapter', chapterNumber: 1, status: 'current', isLead: false, ...over })

it('continuous chapter section emits the DOM contract + chapter hero', () => {
  const { container } = render(
    <SectionShell {...baseProps} viewerMode="continuous" meta={meta({ heroSize: 'chapter', status: 'current' })}>
      <p>body</p>
    </SectionShell>,
  )
  const root = container.querySelector('[data-vb-section]') as HTMLElement
  expect(root.getAttribute('data-vb-section')).toBeTruthy()
  expect(root.getAttribute('data-vb-status')).toBe('current')
  expect(root.getAttribute('data-vb-hero-visible')).toBe('true')
  expect(container.querySelector('[data-vb-hero]')).toBeTruthy()
  expect(container.querySelector('[data-vb-summary-panel]')).toBeTruthy()
})
it('continuous no-hero section seeds hero-visible false and emits no hero', () => {
  const { container } = render(
    <SectionShell {...baseProps} viewerMode="continuous" meta={meta({ heroSize: 'none' })}>
      <p>body</p>
    </SectionShell>,
  )
  const root = container.querySelector('[data-vb-section]') as HTMLElement
  expect(root.getAttribute('data-vb-hero-visible')).toBe('false')
  expect(container.querySelector('[data-vb-hero]')).toBeNull()
})
it('collapse mode still renders the CollapsibleSection button', () => {
  const { container } = render(
    <SectionShell {...baseProps} viewerMode="collapse" meta={meta()}>
      <p>body</p>
    </SectionShell>,
  )
  expect(container.querySelector('button[aria-expanded]')).toBeTruthy()
})
```

**`baseProps` must be COMPLETE (Codex plan-fix #3)** — the existing `SectionShell.test.tsx` does not already have a full bundle with `section`/`title`/`heroUrl`/`stage`. Define a full helper at the top of the file:

```tsx
import type { PublicSection } from '@/lib/viewbook/public-types'
const sampleSection: PublicSection = { sectionKey: 'brand', state: 'active', doneAt: null, acknowledgedAt: null, introNote: 'Intro note.', narrative: null }
const baseProps = {
  section: sampleSection,
  title: 'Brand Guidelines',
  heroUrl: '/hero.jpg',
  summary: undefined,
  stage: 'website-specifics' as const,
  affordance: 'chevron' as const,
  overlayStrength: 55,
  isOperator: false,
  viewbookId: 1,
  token: 'tok',
}
```

- [ ] **Step 2: Run — expect FAIL** (`viewerMode`/`meta` not accepted).

- [ ] **Step 3: Implement `SectionShell.tsx`** — add the two props and branch. Prop additions:

```ts
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'
import type { ViewerMode } from '@/lib/viewbook/presentation-config'
import { ChapterCtaButton } from './ChapterCtaButton'
import { StatusPill } from './SectionSummaryPanel'
```
Add to the destructured props + type: `meta: SectionRenderMeta`, `viewerMode: ViewerMode`.

Keep everything currently in the function (mode/celebratory/overlay math/`summaryFace`/`buildCompactRow`/`buildExpandedHero`/`headerStrip`) for the collapse branch. Add a continuous hero builder + chapter header, then branch the return.

Add these builders inside the component (after `headerStrip`):

```tsx
const copy = SECTION_COPY[section.sectionKey]

function buildContinuousHero(): ReactNode {
  if (meta.heroSize === 'none') return null
  const sizeClass = meta.heroSize === 'full' ? 'min-h-[60vh]' : 'h-[220px]'
  return (
    <div data-vb-hero className={`relative flex ${sizeClass} items-end`} style={{ background: 'var(--vb-primary)' }}>
      <CornerBracket className="absolute left-4 top-4" />
      {heroUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: heroImgOpacity }} />
          <span
            aria-hidden
            className="absolute inset-0"
            style={{ opacity: overlayOpacity, background: `linear-gradient(to top, var(--vb-primary) ${brandStop}%, transparent ${fadeStop}%)` }}
          />
        </>
      )}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/5"
        style={{ background: `linear-gradient(to top, color-mix(in srgb, var(--vb-primary) ${scrimAlpha}%, transparent), transparent)` }}
      />
      <div className="relative z-[3] mx-auto flex w-full max-w-5xl items-center gap-3 px-6 pb-6">
        <h2
          className={`min-w-0 truncate font-extrabold tracking-tight ${meta.heroSize === 'full' ? 'text-3xl sm:text-5xl' : 'text-2xl sm:text-4xl'}`}
          style={{ color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}
        >
          {title}
        </h2>
        {done && <DoneBadge size="hero" />}
      </div>
    </div>
  )
}

const continuousChapterHeader = (
  <div style={{ background: 'color-mix(in srgb, var(--vb-primary) 10%, #fafafa)' }}>
    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-6 pt-5 pb-1">
      {meta.chapterNumber != null && (
        <span aria-hidden className="text-sm font-bold" style={{ color: 'var(--vb-tertiary)' }}>
          {String(meta.chapterNumber).padStart(2, '0')}
        </span>
      )}
      {copy && <span className="min-w-0 flex-1 text-sm text-black/60">{copy.purpose}</span>}
      <StatusPill status={meta.status} />
      {copy?.cta && <ChapterCtaButton {...copy.cta} />}
      <TickDivider />
    </div>
  </div>
)

const continuousBody = (
  <SectionReveal
    sectionKey={section.sectionKey}
    regionId={detailRegionId}
    title={title}
    alwaysOpen={alwaysOpen}
    initiallyOpen={initiallyOpen}
    stickyLabel="continuous"
  >
    {copy && <SectionSummaryPanel whatThis={copy.whatThis} whatWeNeed={copy.whatWeNeed} status={meta.status} />}
    {section.introNote && (
      <p className="max-w-[68ch] border-l-4 pl-4 text-lg text-black/70" style={{ borderColor: 'var(--vb-tertiary)' }}>
        {section.introNote}
      </p>
    )}
    {children}
  </SectionReveal>
)
```

Branch the `return`: the section root `<section>` currently sets only `id` + `scrollMarginTop`. Add the continuous DOM contract attributes CONDITIONALLY (continuous only — collapse mode keeps its current attribute-free root):

```tsx
return (
  <section
    id={section.sectionKey}
    className="flex w-full flex-col"
    style={{ scrollMarginTop: 'calc(var(--vb-sticky-offset, 0px) + 12px)' }}
    {...(viewerMode === 'continuous'
      ? {
          'data-vb-section': section.sectionKey,
          'data-vb-status': meta.status,
          'data-vb-hero-visible': meta.heroSize === 'none' ? 'false' : 'true',
        }
      : {})}
  >
    <style>{`
      @keyframes vb-pop { 0% { transform: scale(0); } 70% { transform: scale(1.18); } 100% { transform: scale(1); } }
      .vb-done-badge { animation: vb-pop 400ms ease-out both; }
      @media (prefers-reduced-motion: reduce) { .vb-done-badge { animation: none; } }
    `}</style>

    {viewerMode === 'continuous' ? (
      <>
        {buildContinuousHero()}
        {continuousChapterHeader}
        {continuousBody}
      </>
    ) : collapsible ? (
      <CollapsibleSection
        viewbookId={viewbookId}
        sectionKey={section.sectionKey}
        title={title}
        heroExpanded={buildExpandedHero()}
        heroCollapsed={buildCompactRow()}
        hasHeroImage={heroUrl != null}
        body={<>{headerStrip}{detailBody}</>}
        regionId={regionId}
        previewMode={previewMode}
        autoRevealMs={autoRevealMs}
      />
    ) : (
      <>
        {buildExpandedHero()}
        {headerStrip}
        {detailBody}
      </>
    )}
  </section>
)
```

(`detailBody` stays as-is for collapse mode. Ensure `SectionSummaryPanel` and `SectionReveal` are already imported — they are.)

- [ ] **Step 4: Run SectionShell tests — expect PASS.** `npx vitest run components/viewbook/public/SectionShell.test.tsx`

- [ ] **Step 5: Widen `renderSection` + thread `meta` — `page.tsx` and all 13 sections.**

In `app/(public)/viewbook/[token]/page.tsx`: add `import type { SectionRenderMeta } from '@/lib/viewbook/section-status'`, widen both callbacks:

```ts
const baseRenderSection = (section: PublicSection, meta: SectionRenderMeta): ReactNode => {
  const props = { section, data, token, isOperator: operatorEmail != null, meta }
  switch (section.sectionKey) { /* ...unchanged cases, each spreads {...props} ... */ }
}
// ...
const wrappedRenderSection = (section: PublicSection, meta: SectionRenderMeta): ReactNode => {
  const operatorSection = operatorData.sections.find((item) => item.sectionKey === section.sectionKey)
  const rendered = baseRenderSection(section, meta)
  if (!operatorSection) return rendered
  return <OperatorSectionWrapper sectionKey={operatorSection.sectionKey}>{rendered}</OperatorSectionWrapper>
}
```

For **each of the 13 section components**, apply the identical two-part change:
1. Add `meta` to the props type + destructure: `meta,` and `meta: SectionRenderMeta` (import the type from `@/lib/viewbook/section-status`).
2. Pass `meta={meta}` to the `<SectionShell ...>` call.

The 13 files (all in `components/viewbook/public/`): `WelcomeSection.tsx`, `MilestonesSection.tsx`, `DataSourceSection.tsx`, `BrandSection.tsx`, `AssessmentSection.tsx`, `StrategySection.tsx`, `MaterialsSection.tsx`, `PcIntroSection.tsx`, `PcSetupSection.tsx`, `PcInviteSection.tsx`, `PcThanksSection.tsx`, `KickoffNextSection.tsx`, `WsIntroSection.tsx`.

Each also passes `viewerMode={data.viewerMode}` to `<SectionShell>` (so the shell knows the mode). Example (`WsIntroSection.tsx`) — before:
```tsx
export function WsIntroSection({ section, data, token, isOperator = false }: {
  section: PublicSection; data: ViewbookPublicData; token: string; isOperator?: boolean
}) {
  // ...
  return (
    <SectionShell section={section} stage={data.stage} title={SECTION_TITLES['ws-intro']}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={<SummaryStat headline={sectionStatusLabel(section)} />}
      affordance={data.collapseAffordance} overlayStrength={data.heroOverlayStrength}
      isOperator={isOperator} viewbookId={data.viewbookId} token={token}>
```
after (add the import, `meta` in props, `meta={meta}` + `viewerMode={data.viewerMode}` on SectionShell):
```tsx
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'
// ...
export function WsIntroSection({ section, data, token, isOperator = false, meta }: {
  section: PublicSection; data: ViewbookPublicData; token: string; isOperator?: boolean; meta: SectionRenderMeta
}) {
  // ...
  return (
    <SectionShell section={section} stage={data.stage} title={SECTION_TITLES['ws-intro']}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
      summary={<SummaryStat headline={sectionStatusLabel(section)} />}
      affordance={data.collapseAffordance} overlayStrength={data.heroOverlayStrength}
      isOperator={isOperator} viewbookId={data.viewbookId} token={token}
      meta={meta} viewerMode={data.viewerMode}>
```
`PcIntroSection.tsx` additionally keeps its existing `autoRevealMs={...}` prop. `BrandSection.tsx` additionally keeps `resolvedFonts`. No other per-file differences — the `meta` + `viewerMode` addition is identical everywhere.

- [ ] **Step 6: Update existing SectionShell tests for the new required props.** Every existing `render(<SectionShell ... >)` in `SectionShell.test.tsx` gains `viewerMode="collapse"` + `meta={meta()}` so the current collapse-behavior assertions keep testing the dormant path. (New continuous assertions from Step 1 already pass `viewerMode="continuous"`.)

- [ ] **Step 6b: Migrate EVERY direct section-component test (Codex plan-fix #2).** All 13 section components now (a) require a `meta` prop and (b) read `viewerMode` from `data`. Any test that renders a section component directly, or builds a `ViewbookPublicData` fixture, must be updated or it will crash on missing `meta` OR silently render the dormant collapse branch (because `data.viewerMode === undefined !== 'continuous'`). Do BOTH:
  1. **The shared `data` fixture/builder MUST set `viewerMode: 'continuous'`** (grep the test-support data builder — e.g. `components/viewbook/public/test-support/*` or the inline builders in `sections-data.test.tsx` / `sections-read.test.tsx`; also `ViewbookShell.test.tsx` / `page.test.tsx`). Collapse-specific tests override to `'collapse'`.
  2. **Add a shared `meta()` fixture** and pass `meta={meta()}` to every direct section render/rerender.

  ```tsx
  // reusable in each section test file (or a small shared test-support helper)
  import type { SectionRenderMeta } from '@/lib/viewbook/section-status'
  const meta = (over: Partial<SectionRenderMeta> = {}): SectionRenderMeta =>
    ({ heroSize: 'chapter', chapterNumber: 1, status: 'current', isLead: false, ...over })
  ```

  Files to sweep (every `*.test.tsx` that renders a section component or builds `data`): `AssessmentSection.test.tsx`, `BrandSection.test.tsx`, `PcIntroSection.test.tsx`, `PcInviteSection.test.tsx`, `PcSetupSection.test.tsx`, `PcThanksSection.test.tsx`, `KickoffNextSection.test.tsx`, `WsIntroSection.test.tsx`, `sections-data.test.tsx`, `sections-read.test.tsx` (+ any other file that constructs a section or `ViewbookPublicData`). Run `npx tsc --noEmit` — it will list every call site still missing `meta`. Fix until clean.

- [ ] **Step 7: Implement `ViewbookShell.tsx` branch.** Add imports:

```ts
import { computeSectionStatuses, carriedStatus, type SectionRenderMeta } from '@/lib/viewbook/section-status'
import { groupCarriedByOrigin } from '@/lib/viewbook/section-origin'
import { SECTION_TITLES } from './section-titles'
import { StageOverview } from './StageOverview'
import { PreviousStages } from './PreviousStages'
import { ReadingProgressController } from './ReadingProgressController'
```
Widen the `renderSection` prop type to `(s: PublicSection, meta: SectionRenderMeta) => ReactNode`. **Remove the redundant `primarySections` and `carriedSections` props from `ViewbookShell`'s signature entirely (Codex plan-fix #5)** — read the canonical arrays off `data.primarySections` / `data.carriedSections` so there is ONE source of truth for rendering + status + overview + previous-stages + TOC. (Update `page.tsx` both branches to stop passing `primarySections=`/`carriedSections=`, and update every `ViewbookShell.test.tsx` call site to drop them.) Compute:

```ts
const primary = data.primarySections
const carried = data.carriedSections
const statuses = computeSectionStatuses(primary.map((s) => s.sectionKey), primary, { pcCompletedAt: data.pcCompletedAt })
const statusOf = (key: PublicSection['sectionKey']) => statuses[key] ?? 'current'
const primaryMeta = (i: number): SectionRenderMeta => ({
  heroSize: i === 0 ? 'full' : 'chapter',
  chapterNumber: i + 1,
  status: statusOf(primary[i].sectionKey),
  isLead: i === 0,
})
const carriedMeta = (s: PublicSection): SectionRenderMeta => ({ heroSize: 'none', chapterNumber: null, status: carriedStatus(s), isLead: false })
```

Replace the body `<div style={{ fontFamily: 'var(--vb-body-font)' }}>...</div>` region with a mode branch:

```tsx
{data.viewerMode === 'continuous' ? (
  <>
    <ReadingProgressController />
    <div style={{ fontFamily: 'var(--vb-body-font)' }}>
      {primary.length > 0 && <div key={primary[0].sectionKey}>{renderSection(primary[0], primaryMeta(0))}</div>}
      <StageOverview
        items={primary.map((s) => ({ sectionKey: s.sectionKey, label: SECTION_TITLES[s.sectionKey], status: statusOf(s.sectionKey), anchor: `#${s.sectionKey}` }))}
      />
      {primary.slice(1).map((s, i) => (
        <div key={s.sectionKey}>{renderSection(s, primaryMeta(i + 1))}</div>
      ))}
      <PreviousStages groups={groupCarriedByOrigin(carried)} renderSection={renderSection} />
    </div>
  </>
) : (
  <div style={{ fontFamily: 'var(--vb-body-font)' }}>
    {primary.map((s, i) => (
      <div key={s.sectionKey}>{renderSection(s, primaryMeta(i))}</div>
    ))}
    <EarlierSteps sections={carried} renderSection={(s) => renderSection(s, carriedMeta(s))} />
  </div>
)}
```

`PreviousStages` passes `renderSection` straight through — it supplies its own `heroSize:'none'` meta internally (Task 7). Keep `StickyOffsetProbe`, `ProgressNav`, `TocRail`, footer, and the `<h1>` exactly as they are, mounted in both branches.

- [ ] **Step 8: Update `ThemePreview.tsx`** (Codex fix #3) — the admin collapse/morph preview must stay collapse mode. Add `import type { SectionRenderMeta }` and pass to its `<SectionShell>`:

```tsx
viewerMode="collapse"
meta={{ heroSize: 'chapter', chapterNumber: 1, status: 'current', isLead: false } as SectionRenderMeta}
```
Update `ThemePreview.test.tsx` only if it asserts against the SectionShell prop surface (it should still pass — the collapse render is unchanged).

- [ ] **Step 9: Update `page.test.tsx` + `ViewbookShell.test.tsx`** for the widened `renderSection` signature + the continuous wiring (assert the lead renders, `StageOverview` `nav[aria-label="In this stage"]` present, `PreviousStages` `section[aria-label="Previous stages"]` present when carried non-empty, `ReadingProgressController` mounts — it returns null, so assert indirectly via the absence of errors / presence of the overview). Add a collapse-mode `ViewbookShell` test (build `data` with `viewerMode: 'collapse'`) asserting `EarlierSteps` renders and `StageOverview` does not.

- [ ] **Step 10: Full gate.** `npx tsc --noEmit` && `npx vitest run components/viewbook lib/viewbook 'app/(public)/viewbook'` → all green.
- [ ] **Step 11: Commit** — `feat(viewbook): continuous-reading viewer as default (meta-threading + mode branch)`

---

### Task 11: `TocRail` — `data-vb-toc-section` + active-marker

**Files:**
- Modify: `components/viewbook/public/TocRail.tsx`
- Test: `components/viewbook/public/TocRail.test.tsx` (extend)

**Interfaces:**
- Produces: top-level rail buttons carry `data-vb-toc-section="{sectionKey}"`; a CSS rule styles `[data-vb-active="true"]`.
- Consumed by: `ReadingProgressController` (already built — matches on the attribute).

- [ ] **Step 1: Add failing test** (append)

```tsx
it('top-level entries carry data-vb-toc-section; child entries do not', () => {
  const toc = [{ sectionKey: 'welcome' as const, label: 'Welcome', anchor: '#welcome', done: false, acked: false }]
  const { container } = render(<TocRail toc={toc} searchIndex={[]} verbose={false} />)
  const btn = container.querySelector('[data-vb-toc-section="welcome"]')
  expect(btn).toBeTruthy()
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — on the top-level item `<button>` in `itemList`, add `data-vb-toc-section={!item.isChild ? item.sectionKey : undefined}` (child sub-entries must NOT carry it). Add to `RAIL_STYLE`:

```css
[data-vb-toc-section][data-vb-active="true"] { background-color: color-mix(in srgb, var(--vb-secondary) 14%, transparent); font-weight: 700; box-shadow: inset 3px 0 0 var(--vb-secondary); }
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run components/viewbook/public/TocRail.test.tsx`
- [ ] **Step 5: Commit** — `feat(viewbook): TocRail active-marker + data-vb-toc-section hook`

---

### Task 12: Full gate + build

- [ ] **Step 1:** `npx tsc --noEmit` → clean.
- [ ] **Step 2:** `npx vitest run` → full suite green (record the count; baseline was the full viewbook suite green).
- [ ] **Step 3:** `npm run build` → succeeds (use the repo's `build` script so its configured Node heap setting applies — Codex plan-fix #6; catches RSC-boundary + client/server violations the unit tests can miss).
- [ ] **Step 4: Commit** any gate fixes — `chore(viewbook): gate green for continuous viewer`.

**Ship Phase 1:** open ONE PR (Phase 1 only) → main → `git push` FIRST → `ssh $PROD_SSH "~/deploy.sh"` (source `.claude/ops-secrets.local.sh`) → prod-verify (spec §13: health 200, deployed HEAD == merge, pull a live token via `node -e` + prisma and fetch `/viewbook/<token>` — confirm continuous render) → browser eyeball (Kevin). Update memory `project_viewbook_reading_experience` + move spec/plan to `docs/superpowers/archive/` on ship.

---

# PHASE 2 — `viewerMode` toggle (SEPARATE follow-up PR; only after Phase 1 is live + verified, only if clean)

> Build on a fresh branch off updated `origin/main` AFTER Phase 1 ships. The Phase-1 read side already resolves `viewerMode` (default continuous); Phase 2 adds the column, the strict write path, the operator control, and the exposure-point dormant-path assurance (spec §5.5 fix #1, §11 fix #5).

### Task P2-1: Migration + strict write validation

**Files:**
- Modify: `prisma/schema.prisma` (Viewbook model)
- Migration: `npx prisma migrate dev --name viewbook_viewer_mode`
- Modify: `lib/viewbook/presentation-config.ts` (`parsePresentationPatch`)
- Test: `lib/viewbook/presentation-config.test.ts`

- [ ] **Step 1:** Add to the `Viewbook` model (after `firstLoadDelayMs`):
```prisma
  viewerMode          String @default("continuous") // 'continuous' | 'collapse' — public reading viewer mode (unknown value degrades to continuous at read time)
```
- [ ] **Step 2:** `npx prisma migrate dev --name viewbook_viewer_mode` (creates migration + regenerates client). **Fallback if `migrate dev` can't run** (e.g. shadow-DB perms): hand-author `prisma/migrations/<ts>_viewbook_viewer_mode/migration.sql` (`ALTER TABLE "Viewbook" ADD COLUMN "viewerMode" TEXT NOT NULL DEFAULT 'continuous';`), then `npx prisma migrate deploy` + `npx prisma generate`. Production applies via `prisma migrate deploy` in the deploy command.
- [ ] **Step 3: Failing test** — `parsePresentationPatch({ viewerMode: 'weird' })` throws `HttpError(400, 'invalid_viewer_mode')`; `parsePresentationPatch({ viewerMode: 'collapse' })` returns `{ viewerMode: 'collapse' }`.
- [ ] **Step 4: Implement** in `parsePresentationPatch` — add `viewerMode?: ViewerMode` to **BOTH** duplicated patch typings (the function's return type annotation AND the local `patch` variable's type — Codex plan-fix #6), then:
```ts
  if ('viewerMode' in raw) {
    if (!isViewerMode(raw.viewerMode)) throw new HttpError(400, 'invalid_viewer_mode')
    patch.viewerMode = raw.viewerMode
  }
```
- [ ] **Step 5:** Gate + commit — `feat(viewbook): viewerMode column + strict write validation`.

### Task P2-2: Persist path + operator read model

**Files:**
- Modify: `lib/viewbook/service.ts` (`updateViewbookPresentation` — grep how `collapseMorph` threads; add `viewerMode` so a PATCH writes it + bumps `syncVersion`)
- Modify: `lib/viewbook/operator-data.ts` (add `viewerMode` to the explicit Prisma `select` + the operator read-model interface)
- Test: **extend `app/api/viewbooks/routes.test.ts`** — the existing presentation-PATCH test (Codex plan-fix #6): assert the FULL route→`parsePresentationPatch`→`updateViewbookPresentation`→DB chain (a `{ viewerMode: 'collapse' }` PATCH persists the column, bumps `syncVersion` once, and a bad value 400s). A service-only test does NOT prove the route/parser/writer chain. Also `operator-data.test.ts` (select exposes it).

- [ ] Steps: failing test (route PATCH persists `viewerMode` + one `syncVersion` bump + 400 on bad value; operator read model returns it) → implement → gate → commit `feat(viewbook): persist viewerMode + expose in operator read model`.

### Task P2-3: Operator control in `PresentationEditor`

**Files:**
- Modify: `components/viewbook/admin/PresentationEditor.tsx` (+ `components/viewbook/admin/viewbook-admin-shared.ts` config)
- Test: `PresentationEditor.test.tsx`

- [ ] Steps: failing test (a 2-option Continuous/Collapse control renders + PATCHes `{ viewerMode }` on change, single atomic patch + sync bump like the other fields) → implement → gate → commit `feat(viewbook): operator viewerMode toggle`.

### Task P2-4: Dormant-path assurance (spec §11 fix #5)

**Files:**
- Test: `components/viewbook/public/ViewbookShell.test.tsx` (or a dedicated integration test)

- [ ] **Step 1:** Add an integration test that renders `ViewbookShell` with `data.viewerMode: 'collapse'` and asserts the `CollapsibleSection` island (`button[aria-expanded]`) + `EarlierSteps` render, and that a `vb:navigate` deep-link force-opens the target region. (The `ThemePreview` collapse render already exercises the dormant path continuously.)
- [ ] **Step 2:** Gate + commit — `test(viewbook): collapse-mode dormant-path assurance`.

**Ship Phase 2:** its own PR → main → deploy → set one real viewbook to `collapse` and browser-eyeball it before relying on the toggle (spec §11).

---

## Self-Review

**Spec coverage:** §4 mode-gating → Tasks 3, 10 (SectionShell/ViewbookShell branch). §5.1 section-status → Task 1. §5.2 section-origin → Task 2. §5.3 section-copy → reused (no task). §5.4 DOM contract → Tasks 9 (sticky-label), 10 (section root + hero), 11 (rail). §5.5 components → Tasks 4 (SummaryPanel/StatusPill), 6 (StageOverview), 7 (PreviousStages), 8 (controller). §5.6 event → Task 5. §6/§8 controller → Task 8. §7 file inventory → Tasks 3–11 (incl. ThemePreview in Task 10, `toc-index` explicitly NOT changed). §9 a11y → enforced across Tasks 4/9/10/11. §10 tests → each task's tests + Task 12. §11 dormancy → Tasks 3/10 (gated), P2-4 (assurance). §13 prod-verify → Task 12 ship step. §14 phasing → Phase 1 / Phase 2 split.

**Placeholder scan:** every code step contains full code; the 13-section edit shows the exact pattern + one complete example + the identical change spelled out; no "TBD"/"handle edge cases"/"similar to".

**Type consistency:** `SectionRenderMeta` (`section-status.ts`) — same shape in Tasks 1/7/10; `ViewerMode` (`presentation-config.ts`) — Tasks 3/10; `SectionStatus` — Tasks 1/4/6/7; `computeSectionStatuses`/`carriedStatus`/`groupCarriedByOrigin`/`originStageOf` signatures match between definition (Tasks 1/2) and use (Task 10, Task 7); `StatusPill` (Task 4) consumed by Tasks 6/7/10; controller DOM attrs (Task 8) match what Tasks 9/10/11 emit.
