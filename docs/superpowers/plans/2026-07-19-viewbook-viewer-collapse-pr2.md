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
- Consumes: `assertSectionKey` + `sectionSupportsCollapse` (`lib/viewbook/theme.ts` / `service.ts` — use whichever exports `assertSectionKey`), `syncVersionBumpWhere` (`lib/viewbook/sync.ts`), `prisma`.
- Produces (the `token` is REQUIRED and enters the commit predicate — Codex FIX-PR2-COMMIT-FENCE-AND-RESULT):
  ```ts
  export async function setSectionCollapsedShared(
    viewbook: { id: number },
    token: string,
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
    const r = await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false })
    expect(r.collapsedShared).toBe(true)
    expect(await sync(vb.id)).toBe(before + 1)
  })

  it('anonymous collapsed=false is rejected 403 operator_required', async () => {
    const vb = await mkViewbook()
    await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false })
    await expect(setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: false, isOperator: false }))
      .rejects.toMatchObject({ status: 403, code: 'operator_required' })
  })

  it('operator collapsed=false succeeds', async () => {
    const vb = await mkViewbook()
    await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false })
    const r = await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: false, isOperator: true })
    expect(r.collapsedShared).toBe(false)
  })

  it('bookend sections cannot be collapsed (400)', async () => {
    const vb = await mkViewbook()
    await expect(setSectionCollapsedShared(vb, vb.token, { sectionKey: 'pc-intro', collapsed: true, isOperator: true }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('idempotent no-op set does NOT bump syncVersion', async () => {
    const vb = await mkViewbook()
    await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false })
    const before = await sync(vb.id)
    await setSectionCollapsedShared(vb, vb.token, { sectionKey: 'brand', collapsed: true, isOperator: false })
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
import { sectionSupportsCollapse, SECTION_KEYS } from './theme'
import { syncVersionBumpWhere } from './sync'

export async function setSectionCollapsedShared(
  viewbook: { id: number },
  token: string,
  input: { sectionKey: string; collapsed: boolean; isOperator: boolean },
): Promise<{ collapsedShared: boolean }> {
  const { sectionKey, collapsed, isOperator } = input
  // Validate against REAL section keys — sectionSupportsCollapse only excludes
  // the bookends, so an arbitrary string would otherwise pass (Codex FIX-3).
  if (!(SECTION_KEYS as readonly string[]).includes(sectionKey)) throw new HttpError(400, 'invalid_section')
  if (!sectionSupportsCollapse(sectionKey)) throw new HttpError(400, 'invalid_section')
  // Shared-EXPAND (collapsed=false) is operator-only. Shared-COLLAPSE is open to any token-holder.
  if (!collapsed && !isOperator) throw new HttpError(403, 'operator_required')

  const now = Date.now()
  // Self-contained commit predicate: matches this book BY TOKEN (current, not
  // revoked), client not archived, section present + not hidden + collapse-
  // eligible, AND the value actually changes. Reused verbatim by the sync bump.
  const predicate = Prisma.sql`
    EXISTS (
      SELECT 1 FROM "ViewbookSection" s
      JOIN "Viewbook" v ON v."id" = s."viewbookId"
      JOIN "Client" c ON c."id" = v."clientId"
      WHERE s."viewbookId" = ${viewbook.id}
        AND s."sectionKey" = ${sectionKey}
        AND s."state" <> 'hidden'
        AND s."collapsedShared" <> ${collapsed}
        AND v."token" = ${token}
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
  const [bumped, changed] = await prisma.$transaction([
    syncVersionBumpWhere(viewbook.id, predicate),
    update,
  ])

  // Inspect BOTH counts (Codex FIX-3):
  //  - 1/1 → real change, success.
  //  - mismatched (1/0 or 0/1) → invariant violation, throw.
  //  - 0/0 → no-op: either already at the requested value (honest replay) OR
  //          blocked by the predicate (revoked/archived/hidden/rotated token).
  //          Re-read to tell them apart — only return success when the persisted
  //          value already equals the request; anything else is 409/blocked.
  if (bumped !== changed) throw new HttpError(500, 'collapse_invariant')
  if (changed === 0) {
    const row = await prisma.viewbookSection.findUnique({
      where: { viewbookId_sectionKey: { viewbookId: viewbook.id, sectionKey } },
      select: { collapsedShared: true, state: true },
    })
    if (!row || row.state === 'hidden' || row.collapsedShared !== collapsed) {
      throw new HttpError(409, 'collapse_blocked') // never fabricate a 200
    }
    // else: genuine idempotent replay — value already what caller asked for.
  }
  return { collapsedShared: collapsed }
}
```

Notes: confirm `Client.archivedAt` + `SECTION_KEYS` export names against the code during impl (the ack/robots layers use the same archived-client guard; `SECTION_KEYS` lives in `theme.ts`). The 0/0 re-read still can't observe a rotated/revoked token if the row value coincidentally matches — that's acceptable (the value IS what was asked and the token check already ran in `requireViewbookToken` preflight); the predicate's `v."token"` guard is the TOCTOU fence for the WRITE itself.

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

- [ ] **Step 1: Failing route tests** (Codex FIX-PR2-ROUTE-CONTRACT-COVERAGE — full contract):

```ts
// mirror app/api/viewbook/[token]/ack route test setup (same-site header, JSON content-type)
it('anonymous collapsed=true → 200 collapsedShared:true', async () => {})
it('anonymous collapsed=false → 403 operator_required', async () => {})
it('operator collapsed=false → 200 collapsedShared:false', async () => {})
it('missing same-site header → rejected', async () => {})
it('wrong content-type → rejected', async () => {})
it('invalid/unknown token → 404', async () => {})
it('rotated token (old value) → 404', async () => {})
it('unknown sectionKey → 400 invalid_section', async () => {})
it('hidden section → 409 collapse_blocked (and NO sync bump)', async () => {})
it('revoked viewbook / archived client → blocked (and NO sync bump)', async () => {})
it('uses the collapse:<token> throttle bucket (an ack POST for the same token still succeeds after collapse spam)', async () => {})
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
  // Parse the bounded body BEFORE resolving optional operator status (Codex FIX-4:
  // preserve the documented preflight order; operator resolution is additive and
  // must never weaken token authorization).
  const input = parseInput(await readBoundedJson(request, BODY_CAP_BYTES))
  const isOperator = (await resolveOperatorEmail(request)) != null
  const result = await setSectionCollapsedShared(viewbook, token, { ...input, isOperator })
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
