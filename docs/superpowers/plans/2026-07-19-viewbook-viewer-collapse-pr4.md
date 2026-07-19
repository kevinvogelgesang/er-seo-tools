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

### Task 2: Shared sanitizer (add functions to the existing config module)

**Files:**
- Modify: `lib/viewbook/presentation-config.ts` — **created in PR3** with `COLLAPSE_AFFORDANCES` / `CollapseAffordanceKind` / `PRESENTATION_DEFAULTS`. This task ADDS the two functions; do NOT redeclare the const/type. (If PR4 lands before PR3, create the file with all of it here instead.)
- Test: `lib/viewbook/presentation-config.test.ts`

**Interfaces:**
- Consumes: the existing `COLLAPSE_AFFORDANCES` / `CollapseAffordanceKind` / `PRESENTATION_DEFAULTS`.
- Produces:
  ```ts
  // strict write-parse: returns a clean patch or throws HttpError(400)
  export function parsePresentationPatch(raw: Record<string, unknown>): Partial<{ collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number }>
  // read-normalize: never throws, degrades to defaults
  export function readPresentationConfig(row: { collapseAffordance: string; heroOverlayStrength: number }): { collapseAffordance: CollapseAffordanceKind; heroOverlayStrength: number }
  ```
- Client-safe **except** the `HttpError` import in `parsePresentationPatch` — `@/lib/api/errors` is import-safe on the client (no server-only deps), same as other viewbook client-safe validators. Confirm during impl; if not, split the throw into the route.

- [ ] **Step 1: Failing tests.**

```ts
it('rejects an unknown affordance (400)', () => { expect(() => parsePresentationPatch({ collapseAffordance: 'zzz' })).toThrow() })
it('rejects a non-finite overlay (400, not coerced)', () => {
  expect(() => parsePresentationPatch({ heroOverlayStrength: Number.NaN })).toThrow()
  expect(() => parsePresentationPatch({ heroOverlayStrength: 'high' })).toThrow()
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
// ADD to the existing lib/viewbook/presentation-config.ts (PR3 created the const/type/defaults).
import { HttpError } from '@/lib/api/errors'
// COLLAPSE_AFFORDANCES, CollapseAffordanceKind, PRESENTATION_DEFAULTS are already
// declared at the top of this file (PR3) — do NOT redeclare them.

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
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, 'invalid_overlay')
    patch.heroOverlayStrength = Math.max(0, Math.min(100, Math.round(n)))
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

### Task 4: Options-page editor UI

**Files:**
- Modify: `components/viewbook/admin/ViewbookEditor.tsx` (near the `ThemeEditor` render)
- Modify: the admin detail type (`ViewbookDetail`) to carry the two fields (from `GET /api/viewbooks/[id]`)
- Test: `components/viewbook/admin/ViewbookEditor.test.tsx` (extend)

**Interfaces:**
- Consumes: `PATCH /api/viewbooks/[id]` presentation branch, `COLLAPSE_AFFORDANCES`.
- Produces: a "Presentation" card with an affordance `<select>` + an overlay range `<input type="range" min=0 max=100>`, saving via `jsonFetch(PATCH)` then the existing `onSaved()` reload.

- [ ] **Step 1: Failing test.**

```ts
it('changing the affordance select PATCHes collapseAffordance', async () => {
  // render editor, change select to 'pill', assert jsonFetch called with body {collapseAffordance:'pill'}
})
```

Run: FAIL.

- [ ] **Step 2: Implement** a small `PresentationCard` block inside `ViewbookEditor` (follow the existing `run('...', () => jsonFetch(...))` pattern used for other PATCHes at lines ~299/326):

```tsx
// affordance select
<select value={vb.collapseAffordance}
  onChange={(e) => void run('Presentation', () => jsonFetch(`/api/viewbooks/${vb.id}`, {
    method: 'PATCH', body: JSON.stringify({ collapseAffordance: e.target.value }),
  }).then(() => load()))}>
  {COLLAPSE_AFFORDANCES.map(a => <option key={a} value={a}>{a}</option>)}
</select>
// overlay range (commit onChange or onPointerUp to avoid a PATCH per pixel — debounce/commit-on-release)
<input type="range" min={0} max={100} defaultValue={vb.heroOverlayStrength}
  onPointerUp={(e) => void run('Presentation', () => jsonFetch(`/api/viewbooks/${vb.id}`, {
    method: 'PATCH', body: JSON.stringify({ heroOverlayStrength: Number((e.target as HTMLInputElement).value) }),
  }).then(() => load()))} />
```

Use `dark:` variants + the existing editor label styling. Ensure `ViewbookDetail` (the type behind `vb`) includes `collapseAffordance: string; heroOverlayStrength: number` (from `getViewbookAdmin`).

- [ ] **Step 3: Thread config into the public render.** Now that PR3's SectionShell accepts `affordance`/`overlayStrength`, pass the real values from `data.collapseAffordance` / `data.heroOverlayStrength` in `app/(public)/viewbook/[token]/page.tsx` (replacing PR3's defaults).

- [ ] **Step 4: Run + gate + commit.**

Run: `npx vitest run components/viewbook app/api/viewbooks lib/viewbook` → PASS; tsc → 0; `npm run build` → OK.

```bash
git add components/viewbook/admin/ViewbookEditor.tsx components/viewbook/admin/ViewbookEditor.test.tsx "app/(public)/viewbook/[token]/page.tsx"
git commit -m "feat(viewbook): options-page presentation controls (affordance + overlay)"
```

---

## PR4 self-check
- Columns (not themeJson); one sanitizer (strict write, degrading read); finite-int check before clamp.
- Atomic dual-update + single sync bump; PATCH 400s on bad input.
- Overlay range commits on release (not per-pixel PATCH). Public render consumes real config.
- `CollapseAffordanceKind` has ONE home (`presentation-config.ts`); PR3 imports it. Gates green incl. build.
