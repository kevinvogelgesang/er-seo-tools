# F2 — Viewbook instances + copy-on-create (THE CUTOVER) — design

**Status:** spec for the Claude-built F2 lane (Onboarding Viewbook roadmap, Track 1).
**Roadmap:** `docs/superpowers/nyi/improvement-roadmaps/2026-07-22-onboarding-viewbook-roadmap.md` — D4/D5/D6/D8/D15, the F2 section, and the template/instance identity contracts (Codex fix #4) are BINDING. **F1 §9 (team roster = uniform copy-on-create, frozen + explicit pull) is a SETTLED Kevin decision F2 inherits — not a question.**
**Tracker:** `docs/superpowers/todos/2026-07-22-onboarding-viewbook-tracker.md`.
**Sequencing:** after F1a (PR #265) + F1b (PR #268), both shipped. F3 (viewer rebuild) builds directly on this. One PR, Claude lane, Codex pre-merge review required (roadmap §7 names F2 a risky F-track PR).

## 0. §9 Q3 — offering DISABLE behavior (**Kevin call — BLOCKS F2 merge, not spec/plan work**)

Recommendation (matches roadmap's own "recommended"): disabling an offering **ARCHIVES** offering-exclusive subsection instances (and the fields they own) — `archivedAt` stamped, data fully preserved, hidden from viewer/admin render; a section instance left with zero live subsections is archived too. **Re-enabling restores**: archived instances matching the re-enabled offering are un-archived in place (answers/history intact) and refreshed to current template content via the same merge as pull; template subsections with no instance are snapshot-created. Alternative (rejected): hard-delete on disable — destroys client answers for a reversible flag flip, and D9's append-only-history philosophy says never. Consequence to confirm: re-enable un-archives ALL fields owned by a restored subsection, including any field an operator individually archived earlier (edge accepted for v1; noted in §7).

## 1. Goal

Every viewbook becomes a self-contained **instance tree** snapshotted from the F1 template library at creation (copy-on-create, D8): per-viewbook section + subsection rows carrying their own copy of titles, copy, content, offering tags, order, and **assets** — rendering never touches a template or global row again. `Viewbook` gains offering flags (D5); `ViewbookField` becomes subsection-instance-owned; "update to current global version" becomes a **versioned per-section pull-merge** that preserves answers and history. The viewer/admin read model cuts over atomically to instances, THEN the legacy stores (`ViewbookGlobalContent`, `ViewbookContentOverride`), their routes, and the F1b dual-write bridge are retired. All existing viewbooks are test-only and are **wiped in the migration** (D4 — no data migration owed).

## 2. Current state (verified 2026-07-23)

- **Templates (F1):** `SectionTemplate`/`SubsectionTemplate`/`FieldTemplate` seeded 13/20/35 in prod; `getTemplateTree` + 7 mutation functions in `template-service.ts`, all version-fenced. `FieldTemplate.fieldKey` is library-global-unique and documented as the F2 answer-preservation join key onto `ViewbookField.defKey` (`@@unique([viewbookId, defKey])`). Envelope parsers + legacy translators live in **`lib/viewbook/template-content.ts`** (not `renderer-types.ts` — F1 spec §4's location claim was off by one file). Content validators (`validateTeam`/`validateBlocks`/`validatePcIntro`) already extracted client-safe (`content-validators.ts`); `TeamMember.photo` is `string | null` (photoless members render without images).
- **Bridge (F1b, deleted whole here):** all legacy-content writes route through `template-service.ts` — bridged writers (`putGlobalContentBridged`/`putSectionCopyGlobalBridged`/`deleteSectionCopyGlobalBridged`/`attachTeamPhotoBridged`), legacy statement interleaves inside `patchSectionTemplate`/`patchSubsection`, `reconcileSeededTemplates` boot pass (marker row `template-library:reconciled`), and the `BRIDGED_CONTENT` map (welcome→{team,process,why}, strategy→{seo,geo,eeat-base}, milestones→{process-milestones}, pc-intro→{pc-intro}).
- **Legacy stores + complete consumer list (grep-verified, no consumers outside `lib/viewbook`):** `ViewbookGlobalContent` read/written by `global-content.ts`, `section-copy-content.ts`, `template-seed.ts` (seed projection reads), `template-service.ts` (bridge). `ViewbookContentOverride` read by `public-data.ts` `loadOverrides` + `getViewbookAdmin` include + `section-copy-content.ts`; written by `putContentOverride`/`deleteContentOverride` + section-copy override writers.
- **Viewer read seam** is entirely inside `lib/viewbook/public-data.ts`: `loadGlobal()` (per-key `getGlobalContent`), `loadOverrides()`, `getSectionCopyGlobalMap`/`getSectionCopyOverrideMap` + `resolveSectionCopy` → served as `data.global` / `data.overrides` / `data.sectionCopy`. Exactly 4 components read `data.global`/`data.overrides` (WelcomeSection team+why+process; StrategySection + MilestonesSection blocks merged with override text; PcIntroSection pcIntro∥`PC_INTRO_DEFAULT`); all 13 pass `data.sectionCopy[key]` into `SectionShell` (ⓘ tooltip + purpose header). Titles come from code const `SECTION_TITLES`; the renderer switch in `app/(public)/viewbook/[token]/page.tsx` maps `sectionKey`→component 1:1; order comes from `STAGE_LINEUPS` (untouched until F3).
- **Admin read/write:** `getViewbookAdmin` includes raw `contentOverrides` + resolves the sectionCopy map; `ContentTab` drives `PUT/DELETE /api/viewbooks/[id]/overrides/[contentKey]` (eligible keys = the 6 block keys — `OVERRIDE_ELIGIBLE_KEYS`) and `…/[id]/section-copy/[sectionKey]`. `syncCatalogQuestions` + `POST …/sync-questions` backfill missing CATALOG defKeys. Custom operator fields (`POST …/[id]/fields`) validate `category ∈ CATALOG_CATEGORIES` — always one of the 8 (== the seeded data-source subsectionKeys).
- **Fields:** `ViewbookField` rows are seeded eagerly from `CATALOG` in `createViewbook`'s single nested create (with sections from `SECTION_KEYS`, milestones from `DEFAULT_MILESTONES`); answers via `answers.ts` with `version` optimistic concurrency + amendment rows.
- **Assets:** `<VIEWBOOK_ASSETS_DIR>/<scope>/<uuid>.webp|.pdf`, scope = `'global'` | viewbook-id string. Serving = ONE public allowlist route (`/api/viewbook/[token]/assets/[filename]`): theme ∪ docs ∪ assessment images ∪ feedback images ∪ **global team-roster photos**. Retention union (`pruneOrphanedViewbookAssetFiles`, per-viewbook scopes only, 24 h grace, any-lookup-throw aborts the scope) mirrors the first four. Team photos are **mutable shared global files deleted on replace** (`attachTeamPhoto`) — copying a filename is NOT a snapshot (roadmap fix #5c). The template admin renders no photo preview (no admin serving dependency on the global-roster branch).
- **syncVersion:** `lib/viewbook/sync.ts` factories; template/bridged writes currently bump ALL viewbooks (rendering depends on globals); every per-viewbook mutation bumps its own row; public viewer + admin poll `{v}`.

## 3. Approaches considered

- **A (chosen): evolve `ViewbookSection` into the section instance + new `ViewbookSubsection` table; keep the public payload shape (`data.global`/`data.sectionCopy`) derived from instances.** One row per section keeps state/ack/content together (D6: sections stay the ack unit), reuses `@@unique([viewbookId, sectionKey])` as the durable instance key that already drives anchors/theme/ack/inspector, and the payload-compat loader keeps the 13 section components byte-stable for the parity gate. Wipe (D4) makes the required-column rebuild trivial.
- **B (rejected): separate `ViewbookSectionInstance` table beside `ViewbookSection`.** Two rows per section, every consumer joins state↔content, ack/hidden semantics split across tables — pure cost, no isolation gain.
- **C (rejected for F2): restructure the public payload to a sections→subsections shape and rewrite the 13 components now.** That is F3's viewer rebuild; doing it inside the cutover PR destroys the rendered-parity gate and doubles the blast radius.

## 4. Data model (one migration: new columns/tables + **wipe** + legacy drops)

```prisma
// Viewbook additions (D5) — validated ≥1 true at every write surface
offeringWebsite Boolean @default(true)
offeringVa      Boolean @default(false)
offeringPpc     Boolean @default(false)

// ViewbookSection additions — the section INSTANCE (identity contracts: snapshot
// rendererType/title/content/version; FK SetNull; rendering never reads the template)
sectionTemplateId Int?      // → SectionTemplate, onDelete: SetNull
rendererType      String    // snapshot; NEVER identity (sectionKey stays the durable per-viewbook key)
title             String    // snapshot — viewer reads THIS from F2 on (F1b promised "applies after cutover")
copyJson          String    // snapshot {v:1, copy:{purpose,whatThis,whatWeNeed}} (TemplateCopyV1)
contentJson       String?   // snapshot of section-level renderer config (none seeded; carried for parity with templates)
sortOrder         Int       // snapshot of the single total order — STORED now, viewer adopts it in F3
templateVersion   Int       // SectionTemplate.version at snapshot/pull time ("update available" = < current)
version           Int       @default(1)  // instance optimistic concurrency (mutations + pull fence on it)
archivedAt        DateTime? // offering-disable archival — DISTINCT from state='hidden' (operator choice)

model ViewbookSubsection {
  id                   Int                 @id @default(autoincrement())
  viewbookId           Int                 // denormalized for allowlist/retention scans
  viewbook             Viewbook            @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  sectionId            Int
  section              ViewbookSection     @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  subsectionTemplateId Int?                // → SubsectionTemplate, onDelete: SetNull
  subsectionKey        String              // durable within the section; seeded = template subsectionKey
  title                String
  offeringWebsite      Boolean             @default(false)  // snapshot of template tags at snapshot/pull time
  offeringVa           Boolean             @default(false)
  offeringPpc          Boolean             @default(false)
  copyJson             String?             // {v:1, copy:{intro?, whatWeNeed?}} (SubsectionCopyV1)
  contentJson          String?             // {v:1, ...} per-renderer content — asset refs point at THIS VIEWBOOK's scope (§8)
  sortOrder            Int
  version              Int                 @default(1)
  archivedAt           DateTime?
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @updatedAt
  fields               ViewbookField[]
  @@unique([sectionId, subsectionKey])
  @@index([viewbookId])
}

// ViewbookField addition — fields become subsection-instance-owned (roadmap F2)
subsectionId Int
subsection   ViewbookSubsection @relation(fields: [subsectionId], references: [id], onDelete: Cascade)
```

- `ViewbookField` keeps `viewbookId`, `defKey` (`@@unique([viewbookId, defKey])` — the pull join key), `category`, `label`, `fieldType`, `sortOrder`, `version`, `archivedAt` unchanged — **the viewer/admin field rendering is untouched in F2** (grouping stays `category`; the subsection-shaped re-shell is F3). `category` stays consistent by construction: every field's owning subsection has `subsectionKey === category` (catalog seed + §9 custom-field mapping).
- **Migration order (one migration, real SQL):** `DELETE FROM "Viewbook"` FIRST (cascades wipe every child — D4), then the table rebuilds/adds (all instance tables empty → NOT NULL columns are clean), then `DROP TABLE "ViewbookContentOverride"` and `DROP TABLE "ViewbookGlobalContent"` (the reconcile marker row dies with its code). Orphaned per-viewbook asset files left by the wipe are collected by the existing orphan sweep (empty referenced-union → deleted after the 24 h grace).
- No new env vars. No middleware change (every new route is cookie-gated `/api/viewbooks/*`).

## 5. Copy-on-create snapshot

`lib/viewbook/instance-snapshot.ts` — **ONE pure projection** (F1 fix-#15 pattern): `projectInstanceTree(templateTree, offerings)` → the full nested rows for every ACTIVE (non-archived) template section with ≥1 active subsection matching the enabled offerings (D5), containing only matching subsections, each carrying its active `FieldTemplate` rows as `ViewbookField` inputs (`defKey = fieldKey`, `category = subsectionKey`, value null, `createdBy: 'seed'`). Used by `createViewbook`, offering-enable (§7), pull's create-missing branch (§6), and the tests.

`createViewbook(clientId, kind, offerings, createdBy)` becomes two phases:
1. **One nested `prisma.viewbook.create`** (array-form txn as today): viewbook row (+ offering flags) + section instances + subsection instances + fields + `DEFAULT_MILESTONES`. Roster photo refs in subsection content are written as `photo: null` in this phase (never a `'global'` filename — a global name in instance content would either break on template replace or leak template-current files; `TeamMember.photo` is nullable so the render degrades to photoless, honestly).
2. **Best-effort asset snapshot** (`snapshotInstanceAssets`, §8): copy each referenced global file into the new viewbook's scope, then a per-subsection fenced txn rewrites `contentJson` with the new filenames (fence on subsection `version`; fence loss → delete the new files). A phase-2 failure logs and leaves photos null — a later **pull repairs it**; the viewbook is never broken, only photoless. (Scope = the viewbook id, which does not exist before phase 1 — full single-txn atomicity is impossible without interactive transactions, which are banned.)

`syncCatalogQuestions` + `POST /api/viewbooks/[id]/sync-questions` are **retired** — pull (§6) is the backfill path.

## 6. Pull — "update to current template version" (versioned MERGE, per section)

`POST /api/viewbooks/[id]/sections/[sectionKey]/pull` `{version}` → `pullSectionFromTemplate()` in the new `lib/viewbook/instance-service.ts`. Preconditions: instance exists; `sectionTemplateId` non-null (else 409 `template_missing` — SetNull'd/never-linked instances can't pull); template section not archived (409 `template_archived`).

**Merge semantics (the roadmap fix-#5 contract, pinned):**
- **Section scalars:** `title`/`rendererType`/`copyJson`/`contentJson` ← template; `templateVersion` ← current `SectionTemplate.version`; instance `version`++. `state`/`introNote`/`narrative`/`acknowledgedAt`/`doneAt` are per-viewbook state — NEVER touched by pull.
- **Subsections** diffed by `subsectionKey` against the template's ACTIVE subsections filtered to the viewbook's enabled offerings:
  - *Both sides:* overwrite `title`/`copyJson`/`contentJson`/offering booleans; `version`++; `archivedAt` cleared (the match set is already offering-filtered, so an offering-archived subsection outside the filter never appears here).
  - *Template-only:* snapshot-create the instance (+ its fields + assets).
  - *Instance-only (template counterpart archived or gone):* stamp `archivedAt` — **archive, never delete** (answers + history preserved).
- **Fields** matched by `defKey == fieldKey` **viewbook-globally** (the `@@unique([viewbookId, defKey])` join): existing → update `label`/`sortOrder`, re-parent `subsectionId` + `category` to the current owning subsection, clear `archivedAt`; **`value`/`version`/amendment history are NEVER touched**; missing → create (`createdBy: 'pull'`); instance fields under this section's subsections whose defKey has no active `FieldTemplate` in this section's template → archive (a field that MOVED to another template section is restored + re-parented when THAT section is pulled — defKey matching is viewbook-global, so no duplicate row can exist). `fieldType` is immutable template-side (F1 has no PATCH surface) — pull never changes it; custom fields (`defKey null`) are untouched.
- **Local-edit policy (pinned): pull OVERWRITES instance content/copy/titles wholesale, behind a UI confirmation** ("replaces this section's content with the current template; answers, history, and completion are kept"). Selective merge is rejected — it is an F5b-scale diff UI for marginal value, and D8's model is freeze + explicit pull, not three-way merge.
- **Mechanics:** asset pre-copy (new files into viewbook scope) → ONE array-form txn (throwing conditional-update guards fenced on the request's expected section `version`, F1b P2025 pattern; P2002 on subsection/field creates rolls back whole) → post-commit best-effort delete of REPLACED instance-scope files; txn failure deletes the NEW files. Scoped syncVersion bump inside the txn. Response: `{summary: {subsectionsAdded/Updated/Archived, fieldsAdded/Updated/Archived}}` + the refreshed section tree.
- **"Update available" indicator:** `getViewbookAdmin` serves each instance's `templateVersion` alongside the current template `version`; ContentTab badges sections where they differ (cheap read, no polling).

## 7. Offering flags — enable/disable after creation

`PATCH /api/viewbooks/[id]/offerings` `{offeringWebsite, offeringVa, offeringPpc}` (operator; ≥1 true or 400 `invalid_offerings`). Creation UI gains the three checkboxes (website pre-checked).

- **Enable:** for each active template section with ≥1 active subsection matching the NEW offering set: no instance → snapshot-create from the CURRENT template (mixed-vintage trees are legal; pull normalizes); instance exists → archived matching subsections are restored via the §6 per-subsection merge (un-archive + refresh to current template; owned fields un-archived), template subsections with no instance are snapshot-created; an archived section instance that regains a live subsection is un-archived.
- **Disable:** every live subsection instance whose SNAPSHOT offering tags no longer intersect the enabled set → `archivedAt` (+ its fields); a section left with zero live subsections → `archivedAt`. **Data preserved** per §0's recommendation.
- Renderer/admin filter `archivedAt: null` everywhere (§8). Scoped syncVersion bump. Asset copies for newly-created subsections follow §5 phase-2 (degrade-to-null + pull repairs).

## 8. Asset snapshot layer (roadmap fix #5c: "copying a filename is NOT a snapshot")

- **`lib/viewbook/instance-asset-refs.ts` — pure, THE single home** of `extractInstanceAssetRefs(rendererType, contentJson) → string[]` (today: welcome-renderer roster photos; future renderers add here). Consumed by ALL FOUR seams so they cannot drift (the admin-polish lesson, now structural): (1) snapshot/pull asset copy, (2) the serving-route allowlist, (3) the retention union, (4) the delete-snapshot.
- **Copy:** `snapshotInstanceAssets` reads each source file (`readViewbookAsset('global', f)` at create/enable; the template's global-scope roster files remain the source of truth for templates), saves a NEW uuid file into `String(viewbookId)` scope, rewrites the subsection `contentJson`. Missing/corrupt source → that ref becomes null + `logError` (honest degrade). Instances therefore reference ONLY their own scope — the template photo replace flow (which deletes the old global file) can no longer break any viewbook, which is the freeze F1 §9 promised.
- **Serving allowlist** (`/api/viewbook/[token]/assets/[filename]`): add lookup (5) — filenames extracted from the token's own live subsection instances, viewbook scope. **Remove the global team-roster branch** — post-cutover no public surface references global roster files (verified: the template admin renders no photo preview), and keeping it would serve template-current files to any token holder (curation drift). Same-404 discipline unchanged.
- **Retention union** (`pruneOrphanedViewbookAssetFiles`): add subsection-instance refs as the 5th lookup, preserving the any-throw-aborts-scope fault isolation. **Delete-snapshot:** `deleteViewbook` + `collectClientViewbookAssetSnapshot` add instance refs to the filename union. (Known pre-existing gap — assessment images are snapshotted by the route, not `deleteViewbook` — is NOT F2's to fix; noted so the plan doesn't "helpfully" refactor it.)

## 9. Read-model cutover (atomic within the PR)

- **`loadViewbookPublicData`:** the sections query selects the instance columns (+ live subsections); `data.sectionCopy` is built from instance `copyJson` via the existing `toLegacySectionCopy` translator (map keyed by the viewbook's OWN sectionKeys now, not all 13); `data.global` (same `PublicGlobalContent` shape — team/blocks/pcIntro) is assembled from the welcome/strategy/milestones/pc-intro instance subsection content through the `BRIDGED_CONTENT` mapping, which is RETAINED and renamed (`INSTANCE_CONTENT_SLOTS`, moved next to the parsers in `template-content.ts`) — it stops being a bridge map and becomes the instance→payload projection. `data.overrides` is DELETED from the payload; StrategySection/MilestonesSection drop their two override-merge lines (no rendered change post-wipe: there are no override rows). Corrupt instance JSON degrades per-block via the existing `guarded()` fault isolation. Archived sections/subsections are filtered out. `pc-thanks` gating, hidden-state filtering, `STAGE_LINEUPS` ordering: **unchanged** (F3's territory).
- **Renderer switch** keys on the instance's snapshot `rendererType` (identity contract: rendering never reads the current template row); for the seeded 13, `rendererType === sectionKey`, so the mapping is behavior-identical. `'generic'` still renders null — **pinned F2 limitation:** operator-created template subsections (generic content) ARE snapshotted into instances but are NOT rendered until F3's subsection-aware viewer; the 13 section renderers render exactly the content shapes they render today. (VA/PPC content authoring is the next roadmap; nothing user-visible is lost.)
- **`SectionShell` title** comes from the instance row (`section.title`) instead of `SECTION_TITLES` — the F1b promise "title edits apply after template cutover". Anchors, theme heroes, ack routes, inspector selection stay keyed by `sectionKey`.
- **`getViewbookAdmin`:** drop the `contentOverrides` include + legacy sectionCopy resolve; serve the instance tree (sections + live subsections, decoded content, `templateVersion` vs current template version). `operator-data.ts` is untouched (reads no content).
- **ContentTab v2 (capability parity, not the F5b editor):** per-section copy form (instance `copyJson`), per-subsection content forms for the block-shaped/pc-intro content (reusing F1b's validated form components against instance endpoints), the roster shown READ-only (per-viewbook roster editing is deliberately absent — frozen + pull is the F1 §9 decision), and the per-section **Pull** button with the update-available badge + §6 confirmation. Custom-field creation (`POST …/fields`) additionally resolves `subsectionId` from `category` (always one of the 8 data-source subsectionKeys — route already validates `category ∈ CATALOG_CATEGORIES`; missing subsection instance → 409 `conflicting_ops`).
- **New instance mutation routes** (cookie-gated, `withRoute` + `parseJsonBody`, version-fenced 409 `version_conflict`, single-surface service functions in `instance-service.ts` — AI-readiness §6: JSON-serializable ops, durable addressing, machine-readable 4xx): extend `PATCH /api/viewbooks/[id]/sections/[sectionKey]` with `{version, title?, copy?}`; new `PATCH /api/viewbooks/[id]/subsections/[subId]` `{version, title?, copy?, content?}` (content validated by the rendererType-aware template parsers — same shapes as the template editor); plus §6 pull + §7 offerings.

## 10. syncVersion policy (redefined — supersedes F1b plan D-e)

Rendering now depends ONLY on instance rows, so: **instance mutations (content/copy/title edits, pull, offerings change, custom-field ops) bump THEIR viewbook's syncVersion, scoped; template mutations bump NOTHING** (template edits reach clients only through pull/enable). The bridge's `syncVersionBumpAll*` fan-outs are deleted with it; the all-viewbook bump helpers are removed if no consumer remains.

## 11. Legacy retirement (same PR, after the cutover lands)

- **Routes deleted** (all operator-cookie, driven only by our UI — no 410 shim needed, unlike the public collapse route): `GET/PUT /api/viewbook-content/[key]`, `POST /api/viewbook-content/team-photo`, `PUT/DELETE /api/viewbooks/section-copy/[sectionKey]`, `PUT/DELETE /api/viewbooks/[id]/overrides/[contentKey]`, `PUT/DELETE /api/viewbooks/[id]/section-copy/[sectionKey]`, `POST /api/viewbooks/[id]/sync-questions`.
- **Modules:** `section-copy-content.ts` deleted whole; `global-content.ts` deleted whole — the crash-safe team-photo FILE flow (save-new → fenced txn → delete-old) moves into `attachTemplateTeamPhoto`, now template-only (roster source = `SubsectionTemplate.contentJson`; the `TeamPhotoTxn`/`AttachTeamPhotoDeps` injection seam collapses, as the F1b handoff predicted); `template-service.ts` loses every bridge export, the legacy statement interleaves, `LEGACY_KEY_TARGET`, and `reconcileSeededTemplates` + its boot call; `public-data.ts` loses `loadGlobal`/`loadOverrides` legacy reads; `service.ts` loses `syncCatalogQuestions`.
- **Seeder:** `template-seed.ts` projects from code consts ONLY (drop the `ViewbookGlobalContent` reads — fresh installs seed pure defaults; prod rows already exist and the seeder never updates). `SECTION_COPY`/`SECTION_TITLES`/`CATALOG` consts stay as seed inputs; the viewer stops importing `SECTION_TITLES`.
- **Tables dropped** per §4. Content validators (`content-validators.ts`) STAY — they validate template AND instance content.
- **Deploy window note:** between `prisma migrate deploy` and the PM2 restart, the OLD build briefly runs against the migrated DB — the public viewer degrades gracefully (wiped viewbooks 404; `guarded()` isolates the dropped-table reads) but the admin detail page 500s (`contentOverrides` include). Minutes-long, internal tool, deploy off-hours; called out in the PR body.

## 12. Parity acceptance + testing

- **Rendered-parity gate (the F1 §6 hand-off):** a `ViewbookPublicData` characterization fixture is captured on pre-F2 main for a canonical fresh viewbook (seeded templates, default theme) and committed FIRST; post-cutover, creating the same viewbook must reproduce it deep-equal under pinned normalizations: (a) the `overrides` key removed (documented shape change, no rendered effect), (b) roster photo filenames normalized (instance-scope uuids replace global names — assert count + on-disk existence instead), (c) ids/timestamps normalized. Plus a component-level pin: instance titles === `SECTION_TITLES` for all seeded keys (the title-source swap is invisible).
- **Unit suites:** `projectInstanceTree` (offering filtering, D5 section-inclusion rule); pull merge matrix (both/template-only/instance-only subsections; field update/create/archive/re-parent/move-across-sections; value+amendment preservation; custom-field immunity; version-conflict 409; template_missing/archived 409s); offerings enable/disable/restore round-trip (answers survive disable→enable); snapshot asset copy (fence-loss deletes new files; missing source degrades to null; pull repairs photoless viewbooks); allowlist + retention + delete-snapshot each covering instance refs (one shared `extractInstanceAssetRefs` fixture so a new producer can't register on one side only); syncVersion policy (template edit bumps nothing; instance edit/pull bumps scoped).
- **Deliberate re-pins:** `template-service.parity.test.ts` (the F1b bridge-parity suite) is RETIRED with the bridge — replaced by the cutover fixture above, not silently deleted; `template-service.test.ts` drops its bridged/reconcile cases; `template-seed` tests re-pin the consts-only projection.
- Gates per house rule: `npx tsc --noEmit` + full vitest + `npm run build`; worktree lane off fresh `origin/main`; Codex pre-merge review (roadmap §7).

## 13. Out of scope (owned elsewhere)

- Viewer order from `sortOrder`, stage removal, `StageOverview`/`PreviousStages` removal, subsection-aware rendering + the `generic` renderer component, grey-out/checkmark, pc-setup relocation, `pcCompletedAt` contract → **F3**.
- Field-row re-shell / grouping by subsection in the UI (the `category` column's retirement) → **F3**.
- Subsection completion + rings → **F4**. Field assignment → **U3**. Lock removal / revision inversion → **U4**.
- Section create/delete, separators, per-viewbook roster/photo editing, edit-everything inspector → **F5b**. Promote-to-template → **F6**.
- Any VA/PPC template content (next roadmap).

## 14. Risks

- **Breadth** (schema + snapshot + cutover + retirement in one PR) — mitigated by strict task order (schema/wipe → snapshot engine → pull/offerings → read cutover → retirement last, each TDD-gated) and the committed-first parity fixture.
- **Asset seam drift** — structurally closed by the single `extractInstanceAssetRefs` home + the four-seam test.
- **Two-phase create crash window** — bounded to photoless renders, self-healing via pull; no broken references possible (phase-1 writes null, never a global name).
- **Concurrent lanes:** U2 (Codex) touches team-member UI, not schema; whichever merges second rebases + `npx prisma generate` + `rm -rf .test-dbs` (F1 precedent).
