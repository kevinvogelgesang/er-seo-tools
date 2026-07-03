---
name: er-seo-tools-extension-recipes
description: Use when adding anything new to er-seo-tools — an API route, a durable job type, a Screaming Frog CSV parser, a Prisma schema migration, a scheduled task, a public share page, a skill-handoff token family (pat_/srt_/krt_/qct_ style), an env var, or a React page/component. Also use when hitting 401 auth_required on a new route, a parser whose data vanishes in prod, a P2002 on enqueue, or "cadence_not_allowed" errors.
---

# Extension recipes — er-seo-tools

## Overview

Step-by-step checklists for the nine most common ways this codebase gets extended.
Every recipe names a real exemplar file to copy from, the gate it must pass, and the
gotcha that has already bitten someone. Copy the exemplar, don't invent a new shape.

**Universal gate** (run before any push; there is no CI for tests/type-check/build):

```bash
npm run lint                                    # = tsc --noEmit (no eslint exists)
DATABASE_URL="file:./local-dev.db" npm test     # vitest run; DB tests fail without the inline env
npm run build
```

**Landing path:** push the branch, open the PR, then merge/deploy per the
gate-green pipeline in `er-seo-tools-change-control` rule 1 (2026-07-03 ruling:
autonomous when gates are re-run green; destructive server ops stay Kevin-gated).

## When to use / when NOT to use

Use this skill when you are **adding** one of the nine things below.

- Debugging existing behavior → `er-seo-tools-debugging-playbook`
- What env vars exist and their prod values → `er-seo-tools-config-and-flags`
- Why an invariant exists (design rationale) → `er-seo-tools-architecture-contract`
- How changes are classified/reviewed/deployed → `er-seo-tools-change-control`
- Test conventions and what counts as evidence → `er-seo-tools-validation-and-qa`
- Getting a dev environment running at all → `er-seo-tools-build-and-env`

---

## Recipe 1 — Add an API route

**Decide the auth class first.** The middleware cookie-gates *everything* by default;
you only touch `middleware.ts` for the other two classes.

| Class | When | What to do |
|---|---|---|
| Cookie-gated (default) | Internal dashboard UI calls it | Nothing — just create the route |
| Token-authed | An external Claude skill calls it with a `Bearer <prefix>_...` JWT | Add a regex to `isPublicPath` in `middleware.ts` + verify JWT in the handler (Recipe 7) |
| Public | Anonymous share/consent pages | Add to `PUBLIC_PATH_PREFIXES` or `PUBLIC_EXACT_PATHS` in `middleware.ts` |

Steps:

1. Create `app/api/<path>/route.ts`. Exemplar (cookie-gated POST with full input
   hygiene): `app/api/site-audit/route.ts`. Exemplar (token-authed GET):
   `app/api/seo-roadmap/[id]/route.ts`.
2. **Body parsing convention:** wrap `await request.json()` in try-catch → 400
   `{ error: 'Invalid JSON body' }` (or `invalid_json`). Never let a malformed body 500.
   Same for any `JSON.parse` of DB blob columns.
3. Next 15 dynamic params are async: `{ params }: { params: Promise<{ id: string }> }`
   then `const { id } = await params`.
4. If (and only if) the route must bypass the cookie gate, add the exact-match regex or
   prefix to `middleware.ts` — **and add a `middleware.test.ts` case. This is MANDATORY:
   three separate historical incidents were external callers getting 401 `auth_required`
   because the allowlist entry was missed.** Mint-token and poll routes stay cookie-gated.
5. **CSRF ordering fact:** in `middleware.ts` the `isPublicPath` check returns *before*
   the CSRF guard, so public/token routes never see the same-site check. A **cookie-gated
   mutating** route called cross-site gets 403 `cross_site_request_blocked` — that is by
   design, not a bug to fix.
6. Write a route test: import `GET`/`POST` directly and call with `new NextRequest(url)`.
   Either hit the real dev DB with prefix-scoped rows, or `vi.mock('@/lib/db', ...)`
   **before** the route import (exemplars: `app/api/site-audit/route.test.ts` DB-backed;
   `app/api/keyword-memo/[id]/route.test.ts` mocked).

**Gate:** `npx vitest run middleware.test.ts` (passes with no env) + the universal gate.
**Gotcha:** share URLs must come from `process.env.NEXT_PUBLIC_APP_URL`, never the
request origin (reverse proxy makes `request.url` a localhost lie).

---

## Recipe 2 — Add a durable job type

Everything long-running goes through the Job queue (`lib/jobs/`). Exemplar to copy:
`lib/jobs/handlers/report-render.ts` — it shows the full canonical shape in 94 lines.

1. Create `lib/jobs/handlers/<name>.ts` exporting:
   - `export const <NAME>_JOB_TYPE = '<name>'`
   - a payload interface + `assertPayload()` that throws on malformed payloads
   - `run<Name>Job(payload: unknown)` — the handler
   - optional `on<Name>Exhausted(payload, ctx)` — domain hook when attempts are burned
   - `register<Name>Handler()` calling `registerJobHandler({ type, concurrency,
     maxAttempts, backoffBaseMs, timeoutMs, handler, onExhausted })`
2. Import and call `register<Name>Handler()` in `lib/jobs/handlers/register.ts` — this
   file is **the single truthful registry** (13 types as of 2026-07-02; the schema
   comment on `Job.type` is stale, never trust it).
3. **Handler contract:** idempotent under re-run (timed-out zombie attempts keep
   running); every domain write conditionally claimed / status-fenced; deleted-target
   rows are clean no-ops (return, don't throw — a throw burns a retry); array-form
   `$transaction([...])` only, never interactive; manual `updatedAt = Date.now()` in
   any raw SQL.
4. **Key discipline:**
   - `dedupKey`: `'<type>:<id>'` — active-window dedup (partial unique index over
     queued/running). P2002 on enqueue does NOT guarantee a visible twin;
     `enqueueJob()` already handles that race — use it, don't hand-roll.
   - `groupKey`: **`site-audit:<id>` means "this audit is alive" to recovery.** A job in
     that group on a non-terminal audit blocks recovery from ever failing it. Never
     reuse it for unrelated work — `report-render` deliberately uses `report:<id>`.
     (`broken-link-verify` is the one sanctioned exception: enqueued only post-terminal.)
5. If the job recurs on a timer, add a `SYSTEM_SCHEDULES` entry (Recipe 5).
6. Write a handler test next to it (every existing handler has one).

**Gate:** `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs` + universal gate.
**Gotcha:** a new handler that *statically* imports `lib/ada-audit/queue-manager`
usually creates an import cycle (worker → handlers → queue-manager → jobs/queue →
worker). Existing handlers use `await import(...)` at the call site — copy that.

---

## Recipe 3 — Add a CSV parser

Exemplar: `lib/parsers/seoElements/h1.parser.ts` (small, complete). Registry:
`lib/parsers/index.ts`.

1. Create the parser extending `BaseParser`. Declare **both** statics:
   - `static parserKey = '<key>'` — an **explicit string literal**, exactly
     `ClassName.replace('Parser','').toLowerCase()`. This is non-negotiable: the parse
     route once derived the key from `ParserClass.name`, prod minification mangled class
     names, and `parsedData.<key>` lookups silently returned empty — page_index and
     keyword data vanished *in prod only*. `lib/parsers/parser-key.test.ts` enforces
     presence, exact canonical value, and uniqueness.
   - `static filenamePattern = '<substring>'` (or array) — matched case-insensitively
     as a **bare substring** of the filename.
2. **Check for substring collisions before choosing position.** Order in the `PARSERS`
   array is load-bearing; three past collisions are documented inline:
   `InsecureContentParser` must precede `UrlIssuesParser`/`SecurityParser` (else
   `security_*_insecure.csv` is swallowed); `PageSpeedOpportunitiesParser` before
   `PageSpeedParser`; SEMRush content-detected parsers last, in their fixed order.
   Grep existing patterns: `grep -rn "filenamePattern" lib/parsers`.
3. Add the class to **both** `PARSERS` (ordered array) and `PARSER_MAP` (key → class)
   in `lib/parsers/index.ts`.
4. Use the shared masks from `BaseParser` (`getIndexableHtmlMask()` etc.) and
   `findColumn(['Address', 'URL'])` for column lookup — never index raw headers.
5. If the aggregator should consume the output, wire `this.parsedData.<parserKey>`
   reads in `lib/services/aggregator.service.ts` (see how `accessibility` / `images`
   are read there). Cap URL sample lists (~20–50) like existing parsers.
6. Dynamic-filename sources (SEMRush-style) override `matchesRawContent`/
   `matchesContent` instead of `filenamePattern` and go at the END of `PARSERS`.

**Gate:** `DATABASE_URL="file:./local-dev.db" npx vitest run lib/parsers` — this runs
`parser-key.test.ts` (minification guard) and `index.routing.test.ts` (detection
routing).
**Gotcha:** the parser-key test asserts the key equals the un-minified name derivation
— naming the key freely (e.g. `'h1_headings'` on `H1Parser`) fails the suite.

---

## Recipe 4 — Schema migration

1. Edit `prisma/schema.prisma`. (No enums exist in this schema — status/type unions
   are comments on `String` fields; follow that convention.)
2. `npx prisma migrate dev --name <name>` — creates the migration and regenerates the
   client. Stop the dev server first: `migrate dev` fails while it holds the SQLite lock.
   **Non-interactive-session caveat** (per the 2026-06-30 plan + change-control):
   `migrate dev` can prompt and hang in a non-interactive session — if it does,
   author the migration SQL by hand in `prisma/migrations/<timestamp>_<name>/migration.sql`
   and apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy`,
   then `npm run db:generate`.
3. Commit the migration folder with the schema change. Production applies it via
   `prisma migrate deploy` inside the deploy script — you never migrate prod by hand.
4. **SetNull vs Cascade decision guide** (the pattern is consistent — copy it):
   - **SetNull**: cross-tree "origin" or attribution links, where the child must survive
     the parent's deletion. Examples: `CrawlRun.sessionId/siteAuditId/adaAuditId`
     (findings outlive pruned origins), `SiteAudit.scheduleId`, and `clientId` on
     historical artifacts (`Session`, `AdaAudit`, `SiteAudit`, `CrawlRun`).
   - **Cascade**: true ownership inside one subtree, where the child is meaningless
     without the parent. Examples: `CrawlPage`/`Finding`/`Violation` from `CrawlRun`;
     child `AdaAudit`/`PdfAudit` rows from `SiteAudit`; `ShareLink` from `Session`;
     and — careful — `clientId` on client-owned config/outputs (`Schedule`,
     `QuarterAssignment`, `SeoReport`, `ProspectsEntry`) CASCADES from `Client`.
     The rule is attribution-vs-ownership, not "clientId is always SetNull".
5. **Partial indexes need raw SQL** — Prisma cannot express `WHERE` clauses. Append
   them to the generated `migration.sql` by hand. Exemplar:
   `prisma/migrations/20260610173014_job_queue_and_schedule/migration.sql` (the
   `jobs_active_dedup` unique index `WHERE "dedupKey" IS NOT NULL AND "status" IN
   ('queued','running')`).
6. Runtime rules that follow from SQLite: array-form `$transaction([...])` only
   (interactive transactions caused the 2026-06-10 write-lock starvation incident);
   raw SQL bypasses `@updatedAt` so set `"updatedAt" = ${Date.now()}` manually
   (storage is integer ms); `createMany` has no `skipDuplicates` (per-row create with
   P2002 catch); chunk bulk writes at 50 (999-bind-variable limit).
7. Think twice before adding `@updatedAt` to `AdaAudit`/`PdfAudit` "for consistency" —
   their recovery deliberately uses Job-group liveness, not a heartbeat column.

**Gate:** migration applies on a fresh clone (`npx prisma migrate dev`), universal gate.
**Gotcha:** the tests share ONE real SQLite dev DB serially — a migration that breaks
a unique index other tests rely on (e.g. the one-open-`AuditBatch` partial index)
surfaces as unrelated-looking test failures.

---

## Recipe 5 — Add a scheduled task

**Decide ownership first:**

| Kind | Mechanism | Exemplar |
|---|---|---|
| System maintenance (code-owned) | Entry in `SYSTEM_SCHEDULES`, `lib/jobs/system-schedules.ts` | the 3 existing entries |
| Operator/client-configured | Plain `Schedule` row created by an API route (`name: null` for client schedules) | `app/api/clients/[id]/schedules/route.ts` |

Steps for a system schedule:

1. Add `{ name: 'system-<x>', jobType, cadence, immediate }` to `SYSTEM_SCHEDULES`.
   `system-` is a reserved namespace; the seed re-enables manual DB disables every boot
   (kill switch = env flag, never DB mutation).
2. The job type must exist (Recipe 2). `immediate: false` if boot already covers the
   first run (see the `system-cleanup` comment).
3. If you ever RENAME/REMOVE a system schedule, the retired-name sweep in
   `seedSystemSchedules` disables it and cancels its queued jobs — that's automatic,
   but only because retirement is detected by the `system-` prefix. Don't bypass it.

Mechanics you get for free (`lib/jobs/scheduler.ts`):

- **Cadence grammar:** `every:<n>m|h|d`, `daily@HH:MM`, `weekly:<0-6>@HH:MM`,
  `monthly:<1-28>@HH:MM` (day-of-month capped at 28 to avoid month overflow).
  Times are server-local (prod runs UTC).
- **Exactly-once-per-slot:** `@@unique([scheduleId, scheduledFor])` on Job survives
  terminal status; a crash between enqueue and nextRunAt-advance replays the slot into
  the unique index harmlessly. Missed slots collapse (a week down → one run).

**Gate:** `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs` + universal gate.
**Gotcha:** client scan schedules reject `daily@`/`every:*` with 400
`cadence_not_allowed` — that's a retention-volume decision (blobs within the 14-day
window), not a parser bug. Only literal `weekly:`/`monthly:` are allowed there.

---

## Recipe 6 — Add a client-facing share surface

Pattern: nullable unique token on the model, mint route, public page, cleanup. Exemplars:
`app/api/site-audit/[id]/share/route.ts` (mint/read/revoke),
`app/ada-audit/site/share/[token]/page.tsx` (public page),
`cleanExpiredSiteAuditShareTokens` in `lib/cleanup.ts`.

1. Schema: `shareToken String? @unique` + `shareExpiresAt DateTime?` (Recipe 4).
2. Mint route (cookie-gated POST): only share terminal/complete rows; token =
   `crypto.randomUUID()`; TTL 30 days; re-POST returns the existing valid token with a
   refreshed expiry (rotate only when expired). Build the URL from
   `NEXT_PUBLIC_APP_URL` — never request origin.
3. Public page at `/<feature>/share/[token]` + any public API it needs under
   `/api/share/` or a feature share path. Add the path prefix to
   `PUBLIC_PATH_PREFIXES` in `middleware.ts` **+ middleware.test.ts case** (Recipe 1
   step 4 — mandatory).
4. Resolve token → row server-side; expired or null token → not-found, never an error
   that leaks existence.
5. **shareMode rendering constraint:** the public page renders the results component
   with a `shareMode` prop that must disable EVERY cookie-gated fetch — no row
   expansion, no triage, no internal links (see the `shareMode` guards in
   `components/ada-audit/SiteAuditResultsView.tsx`). A public viewer holding no cookie
   gets 401s on any forgotten fetch.
6. Cleanup: add a `cleanExpired<X>ShareTokens()` (null token + expiry past) and wire it
   into `runCleanup()` in `lib/cleanup.ts`.

**Gate:** `npx vitest run middleware.test.ts` + load the share URL in a logged-out
browser/incognito profile locally.
**Gotcha:** the middleware allowlist covers the *page*, but every API the page's client
components call needs its own public path — the three historical 401 incidents were
exactly this shape.

---

## Recipe 7 — Add a skill-handoff token family

The pattern behind `pat_`/`srt_`/`krt_`/`qct_`: a dashboard button mints a short-lived
JWT + clipboard payload; an external Claude skill uses the token to GET a structured
export and PATCH a document back. Copy the seo-roadmap family end to end.

**The four-route shape** (exact split matters):

| Route | Auth | Exemplar |
|---|---|---|
| POST mint-token | cookie-gated | `app/api/seo-roadmap/by-session/[sessionId]/mint-token/route.ts` |
| GET by-session poll | cookie-gated | `app/api/seo-roadmap/by-session/[sessionId]/route.ts` |
| GET payload | public, Bearer JWT verified in handler | `app/api/seo-roadmap/[id]/route.ts` |
| PATCH write-back | public, Bearer JWT verified in handler | `app/api/seo-roadmap/[id]/roadmap/route.ts` |

1. Token module `lib/<feature>-token.ts` (copy `lib/seo-roadmap-token.ts`): HS256 via
   `jose`, 1h expiry, issuer `er-seo-tools`, per-feature audience, `sub` = resource id,
   `scope` array, and a **new unique token prefix** (`xxx_`) prepended to the JWT.
   Secret from `<FEATURE>_TOKEN_SECRET`: **throw in production when unset** (mint
   returns 500 `token_service_unavailable`), dev fallback constant with a one-time warn.
2. Mint route: cookie-check explicitly (`isValidAuthCookie`), get-or-create the resource
   row catching only P2002, mint, stamp status/`tokenMintedAt`.
3. Payload/write-back routes: parse `Authorization: Bearer <prefix>_...` with a regex,
   verify sub-binding against the URL id, check scope, map verification failures to
   stable error codes (`token_expired`, `token_invalid_signature`, ...) — see
   `tokenErrorCode()` in the exemplar.
4. **Middleware:** add exactly the two public routes as regexes in `isPublicPath`
   (`middleware.ts`) + middleware.test.ts cases. Mint + poll stay cookie-gated.
5. Prompt composer `lib/<feature>-prompt.ts` producing the locked clipboard contract —
   `Webapp: {url}`, `{X} ID: {id}`, `Access token: {prefix}_...` lines
   (`docs/pillar-prompt-contract.md`); the consuming skill's regexes depend on it.
6. **Boot-guard decision:** as of 2026-07-02 only `PILLAR_TOKEN_SECRET` is checked at
   startup in `instrumentation.ts`; the other three fail lazily at mint time. Lazy
   failure is the current house pattern for new families — add a boot guard only if a
   dead mint button in prod is unacceptable for your feature, and say so in the PR.
7. Update the consuming skill (`skills/er-handoff-memo/` in this repo is the source)
   to recognize the new prefix.

**Gate:** `npx vitest run middleware.test.ts` + a curl of the GET payload route with a
locally-minted token.
**Gotcha:** forgetting the middleware regex is THE classic failure — the external skill
gets 401 `auth_required` from the cookie gate before your token code ever runs.

---

## Recipe 8 — Add an env var / config flag

Full catalog, defaults, and prod values: `er-seo-tools-config-and-flags`. The recipe:

1. Read it in exactly one module with an inline default:
   `Number(process.env.MY_KNOB ?? '4')` — that module is the knob's home.
2. Decide where the prod value lives: **audit-safety/concurrency knobs go in
   `ecosystem.config.js`** (deliberate — `pm2 env` then proves what the worker uses);
   secrets go in the server `.env` (never the repo); pure-dev values in `.env.local`.
3. If the app is unsafe without it in prod, add a fail-fast to the startup checks in
   `instrumentation.ts` (pattern: `PILLAR_TOKEN_SECRET`, auth config, Chromium egress
   guard). Remember: a missing required env crash-loops PM2 even when the build is fine.
4. Note that code defaults intentionally differ from prod in places (pool 2 vs 4,
   PSI 6 vs 15, lighthouse `local` vs `pagespeed`) — don't "fix" the mismatch.

**Gate:** universal gate; grep that the var is read in only one place.
**Gotcha:** `NEXT_PUBLIC_*` vars are inlined at **build time** into client components —
changing them requires a rebuild, not a PM2 restart.

---

## Recipe 9 — Add a React component/page

1. **Thin server page + client component.** The page (`app/<route>/page.tsx`) is an
   async server component: await params, validate, fetch via `lib/services/*`, render
   components. All state/polling/interaction lives in `'use client'` components under
   `components/<feature>/`. Exemplar: `app/clients/[id]/page.tsx` + `components/clients/`.
2. **Dark mode** — Tailwind class-based; every surface needs `dark:` variants:

   | Light | Dark |
   |---|---|
   | `bg-white` | `dark:bg-navy-card` |
   | `text-gray-*` | `dark:text-white` / `dark:text-white/70` |
   | `border-gray-*` | `dark:border-navy-border` |
   | hover `bg-gray-50` | `dark:hover:bg-navy-light` |
   | status `bg-green-100` etc. | `dark:bg-green-500/20` (semantic color at opacity) |

   Theme-dependent rendering must wait for `mounted` from `ThemeProvider` (hydration).
3. **Dates:** render with `components/ClientDate.tsx` (browser-TZ, hydration-safe —
   shows the ISO date slice until mounted). Never `toLocaleString` in a server component.
4. **Polling:** poll-until-status-change UIs poll the GET-by-id API on an interval
   (AuditPoller 1s, SiteAuditHistory 8s smart-poll). For "poll until an external writer
   updates a row" (memo write-backs), reuse `createPollingMachine` in
   `lib/memo-poller-machine.ts` — pure state machine with visibility pause + lifetime
   cap; exemplar consumer `components/seo-parser/SeoRoadmapCard.tsx`.
5. **Recharts must be lazy-loaded** via `next/dynamic` with `ssr: false` (SSR breaks
   it). Exemplar: chart imports at the top of `components/seo-parser/ResultsView.tsx`.
6. **Component tests:** first line `// @vitest-environment jsdom` (global vitest env is
   node), import `describe/it/expect` from `'vitest'` (globals off), React Testing
   Library. Exemplar: any `components/**/*.test.tsx`.

**Gate:** universal gate; view the page in both themes locally (`npm run dev`).
**Gotcha:** a client component that renders server-formatted dates or theme-dependent
markup without the mounted guard produces hydration-mismatch warnings that look like
random text flicker.

---

## Common mistakes (cross-recipe)

- Touching `isPublicPath` without a `middleware.test.ts` case — the single most
  repeated incident class in this repo (three times).
- Interactive `prisma.$transaction(async tx => ...)` anywhere — banned; array-form only.
- Reusing group key `site-audit:<id>` for a job unrelated to audit liveness.
- A parser without an explicit `static parserKey`, or a key that isn't the canonical
  lowercase class-name derivation.
- Forgetting manual `updatedAt = Date.now()` in raw SQL that touches `SiteAudit` — the
  stale sweep will kill healthy audits at the 5-minute mark.
- Running `npm test` without `DATABASE_URL="file:./local-dev.db"` and concluding the
  DB is broken ("Error code 14: Unable to open the database file").
- Live-scanning third-party sites in dev tests. Only client sites already in the system
  or domains you control — audits fetch real external websites.
- Skipping the docs rituals: tracker checkbox + dated status log + handoff rewrite in
  the same commit, and Codex review for specs/plans, are mandatory (see
  `er-seo-tools-docs-and-writing` and `er-seo-tools-change-control`).

## Provenance and maintenance

Written 2026-07-02 against branch `feat/autonomous-live-seo-source` (HEAD 36de2cb,
23 commits ahead of main, not merged, not deployed). All exemplar paths verified to
exist on that branch. The recipes themselves are merge-state-stable; the `seoIntent`
fields visible in `app/api/site-audit/route.ts` and the client-schedules route are
branch-only work (not on main as of this date).

Re-verify volatile facts before relying on them:

- Middleware allowlist + CSRF ordering: `sed -n '5,90p' middleware.ts`
- Registered job types (13 as of 2026-07-02): `grep -n register lib/jobs/handlers/register.ts`
- Parser registry + ordering comments: `sed -n '67,145p' lib/parsers/index.ts`
- Parser-key enforcement: `npx vitest run lib/parsers/parser-key.test.ts`
- System schedules (3 entries): `sed -n '29,37p' lib/jobs/system-schedules.ts`
- Cadence grammar: `sed -n '15,60p' lib/jobs/scheduler.ts`
- Share TTL (30 d) + token rotation: `sed -n '1,60p' 'app/api/site-audit/[id]/share/route.ts'`
- Token-family boot guards (only PILLAR today): `grep -n TOKEN_SECRET instrumentation.ts`
- Migration count / latest (39 dirs, latest `20260630120000_live_seo_source`): `ls -d prisma/migrations/*/ | wc -l && ls prisma/migrations | tail -2`
- npm scripts (lint = tsc --noEmit, build heap bump): `grep -n '"lint"\|"build"\|"test"' package.json`
- Branch vs main state: `git branch --show-current && git log main..HEAD --oneline | wc -l`
