# C16 — Audit Consolidation (Full Merge, Site Audits Wins) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the `/seo-audits` section into one "Audits" section at `/ada-audit`: merged nav entry (with hidden ownership of the retained `/seo-audits/*` routes), Site Audit tab first + default, SF CSV upload as a collapsed optional section under Scan Type = SEO, one unified 4-type recents feed (cursor-paginated, with delete/search/client-filter parity), `Session.requestedBy` attribution, `/seo-audits` index 308, and seoOnly audits living on `/ada-audit/site/[id]` until their run is ready.

**Architecture:** Registry gains `aliases` so ONE visible entry owns both path trees (spec's "path aliases" option — chosen over a hidden entry because sidebar active-state and child expansion key on `activeTool.id`, and a hidden entry would break both for `/seo-audits/diff`). The recents feed becomes a 5-source k-way merge (`AdaAudit` standalone, `Session workflow='technical'`, `SiteAudit seoOnly=false`, `SiteAudit seoOnly=true`, orphaned live-scan `CrawlRun`s) under one stable total order `(createdAt DESC, type ASC, id ASC)` with a per-source cursor predicate — page-two correct by construction. The seoOnly branch on the site page runs AFTER the shared transient/cancelled/error branches and BEFORE ADA summary resolution (Codex fix #4). All link producers point at `/ada-audit/site/[id]`; the page itself is the router for complete seoOnly audits (redirect to the run page), so producers never need run-id lookups.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, Tailwind (class dark mode), Vitest + @testing-library/react.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-08-audit-consolidation-batch-design.md` §P1 — decisions are SETTLED (Kevin + Codex ×12); do not re-litigate.
- Array-form `$transaction([...])` only; no interactive transactions. (No transactions are needed in this plan — all writes are single statements.)
- `Session.requestedBy` is stamped ONLY when `/api/upload` CREATES a session — the append path must NOT overwrite (Codex fix #7).
- Unified recents: `Session.workflow = 'technical'` rows only (Codex fix #5); stable order `(createdAt DESC, type, id)`; page-two correctness has a dedicated DB-backed test (Codex fix #5); session delete + search + client-filter survive `HistoryList` retirement (Codex fix #6).
- `/seo-audits` index redirects via `permanentRedirect()` (308), NEVER `redirect()` (307). `/seo-audits/results/*`, share, and `/seo-audits/diff` URLs are untouched.
- seoOnly complete-branch on `/ada-audit/site/[id]` runs BEFORE the ADA summary resolution (Codex fix #4).
- All 8 enumerated `?scan=`/seoOnly link producers are updated (Codex fix #3): SiteAuditForm, QuickSiteAuditWidget, LiveNowWidget, QueueMemberRow, DashboardQueueStatus, ScheduledScansCard, client-dashboard link-builder, footer. Then `SeoScanForm` is retired.
- KEEP: `GET /api/parse/history` (consumed by `RecentParsesWidget` and `app/(app)/seo-audits/diff/page.tsx:145`), `SeoUploadCard` (+ its test), `DELETE /api/parse/[sessionId]`, all `/seo-audits/results/*` pages.
- **Orphaned live-scan CrawlRuns ARE a recents source (Codex plan-fix 1).** C11 PR 2a added seoOnly *schedules* (`app/api/clients/[id]/schedules/route.ts:89-114` persists `seoOnly` in the payload; `scheduled-site-audit.ts:119` forwards it), so scheduled retention CAN prune seoOnly parents and orphan their live-scan runs (`siteAuditId` SetNull). The unified feed therefore has a FIFTH source: `CrawlRun { tool: 'seo-parser', source: 'live-scan', seoIntent: true, siteAuditId: null }` (matches today's `/api/parse/history` run semantics), badged "Site SEO", linking straight to `/seo-audits/results/run/[id]`, `requestedBy: null` (never matches Mine — CrawlRun has no attribution).
- **One href rule (Codex plan-fix 3):** link DIRECTLY to `/seo-audits/results/run/[runId]` wherever the run id is already in hand (unified recents, `ScheduledScansCard`, orphan-run rows — the spec's own rule: "completed rows with a live-scan run link to the run page"); every producer that lacks the run id links `/ada-audit/site/[id]` and the site page routes (Task 9 redirect). Never `?scan=`.
- Test style (Codex plan-fix 7): the repo has NO jest-dom — use `toBeTruthy()` / `toBeNull()` / `.getAttribute()` assertions, `// @vitest-environment jsdom` as the first line of every component test, and `afterEach(cleanup)` (mirror `components/shell/SidebarNav.test.tsx`). Any `toBeInTheDocument()`/`toHaveAttribute()` in this plan's sketches must be translated accordingly at implementation time.
- No `Session.result` blob reads in the recents list path (Codex plan-fix 2): session score = `crawlRun?.score ?? null`; pre-A2 sessions without a CrawlRun show "—" like pruned rows already do.
- UI: `dark:` variants on every element; no hydration-mismatch patterns; new Tailwind classes must be reachable by the content globs (they cover `./app`, `./components`, `./lib`).
- SQLite migration is hand-authored SQL (interactive `migrate dev` unavailable): apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`.
- Gates (all must pass before PR): `npm run lint` (tsc --noEmit) · `DATABASE_URL="file:./local-dev.db" npm test` · `npm run build`.
- Never scan third-party sites; no prod-mutating verification beyond the documented post-deploy checks.

---

### Task 0: Branch + environment

**Files:** none (setup).

- [ ] **Step 1: Create the worktree/branch off origin/main**

```bash
git fetch origin
git worktree add ../er-seo-tools-c16 -b feat/c16-audit-consolidation origin/main
cd ../er-seo-tools-c16
```

(If working in the main checkout instead: `git checkout -b feat/c16-audit-consolidation origin/main`.)

- [ ] **Step 2: Install + env (fresh worktree only)**

```bash
npm install
cat > .env <<'EOF'
DATABASE_URL=file:./local-dev.db
UPLOADS_DIR=./local-uploads
NEXT_PUBLIC_APP_URL=http://localhost:3000
CHROME_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
EOF
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy
DATABASE_URL="file:./local-dev.db" npx prisma generate
```

- [ ] **Step 3: Baseline gates**

Run: `npm run lint && DATABASE_URL="file:./local-dev.db" npm test`
Expected: green (3781+ tests). If not, STOP — pre-existing breakage is not ours to absorb silently.

---

### Task 1: `Session.requestedBy` migration

**Files:**
- Modify: `prisma/schema.prisma` (Session model, lines 38-66)
- Create: `prisma/migrations/20260708210000_session_requested_by/migration.sql`

**Interfaces:**
- Produces: `Session.requestedBy: string | null` column + `@@index([requestedBy, createdAt])`, used by Tasks 2 and 6.

- [ ] **Step 1: Edit the schema**

In the `Session` model, after `workflow` (line 53), add the field; add the index alongside the existing ones (mirrors `AdaAudit`/`SiteAudit`):

```prisma
  workflow        String   @default("technical") // 'technical' | 'keyword-research'
  requestedBy     String?  // C16: operator label at session creation (SSO-aware); null pre-C16
```

and in the index block:

```prisma
  @@index([workflow])
  @@index([requestedBy, createdAt])
```

- [ ] **Step 2: Hand-author the migration**

`prisma/migrations/20260708210000_session_requested_by/migration.sql`:

```sql
-- C16: session attribution for the unified recents Mine filter.
ALTER TABLE "Session" ADD COLUMN "requestedBy" TEXT;
CREATE INDEX "Session_requestedBy_createdAt_idx" ON "Session"("requestedBy", "createdAt");
```

- [ ] **Step 3: Apply + regenerate**

Run: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`
Expected: migration applied, client regenerated. Then `npm run lint` → green.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260708210000_session_requested_by/
git commit -m "feat(schema): additive Session.requestedBy + index (C16)"
```

---

### Task 2: `/api/upload` stamps `requestedBy` at creation only

**Files:**
- Modify: `app/api/upload/route.ts` (imports at top; create branch at lines 221-230)
- Test: `app/api/upload/route.requested-by.test.ts` (new)

**Interfaces:**
- Consumes: `getOperatorLabel(authCookieValue, operatorCookieValue)` from `@/lib/auth` (verified-session name → email → sanitized legacy cookie → null).
- Produces: new `Session` rows carry `requestedBy`; append path leaves it untouched.

- [ ] **Step 1: Write the failing test**

New file `app/api/upload/route.requested-by.test.ts`. First READ `app/api/upload/route.test.ts` and reuse its request-construction/env helpers verbatim — two hard requirements from that route (Codex plan-fix 6): (a) the route mandates a `Content-Length` header (`parseContentLength` → 411 before any session is created), so the request builder MUST set it exactly the way `route.test.ts` does; (b) `UPLOADS_DIR` is captured at module import, so configure the temp upload dir (or the mocks `route.test.ts` uses) BEFORE importing `./route`, and clean up created files + Session rows in `afterEach` per that file's convention. The C15 precedent (`app/api/site-audit/route.requested-by.test.ts`) mocks `@/lib/auth` with `importOriginal` spread — mirror that:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

const getOperatorLabelMock = vi.fn<() => Promise<string | null>>()
vi.mock('@/lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth')>()
  return { ...mod, getOperatorLabel: (...args: unknown[]) => getOperatorLabelMock(...(args as [])) }
})

import { POST } from './route' // import AFTER env/mocks are configured (UPLOADS_DIR is read at module load)

function uploadRequest(fields: Record<string, string> = {}): NextRequest {
  const fd = new FormData()
  fd.append('files', new File(['Address,Status Code\nhttps://a.example,200\n'], 'internal_all.csv', { type: 'text/csv' }))
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  // Codex plan-fix 6: the route 411s without Content-Length — copy the exact
  // header construction from route.test.ts (do not hand-roll this line).
  return new NextRequest('http://localhost:3000/api/upload', { method: 'POST', body: fd, headers: { 'content-length': '1024' } })
}

describe('POST /api/upload — requestedBy stamping (C16)', () => {
  beforeEach(() => { getOperatorLabelMock.mockReset() })

  it('stamps requestedBy from getOperatorLabel on session CREATE', async () => {
    getOperatorLabelMock.mockResolvedValue('Kevin Vogelgesang')
    const res = await POST(uploadRequest())
    const body = await res.json()
    expect(res.status).toBe(200)
    const row = await prisma.session.findUnique({ where: { id: body.sessionId } })
    expect(row?.requestedBy).toBe('Kevin Vogelgesang')
  })

  it('APPEND to a pending session never overwrites requestedBy (Codex fix #7)', async () => {
    getOperatorLabelMock.mockResolvedValue('Kevin Vogelgesang')
    const first = await (await POST(uploadRequest())).json()
    getOperatorLabelMock.mockResolvedValue('Somebody Else')
    const res2 = await POST(uploadRequest({ sessionId: first.sessionId }))
    expect(res2.status).toBe(200)
    const row = await prisma.session.findUnique({ where: { id: first.sessionId } })
    expect(row?.requestedBy).toBe('Kevin Vogelgesang')
  })

  it('null label → null requestedBy (legacy sessions never match Mine)', async () => {
    getOperatorLabelMock.mockResolvedValue(null)
    const body = await (await POST(uploadRequest())).json()
    const row = await prisma.session.findUnique({ where: { id: body.sessionId } })
    expect(row?.requestedBy).toBeNull()
  })
})
```

Adjust the response-shape assertions (`body.sessionId`) and file fixture to whatever `route.test.ts` actually uses — mirror, don't invent. Clean up created rows if the house convention does (check the sibling test's afterEach).

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/upload/route.requested-by.test.ts`
Expected: FAIL — `requestedBy` is null on create (route never sets it).

- [ ] **Step 3: Implement**

In `app/api/upload/route.ts`, extend the auth import (the file may not import from `@/lib/auth` yet):

```ts
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel } from '@/lib/auth';
```

In the create branch only (currently lines 221-230):

```ts
      // C16: stamp attribution at session creation only — appends to an
      // existing pending session must never overwrite the original creator.
      const requestedBy = await getOperatorLabel(
        request.cookies.get(AUTH_COOKIE_NAME)?.value,
        request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value,
      );
      await prisma.session.create({
        data: {
          id: sessionId,
          files: JSON.stringify(fileNames),
          status: 'pending',
          workflow,
          requestedBy,
        },
      });
```

The append branch (`prisma.session.update` at lines 212-220) is NOT touched.

- [ ] **Step 4: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/upload/`
Expected: new file PASS + existing `route.test.ts` still PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/upload/route.ts app/api/upload/route.requested-by.test.ts
git commit -m "feat(upload): stamp Session.requestedBy at creation via SSO-aware getOperatorLabel (C16)"
```

---

### Task 3: Registry merge — one "Audits" entry with `/seo-audits` alias; footer

**Files:**
- Modify: `lib/tools-registry.ts` (ToolDef interface :12-24; entries :42-58; `toolForPathname` :79-92)
- Modify: `lib/tools-registry.test.ts`
- Modify: `components/shell/SidebarNav.test.tsx` (hard-codes "Site Audits" / "SEO Audits" names — Codex plan-fix 7)
- Modify: `components/footer.tsx` (:6-14)

**Interfaces:**
- Produces: `ToolDef.aliases?: string[]`; merged entry `id: 'audits'`, `name: 'Audits'`, `href: '/ada-audit'`, `aliases: ['/seo-audits']`. `toolForPathname('/seo-audits/…')` → the `audits` entry. Sidebar/Topbar need NO changes (they key on the resolved entry).

- [ ] **Step 1: Write the failing tests**

In `lib/tools-registry.test.ts`, update the two id-sensitive tests and add alias coverage:

```ts
  it('toolForPathname matches longest prefix, exact for home', () => {
    expect(toolForPathname('/')!.id).toBe('home')
    expect(toolForPathname('/ada-audit/queue')!.id).toBe('audits')
    expect(toolForPathname('/seo-audits/results/abc')!.id).toBe('audits')
    expect(toolForPathname('/seo-audits/diff')!.id).toBe('audits')
    expect(toolForPathname('/clients/12')!.id).toBe('clients')
    expect(toolForPathname('/nonexistent')).toBeUndefined()
  })
```

Add:

```ts
  it('C16: one merged Audits entry owns both path trees; no seo-parser entry remains', () => {
    expect(TOOLS.find((t) => t.id === 'seo-parser')).toBeUndefined()
    const audits = TOOLS.find((t) => t.id === 'audits')!
    expect(audits.name).toBe('Audits')
    expect(audits.hidden).toBeFalsy()
    expect(audits.aliases).toEqual(['/seo-audits'])
    expect(audits.children?.map((c) => c.name)).toEqual(['Run an audit', 'Audit queue', 'Recents', 'Compare crawls'])
  })

  it('C16: aliases are internal, non-public paths', () => {
    for (const t of TOOLS) {
      for (const a of t.aliases ?? []) {
        expect(a.startsWith('/')).toBe(true)
        expect(isPublicPath(a), a).toBe(false)
      }
    }
  })
```

Also update `components/shell/SidebarNav.test.tsx` (Codex plan-fix 7): its assertions reference `screen.getByText('Site Audits')` and (if present) 'SEO Audits' — rename to 'Audits', and ADD an alias-active case:

```tsx
  it('C16: aliased path activates the Audits entry and shows its children', () => {
    pathnameMock.value = '/seo-audits/diff'
    render(<SidebarNav collapsed={false} onToggleCollapse={noop} />)
    const active = screen.getByText('Audits').closest('a')!
    expect(active.getAttribute('aria-current')).toBe('page')
    const compare = screen.getByText('Compare crawls').closest('a')!
    expect(compare.getAttribute('href')).toBe('/seo-audits/diff')
  })
```

(Mirror the file's existing active-state assertions — read them first; the exact attribute asserted for child highlighting must match what the existing `/ada-audit/queue` case asserts.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tools-registry.test.ts`
Expected: FAIL (`aliases` undefined, ids wrong).

- [ ] **Step 3: Implement**

`ToolDef` gains the field (after `href`):

```ts
  href: string
  // C16: additional path prefixes owned by this tool — toolForPathname treats
  // them like href so retained routes (/seo-audits/results/*, /seo-audits/diff)
  // resolve to the merged entry for Topbar titles + sidebar active state.
  aliases?: string[]
```

Replace the two entries (`site-audit` + `seo-parser`, lines 42-58) with ONE:

```ts
  {
    id: 'audits', name: 'Audits', href: '/ada-audit', aliases: ['/seo-audits'], group: 'run', icon: IconSiteAudit,
    description: 'Site, single-page & SF-upload audits — ADA + SEO',
    children: [
      { name: 'Run an audit', href: '/ada-audit' },
      { name: 'Audit queue', href: '/ada-audit/queue' },
      { name: 'Recents', href: '/ada-audit/recents' },
      { name: 'Compare crawls', href: '/seo-audits/diff' },
    ],
  },
```

(`IconParser` stays imported — the hidden keyword-research/pillar entries use it.)

Rewrite `toolForPathname` to consider aliases with the same longest-prefix rule:

```ts
// Longest-prefix match over href + aliases so /ada-audit/queue AND
// /seo-audits/diff both → 'audits'; '/' is exact-only.
export function toolForPathname(pathname: string): ToolDef | undefined {
  let best: ToolDef | undefined
  let bestLen = -1
  for (const t of TOOLS) {
    for (const prefix of [t.href, ...(t.aliases ?? [])]) {
      if (prefix === '/') {
        if (pathname === '/') return t
        continue
      }
      if ((pathname === prefix || pathname.startsWith(prefix + '/')) && prefix.length > bestLen) {
        best = t
        bestLen = prefix.length
      }
    }
  }
  return best
}
```

`components/footer.tsx` toolLinks — one merged link, first position:

```ts
const toolLinks = [
  { name: 'Audits', href: '/ada-audit' },
  { name: 'Robots Validator', href: '/robots-validator' },
  { name: 'Quarter Grid', href: '/quarter-grid' },
  { name: 'E-E-A-T Checklist', href: '/eat-checklist' },
  { name: 'RankMath Redirects', href: '/rankmath-redirects' },
  { name: 'Clients', href: '/clients' },
]
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/tools-registry.test.ts && npx vitest run components/shell`
Expected: PASS (SidebarNav/Topbar tests, if any, still green — they consume the registry generically).

- [ ] **Step 5: Commit**

```bash
git add lib/tools-registry.ts lib/tools-registry.test.ts components/shell/SidebarNav.test.tsx components/footer.tsx
git commit -m "feat(nav): merge Site+SEO Audits into one Audits entry with /seo-audits alias (C16)"
```

---

### Task 4: `AuditIndexTabs` — Site Audit first + default; page copy

**Files:**
- Modify: `components/ada-audit/AuditIndexTabs.tsx` (:15-19 parseTab, :35-49 initial state/effect, :85-113 tab buttons)
- Modify: `app/(app)/ada-audit/page.tsx` (metadata :7, h1/description :22-26)
- Test: `components/ada-audit/AuditIndexTabs.test.tsx` (new)

**Interfaces:**
- Consumes: existing `?auditTab=` deep-link param (must keep working: `single` | `site`).
- Produces: default tab `'site'`; labels "Site Audit" (first) and "Single Page" (second).

- [ ] **Step 1: Write the failing test**

New `components/ada-audit/AuditIndexTabs.test.tsx`. Mock the heavy children and `useSearchParams`. House test style (no jest-dom — Codex plan-fix 7): `@vitest-environment jsdom` directive, `afterEach(cleanup)`, truthy/null assertions:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

let mockSearch = ''
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(mockSearch) }))
vi.mock('./AuditForm', () => ({ default: () => <div data-testid="single-form" /> }))
vi.mock('./SiteAuditForm', () => ({ default: () => <div data-testid="site-form" /> }))
vi.mock('./ClientsAuditSummary', () => ({ default: () => null }))
vi.mock('./DashboardQueueStatus', () => ({ default: () => null }))
vi.mock('./RecentsTable', () => ({ default: () => null }))

import AuditIndexTabs from './AuditIndexTabs'

afterEach(cleanup)

describe('AuditIndexTabs (C16)', () => {
  beforeEach(() => { mockSearch = '' })

  it('defaults to the Site Audit tab', () => {
    render(<AuditIndexTabs recentItems={[]} initialNextCursor={null} operator={null} initialScope="all" />)
    expect(screen.getByTestId('site-form')).toBeTruthy()
    expect(screen.queryByTestId('single-form')).toBeNull()
  })

  it('renders Site Audit as the FIRST tab', () => {
    render(<AuditIndexTabs recentItems={[]} initialNextCursor={null} operator={null} initialScope="all" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0].textContent).toContain('Site Audit')
    expect(tabs[1].textContent).toContain('Single Page')
  })

  it('?auditTab=single deep-link still works', () => {
    mockSearch = 'auditTab=single'
    render(<AuditIndexTabs recentItems={[]} initialNextCursor={null} operator={null} initialScope="all" />)
    expect(screen.getByTestId('single-form')).toBeTruthy()
  })
})
```

Note: `initialNextCursor` prop arrives in Task 8 — if running this task before Task 8, omit it here and add it in Task 8's caller sweep. Match the component's real props at implementation time; the mocked children must use the component's actual import specifiers (check the import paths at the top of `AuditIndexTabs.tsx` — e.g. `@/components/ada-audit/AuditForm` vs `./AuditForm` — and mock the exact specifier).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run components/ada-audit/AuditIndexTabs.test.tsx`
Expected: FAIL — default is `'single'`, first tab is "Single Page".

- [ ] **Step 3: Implement**

`parseTab` flips its default (C13 tab-order item absorbed here):

```ts
// C16: Site Audit is the primary surface — default tab, first in order.
function parseTab(value: string | null): Tab {
  return value === 'single' ? 'single' : 'site'
}
```

Initial state + effect simplify (the `?prefillDomain=` inference is now redundant — site IS the default; explicit `?auditTab=` still wins):

```ts
  const [tab, setTab] = useState<Tab>(() => parseTab(searchParams.get('auditTab')))

  useEffect(() => {
    const explicit = searchParams.get('auditTab')
    if (explicit) setTab(parseTab(explicit))
  }, [searchParams])
```

Tab buttons: swap order so the `'site'` button renders first with label **"Site Audit"** (was "Full Site"), `'single'` second with label "Single Page". Keep every existing className/aria attribute; only order + label text change.

`app/(app)/ada-audit/page.tsx` copy:

```ts
export const metadata = { title: 'Audits — ER SEO Tools' }
```

```tsx
        <h1 className="font-display font-bold text-[28px] text-navy dark:text-white">Audits</h1>
        <p className="text-[14px] font-body text-navy/60 dark:text-white/60 mt-1">
          Run site-wide or single-page ADA + SEO audits, or upload Screaming Frog exports. Results are saved and shared across the team.
        </p>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run components/ada-audit/AuditIndexTabs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/AuditIndexTabs.tsx components/ada-audit/AuditIndexTabs.test.tsx "app/(app)/ada-audit/page.tsx"
git commit -m "feat(audits): Site Audit tab first + default; index copy → Audits (C16)"
```

---

### Task 5: SF upload as a collapsed optional section in `SiteAuditForm`

**Files:**
- Modify: `components/ada-audit/SiteAuditForm.tsx` (insert after the Scan Type group, lines 453-480)
- Test: `components/ada-audit/SiteAuditForm.test.tsx` (add cases)

**Interfaces:**
- Consumes: `SeoUploadCard` from `@/components/seo-parser/SeoUploadCard` (no props; on analyze it routes to `/seo-audits/results/[sessionId]` — unchanged).

- [ ] **Step 1: Write the failing test**

In `components/ada-audit/SiteAuditForm.test.tsx`, mock the card at the top with the other mocks:

```tsx
vi.mock('@/components/seo-parser/SeoUploadCard', () => ({ SeoUploadCard: () => <div data-testid="sf-upload-card" /> }))
```

(Verify the export style — `SeoUploadCard` is a named export per `export function SeoUploadCard()`.) Add:

```tsx
  it('C16: SEO intent reveals a collapsed SF-upload section', async () => {
    render(<SiteAuditForm queueStatus={null} />)
    // default intent is ada — no SF section
    expect(screen.queryByText(/Screaming Frog exports/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /SEO/i }))
    const toggle = screen.getByRole('button', { name: /Screaming Frog exports/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('sf-upload-card')).toBeNull() // collapsed by default
    fireEvent.click(toggle)
    expect(screen.getByTestId('sf-upload-card')).toBeTruthy()
  })
```

Match `SiteAuditForm`'s actual required props from the existing tests in that file (e.g. `queueStatus`); the SEO intent button matcher may need `getByRole('button', { name: 'SEO Render-only, faster' })` — copy the working matcher from the existing intent-toggle test if one exists.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run components/ada-audit/SiteAuditForm.test.tsx`
Expected: new case FAILS (no SF section exists).

- [ ] **Step 3: Implement**

In `SiteAuditForm.tsx`: add state + import:

```ts
import { SeoUploadCard } from '@/components/seo-parser/SeoUploadCard'
```

```ts
  const [showSfUpload, setShowSfUpload] = useState(false)
```

Insert directly AFTER the Scan Type group `</div>` (line 480), BEFORE the `{intent === 'ada' && (...)}` WCAG selector:

```tsx
      {/* C16: optional SF-export path — the old /seo-audits upload card, collapsed */}
      {intent === 'seo' && (
        <div className="rounded-xl border border-gray-200 dark:border-navy-border">
          <button
            type="button"
            onClick={() => setShowSfUpload((v) => !v)}
            aria-expanded={showSfUpload}
            className="w-full flex items-center justify-between px-4 py-3 text-[13px] font-body font-semibold text-navy/70 dark:text-white/70"
          >
            <span>Have Screaming Frog exports? Upload CSVs instead</span>
            <span aria-hidden className="text-navy/40 dark:text-white/40">{showSfUpload ? '−' : '+'}</span>
          </button>
          {showSfUpload && (
            <div className="px-4 pb-4 border-t border-gray-100 dark:border-navy-border">
              <SeoUploadCard />
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run components/ada-audit/SiteAuditForm.test.tsx components/seo-parser/SeoUploadCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/SiteAuditForm.tsx components/ada-audit/SiteAuditForm.test.tsx
git commit -m "feat(audits): collapsed SF-upload section under Scan Type = SEO (C16)"
```

---

### Task 6: Unified recents query — 4 sources, stable cursor pagination, filters

**Files:**
- Rewrite: `lib/ada-audit/recents-query.ts`
- Modify tests: `lib/ada-audit/recents-query.test.ts`, `lib/ada-audit/recents-query.db.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 7/8):

```ts
export type RecentType = 'page' | 'sf-upload' | 'site-ada' | 'site-seo'
export interface RecentItem {
  type: RecentType; id: string; createdAt: string; label: string; href: string
  status: string; score: number | null; startedAt: string | null; completedAt: string | null
  clientName: string | null; requestedBy: string | null; deletable: boolean
}
export interface RecentsCursor { createdAt: number; type: RecentType; id: string }
export function encodeRecentsCursor(c: RecentsCursor): string
export function decodeRecentsCursor(raw: string | null): RecentsCursor | null
export interface RecentsQueryOptions {
  limit?: number; operator?: string; cursor?: RecentsCursor | null
  q?: string; clientId?: number | 'unassigned' | null
}
export interface RecentsPage { items: RecentItem[]; nextCursor: string | null }
export async function fetchAllRecents(opts?: RecentsQueryOptions): Promise<RecentsPage>
```

- `fetchRecentsForOperator` is REMOVED (no non-test callers — verified 2026-07-08).

- [ ] **Step 1: Write the failing DB-backed tests**

Extend `lib/ada-audit/recents-query.db.test.ts` (keep its existing fixture helpers/cleanup conventions — read the file first). Flip the C11 exclusion test and add:

```ts
  it('C16: includes seoOnly site audits as site-seo with run-page href when complete', async () => {
    // fixture: seoOnly SiteAudit status 'complete' + a CrawlRun { tool: 'seo-parser', source: 'live-scan' } linked via siteAuditId
    const { items } = await fetchAllRecents({ limit: 50 })
    const row = items.find((i) => i.id === seoOnlyAuditId)!
    expect(row.type).toBe('site-seo')
    expect(row.href).toBe(`/seo-audits/results/run/${liveRunId}`)
    expect(row.score).toBe(liveRunScore) // seo-parser run score, not ada
  })

  it('C16: transient seoOnly audits link to the site page (poller host)', async () => {
    // fixture: seoOnly SiteAudit status 'running'
    const { items } = await fetchAllRecents({ limit: 50 })
    const row = items.find((i) => i.id === runningSeoOnlyId)!
    expect(row.href).toBe(`/ada-audit/site/${runningSeoOnlyId}`)
  })

  it('C16: technical sessions appear as sf-upload (deletable); keyword-research sessions are excluded', async () => {
    const { items } = await fetchAllRecents({ limit: 50 })
    const sf = items.find((i) => i.id === technicalSessionId)!
    expect(sf.type).toBe('sf-upload')
    expect(sf.deletable).toBe(true)
    expect(sf.href).toBe(`/seo-audits/results/${technicalSessionId}`)
    expect(items.find((i) => i.id === keywordSessionId)).toBeUndefined()
  })

  it('C16: Mine scope matches Session.requestedBy; null-requestedBy sessions never match', async () => {
    const { items } = await fetchAllRecents({ limit: 50, operator: 'Kevin Vogelgesang' })
    expect(items.some((i) => i.id === kevinSessionId)).toBe(true)
    expect(items.some((i) => i.id === legacyNullSessionId)).toBe(false)
  })

  it('C16: page-two correctness — identical createdAt across types, no dup, no skip', async () => {
    // Fixture isolation (Codex plan-fix 5): stamp ALL fixtures with a
    // dedicated operator (e.g. `C16-PAGER-${suffix}`) and pass it on every
    // page so shared-DB rows from other tests can never leak in; extend the
    // file's cleanup to delete these Session/SiteAudit/AdaAudit fixtures.
    // Fixture: ONE shared timestamp T; create at T with EXPLICIT ids:
    //   AdaAudits pg1, pg2 · Sessions ss1, ss2 · SiteAudits(seoOnly=false)
    //   sa1, sa2 · SiteAudits(seoOnly=true) sq1, sq2 (8 rows).
    const OP = `C16-PAGER-${suffix}`
    const page1 = await fetchAllRecents({ limit: 3, operator: OP })
    expect(page1.items).toHaveLength(3)
    expect(page1.nextCursor).not.toBeNull()
    const page2 = await fetchAllRecents({ limit: 3, operator: OP, cursor: decodeRecentsCursor(page1.nextCursor) })
    const page3 = await fetchAllRecents({ limit: 3, operator: OP, cursor: decodeRecentsCursor(page2.nextCursor) })
    const all = [...page1.items, ...page2.items, ...page3.items].map((i) => `${i.type}:${i.id}`)
    expect(new Set(all).size).toBe(all.length)          // no duplicates
    expect(all).toHaveLength(8)                          // no skips
    expect(page3.nextCursor).toBeNull()
    // Full order assertion (Codex plan-fix 4): at ONE timestamp the total
    // order is type ASC then id ASC — assert the exact sequence.
    expect(all).toEqual([
      `page:${pg1}`, `page:${pg2}`,
      `sf-upload:${ss1}`, `sf-upload:${ss2}`,
      `site-ada:${sa1}`, `site-ada:${sa2}`,
      `site-seo:${sq1}`, `site-seo:${sq2}`,
    ])
    // (choose fixture ids so pg1 < pg2, ss1 < ss2, etc. — e.g. prefixed
    //  literals like `${suffix}-a` / `${suffix}-b`)
  })

  it('C16: orphaned live-scan runs appear as site-seo linking the run page (Codex fix 1)', async () => {
    // fixture: CrawlRun { tool: 'seo-parser', source: 'live-scan', seoIntent: true, siteAuditId: null }
    const { items } = await fetchAllRecents({ limit: 50 })
    const row = items.find((i) => i.id === orphanRunId)!
    expect(row.type).toBe('site-seo')
    expect(row.href).toBe(`/seo-audits/results/run/${orphanRunId}`)
    expect(row.requestedBy).toBeNull() // CrawlRun carries no attribution — never matches Mine
    // and a NON-orphan live-scan run (siteAuditId set) must NOT appear as its own row
    expect(items.find((i) => i.id === attachedRunId)).toBeUndefined()
  })

  it('C16: q filter matches url/domain/siteName/files; clientId filter incl. unassigned', async () => {
    const byQ = await fetchAllRecents({ limit: 50, q: 'a.example' })
    expect(byQ.items.every((i) => i.label.includes('a.example'))).toBe(true)
    const byClient = await fetchAllRecents({ limit: 50, clientId: clientAId })
    expect(byClient.items.every((i) => i.clientName === 'Client A')).toBe(true)
    const unassigned = await fetchAllRecents({ limit: 50, clientId: 'unassigned' })
    expect(unassigned.items.every((i) => i.clientName === null)).toBe(true)
  })
```

Also update the two existing mocked tests in `recents-query.test.ts` for the new signature/shape (`fetchAllRecents({ limit: 10 })`, items under `.items`, `label` instead of `url`/`domain`), and add pure cursor codec tests:

```ts
  it('cursor codec round-trips and rejects malformed input', () => {
    const c = { createdAt: 1751990400000, type: 'site-ada' as const, id: 'abc' }
    expect(decodeRecentsCursor(encodeRecentsCursor(c))).toEqual(c)
    expect(decodeRecentsCursor(null)).toBeNull()
    expect(decodeRecentsCursor('')).toBeNull()
    expect(decodeRecentsCursor('notanumber~site-ada~x')).toBeNull()
    expect(decodeRecentsCursor('123~bogus-type~x')).toBeNull()
    expect(decodeRecentsCursor('123~site-ada')).toBeNull()
    // Codex plan-fix 4: timestamps outside the valid Date range must be
    // rejected — an Invalid Date must never reach Prisma from a public param.
    expect(decodeRecentsCursor('1e300~site-ada~x')).toBeNull()
    expect(decodeRecentsCursor(`${9e15}~site-ada~x`)).toBeNull()
    expect(decodeRecentsCursor('123.5~site-ada~x')).toBeNull()
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/recents-query.db.test.ts lib/ada-audit/recents-query.test.ts`
Expected: FAIL (new API doesn't exist).

- [ ] **Step 3: Implement — full rewrite of `lib/ada-audit/recents-query.ts`**

```ts
import { prisma } from '@/lib/db'
import { computeScore, computeScoreFromCounts } from '@/lib/ada-audit/scoring'
import type { AxeViolation } from '@/lib/ada-audit/types'

// C16 unified recents: four sources under ONE stable total order
// (createdAt DESC, type ASC, id ASC). The four RecentType literals sort
// lexicographically ('page' < 'sf-upload' < 'site-ada' < 'site-seo') — the
// cursor predicates below depend on that, so new types must keep the
// comparator and cursorWhere() in sync.
export type RecentType = 'page' | 'sf-upload' | 'site-ada' | 'site-seo'
const RECENT_TYPES: readonly RecentType[] = ['page', 'sf-upload', 'site-ada', 'site-seo']

export interface RecentItem {
  type: RecentType
  id: string
  createdAt: string
  label: string
  href: string
  status: string
  score: number | null
  startedAt: string | null
  completedAt: string | null
  clientName: string | null
  requestedBy: string | null
  deletable: boolean
}

export interface RecentsCursor { createdAt: number; type: RecentType; id: string }

// ids are cuid/uuid — '~' can never appear in them.
export function encodeRecentsCursor(c: RecentsCursor): string {
  return `${c.createdAt}~${c.type}~${c.id}`
}

// Max valid Date epoch-ms magnitude (ECMA-262). A public query param must
// never produce an Invalid Date that reaches Prisma (Codex plan-fix 4).
const MAX_DATE_MS = 8_640_000_000_000_000

export function decodeRecentsCursor(raw: string | null): RecentsCursor | null {
  if (!raw) return null
  const parts = raw.split('~')
  if (parts.length !== 3 || !parts[2]) return null
  const createdAt = Number(parts[0])
  if (!Number.isSafeInteger(createdAt) || Math.abs(createdAt) > MAX_DATE_MS) return null
  if (!RECENT_TYPES.includes(parts[1] as RecentType)) return null
  return { createdAt, type: parts[1] as RecentType, id: parts[2] }
}

export interface RecentsQueryOptions {
  limit?: number
  operator?: string
  cursor?: RecentsCursor | null
  q?: string
  clientId?: number | 'unassigned' | null
}

export interface RecentsPage { items: RecentItem[]; nextCursor: string | null }

function pageScore(status: string, result: string | null, wcagLevel: string): number | null {
  if (status !== 'complete' || !result) return null
  try {
    const parsed = JSON.parse(result) as { violations?: AxeViolation[] }
    const { score } = computeScore(parsed.violations ?? [], wcagLevel)
    return Number.isFinite(score) ? score : null
  } catch { return null }
}

function siteScore(status: string, summary: string | null, wcagLevel: string): number | null {
  if (status !== 'complete' || !summary) return null
  try {
    const parsed = JSON.parse(summary) as { aggregate?: unknown } | null
    if (!parsed?.aggregate) return null
    const { score } = computeScoreFromCounts(parsed.aggregate as never, wcagLevel)
    return Number.isFinite(score) ? score : null
  } catch { return null }
}

// NO Session.result blob read here (Codex plan-fix 2): the recents list must
// not become a new hot-path blob reader. Session score = CrawlRun.score only;
// pre-A2 sessions (no CrawlRun) render "—", same as pruned rows.

function firstFile(files: string): string {
  try {
    const arr = JSON.parse(files) as string[]
    return arr[0] ?? 'SF upload'
  } catch { return 'SF upload' }
}

// Position-after-cursor predicate for a source that emits rows of `type`.
// Total order: createdAt DESC, type ASC, id ASC. At the cursor timestamp,
// a source of an EARLIER type is exhausted; the SAME type resumes after the
// cursor id; a LATER type includes the whole timestamp.
function cursorWhere(cursor: RecentsCursor | null, type: RecentType): Record<string, unknown> {
  if (!cursor) return {}
  const cd = new Date(cursor.createdAt)
  if (type < cursor.type) return { createdAt: { lt: cd } }
  if (type === cursor.type) {
    return { OR: [{ createdAt: { lt: cd } }, { AND: [{ createdAt: cd }, { id: { gt: cursor.id } }] }] }
  }
  return { createdAt: { lte: cd } }
}

// TWO sources emit type 'site-seo' (seoOnly SiteAudits + orphaned live-scan
// CrawlRuns). The cursor stays correct: both queries use the same-type
// predicate against their OWN ids, and cuids are unique across both tables,
// so the merged (createdAt, 'site-seo', id) order has no collisions.
type OrphanRunRow = {
  id: string
  createdAt: Date
  status: string
  domain: string | null
  score: number | null
  client: { name: string } | null
}

function compareItems(a: RecentItem, b: RecentItem): number {
  const t = b.createdAt.localeCompare(a.createdAt)
  if (t !== 0) return t
  if (a.type !== b.type) return a.type < b.type ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export async function fetchAllRecents(opts: RecentsQueryOptions = {}): Promise<RecentsPage> {
  const limit = opts.limit ?? 100
  const take = limit + 1
  const cursor = opts.cursor ?? null
  const q = opts.q?.trim() || null
  const mine = opts.operator ? { requestedBy: opts.operator } : {}
  const clientWhere =
    opts.clientId === 'unassigned' ? { clientId: null }
    : typeof opts.clientId === 'number' ? { clientId: opts.clientId }
    : {}
  const order = [{ createdAt: 'desc' as const }, { id: 'asc' as const }]

  // Mine scope: CrawlRun has no requestedBy — an operator filter excludes the
  // orphan-run source entirely (empty promise), matching "legacy rows never
  // match Mine".
  const orphanRuns = opts.operator
    ? Promise.resolve([] as OrphanRunRow[])
    : prisma.crawlRun.findMany({
        where: { AND: [{ tool: 'seo-parser', source: 'live-scan', seoIntent: true, siteAuditId: null, ...clientWhere }, ...(q ? [{ domain: { contains: q } }] : []), cursorWhere(cursor, 'site-seo')] },
        orderBy: order, take,
        select: {
          id: true, createdAt: true, status: true, domain: true, score: true,
          client: { select: { name: true } },
        },
      })

  const [pages, sessions, adaSites, seoSites, orphans] = await Promise.all([
    prisma.adaAudit.findMany({
      where: { AND: [{ siteAuditId: null, ...mine, ...clientWhere }, ...(q ? [{ url: { contains: q } }] : []), cursorWhere(cursor, 'page')] },
      orderBy: order, take,
      select: {
        id: true, createdAt: true, url: true, status: true, wcagLevel: true,
        result: true, startedAt: true, completedAt: true, requestedBy: true,
        client: { select: { name: true } },
        crawlRun: { select: { score: true } },
      },
    }),
    prisma.session.findMany({
      where: { AND: [{ workflow: 'technical', ...mine, ...clientWhere }, ...(q ? [{ OR: [{ siteName: { contains: q } }, { files: { contains: q } }] }] : []), cursorWhere(cursor, 'sf-upload')] },
      orderBy: order, take,
      select: {
        id: true, createdAt: true, status: true, siteName: true, files: true,
        requestedBy: true,
        client: { select: { name: true } },
        crawlRun: { select: { score: true } },
      },
    }),
    prisma.siteAudit.findMany({
      where: { AND: [{ seoOnly: false, ...mine, ...clientWhere }, ...(q ? [{ domain: { contains: q } }] : []), cursorWhere(cursor, 'site-ada')] },
      orderBy: order, take,
      select: {
        id: true, createdAt: true, domain: true, status: true, wcagLevel: true,
        summary: true, startedAt: true, completedAt: true, requestedBy: true,
        client: { select: { name: true } },
        crawlRuns: { where: { tool: 'ada-audit' }, select: { score: true } },
      },
    }),
    prisma.siteAudit.findMany({
      where: { AND: [{ seoOnly: true, ...mine, ...clientWhere }, ...(q ? [{ domain: { contains: q } }] : []), cursorWhere(cursor, 'site-seo')] },
      orderBy: order, take,
      select: {
        id: true, createdAt: true, domain: true, status: true,
        startedAt: true, completedAt: true, requestedBy: true,
        client: { select: { name: true } },
        crawlRuns: { where: { tool: 'seo-parser' }, select: { id: true, score: true } },
      },
    }),
    orphanRuns,
  ])

  const merged: RecentItem[] = [
    ...pages.map((p): RecentItem => ({
      type: 'page', id: p.id, createdAt: p.createdAt.toISOString(),
      label: p.url, href: `/ada-audit/${p.id}`,
      status: p.status, score: p.crawlRun?.score ?? pageScore(p.status, p.result, p.wcagLevel),
      startedAt: p.startedAt?.toISOString() ?? null,
      completedAt: p.completedAt?.toISOString() ?? null,
      clientName: p.client?.name ?? null, requestedBy: p.requestedBy, deletable: false,
    })),
    ...sessions.map((s): RecentItem => ({
      type: 'sf-upload', id: s.id, createdAt: s.createdAt.toISOString(),
      label: s.siteName ?? firstFile(s.files), href: `/seo-audits/results/${s.id}`,
      status: s.status,
      score: s.crawlRun?.score ?? null,
      startedAt: null, completedAt: null,
      clientName: s.client?.name ?? null, requestedBy: s.requestedBy, deletable: true,
    })),
    // Codex plan-fix 1: schedule-pruned seoOnly parents leave orphaned
    // live-scan runs — keep their history visible (parse-history parity).
    ...orphans.map((r): RecentItem => ({
      type: 'site-seo', id: r.id, createdAt: r.createdAt.toISOString(),
      label: r.domain ?? 'SEO scan', href: `/seo-audits/results/run/${r.id}`,
      status: r.status, score: r.score,
      startedAt: null, completedAt: null,
      clientName: r.client?.name ?? null, requestedBy: null, deletable: false,
    })),
    ...adaSites.map((s): RecentItem => ({
      type: 'site-ada', id: s.id, createdAt: s.createdAt.toISOString(),
      label: s.domain, href: `/ada-audit/site/${s.id}`,
      status: s.status, score: s.crawlRuns[0]?.score ?? siteScore(s.status, s.summary, s.wcagLevel),
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      clientName: s.client?.name ?? null, requestedBy: s.requestedBy, deletable: false,
    })),
    ...seoSites.map((s): RecentItem => ({
      type: 'site-seo', id: s.id, createdAt: s.createdAt.toISOString(),
      label: s.domain,
      // Complete + run-ready → straight to SEO results; otherwise the site
      // page hosts the poller/banner (C16 seoOnly behavior).
      href: s.status === 'complete' && s.crawlRuns[0]?.id
        ? `/seo-audits/results/run/${s.crawlRuns[0].id}`
        : `/ada-audit/site/${s.id}`,
      status: s.status, score: s.crawlRuns[0]?.score ?? null,
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
      clientName: s.client?.name ?? null, requestedBy: s.requestedBy, deletable: false,
    })),
  ].sort(compareItems)

  const items = merged.slice(0, limit)
  const last = items[items.length - 1]
  const nextCursor = merged.length > limit && last
    ? encodeRecentsCursor({ createdAt: Date.parse(last.createdAt), type: last.type, id: last.id })
    : null
  return { items, nextCursor }
}
```

(Note `fetchRecentsForOperator` is gone; `RecentItem` is now a flat shape with `label`/`href`/`deletable`.)

- [ ] **Step 4: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/recents-query.db.test.ts lib/ada-audit/recents-query.test.ts`
Expected: PASS. (Callers still broken — fixed in Tasks 7/8; `npm run lint` will fail until then, that's expected mid-stream.)

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/recents-query.ts lib/ada-audit/recents-query.test.ts lib/ada-audit/recents-query.db.test.ts
git commit -m "feat(recents): unified 4-source feed with stable cursor pagination + filters (C16)"
```

---

### Task 7: Recents API route — cursor/q/clientId params

**Files:**
- Modify: `app/api/ada-audit/recents/route.ts`
- Modify test: `app/api/ada-audit/recents/route.test.ts`

**Interfaces:**
- Produces: `GET /api/ada-audit/recents?scope=&limit=&cursor=&q=&clientId=` → `{ items: RecentItem[], nextCursor: string | null }`. Malformed cursor is treated as first page (decode → null), never a 500.

- [ ] **Step 1: Write the failing tests**

Update existing cases for the `{ items, nextCursor }` envelope, then add:

```ts
  it('C16: forwards cursor/q/clientId to fetchAllRecents and returns nextCursor', async () => {
    // mock fetchAllRecents (existing test file convention) to capture opts
    const res = await GET(new Request('http://x/api/ada-audit/recents?limit=3&cursor=123~site-ada~abc&q=foo&clientId=7'))
    expect(capturedOpts).toMatchObject({ limit: 3, q: 'foo', clientId: 7, cursor: { createdAt: 123, type: 'site-ada', id: 'abc' } })
    const body = await res.json()
    expect(body).toHaveProperty('nextCursor')
  })

  it('C16: malformed cursor is ignored (first page), clientId=unassigned passes through', async () => {
    await GET(new Request('http://x/api/ada-audit/recents?cursor=garbage&clientId=unassigned'))
    expect(capturedOpts).toMatchObject({ cursor: null, clientId: 'unassigned' })
  })
```

(Adopt the file's existing mocking style for `fetchAllRecents` and the cookie helpers — read it first; keep the three existing cases green with the new envelope.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/api/ada-audit/recents/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement — full route body**

```ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { AUTH_COOKIE_NAME, OPERATOR_NAME_COOKIE_NAME, getOperatorLabel } from '@/lib/auth'
import { fetchAllRecents, decodeRecentsCursor } from '@/lib/ada-audit/recents-query'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') === 'mine' ? 'mine' : 'all'
  const parsed = parseInt(url.searchParams.get('limit') ?? '', 10)
  const rawLimit = Number.isNaN(parsed) ? 100 : parsed
  const limit = Math.min(100, Math.max(1, rawLimit))
  // Malformed cursors decode to null → first page (harmless, never a 500).
  const cursor = decodeRecentsCursor(url.searchParams.get('cursor'))
  const q = url.searchParams.get('q')?.trim() || undefined
  const rawClient = url.searchParams.get('clientId')
  const clientId = rawClient === 'unassigned' ? ('unassigned' as const)
    : rawClient && /^\d+$/.test(rawClient) ? parseInt(rawClient, 10)
    : null

  let operator: string | undefined
  if (scope === 'mine') {
    const c = await cookies()
    operator = (await getOperatorLabel(c.get(AUTH_COOKIE_NAME)?.value, c.get(OPERATOR_NAME_COOKIE_NAME)?.value)) ?? undefined
    if (!operator) return NextResponse.json({ items: [], nextCursor: null })
  }
  return NextResponse.json(await fetchAllRecents({ limit, operator, cursor, q, clientId }))
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/api/ada-audit/recents/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ada-audit/recents/
git commit -m "feat(recents-api): cursor pagination + q/clientId filters (C16)"
```

---

### Task 8: `RecentsTable` — badges, delete, search, client filter, load more

**Files:**
- Rewrite: `components/ada-audit/RecentsTable.tsx`
- Modify test: `components/ada-audit/RecentsTable.test.tsx`
- Modify callers: `app/(app)/ada-audit/page.tsx` (:15, :29), `app/(app)/ada-audit/recents/page.tsx` (:12, :16), `components/ada-audit/AuditIndexTabs.tsx` (props + :126)

**Interfaces:**
- Consumes: Task 6 `RecentItem`/`RecentsPage`, Task 7 route params, `DELETE /api/parse/[sessionId]` (existing), `GET /api/clients` (existing, returns client list — check its exact shape in `HistoryList.tsx:87-108` and reuse).
- Produces: `RecentsTable` props `{ initialItems: RecentItem[]; initialNextCursor: string | null; initialScope: 'all' | 'mine'; operator: string | null; variant: 'home' | 'full' }`.
- Feature-parity rule (Codex fix #6): search, client filter, delete, and load-more render on `variant='full'` (`/ada-audit/recents` — the nav "Recents" destination). The compact home variant keeps only the All/Mine toggle + "See all recents" link.

- [ ] **Step 1: Write the failing tests**

Update the two existing tests' fixtures to the new item shape, e.g.:

```ts
const item = (over: Partial<RecentItem> = {}): RecentItem => ({
  type: 'site-ada', id: 'a1', createdAt: '2026-07-08T10:00:00.000Z', label: 'client-a.example',
  href: '/ada-audit/site/a1', status: 'complete', score: 92, startedAt: null, completedAt: null,
  clientName: 'Client A', requestedBy: 'Kevin Vogelgesang', deletable: false, ...over,
})
```

Add:

```tsx
  it('C16: renders the four type badges', () => {
    render(<RecentsTable initialItems={[
      item({ type: 'site-ada', id: '1' }),
      item({ type: 'site-seo', id: '2' }),
      item({ type: 'page', id: '3', label: 'https://a.example/p' }),
      item({ type: 'sf-upload', id: '4', deletable: true }),
    ]} initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    expect(screen.getByText('Site ADA')).toBeTruthy()
    expect(screen.getByText('Site SEO')).toBeTruthy()
    expect(screen.getByText('Single Page')).toBeTruthy()
    expect(screen.getByText('SF Upload')).toBeTruthy()
  })

  it('C16: row links use item.href', () => {
    render(<RecentsTable initialItems={[item({ type: 'site-seo', id: 's1', href: '/seo-audits/results/run/r9' })]}
      initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    expect(screen.getByRole('link', { name: 'client-a.example' }).getAttribute('href')).toBe('/seo-audits/results/run/r9')
  })

  it('C16: sf-upload rows delete via two-step confirm → DELETE /api/parse/:id', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true })))
    render(<RecentsTable initialItems={[item({ type: 'sf-upload', id: 'sess1', deletable: true })]}
      initialNextCursor={null} initialScope="all" operator={null} variant="full" />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/parse/sess1', expect.objectContaining({ method: 'DELETE' })))
    await waitFor(() => expect(screen.queryByText('client-a.example')).toBeNull())
  })

  it('C16: Load more appends the next page using nextCursor', async () => {
    const page2 = { items: [item({ id: 'b2', label: 'second-page.example' })], nextCursor: null }
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(page2)))
    render(<RecentsTable initialItems={[item({ id: 'a1' })]} initialNextCursor="123~site-ada~a1"
      initialScope="all" operator={null} variant="full" />)
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await waitFor(() => expect(screen.getByText('second-page.example')).toBeTruthy())
    expect(screen.getByText('client-a.example')).toBeTruthy() // appended, not replaced
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull() // nextCursor null → hidden
  })

  it('C16: home variant hides search/filter/delete/load-more', () => {
    render(<RecentsTable initialItems={[item({ type: 'sf-upload', deletable: true })]} initialNextCursor="1~page~x"
      initialScope="all" operator={null} variant="home" />)
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull()
  })
```

(The client-filter dropdown fetches `/api/clients` on mount for `variant='full'` — in tests, mock `fetch` accordingly or have the dropdown render lazily on first open; pick the same approach `HistoryList` used: `Promise.all` on mount. Mock fetch in a `beforeEach` for the full-variant tests.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run components/ada-audit/RecentsTable.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement — rewrite `RecentsTable.tsx`**

Keep the existing visual system (same table classes, `ClientDate`, `formatDuration`, orange scope pills, `seqRef`/`AbortController` stale-response guard). Structure:

```tsx
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { RecentItem, RecentType } from '@/lib/ada-audit/recents-query'
import { ClientDate } from '@/components/ClientDate'
import { formatDuration, formatDurationHover } from '@/lib/ada-audit/duration'

type Scope = 'all' | 'mine'
interface Props {
  initialItems: RecentItem[]
  initialNextCursor: string | null
  initialScope: Scope
  operator: string | null
  variant: 'home' | 'full'
}

const HOME_LIMIT = 10
const PAGE_LIMIT = 50

const TYPE_BADGES: Record<RecentType, { label: string; className: string }> = {
  'site-ada': { label: 'Site ADA', className: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300' },
  'site-seo': { label: 'Site SEO', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  page: { label: 'Single Page', className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  'sf-upload': { label: 'SF Upload', className: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60' },
}
```

State: `items`, `nextCursor`, `scope`, `qInput` (+ 300 ms debounce into `q` via a `useEffect` timer), `clientFilter: string` (`''` | `'unassigned'` | numeric string), `clients: { id: number; name: string }[]`, `loading`, `loadingMore`, `confirmDeleteId`, `deletingId`.

One `refetch(reset: boolean)` callback builds the query string:

```ts
  const buildParams = useCallback((cursor?: string | null) => {
    const p = new URLSearchParams({ scope, limit: String(variant === 'home' ? HOME_LIMIT : PAGE_LIMIT) })
    if (q) p.set('q', q)
    if (clientFilter) p.set('clientId', clientFilter)
    if (cursor) p.set('cursor', cursor)
    return p
  }, [scope, q, clientFilter, variant])
```

- Scope/filter/search change → `fetch('/api/ada-audit/recents?' + buildParams())`, REPLACE items + nextCursor (with the existing seq/abort guard).
- Load more → `fetch('/api/ada-audit/recents?' + buildParams(nextCursor))`, APPEND items, replace nextCursor.
- Full variant only: on mount, `fetch('/api/clients')` for the dropdown (reuse `HistoryList`'s response-shape handling); render search input + select + Load more button + delete cell. Controls row (full variant), styled like the scope pills:

```tsx
        {variant === 'full' && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              type="search" value={qInput} onChange={(e) => setQInput(e.target.value)}
              placeholder="Search domain, URL or file…"
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card text-[12px] font-body text-navy dark:text-white placeholder:text-navy/40 dark:placeholder:text-white/40 w-64"
            />
            <select
              value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
              aria-label="Filter by client"
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card text-[12px] font-body text-navy dark:text-white"
            >
              <option value="">All clients</option>
              <option value="unassigned">Unassigned</option>
              {clients.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </div>
        )}
```

Row changes: Type cell renders `TYPE_BADGES[it.type]`; link cell uses `it.href` + `it.label`; append an Actions cell (full variant) rendering, for `it.deletable`:

```tsx
                  {variant === 'full' && (
                    <td className="py-2.5 pr-0 text-right">
                      {it.deletable && (confirmDeleteId === it.id ? (
                        <span className="inline-flex gap-1">
                          <button type="button" onClick={() => void doDelete(it.id)} disabled={deletingId === it.id}
                            className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-600 text-white disabled:opacity-50">
                            {deletingId === it.id ? '…' : 'Confirm'}
                          </button>
                          <button type="button" onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-0.5 rounded text-[11px] text-navy/60 dark:text-white/60 border border-gray-200 dark:border-navy-border">Cancel</button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(it.id)} aria-label={`Delete ${it.label}`}
                          className="px-2 py-0.5 rounded text-[11px] text-red-600 dark:text-red-400 hover:underline">Delete</button>
                      ))}
                    </td>
                  )}
```

```ts
  const doDelete = useCallback(async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/parse/${id}`, { method: 'DELETE' })
      if (res.ok) setItems((prev) => prev.filter((i) => !(i.type === 'sf-upload' && i.id === id)))
    } catch (e) { console.warn('[RecentsTable] delete failed:', e) }
    finally { setDeletingId(null); setConfirmDeleteId(null) }
  }, [])
```

Load more (full variant, below the table):

```tsx
        {variant === 'full' && nextCursor && (
          <div className="mt-3 text-center">
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore}
              className="px-4 py-1.5 rounded-lg border border-gray-200 dark:border-navy-border text-[12px] font-body text-navy/70 dark:text-white/70 disabled:opacity-50">
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
```

Caller updates:
- `app/(app)/ada-audit/page.tsx:15` → `const { items: recentItems, nextCursor } = await fetchAllRecents({ limit: 10, operator: operator ?? undefined })`; pass `initialNextCursor={null}` into `AuditIndexTabs` → `RecentsTable` (home variant never pages) — simplest: `AuditIndexTabs` gains `initialNextCursor: string | null` prop threaded to `RecentsTable`; pass `null` from the page.
- `app/(app)/ada-audit/recents/page.tsx:12` → `const { items, nextCursor } = await fetchAllRecents({ limit: 50 })`; `<RecentsTable initialItems={items} initialNextCursor={nextCursor} initialScope="all" operator={operator} variant="full" />` (check how that page currently gets `operator` — mirror `app/(app)/ada-audit/page.tsx` if absent).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run components/ada-audit/RecentsTable.test.tsx components/ada-audit/AuditIndexTabs.test.tsx && npm run lint`
Expected: PASS; lint green again (all `fetchAllRecents` callers updated).

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/RecentsTable.tsx components/ada-audit/RecentsTable.test.tsx components/ada-audit/AuditIndexTabs.tsx "app/(app)/ada-audit/page.tsx" "app/(app)/ada-audit/recents/page.tsx"
git commit -m "feat(recents-ui): 4-type badges, session delete, search/client filter, load more (C16)"
```

---

### Task 9: seoOnly behavior on `/ada-audit/site/[id]`

**Files:**
- Create: `app/(app)/ada-audit/site/[id]/seo-only-view.ts`
- Test: `app/(app)/ada-audit/site/[id]/seo-only-view.test.ts` (new)
- Delete: `app/(app)/ada-audit/site/[id]/seo-only-redirect.ts` + `seo-only-redirect.test.ts`
- Modify: `app/(app)/ada-audit/site/[id]/page.tsx` (remove :46-49; insert seoOnly branch after the error branch :133, before summary resolution :136)

**Interfaces:**
- Produces: `resolveSeoOnlyView(audit: { seoOnly: boolean; status: string }, liveScanRunId: string | null): SeoOnlyView` where `SeoOnlyView = { kind: 'none' } | { kind: 'redirect'; href: string } | { kind: 'banner' }`.
- Consumes: `classifySeoPhase` + `getLatestSeoVerifyJob` (already imported by the page), `SeoPhaseBanner` (already imported), compound-unique CrawlRun lookup `{ siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } }`.

- [ ] **Step 1: Write the failing test**

`app/(app)/ada-audit/site/[id]/seo-only-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveSeoOnlyView } from './seo-only-view'

describe('resolveSeoOnlyView (C16)', () => {
  it('non-seoOnly audits are untouched', () => {
    expect(resolveSeoOnlyView({ seoOnly: false, status: 'complete' }, 'r1')).toEqual({ kind: 'none' })
  })
  it('transient seoOnly audits render in place (poller branch handles them)', () => {
    for (const status of ['queued', 'pending', 'running', 'pdfs-running', 'lighthouse-running']) {
      expect(resolveSeoOnlyView({ seoOnly: true, status }, null)).toEqual({ kind: 'none' })
    }
  })
  it('error/cancelled seoOnly use the shared terminal branches', () => {
    expect(resolveSeoOnlyView({ seoOnly: true, status: 'error' }, null)).toEqual({ kind: 'none' })
    expect(resolveSeoOnlyView({ seoOnly: true, status: 'cancelled' }, null)).toEqual({ kind: 'none' })
  })
  it('complete + live-scan run → redirect to the SEO results run page', () => {
    expect(resolveSeoOnlyView({ seoOnly: true, status: 'complete' }, 'r1'))
      .toEqual({ kind: 'redirect', href: '/seo-audits/results/run/r1' })
  })
  it('complete without a run → building banner', () => {
    expect(resolveSeoOnlyView({ seoOnly: true, status: 'complete' }, null)).toEqual({ kind: 'banner' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run "app/(app)/ada-audit/site/[id]/seo-only-view.test.ts"`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`seo-only-view.ts`:

```ts
// C16: seoOnly audits live on this page while transient (SiteAuditPoller) and
// hand off to the SEO results run page once the live-scan run exists. Pure
// decision helper (no server-only imports) so the branch is unit-testable.
export type SeoOnlyView =
  | { kind: 'none' }
  | { kind: 'redirect'; href: string }
  | { kind: 'banner' }

export function resolveSeoOnlyView(
  audit: { seoOnly: boolean; status: string },
  liveScanRunId: string | null,
): SeoOnlyView {
  if (!audit.seoOnly || audit.status !== 'complete') return { kind: 'none' }
  if (liveScanRunId) return { kind: 'redirect', href: `/seo-audits/results/run/${liveScanRunId}` }
  return { kind: 'banner' }
}
```

`page.tsx`: delete lines 46-49 (the `seoOnlyRedirectTarget` call) and the import at :23; add `import { resolveSeoOnlyView } from './seo-only-view'`. Delete `seo-only-redirect.ts` + its test file. Then insert AFTER the error branch (:133) and BEFORE the summary resolution (:136):

```tsx
  // C16 (Codex fix #4): seoOnly branch BEFORE ADA summary resolution — a
  // seoOnly audit has neither an ADA summary nor an ada-audit CrawlRun, so
  // the flow below would dead-end at "Result data unavailable". Transient
  // seoOnly audits already rendered the poller above; error/cancelled used
  // the shared terminal branches.
  if (audit.seoOnly) {
    const liveRun = await prisma.crawlRun.findUnique({
      where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'seo-parser' } },
      select: { id: true },
    })
    const view = resolveSeoOnlyView(audit, liveRun?.id ?? null)
    if (view.kind === 'redirect') redirect(view.href)
    const seoPhase = classifySeoPhase({ liveScanRunId: null, job: await getLatestSeoVerifyJob(audit.id) })
    // Codex plan-fix 8: SeoPhaseBanner owns the phase-specific copy — the
    // heading must not promise "building" when the verifier failed.
    const building = seoPhase.state === 'queued' || seoPhase.state === 'running'
    return (
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {breadcrumb}
        <div>
          <h1 className="font-display font-bold text-[24px] text-navy dark:text-white">{audit.domain}</h1>
          <p className="text-[13px] font-body text-navy/60 dark:text-white/60 mt-1">
            {building ? 'SEO scan complete — verifying links and building results. Reload to check progress.' : 'SEO scan'}
          </p>
        </div>
        <SeoPhaseBanner phase={seoPhase} />
      </main>
    )
  }
```

(`breadcrumb` is the existing JSX variable built at :51-57 and used by the other status branches — reuse it verbatim. If `SeoPhaseBanner` returns `null` for a state, the copy line above still explains the page.) Transient seoOnly audits now flow into the EXISTING poller branch at :60-79 — no change needed there; when the poller's `router.refresh()` fires on completion, this server component re-runs and issues the redirect once the run exists (C17 matures this).

- [ ] **Step 4: Run tests**

Run: `npx vitest run "app/(app)/ada-audit/site/[id]" && npm run lint`
Expected: helper tests PASS; deleted-test references gone; lint green.

- [ ] **Step 5: Commit**

```bash
git add -A "app/(app)/ada-audit/site/[id]"
git commit -m "feat(site-audit): seoOnly audits render poller/banner on-page, redirect to run when ready (C16)"
```

---

### Task 10: Link-producer sweep — everything points at `/ada-audit/site/[id]`

**Files (all Modify):**
- `components/ada-audit/SiteAuditForm.tsx` (:200, :262) + test (:57, :74)
- `components/widgets/QuickSiteAuditWidget.tsx` (:29-30) + test (:35, :48)
- `components/widgets/LiveNowWidget.tsx` (:40) + test (:55-56)
- `components/ada-audit/QueueMemberRow.tsx` (:60) + test (:50-52)
- `components/ada-audit/DashboardQueueStatus.tsx` (:131) + test (:60-61)
- `lib/services/client-dashboard.ts` (:194-207) + any test asserting the seoOnly timeline href
- `components/clients/ScheduledScansCard.tsx` (:197-199) + test if it asserts hrefs
- (footer already done in Task 3)

**Interfaces:**
- Rule: producers link to `/ada-audit/site/[id]` unconditionally — the site page is the router for complete seoOnly audits (Task 9). Exception: `ScheduledScansCard` keeps its DIRECT run-page link when it already has `liveRunId` (fewer hops), falling back to the site page (never `?scan=`).

- [ ] **Step 1: Update the tests first (failing)**

In each listed test file, change the seoOnly expectation from `/seo-audits?scan=<id>` / `'/seo-audits'` to `/ada-audit/site/<id>`. Example (`SiteAuditForm.test.tsx:57`): `expect(push).toHaveBeenCalledWith('/ada-audit/site/A1')`. For `ScheduledScansCard`: seoOnly + liveRunId → `/seo-audits/results/run/<runId>`; seoOnly without liveRunId → `/ada-audit/site/<auditId>`.

Run: `npx vitest run components/ada-audit/SiteAuditForm.test.tsx components/widgets components/ada-audit/QueueMemberRow.test.tsx components/ada-audit/DashboardQueueStatus.test.tsx components/clients`
Expected: FAIL on the changed assertions.

- [ ] **Step 2: Implement each producer**

- `SiteAuditForm.tsx` both handlers: `const dest = \`/ada-audit/site/${data.id}\`` (drop the `intent === 'seo'` ternary).
- `QuickSiteAuditWidget.tsx`: drop the `seo` const (:29); `router.push(\`/ada-audit/site/${data.id}\`)` (keep the 202/409 handling intact — both paths use the same dest).
- `LiveNowWidget.tsx`: `const href = \`/ada-audit/site/${active.id}\``.
- `QueueMemberRow.tsx`: `<Link href={\`/ada-audit/site/${member.id}\`} …>`.
- `DashboardQueueStatus.tsx`: `href={\`/ada-audit/site/${active.id}\`}`.
- `lib/services/client-dashboard.ts` timeline (replace the C11 comment + href):

```ts
  for (const a of siteAudits) {
    // C16: seoOnly audits now live on /ada-audit/site/[id] (poller while
    // transient; server redirect to the SEO run page when complete) — one
    // link target for every site audit. Title keeps the SEO tag.
    const scheduledSuffix = a.scheduleId ? ' · scheduled' : ''
    timeline.push({
      type: 'site-audit', id: a.id,
      title: `${a.domain}${a.seoOnly ? ' · SEO scan' : ''}${scheduledSuffix}`,
      status: a.status,
      date: a.createdAt.toISOString(),
      href: `/ada-audit/site/${a.id}`,
      stat: a.pagesTotal > 0 ? `${a.pagesTotal} pages` : null,
    })
  }
```

- `ScheduledScansCard.tsx` (:197-199):

```ts
                  href={s.seoOnly && s.liveRunId
                    ? `/seo-audits/results/run/${s.liveRunId}`
                    : `/ada-audit/site/${s.lastRun.id}`}
```

- [ ] **Step 3: Run tests**

Run: same vitest command as Step 1, plus `npx vitest run lib/services` (client-dashboard tests).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/SiteAuditForm.tsx components/ada-audit/SiteAuditForm.test.tsx components/widgets components/ada-audit/QueueMemberRow.tsx components/ada-audit/QueueMemberRow.test.tsx components/ada-audit/DashboardQueueStatus.tsx components/ada-audit/DashboardQueueStatus.test.tsx lib/services/client-dashboard.ts components/clients/ScheduledScansCard.tsx
git commit -m "feat(links): all seoOnly producers point at /ada-audit/site/[id] (C16)"
```

(Add any touched test files the sweep finds — e.g. `lib/services/client-dashboard*.test.ts`.)

---

### Task 11: `/seo-audits` index 308 + retire SeoScanForm/SeoAuditTabs/HistoryList

**Files:**
- Rewrite: `app/(app)/seo-audits/page.tsx`
- Test: `app/(app)/seo-audits/page.test.ts` (new)
- Delete: `components/seo-parser/SeoScanForm.tsx`, `components/seo-parser/SeoScanForm.test.tsx`, `components/seo-parser/SeoAuditTabs.tsx`, `components/seo-parser/SeoAuditTabs.test.tsx`, `components/seo-parser/HistoryList.tsx`
- KEEP: `app/api/parse/history/route.ts` (+ its tests), `SeoUploadCard` (+ test), everything under `app/(app)/seo-audits/results/`, `app/(app)/seo-audits/diff/`, share routes.

- [ ] **Step 1: Write the failing test**

`app/(app)/seo-audits/page.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import SeoAuditsIndexPage from './page'

describe('/seo-audits index (C16)', () => {
  it('permanent-redirects (308) to /ada-audit', () => {
    let digest = ''
    try { SeoAuditsIndexPage() } catch (e) { digest = (e as { digest?: string }).digest ?? '' }
    expect(digest).toContain('NEXT_REDIRECT')
    expect(digest).toContain('/ada-audit')
    expect(digest).toContain('308')
  })
})
```

Run: `npx vitest run "app/(app)/seo-audits/page.test.ts"` → FAIL (page is async and renders JSX today; the digest assertion won't match).

- [ ] **Step 2: Implement**

`app/(app)/seo-audits/page.tsx` — full replacement:

```tsx
import { permanentRedirect } from 'next/navigation'

// C16: the SEO Audits index folded into the merged "Audits" section. 308 via
// permanentRedirect() (NOT redirect(), which emits 307) — precedent: the
// /seo-parser → /seo-audits renames in next.config.ts. Only THIS index
// redirects; /seo-audits/results/*, share and /seo-audits/diff keep their
// URLs (memo/history links must not break).
export default function SeoAuditsIndexPage() {
  permanentRedirect('/ada-audit')
}
```

Delete the five component files. Then verify nothing still imports them:

```bash
rg -l "SeoScanForm|SeoAuditTabs|HistoryList" app components lib
```

Expected: no hits (if a hit appears, fix that importer in this task — do not leave dead imports).

- [ ] **Step 3: Sweep for dead references**

```bash
rg -n "seo-audits\?scan=" app components lib
rg -n "seo-scan-id" app components lib
```

Expected: zero hits for both (`?scan=` producers died in Task 10; `seo-scan-id` sessionStorage lived only in SeoScanForm).

- [ ] **Step 4: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npm test`
Expected: full suite PASS (deleted tests gone, no orphan imports).

- [ ] **Step 5: Commit**

```bash
git add -A "app/(app)/seo-audits/page.tsx" "app/(app)/seo-audits/page.test.ts" components/seo-parser
git commit -m "feat(seo-audits): index 308s to /ada-audit; retire SeoScanForm/SeoAuditTabs/HistoryList (C16)"
```

---

### Task 12: Gates, browser verification, PR, merge, deploy, prod verify

**Files:** none new (verification + ship).

- [ ] **Step 1: Full gates**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```

Expected: all green. Fix anything that fails before proceeding.

- [ ] **Step 2: Authed browser verification (dev server, Playwright MCP)**

`npm run dev`, then verify (house convention — client domains only if any scan is run; none should be needed):
1. Sidebar shows ONE "Audits" entry (Run an audit · Audit queue · Recents · Compare crawls); no "SEO Audits" entry; footer shows one "Audits" link.
2. `/ada-audit` → Site Audit tab first + selected; Scan Type = SEO reveals the collapsed SF section; expanding shows the upload card; dark mode toggles clean on the new elements.
3. `/ada-audit/recents` → badges render; search + client filter + Load more work; an sf-upload row deletes with confirm.
4. `/seo-audits` → lands on `/ada-audit` (network tab shows 308); `/seo-audits/diff` and an existing `/seo-audits/results/*` URL still render, Topbar titled "Audits", sidebar Audits group active with "Compare crawls" highlighted on /seo-audits/diff.
5. An existing seoOnly complete audit id → `/ada-audit/site/[id]` redirects to its run results page.

- [ ] **Step 3: PR**

```bash
git push -u origin feat/c16-audit-consolidation
gh pr create --title "feat: C16 audit consolidation — full merge of SEO Audits into Audits" --body "…(summary of the scope bullets + spec link + gates evidence)…"
```

- [ ] **Step 4: Merge (rule 1 — gates re-ran green this session), deploy, prod verify**

```bash
gh pr merge --squash   # or the house default (check recent PRs: merge commits used)
git checkout main && git pull
ssh $PROD_SSH "~/deploy.sh"
```

Post-deploy verification (required):

```bash
ssh $PROD_SSH "curl -s localhost:3000/api/health"                       # {"status":"ok",…}
ssh $PROD_SSH "cd $APP_HOME && npx prisma migrate status | tail -3"  # session_requested_by applied
ssh $PROD_SSH "pm2 status seo-tools | head -8"                          # online, 0 unstable restarts
```

Then an authed browser spot-check against prod (Kevin's session or Playwright with the operator cookie): `/seo-audits` → `/ada-audit`, recents badges render, one fresh SF upload stamps `requestedBy` (visible under Mine). Do NOT run site scans against non-client domains.

---

### Task 13: Docs ritual (same-commit tracker + handoff) + archive

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`, `docs/superpowers/todos/HANDOFF-improvement-roadmap.md`
- Move: `docs/superpowers/plans/2026-07-08-c16-audit-consolidation.md` → `docs/superpowers/archive/plans/`

- [ ] **Step 1: CLAUDE.md updates**

- Tools table: replace the `/seo-audits` and `/ada-audit` rows with one "Audits" row at `/ada-audit` noting "SF CSV uploads + URL scans merged here; `/seo-audits/results/*`, share and `/seo-audits/diff` URLs retained; `/seo-audits` index 308s".
- Site-audit phase model bullet: update the C11 sentence "ADA surfaces exclude-or-SEO-label seoOnly rows and never deep-link them to `/ada-audit/site/[id]`" → C16 behavior: `/ada-audit/site/[id]` hosts seoOnly transient progress (poller) and server-redirects complete seoOnly audits to the run results page; unified recents shows them as "Site SEO".
- Key files: update the recents-query line (5-source cursor-paginated unified feed) and note `Session.requestedBy`.
- D7 bullet (Codex plan-fix 9): the notification checkbox description names `SeoScanForm` — remove it (`SiteAuditForm` alone carries the checkbox now; behavior unchanged).

- [ ] **Step 2: Tracker + handoff (one commit)**

- Tracker: tick C16's checkbox → `[x]` with a dated status-log line at the TOP of the status log (PR #, merge SHA, gates evidence, deploy + prod-verify results, notable decisions: aliases approach, orphan-run exclusion, cursor design).
- Handoff: rewrite for C17 (progress maturation) as the next item, with the paste-in prompt updated (C16 shipped; C17 scope from spec §P2; carry the C18 triage-`checkedBy` reminder and the Kevin-eyeball leftover).
- `git mv docs/superpowers/plans/2026-07-08-c16-audit-consolidation.md docs/superpowers/archive/plans/`

```bash
git add CLAUDE.md docs/superpowers
git commit -m "docs(c16): audit consolidation shipped — tracker + handoff, plan archived"
git push
```

- [ ] **Step 3: End the chat reply with the handoff's paste-in prompt in a code block.**

---

## Self-Review (done at authoring time)

- **Spec §P1 coverage:** nav+naming (T3, T4 copy), hidden ownership of `/seo-audits/*` via aliases (T3 — spec's explicitly-offered alternative to a hidden entry, chosen for sidebar active-state correctness), footer (T3), tab order/default/label + deep-link params (T4), SF upload section (T5), unified recents incl. workflow filter, cursor order, page-two test, Mine semantics, delete/search/client-filter parity (T6-T8), `Session.requestedBy` create-only (T1-T2), 308 index redirect with subpaths untouched (T11), seoOnly branch placement + poller/banner/redirect (T9), all 8 producers + SeoScanForm retirement (T10-T11, footer in T3), tests per batch-level spec section (each task), gates + authed browser verification (T12), docs ritual (T13).
- **Codex review 2026-07-08: accept with named fixes ×9, ALL APPLIED** — (1) orphaned live-scan runs ARE a 5th recents source (my original exclusion rationale was factually wrong: C11 PR 2a schedules persist `seoOnly`); (2) no `Session.result` blob read in the list path; (3) one explicit href rule (direct run link when the id is in hand, site page otherwise); (4) cursor decode rejects non-safe-integer / out-of-Date-range timestamps + full order assertion in the pagination test; (5) pagination fixtures isolated by dedicated operator + cleanup; (6) upload test must copy `route.test.ts`'s Content-Length/UPLOADS_DIR handling; (7) no jest-dom matchers, `SidebarNav.test.tsx` updated with alias-active coverage; (8) seoOnly banner heading conditioned on phase state; (9) CLAUDE.md D7 bullet drops `SeoScanForm`.
- **Accepted judgment calls:** aliases instead of a hidden registry entry (Codex: sound); search/client-filter/delete/load-more on the full variant only (home stays compact — parity lives at `/ada-audit/recents`); flat `RecentItem` with server-computed `href`.
- **Type consistency:** `RecentItem`/`RecentsCursor`/`RecentsPage` defined once in T6, consumed by T7/T8 with matching names; `resolveSeoOnlyView` signature consistent between T9 test and implementation; `initialNextCursor` prop added in T8 and pre-declared in T4's test note.
