# F1 — Onboarding Viewbook template library (ADDITIVE) — design

**Status:** spec for the Claude-built F1 lane (Onboarding Viewbook roadmap, Track 1 head). **Codex-reviewed 2026-07-22 (Sol): accept with 15 named fixes — ALL applied below** (activation reconciliation, single dual-write authority, atomic bridge statements, team-photo flow, atomic tree seeding, validator extraction, corrected default-source claims, library-global fieldKey, subsection content contract, versioned envelopes, CTA seam, aggregate versions, seed labels + rename placement, order decision now blocking, seed-projection parity framing).
**Roadmap:** `docs/superpowers/nyi/improvement-roadmaps/2026-07-22-onboarding-viewbook-roadmap.md` — D5/D6/D8/D11 + the F1 section and the template/instance identity contracts (Codex fix #4) are BINDING. Do not re-litigate.
**Tracker:** `docs/superpowers/todos/2026-07-22-onboarding-viewbook-tracker.md`.
**Sequencing:** track head; F2 (instances + cutover) builds directly on this. Parallel with U1/U2. **Split confirmed: F1a (schema + registry + seed + parity) and F1b (template admin UI + bridge) are two PRs.** U1/F1/F2 all touch `prisma/schema.prisma` — whichever merges second rebases, `npx prisma generate`, `rm -rf .test-dbs`.

## 0. BLOCKING Kevin decision (§9 Q2 — required BEFORE F1a deploys)

**The canonical initial 13-section order must be confirmed by Kevin before the first production seed** — the seeder never updates existing rows (§5), so a wrong first-seed order persists until manually resequenced. Recommended order (stage-journey; rationale §5): `pc-intro, pc-setup, pc-invite, data-source, welcome, milestones, strategy, kickoff-next, ws-intro, brand, assessment, materials, pc-thanks`. This is no longer a non-blocking recommendation; F1a's merge gate includes this sign-off. (Also needing sign-off, same gate, lower stakes: the display titles for the seeded `main` subsections and the 8 data-source category subsections — §5 proposes defaults.)

## 1. Goal

One durable template library — `SectionTemplate` / `SubsectionTemplate` / `FieldTemplate` — that absorbs the THREE current content homes (code-owned section copy, the Q&A catalog, and `ViewbookGlobalContent` incl. PR #257's `section-copy:<key>` rows) into operator-editable rows, offering-tagged for the multi-offering model (D5), while the legacy read path keeps rendering EXACTLY as today until F2 cuts over. VA + PPC content later becomes content-entry, not engineering.

**F1 is additive.** No viewer, `public-data.ts`, override-route, or `ViewbookField` behavior changes. The only user-visible changes are the F1b admin panel and the D-S title rename (§8).

## 2. Current state (verified 2026-07-22; corrected per Codex fix #7)

The three homes:
1. **Section copy** — `SECTION_COPY` (`lib/viewbook/section-copy.ts:18`): per-`SectionKey` `{purpose ≤240, whatThis ≤600, whatWeNeed ≤600|null, cta?}`; `cta` is code-only (dropped at persistence — and read by `SectionShell.tsx` from `SECTION_COPY[sectionKey]`, a durable-key-vs-code seam §4 must own). Resolve chain (`lib/viewbook/section-copy-content.ts`): per-viewbook `ViewbookContentOverride` → company-wide `ViewbookGlobalContent` → code default, under reserved key namespace `section-copy:<sectionKey>`; whole-object per layer; **`validateSectionCopy` requires EXACTLY the 3 persisted keys — it rejects any versioned envelope** (constrains §4's parsers). Titles: `SECTION_TITLES` (`components/viewbook/public/section-titles.ts`).
2. **Q&A catalog** — `CATALOG` (`lib/viewbook/catalog.ts:29`, ~36 entries): `{defKey, category (8 `CATALOG_CATEGORIES` w/ `CATEGORY_LABELS`), label, fieldType 'text'|'textarea'|'list', sortOrder}`; additive-only defKeys; `ViewbookField` enforces `@@unique([viewbookId, defKey])` — defKeys are globally unique in practice. TWO seed paths exist: `createViewbook` inlines the full catalog as `ViewbookField` rows (`service.ts:80-89`) and `syncCatalogQuestions` (`service.ts:607`) backfills missing defKeys on demand.
3. **Global content** — `ViewbookGlobalContent` (`key @id`, `bodyJson`): 8 `GLOBAL_CONTENT_KEYS` (`team` → `TeamMember[]` roster w/ photo filenames in the `'global'` asset scope, `pc-intro` → bounded string, the other 6 → `ContentBlocks {blocks:[{heading,body}]}`); plus up to 13 `section-copy:*` rows. Overrides in `ViewbookContentOverride`. **There is NO general code-default layer for global keys** — an absent row renders empty/placeholder; only `pc-intro` has a component-local fallback string (in `PcIntroSection`). The body validators (`validateTeam`/`validateBlocks`/`validatePcIntro`) are PRIVATE to server-only `global-content.ts`.

Renderer mapping is the `switch` in `app/(public)/viewbook/[token]/page.tsx:45-77` — 13 section-key-specific components; render ORDER comes from `STAGE_LINEUPS` (`lib/viewbook/stages.ts:47-65`), NOT `SECTION_KEYS` (`lib/viewbook/theme.ts:11` is a validation catalog only; the two orders disagree — roadmap Codex fix #8).

Admin today: `/viewbooks/settings` = `GlobalContentEditor` (8 global keys via `app/api/viewbook-content/[key]`, team photos via `…/team-photo` — **multipart**, `attachTeamPhoto` single-owner writer that deletes the replaced file) + `SectionCopyEditor` (company-wide section copy via `app/api/viewbooks/section-copy/[sectionKey]`). Each legacy writer owns its OWN transaction + syncVersion bump. Per-viewbook overrides live in each viewbook's ContentTab (untouched by F1).

Seeder precedent: `seedSystemSchedules` (`lib/jobs/system-schedules.ts:62`) — boot-time idempotent, invoked from `instrumentation.ts`.

## 3. Data model (F1a; additive migration, DDL only)

```prisma
model SectionTemplate {
  id           Int       @id @default(autoincrement())
  templateKey  String    @unique      // durable identity; seeded = today's SectionKey strings
  rendererType String                 // code-owned registry id (§4); NEVER identity (Codex fix #4)
  title        String                 // default section title
  copyJson     String                 // versioned envelope {v:1, copy:{purpose,whatThis,whatWeNeed}} (§4 parsers)
  contentJson  String?                // versioned renderer-level CONFIG (rare; most content lives on subsections)
  sortOrder    Int                    // ONE total order; separators join this sequence in F5b (single-sequence contract)
  version      Int       @default(1)  // AGGREGATE version: bumped on every mutation of the section OR its subtree (fix #12)
  archivedAt   DateTime?              // archive, never delete, once F2 instances exist
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  subsections  SubsectionTemplate[]
}

model SubsectionTemplate {
  id                Int             @id @default(autoincrement())
  sectionTemplateId Int
  section           SectionTemplate @relation(fields: [sectionTemplateId], references: [id], onDelete: Cascade)
  subsectionKey     String          // durable identity within the section
  title             String
  offeringWebsite   Boolean         @default(false)  // explicit booleans — no scalar-list
  offeringVa        Boolean         @default(false)
  offeringPpc       Boolean         @default(false)
  copyJson          String?         // versioned {v:1, copy:{intro?, whatWeNeed?}} — D6: a subsection has its own heading+copy
  contentJson       String?         // versioned per-renderer subsection content (§4); generic blocks live HERE, not on the section
  sortOrder         Int
  version           Int             @default(1)
  archivedAt        DateTime?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  fields            FieldTemplate[]

  @@unique([sectionTemplateId, subsectionKey])
}

model FieldTemplate {
  id                   Int                @id @default(autoincrement())
  subsectionTemplateId Int
  subsection           SubsectionTemplate @relation(fields: [subsectionTemplateId], references: [id], onDelete: Cascade)
  fieldKey             String             @unique  // LIBRARY-GLOBAL durable identity (fix #8) — F2 preserves answers by this key,
                                                   // mirroring ViewbookField @@unique([viewbookId, defKey]); seeded = catalog defKey.
                                                   // IMMUTABLE after create (no PATCH surface); format ^[a-z0-9][a-z0-9-]{1,63}$
  label                String
  fieldType            String             // 'text' | 'textarea' | 'list' (catalog contract)
  sortOrder            Int
  version              Int                @default(1)
  archivedAt           DateTime?
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
}
```

Identity contracts honored (bind F2+ too): durable keys ≠ rendererType; instances (F2) will snapshot `rendererType`+`title`+content+offering tags+the section's AGGREGATE `version`; instance→template FKs will be `SetNull`; offerings are booleans; sections/separators share one `sortOrder` sequence.

**Aggregate-version rule (fix #12):** every subsection/field mutation increments its OWN `version` AND the parent `SectionTemplate.version` in the same array-form transaction — F2 detects subtree change from the section snapshot version alone. Reorder = one array txn of guarded `UPDATE`s fenced on each touched section's expected version (409 `version_conflict` on any 0-count).

## 4. Renderer-type registry + validators (code-owned, F1a)

New client-safe `lib/viewbook/renderer-types.ts`:
- `RENDERER_TYPES` = the 13 current section renderers, keyed by their existing switch arms (`'welcome' | 'milestones' | 'data-source' | 'brand' | 'assessment' | 'strategy' | 'materials' | 'pc-intro' | 'pc-setup' | 'pc-invite' | 'pc-thanks' | 'kickoff-next' | 'ws-intro'`) **plus `'generic'`** (the content+fields renderer for user-created sections — component ships in F3/F5b; F1 reserves the id + schema).
- **CTA metadata moves into this registry** (fix #11): the per-type `cta` (label/sectionKey/anchor) that `SectionShell.tsx` currently reads from `SECTION_COPY[sectionKey]` becomes `RENDERER_TYPES[type].cta`, and `SectionShell` reads it via the type. This keeps code-owned CTA config off the durable-key seam now, rather than leaving F2 a landmine. (`SECTION_COPY.cta` entries are deleted in the same change; the visible behavior is identical because seeded rendererType == sectionKey.)
- **Versioned envelope parsers (fix #10):** template JSON columns always carry `{v:1, ...}` envelopes with their own strict whole-doc-reject parsers (`ingest-schema.ts` convention) — `parseTemplateCopy`, `parseTemplateContent(rendererType, …)`, `parseSubsectionContent(rendererType, …)` — plus explicit **translators to the unversioned legacy shapes** (`toLegacySectionCopy` → the exact 3-key object `validateSectionCopy` demands; `toLegacyGlobalBody(key)` → the raw `bodyJson` shapes). The legacy validators stay byte-compatible; templates never leak envelopes into legacy rows.
- **Validator extraction (fix #6):** `validateTeam`/`validateBlocks`/`validatePcIntro` move from server-only `global-content.ts` into a new client-safe pure module (`lib/viewbook/content-validators.ts`); `global-content.ts` re-imports them (no behavior change). The `pc-intro` component-local fallback string is extracted to a shared constant (`PC_INTRO_DEFAULT`) used by both `PcIntroSection` and the seeder (fix #7).
- Content shapes: section-level `contentJson` is reserved for renderer CONFIG (none seeded in F1); subsection-level `contentJson` carries the content — `welcome/main` → `{v:1, team: TeamMember[], process: ContentBlocks, why: ContentBlocks}`; `strategy/main` → `{v:1, seoBase, geoBase, eeatBase: ContentBlocks}`; `milestones/main` → `{v:1, processMilestones: ContentBlocks}`; `pc-intro/main` → `{v:1, intro: string ≤2000}`; `generic` subsections → `{v:1, blocks: ContentBlocks}`; other types → null (their content is live per-viewbook data).
- Asset references inside template content (team photos) stay **`'global'`-scope filenames** served by the existing allowlisted asset route. True asset snapshotting is an F2 contract, NOT F1. F1 must not delete/move any global asset (except the team-photo replace flow, §7, which already deletes the OLD file — unchanged semantics).

## 5. Seeding (F1a) — boot seeder, not a data migration

`prisma/migrations/<ts>_viewbook_templates` is **DDL only**. Content seeding is a boot-time idempotent seeder — chosen over migration-SQL because the transform reads live `ViewbookGlobalContent` JSON and code consts, which SQL can't express, and `prisma migrate deploy` runs before the app can help. Roadmap explicitly allows this; precedent `seedSystemSchedules`.

`lib/viewbook/template-seed.ts` → `seedViewbookTemplates()`:
- Invoked from `instrumentation.ts` right after `seedSystemSchedules()` (same failure isolation: a seed throw is logged, never crash-loops boot).
- **Atomic per-section trees (fix #5):** each of the 13 sections is created as ONE nested Prisma `create` (`SectionTemplate` + all `subsections` + all `fields` in a single statement) — a crash can never leave a partial tree behind a "skip existing parent" check. Idempotence: `findUnique(templateKey)` → skip if present (**the seeder NEVER updates an existing row — operator edits win**); on P2002 for `templateKey`, re-read the winner and continue; any OTHER uniqueness violation (e.g. a nested `fieldKey` collision) is a real defect — `logError` + skip that section, never swallowed as "already seeded".
- **Seed projection (ONE pure function, fix #15):** `projectTemplateSeed(globalRows, sectionCopyRows)` → the full 13-tree seed payload; used by BOTH the seeder and the parity tests. Source precedence per piece (= today's resolve chain): section copy = `section-copy:<key>` row else `SECTION_COPY[key]`; titles = `SECTION_TITLES[key]` (data-source: §8's new title — the rename lands in F1a BEFORE first seed, fix #13); global bodies = the `ViewbookGlobalContent` row if present and valid, else **empty** (`team: []`, blocks `{blocks: []}`) — there is no code-default layer to fall back to (fix #7) — except `pc-intro` which falls back to `PC_INTRO_DEFAULT`. Corrupt bodyJson → treat as absent + `logError`. Legacy rows are COPIED, never deleted — legacy stores stay authoritative for rendering until F2.
- **Subsection layout:** every section gets ONE subsection `subsectionKey: 'main'`, `offeringWebsite: true` (VA/PPC false — only website content exists this roadmap), **title = the section's own title** (proposed default; Kevin sign-off per §0) EXCEPT `data-source`: 8 subsections, `subsectionKey` = category id, **title = `CATEGORY_LABELS[category]`** (never raw ids, fix #13), sortOrder = category display order ×10, each carrying its catalog entries as `FieldTemplate` rows (fieldKey = defKey, per-category sortOrder preserved). `PC_SETUP_DEF_KEYS` fields stay in their catalog categories; the pc-setup renderer keeps addressing them by defKey — F1 changes nothing about field rendering.
- **Canonical section order:** §0's Kevin-confirmed order, sortOrder 10..130 gapped. Rationale for the recommendation: it concatenates the four `STAGE_LINEUPS` primaries in stage order (first-occurrence dedup, `pc-thanks` as completion bookend) — the client journey the stage machinery encodes today; `SECTION_KEYS` order was never a render order.

## 6. Seed-projection parity acceptance (F1a; fix #15)

The roadmap bar "seeded website templates render byte-parity with today's defaults" is, in the additive phase, **seed-projection parity** — the viewer doesn't read templates until F2; RENDERED byte parity is F2's cutover gate. F1a ships tests over the shared `projectTemplateSeed`:
- Per key: template copy (via `toLegacySectionCopy`) ≡ `resolveSectionCopy(key, globalRow, null)`; title ≡ `SECTION_TITLES[key]` (data-source rename asserted explicitly); decoded subsection content ≡ the exact objects `loadViewbookPublicData` serves from the global store (team roster deep-equal incl. photo filenames; ContentBlocks deep-equal; pc-intro string equal — comparisons on DECODED values, not raw JSON strings).
- Flattened `FieldTemplate` rows ≡ `CATALOG` (fieldKey/category-subsection/label/fieldType/sortOrder, order-sensitive); subsection titles ≡ `CATEGORY_LABELS`.
- Behavior tests: absent globals → empty seeds (+ pc-intro fallback); corrupt bodyJson → absent + logged; `section-copy:` row precedence over code default; complete-tree atomicity (kill between sections → no partial tree); concurrent double-seed (P2002 path) → one tree; re-run against edited rows → edits preserved; **F1b bridge parity** (§7: template write → legacy row equals `toLegacy*` output).

## 7. Template admin (F1b) — `/viewbooks/settings` evolves

- `GlobalContentEditor` + `SectionCopyEditor` are replaced by a **template editor**: section list in `sortOrder` (reorder per §3's fenced-txn rule), per-section panel editing title, copy, subsection list w/ offering-tag checkboxes + per-subsection copy/content forms (team roster w/ photo upload, ContentBlocks lists, pc-intro text), and the field grid under `data-source` subsections (add field = new `FieldTemplate` with operator-entered `fieldKey`, format-validated, immutable, additive-only; archive, never delete).
- **F1b activation reconciliation (fix #1 — mandatory because F1a and F1b deploy separately):** legacy edits made in the F1a→F1b window would otherwise be stranded (the seeder never updates). F1b's boot runs `reconcileSeededTemplates()` ONCE (guarded by a `ViewbookGlobalContent` marker row `template-library:reconciled` — reserved-namespace precedent): for every template row still **untouched since seed** (`version === 1` at section AND subtree level), re-run `projectTemplateSeed` and overwrite that tree; any row with `version > 1` (operator-edited via some F1a-era script — defensive) is skipped. After the marker exists, never again.
- **Single dual-write authority (fixes #2, #3):** ALL writes to the absorbed content — the new template routes AND the still-callable legacy routes (`PUT /api/viewbook-content/[key]`, `PUT/DELETE /api/viewbooks/section-copy/[sectionKey]`) — go through `lib/viewbook/template-service.ts`. Each mutation composes ONE array-form `$transaction`: template statement(s) + the corresponding legacy-row upsert + one syncVersion bump. The existing `putGlobalContent`/`putSectionCopyGlobal` helpers are refactored into **pure statement builders** (they currently each own a whole transaction — calling them inside another txn would nest; extraction, not wrapping). Legacy routes thereby FORWARD-write templates too — no reverse drift from a stale bookmark or script. Per-viewbook override routes (`ViewbookContentOverride`) are untouched — overrides are instance-layer, absorbed by F2, not template content.
- **Team-photo flow (fix #4):** `POST /api/viewbook-templates/sections/[id]/photo` is **multipart** (`formData`, reusing the existing upload/buffer/re-encode helpers — never `parseJsonBody`). Order: save NEW file (unique name) → ONE fenced array-form txn updating legacy `team` roster row AND the template subsection content AND syncVersion (guarded on template `version`; on 0-count → delete the NEW file, 409) → after commit, best-effort delete the OLD file (ENOENT-tolerant). Crash between file-save and txn leaves only an orphaned unreferenced file (sweepable), never a broken roster.
- Routes: `GET /api/viewbook-templates` (tree), `PATCH …/sections/[id]`, `POST/PATCH …/sections/[id]/subsections[/(subId)]`, `POST/PATCH …/subsections/[id]/fields[/(fieldId)]`, `POST …/sections/[id]/photo`, `POST …/reorder` — cookie-gated admin namespace (NO middleware change), `withRoute` + `parseJsonBody` (except photo), optimistic `version` concurrency (409 `version_conflict`), aggregate-version bumps per §3, validation via §4 parsers. Mutations are single-surface service functions (AI-readiness §6: JSON-serializable ops, no logic in components).
- Section CREATE/DELETE is **not** in F1b (structural mutation is F5b; the 13 seeded sections are the universe until then). Subsection/field create IS in scope (content entry — the VA/PPC enablement path).
- Title edits back-write nothing (titles are code-owned in the viewer until F2) — the editor labels title fields "applies after template cutover (F2)".

## 8. "What we need from you" rename — F1a, before first seed (fix #13)

`SECTION_TITLES['data-source']` → **"What we need from you"** ships in **F1a**, in the same PR as (and ordered before) the seeder, so the first production seed captures the new title and the never-update rule can't fossilize the old one. It's user-facing copy (same class as S1); the parity test pins title equality through the rename. The seeded `data-source` template title uses the same constant.

## 9. §9 Q1 — team roster frozen vs live-shared (RECOMMENDATION; Kevin to confirm at F2 spec time)

Recommend **uniform copy-on-create (frozen + explicit pull), same as all template content** — no live-share carve-out for the team section. Rationale: D8's model already gives every viewbook a one-click "update to current global version" pull in F2, which handles staff churn adequately; a live-share exception would make the team subsection the ONLY content that mutates under a client's feet and would complicate F2's asset-snapshot contract for no structural gain. Consequence to confirm with Kevin: an ex-employee's face stays in an existing viewbook until someone pulls. **F1 is unaffected either way** (the seeder copies the roster; freeze semantics are an F2 behavior) — flagged now so F2's spec inherits a decision, not a question. (Codex concurs the recommendation is D8-consistent.)

## 10. Out of scope (owned elsewhere)

- Instances, copy-on-create, offerings flags on `Viewbook`, pull-merge, asset snapshotting, legacy-store retirement, RENDERED byte-parity gate → **F2**.
- Viewer/ToC changes, stage removal, canonical order ENFORCEMENT in the viewer → **F3**.
- Section create/delete UI, separators, promote-to-template → **F5b/F6**.
- Any VA/PPC template CONTENT (next roadmap; F1 only makes it enterable).

## 11. Gates & risks

- Gates per house rule: `npx tsc --noEmit` + full vitest + `npm run build`; F1a and F1b each PR'd from own worktree lanes off fresh `origin/main`. **F1a merge gate additionally requires the §0 order sign-off.**
- Migration risk: DDL-only, three new tables — no existing-table touch; safe with the parallel U1 lane.
- Seeder risk: reads `ViewbookGlobalContent` at boot on prod — tolerates corrupt bodyJson (absent + `logError`) and an empty DB (pure code/empty-seed per §5's projection rules).
- The dual-write bridge (§7) is the main F1b complexity; Codex reviewed the read-only-legacy-editors fallback and REJECTED it (operators would save template edits clients can't see) — the bridge with single-service authority is the accepted shape. It is deleted whole in F2 (one seam: the legacy-statement builders + their call sites in `template-service.ts`).
