# Client Viewbook PR2 — Public Themed Page (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public token-gated `/viewbook/[token]` page — themed shell, 7 read-only sections, fault isolation, token assets route, middleware matchers, CSP fonts origins, and ThemePreview adoption in the admin theme editor.

**Architecture:** One server loader (`loadViewbookPublicData`) produces a client-safe serializable payload; presentational section components (NO `'use client'`, no server imports) render it. Theming = CSS custom properties set as React inline styles on the shell wrapper + ONE Google Fonts `<link>` built from `FONT_CATALOG` values only. The assets route authorizes by allowlist: the token's own `themeJson` filenames (viewbook scope) or the global team-roster photo set (global scope).

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, Tailwind (public page does NOT use dark mode), Vitest (+ jsdom for component tests).

**Branch/worktree:** `feat/viewbook-pr2` in `.claude/worktrees/client-viewbook`. PR1 is merged (main @ 86a93f3); everything here compiles against merged PR1 code.

## Global Constraints

- Public matchers are **anchored single-segment regex** — never a `/viewbook/` or `/api/viewbook/` prefix (spec §11). PR2 adds exactly TWO: `^/viewbook/[^/]+$` and `^/api/viewbook/[^/]+/assets/[^/]+$`.
- ALL token failures → ONE indistinguishable 404 (`requireViewbookToken` is the only validator).
- All stored text is plain text; React render-time escaping is the only encoding. No `dangerouslySetInnerHTML` anywhere in PR2.
- Fonts are catalog KEYS; client input never reaches the fonts URL. Colors are `^#[0-9a-fA-F]{6}$`-validated by PR1's `parseStoredTheme` before render.
- The public page does NOT participate in app dark/light mode (spec §6); admin pages stay app-themed.
- Outbound links (review links) render `target="_blank" rel="noopener noreferrer"`.
- Public page: `(public)` route group, `export const dynamic = 'force-dynamic'`, `robots: noindex`, zero cookie-gated fetches (C14 sales precedent).
- Assets served with allowlisted MIME + `X-Content-Type-Options: nosniff` (spec §6); `Cache-Control: private, max-age=3600` (C14 hero precedent — filenames are UUIDs, replacement mints a new name, so caching is safe).
- API routes `withRoute`-wrapped. No new env vars.
- Array-form transactions only (no writes in PR2 anyway — the whole PR is read-only).
- `hidden` sections never render; `done` sections collapse to a celebratory expandable header (data retained).
- Fault isolation: a failing data block degrades to a friendly per-section placeholder; the page never blanks (`loadOpsSnapshot` precedent — isolation lives at the LOADER block level).
- Gates before merge: `npx tsc --noEmit` · `npm run lint` · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build` · `/security-review` (public asset route + middleware change = security-sensitive surface).
- All rendered dates use `timeZone: 'UTC'` in `toLocaleDateString` — stable across server timezones (Codex fix 8).
- **Ownership-map additions (Codex fix 7 — mirror these into the program plan's PR2 entry BEFORE implementing, and flag in the PR description):** `lib/viewbook/public-types.ts` (client-safe payload types — the `global-content-keys.ts` precedent; `public-data.ts` imports prisma so components must not import it), `components/viewbook/public/section-titles.ts`, `components/PublicFooter.tsx` + `components/PublicFooter.test.tsx` (anchored-regex footer gate), `next.config.test.ts` (CSP directive assertions). None of these files are in any other live lane.
- **PR4 forward contract:** the payload INCLUDES feedback rows on review links and material-link rows, and `MilestonesSection`/`MaterialsSection` render read-only lists — PR4's integration phase mounts `FeedbackThread`/`MaterialLinkForm` into those two files without touching `public-data.ts`. **CSS-variable contract (Codex fix 4): `--vb-*` is canonical.** PR4's already-pushed leaves reference `var(--viewbook-primary)` (`FeedbackThread.tsx:75`, `MaterialLinkForm.tsx:59`) — the PR4 integration addendum brief MUST include renaming those two references to `var(--vb-primary)`.
- **PR3 forward contract:** `PublicField` carries `version` (optimistic `expectedVersion` writes) and `createdAt` (post-lock "added after lock-in" derivation vs `dataLockedAt`), and amendments carry `id` — so PR3 never has to touch `public-data.ts`/`public-types.ts` (they stay outside its ownership map).

---

### Task 1: Client-safe payload types + public data loader

**Files:**
- Create: `lib/viewbook/public-types.ts`
- Create: `lib/viewbook/public-data.ts`
- Test: `lib/viewbook/public-data.test.ts`

**Interfaces:**
- Consumes: PR1 `requireViewbookToken(token): Promise<Viewbook>` (throws `HttpError(404)`), `parseStoredTheme`, `SECTION_KEYS`, `getGlobalContent(key)`, `GLOBAL_CONTENT_KEYS`, `CATALOG_CATEGORIES`.
- Produces: `loadViewbookPublicData(token: string): Promise<ViewbookPublicData | null>` — null on ANY token failure; all types in `public-types.ts` (dates as ISO strings; every later task consumes these).

- [ ] **Step 1: Write `lib/viewbook/public-types.ts`**

```ts
// Client-safe payload types for the public viewbook page (PR2). The server
// loader (public-data.ts) produces these; every public section component and
// the admin ThemePreview consume them. NO server imports here (the
// global-content-keys.ts precedent) — public-data.ts imports prisma, so
// components must never import types from it directly.

import type { SectionKey, ViewbookTheme } from './theme'
import type { ContentBlocks, GlobalContentKey, TeamMember } from './global-content-keys'

export interface PublicSection {
  sectionKey: SectionKey
  state: 'active' | 'done'
  doneAt: string | null
  introNote: string | null
  narrative: string | null
}

export interface PublicFieldAmendment {
  id: number
  value: string
  author: string // 'client' | operator email — components display 'you' / 'our team'
  createdAt: string
}

export interface PublicField {
  id: number
  label: string
  fieldType: string // 'text' | 'textarea' | 'list'
  value: string | null // list = JSON array of strings
  version: number // PR3 optimistic-concurrency contract (expectedVersion)
  createdAt: string // PR3 derives "added after lock-in" vs dataLockedAt
  valueUpdatedBy: string | null
  valueUpdatedAt: string | null
  isCustom: boolean
  amendments: PublicFieldAmendment[]
}

export interface PublicFieldCategory {
  category: string
  fields: PublicField[]
}

// Feedback rows ride along read-only in PR2; PR4's FeedbackThread renders them.
export interface PublicFeedback {
  id: number
  body: string
  authorName: string | null
  authorKind: string // 'client' | 'operator'
  resolvedAt: string | null
  createdAt: string
}

export interface PublicReviewLink {
  id: number
  label: string
  url: string
  kind: string // 'mockup' | 'live'
  feedback: PublicFeedback[]
}

export interface PublicMilestone {
  id: number
  title: string
  blurb: string | null
  status: string // 'upcoming' | 'current' | 'done'
  targetDate: string | null
  doneAt: string | null
  reviewLinks: PublicReviewLink[]
}

export interface PublicMaterialLink {
  id: number
  label: string
  status: string // 'requested' | 'provided'
  url: string | null
  addedBy: string // 'client' | operator email
  providedAt: string | null
}

export interface PublicGlobalContent {
  team: TeamMember[] | null
  blocks: Partial<Record<Exclude<GlobalContentKey, 'team'>, ContentBlocks | null>>
}

export interface ViewbookPublicData {
  clientName: string
  kind: string // 'new-build' | 'upgrade'
  welcomeNote: string | null
  dataLockedAt: string | null
  theme: ViewbookTheme
  sections: PublicSection[] // visible only, fixed SECTION_KEYS order
  fieldCategories: PublicFieldCategory[]
  milestones: PublicMilestone[]
  materials: PublicMaterialLink[]
  global: PublicGlobalContent
  overrides: Partial<Record<GlobalContentKey, string>>
}
```

- [ ] **Step 2: Write the failing test `lib/viewbook/public-data.test.ts`**

DB-backed (per-worker test DB, repo convention — see `lib/viewbook/service.test.ts` for the setup pattern used in PR1; reuse its helper style for creating a client + viewbook via `createViewbook`).

```ts
import crypto from 'crypto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { loadViewbookPublicData } from './public-data'

// Client.name is @unique — house pattern (route-auth.test.ts): random names.
async function makeClient() {
  return prisma.client.create({ data: { name: `vb-pub-${crypto.randomUUID()}` } })
}

describe('loadViewbookPublicData', () => {
  beforeEach(async () => {
    await prisma.viewbook.deleteMany()
    await prisma.viewbookGlobalContent.deleteMany()
    await prisma.client.deleteMany()
  })

  it('returns null for unknown, revoked, and archived-client tokens', async () => {
    expect(await loadViewbookPublicData('nope')).toBeNull()

    const client = await makeClient()
    const { id, token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    await prisma.viewbook.update({ where: { id }, data: { revokedAt: new Date() } })
    expect(await loadViewbookPublicData(token)).toBeNull()

    await prisma.viewbook.update({ where: { id }, data: { revokedAt: null } })
    await prisma.client.update({ where: { id: client.id }, data: { archivedAt: new Date() } })
    expect(await loadViewbookPublicData(token)).toBeNull()
  })

  it('returns sections visible-only in fixed order; hidden assessment (new-build) is absent', async () => {
    const client = await makeClient()
    const { token } = await createViewbook(client.id, 'new-build', 'kevin@er.com')
    const data = await loadViewbookPublicData(token)
    expect(data).not.toBeNull()
    expect(data!.clientName).toMatch(/^vb-pub-/)
    const keys = data!.sections.map((s) => s.sectionKey)
    expect(keys).toEqual(['welcome', 'milestones', 'data-source', 'brand', 'strategy', 'materials'])
  })

  it('groups fields by category in catalog order, excludes archived, parses stamps + amendments', async () => {
    const client = await makeClient()
    const { id, token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    const field = await prisma.viewbookField.findFirstOrThrow({
      where: { viewbookId: id, defKey: 'school-name' },
    })
    await prisma.viewbookField.update({
      where: { id: field.id },
      data: { value: 'Pro Way', valueUpdatedBy: 'client', valueUpdatedAt: new Date() },
    })
    await prisma.viewbookFieldAmendment.create({
      data: { fieldId: field.id, value: 'Pro Way Hair School', author: 'client' },
    })
    const archived = await prisma.viewbookField.findFirstOrThrow({
      where: { viewbookId: id, defKey: 'school-contact-name' },
    })
    await prisma.viewbookField.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })

    const data = await loadViewbookPublicData(token)
    expect(data!.fieldCategories[0].category).toBe('school')
    const school = data!.fieldCategories[0].fields
    expect(school.some((f) => f.label === 'Primary contact name')).toBe(false)
    const named = school.find((f) => f.label === 'School name')!
    expect(named.value).toBe('Pro Way')
    expect(named.valueUpdatedBy).toBe('client')
    expect(named.amendments).toHaveLength(1)
    expect(named.amendments[0].value).toBe('Pro Way Hair School')
  })

  it('carries milestones with review links + feedback, and material links', async () => {
    const client = await makeClient()
    const { id, token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    const m = await prisma.viewbookMilestone.findFirstOrThrow({ where: { viewbookId: id, sortOrder: 5 } })
    const link = await prisma.viewbookReviewLink.create({
      data: { milestoneId: m.id, label: 'Homepage mockup', url: 'https://example.com/mock', kind: 'mockup', createdBy: 'kevin@er.com' },
    })
    await prisma.viewbookFeedback.create({
      data: { reviewLinkId: link.id, body: 'Love it', authorKind: 'client', authorName: 'Pat' },
    })
    await prisma.viewbookMaterialLink.create({
      data: { viewbookId: id, label: 'Logo files', status: 'requested', addedBy: 'kevin@er.com' },
    })

    const data = await loadViewbookPublicData(token)
    expect(data!.milestones).toHaveLength(7)
    expect(data!.milestones[0].status).toBe('current')
    const withLink = data!.milestones.find((x) => x.reviewLinks.length > 0)!
    expect(withLink.reviewLinks[0].url).toBe('https://example.com/mock')
    expect(withLink.reviewLinks[0].feedback[0].body).toBe('Love it')
    expect(data!.materials).toHaveLength(1)
    expect(data!.materials[0].status).toBe('requested')
  })

  it('degrades global content to null blocks instead of failing (corrupt row)', async () => {
    const client = await makeClient()
    const { token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    await prisma.viewbookGlobalContent.create({
      data: { key: 'process', bodyJson: 'not-json{', updatedBy: 'kevin@er.com' },
    })
    const data = await loadViewbookPublicData(token)
    expect(data).not.toBeNull()
    expect(data!.global.blocks.process ?? null).toBeNull()
    expect(data!.global.team).toBeNull()
  })

  it('degrades ONE failing block without blanking the page (Codex plan-fix 2)', async () => {
    const client = await makeClient()
    const { token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
    const spy = vi
      .spyOn(prisma.viewbookMilestone, 'findMany')
      .mockRejectedValueOnce(new Error('simulated db failure'))
    const data = await loadViewbookPublicData(token)
    spy.mockRestore()
    expect(data).not.toBeNull()
    expect(data!.milestones).toEqual([])
    expect(data!.fieldCategories.length).toBeGreaterThan(0) // sibling block survived
  })

  it('rethrows operational failures from token validation instead of masking them as 404 (Codex plan-fix 1)', async () => {
    const spy = vi
      .spyOn(prisma.viewbook, 'findUnique')
      .mockRejectedValueOnce(new Error('simulated db failure'))
    await expect(loadViewbookPublicData('some-token')).rejects.toThrow('simulated db failure')
    spy.mockRestore()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/public-data.test.ts`
Expected: FAIL — `Cannot find module './public-data'`.

- [ ] **Step 4: Write `lib/viewbook/public-data.ts`**

```ts
// Server loader for the public viewbook page (spec §8). The CORE load
// (token → viewbook + client + sections) must succeed; every other block
// (fields, milestones, materials, global content, overrides) is
// fault-isolated (loadOpsSnapshot precedent): a corrupt/failing block
// degrades to an empty/null value and is logged — the page never blanks.
// Returns null for EVERY token failure (page 404s — indistinguishable).

import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { logError } from '@/lib/log'
import { requireViewbookToken } from './route-auth'
import { parseStoredTheme, SECTION_KEYS } from './theme'
import { CATALOG_CATEGORIES } from './catalog'
import { getGlobalContent } from './global-content'
import {
  GLOBAL_CONTENT_KEYS,
  type ContentBlocks,
  type GlobalContentKey,
  type TeamMember,
} from './global-content-keys'
import type {
  PublicFieldCategory,
  PublicGlobalContent,
  PublicMaterialLink,
  PublicMilestone,
  PublicSection,
  ViewbookPublicData,
} from './public-types'

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

async function guarded<T>(op: string, load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load()
  } catch (err) {
    logError({ subsystem: 'viewbook', op: `public-${op}` }, err)
    return fallback
  }
}

export async function loadViewbookPublicData(token: string): Promise<ViewbookPublicData | null> {
  let vb
  try {
    vb = await requireViewbookToken(token)
  } catch (err) {
    // Only the validator's controlled 404 means "invalid token". Anything
    // else (Prisma/db failure) is operational breakage — rethrow so the page
    // errors visibly instead of masquerading as a 404 (Codex plan-fix 1).
    if (err instanceof HttpError) return null
    throw err
  }

  const [client, sectionRows] = await Promise.all([
    prisma.client.findUnique({ where: { id: vb.clientId }, select: { name: true } }),
    prisma.viewbookSection.findMany({ where: { viewbookId: vb.id } }),
  ])
  if (!client) return null

  const order: readonly string[] = SECTION_KEYS
  const sections: PublicSection[] = sectionRows
    .filter((s) => s.state !== 'hidden')
    .sort((a, b) => order.indexOf(a.sectionKey) - order.indexOf(b.sectionKey))
    .map((s) => ({
      sectionKey: s.sectionKey as PublicSection['sectionKey'],
      state: s.state === 'done' ? 'done' : 'active',
      doneAt: iso(s.doneAt),
      introNote: s.introNote,
      narrative: s.narrative,
    }))

  const [fieldCategories, milestones, materials, global, overrides] = await Promise.all([
    guarded('fields', () => loadFieldCategories(vb.id), [] as PublicFieldCategory[]),
    guarded('milestones', () => loadMilestones(vb.id), [] as PublicMilestone[]),
    guarded('materials', () => loadMaterials(vb.id), [] as PublicMaterialLink[]),
    loadGlobal(), // self-guards PER KEY (Codex plan-fix 2)
    guarded('overrides', () => loadOverrides(vb.id), {} as Partial<Record<GlobalContentKey, string>>),
  ])

  return {
    clientName: client.name,
    kind: vb.kind,
    welcomeNote: vb.welcomeNote,
    dataLockedAt: iso(vb.dataLockedAt),
    theme: parseStoredTheme(vb.themeJson),
    sections,
    fieldCategories,
    milestones,
    materials,
    global,
    overrides,
  }
}

async function loadFieldCategories(viewbookId: number): Promise<PublicFieldCategory[]> {
  const rows = await prisma.viewbookField.findMany({
    where: { viewbookId, archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { amendments: { orderBy: { id: 'asc' } } },
  })
  const catalogOrder: readonly string[] = CATALOG_CATEGORIES
  const byCategory = new Map<string, PublicFieldCategory>()
  const categories = [
    ...catalogOrder.filter((c) => rows.some((r) => r.category === c)),
    ...[...new Set(rows.map((r) => r.category))].filter((c) => !catalogOrder.includes(c)).sort(),
  ]
  for (const category of categories) byCategory.set(category, { category, fields: [] })
  for (const r of rows) {
    byCategory.get(r.category)?.fields.push({
      id: r.id,
      label: r.label,
      fieldType: r.fieldType,
      value: r.value,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      valueUpdatedBy: r.valueUpdatedBy,
      valueUpdatedAt: iso(r.valueUpdatedAt),
      isCustom: r.defKey == null,
      amendments: r.amendments.map((a) => ({
        id: a.id,
        value: a.value,
        author: a.author,
        createdAt: a.createdAt.toISOString(),
      })),
    })
  }
  return [...byCategory.values()].filter((c) => c.fields.length > 0)
}

async function loadMilestones(viewbookId: number): Promise<PublicMilestone[]> {
  const rows = await prisma.viewbookMilestone.findMany({
    where: { viewbookId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      reviewLinks: {
        orderBy: { id: 'asc' },
        include: { feedback: { orderBy: { id: 'asc' } } },
      },
    },
  })
  return rows.map((m) => ({
    id: m.id,
    title: m.title,
    blurb: m.blurb,
    status: m.status,
    targetDate: iso(m.targetDate),
    doneAt: iso(m.doneAt),
    reviewLinks: m.reviewLinks.map((l) => ({
      id: l.id,
      label: l.label,
      url: l.url,
      kind: l.kind,
      feedback: l.feedback.map((f) => ({
        id: f.id,
        body: f.body,
        authorName: f.authorName,
        authorKind: f.authorKind,
        resolvedAt: iso(f.resolvedAt),
        createdAt: f.createdAt.toISOString(),
      })),
    })),
  }))
}

async function loadMaterials(viewbookId: number): Promise<PublicMaterialLink[]> {
  const rows = await prisma.viewbookMaterialLink.findMany({
    where: { viewbookId },
    orderBy: { id: 'asc' },
  })
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    status: r.status,
    url: r.url,
    addedBy: r.addedBy,
    providedAt: iso(r.providedAt),
  }))
}

async function loadGlobal(): Promise<PublicGlobalContent> {
  const out: PublicGlobalContent = { team: null, blocks: {} }
  for (const key of GLOBAL_CONTENT_KEYS) {
    // PER-KEY isolation (Codex plan-fix 2): getGlobalContent reads null on
    // corrupt/absent rows, and a thrown query failure degrades ONLY this key
    // — one bad key must not blank both Welcome and Strategy.
    const value = await guarded(`global-${key}`, () => getGlobalContent(key), null)
    if (key === 'team') out.team = (value as TeamMember[] | null) ?? null
    else out.blocks[key] = (value as ContentBlocks | null) ?? null
  }
  return out
}

async function loadOverrides(viewbookId: number): Promise<Partial<Record<GlobalContentKey, string>>> {
  const rows = await prisma.viewbookContentOverride.findMany({ where: { viewbookId } })
  const known: readonly string[] = GLOBAL_CONTENT_KEYS
  const out: Partial<Record<GlobalContentKey, string>> = {}
  for (const r of rows) {
    if (known.includes(r.contentKey)) out[r.contentKey as GlobalContentKey] = r.body
  }
  return out
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/public-data.test.ts`
Expected: PASS (5 tests). Note: if the `Client.create` data shape in the test doesn't match the schema (check `prisma/schema.prisma` `Client` required fields), fix the test helper, not the loader.

- [ ] **Step 6: Commit**

```bash
git add lib/viewbook/public-types.ts lib/viewbook/public-data.ts lib/viewbook/public-data.test.ts
git commit -m "feat(viewbook): PR2 public payload types + fault-isolated public data loader"
```

---

### Task 2: Middleware matchers (page + assets)

**Files:**
- Modify: `middleware.ts` (inside `isPublicPath`, after the C14 sales block)
- Modify: `middleware.test.ts` (append a describe block)

**Interfaces:**
- Produces: `/viewbook/<token>` and `/api/viewbook/<token>/assets/<filename>` bypass the cookie gate. Nothing else under either prefix is public (PR3/PR4 add their own matchers later).

- [ ] **Step 1: Write the failing tests** — append to `middleware.test.ts`:

```ts
describe('isPublicPath — client viewbook public matchers (PR2)', () => {
  it('public page + token assets matchers are public', () => {
    expect(isPublicPath('/viewbook/3f9c2f4e-aaaa-bbbb-cccc-000000000000')).toBe(true);
    expect(isPublicPath('/api/viewbook/tok/assets/9b0e2c-logo.png')).toBe(true);
  });

  it('shorter/deeper paths and future write routes stay gated', () => {
    expect(isPublicPath('/viewbook')).toBe(false);
    expect(isPublicPath('/viewbook/tok/extra')).toBe(false);
    expect(isPublicPath('/api/viewbook/tok/assets')).toBe(false);
    expect(isPublicPath('/api/viewbook/tok/assets/a/b')).toBe(false);
    // PR3/PR4 routes must NOT be public until their PR ships them
    expect(isPublicPath('/api/viewbook/tok/answers')).toBe(false);
    expect(isPublicPath('/api/viewbook/tok/feedback')).toBe(false);
    expect(isPublicPath('/api/viewbook/tok/materials')).toBe(false);
    // admin API stays cookie-gated
    expect(isPublicPath('/api/viewbooks')).toBe(false);
    expect(isPublicPath('/api/viewbooks/3')).toBe(false);
    expect(isPublicPath('/viewbooks')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run middleware.test.ts`
Expected: FAIL — the two positive assertions return false.

- [ ] **Step 3: Add the matchers** in `middleware.ts`, directly after the C14 sales matchers:

```ts
  // Client viewbook (PR2): public themed page + token-scoped theme assets
  // ONLY. NEVER a '/viewbook/' or '/api/viewbook/' PREFIX — the answers/
  // feedback/materials matchers land only in the PR that ships each route
  // (spec §11), and /viewbooks (admin) stays cookie-gated.
  if (/^\/viewbook\/[^/]+$/.test(pathname)) return true
  if (/^\/api\/viewbook\/[^/]+\/assets\/[^/]+$/.test(pathname)) return true
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run middleware.test.ts`
Expected: PASS (all existing + new).

- [ ] **Step 5: Commit**

```bash
git add middleware.ts middleware.test.ts
git commit -m "feat(viewbook): PR2 anchored public matchers for page + token assets"
```

---

### Task 3: CSP fonts origins

**Files:**
- Modify: `next.config.ts` (the `contentSecurityPolicy` array)
- Test: `next.config.test.ts` (new — Codex plan-fix 7/8)

**Interfaces:**
- Produces: report-only CSP permits Google Fonts stylesheet + font files (spec §6 Codex fix 7 — must land in the same increment as the public page).

- [ ] **Step 1: Write the failing test** (`next.config.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import nextConfig from './next.config'

describe('CSP report-only header (PR2 fonts origins)', () => {
  it('adds both Google Fonts origins and retains the existing directives', async () => {
    const headers = await nextConfig.headers!()
    const csp = headers[0].headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')!.value
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com")
    expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com")
    // Existing directives must survive the edit untouched
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain('connect-src')
  })
})
```

Run: `npx vitest run next.config.test.ts` — expected FAIL (origins missing).

- [ ] **Step 2: Edit the two directives** in `next.config.ts`:

```ts
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // …
  "font-src 'self' data: https://fonts.gstatic.com",
```

(Replace the existing `style-src` and `font-src` lines; leave every other directive untouched. Add one comment line above `style-src`: `// fonts.googleapis.com / fonts.gstatic.com: public viewbook Google Fonts (spec §6)`.)

- [ ] **Step 3: Verify + commit**

Run: `npx vitest run next.config.test.ts` — expected PASS. `npx tsc --noEmit` — expected clean.

```bash
git add next.config.ts next.config.test.ts
git commit -m "feat(viewbook): PR2 CSP report-only fonts origins for the public page"
```

---

### Task 4: Token assets route (curation + HTTP serving)

**Files:**
- Create: `app/api/viewbook/[token]/assets/[filename]/route.ts`
- Test: `app/api/viewbook/[token]/assets/assets-route.test.ts`

**Interfaces:**
- Consumes: `requireViewbookToken`, `readViewbookAsset(scope, filename)`, `parseStoredTheme`, `getGlobalContent('team')`.
- Produces: `GET /api/viewbook/[token]/assets/[filename]` → image bytes or indistinguishable 404. Allowlist = the token's own themeJson filenames (scope `String(vb.id)`) ∪ global team-roster photo filenames (scope `'global'`).

- [ ] **Step 1: Write the failing test** (`app/api/viewbook/[token]/assets/assets-route.test.ts`, follow the `app/api/sales/[token]/hero/hero-route.test.ts` DB-backed route pattern):

```ts
import crypto from 'crypto'
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { createViewbook } from '@/lib/viewbook/service'
import { GET } from './[filename]/route'

// 1x1 PNG (magic bytes are all the route cares about — files are read raw)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

let assetsDir: string

function call(token: string, filename: string) {
  const req = new NextRequest(`http://localhost/api/viewbook/${token}/assets/${filename}`)
  return GET(req, { params: Promise.resolve({ token, filename }) })
}

beforeAll(async () => {
  assetsDir = await mkdtemp(path.join(tmpdir(), 'vb-assets-'))
  vi.stubEnv('VIEWBOOK_ASSETS_DIR', assetsDir)
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await rm(assetsDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await prisma.viewbook.deleteMany()
  await prisma.viewbookGlobalContent.deleteMany()
  await prisma.client.deleteMany()
})

async function seedViewbookWithLogo() {
  const client = await prisma.client.create({ data: { name: `vb-assets-${crypto.randomUUID()}` } })
  const { id, token } = await createViewbook(client.id, 'upgrade', 'kevin@er.com')
  const logo = `${crypto.randomUUID()}.png` // unique per seed — the cross-token test depends on it
  await mkdir(path.join(assetsDir, String(id)), { recursive: true })
  await writeFile(path.join(assetsDir, String(id), logo), PNG)
  const theme = {
    primary: '#122033', secondary: '#1D7F7F', tertiary: '#C99334',
    headingFont: 'inter', bodyFont: 'inter', logo, sectionHeroes: {},
  }
  await prisma.viewbook.update({ where: { id }, data: { themeJson: JSON.stringify(theme) } })
  return { id, token, logo, clientId: client.id }
}

describe('GET /api/viewbook/[token]/assets/[filename]', () => {
  it('serves an allowlisted theme asset with mime + nosniff', async () => {
    const { token, logo } = await seedViewbookWithLogo()
    const res = await call(token, logo)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600')
  })

  it('404s a file that exists on disk but is NOT in the themeJson allowlist', async () => {
    const { id, token } = await seedViewbookWithLogo()
    const stray = 'bbbbbbbb-1111-2222-3333-444444444444.png'
    await writeFile(path.join(assetsDir, String(id), stray), PNG)
    const res = await call(token, stray)
    expect(res.status).toBe(404)
  })

  it('404s traversal shapes, unknown tokens, and revoked viewbooks identically', async () => {
    const { id, token, logo } = await seedViewbookWithLogo()
    expect((await call(token, '..%2F' + String(id) + '%2F' + logo)).status).toBe(404)
    expect((await call(token, 'no-such.png')).status).toBe(404)
    expect((await call('unknown-token', logo)).status).toBe(404)
    await prisma.viewbook.update({ where: { id }, data: { revokedAt: new Date() } })
    expect((await call(token, logo)).status).toBe(404)
  })

  it('serves a global team photo via the roster allowlist', async () => {
    const { token } = await seedViewbookWithLogo()
    const photo = 'cccccccc-1111-2222-3333-444444444444.png'
    await mkdir(path.join(assetsDir, 'global'), { recursive: true })
    await writeFile(path.join(assetsDir, 'global', photo), PNG)
    await prisma.viewbookGlobalContent.create({
      data: {
        key: 'team',
        bodyJson: JSON.stringify([{ name: 'Kev', role: 'SEO', photo, blurb: '' }]),
        updatedBy: 'kevin@er.com',
      },
    })
    const res = await call(token, photo)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
  })

  it('404s a roster-shaped filename when the roster does not contain it', async () => {
    const { token } = await seedViewbookWithLogo()
    const res = await call(token, 'dddddddd-1111-2222-3333-444444444444.png')
    expect(res.status).toBe(404)
  })

  it("404s token A requesting a file allowlisted only on token B's viewbook (Codex plan-fix 8)", async () => {
    const a = await seedViewbookWithLogo()
    const b = await seedViewbookWithLogo()
    // b.logo exists on disk under b's scope and is allowlisted on b — but the
    // request rides token A: cross-token curation must 404.
    const res = await call(a.token, b.logo)
    expect(res.status).toBe(404)
  })

  it('404s an allowlisted asset once the client is archived (Codex plan-fix 8)', async () => {
    const { token, logo, clientId } = await seedViewbookWithLogo()
    await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } })
    const res = await call(token, logo)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/viewbook/[token]/assets/assets-route.test.ts"`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write the route** (`app/api/viewbook/[token]/assets/[filename]/route.ts`):

```ts
// Public token-gated theme-asset serving (spec §6/§7). Authorization is an
// ALLOWLIST, C14 curated-set precedent: the token's own themeJson filenames
// (viewbook scope) or the global team-roster photo set (global scope). A
// guessed filename under an owned viewbook still 404s. Every failure — bad
// token, revoked, archived client, non-allowlisted name, traversal shape,
// missing file — is the SAME 404 (no oracle). Non-ENOENT fs errors rethrow
// into withRoute as 500 (operational visibility, C14 hero precedent).
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { readViewbookAsset } from '@/lib/viewbook/assets'
import { parseStoredTheme } from '@/lib/viewbook/theme'
import { getGlobalContent } from '@/lib/viewbook/global-content'

export const GET = withRoute(
  async (_request: NextRequest, { params }: { params: Promise<{ token: string; filename: string }> }) => {
    const { token, filename } = await params
    const notFoundRes = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

    // Throws HttpError(404) on invalid/revoked/archived — withRoute maps it.
    const vb = await requireViewbookToken(token)

    const theme = parseStoredTheme(vb.themeJson)
    const themeFiles = new Set(
      [theme.logo, ...Object.values(theme.sectionHeroes)].filter((f): f is string => f != null),
    )

    let asset: { buf: Buffer; mime: string } | null = null
    if (themeFiles.has(filename)) {
      asset = await readViewbookAsset(String(vb.id), filename)
    } else {
      const roster = await getGlobalContent('team')
      const photos = new Set(
        (Array.isArray(roster) ? roster : []).map((m) => m.photo).filter((p): p is string => p != null),
      )
      if (photos.has(filename)) asset = await readViewbookAsset('global', filename)
    }
    if (!asset) return notFoundRes()

    return new Response(new Uint8Array(asset.buf), {
      headers: {
        'Content-Type': asset.mime,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  },
)
```

- [ ] **Step 4: Run to verify pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/viewbook/[token]/assets/assets-route.test.ts"`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/api/viewbook/[token]/assets/"
git commit -m "feat(viewbook): PR2 public token assets route — themeJson + roster allowlists, nosniff, indistinguishable 404s"
```

---

### Task 5: Theming core — ThemeStyle, SectionShell, ProgressNav, ViewbookShell

**Files:**
- Create: `components/viewbook/public/ThemeStyle.tsx`
- Create: `components/viewbook/public/SectionShell.tsx`
- Create: `components/viewbook/public/ProgressNav.tsx`
- Create: `components/viewbook/public/ViewbookShell.tsx`
- Test: `components/viewbook/public/ThemeStyle.test.tsx`, `components/viewbook/public/SectionShell.test.tsx`

All four are presentational, NO `'use client'`, no server imports — importable by both the server page and the client `ThemePreview` (Task 8). PR5 later modifies `SectionShell.tsx` (done-animation + hero polish); keep its props surface stable.

**Interfaces:**
- Produces:
  - `fontsHref(theme): string`, `themeCssVars(theme): CSSProperties`, `ThemeStyle({theme})` (Google Fonts `<link>` tags only).
  - `publicAssetUrl(token: string, filename: string): string`.
  - `SectionShell({ section, title, heroUrl, children })` — `section: PublicSection`; `done` → collapsed `<details>`; anchor `id={sectionKey}`.
  - `ProgressNav({ clientName, logoUrl, sections })` — sticky dots nav (pure anchors).
  - `ViewbookShell({ token, data, sectionContent })` — wrapper: css vars + ThemeStyle + ProgressNav + ordered sections via the `sectionContent` render map.

- [ ] **Step 1: Write failing tests**

`components/viewbook/public/ThemeStyle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import { ThemeStyle, fontsHref, themeCssVars } from './ThemeStyle'

afterEach(cleanup)

describe('fontsHref', () => {
  it('builds the href from catalog values only and dedupes same heading/body font', () => {
    expect(fontsHref(DEFAULT_THEME)).toBe(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap',
    )
  })
  it('joins two distinct fonts', () => {
    const href = fontsHref({ ...DEFAULT_THEME, headingFont: 'oswald', bodyFont: 'lora' })
    expect(href).toContain('family=Oswald')
    expect(href).toContain('family=Lora')
  })
  it('falls back to the default catalog entry for an unknown key (defensive)', () => {
    const href = fontsHref({ ...DEFAULT_THEME, headingFont: 'nope', bodyFont: 'nope' })
    expect(href).toContain('family=Inter')
  })
})

describe('themeCssVars', () => {
  it('derives readable on-primary text', () => {
    const dark = themeCssVars({ ...DEFAULT_THEME, primary: '#111111' }) as Record<string, string>
    expect(dark['--vb-on-primary']).toBe('#ffffff')
    const light = themeCssVars({ ...DEFAULT_THEME, primary: '#ffffff' }) as Record<string, string>
    expect(light['--vb-on-primary']).toBe('#111111')
  })
})

describe('ThemeStyle', () => {
  it('renders exactly one stylesheet link', () => {
    const { container } = render(<ThemeStyle theme={DEFAULT_THEME} />)
    expect(container.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1)
  })
})
```

`components/viewbook/public/SectionShell.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { SectionShell } from './SectionShell'
import type { PublicSection } from '@/lib/viewbook/public-types'

afterEach(cleanup)

const section = (over: Partial<PublicSection> = {}): PublicSection => ({
  sectionKey: 'brand',
  state: 'active',
  doneAt: null,
  introNote: null,
  narrative: null,
  ...over,
})

describe('SectionShell', () => {
  it('renders an active section open with its anchor id and intro note', () => {
    render(
      <SectionShell section={section({ introNote: 'A note' })} title="Brand Guidelines" heroUrl={null}>
        <p>Body</p>
      </SectionShell>,
    )
    expect(document.getElementById('brand')).not.toBeNull()
    expect(screen.getByText('A note')).toBeDefined()
    expect(screen.getByText('Body')).toBeDefined()
  })

  it('renders a done section as a collapsed details with the completion date, body retained', () => {
    render(
      <SectionShell
        section={section({ state: 'done', doneAt: '2026-07-01T00:00:00.000Z' })}
        title="Brand Guidelines"
        heroUrl={null}
      >
        <p>Body</p>
      </SectionShell>,
    )
    const details = document.querySelector('details')
    expect(details).not.toBeNull()
    expect(details!.open).toBe(false)
    expect(screen.getByText(/Completed/)).toBeDefined()
    expect(screen.getByText('Body')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run components/viewbook/public/`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four components**

`components/viewbook/public/ThemeStyle.tsx`:

```tsx
// Client-safe theming primitives for the public viewbook. The Google Fonts
// href is built ONLY from FONT_CATALOG values (themes store catalog KEYS —
// client input never reaches the URL, spec §6). Colors were regex-validated
// by parseStoredTheme; they are applied as React inline-style CSS custom
// properties on the shell wrapper (no <style> injection surface at all).
import type { CSSProperties } from 'react'
import { DEFAULT_THEME, FONT_CATALOG, onThemeColorText, type ViewbookTheme } from '@/lib/viewbook/theme'

const FALLBACK = FONT_CATALOG[DEFAULT_THEME.headingFont]

export function fontsHref(theme: ViewbookTheme): string {
  const queries = [
    ...new Set(
      [theme.headingFont, theme.bodyFont].map((k) => (FONT_CATALOG[k] ?? FALLBACK).gfQuery),
    ),
  ]
  return `https://fonts.googleapis.com/css2?${queries.join('&')}&display=swap`
}

export function fontFamily(key: string): string {
  return `'${(FONT_CATALOG[key] ?? FALLBACK).family}', sans-serif`
}

// `--vb-*` is the CANONICAL variable namespace (Codex plan-fix 4): PR4's
// integration phase renames its leaves' `--viewbook-primary` references to
// `--vb-primary`; PR3/PR5 components use these names as-is.
export function themeCssVars(theme: ViewbookTheme): CSSProperties {
  return {
    '--vb-primary': theme.primary,
    '--vb-secondary': theme.secondary,
    '--vb-tertiary': theme.tertiary,
    '--vb-on-primary': onThemeColorText(theme.primary),
    '--vb-on-secondary': onThemeColorText(theme.secondary),
    '--vb-on-tertiary': onThemeColorText(theme.tertiary),
    '--vb-heading-font': fontFamily(theme.headingFont),
    '--vb-body-font': fontFamily(theme.bodyFont),
  } as CSSProperties
}

export function publicAssetUrl(token: string, filename: string): string {
  return `/api/viewbook/${encodeURIComponent(token)}/assets/${encodeURIComponent(filename)}`
}

export function ThemeStyle({ theme }: { theme: ViewbookTheme }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={fontsHref(theme)} />
    </>
  )
}
```

`components/viewbook/public/SectionShell.tsx`:

```tsx
// One shared section frame (spec §8): FULL-VIEWPORT spread — bold header band
// in the brand primary (heading font, derived on-primary text, optional hero
// image), anchor id for the ProgressNav, operator intro note, and an optional
// CEO-skimmable SUMMARY band (one line + big number/status) above the detail
// (Codex plan-fix 5 — the summary prop is the stable API sections and PR5
// build on). 'done' collapses to a celebratory slim <details> header — data
// always retained. PR5 owns the polish pass (animation, richer hero
// rendering) — keep this props surface stable.
import type { ReactNode } from 'react'
import type { PublicSection } from '@/lib/viewbook/public-types'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

export function SectionShell({
  section,
  title,
  heroUrl,
  summary,
  children,
}: {
  section: PublicSection
  title: string
  heroUrl: string | null
  summary?: ReactNode
  children: ReactNode
}) {
  if (section.state === 'done') {
    return (
      <section id={section.sectionKey} className="mx-auto w-full max-w-5xl px-6 py-4">
        <details className="rounded-xl border border-black/10 bg-white shadow-sm">
          <summary className="flex cursor-pointer items-center gap-3 px-5 py-4">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
              style={{ background: 'var(--vb-secondary)', color: 'var(--vb-on-secondary)' }}
            >
              ✓
            </span>
            <span className="text-lg font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
              {title}
            </span>
            {section.doneAt && (
              <span className="ml-auto text-sm text-black/50">Completed {fmtDate(section.doneAt)}</span>
            )}
          </summary>
          <div className="space-y-6 px-5 pb-6">{children}</div>
        </details>
      </section>
    )
  }

  return (
    <section id={section.sectionKey} className="flex min-h-screen w-full flex-col">
      <div
        className="relative flex min-h-[30vh] items-end overflow-hidden"
        style={{ background: 'var(--vb-primary)' }}
      >
        {heroUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        )}
        <h2
          className="relative mx-auto w-full max-w-5xl px-6 pb-6 text-3xl font-extrabold tracking-tight sm:text-5xl"
          style={{ color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}
        >
          {title}
        </h2>
      </div>
      {summary && (
        <div
          className="border-b border-black/10"
          style={{ background: 'color-mix(in srgb, var(--vb-secondary) 10%, white)' }}
        >
          <div className="mx-auto w-full max-w-5xl px-6 py-5 text-lg">{summary}</div>
        </div>
      )}
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-10">
        {section.introNote && (
          <p className="border-l-4 pl-4 text-lg text-black/70" style={{ borderColor: 'var(--vb-tertiary)' }}>
            {section.introNote}
          </p>
        )}
        {children}
      </div>
    </section>
  )
}
```

`components/viewbook/public/ProgressNav.tsx`:

```tsx
// Slim sticky progress nav (spec §8): client logo + one anchor dot per
// visible section. Pure anchors — no client JS.
import type { PublicSection } from '@/lib/viewbook/public-types'
import { SECTION_TITLES } from './section-titles'

export function ProgressNav({
  clientName,
  logoUrl,
  sections,
}: {
  clientName: string
  logoUrl: string | null
  sections: PublicSection[]
}) {
  return (
    <nav
      aria-label="Sections"
      className="sticky top-0 z-40 border-b border-black/10 backdrop-blur"
      style={{ background: 'color-mix(in srgb, var(--vb-primary) 92%, transparent)' }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-2">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={clientName} className="h-8 w-auto" />
        ) : (
          <span
            className="text-sm font-bold"
            style={{ color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}
          >
            {clientName}
          </span>
        )}
        <ul className="ml-auto flex items-center gap-3">
          {sections.map((s) => (
            <li key={s.sectionKey}>
              <a
                href={`#${s.sectionKey}`}
                title={SECTION_TITLES[s.sectionKey]}
                className="block h-2.5 w-2.5 rounded-full transition-transform hover:scale-125"
                style={{
                  background: s.state === 'done' ? 'var(--vb-tertiary)' : 'var(--vb-on-primary)',
                  opacity: s.state === 'done' ? 1 : 0.7,
                }}
              >
                <span className="sr-only">{SECTION_TITLES[s.sectionKey]}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}
```

Also create the tiny shared title map `components/viewbook/public/section-titles.ts` (client-safe, used by nav + shell callers):

```ts
import type { SectionKey } from '@/lib/viewbook/theme'

export const SECTION_TITLES: Record<SectionKey, string> = {
  welcome: 'Welcome & Team',
  milestones: 'Process & Milestones',
  'data-source': 'Data Source',
  brand: 'Brand Guidelines',
  assessment: 'Current-Site Assessment',
  strategy: 'SEO, GEO & E-E-A-T Strategy',
  materials: 'Materials & Links',
}
```

`components/viewbook/public/ViewbookShell.tsx`:

```tsx
// The themed page frame: CSS-variable scope (inline styles — values validated
// by parseStoredTheme), Google Fonts link, sticky ProgressNav, then the
// visible sections in fixed order via the caller's render map. The public
// page does NOT participate in app dark mode (spec §6) — colors here are
// explicit, never `dark:` variants.
import type { ReactNode } from 'react'
import type { SectionKey } from '@/lib/viewbook/theme'
import type { ViewbookPublicData } from '@/lib/viewbook/public-types'
import { ProgressNav } from './ProgressNav'
import { ThemeStyle, publicAssetUrl, themeCssVars } from './ThemeStyle'

export function ViewbookShell({
  token,
  data,
  sectionContent,
}: {
  token: string
  data: ViewbookPublicData
  sectionContent: (sectionKey: SectionKey) => ReactNode
}) {
  const logoUrl = data.theme.logo ? publicAssetUrl(token, data.theme.logo) : null
  return (
    <div className="min-h-screen bg-[#fafafa] text-[#1a1a1a]" style={themeCssVars(data.theme)}>
      <ThemeStyle theme={data.theme} />
      {/* The (public) layout already renders the page's <main> — no nested
          main here; exactly ONE h1 on the page (Codex plan-fix 5). */}
      <h1 className="sr-only">{data.clientName} — Viewbook</h1>
      <ProgressNav clientName={data.clientName} logoUrl={logoUrl} sections={data.sections} />
      <div style={{ fontFamily: 'var(--vb-body-font)' }}>
        {data.sections.map((s) => (
          <div key={s.sectionKey}>{sectionContent(s.sectionKey)}</div>
        ))}
      </div>
      <footer className="px-6 py-10 text-center text-sm text-black/40">
        Prepared for {data.clientName} by Enrollment Resources
      </footer>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run components/viewbook/public/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/
git commit -m "feat(viewbook): PR2 theming core — ThemeStyle, SectionShell, ProgressNav, ViewbookShell"
```

---

### Task 6: Simple read-only sections — Welcome, Brand, Strategy, Materials, AssessmentPlaceholder

**Files:**
- Create: `components/viewbook/public/WelcomeSection.tsx`
- Create: `components/viewbook/public/BrandSection.tsx`
- Create: `components/viewbook/public/StrategySection.tsx`
- Create: `components/viewbook/public/MaterialsSection.tsx`
- Create: `components/viewbook/public/AssessmentPlaceholder.tsx`
- Test: `components/viewbook/public/sections-read.test.tsx`

**Interfaces:**
- Consumes: Task 1 payload types, Task 5 `SectionShell`/`publicAssetUrl`/`fontFamily`.
- Produces: each exports one component taking `{ section, data, token }` (Materials additionally stays PR4-mount-friendly: the list markup is self-contained; PR4 appends `MaterialLinkForm` inside the same shell).

- [ ] **Step 1: Write the failing test** (`components/viewbook/public/sections-read.test.tsx`):

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { WelcomeSection } from './WelcomeSection'
import { BrandSection } from './BrandSection'
import { StrategySection } from './StrategySection'
import { MaterialsSection } from './MaterialsSection'

afterEach(cleanup)

const sec = (sectionKey: PublicSection['sectionKey'], over: Partial<PublicSection> = {}): PublicSection => ({
  sectionKey,
  state: 'active',
  doneAt: null,
  introNote: null,
  narrative: null,
  ...over,
})

const base = (over: Partial<ViewbookPublicData> = {}): ViewbookPublicData => ({
  clientName: 'Acme College',
  kind: 'upgrade',
  welcomeNote: null,
  dataLockedAt: null,
  theme: DEFAULT_THEME,
  sections: [],
  fieldCategories: [],
  milestones: [],
  materials: [],
  global: { team: null, blocks: {} },
  overrides: {},
  ...over,
})

describe('WelcomeSection', () => {
  it('renders welcome note, team roster, and degrades to a placeholder without global content', () => {
    const data = base({
      welcomeNote: 'Hi Acme!',
      global: {
        team: [{ name: 'Kev', role: 'SEO Lead', photo: null, blurb: 'Does SEO' }],
        blocks: { why: { blocks: [{ heading: 'Why', body: 'Because.' }] } },
      },
    })
    render(<WelcomeSection section={sec('welcome')} data={data} token="tok" />)
    expect(screen.getByText('Hi Acme!')).toBeDefined()
    expect(screen.getByText('Kev')).toBeDefined()
    expect(screen.getByText('Because.')).toBeDefined()

    cleanup()
    render(<WelcomeSection section={sec('welcome')} data={base()} token="tok" />)
    expect(screen.getByText(/couldn.t load|coming soon/i)).toBeDefined()
  })
})

describe('BrandSection', () => {
  it('renders the three swatches with hex labels and the narrative prose', () => {
    render(
      <BrandSection section={sec('brand', { narrative: 'Bold and warm.' })} data={base()} token="tok" />,
    )
    expect(screen.getByText('#122033')).toBeDefined()
    expect(screen.getByText('Bold and warm.')).toBeDefined()
  })
})

describe('StrategySection', () => {
  it('renders base blocks and visually-distinct override blocks', () => {
    const data = base({
      global: {
        team: null,
        blocks: { 'seo-base': { blocks: [{ heading: 'Playbook', body: 'Do SEO well.' }] } },
      },
      overrides: { 'seo-base': 'Your custom plan.' },
    })
    render(<StrategySection section={sec('strategy')} data={data} token="tok" />)
    expect(screen.getByText('Do SEO well.')).toBeDefined()
    expect(screen.getByText('Your custom plan.')).toBeDefined()
    expect(screen.getByText(/your plan/i)).toBeDefined()
  })
})

describe('MaterialsSection', () => {
  it('renders provided links with noopener and requested placeholders without an anchor', () => {
    const data = base({
      materials: [
        { id: 1, label: 'Brand book', status: 'provided', url: 'https://x.com/b', addedBy: 'client', providedAt: '2026-07-01T00:00:00.000Z' },
        { id: 2, label: 'Logo files', status: 'requested', url: null, addedBy: 'kevin@er.com', providedAt: null },
      ],
    })
    render(<MaterialsSection section={sec('materials')} data={data} token="tok" />)
    const a = screen.getByRole('link', { name: /brand book/i })
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(screen.getByText('Logo files')).toBeDefined()
    expect(screen.queryByRole('link', { name: /logo files/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run components/viewbook/public/sections-read.test.tsx` → module-not-found FAIL.

- [ ] **Step 3: Implement the five components**

Shared conventions: every component signature is
`({ section, data, token }: { section: PublicSection; data: ViewbookPublicData; token: string })`;
each resolves its own `heroUrl = data.theme.sectionHeroes[section.sectionKey] ? publicAssetUrl(token, data.theme.sectionHeroes[section.sectionKey]!) : null` and wraps content in `<SectionShell section={section} title={SECTION_TITLES[section.sectionKey]} heroUrl={heroUrl}>`. Attribution display rule: `addedBy === 'client' ? 'you' : 'our team'` (never render operator emails to clients).

`WelcomeSection.tsx`:

```tsx
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'

function Placeholder({ what }: { what: string }) {
  return <p className="text-black/50">{what} is coming soon.</p>
}

export function WelcomeSection({ section, data, token }: { section: PublicSection; data: ViewbookPublicData; token: string }) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  const { team, blocks } = data.global
  return (
    <SectionShell section={section} title={SECTION_TITLES[section.sectionKey]} heroUrl={hero ? publicAssetUrl(token, hero) : null}>
      {data.welcomeNote && <p className="text-xl">{data.welcomeNote}</p>}

      {blocks.why?.blocks?.length ? (
        blocks.why.blocks.map((b, i) => (
          <div key={i}>
            {b.heading && (
              <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>{b.heading}</h3>
            )}
            <p className="mt-1 whitespace-pre-line text-black/80">{b.body}</p>
          </div>
        ))
      ) : (
        <Placeholder what="Our story" />
      )}

      <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>Your team</h3>
      {team?.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {team.map((m) => (
            <div key={m.name} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
              {m.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={publicAssetUrl(token, m.photo)} alt={m.name} className="mb-3 h-20 w-20 rounded-full object-cover" />
              )}
              <p className="font-bold">{m.name}</p>
              <p className="text-sm" style={{ color: 'var(--vb-secondary)' }}>{m.role}</p>
              {m.blurb && <p className="mt-2 text-sm text-black/70">{m.blurb}</p>}
            </div>
          ))}
        </div>
      ) : (
        <Placeholder what="Meet-the-team" />
      )}

      {blocks.process?.blocks?.length ? (
        blocks.process.blocks.map((b, i) => (
          <div key={i}>
            {b.heading && (
              <h3 className="text-xl font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>{b.heading}</h3>
            )}
            <p className="mt-1 whitespace-pre-line text-black/80">{b.body}</p>
          </div>
        ))
      ) : null}
    </SectionShell>
  )
}
```

`BrandSection.tsx` — palette swatches from `data.theme` (`primary`/`secondary`/`tertiary`, each a large rounded block with the hex code caption), live typography specimens (`<p style={{fontFamily: 'var(--vb-heading-font)'}}>` "Aa Bb Cc — {FONT_CATALOG family name}" at display size, same for body font), then `section.narrative` as `whitespace-pre-line` prose when present. Import `FONT_CATALOG` from `@/lib/viewbook/theme` for the family display names.

`StrategySection.tsx` — for each of `['seo-base','geo-base','eeat-base'] as const`: render the global `ContentBlocks` under an "Our playbook" heading style; then, when `data.overrides[key]` exists, render it in a visually distinct card (left border `var(--vb-tertiary)`, badge text "Your plan") as `whitespace-pre-line`. If all three blocks are null and no overrides exist, render one placeholder paragraph.

`MaterialsSection.tsx`:

```tsx
import type { PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

export function MaterialsSection({ section, data, token }: { section: PublicSection; data: ViewbookPublicData; token: string }) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  return (
    <SectionShell section={section} title={SECTION_TITLES[section.sectionKey]} heroUrl={hero ? publicAssetUrl(token, hero) : null}>
      {data.materials.length === 0 ? (
        <p className="text-black/50">No materials yet — links you share with us will appear here.</p>
      ) : (
        <ul className="divide-y divide-black/10 rounded-xl border border-black/10 bg-white shadow-sm">
          {data.materials.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
              {m.status === 'provided' && m.url ? (
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="font-medium underline" style={{ color: 'var(--vb-secondary)' }}>
                  {m.label}
                </a>
              ) : (
                <span className="font-medium text-black/70">{m.label}</span>
              )}
              {m.status === 'requested' && (
                <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'var(--vb-tertiary)', color: 'var(--vb-on-tertiary)' }}>
                  requested — add a link
                </span>
              )}
              <span className="ml-auto text-xs text-black/40">
                {m.addedBy === 'client' ? 'added by you' : 'added by our team'}
                {m.providedAt ? ` · ${fmtDate(m.providedAt)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* PR4 integration mounts MaterialLinkForm here (client add-a-link). */}
    </SectionShell>
  )
}
```

`AssessmentPlaceholder.tsx` — SectionShell-wrapped static state: "Your first site scan is coming soon — we'll publish your current-site assessment here." (PR5 swaps this for `AssessmentSection` at the page mount point; keep the same props signature so the swap is one import change.)

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/viewbook/public/sections-read.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/
git commit -m "feat(viewbook): PR2 read-only sections — welcome, brand, strategy, materials, assessment placeholder"
```

---

### Task 7: Data-heavy sections — MilestonesSection + DataSourceSection

**Files:**
- Create: `components/viewbook/public/MilestonesSection.tsx`
- Create: `components/viewbook/public/DataSourceSection.tsx`
- Test: `components/viewbook/public/sections-data.test.tsx`

**Interfaces:**
- Consumes: Task 1 types, Task 5 shell.
- Produces: same `{ section, data, token }` signature. `MilestonesSection` renders review-link cards (PR4 mounts `FeedbackThread` under each card later — keep each card's markup a self-contained block). `DataSourceSection` is read-only (PR3 adds interactivity and OWNS the file after PR2 merges — no editing affordances now).

- [ ] **Step 1: Write the failing test** (`components/viewbook/public/sections-data.test.tsx`):

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_THEME } from '@/lib/viewbook/theme'
import type { PublicMilestone, PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { MilestonesSection } from './MilestonesSection'
import { DataSourceSection } from './DataSourceSection'

afterEach(cleanup)

const sec = (sectionKey: PublicSection['sectionKey']): PublicSection => ({
  sectionKey, state: 'active', doneAt: null, introNote: null, narrative: null,
})

const base = (over: Partial<ViewbookPublicData> = {}): ViewbookPublicData => ({
  clientName: 'Acme', kind: 'upgrade', welcomeNote: null, dataLockedAt: null,
  theme: DEFAULT_THEME, sections: [], fieldCategories: [], milestones: [],
  materials: [], global: { team: null, blocks: {} }, overrides: {}, ...over,
})

const milestone = (over: Partial<PublicMilestone> = {}): PublicMilestone => ({
  id: 1, title: 'Design', blurb: 'Designs take shape.', status: 'upcoming',
  targetDate: null, doneAt: null, reviewLinks: [], ...over,
})

describe('MilestonesSection', () => {
  it('spotlights the current stage and renders review links with noopener', () => {
    const data = base({
      milestones: [
        milestone({ id: 1, title: 'Kickoff', status: 'done', doneAt: '2026-06-01T00:00:00.000Z' }),
        milestone({
          id: 2, title: 'Design', status: 'current',
          reviewLinks: [{ id: 9, label: 'Homepage mockup', url: 'https://x.com/m', kind: 'mockup', feedback: [] }],
        }),
        milestone({ id: 3, title: 'Build', status: 'upcoming', targetDate: '2026-08-01T00:00:00.000Z' }),
      ],
    })
    render(<MilestonesSection section={sec('milestones')} data={data} token="tok" />)
    expect(screen.getByText('Current stage')).toBeDefined()
    const a = screen.getByRole('link', { name: /homepage mockup/i })
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.queryByText(/reviews will appear here/i)).toBeNull() // links exist → no empty state
  })

  it('renders the empty state when NO milestone has review links (separate fixture — Codex plan-fix 8)', () => {
    const data = base({
      milestones: [milestone({ id: 1, title: 'Kickoff', status: 'current' })],
    })
    render(<MilestonesSection section={sec('milestones')} data={data} token="tok" />)
    expect(screen.getByText(/reviews will appear here/i)).toBeDefined()
  })
})

describe('DataSourceSection', () => {
  it('groups by category with display labels, renders values/stamps/amendments, and a locked banner', () => {
    const data = base({
      dataLockedAt: '2026-07-10T00:00:00.000Z',
      fieldCategories: [
        {
          category: 'school',
          fields: [
            {
              id: 1, label: 'School name', fieldType: 'text', value: 'Pro Way',
              version: 1, createdAt: '2026-06-01T00:00:00.000Z',
              valueUpdatedBy: 'client', valueUpdatedAt: '2026-07-01T00:00:00.000Z', isCustom: false,
              amendments: [{ id: 1, value: 'Pro Way Hair School', author: 'client', createdAt: '2026-07-11T00:00:00.000Z' }],
            },
            {
              id: 2, label: 'Services in your subscription', fieldType: 'list',
              value: '["SEO","ADA"]', version: 0, createdAt: '2026-06-01T00:00:00.000Z',
              valueUpdatedBy: null, valueUpdatedAt: null, isCustom: false, amendments: [],
            },
          ],
        },
      ],
    })
    render(<DataSourceSection section={sec('data-source')} data={data} token="tok" />)
    expect(screen.getByText('Your school')).toBeDefined()
    expect(screen.getByText('Pro Way')).toBeDefined()
    expect(screen.getByText(/updated by you/i)).toBeDefined()
    expect(screen.getByText('SEO')).toBeDefined() // list value parsed to items
    expect(screen.getByText('ADA')).toBeDefined()
    expect(screen.getByText(/locked/i)).toBeDefined()
    expect(screen.getByText('Pro Way Hair School')).toBeDefined()
    expect(screen.getByText(/changed on/i)).toBeDefined()
  })

  it('renders a malformed list value as plain text (never crashes)', () => {
    const data = base({
      fieldCategories: [{
        category: 'school',
        fields: [{
          id: 1, label: 'Services in your subscription', fieldType: 'list', value: 'not-json[',
          version: 0, createdAt: '2026-06-01T00:00:00.000Z',
          valueUpdatedBy: null, valueUpdatedAt: null, isCustom: false, amendments: [],
        }],
      }],
    })
    render(<DataSourceSection section={sec('data-source')} data={data} token="tok" />)
    expect(screen.getByText('not-json[')).toBeDefined()
  })

  it('renders user-controlled markup as TEXT, never as elements (Codex plan-fix 8)', () => {
    const data = base({
      fieldCategories: [{
        category: 'school',
        fields: [{
          id: 1, label: 'School name', fieldType: 'text',
          value: '<script>window.__pwned = true</script><img src=x onerror=alert(1)>',
          version: 0, createdAt: '2026-06-01T00:00:00.000Z',
          valueUpdatedBy: null, valueUpdatedAt: null, isCustom: false, amendments: [],
        }],
      }],
    })
    const { container } = render(<DataSourceSection section={sec('data-source')} data={data} token="tok" />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
    expect(screen.getByText(/<script>/)).toBeDefined() // visible as literal text
  })
})
```

- [ ] **Step 2: Run to verify failure** — module-not-found FAIL.

- [ ] **Step 3: Implement**

`MilestonesSection.tsx` — horizontal timeline on wide screens (`overflow-x-auto` flex row of stage cards), stacked on mobile. Per milestone card: status dot (`done` → `var(--vb-tertiary)` check, `current` → filled `var(--vb-secondary)` ring + a "Current stage" chip, `upcoming` → outline), title (heading font), blurb, `targetDate` line when set ("Target: {date}"), `doneAt` line when done. Under the timeline, one subsection per milestone that HAS review links: heading "{title} — reviews", each link a card with kind badge (`mockup`/`live`), `<a target="_blank" rel="noopener noreferrer">` on the label, and (read-only in PR2) resolved feedback count line when `feedback.length > 0` ("N comments"). After the timeline, if NO milestone has review links render the empty state: `"Reviews will appear here at each touchpoint."` — the test asserts on this copy (`/reviews will appear here/i`). Each review-link card ends with a `{/* PR4 mounts FeedbackThread here */}` comment.

`DataSourceSection.tsx`:

```tsx
import type { PublicField, PublicSection, ViewbookPublicData } from '@/lib/viewbook/public-types'
import { SectionShell } from './SectionShell'
import { SECTION_TITLES } from './section-titles'
import { publicAssetUrl } from './ThemeStyle'

const CATEGORY_LABELS: Record<string, string> = {
  school: 'Your school',
  programs: 'Programs',
  'team-access': 'Team & access',
  'crm-leads': 'CRM & leads',
  admissions: 'Admissions',
  positioning: 'Positioning',
  'student-experience': 'Student experience',
  'brand-materials': 'Brand & materials',
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

function who(author: string | null): string {
  return author === 'client' ? 'you' : 'our team'
}

function ListValue({ value }: { value: string }) {
  let items: string[] | null = null
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) items = parsed
  } catch {
    items = null
  }
  if (!items) return <p className="whitespace-pre-line">{value}</p>
  return (
    <ul className="list-disc pl-5">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  )
}

function FieldRow({ field }: { field: PublicField }) {
  return (
    <div className="px-5 py-3">
      <p className="text-sm font-semibold text-black/60">{field.label}</p>
      {field.value == null || field.value === '' ? (
        <p className="text-black/35">Not provided yet</p>
      ) : field.fieldType === 'list' ? (
        <ListValue value={field.value} />
      ) : (
        <p className="whitespace-pre-line">{field.value}</p>
      )}
      {field.valueUpdatedAt && (
        <p className="mt-1 text-xs text-black/40">
          Last updated by {who(field.valueUpdatedBy)} on {fmtDate(field.valueUpdatedAt)}
        </p>
      )}
      {field.amendments.map((a, i) => (
        <div key={i} className="mt-2 border-l-4 pl-3" style={{ borderColor: 'var(--vb-tertiary)' }}>
          <p className="whitespace-pre-line">{a.value}</p>
          <p className="text-xs text-black/40">
            changed on {fmtDate(a.createdAt)} by {who(a.author)}
          </p>
        </div>
      ))}
    </div>
  )
}

export function DataSourceSection({ section, data, token }: { section: PublicSection; data: ViewbookPublicData; token: string }) {
  const hero = data.theme.sectionHeroes[section.sectionKey]
  return (
    <SectionShell section={section} title={SECTION_TITLES[section.sectionKey]} heroUrl={hero ? publicAssetUrl(token, hero) : null}>
      {data.dataLockedAt && (
        <div className="rounded-lg px-4 py-3 text-sm font-medium" style={{ background: 'var(--vb-primary)', color: 'var(--vb-on-primary)' }}>
          These answers were locked in on {fmtDate(data.dataLockedAt)}. Amendments appear beside the original answers.
        </div>
      )}
      {data.fieldCategories.length === 0 && <p className="text-black/50">The launch questionnaire will appear here.</p>}
      {data.fieldCategories.map((cat) => (
        <details key={cat.category} open className="rounded-xl border border-black/10 bg-white shadow-sm">
          <summary className="cursor-pointer px-5 py-3 text-lg font-bold" style={{ fontFamily: 'var(--vb-heading-font)' }}>
            {CATEGORY_LABELS[cat.category] ?? cat.category}
          </summary>
          <div className="divide-y divide-black/5">
            {cat.fields.map((f) => (
              <FieldRow key={f.id} field={f} />
            ))}
          </div>
        </details>
      ))}
      {/* PR3 owns this file next: inline editing, autosave, propose-a-change. */}
    </SectionShell>
  )
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run components/viewbook/public/sections-data.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/viewbook/public/
git commit -m "feat(viewbook): PR2 milestones timeline + read-only data-source sections"
```

---

### Task 8: The public page + PublicFooter gate

**Files:**
- Create: `app/(public)/viewbook/[token]/page.tsx`
- Modify: `components/PublicFooter.tsx` (anchored gate — suppress on the public viewbook page only)
- Test: `components/PublicFooter.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: the live route. `force-dynamic`, `robots: noindex`, 404 via `notFound()` on a null loader result.

- [ ] **Step 1: Write the page**

```tsx
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import type { SectionKey } from '@/lib/viewbook/theme'
import { loadViewbookPublicData } from '@/lib/viewbook/public-data'
import { ViewbookShell } from '@/components/viewbook/public/ViewbookShell'
import { WelcomeSection } from '@/components/viewbook/public/WelcomeSection'
import { MilestonesSection } from '@/components/viewbook/public/MilestonesSection'
import { DataSourceSection } from '@/components/viewbook/public/DataSourceSection'
import { BrandSection } from '@/components/viewbook/public/BrandSection'
import { AssessmentPlaceholder } from '@/components/viewbook/public/AssessmentPlaceholder'
import { StrategySection } from '@/components/viewbook/public/StrategySection'
import { MaterialsSection } from '@/components/viewbook/public/MaterialsSection'

export const dynamic = 'force-dynamic'

// Token-linked page: never index, and never leak the token path via the
// Referer header on outbound requests (Google Fonts, review links) —
// Codex plan-fix 6.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function ViewbookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await loadViewbookPublicData(token)
  if (!data) notFound()

  const bySection = (sectionKey: SectionKey) => {
    const section = data.sections.find((s) => s.sectionKey === sectionKey)
    if (!section) return null
    const props = { section, data, token }
    switch (sectionKey) {
      case 'welcome':
        return <WelcomeSection {...props} />
      case 'milestones':
        return <MilestonesSection {...props} />
      case 'data-source':
        return <DataSourceSection {...props} />
      case 'brand':
        return <BrandSection {...props} />
      case 'assessment':
        // PR5 swaps this placeholder for the real AssessmentSection.
        return <AssessmentPlaceholder {...props} />
      case 'strategy':
        return <StrategySection {...props} />
      case 'materials':
        return <MaterialsSection {...props} />
    }
  }

  return <ViewbookShell token={token} data={data} sectionContent={bySection} />
}
```

- [ ] **Step 2: Gate the internal footer** — in `components/PublicFooter.tsx` add below the `/sales/` line, using the SAME anchored single-segment pattern as the middleware matcher (Codex plan-fix 7 — a future deeper `/viewbook/token/...` route must not silently inherit the footer exception):

```ts
  if (pathname && /^\/viewbook\/[^/]+$/.test(pathname)) return null
```

Add `components/PublicFooter.test.tsx` (jsdom, mock `next/navigation`'s `usePathname`):

```tsx
// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('@/components/footer', () => ({ default: () => <div data-testid="footer" /> }))
import PublicFooter from './PublicFooter'

afterEach(cleanup)

describe('PublicFooter gating', () => {
  it('suppresses the internal footer on the public viewbook page (anchored)', () => {
    pathname = '/viewbook/some-token'
    const { queryByTestId } = render(<PublicFooter />)
    expect(queryByTestId('footer')).toBeNull()
  })
  it('renders it elsewhere, including deeper viewbook-prefixed paths', () => {
    pathname = '/viewbook/some-token/deeper'
    const { queryByTestId } = render(<PublicFooter />)
    expect(queryByTestId('footer')).not.toBeNull()
    pathname = '/about'
    cleanup()
    const again = render(<PublicFooter />)
    expect(again.queryByTestId('footer')).not.toBeNull()
  })
})
```

- [ ] **Step 3: Manual smoke**

```bash
DATABASE_URL="file:./local-dev.db" npx tsx -e "
import { prisma } from './lib/db'
import { createViewbook } from './lib/viewbook/service'
const c = await prisma.client.create({ data: { name: 'Smoke College', domains: '[]' } })
const vb = await createViewbook(c.id, 'upgrade', 'smoke@er.com')
console.log('http://localhost:3000/viewbook/' + vb.token)
"
npm run dev
```

Open the printed URL: page renders all sections themed with the default theme; nav dots anchor-scroll; no internal footer; an invalid token 404s. (If the `Client.create` shape differs from the schema, mirror Task 1's helper.)

Then PROVE the response-security contract (Codex plan-fix 6) against a production build — `force-dynamic` must actually emit a `no-store` Cache-Control header:

```bash
npm run build && npm start &
sleep 3
curl -sI "http://localhost:3000/viewbook/<token>" | grep -i cache-control
curl -sI "http://localhost:3000/viewbook/<token>" | grep -i referrer-policy
```

Expected: `cache-control: no-store, must-revalidate` (Next's dynamic default) and `referrer-policy: no-referrer` (from the metadata export). **If `no-store` is absent**, add the header explicitly in `middleware.ts` for `^/viewbook/[^/]+$` matches (we own that file this PR) and re-verify. Record the observed headers in the PR description.

- [ ] **Step 4: Commit**

```bash
git add "app/(public)/viewbook/" components/PublicFooter.tsx components/PublicFooter.test.tsx
git commit -m "feat(viewbook): PR2 public themed page + footer gate"
```

---

### Task 9: ThemePreview + ThemeEditor adoption

**Files:**
- Create: `components/viewbook/admin/ThemePreview.tsx`
- Modify: `components/viewbook/admin/ThemeEditor.tsx` (replace the inline preview block)

**Interfaces:**
- Consumes: Task 5 `ThemeStyle`/`themeCssVars`, `SectionShell`, `SECTION_TITLES` (client-safe — the shared-renderer requirement, spec §10: the PUBLIC components render inline in the admin page, never an iframe).
- Produces: `ThemePreview({ theme, clientName? })`.

- [ ] **Step 1: Write `ThemePreview.tsx`**

```tsx
'use client'

// Live theme preview (spec §10): renders the PUBLIC page's own components
// (SectionShell + theming primitives) inline with sample content — a shared
// renderer, never an iframe (the app ships frame-ancestors 'none').
import type { ViewbookTheme } from '@/lib/viewbook/theme'
import type { PublicSection } from '@/lib/viewbook/public-types'
import { SectionShell } from '@/components/viewbook/public/SectionShell'
import { ThemeStyle, themeCssVars } from '@/components/viewbook/public/ThemeStyle'

const SAMPLE_SECTION: PublicSection = {
  sectionKey: 'brand',
  state: 'active',
  doneAt: null,
  introNote: 'A short operator intro note looks like this.',
  narrative: null,
}

export function ThemePreview({ theme, clientName = 'Your Client' }: { theme: ViewbookTheme; clientName?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-navy-border">
      <div className="bg-[#fafafa] text-[#1a1a1a]" style={themeCssVars(theme)}>
        <ThemeStyle theme={theme} />
        <div className="px-4 py-2 text-sm font-bold" style={{ background: 'var(--vb-primary)', color: 'var(--vb-on-primary)', fontFamily: 'var(--vb-heading-font)' }}>
          {clientName} — viewbook preview
        </div>
        <div style={{ fontFamily: 'var(--vb-body-font)' }}>
          <SectionShell section={SAMPLE_SECTION} title="Brand Guidelines" heroUrl={null}>
            <p className="text-black/80">
              Body copy renders in the selected body font. Headers use the heading font on the brand
              primary band above.
            </p>
            <div className="flex gap-2">
              {[theme.primary, theme.secondary, theme.tertiary].map((c) => (
                <span key={c} className="inline-block h-10 w-10 rounded-lg border border-black/10" style={{ background: c }} title={c} />
              ))}
            </div>
          </SectionShell>
        </div>
      </div>
    </div>
  )
}
```

(Preview asset note: the preview passes `heroUrl={null}` and shows no logo — theme ASSET previews need the token-gated public URL; the admin page keeps PR1's "(uploaded)"/checkmark indicators. Colors + fonts are the live-preview surface.)

- [ ] **Step 2: Adopt in `ThemeEditor.tsx`** — replace the entire `{/* Inline preview: … */}` `<div>` block with:

```tsx
      <ThemePreview theme={draft} />
```

and add the import: `import { ThemePreview } from './ThemePreview'`.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean; `npx vitest run components/viewbook/` green; visual check on `/viewbooks/[id]` Theme tab in the dev server (fonts swap live when changing the dropdowns).

- [ ] **Step 4: Commit**

```bash
git add components/viewbook/admin/ThemePreview.tsx components/viewbook/admin/ThemeEditor.tsx
git commit -m "feat(viewbook): PR2 shared ThemePreview adopted in the admin theme editor"
```

---

### Task 10: Gates, cross-review, PR

- [ ] **Step 1: Full gates** (inside the worktree)

```bash
npx tsc --noEmit
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```

Expected: all green (test count ≥ 5,633 baseline + PR2 additions). A failure is a failure — investigate it (Codex plan-fix 8). The PR4 lane saw one unreproduced full-suite flake; a re-run may help COLLECT EVIDENCE about it, but never redefines a red run as acceptable.

Then run the security gate for this PR's public surface (new public route + middleware matchers):

```
/security-review
```

Address anything it raises before pushing.

- [ ] **Step 2: Push + cross-review**

```bash
git push -u origin feat/viewbook-pr2
```

Run `/codex-review` (P1 per program plan; base `main`). Apply named fixes, re-run gates.

- [ ] **Step 3: Open the PR** (do NOT merge without Kevin's lane rules satisfied: cross-review applied + gates green)

```bash
gh pr create --base main --head feat/viewbook-pr2 --title "feat(viewbook): PR2 — public themed page (read-only) + assets route + matchers" --body "…file list, ownership-map additions (public-types.ts, PublicFooter gate), spec §8/§7/§6 coverage, gates output…"
```

- [ ] **Step 4: Handoff upkeep** — update `docs/superpowers/todos/HANDOFF-client-viewbook.md` (PR2 state, next = PR4 integration brief) and commit.

---

## Codex review (2026-07-16) — verdict: targeted revision, 8 named fixes, ALL APPLIED above

1. Loader catches ONLY `HttpError` from `requireViewbookToken`; operational failures rethrow (+ test).
2. Global content fault isolation is PER KEY; block-isolation test injects a rejected prisma query.
3. `PublicField` carries `version` + `createdAt`, amendments carry `id` — PR3 never touches `public-data.ts`/`public-types.ts`.
4. `--vb-*` is the canonical CSS-var namespace; `--vb-on-tertiary` added; PR4 integration addendum MUST rename its leaves' `--viewbook-primary` refs (verified present at `FeedbackThread.tsx:75`, `MaterialLinkForm.tsx:59`).
5. SectionShell: full-viewport spreads (`min-h-screen`), stable `summary` band prop; ViewbookShell drops nested `<main>` (public layout owns it) + exactly one `<h1>`.
6. `referrer: 'no-referrer'` metadata; production `curl -sI` proof of `Cache-Control: no-store` with a middleware fallback if absent.
7. Ownership additions mirrored into the program plan (public-types, section-titles, PublicFooter + test, next.config.test); PublicFooter gate uses the ANCHORED regex, not a prefix.
8. Test matrix: cross-token asset 404, archived-client asset 404, CSP directive-retention test, markup-as-text escape test, UTC-stable dates, milestones empty-state fixture split, `/security-review` gate, flake waiver removed.

## Self-Review Notes

- Spec §8 coverage: all 7 sections ✔ (assessment = placeholder by design, PR5); fault isolation at loader, per block/key ✔; hidden/done semantics ✔; noopener ✔; summary band API ✔; no-store proven, not assumed ✔.
- Spec §7: exactly 2 new matchers ✔; token failures indistinguishable ✔; assets route allowlists ✔ (themeJson set + roster set, C14 curated-set precedent).
- Spec §6: CSP fonts origins ✔ (+ retention test); catalog-keyed fonts URL ✔; nosniff ✔; luminance-derived text ✔ (incl. on-tertiary); public page has no dark-mode variants ✔.
- PR4 forward contract: feedback + materials data in payload ✔; mount-point comments ✔; CSS-var rename assigned to PR4 integration ✔.
- PR3 forward contract: DataSourceSection read-only; `version`/`createdAt`/amendment-`id` in the payload ✔.
- PR5 forward contract: SectionShell props stable (incl. `summary`); AssessmentPlaceholder same signature as future AssessmentSection ✔.
