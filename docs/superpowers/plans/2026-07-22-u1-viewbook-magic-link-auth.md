# U1 — Onboarding Viewbook Magic-Link Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (Codex lane: follow `er-seo-tools-workflow` discipline — TDD per task, frequent commits.)

**Goal:** `/viewbook/[token]` becomes invitation-only: invited members sign in via emailed magic links (`#g=` fragment → consume → per-viewbook session cookie), ER staff keep cookie auth, break-glass is read-only, and every client write carries member identity.

**Architecture:** Three new DB tables (grant / session / request-ledger) with hashed opaque secrets; ONE principal resolver (`lib/viewbook/principal.ts`) consumed by every token surface; mint-at-send grants inside the existing `viewbook-email` job; SQL-guarded rate limiting (`INSERT…SELECT`); attribution via a new `ViewbookActivity.actorKind` discriminator.

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite (array-form `$transaction` only), vitest, existing Mailgun notify layer.

**Spec:** `docs/superpowers/specs/2026-07-22-u1-viewbook-magic-link-auth-design.md` (Codex-reviewed, 12 fixes applied; §11 break-glass = read-only CONFIRMED by Kevin 2026-07-22). Section references below (§N) are to that spec.

**Plan review:** Codex (Sol) 2026-07-22 — accept with 13 named fixes, ALL applied below (fenced+awaited lastSeenAt touch, requireJsonObject + concurrency boundary tests, teamInviteDeliveryStatement memberId, defensive consume-count cleanup, fragment scrubber on authenticated branches, logout carve-out from the 404 assertion, explicit auth test environment, one PublicMutationAuth param, post-fence requireMemberStillAuthorized before replay/no-op, ALL activity writers get actorKind, complete attribution semantics incl. DataSourceSection who(), durable ViewbookMaterialLink.addedByKind, member-removal txn count assertions).

## Global Constraints

- Array-form `$transaction([...])` ONLY; conditional logic in SQL (`INSERT…SELECT` / guarded `UPDATE` with `EXISTS` predicates); raw SQL binds integer-ms timestamps manually (`Date.now()`).
- Never log or `.toString()` a raw secret — log grant/session/request **ids** only.
- Middleware gets exactly ONE new matcher with the explicit tail `(?:request|consume|logout)` — never `[^/]+`, never a `/viewbook/` or `/api/viewbook/` prefix.
- Auth failures on API surfaces are **404 `not_found`** via `HttpError` — indistinguishable from a bad token. Only the public PAGE renders an email prompt.
- `auth/request` responses are ALWAYS the same 200 `{ ok: true }` — member or stranger, sent, capped, cooled-down. No observable branch.
- Grant TTL = 7 d, session TTL = 60 d — code constants, NOT env. Cooldown/caps ARE env-tunable (§12 names + defaults).
- Cookie: `vb_s_<viewbookId>` (id, never token), `HttpOnly; Secure; SameSite=Lax; Path=/`, host-only, Max-Age 60 d.
- Magic-link URL = `${NEXT_PUBLIC_APP_URL}/viewbook/<token>#g=<raw>` — **fragment, never a query param**.
- Break-glass (`er_auth` valid, `email: null`) = read-only member-equivalent (Kevin-confirmed): `canRead` yes, `canWrite` no, no operator layer.
- The unauthorized page path NEVER calls `loadViewbookPublicData` and serializes NO viewbook data.
- Gates per PR: `npx tsc --noEmit` clean + full `npx vitest run` + `npm run build` locally.
- House test conventions: vitest, per-file local `mkViewbook()` helpers, DB-backed tests use the `.test-dbs` pattern; `createViewbook(clientId, kind, createdBy)` is 3-arg.
- Work in an isolated worktree off `origin/main` (`git worktree add .claude/worktrees/u1-viewbook-auth -b feat/u1-viewbook-magic-link-auth origin/main`), symlink `node_modules`, copy `.env` (never `.env.local`), then `npx prisma generate && rm -rf .test-dbs` after the schema task.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | 3 new models + back-relations + `ViewbookActivity.actorKind` |
| `prisma/migrations/<ts>_viewbook_magic_link_auth/migration.sql` (generated + hand-edited) | DDL + actorKind backfill |
| `lib/viewbook/auth-config.ts` (create) | TTL constants + call-time env caps |
| `lib/viewbook/auth-secrets.ts` (create) | secret mint/hash + cookie-name helpers |
| `lib/viewbook/principal.ts` (create) | `ViewbookPrincipal`, resolver core + adapters, `canRead`/`canWrite`, `requireCanRead`/`requireCanWrite`, `memberWriteFence` |
| `lib/viewbook/auth-request.ts` (create) | request-ledger + delivery txn core (rate limiting) |
| `lib/viewbook/auth-consume.ts` (create) | consume txn core + logout core |
| `lib/viewbook/auth-retention.ts` (create) | cleanup sweeps |
| `app/api/viewbook/[token]/auth/request/route.ts` (create) | POST auth/request |
| `app/api/viewbook/[token]/auth/consume/route.ts` (create) | POST auth/consume (sets cookie) |
| `app/api/viewbook/[token]/auth/logout/route.ts` (create) | POST auth/logout (clears cookie) |
| `middleware.ts` (modify) | the ONE new matcher |
| `lib/jobs/handlers/viewbook-email.ts` (modify) | explicit kind dispatch + mint-at-send grant path |
| `lib/notify/viewbook-email-content.ts` (modify) | invite builder → grant URL + expiry line; new `buildMagicLinkEmail` |
| `lib/viewbook/team-members.ts` (modify) | stamp real `memberId` on add + resend delivery rows |
| `app/(public)/viewbook/[token]/page.tsx` (modify) | landing flow: light lookup → principal branches |
| `components/viewbook/public/AuthLanding.tsx` (create) | email prompt + `#g=` fragment interstitial (client) |
| `components/viewbook/public/MemberSessionBar.tsx` (create) | "Signed in as … · Sign out" (client) |
| every `app/api/viewbook/[token]/*/route.ts` (modify) | `requireCanRead`/`requireCanWrite` after token resolve; assets → `private, no-store` |
| `lib/viewbook/public-writes.ts`, `lib/viewbook/answers.ts`, `lib/viewbook/ack.ts`, `lib/viewbook/setup.ts`, `lib/viewbook/team-members.ts` (modify) | commit-time member fences + attribution params |
| `lib/viewbook/digest.ts` (modify) | filter `actor='client'` → `actorKind IN ('client','member')` |
| `lib/viewbook/public-data.ts` + `components/viewbook/public/MaterialsSection.tsx` (modify) | member-aware `addedBy` rendering |
| `app/api/viewbooks/[id]/team-members/[memberId]/route.ts` (create) | admin member removal |
| `lib/viewbook/service.ts` + `components/viewbook/admin/ViewbookEditor.tsx` (modify) | admin roster load + minimal remove UI |
| `lib/cleanup.ts` (modify) | wire the sweep |

Suggested PR shape: ONE feature branch/PR (auth is not meaningfully shippable in halves), committed task-by-task.

---

### Task 1: Schema — new tables + `actorKind`

**Files:**
- Modify: `prisma/schema.prisma` (Viewbook block ends ~line 922; `ViewbookActivity` at ~1063; `ViewbookTeamMember` at ~1075)
- Create (generated): `prisma/migrations/<ts>_viewbook_magic_link_auth/migration.sql`

**Interfaces:**
- Produces: models `ViewbookAuthGrant`, `ViewbookMemberSession`, `ViewbookAuthRequest`; `ViewbookActivity.actorKind String @default("client")`; back-relations `ViewbookTeamMember.authGrants/sessions`, `Viewbook.authRequests`.

- [ ] **Step 1: Add the three models from spec §3 verbatim** (grant: `tokenHash @unique`, `expiresAt`, `consumedAt?`, `@@index([memberId])`, `@@index([expiresAt])`; session: same + `revokedAt?`, `lastSeenAt?`; request: `id String @id` app-generated uuid, `@@index([viewbookId, email, createdAt])`, `@@index([email, createdAt])`, `@@index([createdAt])`). Add back-relations on `ViewbookTeamMember` (`authGrants ViewbookAuthGrant[]`, `sessions ViewbookMemberSession[]`) and `Viewbook` (`authRequests ViewbookAuthRequest[]`).

- [ ] **Step 2: Add `actorKind` to `ViewbookActivity` and `addedByKind` to `ViewbookMaterialLink`** (Codex plan-fix #12 — material attribution must be DURABLE: inferring client-side-ness from the current member roster would rewrite history when a member is removed):

```prisma
model ViewbookActivity {
  // …existing fields…
  actorKind  String   @default("client") // 'client' | 'member' | 'operator' | 'system'
}

model ViewbookMaterialLink {
  // …existing fields…
  addedByKind String  @default("client") // 'client' | 'member' | 'operator' — durable render discriminator
}

model ViewbookField {
  // …existing fields…
  valueUpdatedByKind String? // 'client' | 'member' | 'operator' — durable who() discriminator (null = never updated)
}

model ViewbookFieldAmendment {
  // …existing fields…
  authorKind String @default("client") // 'client' | 'member' | 'operator' — durable who() discriminator
}
```

- [ ] **Step 3: Generate the migration**

Run: `npx prisma migrate dev --name viewbook_magic_link_auth`
Expected: migration created, client regenerated.

- [ ] **Step 4: Hand-append the backfills to the generated migration.sql** (existing rows: `'client'` actors/addedBy stay `'client'`, everything else → `'operator'`):

```sql
UPDATE "ViewbookActivity" SET "actorKind" = 'operator' WHERE "actor" <> 'client';
UPDATE "ViewbookMaterialLink" SET "addedByKind" = 'operator' WHERE "addedBy" <> 'client';
UPDATE "ViewbookField" SET "valueUpdatedByKind" = CASE WHEN "valueUpdatedBy" = 'client' THEN 'client' ELSE 'operator' END WHERE "valueUpdatedBy" IS NOT NULL;
UPDATE "ViewbookFieldAmendment" SET "authorKind" = 'operator' WHERE "author" <> 'client';
```

Then run `npx prisma migrate dev` again (applies the edited SQL to the dev DB — or `npx prisma migrate reset` in the worktree DB) and `rm -rf .test-dbs`.

- [ ] **Step 5: Commit** — `git add prisma && git commit -m "feat(viewbook-auth): U1 schema — grants, sessions, request ledger, actorKind"`

---

### Task 2: `auth-config.ts` + `auth-secrets.ts`

**Files:**
- Create: `lib/viewbook/auth-config.ts`, `lib/viewbook/auth-secrets.ts`
- Test: `lib/viewbook/auth-secrets.test.ts`

**Interfaces:**
- Produces: `GRANT_TTL_MS`, `SESSION_TTL_MS`, `LAST_SEEN_TOUCH_MS`, `authCooldownMs()`, `authEmailHourlyCap()`, `authViewbookHourlyCap()`, `authLedgerHourlyCap()`; `mintSecret(): { raw: string; hash: string }`, `hashSecret(raw: string): string`, `memberCookieName(viewbookId: number): string`.

- [ ] **Step 1: Write failing tests** (`auth-secrets.test.ts`): `mintSecret()` returns 43-char base64url raw + 64-hex hash; `hashSecret(raw) === hash`; two mints differ; `memberCookieName(7) === 'vb_s_7'`.

- [ ] **Step 2: Implement**

```ts
// lib/viewbook/auth-config.ts — U1 §12. TTLs are decision-pinned code
// constants; caps are call-time env reads (house rule: never boot checks).
export const GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000
export const LAST_SEEN_TOUCH_MS = 60 * 60 * 1000
export const AUTH_HOUR_MS = 60 * 60 * 1000

function intEnv(name: string, dflt: number): number {
  const raw = process.env[name]
  if (!raw) return dflt
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : dflt
}
export function authCooldownMs(): number { return intEnv('VIEWBOOK_AUTH_COOLDOWN_MS', 60_000) }
export function authEmailHourlyCap(): number { return intEnv('VIEWBOOK_AUTH_EMAIL_HOURLY_CAP', 6) }
export function authViewbookHourlyCap(): number { return intEnv('VIEWBOOK_AUTH_VIEWBOOK_HOURLY_CAP', 30) }
export function authLedgerHourlyCap(): number { return intEnv('VIEWBOOK_AUTH_LEDGER_HOURLY_CAP', 200) }
```

```ts
// lib/viewbook/auth-secrets.ts — raw secrets NEVER stored/logged; stored form
// is always sha256Hex(raw), and the hash is the lookup key.
import crypto from 'crypto'
import { sha256Hex } from '@/lib/findings/keys'

export function mintSecret(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('base64url')
  return { raw, hash: sha256Hex(raw) }
}
export function hashSecret(raw: string): string { return sha256Hex(raw) }
export function memberCookieName(viewbookId: number): string { return `vb_s_${viewbookId}` }
```

- [ ] **Step 3: Run tests** — `npx vitest run lib/viewbook/auth-secrets.test.ts` → PASS.
- [ ] **Step 4: Commit.**

---

### Task 3: `principal.ts` — the ONE resolver

**Files:**
- Create: `lib/viewbook/principal.ts`
- Test: `lib/viewbook/principal.test.ts`

**Interfaces:**
- Consumes: `getAuthSession`, `AUTH_COOKIE_NAME`, `isAuthBypassedInDev` (`@/lib/auth`); `hashSecret`, `memberCookieName` (Task 2); `LAST_SEEN_TOUCH_MS`.
- Produces (exact — later tasks depend on these):

```ts
export type ViewbookPrincipal =
  | { kind: 'member'; member: { id: number; memberKey: string; name: string; email: string }; sessionId: number }
  | { kind: 'operator'; email: string }
  | { kind: 'dev'; email: 'dev@localhost' }
  | { kind: 'break-glass' }

export function canRead(p: ViewbookPrincipal | null): p is ViewbookPrincipal
export function canWrite(p: ViewbookPrincipal | null): boolean // member | operator | dev
export async function resolveViewbookPrincipalFromCookies(
  cookies: { erAuthCookie: string | null; memberCookie: string | null },
  viewbook: { id: number },
): Promise<ViewbookPrincipal | null>
export async function resolveViewbookPrincipal(req: Request, viewbook: { id: number }): Promise<ViewbookPrincipal | null>
export async function resolveViewbookPrincipalRSC(viewbook: { id: number }): Promise<ViewbookPrincipal | null>
export async function requireCanRead(req: Request, viewbook: { id: number }): Promise<ViewbookPrincipal> // throws HttpError(404,'not_found')
export async function requireCanWrite(req: Request, viewbook: { id: number }): Promise<ViewbookPrincipal> // throws HttpError(404,'not_found')
export function memberWriteFence(principal: ViewbookPrincipal, viewbookId: number, now: number): Prisma.Sql
export function attributionOf(principal: ViewbookPrincipal): { actorEmail: string; authorName: string; actorKind: 'member' | 'operator' }
```

- [ ] **Step 1: Write failing DB-backed tests** (house `.test-dbs` pattern; local `mkViewbook()`): resolution order — dev-bypass wins; er_auth email → operator; er_auth null-email → break-glass; live member session cookie → member (with `sessionId`); expired/revoked session → null; session for viewbook A presented to viewbook B → null; `canWrite` false for break-glass/null, true for member/operator/dev; `lastSeenAt` touched at most once per `LAST_SEEN_TOUCH_MS` — the touch is fenced in SQL, so CONCURRENT resolutions (`Promise.all` of several resolves) produce exactly ONE matched update (assert the row's `lastSeenAt` changed once and `updateMany` counts sum to 1); `memberWriteFence` for a member yields SQL that matches only while the session row is live AND the member is on the viewbook (removed member → predicate false), and yields `1 = 1` for operator/dev.

- [ ] **Step 2: Implement.** Resolution core:

```ts
// lib/viewbook/principal.ts — U1 §5: the ONE resolver for every token surface.
import { cookies as nextCookies } from 'next/headers'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/api/errors'
import { logError } from '@/lib/log'
import { AUTH_COOKIE_NAME, getAuthSession, isAuthBypassedInDev } from '@/lib/auth'
import { hashSecret, memberCookieName } from './auth-secrets'
import { LAST_SEEN_TOUCH_MS } from './auth-config'

export async function resolveViewbookPrincipalFromCookies(
  { erAuthCookie, memberCookie }: { erAuthCookie: string | null; memberCookie: string | null },
  viewbook: { id: number },
): Promise<ViewbookPrincipal | null> {
  if (isAuthBypassedInDev()) return { kind: 'dev', email: 'dev@localhost' }
  const session = await getAuthSession(erAuthCookie ?? undefined)
  if (session) return session.email ? { kind: 'operator', email: session.email } : { kind: 'break-glass' }
  if (!memberCookie) return null
  const row = await prisma.viewbookMemberSession.findUnique({
    where: { tokenHash: hashSecret(memberCookie) },
    include: { member: { select: { id: true, memberKey: true, name: true, email: true, viewbookId: true } } },
  })
  const now = Date.now()
  if (!row || row.revokedAt || row.expiresAt.getTime() <= now) return null
  if (row.member.viewbookId !== viewbook.id) return null
  // Throttled touch (Codex plan-fix #1): FENCED in the WHERE (lastSeenAt null
  // or older than the window, session still live) so concurrent resolutions
  // match at most one update per window, and AWAITED with a caught/logged
  // failure so tests are deterministic and a DB error never breaks resolution.
  if (!row.lastSeenAt || now - row.lastSeenAt.getTime() > LAST_SEEN_TOUCH_MS) {
    try {
      await prisma.viewbookMemberSession.updateMany({
        where: {
          id: row.id,
          revokedAt: null,
          expiresAt: { gt: new Date(now) },
          OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now - LAST_SEEN_TOUCH_MS) } }],
        },
        data: { lastSeenAt: new Date(now) },
      })
    } catch (err) {
      logError({ subsystem: 'viewbook', op: 'session-touch', sessionId: row.id }, err)
    }
  }
  const { viewbookId: _vb, ...member } = row.member
  return { kind: 'member', member, sessionId: row.id }
}
```

Adapters: `resolveViewbookPrincipal(req, vb)` parses the `cookie` header (`req.headers.get('cookie')` split on `;`, trim, first `=` splits name/value, `decodeURIComponent` the value in a try/catch) for `AUTH_COOKIE_NAME` and `memberCookieName(vb.id)`; `resolveViewbookPrincipalRSC(vb)` uses `await nextCookies()` and `.get(...)?.value ?? null`. `requireCanRead`/`requireCanWrite` call the request adapter and `throw new HttpError(404, 'not_found')` on failure (same shape as `requireViewbookToken` — no oracle). `memberWriteFence`:

```ts
export function memberWriteFence(principal: ViewbookPrincipal, viewbookId: number, now: number): Prisma.Sql {
  if (principal.kind !== 'member') return Prisma.sql`1 = 1`
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "ViewbookMemberSession" ms
    JOIN "ViewbookTeamMember" tm ON tm."id" = ms."memberId"
    WHERE ms."id" = ${principal.sessionId} AND ms."revokedAt" IS NULL AND ms."expiresAt" > ${now}
      AND tm."viewbookId" = ${viewbookId}
  )`
}
export function attributionOf(principal: ViewbookPrincipal): { actorEmail: string; authorName: string; actorKind: 'member' | 'operator' } {
  if (principal.kind === 'member') return { actorEmail: principal.member.email, authorName: principal.member.name, actorKind: 'member' }
  if (principal.kind === 'operator') return { actorEmail: principal.email, authorName: principal.email, actorKind: 'operator' }
  if (principal.kind === 'dev') return { actorEmail: 'dev@localhost', authorName: 'dev@localhost', actorKind: 'operator' }
  throw new HttpError(404, 'not_found') // break-glass never writes (§11)
}
```

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit.**

---

### Task 4: `auth/request` — ledger txn core + route

**Files:**
- Create: `lib/viewbook/auth-request.ts`, `app/api/viewbook/[token]/auth/request/route.ts`
- Test: `lib/viewbook/auth-request.test.ts`

**Interfaces:**
- Consumes: `requireViewbookToken`, `requireSameSite`/`requireJsonContentType`/`readBoundedJson` (public-write-guard), `canonicalMailbox` (`./global-content-keys`), `enqueueViewbookEmail` (`./email`), config caps (Task 2).
- Produces: `requestMagicLink(viewbook: { id: number }, email: string, now?: number): Promise<void>` — always resolves (uniform outcome; internally enqueues when a delivery landed).

- [ ] **Step 1: Write failing DB-backed tests:** member email → `ViewbookAuthRequest` row + `ViewbookEmailDelivery` row (`kind='magic-link'`, `memberId` = the member's id, `dedupKey='vb-magic-request:<requestId>'`); stranger email → ledger row only, NO delivery; second request inside cooldown → no new ledger row, no delivery; per-email hourly cap (7th request in an hour for one address across two viewbooks → no row); ledger flood floor; **stranger requests never consume the member delivery cap** — fill `authViewbookHourlyCap()` worth of ledger rows with strangers, then a member request still creates a delivery (the delivery cap counts `kind='magic-link'` DELIVERY rows, not ledger rows); no crash gap (both rows commit together — assert via txn). Use env overrides (`process.env.VIEWBOOK_AUTH_…`) + `afterEach` restore. **Concurrency boundary tests (Codex plan-fix #2):** `Promise.all` of N simultaneous `requestMagicLink` calls at each cap boundary — cooldown (2 concurrent same-email → 1 ledger row), per-email hourly cap, ledger flood floor, and the eligible-delivery cap (cap−1 deliveries pre-seeded + 2 concurrent member requests → exactly cap deliveries) — the guarded INSERTs are the only writers, so SQLite serialization must hold every cap exactly.

- [ ] **Step 2: Implement the core** (spec §7 step 4, verbatim semantics):

```ts
// lib/viewbook/auth-request.ts
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/log'
import { enqueueViewbookEmail } from './email'
import { AUTH_HOUR_MS, authCooldownMs, authEmailHourlyCap, authLedgerHourlyCap, authViewbookHourlyCap } from './auth-config'

export async function requestMagicLink(viewbook: { id: number }, email: string, now = Date.now()): Promise<void> {
  const requestId = crypto.randomUUID()
  const dedupKey = `vb-magic-request:${requestId}`
  const hourStart = now - AUTH_HOUR_MS
  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO "ViewbookAuthRequest" ("id","viewbookId","email","createdAt")
      SELECT ${requestId}, ${viewbook.id}, ${email}, ${now}
      WHERE NOT EXISTS (SELECT 1 FROM "ViewbookAuthRequest"
              WHERE "viewbookId" = ${viewbook.id} AND "email" = ${email} AND "createdAt" > ${now - authCooldownMs()})
        AND (SELECT COUNT(*) FROM "ViewbookAuthRequest"
              WHERE "email" = ${email} AND "createdAt" > ${hourStart}) < ${authEmailHourlyCap()}
        AND (SELECT COUNT(*) FROM "ViewbookAuthRequest"
              WHERE "viewbookId" = ${viewbook.id} AND "createdAt" > ${hourStart}) < ${authLedgerHourlyCap()}
    `,
    prisma.$executeRaw`
      INSERT INTO "ViewbookEmailDelivery" ("viewbookId","kind","recipient","dedupKey","memberId","stageLogId","createdAt")
      SELECT ${viewbook.id}, 'magic-link', m."email", ${dedupKey}, m."id", NULL, ${now}
      FROM "ViewbookTeamMember" m
      WHERE m."viewbookId" = ${viewbook.id} AND m."email" = ${email}
        AND EXISTS (SELECT 1 FROM "ViewbookAuthRequest" r WHERE r."id" = ${requestId})
        AND (SELECT COUNT(*) FROM "ViewbookEmailDelivery" d
               WHERE d."viewbookId" = ${viewbook.id} AND d."kind" = 'magic-link' AND d."createdAt" > ${hourStart})
            < ${authViewbookHourlyCap()}
    `,
  ])
  const delivery = await prisma.viewbookEmailDelivery.findUnique({ where: { dedupKey }, select: { id: true } })
  if (delivery) {
    void enqueueViewbookEmail(delivery.id).catch((err) => {
      logError({ subsystem: 'viewbook', op: 'magic-link-enqueue', viewbookId: viewbook.id }, err)
    })
  }
}
```

- [ ] **Step 3: Route** (`app/api/viewbook/[token]/auth/request/route.ts`) — mirror the existing token-route shape (e.g. `feedback/route.ts`): `withRoute` wrapper, `requireSameSite` → `requireJsonContentType` → `requireViewbookToken(token)` → `readBoundedJson(request, 4_096)` → **`requireJsonObject(raw)`** (`lib/viewbook/route-utils.ts` — `readBoundedJson` returns `unknown`; narrow before member access, Codex plan-fix #2) → `canonicalMailbox(body.email)`. Absent/non-string/invalid email → still `{ ok: true }` WITHOUT calling `requestMagicLink` (uniform domain outcome; same-site/content-type/malformed-JSON violations keep their 403/415/400 — request-shape errors, not membership oracles). Valid email → `await requestMagicLink(vb, email)` → `NextResponse.json({ ok: true })`. `requestMagicLink` THROWS on infrastructure failure (DB down) — that surfaces as `withRoute`'s 500; only DOMAIN outcomes (member/stranger/capped/cooled) are uniform.

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit.**

---

### Task 5: Mint-at-send — email job + builders + `memberId` stamping

**Files:**
- Modify: `lib/jobs/handlers/viewbook-email.ts`, `lib/notify/viewbook-email-content.ts`, `lib/viewbook/team-members.ts`
- Test: extend `lib/jobs/handlers/viewbook-email.test.ts` (exists — follow its stubs), `lib/viewbook/team-members.test.ts`

**Interfaces:**
- Consumes: `mintSecret`, `GRANT_TTL_MS`.
- Produces: `buildMagicLinkEmail({ clientName, viewbookTitle, grantUrl }): EmailContent`; `buildTeamInviteEmail` gains `inviteUrl` = grant URL + expiry-line copy (signature unchanged).

- [ ] **Step 1: Write failing tests:**
  - `team-invite` delivery with `memberId` → handler creates exactly one `ViewbookAuthGrant` for that member (`expiresAt ≈ now + 7 d`), the sent URL matches `/viewbook/<token>#g=<raw>` (assert via the injected `deps.sendEmail` stub — the raw secret hashes to the stored `tokenHash`), `sentAt` stamped.
  - `magic-link` delivery → same grant path, `buildMagicLinkEmail` subject.
  - Suppression paths mint NOTHING: notify dark; viewbook revoked; client archived; `memberId` null; member row deleted. Assert `viewbookAuthGrant.count() === 0` + `suppressedAt` stamped.
  - Unknown `kind` → suppressed + `logError`, `deps.sendEmail` never called.
  - `pc-complete` / `stage-change` unchanged (plain token URL, no grant).
  - `addTeamMember` and `resendInvite` delivery rows now carry the real `memberId`.

- [ ] **Step 2: Stamp `memberId` in `team-members.ts`.** In `addTeamMember`'s delivery INSERT (line ~171), replace the `NULL` memberId with a subselect (the autoincrement id isn't known in JS inside the txn):

```sql
INSERT INTO "ViewbookEmailDelivery"
  ("viewbookId", "kind", "recipient", "dedupKey", "memberId", "stageLogId", "createdAt")
SELECT ${viewbook.id}, 'team-invite', ${email}, ${`vb-invite:${memberKey}:1`},
  (SELECT "id" FROM "ViewbookTeamMember" WHERE "memberKey" = ${memberKey}), NULL, ${now}
WHERE (${A2})
```

In `resendInvite` (line ~274) the id IS known: replace `NULL` with `${memberId}`. **Also fix `teamInviteDeliveryStatement` in `lib/viewbook/email.ts` (Codex plan-fix #3):** that exported helper still builds `team-invite` deliveries with `memberId: null` — make `memberId` a REQUIRED input of the statement builder (or delete the helper if `grep -rn teamInviteDeliveryStatement` shows no production caller) so EVERY producer satisfies the mint-at-send contract; a `team-invite` delivery row with null memberId must be impossible to create after this task. Pre-U1 unsent `team-invite` rows with null memberId are terminally suppressed by the handler's null-memberId gate (acceptable — all existing viewbooks are test-only, D4).

- [ ] **Step 3: Email job grant path.** In `runViewbookEmailJob`: add `memberId: true` to the delivery select. Replace the implicit builder ternary with explicit dispatch:

```ts
const kind = delivery.kind
if (kind !== 'team-invite' && kind !== 'magic-link' && kind !== 'pc-complete' && kind !== 'stage-change') {
  await stampSuppressed(delivery.id)
  logError({ subsystem: 'jobs', job: VIEWBOOK_EMAIL_JOB_TYPE, deliveryId: delivery.id },
    new Error(`unknown viewbook-email kind: ${kind}`))
  return
}
```

For the grant kinds (`team-invite` | `magic-link`), after the existing revoked/archived suppression: if `delivery.memberId == null` → suppress + return; load the member (`prisma.viewbookTeamMember.findUnique({ where: { id: delivery.memberId }, select: { id: true, viewbookId: true } })`); missing or `viewbookId !== delivery.viewbookId` → suppress + return. Then mint:

```ts
const { raw, hash } = mintSecret()
await prisma.viewbookAuthGrant.create({
  data: { memberId: member.id, tokenHash: hash, expiresAt: new Date(Date.now() + GRANT_TTL_MS) },
})
const grantUrl = `${viewbookUrl}#g=${raw}`
```

Build content: `team-invite` → `buildTeamInviteEmail({ clientName, viewbookTitle, inviteUrl: grantUrl })`; `magic-link` → `buildMagicLinkEmail({ clientName, viewbookTitle, grantUrl })`. Send + stamp as today. (A sent-but-unstamped crash re-mints on retry and sends a duplicate — documented, accepted: at-least-once, grants single-consume; stale grants age out via Task 9's sweep.) Never log `raw`/`grantUrl`.

- [ ] **Step 4: Builders.** `buildTeamInviteEmail`: button label → "Open your onboarding viewbook"; add below the button `<p style="margin:16px 0 0;font-size:12px;color:${COLOR.sub};">This link expires in 7 days — you can always request a fresh one from the viewbook page.</p>` (+ text-version line). New `buildMagicLinkEmail`:

```ts
interface MagicLinkInput { viewbookTitle: string; grantUrl: string; clientName: string }
export function buildMagicLinkEmail(input: MagicLinkInput): EmailContent {
  const subject = `Here's your sign-in link for ${input.clientName}'s onboarding viewbook`
  const html = shellHtml(`<h1 style="margin:0 0 12px;font-size:22px;">${esc(input.viewbookTitle)}</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${COLOR.sub};">Use the button below to sign in. The link expires in 7 days — you can always request a fresh one from the viewbook page.</p>
    ${buttonHtml(input.grantUrl, 'Open your onboarding viewbook')}`)
  const text = [subject, '', input.viewbookTitle, 'The link expires in 7 days — request a fresh one from the viewbook page any time.', '', `Sign in: ${input.grantUrl}`].join('\n')
  return { subject, html, text }
}
```

- [ ] **Step 5: Run tests** → PASS. **Step 6: Commit.**

---

### Task 6: `auth/consume` + `auth/logout`

**Files:**
- Create: `lib/viewbook/auth-consume.ts`, `app/api/viewbook/[token]/auth/consume/route.ts`, `app/api/viewbook/[token]/auth/logout/route.ts`
- Test: `lib/viewbook/auth-consume.test.ts`

**Interfaces:**
- Produces: `consumeGrant(viewbook: { id: number }, rawGrant: string, now?: number): Promise<{ rawSession: string } | null>` (null = uniform failure); `revokeSessionByCookie(rawSession: string, now?: number): Promise<void>`.

- [ ] **Step 1: Write failing tests:** valid grant → session row created (`expiresAt ≈ now + 60 d`), grant `consumedAt` stamped, returned `rawSession` hashes to the session row; second consume of the same grant → null; expired grant → null; grant whose member belongs to ANOTHER viewbook → null (wrong-viewbook fence); **two concurrent consumes → exactly one session row** (run both `consumeGrant` calls via `Promise.all`, assert `viewbookMemberSession.count() === 1` and exactly one non-null result); logout revokes the matching session (subsequent principal resolve → null) and no-ops on unknown/expired cookie values.

- [ ] **Step 2: Implement the core** (spec §7 — both statements carry the IDENTICAL grant predicate; counts asserted after commit):

```ts
// lib/viewbook/auth-consume.ts
import { prisma } from '@/lib/db'
import { hashSecret, mintSecret } from './auth-secrets'
import { SESSION_TTL_MS } from './auth-config'

export async function consumeGrant(viewbook: { id: number }, rawGrant: string, now = Date.now()): Promise<{ rawSession: string } | null> {
  const h = hashSecret(rawGrant)
  const { raw: rawSession, hash: sessionHash } = mintSecret()
  const [inserted, consumed] = await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO "ViewbookMemberSession" ("memberId","tokenHash","expiresAt","createdAt")
      SELECT g."memberId", ${sessionHash}, ${now + SESSION_TTL_MS}, ${now}
      FROM "ViewbookAuthGrant" g
      JOIN "ViewbookTeamMember" m ON m."id" = g."memberId"
      WHERE g."tokenHash" = ${h} AND g."consumedAt" IS NULL AND g."expiresAt" > ${now}
        AND m."viewbookId" = ${viewbook.id}
    `,
    prisma.$executeRaw`
      UPDATE "ViewbookAuthGrant" SET "consumedAt" = ${now}
      WHERE "tokenHash" = ${h} AND "consumedAt" IS NULL AND "expiresAt" > ${now}
        AND EXISTS (SELECT 1 FROM "ViewbookTeamMember" m
                      WHERE m."id" = "ViewbookAuthGrant"."memberId" AND m."viewbookId" = ${viewbook.id})
    `,
  ])
  if (inserted !== 1 || consumed !== 1) return null
  return { rawSession }
}

export async function revokeSessionByCookie(rawSession: string, now = Date.now()): Promise<void> {
  await prisma.viewbookMemberSession.updateMany({
    where: { tokenHash: hashSecret(rawSession), revokedAt: null },
    data: { revokedAt: new Date(now) },
  })
}
```

**Count contract (Codex plan-fix #4):** `(1,1)` = success; `(0,0)` = uniform failure. `(1,0)`/`(0,1)` are impossible under SQLite serialization (identical predicate, one txn) but MUST be handled defensively — a later edit could drift the predicates. On any non-`(1,1)`, non-`(0,0)` result: `logError` an invariant-failure (ids/counts only — NEVER the grant hash or session secret/hash values), and on `(1,0)` delete the just-created orphan session by `tokenHash: sessionHash` (`deleteMany`) before returning null. The route still answers a uniform 401.

- [ ] **Step 3: Consume route.** Preflight: `requireSameSite` → `requireJsonContentType` → `requireViewbookToken(token)` → `readBoundedJson(request, 4_096)`; `body.g` must be a non-empty string ≤ 128 chars else uniform 401. On `consumeGrant` null → `NextResponse.json({ error: 'invalid_grant' }, { status: 401 })`. On success:

```ts
const res = NextResponse.json({ ok: true })
res.cookies.set(memberCookieName(vb.id), rawSession, {
  httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: Math.floor(SESSION_TTL_MS / 1000),
})
return res
```

- [ ] **Step 4: Logout route.** `requireSameSite` → `requireViewbookToken(token)` (404 on bad token) → read `memberCookieName(vb.id)` from the request cookie header; if present `await revokeSessionByCookie(value)`; ALWAYS respond 204 with the cookie cleared (`res.cookies.set(name, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })`). Works regardless of principal kind — never resolves a principal.

- [ ] **Step 5: Run tests** → PASS. **Step 6: Commit.**

---

### Task 7: Middleware matcher

**Files:**
- Modify: `middleware.ts` (viewbook block, after line 92)
- Test: `middleware.test.ts` (extend the existing viewbook describe block)

- [ ] **Step 1: Failing tests:** `/api/viewbook/abc/auth/request|consume|logout` are public; `/api/viewbook/abc/auth/anything-else`, `/api/viewbook/abc/auth`, `/api/viewbook/abc/auth/request/extra` are NOT public.

- [ ] **Step 2: Add exactly one matcher** below the collapse matcher:

```ts
// U1 magic-link auth endpoints — explicit tail (never [^/]+: a wildcard would
// silently publicize future auth sub-routes).
if (/^\/api\/viewbook\/[^/]+\/auth\/(?:request|consume|logout)$/.test(pathname)) return true
```

- [ ] **Step 3: Run** `npx vitest run middleware.test.ts` → PASS. **Step 4: Commit.**

---

### Task 8: Landing page + `AuthLanding` + `MemberSessionBar`

**Files:**
- Modify: `app/(public)/viewbook/[token]/page.tsx`
- Create: `components/viewbook/public/AuthLanding.tsx`, `components/viewbook/public/MemberSessionBar.tsx`
- Test: `components/viewbook/public/AuthLanding.test.tsx`, extend `app/(public)/viewbook/[token]/` page tests if present (page logic tests live via unit tests on the light-lookup branch — see Step 1)

- [ ] **Step 1: Failing tests:** `AuthLanding` renders email form; submit POSTs `/api/viewbook/<token>/auth/request` and shows "If this address was invited, a link is on its way." for ANY outcome; on mount with `location.hash = '#g=abc'` it strips the hash via `history.replaceState` and shows a **Continue** button; Continue POSTs `{ g: 'abc' }` to `auth/consume`, then `location.replace('/viewbook/<token>')` on 200; a 401 falls back to the email form with "That link has expired — request a fresh one." Assert NO viewbook payload props exist (component takes ONLY `{ token }`).

- [ ] **Step 2: Implement `AuthLanding.tsx`** (client component, `'use client'`): static ER-branded card (reuse the notify email palette — navy header bar, neutral copy: "This onboarding viewbook is invitation-only. Enter your email and we'll send you a sign-in link if you've been invited."). State machine: `idle | sent | consuming | expired`. On mount:

```ts
useEffect(() => {
  const m = /^#g=(.+)$/.exec(window.location.hash)
  if (m) {
    setGrant(decodeURIComponent(m[1]))
    history.replaceState(null, '', window.location.pathname)
  }
}, [])
```

Continue handler: `fetch(`/api/viewbook/${token}/auth/consume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ g }) })` → 200: `window.location.replace(`/viewbook/${token}`)`; else clear grant, show expired copy. Email submit posts to `auth/request`, ALWAYS lands on `sent`.

- [ ] **Step 3: Implement `MemberSessionBar.tsx`** (client): props `{ token: string; name: string }`; renders "Signed in as {name}" + a Sign out button that POSTs `auth/logout` then `window.location.reload()`.

- [ ] **Step 3b: `FragmentScrubber.tsx` (Codex plan-fix #5).** A member/operator who clicks ANOTHER magic link while already signed in lands on an authenticated branch — `AuthLanding` never mounts, and `#g=<secret>` would sit in the address bar (contrary to §6: "With a live principal already present, the component clears the fragment and does nothing"). Create a tiny client leaf that on mount strips a `#g=` fragment via `history.replaceState` (no consume, no state), and mount it on EVERY authenticated branch (member, operator/dev, break-glass) — e.g. rendered as the first child alongside the shell. Test: mount with `location.hash = '#g=x'` → hash removed, no fetch fired.

- [ ] **Step 4: Rewrite the page entry** (spec §6 — the unauthorized path never calls `loadViewbookPublicData`):

```ts
export default async function ViewbookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length > 128) notFound()
  const vb = await prisma.viewbook.findUnique({
    where: { token },
    select: { id: true, revokedAt: true, client: { select: { archivedAt: true } } },
  })
  if (!vb || vb.revokedAt || vb.client.archivedAt) notFound()
  const principal = await resolveViewbookPrincipalRSC({ id: vb.id })
  if (principal == null) return <AuthLanding token={token} />
  const data = await loadViewbookPublicData(token)
  if (!data) notFound()
  // …existing resolveThemeFonts + baseRenderSection unchanged…
```

Branching: `operator`/`dev` → existing operator branch (`isOperator: true` prop path, `loadOperatorViewbookData`); `member` → base shell + `<MemberSessionBar token={token} name={principal.member.name} />` rendered above the shell (wrap in a fragment); `break-glass` → base shell only (read-only member-equivalent — writes 404 server-side). `isOperator` prop = `principal.kind === 'operator' || principal.kind === 'dev'`.

- [ ] **Step 5: Run tests + `npx tsc --noEmit`** → PASS. **Step 6: Commit.**

---

### Task 9: Route guards on every token route + asset `no-store`

**Files:**
- Modify (each `app/api/viewbook/[token]/…/route.ts`): `assets/[filename]` (read), `sync` (read), `feedback`, `materials`, `answers`, `ack`, `team-members`, `setup` (writes). `collapse` keeps its 410 short-circuit untouched.
- Test: each route's existing test file gains principal cases; add a shared enumeration test `lib/viewbook/route-guard-coverage.test.ts`.

- [ ] **Step 1: Failing tests:** for EVERY route above: no principal → 404 `not_found` (body + status identical to a bad token); member cookie → works; `er_auth` operator → works; dev-bypass → works; break-glass → reads work, writes 404. Assets response `Cache-Control` === `private, no-store`.
  - **Auth test environment (Codex plan-fix #7):** vitest runs non-production with auth unconfigured, so `isAuthBypassedInDev()` would be TRUE and "no principal" impossible. For the no-principal/member/operator/break-glass cases, SET the auth env (`APP_AUTH_PASSWORD` + `APP_AUTH_SECRET` or the file's existing auth-test helper pattern — check how `lib/auth.test.ts`/existing middleware tests configure it) in `beforeEach` and restore in `afterEach`; leave it UNSET only for the explicit dev-bypass case.
  - **Token enumeration:** each route is tested against unknown token, revoked viewbook, AND archived-client token (all 404) — not merely "bad token".
  - **Logout carve-out (Codex plan-fix #6):** `auth/logout` is NOT under the "no principal → 404" assertion — for a VALID token it returns 204 and clears the cookie with no/live/expired principal alike; only unknown/revoked/archived tokens 404. Also test an operator and a break-glass session that ALSO carry a member cookie: logout revokes that member session and clears the cookie.

- [ ] **Step 2: Implement.** In each route handler, immediately after `requireViewbookToken(token)`: reads → `await requireCanRead(request, vb)`; mutations → `const principal = await requireCanWrite(request, vb)` (principal threading into cores lands in Task 10 — this task only gates). In `assets/[filename]/route.ts` line ~79 change `'private, max-age=3600'` → `'private, no-store'` (§5: a removed member must not keep reading assets from browser cache).

- [ ] **Step 3: Run the full viewbook route suites** → PASS. **Step 4: Commit.**

---

### Task 10: Commit-time member fences + write attribution

**Files:**
- Modify: `lib/viewbook/public-writes.ts` (feedback + materials cores), `lib/viewbook/answers.ts` (`applyAnswerEdit`, `proposeAmendment`), `lib/viewbook/ack.ts`, `lib/viewbook/setup.ts`, `lib/viewbook/team-members.ts` (add/resend), their routes, `lib/viewbook/digest.ts`, `lib/viewbook/public-data.ts`, `components/viewbook/public/MaterialsSection.tsx`
- Test: extend each core's test file; `lib/viewbook/digest.test.ts`

**Interfaces:**
- Consumes: `memberWriteFence(principal, viewbookId, now)`, `attributionOf(principal)` (Task 3).
- Produces (Codex plan-fix #8 — ONE consistent auth parameter): `export interface PublicMutationAuth { principal: ViewbookPrincipal }` (add to `principal.ts`). EVERY public mutation core — `insertClientFeedback`, `insertClientMaterial` (public-writes.ts), `applyAnswerEdit`, `proposeAmendment` (answers.ts), the ack + setup cores, `addTeamMember`, `resendInvite` (team-members.ts) — gains an `auth: PublicMutationAuth` parameter placed consistently BEFORE the existing optional test-hooks param. Each core derives `attributionOf(auth.principal)` INTERNALLY and applies `memberWriteFence(auth.principal, viewbook.id, now)` itself (a core that received only pre-derived attribution could not build the fence). `applyAnswerEdit`/`proposeAmendment` DROP their `actor: string` param in favor of `auth`.
- Also produces: `requireMemberStillAuthorized(auth: PublicMutationAuth, viewbookId: number): Promise<void>` in `principal.ts` — re-resolves the member session row (live, unexpired, member on this viewbook) and throws `HttpError(404, 'not_found')` otherwise; no-op for operator/dev.

- [ ] **Step 1: Failing tests:**
  - **Fence:** start a member write whose txn predicate is evaluated AFTER the member row is deleted (delete the member, then call the core with the stale `principal`) → 0 rows affected, blocked-diagnosis 404 path.
  - **Removal-race honesty (Codex plan-fix #9):** for EACH core with a replay/no-op success path (answers value-idempotent return, amendment/feedback/material/team-add `clientMutationId` replay, ack already-acked no-op, setup no-change) — a REMOVED member replaying/no-op'ing gets 404, never a replayed 200.
  - **Attribution (spec acceptance 9):** member answers PATCH → `ViewbookField.valueUpdatedBy` = member email, `ViewbookFieldAmendment.author` = member NAME, activity row `actorKind='member'` + `actor` = email; feedback authorship (fix #11): claimed `authorName` body field is IGNORED for EVERY principal — member → member name + `authorKind: 'client'`, operator/dev → verified email + `authorKind: 'operator'`; materials `addedBy` = member email + `addedByKind = 'member'`; team-add `ViewbookTeamMember.addedBy` = the authenticated identity (member email / operator email), not the `'client'` literal.
  - **Digest:** member-actor activity (actorKind `member`) appears in the digest; operator activity does not (3 query sites in `digest.ts` lines ~43/49/86 switch from `actor = 'client'` to `actorKind IN ('client','member')`).
  - **MaterialsSection (fix #12):** renders from the DURABLE `addedByKind` — `'client'`/`'member'` → "added by you" (client-side), `'operator'` → "added by our team"; removing the member row does NOT flip historical rendering.
  - **DataSourceSection `who()` (fix #11):** a field updated by a member email renders as client-side attribution, not "our team" (locate the `who()`/updatedBy-rendering logic in `DataSourceSection.tsx` and test its member-email case).
  - **Producer coverage (fix #10):** a grep-driven test (or assertion script step) that every `ViewbookActivity` INSERT site in `lib/viewbook/` binds an explicit `actorKind` — no writer relies on the column default.
- [ ] **Step 2: Implement fences + attribution.**
  - Each core ANDs `memberWriteFence(auth.principal, viewbook.id, now)` into its existing commit-time predicate (`A`, `A2`, `R`, `activityPredicate`, the answers/ack/setup predicates).
  - **Post-fence authorization recheck (fix #9):** in every blocked-diagnosis / replay / value-idempotent-success path (team-members.ts replay lookup, answers current-value return, public-writes replay lookups, ack/setup no-ops), call `await requireMemberStillAuthorized(auth, viewbook.id)` BEFORE returning the success/replay result — a member removed mid-race must end in 404, not a replayed 200.
  - **ALL activity writers (fix #10):** `appendActivityStatements` (`lib/viewbook/activity.ts`) gains a REQUIRED `actorKind` input (compile error for missed callers). Update EVERY producer: the public cores here (from `attributionOf`), and the admin/operator writers — `service.ts` admin paths, `resetSectionAck`, `lockViewbook`, stage transitions, and any other raw/Prisma `ViewbookActivity` insert (`grep -rn 'ViewbookActivity' lib/ app/` is the worklist) — hardcoding `'operator'` (or `'system'` for job-driven writers if any exist). No production writer may rely on the schema default.
  - `applyAnswerEdit` (answers.ts line ~186) + `proposeAmendment` (~270): `actor` param → `auth`; `valueUpdatedBy`/activity `actor` bind the derived actorEmail; amendment `author` binds the derived authorName.
  - Feedback core: derive authorship from `auth.principal` for every principal kind (fix #11); the client-supplied `authorName` body field is ignored (member → name, operator/dev → email); `authorKind` = `'client'` for member, `'operator'` for operator/dev (matches the column's existing two-value contract; U4 owns the full restructure).
  - Materials core: `addedBy` binds actorEmail; NEW column `addedByKind` binds actorKind (fix #12).
  - Team-members core: `addedBy` binds actorEmail (was hardcoded `'client'`).
  - Routes construct `auth = { principal }` from their Task-9 principal and pass it down.
  - `MaterialsSection.tsx` line ~95 branches on the material's `addedByKind` (threaded through the public payload type in `public-data.ts`/`public-types.ts`) — NO roster lookup, no history-rewriting inference (fix #12).
  - `DataSourceSection.tsx` `who()` (line ~25: `author === 'client' ? 'you' : 'our team'`, used for both `field.valueUpdatedBy` and amendment `a.author`): fix DURABLY, same pattern as `addedByKind` — Task 1's migration ALSO adds `ViewbookField.valueUpdatedByKind String?` and `ViewbookFieldAmendment.authorKind String @default("client")` (backfill: existing non-`'client'` values → `'operator'`). The answer/amendment cores write them from the derived actorKind; the public field/amendment payload threads them; `who(kind)` becomes `kind === 'client' || kind === 'member' ? 'you' : 'our team'`. No roster inference, history stable after member removal (fix #12's durability rule applied consistently).
  - **Audit step (acceptance 9):** `grep -rn "=== 'client'\|!== 'client'" lib/viewbook/ components/viewbook/` — every hit is either fixed by the above, justified in a code comment, or listed in the PR description.
- [ ] **Step 3: Run the full viewbook suite** → PASS. **Step 4: Commit.**

---

### Task 11: Member removal (admin) + roster in `getViewbookAdmin`

**Files:**
- Create: `app/api/viewbooks/[id]/team-members/[memberId]/route.ts`
- Modify: `lib/viewbook/service.ts` (`getViewbookAdmin` include), `components/viewbook/admin/ViewbookEditor.tsx` (+ the tab component that fits — a minimal roster block; U2 refines)
- Test: route test + `service.test.ts` extension

- [ ] **Step 1: Failing tests:** DELETE removes the member in ONE txn (syncVersion bumped, `ViewbookActivity` row kind `'team-remove'`, actor = operator email, actorKind `'operator'`, member row gone); FK cascade removed grants + sessions (create one of each first, assert both gone); removed member's next `resolveViewbookPrincipalFromCookies` → null; 404 on unknown memberId / wrong viewbook; cookie-gated (no `er_auth` → middleware 401 — assert route is NOT in `isPublicPath`).

- [ ] **Step 2: Route** (admin namespace — cookie-gated by middleware omission; `requireOperatorEmail` from `lib/viewbook/operator.ts` for attribution):

```ts
const removal = Prisma.sql`EXISTS (SELECT 1 FROM "ViewbookTeamMember" WHERE "id" = ${memberId} AND "viewbookId" = ${viewbookId})`
const [, activityCount, deleted] = await prisma.$transaction([
  syncVersionBumpWhere(viewbookId, removal),
  prisma.$executeRaw`
    INSERT INTO "ViewbookActivity" ("viewbookId","kind","actor","actorKind","summary","createdAt")
    SELECT ${viewbookId}, 'team-remove', ${operatorEmail}, 'operator', ${'Removed team member'}, ${now}
    WHERE (${removal})`,
  prisma.$executeRaw`DELETE FROM "ViewbookTeamMember" WHERE "id" = ${memberId} AND "viewbookId" = ${viewbookId}`,
])
if (deleted !== 1) throw new HttpError(404, 'not_found')
// Codex plan-fix #13: the statements share one predicate — assert AGREEMENT so
// a predicate drift can never silently accept a delete without its audit row.
if (activityCount !== 1) throw new Error('viewbook_team_remove_activity_mismatch')
// (capture the bump result too — `const [bumped, activityCount, deleted]` —
// and assert bumped === 1 for the same reason)
```

- [ ] **Step 3: Admin loader + UI.** `getViewbookAdmin` include gains `teamMembers: { orderBy: { id: 'asc' } }`. Minimal roster block (name · email · Remove button with confirm) in the admin editor near the existing tabs — one small component, list only; U2 replaces it with the invite grid.

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit.**

---

### Task 12: Cleanup sweeps

**Files:**
- Create: `lib/viewbook/auth-retention.ts`; Test: `lib/viewbook/auth-retention.test.ts`
- Modify: `lib/cleanup.ts` (add to the `Promise.allSettled` list)

- [ ] **Step 1: Failing tests:** deletes grants `expiresAt < now − 7 d` OR `consumedAt < now − 7 d`; deletes sessions `expiresAt < now` OR `revokedAt < now − 7 d`; deletes request rows `createdAt < now − 48 h`; live rows untouched (fresh grant/session/request survive).

- [ ] **Step 2: Implement `pruneViewbookAuthRows(now = new Date())`** — three `deleteMany` calls (Prisma where-clauses, no raw SQL needed), returns `{ grants, sessions, requests }` counts; add `pruneViewbookAuthRows()` to `runCleanup()`'s allSettled list (import alongside the existing `pruneViewbookActivity` line).

- [ ] **Step 3: Run tests** → PASS. **Step 4: Commit.**

---

### Task 13: Acceptance sweep + gates

**Files:** none new — this is the spec-§14 verification pass.

- [ ] **Step 1:** Walk acceptance criteria 1–12 (§14) and map each to a passing test; write any missing test. Pay attention to: the flight-payload assertion (criterion 1 — render `AuthLanding` branch output and assert no client name/theme/section strings; unit-test the page's light-lookup branch with a `loadViewbookPublicData` spy asserting zero calls), per-viewbook isolation (criterion 5 — same email on two viewbooks → two cookies, cross-use fails), and criterion 10 (break-glass read-only).
- [ ] **Step 2:** `npx tsc --noEmit` → clean. `npx vitest run` → all green. `npm run build` → succeeds.
- [ ] **Step 3:** Final commit; open PR titled `feat(viewbook): U1 magic-link auth — invitation-only viewbooks + member attribution`. PR body: spec/plan links, the `=== 'client'` audit table, acceptance-criteria checklist. **U1 is auth-touching → request the pre-merge `/codex-review` of the branch diff before merge.**
- [ ] **Step 4 (post-deploy smoke, with Kevin/Claude-side):** one real Mailgun send; click the emailed link; confirm the `#g=` fragment survived the email-client path, the interstitial consumes, and the cookie session renders the viewbook.

---

## Self-Review notes

- Spec coverage: §3→Task 1, §4→Tasks 2/6, §5→Tasks 3/9, §6→Task 8, §7→Tasks 4/6/7, §8→Task 5, §9→Tasks 11/12 (+token rotate untouched — verified no task touches it), §10→Task 10, §11→Tasks 3/8/9 (canWrite excludes break-glass), §12→Task 2, §14→Task 13.
- Type consistency: `ViewbookPrincipal`/`requireCanRead`/`requireCanWrite`/`memberWriteFence`/`attributionOf` defined once in Task 3 and consumed by name in Tasks 8–11.
- The uniform-400-vs-200 choice for malformed emails in Task 4 Step 3 is a deliberate deviation surface: spec §7 says "response is ALWAYS the same 200" — the plan keeps 200 even for syntactically-invalid emails (no ledger row will land; `canonicalMailbox` null → skip the txn, still `{ ok: true }`). Codex plan review confirmed this as acceptable stricter non-oracle behavior.
- Codex plan-review (13 fixes) applied 2026-07-22: Tasks 1/3/4/5/6/8/9/10/11 amended in place — see the Plan review line in the header for the list. Kevin-verify items carried to Task 13 Step 4: real Mailgun `#g=` smoke, Secure-cookie behavior on the prod HTTPS host + exact `vb_s_<id>` clearing, and the acceptability of terminally-suppressing pre-U1 null-memberId `team-invite` deliveries (test-only viewbooks, D4 — accepted in plan).
