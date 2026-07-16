# Codex Brief — Viewbook PR4, CORE PHASE (activity + digest + public writes)

> Paste this whole document as ONE prompt into `codex exec` (workspace-write
> sandbox) AFTER PR1 (#185) has merged to main. An integration-phase addendum
> follows after PR2 merges — do NOT touch middleware.ts or any
> components/viewbook/public/* file created by PR2 in this phase.

## Setup

```bash
cd <repo-root>
git worktree add .claude/worktrees/viewbook-pr4 -b feat/viewbook-pr4 main
cd .claude/worktrees/viewbook-pr4
```

Work ONLY in that worktree. Commit per task. Push `feat/viewbook-pr4` when
gate-green. Do NOT merge, do NOT open the PR (Claude cross-reviews first).

## Context

er-seo-tools client viewbook: token-linked public client hub. PR1 (merged)
landed the full schema (11 `Viewbook*` models — NEVER touch
`prisma/schema.prisma`), `lib/viewbook/route-auth.ts`
(`requireViewbookToken(token): Promise<Viewbook>` — fail-closed, all failures
one 404), `lib/viewbook/operator.ts` (`requireOperatorEmail(request):
Promise<string>` — 401 on missing session), the asset store, and the admin
shell. Read the spec §7 (write semantics), §9 (notifications & activity) and
the program plan's PR4 section in `docs/superpowers/{specs,plans}/` — they are
the requirements; this brief is the execution contract.

## Your files (CREATE)

- `lib/viewbook/activity.ts` — `appendActivityStatements(viewbookId, kind, actor, summary)` returning Prisma statement(s) for composition into array-form transactions + `listActivity(viewbookId, cursor?, limit?)`.
- `lib/viewbook/public-write-guard.ts` — the ONE shared guard all public viewbook writes use (PR3 consumes it later): `requireSameSite(request)` (mirror `lib/security/same-site.ts` if present, else Origin/Host comparison), `requireJsonContentType(request)`, `checkWriteThrottle(token)` (in-process token-scoped sliding window → `HttpError(429, 'rate_limited')`), `readBoundedJson(request, capBytes)` (stream-capped, mirror `lib/content-audit/read-bounded-json.ts`), `validateClientMutationId(raw)` (UUID-shaped or null).
- `lib/viewbook/digest.ts` — high-water digest core (SPEC §9 EXACTLY): per viewbook capture `highWater = MAX(client-actor activity id)` ONCE; render rows `digestCursorId < id <= highWater` capped at 30 with an honest "+N more in the activity feed" line; after successful send update `digestCursorId = highWater` AND `digestSentAt` together; dark env (Mailgun unset) → advance cursor, do NOT stamp `digestSentAt`; NEVER recompute MAX after sending.
- `lib/viewbook/retention.ts` — `pruneViewbookActivity(now)`: delete activity rows older than 180 d.
- `lib/jobs/handlers/viewbook-digest.ts` — durable job: concurrency 1, 3 attempts, NO group (D7 `notify-email.ts` is the model — read it).
- `lib/notify/viewbook-digest-content.ts` — pure `buildViewbookDigestEmail` (HTML-escaped, plain summaries; follow `lib/notify/content.ts` conventions).
- `app/api/viewbook/[token]/feedback/route.ts` — POST: guard chain (same-site → JSON content-type → `requireViewbookToken` → throttle → bounded body) then ONE array-form transaction: guarded `INSERT … SELECT`-style cap check (≤200 feedback per reviewLink), commit-time re-verify (token current, not revoked, client active, reviewLink belongs to this viewbook — EXISTS predicates), `clientMutationId` replay (existing row → 200 with it), + activity row in the SAME transaction. Body `{reviewLinkId, body ≤4KB, authorName? ≤120, clientMutationId}`. `authorKind: 'client'`.
- `app/api/viewbook/[token]/materials/route.ts` — POST: same guard chain; `{label ≤256B, url https-only via new URL, clientMutationId}`; cap ≤100 materials/viewbook; `status: 'provided'`, `providedAt: now`, `addedBy: 'client'`; activity row same transaction.
- `app/api/viewbooks/[id]/milestones/[milestoneId]/review-links/route.ts` — POST (operator, `requireOperatorEmail`): `{label, url https-only, kind: 'mockup'|'live'}`; milestone must belong to viewbook (fenced).
- `app/api/viewbooks/[id]/review-links/[reviewLinkId]/route.ts` — DELETE (operator, ownership-fenced via the link's milestone.viewbookId).
- `app/api/viewbooks/[id]/feedback/[feedbackId]/resolve/route.ts` — POST (operator): stamp `resolvedAt`/`resolvedBy`, ownership-fenced.
- `app/api/viewbooks/[id]/activity/route.ts` — GET (operator): cursor-paginated feed.
- `components/viewbook/public/FeedbackThread.tsx` + `components/viewbook/public/MaterialLinkForm.tsx` — NEW self-contained client components (thread render + submit; label+URL form; both post to the public routes with a generated `clientMutationId`, optional name field labeled "as reported"). They are NOT mounted anywhere in this phase — PR2's sections mount them in your integration phase.
- `components/viewbook/admin/FeedbackTab.tsx` + `components/viewbook/admin/ActivityFeed.tsx` — admin thread list + resolve buttons; activity feed. NOT mounted in this phase (integration adds the tabs to ViewbookEditor).
- Tests for every module above (vitest; DB-backed tests import `prisma` from `@/lib/db`; create clients named `vb-test-<uuid>` and delete them in `afterAll`). REQUIRED race tests: revoke-vs-write (revoke between preflight and commit → 0 rows → 404, no row written), cross-viewbook reviewLinkId rejected, cap enforcement under `Promise.all` double-submit, clientMutationId replay returns the same row, digest concurrent insertion above high-water stays pending, dark-env cursor-advance-no-stamp.

## Your files (MODIFY — these exact ones, nothing else)

- `lib/jobs/handlers/register.ts` + its test — register `viewbook-digest`.
- `lib/jobs/types.ts` — job type constant (follow existing entries).
- `lib/jobs/system-schedules.ts` + its test — add `system-viewbook-digest` (`every:15m`).
- `lib/cleanup.ts` + wiring test — call `pruneViewbookActivity` in `runCleanup`.
- `lib/viewbook/service.ts` + `lib/viewbook/service.test.ts` — `setSectionState` gains an `actor: string` param and writes the state transition + a `section-done` activity row in ONE array-form transaction (only when state becomes 'done'); update its one caller (`app/api/viewbooks/[id]/sections/[sectionKey]/route.ts`) to pass the operator email.

## FORBIDDEN in this phase

`middleware.ts`, `middleware.test.ts`, `prisma/schema.prisma`, anything in
`components/viewbook/public/` OTHER than your two new leaf files, anything in
`app/(public)/`, `next.config.ts`.

## House invariants (violations = review rejection)

- Array-form `prisma.$transaction([...])` ONLY — no interactive transactions,
  conditional logic via EXISTS predicates / fenced updateMany counts.
- All routes `withRoute`-wrapped (`lib/api/with-route.ts`), JSON via
  `parseJsonBody`/your bounded reader, errors via `HttpError`.
- Public token failures are ONE indistinguishable 404. Operator routes 401 via
  `requireOperatorEmail`.
- Mailgun key never logged; email content HTML-escaped; dark gate =
  `isNotifyEnabled()` from `lib/notify/config.ts`.
- No `Date.now()` in SQL string interpolation — raw statements set `updatedAt`
  manually as integer ms (house rule) — prefer Prisma statements.
- Plain text everywhere client-side; escape at render.

## Gates (run in YOUR worktree; all must pass before push)

```bash
npx tsc --noEmit
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
npm run audit:ci
```

Commit message style: `feat(viewbook): PR4 <what> ` + `Co-Authored-By: Codex`.
When gate-green: push and STOP. Claude cross-reviews before any merge.
