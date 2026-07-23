# F1b — Viewbook Template Admin + Dual-Write Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `GlobalContentEditor`+`SectionCopyEditor` on `/viewbooks/settings` with a template editor over the F1a `SectionTemplate`/`SubsectionTemplate`/`FieldTemplate` trees, routed through ONE dual-write authority (`lib/viewbook/template-service.ts`) so template edits keep rendering via the legacy stores (and legacy routes forward-write templates — no drift in either direction), plus the one-time F1a→F1b `reconcileSeededTemplates()` boot pass.

**Architecture:** All absorbed-content writes — new template routes AND the still-callable legacy routes — compose ONE array-form `$transaction` in `template-service.ts`: template statement(s) + the corresponding legacy-row statement(s) + one syncVersion bump, with the house bump-first fence-sharing pattern (every conditional statement carries the SAME pre-state predicate; fenced statements run BEFORE the statement that changes what the fence reads). The existing `putGlobalContent`/`putSectionCopyGlobal` transaction owners are refactored into pure statement builders (extraction, not wrapping). `attachTeamPhoto` stays the SINGLE file-save/fence/delete-old authority — it gains an injected txn-builder seam instead of a second flow. Template-route mutations are optimistic-`version`-fenced (409 `version_conflict`, aggregate section version); legacy-route forward-writes are unconditional last-writer-wins with drift logging. NO schema migration.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-22-f1-viewbook-template-library-design.md` §7 (Codex-reviewed, 15 fixes applied; F1b implements fixes #1–#4 + the §3 aggregate-version rule #12). F1a module inventory: `docs/superpowers/archive/plans/2026-07-22-f1a-viewbook-template-library.md`.

## Resolved decisions (spec + this plan)

- **Bridge shape (spec fix #2/#3, Codex-ruled):** read-only legacy editors were REJECTED; the accepted shape is single-service dual-write. The bridge is deleted whole in F2 (one seam: the legacy statement builders + their `template-service.ts` call sites).
- **Reconcile (spec fix #1):** one-time, marker row `ViewbookGlobalContent` key `template-library:reconciled`; only re-projects trees untouched since seed (`version === 1` at section AND every subsection AND every field); runs AFTER the seeder at boot.
- **Team-photo order (spec fix #4):** save NEW file → ONE fenced txn (legacy roster + template subsection content + syncVersion) → best-effort delete OLD file; conflict deletes the NEW file (409). Orphan-file-on-crash acceptable.
- **Section CREATE/DELETE is NOT in F1b** (F5b). Subsection/field CREATE is (fieldKey operator-entered, `FIELD_KEY_RE`-validated, immutable; archive-never-delete).
- **Title edits back-write nothing** — the editor labels title fields "applies after template cutover (F2)". Same for subsection copy (`copyJson` — no legacy target exists).
- **Plan decision D-a (version token):** every template mutation carries the SECTION's aggregate `version` as the optimistic token (the tree GET supplies it; any concurrent subtree change invalidates the whole panel — simplest honest token; per §3 every subtree mutation bumps it anyway).
- **Plan decision D-b (content-shape rule):** subsection `contentJson` validates as (1) the section's renderer shape for the four BRIDGED seeded pairs (`welcome/main`, `strategy/main`, `milestones/main`, `pc-intro/main`); (2) REJECTED (400) for other SEEDED subsections (contentless `main`s and the 8 `data-source` category subsections — nothing renders content there, ever); (3) the `generic` `{v:1, blocks}` shape for every operator-created subsection (the VA/PPC content-entry path; per spec §4 "generic subsections").
- **Plan decision D-c (forward-write misses):** on the legacy path, a template statement matching 0 rows (missing/edited-away template row, corrupt-envelope fence miss) NEVER fails the legacy write — it is logged (`logError`, op `template-forward-write-miss`) as visible drift. On the template path, fence misses are hard 409s.
- **Plan decision D-d (reorder partiality):** reorder = one array txn of per-section guarded UPDATEs fenced on each touched section's expected version, 409 on any 0-count (spec §3 verbatim). Because array txns don't roll back on 0-count, a conflicting reorder can commit PARTIAL sortOrder movement — harmless (sortOrder is presentation-only, versions stay honest); the client MUST refetch the tree on 409, and the UI only ever reorders two adjacent sections per call.
- **Plan decision D-e (syncVersion):** bridged writes (section copy, the four bridged content pairs, team photo) bump syncVersion — they change what clients render. Template-only writes (title, subsection copy, offerings, fields, reorder, generic content, archive) do NOT — nothing renders templates until F2.

## Global Constraints

- Array-form `$transaction([...])` only; conditional logic in SQL (`EXISTS`); raw SQL sets `updatedAt` manually (`Date.now()` — integer ms).
- Bump-first fence-sharing (house pattern, `lib/viewbook/sync.ts` header): a predicated companion statement carries the SAME self-contained pre-state predicate as the domain statement and is placed BEFORE any statement that changes what that predicate reads.
- Template JSON columns always carry `{v:1,…}` envelopes; parse via `lib/viewbook/template-content.ts` (whole-doc-reject); legacy rows get the exact legacy shapes via `toLegacySectionCopy`/`toLegacyGlobalBody` — envelopes never leak into legacy rows.
- Legacy behavior stays byte-identical: `putGlobalContent`/`putTeamRoster`/`attachTeamPhoto`/`putSectionCopyGlobal`/`deleteSectionCopyGlobal` keep their exact signatures, validation, error codes, and fence semantics — their existing tests are the net and must stay green UNCHANGED (except the routes' service-import swap in Task 6).
- `attachTeamPhoto` remains the ONLY file-save/fence/delete-old authority for team photos — no second flow.
- `FieldTemplate.fieldKey` is LIBRARY-GLOBAL unique, immutable after create, format `FIELD_KEY_RE = /^[a-z0-9][a-z0-9-]{1,63}$/` (already exported by `template-content.ts`). `subsectionKey` uses the same regex.
- New routes live under cookie-gated `/api/viewbook-templates/…` — NO `middleware.ts` change; every handler calls `requireOperatorEmail` (precedent: `/api/viewbook-content/[key]`). `withRoute` + `parseJsonBody` everywhere except the multipart photo route (`formData`, `requireBoundedContentLength`, `fileBufferFromForm`).
- No `ViewbookActivity` writes (legacy content writes don't log activity today; F1b matches). If any future step adds one, it needs `actorKind: 'operator'` (U1 contract).
- NO schema change, NO migration, NO new env vars.
- Gates per PR: `npx tsc --noEmit` clean + full `npx vitest run` + `npm run build` (local gates are the ONLY gate).
- Worktree (no schema touch → symlink is safe): `git worktree add .claude/worktrees/f1b-template-admin -b feat/f1b-viewbook-template-admin origin/main && ln -s "$(pwd)/node_modules" .claude/worktrees/f1b-template-admin/node_modules && cp .env .claude/worktrees/f1b-template-admin/.env` then fix the copied `.env`: `DATABASE_URL=file:./local-dev.db`, `UPLOADS_DIR=./local-uploads` (never copy `.env.local`).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/viewbook/template-content.ts` (modify) | + `parseSubsectionCopy` (`{v:1, copy:{intro, whatWeNeed}}`, spec §3 comment shape) |
| `lib/viewbook/section-copy-content.ts` (modify) | `putSectionCopyGlobalStatements`/`deleteSectionCopyGlobalStatements` pure builders; legacy fns re-compose |
| `lib/viewbook/global-content.ts` (modify) | `putGlobalContentStatements`, `buildTeamRosterWrite`, exported `teamRosterFence`; `attachTeamPhoto` txn-builder seam |
| `lib/viewbook/template-seed.ts` (modify) | export `projectMainContentJson` + `seedTreeCreateData` (extracted, behavior-identical) |
| `lib/viewbook/template-service.ts` (create) | THE dual-write authority: tree read, all template mutations, bridged legacy writes, photo flows, `reconcileSeededTemplates` |
| `lib/viewbook/template-service.test.ts` (create) | DB-backed service suite |
| `lib/viewbook/template-service.parity.test.ts` (create) | F1a-deferred bridge-parity acceptance + reconcile one-time-ness |
| `instrumentation.ts` (modify) | invoke `reconcileSeededTemplates()` right after the seeder |
| `app/api/viewbook-templates/route.ts` (create) | GET tree |
| `app/api/viewbook-templates/sections/[id]/route.ts` (create) | PATCH section (title/copy) |
| `app/api/viewbook-templates/sections/[id]/subsections/route.ts` (create) | POST create subsection |
| `app/api/viewbook-templates/sections/[id]/subsections/[subId]/route.ts` (create) | PATCH subsection |
| `app/api/viewbook-templates/sections/[id]/photo/route.ts` (create) | POST multipart team photo (version-fenced) |
| `app/api/viewbook-templates/subsections/[id]/fields/route.ts` (create) | POST create field |
| `app/api/viewbook-templates/subsections/[id]/fields/[fieldId]/route.ts` (create) | PATCH field |
| `app/api/viewbook-templates/reorder/route.ts` (create) | POST reorder sections |
| `app/api/viewbook-templates/template-routes.test.ts` (create) | route-level suite (auth, envelope, error codes) |
| `app/api/viewbook-content/[key]/route.ts` (modify) | PUT → `putGlobalContentBridged` |
| `app/api/viewbook-content/team-photo/route.ts` (modify) | POST → `attachTeamPhotoBridged` |
| `app/api/viewbooks/section-copy/[sectionKey]/route.ts` (modify) | PUT/DELETE → bridged variants |
| `components/viewbook/admin/CsmPicker.tsx` (create) | `CsmPicker` MOVED verbatim out of GlobalContentEditor.tsx |
| `components/viewbook/admin/ViewbookEditor.tsx` (modify) | import CsmPicker from its new home |
| `components/viewbook/admin/templates/TemplateEditor.tsx` (create) | loader, section list, reorder, 409-refetch discipline |
| `components/viewbook/admin/templates/SectionPanel.tsx` (create) | title+copy form, subsection list, add-subsection |
| `components/viewbook/admin/templates/SubsectionPanel.tsx` (create) | offerings, subsection copy, content forms (roster/blocks/intro/generic), archive |
| `components/viewbook/admin/templates/FieldGrid.tsx` (create) | data-source field grid + add-field |
| `components/viewbook/admin/templates/template-editor-types.ts` (create) | client-safe tree payload types shared by components |
| `components/viewbook/admin/templates/TemplateEditor.test.tsx` (create) | component suite |
| `app/(app)/viewbooks/settings/page.tsx` (modify) | render `TemplateEditor` + `StrategyDocsCard`; drop legacy editors |
| `components/viewbook/admin/GlobalContentEditor.tsx` + `.test.tsx` (delete) | replaced (CsmPicker moved out first) |
| `components/viewbook/admin/SectionCopyEditor.tsx` + `.test.tsx` (delete) | replaced |

---

### Task 1: `parseSubsectionCopy` in `template-content.ts`

**Files:**
- Modify: `lib/viewbook/template-content.ts`
- Test: `lib/viewbook/template-content.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
export const SUBSECTION_COPY_CAPS = { intro: 600, whatWeNeed: 600 }
export interface SubsectionCopyV1 { v: 1; copy: { intro: string | null; whatWeNeed: string | null } }
export function parseSubsectionCopy(raw: string | null): SubsectionCopyV1 | null
```

- [ ] **Step 1: Write the failing tests** (append a `describe('parseSubsectionCopy')` to the existing suite):

```ts
describe('parseSubsectionCopy', () => {
  const enc = (v: unknown) => JSON.stringify(v)
  it('accepts the exact envelope and normalizes blank strings to null', () => {
    expect(parseSubsectionCopy(enc({ v: 1, copy: { intro: 'Hi', whatWeNeed: '  ' } })))
      .toEqual({ v: 1, copy: { intro: 'Hi', whatWeNeed: null } })
    expect(parseSubsectionCopy(enc({ v: 1, copy: { intro: null, whatWeNeed: 'Logo files' } })))
      .toEqual({ v: 1, copy: { intro: null, whatWeNeed: 'Logo files' } })
  })
  it('whole-doc-rejects deviations', () => {
    expect(parseSubsectionCopy(null)).toBeNull()
    expect(parseSubsectionCopy('not json')).toBeNull()
    expect(parseSubsectionCopy(enc({ v: 2, copy: { intro: null, whatWeNeed: null } }))).toBeNull()
    expect(parseSubsectionCopy(enc({ v: 1, copy: { intro: null } }))).toBeNull()               // missing key
    expect(parseSubsectionCopy(enc({ v: 1, copy: { intro: null, whatWeNeed: null, x: 1 } }))).toBeNull() // extra key
    expect(parseSubsectionCopy(enc({ v: 1, copy: { intro: 7, whatWeNeed: null } }))).toBeNull()
    expect(parseSubsectionCopy(enc({ v: 1, copy: { intro: 'a'.repeat(601), whatWeNeed: null } }))).toBeNull()
    expect(parseSubsectionCopy(enc({ v: 1, copy: { intro: null, whatWeNeed: null }, extra: 1 }))).toBeNull()
  })
})
```

- [ ] **Step 2:** Run `npx vitest run lib/viewbook/template-content.test.ts` → FAIL (`parseSubsectionCopy` not exported).
- [ ] **Step 3: Implement** (below `parseTemplateCopy`, reusing `parseEnvelope`):

```ts
export const SUBSECTION_COPY_CAPS = { intro: 600, whatWeNeed: 600 }

export interface SubsectionCopyV1 { v: 1; copy: { intro: string | null; whatWeNeed: string | null } }

// Subsection heading+copy (spec §3 comment: {v:1, copy:{intro?, whatWeNeed?}};
// D6 — a subsection has its own copy). No legacy target exists — this shape is
// template-only until F2 renders it. Blank strings normalize to null (mirrors
// validateSectionCopy's whatWeNeed normalization).
export function parseSubsectionCopy(raw: string | null): SubsectionCopyV1 | null {
  const parsed = parseEnvelope(raw)
  if (parsed === null) return null
  if (Object.keys(parsed).length !== 2) return null
  if (!isPlainObject(parsed.copy)) return null
  const keys = Object.keys(parsed.copy)
  if (keys.length !== 2) return null
  const { intro, whatWeNeed } = parsed.copy
  if (intro !== null && (typeof intro !== 'string' || intro.length > SUBSECTION_COPY_CAPS.intro)) return null
  if (whatWeNeed !== null && (typeof whatWeNeed !== 'string' || whatWeNeed.length > SUBSECTION_COPY_CAPS.whatWeNeed)) return null
  const norm = (s: string | null) => (typeof s === 'string' && s.trim().length > 0 ? s : null)
  return { v: 1, copy: { intro: norm(intro as string | null), whatWeNeed: norm(whatWeNeed as string | null) } }
}
```

- [ ] **Step 4:** Run the suite → PASS.
- [ ] **Step 5: Commit** — `git add lib/viewbook/template-content.ts lib/viewbook/template-content.test.ts && git commit -m "feat(viewbook): parseSubsectionCopy envelope parser (F1b)"`

---

### Task 2: Legacy statement-builder extraction (spec fixes #2/#3 — extraction, not wrapping)

**Files:**
- Modify: `lib/viewbook/section-copy-content.ts`, `lib/viewbook/global-content.ts`, `lib/viewbook/template-seed.ts`
- Test: `lib/viewbook/section-copy-content.store.test.ts` + `lib/viewbook/global-content.test.ts` (existing — must stay green UNCHANGED), plus new builder assertions appended to `lib/viewbook/global-content.test.ts`

**Interfaces:**
- Produces (consumed by Task 3–6):

```ts
// section-copy-content.ts
export function putSectionCopyGlobalStatements(sectionKey: SectionKey, validated: SectionCopyContent, updatedBy: string): Prisma.PrismaPromise<unknown>[]  // [upsert, syncVersionBumpAllStatement()]
export function deleteSectionCopyGlobalStatements(sectionKey: SectionKey): { statements: Prisma.PrismaPromise<unknown>[]; deleteIndex: number }  // [bumpAllWhere(fence), deleteMany]; caller 404s on results[deleteIndex].count === 0

// global-content.ts
export function teamRosterFence(bodyJson: string): Prisma.Sql            // was private — export as-is
export function putGlobalContentStatements(key: GlobalContentKey, validated: ContentBlocks | string, updatedBy: string): Prisma.PrismaPromise<unknown>[]  // non-team keys only: [upsert, bumpAll]; throws HttpError(400) on key === 'team'
export interface TeamRosterWrite {
  bodyJson: string; next: TeamMember[]; orphaned: string[]
  statements: Prisma.PrismaPromise<unknown>[]
  conflictIndex: number | null  // index of the fenced updateMany whose count===0 means 409 roster_conflict; null on the create path
}
export function buildTeamRosterWrite(row: { bodyJson: string } | null, incoming: TeamMember[], updatedBy: string): TeamRosterWrite

// template-seed.ts (pure extraction, behavior-identical)
export function projectMainContentJson(key: SectionKey, globalRows: SeedSourceRow[], issues: SeedIssue[]): string | null  // = the existing private mainContentJson, exported
export function seedTreeCreateData(tree: SeedSectionTree): Prisma.SectionTemplateCreateInput  // the exact nested-create `data` object createSeedTree passes; createSeedTree becomes prisma.sectionTemplate.create({ data: seedTreeCreateData(tree) })
```

- [ ] **Step 1: Write the failing builder tests** (append to `lib/viewbook/global-content.test.ts`, following its existing DB-backed conventions):

```ts
describe('statement builders (F1b extraction)', () => {
  it('putGlobalContentStatements composes inside a caller-owned transaction', async () => {
    await prisma.$transaction(putGlobalContentStatements('process', { blocks: [{ heading: 'H', body: 'B' }] }, 'op@er.com'))
    const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'process' } })
    expect(JSON.parse(row!.bodyJson)).toEqual({ blocks: [{ heading: 'H', body: 'B' }] })
  })
  it('putGlobalContentStatements rejects team (roster has its own builder)', () => {
    expect(() => putGlobalContentStatements('team', [], 'op@er.com')).toThrow()
  })
  it('buildTeamRosterWrite re-derives photos by name and reports the conflict index', async () => {
    await prisma.viewbookGlobalContent.create({ data: { key: 'team', bodyJson: JSON.stringify([{ name: 'A', role: 'R', photo: 'a.webp', blurb: '' }]), updatedBy: 'x' } })
    const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'team' } })
    const write = buildTeamRosterWrite(row!, [{ name: 'A', role: 'R2', photo: null, blurb: '' }], 'op@er.com')
    expect(write.next[0].photo).toBe('a.webp')      // incoming photo ignored, re-derived
    expect(write.conflictIndex).not.toBeNull()
    const results = await prisma.$transaction(write.statements)
    expect((results[write.conflictIndex!] as { count: number }).count).toBe(1)
  })
})
```

- [ ] **Step 2:** Run `npx vitest run lib/viewbook/global-content.test.ts` → FAIL (builders not exported).
- [ ] **Step 3: Refactor `section-copy-content.ts`.** Move the transaction bodies out; the legacy functions re-compose:

```ts
export function putSectionCopyGlobalStatements(sectionKey: SectionKey, validated: SectionCopyContent, updatedBy: string): Prisma.PrismaPromise<unknown>[] {
  const key = sectionCopyKey(sectionKey)
  const bodyJson = JSON.stringify(validated)
  return [
    prisma.viewbookGlobalContent.upsert({
      where: { key },
      update: { bodyJson, updatedBy },
      create: { key, bodyJson, updatedBy },
    }),
    syncVersionBumpAllStatement(),
  ]
}

export function deleteSectionCopyGlobalStatements(sectionKey: SectionKey): { statements: Prisma.PrismaPromise<unknown>[]; deleteIndex: number } {
  const key = sectionCopyKey(sectionKey)
  const fence = Prisma.sql`EXISTS (SELECT 1 FROM "ViewbookGlobalContent" WHERE "key" = ${key})`
  return { statements: [syncVersionBumpAllWhere(fence), prisma.viewbookGlobalContent.deleteMany({ where: { key } })], deleteIndex: 1 }
}
```

`putSectionCopyGlobal` keeps its validation + `throw HttpError(400, 'invalid_content')` and ends with `await prisma.$transaction(putSectionCopyGlobalStatements(sectionKey, validated, updatedBy))`. `deleteSectionCopyGlobal` keeps its validation, destructures the builder, runs the txn, and keeps `if (res.count === 0) throw new HttpError(404, 'not_found')` reading `results[deleteIndex]`.
- [ ] **Step 4: Refactor `global-content.ts`.** Export `teamRosterFence` (add `export` — no body change). Extract `putGlobalContentStatements` (the non-team upsert+bump pair, verbatim from `putGlobalContent`; `if (key === 'team') throw new HttpError(400, 'invalid_content')`). Extract `buildTeamRosterWrite` from `putTeamRoster`'s body — it holds the stored-roster parse, photo re-derivation by name, orphan computation, and returns either the create pair (`conflictIndex: null`) or the fenced pair (`conflictIndex: 1`, statements `[syncVersionBumpAllWhere(fence), updateMany]`). `putTeamRoster` becomes: load row → `buildTeamRosterWrite` → txn → conflict check → orphan delete. Behavior identical — the assertions in the EXISTING suite are the proof.
- [ ] **Step 5: Extract in `template-seed.ts`:** rename the private `mainContentJson` to exported `projectMainContentJson` (same signature — update its two internal call sites); extract `seedTreeCreateData(tree)` returning the exact `data` object, `createSeedTree` calls `prisma.sectionTemplate.create({ data: seedTreeCreateData(tree) })`. No behavior change; existing seed + parity suites are the proof.
- [ ] **Step 6:** `npx vitest run lib/viewbook` → ALL green (existing suites unchanged + new builder tests). `npx tsc --noEmit` → clean.
- [ ] **Step 7: Commit** — `git add lib/viewbook/section-copy-content.ts lib/viewbook/global-content.ts lib/viewbook/global-content.test.ts lib/viewbook/template-seed.ts && git commit -m "refactor(viewbook): extract legacy content writers into pure statement builders (F1b, spec fixes 2-3)"`

---

### Task 3: `template-service.ts` — tree read + section mutations + reorder

**Files:**
- Create: `lib/viewbook/template-service.ts`
- Test: `lib/viewbook/template-service.test.ts`

**Interfaces:**
- Consumes: Task 1–2 builders/parsers; `parseTemplateCopy`/`parseSubsectionContent`/`parseSubsectionCopy`/`toLegacyGlobalBody` (`./template-content`); `validateSectionCopy` (`./section-copy-validator`); `SECTION_COPY` (`./section-copy`); `SECTION_KEYS` (`./theme`); `CATALOG_CATEGORIES` (`./catalog`); `logError` (`@/lib/log`).
- Produces (exact — later tasks and all routes rely on these):

```ts
// The four bridged (templateKey, 'main') content pairs and their legacy keys.
export const BRIDGED_CONTENT: Record<string, { parts: Record<string, GlobalContentKey> }> = {
  welcome:    { parts: { team: 'team', process: 'process', why: 'why' } },
  strategy:   { parts: { seoBase: 'seo-base', geoBase: 'geo-base', eeatBase: 'eeat-base' } },
  milestones: { parts: { processMilestones: 'process-milestones' } },
  'pc-intro': { parts: { intro: 'pc-intro' } },
}
export type ContentKind = 'welcome' | 'strategy' | 'milestones' | 'pc-intro' | 'generic' | 'none'

export interface TemplateFieldView { id: number; fieldKey: string; label: string; fieldType: string; sortOrder: number; version: number; archivedAt: string | null }
export interface TemplateSubsectionView {
  id: number; subsectionKey: string; title: string
  offeringWebsite: boolean; offeringVa: boolean; offeringPpc: boolean
  copy: { intro: string | null; whatWeNeed: string | null } | null
  content: SubsectionContentV1 | null   // decoded; null when absent OR corrupt
  contentKind: ContentKind
  sortOrder: number; version: number; archivedAt: string | null
  fields: TemplateFieldView[]
}
export interface TemplateSectionView {
  id: number; templateKey: string; rendererType: string; title: string
  copy: SectionCopyContent | null       // decoded from copyJson; null = corrupt (UI shows a warning, not a form)
  sortOrder: number; version: number; archivedAt: string | null
  subsections: TemplateSubsectionView[]
}
export async function getTemplateTree(): Promise<{ sections: TemplateSectionView[] }>

export async function patchSectionTemplate(sectionId: number, input: { version: number; title?: string; copy?: unknown }, updatedBy: string): Promise<void>
export async function reorderSections(items: Array<{ id: number; version: number; sortOrder: number }>): Promise<void>
```

**Semantics to implement:**
- `getTemplateTree`: one `findMany` with nested `subsections.fields`, all three levels `orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]`; decode copy/content per row (`parseTemplateCopy(...)?.copy ?? null`, `parseSubsectionCopy`, `parseSubsectionContent(section.rendererType, …)` for bridged pairs / `parseSubsectionContent('generic', …)` for operator-created subsections); `contentKind` per plan decision D-b (`BRIDGED_CONTENT[templateKey]` + `subsectionKey === 'main'` → the templateKey as kind; other `main`s and `data-source` category keys (`CATALOG_CATEGORIES`) → `'none'`; else `'generic'`).
- `patchSectionTemplate`: at least one of title/copy required (400 `invalid_content`); load the row (404 `not_found`); when `copy` present → `validateSectionCopy(input.copy)` (400 on null). Statements, bump-first fence-shared on `(id, version)`:
  - copy present AND `templateKey` is a `SectionKey` (all 13 seeded are): fenced legacy upsert as raw SQL (an unconditional upsert would commit even when the version fence misses — bridge writes must share the fence):

```ts
const now = Date.now()
const legacyKey = sectionCopyKey(templateKey)
const legacyBody = JSON.stringify(validatedCopy)
const versionFence = Prisma.sql`EXISTS (SELECT 1 FROM "SectionTemplate" WHERE "id" = ${sectionId} AND "version" = ${input.version})`
const statements = [
  prisma.$executeRaw`
    INSERT INTO "ViewbookGlobalContent" ("key", "bodyJson", "updatedBy", "updatedAt")
    SELECT ${legacyKey}, ${legacyBody}, ${updatedBy}, ${now}
    WHERE ${versionFence}
    ON CONFLICT ("key") DO UPDATE SET "bodyJson" = excluded."bodyJson", "updatedBy" = excluded."updatedBy", "updatedAt" = excluded."updatedAt"`,
  syncVersionBumpAllWhere(versionFence),
  prisma.sectionTemplate.updateMany({
    where: { id: sectionId, version: input.version },
    data: { ...(input.title !== undefined ? { title: input.title } : {}), copyJson: JSON.stringify({ v: 1, copy: validatedCopy }), version: { increment: 1 } },
  }),
]
```

  - title-only: just the fenced `updateMany` (no legacy statement, no syncVersion bump — plan decisions "titles back-write nothing" + D-e).
  - After the txn: the `updateMany` count `0` → `throw new HttpError(409, 'version_conflict')`. Title validation: non-empty string ≤ 200 chars (400).
- `reorderSections`: validate items non-empty, unique ids, sortOrder ints; txn = `items.map(i => prisma.sectionTemplate.updateMany({ where: { id: i.id, version: i.version }, data: { sortOrder: i.sortOrder, version: { increment: 1 } } }))`; any count 0 → 409 `version_conflict` (plan decision D-d).

- [ ] **Step 1: Write the failing tests** (DB-backed; follow `template-seed.test.ts` conventions — seed via `seedViewbookTemplates()` in `beforeEach` against a fresh test DB):

```ts
describe('getTemplateTree', () => {
  it('returns 13 sections in sortOrder with decoded copy and contentKind', async () => {
    const { sections } = await getTemplateTree()
    expect(sections.map(s => s.templateKey)).toEqual([...CANONICAL_SECTION_ORDER])
    const welcome = sections.find(s => s.templateKey === 'welcome')!
    expect(welcome.copy).toEqual(resolveSectionCopy('welcome', null, null))
    expect(welcome.subsections[0].contentKind).toBe('welcome')
    const brand = sections.find(s => s.templateKey === 'brand')!
    expect(brand.subsections[0].contentKind).toBe('none')
    const ds = sections.find(s => s.templateKey === 'data-source')!
    expect(ds.subsections).toHaveLength(8)
    expect(ds.subsections.every(s => s.contentKind === 'none')).toBe(true)
    expect(ds.subsections.flatMap(s => s.fields)).toHaveLength(CATALOG.length)
  })
})
describe('patchSectionTemplate', () => {
  it('copy edit dual-writes the legacy section-copy row and bumps version + syncVersion', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'brand')!
    const copy = { purpose: 'New purpose', whatThis: 'New what', whatWeNeed: null }
    await patchSectionTemplate(s.id, { version: s.version, copy }, 'op@er.com')
    const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'section-copy:brand' } })
    expect(validateSectionCopy(JSON.parse(row!.bodyJson))).toEqual(copy)
    const after = await prisma.sectionTemplate.findUnique({ where: { id: s.id } })
    expect(after!.version).toBe(s.version + 1)
    expect(toLegacySectionCopy(parseTemplateCopy(after!.copyJson)!)).toEqual(copy)
  })
  it('stale version → 409 AND no legacy write (fence shared)', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'brand')!
    const copy = { purpose: 'P', whatThis: 'W', whatWeNeed: null }
    await expect(patchSectionTemplate(s.id, { version: s.version + 5, copy }, 'op@er.com'))
      .rejects.toMatchObject({ status: 409 })
    expect(await prisma.viewbookGlobalContent.findUnique({ where: { key: 'section-copy:brand' } })).toBeNull()
  })
  it('title-only edit back-writes nothing', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'materials')!
    await patchSectionTemplate(s.id, { version: s.version, title: 'Materials & assets' }, 'op@er.com')
    expect(await prisma.viewbookGlobalContent.findUnique({ where: { key: 'section-copy:materials' } })).toBeNull()
  })
})
describe('reorderSections', () => {
  it('swaps two adjacent sections and bumps both versions; stale version 409s', async () => {
    const { sections } = await getTemplateTree()
    const [a, b] = sections
    await reorderSections([
      { id: a.id, version: a.version, sortOrder: b.sortOrder },
      { id: b.id, version: b.version, sortOrder: a.sortOrder },
    ])
    const after = await getTemplateTree()
    expect(after.sections[0].id).toBe(b.id)
    await expect(reorderSections([{ id: a.id, version: a.version, sortOrder: 5 }]))
      .rejects.toMatchObject({ status: 409 })  // a's version already bumped
  })
})
```

- [ ] **Step 2:** Run `npx vitest run lib/viewbook/template-service.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `getTemplateTree`, `patchSectionTemplate`, `reorderSections` per the semantics above (module header comment: "THE single dual-write authority (spec §7 fixes #2/#3). Deleted whole in F2.").
- [ ] **Step 4:** Run the suite → PASS.
- [ ] **Step 5: Commit** — `git add lib/viewbook/template-service.ts lib/viewbook/template-service.test.ts && git commit -m "feat(viewbook): template-service tree read, section patch bridge, reorder (F1b)"`

---

### Task 4: Subsection + field mutations (content bridge, creates, archive)

**Files:**
- Modify: `lib/viewbook/template-service.ts`
- Test: `lib/viewbook/template-service.test.ts` (extend)

**Interfaces:**
- Produces:

```ts
export async function createSubsection(sectionId: number, input: { subsectionKey: string; title: string; offeringWebsite?: boolean; offeringVa?: boolean; offeringPpc?: boolean; copy?: unknown; content?: unknown }, updatedBy: string): Promise<void>
export async function patchSubsection(subId: number, input: { version: number; title?: string; offeringWebsite?: boolean; offeringVa?: boolean; offeringPpc?: boolean; copy?: unknown | null; content?: unknown | null; archived?: boolean }, updatedBy: string): Promise<void>
export async function createField(subsectionId: number, input: { fieldKey: string; label: string; fieldType: string }, updatedBy: string): Promise<void>
export async function patchField(fieldId: number, input: { version: number; label?: string; sortOrder?: number; archived?: boolean }, updatedBy: string): Promise<void>
```

**Semantics to implement:**
- **`patchSubsection`** — load sub + parent section (404). Determine `contentKind` (same rule as the tree). Validate:
  - `copy`: `null` clears (`copyJson: null`); otherwise build `{ v: 1, copy: input.copy }`, validate via `parseSubsectionCopy(JSON.stringify(...))` → 400 on null.
  - `content` with kind `'none'` and content ≠ undefined/null → 400 `invalid_content` (plan decision D-b(2)).
  - `content` with kind `'generic'`: build `{ v: 1, blocks: … }` — accept the client's `{ blocks }` object, validate via `parseSubsectionContent('generic', JSON.stringify({ v: 1, ...input.content }))` → 400 on null.
  - `content` with a BRIDGED kind: same envelope-validate against the section's rendererType. For `welcome`, apply the roster photo-preservation rule BEFORE anything else: load the legacy `team` row, parse+validate its stored roster (corrupt → `[]`), re-derive each incoming member's `photo` from the stored roster by name (exactly `buildTeamRosterWrite`'s rule — reuse the same derivation by calling a small exported helper extracted in Task 2 if needed, or inline the two-line map; the DERIVED roster replaces `content.team` in both the template envelope and the legacy row). Orphaned photos of removed members are best-effort deleted after commit (`deleteViewbookAssets('global', orphaned)`), mirroring `putTeamRoster`.
  - Statements (bump-first; every statement shares the version fence `versionFence = EXISTS(SELECT 1 FROM "SectionTemplate" WHERE "id"=sectionId AND "version"=input.version)`):
    1. For each bridged part present in the new content: raw fenced legacy upsert (same `INSERT … SELECT … WHERE ${versionFence} ON CONFLICT("key") DO UPDATE …` shape as Task 3) with `bodyJson = JSON.stringify(toLegacyGlobalBody(legacyKey, parsedContent))`. For `team` the fence is `versionFence AND teamRosterFence(loadedTeamBodyJson)` when a legacy team row exists (a concurrent roster edit → whole write misses → 409); when no legacy team row exists yet the statement is a fenced plain INSERT (the upsert handles it).
    2. `syncVersionBumpAllWhere(versionFence)` — bridged kinds only (D-e).
    3. `prisma.subsectionTemplate.updateMany({ where: { id: subId, section: { version: input.version } }, data: { …fields…, version: { increment: 1 } } })` — title/offerings/copyJson/contentJson/archivedAt (`archived: true` → `new Date()`, `false` → `null`).
    4. LAST: `prisma.sectionTemplate.updateMany({ where: { id: sectionId, version: input.version }, data: { version: { increment: 1 } } })` (the aggregate bump; placed last because it changes what every earlier fence reads).
  - Post-txn: section-bump count 0 → 409 `version_conflict` (all statements shared the fence, so 0 means NOTHING committed). team-fence-only miss also surfaces as count 0 → 409 `roster_conflict` is NOT distinguishable — use `version_conflict` uniformly (the UI refetches either way; note this in the module comment).
- **`createSubsection`** — `FIELD_KEY_RE.test(subsectionKey)` else 400 `invalid_key`; title non-empty ≤200; `content` only as `'generic'` shape (operator-created — never a bridge pair; reject `subsectionKey === 'main'` and, under `data-source`, any key in `CATALOG_CATEGORIES` with 409 `subsection_exists` — P2002 would catch these anyway, this just makes the error deterministic); `copy` via `parseSubsectionCopy`. sortOrder = max existing sortOrder in the section + 10 (loaded). Txn: `[create, sectionTemplate.updateMany({ where: { id: sectionId }, data: { version: { increment: 1 } } })]` — creates are additive, not version-fenced (plan decision D-a covers overwrites; a create can't lose anyone's update). P2002 → 409 `subsection_exists`.
- **`createField`** — parent subsection must exist (404) and not be archived (409 `subsection_archived`); `FIELD_KEY_RE.test(fieldKey)` else 400 `invalid_key`; `fieldType` ∈ `['text','textarea','list']` else 400; label non-empty ≤200. sortOrder = max in subsection + 1 (catalog uses dense per-category ints). Txn: `[fieldTemplate.create, sectionTemplate.updateMany({ where: { id: sectionId }, data: { version: { increment: 1 } } })]`. P2002 (library-global fieldKey) → 409 `field_key_exists`. fieldKey is IMMUTABLE — `patchField` has no fieldKey input, and the route rejects unknown body keys.
- **`patchField`** — fenced like patchSubsection: field `updateMany({ where: { id: fieldId, subsection: { section: { version: input.version } } }, data: { …, version: { increment: 1 } } })` then the section bump LAST fenced on `(id, version)`; count 0 → 409. label ≤200; archived → archivedAt set/cleared. No legacy writes, no syncVersion (D-e).

- [ ] **Step 1: Write the failing tests** (extend the Task 3 suite; key cases):

```ts
describe('patchSubsection content bridge', () => {
  it('strategy/main content edit rewrites all three legacy rows + template envelope', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'strategy')!
    const sub = s.subsections[0]
    const blocks = (h: string) => ({ blocks: [{ heading: h, body: 'b' }] })
    await patchSubsection(sub.id, { version: s.version, content: { seoBase: blocks('SEO'), geoBase: blocks('GEO'), eeatBase: blocks('EEAT') } }, 'op@er.com')
    const seo = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'seo-base' } })
    expect(JSON.parse(seo!.bodyJson)).toEqual(blocks('SEO'))
    const after = await prisma.subsectionTemplate.findUnique({ where: { id: sub.id } })
    const parsed = parseSubsectionContent('strategy', after!.contentJson)!
    expect(toLegacyGlobalBody('geo-base', parsed)).toEqual(blocks('GEO'))
    const section = await prisma.sectionTemplate.findUnique({ where: { id: s.id } })
    expect(section!.version).toBe(s.version + 1)
    expect(after!.version).toBe(sub.version + 1)
  })
  it('welcome roster edit ignores incoming photo values (re-derived by name)', async () => {
    await prisma.viewbookGlobalContent.create({ data: { key: 'team', bodyJson: JSON.stringify([{ name: 'A', role: 'R', photo: 'a.webp', blurb: '' }]), updatedBy: 'x' } })
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'welcome')!
    await patchSubsection(s.subsections[0].id, { version: s.version, content: {
      team: [{ name: 'A', role: 'R2', photo: 'evil.webp', blurb: '' }], process: { blocks: [] }, why: { blocks: [] },
    } }, 'op@er.com')
    const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'team' } })
    expect(JSON.parse(row!.bodyJson)[0].photo).toBe('a.webp')
  })
  it('stale version → 409 and NO legacy row written', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'milestones')!
    await expect(patchSubsection(s.subsections[0].id, { version: s.version + 9, content: { processMilestones: { blocks: [] } } }, 'op@er.com'))
      .rejects.toMatchObject({ status: 409 })
    expect(await prisma.viewbookGlobalContent.findUnique({ where: { key: 'process-milestones' } })).toBeNull()
  })
  it('content on a contentless seeded main → 400; generic content on a created subsection is accepted with no legacy write', async () => {
    const { sections } = await getTemplateTree()
    const brand = sections.find(x => x.templateKey === 'brand')!
    await expect(patchSubsection(brand.subsections[0].id, { version: brand.version, content: { blocks: [] } }, 'op@er.com'))
      .rejects.toMatchObject({ status: 400 })
    await createSubsection(brand.id, { subsectionKey: 'va-notes', title: 'VA notes', offeringVa: true }, 'op@er.com')
    const t2 = await getTemplateTree()
    const b2 = t2.sections.find(x => x.templateKey === 'brand')!
    const created = b2.subsections.find(x => x.subsectionKey === 'va-notes')!
    expect(created.contentKind).toBe('generic')
    await patchSubsection(created.id, { version: b2.version, content: { blocks: [{ heading: 'H', body: 'B' }] } }, 'op@er.com')
  })
})
describe('fields', () => {
  it('createField validates key format, global uniqueness, bumps aggregate version', async () => {
    const { sections } = await getTemplateTree()
    const ds = sections.find(x => x.templateKey === 'data-source')!
    const sub = ds.subsections[0]
    await expect(createField(sub.id, { fieldKey: 'Bad Key', label: 'X', fieldType: 'text' }, 'op@er.com')).rejects.toMatchObject({ status: 400 })
    await expect(createField(sub.id, { fieldKey: 'school-name', label: 'X', fieldType: 'text' }, 'op@er.com')).rejects.toMatchObject({ status: 409 })
    await createField(sub.id, { fieldKey: 'va-hours', label: 'VA hours', fieldType: 'text' }, 'op@er.com')
    const after = await getTemplateTree()
    expect(after.sections.find(x => x.templateKey === 'data-source')!.version).toBe(ds.version + 1)
  })
  it('patchField archives (never deletes) and 409s on stale version', async () => {
    const { sections } = await getTemplateTree()
    const ds = sections.find(x => x.templateKey === 'data-source')!
    const field = ds.subsections[0].fields[0]
    await patchField(field.id, { version: ds.version, archived: true }, 'op@er.com')
    const row = await prisma.fieldTemplate.findUnique({ where: { id: field.id } })
    expect(row!.archivedAt).not.toBeNull()
    await expect(patchField(field.id, { version: ds.version, label: 'nope' }, 'op@er.com')).rejects.toMatchObject({ status: 409 })
  })
})
```

- [ ] **Step 2:** Run → FAIL (functions missing).
- [ ] **Step 3: Implement** per the semantics block. The raw fenced-upsert builder is shared with Task 3 — extract a module-private helper:

```ts
// One fenced legacy upsert: commits IFF the shared pre-state fence holds.
function fencedLegacyUpsert(key: string, bodyJson: string, updatedBy: string, fence: Prisma.Sql) {
  return prisma.$executeRaw`
    INSERT INTO "ViewbookGlobalContent" ("key", "bodyJson", "updatedBy", "updatedAt")
    SELECT ${key}, ${bodyJson}, ${updatedBy}, ${Date.now()}
    WHERE ${fence}
    ON CONFLICT ("key") DO UPDATE SET "bodyJson" = excluded."bodyJson", "updatedBy" = excluded."updatedBy", "updatedAt" = excluded."updatedAt"`
}
```

- [ ] **Step 4:** Run the suite → PASS.
- [ ] **Step 5: Commit** — `git add lib/viewbook/template-service.ts lib/viewbook/template-service.test.ts && git commit -m "feat(viewbook): subsection/field mutations with fenced content bridge (F1b)"`

---

### Task 5: Team-photo flows — `attachTeamPhoto` txn seam + both bridged flows

**Files:**
- Modify: `lib/viewbook/global-content.ts` (seam), `lib/viewbook/template-service.ts`
- Test: `lib/viewbook/template-service.test.ts` (extend); existing `global-content.test.ts` photo suites stay green

**Interfaces:**
- Produces:

```ts
// global-content.ts — attachTeamPhoto stays the ONE file authority; the txn
// body becomes injectable so template-service can add fenced statements
// WITHOUT a second save/fence/delete-old flow.
export interface TeamPhotoTxn {
  statements: Prisma.PrismaPromise<unknown>[]
  verify: (results: unknown[]) => boolean   // false → attachTeamPhoto deletes the NEW file and throws HttpError(409, conflictCode)
  conflictCode: string
}
export interface AttachTeamPhotoDeps {
  beforeStamp?: () => Promise<void>
  buildTxn?: (ctx: { row: { bodyJson: string }; next: TeamMember[]; filename: string; updatedBy: string }) => TeamPhotoTxn
}

// template-service.ts
export async function attachTeamPhotoBridged(memberName: string, buf: Buffer, updatedBy: string): Promise<string>                    // legacy route: unconditional forward-write, drift-logged
export async function attachTemplateTeamPhoto(sectionId: number, memberName: string, buf: Buffer, updatedBy: string, expectedVersion: number): Promise<string>  // template route: everything version-fenced, 409 version_conflict
```

**Semantics:**
- `attachTeamPhoto` refactor: the existing fenced pair + count-check becomes the DEFAULT `buildTxn` (`conflictCode: 'roster_conflict'`, verify = `results[1].count === 1`). The load/validate/member-lookup/save-file/delete-old/orphan-on-throw logic is UNTOUCHED; only the `$transaction(...)` contents come from `buildTxn(ctx)` and the count check becomes `txn.verify(results)`.
- Both bridged flows pre-load the welcome/main subsection (section `templateKey: 'welcome'`, sub `subsectionKey: 'main'`) + its parsed envelope. If missing/corrupt envelope: `attachTeamPhotoBridged` re-projects it from current legacy rows via `projectMainContentJson('welcome', rowsWithDerivedRoster, [])`; `attachTemplateTeamPhoto` 409s `template_missing` only when the tree row is absent entirely (can't fence what isn't there).
- `attachTeamPhotoBridged.buildTxn` returns the default statements PLUS (order: section bump BEFORE sub update — pre-state pattern):
  - `sectionBump`: raw `UPDATE "SectionTemplate" SET "version"="version"+1, "updatedAt"=${Date.now()} WHERE "id"=${welcomeSectionId} AND EXISTS (SELECT 1 FROM "SubsectionTemplate" WHERE "id"=${subId} AND "contentJson" = ${loadedContentJson}) AND (${teamRosterFence(row.bodyJson)})` — `loadedContentJson` may be `IS NULL`-shaped; use `Prisma.sql` branches for null.
  - `subUpdate`: raw UPDATE of `SubsectionTemplate` setting `contentJson = ${newEnvelope}` (the loaded envelope with `team` replaced by `ctx.next`), `version = version + 1`, `updatedAt`, `WHERE "id"=${subId} AND ("contentJson" = ${loadedContentJson})` + rosterFence.
  - verify = roster count === 1 (legacy semantics unchanged); template counts 0 → post-commit `logError(op: 'template-forward-write-miss')` (plan decision D-c) — verify still returns true.
- `attachTemplateTeamPhoto` resolves the section by `sectionId` (must be the welcome template — 404 otherwise), then calls `attachTeamPhoto(memberName, buf, updatedBy, { buildTxn })` where buildTxn's statements ALL carry `versionFence = EXISTS(SELECT 1 FROM "SectionTemplate" WHERE "id"=${sectionId} AND "version"=${expectedVersion})` in addition to the roster fence, verify requires roster count === 1 AND both template counts === 1, `conflictCode: 'version_conflict'`. Includes `syncVersionBumpAllWhere` fenced the same way (replacing the default's fence-only bump — build the statement list from scratch here, not by appending to the default).

- [ ] **Step 1: Write the failing tests:**

```ts
describe('team photo flows', () => {
  const png = () => /* reuse the fixture buffer helper global-content.test.ts uses for attachTeamPhoto */
  beforeEach(async () => {
    await prisma.viewbookGlobalContent.create({ data: { key: 'team', bodyJson: JSON.stringify([{ name: 'A', role: 'R', photo: null, blurb: '' }]), updatedBy: 'x' } })
  })
  it('attachTemplateTeamPhoto updates roster + template envelope + versions atomically', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'welcome')!
    const filename = await attachTemplateTeamPhoto(s.id, 'A', png(), 'op@er.com', s.version)
    const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'team' } })
    expect(JSON.parse(row!.bodyJson)[0].photo).toBe(filename)
    const after = await getTemplateTree()
    const w = after.sections.find(x => x.templateKey === 'welcome')!
    expect(w.version).toBe(s.version + 1)
    expect((w.subsections[0].content as { team: TeamMember[] }).team[0].photo).toBe(filename)
  })
  it('stale version → 409, no roster change, new file deleted', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'welcome')!
    await expect(attachTemplateTeamPhoto(s.id, 'A', png(), 'op@er.com', s.version + 3))
      .rejects.toMatchObject({ status: 409 })
    const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'team' } })
    expect(JSON.parse(row!.bodyJson)[0].photo).toBeNull()
  })
  it('attachTeamPhotoBridged (legacy route path) forward-writes the template without a version token', async () => {
    const { sections } = await getTemplateTree()
    const s = sections.find(x => x.templateKey === 'welcome')!
    const filename = await attachTeamPhotoBridged('A', png(), 'op@er.com')
    const after = await getTemplateTree()
    const w = after.sections.find(x => x.templateKey === 'welcome')!
    expect((w.subsections[0].content as { team: TeamMember[] }).team[0].photo).toBe(filename)
    expect(w.version).toBe(s.version + 1)
  })
})
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** the seam + both flows. **Step 4:** Run the new tests AND `npx vitest run lib/viewbook/global-content.test.ts` (default-path behavior identical) → PASS.
- [ ] **Step 5: Commit** — `git add lib/viewbook/global-content.ts lib/viewbook/template-service.ts lib/viewbook/template-service.test.ts && git commit -m "feat(viewbook): team-photo txn seam + bridged/template photo flows (F1b, spec fix 4)"`

---

### Task 6: Legacy routes forward-write through the service

**Files:**
- Modify: `lib/viewbook/template-service.ts`; `app/api/viewbook-content/[key]/route.ts`, `app/api/viewbook-content/team-photo/route.ts`, `app/api/viewbooks/section-copy/[sectionKey]/route.ts`
- Test: `lib/viewbook/template-service.test.ts` (extend); existing route suites stay green

**Interfaces:**
- Produces:

```ts
export async function putGlobalContentBridged(key: string, raw: unknown, updatedBy: string): Promise<void>
export async function putSectionCopyGlobalBridged(sectionKey: string, raw: unknown, updatedBy: string): Promise<void>
export async function deleteSectionCopyGlobalBridged(sectionKey: string): Promise<void>
```

**Semantics:**
- `putGlobalContentBridged(key, raw, updatedBy)`:
  1. Validate exactly as `putGlobalContent` does (`validateGlobalContent` → 400 `invalid_content`) — identical error surface.
  2. Resolve the bridged target from the inverse of `BRIDGED_CONTENT` (`LEGACY_KEY_TARGET: Record<GlobalContentKey, { templateKey: SectionKey; part: string }>` — build it once from `BRIDGED_CONTENT` at module scope). Load the target section + main subsection.
  3. Compute the NEW template envelope: parse the current `contentJson` (`parseSubsectionContent(rendererType, …)`); if parseable → replace the one part; if null/corrupt → re-project the whole envelope from the CURRENT legacy rows with the new value substituted (`projectMainContentJson(templateKey, substitutedRows, [])`).
  4. Team key: `buildTeamRosterWrite` (photo re-derivation + roster fence) supplies the legacy statements; other keys: `putGlobalContentStatements`. Template statements: the same raw fenced pair as Task 5 (`sectionBump` before `subUpdate`, both fenced on the sub's pre-state `contentJson` equality; for team, ALSO the roster fence). One `$transaction` of all statements.
  5. Post-txn: legacy conflict check exactly as today (team `conflictIndex` count 0 → 409 `roster_conflict` + NO orphan deletion; success → orphan deletion). Template counts 0 → `logError('template-forward-write-miss')`, never a throw (D-c). Template row entirely missing → skip template statements + same drift log.
- `putSectionCopyGlobalBridged`: validate exactly as `putSectionCopyGlobal` (invalid key/content → 400); txn = `putSectionCopyGlobalStatements(...)` + `prisma.sectionTemplate.updateMany({ where: { templateKey: sectionKey }, data: { copyJson: JSON.stringify({ v: 1, copy: validated }), version: { increment: 1 } } })` (unfenced — legacy last-writer-wins); count 0 → drift log.
- `deleteSectionCopyGlobalBridged`: destructure `deleteSectionCopyGlobalStatements(...)`; template statement = raw UPDATE setting `copyJson` to the CODE DEFAULT envelope (`{ v: 1, copy: { purpose, whatThis, whatWeNeed } }` from `SECTION_COPY[sectionKey]` — delete means "revert to code default" in the resolve chain) + `version + 1` + manual `updatedAt`, `WHERE "templateKey"=${sectionKey} AND EXISTS (SELECT 1 FROM "ViewbookGlobalContent" WHERE "key"=${sectionCopyKey(sectionKey)})` (shares the delete's fence, placed BEFORE the deleteMany). `results[deleteIndex].count === 0` → 404 `not_found` (unchanged); template count 0 with legacy count 1 → drift log.
- Routes: swap `putGlobalContent` → `putGlobalContentBridged`, `attachTeamPhoto` → `attachTeamPhotoBridged`, `putSectionCopyGlobal`/`deleteSectionCopyGlobal` → bridged variants. NOTHING else in the routes changes — same auth, parsing, response shapes, error codes.

- [ ] **Step 1: Write the failing tests:**

```ts
describe('legacy bridged writes (forward-write)', () => {
  it('putGlobalContentBridged(process) updates the legacy row AND the welcome/main envelope part, preserving other parts', async () => {
    await putGlobalContentBridged('why', { blocks: [{ heading: 'Why', body: 'w' }] }, 'op@er.com')
    await putGlobalContentBridged('process', { blocks: [{ heading: 'P1', body: 'b' }] }, 'op@er.com')
    const { sections } = await getTemplateTree()
    const w = sections.find(x => x.templateKey === 'welcome')!
    const content = w.subsections[0].content as { process: ContentBlocks; why: ContentBlocks }
    expect(content.process).toEqual({ blocks: [{ heading: 'P1', body: 'b' }] })
    expect(content.why).toEqual({ blocks: [{ heading: 'Why', body: 'w' }] })   // earlier part preserved
    const legacy = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'process' } })
    expect(JSON.parse(legacy!.bodyJson)).toEqual({ blocks: [{ heading: 'P1', body: 'b' }] })
  })
  it('a corrupt template envelope self-heals by re-projection instead of failing the legacy write', async () => {
    const { sections } = await getTemplateTree()
    const w = sections.find(x => x.templateKey === 'welcome')!
    await prisma.subsectionTemplate.update({ where: { id: w.subsections[0].id }, data: { contentJson: 'CORRUPT{' } })
    await putGlobalContentBridged('process', { blocks: [{ heading: 'P', body: 'b' }] }, 'op@er.com')
    const after = await getTemplateTree()
    const content = after.sections.find(x => x.templateKey === 'welcome')!.subsections[0].content
    expect(content).not.toBeNull()   // re-projected whole envelope
  })
  it('a missing template tree never fails the legacy write (drift-logged)', async () => {
    await prisma.sectionTemplate.delete({ where: { templateKey: 'pc-intro' } })
    await expect(putGlobalContentBridged('pc-intro', 'Hello there — welcome aboard!', 'op@er.com')).resolves.toBeUndefined()
    const row = await prisma.viewbookGlobalContent.findUnique({ where: { key: 'pc-intro' } })
    expect(JSON.parse(row!.bodyJson)).toBe('Hello there — welcome aboard!')
  })
  it('putSectionCopyGlobalBridged + deleteSectionCopyGlobalBridged keep template copyJson in sync (delete → code default)', async () => {
    const copy = { purpose: 'P', whatThis: 'W', whatWeNeed: null }
    await putSectionCopyGlobalBridged('brand', copy, 'op@er.com')
    let { sections } = await getTemplateTree()
    expect(sections.find(x => x.templateKey === 'brand')!.copy).toEqual(copy)
    await deleteSectionCopyGlobalBridged('brand')
    ;({ sections } = await getTemplateTree())
    expect(sections.find(x => x.templateKey === 'brand')!.copy).toEqual(resolveSectionCopy('brand', null, null))
  })
  it('team roster conflict still 409s and writes NOTHING (template included)', async () => {
    await prisma.viewbookGlobalContent.create({ data: { key: 'team', bodyJson: JSON.stringify([{ name: 'A', role: 'R', photo: null, blurb: '' }]), updatedBy: 'x' } })
    // …use the beforeStamp-style race: capture the loaded row, mutate the roster between load and txn via a deps seam
    // mirroring global-content.test.ts's existing roster-conflict test, then assert the welcome envelope is unchanged.
  })
})
```

  Implement the roster-conflict race test with the same injection style `global-content.test.ts` already uses for `attachTeamPhoto`'s `beforeStamp` (give `putGlobalContentBridged` an optional `deps?: { beforeWrite?: () => Promise<void> }` last parameter, test-only).
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** the three bridged functions.
- [ ] **Step 4: Swap the routes** (import changes only) and run `npx vitest run app/api lib/viewbook` → existing route + service suites green.
- [ ] **Step 5: Commit** — `git add lib/viewbook/template-service.ts lib/viewbook/template-service.test.ts app/api/viewbook-content app/api/viewbooks/section-copy && git commit -m "feat(viewbook): legacy routes forward-write templates via the dual-write authority (F1b)"`

---

### Task 7: `reconcileSeededTemplates()` + boot wiring (spec fix #1)

**Files:**
- Modify: `lib/viewbook/template-service.ts`, `instrumentation.ts`
- Test: `lib/viewbook/template-service.test.ts` (extend)

**Interfaces:**
- Produces: `export async function reconcileSeededTemplates(): Promise<void>` and `export const RECONCILE_MARKER_KEY = 'template-library:reconciled'`.

**Semantics:**
- Marker check first: `viewbookGlobalContent.findUnique({ where: { key: RECONCILE_MARKER_KEY } })` → present → return (never again).
- Load legacy source rows exactly as `seedViewbookTemplates` does (`GLOBAL_CONTENT_KEYS` + `SECTION_KEYS.map(sectionCopyKey)`), run `projectTemplateSeedWithIssues`, `logError` each issue (op `template-reconcile`).
- For each of the 13 trees: load the existing row + subtree versions (`findUnique({ where: { templateKey }, include: { subsections: { include: { fields: true } } } })`).
  - Row missing → `createSeedTree(tree)` (the boot seeder ran first, so this only happens after a manual deletion — still correct).
  - Untouched since seed = `section.version === 1 && every subsection.version === 1 && every field.version === 1` → overwrite: `await prisma.$transaction([prisma.sectionTemplate.delete({ where: { templateKey } }), prisma.sectionTemplate.create({ data: seedTreeCreateData(tree) })])` (cascade wipes the subtree; delete precedes create so the global `fieldKey` uniques can't collide; array-form, atomic).
  - Any `version > 1` anywhere in the tree → skip (operator-edited — defensive, spec fix #1).
- Finally create the marker: `viewbookGlobalContent.create({ data: { key: RECONCILE_MARKER_KEY, bodyJson: JSON.stringify({ v: 1, reconciledAt: new Date().toISOString() }), updatedBy: 'system' } })`; catch P2002 → fine (a concurrent boot won). A crash BEFORE the marker → the whole pass re-runs next boot (idempotent: re-projection of version-1 trees converges).
- The marker key is a reserved-namespace `ViewbookGlobalContent` row (`section-copy:` precedent); no reader parses it — `getSectionCopyGlobalMap` filters exact keys and `getGlobalContent` only accepts `GLOBAL_CONTENT_KEYS`.
- `instrumentation.ts`: inside the SAME try/catch that invokes `seedViewbookTemplates()`, directly after it:

```ts
      const { seedViewbookTemplates } = await import('@/lib/viewbook/template-seed')
      await seedViewbookTemplates()
      // F1b: one-time activation reconciliation (spec fix #1) — re-projects
      // legacy edits made in the F1a→F1b window into still-untouched trees,
      // marker-guarded so it never runs twice. MUST follow the seeder.
      const { reconcileSeededTemplates } = await import('@/lib/viewbook/template-service')
      await reconcileSeededTemplates()
```

- [ ] **Step 1: Write the failing tests:**

```ts
describe('reconcileSeededTemplates', () => {
  it('re-projects legacy edits into version-1 trees exactly once (marker)', async () => {
    // seed happened in beforeEach with empty legacy rows; simulate an F1a-window legacy edit:
    await prisma.viewbookGlobalContent.create({ data: { key: 'process', bodyJson: JSON.stringify({ blocks: [{ heading: 'Window edit', body: 'b' }] }), updatedBy: 'x' } })
    await reconcileSeededTemplates()
    const { sections } = await getTemplateTree()
    const w = sections.find(x => x.templateKey === 'welcome')!
    expect((w.subsections[0].content as { process: ContentBlocks }).process.blocks[0].heading).toBe('Window edit')
    expect(await prisma.viewbookGlobalContent.findUnique({ where: { key: RECONCILE_MARKER_KEY } })).not.toBeNull()
    // second window edit + second call → NOT absorbed (marker)
    await prisma.viewbookGlobalContent.update({ where: { key: 'process' }, data: { bodyJson: JSON.stringify({ blocks: [{ heading: 'Later', body: 'b' }] }) } })
    await reconcileSeededTemplates()
    const after = await getTemplateTree()
    expect((after.sections.find(x => x.templateKey === 'welcome')!.subsections[0].content as { process: ContentBlocks }).process.blocks[0].heading).toBe('Window edit')
  })
  it('skips operator-edited trees (any version > 1 anywhere in the subtree)', async () => {
    await prisma.viewbookGlobalContent.create({ data: { key: 'process', bodyJson: JSON.stringify({ blocks: [{ heading: 'Window edit', body: 'b' }] }), updatedBy: 'x' } })
    const { sections } = await getTemplateTree()
    const w = sections.find(x => x.templateKey === 'welcome')!
    await prisma.subsectionTemplate.update({ where: { id: w.subsections[0].id }, data: { version: 2 } })  // simulated operator edit
    await reconcileSeededTemplates()
    const after = await getTemplateTree()
    expect((after.sections.find(x => x.templateKey === 'welcome')!.subsections[0].content as { process: ContentBlocks }).process.blocks).toEqual([])
  })
})
```

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** + wire `instrumentation.ts`. **Step 4:** Run → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git add lib/viewbook/template-service.ts lib/viewbook/template-service.test.ts instrumentation.ts && git commit -m "feat(viewbook): one-time F1b activation reconciliation with marker row (spec fix 1)"`

---

### Task 8: API routes

**Files:**
- Create: the eight route files under `app/api/viewbook-templates/…` (File Structure table)
- Test: `app/api/viewbook-templates/template-routes.test.ts`

**Interfaces:** every handler = `withRoute` + `requireOperatorEmail(request)` first + `parseId` on params + `parseJsonBody`/`requireJsonObject` (photo route: `requireBoundedContentLength` + `formData` + `fileBufferFromForm`, mirroring `app/api/viewbook-content/team-photo/route.ts`) → the Task 3–5 service function → `NextResponse.json({ ok: true })` (GET returns the tree). `export const dynamic = 'force-dynamic'` everywhere. Bodies:

| Route | Body → service call |
|---|---|
| `GET /api/viewbook-templates` | — → `getTemplateTree()` |
| `PATCH …/sections/[id]` | `{ version, title?, copy? }` → `patchSectionTemplate(id, body, operator)` |
| `POST …/sections/[id]/subsections` | `{ subsectionKey, title, offeringWebsite?, offeringVa?, offeringPpc?, copy?, content? }` → `createSubsection` |
| `PATCH …/sections/[id]/subsections/[subId]` | `{ version, title?, offering*?, copy?, content?, archived? }` → `patchSubsection(subId, …)` (the `[id]` segment is resolved-and-checked: sub must belong to section, else 404) |
| `POST …/sections/[id]/photo` | multipart `memberName` + `version` + file → `attachTemplateTeamPhoto(id, memberName, buf, operator, Number(version))` (non-integer version → 400) |
| `POST …/subsections/[id]/fields` | `{ fieldKey, label, fieldType }` → `createField` |
| `PATCH …/subsections/[id]/fields/[fieldId]` | `{ version, label?, sortOrder?, archived? }` → `patchField(fieldId, …)` (fieldId-under-subsection checked, 404) — a `fieldKey` property in the body → 400 `invalid_content` (immutability made explicit) |
| `POST …/reorder` | `{ items: [{ id, version, sortOrder }] }` → `reorderSections(items)` |

- [ ] **Step 1: Write the failing route tests** (follow `app/api/viewbooks/routes.test.ts` conventions — mock `requireOperatorEmail` per that suite's pattern, DB-backed): unauth (mock throws) → 401 envelope; GET returns the 13-section tree; PATCH section happy + 409 envelope `{ error: 'version_conflict' }`; PATCH field with `fieldKey` in body → 400; photo route with missing file → 400 `invalid_upload`; subsection PATCH under the wrong section id → 404.
- [ ] **Step 2:** Run → FAIL. **Step 3: Implement** the eight files. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** — `git add app/api/viewbook-templates && git commit -m "feat(viewbook): template admin API routes (F1b)"`

---

### Task 9: Template editor UI + settings page swap

**Files:**
- Create: `components/viewbook/admin/CsmPicker.tsx`, `components/viewbook/admin/templates/{TemplateEditor,SectionPanel,SubsectionPanel,FieldGrid}.tsx`, `templates/template-editor-types.ts`, `templates/TemplateEditor.test.tsx`
- Modify: `components/viewbook/admin/ViewbookEditor.tsx` (CsmPicker import), `app/(app)/viewbooks/settings/page.tsx`
- Delete: `components/viewbook/admin/GlobalContentEditor.tsx` + `.test.tsx`, `components/viewbook/admin/SectionCopyEditor.tsx` + `.test.tsx`

**Step order matters — CsmPicker moves BEFORE the delete:**

- [ ] **Step 1: Move `CsmPicker`** verbatim from `GlobalContentEditor.tsx:225-282` into `components/viewbook/admin/CsmPicker.tsx` (same imports: `jsonFetch`, `editorInputClass`, `editorLabelClass`, `TeamMember`); update `ViewbookEditor.tsx:24` to `import { CsmPicker } from './CsmPicker'`. Run `npx vitest run components/viewbook` → green. Commit — `refactor(viewbook): move CsmPicker to its own module`.
- [ ] **Step 2: Write the failing component tests** (`TemplateEditor.test.tsx`, following `GlobalContentEditor.test.tsx`'s mock-fetch conventions):
  - renders the section list from a mocked GET tree (13 sections, sortOrder order), title fields carry the literal helper text `applies after template cutover (F2)`;
  - editing brand's purpose and saving PATCHes `/api/viewbook-templates/sections/<id>` with `{ version, copy }`;
  - a 409 response shows a conflict message AND refetches the tree (second GET call asserted);
  - the welcome subsection renders the roster form (name/role/email/CSM/photo/bio inputs — ported TeamEditor) and save PATCHes the subsection with the full `{ team, process, why }` content;
  - data-source subsections render the field grid; add-field validates `FIELD_KEY_RE` client-side (bad key → inline error, no fetch) and POSTs `/api/viewbook-templates/subsections/<id>/fields`;
  - add-subsection form POSTs with offering checkboxes; archived subsections render collapsed with an "Archived" pill and a Restore button.
- [ ] **Step 3:** Run → FAIL (components missing).
- [ ] **Step 4: Implement the components.** Structure:
  - `template-editor-types.ts`: the `TemplateTree`/section/subsection/field payload types (mirror the service view types — client-safe copies, plus `ContentKind`).
  - `TemplateEditor.tsx` (`'use client'`): loads `GET /api/viewbook-templates` via `jsonFetch`; holds the tree + a `refetch`; top warning banner reused from GlobalContentEditor ("Affects every viewbook" — bridged edits still render everywhere); maps sections → `SectionPanel`; per-section ↑/↓ buttons build the two-item swap payload for `POST /api/viewbook-templates/reorder`; EVERY mutation helper (shared `mutate(label, fn)` modeled on GlobalContentEditor's `run`) refetches on success AND on a 409 (`version_conflict` → set a "Someone else edited this — reloaded latest" notice). Include a per-panel save-state button pattern (the 2026-07-19 button-local feedback lesson — copy the `saveState` idiom from TeamEditor).
  - `SectionPanel.tsx`: collapsed row (title, templateKey pill, subsection count) → expands to: title input (helper text `applies after template cutover (F2)`), section-copy form (purpose/whatThis/whatWeNeed — port SectionCopyEditor's field layout + caps display), subsection list (`SubsectionPanel` each), add-subsection form (key + title + offering checkboxes; key validated against `FIELD_KEY_RE` client-side).
  - `SubsectionPanel.tsx`: title input (same F2 helper text), offering checkboxes (Website/VA/PPC), subsection-copy form (intro/whatWeNeed, helper text F2), content form by `contentKind`: `welcome` → ported TeamEditor roster grid + per-member photo upload POSTing the TEMPLATE photo route (`FormData` with `memberName`, `version`, `file`) + the process/why block lists; `strategy` → three labeled block lists (SEO/GEO/E-E-A-T foundation, labels from the old BLOCK_TITLES); `milestones` → one block list; `pc-intro` → textarea; `generic` → one block list; `none` → nothing. Block-list editing ports BlocksEditor's add/remove/edit rows. Save = ONE `PATCH` per subsection sending the whole decoded content object + copy + offerings + title with the section `version`. Archive/Restore button (`archived: true/false`).
  - `FieldGrid.tsx`: table of fields (label input, fieldType select, sortOrder number input, Archived pill + toggle) with per-row save (PATCH), plus the add-field row (fieldKey input with pattern hint `a-z, 0-9, dashes; permanent`, label, fieldType select) POSTing create. fieldKey immutability: existing rows render the key as static text, never an input.
- [ ] **Step 5: Swap the settings page:**

```tsx
import type { Metadata } from 'next'
import { TemplateEditor } from '@/components/viewbook/admin/templates/TemplateEditor'
import { StrategyDocsCard } from '@/components/viewbook/admin/StrategyDocsCard'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Onboarding Viewbook Templates' }

export default function ViewbookSettingsPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-heading font-bold text-navy dark:text-white">Onboarding Viewbook templates</h1>
        <p className="text-[13px] font-body text-navy/50 dark:text-white/50">
          The section template library — copy, content, and data-source fields, edited once and rendered into every
          viewbook (per-viewbook overrides live in each viewbook&apos;s editor).
        </p>
      </header>
      <StrategyDocsCard />
      <TemplateEditor />
    </div>
  )
}
```

- [ ] **Step 6: Delete** `GlobalContentEditor.tsx`, `GlobalContentEditor.test.tsx`, `SectionCopyEditor.tsx`, `SectionCopyEditor.test.tsx` (`git rm`). Grep for stragglers: `grep -rn "GlobalContentEditor\|SectionCopyEditor" app components lib --include='*.ts*'` → zero hits.
- [ ] **Step 7:** `npx vitest run components/viewbook` + `npx tsc --noEmit` → green/clean.
- [ ] **Step 8: Commit** — `git add -A components/viewbook/admin app/\(app\)/viewbooks/settings && git commit -m "feat(viewbook): template editor replaces GlobalContentEditor+SectionCopyEditor on /viewbooks/settings (F1b)"`

---

### Task 10: Bridge-parity acceptance suite (the F1a-deferred item)

**Files:**
- Create: `lib/viewbook/template-service.parity.test.ts`

This is spec §6's deferred acceptance line: **template write → legacy row ≡ `toLegacy*` output**, plus the reconcile acceptance. These are acceptance tests over Tasks 3–7 — any failure is a Task 3–7 bug.

- [ ] **Step 1: Write the suite:**
  - **Template→legacy, section copy, all 13 keys:** for each seeded section, `patchSectionTemplate` with a distinct valid copy → assert `validateSectionCopy(JSON.parse(legacyRow.bodyJson))` deep-equals `toLegacySectionCopy(parseTemplateCopy(storedCopyJson)!)` AND deep-equals what `resolveSectionCopy(key, legacyValidated, null)` now serves — the render path sees exactly the template edit.
  - **Template→legacy, all four bridged content pairs:** `patchSubsection` with distinct content per pair → for EVERY part key in `BRIDGED_CONTENT[templateKey].parts`, `JSON.parse(legacyRow.bodyJson)` deep-equals `toLegacyGlobalBody(legacyKey, parseSubsectionContent(rendererType, storedContentJson)!)` — and `getGlobalContent(legacyKey)` (the real read path) returns the same decoded value.
  - **Legacy→template, all 8 global keys + section-copy put/delete:** `putGlobalContentBridged` per key → decoded template part equals the legacy read; `putSectionCopyGlobalBridged`/`deleteSectionCopyGlobalBridged` → template copy tracks (delete lands the code default).
  - **Photo parity:** `attachTemplateTeamPhoto` → legacy roster photo === template envelope photo === returned filename.
  - **Round-trip stability:** after a template write followed by a legacy write of the SAME key, both stores agree (no envelope leakage into legacy rows — assert the legacy bodyJson has NO `v` key).
  - **Reconcile acceptance:** the two Task 7 behaviors restated as acceptance (window-edit absorbed exactly once; version>1 tree skipped).
- [ ] **Step 2:** `npx vitest run lib/viewbook/template-service.parity.test.ts` → PASS (fix any Task 3–7 bug it exposes, in that task's file).
- [ ] **Step 3: Commit** — `git add lib/viewbook/template-service.parity.test.ts && git commit -m "test(viewbook): F1b bridge-parity acceptance suite (spec §6 deferred item)"`

---

### Task 11: Gates + PR

- [ ] **Step 1:** `npx tsc --noEmit` clean; full `npx vitest run` green; `npm run build` succeeds.
- [ ] **Step 2: Verify the additive claims:** `git diff origin/main -- lib/viewbook/public-data.ts app/\(public\)` is EMPTY (no viewer change); `git diff origin/main -- lib/viewbook/global-content.ts lib/viewbook/section-copy-content.ts` shows extraction + seam only (legacy signatures intact); existing legacy suites unmodified except the Task 2 builder appends.
- [ ] **Step 3:** Open PR `feat(viewbook): F1b template admin editor + dual-write bridge`. Body: spec §7 link, plan link, the D-a…D-e plan decisions, bridge-parity summary, reconcile note ("first prod boot after deploy runs reconcile once — check PM2 stderr for `template-reconcile` / `template-forward-write-miss` lines"), out-of-scope list (section CREATE/DELETE → F5b; cutover → F2). Optional pre-merge `/codex-review` if the bridge txns feel risky (handoff guidance).
- [ ] **Step 4 (post-merge, per house rules):** deploy via `ssh $PROD_SSH "~/deploy.sh"` after push; prod-verify: `/viewbooks/settings` renders the template editor; one template copy edit shows on a public viewbook (bridge); `sqlite3`-less check of the marker via the app (or a one-off `npx tsx` script over prod DB is NOT available — use PM2 stderr absence of `template-` diagnostics + a legacy-route smoke); tracker + `/handoff-prep` for wave 4.

---

## Self-Review notes

- **Spec §7 coverage:** editor-replaces-legacy-editors → Task 9; reconcile fix #1 → Task 7; single dual-write authority + statement-builder extraction fixes #2/#3 → Tasks 2–6; team-photo fix #4 → Task 5; routes list → Task 8 (all seven mutation surfaces + GET); aggregate-version rule §3/#12 → every mutation in Tasks 3–5 bumps own + section version in one txn; reorder → Task 3 (D-d notes the spec-literal partiality); optimistic version 409 → Tasks 3–5, 8; fieldKey operator-entered/validated/immutable/archive-never-delete → Tasks 4, 8, 9; section CREATE/DELETE excluded; subsection/field create included; title-edits-back-write-nothing + F2 label → Tasks 3, 9; bridge-parity acceptance (spec §6 deferral) → Task 10; legacy routes still green → Tasks 2/6 constraints.
- **Type consistency:** `TemplateTree` views defined Task 3, consumed Tasks 8/9 (client copies in `template-editor-types.ts`); `TeamPhotoTxn`/`AttachTeamPhotoDeps` defined Task 5 where consumed; builders defined Task 2 signatures match Task 3–6 call sites; `parseSubsectionCopy` (Task 1) consumed Tasks 4/9; `projectMainContentJson`/`seedTreeCreateData` (Task 2) consumed Tasks 6/7.
- **Known risk flagged for Codex review:** (1) the raw `INSERT … SELECT … ON CONFLICT` fenced-upsert shape (SQLite requires the `WHERE` clause we already have to disambiguate the upsert parse — believed fine, verify in test); (2) D-d's partial-reorder-on-conflict; (3) the uniform 409 `version_conflict` for the roster-fence miss inside `patchSubsection`; (4) creates being version-bump-only (not version-fenced) — deliberate, documented in D-a.
