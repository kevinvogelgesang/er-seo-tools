# Viewbook viewer-collapse — PR1: schema, migration, enum retirement, transitional renderer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Read the program overview (`2026-07-19-viewbook-viewer-collapse-program.md`) and the spec first. Global Constraints there apply to every task.

**Goal:** Add `ViewbookSection.collapsedShared`, migrate existing `state='collapsed'` rows onto it, retire `'collapsed'` from the state enum everywhere, and keep the current hero-only rendering via `collapsedShared` (server-only) so there is NO expansion-regression window.

**Architecture:** Collapse becomes orthogonal to `state` (which reverts to `hidden|active|done`). A single additive boolean column holds the shared default; a one-shot backfill converts shipped data and bumps parent `syncVersion` so open browsers refetch. `SectionShell` reads `collapsedShared` instead of `state==='collapsed'`.

**Tech Stack:** Prisma + SQLite, Next 15 RSC, Vitest.

---

### Task 1: Schema column + migration + backfill

**Files:**
- Modify: `prisma/schema.prisma` (model `ViewbookSection`)
- Create: `prisma/migrations/<timestamp>_viewbook_collapsed_shared/migration.sql`
- Test: `lib/viewbook/collapsed-shared-migration.test.ts` (new)

**Interfaces:**
- Produces: `ViewbookSection.collapsedShared: boolean` (Prisma model field), default `false`.

- [ ] **Step 1: Edit the schema.** In `prisma/schema.prisma`, model `ViewbookSection`, change the `state` comment and add the column:

```prisma
  state      String    @default("active") // 'hidden' | 'active' | 'done'
  collapsedShared Boolean @default(false) // viewer-facing shared collapse default (orthogonal to state)
```

- [ ] **Step 2: Generate the migration (do NOT auto-apply the backfill yet).**

Run: `npx prisma migrate dev --name viewbook_collapsed_shared --create-only`
Expected: a new migration folder with the `ALTER TABLE ... ADD COLUMN "collapsedShared"` statement.

- [ ] **Step 3: Append the backfill to the generated `migration.sql`.** Use a literal epoch-ms constant (Prisma SQL can't bind `Date.now()`); pick the ms value at authoring time. Full file:

```sql
-- AlterTable (Prisma-generated)
ALTER TABLE "ViewbookSection" ADD COLUMN "collapsedShared" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: shipped operator collapse (state='collapsed') becomes the shared default.
-- updatedAt stamped explicitly (raw SQL bypasses @updatedAt). <NOW_MS> = author-time epoch ms.
UPDATE "ViewbookSection"
  SET "collapsedShared" = true, "state" = 'active', "updatedAt" = <NOW_MS>
  WHERE "state" = 'collapsed';

-- Bump syncVersion on affected parent books so already-open browsers refetch after deploy.
UPDATE "Viewbook"
  SET "syncVersion" = "syncVersion" + 1, "updatedAt" = <NOW_MS>
  WHERE "id" IN (SELECT DISTINCT "viewbookId" FROM "ViewbookSection" WHERE "collapsedShared" = true);
```

- [ ] **Step 4: Apply + regenerate client.**

Run: `npx prisma migrate dev` (applies the edited migration, regenerates the client)
Expected: "Database is now in sync", client regenerated (the `ViewbookSection` type now has `collapsedShared`).

- [ ] **Step 5: Write the backfill characterization test** (DB-backed). **Fixture pattern:** viewbook tests define a LOCAL `mkViewbook()` helper at the top of the file — there is no shared `test-helpers` module. Mirror `lib/viewbook/ack.test.ts:20`: it `prisma.client.create`s a uniquely-named client, calls `createViewbook(...)` (from `./service`), and returns the row (`{ id, token, … }`). Copy that helper into this test file.

```ts
// lib/viewbook/collapsed-shared-migration.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import crypto from 'crypto'

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vbtest-${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'new-build') // match createViewbook's real signature during impl
}

describe('collapsedShared backfill semantics', () => {
  it('a section written as collapsed reads active + collapsedShared=true', async () => {
    const vb = await mkViewbook()
    await prisma.viewbookSection.update({
      where: { viewbookId_sectionKey: { viewbookId: vb.id, sectionKey: 'brand' } },
      data: { collapsedShared: true, state: 'active' },
    })
    const row = await prisma.viewbookSection.findUniqueOrThrow({
      where: { viewbookId_sectionKey: { viewbookId: vb.id, sectionKey: 'brand' } },
    })
    expect(row.state).toBe('active')
    expect(row.collapsedShared).toBe(true)
  })
})
```

(Confirm `createViewbook`'s real signature/return in `service.ts` during implementation; adjust the helper to match — do not invent a new harness.)

- [ ] **Step 6: Run + commit.**

Run: `npx vitest run lib/viewbook/collapsed-shared-migration.test.ts` → PASS
Run: `npx tsc --noEmit` → 0 errors

```bash
git add prisma/schema.prisma prisma/migrations lib/viewbook/collapsed-shared-migration.test.ts
git commit -m "feat(viewbook): add ViewbookSection.collapsedShared + backfill migration"
```

---

### Task 2: Types + read-model plumbing (`collapsedShared` in, `'collapsed'` state out)

**Files:**
- Modify: `lib/viewbook/public-types.ts` (`PublicSection`)
- Modify: `lib/viewbook/operator-data.ts` (`OperatorSectionData` + mapping)
- Modify: `lib/viewbook/public-data.ts` (`toPublic` ~line 72)
- Modify: `lib/viewbook/section-display.ts` (drop `hero-collapsed`)
- Test: `lib/viewbook/public-data.test.ts` (extend if present, else add a focused test)

**Interfaces:**
- Produces: `PublicSection.state: 'active' | 'done'` and `PublicSection.collapsedShared: boolean`; `OperatorSectionData.state: 'hidden' | 'active' | 'done'` and `OperatorSectionData.collapsedShared: boolean`; `SectionDisplayMode` no longer includes `'hero-collapsed'`.

- [ ] **Step 1: Write/extend the failing test** — `toPublic` maps a `collapsedShared` row:

```ts
// in lib/viewbook/public-data.test.ts (or a new focused test)
it('maps collapsedShared through and never emits a "collapsed" state', async () => {
  // build a viewbook with a section row {state:'active', collapsedShared:true}
  const data = await loadViewbookPublicData(token)
  const brand = [...data!.primarySections, ...data!.carriedSections].find(s => s.sectionKey === 'brand')!
  expect(brand.collapsedShared).toBe(true)
  expect(brand.state).not.toBe('collapsed') // 'collapsed' is retired
})
```

Run: `npx vitest run lib/viewbook/public-data.test.ts` → FAIL (property `collapsedShared` missing).

- [ ] **Step 2: `public-types.ts`** — change the union and add the field:

```ts
export interface PublicSection {
  sectionKey: SectionKey
  state: 'active' | 'done'
  collapsedShared: boolean
  doneAt: string | null
  acknowledgedAt: string | null
  introNote: string | null
  narrative: string | null
}
```

- [ ] **Step 3: `public-data.ts`** — rewrite `toPublic` (the `s.state === 'collapsed'` branch is gone):

```ts
  const toPublic = (s: (typeof sectionRows)[number]): PublicSection => ({
    sectionKey: s.sectionKey as PublicSection['sectionKey'],
    state: s.state === 'done' ? 'done' : 'active',
    collapsedShared: s.collapsedShared,
    doneAt: iso(s.doneAt),
    acknowledgedAt: iso(s.acknowledgedAt),
    introNote: s.introNote,
    narrative: s.narrative,
  })
```

- [ ] **Step 4: `operator-data.ts`** — union + mapping. Change the interface `state` to `'hidden' | 'active' | 'done'`, add `collapsedShared: boolean`, and in the `.map`:

```ts
      state: section.state === 'hidden' || section.state === 'done' ? section.state : 'active',
      collapsedShared: section.collapsedShared,
```

(Drop the `|| section.state === 'collapsed'` clause.)

- [ ] **Step 5: `section-display.ts`** — remove `'hero-collapsed'` from `SectionDisplayMode` and delete the `if (section.state === 'collapsed') return 'hero-collapsed'` line. `PublicSection.state` no longer has `'collapsed'`, so this is also a type fix.

- [ ] **Step 6: Run + gate + commit.**

Run: `npx vitest run lib/viewbook/public-data.test.ts` → PASS
Run: `npx tsc --noEmit` → surfaces every remaining `'collapsed'` reference as a type error (Task 3 clears them). If tsc still errors ONLY in files Task 3 owns, that's expected — commit after Task 3. Otherwise fix here.

```bash
git add lib/viewbook/public-types.ts lib/viewbook/operator-data.ts lib/viewbook/public-data.ts lib/viewbook/section-display.ts
# commit together with Task 3 (tsc must be green before commit)
```

---

### Task 3: Retire `'collapsed'` from the operator write path + inspector pill

**Files:**
- Modify: `lib/viewbook/service.ts` (`setSectionState`)
- Modify: `app/api/viewbooks/[id]/sections/[sectionKey]/route.ts` (validator)
- Modify: `components/viewbook/public/OperatorLayer/inspector/SectionOutline.tsx` (STATE_PILLS + `OutlineRow.state`)
- Modify: `lib/viewbook/toc-index.ts` (only if it branches on `'collapsed'`)
- Modify: fixtures/tests referencing `'collapsed'` state
- Test: `lib/viewbook/service.test.ts` (adjust)

**Interfaces:**
- Consumes: `PublicSection` / `OperatorSectionData` from Task 2.
- Produces: `setSectionState(id, sectionKey, state: 'hidden'|'active'|'done', actor)` — the `'collapsed'` value and the `sectionSupportsCollapse` collapse branch are removed.

- [ ] **Step 1: Adjust the failing service test.** In `lib/viewbook/service.test.ts`, the case asserting `setSectionState(..., 'collapsed')` succeeds must be replaced by one asserting it is now rejected:

```ts
it('rejects the retired "collapsed" state', async () => {
  await expect(setSectionState(vb.id, 'brand', 'collapsed' as never, 'op@x'))
    .rejects.toMatchObject({ status: 400 })
})
```

Run: `npx vitest run lib/viewbook/service.test.ts` → FAIL (still accepted).

- [ ] **Step 2: `service.ts`** — change the signature + drop the collapse branch:

```ts
export async function setSectionState(
  id: number,
  sectionKey: string,
  state: 'hidden' | 'active' | 'done',
  actor: string,
): Promise<void> {
  assertSectionKey(sectionKey)
  if (!['hidden', 'active', 'done'].includes(state)) throw new HttpError(400, 'invalid_section')
  // (collapse is no longer a state — see lib/viewbook/collapse.ts, PR2)
  try {
    const update = prisma.viewbookSection.update({
        where: { viewbookId_sectionKey: { viewbookId: id, sectionKey } },
        data: { state, doneAt: state === 'done' ? new Date() : null },
      })
    const statements = state === 'done'
      ? [syncVersionBumpStatement(id), update, ...appendActivityStatements(id, 'section-done', actor, `Completed ${sectionKey}`)]
      : [syncVersionBumpStatement(id), update]
    await prisma.$transaction(statements)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new HttpError(404, 'not_found')
    }
    throw err
  }
}
```

Remove the now-unused `sectionSupportsCollapse` import from `service.ts` (it moves to PR2's `collapse.ts`). `assertSectionKey` and the imports stay.

- [ ] **Step 3: sections route validator** — in `app/api/viewbooks/[id]/sections/[sectionKey]/route.ts`, drop `'collapsed'`:

```ts
    if (body.state !== 'hidden' && body.state !== 'active' && body.state !== 'done') {
      throw new HttpError(400, 'invalid_section')
    }
```

- [ ] **Step 4: `SectionOutline.tsx`** — change `OutlineRow.state` union (line ~15) to `'active' | 'hidden' | 'done'`, delete the `collapsed:` entry from `STATE_PILLS` (line ~72). If a `collapsedShared` hint pill is wanted it is optional and deferred to PR3; do NOT add it here.

- [ ] **Step 5: `toc-index.ts` + fixtures** — grep and clear the last references:

Run: `grep -rn "'collapsed'\|\"collapsed\"\|hero-collapsed" lib components app --include=*.ts --include=*.tsx | grep -iv "collapsedShared\|collapse.ts\|CollapsibleSection"`
Fix each hit: fixtures that seed `state:'collapsed'` become `state:'active', collapsedShared:true`; any `'collapsed'`-aware branch in `toc-index.ts` is removed (a section is in the TOC when visible, independent of collapse).

- [ ] **Step 6: Gate + commit (Task 2 + Task 3 together).**

Run: `npx tsc --noEmit` → 0 errors
Run: `npx vitest run lib/viewbook components/viewbook/public/OperatorLayer/inspector app/api/viewbooks` → PASS

```bash
git add -A
git commit -m "refactor(viewbook): retire 'collapsed' state enum; collapse is now collapsedShared"
```

---

### Task 4: Transitional server renderer (no expansion-regression window)

**Files:**
- Modify: `components/viewbook/public/SectionShell.tsx`
- Test: `components/viewbook/public/SectionShell.test.tsx`

**Interfaces:**
- Consumes: `PublicSection.collapsedShared` (Task 2).
- Produces: SectionShell renders hero-band-only when `section.collapsedShared` is true — same visual as today's operator collapse, server-only, no viewer control (PR3 adds the control).

- [ ] **Step 1: Update the failing test.** In `SectionShell.test.tsx`, the existing "hero-collapsed suppresses body" test switches its trigger from state to the boolean:

```ts
it('renders hero-only when collapsedShared is true (body + header strip suppressed)', () => {
  const section = { ...baseSection, collapsedShared: true }
  render(<SectionShell section={section} title="Brand" heroUrl={null} stage="building">{body}</SectionShell>)
  expect(screen.queryByTestId('vb-region')).toBeNull()      // body region not rendered
  expect(screen.getByRole('heading', { name: 'Brand' })).toBeInTheDocument() // hero title present
})
```

Run: `npx vitest run components/viewbook/public/SectionShell.test.tsx` → FAIL.

- [ ] **Step 2: `SectionShell.tsx`** — replace the `mode === 'hero-collapsed'` derivation with the boolean. Change:

```ts
  const heroOnly = mode === 'hero-collapsed'
```
to:
```ts
  const heroOnly = section.collapsedShared
```

Delete the now-dead `hero-collapsed` comment references. Everything else (the `{!heroOnly && ...}` guards around the TickDivider strip and SectionReveal) stays as-is — it already produces the hero-only render.

- [ ] **Step 3: Run + gate + commit.**

Run: `npx vitest run components/viewbook/public/SectionShell.test.tsx` → PASS
Run: `npx tsc --noEmit` → 0 errors
Run: `npx vitest run lib/viewbook components/viewbook app/api/viewbook app/api/viewbooks` → PASS (full viewbook suite green)

```bash
git add components/viewbook/public/SectionShell.tsx components/viewbook/public/SectionShell.test.tsx
git commit -m "feat(viewbook): SectionShell renders hero-only from collapsedShared (transitional)"
```

---

## PR1 self-check
- Migration is additive + one-shot backfill; `state` no longer holds `'collapsed'`; parent `syncVersion` bumped.
- No file still reads or writes `'collapsed'` as a state (grep clean except `collapsedShared`, `collapse.ts` (PR2), `CollapsibleSection` (PR3)).
- Rendering parity: a previously-collapsed section still shows hero-only after deploy — no expansion regression.
- Gates: `tsc --noEmit` 0, viewbook vitest green.
