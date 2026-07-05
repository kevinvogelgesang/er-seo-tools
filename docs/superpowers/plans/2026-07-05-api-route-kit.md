# API Route Kit (A3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small `lib/api/` toolkit (`withRoute` / `HttpError` / `parseJsonBody`) and tests for the 21 currently-untested API routes, then adopt the kit on a safe subset of routes — without changing observable behavior except deliberate, enumerated normalizations.

**Architecture:** Three phases ordered as a risk control. Phase 1 pins the current behavior of all 21 untested routes with characterization tests (these PASS against current code — they are a safety net, not red-green). Phase 2 builds the kit with genuine TDD. Phase 3 adopts the kit on plain-JSON cookie-gated routes, each edit made only with its Phase-1 test green; deliberate normalizations update the test in the same commit.

**Tech Stack:** Next.js 15 App Router route handlers, TypeScript, Vitest (node environment, `globals: false`, `fileParallelism: false`), Prisma/SQLite.

## Global Constraints

- **No auth logic in `withRoute()`** — `middleware.ts` owns cookie auth; only `mint-token` + `qct_` token routes verify in-handler and stay untouched.
- **No new dependencies** — no zod. Validation stays inline; the kit adds only `parseJsonBody()`.
- **No logging layer** — A4 owns pino. The kit uses a single `console.error` in the 500 branch only.
- **500 bodies never leak `error.message`** — always `{ error: 'internal_error' }`.
- **Prisma mapping in `withRoute` is a last-resort net** — it catches only Prisma errors the handler did not already handle; route-specific error semantics (e.g. `clients` human-readable 409) are preserved.
- **Tests: node env, no `@vitest-environment` docblock; explicit vitest imports** (`globals: false`). Local runs prefix `DATABASE_URL="file:./local-dev.db"`.
- **DB-backed tests namespace fixtures with a unique prefix** and clean up in `beforeEach`/`afterAll`, deleting child/CrawlRun rows before parents.
- **Never run a live crawl in a test** — `discoverPages` is always mocked (change-control rule 3).
- **Gate before PR:** `npm run lint` (tsc) + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`, all green.
- **Commit-message trailers** (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0164SKzWEYXkt5NnRXUNZKvY
  ```

---

## Phase 1 — Characterization tests (pin current behavior; PASS against current code)

> These tests document behavior AS-IS, warts included. They must pass on the
> unmodified routes. If one fails, the test is wrong OR you found a real bug —
> stop and investigate; do not "fix" the route in Phase 1.
>
> **Match the house style exactly.** Read these existing tests as your pattern
> reference before writing:
> - DB-backed: `app/api/clients/[id]/route.test.ts`, `app/api/site-audit/route.test.ts`
> - Mocked-lib/mocked-prisma: `app/api/seo-parser/[sessionId]/pages/route.test.ts`, `lib/jobs/handlers/site-audit-discover.test.ts` (for the `discoverPages` mock idiom)
> - Token (Bearer): `app/api/pillar-analysis/[id]/mint-token/route.test.ts`

### Exemplars (one per response/auth style — reuse the shape, change the specifics)

**A. DB-backed cookie-gated route** (real Prisma, prefix-namespaced fixtures):

```ts
// @ts-nocheck  ← DO NOT add this; shown only to keep the plan snippet short
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { PATCH, DELETE } from './route'

const PREFIX = '__a3sched__'
const params = (clientId: string, scheduleId: string) => ({
  params: Promise.resolve({ id: clientId, scheduleId }),
})
async function clear() {
  await prisma.schedule.deleteMany({ where: { name: { startsWith: PREFIX } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
}
beforeEach(clear)
afterAll(clear)

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('PATCH /api/clients/[id]/schedules/[scheduleId]', () => {
  it('400 invalid_json on malformed body', async () => {
    const req = new NextRequest('http://localhost/api/clients/1/schedules/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    const res = await PATCH(req, params('1', '1'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })
  // ...remaining cases from the case table below
})
```

**B. Mocked-lib route** (`site-audit/discover` — mock the network crawl):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const discoverPagesMock = vi.fn()
vi.mock('@/lib/ada-audit/sitemap-crawler', () => ({
  discoverPages: (...a: unknown[]) => discoverPagesMock(...a),
}))
import { POST } from './route' // import AFTER the mock

beforeEach(() => discoverPagesMock.mockReset())

it('returns discovered urls for a valid domain', async () => {
  discoverPagesMock.mockResolvedValue({ urls: ['https://x.test/a'], mode: 'sitemap', capped: false })
  const req = new NextRequest('http://localhost/api/site-audit/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'x.test' }),
  })
  const res = await POST(req)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.pageCount).toBe(1)
})

it('422 when discoverPages throws', async () => {
  discoverPagesMock.mockRejectedValue(new Error('boom'))
  const req = new NextRequest('http://localhost/api/site-audit/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'x.test' }),
  })
  const res = await POST(req)
  expect(res.status).toBe(422)
})
```

**C. Streaming response** — read text + assert headers, never `.json()`:

```ts
const res = await GET(req, params(sessionId))
expect(res.status).toBe(200)
expect(res.headers.get('Content-Disposition')).toContain('attachment')
const text = await res.text()
expect(text.length).toBeGreaterThan(0)
```

**D. Raw-file response** (`screenshots`) — assert content-type + arrayBuffer:

```ts
const res = await GET(req, { params: Promise.resolve({ auditId: 'bad/../id', filename: 'x.png' }) })
expect(res.status).toBe(404) // path-traversal rejected
```

**E. Token (`qct_`) route** — mint real token; hand-mint with `jose` for scope/expiry failures:

```ts
import { mintQuarterPushToken } from '@/lib/quarter-push-token'
import { SignJWT } from 'jose'

async function authHeader(planId: string) {
  const { token } = await mintQuarterPushToken(planId)
  return { Authorization: `Bearer ${token}` }
}
// scope-failure: hand-mint a token missing the required scope, prefixed qct_
```

### Task 1: ADA-audit untested routes

**Files:**
- Test: `app/api/ada-audit/[id]/checks/route.test.ts` (Create)
- Test: `app/api/ada-audit/screenshots/[auditId]/[filename]/route.test.ts` (Create)
- Test: `app/api/ada-audit/share/[token]/checks/route.test.ts` (Create)

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `getAdaAuditChecks`/`setAdaAuditCheck` from `@/lib/ada-audit/checks-store`; handlers from each `./route`.
- Produces: nothing (test-only).

Case table (assert exact status + `body.error` code; DB-backed style A, create a real `AdaAudit`/`SiteAudit` fixture where a row is needed):

`ada-audit/[id]/checks` — GET returns `{ checks }` (200) for existing audit; **404 `Audit not found`** for missing id. PUT: `400 Invalid JSON` on `'{not json'`; `400` when `scope!=='node'`, `key` non-string, `checked` non-boolean, or `key` not matching `/^[0-9a-f]{64}$/`; 200 `{ checks }` on a valid 64-hex key (assert `setAdaAuditCheck` persisted via a follow-up GET).

`ada-audit/screenshots/[auditId]/[filename]` — GET **404** when `auditId`/`filename` fail the traversal allowlist regex; **404 `Not found`** when the file is absent. (No fixture file needed — assert the 404 paths only.)

`ada-audit/share/[token]/checks` — GET **404 `Share link not found or expired`** for unknown token, non-`complete` status, or missing/expired `shareExpiresAt`; 200 `{ checks }` for a complete audit with a valid unexpired `shareToken` fixture.

- [ ] **Step 1:** Write the three test files per the case table, style A + exemplar D for screenshots.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/ada-audit/[id]/checks app/api/ada-audit/screenshots app/api/ada-audit/share/[token]/checks` — Expected: PASS (pins current behavior). If any fails, investigate before proceeding.
- [ ] **Step 3:** Commit — `test(a3): characterize ada-audit checks/screenshots/share-checks routes`.

### Task 2: Brief + diff routes

**Files:**
- Test: `app/api/brief/[sessionId]/route.test.ts` (Create)
- Test: `app/api/brief/live/route.test.ts` (Create)
- Test: `app/api/diff/route.test.ts` (Create)

**Interfaces:** Consumes `prisma`, `isValidSessionId` semantics (via real session fixtures or mocked service). Produces nothing.

Case table:

`brief/[sessionId]` (POST) — `400 Invalid session ID` for a bad `sessionId`; `400 Client name is required` when `clientName` absent (note: bad JSON currently defaults to `{}`, so a malformed body with no clientName hits the `400 Client name is required` path — pin that); **`500` currently returns `{ error: <message> }`** — pin the leak (assert `res.status===500`; a Phase-3 task will change this). Success path (`{ brief, stats, filesProcessed }`) may be skipped if wiring a full session-with-files fixture is impractical — cover the validation + error branches, which is where the kit lands.

`brief/live` (POST) — `400 Invalid JSON body` on `'{not json'`; `400` for non-object body, non-positive-int `clientId`, empty/non-string `domain`; `404` (`No canonical SEO run found...`) when the canonical run is null; pin the outer-catch `500 { error: <message> }` leak.

`diff` (POST) — `400 Invalid JSON body` on malformed; `400` for `sessionAId`/`sessionBId` failing `isValidSessionId`; `404` when a session is missing; `400` when a session status `!== 'complete'`; `409 session_archived` when pruned. Use real session fixtures (style A) or a mocked `@/lib/db` (style B) — pick whichever is less fixture-heavy for these read paths.

- [ ] **Step 1:** Write the three test files per the case table.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/brief app/api/diff` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize brief + diff routes (pins current 500 leaks)`.

### Task 3: Export routes (streaming)

**Files:**
- Test: `app/api/export/[sessionId]/[format]/route.test.ts` (Create)
- Test: `app/api/export/[sessionId]/claude/route.test.ts` (Create)

**Interfaces:** Consumes `prisma`; assert with exemplar C (streaming — `res.text()` + headers).

Case table:

`export/[sessionId]/[format]` (GET) — `400` for a `format` not in `{json,summary,markdown}`; `400 Invalid session ID`; `404 Session not found`; `400 'Parsing not complete'` for a non-complete session; success: 200 with `Content-Disposition: attachment` and `Content-Type` matching the format (`application/json` for json, `text/markdown` for markdown). Read via `res.text()`.

`export/[sessionId]/claude` (GET) — `400` invalid session; `404` not found; `400 'Parsing not complete'`; `409 session_archived` when `archivePrunedAt` set and no result; success: 200 streamed attachment.

- [ ] **Step 1:** Write both test files (streaming assertions, exemplar C). Create a complete session fixture for the success path.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/export` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize export (streaming) routes`.

### Task 4: Clients + schedules routes

**Files:**
- Test: `app/api/clients/route.test.ts` (Create)
- Test: `app/api/clients/[id]/schedules/[scheduleId]/route.test.ts` (Create)

**Interfaces:** Consumes `prisma`, handlers `GET`/`POST` from `./route`, `PATCH`/`DELETE` from the schedule route; `cancelJobsByGroup` side effect (assert Schedule row gone rather than job internals). Style A.

Case table:

`clients` — GET 200 returns an array (assert a namespaced fixture client appears). POST 201 `{ ...client }` on `{ name }`; `400 name is required` when name missing; `409 A client with that name already exists` on duplicate (create the fixture twice); **pin the current bad-JSON behavior: malformed body → `500`** (this is the defect Phase 3 fixes — assert `500` here).

`clients/[id]/schedules/[scheduleId]` — PATCH `400 invalid_json` on malformed; `400 enabled_required` when `enabled` absent/non-boolean; `404 not_found` for a schedule not owned by the client; `409 client_archived` when re-enabling on an archived client; 200 `{ ok: true }` on success (assert `nextRunAt` recomputed / row updated). DELETE: `404 not_found` for missing; 200 `{ ok: true }` on success (assert `prisma.schedule.count` is 0 after).

- [ ] **Step 1:** Write both test files (style A). For schedules, create a real Client + Schedule (`name` prefixed) fixture; cadence must be literal `weekly:`/`monthly:` per C2 rules.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/clients/route app/api/clients/[id]/schedules/[scheduleId]` — Expected: PASS (incl. the `500`-on-bad-JSON pin).
- [ ] **Step 3:** Commit — `test(a3): characterize clients list/create + schedule PATCH/DELETE`.

### Task 5: Quarter-plan cookie routes

**Files:**
- Test: `app/api/quarter-plan/activity/route.test.ts` (Create)
- Test: `app/api/quarter-plan/import/route.test.ts` (Create)
- Test: `app/api/quarter-plan/push/mint-token/route.test.ts` (Create)

**Interfaces:** Consumes `prisma`; `AUTH_COOKIE_NAME`/`createAuthCookieValue` from `@/lib/auth` for the mint-token in-handler cookie check. `activity`/`queue` handlers are no-arg `GET()`.

Case table:

`quarter-plan/activity` (GET, no-arg) — 200 `{ activity }`; when no plan exists, 200 `{ activity: {} }`.

`quarter-plan/import` (POST) — `400 Invalid JSON body` on malformed; `400` with `sanitizePlanPayload`'s error for an invalid payload; 201 on a valid create; `409 A quarter plan already exists` when a plan already exists (createOnly conflict). Clean up the created QuarterPlan in `afterAll`.

`quarter-plan/push/mint-token` (POST) — **`401 auth_required` when no auth cookie** (explicit in-handler check — set/omit the `cookie` header to exercise both); with a valid cookie: `409 no_plan` when no plan; `409 nothing_planned` when the plan has nothing pushable; 200 `{ token, planId }` with `token` matching `/^qct_/` when pushable.

- [ ] **Step 1:** Write the three files. mint-token uses the cookie-auth idiom (`cookie: ${AUTH_COOKIE_NAME}=${await createAuthCookieValue({sub:'test:op',email:null,hd:null,name:null})}`).
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/quarter-plan/activity app/api/quarter-plan/import app/api/quarter-plan/push/mint-token` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize quarter-plan activity/import/mint-token`.

### Task 6: Quarter-plan token (qct_) routes

**Files:**
- Test: `app/api/quarter-plan/push/[planId]/route.test.ts` (Create)
- Test: `app/api/quarter-plan/push/[planId]/receipt/route.test.ts` (Create)

**Interfaces:** Consumes `mintQuarterPushToken` from `@/lib/quarter-push-token`, `SignJWT` from `jose`, `prisma`. Bearer exemplar E. Requires the `qct_` token secret env stubbed the same way the existing quarter-push token tests do — check `lib/quarter-push-token.ts` for the env var name and `vi.stubEnv` it.

Case table:

`push/[planId]` (GET) — `401 auth_missing_or_malformed` with no/garbage `Authorization`; `401` with `token_expired`/`token_wrong_plan_id`/`token_invalid_signature`/`token_invalid` (hand-mint the matching failure); `401 token_missing_scope` when the token lacks `'read'`; `404 not_found` when the plan is not the latest; 200 `{ planId, assignments, ... }` on a valid `read`-scoped token for the latest plan.

`push/[planId]/receipt` (POST) — `401 auth_missing_or_malformed`; token errors → `401`; `401 token_missing_scope` without `'receipt-write'`; `400 Invalid JSON body` on malformed body (with a valid token); `404 not_found` when not the latest plan; 200 `{ ok: true }` on success (assert `teamworkPushedAt` written).

- [ ] **Step 1:** Write both files (exemplar E). Create a real QuarterPlan fixture and mint a scoped token against its id.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/quarter-plan/push/[planId]` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize quarter-plan qct_ push GET + receipt`.

### Task 7: Public share routes

**Files:**
- Test: `app/api/share/route.test.ts` (Create)
- Test: `app/api/share/[token]/route.test.ts` (Create)

**Interfaces:** Consumes `prisma` (`shareLink`, `session`). Style A. No auth (public).

Case table:

`share` (POST) — `400 Invalid JSON body` on malformed; `400 Invalid or missing sessionId` when `sessionId` fails `isValidSessionId`; `404 Session not found`; `400 Session is not complete`; success 200 `{ token, shareUrl, expiresAt }` (create a complete Session fixture; assert a `ShareLink` row was created).

`share/[token]` (GET) — `400 Invalid token`; `404 Share link not found`; `410 Share link has expired` (create an expired `ShareLink`); `400` when the session is not complete; success 200 `{ result, expiresAt, sessionId, siteName }` (assert `accessCount` increments — fire-and-forget, so re-read after a tick or assert best-effort).

- [ ] **Step 1:** Write both files (style A). Note the `410` (not 404) for expiry.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/share/route app/api/share/[token]` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize public share create + read routes`.

### Task 8: Site-audit + seo-parser-run untested routes

**Files:**
- Test: `app/api/site-audit/[id]/checks/route.test.ts` (Create)
- Test: `app/api/site-audit/discover/route.test.ts` (Create)
- Test: `app/api/site-audit/queue/route.test.ts` (Create)
- Test: `app/api/seo-parser/run/[runId]/pages/route.test.ts` (Create)

**Interfaces:** Consumes `prisma`; `setSiteAuditCheck`/`getSiteAuditChecks` from `@/lib/ada-audit/checks-store`; `discoverPages` from `@/lib/ada-audit/sitemap-crawler` (MOCKED, exemplar B); `getQueueStatus` from `@/lib/ada-audit/queue-manager` (mock or real). `queue`/`discover` handlers: `queue` is no-arg `GET()`, `discover` is `POST(request)` (no params).

Case table:

`site-audit/[id]/checks` — GET 200 `{ checks }`; **404 `Audit not found`**. PUT: `400 Invalid JSON` on malformed; `400` when `scope` not in `{'page','page-violation'}`, `key` non-string, `checked` non-boolean, or `key` not 64-hex; 200 `{ checks }` on valid (assert `setSiteAuditCheck` persisted).

`site-audit/discover` (POST) — `400 Invalid JSON body`; `400` when `domain` missing; `400 Invalid domain...` for a domain failing the normalize/regex; **`422`** when the mocked `discoverPages` rejects; 200 `{ domain, pageCount, urls }` on success. **`discoverPages` MUST be mocked** — never a live crawl.

`site-audit/queue` (GET, no-arg) — 200 with the queue-status shape from `getQueueStatus()`.

`seo-parser/run/[runId]/pages` (GET) — 200 `{ pages, total }` for a real `CrawlRun` (`tool:'seo-parser'`) with pages; **`{ pages: [], total: 0 }` (200, NOT 404)** when the run is missing or `tool !== 'seo-parser'`; respect `limit` clamp (1–200) and `offset`.

- [ ] **Step 1:** Write the four files. `discover` uses exemplar B (mock `@/lib/ada-audit/sitemap-crawler`).
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/[id]/checks app/api/site-audit/discover app/api/site-audit/queue app/api/seo-parser/run` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize site-audit checks/discover/queue + seo-parser run pages`.

### Task 9: Phase-1 gate

- [ ] **Step 1:** Run the full suite: `DATABASE_URL="file:./local-dev.db" npm test` — Expected: PASS, test count up by 21 files.
- [ ] **Step 2:** Run `npm run lint` — Expected: clean.
- [ ] **Step 3:** No commit (gate only). All 21 untested routes now have behavior-pinning tests — the roadmap's "route tests" deliverable is met before any refactor.

---

## Phase 2 — The kit (`lib/api/`)

### Task 10: `HttpError` + `parseJsonBody`

**Files:**
- Create: `lib/api/errors.ts`
- Create: `lib/api/body.ts`
- Test: `lib/api/errors.test.ts`, `lib/api/body.test.ts`

**Interfaces:**
- Produces: `class HttpError extends Error { status: number; code: string }`; `async function parseJsonBody<T = unknown>(req: NextRequest): Promise<T>` (throws `HttpError(400, 'invalid_json')` on parse failure).

- [ ] **Step 1: Write failing tests** (`lib/api/body.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { parseJsonBody } from './body'
import { HttpError } from './errors'

describe('parseJsonBody', () => {
  it('parses a valid JSON body', async () => {
    const req = new NextRequest('http://localhost/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    })
    expect(await parseJsonBody<{ a: number }>(req)).toEqual({ a: 1 })
  })
  it('throws HttpError(400, invalid_json) on malformed body', async () => {
    const req = new NextRequest('http://localhost/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
    })
    await expect(parseJsonBody(req)).rejects.toMatchObject({ status: 400, code: 'invalid_json' })
  })
})
```

And `lib/api/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { HttpError } from './errors'
it('carries status + code', () => {
  const e = new HttpError(409, 'conflict')
  expect(e.status).toBe(409)
  expect(e.code).toBe('conflict')
  expect(e).toBeInstanceOf(Error)
})
```

- [ ] **Step 2: Run — verify FAIL** (`not defined`): `DATABASE_URL="file:./local-dev.db" npx vitest run lib/api/errors lib/api/body`
- [ ] **Step 3: Implement**:

```ts
// lib/api/errors.ts
export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code)
    this.name = 'HttpError'
  }
}
```

```ts
// lib/api/body.ts
import type { NextRequest } from 'next/server'
import { HttpError } from './errors'

export async function parseJsonBody<T = unknown>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}
```

- [ ] **Step 4: Run — verify PASS.**
- [ ] **Step 5: Commit** — `feat(a3): add lib/api HttpError + parseJsonBody`.

### Task 11: `withRoute`

**Files:**
- Create: `lib/api/with-route.ts`
- Test: `lib/api/with-route.test.ts`

**Interfaces:**
- Consumes: `HttpError` from `./errors`.
- Produces: `function withRoute<A extends unknown[]>(handler: (...args: A) => Promise<Response> | Response): (...args: A) => Promise<Response>`. Rest-args typing so no-arg `GET()`, `(req)`, and `(req, ctx)` all type-check; Next 15 async `params` unaffected (it's inside `ctx`).

- [ ] **Step 1: Write failing tests** (`lib/api/with-route.test.ts`):

```ts
import { describe, it, expect, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { withRoute } from './with-route'
import { HttpError } from './errors'

function prismaKnown(code: string) {
  return new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: '5' } as never)
}

describe('withRoute', () => {
  it('passes a normal Response through unchanged', async () => {
    const wrapped = withRoute(async () => NextResponse.json({ ok: true }, { status: 201 }))
    const res = await wrapped()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })
  })
  it('maps HttpError to its status + code', async () => {
    const wrapped = withRoute(async () => { throw new HttpError(404, 'not_found') })
    const res = await wrapped()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })
  it('maps Prisma P2025 -> 404 not_found', async () => {
    const wrapped = withRoute(async () => { throw prismaKnown('P2025') })
    const res = await wrapped()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })
  it('maps Prisma P2002 -> 409 conflict', async () => {
    const wrapped = withRoute(async () => { throw prismaKnown('P2002') })
    const res = await wrapped()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('conflict')
  })
  it('maps an unknown throw -> 500 internal_error with no message leak', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapped = withRoute(async () => { throw new Error('secret detail') })
    const res = await wrapped()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('internal_error')
    expect(JSON.stringify(body)).not.toContain('secret detail')
    spy.mockRestore()
  })
  it('passes ctx args through to the handler', async () => {
    const wrapped = withRoute(async (_req: unknown, ctx: { params: Promise<{ id: string }> }) => {
      const { id } = await ctx.params
      return NextResponse.json({ id })
    })
    const res = await wrapped({} as never, { params: Promise.resolve({ id: '7' }) })
    expect((await res.json()).id).toBe('7')
  })
})
```

- [ ] **Step 2: Run — verify FAIL.**
- [ ] **Step 3: Implement**:

```ts
// lib/api/with-route.ts
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { HttpError } from './errors'

export function withRoute<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.code }, { status: err.status })
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return NextResponse.json({ error: 'not_found' }, { status: 404 })
        if (err.code === 'P2002') return NextResponse.json({ error: 'conflict' }, { status: 409 })
      }
      console.error('[api] unhandled route error', err)
      return NextResponse.json({ error: 'internal_error' }, { status: 500 })
    }
  }
}
```

- [ ] **Step 4: Run — verify PASS.**
- [ ] **Step 5: Verify typing** — add a compile-only smoke to the test file (no-arg + (req,ctx) both wrapped) and run `npm run lint`. Expected: clean.
- [ ] **Step 6: Commit** — `feat(a3): add lib/api withRoute wrapper`.

---

## Phase 3 — Opportunistic adoption (under green Phase-1 tests)

> For each route: (1) if a deliberate normalization applies, update its Phase-1
> test to expect the new behavior in the SAME commit, with a one-line comment;
> (2) refactor the route onto `withRoute`/`parseJsonBody`; (3) run that route's
> test — green. Any UNexpected red = drift; stop and reconcile.

### Task 12: Adopt on `clients/route.ts` (fixes bad-JSON 500)

**Files:** Modify `app/api/clients/route.ts`; Modify `app/api/clients/route.test.ts`.

Deliberate change: POST malformed body `500` → `400 invalid_json`. The duplicate-name `409 A client with that name already exists` is PRESERVED — keep the route's explicit P2002 catch (do not delegate it to `withRoute`'s generic mapper).

- [ ] **Step 1:** Update the bad-JSON test case: expect `400` + `invalid_json` (comment: `// A3: normalized from 500`).
- [ ] **Step 2:** Wrap `GET`/`POST` in `withRoute`; replace the inline `await request.json()` with `parseJsonBody(request)`; keep the explicit `catch` mapping P2002 → the human 409 (so that behavior is unchanged).
- [ ] **Step 3:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/clients/route` — Expected: PASS (409 unchanged, bad-JSON now 400).
- [ ] **Step 4:** Commit — `refactor(a3): adopt withRoute on clients route (bad-JSON 500->400)`.

### Task 13: Adopt on `brief/[sessionId]` + `brief/live` (stops message leak)

**Files:** Modify both routes + their Phase-1 tests.

Deliberate change: the outer-catch `500 { error: <message> }` → `500 { error: 'internal_error' }`.

- [ ] **Step 1:** Update both tests' 500 cases: expect `body.error === 'internal_error'` (comment: `// A3: no longer leaks message`).
- [ ] **Step 2:** Wrap the `POST` handlers in `withRoute`; delete the manual outer try-catch (withRoute owns it); use `parseJsonBody` for `brief/live`. For `brief/[sessionId]`, keep the `.catch(()=>({}))` default ONLY if a test pins the `{}`-default validation path — otherwise replace with `parseJsonBody` and update that test case to `400 invalid_json` (note it as a second deliberate change if so).
- [ ] **Step 3:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/brief` — Expected: PASS.
- [ ] **Step 4:** Commit — `refactor(a3): adopt withRoute on brief routes (stop 500 message leak)`.

### Task 14: Adopt on `diff` + `quarter-plan/import` (bad-JSON code normalization)

**Files:** Modify both routes + their Phase-1 tests.

Deliberate change: `400 "Invalid JSON body"` → `400 invalid_json`.

- [ ] **Step 1:** Update both tests' malformed-body cases to expect `invalid_json` (comment noting the normalization).
- [ ] **Step 2:** Wrap handlers in `withRoute`; swap inline JSON parse for `parseJsonBody`; preserve all other status codes (`404`/`400`/`409 session_archived`/`409 A quarter plan already exists`) by keeping their explicit throws/returns (convert to `throw new HttpError(...)` where it tidies the code, keeping the SAME code string — e.g. `HttpError(409, 'session_archived')`).
- [ ] **Step 3:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/diff app/api/quarter-plan/import` — Expected: PASS.
- [ ] **Step 4:** Commit — `refactor(a3): adopt withRoute on diff + quarter-plan/import`.

### Task 15: Adopt on `site-audit/[id]/checks` + `ada-audit/[id]/checks` (bad-JSON code normalization)

**Files:** Modify both routes + their Phase-1 tests.

Deliberate change: `400 "Invalid JSON"` → `400 invalid_json`.

- [ ] **Step 1:** Update both tests' PUT malformed-body cases to expect `invalid_json`.
- [ ] **Step 2:** Wrap `GET`/`PUT` in `withRoute`; swap to `parseJsonBody`; convert the `404 Audit not found` and the validation `400`s to explicit `HttpError` throws with the SAME code strings, OR leave them as direct `NextResponse.json` returns (withRoute passes returns through). Keep the `getOperatorLabel` logic unchanged.
- [ ] **Step 3:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/[id]/checks app/api/ada-audit/[id]/checks` — Expected: PASS.
- [ ] **Step 4:** Commit — `refactor(a3): adopt withRoute on site-audit + ada-audit checks routes`.

### Task 16: Adopt on behavior-preserving reads (`clients/[id]/schedules/[scheduleId]`, `quarter-plan/activity`, `site-audit/queue`)

**Files:** Modify the three routes + relevant Phase-1 tests (expect NO assertion changes — pure envelope/net adoption).

- [ ] **Step 1:** Wrap each handler in `withRoute`. For `schedules/[scheduleId]` keep `invalid_json`/`enabled_required`/`not_found`/`client_archived` codes exactly (they already match the kit's style — convert to `HttpError` throws or leave as returns). `quarter-plan/activity` + `site-audit/queue` are no-arg `GET()` — `withRoute(async () => ...)` must type-check (verified in Task 11).
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/clients/[id]/schedules/[scheduleId] app/api/quarter-plan/activity app/api/site-audit/queue` — Expected: PASS with NO test changes.
- [ ] **Step 3:** Commit — `refactor(a3): adopt withRoute on schedule/activity/queue reads`.

### Task 17: Docs + new-route guidance + final gate

**Files:** Modify `CLAUDE.md` (add `lib/api/` to Key files + a one-line "new routes use `withRoute` + `parseJsonBody`" note); Modify `.claude/skills/er-seo-tools-extension-recipes/SKILL.md` (route recipe references the kit). Tracker + handoff handled in the ship ritual, not here.

- [ ] **Step 1:** Add the `lib/api/` Key-files entry + new-route guidance to CLAUDE.md.
- [ ] **Step 2:** Update the extension-recipes route recipe to use `withRoute`.
- [ ] **Step 3:** Full gate: `npm run lint` && `DATABASE_URL="file:./local-dev.db" npm test` && `npm run build` — Expected: all green.
- [ ] **Step 4:** Commit — `docs(a3): document lib/api route kit + new-route guidance`.

---

## Self-review notes

- **Spec coverage:** Phase 1 (Tasks 1–8) covers all 21 untested routes; Task 9 gates it. Phase 2 (Tasks 10–11) builds the kit per spec. Phase 3 (Tasks 12–16) adopts the enumerated safe subset; every deliberate normalization from the spec's "Bad-JSON standardization" block maps to a task (clients→T12, brief leaks→T13, diff/import→T14, checks→T15). Excluded routes (streaming/file/public-share/token) are test-only (Tasks 3, 1-screenshots, 7, 6) and never adopted — matches the spec's exclusion list. Docs (Task 17) = spec's Phase-3 deliverable.
- **No auth added to withRoute** — honored (Global Constraints).
- **Prisma mapping = last-resort net** — honored: T12 keeps clients' explicit 409; T14/T15 keep specific codes via explicit throws.
- **Placeholder scan:** all test tasks give exemplars + explicit case tables (status + code per case); kit tasks give full code. No TBDs.
- **Type consistency:** `withRoute` rest-args signature (T11) supports the no-arg handlers used in T16; `HttpError(status, code)` and `parseJsonBody` signatures consistent across T10/T11/T12–16.
