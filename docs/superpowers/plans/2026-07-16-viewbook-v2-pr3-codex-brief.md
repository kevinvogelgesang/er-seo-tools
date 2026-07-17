# Viewbook v2 PR3 — Email Infrastructure + CSM — Codex Brief

Self-contained brief for the Codex lane (v1 tandem model). Everything you need
is in this file + the repo at your worktree HEAD. Claude runs gates and
commits; leave your work UNCOMMITTED in the worktree.

**Branch/worktree:** `feat/viewbook-v2-pr3` at `.claude/worktrees/viewbook-v2-pr3`
**Spec:** `docs/superpowers/specs/2026-07-16-viewbook-v2-stages-design.md` §5 (data model), §8 (emails), §4 (stage-move) 
**Program:** `docs/superpowers/plans/2026-07-16-viewbook-v2-program.md` (wave 3; lanes are DISJOINT — no rebase-integration duty)

## Repo rules that bind every change

- **Array-form `$transaction([...])` ONLY** — never the interactive `async (tx) => {}` form (SQLite write-lock starvation, a documented prod incident). Express conditional logic in SQL (`EXISTS` predicates); set `updatedAt` manually in raw statements (integer ms `Date.now()`).
- No new env vars; no `middleware.ts` changes (every route here is cookie-gated — no public matchers).
- Plain text everywhere on the public surface; escape at render; no `dangerouslySetInnerHTML`. Email bodies: fixed templates, every dynamic value HTML-escaped.
- Operator identity = `requireOperatorEmail(request)` (`lib/viewbook/operator.ts`); admin route shells mirror `app/api/viewbooks/[id]/lock/route.ts` (withRoute + parseId + requireJsonObject + force-dynamic).
- Tests: vitest, `DATABASE_URL="file:./local-dev.db"` from the worktree root; follow each suite's existing fixture conventions (read before writing). TDD: failing test → implement → green, per unit below.
- **Sync-bump merge gate (program-wide):** any NEW mutation of *rendered* viewbook data adopts `syncVersionBumpStatement()`/variants from `lib/viewbook/sync.ts` inside the SAME fenced array transaction, plus bump/no-bump tests asserting **RELATIVE syncVersion deltas** (never absolute counts — `bumpAll` tests sweep the shared DB). In THIS PR the one new rendered mutation is **CSM assignment (`csmName`)** — §5 below. Delivery rows are NOT rendered data; they ride the stage move's existing bump.

## The load-bearing constraint (read first)

Array-form `$transaction([...])` **cannot consume a prior statement's autoincrement `id`.** So a `ViewbookEmailDelivery` created in the same fenced txn as the `ViewbookStageLog` **cannot** set `stageLogId` (the log's autoincrement id isn't available mid-array). The repo solves this with app-generated UUIDs: `ViewbookStageLog.eventKey` and `ViewbookTeamMember.memberKey` are `@unique` UUIDs generated BEFORE the txn (`service.ts:262` `const eventKey = crypto.randomUUID()`). Therefore:

- Stage-change delivery `dedupKey` = `vb-stage:<eventKey>:<recipient>` (spec §8 table — authoritative; the §5 model comment's `<stageLogId>` example is superseded). Leave `ViewbookEmailDelivery.stageLogId` **null** (it's a plain `Int?`, no FK). Correlate by `dedupKey`/`eventKey`.
- `dedupKey @unique` is a REAL status-independent unique index. A replayed stage move that re-inserts the same `dedupKey` throws P2002 → rolls back the whole array. Generate deterministic dedupKeys so a replay is caught as a conflict, and the delivery INSERTs ride INSIDE the stage-move array (so a P2025 stage-fence loss also discards the deliveries).
- Enqueue the durable job by DELIVERY id AFTER the txn commits: re-select the just-created rows by their deterministic `dedupKey`s (you know `eventKey` + each recipient), then `enqueueViewbookEmail(delivery.id)` per row (fire-and-forget, `.catch(log)` — a send-enqueue failure must never fail the stage move).

## Scope (exactly this, nothing more)

### 1. `viewbook-email` durable job + delivery core (`lib/viewbook/email.ts` + `lib/jobs/handlers/viewbook-email.ts`)

**Job type const** — add `VIEWBOOK_EMAIL_JOB_TYPE = 'viewbook-email'` to `lib/jobs/types.ts` (beside `VIEWBOOK_DIGEST_JOB_TYPE`).

**Handler** `lib/jobs/handlers/viewbook-email.ts` — copy the D7 marker pattern from `lib/jobs/handlers/notify-email.ts`, but fence a **delivery row** instead of an audit marker:
- Registration (via `registerViewbookEmailHandler()`, wired in `lib/jobs/handlers/register.ts`): `concurrency: 1, maxAttempts: 3, backoffBaseMs: 30_000, timeoutMs: 30_000`. **No `groupKey`** (spec §8 — no shared groups). No `onExhausted` (a permanently-failing send just exhausts; the row keeps `sentAt` null — honest).
- Payload: `{ deliveryId: number }`. `assertPayload` throws on malformed (mirror notify-email).
- **Terminal-marker guard (Codex fix 7):** every stamp — both `suppressedAt` and `sentAt` — is a conditional `updateMany` fenced on `{ id, sentAt: null, suppressedAt: null }`. A row is terminal when EITHER marker is set; never overwrite one with the other.
- Flow (NOT a transaction — the D7 read→send→conditional-stamp pattern):
  1. `if (!isNotifyEnabled())` → stamp `suppressedAt` (fenced on both markers null) and return. **Dark env = permanent suppression, honest record, no catch-up flood** (spec §8). Do NOT throw.
  2. Load the delivery row (`findUnique({ where: { id } })`). Missing → return (deleted).
  3. Already terminal (`sentAt != null || suppressedAt != null`) → return (idempotent).
  4. **Missing app URL is terminal, not a dangling no-op (Codex fix 7):** if `NEXT_PUBLIC_APP_URL` is unset, stamp `suppressedAt` (fenced) + `logError` and return — do NOT complete the job while leaving the delivery non-terminal (a non-terminal row would be re-enqueued forever by the recovery seam below).
  5. **Enrichment resolves the delivery's OWN event, not the viewbook's current state (Codex fix 4):** for `kind: 'stage-change'`, parse `eventKey` out of `dedupKey` (`vb-stage:<eventKey>:<recipient>` — split on `:`; `eventKey` is a UUID with no `:`, recipient emails have no `:`) and load `ViewbookStageLog.findUnique({ where: { eventKey } })` to get the stage that was ENTERED. Do NOT read `viewbook.stage` — it may have advanced again before the job runs. Load viewbook title/clientName best-effort with a short deadline (mirror notify-email's `withDeadline`); enrichment failure degrades to base copy, never suppresses the send. Build content via the §2 builder selected by `delivery.kind`; recipient = `delivery.recipient`.
  6. `await sendEmail({ to: delivery.recipient, content }, deps)` then conditional stamp: `prisma.viewbookEmailDelivery.updateMany({ where: { id, sentAt: null, suppressedAt: null }, data: { sentAt: new Date() } })`. Marker stamped only after a successful send (at-least-once, narrow dup window). A send failure throws → retry.
- Injectable `deps` (mirror notify-email's `NotifyDeps` / `realNotifyDeps` seam) so tests stub `sendEmail`.

**Delivery core** `lib/viewbook/email.ts`:
- `enqueueViewbookEmail(deliveryId: number): Promise<unknown>` — `enqueueJob({ type: VIEWBOOK_EMAIL_JOB_TYPE, payload: { deliveryId }, dedupKey: \`viewbook-email:\${deliveryId}\` })`. **No `groupKey`.** **Do NOT swallow errors here (Codex fix 3):** return the promise; the CALLER `.catch(logError)`s it so an enqueue failure is observable (the recovery seam below is the durability net, not silent-swallow). (The queue's active-window dedup + the delivery row's own `sentAt`/`suppressedAt` markers are the idempotency layers.)
- `stageChangeDeliveryStatements(input: { viewbookId: number; eventKey: string; recipients: string[] })` → an array of `prisma.viewbookEmailDelivery.create(...)` PrismaPromises (one per recipient), `kind: 'stage-change'`, `recipient`, `dedupKey: vb-stage:<eventKey>:<recipient>`, `stageLogId: null`, `memberId: null`. Returns `[]` for an empty recipient list (the no-op case until PR5). **No `stage` argument (Codex fix 4):** the stage the email announces is resolved by the job from `ViewbookStageLog.eventKey`, never stored on the delivery. `recipients` MUST be pre-deduplicated by the caller (§4) — two identical dedupKeys in one array would P2002 and roll back the whole txn. Keep this a pure statement-builder (only `.create` promise construction) so it composes into the fenced array.
- `recoverViewbookEmailDeliveries(): Promise<void>` — **durability backstop (Codex fix 3), mirrors `recoverBrokenLinkVerifies`:** find deliveries with `sentAt: null AND suppressedAt: null` for which NO `viewbook-email:<deliveryId>` Job row has ever existed (a delivery committed but whose post-commit enqueue was lost to a crash/throw), bounded (`take` a sane cap, e.g. 200), and re-enqueue each. Wire it into `recoverQueue()` (boot) and the `stale-audit-reset` scheduled sweep (mirror where `recoverBrokenLinkVerifies` is called). Read that function first for the exact "no job ever existed" query shape (it checks Job rows by dedup/group; adapt to the `viewbook-email:<id>` dedupKey). This closes the commit→enqueue gap so a stranded delivery is never permanently unsent.

### 2. Email templates (`lib/notify/viewbook-*-content.ts`)

Pure builders returning `EmailContent` (`{ subject, html, text }` from `lib/notify/content.ts`), no transport/env. Reuse `content.ts`'s `esc()` HTML-escape approach and the branded `shellHtml`/`buttonHtml` helpers (import or mirror — read `content.ts` + `lib/notify/viewbook-digest-content.ts` for the house style). One file per kind (or one `viewbook-email-content.ts` with three exports — match the digest file's granularity; the digest uses a single `viewbook-digest-content.ts`, so a single `viewbook-email-content.ts` with three builders is fine and preferred):
- `buildTeamInviteEmail({ viewbookTitle, inviteUrl, clientName })` → "You've been invited to {clientName}'s viewbook" + button to `inviteUrl`.
- `buildPcCompleteEmail({ viewbookTitle, viewbookUrl, clientName })` → CSM-facing "{clientName} finished their post-contract setup" + link.
- `buildStageChangeEmail({ stageLabel, viewbookTitle, viewbookUrl, clientName })` → "Your project has moved to {stageLabel}" + link (spec §8).

All three: HTML + text in lockstep; every dynamic string through `esc()`; no client-authored content beyond escaped names/labels. URLs built from `NEXT_PUBLIC_APP_URL` (mirror how notify-email builds `resultsUrl()`); if unset, the JOB no-ops before calling the builder (do the unset check in the handler, like notify-email). **team-invite and pc-complete builders ship now but their TRIGGERS are PR5** — this PR only wires the stage-change trigger (§4). Ship all three templates so PR5 has them ready.

### 3. Roster `isCsm` / `email` validator extension

`lib/viewbook/global-content-keys.ts` — extend `TeamMember`:
```ts
export interface TeamMember {
  name: string
  role: string
  photo: string | null
  blurb: string
  isCsm?: boolean   // optional — additive
  email?: string    // optional — additive, canonical mailbox
}
```
`lib/viewbook/global-content.ts` `validateTeam` (`:48-66`) — **relax the exact-key gate** (currently `if (Object.keys(m).length !== 4) return null`, `:54`) to allow the two optional keys:
- Accept 4–6 keys; every key must be one of the six known names (reject unknown keys — do NOT loosen to "≥4 anything").
- `isCsm`, when present, must be `typeof === 'boolean'` (else reject).
- `email`, when present, must pass the shared `canonicalMailbox(raw)` helper (§4 — defined in `global-content-keys.ts`): strict `local@domain`, no display names/commas/whitespace, `≤254`, stored **lowercased** (spec §8 abuse boundary). Reject when it returns null; store the canonicalized form. Absent `email` stays absent. (Read-as-strict-as-write: `getGlobalContent` runs the same validator, so a stored canonical email round-trips.)
- **Read stays exactly as strict as write** — `getGlobalContent` runs the same validator; a roster carrying the new fields must round-trip. Entries WITHOUT the new keys stay valid (additive).
- **Single-owner policy:** `putTeamRoster` (`:114-152`) already re-derives `photo` by name (ignores incoming). Apply the SAME policy consistently: decide whether `isCsm`/`email` are set through `putTeamRoster` (accepted from the validated input, since they're roster-intrinsic) — YES, accept them from the validated roster payload (they describe the member). Update the `putTeamRoster` write to persist the validated `isCsm`/`email` alongside name/role/blurb. `putTeamRoster` already adopts `syncVersionBumpAllWhere` (PR2 row 24) — keep that; no new bump needed for the roster write.
- The generic "Your team" block on WelcomeSection must **filter `isCsm` out** of the ordinary team grid (spec §5) — see §5 UI.

### 4. Stage-change delivery wired into `moveViewbookStage`

`lib/viewbook/service.ts` `moveViewbookStage` (`:250-280`) — the fenced array (`:267-272`) currently: `[syncVersionBumpStatement(id), viewbook.update(stage fence), viewbookStageLog.create(eventKey), ...appendActivityStatements(...)]`.

Add stage-change deliveries INSIDE this array on **forward** moves only (spec §8 — forward stage moves email; `direction === 'forward'`):

1. **Resolve recipients with the FINAL policy — no pragmatic fallback (Codex fix 1).** BEFORE the txn: read the viewbook's `clientNotifyJson` (add it to the `moveViewbookStage` pre-read). Parse (JSON array of strings; corrupt → `[]`). Build the **allowed set** = every stored `ViewbookTeamMember.email` for this viewbook ∪ the value of the designated **primary-contact-email** answer (resolved by `defKey` — see below). Keep a recipient ONLY if its canonicalized form is in the allowed set. Then **canonicalize + lowercase + dedupe** via a single shared helper. **Do NOT admit arbitrary canonical addresses** just because no members exist — an unmatched entry is dropped. Until PR5 seeds `clientNotifyJson` + the primary-contact field, the allowed set is empty ⇒ zero deliveries (the honest no-op).
   - **Shared mailbox normalizer:** put the `local@domain` canonicalizer (lowercase, trim, reject display-names/commas/whitespace, `≤254`) in ONE exported helper `canonicalMailbox(raw): string | null` in the **client-safe leaf** `lib/viewbook/global-content-keys.ts` (NOT `email.ts` — that module drags in the job queue, and the §3 roster validator must import the canonicalizer without that weight). Used by: the §3 roster `email` validator, the §4 allowed-set build + recipient filter, and **PR5 MUST reuse it** (do not clone). Note this in your handoff.
   - **Primary-contact defKey:** define `PRIMARY_CONTACT_EMAIL_DEFKEY = 'school-contact-email'` as an exported const, also in `lib/viewbook/global-content-keys.ts` (client-safe, co-located with the mailbox helper). Resolve the answer by joining the viewbook's active `ViewbookField` (defKey match) → its answer value. The field won't exist until PR5's pc-setup catalog entries, so the lookup returns nothing today — that's correct. **PR5 MUST import this const** (do not redefine the string). Flag this shared const in your handoff.
2. Splice `...stageChangeDeliveryStatements({ viewbookId: id, eventKey, recipients })` (deduped) into the array AFTER `viewbookStageLog.create`. On `direction === 'back'` or empty recipients → splice nothing.
3. AFTER commit: re-select the created delivery rows by their deterministic dedupKeys (`vb-stage:<eventKey>:<recipient>`) to get ids, then `enqueueViewbookEmail(id).catch(logError)` per row inside a try/catch so an enqueue failure never fails the (already-committed) move. The §1 `recoverViewbookEmailDeliveries` seam backstops any row whose enqueue is lost here.
4. **P2002/replay reasoning — corrected (Codex fix 2).** `eventKey = crypto.randomUUID()` is fresh EVERY call, so an HTTP replay CANNOT recreate the same delivery dedupKey — a true double-submit loses on the `expectedStage` fence (P2025 → 409 `stage_conflict`) FIRST, before any delivery insert. The only realistic P2002 on a delivery insert is **duplicate recipients within one batch** — which step 1's dedupe eliminates — or an astronomically unlikely UUID collision. Do NOT describe replay as "P2002 rolls back". Do NOT add a bump for deliveries (the `syncVersionBumpStatement(id)` at index 0 already covers the move — one bump, not two).

Tests:
- Forward move with a populated allowed set (seed `ViewbookTeamMember` rows whose emails are also in `clientNotifyJson`, set directly in the test) creates one delivery per recipient (`kind:'stage-change'`, correct dedupKey, `sentAt`/`suppressedAt` null). Invoking the enqueued handler with a stubbed `sendEmail` stamps `sentAt`; a dark-env run stamps `suppressedAt`.
- `clientNotifyJson` containing an address NOT in the allowed set → that entry is dropped (not delivered).
- **Recipient dedupe:** `clientNotifyJson` with the same mailbox twice (different case) → ONE delivery row, no P2002.
- **Stage-fence replay** (stale `expectedStage`) → 409 `stage_conflict`, zero delivery rows created (assert no double rows).
- Forward move with empty `clientNotifyJson` → zero deliveries. A `back` move → zero deliveries.

### 5. CSM assignment + featured card + admin picker

**Assignment (service + route):** `lib/viewbook/service.ts` gains `assignViewbookCsm(id: number, csmName: string | null, actor: string)`:
- Validate `csmName`: `null` clears it; a non-null value must match the `name` of a CURRENT roster member flagged `isCsm: true` (load the global `'team'` roster via `getGlobalContent('team')`, filter `isCsm`, check membership) — else `HttpError(400, 'invalid_csm')`.
- **Fence the bump, the update, AND the activity on ONE shared pre-state predicate (Codex fix 5).** Do NOT pair a predicated bump/updateMany with an UNCONDITIONAL `appendActivityStatements` — that would append an activity row even when the domain update matched zero rows (unknown id, archived client, or a same-value no-op). Instead:
  1. Pre-read the viewbook (`findUnique` join to Client) → 404 unknown id; 409 `client_archived` on an archived client; and treat `csmName === current csmName` as a **no-op** (return without a write — no bump, no activity).
  2. For the real write, use a single self-contained EXISTS predicate `P` = "viewbook `id` exists AND client not archived AND `csmName` IS DISTINCT FROM the target value" and build an array-form txn where ALL THREE statements carry `P`: `syncVersionBumpWhere(id, P)`, a `prisma.$executeRaw` `UPDATE "Viewbook" SET "csmName" = ?, "updatedAt" = ? WHERE (P)`, and a conditional activity `INSERT … SELECT … WHERE (P)` (mirror how the raw guarded-insert activity paths are written). A lost pre-state race then bumps nothing, writes nothing, and logs nothing — all-or-none.
- Route: `PATCH /api/viewbooks/[id]/csm` `{ csmName: string | null }`, cookie-gated (`requireOperatorEmail`), withRoute + parseId + requireJsonObject, 409 `client_archived` on an archived client (repo policy), 400 `invalid_csm`, 404 unknown id. Mirror `app/api/viewbooks/[id]/lock/route.ts` shell.
- Tests: valid flagged member → set + **syncVersion +1** (relative delta) + one `csm-assigned` activity row; non-flagged/absent name → `invalid_csm` + **+0** + no activity; archived client → 409 + **+0**; unknown id → 404 + **+0**; **same-value replay → +0** + no activity; a simulated lost pre-state race (predicate false at write time) → **+0**, no activity, no csmName change.

**Featured CSM card (`components/viewbook/public/WelcomeSection.tsx`):**
- The public payload ALREADY carries `data.csmName` (`public-data.ts:93`, `public-types.ts:98`) — no payload change needed. The CSM's role/photo/email come from the roster entry whose `name === data.csmName` and `isCsm === true` (read from `data.global.team`).
- Render a featured "Your ER contact" card ABOVE the ordinary team grid when `data.csmName` resolves to a flagged roster member: photo (via `publicAssetUrl`), name, role, and a `mailto:` when `email` is present. **Graceful degradation (spec §5):** a dangling `csmName` (member renamed/removed) or unavailable roster → hide the featured card (do not error); the ordinary grid still renders.
- **Filter `isCsm` members OUT of the ordinary "Your team" grid** (spec §5) so a CSM isn't shown twice.
- Escape all dynamic strings (names/roles/emails) — they're already plain text, but keep the render escaping consistent with the existing grid.

**Roster editor fields — the CSM producer (Codex fix 6).** `components/viewbook/admin/GlobalContentEditor.tsx` currently exposes only name/role/blurb/photo per roster member. Without an `email` input and an `isCsm` checkbox there is NO way to flag a CSM or give one a mailbox, so the picker + featured card would be inert. ADD both controls to each roster-member row (they flow through the existing `putTeamRoster` save, whose `syncVersionBumpAllWhere` already covers the write — NOT a new write path). Persist them via the §3-extended validator (email canonicalized by the shared `canonicalMailbox` helper before send; invalid email surfaces the editor's existing error affordance). Match the surrounding admin styling (dark-mode variants).

**Admin CSM picker:** a small control in the admin editor (the Settings or Content tab where team/theme are managed — read `components/viewbook/admin/` to place it beside related controls). A `<select>` of current `isCsm`-flagged roster members (+ an "unassigned" option) that PATCHes `/api/viewbooks/[id]/csm`. Follow the surrounding admin component styling (dark-mode variants, button classes) and the existing admin mutation → `requestRefresh()`/reload pattern. Adopt `useEditorActivity` if it holds a draft (mirror sibling admin controls).

## Tests (write with the code, per unit)

- `lib/jobs/handlers/viewbook-email.test.ts` — dark-env → `suppressedAt` set, `sentAt` null, no send; happy path → `sendEmail` called once, `sentAt` stamped; already-terminal row → no-op; missing row → no-op; send throws → row unchanged (retryable); stub `sendEmail` via injected deps.
- `lib/viewbook/email.test.ts` — `stageChangeDeliveryStatements` returns `[]` for empty recipients and N `.create` statements otherwise with correct dedupKeys; `enqueueViewbookEmail` enqueues with the right type/dedupKey/no group (spy on `enqueueJob`).
- `lib/notify/viewbook-email-content.test.ts` — each builder: subject/body present, URL present. **Escaping contract (Codex fix 8):** a hostile `clientName` `<img src=x>` must appear HTML-**escaped** in the `html` body (contains `&lt;img`, does NOT contain the raw `<img`) but as **literal inert text** in the `text` body (contains the raw `<img src=x>`, NOT HTML entities — plaintext email is not HTML and must not be entity-encoded). Do NOT assert "escaped in both" — that tests the wrong contract for the text part.
- `lib/viewbook/global-content.test.ts` (extend) — roster with `isCsm`/`email` round-trips (write → read equal); unknown extra key rejected; malformed `email` rejected; `email` lowercased; entry without new keys still valid; `putTeamRoster` persists `isCsm`/`email`.
- `lib/viewbook/service.test.ts` (extend) — `assignViewbookCsm`: valid flagged member → set + **syncVersion +1** (relative delta); non-flagged/absent name → `invalid_csm` + **+0**; null clears + bump; unknown id → 404 + +0. `moveViewbookStage` forward with recipients → deliveries created + **move still bumps once** (relative +1, not +2 — deliveries don't add a bump); forward empty → zero deliveries; back → zero deliveries.
- Route tests (mirror the admin route harness style, real signed cookies): `PATCH /api/viewbooks/[id]/csm` happy/401/404/400/409-archived.
- UI tests: WelcomeSection featured CSM card renders for a flagged member, hides on dangling `csmName`, filters the CSM out of the grid; admin picker PATCHes and surfaces errors.

## Out of scope (do NOT touch)

Contrast/theme/ws-intro/tester/BrandSection/`stages.ts`/public `page.tsx` (PR6, the concurrent lane) · team-member add / ack / setup public routes + their triggers (PR5) · `clientNotifyJson` WRITE path (PR5's setup route) — PR3 only READS it · image/webp pipeline (PR7) · ER inline layer (PR8) · `middleware.ts` · prisma schema (all tables exist from PR1's migration).

## Definition of done

Every unit above implemented with tests; work left UNCOMMITTED in the worktree; a short handoff summary written to `.superpowers/sdd/pr3-codex-handoff.md` (what you built, deviations, test counts, any decisions on the recipient-validation policy). Claude then runs the FULL gates (`npx tsc --noEmit`, `npm run lint`, `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`), verifies the sync-bump merge gate (CSM assignment bumps; deliveries don't double-bump; relative-delta tests present), cross-reviews the branch, and commits.
