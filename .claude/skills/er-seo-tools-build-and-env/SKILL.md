---
name: er-seo-tools-build-and-env
description: "Use when setting up er-seo-tools from a fresh clone or fixing a broken local env: npm install hangs, dev server won't start, tests fail with 'Error code 14: Unable to open the database file', prisma migrate targets the wrong SQLite file, an unexpected login wall appears in dev, ADA audits can't launch Chrome on macOS, next build runs out of memory, or you need the exact dev/test/lint/build/coverage commands."
---

# er-seo-tools: Build and Local Environment

## Overview

Zero-context runbook: fresh clone → running dev server → passing tests on a laptop.
Core principle: **the app, the Prisma CLI, and Vitest each read env vars from
different places** — most local breakage is a `DATABASE_URL` that one of the three
never saw. When in doubt, pass `DATABASE_URL="file:./local-dev.db"` inline.

## When to use

- Recreating the dev environment from scratch (new machine, new clone, new session).
- Any local failure of `npm install`, `npm run dev`, `npm test`, `npm run lint`,
  `npm run build`, or `npx prisma migrate dev`.
- Deciding which env vars you actually need for the task at hand.

## When NOT to use

| Need | Use instead |
|---|---|
| Deploying, PM2, prod paths, prod migrations, server logs | `er-seo-tools-run-and-operate` |
| Full env-var catalog (all ~45 vars, code defaults vs prod values) | `er-seo-tools-config-and-flags` |
| Test-writing conventions, what counts as evidence, adding tests | `er-seo-tools-validation-and-qa` |
| A bug in the app itself (not the toolchain) | `er-seo-tools-debugging-playbook` |
| What may be changed and how changes are gated | `er-seo-tools-change-control` |

## Prerequisites

| Requirement | Check | Notes |
|---|---|---|
| Node >= 22 | `node --version` | `package.json` `engines` requires `>=22`. Prod runs Node 22. |
| git | `git --version` | Repo is on GitHub; the server pulls from it (deploy is Kevin-only). |
| Google Chrome | see below | Only needed for ADA audits / site audits / live scans. Code default path is `/usr/bin/google-chrome` (Linux). On macOS set `CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`. |
| Network access to HuggingFace | — | `npm install` downloads a ~25 MB embedding model (see below). Offline installs look hung but do not fail. |

No Docker, no Postgres, no external services required. The DB is a local SQLite file.

## Bootstrap sequence (fresh clone)

```bash
git clone <repo-url> er-seo-tools && cd er-seo-tools

# 1. Install. postinstall runs `tsx scripts/prewarm-embedding-model.ts || true`:
#    it downloads + caches the ~25MB Xenova/all-MiniLM-L6-v2 embedding model
#    (used by pillar analysis) and runs one warmup inference. It is tolerant —
#    the script exits 0 even on failure, and the `|| true` backstops that —
#    so a slow/offline install just skips the prewarm; nothing is broken.
npm install

# 2. Env files — see "Env file layout" below. Minimal working local setup:
cat > .env <<'EOF'
DATABASE_URL=file:./local-dev.db
UPLOADS_DIR=./local-uploads
PORT=3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF
# Do NOT set APP_AUTH_PASSWORD — leaving it unset in dev IS the auth bypass.

# 3. Create/migrate the DB (39 migrations as of 2026-07-02, latest
#    20260630120000_live_seo_source). This is the documented path (README);
#    an `npm run db:push` script exists but migrate is what the repo uses —
#    schema changes MUST go through `npx prisma migrate dev --name <name>`.
#    Caveat: migrate dev can prompt and hang in a NON-INTERACTIVE session —
#    fallback is hand-authored migration SQL + `npx prisma migrate deploy`
#    (see er-seo-tools-change-control, schema-change procedure).
npx prisma migrate dev

# 4. Dev server (turbopack). Open http://localhost:3000 — no login in dev.
npm run dev

# 5. Smoke-test the test harness (both verified passing 2026-07-02):
npx vitest run middleware.test.ts                                         # pure, no DB
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/queue.test.ts  # DB-backed
```

The SQLite file lands at `prisma/local-dev.db` — Prisma resolves relative
`file:` paths against the `prisma/` schema directory, not the repo root.
It is gitignored (as are `.env` and `.env*.local`).

## Env file layout — who reads what

This is the single biggest trap in the repo. Three consumers, three behaviors:

| Consumer | Reads | Does NOT read |
|---|---|---|
| Next.js (`npm run dev` / `next build`) | `.env`, `.env.local` (local overrides win) | — |
| Prisma CLI (`npx prisma migrate dev` etc.) | shell env, root `.env`, `prisma/.env` | `.env.local` |
| Vitest / `npx tsx scripts/*.ts` | shell env; `@prisma/client` falls back to root `.env` | `.env.local` |

Consequences:

- **Putting `DATABASE_URL` only in `.env.local` breaks tests and the Prisma CLI.**
  Put it in root `.env` (simplest), or pass it inline every time:
  `DATABASE_URL="file:./local-dev.db" npm test`. The inline form is the repo's
  documented convention (see the usage headers of `scripts/findings-rebuild.ts`
  and `scripts/findings-parity.ts`) and works regardless of file layout.
- **Do not `cp .env.example .env` verbatim** (the README suggests the copy —
  edit it after). `.env.example` is written for a server:
  `DATABASE_URL=file:/var/lib/er-seo-tools/db.sqlite` and
  `UPLOADS_DIR=/var/lib/er-seo-tools/uploads` do not exist on a laptop and (with
  no shell `DATABASE_URL`) produce the classic failure
  `Error code 14: Unable to open the database file` in every DB-backed test.
  Copy it for the comments, then replace the paths with local values.
- `.env.example` is the tracked, commented catalog of the CORE server vars — read
  it before inventing anything, but know it is NOT exhaustive: `CHROME_EXECUTABLE`,
  `QUARTER_PUSH_TOKEN_SECRET`, `GOOGLE_SA_KEY_FILE`, `CRM_API_BASE`, and the
  concurrency/tuning knobs (`BROWSER_POOL_SIZE`, `SITE_AUDIT_CONCURRENCY`,
  `PSI_CONCURRENCY`, …) are absent from it. The full catalog lives in
  er-seo-tools-config-and-flags.

### Required vs optional for dev

**Required:** `DATABASE_URL` only (everything else has a workable default).
Recommended: `UPLOADS_DIR`, `NEXT_PUBLIC_APP_URL=http://localhost:3000` (share
links and skill-handoff URLs are built from it — never from request origin),
`PORT`.

**The dev-auth-bypass rule:** `lib/auth.ts` `isAuthBypassedInDev()` returns true
when `NODE_ENV !== 'production'` AND `APP_AUTH_PASSWORD` is unset. So in dev,
**do not set `APP_AUTH_PASSWORD` unless you deliberately want the login wall.**
If you set it, you must log in through the auth gate like prod.

**Optional, feature-gated (unset = feature degraded, app still runs):**

| Var | Enables | Without it |
|---|---|---|
| `CHROME_EXECUTABLE` | ADA/site audits on macOS | Audits fail to launch Chrome (default path is Linux-only) |
| `GOOGLE_SA_KEY_FILE` | C10 SEO performance reports (GA4 + GSC service account) | Reports feature cannot fetch data; rest of app fine |
| `PAGESPEED_API_KEY` | Higher PSI quota (25k/day) | Keyless PSI quota (low); fine for occasional dev runs |
| `LIGHTHOUSE_PROVIDER` | `pagespeed` \| `local` \| `off` | Code default is `local` (prod uses `pagespeed`); set `off` to skip Lighthouse in dev site audits |
| Token secrets (`PILLAR_TOKEN_SECRET`, `SEO_ROADMAP_TOKEN_SECRET`, `KEYWORD_MEMO_TOKEN_SECRET`, `QUARTER_PUSH_TOKEN_SECRET`) | Handoff-token signing | Dev falls back to a deterministic dev-only constant with a logged warning; required in prod only |
| `CHROME_PROXY_SERVER` / `CHROMIUM_NETWORK_ISOLATED` | Chromium SSRF egress guard | Not needed in dev — `requireBrowserEgressGuardConfig()` returns early when `NODE_ENV !== 'production'` |

Production fail-fast note (context, not a dev concern): `instrumentation.ts`
`process.exit(1)`s at startup if prod is missing `PILLAR_TOKEN_SECRET`, auth
config (`APP_AUTH_SECRET` plus a login path — Google OAuth trio or
`APP_AUTH_PASSWORD`), or the Chromium egress guard. A build that is green
locally can still crash-loop PM2 from env omissions alone.

## Running tests

```bash
DATABASE_URL="file:./local-dev.db" npm test              # full suite (vitest run)
DATABASE_URL="file:./local-dev.db" npm run test:watch    # vitest watch mode
DATABASE_URL="file:./local-dev.db" npm run test:coverage # v8 coverage over lib/**
DATABASE_URL="file:./local-dev.db" npx vitest run <path> # one file (fastest loop)
```

Facts you need to know (from `vitest.config.mts`):

- **~290 test files** (as of 2026-07-02, branch `feat/autonomous-live-seo-source`):
  ~196 in `lib/`, ~68 in `app/` (API route handlers imported directly and called
  with `new NextRequest(...)`), ~25 in `components/`, plus root `middleware.test.ts`.
- **DB-backed tests hit the REAL shared SQLite dev DB** (`prisma/local-dev.db`)
  via the real `prisma` from `@/lib/db`. No separate test DB, no setupFiles.
  That is why `fileParallelism: false` is set — the `AuditBatch` partial unique
  index (`audit_batches_one_open`, a one-open-batch singleton invariant)
  collides across parallel files. **Never re-enable parallelism.**
- Global environment is `node`, `globals: false` — every test imports
  `describe/it/expect/vi` from `'vitest'`; component tests carry a first-line
  `// @vitest-environment jsdom` pragma. `server-only` is aliased to an empty
  stub (`test/stubs/server-only.ts`).
- Coverage: v8 over `lib/**/*.ts`, excluding `lib/db.ts` and
  `lib/ada-audit/runner.ts` (the puppeteer runner is not unit-tested).
- Pure/mocked tests (e.g. `middleware.test.ts`) pass with **no env at all**;
  only DB-backed tests need `DATABASE_URL`. If a test fails with
  `Error code 14: Unable to open the database file`, the fix is the inline
  `DATABASE_URL` — not a code change.
- **Suite state:** individual files verified green 2026-07-02
  (`middleware.test.ts` 33 tests; `lib/jobs/queue.test.ts` 7 tests, fails
  without `DATABASE_URL` and passes with it; `lib/findings/live-seo-score.test.ts`
  10 tests). A full-suite run was NOT executed in this skill's verification
  session, but er-seo-tools-validation-and-qa verified a full run the same day
  (290 files / 2871 tests green, ~51 s). Still run
  `DATABASE_URL="file:./local-dev.db" npm test` yourself before claiming the
  suite passes. No CI runs tests (see below).

For conventions when *writing* tests (prefix-scoped rows, deletion order,
`vi.mock('@/lib/db')` hoisting), use `er-seo-tools-validation-and-qa`.

## Gates: lint and build

```bash
npm run lint    # = tsc --noEmit. There is NO eslint in this repo.
npm run build   # = NODE_OPTIONS='--max-old-space-size=3072' next build
```

- `tsconfig.json` **excludes `**/*.test.ts` and `**/*.test.tsx`** — `npm run lint`
  will not catch type errors inside test files; only Vitest's own transform
  surfaces those.
- The 3072 MB heap flag is baked into the build script — do not remove it. It is
  a production-incident fix (commit 9208496, merged via PR #76, 2026-06): the
  C10 reports feature pushed `next build`'s type-check worker past Node's ~2 GB
  default heap on the 3.82 GB prod VPS and OOM-killed deploys. Keep it
  POSIX-inline (the script runs on mac and linux).
- `next.config.ts` `serverExternalPackages: ['jsdom','axe-core','lighthouse','pdfjs-dist']`
  is load-bearing (server-only ESM that webpack cannot bundle, dynamic-imported
  at runtime), as is `outputFileTracingIncludes` (ships the Prisma engine with
  `/api` routes). Do not "clean up" either.
- **There is no CI gate for lint/tests/build.** The only GitHub workflow is
  `.github/workflows/security-audit.yml` (audit-ci on Node 22,
  `npm install --ignore-scripts`, fails on new high/critical production
  advisories; the allowlist in `audit-ci.jsonc` is 11 exact GHSA ids for a
  reviewed protobufjs chain under `@xenova/transformers`). The pre-push gate is
  local discipline:
  `npm run lint && DATABASE_URL="file:./local-dev.db" npm test && npm run build`.

## Other build artifacts: `skills/`, `dist/`, `build:skill`

- `skills/` (tracked) holds Claude-skill *sources* shipped to end users:
  `skills/er-handoff-memo/`.
- **2026-07-13, D1 PR3:** the legacy `skills/pillar-analysis-narrative/`
  skill, `scripts/build-skill.sh`, and the `npm run build:skill` script were
  all RETIRED — superseded by `skills/er-handoff-memo/`, which needs no build
  wiring; it is distributed as a plain folder.
- `scripts/findings-rebuild.ts` / `scripts/findings-parity.ts` are operational
  recovery/verification tools, run as
  `DATABASE_URL="file:./local-dev.db" npx tsx scripts/findings-rebuild.ts <id>`.

## Known traps (symptom → cause → fix)

| Symptom | Cause | Fix |
|---|---|---|
| Tests: `Error code 14: Unable to open the database file` | `DATABASE_URL` not in shell env and root `.env` missing or pointing at a server path — Vitest never reads `.env.local` | `DATABASE_URL="file:./local-dev.db" npm test`, or put that value in root `.env` |
| `npx prisma migrate dev` targets (or fails on) a weird path | Prisma CLI reads root `.env`/`prisma/.env`, never `.env.local`; relative `file:` paths resolve against `prisma/` | Same fix as above; the DB is `prisma/local-dev.db` |
| `npm install` appears hung | postinstall downloading the ~25 MB MiniLM model from HuggingFace | Wait, or `npm install --ignore-scripts` (CI does this); prewarm failure is non-fatal |
| Prisma type errors after pulling a branch with schema changes | Generated client is stale | `npx prisma migrate dev` (applies new migrations + regenerates), or `npm run db:generate` if migrations are already applied |
| ADA audit: Chrome fails to launch on macOS | Default executable path `/usr/bin/google-chrome` is Linux-only (`lib/ada-audit/browser-pool.ts`) | `CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` in `.env` |
| Login wall in dev | `APP_AUTH_PASSWORD` is set | Unset it (dev bypass requires it unset AND `NODE_ENV !== 'production'`) |
| `next build` OOM-killed | Heap flag removed from the build script, or the type-check surface grew further | Keep/restore `NODE_OPTIONS='--max-old-space-size=3072'`; investigate what grew |
| Type error only appears in tests while `npm run lint` is green | tsconfig excludes test files from `tsc --noEmit` | Run the affected test file under vitest; fix there |
| Mystery extra DBs under `prisma/prisma/` | Artifact of running prisma from the wrong cwd (gitignored) | Ignore; the real dev DB is `prisma/local-dev.db` (`prisma/dev.db` is stale) |
| Test flake around AuditBatch uniqueness | Someone re-enabled `fileParallelism` | Revert — test files share one real DB by design |
| Red `security-audit` CI run | A NEW GHSA id (allowlist is exact-id only, by design) | Do the reachability review per `SECURITY.md`; never blindly widen `audit-ci.jsonc` |

## What you CANNOT do locally

- **Deploy or touch prod.** `~/deploy.sh` lives on the server only (its content
  is not in the repo). Merge + deploy are autonomous when gate-green under the
  2026-07-03 ruling, but they belong to `er-seo-tools-run-and-operate` /
  `er-seo-tools-change-control` (rule 1) — this skill is local-env only.
- **C10 SEO reports without credentials.** GA4/GSC fetches need a Google
  service-account key file (`GOOGLE_SA_KEY_FILE`) with access to the client's
  properties; without it the reports feature cannot fetch real data.
- **CRM prospects data.** The CRM adapter path is gated on `CRM_API_BASE` plus
  a client `crmClientRef`; unset locally, prospects fall back to manual
  `ProspectsEntry` rows or "unmapped".
- **Realistic PSI throughput.** Keyless PageSpeed Insights quota is low;
  `PAGESPEED_API_KEY` raises it to 25k/day. For dev site audits, consider
  `LIGHTHOUSE_PROVIDER=off`.
- **Prod-only startup behavior.** The three fail-fast gates, the Chromium
  egress guard, PM2 memory limits, and ops-mode SQLite behavior only manifest
  with `NODE_ENV=production` on the server. "Works locally" does not prove
  startup will succeed there.
- **Scanning arbitrary websites.** Audits, live scans, and broken-link
  verification fetch real external sites. Only scan client sites already in the
  system or domains you control — never test crawls against third-party sites.

## Common mistakes

- Copying `.env.example` to `.env` unmodified (server paths → Error code 14).
- Setting `APP_AUTH_PASSWORD` in dev "for realism" and then fighting the login wall.
- Running `npm test` bare and concluding the suite is broken — it's the missing
  inline `DATABASE_URL`.
- Trusting `npm run lint` to have checked test files, or trusting CI to have run
  anything beyond the dependency audit.
- Using `npm run db:push` for schema changes — the repo's flow is
  `npx prisma migrate dev --name <name>` locally, `prisma migrate deploy` on prod.
- Editing `vitest.config.mts` parallelism or the build script's heap flag.

## Provenance and maintenance

Authored 2026-07-02 against branch `feat/autonomous-live-seo-source`
(ahead of main, not merged, not deployed). Everything here is
merge-state-neutral build/env mechanics except the migration count/latest
(39 dirs, `20260630120000_live_seo_source`) and the test-file count (~290),
which reflect this branch. Verified by direct file reads plus live runs of
`middleware.test.ts` (33 pass, no env), `lib/jobs/queue.test.ts` (7 fail
without `DATABASE_URL` with Error code 14; 7 pass with it), and
`lib/findings/live-seo-score.test.ts` (10 pass). A full-suite run was NOT
performed in the authoring session.

Re-verify volatile facts:

```bash
node -e "console.log(require('./package.json').scripts)"                 # all npm scripts + postinstall
ls -d prisma/migrations/*/ | wc -l && ls prisma/migrations | tail -2     # migration count + latest
find . -path ./node_modules -prune -o -name '*.test.ts*' -print | grep -v node_modules | grep -v '.claude' | wc -l  # test-file count
sed -n '1,36p' vitest.config.mts                                         # parallelism, aliases, coverage
grep -n 'exclude' tsconfig.json                                          # test files still excluded from lint
ls .github/workflows/                                                    # CI still audit-only?
cat .env.example                                                         # current env-var catalog
grep -n 'CHROME_EXECUTABLE\|BROWSER_POOL_SIZE' lib/ada-audit/browser-pool.ts  # Chrome default path
grep -n -A2 'isAuthBypassedInDev' lib/auth.ts                            # dev auth-bypass rule
ls skills/ # er-handoff-memo only; pillar-analysis-narrative retired 2026-07-13
```
