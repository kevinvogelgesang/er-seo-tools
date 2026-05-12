# Hardening Next Chat Handoff

## Repo And Context

- Repo: `/Users/kevin/enrollment-resources/Claude/er-seo-tools`
- Date: 2026-05-12
- Current worktree has a large uncommitted hardening batch. Do not revert it.
- Local/generated untracked files intentionally left alone:
  - `.claude/`
  - `local-uploads/`
  - `prisma/local-dev.db*`

## What Was Completed In This Batch

- Tooling:
  - `npm run lint` now runs `tsc --noEmit`.
  - Vitest excludes `.claude/worktrees`, local uploads, and local SQLite DB files.

- App auth:
  - Added password-gated app auth using `APP_AUTH_PASSWORD`.
  - Added signed HttpOnly cookie auth with server-side expiry.
  - Added `/login`, `/api/auth/login`, `/api/auth/logout`, middleware, logout UI, `.env.example`, README docs, and production fail-fast in `instrumentation.ts`.
  - Middleware protects app/API routes by default.
  - Public paths intentionally include SEO share pages/routes, ADA share pages, auth routes, and bearer-token pillar machine endpoints.

- Pillar token minting:
  - `POST /api/pillar-analysis/[id]/mint-token` now checks the app auth cookie.
  - Bearer-token skill endpoints remain public but still require valid scoped JWTs.

- SSRF/network safety:
  - Added `lib/security/safe-url.ts`.
  - `app/api/fetch-url/route.ts`, sitemap crawler, and ADA runner now use shared safe URL checks.
  - Added manual redirect validation, bounded response reads, private/internal host blocking, and broader reserved IP blocking.
  - ADA runner now blocks unsupported browser request protocols; only `http:`, `https:`, `data:`, `blob:`, and `about:` are allowed through request interception.
  - Sitemap discovery now filters robots sitemap URLs and child sitemap URLs to the audited domain before fetching.

- Upload/parse robustness:
  - Upload quota is reserved before `request.formData()`.
  - Upload appends to existing sessions only when status is `pending`.
  - Corrupt session file manifests are rejected instead of silently overwritten.
  - Parse only claims `pending` sessions.
  - Parse rejects corrupt/empty file manifests.
  - Parse reads/parses files sequentially instead of all at once.

- Cleanup/delete:
  - SEO session delete removes DB row first, then cleans upload artifacts with settled cleanup.
  - ADA audit delete and site audit delete clean screenshot artifacts without failing the user-facing delete.
  - Scheduled cleanup removes old orphan upload dirs and orphan/expired screenshot dirs more robustly.

- Parser/result correctness:
  - Fixed capped-array undercounting in internal parser and duplicate parser/aggregator paths.
  - Added duplicate count fields through types/UI.
  - Hardened SEO result page against corrupt stored result JSON.
  - Fixed exact duplicate similarity parsing for `98%`/`100%`.

- ADA share view:
  - Public ADA share page is read-only now.
  - It no longer renders authenticated share/rescan controls or screenshot-backed issue details.

- DNS rebinding/IP pinning:
  - `safeFetch()` now uses a Node `http`/`https` transport with a DNS lookup callback pinned to the address set that passed SSRF validation.
  - Redirect hops are revalidated and repinned before they are followed.

- ADA share token expiry:
  - Added `AdaAudit.shareExpiresAt`, migration, route minting/rotation, public share-page expiry enforcement, and cleanup for expired ADA share tokens.

- Remaining hardening pass:
  - Added Chromium production egress guard configuration: `CHROME_PROXY_SERVER` support and startup fail-fast unless a proxy or `CHROMIUM_EGRESS_GUARD_CONFIRMED=true` is configured.
  - Added `UPLOAD_MAX_BODY_BYTES` request cap before `request.formData()`.
  - Added Origin/Sec-Fetch-Site validation to logout POST.
  - Added cleanup for old complete-session upload directories once no pillar analysis is pending/running.

## Validation Already Run

Latest passing commands:

```bash
npm test -- --reporter=dot
npm run build
npx tsc --noEmit
npm test -- lib/security/safe-url.test.ts 'app/api/ada-audit/[id]/share/route.test.ts' lib/cleanup.test.ts --reporter=dot
```

Latest results:

- Tests passed: 69 files, 1025 tests.
- Build passed with middleware included.
- Typecheck passed after adding this handoff doc.
- Focused DNS/ADA tests passed: 3 files, 16 tests.
- Latest tests passed after remaining hardening pass: 72 files, 1034 tests.
- Focused remaining hardening tests passed: 4 files, 12 tests.

## Remaining Priority Work

1. Final full audit
   - After the remaining items, run another codebase audit.
   - Focus areas:
     - route exposure/auth allowlist
     - SSRF/network egress
     - upload/parse lifecycle
     - cleanup/artifacts
     - stored JSON rendering
     - share-token behavior

## Suggested Next-Chat Opening Prompt

Continue in `/Users/kevin/enrollment-resources/Claude/er-seo-tools`. Read `docs/superpowers/plans/2026-05-12-hardening-next-todo.md` first. The current uncommitted hardening batch has already passed `npm test -- --reporter=dot`, `npm run build`, and `npx tsc --noEmit`. Do not revert existing changes. The next step is a final full audit focused on route exposure/auth allowlist, SSRF/network egress, upload/parse lifecycle, cleanup/artifacts, stored JSON rendering, and share-token behavior.
