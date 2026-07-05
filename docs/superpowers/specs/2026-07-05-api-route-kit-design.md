# A3 — API Route Kit + Route Tests — Design

**Status:** draft (Codex review pending) · **Date:** 2026-07-05 · **Roadmap item:** Track A / A3 (`../nyi/improvement-roadmaps/06-platform.md` §3)
**Branch:** `feat/a3-route-kit`

## Problem

The `app/api/` surface has **73 route handlers; 21 have no tests.** They share a
loosely-consistent error envelope (`NextResponse.json({ error }, { status })`)
but diverge in ways that have already caused, or could cause, prod-only bugs:

- **Bad-JSON handling is inconsistent.** Most routes wrap `await req.json()` in a
  try-catch → clean `400`. But `app/api/clients/route.ts` POST lets a parse
  failure fall through to the `500` catch, and `app/api/brief/[sessionId]/route.ts`
  swallows it into a `{}` default. Same input, three behaviors.
- **Two 500 paths leak `error.message`** to the client (`brief/[sessionId]`,
  `brief/live`) — a low-grade information-disclosure smell.
- **Prisma-error→HTTP mapping is copy-pasted** into ~3 routes (P2002→409 in
  `clients`; P2025 handled ad-hoc elsewhere) and absent from the rest.
- **Error-code style is mixed:** snake_case machine codes (`invalid_json`,
  `not_found`, `session_archived`) in newer routes vs human sentences
  (`name is required`, `Invalid JSON`) in older ones.

There is **no shared route helper** today (`grep` for `withRoute`/`withAuth`/
`routeHandler` returns nothing; `lib/api/` does not exist). Each new route
re-implements try-catch + error shaping from scratch, and the 21 untested routes
are untested largely because standing them up feels like boilerplate.

A3's goal (per `06-platform.md` §3): a small `lib/api/` toolkit that makes the
error/parsing behavior uniform and makes route tests cheap, **adopted
incrementally** — new routes immediately, existing routes opportunistically —
paired with tests for the untested routes.

## Scope corrections vs the roadmap doc (grounded in the current code)

The roadmap doc (written 2026-06-10) described `withRoute()` as providing "auth
guard, zod-style payload validation, a uniform error envelope, Prisma-error→HTTP
mapping, and request logging." Two of those five no longer fit and one is
deferred; recorded here so the plan doesn't rebuild obsolete scope:

1. **No auth guard in `withRoute()`.** `middleware.ts` is the single cookie-auth
   gate for the whole app: any non-`isPublicPath` route returns `401
   auth_required` (JSON) or redirects to `/login` before the handler runs.
   Cookie-gated handlers therefore do **no** in-handler auth check. Moving auth
   into `withRoute()` would be redundant *and* a behavior change (it would start
   401-ing in unit tests that call the handler directly, and could double-gate).
   The only in-handler auth lives in `mint-token` (explicit
   `isValidAuthCookie`) and the `qct_` token routes (Bearer JWT) — those keep
   their existing checks untouched.
2. **Request logging deferred to A4.** The observability floor (A4) owns pino /
   structured logging / `logError()`. A3 uses a minimal `console.error` in the
   500 branch only, to be upgraded by A4. Building a logging layer here would
   collide with A4.
3. **Validation stays minimal in v1** (see Open Questions). No schema-validation
   library is in `package.json`; routes validate ad-hoc inline. v1 provides at
   most a couple of tiny assertion helpers, not a zod-style schema layer.

The count is **21 untested routes, not 14** — C-track features (C4 reporting,
C6 live-scan, B5 quarter push) added routes after the roadmap was written.

## Goals

- **G1.** Every one of the 21 untested routes gets a test file that pins its
  **current** behavior (status codes, error codes, response shape, side effects),
  following the house test conventions.
- **G2.** A `lib/api/` kit exists — `withRoute()`, `HttpError`, `parseJsonBody()`,
  Prisma-error mapping — with its own unit tests.
- **G3.** The kit is adopted on a **safe subset** of existing routes and is the
  default for all new routes, without changing observable behavior on any route
  a client already depends on (except deliberate, test-updated normalizations).
- **G4.** Zero net-new prod risk: tests land before any refactor, and every
  refactored route is covered by a green G1 test first.

## Non-goals

- **Not** refactoring all 21 (or all 73) routes onto the kit in this work. Mass
  simultaneous change to prod routes is the explicit anti-goal (Approach B).
- **Not** a validation/schema-library adoption (no zod). 
- **Not** a logging/observability layer (A4).
- **Not** changing any auth/middleware behavior, `isPublicPath` membership, or
  the ambiguous gating of `ada-audit/share/[token]/checks` (flagged below, left
  as-is; tests pin current behavior).
- **Not** touching streaming, raw-file, public-share, or token routes' internals
  in the adoption phase (test-only in v1).

## Approach (chosen: A — tests-first, adopt-incrementally)

Three phases, each independently shippable and gate-green; the ordering is the
risk control.

### Phase 1 — Characterization tests (pure-additive, zero prod risk)

Write a `route.test.ts` beside each of the 21 untested routes, asserting current
behavior exactly — **including the warts** (the `clients` POST 500-on-bad-JSON,
the `brief` `{}` default, the `error.message` leaks). Warts are pinned, not
fixed, in this phase; Phase 3 may normalize them with the test updated in the
same commit and the change called out.

Follow the two established house styles (see Testing Conventions): DB-backed with
prefix-namespaced fixtures for routes that hit real Prisma, mocked-Prisma for
routes where a real row is awkward. Node environment (global default), direct
handler invocation, `NextRequest` construction, `params` as `Promise`.

Special response shapes to assert non-JSON:
- Streaming (`export/[sessionId]/[format]`, `export/[sessionId]/claude`) →
  `await res.text()` + `Content-Disposition` / `Content-Type` / chunked header.
- Raw file (`ada-audit/screenshots/...`) → `Content-Type: image/png` +
  `await res.arrayBuffer()`; path-traversal `404` cases.
- Redirect / custom statuses: `201` (clients POST, quarter-plan import), `410`
  (`share/[token]` expired), `422` (`site-audit/discover`).

Routes that make **external fetches** (`site-audit/discover` → `discoverPages`)
are tested with the network layer mocked — never a live crawl (change-control
rule 3).

**Deliverable:** 21 new test files, all green. This alone satisfies the roadmap's
"route tests for the untested routes."

### Phase 2 — The kit (`lib/api/`)

New module `lib/api/` (co-located tests):

```ts
// lib/api/errors.ts
export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}

// lib/api/with-route.ts
type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response> | Response
export function withRoute<C>(handler: Handler<C>): Handler<C>
// - returns whatever Response the handler returns (streaming/file/redirect/
//   custom-status all pass through unchanged)
// - catch HttpError            → NextResponse.json({ error: code }, { status })
// - catch Prisma known error   → P2025→404 not_found, P2002→409 conflict
// - catch anything else        → console.error(...) + 500 { error: 'internal_error' }
//   (NO error.message in the body)

// lib/api/body.ts
export async function parseJsonBody<T = unknown>(req: NextRequest): Promise<T>
// - await req.json() in try-catch → throw new HttpError(400, 'invalid_json')
```

`withRoute` is a thin wrapper: it never inspects the request beyond catching, so
it is compatible with every method signature (`GET()` no-arg, `GET(req, ctx)`,
`PUT(req, ctx)`) and with Next 15's `ctx.params: Promise<...>`.

**Deliverable:** `lib/api/` + unit tests covering: pass-through of a normal JSON
response, `HttpError` mapping for each status, P2025/P2002 mapping, unknown-error
→ 500-no-leak, `parseJsonBody` success + `invalid_json`.

### Phase 3 — Opportunistic adoption (under green Phase-1 tests)

Adopt `withRoute()` + `parseJsonBody()` on the **plain-JSON cookie-gated routes**
where it is a clean win and behavior is preserved. Candidate set (final list
decided in the plan, but bounded to this class):

- `clients/route.ts` (GET/POST) — normalizes bad-JSON POST from 500→`400
  invalid_json` (deliberate; test updated + noted).
- `brief/[sessionId]`, `brief/live` — stop leaking `error.message` (deliberate;
  test updated + noted).
- `diff`, `site-audit/[id]/checks`, `ada-audit/[id]/checks`,
  `clients/[id]/schedules/[scheduleId]`, `quarter-plan/import`,
  `quarter-plan/activity`, `site-audit/queue` — envelope + Prisma mapping,
  behavior-preserving.

**Excluded from v1 adoption** (test-only, internals untouched):
- Streaming: `export/[sessionId]/[format]`, `export/[sessionId]/claude`.
- Raw file: `ada-audit/screenshots/[auditId]/[filename]`.
- Public/security-sensitive: `share/route.ts` (POST create), `share/[token]`,
  `ada-audit/share/[token]/checks`.
- Token/mint: `quarter-plan/push/[planId]`, `.../receipt`, `.../mint-token`
  (careful existing auth flow; not worth the churn in v1).

Each adopted route is edited **only** with its Phase-1 test green, so any
observable drift fails the suite. Deliberate normalizations update the test in
the same commit with a one-line rationale.

**Deliverable:** ~8–10 routes on the kit; new-route guidance added to
`er-seo-tools-extension-recipes` skill / CLAUDE.md.

## Testing conventions (house style, to match exactly)

- Environment: node (global default in `vitest.config.mts`); route tests add **no**
  `@vitest-environment` docblock. `globals: false` → import
  `{ describe, it, expect, beforeEach, afterAll, vi }` explicitly.
  `fileParallelism: false` (shared dev SQLite). `@` alias = repo root.
- Local runs prefix `DATABASE_URL="file:./local-dev.db"`.
- **DB-backed style:** real `prisma` from `@/lib/db`, prefix-namespaced fixtures
  (`__a3xxx__`), `deleteMany({ where: { name: { startsWith: PREFIX } } })` in
  `beforeEach`/`afterAll`; child/CrawlRun rows deleted before parents.
- **Mocked-Prisma style:** hoisted `vi.mock('@/lib/db', ...)` declared **before**
  the handler import; `mockReset()` in `beforeEach`.
- Requests: `new NextRequest('http://localhost/api/...', { method, headers, body:
  JSON.stringify(...) })`; malformed-JSON tests pass a raw `'{not json'` string.
- Params: `{ params: Promise.resolve({ id: String(id) }) }`.
- Cookie auth (mint-token): set `cookie` header to
  `${AUTH_COOKIE_NAME}=${await createAuthCookieValue({sub,email:null,hd:null,name:null})}`.
- Bearer auth (`qct_`): `mintQuarterPushToken`; scope/expiry-failure cases
  hand-mint with `jose` `SignJWT` and prefix `qct_`, with `*_TOKEN_SECRET` stubbed.
- Assertions: call handler directly; `expect(res.status).toBe(...)`; `const body =
  await res.json(); expect(body.error).toBe('<exact code>')`. DB-backed tests
  verify persistence via re-`findUnique`/`count`.
- Cookie-gated handlers do **no** in-handler auth → unit tests can't exercise the
  401 path (that's middleware, covered by `middleware.test.ts`). Only
  `mint-token` + token routes have unit-testable auth.

## Open questions (routed to Codex, not Kevin)

1. **Validation in v1:** hand-rolled tiny assert helpers vs no validation helper
   at all (routes keep inline checks) vs add zod. Lean: **no formal validation
   layer in v1** — ad-hoc inline validation stays; revisit if a real schema need
   emerges. Adding zod is a dep + scope creep for a consistency-only item.
2. **Phase 3 normalizations:** fix the `error.message` leak and the
   `clients`-POST-bad-JSON-500 as part of adoption (test updated), or strictly
   preserve current behavior and defer fixes? Lean: **fix them** — they're
   genuine (minor) defects and the whole point of a uniform envelope; each is a
   deliberate, tested, one-line-noted change.
3. **`withRoute` ergonomics** with mixed handler signatures (no-arg `GET()` vs
   `(req, ctx)`), and whether the generic `C` context type is worth it vs `any`.

## Risks & mitigations

- **Refactoring working prod routes (the repo's #1 failure class).** Mitigated by
  tests-first (Phase 1 before Phase 3), bounded adoption set, and excluding
  streaming/file/public/token routes from v1.
- **Streaming/file assertions differ from JSON.** Enumerated above; the kit's
  pass-through design means these routes need no wrapper to be tested.
- **Deliberate behavior changes hidden in a refactor.** Mitigated by requiring
  each normalization to update its test in the same commit with a rationale.

## Out-of-scope follow-ups (park, don't build)

- Migrating the remaining ~50 routes onto the kit (opportunistic, over time).
- A4 pino logging integration in `withRoute`.
- Resolving the `ada-audit/share/[token]/checks` gating ambiguity (share page is
  public but its data API is middleware-gated) — flag to Kevin, decide later.
- A schema-validation layer if inline validation becomes unwieldy.
