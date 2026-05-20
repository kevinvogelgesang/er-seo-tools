# ADA Audit — Operator "Requested by" Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the operator's first name at login as a plain-text `er-operator-name` cookie and surface it as a "Requested by" column in the Recent Page Audits and Recent Site Audits history tables. No user accounts, no permissions — just enough attribution for the team to see at a glance who kicked off a given run.

**Architecture:** A free-text cookie is written by the login route on successful authentication (1 year max-age) and read server-side whenever a new audit is created. Both `AdaAudit` and `SiteAudit` gain a nullable `requestedBy String?` column. The login page server-component pre-fills the input from the existing cookie via `next/headers`. `enqueueAudit` is refactored to take an options object for its optional args so the positional contract stays stable. Historical rows are backfilled to `"Testing"`; new audits with no cookie store `null` and render `—`.

**Tech Stack:** Next.js 15 App Router · TypeScript · Prisma + SQLite · vitest · Node 22

**Companion spec:** `docs/superpowers/specs/2026-05-20-ada-requested-by-name-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `requestedBy String?` to `AdaAudit` and `SiteAudit` |
| `prisma/migrations/<ts>_add_requested_by/migration.sql` | Create | Generated `ALTER TABLE ... ADD COLUMN` for both tables + manually appended backfill UPDATEs |
| `lib/auth.ts` | Modify | Export `OPERATOR_NAME_COOKIE_NAME` and `OPERATOR_NAME_MAX_AGE` constants |
| `app/login/page.tsx` | Modify | Name input above password, pre-filled via `cookies()` from `next/headers` |
| `app/api/auth/login/route.ts` | Modify | Read + sanitize `operatorName` from `formData`; set or delete `er-operator-name` cookie |
| `app/api/auth/login/route.test.ts` | Create | Cookie set/delete/trim+cap tests |
| `lib/ada-audit/types.ts` | Modify | Add `requestedBy: string \| null` to `AuditListItem` and `SiteAuditDetail` |
| `lib/ada-audit/queue-manager.ts` | Modify | Refactor `enqueueAudit` to options-object signature; persist `requestedBy` |
| `lib/ada-audit/queue-request.ts` | Modify | Add `requestedBy?: string \| null` to `QueueRequestInput`; forward to `enqueueAudit` |
| `lib/ada-audit/queue-request.test.ts` | Modify | Update for new `enqueueAudit` signature |
| `lib/ada-audit/queue-manager.test.ts` | Modify | Assert `requestedBy` is persisted on the `SiteAudit` row |
| `app/api/ada-audit/route.ts` | Modify | POST reads cookie → `prisma.adaAudit.create`; GET includes `requestedBy` in `items.map` |
| `app/api/ada-audit/route.test.ts` | Create | Cookie present/absent on POST; field present on GET |
| `app/api/site-audit/route.ts` | Modify | POST reads cookie → `QueueRequestInput`; GET includes `requestedBy` in `items.map` |
| `app/api/site-audit/route.test.ts` | Create | Cookie threaded through to `queueSiteAuditRequest`; field present on GET |
| `app/api/site-audit/[id]/route.ts` | Modify | Include `requestedBy` in detail response (shared `SiteAuditDetail` contract) |
| `app/api/site-audit/bulk-queue/route.ts` | Modify | Accept `NextRequest`, read cookie, forward `requestedBy` to every created audit |
| `components/ada-audit/AuditHistory.tsx` | Modify | Add `Requested by` column between Client and Score |
| `components/ada-audit/SiteAuditHistory.tsx` | Modify | Add `Requested by` column between Client and Pages |

---

### Task 1: Branch + working tree

**Files:** none

- [ ] **Step 1: Pull latest main**

```bash
git checkout main && git pull origin main
```

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feat/ada-requested-by-name
```

---

### Task 2: Schema migration + backfill

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_add_requested_by/migration.sql`

**Why first:** Every downstream task depends on the column existing. The Prisma client must be regenerated before TypeScript will accept `requestedBy` in `prisma.*.create` calls.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Locate the `AdaAudit` model and add the field (place it near `clientId` / `wcagLevel` for grouping with metadata fields):

```prisma
requestedBy   String?   // null on child rows; set on standalone page audits
```

Locate the `SiteAudit` model and add the same field:

```prisma
requestedBy   String?   // operator name from er-operator-name cookie at creation time
```

No index — the column is only `SELECT`-ed via existing paginated `findMany` calls.

- [ ] **Step 2: Create the migration WITHOUT applying it yet**

```bash
npx prisma migrate dev --create-only --name add_requested_by
```

The `--create-only` flag generates `prisma/migrations/<ts>_add_requested_by/migration.sql` (two `ALTER TABLE ... ADD COLUMN "requestedBy" TEXT` statements) **without** applying it to the local DB. This lets us append the backfill SQL before the migration ever runs, so it's exercised end-to-end on first apply (and in production via `prisma migrate deploy`).

- [ ] **Step 3: Append the backfill UPDATEs to the generated migration**

Open the newly generated `migration.sql` and append:

```sql
-- Backfill: mark all pre-feature audits as "Testing"
UPDATE "SiteAudit" SET "requestedBy" = 'Testing' WHERE "requestedBy" IS NULL;
UPDATE "AdaAudit"  SET "requestedBy" = 'Testing'
  WHERE "requestedBy" IS NULL AND "siteAuditId" IS NULL;
```

Child `AdaAudit` rows (`siteAuditId IS NOT NULL`) are intentionally excluded — they never appear in a history list.

- [ ] **Step 4: Apply the (now-complete) migration**

```bash
npx prisma migrate dev
```

Without flags, `migrate dev` applies any pending migrations. This is the single command that runs both the column-add and the backfill on the local DB, mirroring exactly what `migrate deploy` will do in production.

- [ ] **Step 5: Verify schema + backfill**

```bash
DATABASE_URL='file:./local-dev.db' sqlite3 prisma/local-dev.db ".schema SiteAudit" | grep requestedBy
DATABASE_URL='file:./local-dev.db' sqlite3 prisma/local-dev.db ".schema AdaAudit" | grep requestedBy
DATABASE_URL='file:./local-dev.db' sqlite3 prisma/local-dev.db "SELECT COUNT(*) FROM SiteAudit WHERE requestedBy = 'Testing';"
```

Expected: each schema dump shows `"requestedBy" TEXT`; the count matches the number of pre-feature site audits in the local DB.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(ada-audit): add requestedBy column to AdaAudit + SiteAudit with backfill"
```

---

### Task 3: Export auth constants

**Files:**
- Modify: `lib/auth.ts`

- [ ] **Step 1: Add the exports**

Append to `lib/auth.ts` (place near other exported constants):

```typescript
export const OPERATOR_NAME_COOKIE_NAME = 'er-operator-name'
export const OPERATOR_NAME_MAX_AGE = 31536000 // 1 year, in seconds
```

- [ ] **Step 2: Typecheck**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/auth.ts
git commit -m "feat(auth): export OPERATOR_NAME_COOKIE_NAME and max-age constants"
```

---

### Task 4: Login route — sanitize, set, delete cookie (TDD)

**Files:**
- Modify: `app/api/auth/login/route.ts`
- Create: `app/api/auth/login/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/auth/login/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    verifyPassword: vi.fn(),
    signSession: vi.fn(() => 'signed.session.token'),
  }
})

const { verifyPassword } = await import('@/lib/auth')
const { POST } = await import('./route')

function formRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields)
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

beforeEach(() => {
  vi.mocked(verifyPassword).mockReset()
  vi.mocked(verifyPassword).mockResolvedValue(true)
})

describe('POST /api/auth/login — operator name cookie', () => {
  it('sets er-operator-name cookie when operatorName is non-empty', async () => {
    const res = await POST(formRequest({ password: 'pw', operatorName: 'Kevin' }))
    const cookie = res.cookies.get('er-operator-name')
    expect(cookie?.value).toBe('Kevin')
    expect(cookie?.maxAge).toBe(31536000)
    expect(cookie?.sameSite).toBe('lax')
  })

  it('deletes er-operator-name cookie when operatorName is empty', async () => {
    const res = await POST(formRequest({ password: 'pw', operatorName: '' }))
    // Next sets a delete via Max-Age=0 / empty value
    const setCookie = res.headers.get('set-cookie') ?? ''
    // Next.js delete-cookie emits `er-operator-name=; Path=/; Expires=Thu, 01 Jan 1970 …`
    expect(setCookie).toMatch(/er-operator-name=;.*Expires=Thu, 01 Jan 1970/i)
  })

  it('deletes er-operator-name cookie when operatorName is absent', async () => {
    const res = await POST(formRequest({ password: 'pw' }))
    const setCookie = res.headers.get('set-cookie') ?? ''
    // Next.js delete-cookie emits `er-operator-name=; Path=/; Expires=Thu, 01 Jan 1970 …`
    expect(setCookie).toMatch(/er-operator-name=;.*Expires=Thu, 01 Jan 1970/i)
  })

  it('trims whitespace and caps at 64 chars', async () => {
    const long = '   ' + 'a'.repeat(80) + '   '
    const res = await POST(formRequest({ password: 'pw', operatorName: long }))
    const cookie = res.cookies.get('er-operator-name')
    expect(cookie?.value).toBe('a'.repeat(64))
  })

  it('treats whitespace-only input as empty (deletes cookie)', async () => {
    const res = await POST(formRequest({ password: 'pw', operatorName: '     ' }))
    const setCookie = res.headers.get('set-cookie') ?? ''
    // Next.js delete-cookie emits `er-operator-name=; Path=/; Expires=Thu, 01 Jan 1970 …`
    expect(setCookie).toMatch(/er-operator-name=;.*Expires=Thu, 01 Jan 1970/i)
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run app/api/auth/login/route.test.ts
```

Expected: FAIL — route does not currently touch `er-operator-name`.

- [ ] **Step 3: Wire the cookie in `app/api/auth/login/route.ts`**

After the existing `verifyPassword` success path (where the session cookie is set on `response`), add:

```typescript
import { OPERATOR_NAME_COOKIE_NAME, OPERATOR_NAME_MAX_AGE } from '@/lib/auth'

// …inside POST, after auth success and before `return response`:
const rawName = formData.get('operatorName')
const sanitized = typeof rawName === 'string' ? rawName.trim().slice(0, 64) : ''

if (sanitized) {
  response.cookies.set({
    name: OPERATOR_NAME_COOKIE_NAME,
    value: sanitized,
    path: '/',
    maxAge: OPERATOR_NAME_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
} else {
  response.cookies.delete(OPERATOR_NAME_COOKIE_NAME)
}
```

Rationale for the delete branch: the login response is the only response that touches the cookie. Omitting it on empty input would preserve a stale value from a prior session — the wrong default for "operator removed their name."

- [ ] **Step 4: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run app/api/auth/login/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/login/route.ts app/api/auth/login/route.test.ts
git commit -m "feat(auth): set/delete er-operator-name cookie on login"
```

---

### Task 5: Login page UI — name input pre-filled from cookie

**Files:**
- Modify: `app/login/page.tsx`

- [ ] **Step 1: Read existing cookie and add input**

Open `app/login/page.tsx`. At the top, import the helper and the constant:

```typescript
import { cookies } from 'next/headers'
import { OPERATOR_NAME_COOKIE_NAME } from '@/lib/auth'
```

The page is already a Server Component (Next.js 15 default). Inside the default-exported async function, before the JSX `return`, add:

```typescript
const cookieStore = await cookies()
const existingName = cookieStore.get(OPERATOR_NAME_COOKIE_NAME)?.value ?? ''
```

In the existing `<form action="/api/auth/login" method="post">`, add the operator-name input **immediately above the password field**:

```tsx
<label className="block">
  <span className="block text-[12px] font-body font-semibold uppercase tracking-wider text-navy/60 dark:text-white/60 mb-1">
    Your name
  </span>
  <input
    type="text"
    name="operatorName"
    maxLength={64}
    defaultValue={existingName}
    placeholder="e.g. Kevin"
    className="w-full rounded-lg border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card px-3 py-2 text-navy dark:text-white placeholder:text-navy/30 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-orange/30"
    autoComplete="given-name"
  />
</label>
```

Note: TSX uses `maxLength` (camelCase), not `maxlength`.

- [ ] **Step 2: Typecheck**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Smoke the login screen**

```bash
npm run dev
```

Open `http://localhost:3000/login`. Confirm:
- Name field appears above the password field
- Submitting with a name + correct password redirects through to the home page
- Re-opening `/login` after success shows the name pre-filled (cookie round-trip works)
- Submitting with the field blanked deletes the cookie (verify via dev-tools → Application → Cookies)

- [ ] **Step 4: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat(auth): add operator name input to login page, pre-filled from cookie"
```

---

### Task 6: Extend `AuditListItem` and `SiteAuditDetail` types

**Files:**
- Modify: `lib/ada-audit/types.ts`

- [ ] **Step 1: Add the field to both interfaces**

Open `lib/ada-audit/types.ts`. In `AuditListItem`, add:

```typescript
requestedBy: string | null
```

In `SiteAuditDetail`, add the same field:

```typescript
requestedBy: string | null
```

**Important:** `SiteAuditDetail` is shared by both `GET /api/site-audit` (list) and `GET /api/site-audit/[id]` (detail). Adding `requestedBy` as a required field on the type means **both** endpoints must return it — handled in Tasks 9 and 10.

- [ ] **Step 2: Typecheck**

```bash
npm run lint
```

Expected: FAIL at the call sites that build `AuditListItem` / `SiteAuditDetail` objects (the list and detail routes). That's expected — those are fixed in Tasks 9 and 10. Note the failures and move on; do not commit yet.

(If you prefer green-at-every-step, defer Task 6 commit until after Task 10. The plan keeps Task 6 separate for review clarity.)

---

### Task 7: Refactor `enqueueAudit` to options-object signature (TDD)

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts`
- Modify: `lib/ada-audit/queue-manager.test.ts`
- Modify: `lib/ada-audit/queue-request.ts`
- Modify: `lib/ada-audit/queue-request.test.ts`

**Why a refactor:** the current signature is `enqueueAudit(domain, clientId, wcagLevel, preDiscoveredUrls?)`. Adding `requestedBy` as a fifth positional argument is fragile. Switching the trailing optional args to an options object keeps the required positional args stable and makes the call sites readable.

- [ ] **Step 1: Write the failing test**

In `lib/ada-audit/queue-manager.test.ts`, append:

```typescript
describe('enqueueAudit — requestedBy + options object', () => {
  it('accepts requestedBy via the options object and persists it on the SiteAudit row', async () => {
    // Arrange (use whatever harness the existing tests use to mock prisma.siteAudit.create)
    const created = await enqueueAudit('example.com', null, 'wcag21aa', {
      requestedBy: 'Kevin',
    })
    expect(created.requestedBy).toBe('Kevin')
  })

  it('still accepts preDiscoveredUrls via the options object', async () => {
    const created = await enqueueAudit('example.com', null, 'wcag21aa', {
      preDiscoveredUrls: ['https://example.com/a', 'https://example.com/b'],
    })
    expect(JSON.parse(created.discoveredUrls ?? '[]')).toHaveLength(2)
  })

  it('treats both options as optional', async () => {
    const created = await enqueueAudit('example.com', null, 'wcag21aa')
    expect(created.requestedBy).toBeNull()
  })
})
```

Adjust the existing positional-arg tests to use the new options-object form.

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-manager.test.ts
```

Expected: FAIL — new signature not implemented.

- [ ] **Step 3: Refactor `enqueueAudit`**

In `lib/ada-audit/queue-manager.ts`, change the signature:

```typescript
export interface EnqueueAuditOptions {
  preDiscoveredUrls?: string[]
  requestedBy?: string | null
}

export async function enqueueAudit(
  domain: string,
  clientId: number | null,                  // numeric ID, matching current contract
  wcagLevel: string,
  opts: EnqueueAuditOptions = {},
): Promise<{ id: string; status: string }>  // unchanged public return shape
{
  const { preDiscoveredUrls, requestedBy } = opts
  // …existing body, but include requestedBy in the create payload:
  const audit = await prisma.siteAudit.create({
    data: {
      domain,
      clientId,
      wcagLevel,
      status: 'queued',
      discoveredUrls: preDiscoveredUrls ? JSON.stringify(preDiscoveredUrls) : null,
      requestedBy: requestedBy ?? null,
      // …other existing fields, unchanged…
    },
  })
  // …rest unchanged…
  return { id: audit.id, status: audit.status }
}
```

The return shape stays `{ id, status }` (the existing contract). Tests that need to assert `requestedBy` landed should `prisma.siteAudit.findUnique({ where: { id }})` against the persisted row.

- [ ] **Step 4: Update the sole caller, preserving the existing normalization layer**

In `lib/ada-audit/queue-request.ts`, the current `queueSiteAuditRequest` performs domain normalization and `wcagLevel` sanitization before handing off to `enqueueAudit`. Keep those normalizations intact — only change the call signature to use the options-object form:

```typescript
export interface QueueRequestInput {
  domain: string
  clientId: number | null              // numeric ID, matching existing type
  wcagLevel: string
  preDiscoveredUrls?: string[]
  requestedBy?: string | null
}

// Inside queueSiteAuditRequest — domain and wcagLevel are still normalized locally before this call:
const audit = await enqueueAudit(normalizedDomain, input.clientId, sanitizedWcagLevel, {
  preDiscoveredUrls: input.preDiscoveredUrls,
  requestedBy: input.requestedBy ?? null,
})
```

Update `lib/ada-audit/queue-request.test.ts` to match — pass `requestedBy` via the input object, then assert it lands on the persisted row via a separate `prisma.siteAudit.findUnique` lookup. The existing domain-normalization assertion at line ~71-80 must continue to pass unchanged.

- [ ] **Step 5: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run lib/ada-audit/queue-manager.test.ts lib/ada-audit/queue-request.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/queue-manager.test.ts lib/ada-audit/queue-request.ts lib/ada-audit/queue-request.test.ts
git commit -m "refactor(ada-audit): enqueueAudit options object; thread requestedBy through queue-request"
```

---

### Task 8: Standalone page audit endpoint (TDD)

**Files:**
- Modify: `app/api/ada-audit/route.ts`
- Create: `app/api/ada-audit/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/ada-audit/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  prisma: {
    adaAudit: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}))

const { prisma } = await import('@/lib/db')
const { POST, GET } = await import('./route')

beforeEach(() => {
  vi.mocked(prisma.adaAudit.create).mockReset()
  vi.mocked(prisma.adaAudit.findMany).mockReset()
  vi.mocked(prisma.adaAudit.count).mockReset()
})

function postRequest(body: object, cookies: Record<string, string> = {}) {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  return new NextRequest('http://localhost/api/ada-audit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', cookie: cookieHeader },
  })
}

describe('POST /api/ada-audit — requestedBy', () => {
  it('stores requestedBy from the er-operator-name cookie', async () => {
    vi.mocked(prisma.adaAudit.create).mockResolvedValue({ id: 'a-1' } as never)
    await POST(postRequest({ url: 'https://example.com' }, { 'er-operator-name': 'Kevin' }))
    expect(prisma.adaAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requestedBy: 'Kevin' }) }),
    )
  })

  it('stores null when cookie is absent', async () => {
    vi.mocked(prisma.adaAudit.create).mockResolvedValue({ id: 'a-1' } as never)
    await POST(postRequest({ url: 'https://example.com' }))
    expect(prisma.adaAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requestedBy: null }) }),
    )
  })
})

describe('GET /api/ada-audit — requestedBy in list items', () => {
  it('includes requestedBy on each item', async () => {
    vi.mocked(prisma.adaAudit.findMany).mockResolvedValue([
      { id: 'a', url: 'https://x/a', status: 'complete', score: 90, requestedBy: 'Kevin',
        createdAt: new Date(), wcagLevel: 'wcag21aa', clientId: null, client: null,
        result: null, error: null, siteAuditId: null, shareToken: null } as never,
    ])
    vi.mocked(prisma.adaAudit.count).mockResolvedValue(1)
    const res = await GET(new NextRequest('http://localhost/api/ada-audit'))
    const json = await res.json()
    expect(json.items[0].requestedBy).toBe('Kevin')
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run app/api/ada-audit/route.test.ts
```

Expected: FAIL — route does not yet read the cookie or include `requestedBy` in items.

- [ ] **Step 3: Wire the cookie + list mapping**

In `app/api/ada-audit/route.ts`:

```typescript
import { OPERATOR_NAME_COOKIE_NAME } from '@/lib/auth'

// Inside POST, before prisma.adaAudit.create:
const requestedBy =
  request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value?.trim().slice(0, 64) || null

const audit = await prisma.adaAudit.create({
  data: {
    url: parsed.toString(),
    status: 'pending',
    clientId,
    wcagLevel,
    requestedBy,
    // …other existing fields, unchanged…
  },
})
```

In the GET handler's `items.map`, add:

```typescript
requestedBy: a.requestedBy ?? null,
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run app/api/ada-audit/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ada-audit/route.ts app/api/ada-audit/route.test.ts lib/ada-audit/types.ts
git commit -m "feat(ada-audit): persist + return requestedBy for standalone page audits"
```

(`lib/ada-audit/types.ts` from Task 6 is bundled with this commit because Task 6 was deferred until the call sites caught up.)

---

### Task 9: Site audit list endpoint (TDD)

**Files:**
- Modify: `app/api/site-audit/route.ts`
- Create: `app/api/site-audit/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/site-audit/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/ada-audit/queue-request', () => ({
  queueSiteAuditRequest: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    siteAudit: { findMany: vi.fn(), count: vi.fn() },
  },
}))

const { queueSiteAuditRequest } = await import('@/lib/ada-audit/queue-request')
const { prisma } = await import('@/lib/db')
const { POST, GET } = await import('./route')

beforeEach(() => {
  vi.mocked(queueSiteAuditRequest).mockReset()
  vi.mocked(prisma.siteAudit.findMany).mockReset()
  vi.mocked(prisma.siteAudit.count).mockReset()
})

function postRequest(body: object, cookies: Record<string, string> = {}) {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  return new NextRequest('http://localhost/api/site-audit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', cookie: cookieHeader },
  })
}

describe('POST /api/site-audit — requestedBy threading', () => {
  it('passes requestedBy from the cookie to queueSiteAuditRequest', async () => {
    vi.mocked(queueSiteAuditRequest).mockResolvedValue({ id: 'sa-1' } as never)
    await POST(postRequest({ domain: 'example.com' }, { 'er-operator-name': 'Kevin' }))
    expect(queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: 'Kevin' }),
    )
  })

  it('passes null when cookie is absent', async () => {
    vi.mocked(queueSiteAuditRequest).mockResolvedValue({ id: 'sa-1' } as never)
    await POST(postRequest({ domain: 'example.com' }))
    expect(queueSiteAuditRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: null }),
    )
  })
})

describe('GET /api/site-audit — requestedBy in list items', () => {
  it('includes requestedBy on each item', async () => {
    vi.mocked(prisma.siteAudit.findMany).mockResolvedValue([
      { id: 'sa', domain: 'x', status: 'complete', requestedBy: 'Kevin',
        createdAt: new Date(), clientId: null, client: null,
        pagesTotal: 1, pagesComplete: 1, pagesError: 0,
        pdfsTotal: 0, pdfsComplete: 0, pdfsError: 0,
        summary: null, error: null } as never,
    ])
    vi.mocked(prisma.siteAudit.count).mockResolvedValue(1)
    const res = await GET(new NextRequest('http://localhost/api/site-audit'))
    const json = await res.json()
    expect(json.items[0].requestedBy).toBe('Kevin')
  })
})
```

- [ ] **Step 2: Run, verify it fails**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run app/api/site-audit/route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Wire cookie + list mapping**

In `app/api/site-audit/route.ts`:

```typescript
import { OPERATOR_NAME_COOKIE_NAME } from '@/lib/auth'

// Inside POST, before queueSiteAuditRequest:
const requestedBy =
  request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value?.trim().slice(0, 64) || null

const audit = await queueSiteAuditRequest({
  domain,
  clientId,
  wcagLevel,
  requestedBy,
  // …other existing fields, unchanged…
})
```

In the GET handler's `items.map`, add:

```typescript
requestedBy: a.requestedBy ?? null,
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run app/api/site-audit/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/site-audit/route.ts app/api/site-audit/route.test.ts
git commit -m "feat(ada-audit): persist + return requestedBy for site audits"
```

---

### Task 10: Detail endpoint includes `requestedBy`

**Files:**
- Modify: `app/api/site-audit/[id]/route.ts`

**Why:** `SiteAuditDetail` is shared between the list and detail endpoints. The list endpoint now returns `requestedBy`; the detail endpoint must too, or the type contract breaks.

- [ ] **Step 1: Add the field to the detail response**

In `app/api/site-audit/[id]/route.ts`, in the final `return NextResponse.json({…})` payload, add:

```typescript
requestedBy: audit.requestedBy ?? null,
```

- [ ] **Step 2: Typecheck**

```bash
npm run lint
```

Expected: PASS. All `SiteAuditDetail` callers should now satisfy the type.

- [ ] **Step 3: Commit**

```bash
git add app/api/site-audit/\[id\]/route.ts
git commit -m "feat(ada-audit): include requestedBy in site audit detail response"
```

---

### Task 11: Bulk-queue support for `requestedBy`

**Files:**
- Modify: `app/api/site-audit/bulk-queue/route.ts`

- [ ] **Step 1: Read the current handler**

```bash
grep -n "export async function" app/api/site-audit/bulk-queue/route.ts
```

The current export takes no `NextRequest`. Update the signature so the handler can read the cookie.

- [ ] **Step 2: Accept `NextRequest`, read cookie, forward**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { OPERATOR_NAME_COOKIE_NAME } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const requestedBy =
    request.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value?.trim().slice(0, 64) || null

  // Inside the loop / batch creation, when enqueueing each audit, pass requestedBy:
  await queueSiteAuditRequest({
    domain,
    clientId,
    wcagLevel,
    requestedBy,
    // …other fields, unchanged…
  })

  // …existing response, unchanged…
}
```

Same-origin fetches from `BulkQueueModal` already send cookies, so no client change is needed.

- [ ] **Step 3: Typecheck + smoke**

```bash
npm run lint
```

Expected: PASS.

Smoke-test the bulk-queue path manually: set `er-operator-name` to a known value, kick off a bulk queue from the UI, then check the DB:

```bash
DATABASE_URL='file:./local-dev.db' sqlite3 prisma/local-dev.db "SELECT id, domain, requestedBy FROM SiteAudit ORDER BY createdAt DESC LIMIT 5;"
```

Expected: the newly-queued rows show the operator name.

- [ ] **Step 4: Commit**

```bash
git add app/api/site-audit/bulk-queue/route.ts
git commit -m "feat(ada-audit): bulk-queue threads requestedBy through to every audit"
```

---

### Task 12: UI — add `Requested by` column to history tables

**Files:**
- Modify: `components/ada-audit/AuditHistory.tsx`
- Modify: `components/ada-audit/SiteAuditHistory.tsx`

No unit tests (no React testing stack). Visual verification follows in Task 13.

- [ ] **Step 1: Update `AuditHistory.tsx`**

Locate the existing table header row. Between the `Client` `<th>` and the `Score` `<th>`, insert:

```tsx
<th className="text-left py-2 pr-4 text-[11px] uppercase tracking-wider font-semibold text-navy/50 dark:text-white/50">
  Requested by
</th>
```

In the body row, between the Client cell and the Score cell:

```tsx
<td className="py-2.5 pr-4 text-navy/60 dark:text-white/60 whitespace-nowrap">
  {a.requestedBy ?? <span className="text-navy/25 dark:text-white/25">—</span>}
</td>
```

- [ ] **Step 2: Update `SiteAuditHistory.tsx`**

Same insertion — between `Client` and `Pages`:

```tsx
<th className="text-left py-2 pr-4 text-[11px] uppercase tracking-wider font-semibold text-navy/50 dark:text-white/50">
  Requested by
</th>
```

```tsx
<td className="py-2.5 pr-4 text-navy/60 dark:text-white/60 whitespace-nowrap">
  {a.requestedBy ?? <span className="text-navy/25 dark:text-white/25">—</span>}
</td>
```

- [ ] **Step 3: Typecheck**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ada-audit/AuditHistory.tsx components/ada-audit/SiteAuditHistory.tsx
git commit -m "feat(ada-audit): render Requested by column in audit history tables"
```

---

### Task 13: Manual verification

**Files:** none — runtime check.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Login flow**

Navigate to `/login`. Confirm:
- Name field above password
- Submit with name `Kevin` → redirected to home; cookie `er-operator-name=Kevin` visible in dev tools
- Re-open `/login` → name field pre-filled with `Kevin`
- Submit with the name field blanked → cookie deleted

- [ ] **Step 3: Create a standalone page audit and a site audit**

With the name cookie set, kick off one of each. After the audit row is created (no need to wait for completion):

```bash
DATABASE_URL='file:./local-dev.db' sqlite3 prisma/local-dev.db "SELECT id, url, requestedBy FROM AdaAudit WHERE siteAuditId IS NULL ORDER BY createdAt DESC LIMIT 1;"
DATABASE_URL='file:./local-dev.db' sqlite3 prisma/local-dev.db "SELECT id, domain, requestedBy FROM SiteAudit ORDER BY createdAt DESC LIMIT 1;"
```

Expected: both rows show `requestedBy = 'Kevin'`.

- [ ] **Step 4: Verify history tables**

Open `/ada-audit`. Confirm:
- "Recent Page Audits" shows a `Requested by` column between Client and Score, populated with `Kevin` for the new row and either `Testing` (historical) or `—` (new with no cookie) for others.
- "Recent Site Audits" shows the same column between Client and Pages, behaving the same way.

- [ ] **Step 5: No-cookie audit**

Delete the `er-operator-name` cookie via dev tools, queue another audit, and confirm the new row renders `—` in the table.

- [ ] **Step 6: Bulk-queue**

With the cookie set, trigger a bulk queue via `BulkQueueModal`. Confirm every newly-created `SiteAudit` row has `requestedBy = 'Kevin'`.

---

### Task 14: Lint + full test suite + production build

**Files:** none.

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 2: Full test suite**

```bash
DATABASE_URL='file:./local-dev.db' npx vitest run
```

Expected: PASS, with the new test files (`auth/login/route.test.ts`, `ada-audit/route.test.ts`, `site-audit/route.test.ts`) and the extended `queue-manager.test.ts` / `queue-request.test.ts` all green.

- [ ] **Step 3: Production build**

```bash
rm -rf .next && npm run build
```

Expected: clean build, no type errors.

---

### Task 15: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/ada-requested-by-name
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(ada-audit): operator Requested by column in audit history" --body "$(cat <<'EOF'
## Summary
PR 3 of the ADA audit UX overhaul. Captures the operator's first name at login via a plain-text `er-operator-name` cookie and surfaces it as a "Requested by" column in the Recent Page Audits and Recent Site Audits history tables. No user accounts, no permissions — just enough attribution to see at a glance who kicked off a given run.

## Schema migration
**This PR includes a Prisma migration** (`add_requested_by`) that:
- Adds nullable `requestedBy TEXT` columns to `AdaAudit` and `SiteAudit` via `ALTER TABLE ... ADD COLUMN` (no table redefine).
- Backfills `requestedBy = 'Testing'` on all pre-feature rows (parent `SiteAudit` rows + standalone `AdaAudit` rows). Child `AdaAudit` rows (`siteAuditId IS NOT NULL`) are intentionally NOT backfilled — they never appear in a history list.
- The backfill UPDATE statements are appended manually to the generated `migration.sql`. On production they run as part of `prisma migrate deploy`.

## What changed
- **Schema:** `requestedBy String?` on `AdaAudit` + `SiteAudit`. No index — `SELECT`-only column.
- **Auth:** Login form gains a `Your name` field above the password field, pre-filled from the existing cookie via `next/headers`. Login route reads `operatorName` from form data, trims, caps at 64 chars, and either sets or deletes the `er-operator-name` cookie (1-year max-age, `SameSite=Lax`, `Secure` in prod, `HttpOnly` false).
- **API:** Standalone page audits (`POST /api/ada-audit`), site audits (`POST /api/site-audit`), and bulk-queue (`POST /api/site-audit/bulk-queue`) all read the cookie at creation time and persist it on the row. List endpoints (`GET /api/ada-audit`, `GET /api/site-audit`) return `requestedBy` on each item. The detail endpoint (`GET /api/site-audit/[id]`) also returns it for type consistency.
- **Internal refactor:** `enqueueAudit` switched from positional `preDiscoveredUrls` to an options object (`{ preDiscoveredUrls?, requestedBy? }`) so the trailing optional args stop growing positionally.
- **UI:** New `Requested by` column in both audit history tables, between Client and the next data column. Renders the stored value, or `—` when null.

## Constraints honored
- Node 22 + SQLite only. `ALTER TABLE ... ADD COLUMN` for nullable TEXT works directly on SQLite (no redefine-table needed).
- No new dependencies.
- Existing positional `enqueueAudit(domain, clientId, wcagLevel)` contract preserved — only the optional trailing args moved to an options object.

## Test plan
- [x] `POST /api/auth/login` sets the cookie on non-empty name, deletes it on empty/whitespace-only, trims + caps at 64 chars (new test file).
- [x] `POST /api/ada-audit` persists `requestedBy` from cookie, stores `null` when cookie absent; `GET` returns the field in `items` (new test file).
- [x] `POST /api/site-audit` threads `requestedBy` through to `queueSiteAuditRequest`; `GET` returns the field (new test file).
- [x] `enqueueAudit` accepts options-object form, persists `requestedBy`, still accepts `preDiscoveredUrls` (extended existing tests).
- [x] Full test suite, lint, and production build pass.
- [x] Manual: login round-trip pre-fills, blanking deletes the cookie, standalone + site + bulk-queue audits all attribute correctly, history tables render the column with backfilled `Testing` and live `—`.

## Out of scope
- Profile/rename UI (operators clear cookie via dev tools to correct typos).
- Per-user filtering or "my audits" view.
- Showing the name on detail pages, share views, or exports.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL**

---

## Self-review checklist

- [x] **Spec coverage**: schema (Task 2), constants (Task 3), login route (Task 4), login page (Task 5), types (Task 6), `enqueueAudit` refactor (Task 7), standalone audit (Task 8), site audit list (Task 9), site audit detail (Task 10), bulk-queue (Task 11), UI (Task 12).
- [x] **Migration handled correctly**: `prisma migrate dev --name add_requested_by` generates the column-add; backfill UPDATEs are appended manually to `migration.sql`; child `AdaAudit` rows (`siteAuditId IS NOT NULL`) intentionally excluded from backfill.
- [x] **No type breakage**: `SiteAuditDetail` now requires `requestedBy`, so both the list endpoint (Task 9) and the detail endpoint (Task 10) return it. Task 6 is committed alongside Task 8 to keep TS green at every checkpoint.
- [x] **`enqueueAudit` contract**: required positional args (`domain`, `clientId`, `wcagLevel`) preserved; optional args (`preDiscoveredUrls`, `requestedBy`) moved to an options object. The sole caller and its test are updated in the same task.
- [x] **Cookie correctness**: empty submission **deletes** the cookie via `response.cookies.delete(...)`, not "do nothing" — prevents stale values from prior sessions surviving an explicit clear.
- [x] **Bulk-queue covered**: handler now accepts `NextRequest` so the cookie reaches the bulk path. Spec ambiguity #4 ("Bulk-queue gets `requestedBy = null`") is intentionally overridden — wiring it through is straightforward and worth doing.
- [x] **TDD discipline**: every behavior-bearing task (4, 7, 8, 9) writes the failing test first, then the implementation, then the green pass. Pure UI/schema tasks (2, 3, 5, 10, 11, 12) skip TDD and rely on lint + manual verification.
- [x] **Display contract**: `Testing` = backfilled historical row; `—` = new row with no cookie; literal name = new row with cookie. Consistent with the spec's resolution of ambiguity #1.
