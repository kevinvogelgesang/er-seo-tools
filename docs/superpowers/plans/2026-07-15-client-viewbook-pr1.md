# Client Viewbook PR1 — Schema + Seeds + Theme/Assets + Admin Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full 11-model viewbook schema, the code-owned seeds (question catalog, default milestones, font catalog), the strict theme validator, the atomic asset-attachment layer, the public-token validator (`route-auth.ts` — later lanes compile against it), the admin service + API routes, and the internal admin UI shell.

**Architecture:** All 11 Prisma models ship in this one migration (later PRs never touch `schema.prisma`). Pure/validating modules in `lib/viewbook/*` with vitest coverage; thin `withRoute` admin routes over the service layer; asset writes are atomic file-write → DB-stamp → old-file-delete operations, never bare saves. No public page, no middleware changes, no jobs in this PR.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, vitest (per-worker template-copied test DBs — import `prisma` from `@/lib/db` in tests; `.test-dbs/` is wiped per run, but add prefix-scoped cleanup hooks anyway for intra-worker cross-suite hygiene), Tailwind class dark mode.

**Rev 2** applies Codex plan-review fixes 8–15 and Kevin-confirmed decisions (2026-07-16): missing session email → **401 reject** (never a sentinel in an email field); global team photo = **one atomic multipart update**; `VIEWBOOK_ASSETS_DIR` added to `ecosystem.config.js` in this PR.

## Global Constraints (from spec — apply to every task)

- Array-form `$transaction([...])` ONLY; conditional logic in SQL / fenced statements whose failure rolls the transaction back.
- All API routes wrapped in `withRoute`; JSON bodies via `parseJsonBody`; errors via `HttpError`.
- Operator attribution: `requireOperatorEmail()` (Task 7) — verified session email or `HttpError(401, 'auth_required')`. Never a fallback sentinel.
- Custom `ViewbookField.defKey` is `NULL`, never `''`; custom fields addressed by `id`.
- Theme validation strict whole-object (details Task 3). Uploads magic-byte-sniffed, 2 MB cap, server-generated filenames, atomic attachment flows (Task 4/5).
- `VIEWBOOK_ASSETS_DIR` env, default `path.join(process.cwd(), 'data', 'viewbook-assets')`; scopes exactly `'global'` or `String(positiveInt)`.
- Never run `prisma migrate reset` against the local dev DB.
- Gates: `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build` · `npm run audit:ci`.

**Section keys (frozen):** `welcome` · `milestones` · `data-source` · `brand` · `assessment` · `strategy` · `materials`.
**Global content keys (frozen):** `team` · `process` · `why` · `seo-base` · `geo-base` · `eeat-base`.

---

### Task 1: Prisma schema + migration (11 models)

**Files:**
- Modify: `prisma/schema.prisma` (11 models + `Client.viewbook Viewbook?` inverse)
- Create: `prisma/migrations/<generated>_client_viewbook/migration.sql` (generated, then hand-append the partial index)

**Interfaces:**
- Produces: models `Viewbook`, `ViewbookSection`, `ViewbookField`, `ViewbookFieldAmendment`, `ViewbookMilestone`, `ViewbookReviewLink`, `ViewbookFeedback`, `ViewbookGlobalContent`, `ViewbookContentOverride`, `ViewbookMaterialLink`, `ViewbookActivity` — copy the schema block from spec §4 verbatim (it is the contract).

- [ ] **Step 1:** Add the models + the `Client` inverse relation to `prisma/schema.prisma`.
- [ ] **Step 2:** `npx prisma migrate dev --name client_viewbook` (normal repo flow — creates the migration + regenerates the client against the local dev DB; no reset).
- [ ] **Step 3:** Hand-append to the new `migration.sql`:

```sql
-- At most one 'current' milestone per viewbook (spec §4 / Codex fix 5)
CREATE UNIQUE INDEX "ViewbookMilestone_one_current_per_viewbook"
ON "ViewbookMilestone"("viewbookId") WHERE "status" = 'current';
```

- [ ] **Step 4:** Prove the edited migration applies cleanly WITHOUT touching the dev DB — disposable DB:

Run: `DATABASE_URL="file:/tmp/vb-mig-check.db" npx prisma migrate deploy && rm -f /tmp/vb-mig-check.db*`
Expected: all migrations applied, including the hand-edited one. Then apply the partial index to the local dev DB itself: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy` (idempotent for already-applied migrations; `migrate dev` in Step 2 ran before the hand-edit, so deploy picks up nothing new — instead run the index statement once via `npx prisma db execute --file` against local-dev if `migrate dev` already marked the migration applied. Simplest safe order: write the SQL edit BEFORE first applying — i.e. use `npx prisma migrate dev --create-only`, edit, then `npx prisma migrate dev`).
- [ ] **Step 5:** Gate `npx tsc --noEmit` → clean. Commit: `git add prisma && git commit -m "feat(viewbook): PR1 schema — 11 models, partial unique current-milestone index"`

> Corrected procedure summary: `npx prisma migrate dev --name client_viewbook --create-only` → hand-edit SQL → `npx prisma migrate dev` (applies + generates) → disposable-DB `migrate deploy` proof. Never `migrate reset`.

---

### Task 2: Question catalog + default milestones (seeds)

Files `lib/viewbook/catalog.ts` + `lib/viewbook/milestones.ts`, test `lib/viewbook/catalog.test.ts`; contracts: `CATALOG: CatalogEntry[]` (`{ defKey, category, label, fieldType: 'text'|'textarea'|'list', sortOrder }`), `CATALOG_CATEGORIES` (8 categories: `school`, `programs`, `team-access`, `crm-leads`, `admissions`, `positioning`, `student-experience`, `brand-materials`), `DEFAULT_MILESTONES` (7 stages).

The full `CATALOG` literal (33 entries — implement exactly; additive-only contract, never rename/remove a defKey once shipped):

```ts
export const CATALOG: CatalogEntry[] = [
  { defKey: 'school-name', category: 'school', label: 'School name', fieldType: 'text', sortOrder: 1 },
  { defKey: 'school-contact-name', category: 'school', label: 'Primary contact name', fieldType: 'text', sortOrder: 2 },
  { defKey: 'school-contact-email', category: 'school', label: 'Primary contact email', fieldType: 'text', sortOrder: 3 },
  { defKey: 'school-services', category: 'school', label: 'Services in your subscription', fieldType: 'list', sortOrder: 4 },
  { defKey: 'school-ad-name', category: 'school', label: 'How do you refer to your school in advertising? Any abbreviations?', fieldType: 'textarea', sortOrder: 5 },
  { defKey: 'programs-roster', category: 'programs', label: 'Programs to market (one per line)', fieldType: 'list', sortOrder: 1 },
  { defKey: 'programs-highlights', category: 'programs', label: 'Key features / highlights per program', fieldType: 'textarea', sortOrder: 2 },
  { defKey: 'team-staff-accounts', category: 'team-access', label: 'Staff needing accounts / lead notifications (name + email)', fieldType: 'list', sortOrder: 1 },
  { defKey: 'team-website-approver', category: 'team-access', label: 'Who approves website changes? (name, title, email)', fieldType: 'text', sortOrder: 2 },
  { defKey: 'team-technical-contact', category: 'team-access', label: 'Technical contact for coordination (name, title, email)', fieldType: 'text', sortOrder: 3 },
  { defKey: 'crm-lead-delivery', category: 'crm-leads', label: 'How would you like to receive leads?', fieldType: 'text', sortOrder: 1 },
  { defKey: 'crm-notification-emails', category: 'crm-leads', label: 'Emails that should receive lead notifications', fieldType: 'list', sortOrder: 2 },
  { defKey: 'crm-in-use', category: 'crm-leads', label: 'CRM / notification integrations in use', fieldType: 'text', sortOrder: 3 },
  { defKey: 'crm-credential-method', category: 'crm-leads', label: 'Preferred method for sharing CRM access', fieldType: 'text', sortOrder: 4 },
  { defKey: 'crm-lead-volume', category: 'crm-leads', label: 'Current leads per month + where they come from', fieldType: 'textarea', sortOrder: 5 },
  { defKey: 'crm-enrollment-time', category: 'crm-leads', label: 'Average enrollment time (inquiry → enrolled)', fieldType: 'text', sortOrder: 6 },
  { defKey: 'admissions-staff-title', category: 'admissions', label: 'What do you call your admissions staff?', fieldType: 'text', sortOrder: 1 },
  { defKey: 'admissions-next-step', category: 'admissions', label: 'What do you call the admissions interview / next step?', fieldType: 'text', sortOrder: 2 },
  { defKey: 'admissions-tour-format', category: 'admissions', label: 'Tour: online, in-person, or both?', fieldType: 'text', sortOrder: 3 },
  { defKey: 'admissions-accreditations', category: 'admissions', label: 'Accreditations (association names + URLs)', fieldType: 'list', sortOrder: 4 },
  { defKey: 'positioning-advantages', category: 'positioning', label: 'What unique advantages set your school apart?', fieldType: 'list', sortOrder: 1 },
  { defKey: 'positioning-top5', category: 'positioning', label: 'Top 5 reasons someone chooses your school', fieldType: 'list', sortOrder: 2 },
  { defKey: 'positioning-differentiators', category: 'positioning', label: 'What do you do differently that makes you stand out?', fieldType: 'list', sortOrder: 3 },
  { defKey: 'positioning-demographic', category: 'positioning', label: 'What best describes your demographic?', fieldType: 'text', sortOrder: 4 },
  { defKey: 'positioning-ideal-student', category: 'positioning', label: 'Ideal student per program (demographics / characteristics)', fieldType: 'textarea', sortOrder: 5 },
  { defKey: 'studentexp-motivations', category: 'student-experience', label: 'Common prospect motivations for going back to school', fieldType: 'list', sortOrder: 1 },
  { defKey: 'studentexp-barriers', category: 'student-experience', label: 'Common barriers for prospects', fieldType: 'list', sortOrder: 2 },
  { defKey: 'studentexp-feedback', category: 'student-experience', label: 'Most common feedback from students / graduates', fieldType: 'textarea', sortOrder: 3 },
  { defKey: 'studentexp-culture', category: 'student-experience', label: 'Anything else about your students and culture', fieldType: 'textarea', sortOrder: 4 },
  { defKey: 'brand-guidelines-status', category: 'brand-materials', label: 'Existing brand guidelines / style guide?', fieldType: 'text', sortOrder: 1 },
  { defKey: 'brand-privacy-policy', category: 'brand-materials', label: 'Privacy policy status', fieldType: 'text', sortOrder: 2 },
  { defKey: 'brand-testimonials', category: 'brand-materials', label: 'Student testimonials available?', fieldType: 'text', sortOrder: 3 },
  { defKey: 'brand-domain-registrar', category: 'brand-materials', label: 'Domain registrar (e.g. GoDaddy, Namecheap)', fieldType: 'text', sortOrder: 4 },
]
```

And `DEFAULT_MILESTONES` (first stage seeded `current` by the service):

```ts
export const DEFAULT_MILESTONES = [
  { title: 'Kickoff', blurb: 'Orientation call — process, timeline, what we need from you.', sortOrder: 1 },
  { title: 'Materials in', blurb: 'Logos, photos, policies, testimonials delivered.', sortOrder: 2 },
  { title: 'Design', blurb: 'Brand direction and page designs take shape.', sortOrder: 3 },
  { title: 'Build', blurb: 'Your site is assembled on our stack.', sortOrder: 4 },
  { title: 'First review', blurb: 'Homepage + one program page, ready for your feedback.', sortOrder: 5 },
  { title: 'Full-site review', blurb: 'The whole site, ready for your walkthrough.', sortOrder: 6 },
  { title: 'Launch', blurb: 'Go live.', sortOrder: 7 },
] as const
```

- [ ] Test-first as rev 1 (unique defKeys, category coverage, per-category unique sortOrder, 7 ordered milestones) → fail → implement → pass.
- [ ] Commit: `git commit -m "feat(viewbook): question catalog + default milestone seeds"`

Run tests: `DATABASE_URL="file:./local-dev.db" npm test -- lib/viewbook/catalog.test.ts`

---

### Task 3: Theme kit — strict validator + font catalog

**Files:** Create `lib/viewbook/theme.ts`; Test `lib/viewbook/theme.test.ts`

**Interfaces (rev 2 deltas bolded):**
- `SECTION_KEYS`, `SectionKey`, `ViewbookTheme`, `DEFAULT_THEME`, `FONT_CATALOG` (12 entries incl. `'inter'`), `ASSET_FILENAME_RE = /^[a-z0-9-]+\.(png|jpe?g|webp)$/`, `validateViewbookTheme(raw: unknown): ViewbookTheme | null`, `parseStoredTheme(json: string): ViewbookTheme`, `onThemeColorText(hex: string): '#ffffff' | '#111111'`.
- Validator rules (strict, in order): **plain object only** (`Object.getPrototypeOf(raw)` is `Object.prototype` or `null`; arrays rejected) → key set exactly equals the 7 allowed keys → colors `/^#[0-9a-fA-F]{6}$/` → fonts via **`Object.prototype.hasOwnProperty.call(FONT_CATALOG, key)`** (never `in` — prototype names like `'toString'` must fail) → `logo` null or `ASSET_FILENAME_RE` → `sectionHeroes` **plain object**, keys ⊆ `SECTION_KEYS`, values match the regex → **UTF-8 byte cap `new TextEncoder().encode(JSON.stringify(theme)).length <= 8192`** (never `.length` on the string).
- `onThemeColorText`: WCAG relative luminance with the **0.179 crossover** (the point where white and black text have equal contrast ratio), not 0.5: `L > 0.179 → '#111111'` else `'#ffffff'`.

- [ ] **Step 1: Failing tests** — rev 1 cases PLUS: array theme rejected (`validateViewbookTheme([]) === null`); `sectionHeroes: []` rejected; `headingFont: 'toString'` rejected; multi-byte cap test (theme with a logo name padded so UTF-16 length < 8192 but UTF-8 bytes > 8192 via 3-byte chars) rejected; contrast crossover: `onThemeColorText('#808080')` → `'#111111'` (L≈0.216 > 0.179) and `onThemeColorText('#5a5a5a')` → `'#ffffff'` (L≈0.100).

```ts
it('rejects arrays, prototype font keys, and over-cap UTF-8 bytes', () => {
  expect(validateViewbookTheme([])).toBeNull()
  expect(validateViewbookTheme({ ...good, sectionHeroes: [] })).toBeNull()
  expect(validateViewbookTheme({ ...good, headingFont: 'toString' })).toBeNull()
  const fat = { ...good, sectionHeroes: { brand: 'a'.repeat(3000) + '.png' } } // regex-legal but with multibyte padding variant below
  expect(validateViewbookTheme(fat)).toBeNull() // byte cap via TextEncoder
})
it('picks text color at the 0.179 luminance crossover', () => {
  expect(onThemeColorText('#808080')).toBe('#111111')
  expect(onThemeColorText('#5a5a5a')).toBe('#ffffff')
})
```

- [ ] **Steps 2–4:** fail → implement → pass. **Step 5:** Commit `git commit -m "feat(viewbook): strict theme validator (plain-object, hasOwnProperty, UTF-8 cap, 0.179 crossover) + font catalog"`

---

### Task 4: Asset store — sniffing, containment, ENOENT-only tolerance

**Files:** Create `lib/viewbook/assets.ts`; Test `lib/viewbook/assets.test.ts`

**Interfaces (rev 2 deltas bolded):**
- `viewbookAssetsDir()`; `sniffImageType(buf): 'png'|'jpeg'|'webp'|null`; **`validateAssetScope(scope: string): boolean`** (exactly `'global'` or `/^[1-9][0-9]*$/`); `saveViewbookAsset(scope, buf)` → `{ filename, mime }` (2 MB cap, sniff-reject → `HttpError(400,'invalid_image')`, `crypto.randomUUID()`-based filename, temp+rename); `readViewbookAsset(scope, filename)` → `{ buf, mime } | null` — **containment = `path.resolve(dir, scope, filename)` must `startsWith(path.resolve(dir) + path.sep)` IN ADDITION to the filename regex**; ENOENT → null, **any other fs error rethrows**; `deleteViewbookAssets(scope, filenames)` — best-effort: ENOENT swallowed silently, **other errors logged via `logError('[viewbook] asset delete', err)` and swallowed** (delete paths must not throw into callers), invalid scope/filename entries skipped.

- [ ] **Step 1: Failing tests** — rev 1 cases PLUS: `validateAssetScope('global')`/`('12')` true, `('0')`/`('../x')`/`('')` false; `readViewbookAsset('12', 'ok-name.png')` with a crafted resolved-path escape impossible by construction (test the regex+containment rejection of `'..%2f'`-style names → null without fs touch); non-ENOENT read error rethrows (chmod-based EACCES test skipped on CI-unfriendly platforms — simulate by injecting `deps.readFile` throwing `{code:'EACCES'}`; give the module an injectable `deps` like `broken-link-check.ts`'s `realDeps` pattern).
- [ ] **Steps 2–4:** fail → implement → pass. **Step 5:** Commit `git commit -m "feat(viewbook): asset store — sniffing, scope validation, path containment, ENOENT-only tolerance"`

---

### Task 5: Service layer — seeding, token, sections, milestones, atomic attachments, delete

**Files:** Create `lib/viewbook/service.ts`; Test `lib/viewbook/service.test.ts`

**Interfaces (rev 2 deltas bolded):**
- `createViewbook(clientId, kind, createdBy)` — ONE nested `prisma.viewbook.create` (7 sections — `assessment` hidden for `new-build`; `CATALOG.length` fields `createdBy:'seed'`; 7 milestones, first `current`). **Catches P2002 on the `clientId` unique itself → `HttpError(409,'viewbook_exists')`** (service promises the 409; not delegated to withRoute). Archived client → `HttpError(409,'client_archived')`.
- `listViewbooks()`, `getViewbookAdmin(id)` (subtree + `parseStoredTheme`).
- `updateViewbookTheme(id, raw)`, `updateViewbookSettings(id, patch)`.
- `rotateViewbookToken(id)` — new UUID **AND `revokedAt: null`** (rotation un-revokes; revoke-then-rotate = re-enable with a fresh link). `revokeViewbook(id)`.
- `setSectionState(id, key, state)` / `updateSectionText(id, key, patch)`.
- `createMilestone(id, data, { current?: boolean })` / `updateMilestone(id, milestoneId, patch)` / `deleteMilestone(id, milestoneId)` — promotion to `'current'` is `$transaction([updateMany({ where: { viewbookId: id, status: 'current' }, data: { status: 'upcoming' } }), update({ where: { id: milestoneId, viewbookId: id }, data: { status: 'current' } })])` — **the second statement's compound `where { id, viewbookId }` throws P2025 on a missing/cross-viewbook target and rolls the whole transaction back** (the demote is never orphaned). Create-as-current uses the same demote + nested create shape.
- `syncCatalogQuestions(id)` — **per-row `create` with narrow P2002-catch-and-skip** (SQLite Prisma has no `skipDuplicates`; find-missing-then-createMany races — fix 12). Returns `{ added: number }`.
- **`attachViewbookLogo(id, buf)` / `attachSectionHero(id, sectionKey, buf)`** — atomic attachment (fix 11): `saveViewbookAsset` → theme re-validate with new filename → conditional `update` stamping `themeJson` → on stamp failure (throw/0 rows) delete the NEW file and rethrow → on success delete the OLD filename. Returns the updated theme.
- `deleteViewbook(id)` — snapshot theme filenames FIRST, delete row, best-effort `deleteViewbookAssets`.
- **`collectClientViewbookAssetSnapshot(clientId)`** — exported for Task 7's client-DELETE integration.

- [ ] **Step 1: Failing tests** (DB-backed; **`beforeAll`/`afterAll` prefix-scoped cleanup: `prisma.client.deleteMany({ where: { name: { startsWith: 'vb-test-' } } })`** — fix 12): rev 1 cases PLUS: duplicate-create 409 comes from the service catch (assert `HttpError` code `viewbook_exists`); rotate clears `revokedAt`; cross-viewbook milestone promotion rejects AND leaves the original `current` row intact (rollback proof); two sequential promotions leave exactly one current; `syncCatalogQuestions` concurrent double-call (`Promise.all([sync, sync])`) adds each missing defKey exactly once; `attachViewbookLogo` on a deleted viewbook leaves no orphan file (assert dir empty after rejection).

Run: `DATABASE_URL="file:./local-dev.db" npm test -- lib/viewbook/service.test.ts`

- [ ] **Steps 2–4:** fail → implement → pass. **Step 5:** Commit `git commit -m "feat(viewbook): service layer — nested-create seeding, rollback-safe milestone promotion, atomic asset attachment"`

---

### Task 6: Global content — typed bodies + atomic team photo

**Files:** Create `lib/viewbook/global-content.ts`; Test `lib/viewbook/global-content.test.ts`

**Interfaces:** as rev 1 (`GLOBAL_CONTENT_KEYS`, `TeamMember`, `ContentBlocks`, `validateGlobalContent`, `putGlobalContent`, `getGlobalContent`, `getAllGlobalContent` — corrupt row reads null) PLUS **`attachTeamPhoto(memberName: string, buf: Buffer, updatedBy: string)`** — one atomic multipart flow (Kevin decision): save to scope `'global'` → load+validate roster → member by exact name (miss → delete new file, `HttpError(404,'member_not_found')`) → stamp `photo` → delete old photo file. PLUS **`validateContentOverride(body: string)`** (≤ 4 KB) + `putContentOverride(viewbookId, contentKey, body, updatedBy)` / `deleteContentOverride` (fix 13 — per-client overrides are PR1 admin scope).

- [ ] Test-first (roster roundtrip; unknown key 400; corrupt null; caps; photo-attach miss deletes orphan; override cap) → fail → implement → pass → commit `git commit -m "feat(viewbook): global content store + atomic team photo + per-client overrides"`

---

### Task 7: Public-token validator + admin API routes (test-first)

**Files:**
- Create: `lib/viewbook/route-auth.ts` + `lib/viewbook/route-auth.test.ts` (moved into PR1 — program fix 1)
- Create: `lib/viewbook/operator.ts` (`requireOperatorEmail(): Promise<string>` — `getAuthSession()` email or `HttpError(401,'auth_required')`; **no sentinel fallback** — Kevin decision) + test (mock `@/lib/auth` via `vi.mock`)
- Create: `app/api/viewbooks/route.ts`, `app/api/viewbooks/[id]/route.ts`, `…/[id]/token/route.ts`, `…/[id]/sections/[sectionKey]/route.ts`, `…/[id]/milestones/route.ts` + `…/[milestoneId]/route.ts`, `…/[id]/assets/route.ts` (POST multipart `{kind:'logo'|'hero', sectionKey?}` → attachment ops — never save-only), `…/[id]/sync-questions/route.ts`, `…/[id]/overrides/[contentKey]/route.ts`, `app/api/viewbook-content/[key]/route.ts`, `app/api/viewbook-content/team-photo/route.ts`
- Create: `app/api/viewbooks/routes.test.ts` (route-level tests)
- Modify: `app/api/clients/[id]/route.ts` — DELETE: `collectClientViewbookAssetSnapshot(clientId)` BEFORE the delete, best-effort file cleanup after (fix 11)

**Interfaces:**
- `route-auth.ts` produces `requireViewbookToken(token: string): Promise<Viewbook>` — resolves by token, rejects revoked / archived-client / not-found with ONE indistinguishable `HttpError(404, 'not_found')`. PR2/PR4/PR3 import it unchanged.
- Routes are thin service calls; ids parsed `^[1-9][0-9]*$` → 404; every handler `withRoute`-wrapped; attribution via `requireOperatorEmail()`.

- [ ] **Step 1: Failing route tests** (call the exported handlers directly with `new Request(...)`, `vi.mock('@/lib/auth')`): malformed JSON → 400 `invalid_json`; id `'abc'` → 404; no session email → 401 `auth_required`; invalid theme PATCH → 400 `invalid_theme`; multipart logo attach happy-path stamps theme + serves back; `requireViewbookToken` fail-closed trio (bad token / revoked / archived client) → identical 404 bodies.
- [ ] **Steps 2–4:** fail → implement → pass. **Step 5:** Commit `git commit -m "feat(viewbook): route-auth + operator guard + admin API routes (test-first)"`

---

### Task 8: Admin UI shell + clients card + nav registry (test-first where logic lives)

**Files:**
- Create: `app/(app)/viewbooks/page.tsx`, `app/(app)/viewbooks/[id]/page.tsx`, `app/(app)/viewbooks/settings/page.tsx`, `components/viewbook/admin/{ViewbookIndex,ViewbookEditor,ThemeEditor,ContentTab,MilestonesEditor,GlobalContentEditor,ViewbookCard}.tsx`, `components/viewbook/admin/ViewbookCard.test.tsx` + `ViewbookIndex.test.tsx` (render + copy-link + create-flow behavior, `@vitejs/plugin-react` is already wired)
- Modify: `app/(app)/clients/[id]/page.tsx` (mount `ViewbookCard`), `lib/tools-registry.ts` + its existing test (add `/viewbooks` entry — follow the `/sales` row shape), `ecosystem.config.js` (add `VIEWBOOK_ASSETS_DIR: '${DATA_HOME}/viewbook-assets'`-style env following `HERO_SCREENSHOTS_DIR`'s row)

Editor tabs in PR1: **Theme · Content (incl. per-client overrides) · Milestones · Settings** (+ "Sync questions" button in Settings). Data Source / Feedback / Activity tabs arrive in PR3/PR4. ThemeEditor preview = inline swatches + typography specimen (the shared public renderer arrives in PR2).

- [ ] **Step 1:** Failing component tests (index renders rows from fetched JSON; card copy-link writes `${NEXT_PUBLIC_APP_URL}/viewbook/<token>`; create posts `{clientId, kind}`) → fail.
- [ ] **Step 2:** Build UI (repo dark-mode variants; `ProspectDashboard.tsx` idioms) → tests pass.
- [ ] **Step 3:** Gates: `npx tsc --noEmit && npm run lint && npm run build` clean. Commit `git commit -m "feat(viewbook): admin UI shell, clients card, nav registry, assets env"`

---

### Task 9: PR gates + PR + handoff

- [ ] **Step 1:** Full gates in the worktree: `npx tsc --noEmit && npm run lint && DATABASE_URL="file:./local-dev.db" npm test && npm run build && npm run audit:ci` — all green.
- [ ] **Step 2:** Push `feat/client-viewbook`; open PR `feat(viewbook): PR1 — schema, seeds, theme/assets, route-auth, admin shell`; body links spec + program plan.
- [ ] **Step 3:** `/codex-review` the branch diff (P1); apply verified findings; merge on gate-green.
- [ ] **Step 4:** Write `docs/superpowers/todos/HANDOFF-client-viewbook.md` (state, next = PR2 open + PR4 Codex core-phase brief cut, gotchas) and commit. Cut the PR4 brief.

## Self-review notes (rev 2)

- All 15 Codex plan fixes addressed: 1 (route-auth → Task 7), 8 (11 models, no reset, create-only flow), 9 (compound-where rollback + cross-viewbook tests), 10 (TextEncoder/plain-object/hasOwnProperty/0.179 + tests), 11 (atomic attachments, scope validation, path containment, ENOENT-only, client-DELETE snapshot, ecosystem env, team-photo route), 12 (service P2002 catch, rotate clears revokedAt, per-row sync, cleanup hooks, exact test commands), 13 (sync-questions, overrides, team photo, client-delete cleanup, tools-registry owned here), 14 (Tasks 7–8 test-first, audit:ci in gates), 15 (401 reject — Kevin decision).
- Fixes 2–7 live in the program plan rev 2 (lane/ownership changes).
- Test-DB correction: per-worker template copies ARE the mechanism (verified `test/global-setup.ts` + `test/setup-worker.ts`); cleanup hooks kept as hygiene, reset ban kept as correctness.
