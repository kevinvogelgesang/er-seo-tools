# U1 — Onboarding Viewbook magic-link auth (design)

**Status:** spec for the Codex-built U1 lane (Onboarding Viewbook roadmap, Track 2). **Codex-reviewed 2026-07-22 (Sol): accept with 12 named fixes — ALL applied below** (fragment links, guarded-INSERT consume, atomic request ledger, cap split, mint-at-send pinned, resolver adapters, write capabilities + commit-time member fences, `actorKind` attribution, model completeness, archived-client 404 + logout semantics, explicit matcher, removal txn + no-store assets).
**Roadmap:** `docs/superpowers/nyi/improvement-roadmaps/2026-07-22-onboarding-viewbook-roadmap.md` — decisions D2/D3/D4 + the six U1 invariants (§4 "U1") are BINDING; this spec turns them into a buildable design. Do not re-litigate.
**Tracker:** `docs/superpowers/todos/2026-07-22-onboarding-viewbook-tracker.md`.
**Sequencing:** parallel with F1/F2; MUST land before F3 (both touch `app/(public)/viewbook/[token]/page.tsx`). U1/F1/F2 all touch `prisma/schema.prisma` — whichever merges second rebases, `npx prisma generate`, `rm -rf .test-dbs`.

## 1. Goal

Viewbook access becomes invitation-only. `/viewbook/[token]` stops being "anyone with the URL sees everything" and becomes a LANDING page: an invited member with a live session sees the viewbook; everyone else gets an email prompt that (non-oracle) sends a fresh magic link to invited addresses. ER staff keep cookie auth and see any viewbook (D2). Client writes stop being anonymous — member identity flows into write attribution.

All existing viewbooks are test-only (D4): no back-compat for anonymous URL access; the flip is one release. New tables only — no wipe migration is required for U1 itself (existing rows keep working; anonymous ACCESS simply ends).

## 2. Current state (verified 2026-07-22)

- **Public page** `app/(public)/viewbook/[token]/page.tsx`: `force-dynamic`; loads `loadViewbookPublicData(token)` + `getOperatorEmailForPublicPage()` in parallel; `!data → notFound()`; operator branch wraps sections in the operator layer. `loadViewbookPublicData` (`lib/viewbook/public-data.ts:51`) resolves the token via `requireViewbookToken` (HttpError → null → 404) and assembles the full payload.
- **Middleware** (`middleware.ts:74-92`): anchored single-segment public matchers only — `/^\/viewbook\/[^/]+$/` plus one per token API route (`assets`, `feedback`, `materials`, `answers`, `sync`, `ack`, `team-members`, `setup`, `collapse`→410). House rule: NEVER a `/viewbook/` or `/api/viewbook/` prefix matcher. Everything else is `er_auth`-cookie-gated (`lib/auth.ts`, HMAC-signed payload, 12 h, `getAuthSession`).
- **Token routes** (`app/api/viewbook/[token]/*`): all resolve the shared `Viewbook.token` via `requireViewbookToken`; writes share the preflight chain in `lib/viewbook/public-write-guard.ts` (`requireSameSite → requireJsonContentType → requireViewbookToken → checkWriteThrottle → readBoundedJson`). **No user identity** — `actor`/`author` are hardcoded `'client'`; feedback `authorName` is client-claimed.
- **Operator detection:** `getOperatorEmailForPublicPage()` (`lib/viewbook/public-session.ts`) = valid `er_auth` session with non-null `email`; dev-bypass returns `'dev@localhost'`; break-glass password sessions carry `email: null` → NOT operator today. Route-side equivalents: `resolveOperatorEmail`/`requireOperatorEmail` (`lib/viewbook/operator.ts`) — note `resolveOperatorEmail` cannot distinguish break-glass from unauthenticated (both → null); the principal resolver must read `getAuthSession` directly.
- **Models:** `ViewbookTeamMember` (`prisma/schema.prisma:1075`) — `memberKey @unique` (uuid), `name`, `email`, `@@unique([viewbookId, email])`, cap 15, `onDelete: Cascade` from Viewbook. NO auth columns. `Viewbook.token @unique` + `revokedAt` (rotate = new uuid; revoke = 404). `ViewbookEmailDelivery` — `kind`, `recipient`, `dedupKey @unique`, `memberId?`, `sentAt`/`suppressedAt`; durable `viewbook-email` job (`lib/jobs/handlers/viewbook-email.ts`) builds URLs from `NEXT_PUBLIC_APP_URL` and today sends the SHARED token URL as the "invite". **The current invite/resend SQL writes `memberId = NULL` on delivery rows** (`lib/viewbook/team-members.ts`) — U1 must stamp the real member id on add AND resend.
- **Attribution consumers (verified — these constrain §10):** `lib/viewbook/digest.ts` selects activity rows by `actor = 'client'` (a raw email in `actor` would silently vanish from digests); `MaterialsSection` treats any non-`'client'` `addedBy` as ER-authored; `proposeAmendment` currently uses ONE string for both the activity actor and the amendment author.
- **Dev-bypass:** `isAuthBypassedInDev()` (`lib/auth.ts:54`) = non-prod AND auth unconfigured; middleware passes everything, viewbook operator identity becomes `'dev@localhost'`.
- **Cleanup:** `runCleanup()` (`lib/cleanup.ts:28`) `Promise.allSettled` list; share-token expiry sweeps are the precedent (`cleanExpiredShareLinks` etc.).
- **Hashing precedents:** `sha256Hex` (`lib/findings/keys.ts:15`); opaque secrets via `crypto.randomUUID()`/`randomBytes`.
- **Admin roster gap:** `getViewbookAdmin` (`lib/viewbook/service.ts`) does NOT load team members today — the §9 removal UI needs loader + type changes. The only add-member surface is the public `pc-invite` form.

## 3. Data model (new; additive migration)

```prisma
model ViewbookAuthGrant {
  id         Int                @id @default(autoincrement())
  memberId   Int
  member     ViewbookTeamMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  tokenHash  String             @unique // sha256Hex(rawSecret); raw secret NEVER stored/logged
  expiresAt  DateTime           // mint + 7 d (first-click validity, D3)
  consumedAt DateTime?          // set once, by the winning consume (fenced, §7)
  createdAt  DateTime           @default(now())

  @@index([memberId])
  @@index([expiresAt])
}

model ViewbookMemberSession {
  id         Int                @id @default(autoincrement())
  memberId   Int
  member     ViewbookTeamMember @relation(fields: [memberId], references: [id], onDelete: Cascade)
  tokenHash  String             @unique // sha256Hex(rawSecret)
  expiresAt  DateTime           // mint + 60 d (D3)
  revokedAt  DateTime?          // logout / explicit revocation
  createdAt  DateTime           @default(now())
  lastSeenAt DateTime?          // best-effort, throttled touch (≤1 write/hour/session)

  @@index([memberId])
  @@index([expiresAt])
}

model ViewbookAuthRequest {
  id         String   @id            // app-generated crypto.randomUUID() — the request identity §7 keys deliveries on
  viewbookId Int
  viewbook   Viewbook @relation(fields: [viewbookId], references: [id], onDelete: Cascade)
  email      String   // normalized lowercase; logged for members AND strangers (non-oracle rate limiting)
  createdAt  DateTime @default(now())

  @@index([viewbookId, email, createdAt])
  @@index([email, createdAt])   // the global per-email cap scans this
  @@index([createdAt])
}
```

`ViewbookTeamMember` gains the two back-relations (`authGrants ViewbookAuthGrant[]`, `sessions ViewbookMemberSession[]`); `Viewbook` gains `authRequests ViewbookAuthRequest[]`.

Notes:
- **Hashed opaque rows, not signed cookies** (roadmap invariant): revocation must be immediate; member deletion cascades grants + sessions by FK.
- Raw secrets: `crypto.randomBytes(32).toString('base64url')`. Stored form is always `sha256Hex(raw)`; lookups are by hash (constant-time by construction — the hash is the key).
- D4 allows wipe/reseed but U1 needs none: all three tables are new.

## 4. Cookie design (per-viewbook isolation)

- **Name:** `vb_s_<viewbookId>` (id, not token — token rotation must not orphan sessions). One cookie per viewbook a person belongs to; a person on N viewbooks carries N cookies. This is the roadmap-pinned isolation model — one global cookie would clobber multi-viewbook access.
- **Value:** the raw session secret (opaque). **Attributes:** `HttpOnly; Secure; SameSite=Lax; Path=/` — host-only (no `Domain`). `Max-Age` = 60 d.
- `Path=/` is deliberate: the public page lives at `/viewbook/<token>` but the APIs live at `/api/viewbook/<token>/*`; a path-scoped cookie can't serve both.
- Resolution order on any token surface: resolve `token → viewbook` first (existing `requireViewbookToken`), then read `vb_s_<viewbook.id>`.
- **Logout**: see §7 — always clears the cookie and revokes any matching session row, regardless of principal kind.

## 5. `ViewbookPrincipal` — the ONE resolver

New `lib/viewbook/principal.ts`:

```ts
type ViewbookPrincipal =
  | { kind: 'member';   member: { id: number; memberKey: string; name: string; email: string }; sessionId: number }
  | { kind: 'operator'; email: string }          // er_auth with non-null email (D2)
  | { kind: 'dev';      email: 'dev@localhost' } // isAuthBypassedInDev() — concrete attribution identity
  | { kind: 'break-glass' }                       // valid er_auth, email null — see §11

// CORE takes explicit cookie VALUES (a server component has no Request):
resolveViewbookPrincipalFromCookies(
  { erAuthCookie, memberCookie }: { erAuthCookie: string | null; memberCookie: string | null },
  viewbook: { id: number },
): Promise<ViewbookPrincipal | null>

// Thin adapters — the ONLY two entry points:
resolveViewbookPrincipal(req: Request, viewbook)          // routes: reads the cookie header
resolveViewbookPrincipalRSC(viewbook)                     // server components: next/headers cookies()
```

- Resolution order: dev-bypass → `getAuthSession(erAuthCookie)` **directly** (email → `operator`; valid-but-null-email → `break-glass` — `resolveOperatorEmail` can't make that distinction) → member cookie (`vb_s_<id>` → hash → live `ViewbookMemberSession`: not revoked, not expired, member's `viewbookId` matches). Returns `null` when nothing matches.
- **Capabilities, not just presence:** `canRead(p)` = any non-null principal; `canWrite(p)` = `member | operator | dev` (break-glass is read-only, §11). Session validity and the throttled `lastSeenAt` touch live here and nowhere else.
- **Commit-time member fences:** principal resolution is a read; member removal can race it. Every MEMBER mutation therefore threads `principal.sessionId` into its existing conditional-write SQL: the write predicate additionally requires `EXISTS (session row: id = :sessionId AND revokedAt IS NULL AND expiresAt > :now AND member present on this viewbook)` in the SAME statement/array-form txn that performs the write. A removed member's in-flight write affects 0 rows.
- **EVERY route under `/api/viewbook/[token]/*` requires `canRead` (reads) / `canWrite` (mutations)** after `requireViewbookToken`: `assets`, `sync` (read) · `feedback`, `materials`, `answers`, `ack`, `team-members`, `setup` (write) · the new `auth/logout` (see §7; `collapse` keeps its 410 short-circuit; `auth/request`/`auth/consume` are pre-auth by nature). Failure mode: **404 via the same `HttpError` shape `requireViewbookToken` uses** — indistinguishable from a bad token (no oracle for "valid token, not signed in" on API surfaces). The public PAGE is the one place that renders an email prompt instead.
- **Asset caching:** authenticated asset responses switch from `private, max-age=3600` to **`private, no-store`** — a removed member must not keep reading assets from browser cache without re-authorization.
- Middleware is untouched as an auth layer: it stays the anchored public bypass; authorization lives in handlers (roadmap invariant). Exactly ONE new matcher, with an **explicit tail** (never `[^/]+` — that would silently publicize future auth routes):

```ts
/^\/api\/viewbook\/[^/]+\/auth\/(?:request|consume|logout)$/
```

## 6. Landing page flow (`app/(public)/viewbook/[token]/page.tsx`)

Rewritten entry order — **the unauthorized path never calls `loadViewbookPublicData`** (roadmap invariant):

1. Light token resolution ONLY: `viewbook.findUnique({ where: { token }, select: { id, revokedAt, client: { select: { archivedAt } } } })`. Unknown, revoked, **or archived-client** → `notFound()` (today's `requireViewbookToken` 404s archived clients; the light path must preserve that, not render a prompt for them).
2. `resolveViewbookPrincipalRSC()`:
   - `operator`/`dev` → full load + operator layer (existing behavior).
   - `member` → full load, `baseRenderSection`, no operator layer. Member identity threads into the shell props (for U3/U4 later; U1 may surface a small "Signed in as <name> · Sign out" affordance).
   - `break-glass` → read-only member-equivalent view (§11).
   - `null` → render the **email-prompt page**: a minimal client component (email field + submit → `POST /api/viewbook/[token]/auth/request`). It must not receive or serialize ANY viewbook payload — no client name, no theme, no section data. Static ER-branded copy only.
3. **Magic-link arrival** — the emailed URL is `/viewbook/<token>#g=<rawGrantSecret>` (**URL FRAGMENT, never a query param** — query strings land in nginx/access logs; fragments never reach the server). The unauthenticated page always ships a small client component that on mount reads `location.hash`, and if a `g` fragment is present: holds it in memory, immediately strips it via `history.replaceState`, and renders a **"Continue" interstitial button** that `POST`s `{ g }` to `/api/viewbook/[token]/auth/consume`, then `location.replace` to the clean URL. No auto-consume on load (RSC render can't set cookies; email security scanners prefetch links — though a fragment never reaches the server, the button keeps consume an explicit user action). With a live principal already present, the component clears the fragment and does nothing.
   - The existing matcher `/^\/viewbook\/[^/]+$/` needs no change (fragments/query strings aren't in `pathname`).

## 7. Auth endpoints (all under the ONE new matcher)

**`POST /api/viewbook/[token]/auth/request`** — body `{ email }`.
1. Preflight: `requireSameSite` + JSON + bounded body (reuse `public-write-guard` pieces).
2. Resolve token (unknown/revoked/archived-client → 404).
3. Normalize email (trim/lowercase); generate `requestId = crypto.randomUUID()`.
4. **One atomic array-form `$transaction` of two raw statements** (house `INSERT … SELECT` pattern, precedent `strategy-volume-ledger.ts`; integer-ms timestamps set manually):
   ```sql
   -- (a) guarded request-ledger insert — the rate limiter. Caps:
   --     cooldown: 0 rows for (viewbookId,email) within VIEWBOOK_AUTH_COOLDOWN_MS
   --     per-email volume: < VIEWBOOK_AUTH_EMAIL_HOURLY_CAP rows for email within 1 h (global, any viewbook)
   --     ledger flood floor: < VIEWBOOK_AUTH_LEDGER_HOURLY_CAP rows for viewbookId within 1 h (high; DB-flood guard ONLY)
   INSERT INTO "ViewbookAuthRequest" ("id","viewbookId","email","createdAt")
   SELECT :requestId, :vbId, :email, :now
   WHERE <the three predicates above>;

   -- (b) guarded delivery creation, fenced on (a) having landed AND the email being an invited member —
   --     this is where the REAL per-viewbook capacity cap lives, counted over ELIGIBLE deliveries so
   --     strangers can never exhaust members' capacity (Codex fix #4):
   INSERT INTO "ViewbookEmailDelivery" ("viewbookId","kind","recipient","dedupKey","memberId","createdAt")
   SELECT :vbId, 'magic-link', m."email", 'vb-magic-request:' || :requestId, m."id", :now
   FROM "ViewbookTeamMember" m
   WHERE m."viewbookId" = :vbId AND m."email" = :email
     AND EXISTS (SELECT 1 FROM "ViewbookAuthRequest" r WHERE r."id" = :requestId)
     AND (SELECT COUNT(*) FROM "ViewbookEmailDelivery" d
            WHERE d."viewbookId" = :vbId AND d."kind" = 'magic-link' AND d."createdAt" > :now - :hourMs)
         < :perViewbookHourCap;
   ```
   The delivery `dedupKey` is **`vb-magic-request:<requestId>`** — the request row is the durable identity; NO grant exists yet (grants are minted at send, §8). There is no crash gap: ledger row + delivery row commit together or not at all.
5. If the delivery row landed (post-txn `SELECT id … WHERE dedupKey = …`), enqueue `viewbook-email` for it (existing `enqueueViewbookEmail`). Enqueue failure is logged; the delivery row stands (the existing delivery-sweep/retry semantics apply).
6. **Response is ALWAYS the same 200** `{ ok: true }` — member or stranger, sent, capped, or cooled-down. No observable branch in status/body. The email-prompt UI shows "If this address was invited, a link is on its way."

**`POST /api/viewbook/[token]/auth/consume`** — body `{ g }`.
1. Same-site + JSON preflight; resolve token (unknown/revoked/archived → 404).
2. Compute `h = sha256Hex(g)`; mint the would-be session secret + hash up front.
3. **One atomic array-form `$transaction` of two raw statements with the IDENTICAL grant predicate** (an array txn cannot conditionally skip a later statement on an earlier result — Codex fix #2 — so BOTH statements carry the full guard; counts are asserted after commit):
   ```sql
   -- (a) session INSERT, guarded on the grant being live and owned by this viewbook:
   INSERT INTO "ViewbookMemberSession" ("memberId","tokenHash","expiresAt","createdAt")
   SELECT g."memberId", :sessionHash, :now + :sessionTtl, :now
   FROM "ViewbookAuthGrant" g
   JOIN "ViewbookTeamMember" m ON m."id" = g."memberId"
   WHERE g."tokenHash" = :h AND g."consumedAt" IS NULL AND g."expiresAt" > :now
     AND m."viewbookId" = :vbId;

   -- (b) grant consume-fence, same predicate:
   UPDATE "ViewbookAuthGrant"
   SET "consumedAt" = :now
   WHERE "tokenHash" = :h AND "consumedAt" IS NULL AND "expiresAt" > :now
     AND EXISTS (SELECT 1 FROM "ViewbookTeamMember" m
                   WHERE m."id" = "ViewbookAuthGrant"."memberId" AND m."viewbookId" = :vbId);
   ```
   Both statements run inside ONE SQLite transaction, so no concurrent consume can interleave between them — two simultaneous consumes produce exactly one session (test this). `(1,1)` counts → success: `Set-Cookie: vb_s_<id>=<rawSession>…`, 200. Anything else → uniform 401 `{ error: 'invalid_grant' }` (expired, consumed, wrong viewbook, unknown — one shape). The UI then falls back to the email prompt ("link expired — request a fresh one"), which is D3's always-works path.

**`POST /api/viewbook/[token]/auth/logout`** — resolve token → **regardless of principal kind**: read the `vb_s_<id>` cookie; if present, stamp `revokedAt` on the matching session row (by hash; expired/unknown rows no-op) AND clear the cookie; always 204. This handles expired sessions and operators who also carry a member cookie — logout never depends on resolving a `member` principal.

## 8. Invite + email — mint-at-send (pinned)

**All grant minting lives in the email job handler. Nothing else mints; no secret ever rests in the DB or job payload.** (The `payloadJson` alternative is rejected — secret-at-rest exposure.)

- `addTeamMember`/`resendInvite` (`lib/viewbook/team-members.ts`) keep creating `team-invite` deliveries — **now stamping the real `memberId`** on the delivery row for BOTH add and resend (today's SQL writes `memberId = NULL`; the handler needs it to mint).
- `runViewbookEmailJob` dispatch becomes **explicit per kind**: `team-invite` and `magic-link` take the grant path; `pc-complete`/`stage-change` keep plain token URLs; **an unknown kind suppresses with `logError` — never falls through to another builder**.
- Grant path, in order: load delivery → suppress (existing marker semantics) if notify dark, viewbook revoked, client archived, **or `memberId` null / member row gone** → mint a FRESH grant for `memberId` (`randomBytes` → row with `expiresAt = now + 7 d`) → build `${NEXT_PUBLIC_APP_URL}/viewbook/<token>#g=<raw>` → send → stamp `sentAt` (existing at-least-once contract). A retry after a sent-but-unstamped crash mints a second grant and sends a duplicate email — **documented, accepted** (same at-least-once window as D7; both links work, grants are single-consume). Failed attempts' unused grants age out via the §9 sweep.
- `team-invite` emails become magic-link emails (same builder family, `lib/notify/viewbook-email-content.ts`): subject stays "You've been invited to <client>'s onboarding viewbook"; body button "Open your onboarding viewbook" → grant URL; add a "link expires in 7 days — you can always request a fresh one from the viewbook page" line. `magic-link` kind gets its own builder ("Here's your sign-in link for <client>'s onboarding viewbook").
- **Verify during build:** fragment URLs survive the Mailgun template/client path intact (they should — fragments are client-side — but exercise a real send in smoke).

## 9. Revocation, removal, cleanup

- **Member removal** (new — roadmap: "member removal doesn't exist today"): `DELETE /api/viewbooks/[id]/team-members/[memberId]` (admin namespace, cookie-gated via `requireOperatorEmail`). ONE array-form `$transaction`: (a) EXISTS-fenced syncVersion bump, (b) `ViewbookActivity` insert (removal, operator attribution), (c) `deleteMany({ id: memberId, viewbookId })` — FK cascade deletes grants + sessions → the removed member's cookie dies on next request (and any in-flight write dies on its §5 commit-time fence). 404 on 0-row delete.
  - Admin UI: `getViewbookAdmin` does NOT load team members today — extend the loader/type to include the roster and add a remove button (minimal list; U2's grid refines it). Note the first-member bootstrap flow stays the public `pc-invite` form (operators can use it — they hold `canWrite`); called out for Kevin in §11-adjacent verification, not changed here.
- **Token rotate/revoke** (existing `POST/DELETE /api/viewbooks/[id]/token`): unchanged. Sessions key off `viewbookId`, so rotation does NOT log members out (correct: rotation re-secrets the URL namespace, membership is now the real gate). Viewbook revoke (`revokedAt`) already 404s everything at the token gate.
- **runCleanup sweeps** (`lib/cleanup.ts`, one new entry): delete grants `expiresAt < now − 7 d` OR `consumedAt < now − 7 d`; delete sessions `expiresAt < now` OR `revokedAt < now − 7 d`; delete `ViewbookAuthRequest` rows `createdAt < now − 48 h`.

## 10. Write attribution (member identity)

Attribution has THREE verified consumers that break under a naive "replace `'client'` with an email" (Codex fix #8): `digest.ts` selects activity by `actor = 'client'`; `MaterialsSection` renders any non-`'client'` `addedBy` as ER-authored; `proposeAmendment` reuses one string for activity actor AND amendment author. Therefore:

- **`ViewbookActivity` gains a durable `actorKind` discriminator** (`'client' | 'member' | 'operator' | 'system'`; additive column, backfilled in the migration: existing `'client'` actors → `'client'`, everything else → `'operator'`). `actor` keeps the identity string (member email / operator email / `'client'` for legacy). `digest.ts` switches its filter from `actor = 'client'` to `actorKind IN ('client','member')` — member activity keeps flowing into digests.
- **Activity actor and display author become SEPARATE parameters** where they're conflated today: `proposeAmendment`/`applyAnswerEdit` gain `{ actorEmail, authorName }` — `ViewbookFieldAmendment.author` and feedback authorship get the member's **name** (display), `valueUpdatedBy`/`ViewbookActivity.actor` get the member's **email** (identity). Feedback ignores the client-claimed `authorName` body field when a member principal exists; `authorKind` stays `'client'` (U4 owns the full `authorKind`/`authorNameSnapshot` restructure — U1 must not paint it into a corner, and a separate name/email split is exactly what U4 formalizes).
- **`MaterialsSection` attribution goes member-aware**: `addedBy` stores the member email; the component's ER-vs-client branch keys off membership (or a passed kind), not `!== 'client'` — a member email must render as client-side, not ER.
- `operator`/`dev` principals on the public routes attribute with their email (dev = `dev@localhost`); operators normally write via `/api/viewbooks/[id]/*` (unchanged).
- U1 does NOT restructure history rows — U4 owns that. U1 replaces the hardcoded `'client'` literals at call sites, adds `actorKind`, and audits every `=== 'client'` / `!== 'client'` comparison in `lib/viewbook/` + `components/viewbook/` (the three above are the known ones; the audit is an acceptance item).

## 11. §9 Q6 — break-glass (**CONFIRMED by Kevin 2026-07-22: read-only member-equivalent**, as recommended below)

Break-glass sessions (valid `er_auth`, `email: null` — the `APP_AUTH_PASSWORD` path) get **read-only member-equivalent access**: they can VIEW any viewbook (they hold the ER app password; locking them out of viewing is theater) but get NO operator layer and NO public-route writes (a write needs an attributable identity; break-glass has none). This matches today's behavior where break-glass is already not an operator on viewbook surfaces, and it keeps the U1 attribution contract total ("every write has a name"). If Kevin wants full exemption instead, the change is `canWrite` including `break-glass` + a fixed `'er-staff'` attribution string — one file. Acceptance criterion 10 tests the RECOMMENDED behavior; flip it with the decision if Kevin overrides.

## 12. Config

No new REQUIRED env. Optional tuning (defaults in code, `lib/viewbook/auth-config.ts` or equivalent):
- `VIEWBOOK_AUTH_COOLDOWN_MS` (default 60 000) — per (viewbook,email) resend cooldown
- `VIEWBOOK_AUTH_EMAIL_HOURLY_CAP` (default 6) — global per-address ledger cap
- `VIEWBOOK_AUTH_VIEWBOOK_HOURLY_CAP` (default 30) — per-viewbook cap on ELIGIBLE magic-link deliveries (§7 step 4b)
- `VIEWBOOK_AUTH_LEDGER_HOURLY_CAP` (default 200) — per-viewbook ledger flood floor (DB protection only; strangers hit this, never the delivery cap)
- Grant TTL 7 d and session TTL 60 d are code constants (decision-pinned, not env).
- Dark-notify environments (`isNotifyEnabled()` false): `auth/request` still 200s uniformly; the delivery row is created and suppressed exactly like other viewbook emails. Magic-link auth is therefore only usable where Mailgun is configured — acceptable: prod has it, dev has `isAuthBypassedInDev()`.

## 13. Out of scope (owned elsewhere)

- Invite grid UX (U2). Field assignment + digests (U3). Revision history/lock removal (U4).
- Any change to `STAGE_LINEUPS`, templates, or the viewer beyond the landing branch (F-track).
- Rate limiting on `auth/consume` beyond the uniform-401 (grants are 256-bit; brute force is not a practical surface — but consume IS same-site-fenced).

## 14. Acceptance criteria

1. Anonymous GET `/viewbook/<token>` renders the email prompt; the response contains NO viewbook data (assert on serialized flight payload: no client name/theme/sections) and `loadViewbookPublicData` is not invoked (spy/unit). Archived-client and revoked tokens still 404 (page and every API route) — never the prompt.
2. Full round-trip: invite → email job mints grant at send → `#g=` fragment interstitial (fragment stripped from the URL bar before consume) → consume sets `vb_s_<id>` cookie → clean URL renders the viewbook; second consume of the same grant → 401; **two concurrent consumes → exactly one session row** (the §7 txn test).
3. Expired grant → 401 → email re-request issues a fresh link (D3: expiry never strands an invited member).
4. Every `/api/viewbook/[token]/*` route 404s without a principal and works with (a) member cookie, (b) `er_auth` operator, (c) dev-bypass. Tests enumerate ALL routes (assets, sync, feedback, materials, answers, ack, team-members, setup, auth/logout). Asset responses carry `private, no-store`.
5. Per-viewbook isolation: sessions/cookies for viewbook A grant nothing on viewbook B (same email invited to both → two cookies, each scoped).
6. Rate limiting: second request inside the cooldown inserts no ledger row, creates no delivery, same 200 body; stranger emails NEVER consume the per-viewbook delivery cap (fill the ledger with strangers → a member request still gets a delivery); caps hold under concurrency (the guarded INSERTs are the only writers).
7. Mint-at-send: no grant row exists between request and job execution; suppression paths (dark, revoked, archived, member deleted, null memberId) mint nothing; unknown delivery kind suppresses with a log, never sends another kind's content.
8. Member removal: ONE txn (bump + activity + delete); cascade kills grants + sessions; the removed member's next request 404s; an in-flight member write racing the removal affects 0 rows (commit-time fence test).
9. Attribution: member answers PATCH → `valueUpdatedBy` = member email, amendment `author` = member name, activity row `actorKind = 'member'` + `actor` = email; digests include member activity; `MaterialsSection` renders member-added materials as client-side; the `=== 'client'` comparison audit is complete.
10. Operator behavior unchanged (er_auth email → operator layer); break-glass sees the read-only view and every write path rejects it (per §11 recommendation — flip with Kevin's decision).
11. Cleanup sweep deletes expired grants/sessions/request rows and nothing live.
12. Middleware: exactly one new matcher with the explicit `(?:request|consume|logout)` tail; `npx tsc --noEmit` + full vitest + build green.

## 15. Test-surface notes for the builder

- House test conventions: vitest, per-file local `mkViewbook()` helpers, DB-backed tests use the `.test-dbs` pattern; middleware matcher tests live in `middleware.test.ts` (extend the existing viewbook describe blocks).
- `createViewbook(clientId, kind, createdBy)` is 3-arg.
- Array-form `$transaction` ONLY; conditional writes are raw `INSERT…SELECT`/guarded `UPDATE` with manual integer-ms timestamps (raw SQL bypasses `@updatedAt`).
- Never log or `.toString()` raw secrets; log grant/session/request ids only.
- Smoke after deploy: one real Mailgun send to confirm the `#g=` fragment survives the email client path (§8).
