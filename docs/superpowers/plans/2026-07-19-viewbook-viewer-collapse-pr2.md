# Viewbook viewer-collapse — PR2: shared-collapse write (service + public route)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Read the program overview + spec first. Global Constraints apply. Depends on PR1.

**Goal:** Let any token-holder set a section's shared collapse (`collapsed:true`) and let a verified operator also shared-expand (`collapsed:false`), through a public token route with a dedicated throttle bucket and a self-contained commit predicate.

**Architecture:** A pure-ish service (`lib/viewbook/collapse.ts`) does one fenced array-form transaction (predicated UPDATE + fence-shared sync bump). The route reuses the ack preflight chain, resolves operator status request-scoped, and gates shared-expand.

**Tech Stack:** Next 15 route handlers, Prisma array-form `$transaction`, Vitest.

---

### Task 1: Non-throwing request-scoped operator resolver

**Files:**
- Modify: `lib/viewbook/operator.ts`
- Test: `lib/viewbook/operator.test.ts` (add cases; create if absent)

**Interfaces:**
- Produces: `resolveOperatorEmail(request: Request): Promise<string | null>` — the non-throwing core; `requireOperatorEmail` delegates and throws `401 auth_required` on null.

- [ ] **Step 1: Failing test.**

```ts
// lib/viewbook/operator.test.ts
import { describe, it, expect } from 'vitest'
import { resolveOperatorEmail } from './operator'

describe('resolveOperatorEmail', () => {
  it('returns null for a request with no auth cookie (never throws)', async () => {
    const req = new Request('https://x/api', { headers: {} })
    await expect(resolveOperatorEmail(req)).resolves.toBeNull()
  })
})
```

Run: `npx vitest run lib/viewbook/operator.test.ts` → FAIL (not exported).

- [ ] **Step 2: Refactor `operator.ts`.** Extract the core; keep `requireOperatorEmail` behavior identical:

```ts
export async function resolveOperatorEmail(request: Request): Promise<string | null> {
  if (isAuthBypassedInDev()) return 'dev@localhost'
  const value = cookieFromHeader(request.headers.get('cookie') ?? '', AUTH_COOKIE_NAME)
  const session = await getAuthSession(value)
  return session?.email ?? null
}

export async function requireOperatorEmail(request: Request): Promise<string> {
  const email = await resolveOperatorEmail(request)
  if (!email) throw new HttpError(401, 'auth_required')
  return email
}
```

- [ ] **Step 3: Run + commit.**

Run: `npx vitest run lib/viewbook/operator.test.ts` → PASS; `npx tsc --noEmit` → 0

```bash
git add lib/viewbook/operator.ts lib/viewbook/operator.test.ts
git commit -m "refactor(viewbook): extract non-throwing resolveOperatorEmail"
```

---

### Task 2: `setSectionCollapsedShared` service

**Files:**
- Create: `lib/viewbook/collapse.ts`
- Test: `lib/viewbook/collapse.test.ts`

**Interfaces:**
- Consumes: `sectionSupportsCollapse` (`lib/viewbook/theme.ts`), `syncVersionBumpWhere` (`lib/viewbook/sync.ts`), `prisma`.
- Produces:
  ```ts
  export async function setSectionCollapsedShared(
    viewbook: { id: number },
    input: { sectionKey: string; collapsed: boolean; isOperator: boolean },
  ): Promise<{ collapsedShared: boolean }>
  ```

- [ ] **Step 1: Failing tests** (DB-backed). Use a LOCAL `mkViewbook()` helper (see PR1 Task 1 Step 5 — copy the `mkViewbook` from `lib/viewbook/ack.test.ts`; there is no shared `test-helpers` module):

```ts
// lib/viewbook/collapse.test.ts
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { createViewbook } from './service'
import { setSectionCollapsedShared } from './collapse'

async function mkViewbook() {
  const client = await prisma.client.create({ data: { name: `vbtest-${crypto.randomUUID()}` } })
  return createViewbook(client.id, 'new-build') // match the real signature during impl
}
async function sync(id: number) {
  return (await prisma.viewbook.findUniqueOrThrow({ where: { id } })).syncVersion
}

describe('setSectionCollapsedShared', () => {
  it('any caller can set collapsed=true; bumps syncVersion', async () => {
    const vb = await mkViewbook()
    const before = await sync(vb.id)
    const r = await setSectionCollapsedShared(vb, { sectionKey: 'brand', collapsed: true, isOperator: false })
    expect(r.collapsedShared).toBe(true)
    expect(await sync(vb.id)).toBe(before + 1)
  })

  it('anonymous collapsed=false is rejected 403 operator_required', async () => {
    const vb = await mkViewbook()
    await setSectionCollapsedShared(vb, { sectionKey: 'brand', collapsed: true, isOperator: false })
    await expect(setSectionCollapsedShared(vb, { sectionKey: 'brand', collapsed: false, isOperator: false }))
      .rejects.toMatchObject({ status: 403, code: 'operator_required' })
  })

  it('operator collapsed=false succeeds', async () => {
    const vb = await mkViewbook()
    await setSectionCollapsedShared(vb, { sectionKey: 'brand', collapsed: true, isOperator: false })
    const r = await setSectionCollapsedShared(vb, { sectionKey: 'brand', collapsed: false, isOperator: true })
    expect(r.collapsedShared).toBe(false)
  })

  it('bookend sections cannot be collapsed (400)', async () => {
    const vb = await mkViewbook()
    await expect(setSectionCollapsedShared(vb, { sectionKey: 'pc-intro', collapsed: true, isOperator: true }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('idempotent no-op set does NOT bump syncVersion', async () => {
    const vb = await mkViewbook()
    await setSectionCollapsedShared(vb, { sectionKey: 'brand', collapsed: true, isOperator: false })
    const before = await sync(vb.id)
    await setSectionCollapsedShared(vb, { sectionKey: 'brand', collapsed: true, isOperator: false })
    expect(await sync(vb.id)).toBe(before) // value unchanged → no bump
  })
})
```

Run: `npx vitest run lib/viewbook/collapse.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `collapse.ts`.** The UPDATE and the sync bump share ONE self-contained predicate (token current + client not archived + section visible/collapse-allowed + value actually changing). Assert row counts.

```ts
import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { sectionSupportsCollapse } from './theme'
import { syncVersionBumpWhere } from './sync'

export async function setSectionCollapsedShared(
  viewbook: { id: number },
  input: { sectionKey: string; collapsed: boolean; isOperator: boolean },
): Promise<{ collapsedShared: boolean }> {
  const { sectionKey, collapsed, isOperator } = input
  if (!sectionSupportsCollapse(sectionKey)) throw new HttpError(400, 'invalid_section')
  // Shared-EXPAND (collapsed=false) is operator-only. Shared-COLLAPSE is open to any token-holder.
  if (!collapsed && !isOperator) throw new HttpError(403, 'operator_required')

  const now = Date.now()
  // Self-contained commit predicate: the section exists, is NOT hidden, is
  // collapse-eligible (enforced above), the parent book is live + not revoked,
  // the client is not archived, AND the value actually changes. Reused verbatim
  // by the sync bump so a no-op/blocked write bumps nothing.
  const predicate = Prisma.sql`
    EXISTS (
      SELECT 1 FROM "ViewbookSection" s
      JOIN "Viewbook" v ON v."id" = s."viewbookId"
      JOIN "Client" c ON c."id" = v."clientId"
      WHERE s."viewbookId" = ${viewbook.id}
        AND s."sectionKey" = ${sectionKey}
        AND s."state" <> 'hidden'
        AND s."collapsedShared" <> ${collapsed}
        AND v."revokedAt" IS NULL
        AND c."archivedAt" IS NULL
    )`

  const update = prisma.$executeRaw`
    UPDATE "ViewbookSection"
      SET "collapsedShared" = ${collapsed}, "updatedAt" = ${now}
      WHERE "viewbookId" = ${viewbook.id}
        AND "sectionKey" = ${sectionKey}
        AND ${predicate}`

  // Fence-shared bump placed BEFORE the update (companion-statement pattern).
  const [, changed] = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, predicate),
    update,
  ])
  // `changed` is the UPDATE's affected-row count. 0 = no-op (already at value)
  // or blocked by the predicate — either way the state is `collapsed`.
  void changed
  return { collapsedShared: collapsed }
}
```

Note: `Client` has `archivedAt` (confirm column name against schema during impl; the ack/robots layers use the same archived-client guard). If `sectionSupportsCollapse` currently lives imported in `service.ts` only, it is exported from `theme.ts` — import from there.

- [ ] **Step 3: Run + gate + commit.**

Run: `npx vitest run lib/viewbook/collapse.test.ts` → PASS; `npx tsc --noEmit` → 0

```bash
git add lib/viewbook/collapse.ts lib/viewbook/collapse.test.ts
git commit -m "feat(viewbook): setSectionCollapsedShared service (fenced, operator-gated expand)"
```

---

### Task 3: `POST /api/viewbook/[token]/collapse` route

**Files:**
- Create: `app/api/viewbook/[token]/collapse/route.ts`
- Test: `app/api/viewbook/collapse-route.test.ts` (or the repo's route-test location for viewbook public routes)

**Interfaces:**
- Consumes: `requireViewbookToken`, `resolveOperatorEmail`, the preflight guards, `setSectionCollapsedShared`.
- Produces: `POST` handler → `200 { collapsedShared }`.

- [ ] **Step 1: Failing route tests.**

```ts
// mirror app/api/viewbook/[token]/ack route test setup (same-site header, JSON content-type)
it('anonymous collapsed=true → 200 collapsedShared:true', async () => { /* POST, assert body */ })
it('anonymous collapsed=false → 403 operator_required', async () => { /* no auth cookie */ })
it('operator collapsed=false → 200 collapsedShared:false', async () => { /* auth cookie */ })
it('uses the collapse:<token> throttle bucket (does not consume the ack bucket)', async () => {
  // fire >throttle-limit collapse POSTs, then assert an ack POST for the same token still succeeds
})
```

Run: FAIL (route missing).

- [ ] **Step 2: Implement the route** (preflight order is load-bearing; dedicated throttle key):

```ts
import { NextRequest, NextResponse } from 'next/server'
import { withRoute } from '@/lib/api/with-route'
import { HttpError } from '@/lib/api/errors'
import { requireJsonObject } from '@/lib/viewbook/route-utils'
import { requireViewbookToken } from '@/lib/viewbook/route-auth'
import { resolveOperatorEmail } from '@/lib/viewbook/operator'
import {
  checkWriteThrottle, readBoundedJson, requireJsonContentType, requireSameSite,
} from '@/lib/viewbook/public-write-guard'
import { setSectionCollapsedShared } from '@/lib/viewbook/collapse'

export const dynamic = 'force-dynamic'
const BODY_CAP_BYTES = 1024
type RouteParams = { params: Promise<{ token: string }> }

function parseInput(raw: unknown): { sectionKey: string; collapsed: boolean } {
  const body = requireJsonObject(raw)
  if (typeof body.sectionKey !== 'string' || !body.sectionKey) throw new HttpError(400, 'invalid_section')
  if (typeof body.collapsed !== 'boolean') throw new HttpError(400, 'invalid_request')
  return { sectionKey: body.sectionKey, collapsed: body.collapsed }
}

export const POST = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  requireJsonContentType(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  checkWriteThrottle(`collapse:${token}`) // dedicated bucket — never starves ack/materials/setup
  const isOperator = (await resolveOperatorEmail(request)) != null
  const input = parseInput(await readBoundedJson(request, BODY_CAP_BYTES))
  const result = await setSectionCollapsedShared(viewbook, { ...input, isOperator })
  return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } })
})
```

- [ ] **Step 3: Confirm middleware.** `/api/viewbook/[token]/*` is already a public prefix (ack/feedback live there). No middleware change. Verify by grepping `middleware.ts` for the viewbook public matcher and confirming the new segment is covered.

- [ ] **Step 4: Run + gate + commit.**

Run: `npx vitest run app/api/viewbook` → PASS; `npx tsc --noEmit` → 0

```bash
git add "app/api/viewbook/[token]/collapse/route.ts" app/api/viewbook/collapse-route.test.ts
git commit -m "feat(viewbook): POST /api/viewbook/[token]/collapse (public, operator-gated expand)"
```

---

## PR2 self-check
- Anonymous can set true, never false (route + service both enforce; pinned by tests).
- One self-contained predicate reused by UPDATE + sync bump; no-op/blocked write bumps nothing.
- Dedicated `collapse:<token>` throttle bucket proven not to starve the ack bucket.
- Array-form `$transaction` only; `updatedAt` stamped via `Date.now()`.
- Gates green.
