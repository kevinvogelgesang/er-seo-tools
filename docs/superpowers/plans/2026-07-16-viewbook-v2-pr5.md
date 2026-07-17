# Viewbook v2 PR5 — Post-Contract Stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the post-contract stage end-to-end: the `pc-intro`/`pc-setup`/`pc-invite`/`pc-thanks` sections, the `ViewbookTeamMember` invite flow, section acknowledgment + post-contract completion (`pcCompletedAt`) with the `pc-complete` email, the `team-invite` email, the three new public routes (ack / team-members / setup) + anchored matchers, the ack-to-stage forward fence (`force`), the creation default flip to `post-contract`, and the admin stage-move buttons deferred from PR1.

**Architecture:** The post-contract stage is the FIRST stage a new viewbook enters. `pc-intro` is a code-owned welcome hero; `pc-setup` renders the designated org-basics fields (school name / contact name / contact email / phone / website) — written through the EXISTING answers PATCH — plus a `setup` route that persists `clientNotifyJson` (who gets stage-change mail); `pc-invite` manages a stored team list with capped invite emails; `data-source` is the existing Q&A; `pc-thanks` reveals once `pcCompletedAt` is stamped. The three ackable sections (`pc-setup`, `pc-invite`, `data-source`) each get a client ack action (public, fenced, idempotent); the ack that satisfies "every non-hidden ackable section is acknowledged" stamps `Viewbook.pcCompletedAt` (first-writer-wins) and creates the `pc-complete` delivery. Advancing forward OUT of `post-contract` requires `pcCompletedAt` (or `force`, which stamps it + creates the delivery). All new rendered-data mutations adopt PR2's sync-bump factories inside their fenced array txns.

**Tech Stack:** Next.js 15 App Router, TypeScript, React (client islands for ack/invite/setup + admin controls), Prisma + SQLite (array-form `$transaction` only), vitest + @testing-library/react (jsdom). Reuses PR3's `lib/viewbook/email.ts` delivery machinery and `lib/notify/viewbook-email-content.ts` templates.

## Global Constraints

- **NO Prisma migration.** Every column and table PR5 needs already landed in migration `20260716212619_viewbook_v2_stages`: `Viewbook.{stage,syncVersion,csmName,clientNotifyJson,pcCompletedAt}`, `ViewbookSection.acknowledgedAt`, and the `ViewbookTeamMember` / `ViewbookStageLog` / `ViewbookEmailDelivery` tables. PR5 is route/logic/UI-only. Do NOT add a migration; do NOT edit `prisma/schema.prisma`.
- **Array-form `$transaction([...])` ONLY** — never the interactive `async (tx) => {}` form (SQLite write-lock starvation, a documented prod incident). Express conditional logic in SQL (`EXISTS`/`NOT EXISTS` predicates + `INSERT … SELECT … WHERE`); set `updatedAt`/timestamps manually as integer ms `Date.now()` in raw statements (`@updatedAt`/`@default(now())` do NOT fire on `$executeRaw`). **Array-form txns cannot consume a prior statement's autoincrement id** — downstream delivery rows key off the app-generated `ViewbookTeamMember.memberKey` UUID, never the `Int` id; leave `ViewbookEmailDelivery.memberId` null and correlate by `dedupKey`.
- **Sync-bump merge gate — NOT vacuous (unlike PR6).** Every NEW rendered-data mutation (ack write, team-member add, `clientNotifyJson` write, `pcCompletedAt` stamp on ack, force-advance stamp, ack-reset) MUST adopt `syncVersionBumpStatement()`/`syncVersionBumpWhere()` from `lib/viewbook/sync.ts` inside the SAME fenced array txn, carrying the SAME pre-state predicate as the domain write, placed FIRST in the array. Add **relative-delta** bump/no-bump tests: a 0-row fenced write and a `clientMutationId`/idempotent replay bump NOTHING (assert `syncVersion` delta, never absolute counts — `bumpAll` sweeps flake absolute counts across the shared test DB). Org-basics answers go through the EXISTING answers PATCH (already bump-adopting) — do NOT add a second write path for them. A pure `pc-complete`/`team-invite` DELIVERY row is NOT rendered data and adds no extra bump beyond the mutation that creates it.
- **Public surface is LIGHT-ONLY.** `ViewbookShell`/`SectionShell` use NO `dark:` variants (their header comments state this — spec §6). pc-* section components + their public client islands MUST NOT use `dark:` variants. ADMIN components (`components/viewbook/admin/**`) DO use `dark:` — the stage-move buttons in Task 6 follow the admin convention.
- **No jest-dom.** setupFiles is only `./test/setup-worker.ts`. Component tests use DOM-native assertions (`toBeTruthy`, `.textContent`, `querySelector`, `.not.toBeNull`) — never `toBeInTheDocument`/`toHaveTextContent`.
- **Public-write route contract (copy verbatim, order load-bearing):** `requireSameSite(request)` → `requireJsonContentType(request)` → resolve `token` → `requireViewbookToken(token)` (preflight, returns the `Viewbook` row) → `checkWriteThrottle(token)` → `parseInput(await readBoundedJson(request, BODY_CAP_BYTES))` → transactional core → `NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })`, `withRoute`-wrapped, `export const dynamic = 'force-dynamic'`. Preflight is NOT the fence — every mutation re-verifies the full access chain in SQL (token current + `revokedAt IS NULL` + `Client.archivedAt IS NULL` + section not hidden + ownership + caps) at commit time. Template = `app/api/viewbook/[token]/feedback/route.ts` (single `withRoute` wrap) unless a 409-conflict body branch is needed (then the answers-route double-wrap that re-forces `no-store`).
- Plain text everywhere on the public surface; escape at render; no `dangerouslySetInnerHTML`. Email bodies are the fixed PR3 templates (every dynamic value already `esc()`-escaped).
- Gates before merge: `npx tsc --noEmit` (== `npm run lint`), `DATABASE_URL="file:./local-dev.db" npm test`, `npm run build`. Work in worktree branch `feat/viewbook-v2-pr5`; sequence vitest runs (never two suites concurrently in one worktree — shared `.test-dbs/`).

## Scope reality check (grounded in merged main @ 9dd3a30)

- **Schema is fully ahead** (see Global Constraints) — confirmed at `prisma/schema.prisma` `Viewbook` (:862-894), `ViewbookSection.acknowledgedAt` (:905), `ViewbookTeamMember` (:1032-1044, carries `memberKey @unique`, `clientMutationId String? @unique`, `@@unique([viewbookId,email])`), `ViewbookEmailDelivery` (:1058-1072, `memberId Int?`, `dedupKey @unique`), `ViewbookStageLog` (:1046-1056, `eventKey @unique`).
- **pc-* keys are DORMANT.** All 13 keys are in `SECTION_KEYS` (`theme.ts:8-22`), all have `SECTION_TITLES` (`section-titles.ts` — `pc-intro:'Welcome'`, `pc-setup:'Set Up Your Viewbook'`, `pc-invite:'Invite Your Team'`, `pc-thanks:'Thank You'`), and all get `ViewbookSection` rows at creation (`service.ts:61-66`). But `STAGE_LINEUPS['post-contract']` is `{ primary: ['data-source'], carried: [] }` (`stages.ts:37-48`) — the four pc-* keys are in NO lineup, have NO component, and hit `default: return null` in `page.tsx`'s `renderSection`. PR5 activates them.
- **`acknowledgedAt` has NO write path.** Read-only today: serialized in `public-data.ts:72`, typed in `public-types.ts:15`. No route/service writes it.
- **`pcCompletedAt` has NO logic.** Only referenced in the `moveViewbookStage` comment (`service.ts:253`) reserving PR5's forward-fence + force.
- **`clientNotifyJson` is READ-only** (consumed by `moveViewbookStage`'s recipient resolver, `service.ts:262-297`). PR5 adds its WRITE (setup route).
- **PR3 shipped the delivery machinery dormant-until-PR5:** `lib/viewbook/email.ts` (`enqueueViewbookEmail`, `stageChangeDeliveryStatements`, `recoverViewbookEmailDeliveries`, `RECOVERY_LIMIT=200`), the `viewbook-email` job handler (all three `kind`s dispatched), and `lib/notify/viewbook-email-content.ts` (`buildTeamInviteEmail`/`buildPcCompleteEmail`/`buildStageChangeEmail`). Only the `stage-change` trigger is wired. PR5 wires the `team-invite` + `pc-complete` triggers.
- **Shared constants (import, never redefine):** `PRIMARY_CONTACT_EMAIL_DEFKEY = 'school-contact-email'` and `canonicalMailbox(raw)` live in `lib/viewbook/global-content-keys.ts`. The stage-change recipient resolver already reads both.
- **No phone / website-url catalog entry exists.** Catalog `'school'` defKeys today (`catalog.ts`): `school-name`, `school-contact-name`, `school-contact-email`, `school-services`, `school-ad-name`.
- **`PublicField` exposes NO `defKey`** (`public-types.ts:27-38`) — only a derived `isCustom`. `loadFieldCategories` (`public-data.ts:112-145`) computes `isCustom: r.defKey == null` but drops `defKey`. This is the "Codex fix 11" gap pc-setup + header display-name need.
- **Admin move buttons confirmed absent** (grep-verified). Read-only stage displays: `ViewbookEditor` SettingsTab "Project stage" line (`ViewbookEditor.tsx:165-169`, with a `run(label, fn, onSuccess?)` mutation helper at :144-158) and `ViewbookIndex` chip (`ViewbookIndex.tsx:138-142`). `pcCompletedAt` is NOT in `ViewbookDetail`/`ViewbookListRow` (`viewbook-admin-shared.ts`).
- **Reuse patterns:** admin mutation via `jsonFetch` (`viewbook-admin-shared.ts:13-18`) + optimistic/busy/error + `onChanged()`→`load()` (`CsmPicker.assign`, `GlobalContentEditor.tsx:231-249`); public stage caller `KickoffNextButton.tsx:15-22`. Timestamp-flip-via-`updateMany` inside an array txn: `lockViewbook` (`answers.ts:340-370`). CSM-assign fenced pattern: `assignViewbookCsm` (`service.ts:335-384`).

## Final target lineups (spec §4 — PR5 activates these)

| Stage | Primary | Carried |
|---|---|---|
| `post-contract` | `pc-intro, pc-setup, pc-invite, data-source, pc-thanks` | — |
| `kickoff` | welcome, milestones, strategy, kickoff-next | `pc-setup, pc-invite`, data-source |
| `website-specifics` | ws-intro, brand, assessment | welcome, milestones, strategy, `pc-setup, pc-invite`, data-source |
| `building` | welcome, milestones, data-source, brand, assessment, strategy, materials | `pc-setup, pc-invite` |

`pc-intro`, `pc-thanks` are stage-scoped (post-contract only, never carried). `pc-thanks` renders only when `pcCompletedAt` is set. The bold cells are PR5's additions to the current lineups (current: post-contract primary `['data-source']`; kickoff carried `['data-source']`; website-specifics carried `['welcome','milestones','strategy','data-source']`; building carried `[]`).

---

### Task 1: Data & pure scaffolding (catalog, PC def-keys, defKey exposure, display-name, admin types)

**Files:**
- Modify: `lib/viewbook/catalog.ts` (+ `catalog.test.ts` if present) — add two `'school'` entries: `{ defKey: 'school-phone', category: 'school', label: 'Main phone number', fieldType: 'text', sortOrder: <after school-contact-email> }` and `{ defKey: 'school-website', category: 'school', label: 'Website URL', fieldType: 'text', sortOrder: <next> }`. Additive only — never renumber/rename existing defKeys; pick sortOrder values that slot them among the school basics (e.g. between `school-contact-email` and `school-services`; if that forces a renumber, append at the end of `'school'` instead — do NOT touch other categories).
- Modify: `lib/viewbook/stages.ts` — add `export const PC_SETUP_DEF_KEYS = ['school-name','school-contact-name','school-contact-email','school-phone','school-website'] as const` (the designated org-basics fields pc-setup renders, in display order). Keep it a client-safe pure const.
- Modify: `lib/viewbook/public-types.ts` — add `defKey: string | null` to `PublicField`; add to `ViewbookPublicData`: `pcCompletedAt: string | null`, `clientNotifyJson: string[]` (parsed array — the setup UI + who-gets-notified display), and `teamMembers: { memberKey: string; name: string; email: string; invited: boolean }[]` (bounded, ordered by `id`). **`invited` is existence-only, NOT send status (Codex fix 7):** it is `true` when ≥1 `team-invite` delivery row exists for the member — do NOT surface `sentAt`/`suppressedAt`, because rendering the send state would make the email job handler's `sentAt`/`suppressedAt` marker writes into rendered-data mutations that would then have to bump `syncVersion` (they don't, and shouldn't — PR3's handler is untouched). The UI labels it **"Invite requested"**, never "Sent".
- Modify: `lib/viewbook/public-data.ts` — (a) forward `defKey: r.defKey` in `loadFieldCategories` (:112-145; row already selected; keep `isCustom: r.defKey == null`); (b) add `pcCompletedAt` + parsed `clientNotifyJson` to the payload (core load, not fault-isolated — they gate rendering); (c) load `teamMembers` (bounded, fault-isolated block — a failure degrades to `[]`) with the `invited` boolean via an existence check against `ViewbookEmailDelivery` (`kind='team-invite'`, `memberId` is null so match by `dedupKey LIKE 'vb-invite:'||memberKey||':%'`); (d) **`pc-thanks` nav-exclusion (Codex fix 10):** in the `pick(lineup.primary)` step, drop `pc-thanks` from `primarySections` when `pcCompletedAt` is null (a component-only null gate leaves a dead ProgressNav dot). Also expose the `school-name` answer value (or a derived `displayName` — see next) so the header can render it.
- Create: `lib/viewbook/display-name.ts` (+ test) — pure `viewbookDisplayName({ schoolNameValue, clientName }): string` returning trimmed `schoolNameValue` when non-empty else `clientName` (spec §7). **Actually WIRE it (Codex fix 10):** compute `displayName` in `public-data.ts` from the `school-name` field value + `client.name`, add `displayName: string` to `ViewbookPublicData`, and render it in the header (`ViewbookShell`/`ProgressNav` — the header client-name display). Creating the helper without using it is a no-op.
- Global-content `pc-intro` key (Codex fix 10 — spec §7: "global-content editable copy, new key `pc-intro`"): extend `lib/viewbook/global-content-keys.ts` + `lib/viewbook/global-content.ts` `validate*`/key-dispatch to recognize a new global text key `pc-intro` (a single bounded string; read-as-strict-as-write; absent → null, additive), surface it in `data.global`, and add an input to `components/viewbook/admin/GlobalContentEditor.tsx` (admin `dark:` styling). `PcIntroSection` renders `data.global.pcIntro` with a code-owned fallback when unset. Read the existing `'team'` key dispatch to mirror the pattern. (This is a shared/global surface — one edit reaches all viewbooks; the global-content save already adopts `syncVersionBumpAllWhere`, so no new bump path.)
- Modify: `components/viewbook/admin/viewbook-admin-shared.ts` — add `pcCompletedAt: string | null` to `ViewbookDetail` and `ViewbookListRow`. Verify the server side (`GET /api/viewbooks/[id]` detail + `listViewbooks`) returns `pcCompletedAt` — add the `select`/serialization if missing, so the types aren't lying.

**Interfaces:** pure/data + read-path + one global-content key. The global-content `pc-intro` write rides the existing global-content save's `syncVersionBumpAllWhere` (no new bump path); everything else here is read-only.

- [ ] **Step 1: Write failing tests** — catalog: two new `'school'` defKeys exist, existing five byte-pinned unchanged. `PC_SETUP_DEF_KEYS` == the 5-key tuple + every member resolves in `CATALOG`. `display-name`: value wins trimmed/non-empty, clientName fallback on null/empty/whitespace. `public-data`: `loadFieldCategories` emits `defKey` (seeded field serializes it; custom → `defKey:null`,`isCustom:true`); payload carries `pcCompletedAt`, parsed `clientNotifyJson`, `teamMembers` with `invited` existence-only; `pc-thanks` absent from `primarySections` when `pcCompletedAt` null, present when set; `displayName` derived from school-name else client name. global-content: `pc-intro` round-trips (write→read), absent → null, additive.
- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement** the edits above. Confirm `defKey` + the new `ViewbookPublicData` fields type-check against every constructor (grep object literals / test + preview fixtures — add the new fields there).
- [ ] **Step 4: Green** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook components/viewbook` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(viewbook): pc-setup catalog+defkeys, defKey/team/pcCompletedAt payload, display-name, pc-intro global key`

**Note for later tasks:** existing viewbooks receive the two new catalog fields via the operator-triggered sync-questions path (`syncCatalogQuestions`, `service.ts:481-517` — per-row bump+create, skips existing defKeys, P2002-tolerant). New viewbooks get them at creation via `CATALOG.map(...)`. PR5 does NOT auto-backfill; document this in the handoff (operator hits "sync questions" on legacy viewbooks so pc-setup shows phone/website).

---

### Task 2: Ack + completion core (`lib/viewbook/ack.ts`) + `pc-complete` delivery

**Files:**
- Create: `lib/viewbook/ack.ts` + `lib/viewbook/ack.test.ts`
- Modify: the existing section-state hide path — `lib/viewbook/service.ts` `setSectionState` (or wherever `app/api/viewbooks/[id]/sections/[sectionKey]` PATCH resolves hide/show) — to run the shared `buildPcCompletion` (no `acknowledgedAt=${now}` gate) when hiding, so hiding the last unacked ackable section completes (Codex fix 3). Do NOT add a second bump — the hide already bumps.
- Modify: `lib/viewbook/email.ts` — add `pcCompleteDeliveryInsert({ viewbookId, recipient, predicate }): Prisma.Sql-backed $executeRaw` — a **raw, conflict-safe** `INSERT INTO "ViewbookEmailDelivery" (...) SELECT ${viewbookId},'pc-complete',${recipient},${'vb-pc-complete:'+viewbookId},NULL,NULL,${now} WHERE (${predicate}) ON CONFLICT("dedupKey") DO NOTHING`. **NOT a Prisma `.create`** (Codex fix 9 — the `.create` builder cannot express `ON CONFLICT DO NOTHING`, and BOTH the ack-completion path (Task 2) and the force-advance path (Task 6) need conflict-safety on the unique `vb-pc-complete:<viewbookId>` dedupKey). Both callers reuse this ONE builder. Export `resolvePcCompleteRecipient(viewbookId): Promise<string>` — recipient = the assigned CSM's roster email (`getGlobalContent('team')` → member with `isCsm===true && name===viewbook.csmName`, `canonicalMailbox(member.email)`) `?? notifyAdminEmail()` (`lib/notify/config.ts`); resolve BEFORE the txn (bind the value in).

**Interfaces (`ack.ts`):**
- `ACKABLE_SECTION_KEYS = ['pc-setup','pc-invite','data-source'] as const` (exported).
- `acknowledgeSection(viewbook: Viewbook, token: string, input: { sectionKey: string; clientMutationId: string }, hooks?: MutationHooks): Promise<{ acknowledged: PublicSection-ish; pcCompleted: boolean; replayed: boolean }>` — the PUBLIC ack write.
- `resetSectionAck(viewbookId: number, sectionKey: string, actor: string): Promise<void>` — the OPERATOR ack-reset (clears `acknowledgedAt`, appends activity; does NOT clear `pcCompletedAt`).

**Ack write mechanics (array-form, fence-shared) — statement ORDER is load-bearing (Codex fixes 1–2):**
1. `sectionKey` must be in `ACKABLE_SECTION_KEYS` (else `HttpError(400,'invalid_section')`). `clientMutationId` via `validateClientMutationId` (400 if missing/malformed).
2. Shared ack predicate `P` (self-contained EXISTS — the FULL access chain, NOT a bare `{viewbookId,sectionKey,acknowledgedAt:null}` builder-where): viewbook `id`+`token` current, `revokedAt IS NULL`, `Client.archivedAt IS NULL`, the target `ViewbookSection` exists with this `sectionKey`, `state <> 'hidden'`, AND `acknowledgedAt IS NULL` (re-ack is the idempotent no-op — 0 rows, no activity, no bump). Express the ack UPDATE as raw SQL fenced by `P` (or a Prisma-builder `updateMany` whose where re-inlines the full chain via a correlated EXISTS) — do NOT fence it on section columns alone (a revoked/archived viewbook must not ack). No `clientMutationId` column exists on `ViewbookSection`; idempotency IS the `acknowledgedAt IS NULL` gate (return `replayed:true` when already acked). Accept `clientMutationId` for client-side consistency.
3. Array statements, IN THIS ORDER: `[ syncVersionBumpWhere(id, P), <activity INSERT … SELECT 'section-ack','client','Acknowledged: <sectionKey>' … WHERE P>, <ack UPDATE "ViewbookSection" SET acknowledgedAt=${now}, updatedAt=${now} WHERE (P re-expressed for the section row)>, <pc-complete delivery INSERT … WHERE (C) ON CONFLICT DO NOTHING>, <pcCompletedAt UPDATE … WHERE (C)> ]`. Destructure the counts; ack success = the ack-update count === 1 && activity count === 1.
4. **Completion predicate `C` and ORDER (Codex fixes 1–2):** `C` = viewbook `id` AND `stage='post-contract'` AND `pcCompletedAt IS NULL` AND **the target section's `acknowledgedAt = ${now}` (proves THIS txn stamped it — so a no-op re-ack can never trigger completion)** AND `NOT EXISTS (ackable non-hidden section of this viewbook with acknowledgedAt IS NULL)`. Because SQLite executes array statements sequentially in one txn, the ack UPDATE (statement 3) is visible to `C`. **The delivery INSERT (statement 4) must run BEFORE the `pcCompletedAt` stamp (statement 5)** — if the stamp ran first, `pcCompletedAt IS NULL` inside `C` would already be false and the delivery would never be created (Codex fix 1). The delivery uses `pcCompleteDeliveryInsert` (raw, `ON CONFLICT("dedupKey") DO NOTHING`). Because `pcCompletedAt IS NULL ∧ acknowledgedAt=${now}` gate both statements and SQLite serializes writers, exactly ONE concurrent last-ack completes; `ON CONFLICT` is the backstop (never rolls the array back). **Completion winner = the `pcCompletedAt` UPDATE affected-row count** (== 1 for the completer, 0 otherwise).
5. **Do NOT add a second sync bump for completion** — index-0 `syncVersionBumpWhere(id,P)` already bumps (one bump per successful ack, incl. the completing one; the pc-thanks reveal rides that same refresh).
6. AFTER commit: if the `pcCompletedAt` count was 1, re-select the `vb-pc-complete:<id>` delivery by dedupKey → `void enqueueViewbookEmail(id).catch(logError)`. `recoverViewbookEmailDeliveries` backstops a lost enqueue.
7. On ack-update count 0: replay/no-op diagnosis — re-preflight `requireViewbookToken` (404 oracle); already-acked → `{ replayed:true }` (200); else diagnose (hidden → 404, unknown ackable → 400).

**Completion-on-hide (Codex fix 3 — real gap).** Hiding the last unacknowledged ackable section makes `C` true WITHOUT another ack. The operator hide path (`PATCH /api/viewbooks/[id]/sections/[sectionKey]` → the section-state service) MUST run the SAME first-winner completion (delivery INSERT `WHERE C` → `pcCompletedAt` UPDATE `WHERE C`, same `ON CONFLICT`, same post-commit enqueue) — with `C` here NOT requiring `acknowledgedAt=${now}` (no ack happened) but still requiring `stage='post-contract' ∧ pcCompletedAt IS NULL ∧ NOT EXISTS(non-hidden ackable unacked)`. **Factor the completion statements + recipient resolution into ONE shared helper** (`buildPcCompletion({ viewbookId, recipient, extraGate? })` returning the ordered `[deliveryInsert, pcCompletedAtUpdate]` statements + a post-commit `enqueueIfCompleted`), reused by: ack (Task 2, with the `acknowledgedAt=${now}` extra gate), the hide path (this task, no extra gate), and force-advance (Task 6, gated on `stage=expectedStage` — see Task 6 for its distinct ordering). The section-state service is an existing cookie-gated route; extend its hide branch here in Task 2 (or note it as owned by Task 6 if that reads cleaner — but it MUST land in PR5). Add a DB test: hiding the last unacked section completes + creates exactly one delivery.

**Ack-reset mechanics (`resetSectionAck`, operator):** array `[ syncVersionBumpWhere(id, R), <activity INSERT 'section-ack-reset', actor WHERE R>, UPDATE "ViewbookSection" SET acknowledgedAt=NULL, updatedAt=${now} WHERE viewbookId=id AND sectionKey=? AND acknowledgedAt IS NOT NULL ]` where `R` fences on the section currently having a non-null `acknowledgedAt` (no-op if already clear). **Never clears `pcCompletedAt`** (thank-you state is one-way, spec §4).

- [ ] **Step 1: Write failing tests** (`ack.test.ts`, DB-backed — follow the `public-writes.test.ts` fixture style):
  - single ack stamps `acknowledgedAt` + one `section-ack` activity + `syncVersion +1` (relative); re-ack → `+0`, no activity, `replayed:true`.
  - non-ackable sectionKey → 400; hidden ackable section → 404/no-op (per contract); acking after `revokedAt`/archived client → 404.
  - **last-ack completion:** acking the final required section (others already acked, none hidden) stamps `pcCompletedAt` once + creates exactly one `vb-pc-complete:<id>` delivery (`sentAt`/`suppressedAt` null); invoking the enqueued handler with a stubbed `sendEmail` stamps `sentAt`; dark-env → `suppressedAt`.
  - **hidden shrinks the required set (Codex fix 4):** with `pc-invite` hidden, acking `pc-setup`+`data-source` completes (hidden excluded from the predicate).
  - **concurrent last-ack:** two different final sections acked in parallel → exactly one `pcCompletedAt` winner + exactly one delivery row (assert count==1).
  - completion recipient = flagged CSM's email when assigned; falls back to `notifyAdminEmail()` when no CSM/roster.
  - **no-op re-ack does NOT complete (Codex fix 2):** with all-but-one already acked and `pcCompletedAt` null, re-acking an ALREADY-acked section (not the missing one) → `+0`, no `pcCompletedAt`, no delivery (the `acknowledgedAt=${now}` gate in `C` blocks it).
  - **completion-on-hide (Codex fix 3):** with one ackable section still unacked, hiding THAT section (operator section-state PATCH) stamps `pcCompletedAt` once + creates exactly one `vb-pc-complete:<id>` delivery; hiding when already complete → no duplicate delivery (`ON CONFLICT`).
  - `resetSectionAck` clears `acknowledgedAt` + activity + `+1`; re-reset → `+0`; does NOT clear `pcCompletedAt`.
- [ ] **Step 2: Verify failures.**
- [ ] **Step 3: Implement** `ack.ts` + the `email.ts` `pcCompleteDeliveryStatement` helper.
- [ ] **Step 4: Green** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook/ack.test.ts lib/viewbook/email.test.ts` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(viewbook): section ack + post-contract completion + pc-complete delivery`

---

### Task 3: Team-member invite core (`lib/viewbook/team-members.ts`) + `team-invite` delivery

**Files:**
- Create: `lib/viewbook/team-members.ts` + `team-members.test.ts`
- Modify: `lib/viewbook/email.ts` — add `teamInviteDeliveryStatement({ viewbookId, memberKey, ordinal, recipient })` (single `.create` PrismaPromise, `kind:'team-invite'`, `dedupKey: vb-invite:<memberKey>:<ordinal>`, `memberId:null`, `stageLogId:null`). NOTE the delivery INSERT for add/resend is done as raw `INSERT … SELECT … WHERE <caps predicate>` (the ordinal + cap must be computed in SQL, so the raw form — not the `.create` builder — is used inside the fenced core; the `teamInviteDeliveryStatement` builder is the simple case for tests / any non-cap path). Prefer raw guarded INSERTs in the core; keep the builder for symmetry + unit tests.

**Interfaces (`team-members.ts`):**
- `addTeamMember(viewbook, token, input: { name; email; clientMutationId }, hooks?): Promise<{ member; replayed; delivered: boolean }>` — PUBLIC.
- `resendInvite(viewbook, token, input: { memberId: number; clientMutationId }, hooks?): Promise<{ delivered: boolean; replayed: boolean }>` — PUBLIC (body-dispatched from the same route).

**Caps + mechanics (all in guarded SQL — never count-then-create, spec §8):**
- `name`: non-empty, `≤120` bytes. `email`: MUST pass `canonicalMailbox` (single canonical mailbox, lowercased) else `400 invalid_email`. `clientMutationId` via `validateClientMutationId`.
- `memberKey = crypto.randomUUID()` generated BEFORE the txn (delivery dedupKey references it).
- **Add is member-AND-invite-atomic (Codex fix 5).** Spec §8 is "add → invite email sent" — a capped-out invite must NOT leave an orphan member with no invite. Put the 24h invite cap in the SHARED add predicate so a blocked request creates NEITHER row. Array: `[ syncVersionBumpWhere(id, A), <activity INSERT 'team-invite-add','client' WHERE A>, <member INSERT … SELECT … WHERE A ON CONFLICT("clientMutationId") DO NOTHING>, <invite-delivery INSERT … SELECT 'vb-invite:'||<memberKey>||':1' … WHERE A2> ]` where:
  - `A` = access chain (token current, not revoked, client active) AND `NOT EXISTS(clientMutationId replay)` AND `(SELECT COUNT(*) FROM ViewbookTeamMember WHERE viewbookId=id) < 15` AND `NOT EXISTS(ViewbookTeamMember WHERE viewbookId=id AND email=<canonical>)` (duplicate-email guard — cleaner than a `@@unique([viewbookId,email])` P2002 rollback) AND the 24h window cap `(SELECT COUNT(*) FROM ViewbookEmailDelivery WHERE viewbookId=id AND kind='team-invite' AND createdAt >= ${now - 86_400_000}) < 10`.
  - **`A2` is NOT `A` (Codex fix 4).** After the member INSERT, `A`'s `NOT EXISTS(clientMutationId replay)` is FALSE within the same txn (the row now exists) — reusing `A` would block the delivery. `A2` = `EXISTS(ViewbookTeamMember WHERE viewbookId=id AND memberKey=<generatedKey>)` (the member this txn just created) AND the SAME 24h window cap clause. This ties the delivery to the just-created member and re-checks the window.
  - Destructure counts; add success = member row inserted (count 1) ⇒ invite delivery inserted too (both gated compatibly). `clientMutationId` replay → member count 0 → `{ replayed:true }`, `+0`.
- **Resend** — NO durable idempotency (Codex fix 6). `ViewbookEmailDelivery` has no `clientMutationId` column and PR5 adds no migration, so a resend CANNOT be made HTTP-replay-safe. Drop `clientMutationId`/`replayed` from the resend contract. A double-submit that both pass the `<3` gate is acceptable — bounded by the ≤3-sends cap + the per-token write throttle + the 24h window cap. Array gated on: member exists (by `memberId` + viewbook ownership + access chain) AND `(SELECT COUNT(*) FROM ViewbookEmailDelivery WHERE dedupKey LIKE 'vb-invite:'||<memberKey>||':%') < 3` (≤3 sends/member) AND the 24h window cap. Ordinal `n = existing-invite-count-for-member + 1` and `dedupKey = 'vb-invite:'||<memberKey>||':'||n` computed in SQL. Pre-read `memberKey` from `memberId` so the LIKE prefix is exact. SQLite single-writer serializes concurrent resends → distinct ordinals, or one blocked by the cap (add a concurrent-double-resend DB test asserting ≤3 total + no duplicate dedupKey → the second either gets `:n+1` or is capped, never a P2002 rollback of a legit send).
- AFTER commit (both paths): re-select the just-created `team-invite` delivery by its deterministic dedupKey → `void enqueueViewbookEmail(id).catch(logError)`.

- [ ] **Step 1: Write failing tests** (DB-backed):
  - add member → row created + `team-invite-add` activity + `syncVersion +1` + one `vb-invite:<memberKey>:1` delivery; handler send stamps `sentAt`; dark → `suppressedAt`.
  - duplicate email (same viewbook) → no second row (0 inserted), no bump, honest error/replay; `clientMutationId` replay → `replayed:true`, `+0`.
  - **member cap:** 16th add blocked (seed 15) → 0 inserted, `+0`.
  - **24h window cap (atomic add):** 11th add in 24h blocked ENTIRELY (seed 10 team-invite deliveries in the window) → NO member row, NO delivery; assert ≤10 team-invite rows in the window.
  - **resend cap:** 4th send for a member blocked (seed 3 deliveries) → 0 new delivery; 2nd/3rd sends get ordinals `:2`/`:3`.
  - **concurrent double-resend:** two parallel resends of the same member (2 existing sends) → total sends ≤3, no duplicate dedupKey, no P2002 rollback of a legit send (one gets `:3`, the other is capped or gets a distinct ordinal).
  - resend for unknown/other-viewbook `memberId` → 404/no-op.
  - relative-delta bump tests: successful add `+1`; a successful resend `+1` (invite status renders in pc-invite as "invited"/"invite requested" — see payload note below — so a resend changes rendered state); a fully-blocked add/resend → `+0`; `clientMutationId` replay of an add → `+0`, `replayed:true`.
- [ ] **Step 2: Verify failures.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Green.**
- [ ] **Step 5: Commit** — `feat(viewbook): team-member invites with SQL-enforced caps + team-invite delivery`

---

### Task 4: Setup core — `clientNotifyJson` write (`lib/viewbook/setup.ts`)

**Files:**
- Create: `lib/viewbook/setup.ts` + `setup.test.ts`

**Interfaces:** `setNotifyEmails(viewbook, token, input: { notifyEmails: string[]; clientMutationId? }, hooks?): Promise<{ notifyEmails: string[] }>` — PUBLIC (the `setup` PATCH).

**Mechanics + validation (spec §8 abuse boundary):**
- Validate `notifyEmails`: array, `≤5` entries, each `canonicalMailbox`-valid; **each MUST already be on the viewbook** — equal to a stored `ViewbookTeamMember.email` OR the current `school-contact-email` answer value (both canonicalized). Reject arbitrary addresses (`400 invalid_notify_recipient`). Dedupe + lowercase. This mirrors the `moveViewbookStage` allowed-set intersection (`service.ts:262-297`) — factor a shared `resolveAllowedNotifyRecipients(viewbookId)` helper reused by BOTH (put it beside the resolver in `service.ts` or a small `lib/viewbook/notify-recipients.ts`; the stage resolver should then import it, replacing its inline duplicate — one home).
- Store the validated JSON array string on `Viewbook.clientNotifyJson` inside the array txn, fenced on `S` = access chain (viewbook current, not revoked, client active) AND **`clientNotifyJson IS NOT <canonical JSON string>` (value-idempotence, Codex fix 8)** — reposting the same deduped/canonicalized list produces 0 rows, no activity, `syncVersion +0`. Serialize the validated array with a stable key order so the equality compare is deterministic. `clientNotifyJson` IS rendered data (pc-setup shows who gets notified) → `syncVersionBumpWhere(id, S)` at index 0; activity `'notify-emails-set','client' WHERE S`; the `UPDATE "Viewbook" SET clientNotifyJson=…, updatedAt=… WHERE (S)`. The optional `clientMutationId` is advisory only (no durable column); value-idempotence is the real replay guard.
- The setup route ONLY writes `clientNotifyJson`. Org-basics field values (school name/contact/phone/website) are written by the client through the EXISTING answers PATCH — pc-setup wires those inputs to that route, NOT here.

- [ ] **Step 1: Failing tests** — valid subset of team/primary-contact emails persists + `+1`; an address not on the viewbook → `400`, `+0`; >5 → 400; malformed mailbox → 400; empty array clears it (`[]`) + `+1`; dedupe/lowercase; the shared allowed-set helper returns team emails ∪ primary-contact answer. Add a regression test that `moveViewbookStage` still resolves recipients identically after the resolver is factored out (no behavior change).
- [ ] **Step 2: Verify failures.** — [ ] **Step 3: Implement** (+ refactor the stage resolver onto the shared helper). — [ ] **Step 4: Green** (run the `service.test.ts` stage-move tests too — the refactor must not regress them).
- [ ] **Step 5: Commit** — `feat(viewbook): setup route clientNotifyJson write + shared allowed-recipient resolver`

---

### Task 5: The three public routes + ack-reset route + middleware matchers

**Files:**
- Create: `app/api/viewbook/[token]/ack/route.ts` (POST), `app/api/viewbook/[token]/team-members/route.ts` (POST, body-dispatched), `app/api/viewbook/[token]/setup/route.ts` (PATCH)
- Create: `app/api/viewbooks/[id]/ack/[sectionKey]/route.ts` (DELETE, cookie-gated ack-reset)
- Modify: `middleware.ts` — add three anchored public matchers beside the existing viewbook block (`middleware.ts:75-79`), BEFORE the `PUBLIC_PATH_PREFIXES` fallthrough:
  ```ts
  if (/^\/api\/viewbook\/[^/]+\/ack$/.test(pathname)) return true
  if (/^\/api\/viewbook\/[^/]+\/team-members$/.test(pathname)) return true
  if (/^\/api\/viewbook\/[^/]+\/setup$/.test(pathname)) return true
  ```
  Do NOT add a `/api/viewbook/` prefix. The ack-reset route is `/api/viewbooks/[id]/…` (cookie-gated `[id]` namespace) — NO middleware change (default-gated).
- Create route test files for each (mirror `answers`/`feedback` route test harness — real signed same-site headers).

**Route wiring:**
- **ack** (POST): body `{ sectionKey, clientMutationId }`; preflight chain → `acknowledgeSection(...)` → `NextResponse.json({ acknowledged, pcCompleted }, { status: replayed?200:201, headers:{'Cache-Control':'no-store'} })`. `BODY_CAP_BYTES = 2*1024`.
- **team-members** (POST): body-dispatched — `{ mode:'create', name, email, clientMutationId }` → `addTeamMember`; `{ mode:'resend', memberId, clientMutationId }` → `resendInvite`; unknown mode → 400. `BODY_CAP_BYTES = 4*1024`.
- **setup** (PATCH): body `{ notifyEmails: string[], clientMutationId? }` → `setNotifyEmails`. `BODY_CAP_BYTES = 4*1024`.
- **ack-reset** (DELETE `/api/viewbooks/[id]/ack/[sectionKey]`): cookie-gated via `requireOperatorEmail(request)` (throws 401); `parseId`; validate `sectionKey` ∈ `ACKABLE_SECTION_KEYS`; `resetSectionAck(id, sectionKey, actor)` → `{ ok:true }`. Mirror `app/api/viewbooks/[id]/lock/route.ts` shell.
- Every public route: `requireSameSite` → `requireJsonContentType` → `requireViewbookToken` → `checkWriteThrottle` → `readBoundedJson` (order load-bearing), `withRoute`, `force-dynamic`, `no-store`. Enqueue emails post-commit inside the core (already handled in Tasks 2/3), not the route.

- [ ] **Step 1: Failing tests** — per route: happy path (correct status/body/`no-store`), 415 non-JSON, 403 cross-site, 404 bad/revoked token, 429 throttle (where feasible), 413 over-cap body, 400 invalid body. **Matcher anchoring tests** (extend the middleware test suite): each new matcher matches `^/api/viewbook/TOKEN/{ack,team-members,setup}$` (positive) and a deeper path `/api/viewbook/TOKEN/ack/extra` is NOT public (negative); the ack-reset `/api/viewbooks/…` path is NOT matched by any public matcher.
- [ ] **Step 2: Verify failures.** — [ ] **Step 3: Implement** the four routes + matchers. — [ ] **Step 4: Green** — route + middleware suites; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(viewbook): ack/team-members/setup public routes + ack-reset + matchers`

---

### Task 6: Stage-move `force` + ack-to-stage forward fence + admin move buttons

**Files:**
- Modify: `lib/viewbook/service.ts` `moveViewbookStage` (:247-333) — add a `force = false` param; extend the pre-read `select` with `stage` + `pcCompletedAt`; add the forward fence + force-stamp.
- Modify: `app/api/viewbooks/[id]/stage/route.ts` — parse `body.force` (boolean, default false) and pass it through.
- Modify: `components/viewbook/admin/ViewbookEditor.tsx` SettingsTab (:128+) — add Advance / Roll back buttons beside the read-only "Project stage" line, using the existing `run(label, fn, onSuccess?)` helper + `jsonFetch` POST to `/api/viewbooks/${id}/stage` with `{ direction, expectedStage: vb.stage, force? }`. Advance out of `post-contract` when `!vb.pcCompletedAt` prompts a confirm ("acknowledgments incomplete — advance anyway?") and re-POSTs with `force:true`. Disable/hide back at the first stage and forward at the last (`nextStage`/`prevStage` null).
- Optionally surface a stage advance affordance in `ViewbookIndex` — NOT required; the SettingsTab is the home. If added, reuse the same jsonFetch pattern.

**`moveViewbookStage` fence mechanics — ORDER is load-bearing (Codex fix 9):**
- Forward fence: when `direction==='forward'` AND `expectedStage==='post-contract'` AND `pcCompletedAt` is null AND NOT `force` → `HttpError(409,'ack_incomplete')` BEFORE the txn.
- **Force path array order:** the force pc-complete delivery + `pcCompletedAt` stamp MUST run BEFORE the existing `expectedStage` stage update — because their completion gate requires `stage = expectedStage` (== `'post-contract'`), which becomes false once the stage flips. Ordered array: `[ syncVersionBumpStatement(id), <force pc-complete delivery INSERT via the shared `pcCompleteDeliveryInsert` raw builder, WHERE gate G>, <pcCompletedAt UPDATE WHERE G>, prisma.viewbook.update({ where:{ id, stage: expectedStage }, data:{ stage: target } }), viewbookStageLog.create(eventKey), ...stageChangeDeliveryStatements, ...appendActivityStatements ]` where `G` = `id AND stage=${expectedStage} AND pcCompletedAt IS NULL` (only fires on the force-out-of-post-contract case). Use the SAME raw `pcCompleteDeliveryInsert` (Task 2, `ON CONFLICT("dedupKey") DO NOTHING`) — NOT a Prisma `.create` (which can't `ON CONFLICT`); resolve the recipient via Task 2's `resolvePcCompleteRecipient`. The `ON CONFLICT` makes force harmless when a Task-2 ack already created the `vb-pc-complete:<id>` row.
- The existing `expectedStage` compound-where update stays the P2025→409 race fence and gates everything (a lost race rolls the whole array — including the force stamp — back).
- After commit: if a `pc-complete` delivery was created (force path), enqueue it too (alongside the existing stage-change enqueue loop).
- `syncVersionBumpStatement(id)` stays index 0 — one bump for the whole move (force stamp + stage flip = one rendered change).

- [ ] **Step 1: Failing tests** (`service.test.ts` extend) — forward out of `post-contract` with `pcCompletedAt` null and no force → 409 `ack_incomplete`, `+0`, no stage change; with `force` → stage advances + `pcCompletedAt` stamped + one `vb-pc-complete` delivery + stage-change deliveries as usual; forward out of `post-contract` with `pcCompletedAt` already set (e.g. after Task 2 completion) → advances normally, NO duplicate pc-complete delivery (`ON CONFLICT`); back-move and forward-from-later-stages unaffected by the fence; `force` on a non-post-contract forward is a harmless no-op (no extra stamp). Route test: `{force:true}` parsed + threaded; `{direction:'forward',expectedStage:'post-contract'}` → 409 without force.
- [ ] **Step 2: Verify failures.** — [ ] **Step 3: Implement** service + route + admin buttons. Admin button tests: SettingsTab renders Advance/Roll back; advancing from post-contract with `pcCompletedAt:null` triggers the confirm→force path (mock `jsonFetch`); DOM-native assertions, admin `dark:` variants allowed.
- [ ] **Step 4: Green** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook components/viewbook app/api/viewbooks` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(viewbook): stage-move force + ack-to-stage fence + admin move buttons`

---

### Task 7: pc-* section components + lineup activation + creation-default flip

**Files:**
- Create: `components/viewbook/public/PcIntroSection.tsx`, `PcSetupSection.tsx`, `PcInviteSection.tsx`, `PcThanksSection.tsx` (+ tests). Plus client islands as needed: `AckButton.tsx` (POSTs `/api/viewbook/[token]/ack`), `TeamInviteForm.tsx` + team list (POSTs `/api/viewbook/[token]/team-members`), and the setup notify-emails control (POSTs `/api/viewbook/[token]/setup`); org-basics inputs reuse the EXISTING answer editor (`FieldEditor`) pointed at the `PC_SETUP_DEF_KEYS` fields.
- Modify: `app/(public)/viewbook/[token]/page.tsx` — import the four components; add `case 'pc-intro'|'pc-setup'|'pc-invite'|'pc-thanks'` to `renderSection` (before `default`). (Payload fields `pcCompletedAt`/`teamMembers`/`clientNotifyJson`/`displayName`/`global.pcIntro` + the pc-thanks primarySections exclusion all land in Task 1.)
- Modify: `components/viewbook/public/DataSourceSection.tsx` — post-contract intro line + the shared `AckButton` (post-contract only), per the contract above.
- Modify: `components/viewbook/public/SectionShell.tsx` — extend the existing `state==='done'` `<details>` collapse to ALSO collapse when `section.acknowledgedAt != null` (tiny, prop-driven; light-only). Add/extend `SectionShell.test.tsx` for the acknowledged-collapse case.
- Modify: `lib/viewbook/stages.ts` `STAGE_LINEUPS` — activate the final lineups (table above): post-contract primary `['pc-intro','pc-setup','pc-invite','data-source','pc-thanks']`; add `pc-setup,pc-invite` to kickoff/website-specifics/building carried lists per the table. `lib/viewbook/stages.test.ts` — unpin the "lineups only reference shipped renderers" set to include the four pc-* keys (deliberate, note in the test comment, mirroring PR4/PR6 unpins).
- Modify: `lib/viewbook/service.ts:60` — flip `stage: 'building'` → `stage: 'post-contract'` (remove/adjust the PR1 comment). Update any creation test asserting the default stage.

**Component contracts:** each is `{ section, data, token }` (add `isOperator`/operator props ONLY if strictly needed — PR8 owns the operator layer; keep pc-* client-facing). Wrap in `SectionShell` with `title={SECTION_TITLES[key]}`, `heroUrl` from `data.theme.sectionHeroes[key]`. Defensive stage self-gate (`if (data.stage !== 'post-contract') return null`) mirroring `WsIntroSection`/`KickoffNextSection` (except pc-setup/pc-invite are ALSO carried into later stages — they must NOT hard-gate to post-contract; render in all their lineup stages, and show the ack action ONLY while `data.stage === 'post-contract'`). pc-thanks: `if (!data.pcCompletedAt) return null` (already excluded from `primarySections` when null in Task 1, so this is belt-and-suspenders). LIGHT-ONLY (no `dark:`). Escape all dynamic strings.
- **pc-intro:** renders `data.global.pcIntro` (the new global-content key from Task 1) with a code-owned fallback string when unset (Codex fix 10 — NOT purely code-owned) + `section.introNote` (free via SectionShell). Never collapses, no ack.
- **pc-setup:** renders the `PC_SETUP_DEF_KEYS` fields (find them in `data.fieldCategories` by the new `defKey`) via the existing answer-edit island; the notify-emails control (setup route); an ack action (post-contract only).
- **pc-invite:** the stored team list (`data.teamMembers` — name/email + **"Invite requested"** status from the `invited` boolean, NEVER "Sent"; Codex fix 7) + add form + per-member resend; ≤15 note; ack action (post-contract only).
- **pc-thanks:** the fixed thank-you copy (spec §7); revealed by `pcCompletedAt`.
- **data-source ack + intro (Codex fix 10):** `data-source` is an ackable section AND is in the post-contract primary flow, so the EXISTING `DataSourceSection.tsx` MUST gain (a) a post-contract intro line ("fill in what you can before the kickoff call" — spec §7, shown only while `data.stage==='post-contract'`) and (b) the same client ack action (post-contract only). Editing `DataSourceSection.tsx` is PR5's job (it's a section component); PR8 must NOT edit it (PR8 wraps).
- **Collapse acknowledged sections in post-contract (Codex fix 10, spec §4 "collapses the section for everyone").** An acknowledged ackable section (pc-setup/pc-invite/data-source with `section.acknowledgedAt` set) renders COLLAPSED in post-contract (mirror `SectionShell`'s existing `state==='done'` `<details>` collapse). Implement via a minimal `SectionShell` signal (e.g. it already collapses on `state==='done'`; extend it to also collapse when `section.acknowledgedAt != null` — SectionShell is a shared light-only file, keep the change tiny and prop-driven so PR7's redesign and PR8's operator reset still compose), OR a per-component collapsed summary face. Prefer the SectionShell path (one place). Reset-ack (operator, Task 5) re-expands.
- **Shared ack island `AckButton.tsx`:** used by pc-setup, pc-invite, and DataSource — one client island, POSTs `/api/viewbook/[token]/ack`, `requestRefresh()` on success, registers `useEditorActivity` while in flight.

- [ ] **Step 1: Failing tests** — component render tests (DOM-native, fixture from a sibling section test): each pc-* renders its title/copy in post-contract; pc-thanks hidden when `pcCompletedAt` null, shown when set; pc-setup surfaces the PC_SETUP_DEF_KEYS labels; defensive gates. `stages.test.ts`: `STAGE_LINEUPS['post-contract'].primary` equals the 5-key list; carried lists gained `pc-setup,pc-invite` in the three later stages; unpin assertion. Creation test: new viewbook seeds `stage:'post-contract'`. A lineup-resolution test (public-data) that a post-contract viewbook renders the five primary sections in order.
- [ ] **Step 2: Verify failures.** — [ ] **Step 3: Implement** components + islands + page cases + lineup activation + creation flip. Wire islands to the routes from Task 5 (they exist now). Reuse `KickoffNextButton`'s fetch+`requestRefresh()` pattern for the client islands; register editing islands with `useEditorActivity` where they hold drafts (invite form, notify-emails input) so the sync poller doesn't clobber them (PR2 edit-guard contract).
- [ ] **Step 4: Green** — full viewbook scope: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/viewbook components/viewbook app/api/viewbook app/api/viewbooks` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(viewbook): pc-* sections, post-contract lineup activation, creation-default flip`

---

### Task 8: Gates, sync-bump audit, cross-review, merge

- [ ] **Step 1: Sync-bump audit** — enumerate every NEW rendered-data write in the branch diff (ack stamp, pcCompletedAt stamp, team-member add, resend status, clientNotifyJson set, force-advance stamp, ack-reset) and confirm each adopts `syncVersionBumpStatement()`/`syncVersionBumpWhere()` inside its fenced array txn with a shared predicate, AND has a relative-delta bump/no-bump test (0-row fenced write + replay bump NOTHING). Record the audit table in the SDD ledger (mutation → bump factory → test name). Confirm org-basics answers ride the existing (already-bump-adopting) answers PATCH — no second write path. Confirm delivery-only rows add no extra bump.
- [ ] **Step 2: Full gates in the worktree** — `npx tsc --noEmit` && `DATABASE_URL="file:./local-dev.db" npm test` && `npm run build` (sequence suites — never concurrent in one worktree).
- [ ] **Step 3: Reviews** — final whole-branch review (fable, most-capable) + `codex exec review --base <pre-work branch HEAD>` (P1). Fix Critical/Important + valid P2 findings; re-gate.
- [ ] **Step 4: Merge PR5 FIRST** (it owns the page/route/lineup integration). PR8 (Codex lane) rebases onto this merge and owns the final page/session wiring. Open PR `Viewbook v2 PR5 — post-contract stage`, merge on green.

## Self-review notes (spec coverage)

- §4 ack set (`pc-setup`,`pc-invite`,`data-source`), idempotent re-ack, hidden-excluded completion predicate, first-writer `pcCompletedAt`, one-way thanks, ack-reset → Task 2. Stage moves `force` + ack-to-stage forward fence + force-stamp → Task 6. ✓
- §5 `clientNotifyJson` write + validation → Task 4; `defKey` exposure (fix 11) → Task 1. Schema already migrated (no PR5 migration). ✓
- §7 pc-intro/setup/invite/thanks + header display-name derivation → Tasks 1 + 7; org-basics via existing answers PATCH. ✓
- §8 `pc-complete` (Task 2) + `team-invite` (Task 3) triggers reusing PR3's `enqueueViewbookEmail`/delivery pattern + templates; dedupKeys `vb-pc-complete:<id>` / `vb-invite:<memberKey>:<n>`; caps (≤15 members, ≤3 sends, ≤10/24h) in SQL; canonical mailboxes; clientNotifyJson recipients restricted to viewbook addresses (Task 4). ✓
- §11 three anchored public matchers + ack-reset cookie route → Task 5. ✓
- §13 tests: ack state machine, concurrent last-ack, hidden-predicate, invite caps under concurrency, force-advance stamping, matcher anchoring, sync-bump coverage incl. 0-row + replay → spread across Tasks 2/3/4/5/6/8. ✓

## Out of scope (do NOT touch)

ER inline operator layer / presentation toggle / OperatorLayer / per-section affordance slots / `page.tsx` session wiring beyond the pc-* renderSection cases (PR8, the concurrent lane — PR8 rebases onto this and owns final page/session integration) · SectionShell v2 redesign / image-webp-sharp pipeline / TOC rail / search (PR7) · `prisma/schema.prisma` + migrations (already landed) · `lib/notify/` transport · contrast/theme/ws-intro (PR6, merged) · the CSM roster editor / `assignViewbookCsm` (PR3, merged — PR5 READS csmName for the pc-complete recipient, does not change assignment).

## Definition of done

All eight tasks green; sync-bump merge gate satisfied with relative-delta tests; full gates pass; fable + `codex exec review` findings resolved; PR5 merged FIRST. SDD ledger updated per task.
