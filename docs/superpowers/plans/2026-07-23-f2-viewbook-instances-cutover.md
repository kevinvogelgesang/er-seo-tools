# F2 — Viewbook Instances + Copy-on-Create Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot the F1 template library into per-viewbook section/subsection instance rows at creation (copy-on-create, offering-filtered), add versioned per-section pull-merge + offering flags, cut the viewer/admin read model over to instances, then retire the legacy `ViewbookGlobalContent`/`ViewbookContentOverride` stores and the F1b dual-write bridge.

**Architecture:** Evolve `ViewbookSection` into the section instance (aggregate-version-fenced) + new `ViewbookSubsection` table (composite tenant-integrity FKs); `ViewbookField` gains required `subsectionId`. One pure projection (`projectInstanceTree`) feeds create/enable/pull. Public payload keeps its `data.global`/`data.sectionCopy` shape derived from instances so the 13 section components stay parity-stable. Two migrations: A (instances + test-viewbook wipe) first, B (legacy-table drop) last.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite (array-form `$transaction` ONLY), vitest, sharp.

**Spec:** `docs/superpowers/specs/2026-07-23-f2-viewbook-instances-cutover-design.md` (Codex-reviewed, fixes 1–12 applied). Read it before starting. Binding roadmap decisions: D4/D5/D6/D8/D15 + identity contracts.

## Global Constraints

- Array-form `$transaction([...])` only — NEVER interactive `$transaction(async tx => ...)`. Conditional logic goes in SQL (`EXISTS`, subselects); raw statements set `updatedAt` manually (`Date.now()`, integer ms).
- Throwing conditional-update guards (P2025 pattern, `service.ts:397` precedent) inside array txns for hard preconditions; P2002 rollback for uniqueness races.
- New API routes: cookie-gated by omission (NO `middleware.ts` change), `withRoute` + `parseJsonBody`, machine-readable error codes.
- Local gates are the ONLY gates: `npx tsc --noEmit` + full `npx vitest run` + `npm run build` before PR.
- Worktree lane: `git worktree add .claude/worktrees/f2-instances-cutover -b feat/f2-viewbook-instances` off FRESH `origin/main`; symlink `node_modules`, copy `.env` (never `.env.local`).
- After schema changes: `npx prisma migrate dev --name <name>` then `rm -rf .test-dbs`.
- No new env vars. No AI-API features. All existing viewbooks are test-only (D4) — the wipe is sanctioned.
- §0/§15 Kevin sign-offs (offering-disable archival, CSM roster source, equal-version refresh, wipe timing) gate the MERGE, not the build.

---

### Task 1: Parity fixture capture (pre-F2 code, FIRST commit on the branch)

**Files:**
- Create: `lib/viewbook/__fixtures__/f2-parity-public-data.json`
- Create: `scripts/capture-viewbook-parity-fixture.ts`
- Create: `lib/viewbook/f2-parity.test.ts` (capture-mode assertion only; the real gate is finished in Task 10)

**Interfaces:**
- Produces: the frozen pre-cutover `ViewbookPublicData` JSON (one per `kind`: `new-build`, `upgrade`) that Task 10's cutover test must reproduce.

The branch tip is still identical to `origin/main` here — the fixture is captured from PRE-F2 behavior. Normalizations applied AT CAPTURE (so the fixture is stable): `viewbookId`/section `id`s → `0`, `token` → `"TOKEN"`, all ISO timestamps → `"TS"`, field `id`s → `0`.

- [ ] **Step 1: Write the capture script**

```ts
// scripts/capture-viewbook-parity-fixture.ts — run with: npx tsx scripts/capture-viewbook-parity-fixture.ts
// Creates a throwaway client+viewbook per kind against the dev DB, seeds templates
// (idempotent), loads ViewbookPublicData, normalizes, writes the fixture JSON, deletes the rows.
import { writeFile } from 'fs/promises'
import { prisma } from '@/lib/db'
import { seedViewbookTemplates } from '@/lib/viewbook/template-seed'
import { createViewbook, deleteViewbook } from '@/lib/viewbook/service'
import { loadViewbookPublicData } from '@/lib/viewbook/public-data'

export function normalizeParityPayload(data: unknown): unknown {
  return JSON.parse(
    JSON.stringify(data, (key, value) => {
      if (key === 'viewbookId' || key === 'id') return 0
      if (key === 'token') return 'TOKEN'
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return 'TS'
      return value
    }),
  )
}

async function main() {
  await seedViewbookTemplates()
  const out: Record<string, unknown> = {}
  for (const kind of ['new-build', 'upgrade'] as const) {
    const client = await prisma.client.create({ data: { name: `f2-fixture-${kind}-${Date.now()}` } })
    const vb = await createViewbook(client.id, kind, 'fixture@enrollmentresources.com')
    const data = await loadViewbookPublicData(vb.token)
    out[kind] = normalizeParityPayload(data)
    await deleteViewbook(vb.id)
    await prisma.client.delete({ where: { id: client.id } })
  }
  await writeFile('lib/viewbook/__fixtures__/f2-parity-public-data.json', JSON.stringify(out, null, 2))
}
main().then(() => process.exit(0))
```

- [ ] **Step 2: Run it and eyeball the fixture**

Run: `npx tsx scripts/capture-viewbook-parity-fixture.ts && head -50 lib/viewbook/__fixtures__/f2-parity-public-data.json`
Expected: JSON with `new-build` + `upgrade` keys; `new-build` has NO `assessment` in `primarySections`/`carriedSections` visible set (hidden state), `sectionCopy` has 13 keys, `global.team`/`blocks` reflect seeded template content.

- [ ] **Step 3: Write the placeholder test that pins the fixture exists and parses**

```ts
// lib/viewbook/f2-parity.test.ts
import { describe, it, expect } from 'vitest'
import fixture from './__fixtures__/f2-parity-public-data.json'

describe('f2 parity fixture', () => {
  it('carries both kinds with 13-section copy maps', () => {
    for (const kind of ['new-build', 'upgrade'] as const) {
      const data = fixture[kind] as { sectionCopy: Record<string, unknown> }
      expect(Object.keys(data.sectionCopy)).toHaveLength(13)
    }
  })
})
```

- [ ] **Step 4: Run it** — `npx vitest run lib/viewbook/f2-parity.test.ts` → PASS
- [ ] **Step 5: Commit** — `git add … && git commit -m "test(viewbook): capture pre-F2 public-data parity fixture (Task 1)"`

---

### Task 2: Migration A — instance schema + wipe

**Files:**
- Modify: `prisma/schema.prisma` (Viewbook offering flags; ViewbookSection instance columns; new ViewbookSubsection; ViewbookField.subsectionId + archiveReason; inverse relations on SectionTemplate/SubsectionTemplate/Viewbook)
- Create: `prisma/migrations/<ts>_viewbook_instances/migration.sql` (generated, then EDIT to prepend the wipe)
- Test: `lib/viewbook/instance-schema.test.ts`

**Interfaces:**
- Produces: the exact §4 schema. Every later task consumes these columns. Composite FK targets: `ViewbookSection @@unique([id, viewbookId])`, `ViewbookSubsection @@unique([id, viewbookId])`.

- [ ] **Step 1: Apply the §4 schema to `prisma/schema.prisma`** — copy the spec §4 blocks verbatim: Viewbook gains `offeringWebsite Boolean @default(true)` / `offeringVa` / `offeringPpc` (`@default(false)`) + `subsections ViewbookSubsection[]`; ViewbookSection gains `sectionTemplateId Int?` + `sectionTemplate SectionTemplate? @relation(fields: [sectionTemplateId], references: [id], onDelete: SetNull)`, `rendererType String`, `title String`, `copyJson String`, `contentJson String?`, `sortOrder Int`, `templateVersion Int`, `version Int @default(1)`, `archivedAt DateTime?`, `archiveReason String?`, `subsections ViewbookSubsection[]`, `@@unique([id, viewbookId])`; new `model ViewbookSubsection` exactly per spec §4 (composite `section` relation on `[sectionId, viewbookId] → [id, viewbookId]` Cascade, `subsectionTemplate` SetNull, `@@unique([sectionId, subsectionKey])`, `@@unique([id, viewbookId])`, `@@index([viewbookId])`); ViewbookField gains `subsectionId Int`, `subsection ViewbookSubsection @relation(fields: [subsectionId, viewbookId], references: [id, viewbookId], onDelete: Cascade)`, `archiveReason String?`. Add matching inverse relation arrays (`SectionTemplate.instances ViewbookSection[]`, `SubsectionTemplate.instances ViewbookSubsection[]`, `ViewbookSubsection.viewbook Viewbook @relation(... onDelete: Cascade)` if Prisma accepts the shared `viewbookId` scalar — spec §4 fallback: drop the direct viewbook relation on ViewbookSubsection, keep the index).
- [ ] **Step 2: Generate** — `npx prisma migrate dev --name viewbook_instances`. If Prisma rejects the shared-scalar relation, apply the spec's pinned fallback and regenerate.
- [ ] **Step 3: Edit the generated `migration.sql`** — prepend as the FIRST statement:

```sql
-- D4: all existing viewbooks are test-only; wipe so the instance NOT NULL
-- rebuild below operates on empty tables. Cascades take every child row.
DELETE FROM "Viewbook";
```

Then re-apply locally: `npx prisma migrate reset --force --skip-seed` (dev DB) and `rm -rf .test-dbs`.
- [ ] **Step 4: Write the schema test**

```ts
// lib/viewbook/instance-schema.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import crypto from 'crypto'

describe('F2 instance schema', () => {
  it('rejects a subsection pointing at another viewbook\'s section (composite FK)', async () => {
    const c1 = await prisma.client.create({ data: { name: `f2-schema-${crypto.randomUUID()}` } })
    const c2 = await prisma.client.create({ data: { name: `f2-schema-${crypto.randomUUID()}` } })
    const mk = (clientId: number) =>
      prisma.viewbook.create({
        data: {
          clientId, kind: 'upgrade', token: crypto.randomUUID(),
          sections: { create: { sectionKey: 'welcome', rendererType: 'welcome', title: 'W', copyJson: '{}', sortOrder: 10, templateVersion: 1 } },
        },
        include: { sections: true },
      })
    const v1 = await mk(c1.id)
    const v2 = await mk(c2.id)
    await expect(
      prisma.viewbookSubsection.create({
        data: {
          viewbookId: v2.id, sectionId: v1.sections[0].id, // cross-tenant pair
          subsectionKey: 'main', title: 'M', sortOrder: 10,
        },
      }),
    ).rejects.toThrow() // FK violation — unrepresentable by construction
    await prisma.client.deleteMany({ where: { id: { in: [c1.id, c2.id] } } })
  })
})
```

- [ ] **Step 5: Run** — `npx vitest run lib/viewbook/instance-schema.test.ts` → PASS. Then `npx tsc --noEmit` — EXPECT compile errors in `service.ts` (`createViewbook` now missing required section columns): fix minimally by giving the EXISTING seed literals the new columns with placeholder snapshots (`rendererType: key, title: SECTION_TITLES[key], copyJson: JSON.stringify({v:1,copy:SECTION_COPY[key]}), sortOrder: (i+1)*10, templateVersion: 0`) — Task 4 replaces this wholesale; fields temporarily need `subsectionId`, so ALSO in this task point `createViewbook`'s field seed at a per-section `main` subsection nested create mirror of the catalog categories under `data-source` (temporary; Task 4 replaces). Keep every other test green.
- [ ] **Step 6: Full gates** — `npx tsc --noEmit && npx vitest run lib/viewbook` → green.
- [ ] **Step 7: Commit** — `feat(viewbook): F2 instance schema + test-viewbook wipe migration (Task 2)`

---

### Task 3: `extractInstanceAssetRefs` — the single asset-ref home

**Files:**
- Create: `lib/viewbook/instance-asset-refs.ts`
- Test: `lib/viewbook/instance-asset-refs.test.ts`

**Interfaces:**
- Produces: `extractInstanceAssetRefs(rendererType: string, contentJson: string | null): string[]` — pure, never throws (corrupt JSON → `[]`). Consumed by Tasks 5 (asset copy), 9 (allowlist), 11 (retention/delete unions).

- [ ] **Step 1: Failing tests** — welcome roster with 2 photos + 1 null → exactly the 2 filenames; corrupt JSON → `[]`; non-welcome rendererType → `[]`; filename not matching `ASSET_FILENAME_RE` → excluded.

```ts
import { describe, it, expect } from 'vitest'
import { extractInstanceAssetRefs } from './instance-asset-refs'

const roster = JSON.stringify({ v: 1, team: [
  { name: 'A', role: 'CSM', photo: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp', blurb: '' },
  { name: 'B', role: 'Dev', photo: null, blurb: '' },
  { name: 'C', role: 'PM', photo: '../etc/passwd', blurb: '' },
], process: { blocks: [] }, why: { blocks: [] } })

describe('extractInstanceAssetRefs', () => {
  it('extracts valid roster photo filenames from welcome content', () =>
    expect(extractInstanceAssetRefs('welcome', roster)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp']))
  it('returns [] for corrupt JSON / null / other renderer types', () => {
    expect(extractInstanceAssetRefs('welcome', '{nope')).toEqual([])
    expect(extractInstanceAssetRefs('welcome', null)).toEqual([])
    expect(extractInstanceAssetRefs('strategy', roster)).toEqual([])
  })
})
```

- [ ] **Step 2: Run → FAIL. Implement** (parse via `parseSubsectionContent('welcome', …)` from `template-content.ts`; filter photos through the exported `ASSET_FILENAME_RE` from `lib/viewbook/assets-shared` — verify the actual export home first, `grep -rn "ASSET_FILENAME_RE" lib/`). Run → PASS.
- [ ] **Step 3: Commit** — `feat(viewbook): extractInstanceAssetRefs single asset-ref home (Task 3)`

---

### Task 4: `projectInstanceTree` + `createViewbook` rewrite + creation offerings

**Files:**
- Create: `lib/viewbook/instance-snapshot.ts`
- Modify: `lib/viewbook/service.ts` (`createViewbook`), `app/api/viewbooks/route.ts` (POST body), the create form component (locate via `grep -rn "createViewbook\|kind.*new-build" components/viewbook/admin` — the list/create UI)
- Test: `lib/viewbook/instance-snapshot.test.ts`, extend `lib/viewbook/service.test.ts`

**Interfaces:**
- Produces:
  - `projectInstanceTree(tree: TemplateSectionView[], offerings: {website: boolean, va: boolean, ppc: boolean}): { sections: SectionInstanceInput[], assetPlan: AssetPlanEntry[] }` where `SectionInstanceInput` mirrors the nested-create shape (section scalars + `subsections.create[]` + per-subsection `fields.create[]`, roster photos ALREADY null-stripped) and `AssetPlanEntry = { sectionKey: string, subsectionKey: string, refs: string[] }`.
  - `snapshotInstanceAssets(viewbookId: number, plan: AssetPlanEntry[]): Promise<void>` — best-effort phase 2.
  - `createViewbook(clientId, kind, createdBy, offerings?)` — offerings default `{website: true, va: false, ppc: false}`.
  - `offeringAvailability(tree): {website: boolean, va: boolean, ppc: boolean}` — an offering is available iff ≥1 active template subsection carries its tag.
- Consumes: `getTemplateTree()` (template-service), `extractInstanceAssetRefs` (Task 3), `readViewbookAsset`/`saveViewbookAsset`/`deleteViewbookAssets` (assets.ts).

- [ ] **Step 1: Failing projection tests** — build a fixture `TemplateSectionView[]` (3 sections: one website-only `main`, one with website+VA subsections, one VA-only; data-source-style section with 2 subsections × 2 fields):

```ts
// lib/viewbook/instance-snapshot.test.ts (representative assertions)
it('includes only sections with ≥1 offering-matching active subsection (D5)', () => {
  const { sections } = projectInstanceTree(tree, { website: true, va: false, ppc: false })
  expect(sections.map(s => s.sectionKey)).not.toContain('va-only-section')
})
it('filters subsections to matching offerings and carries fields with category = subsectionKey', () => { /* … */ })
it('null-strips roster photos into assetPlan (fix #8a)', () => {
  const { sections, assetPlan } = projectInstanceTree(treeWithPhotos, { website: true, va: false, ppc: false })
  const welcome = sections.find(s => s.sectionKey === 'welcome')!
  expect(welcome.subsections[0].contentJson).not.toContain('.webp')
  expect(assetPlan).toEqual([{ sectionKey: 'welcome', subsectionKey: 'main', refs: ['aaaa….webp'] }])
})
it('assessment starts hidden for new-build, active for upgrade (fix #12)', () => { /* state on the section input by kind */ })
it('skips archived template sections/subsections/fields', () => { /* … */ })
```

- [ ] **Step 2: Implement `instance-snapshot.ts`** — pure module: map template rows → instance inputs (`sectionKey = templateKey`, `templateVersion = section.version`, `sortOrder` copied, copy/content JSON strings copied verbatim EXCEPT welcome-renderer subsection content, which round-trips through `parseSubsectionContent` to null photos; state init: `assessment` + `new-build` → `'hidden'`, else `'active'`). Run → PASS.
- [ ] **Step 3: Rewrite `createViewbook`** — phase 1: ONE nested `prisma.viewbook.create` (offering flags + projected sections/subsections/fields + `DEFAULT_MILESTONES`) — remove Task 2's temporary seed; note nested create of fields under subsections needs `viewbookId` on both children: use nested `sections.create → subsections.create → fields.create` ONLY if Prisma can populate the composite scalars, otherwise (the reliable path — pin it): create the viewbook + sections nested, then ONE `$transaction([...])` of `createMany` for subsections then raw `INSERT … SELECT` for fields resolving `subsectionId` by `(viewbookId, sectionId, subsectionKey)` subselect. Phase 2: `await snapshotInstanceAssets(vb.id, assetPlan).catch(logError)` — per-plan-entry: read global file → save into `String(vb.id)` scope → `$transaction([bump-section-version-guarded-update, subsection contentJson UPDATE fenced on version])`; fence loss → delete new files, log. Validation: `offerings` with all three false → `HttpError(400, 'invalid_offerings')`; requested offering unavailable per `offeringAvailability` → `HttpError(409, 'offering_unavailable')`.
- [ ] **Step 4: Service tests** — extend `service.test.ts`: create seeds instance tree matching seeded templates (13 sections / 20 subsections / 35 fields for website); roster photos copied into viewbook scope + contentJson rewritten (assert files exist on disk + no `'global'`-era filename remains); phase-2 failure (mock `readViewbookAsset` throw) leaves photos null + viewbook intact; `offering_unavailable` on `{va: true, website: false}`.
- [ ] **Step 5: POST route + create form** — body gains optional `offerings` object (validated booleans); form gains three checkboxes, unavailable ones disabled from a new `availability` field on the existing viewbooks GET (serve `offeringAvailability(await getTemplateTree())`).
- [ ] **Step 6: Full viewbook suite + tsc** → green. Commit — `feat(viewbook): copy-on-create instance snapshot + offering flags at creation (Task 4)`

---

### Task 5: Instance content mutations (`instance-service.ts`) + aggregate fence

**Files:**
- Create: `lib/viewbook/instance-service.ts`
- Modify: `app/api/viewbooks/[id]/sections/[sectionKey]/route.ts` (PATCH gains instance-edit fields), `app/api/viewbooks/[id]/fields/route.ts` + `…/fields/[fieldId]/route.ts` (aggregate bump + archiveReason)
- Create: `app/api/viewbooks/[id]/subsections/[subId]/route.ts`
- Test: `lib/viewbook/instance-service.test.ts`

**Interfaces:**
- Produces (all single-surface, JSON-serializable ops — AI-readiness):
  - `patchSectionInstance(viewbookId, sectionKey, {version, title?, copy?}, updatedBy)` → refreshed section; 409 `version_conflict` via throwing guard.
  - `patchSubsectionInstance(viewbookId, subId, {version, title?, copy?, content?}, updatedBy)` — content validated by `parseSubsectionContent(rendererType, …)`; SAME txn bumps owning section `version` (aggregate fence) + scoped syncVersion.
  - `bumpSectionAggregate(sectionId, viewbookId)` raw-SQL statement factory used by every field/subsection mutation.
- Consumes: parsers from `template-content.ts`, `syncVersionBumpStatement` from `sync.ts`.

- [ ] **Step 1: Failing tests** — patch section copy → copyJson updated + section.version+1 + syncVersion+1; stale version → 409 + NOTHING changed (rollback pin); subsection content patch bumps BOTH subsection.version and section.version in one txn; invalid content shape → 400 `invalid_content`; custom-field create/archive bumps section aggregate and stamps `archiveReason: 'operator'` on archive; field DELETE route archive keeps value/amendments.
- [ ] **Step 2: Implement** — every mutation is ONE array txn: `[guardedSectionOrSubsectionUpdate(P2025 throw on version mismatch), bumpSectionAggregate(...), syncVersionBumpStatement(viewbookId)]`. `bumpSectionAggregate`:

```ts
export function bumpSectionAggregate(sectionId: number, viewbookId: number) {
  return prisma.$executeRaw`
    UPDATE "ViewbookSection" SET "version" = "version" + 1, "updatedAt" = ${Date.now()}
    WHERE "id" = ${sectionId} AND "viewbookId" = ${viewbookId}`
}
```

- [ ] **Step 3: Routes** — extend the existing section PATCH (state/introNote writes stay unfenced as today; presence of `title`/`copy` switches to the fenced instance path requiring `version`); new subsection PATCH; field routes add the aggregate-bump statement to their existing txns + `archiveReason`.
- [ ] **Step 4: Run suite + tsc → green. Commit** — `feat(viewbook): instance content mutations with aggregate section fence (Task 5)`

---

### Task 6: Pull — versioned per-section merge

**Files:**
- Modify: `lib/viewbook/instance-service.ts` (add `pullSectionFromTemplate`)
- Create: `app/api/viewbooks/[id]/sections/[sectionKey]/pull/route.ts`
- Test: `lib/viewbook/instance-pull.test.ts`

**Interfaces:**
- Produces: `pullSectionFromTemplate(viewbookId, sectionKey, expectedVersion, updatedBy)` → `{summary: {subsectionsAdded, subsectionsUpdated, subsectionsArchived, fieldsAdded, fieldsUpdated, fieldsArchived}, section}`; errors 409 `version_conflict` | `template_missing` | `template_archived`.
- Consumes: `projectInstanceTree` (single-section variant: export `projectSectionInstance(sectionView, offerings)` from instance-snapshot), `extractInstanceAssetRefs`, `bumpSectionAggregate`.

Implementation shape (all statements built AFTER reading current instance + template state; the aggregate `version` fence makes the read→txn window safe — any concurrent content mutation bumps it and the txn 409s):

1. Load section instance (+ live & archived subsections + this-section fields) and the template section tree. Precondition failures → HttpErrors.
2. Compute the merge diff in pure code → statement list.
3. Asset pre-copy: for template subsections whose content carries refs, copy global files → viewbook scope now; rewrite those contentJson strings in-memory with the new names.
4. ONE `$transaction([...])`:
   - Throwing guarded section UPDATE fenced on `version = expectedVersion` (sets title/rendererType/copyJson/contentJson/templateVersion, `version + 1`).
   - Per matched subsection: guarded UPDATE (overwrite scalars, clear archivedAt/archiveReason).
   - Per new subsection: `INSERT` (plain create — id unknown is fine for creates without dependents in the same txn) **except** when an existing field must re-parent into it: then `INSERT` first and re-parent via durable-key subselect (fix #3):

```ts
prisma.$executeRaw`
  UPDATE "ViewbookField" SET
    "subsectionId" = (SELECT s."id" FROM "ViewbookSubsection" s
      WHERE s."viewbookId" = ${viewbookId} AND s."sectionId" = ${sectionId} AND s."subsectionKey" = ${subKey}),
    "category" = ${subKey}, "label" = ${tf.label}, "sortOrder" = ${tf.sortOrder},
    "archivedAt" = CASE WHEN "archiveReason" = 'operator' THEN "archivedAt" ELSE NULL END,
    "archiveReason" = CASE WHEN "archiveReason" = 'operator' THEN "archiveReason" ELSE NULL END
  WHERE "viewbookId" = ${viewbookId} AND "defKey" = ${tf.fieldKey}`
```

   - Missing fields: `INSERT … SELECT` resolving subsectionId the same way (`createdBy: 'pull'`, version 0, value NULL).
   - Instance-only subsections / orphaned fields: UPDATE stamping `archivedAt`/`archiveReason: 'pull'` (operator-archived fields excluded by the CASE above).
   - `syncVersionBumpStatement(viewbookId)`.
5. Post-commit: compute the whole-viewbook post-commit asset union (`extractInstanceAssetRefs` over ALL subsections incl. archived); delete replaced files ONLY if absent from that union (fix #8c). Txn throw → delete the NEW files.

- [ ] **Step 1: Failing test matrix** (build template + instance fixtures directly with prisma):
  - value + amendments survive a pull that relabels/reorders a field
  - template-only subsection created WITH its fields; instance-only archived (`'pull'`)
  - field moved across subsections re-parents via subselect (assert same row id, new subsectionId)
  - field moved across SECTIONS: archived by pull(A), restored + re-parented by pull(B)
  - operator-archived field NOT restored
  - custom field (defKey null) untouched
  - stale `expectedVersion` → 409, zero changes (rollback pin)
  - concurrent-edit simulation: bump section version between read and txn → 409
  - equal-version pull repairs a photoless viewbook (photos null → files copied + contentJson rewritten)
  - replaced asset deleted ONLY when unreferenced by any other subsection (two subsections sharing a filename fixture)
  - `template_missing` (sectionTemplateId null) and `template_archived` → 409s
- [ ] **Step 2: Implement per the shape above. Run → PASS.**
- [ ] **Step 3: Route** — POST, body `{version: number}`, `withRoute`+`parseJsonBody`.
- [ ] **Step 4: Suite + tsc → green. Commit** — `feat(viewbook): versioned per-section template pull-merge (Task 6)`

---

### Task 7: Offerings PATCH — one fenced operation

**Files:**
- Modify: `lib/viewbook/instance-service.ts` (add `updateViewbookOfferings`)
- Create: `app/api/viewbooks/[id]/offerings/route.ts`
- Test: `lib/viewbook/instance-offerings.test.ts`

**Interfaces:**
- Produces: `updateViewbookOfferings(viewbookId, next: {website, va, ppc}, expected: {website, va, ppc}, updatedBy)`; errors 400 `invalid_offerings`, 409 `offerings_conflict` | `offering_unavailable`.
- Consumes: `projectInstanceTree`/`projectSectionInstance`, `offeringAvailability`, `snapshotInstanceAssets`, `bumpSectionAggregate`.

Implementation shape: read current flags + full instance tree + template tree → compute archive/restore/create sets in pure code → ONE `$transaction([...])` where EVERY statement carries the pre-state offering predicate (raw `WHERE … AND EXISTS (SELECT 1 FROM "Viewbook" v WHERE v."id" = ? AND v."offeringWebsite" = ? AND v."offeringVa" = ? AND v."offeringPpc" = ?)` with the `expected` values; the flag-update statement is a throwing guarded update on the same predicate) + one scoped syncVersion bump. Restores are `archivedAt = NULL, archiveReason = NULL` ONLY (frozen — no content overwrite); field restores exclude `archiveReason = 'operator'`. Creates come from the CURRENT template via the projection; their asset copies run as phase 2 after commit (degrade-to-null; equal-version pull repairs).

- [ ] **Step 1: Failing tests** — disable va→ archives va-exclusive subsections + fields (`'offering'`) + empty sections; multi-tag subsection (website+va) with website still on → NOT archived; re-enable restores FROZEN (a local content edit made before disable survives untouched — the fix-#5 pin) + does NOT restore operator-archived fields + creates template subsections added since; `expected` mismatch → 409 `offerings_conflict` + nothing changed; all-false → 400; enable ppc (no ppc templates) → 409 `offering_unavailable`; answers survive disable→enable round-trip; syncVersion +1 exactly once.
- [ ] **Step 2: Implement. Run → PASS. Step 3: Route. Step 4: Suite + tsc → green. Commit** — `feat(viewbook): offering enable/disable as one fenced operation (Task 7)`

---

### Task 8: `archivedAt` behavioral fences + completion set

**Files:**
- Modify: `lib/viewbook/ack.ts` (ack fence + `pcCompletedAt` requirement set + reset), `lib/viewbook/answers.ts`, `lib/viewbook/setup.ts`, `lib/viewbook/team-members.ts`, `lib/viewbook/public-writes.ts`, `lib/viewbook/collapse.ts`
- Test: extend each module's existing test file

**Interfaces:** none new — each existing write fence's SQL predicate gains `AND s."archivedAt" IS NULL` (section-scoped writes) / a subsection-archived join for field writes (`applyAnswerEdit`/`proposeAmendment`: the field's owning subsection AND section must be live).

- [ ] **Step 1: Failing tests per module** — e.g. `acknowledgeSection` on an archived section → `conflicting_ops`-class rejection identical to hidden; `applyAnswerEdit` on a field whose subsection is archived → rejected; `pcCompletedAt` computes with an archived `pc-invite` EXCLUDED from the requirement set (ack the remaining two → completes).
- [ ] **Step 2: Implement — locate each fence via `grep -n "state.*hidden\|<> 'hidden'" lib/viewbook/*.ts` and extend the SAME predicate (never a separate pre-read).** Run → PASS.
- [ ] **Step 3: Suite + tsc → green. Commit** — `feat(viewbook): archived instances are inert in every behavioral fence (Task 8)`

---

### Task 9: Asset allowlist + retention + delete-snapshot unions

**Files:**
- Modify: `app/api/viewbook/[token]/assets/[filename]/route.ts` (add live-subsection instance-ref lookup; REMOVE the global team-roster branch), `lib/viewbook/retention.ts` (5th lookup, archived-inclusive), `lib/viewbook/service.ts` (`deleteViewbook` + `collectClientViewbookAssetSnapshot` unions)
- Test: extend `app/api/viewbook/[token]/assets` route tests + `lib/viewbook/retention.test.ts` + `service.test.ts`

**Interfaces:** all three consume `extractInstanceAssetRefs` (Task 3) — ONE shared fixture across the three test files so a future producer can't register on one side only.

- [ ] **Step 1: Failing tests** — serving: instance roster photo serves for the owning token, 404s for another viewbook's token, 404s when its subsection is ARCHIVED (live-only serving); a global-scope roster filename now 404s on the public route. Retention: file referenced ONLY by an archived subsection is NOT pruned (fix #8b); unreferenced instance-scope file older than grace IS. Delete: `deleteViewbook` removes instance-referenced files (archived included).
- [ ] **Step 2: Implement.** Serving lookup: `prisma.viewbookSubsection.findMany({ where: { viewbookId, archivedAt: null }, select: { contentJson: true, section: { select: { rendererType: true, archivedAt: true } } } })` → refs; skip when parent section archived. Retention/delete: same query WITHOUT the archived filters. Run → PASS.
- [ ] **Step 3: Suite + tsc → green. Commit** — `feat(viewbook): instance asset refs join serving allowlist, retention and delete unions (Task 9)`

---

### Task 10: Read-model cutover — public payload + renderer switch + components + parity gate

**Files:**
- Modify: `lib/viewbook/public-data.ts`, `lib/viewbook/template-content.ts` (rename `BRIDGED_CONTENT` → `INSTANCE_CONTENT_SLOTS`, move from template-service), `app/(public)/viewbook/[token]/page.tsx` (switch on `section.rendererType`), `components/viewbook/public/SectionShell.tsx` + all 13 section components (title from payload; StrategySection/MilestonesSection drop override merge; WelcomeSection team from payload unchanged shape)
- Modify: `lib/viewbook/f2-parity.test.ts` (the REAL gate)
- Test: extend `lib/viewbook/public-data.test.ts`

**Interfaces:**
- Produces: `PublicSection` gains `title: string` + `rendererType: string`; `ViewbookPublicData.sectionCopy: Partial<Record<string, ResolvedSectionCopy>>` (typed by string key); `data.overrides` REMOVED; `data.global` shape unchanged, now assembled from instance content via `INSTANCE_CONTENT_SLOTS`.
- Consumes: instance columns (Task 2), `toLegacySectionCopy`/`parseSubsectionContent` (template-content.ts).

- [ ] **Step 1: Extend the parity test into the real gate**

```ts
// f2-parity.test.ts — final form
it('reproduces the pre-F2 payload for a fresh viewbook (both kinds)', async () => {
  await seedViewbookTemplates()
  for (const kind of ['new-build', 'upgrade'] as const) {
    const client = await prisma.client.create({ data: { name: `f2-parity-${crypto.randomUUID()}` } })
    const vb = await createViewbook(client.id, kind, 'parity@enrollmentresources.com')
    const data = await loadViewbookPublicData(vb.token)
    const normalized = normalizeParityPayload(data) as Record<string, unknown>
    const expected = structuredClone(fixture[kind]) as Record<string, unknown>
    // Pinned normalizations (spec §12): (a) overrides removed from the new payload;
    // (b) title/rendererType are deliberate additions; (c) photo filenames rewritten.
    delete expected.overrides
    stripAdditions(normalized) // removes .title/.rendererType from every section entry + normalizes photo filenames on BOTH sides (assert count separately)
    expect(normalized).toEqual(expected)
    await deleteViewbook(vb.id); await prisma.client.delete({ where: { id: client.id } })
  }
})
it('instance titles equal SECTION_TITLES for every seeded key (title-source swap invisible)', async () => { /* compare payload section titles to the const */ })
```

- [ ] **Step 2: Rewrite the content loads in `public-data.ts`** — sections query selects instance columns + live subsections (`archivedAt: null` both levels, section `state` filter unchanged); build `sectionCopy` (corrupt copyJson → `SECTION_COPY[key]` fallback for known keys + `logError`, else empty); build `global` via `INSTANCE_CONTENT_SLOTS`; delete `loadGlobal`/`loadOverrides`. Keep `guarded()` per block.
- [ ] **Step 3: Switch + components** — `baseRenderSection` keys on `section.rendererType`; `'generic'`/unknown → null (pinned F2 limitation); each component takes `title={section.title}`; remove `SECTION_TITLES` imports from all 13 + SectionShell; StrategySection/MilestonesSection drop `data.overrides[key]` merge lines.
- [ ] **Step 4: Run the parity gate + full component/public-data suites** → PASS (this is the spec's rendered-parity acceptance).
- [ ] **Step 5: tsc + full vitest → green. Commit** — `feat(viewbook): read-model cutover — viewer renders instance rows, parity-gated (Task 10)`

---

### Task 11: Admin cutover — `getViewbookAdmin` + ContentTab v2

**Files:**
- Modify: `lib/viewbook/service.ts` (`getViewbookAdmin`), `components/viewbook/admin/ContentTab.tsx` (rebuild), the admin DataTab sync-questions button (remove; locate via `grep -rn "sync-questions" components/`)
- Test: extend `lib/viewbook/service.test.ts` + ContentTab component test

**Interfaces:**
- Produces: `getViewbookAdmin` serves `sections: [{…instance columns…, currentTemplateVersion: number | null, subsections: [{…, decodedContent}]}]` (replaces `contentOverrides` + legacy sectionCopy resolve); ContentTab v2 = per-section copy form + block/pc-intro subsection content forms (reuse the F1b `SubsectionPanel` form pieces where they fit — inspect `components/viewbook/admin/templates/` first) + roster read-only + per-section Pull button (always enabled; badge when `templateVersion < currentTemplateVersion`; §6 confirmation dialog) + offerings checkboxes wired to Task 7's route.
- Consumes: Tasks 5/6/7 routes.

- [ ] **Step 1: Failing service test** — `getViewbookAdmin` returns instance tree + `currentTemplateVersion` join; no `contentOverrides` key.
- [ ] **Step 2: Implement service + rebuild ContentTab** (forms post to `PATCH sections/[sectionKey]` / `PATCH subsections/[subId]` / `POST …/pull` / `PATCH offerings`; 409 → refetch-and-notify pattern from the F1b editor). Remove the sync-questions button + its route call sites.
- [ ] **Step 3: Component test** — pull button renders badge state; confirm dialog fires before POST; offerings checkboxes disable unavailable options.
- [ ] **Step 4: Suite + tsc → green. Commit** — `feat(viewbook): admin content tab reads/writes instances; pull + offerings UI (Task 11)`

---

### Task 12: Operational roster reader + consumer migration

**Files:**
- Modify: `lib/viewbook/template-service.ts` (add `getTemplateTeamRoster()`), `components/viewbook/admin/CsmPicker.tsx`, `lib/viewbook/service.ts` (`assignViewbookCsm`), `lib/viewbook/email.ts` (`resolvePcCompleteRecipient`)
- Create: `app/api/viewbook-templates/team-roster/route.ts` (GET, cookie-gated)
- Test: extend `template-service.test.ts` + `csm-chip.test.ts`/`email.test.ts` equivalents

**Interfaces:**
- Produces: `getTemplateTeamRoster(): Promise<TeamMember[]>` — decodes the welcome-renderer `SubsectionTemplate.contentJson` roster (corrupt/absent → `[]` + `logError`); route returns `{team: TeamMember[]}`.
- Rationale pin: operational reads (who is a CSM NOW) use the CURRENT template roster — the freeze governs client-rendered content only (spec §11).

- [ ] **Step 1: Failing tests** — reader returns seeded roster; `assignViewbookCsm` validates `isCsm` against it; `resolvePcCompleteRecipient` resolves the CSM email from it; CsmPicker fetches the new route (component test swaps the fetch URL).
- [ ] **Step 2: Implement + migrate all three consumers.** Run → PASS.
- [ ] **Step 3: Suite + tsc → green. Commit** — `feat(viewbook): operational roster reads move to the template roster (Task 12)`

---

### Task 13: Legacy retirement — migration B + module/route deletion + seeder consts-only

**Files:**
- Delete: `app/api/viewbook-content/[key]/route.ts`, `app/api/viewbook-content/team-photo/route.ts`, `app/api/viewbooks/section-copy/[sectionKey]/route.ts`, `app/api/viewbooks/[id]/overrides/[contentKey]/route.ts`, `app/api/viewbooks/[id]/section-copy/[sectionKey]/route.ts`, `app/api/viewbooks/[id]/sync-questions/route.ts`, `lib/viewbook/section-copy-content.ts`, `lib/viewbook/global-content.ts`, `lib/viewbook/template-service.parity.test.ts`
- Modify: `lib/viewbook/template-service.ts` (delete bridged writers, legacy interleaves, `LEGACY_KEY_TARGET`, `reconcileSeededTemplates`; `attachTemplateTeamPhoto` becomes template-only owning the save→fenced-txn→delete-old file flow), `lib/viewbook/template-seed.ts` (consts-only projection — drop `ViewbookGlobalContent` reads), `instrumentation.ts` (drop reconcile call), `lib/viewbook/service.ts` (delete `syncCatalogQuestions`), `lib/viewbook/sync.ts` (delete `syncVersionBumpAllStatement`/`syncVersionBumpAllWhere` if consumer-free — verify via grep), `prisma/schema.prisma` (drop the two models)
- Create: `prisma/migrations/<ts>_drop_viewbook_legacy_stores/migration.sql`
- Test: re-pin `template-seed.test.ts` (consts-only), `template-service.test.ts` (bridge cases removed; photo flow re-pinned template-only), add a syncVersion-policy test

**Interfaces:** none new. Type imports of `ResolvedSectionCopy`/`SectionCopyContent` re-point to `section-copy-validator.ts`.

- [ ] **Step 1: Delete + migrate types/imports; `npx prisma migrate dev --name drop_viewbook_legacy_stores`; `rm -rf .test-dbs`.** The generated SQL should be exactly the two `DROP TABLE`s.
- [ ] **Step 2: `attachTemplateTeamPhoto` rewrite** — roster read/write against the welcome `SubsectionTemplate.contentJson` only; fenced on template `version`; file flow preserved (save NEW unique file → guarded txn → post-commit ENOENT-tolerant delete of the OLD file; 0-count → delete NEW file, 409).
- [ ] **Step 3: syncVersion policy test** — a template copy/content/photo edit bumps NO viewbook syncVersion; an instance edit/pull/offerings change bumps exactly its own.
- [ ] **Step 4: Grep gates** — `grep -rn "viewbookGlobalContent\|viewbookContentOverride" lib/ app/ components/ --include='*.ts*' | grep -v test` → EMPTY; `grep -rn "syncCatalogQuestions\|putContentOverride\|getGlobalContent" lib/ app/ components/` → EMPTY.
- [ ] **Step 5: Full gates — `npx tsc --noEmit && npx vitest run && npm run build` → green. Commit** — `feat(viewbook): retire legacy content stores, bridge and reconcile; template seeder goes consts-only (Task 13)`

---

### Task 14: Final review, gates, PR

- [ ] **Step 1: Self-review the whole branch** against spec §§4–12 (esp. the four asset seams share `extractInstanceAssetRefs`; every fence lists `archivedAt`; no interactive txns crept in: `grep -rn '\$transaction(async' lib/ app/` → empty).
- [ ] **Step 2: Full gates** — `npx tsc --noEmit && npx vitest run && npm run build`.
- [ ] **Step 3: PR** — body records: the two-migration deploy shape + the §11 old-build/new-schema window note (deploy off-hours); D4 wipe consequence (every open client link dies); §0/§15 Kevin sign-off checklist (offering archival, CSM roster source, equal-version refresh, wipe timing); deviations if any. Request Codex pre-merge review (roadmap §7 requires it for F2).
- [ ] **Step 4: STOP — do not merge.** Merge waits on Codex pre-merge review + Kevin's §0/§15 sign-offs.

---

## Self-review notes (spec coverage)

- §4 schema → Task 2; §5 snapshot/create → Tasks 3–4; §6 pull → Task 6 (aggregate fence from Task 5); §7 offerings + fences → Tasks 7–8; §8 assets → Tasks 3/4/6/9; §9 cutover → Tasks 10 (viewer) + 11 (admin) + 5 (mutation routes); §10 syncVersion → Tasks 5/13; §11 retirement + roster consumers → Tasks 12–13; §12 parity/testing → Tasks 1/10 + per-task suites; §0/§15 → Task 14 PR checklist.
- Deliberate residue: `SECTION_COPY`/`SECTION_TITLES`/`CATALOG` remain as seed inputs only; `collapsedShared` untouched; assessment-image delete-snapshot gap untouched (spec §8).
