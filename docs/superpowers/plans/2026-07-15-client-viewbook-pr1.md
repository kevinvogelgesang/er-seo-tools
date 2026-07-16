# Client Viewbook PR1 — Schema + Seeds + Theme/Assets + Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full viewbook schema, the code-owned seeds (question catalog, default milestones, font catalog), the strict theme validator, the asset store, the admin service layer + API routes, and the internal admin UI shell — everything both later lanes build on.

**Architecture:** All 10 Prisma models ship in this one migration (later PRs never touch `schema.prisma`). Pure/validating modules live in `lib/viewbook/*` with vitest coverage; thin `withRoute` admin routes call the service layer; admin UI is a minimal three-tab editor. No public routes, no middleware changes, no jobs in this PR.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, vitest (per-worker isolated test DBs — import `prisma` from `@/lib/db` directly in tests), Tailwind (class dark mode).

## Global Constraints (from spec — apply to every task)

- Array-form `$transaction([...])` ONLY; conditional logic in SQL (`EXISTS`), never interactive transactions.
- All API routes wrapped in `withRoute` (`lib/api/with-route.ts`); JSON bodies via `parseJsonBody` (`lib/api/body.ts`); errors via `HttpError` (`lib/api/errors.ts`).
- Operator attribution = `getAuthSession()` email (`lib/auth.ts`), never client-supplied.
- Custom `ViewbookField.defKey` is `NULL`, never `''`; custom fields addressed by `id`.
- Theme validation is a strict whole-object parse: unknown keys rejected, 8 KB byte cap, colors `^#[0-9a-fA-F]{6}$`, fonts must be `FONT_CATALOG` keys, `sectionHeroes` keys ⊆ section keys, filenames match `^[a-z0-9-]+\.(png|jpe?g|webp)$`.
- Uploads: magic-byte sniffing (png/jpg/webp), SVG impossible by construction, 2 MB cap, server-generated filenames, atomic unique-temp+rename, ENOENT-tolerant delete.
- `VIEWBOOK_ASSETS_DIR` env, default `<cwd>/data/viewbook-assets`; subdirs `global/` and `<viewbookId>/`.
- Gates: `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.

**Section keys (frozen):** `welcome` · `milestones` · `data-source` · `brand` · `assessment` · `strategy` · `materials`.
**Global content keys (frozen):** `team` · `process` · `why` · `seo-base` · `geo-base` · `eeat-base`.

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (add 10 models + `Client.viewbook` inverse relation)
- Create: `prisma/migrations/<generated>_client_viewbook/migration.sql` (generated, then hand-append one partial index)

**Interfaces:**
- Produces: models `Viewbook`, `ViewbookSection`, `ViewbookField`, `ViewbookFieldAmendment`, `ViewbookMilestone`, `ViewbookReviewLink`, `ViewbookFeedback`, `ViewbookGlobalContent`, `ViewbookContentOverride`, `ViewbookMaterialLink`, `ViewbookActivity` exactly as spec §4 (post-Codex-fix version: `ViewbookField.version/archivedAt`, `clientMutationId @unique` on amendment/feedback/material, `ViewbookMaterialLink.status/url?/providedAt`, indexes `@@index([viewbookId, id])` on activity/materials, `@@index([reviewLinkId, id])`, `@@index([fieldId, id])`, `@@index([viewbookId, sortOrder])` on milestones).

- [ ] **Step 1: Add the models to `prisma/schema.prisma`** — copy the schema block from spec §4 verbatim (it is the contract; do not improvise), and add to `model Client`: `viewbook Viewbook?`
- [ ] **Step 2: Generate the migration**

Run: `npx prisma migrate dev --name client_viewbook`
Expected: migration created, client regenerated, no drift.

- [ ] **Step 3: Append the partial unique index** to the new `migration.sql` (Prisma can't express it):

```sql
-- At most one 'current' milestone per viewbook (spec §4 / Codex fix 5)
CREATE UNIQUE INDEX "ViewbookMilestone_one_current_per_viewbook"
ON "ViewbookMilestone"("viewbookId") WHERE "status" = 'current';
```

Run: `npx prisma migrate reset --force && npx prisma migrate dev` (local db) to prove the edited migration applies cleanly.

- [ ] **Step 4: Gate + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add prisma && git commit -m "feat(viewbook): PR1 schema — 10 models, partial unique current-milestone index"
```

---

### Task 2: Question catalog + default milestones (seeds)

**Files:**
- Create: `lib/viewbook/catalog.ts`, `lib/viewbook/milestones.ts`
- Test: `lib/viewbook/catalog.test.ts`

**Interfaces:**
- Produces: `CATALOG: CatalogEntry[]` where `CatalogEntry = { defKey: string; category: CatalogCategory; label: string; fieldType: 'text' | 'textarea' | 'list'; sortOrder: number }`; `CATALOG_CATEGORIES: readonly CatalogCategory[]` (`'school' | 'programs' | 'team-access' | 'crm-leads' | 'admissions' | 'positioning' | 'student-experience' | 'brand-materials'`); `DEFAULT_MILESTONES: { title: string; blurb: string; sortOrder: number }[]` (7 stages, spec §5).

- [ ] **Step 1: Write the failing test** (`lib/viewbook/catalog.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { CATALOG, CATALOG_CATEGORIES } from './catalog'
import { DEFAULT_MILESTONES } from './milestones'

describe('viewbook catalog', () => {
  it('has unique defKeys and valid categories/types', () => {
    const keys = CATALOG.map((e) => e.defKey)
    expect(new Set(keys).size).toBe(keys.length)
    for (const e of CATALOG) {
      expect(CATALOG_CATEGORIES).toContain(e.category)
      expect(['text', 'textarea', 'list']).toContain(e.fieldType)
      expect(e.defKey).toMatch(/^[a-z0-9-]+$/)
      expect(e.label.length).toBeGreaterThan(0)
    }
  })
  it('covers every category and orders within category', () => {
    for (const cat of CATALOG_CATEGORIES) {
      const entries = CATALOG.filter((e) => e.category === cat)
      expect(entries.length).toBeGreaterThan(0)
      const orders = entries.map((e) => e.sortOrder)
      expect(new Set(orders).size).toBe(orders.length)
    }
  })
  it('seeds 7 default milestones in order', () => {
    expect(DEFAULT_MILESTONES).toHaveLength(7)
    expect(DEFAULT_MILESTONES.map((m) => m.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(DEFAULT_MILESTONES[0].title).toBe('Kickoff')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- lib/viewbook/catalog.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `catalog.ts`** — client-safe, no imports:

```ts
export const CATALOG_CATEGORIES = [
  'school', 'programs', 'team-access', 'crm-leads',
  'admissions', 'positioning', 'student-experience', 'brand-materials',
] as const
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number]

export interface CatalogEntry {
  defKey: string
  category: CatalogCategory
  label: string
  fieldType: 'text' | 'textarea' | 'list'
  sortOrder: number
}

// Modeled on the Jotform onboarding document (spec §5). Additive-only:
// never rename/remove a defKey — existing ViewbookField rows reference them.
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

And `milestones.ts`:

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

- [ ] **Step 4: Run tests** — `npm test -- lib/viewbook/catalog.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add lib/viewbook && git commit -m "feat(viewbook): question catalog + default milestone seeds"`

---

### Task 3: Theme kit — strict validator + font catalog

**Files:**
- Create: `lib/viewbook/theme.ts`
- Test: `lib/viewbook/theme.test.ts`

**Interfaces:**
- Produces: `SECTION_KEYS` (frozen 7-key list), `type SectionKey`, `type ViewbookTheme = { primary: string; secondary: string; tertiary: string; headingFont: string; bodyFont: string; logo: string | null; sectionHeroes: Partial<Record<SectionKey, string>> }`; `DEFAULT_THEME: ViewbookTheme` (ER navy/teal/gold, `'inter'`/`'inter'`, no logo/heroes); `FONT_CATALOG: Record<string, { family: string; gfQuery: string }>` (12+ curated entries incl. `'inter'`); `validateViewbookTheme(raw: unknown): ViewbookTheme | null` (strict: null on ANY violation — unknown key, bad hex, unknown font key, bad hero section key, bad filename, >8 KB when re-serialized); `parseStoredTheme(json: string): ViewbookTheme` (validate-or-DEFAULT_THEME — read as strict as write, degrade never throw); `onThemeColorText(hex: string): '#ffffff' | '#111111'` (relative luminance threshold 0.5); `ASSET_FILENAME_RE = /^[a-z0-9-]+\.(png|jpe?g|webp)$/`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { validateViewbookTheme, parseStoredTheme, onThemeColorText, DEFAULT_THEME, FONT_CATALOG } from './theme'

const good = {
  primary: '#122033', secondary: '#1D7F7F', tertiary: '#C99334',
  headingFont: 'inter', bodyFont: 'inter', logo: null, sectionHeroes: {},
}

describe('validateViewbookTheme', () => {
  it('accepts a complete valid theme', () => {
    expect(validateViewbookTheme(good)).toEqual(good)
  })
  it('rejects unknown keys, bad hex, unknown fonts, bad hero keys/filenames', () => {
    expect(validateViewbookTheme({ ...good, extra: 1 })).toBeNull()
    expect(validateViewbookTheme({ ...good, primary: 'red' })).toBeNull()
    expect(validateViewbookTheme({ ...good, primary: '#12203' })).toBeNull()
    expect(validateViewbookTheme({ ...good, headingFont: 'comic-sans' })).toBeNull()
    expect(validateViewbookTheme({ ...good, sectionHeroes: { nope: 'a.png' } })).toBeNull()
    expect(validateViewbookTheme({ ...good, sectionHeroes: { brand: '../x.png' } })).toBeNull()
    expect(validateViewbookTheme({ ...good, logo: 'x.svg' })).toBeNull()
    expect(validateViewbookTheme(null)).toBeNull()
  })
  it('parseStoredTheme degrades to DEFAULT_THEME, never throws', () => {
    expect(parseStoredTheme('not json')).toEqual(DEFAULT_THEME)
    expect(parseStoredTheme('{}')).toEqual(DEFAULT_THEME)
    expect(parseStoredTheme(JSON.stringify(good))).toEqual(good)
  })
  it('every catalog font has family + gfQuery; luminance picks legible text', () => {
    expect(Object.keys(FONT_CATALOG).length).toBeGreaterThanOrEqual(12)
    for (const f of Object.values(FONT_CATALOG)) {
      expect(f.family.length).toBeGreaterThan(0)
      expect(f.gfQuery).toMatch(/^family=/)
    }
    expect(onThemeColorText('#122033')).toBe('#ffffff')
    expect(onThemeColorText('#f5f0e6')).toBe('#111111')
  })
})
```

- [ ] **Step 2: Run to fail** — `npm test -- lib/viewbook/theme.test.ts` → FAIL.
- [ ] **Step 3: Implement** — client-safe module; strict object walk (no `zod` — repo has none; follow `lib/sweep/types.ts` whole-doc-reject convention). Validation checks, in order: non-null object → key set exactly equals allowed keys → three colors match `/^#[0-9a-fA-F]{6}$/` → both fonts `in FONT_CATALOG` → `logo` null or `ASSET_FILENAME_RE` → `sectionHeroes` object whose keys ⊆ `SECTION_KEYS` and values match `ASSET_FILENAME_RE` → `JSON.stringify(theme).length <= 8192`. `onThemeColorText`: WCAG relative luminance (`0.2126R+0.7152G+0.0722B` on sRGB-linearized channels) > 0.5 → dark text else white. `FONT_CATALOG` initial 12: inter, lora, playfair-display, montserrat, oswald, merriweather, source-sans-3, work-sans, libre-baskerville, poppins, archivo, dm-serif-display (each `gfQuery` like `family=Playfair+Display:wght@400;700`).
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(viewbook): strict theme validator + curated font catalog"`

---

### Task 4: Asset store — sniffing, atomic write, lifecycle delete

**Files:**
- Create: `lib/viewbook/assets.ts`
- Test: `lib/viewbook/assets.test.ts`

**Interfaces:**
- Produces: `viewbookAssetsDir(): string` (env `VIEWBOOK_ASSETS_DIR` default `path.join(process.cwd(), 'data', 'viewbook-assets')`); `sniffImageType(buf: Buffer): 'png' | 'jpeg' | 'webp' | null` (magic bytes: `89 50 4E 47`, `FF D8 FF`, `RIFF....WEBP`); `saveViewbookAsset(scope: string, buf: Buffer): Promise<{ filename: string; mime: string }>` (scope = `'global'` or `String(viewbookId)`; rejects `buf.length > 2_097_152` or null sniff with `HttpError(400, 'invalid_image')`; filename = `${crypto.randomUUID()}.${ext}` — server-generated, always matches `ASSET_FILENAME_RE`; write temp + `fs.rename`); `readViewbookAsset(scope, filename)` (containment: filename must match `ASSET_FILENAME_RE` — no separators possible; returns `{ buf, mime } | null` on ENOENT); `deleteViewbookAssets(scope: string, filenames: string[]): Promise<void>` (ENOENT-tolerant, never throws).
- Consumes: `ASSET_FILENAME_RE` from Task 3.

- [ ] **Step 1: Write the failing test** — use `fs.mkdtemp` + `process.env.VIEWBOOK_ASSETS_DIR` override in `beforeEach`; minimal valid PNG/JPEG/WEBP header buffers as fixtures; asserts: save→read roundtrip + returned filename matches the regex; oversize and sniff-fail throw `HttpError` 400; `readViewbookAsset('1', 'nope.png')` → null; `deleteViewbookAssets` on missing files resolves; a `.svg`-shaped buffer (`<svg…`) sniffs null.

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { saveViewbookAsset, readViewbookAsset, deleteViewbookAssets, sniffImageType } from './assets'
import { HttpError } from '@/lib/api/errors'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])
let dir: string
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'vb-assets-')); process.env.VIEWBOOK_ASSETS_DIR = dir })
afterEach(async () => { delete process.env.VIEWBOOK_ASSETS_DIR; await rm(dir, { recursive: true, force: true }) })

describe('viewbook asset store', () => {
  it('sniffs png/jpeg/webp and rejects svg/unknown', () => {
    expect(sniffImageType(PNG)).toBe('png')
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffImageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('webp')
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
  })
  it('save → read roundtrip with server-generated filename', async () => {
    const { filename, mime } = await saveViewbookAsset('7', PNG)
    expect(filename).toMatch(/^[a-z0-9-]+\.png$/)
    expect(mime).toBe('image/png')
    const back = await readViewbookAsset('7', filename)
    expect(back?.buf.equals(PNG)).toBe(true)
  })
  it('rejects oversize and non-image; tolerates missing on read/delete', async () => {
    await expect(saveViewbookAsset('7', Buffer.alloc(2_097_153))).rejects.toBeInstanceOf(HttpError)
    await expect(saveViewbookAsset('7', Buffer.from('hello'))).rejects.toBeInstanceOf(HttpError)
    expect(await readViewbookAsset('7', 'missing.png')).toBeNull()
    await expect(deleteViewbookAssets('7', ['missing.png'])).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to fail** → FAIL. **Step 3: Implement** (mirror `lib/sales/hero-screenshot.ts` atomic-write/delete idioms). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(viewbook): asset store with magic-byte sniffing + atomic writes"`

---

### Task 5: Service layer — create/seed, list, token, sections, milestones, delete

**Files:**
- Create: `lib/viewbook/service.ts`
- Test: `lib/viewbook/service.test.ts` (DB-backed — import `prisma` from `@/lib/db`, create a `Client` per test with a unique name)

**Interfaces:**
- Consumes: `CATALOG`, `DEFAULT_MILESTONES`, `SECTION_KEYS`, `DEFAULT_THEME`, `validateViewbookTheme`, `deleteViewbookAssets`, `parseStoredTheme`.
- Produces:
  - `createViewbook(clientId: number, kind: 'new-build' | 'upgrade', createdBy: string): Promise<{ id: number; token: string }>` — ONE nested `prisma.viewbook.create` seeding `sections` (7 rows; `assessment` state `'hidden'` when kind `'new-build'`, else `'active'`), `fields` (one per `CATALOG` entry, `createdBy: 'seed'`), `milestones` (from `DEFAULT_MILESTONES`, first one `status: 'current'`). Existing viewbook for client → `HttpError(409, 'viewbook_exists')` (P2002 on `clientId` unique caught by withRoute as fallback). Archived client → `HttpError(409, 'client_archived')`.
  - `listViewbooks()` — client name/kind/createdAt + counts (unresolvedFeedback: 0 until PR4 — computed via `_count` when models populate).
  - `getViewbookAdmin(id: number)` — full subtree for the editor (sections, fields+amendments, milestones+reviewLinks, overrides, materials) + `theme: parseStoredTheme(themeJson)`.
  - `updateViewbookTheme(id, raw: unknown)` — `validateViewbookTheme` or `HttpError(400, 'invalid_theme')`; returns saved theme.
  - `updateViewbookSettings(id, patch: { welcomeNote?; notifyEmail?; kind? })` — bounded strings.
  - `rotateViewbookToken(id)` / `revokeViewbook(id)` — new UUID / stamp `revokedAt`.
  - `setSectionState(id, sectionKey, state: 'hidden' | 'active' | 'done')` — stamps/clears `doneAt`; unknown key → `HttpError(400, 'invalid_section')`.
  - `updateSectionText(id, sectionKey, patch: { introNote?; narrative? })`.
  - `createMilestone/updateMilestone/deleteMilestone` — status transitions keep the partial-unique invariant with an array-form txn: `[demote current where viewbookId, promote target]` when setting `'current'`.
  - `syncCatalogQuestions(id)` — `createMany` missing defKeys only (idempotent, never touches values).
  - `deleteViewbook(id)` — snapshot `themeJson` filenames + hero filenames FIRST, `prisma.viewbook.delete`, then `deleteViewbookAssets(String(id), snapshot)` best-effort.

- [ ] **Step 1: Write failing tests** — cover: create seeds exact counts (`CATALOG.length` fields, 7 sections, 7 milestones, milestone[0] current, new-build hides `assessment`); duplicate create → 409; rotate changes token, revoke stamps; `setSectionState('data-source','done')` stamps doneAt; promoting a second milestone to current demotes the first (assert exactly one `status: 'current'` row); `syncCatalogQuestions` after deleting one seeded field row restores exactly it; `deleteViewbook` removes subtree rows.

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook, rotateViewbookToken, revokeViewbook, setSectionState, updateMilestone, syncCatalogQuestions, deleteViewbook } from './service'
import { CATALOG } from './catalog'

async function mkClient() {
  return prisma.client.create({ data: { name: `vb-test-${crypto.randomUUID()}` } })
}

describe('createViewbook', () => {
  it('seeds sections/fields/milestones in one nested create', async () => {
    const c = await mkClient()
    const { id } = await createViewbook(c.id, 'new-build', 'kevin@enrollmentresources.com')
    const vb = await prisma.viewbook.findUniqueOrThrow({
      where: { id }, include: { sections: true, fields: true, milestones: true },
    })
    expect(vb.fields).toHaveLength(CATALOG.length)
    expect(vb.sections).toHaveLength(7)
    expect(vb.sections.find((s) => s.sectionKey === 'assessment')?.state).toBe('hidden')
    expect(vb.milestones.filter((m) => m.status === 'current')).toHaveLength(1)
    await expect(createViewbook(c.id, 'upgrade', 'x@y.z')).rejects.toMatchObject({ status: 409 })
  })
})
// …token rotate/revoke, section state, single-current invariant,
// syncCatalogQuestions idempotency, delete-cascades tests in the same file,
// each on its own fresh client (same shape as above).
```

- [ ] **Step 2: Run to fail** → FAIL. **Step 3: Implement `service.ts`** per the Produces contract (array-form transactions; single-current promotion = `$transaction([updateMany demote, update promote])`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(viewbook): admin service layer — nested-create seeding, token lifecycle, sections, milestones"`

---

### Task 6: Global content — typed bodies + service

**Files:**
- Create: `lib/viewbook/global-content.ts`
- Test: `lib/viewbook/global-content.test.ts`

**Interfaces:**
- Produces: `GLOBAL_CONTENT_KEYS` (frozen 6); `type TeamMember = { name: string; role: string; photo: string | null; blurb: string }`; `type ContentBlocks = { blocks: { heading: string; body: string }[] }`; `validateGlobalContent(key, raw: unknown)` — `team` → `TeamMember[]` (photo null or `ASSET_FILENAME_RE`, caps: 20 members, 2 KB blurb), others → `ContentBlocks` (≤ 20 blocks, ≤ 4 KB body each); strict whole-doc reject → null; `putGlobalContent(key, raw, updatedBy)` (upsert; invalid → `HttpError(400,'invalid_content')`); `getAllGlobalContent()` → `Record<key, parsed | null>` (corrupt row reads null, never throws); `getGlobalContent(key)`.

- [ ] **Step 1: Failing test** — valid team roster roundtrips; unknown key 400; corrupt stored JSON reads null; block caps enforced.
- [ ] **Step 2: Run to fail.** **Step 3: Implement.** **Step 4: Run to pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(viewbook): typed global content store"`

---

### Task 7: Admin API routes

**Files:**
- Create: `app/api/viewbooks/route.ts` (GET list, POST `{clientId, kind}`), `app/api/viewbooks/[id]/route.ts` (GET, PATCH `{theme?|welcomeNote?|notifyEmail?|kind?}`, DELETE), `app/api/viewbooks/[id]/token/route.ts` (POST rotate / DELETE revoke), `app/api/viewbooks/[id]/sections/[sectionKey]/route.ts` (PATCH `{state?|introNote?|narrative?}`), `app/api/viewbooks/[id]/milestones/route.ts` (POST) + `app/api/viewbooks/[id]/milestones/[milestoneId]/route.ts` (PATCH/DELETE), `app/api/viewbooks/[id]/assets/route.ts` (POST multipart upload → `saveViewbookAsset(String(id), buf)`), `app/api/viewbook-content/[key]/route.ts` (GET/PUT).

**Interfaces:**
- Consumes: everything from Tasks 3–6; `withRoute`, `parseJsonBody`, `HttpError`, `getAuthSession`.
- Produces: JSON envelopes `{ viewbook }` / `{ viewbooks }` / `{ theme }` / `{ error }` consumed by Task 8's UI and later lanes' admin tabs. All handlers: strict `^[1-9][0-9]*$` id parse → 404; operator email = `(await getAuthSession())?.email ?? 'operator'`; every route `withRoute`-wrapped; **no middleware.ts changes** (cookie-gated by default).

- [ ] **Step 1:** Implement routes as thin service calls (no business logic in handlers). Upload route: `const form = await req.formData()`, single `file` entry, `Buffer.from(await file.arrayBuffer())`.
- [ ] **Step 2:** Gate — `npx tsc --noEmit` clean; `npm test` still green (service tests cover the logic; routes stay logic-free).
- [ ] **Step 3: Commit** — `git commit -m "feat(viewbook): admin API routes (viewbooks CRUD, token, sections, milestones, assets, global content)"`

---

### Task 8: Admin UI shell + clients-page card

**Files:**
- Create: `app/(app)/viewbooks/page.tsx` (index), `app/(app)/viewbooks/[id]/page.tsx` (editor), `app/(app)/viewbooks/settings/page.tsx` (global content), `components/viewbook/admin/ViewbookIndex.tsx`, `components/viewbook/admin/ViewbookEditor.tsx` (tabs: Theme · Content · Milestones · Settings — Data Source/Feedback/Activity tabs are later lanes), `components/viewbook/admin/ThemeEditor.tsx` (color pickers via `<input type="color">` + font selects + logo/hero upload + inline swatch/typography preview — the SHARED public preview renderer arrives in PR2), `components/viewbook/admin/GlobalContentEditor.tsx`, `components/viewbook/admin/MilestonesEditor.tsx`
- Modify: `app/(app)/clients/[id]/page.tsx` — add a `ViewbookCard` (create / open editor / copy `${NEXT_PUBLIC_APP_URL}/viewbook/${token}` link)
- Modify: the Nav registry the app uses for tool tiles (follow `/sales` precedent) to add `/viewbooks` ("Client Viewbooks")

**Interfaces:**
- Consumes: Task 7 routes only (fetch from client components; follow `ProspectDashboard.tsx` idioms — controlled forms, error banners, no polling needed here).

- [ ] **Step 1:** Build index (table: client, kind, created, link-copy button) + editor tabs + settings editor + card. Dark-mode variants per repo convention (`dark:bg-navy-card` etc.).
- [ ] **Step 2:** Gate — `npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(viewbook): admin UI shell — index, editor tabs, global content, clients card"`

---

### Task 9: PR gates + PR + handoff

- [ ] **Step 1:** Full gate run in the worktree: `npx tsc --noEmit && npm run lint && DATABASE_URL="file:./local-dev.db" npm test && npm run build` — all green.
- [ ] **Step 2:** Push `feat/client-viewbook`, open PR titled `feat(viewbook): PR1 — schema, seeds, theme/assets, admin shell`, body links spec + program plan.
- [ ] **Step 3:** Request `/codex-review` on the branch diff (P1); apply verified findings.
- [ ] **Step 4:** Write `docs/superpowers/todos/HANDOFF-client-viewbook.md` (current state, PR2 next + PR4 Codex brief-cut next, gotchas) and commit.

## Self-review notes

- Spec coverage: PR1 slice of §4–§6, §10 (admin), §12 (seed/theme/asset/service tests) — public/§7–§9 items are explicitly later lanes per the program plan.
- No placeholders: every module's contract is stated with exact signatures; test code included where a task is test-first (Tasks 5–6 include representative complete tests plus named required cases — the implementer writes them in the same file/shape shown).
- Type consistency: `SectionKey`/`SECTION_KEYS`, `ASSET_FILENAME_RE`, `CatalogEntry`, `ViewbookTheme` names match across Tasks 3–8.
