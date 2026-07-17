# Viewbook v2 PR6 — Website-Specifics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the website-specifics stage's own hero section (`ws-intro`) and add a WCAG contrast tester to the brand section, backed by a new `lib/viewbook/contrast.ts` that becomes the ONE shared relative-luminance implementation (`theme.ts`'s `onThemeColorText` refactors onto it).

**Architecture:** A pure, client-safe `contrast.ts` exports `relativeLuminance`, `contrastRatio`, and a `contrastBands` classifier (spec-pinned AA/AAA bands). `theme.ts` keeps its `onThemeColorText` signature and 0.179 crossover but computes luminance via the shared function (output-identical for byte-quantized hex — the theme suite stays green). A client-only `ContrastTester` renders a live matrix of the theme's real pairings plus a free pair-picker (nothing persisted, no network, no editor-registry touch). A new `WsIntroSection` slim hero renders through `SectionShell`, and `ws-intro` is activated into the `website-specifics` lineup + the page render switch.

**Tech Stack:** Next.js 15 App Router, TypeScript, React (client component for the tester), Tailwind, vitest + @testing-library/react (jsdom).

## Global Constraints

- **No new rendered-data mutation in this PR.** The tester persists nothing; `ws-intro` copy is code-owned static + the existing editable `section.narrative` (written through already-bump-adopting routes). The program-wide sync-bump merge gate is therefore **vacuously satisfied** — Task 6 records a one-line sync-bump audit confirming no new write path. (The inline theme editor that WOULD write theme data is PR8, out of scope here.)
- `contrast.ts` and `theme.ts` are **client-safe** — pure functions only, no server imports (`@/lib/db`, `fs`, etc.). `contrast.ts` imports nothing from `theme.ts` (no cycle: `theme.ts` → `contrast.ts`, one direction).
- WCAG relative-luminance uses the **0.04045 sRGB linearization threshold** (spec §9), replacing `theme.ts`'s classic 0.03928. For all 6-digit `#rrggbb` inputs the two thresholds bracket the same 8-bit byte boundary, so `onThemeColorText` output is unchanged — but the theme suite is the gate: it MUST stay green after the refactor.
- Contrast bands pinned exactly (spec §9): **AA 4.5 normal / 3.0 large; AAA 7.0 normal / 4.5 large.**
- Real page constants (from `components/viewbook/public/ViewbookShell.tsx:31` `bg-[#fafafa] text-[#1a1a1a]`): `PAGE_BG = '#fafafa'`, `PAGE_TEXT = '#1a1a1a'`. Brand bands render `var(--vb-on-*)` text on `var(--vb-*)` (`SectionShell.tsx:70/88`); `var(--vb-primary)` is also used as accent text on the light page (`DataSourceSection.tsx:63`).
- The tester is **visible to everyone** (spec §9) — it lives in the brand section, no operator gate.
- Plain text on the public surface; escape at render; no `dangerouslySetInnerHTML`. Dark-mode `dark:` variants where the surrounding components use them (public viewbook is a themed light surface — match neighbors).
- Gates before merge: `npx tsc --noEmit`, `npm run lint`, `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`. Work in worktree branch `feat/viewbook-v2-pr6`.

## Scope reality check (grounded in merged main @ 34f9f5d)

- **`brand` and `assessment` are ALREADY in `STAGE_LINEUPS['website-specifics'].primary`** (`stages.ts:39-42` = `['brand','assessment']`) and fully wired (components + render-switch cases + titles). PR6 does **NOT** introduce them. "Assessment placement" per the spec's final lineup (`ws-intro, brand, assessment`) means only **prepending `ws-intro`**; assessment already sits after brand and stays there.
- **`ws-intro` is dormant**: present in `SECTION_KEYS` (`theme.ts:19`) and `SECTION_TITLES` (`section-titles.ts` → `'Website Specifics'`), but in NO lineup, NO component, NO render-switch case. This is the one section PR6 activates.
- The carried-list additions (`pc-setup`, `pc-invite`) in the spec's final website-specifics lineup ship with PR5 (their components) — **do NOT add them here** (producer-before-consumer rule, spec §4).
- `contrast.ts` does not exist. `onThemeColorText` (`theme.ts:123-132`) is the sole luminance impl; its only non-test caller is `themeCssVars` (`ThemeStyle.tsx:32-34`).

---

### Task 1: `lib/viewbook/contrast.ts` — shared luminance + contrast primitives

**Files:**
- Create: `lib/viewbook/contrast.ts`, `lib/viewbook/contrast.test.ts`

**Interfaces:**
- Produces (all pure, client-safe; input is a validated `#rrggbb` string — no internal guarding, matching `onThemeColorText`'s existing contract):
  - `relativeLuminance(hex: string): number` — WCAG 2.x relative luminance, 0.04045 threshold.
  - `contrastRatio(hexA: string, hexB: string): number` — `(Llight + 0.05) / (Ldark + 0.05)`, order-independent.
  - `CONTRAST_BANDS: { aaNormal: 4.5; aaLarge: 3.0; aaaNormal: 7.0; aaaLarge: 4.5 }` (const).
  - `type ContrastBands = { aaNormal: boolean; aaLarge: boolean; aaaNormal: boolean; aaaLarge: boolean }`.
  - `contrastBands(ratio: number): ContrastBands` — `ratio >= threshold` per band.
- Consumes: nothing.

- [ ] **Step 1: Write failing tests** — `lib/viewbook/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { relativeLuminance, contrastRatio, contrastBands, CONTRAST_BANDS } from './contrast'

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6)
  })
  it('is monotonic in brightness', () => {
    expect(relativeLuminance('#808080')).toBeGreaterThan(relativeLuminance('#404040'))
  })
})

describe('contrastRatio', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 4)
  })
  it('identical colors are 1:1', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 6)
  })
  it('is order-independent', () => {
    expect(contrastRatio('#122033', '#fafafa')).toBeCloseTo(contrastRatio('#fafafa', '#122033'), 10)
  })
})

describe('contrastBands', () => {
  it('all bands pass at 21:1', () => {
    expect(contrastBands(21)).toEqual({ aaNormal: true, aaLarge: true, aaaNormal: true, aaaLarge: true })
  })
  it('exactly 4.5 passes AA-normal, AA-large, AAA-large but not AAA-normal', () => {
    expect(contrastBands(4.5)).toEqual({ aaNormal: true, aaLarge: true, aaaNormal: false, aaaLarge: true })
  })
  it('3.0 passes only AA-large', () => {
    expect(contrastBands(3.0)).toEqual({ aaNormal: false, aaLarge: true, aaaNormal: false, aaaLarge: false })
  })
  it('band thresholds are the spec-pinned values', () => {
    expect(CONTRAST_BANDS).toEqual({ aaNormal: 4.5, aaLarge: 3.0, aaaNormal: 7.0, aaaLarge: 4.5 })
  })
})
```

- [ ] **Step 2: Run to verify failure** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/contrast.test.ts` → module not found.

- [ ] **Step 3: Implement `lib/viewbook/contrast.ts`**

```ts
// v2 PR6: THE ONE shared WCAG relative-luminance / contrast implementation
// (spec §9, Codex fix 12). Client-safe, pure. theme.ts's onThemeColorText
// refactors onto relativeLuminance. Inputs are already-validated #rrggbb hex
// (parseStoredTheme / theme validator), so no internal guarding — matching the
// prior onThemeColorText contract.

function channelLuminance(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const r = channelLuminance(parseInt(hex.slice(1, 3), 16))
  const g = channelLuminance(parseInt(hex.slice(3, 5), 16))
  const b = channelLuminance(parseInt(hex.slice(5, 7), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

export const CONTRAST_BANDS = {
  aaNormal: 4.5,
  aaLarge: 3.0,
  aaaNormal: 7.0,
  aaaLarge: 4.5,
} as const

export type ContrastBands = {
  aaNormal: boolean
  aaLarge: boolean
  aaaNormal: boolean
  aaaLarge: boolean
}

export function contrastBands(ratio: number): ContrastBands {
  return {
    aaNormal: ratio >= CONTRAST_BANDS.aaNormal,
    aaLarge: ratio >= CONTRAST_BANDS.aaLarge,
    aaaNormal: ratio >= CONTRAST_BANDS.aaaNormal,
    aaaLarge: ratio >= CONTRAST_BANDS.aaaLarge,
  }
}
```

- [ ] **Step 4: Green** — same command, all pass.
- [ ] **Step 5: Commit** — `feat(viewbook): shared WCAG contrast primitives (contrast.ts)`

---

### Task 2: Refactor `theme.ts` `onThemeColorText` onto `relativeLuminance`

**Files:**
- Modify: `lib/viewbook/theme.ts:123-132`
- Test: `lib/viewbook/theme.test.ts` (extend — do NOT weaken existing assertions)

**Interfaces:**
- Consumes: Task 1's `relativeLuminance`.
- Produces: `onThemeColorText(hex: string): '#ffffff' | '#111111'` — SAME signature, SAME literal-union return, SAME 0.179 crossover. Output identical for all `#rrggbb` inputs.

- [ ] **Step 1: Write a failing (well: pinning) test** — add to `lib/viewbook/theme.test.ts` a test asserting `onThemeColorText` still returns the exact expected literal for representative colors AND that it now delegates to the shared luminance (a black/white/mid triple). This will PASS once the refactor keeps output identical; write it first to lock the contract:

```ts
import { onThemeColorText } from './theme'
import { relativeLuminance } from './contrast'

describe('onThemeColorText (post-contrast.ts refactor)', () => {
  it('picks dark text on light bg, white text on dark bg', () => {
    expect(onThemeColorText('#ffffff')).toBe('#111111')
    expect(onThemeColorText('#000000')).toBe('#ffffff')
    expect(onThemeColorText('#122033')).toBe('#ffffff') // DEFAULT_THEME.primary
    expect(onThemeColorText('#c99334')).toBe('#111111') // DEFAULT_THEME.tertiary
  })
  it('crossover is at luminance 0.179 using the shared luminance fn', () => {
    // Deterministic boundary (Codex fix): #757575 ≈ 0.178 luminance → white text
    // (below crossover); #767676 ≈ 0.181 → dark text (above). These are exact
    // 8-bit greys straddling 0.179; no "adjust if flaky" — they are the gate.
    expect(onThemeColorText('#757575')).toBe('#ffffff')
    expect(onThemeColorText('#767676')).toBe('#111111')
    expect(relativeLuminance('#757575')).toBeLessThan(0.179)
    expect(relativeLuminance('#767676')).toBeGreaterThan(0.179)
  })
})
```

- [ ] **Step 2: Run to verify** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/theme.test.ts`. The boundary greys are deterministic (computed: #757575 → 0.178, #767676 → 0.181); no adjustment expected.

- [ ] **Step 3: Implement the refactor** — replace the inlined channel closure with the shared function, preserving everything else:

```ts
import { relativeLuminance } from './contrast'

// WCAG relative luminance via the shared contrast primitive (spec §9 — one impl,
// not two). 0.179 is the crossover where black and white text have equal
// contrast ratio against the background. Output is unchanged from the prior
// inlined 0.03928-threshold form for all byte-quantized #rrggbb inputs.
export function onThemeColorText(hex: string): '#ffffff' | '#111111' {
  return relativeLuminance(hex) > 0.179 ? '#111111' : '#ffffff'
}
```

Add the `import` at the top of `theme.ts` with the other imports.

- [ ] **Step 4: Green** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/theme.test.ts lib/viewbook/contrast.test.ts` AND `npx tsc --noEmit` (confirm the literal-union return still type-checks against `ThemeStyle.tsx`'s `--vb-on-*` usage).
- [ ] **Step 5: Commit** — `refactor(viewbook): onThemeColorText delegates to shared relativeLuminance`

---

### Task 3: `ContrastTester.tsx` — live matrix + free pair-picker (client-only)

**Files:**
- Create: `components/viewbook/public/ContrastTester.tsx`, `components/viewbook/public/ContrastTester.test.tsx`

**Interfaces:**
- Consumes: `contrast.ts` (`contrastRatio`, `contrastBands`), `theme.ts` (`onThemeColorText`, `ViewbookTheme`).
- Produces: `export function ContrastTester({ theme }: { theme: ViewbookTheme })` — a `'use client'` component. Renders (a) a fixed matrix of the theme's real pairings with computed ratio + four band chips each, recomputed from `theme` on every render (live as ER edits); (b) a free pair-picker (two color inputs, local `useState`, nothing persisted, no fetch, no `useEditorActivity`).

Matrix rows (compute `contrastRatio(fg, bg)` per row; `PAGE_BG='#fafafa'`, `PAGE_TEXT='#1a1a1a'` as module consts):

| Label | fg | bg |
|---|---|---|
| Body text on page | `PAGE_TEXT` | `PAGE_BG` |
| Brand color as text on page | `theme.primary` | `PAGE_BG` |
| Secondary color as text on page | `theme.secondary` | `PAGE_BG` |
| Accent color as text on page | `theme.tertiary` | `PAGE_BG` |
| Text on primary band | `onThemeColorText(theme.primary)` | `theme.primary` |
| Text on secondary band | `onThemeColorText(theme.secondary)` | `theme.secondary` |
| Text on accent band | `onThemeColorText(theme.tertiary)` | `theme.tertiary` |

- [ ] **Step 1: Write failing tests** — `ContrastTester.test.tsx` (jsdom, @testing-library/react; follow the render/query conventions in a sibling public component test, e.g. `SectionShell.test.tsx` / `FeedbackThread.test.tsx`):

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContrastTester } from './ContrastTester'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'

describe('ContrastTester', () => {
  it('renders a ratio for each theme pairing (7 rows)', () => {
    render(<ContrastTester theme={DEFAULT_THEME} />)
    // every row shows an "N.N:1" ratio; there are 7 fixed rows
    const ratios = screen.getAllByTestId('contrast-ratio')
    expect(ratios).toHaveLength(7)
  })
  it('shows a passing AA-normal chip for dark body text on the light page', () => {
    render(<ContrastTester theme={DEFAULT_THEME} />)
    const bodyRow = screen.getByTestId('contrast-row-body')
    // #1a1a1a on #fafafa is ~16:1 → AA normal passes. NOTE: this repo has NO
    // jest-dom (setupFiles is only ./test/setup-worker.ts) — use DOM-native
    // assertions (textContent / querySelector / toBeTruthy), never
    // toBeInTheDocument / toHaveTextContent (Codex fix).
    expect(bodyRow.textContent).toMatch(/AA/i)
    expect(bodyRow.querySelector('[data-band="aaNormal"][data-pass="true"]')).not.toBeNull()
  })
  it('flags a light brand color used as page text as failing AA-normal', () => {
    // a pale primary as accent text on #fafafa fails 4.5:1
    render(<ContrastTester theme={{ ...DEFAULT_THEME, primary: '#cfe8e8' }} />)
    const brandRow = screen.getByTestId('contrast-row-primary-on-page')
    expect(brandRow.querySelector('[data-band="aaNormal"][data-pass="false"]')).not.toBeNull()
  })
  it('pair-picker recomputes the ratio when a color input changes', () => {
    render(<ContrastTester theme={DEFAULT_THEME} />)
    const fg = screen.getByTestId('pairpicker-fg') as HTMLInputElement
    const before = screen.getByTestId('pairpicker-ratio').textContent
    fireEvent.change(fg, { target: { value: '#ffffff' } })
    const after = screen.getByTestId('pairpicker-ratio').textContent
    expect(after).not.toEqual(before)
  })
})
```

- [ ] **Step 2: Verify failures** — `DATABASE_URL="file:./local-dev.db" npx vitest run components/viewbook/public/ContrastTester.test.tsx` → module not found.

- [ ] **Step 3: Implement `ContrastTester.tsx`** — a `'use client'` component. Structure:
  - Module consts `PAGE_BG`/`PAGE_TEXT` and a `ROWS` builder from `theme` producing `{ key, label, fg, bg }[]` (the 7 rows above; stable `data-testid`s: `contrast-row-body`, `contrast-row-primary-on-page`, `contrast-row-secondary-on-page`, `contrast-row-tertiary-on-page`, `contrast-row-on-primary`, `contrast-row-on-secondary`, `contrast-row-on-tertiary`).
  - A `<Row>` render: swatch (`background: bg`, sample text in `fg`), the ratio formatted `ratio.toFixed(2) + ':1'` inside `data-testid="contrast-ratio"`, and four band chips each `<span data-band={bandKey} data-pass={pass} className={pass ? passClass : failClass}>{AA/AAA · normal/large}</span>`.
  - Pair-picker: `const [fg, setFg] = useState(PAGE_TEXT); const [bg, setBg] = useState(PAGE_BG)` + two `<input type="color" data-testid="pairpicker-fg|bg">` + a computed ratio in `data-testid="pairpicker-ratio"` + its band chips.
  - Heading + short helper copy ("Contrast ratios for this theme's real color pairings, against WCAG AA/AAA."). Escape nothing dynamic here — all values are hex/labels.
  - No `fetch`, no `useEditorActivity`, no persistence. Styling: match sibling public components' Tailwind (cards `rounded-xl border border-black/10 bg-white`, small chips). Keep it accessible (labels on the color inputs, chips carry text not just color).

- [ ] **Step 4: Green** — same command, all 4 tests pass; also `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(viewbook): client-only WCAG contrast tester`

---

### Task 4: `WsIntroSection.tsx` — slim website-specifics hero

**Files:**
- Create: `components/viewbook/public/WsIntroSection.tsx`, `components/viewbook/public/WsIntroSection.test.tsx`

**Interfaces:**
- Consumes: `SectionShell`, `SECTION_TITLES`, `publicAssetUrl`, `PublicSection`/`ViewbookPublicData` types (same `{ section, data, token }` prop shape as sibling sections).
- Produces: `export function WsIntroSection({ section, data, token }: { section: PublicSection; data: ViewbookPublicData; token: string })` — a sync server component rendering a hero through the **current** `SectionShell`: title `SECTION_TITLES['ws-intro']` ('Website Specifics'), `heroUrl` from `data.theme.sectionHeroes['ws-intro']` via `publicAssetUrl` (null when absent), and a short code-owned lead paragraph as `children`.
- **Hero-size honesty (Codex fix):** the current `SectionShell` renders active sections as a full-viewport `min-h-screen` hero (`SectionShell.tsx:65`) — PR6 CANNOT produce the spec's "slim hero" through that API. PR6 **activates** the section using the current shell; the slim summary-face presentation lands with **SectionShell v2 in PR7**. Do not attempt a bespoke slim layout here.
- **No `narrative` render (Codex fix):** `ContentTab` exposes narrative editing only for `brand`/`assessment` (`ContentTab.tsx:114 showNarrative`), so `ws-intro` has no editable narrative — do NOT render `section.narrative`. `SectionShell` already renders `section.introNote` (editable via `ContentTab` for every section) above `children`, so ws-intro's editable copy path is `introNote` for free. WsIntroSection only supplies the code-owned LEAD paragraph.
- Defensive stage self-gate mirroring `KickoffNextSection` (`if (data.stage !== 'website-specifics') return null`) — the lineup already gates it; belt-and-suspenders.

- [ ] **Step 1: Write failing tests** — `WsIntroSection.test.tsx` (jsdom; a section test can render a server component directly since it returns JSX synchronously — follow how `BrandSection`/`StrategySection` tests render if present, else render like a plain component):

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WsIntroSection } from './WsIntroSection'
// build a minimal ViewbookPublicData + PublicSection via the suite's existing
// fixture helper if one exists; otherwise inline a typed literal.

// NO jest-dom in this repo — DOM-native assertions only (toBeTruthy / textContent).
const baseSection = { sectionKey: 'ws-intro', state: 'active', doneAt: null, introNote: null, narrative: null } as const

function data(stage: string) {
  return { stage, theme: { ...DEFAULT_THEME }, /* ...other required fields via fixture... */ } as any
}

describe('WsIntroSection', () => {
  it('renders the website-specifics hero title in that stage', () => {
    const { container } = render(<WsIntroSection section={{ ...baseSection }} data={data('website-specifics')} token="t" />)
    expect(container.textContent).toContain('Website Specifics')
  })
  it('renders the code-owned lead paragraph', () => {
    const { container } = render(<WsIntroSection section={{ ...baseSection }} data={data('website-specifics')} token="t" />)
    expect(container.textContent).toMatch(/look and feel/i)
  })
  it('returns null outside website-specifics (defensive gate)', () => {
    const { container } = render(<WsIntroSection section={{ ...baseSection }} data={data('building')} token="t" />)
    expect(container.firstChild).toBeNull()
  })
})
```

Read a sibling section test first (`SectionShell.test.tsx`) to reuse the exact fixture-construction pattern for `ViewbookPublicData` — do not hand-roll required fields wrongly. (`section.introNote` rendering is `SectionShell`'s contract, already tested there — WsIntroSection does not re-test it.)

- [ ] **Step 2: Verify failures** — `DATABASE_URL="file:./local-dev.db" npx vitest run components/viewbook/public/WsIntroSection.test.tsx`.

- [ ] **Step 3: Implement `WsIntroSection.tsx`** — mirror the simplest existing section's shape:

```tsx
import type { ReactNode } from 'react'
import { SectionShell } from './SectionShell'
import { publicAssetUrl } from './ThemeStyle'
import { SECTION_TITLES } from './section-titles'
import type { PublicSection } from '@/lib/viewbook/public-types'
import type { ViewbookPublicData } from '@/lib/viewbook/public-types'

const LEAD =
  "Now we dial in the look and feel of your site — your brand palette, typography, and the accessibility bar every page has to clear."

export function WsIntroSection({ section, data, token }: {
  section: PublicSection
  data: ViewbookPublicData
  token: string
}): ReactNode {
  if (data.stage !== 'website-specifics') return null
  const hero = data.theme.sectionHeroes['ws-intro']
  return (
    <SectionShell
      section={section}
      title={SECTION_TITLES['ws-intro']}
      heroUrl={hero ? publicAssetUrl(token, hero) : null}
    >
      {/* SectionShell renders section.introNote above these children automatically.
          ws-intro has no narrative editor (ContentTab showNarrative is brand/assessment
          only) — do NOT render section.narrative here. */}
      <p className="text-lg text-black/70" style={{ fontFamily: 'var(--vb-body-font)' }}>{LEAD}</p>
    </SectionShell>
  )
}
```

Verify the exact `PublicSection`/`ViewbookPublicData` import paths against `public-types.ts` before finalizing.

- [ ] **Step 4: Green** — same command; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(viewbook): ws-intro slim hero section`

---

### Task 5: Activate `ws-intro` + mount the tester in BrandSection

**Files:**
- Modify: `lib/viewbook/stages.ts:39-42` (prepend `ws-intro` to `website-specifics.primary`), `lib/viewbook/stages.test.ts` (unpin: allowed-key set gains `ws-intro`), `app/(public)/viewbook/[token]/page.tsx` (import + `case 'ws-intro'`), `components/viewbook/public/BrandSection.tsx` (render `<ContrastTester theme={data.theme} />`)
- Test: `components/viewbook/public/BrandSection.test.tsx` (if present — assert the tester renders), `lib/viewbook/stages.test.ts`

**Interfaces:** consumes Tasks 3 + 4; no signature changes.

- [ ] **Step 1: Failing tests**
  - `stages.test.ts`: the lineup should now include `ws-intro` in `website-specifics.primary` as the FIRST entry, and the "lineups contain only keys with shipped renderers" pin (unpinned in PR4 to allow `kickoff-next`) now also allows `ws-intro`. Assert `STAGE_LINEUPS['website-specifics'].primary` equals `['ws-intro', 'brand', 'assessment']`.
  - `BrandSection.test.tsx` (extend if it exists; else add): rendering `BrandSection` includes the contrast tester (query a stable marker from Task 3, e.g. `getAllByTestId('contrast-ratio')` non-empty). If no BrandSection test exists, add a minimal one using the suite's fixture pattern.
- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement**
  - `stages.ts`: `'website-specifics': { primary: ['ws-intro', 'brand', 'assessment'], carried: ['welcome', 'milestones', 'strategy', 'data-source'] }` (carried UNCHANGED — pc-setup/pc-invite are PR5).
  - `stages.test.ts`: update the allowed-renderer-key set comment + assertion to include `ws-intro` (deliberate unpin — note it in the test comment, mirroring PR4's `kickoff-next` unpin).
  - `page.tsx`: `import { WsIntroSection } from '@/components/viewbook/public/WsIntroSection'` (match the file's import style) and add `case 'ws-intro': return <WsIntroSection {...props} />` to the `renderSection` switch (before `default`).
  - `BrandSection.tsx`: after the palette + typography specimens (and before/after the optional design-philosophy narrative — place it as its own labeled block), render `<ContrastTester theme={data.theme} />`. `ContrastTester` is a client component; `BrandSection` is a server component rendering it as a child (passing the plain `theme` object) — allowed.
- [ ] **Step 4: Green** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook components/viewbook app/api/viewbook app/api/viewbooks` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(viewbook): activate ws-intro lineup + brand-section contrast tester`

---

### Task 6: Gates, sync-bump audit, cross-review, merge

- [ ] **Step 1: Sync-bump audit** — grep the branch diff for any new `prisma.$transaction` / `updateMany` / `create` / `$executeRaw` write of viewbook-rendered data. Expected result: **none** (tester is client-only, ws-intro reads only). Record the audit line in the SDD ledger: "PR6 sync-bump audit: 0 new rendered-data mutations — merge gate vacuously satisfied." If ANY write snuck in, it must adopt `syncVersionBumpStatement()`/variants + relative-delta bump/no-bump tests before proceeding.
- [ ] **Step 2: Full gates in the worktree** — `npx tsc --noEmit` && `npm run lint` && `DATABASE_URL="file:./local-dev.db" npm test` && `npm run build` (run test suites exclusively — never concurrently in one worktree).
- [ ] **Step 3: Reviews** — final whole-branch review (fable, most-capable) + `codex exec review --base <pre-work branch HEAD>` (P1). Fix Critical/Important + valid findings; re-gate.
- [ ] **Step 4: Merge** — PR `Viewbook v2 PR6 — website-specifics`, merge on green. Wave 3 also requires the Codex-lane PR3 to land; either order (lanes are disjoint — no rebase-integration duty this wave).

## Self-review notes (spec §7/§9 coverage)

- §9 WCAG tester → Tasks 1 (contrast.ts, 0.04045, bands) + 3 (matrix of real pairings + free pair-picker, visible to everyone, live via `theme` prop). ✓
- §9 "one shared luminance impl" → Task 2 (theme.ts refactors onto `relativeLuminance`). ✓
- §7 ws-intro hero → Task 4 + Task 5 activation, rendered through the CURRENT SectionShell (full-viewport). The spec's "slim hero" presentation is delivered by SectionShell v2 in **PR7** — PR6 only activates the section (Codex fix). ✓ (deferral)
- §7 "assessment placement" → already in lineup; Task 5 keeps it after brand (final lineup `ws-intro, brand, assessment`). ✓
- §9 image/webp pipeline + PDF docs → **NOT this PR** (image pipeline is PR7; PDF docs shipped in PR4). Out of scope.
- SectionShell v2 (summary face / scroll expand) → **PR7**, not here. `WsIntroSection` uses the current SectionShell contract as-is.

## Out of scope (do NOT touch)

Image/webp/sharp pipeline (PR7) · SectionShell v2 redesign (PR7) · inline theme editor / ER operator layer (PR8) · email / CSM / roster (PR3, the concurrent lane — do not touch `service.ts`, `global-content.ts`, `WelcomeSection.tsx`, `lib/notify/**`) · `middleware.ts` · prisma schema · pc-* section keys/lineup entries (PR5).
