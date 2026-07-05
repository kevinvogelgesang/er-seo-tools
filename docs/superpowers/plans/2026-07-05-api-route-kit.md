# API Route Kit (A3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small `lib/api/` toolkit (`withRoute` / `HttpError` / `parseJsonBody`) and tests for the currently-untested API routes, then adopt the kit on a safe subset of routes — without changing observable behavior except deliberate, enumerated normalizations.

**Architecture:** Three phases ordered as a risk control. Phase 1 pins the current behavior of the untested routes with characterization tests (these PASS against current code — they are a safety net, not red-green). Phase 2 builds the kit with genuine TDD. Phase 3 adopts the kit on plain-JSON cookie-gated routes, each edit made only with its Phase-1 test green; deliberate normalizations update the test in the same commit.

**Tech Stack:** Next.js 15 App Router route handlers, TypeScript, Vitest (node environment, `globals: false`, `fileParallelism: false`), Prisma/SQLite.

## Scope correction (Codex plan review, 2026-07-05)

There are **16 routes with no test coverage**, not 21. The five quarter-plan
subroutes (`activity`, `import`, `push/mint-token`, `push/[planId]`,
`push/[planId]/receipt`) are ALREADY tested inside the monolithic
`app/api/quarter-plan/route.test.ts` — which carries an explicit warning that
these tests must stay in one file because `QuarterPlan` is a singleton over the
shared dev DB. **Do NOT create sibling test files for quarter-plan subroutes**
(it splits singleton tests and races the DB). Task 5 instead extends that one
file for any missing cases.

## Global Constraints

- **No auth logic in `withRoute()`** — `middleware.ts` owns cookie auth; only `mint-token` + `qct_` token routes verify in-handler and stay untouched.
- **No new dependencies** — no zod. Validation stays inline; the kit adds only `parseJsonBody()`.
- **No logging layer** — A4 owns pino. The kit uses a single `console.error` in the 500 branch only.
- **500 bodies never leak `error.message`** — always `{ error: 'internal_error' }`.
- **Prisma mapping in `withRoute` is a last-resort net** — it catches only Prisma errors the handler did not already handle; route-specific error semantics (e.g. `clients` human-readable 409) are preserved.
- **`vi.stubEnv('APP_AUTH_PASSWORD', 'test-password')` for any in-handler `isValidAuthCookie` test** — `isValidAuthCookie` dev-bypasses when `APP_AUTH_PASSWORD` is unset, so a "no cookie → 401" case only holds with the password stubbed; build the valid cookie under the same signing config.
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
> - Token (Bearer) + singleton discipline: `app/api/quarter-plan/route.test.ts`

### Exemplars (one per response/auth style — reuse the shape, change the specifics)

**A. DB-backed cookie-gated route** (real Prisma, prefix-namespaced fixtures):

```ts
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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'x.test' }),
  })
  const res = await POST(req)
  expect(res.status).toBe(200)
  expect((await res.json()).pageCount).toBe(1)
})

it('422 when discoverPages throws', async () => {
  discoverPagesMock.mockRejectedValue(new Error('boom'))
  const req = new NextRequest('http://localhost/api/site-audit/discover', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'x.test' }),
  })
  expect((await POST(req)).status).toBe(422)
})
```

**C. Streaming response** — read text + assert headers, never `.json()`:

```ts
const res = await GET(req, params(sessionId))
expect(res.status).toBe(200)
expect(res.headers.get('Content-Disposition')).toContain('attachment')
expect((await res.text()).length).toBeGreaterThan(0)
```

**D. Raw-file response** (`screenshots`) — 404-only characterization (see Task 1 note):

```ts
const res = await GET(req, { params: Promise.resolve({ auditId: '../etc', filename: 'x.png' }) })
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

**Interfaces:** Consumes `prisma` from `@/lib/db`; `getAdaAuditChecks`/`setAdaAuditCheck` from `@/lib/ada-audit/checks-store`; handlers from each `./route`. Produces nothing.

Case table (assert exact status + `body.error` code; DB-backed style A):

`ada-audit/[id]/checks` — GET returns `{ checks }` (200) for an existing `AdaAudit` fixture; **404 `Audit not found`** for missing id. PUT: `400 Invalid JSON` on `'{not json'`; `400` when `scope!=='node'`, `key` non-string, `checked` non-boolean, or `key` not matching `/^[0-9a-f]{64}$/`; 200 `{ checks }` on a valid 64-hex key (assert `setAdaAuditCheck` persisted via a follow-up GET).

`ada-audit/screenshots/[auditId]/[filename]` — **404-only characterization** (Codex fix: no success fixture — avoids env-configured `SCREENSHOTS_DIR` setup). Assert **404** when `auditId`/`filename` fail the traversal allowlist regex, and **404 `Not found`** when the file is absent. The 200 image path is left to manual/integration coverage; note this in a comment.

`ada-audit/share/[token]/checks` — GET **404 `Share link not found or expired`** for unknown token, non-`complete` status, or missing/expired `shareExpiresAt`; 200 `{ checks }` for a complete audit with a valid unexpired `shareToken` fixture.

- [ ] **Step 1:** Write the three test files per the case table (style A + exemplar D for screenshots).
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/ada-audit/[id]/checks" "app/api/ada-audit/screenshots" "app/api/ada-audit/share/[token]/checks"` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize ada-audit checks/screenshots/share-checks routes`.

### Task 2: Brief + diff routes

**Files:**
- Test: `app/api/brief/[sessionId]/route.test.ts` (Create)
- Test: `app/api/brief/live/route.test.ts` (Create)
- Test: `app/api/diff/route.test.ts` (Create)

**Interfaces:** Consumes `prisma`, session fixtures / mocked services. Produces nothing.

Case table:

`brief/[sessionId]` (POST) — `400 Invalid session ID` for a bad `sessionId`; `400 Client name is required` when `clientName` absent; **pin that a malformed JSON body currently defaults to `{}` → `400 Client name is required`** (this behavior is PRESERVED in Phase 3 — see Task 12); pin the outer-catch `500 { error: <message> }` leak (assert `res.status===500`; Task 12 changes the leak, not the `{}` default). The full success path may be skipped if a full session-with-files fixture is impractical — cover validation + error branches.

`brief/live` (POST) — `400 Invalid JSON body` on `'{not json'`; `400` for non-object body, non-positive-int `clientId`, empty/non-string `domain`; `404` (`No canonical SEO run found...`) when the canonical run is null; pin the outer-catch `500 { error: <message> }` leak.

`diff` (POST) — `400 Invalid JSON body` on malformed; `400` for `sessionAId`/`sessionBId` failing `isValidSessionId`; `404` when a session is missing; `400` when a session status `!== 'complete'`; `409 session_archived` when pruned.

- [ ] **Step 1:** Write the three test files per the case table.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/brief app/api/diff` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize brief + diff routes (pins current 500 leaks + {} default)`.

### Task 3: Export routes (streaming)

**Files:**
- Test: `app/api/export/[sessionId]/[format]/route.test.ts` (Create)
- Test: `app/api/export/[sessionId]/claude/route.test.ts` (Create)

**Interfaces:** Consumes `prisma`; assert with exemplar C (streaming — `res.text()` + headers).

Case table:

`export/[sessionId]/[format]` (GET) — `400` for a `format` not in `{json,summary,markdown}`; `400 Invalid session ID`; `404 Session not found`; `400 'Parsing not complete'`; success: 200 with `Content-Disposition: attachment` and `Content-Type` matching the format. Read via `res.text()`.

`export/[sessionId]/claude` (GET) — `400` invalid session; `404` not found; `400 'Parsing not complete'`; `409 session_archived` when `archivePrunedAt` set and no result; success: 200 streamed attachment.

- [ ] **Step 1:** Write both test files (streaming assertions, exemplar C). Create a complete session fixture for the success path.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/export` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize export (streaming) routes`.

### Task 4: Clients + schedules routes

**Files:**
- Test: `app/api/clients/route.test.ts` (Create)
- Test: `app/api/clients/[id]/schedules/[scheduleId]/route.test.ts` (Create)

**Interfaces:** Consumes `prisma`; `GET`/`POST` from `./route`, `PATCH`/`DELETE` from the schedule route; `cancelJobsByGroup` side effect (assert Schedule row gone, not job internals). Style A.

Case table:

`clients` — GET 200 returns an array (assert a namespaced fixture appears). POST 201 `{ ...client }` on `{ name }`; `400 name is required` when missing; `409 A client with that name already exists` on duplicate; **pin the current bad-JSON behavior: malformed body → `500`** (the defect Task 11 fixes — assert `500` here).

`clients/[id]/schedules/[scheduleId]` — PATCH `400 invalid_json` on malformed; `400 enabled_required` when `enabled` absent/non-boolean; `404 not_found` for a schedule not owned by the client; `409 client_archived` when re-enabling on an archived client; 200 `{ ok: true }` on success. DELETE: `404 not_found` for missing; 200 `{ ok: true }` on success (assert `prisma.schedule.count` is 0 after). Cadence must be literal `weekly:`/`monthly:` (C2 rule).

- [ ] **Step 1:** Write both test files (style A) with prefixed Client + Schedule fixtures.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/clients/route" "app/api/clients/[id]/schedules/[scheduleId]"` — Expected: PASS (incl. the `500`-on-bad-JSON pin).
- [ ] **Step 3:** Commit — `test(a3): characterize clients list/create + schedule PATCH/DELETE`.

### Task 5: Extend the quarter-plan monolith for any missing cases (NO sibling files)

**Files:**
- Modify: `app/api/quarter-plan/route.test.ts` (extend in-file only)

**Interfaces:** The file already imports `IMPORT`, `ACTIVITY`, `MINT`, `EXPORT`, `RECEIPT`, `mintQuarterPushToken`, `SignJWT`. Add cases within the existing `describe` blocks / add new `describe`s in the SAME file. `QuarterPlan` is a singleton — reuse the file's existing cleanup (`prisma.quarterPlan.deleteMany({})`).

Read the existing file first and add ONLY the cases below that are not already asserted:

`quarter-plan/import` (POST) — `400 Invalid JSON body` on malformed; `400` with `sanitizePlanPayload`'s error; 201 on valid create; `409 A quarter plan already exists` on createOnly conflict.

`quarter-plan/activity` (GET, no-arg) — 200 `{ activity }`; 200 `{ activity: {} }` when no plan.

`quarter-plan/push/mint-token` (POST) — **`401 auth_required` with no auth cookie** (requires `vi.stubEnv('APP_AUTH_PASSWORD','test-password')` — see Global Constraints); `409 no_plan`; `409 nothing_planned`; 200 `{ token, planId }` with `token` matching `/^qct_/`.

`quarter-plan/push/[planId]` (GET, qct_) — `401 auth_missing_or_malformed`; token-error `401`s (hand-mint expired/wrong-plan/bad-sig); `401 token_missing_scope` without `'read'`; `404 not_found` when not the latest plan; 200 `{ planId, assignments, ... }` on a valid read token.

`quarter-plan/push/[planId]/receipt` (POST, qct_) — `401 auth_missing_or_malformed`; token `401`s; `401 token_missing_scope` without `'receipt-write'`; `400 Invalid JSON body` on malformed (valid token); `404 not_found` when not the latest; 200 `{ ok: true }` (assert `teamworkPushedAt` written).

- [ ] **Step 1:** Read `app/api/quarter-plan/route.test.ts`; add only the missing cases above, in-file.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/quarter-plan/route` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): extend quarter-plan monolith for missing subroute cases`.

### Task 6: Public share routes

**Files:**
- Test: `app/api/share/route.test.ts` (Create)
- Test: `app/api/share/[token]/route.test.ts` (Create)

**Interfaces:** Consumes `prisma` (`shareLink`, `session`). Style A. No auth (public).

Case table:

`share` (POST) — `400 Invalid JSON body` on malformed; `400 Invalid or missing sessionId`; `404 Session not found`; `400 Session is not complete`; success 200 `{ token, shareUrl, expiresAt }` (complete Session fixture; assert a `ShareLink` row created).

`share/[token]` (GET) — `400 Invalid token`; `404 Share link not found`; `410 Share link has expired` (expired `ShareLink` fixture); `400` when the session is not complete; success 200 `{ result, expiresAt, sessionId, siteName }`. **Do NOT assert `accessCount` increments** (Codex fix — it's a `void`-fire-and-forget update and re-read races).

- [ ] **Step 1:** Write both files (style A). Note the `410` (not 404) for expiry; no accessCount assertion.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/share/route" "app/api/share/[token]"` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize public share create + read routes`.

### Task 7: Site-audit + seo-parser-run untested routes

**Files:**
- Test: `app/api/site-audit/[id]/checks/route.test.ts` (Create)
- Test: `app/api/site-audit/discover/route.test.ts` (Create)
- Test: `app/api/site-audit/queue/route.test.ts` (Create)
- Test: `app/api/seo-parser/run/[runId]/pages/route.test.ts` (Create)

**Interfaces:** Consumes `prisma`; `setSiteAuditCheck`/`getSiteAuditChecks` from `@/lib/ada-audit/checks-store`; `discoverPages` from `@/lib/ada-audit/sitemap-crawler` (MOCKED, exemplar B); `getQueueStatus` from `@/lib/ada-audit/queue-manager`. `queue` is no-arg `GET()`; `discover` is `POST(request)` (no params).

Case table:

`site-audit/[id]/checks` — GET 200 `{ checks }`; **404 `Audit not found`**. PUT: `400 Invalid JSON` on malformed; `400` when `scope` not in `{'page','page-violation'}`, `key` non-string, `checked` non-boolean, or `key` not 64-hex; 200 `{ checks }` on valid (assert `setSiteAuditCheck` persisted).

`site-audit/discover` (POST) — `400 Invalid JSON body`; `400` when `domain` missing; `400 Invalid domain...` for a bad domain; **`422`** when the mocked `discoverPages` rejects; 200 `{ domain, pageCount, urls }`. **`discoverPages` MUST be mocked** — never a live crawl.

`site-audit/queue` (GET, no-arg) — 200 with the queue-status shape from `getQueueStatus()`.

`seo-parser/run/[runId]/pages` (GET) — 200 `{ pages, total }` for a real `CrawlRun` (`tool:'seo-parser'`) with pages; **`{ pages: [], total: 0 }` (200, NOT 404)** when the run is missing or `tool !== 'seo-parser'`; respect `limit` clamp (1–200) and `offset`.

- [ ] **Step 1:** Write the four files. `discover` uses exemplar B.
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/site-audit/[id]/checks" "app/api/site-audit/discover" "app/api/site-audit/queue" "app/api/seo-parser/run"` — Expected: PASS.
- [ ] **Step 3:** Commit — `test(a3): characterize site-audit checks/discover/queue + seo-parser run pages`.

### Task 8: Phase-1 gate

- [ ] **Step 1:** Run the full suite: `DATABASE_URL="file:./local-dev.db" npm test` — Expected: PASS; test files up by 15 (16 untested routes minus the 5 quarter-plan cases folded into the existing monolith file, plus screenshots/checks combined per task) and the quarter-plan monolith extended.
- [ ] **Step 2:** Run `npm run lint` — Expected: clean.
- [ ] **Step 3:** No commit (gate only). All 16 untested routes now have behavior-pinning tests and the quarter-plan monolith is filled — the roadmap's "route tests" deliverable is met before any refactor.

---

## Phase 2 — The kit (`lib/api/`)

### Task 9: `HttpError` + `parseJsonBody`

**Files:**
- Create: `lib/api/errors.ts`, `lib/api/body.ts`
- Test: `lib/api/errors.test.ts`, `lib/api/body.test.ts`

**Interfaces:**
- Produces: `class HttpError extends Error { readonly status: number; readonly code: string }`; `async function parseJsonBody<T = unknown>(req: NextRequest): Promise<T>` (throws `HttpError(400, 'invalid_json')` on parse failure).

- [ ] **Step 1: Write failing tests** (`lib/api/body.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { parseJsonBody } from './body'

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

### Task 10: `withRoute`

**Files:**
- Create: `lib/api/with-route.ts`
- Test: `lib/api/with-route.test.ts`

**Interfaces:**
- Consumes: `HttpError` from `./errors`.
- Produces: `function withRoute<A extends unknown[]>(handler: (...args: A) => Promise<Response> | Response): (...args: A) => Promise<Response>`. Rest-args typing so no-arg `GET()`, `(req)`, and `(req, ctx)` all type-check; Next 15 async `params` is inside `ctx` and unaffected.
- **A thrown `Response` is passed through** (returned as-is), not swallowed to 500 (Codex fix — avoids a route-kit trap for handlers that throw a redirect/response).

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
    const res = await withRoute(async () => { throw new HttpError(404, 'not_found') })()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })
  it('maps Prisma P2025 -> 404 not_found', async () => {
    const res = await withRoute(async () => { throw prismaKnown('P2025') })()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })
  it('maps Prisma P2002 -> 409 conflict', async () => {
    const res = await withRoute(async () => { throw prismaKnown('P2002') })()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('conflict')
  })
  it('passes a THROWN Response through unchanged', async () => {
    const res = await withRoute(async () => { throw NextResponse.json({ x: 1 }, { status: 302 }) })()
    expect(res.status).toBe(302)
    expect(await res.json()).toEqual({ x: 1 })
  })
  it('maps an unknown throw -> 500 internal_error with no message leak', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await withRoute(async () => { throw new Error('secret detail') })()
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
      // A handler may throw an already-formed Response (e.g. a redirect); honor it.
      if (err instanceof Response) return err
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
- [ ] **Step 5: Verify typing** — confirm `withRoute(async () => ...)` (no-arg) and `withRoute(async (req, ctx) => ...)` both type-check by using both forms in the test file, then run `npm run lint`. Expected: clean. (This gates Phase 3, which wraps no-arg `GET()` handlers.)
- [ ] **Step 6: Commit** — `feat(a3): add lib/api withRoute wrapper (incl. thrown-Response passthrough)`.

---

## Phase 3 — Opportunistic adoption (under green Phase-1 tests)

> For each route: (1) if a deliberate normalization applies, update its test to
> expect the new behavior in the SAME commit, with a one-line comment; (2)
> refactor the route onto `withRoute`/`parseJsonBody`; (3) run that route's test
> — green. Any UNexpected red = drift; stop and reconcile. **Every validation
> branch converted to an `HttpError` throw MUST preserve the existing error code
> string** unless the task names a deliberate normalization.
>
> Before→after malformed-JSON table (the only deliberate envelope changes):
> | Route | before | after |
> |---|---|---|
> | `clients` POST | `500` (unhandled) | `400 invalid_json` |
> | `brief/live` POST | `400 "Invalid JSON body"` | `400 invalid_json` |
> | `brief/[sessionId]` POST | `{}` default → `400 Client name is required` | **UNCHANGED** (preserve `.catch(()=>({}))`) |
> | `diff` POST | `400 "Invalid JSON body"` | `400 invalid_json` |
> | `quarter-plan/import` POST | `400 "Invalid JSON body"` | `400 invalid_json` |
> | `site-audit/[id]/checks` PUT | `400 "Invalid JSON"` | `400 invalid_json` |
> | `ada-audit/[id]/checks` PUT | `400 "Invalid JSON"` | `400 invalid_json` |
>
> The two `brief` 500 message-leaks → `500 internal_error` is the other deliberate change (Task 12).

### Task 11: Adopt on `clients/route.ts` (fixes bad-JSON 500)

**Files:** Modify `app/api/clients/route.ts`; Modify `app/api/clients/route.test.ts`.

- [ ] **Step 1:** Update the bad-JSON test case: expect `400` + `invalid_json` (`// A3: normalized from 500`).
- [ ] **Step 2:** Wrap `GET`/`POST` in `withRoute`; replace the inline `await request.json()` with `parseJsonBody(request)`; **keep the explicit `catch` that maps P2002 → the human-readable `409 A client with that name already exists`** (do not delegate to the generic net — preserve the string).
- [ ] **Step 3:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/clients/route"` — Expected: PASS (409 unchanged, bad-JSON now 400).
- [ ] **Step 4:** Commit — `refactor(a3): adopt withRoute on clients route (bad-JSON 500->400)`.

### Task 12: Adopt on `brief/live` + `brief/[sessionId]` (stops message leak; preserves {} default)

**Files:** Modify both routes + their Phase-1 tests.

- [ ] **Step 1:** Update both tests' 500 cases: expect `body.error === 'internal_error'` (`// A3: no longer leaks message`). Do NOT change the `brief/[sessionId]` `400 Client name is required` case.
- [ ] **Step 2:** Wrap both `POST` handlers in `withRoute`; delete the manual outer try-catch (withRoute owns the 500). For `brief/live`, swap the inline JSON parse for `parseJsonBody`. **For `brief/[sessionId]`, KEEP `.catch(() => ({}))`** (Codex fix — do not use `parseJsonBody` here; the `{}` default is not on the deliberate-change list).
- [ ] **Step 3:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/brief` — Expected: PASS.
- [ ] **Step 4:** Commit — `refactor(a3): adopt withRoute on brief routes (stop 500 message leak)`.

### Task 13: Adopt on `diff` + `quarter-plan/import` (bad-JSON code normalization)

**Files:** Modify `app/api/diff/route.ts`, `app/api/quarter-plan/import/route.ts`, `app/api/diff/route.test.ts`, and **`app/api/quarter-plan/route.test.ts`** (the import test lives in the monolith — edit it there, not a sibling).

- [ ] **Step 1:** Update the malformed-body cases (diff test + the import case in the monolith) to expect `invalid_json` (`// A3: normalized from "Invalid JSON body"`).
- [ ] **Step 2:** Wrap handlers in `withRoute`; swap inline JSON parse for `parseJsonBody`; preserve all other codes (`404`/`400`/`409 session_archived`/`409 A quarter plan already exists`) by keeping their explicit throws/returns (convert to `throw new HttpError(status, '<same code string>')` only where it tidies the code, keeping the string identical).
- [ ] **Step 3:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/diff app/api/quarter-plan/route` — Expected: PASS.
- [ ] **Step 4:** Commit — `refactor(a3): adopt withRoute on diff + quarter-plan/import`.

### Task 14: Adopt on `site-audit/[id]/checks` + `ada-audit/[id]/checks` (bad-JSON code normalization)

**Files:** Modify both routes + their Phase-1 tests.

- [ ] **Step 1:** Update both tests' PUT malformed-body cases to expect `invalid_json`.
- [ ] **Step 2:** Wrap `GET`/`PUT` in `withRoute`; swap to `parseJsonBody`; convert `404 Audit not found` and the validation `400`s to explicit `HttpError` throws with the SAME code strings, OR leave them as direct `NextResponse.json` returns (withRoute passes returns through). Keep the `getOperatorLabel` logic unchanged.
- [ ] **Step 3:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/site-audit/[id]/checks" "app/api/ada-audit/[id]/checks"` — Expected: PASS.
- [ ] **Step 4:** Commit — `refactor(a3): adopt withRoute on site-audit + ada-audit checks routes`.

### Task 15: Adopt on behavior-preserving reads (`clients/[id]/schedules/[scheduleId]`, `quarter-plan/activity`, `site-audit/queue`)

**Files:** Modify the three routes. Test edits: schedule test is a sibling; `quarter-plan/activity` test is in the monolith. Expect NO assertion changes (pure envelope/net adoption).

- [ ] **Step 1:** Wrap each handler in `withRoute`. For `schedules/[scheduleId]` keep `invalid_json`/`enabled_required`/`not_found`/`client_archived` codes exactly. `quarter-plan/activity` + `site-audit/queue` are no-arg `GET()` — `withRoute(async () => ...)` must type-check (verified in Task 10).
- [ ] **Step 2:** Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/clients/[id]/schedules/[scheduleId]" app/api/quarter-plan/route "app/api/site-audit/queue"` — Expected: PASS with NO test changes.
- [ ] **Step 3:** Commit — `refactor(a3): adopt withRoute on schedule/activity/queue reads`.

### Task 16: Docs + new-route guidance + final gate

**Files:** Modify `CLAUDE.md` (add `lib/api/` to Key files + a one-line "new routes use `withRoute` + `parseJsonBody`" note); Modify `.claude/skills/er-seo-tools-extension-recipes/SKILL.md` (route recipe references the kit). Tracker + handoff handled in the ship ritual, not here.

- [ ] **Step 1:** Add the `lib/api/` Key-files entry + new-route guidance to CLAUDE.md.
- [ ] **Step 2:** Update the extension-recipes route recipe to use `withRoute`.
- [ ] **Step 3:** Full gate: `npm run lint` && `DATABASE_URL="file:./local-dev.db" npm test` && `npm run build` — Expected: all green.
- [ ] **Step 4:** Commit — `docs(a3): document lib/api route kit + new-route guidance`.

---

## Self-review notes

- **Spec coverage:** Phase 1 (Tasks 1–7) covers all 16 sibling-untested routes; Task 5 fills the quarter-plan monolith in-file (Codex fix #1). Task 8 gates Phase 1. Phase 2 (Tasks 9–10) builds the kit per spec, incl. thrown-Response passthrough (Codex fix #6). Phase 3 (Tasks 11–15) adopts the enumerated safe subset; every deliberate normalization maps to a task and to the before→after table. Docs (Task 16) = spec's Phase-3 deliverable.
- **Codex fixes applied:** #1 quarter-plan monolith (Task 5, count corrected to 16); #2 `APP_AUTH_PASSWORD` stub (Global Constraints + Task 5); #3 screenshots 404-only (Task 1); #4 no accessCount assertion (Task 6); #5 preserve `brief/[sessionId]` `{}` default (Task 12 + before→after table); #6 thrown-Response passthrough (Task 10).
- **No auth added to withRoute; Prisma mapping = last-resort net** — honored (Task 11 keeps clients' explicit 409; Tasks 13/14 keep specific codes via same-string throws).
- **Placeholder scan:** all test tasks give exemplars + explicit case tables; kit tasks give full code. No TBDs.
- **Type consistency:** `withRoute` rest-args signature (Task 10) supports the no-arg handlers used in Task 15; `HttpError(status, code)` + `parseJsonBody` signatures consistent across Tasks 9–15.
