# F2 — Viewbook Instances + Copy-on-Create Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Codex-reviewed 2026-07-23 (Sol): accept with 12 named fixes — ALL applied in this revision (test-based deterministic fixture capture + normalize helper out of scripts/; Tasks 2+4 merged into one gate-green schema task; relation graph PINNED — Prisma 7.9 probe validated the shared-scalar composite relations, atomic nested create required, multi-txn fallback deleted; projection takes `kind` + raw template loader + member-mapped assetPlan; phase-2 asset rewrite bumps scoped syncVersion; single aggregate-bump semantics; pull ownership predicates + empty-after-filter behavior + injectable race hook; offering txn order reversed (companions first, throwing flag flip LAST); archived fences cover service.ts mutations + operator-data + pinned per-route error shapes; Task 10 includes public-types.ts, admin split into DTO/service vs UI tasks incl. ViewbookEditor/admin-shared/ViewbookIndex/ViewbookCard; retirement enumerates test fallout and KEEPS `syncVersionBumpAll*` for docs.ts global-doc fanout).

**Goal:** Snapshot the F1 template library into per-viewbook section/subsection instance rows at creation (copy-on-create, offering-filtered), add versioned per-section pull-merge + offering flags, cut the viewer/admin read model over to instances, then retire the legacy `ViewbookGlobalContent`/`ViewbookContentOverride` stores and the F1b dual-write bridge.

**Architecture:** Evolve `ViewbookSection` into the section instance (aggregate-version-fenced) + new `ViewbookSubsection` table (composite tenant-integrity FKs, shared `viewbookId` scalar — Prisma-7.9-validated); `ViewbookField` gains required `subsectionId`. One pure projection (`projectInstanceTree`) feeds create/enable/pull. Public payload keeps its `data.global`/`data.sectionCopy` shape derived from instances so the 13 section components stay parity-stable. Two migrations: A (instances + test-viewbook wipe) early, B (legacy-table drop) last.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite (array-form `$transaction` ONLY), vitest, sharp.

**Spec:** `docs/superpowers/specs/2026-07-23-f2-viewbook-instances-cutover-design.md` (Codex-reviewed twice; §4 relation pin, §5 assetPlan/member mapping + phase-2 sync bump, §6 empty-after-filter + ownership predicates, §7 statement order, §10 bumpAll retention are BINDING). Read it before starting.

## Global Constraints

- Array-form `$transaction([...])` only — NEVER interactive `$transaction(async tx => ...)`. Conditional logic goes in SQL (`EXISTS`, subselects); raw statements set `updatedAt` manually (`Date.now()`, integer ms).
- Throwing conditional-update guards (P2025 pattern, `service.ts:397` precedent) inside array txns for hard preconditions; P2002 rollback for uniqueness races.
- New API routes: cookie-gated by omission (NO `middleware.ts` change), `withRoute` + `parseJsonBody`, machine-readable error codes. Archived instances reuse each route's EXISTING hidden-section error shape.
- Local gates are the ONLY gates: `npx tsc --noEmit` + full `npx vitest run` + `npm run build` before PR. Every task ends gate-green.
- Worktree lane: `git worktree add .claude/worktrees/f2-instances-cutover -b feat/f2-viewbook-instances` off FRESH `origin/main`; symlink `node_modules`, copy `.env` (never `.env.local`).
- After schema changes: `npx prisma migrate dev --name <name>` then `rm -rf .test-dbs`.
- No new env vars. No AI-API features. All existing viewbooks are test-only (D4) — the wipe is sanctioned.
- §0/§15 Kevin sign-offs (offering-disable archival, CSM roster source, equal-version refresh, wipe timing) gate the MERGE, not the build.

---

### Task 1: Parity fixture capture (pre-F2 code, FIRST commit on the branch)

**Files:**
- Create: `lib/viewbook/__fixtures__/parity-normalize.ts` (test-support module — NOT under scripts/)
- Create: `lib/viewbook/__fixtures__/f2-parity-public-data.json`
- Create: `lib/viewbook/f2-parity.test.ts`

**Interfaces:**
- Produces: `normalizeParityPayload(data: unknown): unknown` (pure; ids→0, token→"TOKEN", ISO timestamps→"TS", roster photo filenames→`PHOTO_<n>` in first-seen order) and the frozen pre-cutover `ViewbookPublicData` JSON per `kind` (`new-build`, `upgrade`). Task 10 imports BOTH.

The branch tip is still identical to `origin/main` here — the fixture captures PRE-F2 behavior, from the isolated vitest worker DB with fully deterministic inputs (no dev-DB dependence, no wall-clock names in the payload).

- [ ] **Step 1: Write the normalize helper**

```ts
// lib/viewbook/__fixtures__/parity-normalize.ts
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const PHOTO_RE = /^[0-9a-f-]{36}\.webp$/

export function normalizeParityPayload(data: unknown): unknown {
  const photoMap = new Map<string, string>()
  return JSON.parse(
    JSON.stringify(data, (key, value) => {
      if (key === 'viewbookId' || key === 'id') return 0
      if (key === 'token') return 'TOKEN'
      if (typeof value === 'string' && ISO_RE.test(value)) return 'TS'
      if (key === 'photo' && typeof value === 'string' && PHOTO_RE.test(value)) {
        if (!photoMap.has(value)) photoMap.set(value, `PHOTO_${photoMap.size + 1}`)
        return photoMap.get(value)
      }
      return value
    }),
  )
}
```

- [ ] **Step 2: Write the capture/assert test** — one file, two modes: `F2_PARITY_CAPTURE=1 npx vitest run lib/viewbook/f2-parity.test.ts` writes the fixture; normal runs assert against it. Deterministic setup: seed templates (`seedViewbookTemplates()`), upsert a FIXED `ViewbookGlobalContent` roster (2 members, member 1 with a real saved `'global'`-scope photo via `saveViewbookAsset`, member 2 photoless) + fixed `process`/`why`/`seo-base` blocks + a `section-copy:welcome` row BEFORE capture, so the payload exercises roster photos, blocks, and section-copy precedence. Fixed client name `f2-parity-client`.

```ts
// lib/viewbook/f2-parity.test.ts (capture-era form; Task 10 extends it)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFile } from 'fs/promises'
import { prisma } from '@/lib/db'
import { seedViewbookTemplates } from './template-seed'
import { createViewbook, deleteViewbook } from './service'
import { loadViewbookPublicData } from './public-data'
import { normalizeParityPayload } from './__fixtures__/parity-normalize'
import fixture from './__fixtures__/f2-parity-public-data.json'

const CAPTURE = process.env.F2_PARITY_CAPTURE === '1'

async function seedDeterministicContent() { /* upserts described in Step 2 prose — full code in the test */ }

async function buildPayload(kind: 'new-build' | 'upgrade') {
  const client = await prisma.client.create({ data: { name: `f2-parity-client-${kind}` } })
  const vb = await createViewbook(client.id, kind, 'parity@enrollmentresources.com')
  const data = await loadViewbookPublicData(vb.token)
  const normalized = normalizeParityPayload(data)
  await deleteViewbook(vb.id)
  await prisma.client.delete({ where: { id: client.id } })
  return normalized
}

describe('F2 rendered-parity gate', () => {
  beforeAll(async () => { await seedViewbookTemplates(); await seedDeterministicContent() })
  afterAll(async () => { await prisma.client.deleteMany({ where: { name: { startsWith: 'f2-parity-client' } } }) })

  it('fresh-viewbook payload matches the pre-F2 fixture (both kinds)', async () => {
    const out: Record<string, unknown> = {}
    for (const kind of ['new-build', 'upgrade'] as const) out[kind] = await buildPayload(kind)
    if (CAPTURE) {
      await writeFile('lib/viewbook/__fixtures__/f2-parity-public-data.json', JSON.stringify(out, null, 2))
      return
    }
    expect(out).toEqual(fixture)
  })

  it('new-build assessment section is hidden, upgrade active (state pin — visibility is stage-gated later)', async () => {
    // direct prisma read of ViewbookSection.state per kind — pins fix #12 independent of lineups
  })
})
```

- [ ] **Step 3: Capture** — `F2_PARITY_CAPTURE=1 npx vitest run lib/viewbook/f2-parity.test.ts`, eyeball the JSON (13 `sectionCopy` keys, roster with `PHOTO_1` + null, `section-copy:welcome` precedence visible), then run WITHOUT the env → PASS (self-consistency on pre-F2 code).
- [ ] **Step 4: Commit** — `test(viewbook): deterministic pre-F2 public-data parity fixture (Task 1)`

---

### Task 2: `extractInstanceAssetRefs` — the single asset-ref home

**Files:**
- Create: `lib/viewbook/instance-asset-refs.ts`
- Test: `lib/viewbook/instance-asset-refs.test.ts`

**Interfaces:**
- Produces: `extractInstanceAssetRefs(rendererType: string, contentJson: string | null): string[]` — pure, never throws (corrupt JSON → `[]`). Consumed by Tasks 3 (asset copy), 8 (allowlist/retention/delete unions).

- [ ] **Step 1: Failing tests**

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

- [ ] **Step 2: Run → FAIL. Implement** (parse via `parseSubsectionContent('welcome', …)` from `template-content.ts`; filter photos through the filename grammar — locate its export with `grep -rn "ASSET_FILENAME_RE" lib/` and import from its real home). Run → PASS.
- [ ] **Step 3: Commit** — `feat(viewbook): extractInstanceAssetRefs single asset-ref home (Task 2)`

---

### Task 3: Migration A + projection + `createViewbook` rewrite (ONE gate-green change — Codex fix #2)

Migration A makes `ViewbookField.subsectionId` required and adds NOT NULL instance columns, which breaks `createViewbook` AND every direct Prisma fixture in the suite — schema, projection, creation rewrite, and fixture repairs land as one task so every commit is green. This is the plan's biggest task by design; its internal steps are still bite-sized.

**Files:**
- Modify: `prisma/schema.prisma` (spec §4 verbatim: Viewbook offering flags + `subsections`; ViewbookSection instance columns + `@@unique([id, viewbookId])` + `subsections` + `sectionTemplate` SetNull relation + `archiveReason`; new ViewbookSubsection with composite `section` relation AND direct `viewbook` relation (Prisma-7.9-validated shared scalar); ViewbookField `subsectionId` + composite `subsection` relation + `archiveReason`; inverse arrays on SectionTemplate/SubsectionTemplate)
- Create: `prisma/migrations/<ts>_viewbook_instances/migration.sql` (generated, then prepend `DELETE FROM "Viewbook";` as the first statement)
- Create: `lib/viewbook/instance-snapshot.ts`
- Modify: `lib/viewbook/service.ts` (`createViewbook`), `lib/viewbook/template-service.ts` (add `loadTemplateTreeRaw()`), `app/api/viewbooks/route.ts` (POST offerings + GET availability)
- Modify: every test file that creates `ViewbookField`/`ViewbookSection` rows directly — enumerate with `grep -rln "viewbookField.create\|viewbookField.createMany\|sections: { create" lib/ app/ components/ --include='*.test.ts*'` and add the now-required columns via ONE shared test helper (`lib/viewbook/__fixtures__/instance-test-helpers.ts`: `mkSectionInput(key, overrides?)`, `mkFieldInput(defKey, overrides?)`) so future schema drift is one-file
- Test: `lib/viewbook/instance-schema.test.ts`, `lib/viewbook/instance-snapshot.test.ts`, extend `lib/viewbook/service.test.ts`

**Interfaces:**
- Produces:
  - `loadTemplateTreeRaw(): Promise<RawTemplateSection[]>` — server-only; RAW rows (`templateKey, rendererType, title, copyJson, contentJson, sortOrder, version, archivedAt` + nested subsections/fields with raw JSON strings + offering booleans). The projection snapshots RAW envelopes verbatim — `getTemplateTree()`'s decoded views stay admin-UI-only (Codex fix #5).
  - `projectInstanceTree(raw: RawTemplateSection[], offerings: {website, va, ppc}, kind: 'new-build' | 'upgrade'): { sections: SectionInstanceInput[], assetPlan: AssetPlanEntry[] }` — `AssetPlanEntry = { sectionKey: string, subsectionKey: string, refs: [{ memberName: string, filename: string }] }` (member-mapped so phase 2 rewrites the right roster entry).
  - `projectSectionInstance(rawSection, offerings)` — single-section variant for pull/enable.
  - `offeringAvailability(raw): {website, va, ppc}` — available iff ≥1 active subsection carries the tag.
  - `snapshotInstanceAssets(viewbookId: number, plan: AssetPlanEntry[]): Promise<void>` — phase 2; per entry: read global file → save to `String(viewbookId)` scope → ONE `$transaction([guarded subsection contentJson UPDATE fenced on version (photo set by memberName), bumpSectionAggregate, syncVersionBumpStatement(viewbookId)])` (spec §5 — the rewrite changes rendered content, so it bumps sync); fence loss → delete new files + `logError`.
  - `createViewbook(clientId, kind, createdBy, offerings?)` — offerings default `{website: true, va: false, ppc: false}`; **ONE atomic nested `prisma.viewbook.create`** (viewbook + sections + subsections + fields + DEFAULT_MILESTONES — Prisma populates composite scalars from parents; if the generated client rejects nested composite creates at RUNTIME, fall back to a SINGLE array-form txn of raw INSERTs with durable-key subselects — NEVER a multi-transaction split, Codex fix #4); then phase-2 `snapshotInstanceAssets(...).catch(logError)`. 400 `invalid_offerings` (all false), 409 `offering_unavailable`.

- [ ] **Step 1: Schema + `npx prisma migrate dev --name viewbook_instances`** → prepend the wipe to the generated SQL → `npx prisma migrate reset --force --skip-seed && rm -rf .test-dbs`.
- [ ] **Step 2: Schema tests (write first, expect FAIL until Step 1 lands + helpers exist)**

```ts
// lib/viewbook/instance-schema.test.ts
it('rejects a SUBSECTION pointing at another viewbook\'s section (composite FK)', async () => { /* two clients/viewbooks; cross-pair create rejects */ })
it('rejects a FIELD pointing at another viewbook\'s subsection (composite FK)', async () => { /* same shape one level down (Codex fix #3) */ })
it('creates one complete nested instance tree through Viewbook → sections → subsections → fields', async () => {
  // ONE prisma.viewbook.create with 2 sections / 3 subsections / 2 fields nested;
  // asserts composite scalars (viewbookId on every row) were populated by Prisma.
})
```

- [ ] **Step 3: Projection tests + implementation** (`instance-snapshot.test.ts` — offering filtering D5; subsection filtering; fields carry `category = subsectionKey`; welcome roster null-stripped with member-mapped assetPlan; `kind` drives assessment `'hidden'`/`'active'`; archived template rows skipped; raw envelopes copied byte-verbatim for non-welcome content). Implement `instance-snapshot.ts` + `loadTemplateTreeRaw`. Run → PASS.
- [ ] **Step 4: Rewrite `createViewbook`** per the produced interface; remove the old SECTION_KEYS/CATALOG seed entirely. Extend `service.test.ts`: 13/20/35 tree for website offerings against seeded templates; photos copied + contentJson rewritten + files on disk + **syncVersion bumped by phase 2** (compare pre/post); phase-2 failure (mock read throw) → photos null, viewbook intact, syncVersion NOT bumped by the failed rewrite; `offering_unavailable` on `{va: true, website: false}`; nested-create atomicity (force a mid-create constraint failure → zero rows remain).
- [ ] **Step 5: Fixture-repair sweep** — run the FULL suite; for every failure caused by the new required columns, route the fixture through `instance-test-helpers.ts`. Expected hot spots: `service.test.ts`, `answers.test.ts`, `ack.test.ts`, `digest.test.ts`, `public-data.test.ts`, route tests under `app/api/viewbooks`. Task 1's parity test must still PASS byte-identically (creation output is projection-fed but the legacy read path is untouched — this is the mid-plan parity checkpoint).
- [ ] **Step 6: POST/GET route** — POST body optional `offerings` (validated booleans); viewbooks GET gains `availability` (`offeringAvailability(await loadTemplateTreeRaw())`).
- [ ] **Step 7: Full gates → green. Commit** — `feat(viewbook): F2 instance schema, wipe migration, projection and copy-on-create (Task 3)`

---

### Task 4: Instance content mutations (`instance-service.ts`) + single-bump aggregate fence

**Files:**
- Create: `lib/viewbook/instance-service.ts`
- Modify: `app/api/viewbooks/[id]/sections/[sectionKey]/route.ts`, `app/api/viewbooks/[id]/fields/route.ts`, `app/api/viewbooks/[id]/fields/[fieldId]/route.ts`
- Create: `app/api/viewbooks/[id]/subsections/[subId]/route.ts`
- Test: `lib/viewbook/instance-service.test.ts`

**Interfaces:**
- Produces:
  - `patchSectionInstance(viewbookId, sectionKey, {version, title?, copy?}, updatedBy)` — the section's OWN guarded update increments `version` once; **NO separate `bumpSectionAggregate` statement (Codex fix #7 — that would double-increment)**.
  - `patchSubsectionInstance(viewbookId, subId, {version, title?, copy?, content?}, updatedBy)` — txn = `[guarded subsection update (throwing, fenced on subsection version), bumpSectionAggregateGuarded(sectionId, viewbookId), syncVersionBumpStatement(viewbookId)]` — EXACTLY ONE owning-section bump.
  - `bumpSectionAggregateGuarded(sectionId, viewbookId)` — **throwing** raw update (`$queryRaw … RETURNING id` checked non-empty, or a guarded `update` that P2025s on miss) — never a silent zero-row no-op.
- Mixed edits: a request carrying BOTH state fields (`state`/`introNote`) AND instance fields (`title`/`copy`) → 400 `invalid_field` (compose one or the other; the state path keeps today's unfenced semantics).
- Consumes: parsers from `template-content.ts`, `syncVersionBumpStatement` from `sync.ts`.

- [ ] **Step 1: Failing tests** — copy patch → copyJson updated + section.version EXACTLY +1 + syncVersion +1; stale version → 409 + rollback pin (nothing changed); subsection content patch → subsection.version +1 AND section.version EXACTLY +1 in one txn; invalid content shape → 400 `invalid_content`; mixed state+instance body → 400; field create/archive bumps section aggregate exactly once + archive stamps `archiveReason: 'operator'` + value/amendments survive.
- [ ] **Step 2: Implement. Step 3: Routes** (presence of `title`/`copy` switches the section PATCH to the fenced path requiring `version`; field routes add the guarded aggregate bump to their EXISTING txns + archiveReason).
- [ ] **Step 4: Suite + tsc → green. Commit** — `feat(viewbook): instance content mutations with single-bump aggregate fence (Task 4)`

---

### Task 5: Pull — versioned per-section merge

**Files:**
- Modify: `lib/viewbook/instance-service.ts` (add `pullSectionFromTemplate`)
- Create: `app/api/viewbooks/[id]/sections/[sectionKey]/pull/route.ts`
- Test: `lib/viewbook/instance-pull.test.ts`

**Interfaces:**
- Produces: `pullSectionFromTemplate(viewbookId, sectionKey, expectedVersion, updatedBy, deps?)` → `{summary, section}`; 409 `version_conflict` | `template_missing` | `template_archived`. `deps?: { beforeCommit?: () => Promise<void> }` — test-only injection point between statement-build and `$transaction` for deterministic race tests (Codex fix #8; house DI precedent).
- Consumes: `projectSectionInstance`, `extractInstanceAssetRefs`, `bumpSectionAggregateGuarded` (only for statements not already touching the section row), `snapshotInstanceAssets`-style copy helpers.

Implementation shape:
1. Load section instance (+ ALL subsections incl. archived + this-section fields) and `loadTemplateTreeRaw()`'s section. Precondition HttpErrors per spec §6. Equal-version pull is legal (repair path).
2. Offering-filter the template subsections. **Zero active matches → the merge archives every instance subsection AND the section (`archiveReason: 'pull'`)** — spec §6 empty-after-filter rule, not an error.
3. Compute merge diff in pure code → statements. Asset pre-copy for template refs (member-mapped), rewriting contentJson strings in-memory.
4. `await deps?.beforeCommit?.()` then ONE `$transaction([...])`:
   - Throwing guarded section UPDATE fenced `version = expectedVersion` (sets title/rendererType/copyJson/contentJson/templateVersion, `version + 1` — the ONLY section-row bump in the txn).
   - Matched subsections: guarded UPDATEs (overwrite scalars; clear archivedAt/archiveReason).
   - New subsections: plain `INSERT`s.
   - Field updates/re-parents: raw UPDATE with durable-key subselect for `subsectionId` + **ownership predicate** (spec §6): only rows whose current `subsectionId` belongs to THIS section (or whose defKey matches a template field of this section for cross-section restore) are touched:

```ts
prisma.$executeRaw`
  UPDATE "ViewbookField" SET
    "subsectionId" = (SELECT s."id" FROM "ViewbookSubsection" s
      WHERE s."viewbookId" = ${viewbookId} AND s."sectionId" = ${sectionId} AND s."subsectionKey" = ${subKey}),
    "category" = ${subKey}, "label" = ${tf.label}, "sortOrder" = ${tf.sortOrder},
    "archivedAt" = CASE WHEN "archiveReason" = 'operator' THEN "archivedAt" ELSE NULL END,
    "archiveReason" = CASE WHEN "archiveReason" = 'operator' THEN "archiveReason" ELSE NULL END,
    "updatedAt" = ${Date.now()}
  WHERE "viewbookId" = ${viewbookId} AND "defKey" = ${tf.fieldKey}`
```

   - Field archives (template counterpart gone from THIS section): raw UPDATE stamping `archivedAt`/`'pull'` with `AND "subsectionId" IN (SELECT id FROM "ViewbookSubsection" WHERE "sectionId" = ${sectionId})` — a concurrently-moved field is out of reach.
   - Missing fields: `INSERT … SELECT` resolving subsectionId by durable key (`createdBy: 'pull'`, version 0, value NULL).
   - `syncVersionBumpStatement(viewbookId)`.
5. Post-commit: whole-viewbook post-commit asset union (ALL subsections incl. archived) → delete replaced files only when absent from it. Txn throw → delete NEW files.

- [ ] **Step 1: Failing test matrix** — value+amendments survive relabel/reorder; template-only subsection created WITH fields; instance-only archived `'pull'`; cross-subsection re-parent (same row id); cross-SECTION move (archived by pull(A), restored+re-parented by pull(B)); operator-archived field never restored; custom field untouched; stale version → 409 + rollback; **race: `beforeCommit` bumps the section version → 409, zero changes**; equal-version pull repairs photoless viewbook (+ syncVersion bump); empty-after-filter archives section+subsections; shared-filename replacement NOT deleted while another subsection references it; `template_missing`/`template_archived`.
- [ ] **Step 2: Implement. Step 3: Route (POST `{version}`). Step 4: Suite + tsc → green. Commit** — `feat(viewbook): versioned per-section template pull-merge (Task 5)`

---

### Task 6: Offerings PATCH — one fenced operation, flag flip LAST

**Files:**
- Modify: `lib/viewbook/instance-service.ts` (`updateViewbookOfferings`)
- Create: `app/api/viewbooks/[id]/offerings/route.ts`
- Test: `lib/viewbook/instance-offerings.test.ts`

**Interfaces:**
- Produces: `updateViewbookOfferings(viewbookId, next, expected, updatedBy, deps?)`; 400 `invalid_offerings`, 409 `offerings_conflict` | `offering_unavailable`. Same `deps.beforeCommit` race seam as pull.
- **Statement order (Codex fix #9, spec §7):** all companion mutations FIRST, each predicated on the `expected` PRE-state flags (`AND EXISTS (SELECT 1 FROM "Viewbook" v WHERE v."id" = ? AND v."offeringWebsite" = ? …)`); the **throwing guarded flag UPDATE runs LAST** — its P2025 on a concurrent change rolls back every companion; putting it first would make the companions silently no-op.
- Restores: `archivedAt = NULL, archiveReason = NULL` ONLY on `'offering'`-reason rows (frozen — no content overwrite); field restores exclude `'operator'`. Creates from CURRENT template via `projectSectionInstance`; their asset copies run post-commit phase-2 (degrade-to-null; equal-version pull repairs; sync bump per spec §5).

- [ ] **Step 1: Failing tests** — disable va → va-exclusive subsections+fields archived `'offering'` + emptied sections archived; multi-tag (website+va) subsection survives; re-enable restores FROZEN (pre-disable local edit survives untouched) + skips operator-archived fields + creates since-added template subsections; `expected` mismatch → 409 + NOTHING changed (assert via `beforeCommit` flipping a flag → rollback of companions proven); all-false → 400; enable ppc → 409 `offering_unavailable`; answers survive round-trip; syncVersion +1 exactly once; **both race orders: companion-first commit vs guard-first conflict** (Codex verify item).
- [ ] **Step 2: Implement. Step 3: Route + wire availability into the response. Step 4: Suite + tsc → green. Commit** — `feat(viewbook): offering enable/disable as one fenced operation (Task 6)`

---

### Task 7: `archivedAt` behavioral fences — clients, operators, inspector

**Files:**
- Modify: `lib/viewbook/ack.ts` (ack fence + `pcCompletedAt` requirement set + reset), `lib/viewbook/answers.ts`, `lib/viewbook/setup.ts`, `lib/viewbook/team-members.ts`, `lib/viewbook/public-writes.ts`, `lib/viewbook/collapse.ts`, `lib/viewbook/service.ts` (`setSectionState`, `updateSectionText`), `lib/viewbook/operator-data.ts` (exclude archived from the inspector payload)
- Test: extend each module's existing test file

**Interfaces:** none new — each existing fence's SQL predicate gains `AND "archivedAt" IS NULL` on the section (plus the owning-subsection join for field writes: `applyAnswerEdit`/`proposeAmendment` require live subsection AND live section). **Each route keeps its EXISTING hidden-section error shape** for the archived case (find each with `grep -n "hidden" lib/viewbook/<module>.ts` and reuse the same code/status — Codex fix #10).

- [ ] **Step 1: Failing tests per module** — ack on archived section → same error as hidden; answer edit on field under archived subsection → rejected; `setSectionState`/`updateSectionText` on archived → rejected; operator-data payload omits archived sections/subsections; `pcCompletedAt` requirement set EXCLUDES archived sections (archive `pc-invite`, ack the other two → completes).
- [ ] **Step 2: Implement (extend the SAME predicates — never a separate pre-read). Step 3: Suite + tsc → green. Commit** — `feat(viewbook): archived instances are inert across client, operator and inspector surfaces (Task 7)`

---

### Task 8: Asset allowlist + retention + delete-snapshot unions

**Files:**
- Modify: `app/api/viewbook/[token]/assets/[filename]/route.ts` (add live-subsection instance-ref lookup; REMOVE the global team-roster branch), `lib/viewbook/retention.ts` (5th lookup, archived-INCLUSIVE), `lib/viewbook/service.ts` (`deleteViewbook` + `collectClientViewbookAssetSnapshot` unions)
- Test: extend the assets route tests + `lib/viewbook/retention.test.ts` + `service.test.ts`

**Interfaces:** all three consume `extractInstanceAssetRefs` (Task 2) with ONE shared fixture module across the three test files (a producer can't register on one side only). Serving = LIVE subsections of LIVE sections only; retention/delete = ALL subsections including archived (spec §8).

- [ ] **Step 1: Failing tests** — instance photo serves for owning token; 404 for another token; 404 when its subsection OR section is archived; global-scope roster filename 404s on the public route; file referenced ONLY by an archived subsection survives the sweep; unreferenced instance-scope file past grace is pruned; `deleteViewbook` removes instance-referenced files (archived included).
- [ ] **Step 2: Implement. Step 3: Suite + tsc → green. Commit** — `feat(viewbook): instance asset refs join serving allowlist, retention and delete unions (Task 8)`

---

### Task 9: Read-model cutover — public payload + renderer switch + components + parity gate

**Files:**
- Modify: `lib/viewbook/public-data.ts`, `lib/viewbook/public-types.ts` (`PublicSection` gains `title` + `rendererType`; `sectionCopy` becomes `Partial<Record<string, ResolvedSectionCopy>>`; `overrides` removed — Codex fix #11: this file was missing from the inventory), `lib/viewbook/template-content.ts` (move `BRIDGED_CONTENT` here from template-service as `INSTANCE_CONTENT_SLOTS`; keep a `BRIDGED_CONTENT` re-export alias until Task 12 deletes the bridge), `app/(public)/viewbook/[token]/page.tsx` (switch on `section.rendererType`), `components/viewbook/public/SectionShell.tsx` + all 13 section components (title from payload; StrategySection/MilestonesSection drop override merge)
- Modify: `lib/viewbook/f2-parity.test.ts` (final gate form)
- Test: extend `lib/viewbook/public-data.test.ts`

**Interfaces:**
- Produces: the cutover payload — `PublicSection.title`/`.rendererType`; `data.global` assembled from instance content via `INSTANCE_CONTENT_SLOTS`; `data.sectionCopy` partial with corrupt-copyJson fallback to `SECTION_COPY[key]` for the 13 known keys (+ `logError`), empty otherwise; `data.overrides` gone.
- Consumes: instance columns (Task 3), `toLegacySectionCopy`/`parseSubsectionContent` (template-content.ts), fixture + `normalizeParityPayload` (Task 1).

- [ ] **Step 1: Extend the parity test into the final gate** — same deterministic setup; normalizations per spec §12: strip `title`/`rendererType` additions from the new payload + delete `overrides` from the EXPECTED fixture before comparing; photo filenames already normalized by the shared helper. Add the title pin: every payload section's `title` === `SECTION_TITLES[sectionKey]`.
- [ ] **Step 2: Rewrite content loads in `public-data.ts`** — sections query selects instance columns + live subsections (`archivedAt: null` both levels; `state` filter unchanged); delete `loadGlobal`/`loadOverrides`; keep `guarded()` per block.
- [ ] **Step 3: Switch + components** — `baseRenderSection` keys on `section.rendererType` (`'generic'`/unknown → null, the pinned F2 limitation); 13 components + SectionShell take `title={section.title}` and drop `SECTION_TITLES` imports; StrategySection/MilestonesSection drop the two `data.overrides[key]` merge lines.
- [ ] **Step 4: Run the parity gate** → PASS (this is the spec's rendered-parity acceptance). **Step 5: tsc + full vitest → green. Commit** — `feat(viewbook): read-model cutover — viewer renders instance rows, parity-gated (Task 9)`

---

### Task 10: Admin cutover A — DTO/service wiring (Codex fix #11 split)

**Files:**
- Modify: `lib/viewbook/service.ts` (`getViewbookAdmin`), `lib/viewbook/viewbook-admin-shared.ts` (admin DTO types), `lib/viewbook/template-service.ts` (add `getTemplateTeamRoster()` — used by Task 12's consumers AND kept here so the admin DTO task is self-contained for type-checking)
- Test: extend `lib/viewbook/service.test.ts`

**Interfaces:**
- Produces: `getViewbookAdmin` serves `sections: AdminSectionInstance[]` (`{id, sectionKey, rendererType, title, copy (decoded), state, version, templateVersion, currentTemplateVersion: number | null, archivedAt, sortOrder, subsections: AdminSubsectionInstance[] (decoded content + version + archivedAt + offering booleans)}`) and viewbook `offerings` + `availability`; the `contentOverrides` include and legacy sectionCopy resolve are DELETED. `getTemplateTeamRoster(): Promise<TeamMember[]>` (welcome-renderer `SubsectionTemplate.contentJson`; corrupt/absent → `[]` + `logError`).
- Consumes: `loadTemplateTreeRaw` (version join), template-content parsers.

- [ ] **Step 1: Failing service tests** — instance tree + `currentTemplateVersion` join present; no `contentOverrides` key; archived subsections included WITH their archivedAt (admin sees archived state, unlike the viewer); roster reader returns seeded roster.
- [ ] **Step 2: Implement + update the DTO types in `viewbook-admin-shared.ts`. Step 3: Suite + tsc → green (admin UI still compiles against the old props ONLY if untouched — where types break, fix the consuming components minimally in this task; the UI REBUILD is Task 11). Commit** — `feat(viewbook): admin DTO serves instance tree with template-version join (Task 10)`

---

### Task 11: Admin cutover B — ContentTab v2 + editor surfaces

**Files:**
- Modify: `components/viewbook/admin/ContentTab.tsx` (rebuild), `components/viewbook/admin/ViewbookEditor.tsx` (tab wiring + offerings controls), the viewbook list/create components (`grep -rn "kind.*new-build" components/viewbook/admin/` — `ViewbookIndex`/`ViewbookCard` per Codex) for creation offering checkboxes (disabled when unavailable), the DataTab sync-questions button (remove)
- Test: ContentTab component test + creation-form test

**Interfaces:**
- Consumes: Tasks 4/5/6 routes + Task 10 DTO. ContentTab v2 scope (capability parity, spec §9): per-section copy form; per-subsection content forms for block-shaped/pc-intro content (reuse F1b form pieces from `components/viewbook/admin/templates/` where they fit); roster read-only; per-section **Pull** button — ALWAYS enabled ("Refresh from template"), badge when `templateVersion < currentTemplateVersion`, §6 confirmation dialog ("replaces this section's content with the current template; answers, history, and completion are kept"); offerings checkboxes with `expected`-carrying PATCH + unavailable options disabled; 409 → refetch-and-notify (F1b editor pattern).

- [ ] **Step 1: Component tests** — pull button enabled at equal versions + badge only when newer; confirm dialog gates the POST; offerings checkboxes disable unavailable; 409 resyncs.
- [ ] **Step 2: Rebuild + remove sync-questions button and its call sites. Step 3: Suite + tsc → green. Commit** — `feat(viewbook): admin content tab reads/writes instances; pull + offerings UI (Task 11)`

---

### Task 12: Operational roster consumers + retirement of legacy stores (migration B)

**Files:**
- Create: `app/api/viewbook-templates/team-roster/route.ts` (GET, cookie-gated)
- Modify: `components/viewbook/admin/CsmPicker.tsx`, `lib/viewbook/service.ts` (`assignViewbookCsm`), `lib/viewbook/email.ts` (`resolvePcCompleteRecipient`) — all three onto `getTemplateTeamRoster` (spec §11: operational reads use the CURRENT template roster)
- Delete: `app/api/viewbook-content/[key]/route.ts`, `app/api/viewbook-content/team-photo/route.ts`, `app/api/viewbooks/section-copy/[sectionKey]/route.ts`, `app/api/viewbooks/[id]/overrides/[contentKey]/route.ts`, `app/api/viewbooks/[id]/section-copy/[sectionKey]/route.ts`, `app/api/viewbooks/[id]/sync-questions/route.ts`, `lib/viewbook/section-copy-content.ts`, `lib/viewbook/global-content.ts`, `lib/viewbook/template-service.parity.test.ts`, **plus their test files** (enumerate: `grep -rln "viewbook-content\|section-copy-content\|global-content\|sync-questions" lib/ app/ components/ --include='*.test.ts*'` — each is either deleted with its subject or re-pointed; the F1 seed-projection parity tests that import legacy readers are re-pinned to consts-only expectations — Codex fix #12)
- Modify: `lib/viewbook/template-service.ts` (delete bridged writers, legacy interleaves, `LEGACY_KEY_TARGET`, `reconcileSeededTemplates`, the `BRIDGED_CONTENT` alias; `attachTemplateTeamPhoto` becomes template-only, owning the save→fenced-txn→delete-old FILE flow), `lib/viewbook/template-seed.ts` (consts-only projection), `instrumentation.ts` (drop reconcile call), `lib/viewbook/service.ts` (delete `syncCatalogQuestions`), `prisma/schema.prisma` (drop the two models)
- **KEEP `lib/viewbook/sync.ts` `syncVersionBumpAllStatement`/`syncVersionBumpAllWhere`** — `docs.ts` global-document mutations still fan out to every viewbook (Codex fix #12; spec §10).
- Create: `prisma/migrations/<ts>_drop_viewbook_legacy_stores/migration.sql` (exactly the two `DROP TABLE`s)
- Test: re-pin `template-seed.test.ts` + `template-service.test.ts`; add the syncVersion-policy test; add a docs-fanout regression test (global doc create still bumps every viewbook)

**Interfaces:** type imports of `ResolvedSectionCopy`/`SectionCopyContent` re-point to `section-copy-validator.ts`; any surviving content types stranded by the `global-content.ts` deletion move to `content-validators.ts`.

- [ ] **Step 1: Roster consumers first** (route + 3 migrations + tests) — commit separately: `feat(viewbook): operational roster reads move to the template roster (Task 12a)`.
- [ ] **Step 2: Deletions + `attachTemplateTeamPhoto` rewrite + seeder consts-only + `npx prisma migrate dev --name drop_viewbook_legacy_stores` + `rm -rf .test-dbs`.**
- [ ] **Step 3: Policy tests** — template copy/content/photo edit bumps NO viewbook syncVersion; instance edit/pull/offerings/phase-2 bumps exactly its own; global-doc mutation still bumps all.
- [ ] **Step 4: Grep gates** — `grep -rn "viewbookGlobalContent\|viewbookContentOverride" lib/ app/ components/ --include='*.ts*'` → EMPTY; `grep -rn "syncCatalogQuestions\|putContentOverride\|getGlobalContent\|BRIDGED_CONTENT" lib/ app/ components/` → EMPTY.
- [ ] **Step 5: Full gates incl. `npm run build` → green. Commit** — `feat(viewbook): retire legacy content stores, bridge and reconcile; seeder goes consts-only (Task 12b)`

---

### Task 13: Final review, gates, PR

- [ ] **Step 1: Self-review the whole branch** against spec §§4–12: four asset seams share `extractInstanceAssetRefs`; every fence lists `archivedAt`; `grep -rn '\$transaction(async' lib/ app/` → empty; offering txn order (companions first, flag flip last) verified in code.
- [ ] **Step 2: Full gates** — `npx tsc --noEmit && npx vitest run && npm run build`.
- [ ] **Step 3: PR** — body records: two-migration deploy shape + §11 old-build/new-schema window (deploy off-hours); D4 wipe consequence (every open client link dies — cascades team members, auth sessions, delivery ledgers); §0/§15 Kevin sign-off checklist (offering archival, CSM roster source, equal-version refresh, wipe timing); deviations. Request Codex pre-merge review (roadmap §7 requires it for F2).
- [ ] **Step 4: STOP — do not merge** until Codex pre-merge review + Kevin's §0/§15 sign-offs.

---

## Self-review notes (spec coverage)

- §4 schema/relations → Task 3; §5 snapshot/create/assetPlan/phase-2 bump → Tasks 2–3; §6 pull (fence, subselects, ownership predicates, empty-after-filter, equal-version) → Tasks 4–5; §7 offerings + fences → Tasks 6–7; §8 assets → Tasks 2/3/5/8; §9 cutover → Tasks 9 (viewer) + 10/11 (admin) + 4 (mutation routes); §10 syncVersion (bumpAll KEPT for docs) → Tasks 4/12; §11 retirement + roster consumers → Task 12; §12 parity/testing → Tasks 1/9 + per-task suites; §0/§15 → Task 13 PR checklist.
- Deliberate residue: `SECTION_COPY`/`SECTION_TITLES`/`CATALOG` remain as seed inputs only; `collapsedShared` untouched; assessment-image delete-snapshot gap untouched (spec §8).
