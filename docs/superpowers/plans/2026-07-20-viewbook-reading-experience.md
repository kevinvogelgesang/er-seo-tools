# Viewbook Reading-Experience Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public viewbook viewer into one continuous, hierarchy-driven reading experience — one full hero for the current stage's lead section, ~220px chapter heroes, an "In this stage" overview, a hero-exit sticky label, a strong active-rail marker, and "Previous stages" as compact rows — with all new copy/status code-owned (no schema/editor change).

**Architecture:** A "spine" set of changes (Wave 1) publishes frozen DOM + pure-module contracts and ships compilable stubs; then 5 disjoint-file lanes (Wave 2) build concurrently against those contracts. Scroll behavior is driven by ONE `IntersectionObserver` that writes only presentational attributes (never collapse/height state — the documented "blink bug" cause).

**Tech Stack:** Next.js 15 App Router (RSC), TypeScript, Tailwind (light-only for the public viewbook — NO `dark:` variants, colors from `--vb-*` CSS vars), Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-07-20-viewbook-reading-experience-design.md` (read §4 before any task — it is the contract).

## Global Constraints

- **Public viewbook is LIGHT-ONLY** — never emit `dark:` classes; all color via `--vb-*` CSS vars or explicit literals.
- **No RSC boundary violations** — a `'use client'` component must not receive a function prop. `PreviousStages` takes `renderSection` (a function) → it MUST be a server component. `TocRail`/`ReadingProgressController`/`SectionReveal` are client leaves taking only serializable props.
- **`.toString()`-injected code rule does NOT apply here** — these are ordinary React modules, not in-page injected parsers.
- **No schema/editor/API changes.** `PublicSection` gains no fields. `pcCompletedAt` is already on `ViewbookPublicData`.
- **Gate before every merge:** `npx tsc --noEmit` && `npx vitest run` green. In-build type-check/lint stay disabled (CLAUDE.md) — local gates are the only gate.
- **Section catalog (13):** `welcome, milestones, data-source, brand, assessment, strategy, materials, pc-intro, pc-setup, pc-invite, pc-thanks, kickoff-next, ws-intro`. Bookends: `pc-intro`, `pc-thanks`.
- **`SectionRenderMeta` (§4.0)** is the render-threading contract: `{ heroSize: 'full'|'chapter'|'none'; chapterNumber: number|null; status: SectionStatus; isLead: boolean }`.
- **DOM contract (§4.1):** section root `data-vb-section`/`data-vb-status`/`data-vb-hero-visible`; hero `data-vb-hero`; sticky duplicate label `data-vb-sticky-label` (`aria-hidden`, text-only); rail top-level buttons `data-vb-toc-section="{sectionKey}"`.
- **Commit style:** end messages with the two trailers used across this repo (`Co-Authored-By: Claude Opus 4.8 (1M context)` + `Claude-Session:`).

## File Structure

**New pure modules (`lib/viewbook/`):**
- `section-copy.ts` — `SECTION_COPY` (per-key purpose/whatThis/whatWeNeed/cta) + `INPUT_EXPECTING_KEYS`.
- `section-status.ts` — `SectionStatus` type + `computeSectionStatuses(...)`.
- `section-origin.ts` — `originStageOf(sectionKey)` + `groupCarriedByOrigin(...)`.

**New components (`components/viewbook/public/`):**
- `SectionSummaryPanel.tsx` — "What this is / What we need / status" panel (server).
- `StageOverview.tsx` — "In this stage" strip (server; stub in Wave 1, real in Lane D).
- `PreviousStages.tsx` — replaces `EarlierSteps` (server; stub in Wave 1, real in Lane D).
- `ReadingProgressController.tsx` — the scroll controller (client; stub in Wave 1, real in Lane A).

**Modified (spine, Wave 1):** `lib/viewbook/toc-index.ts`; `SectionShell.tsx`; `SectionReveal.tsx`; `ViewbookShell.tsx`; `app/(public)/viewbook/[token]/page.tsx`; all 13 section components; `OperatorLayer/*` wrapper.

**Modified (lanes, Wave 2):** `TocRail.tsx` (B); `WelcomeSection.tsx` (C); `KickoffNextSection.tsx` (E). **Deleted (D):** `EarlierSteps.tsx` + `EarlierSteps.test.tsx`.

---

# WAVE 1 — SPINE (single owner, lands first, compiles + tests green standalone)

### Task 1: `section-copy.ts` (pure copy + input-expecting set)

**Files:**
- Create: `lib/viewbook/section-copy.ts`
- Test: `lib/viewbook/section-copy.test.ts`

**Interfaces:**
- Produces: `SECTION_COPY: Record<SectionKey, SectionCopy>`, `INPUT_EXPECTING_KEYS: ReadonlySet<SectionKey>`, `interface SectionCopy { purpose: string; whatThis: string; whatWeNeed: string | null; cta?: { label: string; sectionKey: SectionKey; anchor: string } | null }`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/viewbook/section-copy.test.ts
import { describe, it, expect } from 'vitest'
import { SECTION_COPY, INPUT_EXPECTING_KEYS } from './section-copy'
import { SECTION_KEYS } from './theme'

describe('section-copy', () => {
  it('has copy for every section key', () => {
    for (const k of SECTION_KEYS) {
      expect(SECTION_COPY[k], `missing copy for ${k}`).toBeDefined()
      expect(SECTION_COPY[k].purpose.length).toBeGreaterThan(0)
      expect(SECTION_COPY[k].whatThis.length).toBeGreaterThan(0)
    }
  })
  it('input-expecting keys are a subset of the catalog and each has whatWeNeed text', () => {
    for (const k of INPUT_EXPECTING_KEYS) {
      expect((SECTION_KEYS as readonly string[]).includes(k)).toBe(true)
      expect(SECTION_COPY[k].whatWeNeed, `${k} expects input but has no whatWeNeed`).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run test — expect FAIL** (`npx vitest run lib/viewbook/section-copy.test.ts`) — "Cannot find module './section-copy'".

- [ ] **Step 3: Implement**

```ts
// lib/viewbook/section-copy.ts
// Code-owned, client-safe per-section reading copy (spec §4.2). Keyed by the
// fixed SECTION_KEYS catalog; no operator data, no server imports. Light-only UI.
import type { SectionKey } from './theme'

export interface SectionCopy {
  purpose: string            // one sentence — chapter header + rail tooltip
  whatThis: string           // "What this is" — 1–2 sentences
  whatWeNeed: string | null  // "What we need from you" — null = nothing needed
  // Optional primary action. `anchor` REQUIRED (a real in-page target other than
  // the section's own hero); `sectionKey` is the SectionReveal to force-open.
  cta?: { label: string; sectionKey: SectionKey; anchor: string } | null
}

export const INPUT_EXPECTING_KEYS: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'pc-setup', 'pc-invite', 'data-source', 'brand', 'assessment', 'materials',
])

export const SECTION_COPY: Record<SectionKey, SectionCopy> = {
  'pc-intro': { purpose: 'Welcome to your viewbook.', whatThis: 'A living space that walks you through every step of your new website, from kickoff to launch.', whatWeNeed: null },
  'pc-setup': { purpose: "Confirm your school's core details.", whatThis: 'The essentials we build everything else on — name, contacts, and web address.', whatWeNeed: 'Fill in the org-basics fields below.', cta: { label: 'Fill in org basics', sectionKey: 'pc-setup', anchor: '#pc-setup' } },
  'pc-invite': { purpose: 'Bring your team into the viewbook.', whatThis: 'Invite the people who should follow along and collaborate on the build.', whatWeNeed: 'Invite the people who should collaborate.' },
  'data-source': { purpose: "Connect the analytics we'll report on.", whatThis: 'Grants us read access to your traffic data so progress is measured, not guessed.', whatWeNeed: 'Grant access to your analytics.' },
  'pc-thanks': { purpose: "You're all set for kickoff.", whatThis: 'Everything we need to begin is in. Here is what happens next.', whatWeNeed: null },
  'welcome': { purpose: 'Meet your team and how we work.', whatThis: 'Who you are working with, why we do this, and the process ahead.', whatWeNeed: null },
  'milestones': { purpose: 'The plan and where we are in it.', whatThis: 'The build broken into milestones so you always know the current step.', whatWeNeed: null },
  'strategy': { purpose: 'How we will grow your enrollment.', whatThis: 'The SEO, GEO, and E-E-A-T approach guiding the new site.', whatWeNeed: null },
  'brand': { purpose: 'Your brand guidelines for the new site.', whatThis: 'The logos, colors, and rules that keep the site unmistakably you.', whatWeNeed: 'Share logos, colors, and brand rules.' },
  'assessment': { purpose: 'What we found on your current site.', whatThis: 'A review of the existing site so we carry forward what works and fix what does not.', whatWeNeed: 'Review and add notes.' },
  'materials': { purpose: 'Shared links and working files.', whatThis: 'A shared home for the links and files this project relies on.', whatWeNeed: 'Add any links or files we should have.' },
  'ws-intro': { purpose: 'What we build in this stage.', whatThis: 'The website-specifics work that turns strategy into a real site.', whatWeNeed: null },
  'kickoff-next': { purpose: 'Your next actions.', whatThis: 'A short, clear list of what to do next to keep the build moving.', whatWeNeed: 'Complete the highlighted items.' },
}
```

- [ ] **Step 4: Run test — expect PASS.**
- [ ] **Step 5: Commit** — `feat(viewbook): code-owned section reading copy + input-expecting set`.

---

### Task 2: `section-status.ts` (pure status derivation)

**Files:**
- Create: `lib/viewbook/section-status.ts`
- Test: `lib/viewbook/section-status.test.ts`

**Interfaces:**
- Consumes: `INPUT_EXPECTING_KEYS` (Task 1), `PublicSection`, `SectionKey`.
- Produces: `type SectionStatus = 'complete'|'current'|'upcoming'|'needs-input'`; `computeSectionStatuses(renderedPrimaryOrder: SectionKey[], sections: Pick<PublicSection,'sectionKey'|'state'|'acknowledgedAt'>[], ctx: { pcCompletedAt: string | null }): Partial<Record<SectionKey, SectionStatus>>`; `carriedStatus(section: Pick<PublicSection,'state'>): SectionStatus`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/viewbook/section-status.test.ts
import { describe, it, expect } from 'vitest'
import { computeSectionStatuses, carriedStatus } from './section-status'

const sec = (sectionKey: string, state: 'active'|'done'|'collapsed', acknowledgedAt: string | null = null) =>
  ({ sectionKey, state, acknowledgedAt }) as any

describe('computeSectionStatuses', () => {
  it('done → complete; first active informational → current; later active → upcoming', () => {
    const order = ['welcome', 'milestones', 'strategy'] as any
    const secs = [sec('welcome', 'done'), sec('milestones', 'active'), sec('strategy', 'active')]
    const r = computeSectionStatuses(order, secs, { pcCompletedAt: null })
    expect(r.welcome).toBe('complete')
    expect(r.milestones).toBe('current')
    expect(r.strategy).toBe('upcoming')
  })
  it('active input-expecting → needs-input; acknowledged input → complete', () => {
    const order = ['pc-setup', 'data-source'] as any
    const secs = [sec('pc-setup', 'active'), sec('data-source', 'active', '2026-07-01T00:00:00Z')]
    const r = computeSectionStatuses(order, secs, { pcCompletedAt: null })
    expect(r['pc-setup']).toBe('needs-input')
    expect(r['data-source']).toBe('complete')
  })
  it('pc-intro is complete once pcCompletedAt is set, else current', () => {
    const order = ['pc-intro', 'pc-setup'] as any
    const active = computeSectionStatuses(order, [sec('pc-intro', 'active'), sec('pc-setup', 'active')], { pcCompletedAt: null })
    expect(active['pc-intro']).toBe('current')
    const done = computeSectionStatuses(order, [sec('pc-intro', 'active'), sec('pc-setup', 'done')], { pcCompletedAt: '2026-07-01T00:00:00Z' })
    expect(done['pc-intro']).toBe('complete')
  })
  it('all-complete lineup fabricates no current', () => {
    const order = ['welcome', 'milestones'] as any
    const r = computeSectionStatuses(order, [sec('welcome', 'done'), sec('milestones', 'done')], { pcCompletedAt: null })
    expect(Object.values(r)).toEqual(['complete', 'complete'])
  })
  it('returns a partial map — missing keys are absent, not defaulted', () => {
    const r = computeSectionStatuses(['welcome'] as any, [sec('welcome', 'active')], { pcCompletedAt: null })
    expect('milestones' in r).toBe(false)
  })
})

describe('carriedStatus', () => {
  it('done → complete, else current', () => {
    expect(carriedStatus({ state: 'done' } as any)).toBe('complete')
    expect(carriedStatus({ state: 'active' } as any)).toBe('current')
    expect(carriedStatus({ state: 'collapsed' } as any)).toBe('current')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL** ("Cannot find module './section-status'").

- [ ] **Step 3: Implement**

```ts
// lib/viewbook/section-status.ts
// Pure, client-safe status derivation (spec §4.3). No scroll state.
import type { SectionKey } from './theme'
import type { PublicSection } from './public-types'
import { INPUT_EXPECTING_KEYS } from './section-copy'

export type SectionStatus = 'complete' | 'current' | 'upcoming' | 'needs-input'

type StatusInput = Pick<PublicSection, 'sectionKey' | 'state' | 'acknowledgedAt'>

export function computeSectionStatuses(
  renderedPrimaryOrder: SectionKey[],
  sections: StatusInput[],
  ctx: { pcCompletedAt: string | null },
): Partial<Record<SectionKey, SectionStatus>> {
  const byKey = new Map(sections.map((s) => [s.sectionKey, s]))
  const out: Partial<Record<SectionKey, SectionStatus>> = {}
  let currentAssigned = false
  for (const key of renderedPrimaryOrder) {
    const s = byKey.get(key)
    if (!s) continue
    // Bookends resolve off pcCompletedAt, never the progression.
    if (key === 'pc-intro') { out[key] = ctx.pcCompletedAt != null ? 'complete' : 'current'; continue }
    if (key === 'pc-thanks') { out[key] = 'current'; continue } // only rendered when pcCompletedAt != null
    if (s.state === 'done') { out[key] = 'complete'; continue }
    if (s.state === 'active' && s.acknowledgedAt != null) { out[key] = 'complete'; continue }
    if (s.state === 'active' && INPUT_EXPECTING_KEYS.has(key)) { out[key] = 'needs-input'; continue }
    // Remaining active informational sections: first → current, rest → upcoming.
    if (s.state === 'active') {
      out[key] = currentAssigned ? 'upcoming' : 'current'
      currentAssigned = true
      continue
    }
    out[key] = 'current' // collapsed-but-active fallback (rare on primary)
  }
  return out
}

export function carriedStatus(section: Pick<PublicSection, 'state'>): SectionStatus {
  return section.state === 'done' ? 'complete' : 'current'
}
```

- [ ] **Step 4: Run test — expect PASS.**
- [ ] **Step 5: Commit** — `feat(viewbook): pure section-status derivation`.

---

### Task 3: `section-origin.ts` (carried-section origin-stage grouping)

**Files:**
- Create: `lib/viewbook/section-origin.ts`
- Test: `lib/viewbook/section-origin.test.ts`

**Interfaces:**
- Consumes: `STAGE_LINEUPS`, `VIEWBOOK_STAGES`, `STAGE_LABELS` (`./stages`), `SectionKey`.
- Produces: `originStageOf(key: SectionKey): ViewbookStage | null` (earliest stage where the key is `primary`); `groupCarriedByOrigin(sections: PublicSection[]): { stageLabel: string; sections: PublicSection[] }[]` (groups in stage order; label via `STAGE_LABELS`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/viewbook/section-origin.test.ts
import { describe, it, expect } from 'vitest'
import { originStageOf, groupCarriedByOrigin } from './section-origin'

describe('section-origin', () => {
  it('resolves the earliest primary stage for a key', () => {
    expect(originStageOf('pc-setup')).toBe('post-contract')
    expect(originStageOf('welcome')).toBe('kickoff')
    expect(originStageOf('brand')).toBe('website-specifics')
  })
  it('groups carried sections by origin stage in stage order', () => {
    const secs = [
      { sectionKey: 'welcome', state: 'done' },
      { sectionKey: 'pc-setup', state: 'done' },
    ] as any
    const groups = groupCarriedByOrigin(secs)
    expect(groups.map((g) => g.stageLabel)).toEqual(['Getting Started', 'Kickoff'])
    expect(groups[0].sections[0].sectionKey).toBe('pc-setup')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// lib/viewbook/section-origin.ts
// Pure, client-safe: which stage a carried section "belongs" to (spec §5 item 7).
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
    if (!buckets.has(origin)) buckets.set(origin, [])
    buckets.get(origin)!.push(s)
  }
  // Emit in canonical stage order.
  return VIEWBOOK_STAGES.filter((st) => buckets.has(st)).map((st) => ({
    stageLabel: STAGE_LABELS[st],
    sections: buckets.get(st)!,
  }))
}
```

- [ ] **Step 4: Run test — expect PASS.**
- [ ] **Step 5: Commit** — `feat(viewbook): carried-section origin-stage grouping`.

---

### Task 4: Extend `toc-index.ts` with `status`

**Files:**
- Modify: `lib/viewbook/toc-index.ts`
- Test: `lib/viewbook/toc-index.test.ts` (add a case; create if absent)

**Interfaces:**
- Consumes: `computeSectionStatuses` (Task 2), `SectionStatus`.
- Produces: `TocEntry` gains `status: SectionStatus`; `buildTocIndex(data)` populates it from the rendered primary order + `data.pcCompletedAt`.

- [ ] **Step 1: Read `lib/viewbook/toc-index.ts`** to learn how `TocEntry` and `buildTocIndex` currently derive top-level entries and their `done`/`acked` flags (reuse that section list as the `renderedPrimaryOrder`).

- [ ] **Step 2: Write the failing test**

```ts
// add to lib/viewbook/toc-index.test.ts
import { buildTocIndex } from './toc-index'
it('tags each top-level toc entry with a status', () => {
  // Build a minimal ViewbookPublicData with a done + an active primary section.
  const data = makeData({ stage: 'kickoff', sections: [
    { sectionKey: 'welcome', state: 'done' }, { sectionKey: 'milestones', state: 'active' },
  ], pcCompletedAt: '2026-07-01T00:00:00Z' })
  const toc = buildTocIndex(data)
  const welcome = toc.find((e) => e.sectionKey === 'welcome')!
  const milestones = toc.find((e) => e.sectionKey === 'milestones')!
  expect(welcome.status).toBe('complete')
  expect(milestones.status).toBe('current')
})
```
(Use the file's existing `makeData`/fixture helper; if none exists, build the smallest `ViewbookPublicData` the current tests already construct.)

- [ ] **Step 3: Run — expect FAIL** ("status" undefined / type error).

- [ ] **Step 4: Implement** — add `status: SectionStatus` to the `TocEntry` interface; in `buildTocIndex`, compute `const statuses = computeSectionStatuses(primaryOrder, primarySections, { pcCompletedAt: data.pcCompletedAt })` where `primaryOrder`/`primarySections` are the same top-level sections the function already iterates, and set `status: statuses[key] ?? carriedStatus(section)` for each entry (carried entries fall back to `carriedStatus`). Import from `./section-status`.

- [ ] **Step 5: Run — expect PASS.** Run the full `toc-index` suite to confirm no regression.
- [ ] **Step 6: Commit** — `feat(viewbook): tag toc entries with section status`.

---

### Task 5: `SectionSummaryPanel.tsx`

**Files:**
- Create: `components/viewbook/public/SectionSummaryPanel.tsx`
- Test: `components/viewbook/public/SectionSummaryPanel.test.tsx`

**Interfaces:**
- Produces: `SectionSummaryPanel({ whatThis, whatWeNeed, status }: { whatThis: string; whatWeNeed: string | null; status: SectionStatus })` (server component).

- [ ] **Step 1: Write the failing test**

```tsx
// components/viewbook/public/SectionSummaryPanel.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { SectionSummaryPanel } from './SectionSummaryPanel'

describe('SectionSummaryPanel', () => {
  it('shows What this is and the status label', () => {
    render(<SectionSummaryPanel whatThis="A living space." whatWeNeed={null} status="current" />)
    expect(screen.getByText('What this is')).toBeInTheDocument()
    expect(screen.getByText('A living space.')).toBeInTheDocument()
    expect(screen.getByText(/current/i)).toBeInTheDocument()
  })
  it('shows What we need from you only when provided', () => {
    const { rerender } = render(<SectionSummaryPanel whatThis="x" whatWeNeed="Do the thing." status="needs-input" />)
    expect(screen.getByText('What we need from you')).toBeInTheDocument()
    expect(screen.getByText('Do the thing.')).toBeInTheDocument()
    rerender(<SectionSummaryPanel whatThis="x" whatWeNeed={null} status="complete" />)
    expect(screen.queryByText('What we need from you')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — a light-only panel. Structure: a rounded card (`border-black/10 bg-white`), a two-column-on-`sm` grid with a "What this is" block (label in `--vb-secondary` uppercase eyebrow style + `whatThis` prose) and, when `whatWeNeed != null`, a "What we need from you" block; plus a `StatusPill` (see below). Add a small exported `StatusPill({ status }: { status: SectionStatus })` in this file that maps status → label + color token: `complete`→"Complete"/`--vb-tertiary`, `current`→"Current"/`--vb-secondary`, `upcoming`→"Upcoming"/neutral `rgba(0,0,0,0.45)`, `needs-input`→"Needs input"/`--vb-primary`. Label is a visible word (not color-only). `StatusPill` will be reused by `SectionShell` and `StageOverview`.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(viewbook): SectionSummaryPanel + StatusPill`.

---

### Task 6: Wave-1 stubs — controller, StageOverview, PreviousStages

**Files:**
- Create: `components/viewbook/public/ReadingProgressController.tsx`
- Create: `components/viewbook/public/StageOverview.tsx`
- Create: `components/viewbook/public/PreviousStages.tsx`

**Interfaces (frozen — Lanes A/D replace internals only):**
- Produces: `ReadingProgressController()` (client, no props); `StageOverview({ items }: { items: { sectionKey: SectionKey; label: string; status: SectionStatus; anchor: string }[] })` (server); `PreviousStages({ groups, renderSection }: { groups: { stageLabel: string; sections: PublicSection[] }[]; renderSection: (s: PublicSection, meta: SectionRenderMeta) => ReactNode })` (server).

- [ ] **Step 1: Implement the controller stub**

```tsx
// components/viewbook/public/ReadingProgressController.tsx
'use client'
// Lane A replaces the body (spec §7). Stub: mount-only no-op so ViewbookShell
// compiles and the contract exists. Renders nothing.
export function ReadingProgressController() {
  return null
}
```

- [ ] **Step 2: Implement the StageOverview stub** — server component; renders a `<nav aria-label="In this stage">` with a simple list of `items` (button per item calling nothing yet — stub may render plain text/links). Keep the exact prop shape above.

- [ ] **Step 3: Implement the PreviousStages stub** — server component (NO `'use client'`); if `groups` is empty return `null`; else render each group's `stageLabel` and, for each section, `renderSection(s, { heroSize: 'none', chapterNumber: null, status: 'complete', isLead: false })`. This is a functional stub Lane D restyles.

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` (expect PASS; imports resolve).
- [ ] **Step 5: Commit** — `feat(viewbook): stub controller/overview/previous-stages contracts`.

---

### Task 7: `SectionShell` — heroSize, chapter header, DOM contract, summary-panel slot

**Files:**
- Modify: `components/viewbook/public/SectionShell.tsx`
- Test: `components/viewbook/public/SectionShell.test.tsx`

**Interfaces:**
- Consumes: `SectionRenderMeta` (define/export it here or in `public-types.ts` — put it in `lib/viewbook/public-types.ts` so leaves + operator layer import it without a cycle), `SECTION_COPY`, `StatusPill`, `SectionSummaryPanel`.
- Produces: `SectionShell` gains a `meta: SectionRenderMeta` prop; emits `data-vb-section`, `data-vb-status`, `data-vb-hero-visible` on `<section>`, `data-vb-hero` on the hero div, renders the chapter header + summary panel.

- [ ] **Step 1: Add `SectionRenderMeta` to `lib/viewbook/public-types.ts`** (so it is import-cycle-safe) exactly per Global Constraints, importing `SectionStatus` from `./section-status`.

- [ ] **Step 2: Write the failing test**

```tsx
// components/viewbook/public/SectionShell.test.tsx  (add cases)
import { render } from '@testing-library/react'
// ...existing imports...
const meta = (over = {}) => ({ heroSize: 'chapter', chapterNumber: 2, status: 'current', isLead: false, ...over }) as any

it('emits the DOM contract attributes and a hero sentinel for chapter heroes', () => {
  const { container } = render(<SectionShell section={activeSection('brand')} stage="website-specifics" title="Brand" heroUrl={null} meta={meta()}>body</SectionShell>)
  const section = container.querySelector('section')!
  expect(section.getAttribute('data-vb-section')).toBe('brand')
  expect(section.getAttribute('data-vb-status')).toBe('current')
  expect(section.getAttribute('data-vb-hero-visible')).toBe('true')
  expect(container.querySelector('[data-vb-hero]')).toBeTruthy()
})
it('no-hero sections seed hero-visible false and emit no hero sentinel', () => {
  const { container } = render(<SectionShell section={activeSection('brand')} stage="website-specifics" title="Brand" heroUrl={null} meta={meta({ heroSize: 'none' })}>body</SectionShell>)
  expect(container.querySelector('section')!.getAttribute('data-vb-hero-visible')).toBe('false')
  expect(container.querySelector('[data-vb-hero]')).toBeNull()
})
```
(Reuse the file's existing section fixture helper; add `activeSection(key)` if not present.)

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement.** On the `<section>`: add `data-vb-section={section.sectionKey}`, `data-vb-status={meta.status}`, `data-vb-hero-visible={meta.heroSize === 'none' ? 'false' : 'true'}`. Hero band: render only when `meta.heroSize !== 'none'`; size by `meta.heroSize` — `full` → `min-h-[60vh]`, `chapter` → `h-[220px]` (keep the existing image + brand-fade + on-primary `<h2>`); add `data-vb-hero` to the hero `<div>`. Chapter header (replaces the bare `TickDivider` strip, still suppressed when `heroOnly`): a row with the chapter number (`meta.chapterNumber`, `aria-hidden` decorative when non-null), the `SECTION_COPY[key].purpose` sentence, a `<StatusPill status={meta.status} />`, and (when `SECTION_COPY[key].cta`) a CTA button wired via `navigateToAnchor(cta.sectionKey, cta.anchor)` — but CTA is a client action, so render it through a tiny existing/`'use client'` button island (reuse `KickoffNextButton` pattern or add a minimal `ChapterCtaButton`; keep SectionShell a server component). Body: render `<SectionSummaryPanel whatThis={copy.whatThis} whatWeNeed={copy.whatWeNeed} status={meta.status} />` before `children`, inside the existing `SectionReveal` region.

- [ ] **Step 5: Run — expect PASS** (+ existing SectionShell suite green).
- [ ] **Step 6: Commit** — `feat(viewbook): SectionShell hero sizing + chapter header + summary panel`.

---

### Task 8: `SectionReveal` — fixed-box sticky bar + inert duplicate label + ~68ch

**Files:**
- Modify: `components/viewbook/public/SectionReveal.tsx`
- Test: `components/viewbook/public/SectionReveal.test.tsx`

**Interfaces:**
- Produces: sticky bar keeps a constant height; a `data-vb-sticky-label` inner element (`aria-hidden="true"`, text-only) fades via CSS keyed off the ancestor section's `data-vb-hero-visible`.

- [ ] **Step 1: Write the failing test**

```tsx
// add to SectionReveal.test.tsx
it('renders an aria-hidden duplicate sticky label with no interactive children', () => {
  const { container } = render(<SectionReveal regionId="r" title="Brand" alwaysOpen={false} initiallyOpen>body</SectionReveal>)
  const dup = container.querySelector('[data-vb-sticky-label]')!
  expect(dup).toBeTruthy()
  expect(dup.getAttribute('aria-hidden')).toBe('true')
  expect(dup.querySelector('a,button')).toBeNull()
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Keep the existing sticky bar and its always-visible interactive header. ADD a `data-vb-sticky-label` inner `<span>` (duplicate of the title text only, `aria-hidden`) that is faded by an inline `<style>`: `[data-vb-hero-visible="true"] [data-vb-sticky-label] { opacity: 0; } @media (prefers-reduced-motion: reduce){ [data-vb-sticky-label]{ transition:none } }` and a default `transition: opacity 200ms`. Ensure the bar's height does not depend on the duplicate label's opacity (it always occupies its box). Constrain body prose: wrap the `children` container (the `.mx-auto ... max-w-5xl` inner) content measure by adding `max-w-[68ch]` to the prose wrapper (NOT the full-width bar) — apply to the summary panel + intro + children column so text lines cap ~68ch while cards can stay wider.

- [ ] **Step 4: Run — expect PASS** (+ existing SectionReveal suite).
- [ ] **Step 5: Commit** — `feat(viewbook): fixed-box sticky bar with inert reveal label + measure`.

---

### Task 9: Render-meta threading — `renderSection` + all 13 components + operator wrapper

**Files:**
- Modify: `app/(public)/viewbook/[token]/page.tsx` (`baseRenderSection`, `wrappedRenderSection`)
- Modify: all 13 section components (each forwards `meta` → `SectionShell`)
- Modify: `components/viewbook/public/OperatorLayer/*` (the wrapper that composes `renderSection`)

**Interfaces:**
- Consumes: `SectionRenderMeta`.
- Produces: `renderSection` signature is `(section, meta) => ReactNode` end-to-end.

- [ ] **Step 1: Read** `page.tsx` and `OperatorLayer/OperatorViewbookLayer.tsx` (+ wrapper) to see how `baseRenderSection`/`wrappedRenderSection` dispatch to the 13 components today.

- [ ] **Step 2: Widen the dispatchers** — `baseRenderSection(section: PublicSection, meta: SectionRenderMeta)` passes `meta` to whichever component it renders. `wrappedRenderSection` forwards `(section, meta)` unchanged (the operator wrapper adds its overlay but must not swallow `meta`).

- [ ] **Step 3: Thread `meta` into each of the 13 components** — each component's props gain `meta: SectionRenderMeta`, forwarded to its internal `SectionShell`. Sections that build their own `SummaryStat` summary keep it; `SectionShell` now also renders the summary panel + chapter header from `meta`.

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit`. Fix every call-site the compiler flags until green (this is the mechanical bulk of the task).

- [ ] **Step 5: Run the viewbook component + page test suites** — `npx vitest run components/viewbook lib/viewbook` — fix fallout (tests that construct `renderSection` or render a section component now pass a `meta`; add a shared test helper `defaultMeta()` if useful).

- [ ] **Step 6: Commit** — `refactor(viewbook): thread SectionRenderMeta through renderSection + all sections`.

---

### Task 10: `ViewbookShell` — lead promotion, meta computation, mount controller/overview, previous-stages

**Files:**
- Modify: `components/viewbook/public/ViewbookShell.tsx`
- Test: `components/viewbook/public/ViewbookShell.test.tsx`

**Interfaces:**
- Consumes: `computeSectionStatuses`, `carriedStatus`, `groupCarriedByOrigin`, `SECTION_COPY`, `SectionRenderMeta`, stubs from Task 6.
- Produces: full-hero lead, per-section `meta`, mounts `ReadingProgressController` + `StageOverview`, renders `PreviousStages` instead of `EarlierSteps`.

- [ ] **Step 1: Write the failing test**

```tsx
// add to ViewbookShell.test.tsx
it('promotes the first rendered primary section to a full hero and the rest to chapter', () => {
  const data = makeData({ stage: 'kickoff' }) // primary: welcome, milestones, strategy, kickoff-next
  const seen: Record<string, string> = {}
  render(<ViewbookShell token="t" data={data} primarySections={data.__primary} carriedSections={data.__carried}
    renderSection={(s, meta) => { seen[s.sectionKey] = meta.heroSize; return <div /> }} />)
  const first = data.__primary[0].sectionKey
  expect(seen[first]).toBe('full')
  expect(seen[data.__primary[1].sectionKey]).toBe('chapter')
})
it('renders the In this stage overview and mounts the reading controller', () => {
  const data = makeData({ stage: 'kickoff' })
  const { container } = render(<ViewbookShell token="t" data={data} primarySections={data.__primary} carriedSections={data.__carried} renderSection={() => <div />} />)
  expect(container.querySelector('[aria-label="In this stage"]')).toBeTruthy()
})
```
(Use the suite's existing `makeData`; expose `__primary`/`__carried` or read the arrays the test already passes.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.**
  - Compute `const statuses = computeSectionStatuses(primarySections.map(s=>s.sectionKey), primarySections, { pcCompletedAt: data.pcCompletedAt })`.
  - Build per-section `meta`: iterate `primarySections` with index; `isLead = index === 0`; `heroSize = isLead ? 'full' : 'chapter'`; `chapterNumber = index + 1`; `status = statuses[key] ?? 'current'`. Pass `meta` into `renderSection(s, meta)`.
  - Insert `<StageOverview items={primarySections.map((s,i)=>({ sectionKey: s.sectionKey, label: SECTION_TITLES[s.sectionKey], status: statuses[s.sectionKey] ?? 'current', anchor: '#'+s.sectionKey }))} />` immediately AFTER the lead section (index 0) and before the rest — i.e. render lead, then overview, then remaining primaries. (Simplest: render `primarySections[0]`, then `<StageOverview .../>`, then `primarySections.slice(1)`.)
  - Replace `<EarlierSteps .../>` with `<PreviousStages groups={groupCarriedByOrigin(carriedSections)} renderSection={(s)=>renderSection(s, { heroSize:'none', chapterNumber:null, status: carriedStatus(s), isLead:false })} />`.
  - Mount `<ReadingProgressController />` once (near the existing `StickyOffsetProbe`).
- [ ] **Step 4: Run — expect PASS** (+ existing ViewbookShell suite; update fixtures that asserted `EarlierSteps`).
- [ ] **Step 5: Typecheck + full viewbook suite green.**
- [ ] **Step 6: Commit** — `feat(viewbook): full-hero lead, in-stage overview, previous-stages wiring`.

**⇒ Wave 1 merge gate:** `npx tsc --noEmit` && `npx vitest run` green; open PR onto `main`. Wave 2 lanes branch from this.

---

# WAVE 2 — LANES (concurrent, disjoint files, built on Wave-1 contracts)

> Lanes A/B/C → **Codex (Sol)**; Lanes D/E → **me**. Each lane branches off the merged spine, is its own PR, and may edit ONLY its listed files.

### Lane A — Task A: `ReadingProgressController` (replace stub)

**Files:** Modify `components/viewbook/public/ReadingProgressController.tsx`; Test `ReadingProgressController.test.tsx`.

**Interfaces:** Consumes the DOM contract (`[data-vb-section]`, `[data-vb-hero]`, `[data-vb-hero-visible]`, `[data-vb-toc-section]`) + `--vb-sticky-offset`. Produces no exports beyond the component.

- [ ] **Step 1: Write failing tests** (jsdom, mocked `IntersectionObserver`):
  - When `IntersectionObserver` is undefined, on mount every `[data-vb-section]` gets `data-vb-hero-visible="false"` (fallback).
  - Given a fake observer, simulating hero N's bottom crossing the activation line sets that section's `data-vb-hero-visible="false"` and marks the correct rail node `[data-vb-toc-section="<key>"]` with `data-vb-active` + `aria-current="location"`, clearing it from the previously-active node.
  - The controller re-queries the rail node each commit (place two nodes, swap which one is in the DOM, assert it targets the live one).

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** per spec §7: build the observer with `rootMargin` top derived from the current `--vb-sticky-offset`; maintain a crossed/not-crossed flag per hero from `boundingClientRect.top` vs the activation line; active = last crossed (first-before / last-after fallback); flip `data-vb-hero-visible` off hero-bottom crossing; rebuild observer when `StickyOffsetProbe` republishes a changed offset (listen to the same signal `StickyOffsetProbe` uses, or a `MutationObserver`/rAF poll of the CSS var — read `StickyOffsetProbe.tsx` to match its publish mechanism); rAF-batch writes; NEVER touch collapse/`grid-template-rows`; SSR/no-IO fallback sets all hero-visible false.
- [ ] **Step 4: Run — expect PASS.** — [ ] **Step 5: Commit** — `feat(viewbook): reading-progress scroll controller (Lane A)`.

### Lane B — Task B: `TocRail` active state + glyphs + `data-vb-toc-section` + mobile pill

**Files:** Modify `TocRail.tsx`; Test `TocRail.test.tsx`.

**Interfaces:** Consumes `TocEntry.status`. Produces: top-level buttons emit `data-vb-toc-section="{sectionKey}"`; CSS styles `[data-vb-active="true"]`; glyphs map to status.

- [ ] **Step 1: Write failing tests:** each top-level entry button has `data-vb-toc-section` = its key; a `data-vb-active="true"` entry renders the accent bar/filled-marker class; glyph per status (✓ complete, ring current + needs-input, dot upcoming) via a data attr the test can assert; the mobile FAB shows a "Sections" label (not a bare `☰`).
- [ ] **Step 2: Run — expect FAIL.** — [ ] **Step 3: Implement:** add `data-vb-toc-section` to top-level buttons only; extend `Glyph` to take `status` and render ✓/ring/dot; add a CSS rule for `[data-vb-active="true"]` (left accent bar in `--vb-secondary` + filled marker); change the mobile FAB to a labeled pill "Sections" (keep `aria-label`, keep the bottom-sheet). Do NOT set `data-vb-active` here — Lane A owns that.
- [ ] **Step 4: Run — expect PASS.** — [ ] **Step 5: Commit** — `feat(viewbook): rail active-state, status glyphs, Sections pill (Lane B)`.

### Lane C — Task C: `WelcomeSection` editorial cards

**Files:** Modify `WelcomeSection.tsx`; Test `WelcomeSection.test.tsx` (create if absent).

- [ ] **Step 1: Write failing tests:** renders labeled cards — Philosophy (from `blocks.why`), Credentials (code-owned ER copy const in this file), Contact (CSM), Team (roster), Process (from `blocks.process`); placeholders when a block is absent (existing pattern).
- [ ] **Step 2: Run — expect FAIL.** — [ ] **Step 3: Implement:** restructure the existing body into five clearly-labeled `<section>`/card blocks in that order; add a local `ER_CREDENTIALS` copy const for the Credentials card; keep `SectionShell`/`meta` usage from Wave 1 intact (do not touch the shell). Light-only.
- [ ] **Step 4: Run — expect PASS.** — [ ] **Step 5: Commit** — `feat(viewbook): Welcome & Team editorial cards (Lane C)`.

### Lane D — Task D: `StageOverview` + `PreviousStages` (real) + delete `EarlierSteps`

**Files:** Modify `StageOverview.tsx`, `PreviousStages.tsx`; Delete `EarlierSteps.tsx` + `EarlierSteps.test.tsx`; Tests `StageOverview.test.tsx`, `PreviousStages.test.tsx`.

- [ ] **Step 1: Write failing tests:** `StageOverview` renders one clickable entry per item (number · label · status glyph) that calls `navigateToAnchor`; `PreviousStages` renders "Previous stages" heading, groups labeled by origin stage, `state==='collapsed'` carried sections render as NON-expandable rows (no toggle/region), others expand to `renderSection(s, {heroSize:'none',...})`.
- [ ] **Step 2: Run — expect FAIL.** — [ ] **Step 3: Implement** both real components (spec §2/§5 item 7); reuse `StatusPill`/`Glyph` styling; ensure `PreviousStages` stays a server component. Delete `EarlierSteps.tsx` + its test.
- [ ] **Step 4: Run — expect PASS**; grep to confirm no remaining `EarlierSteps` import (`git grep EarlierSteps` → none). — [ ] **Step 5: Commit** — `feat(viewbook): In-stage overview + Previous stages rows; retire EarlierSteps (Lane D)`.

### Lane E — Task E: `KickoffNextSection` action summary + CTA

**Files:** Modify `KickoffNextSection.tsx`; Test `KickoffNextSection.test.tsx` (create if absent).

- [ ] **Step 1: Write failing test:** renders an action summary with a single clear CTA (label from `SECTION_COPY['kickoff-next'].cta` or a local const) wired via `navigateToAnchor`; not an empty chapter.
- [ ] **Step 2: Run — expect FAIL.** — [ ] **Step 3: Implement:** replace the near-empty body with a concise action summary + one prominent CTA button (client island for the click, per the SectionShell CTA pattern). Keep `meta`/shell usage intact.
- [ ] **Step 4: Run — expect PASS.** — [ ] **Step 5: Commit** — `feat(viewbook): Next Steps action summary + CTA (Lane E)`.

**⇒ Wave 2 integration gate:** merge lanes onto the spine branch; run `npx tsc --noEmit` && `npx vitest run`; integration pass fixes only merge/wiring conflicts (never repairs a shared contract inside a lane file — that returns to a spine follow-up). Then browser eyeball (animation feel / CLS / active-state / mobile sheet) — no local `/verify` for viewbook. Then PR → `main` → deploy.

---

## Self-Review

**Spec coverage:** §4.0 render-meta → Task 9; §4.1 DOM/sticky → Tasks 7,8; §4.2 copy → Task 1; §4.3 status → Task 2; §4.4 toc/rail-id → Tasks 4,B; §4.5 stubs → Task 6; §5 features → Tasks 7–10,C,D,E; §6 delivery = the Wave/lane structure; §7 controller → Task A; §8 a11y → Tasks 7,8,A,B; §9 tests = per-task; §10 risks addressed (fixed-box §8, deterministic active §A). All covered.

**Placeholder scan:** pure modules (Tasks 1–6, A) carry full code; JSX-heavy tasks carry full test code + exact structural directives + spec refs (no "add error handling"/"similar to"/"TBD"). Acceptable for a light-only presentational redesign where transcribing every Tailwind line adds no correctness value.

**Type consistency:** `SectionRenderMeta` (public-types) used identically in Tasks 6–10 + D; `computeSectionStatuses` signature identical in Tasks 2,4,10; `SectionStatus` from `section-status.ts` everywhere; `data-vb-toc-section` producer (B) matches consumer (A); `carriedStatus` used in Tasks 4,10,D.
