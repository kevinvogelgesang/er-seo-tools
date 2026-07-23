# F1a — Viewbook Template Library (schema + registry + seed + parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the durable template library tables (`SectionTemplate`/`SubsectionTemplate`/`FieldTemplate`), the code-owned renderer-type registry (CTA seam moved off `SECTION_COPY`), client-safe validators, the boot-time idempotent seeder driven by ONE pure `projectTemplateSeed`, seed-projection parity tests, and the "What we need from you" rename — all ADDITIVE (legacy read paths render byte-identically).

**Architecture:** DDL-only migration; content seeding at boot (reads live `ViewbookGlobalContent` + code consts — reasons SQL can't); each section tree seeded as ONE atomic nested Prisma `create`; the seeder NEVER updates existing rows. F1b (template admin + dual-write bridge) is a separate later PR — NOT in scope here.

**Tech Stack:** Next.js 15, Prisma + SQLite, vitest.

**Spec:** `docs/superpowers/specs/2026-07-22-f1-viewbook-template-library-design.md` (Codex-reviewed, 15 fixes applied; §0 canonical order + seeded titles CONFIRMED by Kevin 2026-07-22 — the seed/deploy gate is cleared). §N references are to that spec.

**Plan review:** Codex (Sol) 2026-07-22 — accept with 8 named fixes, ALL applied below (client-safe `section-copy-validator.ts` extraction, full parser/translator characterization, pure `{trees, issues}` projection split, winner-based P2002 handling + infra errors propagate, real nested-write atomicity test via `createSeedTree`, barrier-based concurrent-loser test, explicit `logError` wiring in instrumentation, validated copy-parity fixture).

## Global Constraints

- **F1a scope only:** schema (§3), registry + validators (§4), seeder (§5), parity tests (§6), D-S rename (§8). F1b items (template admin routes, dual-write bridge, `reconcileSeededTemplates`, team-photo template flow) are OUT — do not build them.
- Canonical order (Kevin-confirmed): `pc-intro, pc-setup, pc-invite, data-source, welcome, milestones, strategy, kickoff-next, ws-intro, brand, assessment, materials, pc-thanks`, sortOrder 10..130 gapped by 10.
- The seeder NEVER updates an existing `SectionTemplate` row — operator edits win; idempotence is skip-if-present.
- `FieldTemplate.fieldKey` is LIBRARY-GLOBAL `@unique`, immutable, format `^[a-z0-9][a-z0-9-]{1,63}$`; seeded = catalog `defKey`.
- Template JSON columns ALWAYS carry `{v:1, …}` envelopes with strict whole-doc-reject parsers; legacy shapes stay byte-compatible via explicit `toLegacy*` translators — templates never leak envelopes into legacy rows.
- Absent/corrupt global rows seed EMPTY (`team: []`, `{blocks: []}`) — there is NO code-default layer — EXCEPT `pc-intro` → `PC_INTRO_DEFAULT`. Corrupt bodyJson → treated absent + `logError`.
- Legacy rows are COPIED, never deleted/mutated. No viewer, `public-data.ts`, override-route, or `ViewbookField` behavior changes (the CTA seam move must be render-identical).
- `SECTION_TITLES['data-source']` → **"What we need from you"** lands in this PR, ordered before the seeder.
- Array-form `$transaction` only (nested `create` is a single statement — fine). No `Date.now()`-dependent seed content.
- Gates: `npx tsc --noEmit` + full `npx vitest run` + `npm run build`. U1 also touches `prisma/schema.prisma` — whichever merges second rebases + `npx prisma generate && rm -rf .test-dbs`.
- Worktree: `git worktree add .claude/worktrees/f1a-template-library -b feat/f1a-viewbook-template-library origin/main`, symlink `node_modules`, copy `.env` (never `.env.local`).

---

## File Structure

| File | Responsibility |
|---|---|
| `components/viewbook/public/section-titles.ts` (modify) | D-S title rename |
| `prisma/schema.prisma` (modify) + migration `viewbook_templates` | 3 new models, DDL only |
| `lib/viewbook/content-validators.ts` (create) | client-safe `validateTeam`/`validateBlocks`/`validatePcIntro` + caps + `PC_INTRO_DEFAULT` |
| `lib/viewbook/section-copy-validator.ts` (create) | client-safe `SectionCopyContent` + caps + `validateSectionCopy` (extracted; `section-copy-content.ts` re-exports) |
| `lib/viewbook/global-content.ts` (modify) | re-import validators (behavior-identical) |
| `components/viewbook/public/PcIntroSection.tsx` (modify) | use shared `PC_INTRO_DEFAULT` |
| `lib/viewbook/renderer-types.ts` (create) | `RENDERER_TYPES` registry (13 + `'generic'`) incl. CTA metadata |
| `lib/viewbook/section-copy.ts` (modify) | delete `cta` entries + the `cta` field |
| `components/viewbook/public/SectionShell.tsx` (modify) | read CTA from the registry |
| `lib/viewbook/template-content.ts` (create) | `{v:1,…}` envelope parsers + `toLegacy*` translators + `FIELD_KEY_RE` |
| `lib/viewbook/template-seed.ts` (create) | pure `projectTemplateSeed` + `seedViewbookTemplates` |
| `instrumentation.ts` (modify) | invoke seeder after `seedSystemSchedules()` |
| `lib/viewbook/template-seed.parity.test.ts` (create) | §6 seed-projection parity acceptance suite |

---

### Task 1: "What we need from you" rename (§8)

**Files:**
- Modify: `components/viewbook/public/section-titles.ts:7`
- Test: existing suites that assert the old title (grep `'Data Source'` in `components/viewbook` + `lib/viewbook` tests and update)

- [ ] **Step 1:** Change `'data-source': 'Data Source',` → `'data-source': 'What we need from you',`.
- [ ] **Step 2:** `grep -rn "'Data Source'" components/ lib/ app/ --include='*.ts*'` — update test expectations that pin the old title (title only; the `data-source` KEY never changes). Leave non-title uses (e.g. activity summaries reading "Data Source answer") untouched — the rename is the section display title only.
- [ ] **Step 3:** `npx vitest run` on the touched suites → PASS. **Step 4: Commit** — `feat(viewbook): rename Data Source section title to "What we need from you"`.

---

### Task 2: Schema — three template models (DDL only)

**Files:**
- Modify: `prisma/schema.prisma` (append after the viewbook model block)
- Create (generated): `prisma/migrations/<ts>_viewbook_templates/migration.sql`

**Interfaces:**
- Produces: `SectionTemplate`, `SubsectionTemplate`, `FieldTemplate` exactly as spec §3 (copy the Prisma block verbatim — `templateKey @unique`, `rendererType`, `title`, `copyJson`, `contentJson?`, `sortOrder`, `version @default(1)`, `archivedAt?`, timestamps; subsection `@@unique([sectionTemplateId, subsectionKey])` + offering booleans; field `fieldKey @unique`).

- [ ] **Step 1:** Paste the §3 model block into `prisma/schema.prisma` verbatim.
- [ ] **Step 2:** `npx prisma migrate dev --name viewbook_templates` → migration is pure `CREATE TABLE`/index DDL (verify: no `ALTER` of existing tables). `rm -rf .test-dbs`.
- [ ] **Step 3:** `npx tsc --noEmit` → clean. **Step 4: Commit.**

---

### Task 3: `content-validators.ts` extraction + `PC_INTRO_DEFAULT` (fixes #6, #7)

**Files:**
- Create: `lib/viewbook/content-validators.ts`; Test: `lib/viewbook/content-validators.test.ts`
- Modify: `lib/viewbook/global-content.ts` (delete the private copies, import), `components/viewbook/public/PcIntroSection.tsx` (import `PC_INTRO_DEFAULT`, delete local `FALLBACK_INTRO`)

**Interfaces:**
- Produces: `validateTeam(raw: unknown): TeamMember[] | null`, `validateBlocks(raw: unknown): ContentBlocks | null`, `validatePcIntro(raw: unknown): string | null`, `TEAM_CAPS`, `BLOCK_CAPS`, `PC_INTRO_CAP`, `PC_INTRO_DEFAULT: string`.

- [ ] **Step 1: Write failing tests** — move-verify: each validator accepts/rejects the same fixtures the existing `global-content.test.ts` covers (valid roster; >20 members null; unknown key null; photo failing `ASSET_FILENAME_RE` null; blocks with extra key null; pc-intro empty/oversized null). Assert the module is client-safe (imports only `./theme` + `./global-content-keys` — no `@/lib/db`).
- [ ] **Step 2:** MOVE the three validator functions + `isPlainObject` + the caps from `global-content.ts` (lines ~25-114) into `lib/viewbook/content-validators.ts` **unchanged** (exported). Set `PC_INTRO_DEFAULT` = the exact `FALLBACK_INTRO` string currently in `PcIntroSection.tsx:14` (copy verbatim).
- [ ] **Step 3:** `global-content.ts` imports them (`import { validateTeam, validateBlocks, validatePcIntro } from './content-validators'`); `PcIntroSection.tsx` renders `{data.global.pcIntro || PC_INTRO_DEFAULT}`.

- [ ] **Step 3b: extract `section-copy-validator.ts` (Codex plan-fix #1 — MUST).** `template-content.ts` (Task 5) cannot import `validateSectionCopy` from `section-copy-content.ts` — that module imports Prisma/the DB/`HttpError`/sync statements and would drag server code into a client-safe module. Create pure client-safe `lib/viewbook/section-copy-validator.ts` holding `SectionCopyContent`, `ResolvedSectionCopy`, the `CAPS` object, and `validateSectionCopy` MOVED verbatim; `section-copy-content.ts` imports AND re-exports them (zero behavior/import-site changes elsewhere). Test: module imports only types/pure code; existing `section-copy-content` suites stay green.
- [ ] **Step 4:** Full `npx vitest run lib/viewbook` → PASS (existing global-content suite proves behavior identical). **Step 5: Commit.**

---

### Task 4: `renderer-types.ts` registry + CTA seam move (fix #11)

**Files:**
- Create: `lib/viewbook/renderer-types.ts`; Test: `lib/viewbook/renderer-types.test.ts`
- Modify: `lib/viewbook/section-copy.ts` (drop `cta`), `components/viewbook/public/SectionShell.tsx:425`

**Interfaces:**
- Produces:

```ts
export const RENDERER_TYPE_IDS = ['welcome','milestones','data-source','brand','assessment','strategy','materials','pc-intro','pc-setup','pc-invite','pc-thanks','kickoff-next','ws-intro','generic'] as const
export type RendererTypeId = (typeof RENDERER_TYPE_IDS)[number]
export interface RendererTypeMeta {
  id: RendererTypeId
  // Optional primary action, moved verbatim from SECTION_COPY[key].cta
  cta: { label: string; sectionKey: SectionKey; anchor: string } | null
}
export const RENDERER_TYPES: Record<RendererTypeId, RendererTypeMeta>
export function isRendererTypeId(v: string): v is RendererTypeId
```

- [ ] **Step 1: Failing tests:** registry has exactly the 14 ids; `RENDERER_TYPES['pc-setup'].cta` equals the object currently in `SECTION_COPY['pc-setup'].cta` (`{ label: 'Fill in org basics', sectionKey: 'pc-setup', anchor: '#pc-setup' }`); every other id's `cta` is null; `isRendererTypeId('generic')` true / `'bogus'` false.
- [ ] **Step 2: Implement.** Client-safe module (imports only `SectionKey` type). Move the ONLY existing cta (`pc-setup` — verify with `grep -n "cta:" lib/viewbook/section-copy.ts`, currently one entry) into the registry; all other entries `cta: null`; `'generic'` reserves the id (component ships F3/F5b).
- [ ] **Step 3:** `section-copy.ts`: delete the `cta?` field from `SectionCopy` and the `cta:` entry from `pc-setup`. `SectionShell.tsx:425`: `const cta = SECTION_COPY[section.sectionKey]?.cta ?? null` → `const cta = RENDERER_TYPES[section.sectionKey]?.cta ?? null` (import from `@/lib/viewbook/renderer-types`; sectionKey ∈ RendererTypeId for all 13 — seeded rendererType == sectionKey, so this lookup is identity-preserving).
- [ ] **Step 4:** Run `npx vitest run components/viewbook lib/viewbook` → PASS (SectionShell suites prove render-identical). `npx tsc --noEmit`. **Step 5: Commit.**

---

### Task 5: `template-content.ts` — versioned envelopes + legacy translators (fix #10)

**Files:**
- Create: `lib/viewbook/template-content.ts`; Test: `lib/viewbook/template-content.test.ts`

**Interfaces:**
- Consumes: validators (Task 3), `validateSectionCopy`/`SectionCopyContent` (`./section-copy-validator` — the Task 3 Step 3b pure module, NEVER `./section-copy-content`), types from `./global-content-keys`.
- Produces (exact):

```ts
export const FIELD_KEY_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
export interface TemplateCopyV1 { v: 1; copy: SectionCopyContent }
export type SubsectionContentV1 =
  | { v: 1; team: TeamMember[]; process: ContentBlocks; why: ContentBlocks }      // welcome/main
  | { v: 1; seoBase: ContentBlocks; geoBase: ContentBlocks; eeatBase: ContentBlocks } // strategy/main
  | { v: 1; processMilestones: ContentBlocks }                                     // milestones/main
  | { v: 1; intro: string }                                                        // pc-intro/main
  | { v: 1; blocks: ContentBlocks }                                                // generic
export function parseTemplateCopy(raw: string | null): TemplateCopyV1 | null
export function parseSubsectionContent(rendererType: string, raw: string | null): SubsectionContentV1 | null
export function parseTemplateContent(rendererType: string, raw: string | null): null // section-level CONFIG — nothing defined in F1; non-null input parses to null + is the caller's logError signal
export function toLegacySectionCopy(copy: TemplateCopyV1): SectionCopyContent
export function toLegacyGlobalBody(key: GlobalContentKey, content: SubsectionContentV1): TeamMember[] | ContentBlocks | string | null
```

- [ ] **Step 1: Failing tests (Codex plan-fix #2 — characterize EVERY variant and translator branch; F1b's bridge contract rests on these):** strict whole-doc-reject (`ingest-schema.ts` convention): missing `v`, `v: 2`, extra keys, wrong inner shape → null; happy-path round-trips for ALL FIVE `parseSubsectionContent` variants (`welcome`, `strategy`, `milestones`, `pc-intro`, `generic`); UNKNOWN rendererType → null; a contentless renderer (e.g. `'brand'`) receiving NON-null content → null; `parseTemplateContent` rejects ALL non-null input (pinned so future code can't mistake arbitrary JSON for valid config); `parseTemplateCopy` inner `copy` validated with the SAME rules as `validateSectionCopy` (over-cap purpose → null); `toLegacySectionCopy` output passes `validateSectionCopy` (exactly 3 keys — never leaks `v`); **`toLegacyGlobalBody` tested for ALL EIGHT global keys** (`team`→roster, `pc-intro`→string, the six blocks keys→their `ContentBlocks`) AND renderer/key MISMATCHES (e.g. `toLegacyGlobalBody('team', strategyContent)`) → null; `FIELD_KEY_RE` accepts every catalog `defKey` (loop over `CATALOG`) and rejects `'A-upper'`, `'-lead'`, 65+ chars.
- [ ] **Step 2: Implement.** Pure, client-safe. Each parser: `JSON.parse` in try/catch → plain-object check → `v === 1` → exact key set for the renderer type → inner values through the Task-3 validators / `validateSectionCopy` → typed object; ANY failure → null (whole-doc reject, never partial).
- [ ] **Step 3:** Run tests → PASS. **Step 4: Commit.**

---

### Task 6: `template-seed.ts` — pure projection + atomic idempotent seeder (§5, fixes #5, #7, #13, #15)

**Files:**
- Create: `lib/viewbook/template-seed.ts`; Test: `lib/viewbook/template-seed.test.ts`
- Modify: `instrumentation.ts` (after the `seedSystemSchedules()` call, same failure isolation)

**Interfaces:**
- Consumes: `CATALOG`, `CATALOG_CATEGORIES` (`./catalog`); `CATEGORY_LABELS` (`./category-labels`); `SECTION_COPY` (`./section-copy`); `SECTION_TITLES` (`@/components/viewbook/public/section-titles`); `validateSectionCopy` (`./section-copy-content`); validators + `PC_INTRO_DEFAULT` (Task 3); envelope types (Task 5).
- Produces:

```ts
export const CANONICAL_SECTION_ORDER: readonly SectionKey[] // §0 order, exported for F3
export interface SeedFieldRow { fieldKey: string; label: string; fieldType: string; sortOrder: number }
export interface SeedSubsectionRow {
  subsectionKey: string; title: string
  offeringWebsite: boolean; offeringVa: boolean; offeringPpc: boolean
  copyJson: string | null; contentJson: string | null; sortOrder: number
  fields: SeedFieldRow[]
}
export interface SeedSectionTree {
  templateKey: SectionKey; rendererType: string; title: string
  copyJson: string; contentJson: string | null; sortOrder: number
  subsections: SeedSubsectionRow[]
}
export interface SeedSourceRow { key: string; bodyJson: string }
export interface SeedIssue { key: string; reason: 'corrupt-json' | 'invalid-shape' }
// Codex plan-fix #3: the projection is GENUINELY pure — it returns issues as
// DATA instead of calling logError. The seeder logs them.
export function projectTemplateSeedWithIssues(globalRows: SeedSourceRow[], sectionCopyRows: SeedSourceRow[]): { trees: SeedSectionTree[]; issues: SeedIssue[] }
export function projectTemplateSeed(globalRows: SeedSourceRow[], sectionCopyRows: SeedSourceRow[]): SeedSectionTree[] // = .trees convenience wrapper (parity tests use either)
export async function seedViewbookTemplates(): Promise<void>
// Internal, exported for tests (Codex plan-fixes #5/#6):
export async function createSeedTree(tree: SeedSectionTree): Promise<void> // the ONE nested create production uses
export interface SeedDeps { beforeCreate?: (templateKey: string) => Promise<void> } // test barrier seam
```

- [ ] **Step 1: Failing tests for `projectTemplateSeed`** (pure — feed fixture rows):
  - 13 trees in `CANONICAL_SECTION_ORDER`, sortOrder `10,20,…,130`; `rendererType === templateKey` for all; section `contentJson === null` for all.
  - `copyJson` decodes to `{v:1, copy}` where `copy` = the `section-copy:<key>` fixture when present+valid, else `SECTION_COPY[key]`'s 3-key projection.
  - `title === SECTION_TITLES[key]` (data-source = "What we need from you").
  - Every non-data-source section: ONE subsection `'main'`, `title` = the section title, `offeringWebsite: true`, va/ppc false, `copyJson: null`, `fields: []`.
  - `data-source`: 8 subsections in `CATALOG_CATEGORIES` order, `subsectionKey` = category id, `title = CATEGORY_LABELS[category]`, sortOrder ×10; fields = that category's `CATALOG` entries (`fieldKey = defKey`, label/fieldType/sortOrder preserved).
  - Content mapping: `welcome/main.contentJson` decodes to `{v:1, team, process, why}` from the fixture rows; `strategy/main` → `{v:1, seoBase, geoBase, eeatBase}`; `milestones/main` → `{v:1, processMilestones}`; `pc-intro/main` → `{v:1, intro}`; all other subsections `contentJson: null`.
  - Absent global rows → `team: []` / `{blocks: []}`; `pc-intro` absent → `intro: PC_INTRO_DEFAULT`; corrupt/malformed bodyJson AND structurally-invalid (parses but fails the validator) rows — for BOTH global keys and `section-copy:*` keys — → treated absent AND reported in `issues` (`corrupt-json` vs `invalid-shape`); the projection itself never logs (fix #3).
- [ ] **Step 2: Implement the projection.** `projectTemplateSeedWithIssues` is pure — no `Date`/`Math.random`/IO/logging; issues are returned data. Global-body resolution: find row by key → `JSON.parse` try/catch (`corrupt-json`) → Task-3 validator (`invalid-shape`) → valid value or empty default. Section-copy resolution: `section-copy:<key>` row → `validateSectionCopy` (from `section-copy-validator.ts`) → else `SECTION_COPY[key]` (3-key projection, `cta` already gone per Task 4). Envelopes via `JSON.stringify({ v: 1, ... })`. `projectTemplateSeed` = thin `.trees` wrapper.
- [ ] **Step 3: Failing tests for `seedViewbookTemplates`** (DB-backed):
  - Empty DB → 13 `SectionTemplate` rows each with complete subtree (assert counts: 13 sections, 20 subsections (12×1 + 8), `CATALOG.length` fields).
  - Idempotent re-run → zero new rows; an operator-edited row (bump `title`, `version: 2`) survives re-run untouched (**seeder never updates**).
  - **Nested-write atomicity (Codex plan-fix #5 — real SQLite proof, no Prisma mocking):** call the production `createSeedTree` directly with a SYNTHETIC tree containing two fields with the SAME globally-unique `fieldKey` → the nested create rejects → assert parent section, subsections, AND fields are ALL absent (the nested create is one statement; a partial tree is impossible).
  - **Concurrent-loser path (Codex plan-fix #6 — deterministic, not `Promise.all`-and-hope):** using the `SeedDeps.beforeCreate` barrier seam, hold TWO seeder runs at the same `templateKey`'s create until both have passed `findUnique`, then release → exactly one create wins, the loser P2002s, re-reads the winner, continues; exactly 13 complete trees remain.
  - A nested `fieldKey` collision with a PRE-EXISTING row (pre-insert a `FieldTemplate` with `fieldKey: 'school-name'` under a dummy tree) → that section is logged + skipped, the other 12 seed fine.
  - **Infra errors propagate (fix #4):** a closed/unavailable DB (or an injected non-P2002 failure) makes `seedViewbookTemplates` THROW — never a silent partial "success".
- [ ] **Step 4: Implement `seedViewbookTemplates`.** Load `globalRows` (`viewbookGlobalContent.findMany({ where: { key: { in: [...GLOBAL_CONTENT_KEYS] } } })`) + `sectionCopyRows` (`key: { in: SECTION_KEYS.map(sectionCopyKey) } }`) → `projectTemplateSeedWithIssues` → `logError` each issue → for each tree: `findUnique({ where: { templateKey } })` → skip if present; else `deps.beforeCreate?.(templateKey)` → `createSeedTree(tree)` (`prisma.sectionTemplate.create({ data: { …, subsections: { create: tree.subsections.map(s => ({ …, fields: { create: s.fields } })) } } })`). **Error handling (Codex plan-fix #4 — winner-based, not metadata-based):** on ANY P2002 (never inspect `meta.target` — its representation is not a correctness fence), re-read `templateKey`: winner exists → continue (concurrent-seed race); NO winner → a nested uniqueness defect (e.g. global `fieldKey` collision) → `logError({ subsystem: 'viewbook', op: 'template-seed', templateKey }, err)` + skip that section. Any NON-P2002 error PROPAGATES (rethrow) to the instrumentation catch — a database/infrastructure failure must never be converted into a successful partial seed.
- [ ] **Step 5: Wire into `instrumentation.ts`** directly after `await seedSystemSchedules()`:

```ts
// F1a: seed the viewbook template library. NEW failure isolation (Codex
// plan-fix #7 — instrumentation.ts has no logError binding today and does not
// independently catch seedSystemSchedules): a seed failure is logged and boot
// continues; it must never crash-loop the app.
try {
  const { seedViewbookTemplates } = await import('@/lib/viewbook/template-seed')
  await seedViewbookTemplates()
} catch (err) {
  const { logError } = await import('@/lib/log')
  logError({ subsystem: 'viewbook', op: 'template-seed-boot' }, err)
}
```

(The dynamic `logError` import inside the catch matches the file's lazy-import style; this is deliberately NEW isolation, not a mirror of how `seedSystemSchedules` is invoked.)
- [ ] **Step 6: Run tests** → PASS. **Step 7: Commit.**

---

### Task 7: Seed-projection parity acceptance suite (§6, fix #15)

**Files:**
- Create: `lib/viewbook/template-seed.parity.test.ts`

This is the roadmap's "byte-parity" bar in its additive-phase form — comparisons on DECODED values, not raw JSON strings, over the SAME `projectTemplateSeed` the seeder uses.

- [ ] **Step 1: Write the suite** (these are acceptance tests — expected to pass against Tasks 3–6; any failure is a Task 3–6 bug):
  - **Copy parity, per key (Codex plan-fix #8 — explicit expected value):** a raw `{key, bodyJson}` fixture cannot be passed to `resolveSectionCopy` directly — first `validateSectionCopy(JSON.parse(row.bodyJson))` (the extracted pure validator), THEN assert `toLegacySectionCopy(parseTemplateCopy(tree.copyJson)!)` deep-equals `resolveSectionCopy(key, validatedGlobal, null)` for all 13 keys — with and without a `section-copy:` row (precedence asserted for at least one key).
  - **Title parity:** `tree.title === SECTION_TITLES[key]` for all 13; the data-source rename asserted explicitly (`'What we need from you'`).
  - **Content parity:** decoded `welcome/main` content deep-equals the exact objects the global store serves (`validateTeam(JSON.parse(teamRow.bodyJson))` incl. photo filenames; `validateBlocks` for process/why); same for strategy/milestones keys; `pc-intro` string equality; comparisons on decoded values.
  - **Catalog parity:** flattened `FieldTemplate` seed rows (data-source subsections, category order, field sortOrder) deep-equal `CATALOG` on `(fieldKey←defKey, category←subsectionKey, label, fieldType, sortOrder)` — order-sensitive; subsection titles ≡ `CATEGORY_LABELS`.
  - **Behavior:** absent globals → empty seeds + pc-intro fallback; corrupt bodyJson → absent + logged; `section-copy:` precedence over code default. (Atomicity/double-seed/edit-preservation live in Task 6's suite; the F1b bridge-parity test lands with F1b.)
- [ ] **Step 2: Run** `npx vitest run lib/viewbook/template-seed.parity.test.ts` → PASS. **Step 3: Commit.**

---

### Task 8: Gates + PR

- [ ] **Step 1:** `npx tsc --noEmit` clean; full `npx vitest run` green; `npm run build` succeeds.
- [ ] **Step 2:** Verify additive claims: `git diff origin/main -- lib/viewbook/public-data.ts app/api/viewbook` is EMPTY except intended files; grep confirms no legacy write path changed.
- [ ] **Step 3:** Open PR `feat(viewbook): F1a template library — schema, registry, boot seeder, parity`. Body: spec/plan links, §0 sign-off note (order confirmed 2026-07-22), parity-suite summary, F1b out-of-scope list. Deploy note: first prod boot seeds 13 trees from live global content — check PM2 stderr for `template-seed` logError lines after deploy.

---

## Self-Review notes

- Spec coverage: §0→Task 6 (order constant), §3→Task 2, §4→Tasks 3/4/5, §5→Task 6, §6→Task 7, §8→Task 1. §7 (F1b) intentionally absent. Fixes touching F1a: #5 (Task 6 atomic nested create), #6 (Task 3), #7 (Tasks 3/6 empty-seed + PC_INTRO_DEFAULT), #8 (Task 2 fieldKey unique + Task 5 FIELD_KEY_RE), #10 (Task 5), #11 (Task 4), #12 (schema `version` columns land in Task 2; bump RULES are F1b — no F1a mutation surface exists), #13 (Tasks 1/6 CATEGORY_LABELS titles), #15 (Tasks 6/7 shared projection).
- Type consistency: `SeedSectionTree`/`projectTemplateSeed` defined in Task 6, consumed in Task 7; envelope parsers defined Task 5, consumed Tasks 6/7; `PC_INTRO_DEFAULT` defined Task 3, consumed Tasks 6/7.
- Deliberate choice to flag for review: `parseTemplateContent` returns null-always in F1 (no section-level config shapes exist); F1b/F2 will extend it — kept in the module so the seam exists from day one. Codex confirmed acceptable with the all-non-null-input-rejected behavior pinned by test.
- Codex plan-review (8 fixes) applied 2026-07-22: Tasks 3/5/6/7 amended in place — see the Plan review header line. Codex also confirmed: TEAM_CAPS/BLOCK_CAPS/PC_INTRO_CAP are module-private today (safe to move); the `RENDERER_TYPES[section.sectionKey]` transitional CTA lookup is render-identical for F1a (F2 must switch to the snapshotted `rendererType`); post-first-boot prod verify = exactly 13 sections / 20 subsections / `CATALOG.length` fields + zero `template-seed` diagnostics.
