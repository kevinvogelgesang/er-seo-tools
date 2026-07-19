# Viewbook viewer-collapse — PR4: options-page config (affordance + overlay)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Read the program overview + spec first. Global Constraints apply. Depends on PR1 (independent of PR2/PR3, but PR3 consumes these values — ship PR4 before or with PR3's final wiring).

**Goal:** Two per-viewbook presentation settings — `collapseAffordance` (`bar|pill|chevron`) and `heroOverlayStrength` (0–100 int) — stored as `Viewbook` columns, edited on the admin options page, with one shared sanitizer, atomic write, and a single syncVersion bump.

**Architecture:** Columns (NOT the strict themeJson blob — adding keys there degrades every stored theme to default). One client-safe sanitizer owns defaults + strict validation for read and write. `PATCH /api/viewbooks/[id]` gains a presentation branch.

**Tech Stack:** Prisma + SQLite, Next 15 route + admin React editor.

---

### Task 1: Schema columns + migration

**Files:**
- Modify: `prisma/schema.prisma` (model `Viewbook`)
- Create: `prisma/migrations/<timestamp>_viewbook_presentation_config/migration.sql`

**Interfaces:**
- Produces: `Viewbook.collapseAffordance: string @default("bar")`, `Viewbook.heroOverlayStrength: int @default(55)`.

- [ ] **Step 1: Edit schema.** In model `Viewbook`:

```prisma
  collapseAffordance  String @default("bar")  // 'bar' | 'pill' | 'chevron' (presentation config, PR4)
  heroOverlayStrength Int    @default(55)      // 0..100 hero overlay opacity
```

- [ ] **Step 2: Migrate.**

Run: `npx prisma migrate dev --name viewbook_presentation_config`
Expected: additive columns, client regenerated. No backfill needed (defaults cover all rows).

- [ ] **Step 3: Commit.**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(viewbook): add collapseAffordance + heroOverlayStrength columns"
```

---

### Task 2: The full `presentation-config` module (types + consts + defaults + sanitizer)

**Files:**
- Create: `lib/viewbook/presentation-config.ts` — **PR4 OWNS this file entirely** (Codex FIX-PR3-PR4-CONFIG-OWNERSHIP). PR3 imports `CollapseAffordanceKind`/`COLLAPSE_AFFORDANCES` from here, so this must land before PR3.
- Test: `lib/viewbook/presentation-config.test.ts`

**Interfaces:**
- Produces (the ONE home of the affordance type; client-safe):
  ```ts
  export const COLLAPSE_AFFORDANCES = ['bar','pill','chevron'] as const
  export type CollapseAffordanceKind = (typeof COLLAPSE_AFFORDANCES)[number]
  export const PRESENTATION_DEFAULTS = { collapseAffordance: 'bar' as CollapseAffordanceKind, heroOverlayStrength: 55 }
  export function parsePresentationPatch(raw: Record<string, unknown>): Partial<{ collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number }> // strict; throws HttpError(400)
  export function readPresentationConfig(row: { collapseAffordance: string; heroOverlayStrength: number }): { collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number } // never throws
  ```
- `@/lib/api/errors` (`HttpError`) is import-safe on the client (no server-only deps), matching other viewbook client-safe validators. Confirm during impl; if not, throw in the route instead.

- [ ] **Step 1: Failing tests.**

```ts
it('rejects an unknown affordance (400)', () => { expect(() => parsePresentationPatch({ collapseAffordance: 'zzz' })).toThrow() })
it('rejects a non-integer / non-finite overlay (400, not coerced)', () => {
  expect(() => parsePresentationPatch({ heroOverlayStrength: Number.NaN })).toThrow()
  expect(() => parsePresentationPatch({ heroOverlayStrength: 'high' })).toThrow()
  expect(() => parsePresentationPatch({ heroOverlayStrength: 12.5 })).toThrow() // Number.isInteger gate
})
it('clamps a valid overlay into [0,100]', () => {
  expect(parsePresentationPatch({ heroOverlayStrength: 250 })).toEqual({ heroOverlayStrength: 100 })
  expect(parsePresentationPatch({ heroOverlayStrength: -5 })).toEqual({ heroOverlayStrength: 0 })
})
it('read degrades a corrupt stored affordance to the default', () => {
  expect(readPresentationConfig({ collapseAffordance: 'garbage', heroOverlayStrength: 55 }).collapseAffordance).toBe('bar')
})
```

Run: FAIL.

- [ ] **Step 2: Implement.**

```ts
import { HttpError } from '@/lib/api/errors'
export const COLLAPSE_AFFORDANCES = ['bar', 'pill', 'chevron'] as const
export type CollapseAffordanceKind = (typeof COLLAPSE_AFFORDANCES)[number]
export const PRESENTATION_DEFAULTS = { collapseAffordance: 'bar' as CollapseAffordanceKind, heroOverlayStrength: 55 }

function isAffordance(v: unknown): v is CollapseAffordanceKind {
  return typeof v === 'string' && (COLLAPSE_AFFORDANCES as readonly string[]).includes(v)
}

export function parsePresentationPatch(raw: Record<string, unknown>) {
  const patch: Partial<{ collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number }> = {}
  if ('collapseAffordance' in raw) {
    if (!isAffordance(raw.collapseAffordance)) throw new HttpError(400, 'invalid_affordance')
    patch.collapseAffordance = raw.collapseAffordance
  }
  if ('heroOverlayStrength' in raw) {
    const n = raw.heroOverlayStrength
    // Require a FINITE INTEGER before clamping (Codex FIX-10) — reject 12.5, NaN, "high".
    if (typeof n !== 'number' || !Number.isInteger(n)) throw new HttpError(400, 'invalid_overlay')
    patch.heroOverlayStrength = Math.max(0, Math.min(100, n))
  }
  return patch
}

export function readPresentationConfig(row: { collapseAffordance: string; heroOverlayStrength: number }) {
  return {
    collapseAffordance: isAffordance(row.collapseAffordance) ? row.collapseAffordance : PRESENTATION_DEFAULTS.collapseAffordance,
    heroOverlayStrength: Number.isFinite(row.heroOverlayStrength)
      ? Math.max(0, Math.min(100, Math.round(row.heroOverlayStrength)))
      : PRESENTATION_DEFAULTS.heroOverlayStrength,
  }
}
```

- [ ] **Step 3: Run + commit.** vitest → PASS; tsc → 0.

```bash
git add lib/viewbook/presentation-config.ts lib/viewbook/presentation-config.test.ts
git commit -m "feat(viewbook): presentation-config sanitizer (strict write, degrading read)"
```

---

### Task 3: PATCH route branch + service + loaders

**Files:**
- Modify: `lib/viewbook/service.ts` (add `updateViewbookPresentation`)
- Modify: `app/api/viewbooks/[id]/route.ts` (PATCH: presentation branch)
- Modify: `lib/viewbook/public-data.ts` + `lib/viewbook/operator-data.ts` (surface the two fields via `readPresentationConfig`)
- Modify: `lib/viewbook/public-types.ts` (`ViewbookPublicData` gains `collapseAffordance` + `heroOverlayStrength`)
- Test: `app/api/viewbooks/routes.test.ts` (extend), `lib/viewbook/service.test.ts`

**Interfaces:**
- Produces: `updateViewbookPresentation(id, patch): Promise<void>` — atomic update of the two columns + ONE syncVersion bump; `ViewbookPublicData.collapseAffordance` / `.heroOverlayStrength`.

- [ ] **Step 1: Failing tests.** (`mkViewbook` = the local helper from PR1/PR2 — `service.test.ts` already has its own; reuse it.)

```ts
// service.test.ts
it('updateViewbookPresentation writes both fields + bumps syncVersion once', async () => {
  const vb = await mkViewbook(); const before = (await prisma.viewbook.findUniqueOrThrow({where:{id:vb.id}})).syncVersion
  await updateViewbookPresentation(vb.id, { collapseAffordance: 'pill', heroOverlayStrength: 20 })
  const row = await prisma.viewbook.findUniqueOrThrow({ where: { id: vb.id } })
  expect(row.collapseAffordance).toBe('pill'); expect(row.heroOverlayStrength).toBe(20)
  expect(row.syncVersion).toBe(before + 1)
})
// routes.test.ts
it('PATCH {collapseAffordance:"zzz"} → 400', async () => { /* … */ })
```

Run: FAIL.

- [ ] **Step 2: `service.ts`** — array-form txn, single bump:

```ts
import { syncVersionBumpStatement } from './sync'
export async function updateViewbookPresentation(
  id: number,
  patch: Partial<{ collapseAffordance: string; heroOverlayStrength: number }>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return
  await prisma.$transaction([
    syncVersionBumpStatement(id),
    prisma.viewbook.update({ where: { id }, data: patch }),
  ])
}
```

- [ ] **Step 3: `route.ts`** — add the presentation branch to PATCH (before the `!handled` throw):

```ts
import { parsePresentationPatch } from '@/lib/viewbook/presentation-config'
import { updateViewbookPresentation } from '@/lib/viewbook/service'
// …inside PATCH, after the settings branch:
const presentation = parsePresentationPatch(body) // throws 400 on bad input
if (Object.keys(presentation).length > 0) {
  await updateViewbookPresentation(id, presentation)
  handled = true
}
```

- [ ] **Step 4: Loaders + type.** In `public-data.ts`, spread `readPresentationConfig(vb)` into the returned `ViewbookPublicData` (`vb` is the full row from `requireViewbookToken`). Add the two fields to `ViewbookPublicData` in `public-types.ts`. In `operator-data.ts`, select + expose them too (the operator loader uses an explicit `select` — add `collapseAffordance: true, heroOverlayStrength: true`).

- [ ] **Step 5: Run + gate + commit.**

Run: `npx vitest run lib/viewbook app/api/viewbooks` → PASS; tsc → 0.

```bash
git add lib/viewbook/service.ts "app/api/viewbooks/[id]/route.ts" lib/viewbook/public-data.ts lib/viewbook/operator-data.ts lib/viewbook/public-types.ts app/api/viewbooks/routes.test.ts lib/viewbook/service.test.ts
git commit -m "feat(viewbook): PATCH presentation config (atomic, single sync bump) + loaders"
```

---

### Task 4: Options-page editor UI (dedicated `PresentationEditor`)

**Files:**
- Create: `components/viewbook/admin/PresentationEditor.tsx` (a self-contained card, NOT inline in `ViewbookEditor` — Codex FIX-10: `run` lives in one component and `load` in the parent, so an inline sketch can't compile in either)
- Modify: `components/viewbook/admin/ViewbookEditor.tsx` (render `<PresentationEditor viewbookId={vb.id} config={…} onSaved={() => void load()} />` near `<ThemeEditor … onSaved={…} />`)
- Modify: `components/viewbook/admin/viewbook-admin-shared.ts` — add `collapseAffordance: string; heroOverlayStrength: number` to `ViewbookDetail` (the type behind `vb`, populated by `getViewbookAdmin`)
- Test: `components/viewbook/admin/PresentationEditor.test.tsx`

**Interfaces:**
- Consumes: `PATCH /api/viewbooks/[id]` presentation branch, `COLLAPSE_AFFORDANCES` + `CollapseAffordanceKind` from `presentation-config`, `jsonFetch`.
- Produces: `PresentationEditor({ viewbookId, config, onSaved })` — mirrors `ThemeEditor`'s self-contained pattern (owns its own save state + calls `onSaved` after a successful PATCH; the parent `load()` is passed AS `onSaved`).

- [ ] **Step 1: Failing tests.**

```ts
it('changing the affordance select PATCHes {collapseAffordance} then calls onSaved', async () => {})
it('the overlay slider is controlled and PATCHes {heroOverlayStrength} on blur AND on keyboard commit (Enter / arrow+blur), not only pointer release', async () => {})
```

Run: FAIL.

- [ ] **Step 2: Implement `PresentationEditor.tsx`.** Controlled slider (local `useState` seeded from `config.heroOverlayStrength`), committing on `onBlur` and `onKeyUp` (Enter) as well as pointer release — never only `onPointerUp` (keyboard users must be able to save; Codex FIX-10). `heroOverlayStrength` is sent as an integer (`Math.round` the slider value client-side too, matching the server's `Number.isInteger` gate).

```tsx
'use client'
import { useState } from 'react'
import { jsonFetch } from '@/components/viewbook/admin/viewbook-admin-shared' // or the shared fetch util's real path
import { COLLAPSE_AFFORDANCES, type CollapseAffordanceKind } from '@/lib/viewbook/presentation-config'

export function PresentationEditor({ viewbookId, config, onSaved }: {
  viewbookId: number
  config: { collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number }
  onSaved: () => void
}) {
  const [overlay, setOverlay] = useState(config.heroOverlayStrength)
  const [busy, setBusy] = useState(false)
  async function save(patch: Record<string, unknown>) {
    setBusy(true)
    try { await jsonFetch(`/api/viewbooks/${viewbookId}`, { method: 'PATCH', body: JSON.stringify(patch) }); onSaved() }
    finally { setBusy(false) }
  }
  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-navy-border">
      <label className="block text-sm font-semibold">Collapse affordance</label>
      <select disabled={busy} defaultValue={config.collapseAffordance}
        onChange={(e) => void save({ collapseAffordance: e.target.value })}
        className="mt-1 rounded border px-2 py-1 dark:bg-navy-deep dark:border-navy-border">
        {COLLAPSE_AFFORDANCES.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <label className="mt-4 block text-sm font-semibold">Hero overlay strength: {overlay}</label>
      <input type="range" min={0} max={100} value={overlay} disabled={busy}
        onChange={(e) => setOverlay(Math.round(Number(e.target.value)))}
        onBlur={() => void save({ heroOverlayStrength: overlay })}
        onKeyUp={(e) => { if (e.key === 'Enter') void save({ heroOverlayStrength: overlay }) }} />
    </div>
  )
}
```

(Confirm `jsonFetch`'s real import path during impl.) In `ViewbookEditor.tsx`, pass `config={readPresentationConfig(vb)}` (or the raw two fields) + `onSaved={() => void load()}`.

- [ ] **Step 2b:** `viewbook-admin-shared.ts` — add the two fields to `ViewbookDetail`, and ensure `getViewbookAdmin` (`service.ts`) selects/returns them.

- [ ] **Step 3: (public render wiring lives in PR3.)** PR4 lands before PR3, so `data.collapseAffordance` / `data.heroOverlayStrength` are available in the payload; PR3 Task 4 Step 3 threads them into `SectionShell`. Nothing to do here beyond confirming the two fields are on `ViewbookPublicData` (Task 3 Step 4).

- [ ] **Step 4: Run + gate + commit.**

Run: `npx vitest run components/viewbook app/api/viewbooks lib/viewbook` → PASS; tsc → 0; `npm run build` → OK.

```bash
git add components/viewbook/admin/PresentationEditor.tsx components/viewbook/admin/PresentationEditor.test.tsx components/viewbook/admin/ViewbookEditor.tsx components/viewbook/admin/viewbook-admin-shared.ts lib/viewbook/service.ts
git commit -m "feat(viewbook): options-page PresentationEditor (affordance + overlay)"
```

---

## PR4 self-check
- Columns (not themeJson); one sanitizer (strict write, degrading read); `Number.isInteger` check before clamp.
- Atomic dual-update + single sync bump; PATCH 400s on bad input.
- Dedicated `PresentationEditor` (compiles — `run`/`load` not split across components); controlled slider saves on blur + keyboard, not only pointer release; `ViewbookDetail` carries the two fields.
- `presentation-config.ts` fully owned here; PR3 imports the type/consts. Gates green incl. build.
