# Viewbook Viewer Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two light-only viewbook public-viewer features — (A) replace the per-section "What this is / What we need" panel with a company-wide-editable, per-viewbook-overridable ⓘ info-tooltip beside each section heading, and (B) a floating hamburger that fully hides the desktop ToC rail (device-local, default expanded).

**Architecture:** Feature A reuses the existing `ViewbookGlobalContent` + `ViewbookContentOverride` tables under a reserved `section-copy:<sectionKey>` key namespace (no migration); a new `lib/viewbook/section-copy-content.ts` owns validate/resolve/store, `public-data.ts` resolves the three-layer copy (code default ← company-wide ← per-viewbook) into `ViewbookPublicData.sectionCopy`, and `SectionShell` renders it in an ⓘ tooltip. Feature B adds a `useTocHidden` localStorage hook and a persistent hamburger in `TocRail`, retiring the dormant `DESKTOP_RAIL_COLLAPSIBLE` shrink path.

**Tech Stack:** Next.js 15 App Router (RSC), TypeScript, Prisma + SQLite, Tailwind (light-only for the public viewer), vitest + @testing-library/react.

## Global Constraints

- **Light-only** public viewer: NO `dark:` classes anywhere in `components/viewbook/public/*`; color via `--vb-*` CSS vars only.
- **Tests:** `// @vitest-environment jsdom` pragma on **line 1** of any React/DOM test; **NO jest-dom** — DOM-native assertions only (`container.textContent`, `getAttribute`, `querySelector`). `lib/` and route tests use the default node env (no pragma).
- **RSC boundary:** `'use client'` islands take only serializable props — never a function prop across the Server→Client boundary. `SectionShell` and `public-data.ts` stay server-side.
- **DB writes:** array-form `$transaction([...])` only — NEVER `prisma.$transaction(async tx => …)`. Content writes bump `syncVersion` (`syncVersionBumpAllStatement` global, `syncVersionBumpStatement(viewbookId)` per-viewbook), mirroring `lib/viewbook/global-content.ts`.
- **Routes:** wrap handlers in `withRoute`; parse bodies with `parseJsonBody`; operator-gate with `requireOperatorEmail`. New routes under `/api/viewbooks/*` need NO middleware/`isPublicPath` change (cookie-gated by omission).
- **Gates per task:** `npx tsc --noEmit` + the task's scoped `npx vitest run <file>`. Full `npx vitest run` + `npm run build` before each PR.
- **Section catalog:** `SECTION_KEYS` / `type SectionKey` from `lib/viewbook/theme.ts` (13 keys). `SECTION_COPY` (code default) + `INPUT_EXPECTING_KEYS` + `cta` stay code-owned in `lib/viewbook/section-copy.ts`.

**Working branch:** `feat/vb-viewer-polish` (worktree `.claude/worktrees/vb-viewer-polish`, off `origin/main`).
**PR split:** Tasks 1–2 = **PR 1 (Feature B)**, ship first (no schema, no content-write, `/codex-review` optional). Tasks 3–11 = **PR 2 (Feature A)**, `/codex-review` P1 before merge (content-write path).

---

# PR 1 — Feature B: ToC hide toggle

### Task 1: `useTocHidden` device-local hook

**Files:**
- Create: `components/viewbook/public/useTocHidden.ts`
- Test: `components/viewbook/public/useTocHidden.test.tsx`

**Interfaces:**
- Produces: `useTocHidden(): { hidden: boolean; ready: boolean; show(): void; hide(): void; toggle(): void }`. Device-global localStorage key `vb:toc-hidden` (`'true'` = hidden). SSR-safe default `hidden=false` (expanded); reconciled in a mount effect. Mirrors `useCollapseState.ts` conventions (no `window`/`localStorage` read during render).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { renderHook, act, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { useTocHidden, TOC_HIDDEN_KEY } from './useTocHidden'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

describe('useTocHidden', () => {
  it('defaults to expanded (hidden=false) and becomes ready after mount', () => {
    const { result } = renderHook(() => useTocHidden())
    expect(result.current.hidden).toBe(false)
    expect(result.current.ready).toBe(true)
  })

  it('reconciles hidden=true from localStorage on mount', () => {
    localStorage.setItem(TOC_HIDDEN_KEY, 'true')
    const { result } = renderHook(() => useTocHidden())
    expect(result.current.hidden).toBe(true)
  })

  it('hide()/show()/toggle() persist to localStorage', () => {
    const { result } = renderHook(() => useTocHidden())
    act(() => result.current.hide())
    expect(result.current.hidden).toBe(true)
    expect(localStorage.getItem(TOC_HIDDEN_KEY)).toBe('true')
    act(() => result.current.show())
    expect(result.current.hidden).toBe(false)
    expect(localStorage.getItem(TOC_HIDDEN_KEY)).toBe('false')
    act(() => result.current.toggle())
    expect(result.current.hidden).toBe(true)
  })

  it('tolerates unavailable localStorage without throwing', () => {
    const orig = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
    try {
      const { result } = renderHook(() => useTocHidden())
      act(() => result.current.hide())
      expect(result.current.hidden).toBe(true) // in-memory state still applies
    } finally {
      if (orig) Object.defineProperty(window, 'localStorage', orig)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/viewbook/public/useTocHidden.test.tsx`
Expected: FAIL — `useTocHidden` / `TOC_HIDDEN_KEY` not exported.

- [ ] **Step 3: Write the hook**

```tsx
'use client'

// Device-global ToC visibility (Feature B). Purely local, per-machine — one
// localStorage key for all viewbooks on this browser. Default = expanded
// (hidden=false). Mirrors useCollapseState's SSR-safe reconcile pattern: no
// window/localStorage read during render; a mount effect reconciles.
import { useCallback, useEffect, useState } from 'react'

export const TOC_HIDDEN_KEY = 'vb:toc-hidden'

function readHidden(): boolean {
  try {
    return localStorage.getItem(TOC_HIDDEN_KEY) === 'true'
  } catch {
    return false
  }
}

function writeHidden(value: boolean): void {
  try {
    localStorage.setItem(TOC_HIDDEN_KEY, value ? 'true' : 'false')
  } catch {
    // localStorage unavailable (private mode etc) — in-memory state still applies.
  }
}

export function useTocHidden() {
  // SSR-safe seed: expanded on server + first client paint (no storage read
  // during render); the mount effect reconciles immediately after.
  const [hidden, setHidden] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setHidden(readHidden())
    setReady(true)
  }, [])

  const hide = useCallback(() => { setHidden(true); writeHidden(true) }, [])
  const show = useCallback(() => { setHidden(false); writeHidden(false) }, [])
  const toggle = useCallback(() => {
    setHidden((h) => { const next = !h; writeHidden(next); return next })
  }, [])

  return { hidden, ready, show, hide, toggle }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/viewbook/public/useTocHidden.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/useTocHidden.ts components/viewbook/public/useTocHidden.test.tsx
git commit -m "feat(viewbook): useTocHidden device-local hook (Feature B)"
```

---

### Task 2: TocRail hamburger — full hide + retire DESKTOP_RAIL_COLLAPSIBLE

**Files:**
- Modify: `components/viewbook/public/TocRail.tsx`
- Test: `components/viewbook/public/TocRail.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `useTocHidden` (Task 1).
- Behavior: desktop branch renders an always-visible circular hamburger (☰). Default expanded = hamburger + rail `<nav>` card. Toggling `hidden` removes the rail `<nav>` from the DOM (complete hide); the hamburger stays. Mobile branch (FAB + bottom-sheet, `< 768px`) unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { render, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { TocRail } from './TocRail'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

const toc = [
  { sectionKey: 'welcome', label: 'Welcome', anchor: '#welcome', done: false, acked: false, children: [] },
  { sectionKey: 'brand', label: 'Brand', anchor: '#brand', done: true, acked: false, children: [] },
] as any

describe('TocRail desktop hide toggle', () => {
  it('renders the rail nav expanded by default with an always-present hamburger', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={[]} verbose={false} />)
    expect(container.querySelector('[data-vb-toc-hamburger]')).not.toBeNull()
    const nav = container.querySelector('[data-vb-toc-nav]')
    expect(nav).not.toBeNull()
    // hamburger reflects expanded state + controls the mounted nav
    const btn = container.querySelector('[data-vb-toc-hamburger]')!
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('aria-controls')).toBe(nav!.getAttribute('id'))
  })

  it('hiding removes the rail nav from the DOM; hamburger stays and drops aria-controls', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={[]} verbose={false} />)
    const btn = container.querySelector('[data-vb-toc-hamburger]')!
    fireEvent.click(btn)
    expect(container.querySelector('[data-vb-toc-nav]')).toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-controls')).toBeNull()
  })

  it('re-showing restores the rail nav', () => {
    const { container } = render(<TocRail toc={toc} searchIndex={[]} verbose={false} />)
    const btn = container.querySelector('[data-vb-toc-hamburger]')!
    fireEvent.click(btn) // hide
    fireEvent.click(btn) // show
    expect(container.querySelector('[data-vb-toc-nav]')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/viewbook/public/TocRail.test.tsx`
Expected: FAIL — no `[data-vb-toc-hamburger]` element.

- [ ] **Step 3: Edit `TocRail.tsx` — desktop branch**

Remove the `DESKTOP_RAIL_COLLAPSIBLE` const, its 40px-width branch, the `onFocus`-forces-open hook, and the desktop `Escape`-collapse logic. Replace the desktop `return (...)` block (the `// ---- Desktop: right-edge rail ----` section) with:

```tsx
  // ---- Desktop: hamburger + hideable rail ----------------------------------
  const railId = 'vb-toc-rail'
  return (
    <>
      <style>{RAIL_STYLE}</style>
      {/* Always-visible hamburger. max-md:hidden guards the pre-effect window
          where isMobile is still false on a phone (SSR renders desktop). */}
      <button
        type="button"
        ref={triggerRef}
        data-vb-toc-hamburger
        aria-label={hidden ? 'Show section navigation' : 'Hide section navigation'}
        aria-expanded={!hidden}
        {...(hidden ? {} : { 'aria-controls': railId })}
        onClick={toggle}
        className="fixed left-3 top-1/2 z-50 -mt-24 flex h-9 w-9 max-md:hidden items-center justify-center rounded-full border border-black/10 bg-white/95 shadow-md backdrop-blur"
        style={{ color: 'var(--vb-primary)' }}
      >
        <span aria-hidden className="text-base font-bold">☰</span>
      </button>
      {!hidden && (
        <nav
          ref={railRef}
          id={railId}
          data-vb-toc-nav
          aria-label="Section navigation"
          onKeyDown={onListKeyDown}
          className="fixed left-3 top-1/2 z-40 -translate-y-1/2 max-md:hidden"
        >
          <div
            className="rounded-xl border border-black/10 bg-white/95 p-2 shadow-lg backdrop-blur"
            style={{ width: 240 }}
          >
            {searchBox}
            {itemList}
          </div>
        </nav>
      )}
    </>
  )
```

Add near the other hooks at the top of `TocRail`:

```tsx
  const { hidden, toggle } = useTocHidden()
```

Add the import:

```tsx
import { useTocHidden } from './useTocHidden'
```

After showing the rail, move focus to the first entry. Add this effect (guard on `!hidden` and desktop):

```tsx
  // Focus the first rail entry when the rail is (re)shown on desktop.
  const prevHiddenRef = useRef(true)
  useEffect(() => {
    if (!isMobile && prevHiddenRef.current && !hidden) {
      itemRefs.current[0]?.focus()
    }
    prevHiddenRef.current = hidden
  }, [hidden, isMobile])
```

> Keep the existing `triggerRef`/`railRef` refs. `-mt-24` places the hamburger above the vertically-centered rail card ("above the ToC"). Preserve the current LEFT side (`left-3`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/viewbook/public/TocRail.test.tsx`
Expected: PASS (3 tests). Also run `npx tsc --noEmit` (expect clean — the removed `DESKTOP_RAIL_COLLAPSIBLE` has no other referencers; grep to confirm: `grep -rn DESKTOP_RAIL_COLLAPSIBLE components lib app` → no matches).

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/TocRail.tsx components/viewbook/public/TocRail.test.tsx
git commit -m "feat(viewbook): floating hamburger fully hides desktop ToC rail (Feature B)"
```

**PR 1 gate:** `npx tsc --noEmit && npx vitest run && npm run build`. Open PR. `/codex-review` optional (client-only). Deploy + browser-eyeball: hamburger hides/shows the rail; persisted-hidden reload shows the brief rail flash (acceptable, no CLS); mobile FAB unchanged.

---

# PR 2 — Feature A: section info-tooltips

### Task 3: `section-copy-content.ts` — validate / resolve / store

**Files:**
- Create: `lib/viewbook/section-copy-content.ts`
- Test: `lib/viewbook/section-copy-content.test.ts`

**Interfaces:**
- Produces:
  - `type SectionCopyContent = { purpose: string; whatThis: string; whatWeNeed: string | null }`
  - `type ResolvedSectionCopy = SectionCopyContent` (always fully populated)
  - `sectionCopyKey(sectionKey: SectionKey): string` → `` `section-copy:${sectionKey}` ``
  - `validateSectionCopy(raw: unknown): SectionCopyContent | null` (empty `whatWeNeed` → `null`)
  - `resolveSectionCopy(sectionKey, companyWide: SectionCopyContent | null, override: SectionCopyContent | null): ResolvedSectionCopy`
  - `getSectionCopyGlobalMap(): Promise<Partial<Record<SectionKey, SectionCopyContent>>>` (one `findMany`)
  - `getSectionCopyOverrideMap(viewbookId): Promise<Partial<Record<SectionKey, SectionCopyContent>>>` (one `findMany`)
  - `putSectionCopyGlobal(sectionKey, raw, updatedBy)`, `deleteSectionCopyGlobal(sectionKey)`
  - `putSectionCopyOverride(viewbookId, sectionKey, raw, updatedBy)`, `deleteSectionCopyOverride(viewbookId, sectionKey)`
- Consumes: `SECTION_COPY` (code default) + `SECTION_KEYS`/`SectionKey` from `theme.ts`; `prisma`; `HttpError`; sync helpers from `lib/viewbook/sync.ts`.

- [ ] **Step 1: Write the failing test (pure logic)**

```ts
import { describe, it, expect } from 'vitest'
import { validateSectionCopy, resolveSectionCopy, sectionCopyKey } from './section-copy-content'
import { SECTION_COPY } from './section-copy'

describe('sectionCopyKey', () => {
  it('namespaces the section key', () => {
    expect(sectionCopyKey('brand')).toBe('section-copy:brand')
  })
})

describe('validateSectionCopy', () => {
  it('accepts a well-formed object and normalizes empty whatWeNeed to null', () => {
    expect(validateSectionCopy({ purpose: 'p', whatThis: 't', whatWeNeed: '' }))
      .toEqual({ purpose: 'p', whatThis: 't', whatWeNeed: null })
    expect(validateSectionCopy({ purpose: 'p', whatThis: 't', whatWeNeed: '  ' })!.whatWeNeed).toBeNull()
    expect(validateSectionCopy({ purpose: 'p', whatThis: 't', whatWeNeed: 'need' })!.whatWeNeed).toBe('need')
  })
  it('rejects missing/extra fields, wrong types, and over-cap', () => {
    expect(validateSectionCopy({ purpose: 'p', whatThis: 't' })).toBeNull()
    expect(validateSectionCopy({ purpose: 'p', whatThis: 't', whatWeNeed: null, extra: 1 })).toBeNull()
    expect(validateSectionCopy({ purpose: 1, whatThis: 't', whatWeNeed: null })).toBeNull()
    expect(validateSectionCopy({ purpose: 'p', whatThis: 'x'.repeat(601), whatWeNeed: null })).toBeNull()
    expect(validateSectionCopy(null)).toBeNull()
    expect(validateSectionCopy('nope')).toBeNull()
  })
  it('requires purpose and whatThis to be non-empty', () => {
    expect(validateSectionCopy({ purpose: '', whatThis: 't', whatWeNeed: null })).toBeNull()
    expect(validateSectionCopy({ purpose: 'p', whatThis: '', whatWeNeed: null })).toBeNull()
  })
})

describe('resolveSectionCopy (3-layer, whole-object per layer)', () => {
  const code = SECTION_COPY['brand'] // { purpose, whatThis, whatWeNeed }
  it('falls back to the code default when both layers absent', () => {
    const r = resolveSectionCopy('brand', null, null)
    expect(r).toEqual({ purpose: code.purpose, whatThis: code.whatThis, whatWeNeed: code.whatWeNeed })
  })
  it('company-wide wins over code default', () => {
    const cw = { purpose: 'CW p', whatThis: 'CW t', whatWeNeed: null }
    expect(resolveSectionCopy('brand', cw, null)).toEqual(cw)
  })
  it('per-viewbook override wins over company-wide', () => {
    const cw = { purpose: 'CW p', whatThis: 'CW t', whatWeNeed: 'cw' }
    const ov = { purpose: 'OV p', whatThis: 'OV t', whatWeNeed: null }
    expect(resolveSectionCopy('brand', cw, ov)).toEqual(ov)
  })
  it('an ABSENT override (null, e.g. invalidated upstream) falls through to company-wide, not code default', () => {
    const cw = { purpose: 'CW p', whatThis: 'CW t', whatWeNeed: 'cw' }
    expect(resolveSectionCopy('brand', cw, null)).toEqual(cw)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/viewbook/section-copy-content.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// Company-wide + per-viewbook section copy (spec Feature A). Reuses the
// existing ViewbookGlobalContent / ViewbookContentOverride tables under a
// reserved `section-copy:<sectionKey>` key namespace — NO migration. Mirrors
// lib/viewbook/global-content.ts conventions: strict whole-doc validation
// (read exactly as strict as write; corrupt rows read null, never throw);
// every write bumps syncVersion inside the same $transaction. Server-only.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { SECTION_KEYS, type SectionKey } from './theme'
import { SECTION_COPY } from './section-copy'
import {
  syncVersionBumpAllStatement, syncVersionBumpAllWhere,
  syncVersionBumpStatement, syncVersionBumpWhere,
} from './sync'

export interface SectionCopyContent {
  purpose: string
  whatThis: string
  whatWeNeed: string | null
}
export type ResolvedSectionCopy = SectionCopyContent

const CAPS = { purpose: 240, whatThis: 600, whatWeNeed: 600 }
const NS = 'section-copy:'

export function sectionCopyKey(sectionKey: SectionKey): string {
  return `${NS}${sectionKey}`
}

function isSectionKey(key: string): key is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(key)
}

// Suffix-validate a stored key back to a SectionKey (null if off-catalog).
function sectionKeyFromStored(key: string): SectionKey | null {
  if (!key.startsWith(NS)) return null
  const suffix = key.slice(NS.length)
  return isSectionKey(suffix) ? suffix : null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

export function validateSectionCopy(raw: unknown): SectionCopyContent | null {
  if (!isPlainObject(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length !== 3) return null
  const { purpose, whatThis, whatWeNeed } = raw
  if (typeof purpose !== 'string' || purpose.trim().length === 0 || purpose.length > CAPS.purpose) return null
  if (typeof whatThis !== 'string' || whatThis.trim().length === 0 || whatThis.length > CAPS.whatThis) return null
  if (whatWeNeed !== null && typeof whatWeNeed !== 'string') return null
  if (typeof whatWeNeed === 'string' && whatWeNeed.length > CAPS.whatWeNeed) return null
  const normalizedNeed = typeof whatWeNeed === 'string' && whatWeNeed.trim().length > 0 ? whatWeNeed : null
  return { purpose, whatThis, whatWeNeed: normalizedNeed }
}

// Whole-object per layer: per-viewbook override ← company-wide ← code default.
// Each layer already `validateSectionCopy`-filtered to null-on-invalid by the
// caller, so an invalid override arrives here as null and falls through.
export function resolveSectionCopy(
  sectionKey: SectionKey,
  companyWide: SectionCopyContent | null,
  override: SectionCopyContent | null,
): ResolvedSectionCopy {
  if (override) return override
  if (companyWide) return companyWide
  const code = SECTION_COPY[sectionKey]
  return { purpose: code.purpose, whatThis: code.whatThis, whatWeNeed: code.whatWeNeed }
}

function parseRow(bodyJson: string): SectionCopyContent | null {
  try { return validateSectionCopy(JSON.parse(bodyJson)) } catch { return null }
}

// ---- reads (one findMany each, exact key set — never startsWith) ----------
export async function getSectionCopyGlobalMap(): Promise<Partial<Record<SectionKey, SectionCopyContent>>> {
  const rows = await prisma.viewbookGlobalContent.findMany({
    where: { key: { in: SECTION_KEYS.map(sectionCopyKey) } },
  })
  const out: Partial<Record<SectionKey, SectionCopyContent>> = {}
  for (const r of rows) {
    const sk = sectionKeyFromStored(r.key)
    if (!sk) continue
    const v = parseRow(r.bodyJson)
    if (v) out[sk] = v
  }
  return out
}

export async function getSectionCopyOverrideMap(viewbookId: number): Promise<Partial<Record<SectionKey, SectionCopyContent>>> {
  const rows = await prisma.viewbookContentOverride.findMany({
    where: { viewbookId, contentKey: { in: SECTION_KEYS.map(sectionCopyKey) } },
  })
  const out: Partial<Record<SectionKey, SectionCopyContent>> = {}
  for (const r of rows) {
    const sk = sectionKeyFromStored(r.contentKey)
    if (!sk) continue
    const v = parseRow(r.body)
    if (v) out[sk] = v
  }
  return out
}

// ---- writes (bump inside the same txn; delete = EXISTS-fenced, 404 on 0) ---
export async function putSectionCopyGlobal(sectionKey: string, raw: unknown, updatedBy: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const validated = validateSectionCopy(raw)
  if (!validated) throw new HttpError(400, 'invalid_content')
  const key = sectionCopyKey(sectionKey)
  const bodyJson = JSON.stringify(validated)
  await prisma.$transaction([
    prisma.viewbookGlobalContent.upsert({
      where: { key },
      update: { bodyJson, updatedBy },
      create: { key, bodyJson, updatedBy },
    }),
    syncVersionBumpAllStatement(),
  ])
}

export async function deleteSectionCopyGlobal(sectionKey: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const key = sectionCopyKey(sectionKey)
  const fence = Prisma.sql`EXISTS (SELECT 1 FROM "ViewbookGlobalContent" WHERE "key" = ${key})`
  const [, res] = await prisma.$transaction([
    syncVersionBumpAllWhere(fence),
    prisma.viewbookGlobalContent.deleteMany({ where: { key } }),
  ])
  if (res.count === 0) throw new HttpError(404, 'not_found')
}

export async function putSectionCopyOverride(viewbookId: number, sectionKey: string, raw: unknown, updatedBy: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const validated = validateSectionCopy(raw)
  if (!validated) throw new HttpError(400, 'invalid_content')
  const vb = await prisma.viewbook.findUnique({ where: { id: viewbookId }, select: { id: true } })
  if (!vb) throw new HttpError(404, 'not_found')
  const contentKey = sectionCopyKey(sectionKey)
  const body = JSON.stringify(validated)
  await prisma.$transaction([
    prisma.viewbookContentOverride.upsert({
      where: { viewbookId_contentKey: { viewbookId, contentKey } },
      update: { body, updatedBy },
      create: { viewbookId, contentKey, body, updatedBy },
    }),
    syncVersionBumpStatement(viewbookId),
  ])
}

export async function deleteSectionCopyOverride(viewbookId: number, sectionKey: string): Promise<void> {
  if (!isSectionKey(sectionKey)) throw new HttpError(400, 'invalid_content')
  const contentKey = sectionCopyKey(sectionKey)
  const fence = Prisma.sql`EXISTS (
    SELECT 1 FROM "ViewbookContentOverride" WHERE "viewbookId" = ${viewbookId} AND "contentKey" = ${contentKey}
  )`
  const [, res] = await prisma.$transaction([
    syncVersionBumpWhere(viewbookId, fence),
    prisma.viewbookContentOverride.deleteMany({ where: { viewbookId, contentKey } }),
  ])
  if (res.count === 0) throw new HttpError(404, 'not_found')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/viewbook/section-copy-content.test.ts`
Expected: PASS. Run `npx tsc --noEmit` (clean).

- [ ] **Step 5: Commit**

```bash
git add lib/viewbook/section-copy-content.ts lib/viewbook/section-copy-content.test.ts
git commit -m "feat(viewbook): section-copy content store + 3-layer resolver (Feature A)"
```

---

### Task 4: Widen `Tooltip` to a ReactNode label + on-primary tone

**Files:**
- Modify: `components/viewbook/public/Tooltip.tsx`
- Test: `components/viewbook/public/Tooltip.test.tsx` (create)

**Interfaces:**
- Produces: `Tooltip({ label: ReactNode; id: string; tone?: 'default' | 'on-primary'; children?: ReactNode })`. `label` widened from `string` → `ReactNode`. `tone='on-primary'` renders the default ⓘ glyph in white (for use over the hero); `tone='default'` keeps `text-black/40`. Trigger stays focusable + `aria-describedby`-wired.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(cleanup)

describe('Tooltip', () => {
  it('renders a ReactNode label and wires aria-describedby to the tooltip id', () => {
    const { container } = render(
      <Tooltip id="tip-1" label={<div><p>What this is</p><p>Detail</p></div>} />
    )
    const trigger = container.querySelector('[aria-describedby="tip-1"]')
    expect(trigger).not.toBeNull()
    expect(trigger!.getAttribute('tabindex')).toBe('0')
    const tip = container.querySelector('#tip-1[role="tooltip"]')
    expect(tip).not.toBeNull()
    expect(tip!.textContent).toContain('What this is')
    expect(tip!.textContent).toContain('Detail')
  })

  it('on-primary tone renders the default glyph in white', () => {
    const { container } = render(<Tooltip id="tip-2" label="x" tone="on-primary" />)
    const trigger = container.querySelector('[aria-describedby="tip-2"]')!
    expect(trigger.className).toContain('text-white')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/viewbook/public/Tooltip.test.tsx`
Expected: FAIL — `tone` prop unsupported / white class absent.

- [ ] **Step 3: Edit `Tooltip.tsx`**

```tsx
// PR5 (spec §8): pure-CSS tooltip, server component. Reveal on hover OR
// keyboard focus; no JS. The trigger is ALWAYS focusable + aria-describedby-
// wired so callers can't ship a mouse-only tooltip. `label` accepts a
// ReactNode (Feature A needs a multi-line What-this-is/What-we-need body).
import type { ReactNode } from 'react'

export function Tooltip({
  label,
  id,
  children,
  tone = 'default',
}: {
  label: ReactNode
  id: string
  children?: ReactNode
  tone?: 'default' | 'on-primary'
}) {
  const glyphTone = tone === 'on-primary' ? 'text-white/90' : 'text-black/40'
  return (
    <span className="group relative inline-flex items-center">
      <span
        tabIndex={0}
        aria-describedby={id}
        className={
          children
            ? 'cursor-help outline-offset-2'
            : `cursor-help select-none text-sm ${glyphTone} outline-offset-2`
        }
      >
        {children ?? 'ⓘ'}
      </span>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-lg bg-black/85 px-3 py-2 text-xs font-normal text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/viewbook/public/Tooltip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/Tooltip.tsx components/viewbook/public/Tooltip.test.tsx
git commit -m "feat(viewbook): Tooltip accepts ReactNode label + on-primary tone (Feature A)"
```

---

### Task 5: Relocate `StatusPill` out of `SectionSummaryPanel`

**Files:**
- Create: `components/viewbook/public/StatusPill.tsx` (moved `StatusPill` + `SectionStatus` STATUS_LABEL logic)
- Modify: `components/viewbook/public/SectionShell.tsx`, `components/viewbook/public/StageOverview.tsx`, `components/viewbook/public/PreviousStages.tsx` (import from `./StatusPill`)
- Test: `components/viewbook/public/StatusPill.test.tsx` (create — moved from the panel test's StatusPill case)

**Interfaces:**
- Produces: `StatusPill({ status: SectionStatus })` from `./StatusPill` (identical output to today's).

- [ ] **Step 1: Create `StatusPill.tsx`** — move the `STATUS_LABEL` map + `StatusPill` function verbatim from `SectionSummaryPanel.tsx`:

```tsx
// The viewbook-public section StatusPill (distinct from components/ui/StatusPill).
// Visible TEXT label always present — status is never conveyed by color alone.
// LIGHT-ONLY (color via --vb-*). Relocated out of SectionSummaryPanel (removed
// in Feature A) since StageOverview / PreviousStages / the chapter header still
// consume it.
import type { SectionStatus } from '@/lib/viewbook/section-status'

const STATUS_LABEL: Record<SectionStatus, string> = {
  complete: 'Complete',
  current: 'Current',
  upcoming: 'Upcoming',
  'needs-input': 'Needs input',
}

export function StatusPill({ status }: { status: SectionStatus }) {
  const filled = status === 'complete' || status === 'needs-input'
  const bg = status === 'complete' ? 'var(--vb-secondary)' : status === 'needs-input' ? 'var(--vb-primary)' : 'transparent'
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
```

- [ ] **Step 2: Create `StatusPill.test.tsx`**

```tsx
// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { StatusPill } from './StatusPill'

afterEach(cleanup)

describe('StatusPill', () => {
  it('renders a visible text label per status (never color-alone)', () => {
    const { container } = render(<StatusPill status="needs-input" />)
    expect(container.textContent).toContain('Needs input')
    expect(container.querySelector('[data-vb-status-pill="needs-input"]')).not.toBeNull()
  })
})
```

- [ ] **Step 3: Update the three importers** — change `import { StatusPill } from './SectionSummaryPanel'` to `import { StatusPill } from './StatusPill'` in `StageOverview.tsx` and `PreviousStages.tsx`; in `SectionShell.tsx` change `import { SectionSummaryPanel, StatusPill } from './SectionSummaryPanel'` to `import { StatusPill } from './StatusPill'` (the `SectionSummaryPanel` import is removed entirely in Task 7).

- [ ] **Step 4: Run gate**

Run: `npx vitest run components/viewbook/public/StatusPill.test.tsx && npx tsc --noEmit`
Expected: PASS + clean. (`SectionSummaryPanel` still exports `StatusPill` at this point too — harmless; Task 7 deletes the panel.)

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/StatusPill.tsx components/viewbook/public/StatusPill.test.tsx components/viewbook/public/StageOverview.tsx components/viewbook/public/PreviousStages.tsx components/viewbook/public/SectionShell.tsx
git commit -m "refactor(viewbook): relocate StatusPill to its own file (Feature A prep)"
```

---

### Task 6: Thread resolved `sectionCopy` into `ViewbookPublicData`

**Files:**
- Modify: `lib/viewbook/public-types.ts` (add `sectionCopy` field), `lib/viewbook/public-data.ts` (resolve + assemble)
- Test: `lib/viewbook/public-data.section-copy.test.ts` (create) — test the resolution wiring via an exported pure helper.

**Interfaces:**
- Produces: `ViewbookPublicData.sectionCopy: Record<SectionKey, ResolvedSectionCopy>` (every catalog key present — resolved). New exported pure helper `buildSectionCopyMap(global, overrides): Record<SectionKey, ResolvedSectionCopy>` for direct unit testing.
- Consumes: `getSectionCopyGlobalMap`, `getSectionCopyOverrideMap`, `resolveSectionCopy` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildSectionCopyMap } from './public-data'
import { SECTION_COPY } from './section-copy'

describe('buildSectionCopyMap', () => {
  it('resolves every catalog key with override ← company-wide ← code default', () => {
    const global = { brand: { purpose: 'CW', whatThis: 'CWt', whatWeNeed: null } }
    const overrides = { brand: { purpose: 'OV', whatThis: 'OVt', whatWeNeed: 'need' } }
    const map = buildSectionCopyMap(global as any, overrides as any)
    expect(map.brand).toEqual({ purpose: 'OV', whatThis: 'OVt', whatWeNeed: 'need' })
    // a key with neither layer = code default
    expect(map.welcome.whatThis).toBe(SECTION_COPY.welcome.whatThis)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/viewbook/public-data.section-copy.test.ts`
Expected: FAIL — `buildSectionCopyMap` not exported.

- [ ] **Step 3: Edit `public-types.ts`** — add to `ViewbookPublicData` (near `global`/`overrides`):

```ts
import type { ResolvedSectionCopy } from './section-copy-content'
import type { SectionKey } from './theme'
// ... inside interface ViewbookPublicData:
  sectionCopy: Record<SectionKey, ResolvedSectionCopy>
```

- [ ] **Step 4: Edit `public-data.ts`** — add the pure helper + the load. Add imports:

```ts
import { SECTION_KEYS, type SectionKey } from './theme'
import {
  getSectionCopyGlobalMap, getSectionCopyOverrideMap, resolveSectionCopy,
  type ResolvedSectionCopy, type SectionCopyContent,
} from './section-copy-content'
```

Add the exported pure helper:

```ts
// Exported for direct unit testing: resolve every catalog key from the two
// already-validated maps (missing key in a map = that layer absent).
export function buildSectionCopyMap(
  global: Partial<Record<SectionKey, SectionCopyContent>>,
  overrides: Partial<Record<SectionKey, SectionCopyContent>>,
): Record<SectionKey, ResolvedSectionCopy> {
  const out = {} as Record<SectionKey, ResolvedSectionCopy>
  for (const key of SECTION_KEYS) {
    out[key] = resolveSectionCopy(key, global[key] ?? null, overrides[key] ?? null)
  }
  return out
}
```

In `loadViewbookPublicData`, add two fault-isolated loads to the existing `Promise.all` block and assemble the map:

```ts
  // ...alongside global/overrides in the Promise.all:
  const sectionCopyGlobal = await guarded('section-copy-global', () => getSectionCopyGlobalMap(), {} as Partial<Record<SectionKey, SectionCopyContent>>)
  const sectionCopyOverrides = await guarded('section-copy-overrides', () => getSectionCopyOverrideMap(vb.id), {} as Partial<Record<SectionKey, SectionCopyContent>>)
  const sectionCopy = buildSectionCopyMap(sectionCopyGlobal, sectionCopyOverrides)
```

(Prefer adding both to the existing `Promise.all([...])` array for parallelism; if simpler, the sequential `guarded` calls above are acceptable — the block is fault-isolated either way.) Add `sectionCopy` to the returned object.

- [ ] **Step 5: Run test + gate**

Run: `npx vitest run lib/viewbook/public-data.section-copy.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add lib/viewbook/public-types.ts lib/viewbook/public-data.ts lib/viewbook/public-data.section-copy.test.ts
git commit -m "feat(viewbook): resolve section copy into ViewbookPublicData.sectionCopy (Feature A)"
```

---

### Task 7: `SectionShell` — ⓘ tooltip beside the H2, remove the panel, thread copy

**Files:**
- Modify: `components/viewbook/public/SectionShell.tsx`
- Modify (callers passing the new prop): the ~13 section components + preview that render `SectionShell` — `WelcomeSection.tsx`, `BrandSection.tsx`, `StrategySection.tsx`, `AssessmentSection.tsx`, `MaterialsSection.tsx`, `MilestonesSection.tsx`, `WsIntroSection.tsx`, `KickoffNextSection.tsx`, `DataSourceSection.tsx`, `PcIntroSection.tsx`, `PcSetupSection.tsx`, `PcInviteSection.tsx`, `PcThanksSection.tsx`, `SummaryStat.tsx` (if it renders SectionShell), `ThemePreview.tsx`
- Delete: `components/viewbook/public/SectionSummaryPanel.tsx` + `components/viewbook/public/SectionSummaryPanel.test.tsx`
- Test: `components/viewbook/public/SectionShell.sectioncopy.test.tsx` (create — a focused render test for the ⓘ in both viewer modes)

**Interfaces:**
- Consumes: `ViewbookPublicData.sectionCopy[key]` (Task 6) — each caller passes `sectionCopy={data.sectionCopy[section.sectionKey]}` (ThemePreview passes `resolveSectionCopy(key, null, null)` — code default). Making the prop **required** means `tsc` flags every un-migrated caller.
- Produces: `SectionShell` renders the ⓘ tooltip (from `sectionCopy.whatThis`/`whatWeNeed`) as a **sibling of** the hero `<h2>` (continuous) or in the `headerStrip` (collapse); no more `SectionSummaryPanel`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SectionShell } from './SectionShell'

afterEach(cleanup)

const baseSection = {
  sectionKey: 'brand', state: 'active', doneAt: null, acknowledgedAt: null,
  introNote: null, narrative: null,
} as any
const copy = { purpose: 'Your brand.', whatThis: 'The logos and colors.', whatWeNeed: 'Share brand rules.' }
const meta = { heroSize: 'full', chapterNumber: 3, status: 'current', isLead: false } as any

function renderShell(viewerMode: 'continuous' | 'collapse') {
  return render(
    <SectionShell
      section={baseSection} title="Brand" heroUrl={null} stage="building"
      affordance="chevron" overlayStrength={55} isOperator={false} viewbookId={1} token="t"
      meta={meta} viewerMode={viewerMode} sectionCopy={copy}
    >
      <div>body</div>
    </SectionShell>
  )
}

describe('SectionShell section-copy tooltip', () => {
  it('continuous: renders an info-tooltip carrying whatThis + whatWeNeed, and NO summary panel', () => {
    const { container } = render(<>{renderShell('continuous')}</>)
    expect(container.querySelector('[data-vb-summary-panel]')).toBeNull()
    const tip = container.querySelector('[role="tooltip"]')
    expect(tip).not.toBeNull()
    expect(tip!.textContent).toContain('The logos and colors.')
    expect(tip!.textContent).toContain('Share brand rules.')
  })

  it('the tooltip trigger is NOT nested inside the h2 (accessible-name safety)', () => {
    const { container } = renderShell('continuous')
    const h2 = container.querySelector('h2')
    expect(h2).not.toBeNull()
    expect(h2!.querySelector('[aria-describedby]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/viewbook/public/SectionShell.sectioncopy.test.tsx`
Expected: FAIL — `sectionCopy` prop unknown / panel still present.

- [ ] **Step 3: Edit `SectionShell.tsx`**

1. Add `sectionCopy: ResolvedSectionCopy` to the props type; import the type + the `Tooltip`:

```tsx
import type { ResolvedSectionCopy } from '@/lib/viewbook/section-copy-content'
import { Tooltip } from './Tooltip'
```

2. Replace `const copy = SECTION_COPY[section.sectionKey]` with:

```tsx
  const cta = SECTION_COPY[section.sectionKey]?.cta ?? null
  const sectionCopy = props.sectionCopy // resolved: purpose / whatThis / whatWeNeed
```

(Adjust: since the component uses destructured props, add `sectionCopy` to the destructure and keep `cta` as above.)

3. Add a shared tooltip-body builder + trigger near the top of the render:

```tsx
  const infoTooltipId = `vb-info-${section.sectionKey}`
  const infoTooltipBody = (
    <span className="block space-y-1.5 text-left">
      <span className="block">
        <span className="block font-semibold uppercase tracking-wide text-white/60 text-[10px]">What this is</span>
        <span className="block">{sectionCopy.whatThis}</span>
      </span>
      {sectionCopy.whatWeNeed != null && (
        <span className="block">
          <span className="block font-semibold uppercase tracking-wide text-white/60 text-[10px]">What we need</span>
          <span className="block">{sectionCopy.whatWeNeed}</span>
        </span>
      )}
    </span>
  )
```

4. In `buildContinuousHero`, place the ⓘ as a **sibling** of the `<h2>` inside the existing bottom cluster `<div className="relative z-[3] ... items-center gap-3 ...">` — after the `<h2>` (and the `DoneBadge`), NOT inside the `<h2>`:

```tsx
          {done && <DoneBadge size="hero" />}
          <Tooltip id={infoTooltipId} label={infoTooltipBody} tone="on-primary" />
```

5. In `buildContinuousChapterHeader`, keep `sectionCopy.purpose` (was `copy.purpose`) and `cta` (was `copy.cta`):

```tsx
          <span className="min-w-0 flex-1 text-sm text-black/60">{sectionCopy.purpose}</span>
          <StatusPill status={meta.status} />
          {cta && <ChapterCtaButton {...cta} />}
```

6. In `buildContinuousBody`, **remove** the `{copy && <SectionSummaryPanel .../>}` line entirely.

7. For the collapse viewer: **remove** the `SectionSummaryPanel` block from `detailBody`, and add the ⓘ to `headerStrip` (a sibling of the `<h2><button>` heading, outside any button):

```tsx
  const headerStrip = (
    <div style={{ background: 'color-mix(in srgb, var(--vb-primary) 10%, #fafafa)' }}>
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-6 pt-5 pb-1">
        <Tooltip id={infoTooltipId} label={infoTooltipBody} />
        <div className="min-w-0 flex-1"><TickDivider /></div>
      </div>
    </div>
  )
```

8. Remove the now-unused `SectionSummaryPanel` import (keep `StatusPill` from `./StatusPill` per Task 5). Keep `SECTION_COPY` import (still used for `cta`).

- [ ] **Step 4: Update all `SectionShell` callers** — add `sectionCopy={data.sectionCopy[section.sectionKey]}` to each of the ~13 section components (they all have `data` in scope). For `ThemePreview.tsx` (no `data.sectionCopy`), pass the code default:

```tsx
import { resolveSectionCopy } from '@/lib/viewbook/section-copy-content'
// ...
sectionCopy={resolveSectionCopy(section.sectionKey, null, null)}
```

Run `npx tsc --noEmit` and fix every reported missing-prop site until clean (tsc enumerates them because the prop is required).

- [ ] **Step 5: Delete the panel + its test**

```bash
git rm components/viewbook/public/SectionSummaryPanel.tsx components/viewbook/public/SectionSummaryPanel.test.tsx
```

- [ ] **Step 6: Run tests + gate**

Run: `npx vitest run components/viewbook/public/SectionShell.sectioncopy.test.tsx && npx tsc --noEmit`
Expected: PASS + clean. Also run the broader viewbook suite: `npx vitest run components/viewbook` (expect green — StatusPill importers, StageOverview, PreviousStages unaffected).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(viewbook): section info-tooltip beside H2, retire SectionSummaryPanel (Feature A)"
```

---

### Task 8: Global section-copy operator routes

**Files:**
- Create: `app/api/viewbooks/section-copy/[sectionKey]/route.ts`
- Test: `app/api/viewbooks/section-copy/[sectionKey]/route.test.ts`

**Interfaces:**
- Produces: `PUT /api/viewbooks/section-copy/:sectionKey` (`{ purpose, whatThis, whatWeNeed }` → `putSectionCopyGlobal`) + `DELETE …` (`deleteSectionCopyGlobal`). Operator-gated, `withRoute`, `parseJsonBody`. No middleware change (cookie-gated by omission from `isPublicPath`).

- [ ] **Step 1: Write the failing test** (mirror `app/api/viewbooks/[id]/overrides/[contentKey]` route-test conventions — mock `requireOperatorEmail` + the store):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/viewbook/operator', () => ({ requireOperatorEmail: vi.fn(async () => 'op@er.com') }))
vi.mock('@/lib/viewbook/section-copy-content', () => ({
  putSectionCopyGlobal: vi.fn(async () => {}),
  deleteSectionCopyGlobal: vi.fn(async () => {}),
}))

import { PUT, DELETE } from './route'
import { putSectionCopyGlobal, deleteSectionCopyGlobal } from '@/lib/viewbook/section-copy-content'

function req(body?: unknown) {
  return new Request('http://x/api/viewbooks/section-copy/brand', {
    method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const ctx = { params: Promise.resolve({ sectionKey: 'brand' }) }

beforeEach(() => vi.clearAllMocks())

describe('PUT /api/viewbooks/section-copy/[sectionKey]', () => {
  it('validates + writes and returns ok', async () => {
    const res = await PUT(req({ purpose: 'p', whatThis: 't', whatWeNeed: null }) as any, ctx as any)
    expect(res.status).toBe(200)
    expect(putSectionCopyGlobal).toHaveBeenCalledWith('brand', { purpose: 'p', whatThis: 't', whatWeNeed: null }, 'op@er.com')
  })
  it('rejects a non-object body with 400', async () => {
    const res = await PUT(req('nope') as any, ctx as any)
    expect(res.status).toBe(400)
  })
})

describe('DELETE', () => {
  it('reverts to default', async () => {
    const res = await DELETE(req() as any, ctx as any)
    expect(res.status).toBe(200)
    expect(deleteSectionCopyGlobal).toHaveBeenCalledWith('brand')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/viewbooks/section-copy/[sectionKey]/route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write the route** (mirror `overrides/[contentKey]/route.ts`):

```ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { HttpError } from '@/lib/api/errors'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { putSectionCopyGlobal, deleteSectionCopyGlobal } from '@/lib/viewbook/section-copy-content'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ sectionKey: string }> }

export const PUT = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { sectionKey } = await params
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))
  await putSectionCopyGlobal(sectionKey, body, operator)
  return NextResponse.json({ ok: true })
})

export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const { sectionKey } = await params
  await deleteSectionCopyGlobal(sectionKey)
  return NextResponse.json({ ok: true })
})
```

> `putSectionCopyGlobal` already validates the object shape (`validateSectionCopy` → 400 `invalid_content`), so the route passes the whole body through.

- [ ] **Step 4: Run test + gate**

Run: `npx vitest run app/api/viewbooks/section-copy/[sectionKey]/route.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add "app/api/viewbooks/section-copy/[sectionKey]/route.ts" "app/api/viewbooks/section-copy/[sectionKey]/route.test.ts"
git commit -m "feat(viewbook): global section-copy operator routes (Feature A)"
```

---

### Task 9: Per-viewbook section-copy override routes

**Files:**
- Create: `app/api/viewbooks/[id]/section-copy/[sectionKey]/route.ts`
- Test: `app/api/viewbooks/[id]/section-copy/[sectionKey]/route.test.ts`

**Interfaces:**
- Produces: `PUT /api/viewbooks/:id/section-copy/:sectionKey` (`putSectionCopyOverride`) + `DELETE …` (`deleteSectionCopyOverride`). Operator-gated. Mirrors `overrides/[contentKey]/route.ts` (uses `parseId`).

- [ ] **Step 1: Write the failing test** (mirror Task 8, add `parseId` + `id` param):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/viewbook/operator', () => ({ requireOperatorEmail: vi.fn(async () => 'op@er.com') }))
vi.mock('@/lib/viewbook/section-copy-content', () => ({
  putSectionCopyOverride: vi.fn(async () => {}),
  deleteSectionCopyOverride: vi.fn(async () => {}),
}))
import { PUT, DELETE } from './route'
import { putSectionCopyOverride, deleteSectionCopyOverride } from '@/lib/viewbook/section-copy-content'

const ctx = { params: Promise.resolve({ id: '12', sectionKey: 'brand' }) }
function put(body: unknown) {
  return new Request('http://x', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}
beforeEach(() => vi.clearAllMocks())

it('PUT writes the override', async () => {
  const res = await PUT(put({ purpose: 'p', whatThis: 't', whatWeNeed: 'n' }) as any, ctx as any)
  expect(res.status).toBe(200)
  expect(putSectionCopyOverride).toHaveBeenCalledWith(12, 'brand', { purpose: 'p', whatThis: 't', whatWeNeed: 'n' }, 'op@er.com')
})
it('DELETE removes the override', async () => {
  const res = await DELETE(new Request('http://x', { method: 'DELETE' }) as any, ctx as any)
  expect(res.status).toBe(200)
  expect(deleteSectionCopyOverride).toHaveBeenCalledWith(12, 'brand')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/api/viewbooks/[id]/section-copy/[sectionKey]/route.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the route:**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { requireOperatorEmail } from '@/lib/viewbook/operator'
import { parseId, requireJsonObject } from '@/lib/viewbook/route-utils'
import { putSectionCopyOverride, deleteSectionCopyOverride } from '@/lib/viewbook/section-copy-content'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; sectionKey: string }> }

export const PUT = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  const operator = await requireOperatorEmail(request)
  const { id: rawId, sectionKey } = await params
  const body = requireJsonObject(await parseJsonBody<Record<string, unknown>>(request))
  await putSectionCopyOverride(parseId(rawId), sectionKey, body, operator)
  return NextResponse.json({ ok: true })
})

export const DELETE = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  await requireOperatorEmail(request)
  const { id: rawId, sectionKey } = await params
  await deleteSectionCopyOverride(parseId(rawId), sectionKey)
  return NextResponse.json({ ok: true })
})
```

- [ ] **Step 4: Run test + gate**

Run: `npx vitest run "app/api/viewbooks/[id]/section-copy/[sectionKey]/route.test.ts" && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add "app/api/viewbooks/[id]/section-copy/[sectionKey]/route.ts" "app/api/viewbooks/[id]/section-copy/[sectionKey]/route.test.ts"
git commit -m "feat(viewbook): per-viewbook section-copy override routes (Feature A)"
```

---

### Task 10: Company-wide `SectionCopyEditor` on `/viewbooks/settings`

**Files:**
- Create: `components/viewbook/admin/SectionCopyEditor.tsx`
- Modify: `app/(app)/viewbooks/settings/page.tsx` (render the editor + pass the loaded map)
- Test: `components/viewbook/admin/SectionCopyEditor.test.tsx`

**Interfaces:**
- Consumes: an initial `Record<SectionKey, ResolvedSectionCopy>` (resolved from code default ← company-wide) passed from the server page (which calls `getSectionCopyGlobalMap` + `resolveSectionCopy` per key). PUT/DELETE `/api/viewbooks/section-copy/:sectionKey` (Task 8).
- Produces: a per-section editor (13 sections; purpose/whatThis/whatWeNeed textareas; Save + "Reset to default"). Mirror the block-editor styling in `GlobalContentEditor.tsx` (`jsonFetch` from `./viewbook-admin-shared`, `ViewbookEditorPanel`/editor class helpers from `@/components/viewbook/editor`, `StatusPill` from `@/components/ui/StatusPill`). This is admin UI → dark-mode classes ARE allowed here (NOT the public viewer).

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { SectionCopyEditor } from './SectionCopyEditor'

afterEach(cleanup)
beforeEach(() => { vi.restoreAllMocks() })

const initial = {
  brand: { purpose: 'P', whatThis: 'T', whatWeNeed: 'N' },
} as any

describe('SectionCopyEditor', () => {
  it('renders a section row with prefilled fields and PUTs on save', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SectionCopyEditor sectionKeys={['brand'] as any} initial={initial} />)
    const whatThis = screen.getByLabelText('What this is — brand') as HTMLTextAreaElement
    expect(whatThis.value).toBe('T')
    fireEvent.change(whatThis, { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: /save brand/i }))
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalled()
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/viewbooks/section-copy/brand')
    expect((opts as any).method).toBe('PUT')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/viewbook/admin/SectionCopyEditor.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `SectionCopyEditor.tsx`** — a `'use client'` component. Structure (mirror `GlobalContentEditor` block editor): local state per section (purpose/whatThis/whatWeNeed), a Save button that PUTs `{ purpose, whatThis, whatWeNeed }` (empty whatWeNeed → server normalizes to null), a "Reset to default" button that DELETEs then restores the code default into local state. Labels: `What this is — {sectionKey}`, `What we need — {sectionKey}`, `Chapter one-liner — {sectionKey}`. Save button accessible name `Save {sectionKey}`. Use `SECTION_TITLES` for the human heading. Key implementation points:

```tsx
'use client'
import { useState } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'
import type { ResolvedSectionCopy } from '@/lib/viewbook/section-copy-content'
import { SECTION_TITLES } from '@/components/viewbook/public/section-titles'
import { jsonFetch } from './viewbook-admin-shared'
import { editorLabelClass, editorTextareaClass, editorPrimaryBtnClass, editorDestructiveBtnClass } from '@/components/viewbook/editor'

export function SectionCopyEditor({ sectionKeys, initial }: {
  sectionKeys: readonly SectionKey[]
  initial: Record<SectionKey, ResolvedSectionCopy>
}) {
  return (
    <div className="space-y-6">
      {sectionKeys.map((key) => (
        <SectionRow key={key} sectionKey={key} initial={initial[key]} />
      ))}
    </div>
  )
}

function SectionRow({ sectionKey, initial }: { sectionKey: SectionKey; initial: ResolvedSectionCopy }) {
  const [purpose, setPurpose] = useState(initial.purpose)
  const [whatThis, setWhatThis] = useState(initial.whatThis)
  const [whatWeNeed, setWhatWeNeed] = useState(initial.whatWeNeed ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      await jsonFetch(`/api/viewbooks/section-copy/${sectionKey}`, {
        method: 'PUT',
        body: JSON.stringify({ purpose, whatThis, whatWeNeed: whatWeNeed.trim() === '' ? null : whatWeNeed }),
      })
    } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-navy-border p-4">
      <h3 className="font-semibold text-navy dark:text-white">{SECTION_TITLES[sectionKey]}</h3>
      <label className={editorLabelClass}>Chapter one-liner — {sectionKey}</label>
      <textarea aria-label={`Chapter one-liner — ${sectionKey}`} className={editorTextareaClass} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      <label className={editorLabelClass}>What this is — {sectionKey}</label>
      <textarea aria-label={`What this is — ${sectionKey}`} className={editorTextareaClass} value={whatThis} onChange={(e) => setWhatThis(e.target.value)} />
      <label className={editorLabelClass}>What we need — {sectionKey}</label>
      <textarea aria-label={`What we need — ${sectionKey}`} className={editorTextareaClass} value={whatWeNeed} onChange={(e) => setWhatWeNeed(e.target.value)} />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" aria-label={`Save ${sectionKey}`} disabled={busy} className={editorPrimaryBtnClass} onClick={save}>Save</button>
      </div>
    </div>
  )
}
```

> If `editorLabelClass`/`editorTextareaClass`/`editorPrimaryBtnClass`/`editorDestructiveBtnClass` names differ, use the exact exports of `@/components/viewbook/editor` (confirm via that file). A "Reset to default" button (DELETE then reset local state to the code default) can be added mirroring `ContentTab`'s override delete-with-confirm; not required for the passing test but include it for parity with the spec.

- [ ] **Step 4: Wire into the settings page** — `app/(app)/viewbooks/settings/page.tsx` is a server component. Load the map and pass it:

```tsx
import { SECTION_KEYS } from '@/lib/viewbook/theme'
import { getSectionCopyGlobalMap, resolveSectionCopy } from '@/lib/viewbook/section-copy-content'
import { SectionCopyEditor } from '@/components/viewbook/admin/SectionCopyEditor'
// ...in the async page body:
  const globalMap = await getSectionCopyGlobalMap()
  const initial = Object.fromEntries(
    SECTION_KEYS.map((k) => [k, resolveSectionCopy(k, globalMap[k] ?? null, null)]),
  ) as Record<(typeof SECTION_KEYS)[number], ReturnType<typeof resolveSectionCopy>>
// ...render below GlobalContentEditor:
  <section className="space-y-3">
    <h2 className="text-xl font-heading font-bold text-navy dark:text-white">Section copy</h2>
    <p className="text-[13px] text-navy/50 dark:text-white/50">The ⓘ tooltip beside each section heading — edited once, rendered into every viewbook (per-viewbook overrides live in each viewbook's editor).</p>
    <SectionCopyEditor sectionKeys={SECTION_KEYS} initial={initial} />
  </section>
```

(Make the page `async` if it isn't already.)

- [ ] **Step 5: Run test + gate**

Run: `npx vitest run components/viewbook/admin/SectionCopyEditor.test.tsx && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add components/viewbook/admin/SectionCopyEditor.tsx components/viewbook/admin/SectionCopyEditor.test.tsx "app/(app)/viewbooks/settings/page.tsx"
git commit -m "feat(viewbook): company-wide Section copy editor on /viewbooks/settings (Feature A)"
```

---

### Task 11: Per-viewbook section-copy overrides in `ContentTab`

**Files:**
- Modify: `components/viewbook/admin/ContentTab.tsx` (add a "Section copy overrides" block) + its parent `ViewbookEditor` data plumbing if the resolved per-viewbook map isn't already loaded.
- Test: `components/viewbook/admin/ContentTab.sectioncopy.test.tsx` (create)

**Interfaces:**
- Consumes: the per-viewbook resolved map (code default ← company-wide ← override) — loaded server-side where `ContentTab`'s other data comes from (mirror how `overrides` reach `ContentTab`). PUT/DELETE `/api/viewbooks/:id/section-copy/:sectionKey` (Task 9).
- Produces: a per-section override editor in the viewbook admin, one row per section (same three fields), Save (PUT) + "Clear override" (DELETE → falls back to company-wide/default on next load).

- [ ] **Step 1: Write the failing test** (mirror Task 10's fetch-assertion shape, targeting the per-viewbook endpoint):

```tsx
// @vitest-environment jsdom
// DOM-native assertions only — this repo has NO jest-dom.
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { SectionCopyOverrides } from './ContentTab'

afterEach(cleanup)
beforeEach(() => vi.restoreAllMocks())

it('PUTs a per-viewbook section-copy override', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<SectionCopyOverrides viewbookId={7} sectionKeys={['brand'] as any}
    resolved={{ brand: { purpose: 'P', whatThis: 'T', whatWeNeed: null } } as any} />)
  fireEvent.change(screen.getByLabelText('What this is — brand'), { target: { value: 'Client-specific' } })
  fireEvent.click(screen.getByRole('button', { name: /save brand override/i }))
  await Promise.resolve()
  const [url, opts] = fetchMock.mock.calls[0]
  expect(String(url)).toContain('/api/viewbooks/7/section-copy/brand')
  expect((opts as any).method).toBe('PUT')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/viewbook/admin/ContentTab.sectioncopy.test.tsx`
Expected: FAIL — `SectionCopyOverrides` not exported.

- [ ] **Step 3: Add `SectionCopyOverrides` to `ContentTab.tsx`** — an exported sub-component (so it's independently testable), rendered inside `ContentTab` under a "Section copy overrides" heading. Same three-field row as Task 10 but posting to the per-viewbook endpoint and with a "Clear override" DELETE. Wire the resolved per-viewbook map from the server (add it to `ContentTab`'s props; the parent loads it via `getSectionCopyGlobalMap` + `getSectionCopyOverrideMap` + `buildSectionCopyMap`-style resolution). Reuse the same field/label conventions (`What this is — {sectionKey}`, button `Save {sectionKey} override`). Follow the existing `ContentTab` override block's `jsonFetch` + confirm-delete pattern (lines ~300–330).

- [ ] **Step 4: Wire the resolved map to `ContentTab`** — in the server component that renders `ViewbookEditor`/`ContentTab`, load `getSectionCopyGlobalMap()` + `getSectionCopyOverrideMap(viewbookId)`, resolve per key, and pass as a prop down to `ContentTab` (mirror how `overrides` is already threaded). Run `npx tsc --noEmit` and fix the prop plumbing until clean.

- [ ] **Step 5: Run test + gate**

Run: `npx vitest run components/viewbook/admin/ContentTab.sectioncopy.test.tsx && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add components/viewbook/admin/ContentTab.tsx components/viewbook/admin/ContentTab.sectioncopy.test.tsx
# plus the parent server component that plumbs the resolved map
git commit -m "feat(viewbook): per-viewbook section-copy overrides in ContentTab (Feature A)"
```

**PR 2 gate:** full `npx vitest run` + `npm run build`. `/codex-review` (P1 — content-write path). Deploy via `~/deploy.sh` + prod-verify (health 200, deployed HEAD; NO migration). Browser-eyeball on a designated viewbook: ⓘ beside the H2 shows whatThis/whatWeNeed; company-wide edit on `/viewbooks/settings` reflects everywhere; a per-viewbook override wins; the old panel is gone.

---

## Self-Review

**Spec coverage:**
- A1 3-field/3-layer editable + normalization + fallthrough → Task 3 (`validateSectionCopy`/`resolveSectionCopy`), Task 6 (`buildSectionCopyMap`). ✅
- A2 namespace/no-migration/exact-key queries → Task 3 (`in:` queries, `sectionCopyKey`). ✅
- A3 store fns + delete-fence + bump placement → Task 3. ✅
- A4 data flow into viewer → Task 6 + Task 7. ✅
- A5 ⓘ placement (continuous sibling of H2, collapse headerStrip) + never-in-h2/button → Task 7. ✅
- A6 removal + StatusPill relocation → Task 5 + Task 7. ✅
- A7 editing surfaces (company-wide + per-viewbook) → Tasks 8–11. ✅
- Tooltip ReactNode + on-primary → Task 4. ✅
- B1 hide behavior + retire DESKTOP_RAIL_COLLAPSIBLE → Task 2. ✅
- B2 desktop-only + mobile guard → Task 2. ✅
- B3 device-global persistence → Task 1. ✅
- B4 a11y (aria-controls omit-while-hidden, focus, CLS, flash-check) → Task 1 + Task 2 + PR gates. ✅

**Placeholder scan:** Tasks 10–11 (admin editor UIs) reference mirror files (`GlobalContentEditor`, `ContentTab`) for styling parity and note "confirm exact export names of `@/components/viewbook/editor`" — the core wiring (fetch calls, endpoints, state, labels) is spelled out with real code; the visual chrome follows the established admin pattern. Acceptable per the skill's "follow established patterns in existing codebases." All other tasks have complete code.

**Type consistency:** `SectionCopyContent`/`ResolvedSectionCopy` names consistent Tasks 3/6/7/10/11; `sectionCopy` prop name consistent Tasks 6/7; endpoint paths consistent Tasks 8/9 ↔ 10/11; `useTocHidden` shape consistent Tasks 1/2.

**Open confirmation for the implementer (not blockers):**
- Exact export names in `@/components/viewbook/editor` (Task 10/11) — confirm before use.
- Whether `SummaryStat.tsx` actually renders `SectionShell` (Task 7 caller list) — grep confirmed it imports it; verify it passes the new prop.
- The exact server component that renders `ContentTab` (Task 11 Step 4) — trace from `ViewbookEditor`.
