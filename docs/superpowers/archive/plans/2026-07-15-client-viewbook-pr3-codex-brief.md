# Codex Brief — Viewbook PR3 (Data Source interactivity)

> Paste this whole document as ONE prompt into `codex exec`. Cut 2026-07-16
> from MERGED main @ b7be08e (PR1 #185 + PR2 #187 + PR4 #189 all in). PR5
> (Claude lane) runs in parallel and owns `SectionShell.tsx` /
> `AssessmentSection` / `Tooltip.tsx` / the public page mount — you never
> touch those.

## Setup + sandbox rules

Your worktree ALREADY EXISTS: `.claude/worktrees/viewbook-pr3`, branch
`feat/viewbook-pr3`, created by Claude from `origin/main` @ b7be08e.

```bash
cd <repo-root>/.claude/worktrees/viewbook-pr3
```

Work ONLY there. Sandbox rules (lessons from PR4):

- Do NOT commit — git metadata for a worktree lives in the main repo's
  `.git/worktrees/…`, outside your sandbox. Leave ALL work uncommitted;
  Claude reviews, runs full gates, and commits.
- Do NOT run `npm run build` or `npm run audit:ci` (network). You MAY run:
  `npx tsc --noEmit`, `npm run lint`, and
  `DATABASE_URL="file:./local-dev.db" npx vitest run <paths>` (the worktree
  has no `.env` — always prefix `DATABASE_URL`).
- Done means: tsc + lint + your targeted vitest green, all changes
  uncommitted, then STOP and report. Claude runs the full suite + build,
  commits, cross-reviews, opens the PR.

## Context

er-seo-tools client viewbook: token-linked public client hub. Merged so far:
PR1 = full schema (11 `Viewbook*` models — NEVER touch
`prisma/schema.prisma`), `route-auth.ts`, `operator.ts`, service layer, admin
shell. PR2 = public themed page (read-only sections incl. the read-only
`DataSourceSection`), `--vb-*` CSS vars, public-data loader. PR4 =
`public-write-guard.ts`, `public-writes.ts` (feedback/materials transactional
cores — YOUR pattern to follow), `activity.ts`, digest, admin
Feedback/Activity tabs.

Requirements of record: spec §7 (write semantics — Codex fixes 1–3), §8
"Data Source" bullet, §10 (Data Source admin tab), §11, §12 in
`docs/superpowers/specs/2026-07-15-client-viewbook-design.md`, plus the PR3
section of `docs/superpowers/plans/2026-07-15-client-viewbook-program.md`.
Read them before coding. This brief is the execution contract.

## What PR3 ships

Client answer writes with optimistic concurrency + autosave, the lock-in
state machine, dated append-only amendments, operator custom-field CRUD +
soft-archive, operator answer editing, and the Data Source admin tab.

### The answer/lock/amendment state machine (spec §7, exact)

- **Edit path** (client public route AND operator admin route — same rules):
  request carries `expectedVersion`. Conditional write fenced in SQL on
  `version = expectedVersion` AND the field being **editable**: viewbook not
  locked (`dataLockedAt IS NULL`) OR the field sits outside the locked
  baseline (`ViewbookField.createdAt > Viewbook.dataLockedAt` — post-lock
  custom fields stay editable, spec §8). Bumps `version` by 1, stamps
  `valueUpdatedBy` (`'client'` or operator email) + `valueUpdatedAt`.
- **0-rows diagnosis order** (public-writes.ts precedent — diagnose AFTER the
  fenced write, never before): re-run `requireViewbookToken` (public path);
  field missing / archived / cross-viewbook / section hidden → 404;
  version mismatch → **409 `stale_version` + the current
  `{value, version}`**; locked baseline field → **409 `data_locked` + the
  current value** (NEVER a silent amendment — the client UI re-renders the
  locked state and offers "propose a change").
- **No-op saves** (incoming value equals current value): no write, no version
  bump, NO activity row; return 200 with the current field state.
- **Amendment path** (EXPLICIT only — a distinct request shape, never a
  fallback): allowed only post-lock and only on locked-baseline fields
  (editable fields take the edit path; amending an editable field → 409
  `not_locked`). Append-only `ViewbookFieldAmendment`, cap **≤ 20 per field**
  via guarded `INSERT … SELECT` (cap predicate in SQL, never
  count-then-create), `clientMutationId` (UUID, required) replay returns the
  stored row as 200. `author` = `'client'` (public) or operator email
  (admin).
- **Lock-in** (operator): fenced
  `updateMany({ where: { id, dataLockedAt: null }, data: { dataLockedAt, dataLockedBy } })`
  — idempotent, first writer wins; count 1 → also write a `'lock'` activity
  row in the SAME array-form transaction; count 0 → 200 `already_locked`
  (read + return current state, no activity).
- **Activity kinds** (`appendActivityStatements`): `'answer'` (value
  actually changed), `'amendment'`, `'lock'`. Actor = `'client'` or operator
  email. Ride the same transaction as the domain write.
- **Commit-time fencing on every public mutation** (spec fix 1): the fenced
  SQL re-verifies token current + `revokedAt IS NULL` + client not archived +
  `data-source` section not `'hidden'` + field belongs to the token's
  viewbook + field not archived. `requireViewbookToken` is only a preflight.
- **`fieldType: 'list'` values** are a JSON array of strings — validate on
  write (array, every element a string, byte cap applies to the serialized
  form). `'text'`/`'textarea'` values are plain strings. Value byte cap
  **8 KB** (spec §11); `value: null` (clearing) is allowed on the edit path.

## Interface contracts (copied from MERGED main — import, never re-implement)

`lib/viewbook/route-auth.ts`:
```ts
export async function requireViewbookToken(token: string): Promise<Viewbook>
// fail-closed; unknown/revoked/archived-client ALL → HttpError(404, 'not_found'); PREFLIGHT ONLY
```

`lib/viewbook/public-write-guard.ts` (PR4 — you MUST reuse, never modify):
```ts
export function requireSameSite(request: Request): void            // 403 cross_site_request_blocked
export function requireJsonContentType(request: Request): void     // 415 json_content_type_required
export function checkWriteThrottle(token: string, now?: number): void // 429 rate_limited (10/min/token)
export async function readBoundedJson(request: Request, capBytes: number): Promise<unknown> // 413/400
export function validateClientMutationId(raw: unknown): string | null // UUID-shaped or null; 400 otherwise
export function resetWriteThrottleForTests(): void
```

Public-route guard-chain order — copy `app/api/viewbook/[token]/feedback/route.ts` EXACTLY:
```ts
export const dynamic = 'force-dynamic'
export const PATCH = withRoute(async (request: NextRequest, { params }: RouteParams) => {
  requireSameSite(request)
  requireJsonContentType(request)
  const token = (await params).token
  const viewbook = await requireViewbookToken(token)
  checkWriteThrottle(token)
  const input = parseInput(await readBoundedJson(request, BODY_CAP_BYTES))
  // … transactional core in lib/viewbook/answers.ts …
  return NextResponse.json({...}, { status, headers: { 'Cache-Control': 'no-store' } })
})
```

`lib/viewbook/public-writes.ts` is THE transactional-core pattern (read the
whole file): ONE array-form `prisma.$transaction([...])` of `$executeRaw`
statements, activity insert + domain write both EXISTS-fenced on (token
current ∧ not revoked ∧ client not archived ∧ section not hidden ∧ target
belongs to viewbook ∧ cap), `ON CONFLICT("clientMutationId") DO NOTHING`
replay, integer-ms `createdAt` binding, and post-transaction diagnosis
(replay probe → `requireViewbookToken` → specific 409 → 404). Your answers
core lives in a NEW `lib/viewbook/answers.ts` in the same style — the edit
path is a fenced raw UPDATE (`WHERE "version" = ${expectedVersion} AND …`)
instead of an INSERT.

`lib/viewbook/activity.ts` (PR4):
```ts
export function appendActivityStatements(viewbookId: number, kind: string, actor: string, summary: string): Prisma.PrismaPromise<unknown>[]
```

`lib/viewbook/operator.ts` (PR1): `requireOperatorEmail(request): Promise<string>` — 401 on missing session.
`lib/viewbook/route-utils.ts` (PR1): `parseId(raw): number` (404 on non-int), `requireJsonObject(body): Record<string, unknown>` (400).
`lib/api/with-route.ts` `withRoute`, `lib/api/errors.ts` `HttpError(status, code)`.

`lib/viewbook/public-types.ts` `PublicField` (PR2 — already carries your contract; NEVER modify this file):
```ts
export interface PublicField {
  id: number; label: string; fieldType: string
  value: string | null
  version: number      // the expectedVersion optimistic-concurrency contract
  createdAt: string    // derive "added after lock-in" vs dataLockedAt
  valueUpdatedBy: string | null; valueUpdatedAt: string | null
  isCustom: boolean
  amendments: PublicFieldAmendment[]  // {id, value, author, createdAt}
}
```
`ViewbookPublicData` carries `dataLockedAt: string | null` + `fieldCategories: PublicFieldCategory[]`
(`{category, fields}`). The loader (`public-data.ts`) already filters
`archivedAt: null` — soft-archived fields vanish from the public page with NO
loader change.

`lib/viewbook/catalog.ts`: `CATALOG_CATEGORIES = ['school','programs','team-access','crm-leads','admissions','positioning','student-experience','brand-materials'] as const`; `fieldType ∈ 'text' | 'textarea' | 'list'`.

`lib/viewbook/service.ts` `getViewbookAdmin(id)` ALREADY includes
`fields: { orderBy: [{category:'asc'},{sortOrder:'asc'}], include: { amendments: true } }`
— the admin tab reads fields from the existing `GET /api/viewbooks/:id`
payload; do NOT add a fields GET route and do NOT modify `service.ts`.

Schema fields you fence on (PR1, read `prisma/schema.prisma` for the full
models — never edit it): `ViewbookField{ id, viewbookId, defKey (null =
custom), category, label, fieldType, sortOrder, value, version (default 0),
valueUpdatedBy, valueUpdatedAt, archivedAt, createdBy, createdAt,
@@unique([viewbookId, defKey]) }`;
`ViewbookFieldAmendment{ id, fieldId, value, author, clientMutationId
@unique, createdAt }`; `Viewbook{ dataLockedAt, dataLockedBy, revokedAt, … }`.

`middleware.ts` `isPublicPath` currently (lines ~71–78):
```ts
// Client viewbook: public themed page + exact token-scoped routes ONLY.
// NEVER a '/viewbook/' or '/api/viewbook/' PREFIX — the answers matcher
// lands only in the PR that ships that route (spec §11), and /viewbooks
// (admin) must stay gated.
if (/^\/viewbook\/[^/]+$/.test(pathname)) return true
if (/^\/api\/viewbook\/[^/]+\/assets\/[^/]+$/.test(pathname)) return true
if (/^\/api\/viewbook\/[^/]+\/feedback$/.test(pathname)) return true
if (/^\/api\/viewbook\/[^/]+\/materials$/.test(pathname)) return true
```

`middleware.test.ts` (~line 151) currently asserts
`isPublicPath('/api/viewbook/tok/answers')` is **false** with the comment
that PR3 flips it — that is YOUR flip.

`components/viewbook/admin/ViewbookEditor.tsx` (client component): local
`ViewbookDetail` interface + `TABS = ['Theme','Content','Milestones','Feedback','Activity','Settings'] as const`;
tabs render as `{tab === 'X' && <XTab … />}`. PR4's `FeedbackTab` gets
`key={vb.id}` because it seeds `useState` from props — same remount-refresh
pattern applies to your tab if it seeds state.

`components/viewbook/public/DataSourceSection.tsx` (PR2, server component —
NO `'use client'`): renders the locked banner off `data.dataLockedAt`,
categories as `<details>` blocks, `FieldRow` per field (value + "last updated
by {you|our team} on {date}" + amendments bordered `var(--vb-tertiary)`),
marker comment at the bottom: `{/* PR3 owns this file next: inline editing,
autosave, propose-a-change. */}`. Server components can render client leaves
but can NOT pass function props (PR4 integration lesson —
`MilestonesSection` mounts `FeedbackThread` this way; `MaterialLinkForm`
calls `useRouter().refresh()` internally on success instead of an
`onCreated` prop).

## Your files (CREATE)

- `lib/viewbook/answers.ts` — the state machine above. Suggested exports:
  `applyAnswerEdit(viewbook, token | null, { fieldId, value, expectedVersion }, actor)`
  (token null = operator path — fences everything EXCEPT token/revocation;
  operator edits obey the same version + lock rules, spec §7),
  `proposeAmendment(viewbook, token | null, { fieldId, value, clientMutationId }, actor)`,
  `lockViewbook(id, operatorEmail)`. Every mutation = ONE array-form
  transaction, activity row included, diagnosis after.
- `app/api/viewbook/[token]/answers/route.ts` — PATCH, guard chain verbatim.
  Body cap 10 KB (8 KB value + envelope). Two request shapes,
  discriminated by `mode`:
  `{ mode: 'edit', fieldId, value, expectedVersion }` → edit path; 200
  `{ field: { id, value, version, valueUpdatedBy, valueUpdatedAt } }`.
  `{ mode: 'amend', fieldId, value, clientMutationId }` → amendment path;
  201 `{ amendment }` (200 on replay). Unknown/missing `mode` → 400.
  409 bodies carry `{ error, current: { value, version } }` so the client UI
  can re-render truth. All responses `Cache-Control: no-store`.
- `app/api/viewbooks/[id]/lock/route.ts` — POST (operator,
  `requireOperatorEmail` → `parseId` → `lockViewbook`). 200
  `{ dataLockedAt, dataLockedBy, alreadyLocked }`.
- `app/api/viewbooks/[id]/fields/route.ts` — POST create custom field
  (operator): `{ label ≤200 chars, fieldType ∈ text|textarea|list, category ∈
  CATALOG_CATEGORIES }` → `defKey: null`, `createdBy` = operator email,
  `sortOrder` = max(sortOrder)+1 within (viewbook, category), version 0.
  Creation is allowed pre- AND post-lock (post-lock customs render "added
  after lock-in" on the public page via `createdAt > dataLockedAt`).
- `app/api/viewbooks/[id]/fields/[fieldId]/route.ts` —
  PATCH (operator): `{ value, expectedVersion }` → `applyAnswerEdit`
  operator path; and/or `{ label }` (custom fields ONLY — `defKey: null`;
  relabeling a catalog field → 400). `{ mode: 'amend', value,
  clientMutationId }` → operator amendment.
  DELETE (operator): SOFT-archive — stamp `archivedAt` (never hard-delete;
  ownership-fenced `updateMany where { id: fieldId, viewbookId, archivedAt:
  null }`; 0 rows → 404). Archived fields stay in the admin payload
  (render greyed "archived") and disappear from the public page.
- `components/viewbook/admin/DataSourceTab.tsx` — grouped field list from the
  `ViewbookDetail` fields you add to the interface: inline value editing
  carrying `expectedVersion` (on 409 show the returned current value, never
  clobber), add-custom-field form, per-field archive button (confirm),
  amendment list per field + operator propose-amendment when locked,
  **Lock in** button with `confirm()` (hidden once locked; locked state shows
  who/when).
- New public client leaves as needed under `components/viewbook/public/`
  (e.g. `FieldEditor.tsx`, `AmendmentForm.tsx`) — self-contained `'use
  client'` files, generate `clientMutationId` via `crypto.randomUUID()`,
  autosave per field on blur (PATCH `mode:'edit'`), 409 handling that
  re-renders the server truth (`data_locked` → flip to the propose-a-change
  form), `useRouter().refresh()` after successful amendment. These are NEW
  files only — never edit other existing public components.
- Tests for every module (vitest; DB-backed tests import `prisma` from
  `@/lib/db`; create clients named `vb-test-<uuid>` and clean up in
  `afterAll`; call `resetWriteThrottleForTests()` between route tests).
  REQUIRED race/edge tests (spec §12): lock-vs-answer (lock lands between
  preflight and commit → 409 `data_locked`, no write), revoke-vs-write (→
  404, no row), stale `expectedVersion` → 409 + current value, cross-viewbook
  `fieldId` → 404, amendment cap under `Promise.all` double-submit (exactly
  20 land), `clientMutationId` replay returns the same row, no-op save emits
  no activity + no version bump, post-lock custom field edits succeed while
  baseline fields 409, archived field edit → 404, list-value validation,
  middleware matcher positive + deeper-path negatives.

## Your files (MODIFY — these exact ones, nothing else)

- `components/viewbook/public/DataSourceSection.tsx` — replace the marker
  comment with the interactive mounts: pre-lock (or post-lock custom) fields
  render your editor leaf (props: `token`, `field` — data props only);
  locked baseline fields render read-only + your propose-a-change leaf;
  keep the existing locked banner, category grouping, stamps, and amendment
  rendering.
- `components/viewbook/admin/ViewbookEditor.tsx` — `TABS` gains
  `'Data Source'` (order: Theme · Content · Data Source · Milestones ·
  Feedback · Activity · Settings); extend the local `ViewbookDetail` with
  `dataLockedBy: string | null` and
  `fields: { id: number; defKey: string | null; category: string; label: string; fieldType: string; sortOrder: number; value: string | null; version: number; valueUpdatedBy: string | null; valueUpdatedAt: string | null; archivedAt: string | null; createdAt: string; amendments: { id: number; value: string; author: string; createdAt: string }[] }[]`
  (the GET already returns all of it); render
  `{tab === 'Data Source' && <DataSourceTab key={vb.id} viewbook={…} onChanged={() => void load()} />}`.
  Do NOT touch the other tabs or `SettingsTab`.
- `middleware.ts` — add EXACTLY ONE matcher alongside PR2/PR4's, same style:
  `if (/^\/api\/viewbook\/[^/]+\/answers$/.test(pathname)) return true`
  and update the block comment (the answers matcher has now landed with its
  route).
- `middleware.test.ts` — move the `/api/viewbook/tok/answers` assertion into
  the public expectations; add negatives `/api/viewbook/tok/answers/extra`
  and `/api/viewbook/tok/answersx`.

## FORBIDDEN

`prisma/schema.prisma`, `next.config.ts`, `lib/viewbook/public-write-guard.ts`
(consume only), `lib/viewbook/public-writes.ts`, `lib/viewbook/public-data.ts`,
`lib/viewbook/public-types.ts`, `lib/viewbook/service.ts`,
`app/(public)/viewbook/[token]/page.tsx`, every existing
`components/viewbook/public/*` file except `DataSourceSection.tsx`
(`SectionShell`/`AssessmentPlaceholder`/`Tooltip` are PR5's live lane —
touching them collides), `MilestonesSection.tsx`/`MaterialsSection.tsx`
(PR4), all of `lib/jobs/`, `lib/notify/`, `lib/cleanup.ts`. No new
migrations. No new env vars.

## House invariants (violations = review rejection)

- Array-form `prisma.$transaction([...])` ONLY — conditional logic via EXISTS
  predicates / fenced update counts; raw statements bind timestamps as
  integer ms (`Date.now()`), and any raw UPDATE must set `updatedAt` manually
  ONLY on models that have it (`ViewbookField` has NO `updatedAt` — do not
  invent one).
- All API routes `withRoute`-wrapped; errors via `HttpError`; public token
  failures ONE indistinguishable 404; operator routes 401 via
  `requireOperatorEmail`.
- Plain text everywhere; escape at render; no rich text crosses the public
  boundary. Public mutation responses + page: `Cache-Control: no-store`.
- Anchored single-segment middleware matchers only — NEVER a prefix.
- Values/labels validated server-side with byte caps (`Buffer.byteLength`).

Commit message style (for Claude's reference when committing):
`feat(viewbook): PR3 <what>` + `Co-Authored-By: Codex`.
