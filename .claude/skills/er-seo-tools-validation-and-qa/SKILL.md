---
name: er-seo-tools-validation-and-qa
description: "Use when proving a change works in er-seo-tools — running or adding tests, defining 'done', pre-PR gates, or test failures where you need the house conventions (env, DB, mocking). Triggers: DB-backed test flakiness, 'is this gate-green?', how to test a parser/route/job handler/component, where test fixtures live, whether a known test failure is pre-existing, what evidence to show before claiming a fix or feature complete, prod-verification expectations after deploy."
---

# Validation & QA — what counts as evidence in er-seo-tools

## Overview

This repo has **no CI for tests, type-check, or build** — the only GitHub workflow is
`security-audit.yml` (dependency audit). Every quality gate is local discipline, so the
evidence bar is contractual: you show command output, you never assert "passes" without
having run it. "Gate-green" is a defined term here (see the ladder below), and every
production incident historically earns a permanent guard test.

## When to use / When NOT to use

Use this skill when you are validating work: running gates, writing tests, deciding
whether something is "done", or interpreting a test failure's *conventions* (env, DB,
mocking).

Use a sibling instead when:

| Situation | Use instead |
|---|---|
| Fresh clone won't run at all; env-var setup; dev server | `er-seo-tools-build-and-env` |
| A test/app failure needs root-causing (not convention lookup) | `er-seo-tools-debugging-playbook` |
| You need scripts/DB queries to *measure* behavior | `er-seo-tools-diagnostics-and-tooling` |
| Numeric proof for a scoring/algorithm change (before/after data) | `er-seo-tools-proof-and-analysis-toolkit` |
| Deploy gating, what needs Kevin's sign-off, change classes | `er-seo-tools-change-control` |
| Tracker checkbox / status-log / handoff-doc mechanics | `er-seo-tools-docs-and-writing` |
| Evidence bar for *research ideas* (not code changes) | `er-seo-tools-research-methodology` |

## The gate ladder

Run in this order. All commands verified 2026-07-02 on branch
`feat/autonomous-live-seo-source`.

| # | Gate | Command | What it is / is NOT |
|---|---|---|---|
| 1 | Type-check | `npm run lint` | `tsc --noEmit`. There is **no eslint** in this repo. `tsconfig.json` **excludes `**/*.test.ts(x)`** — test-file type errors do NOT surface here, only in vitest's own transform. |
| 2 | Tests | `DATABASE_URL="file:./local-dev.db" npm test` | `vitest run`. 290 test files / 2871 tests, all green in ~51 s as of 2026-07-02. The `DATABASE_URL` prefix is **mandatory** (see the big trap below). |
| 3 | Build | `npm run build` | `NODE_OPTIONS='--max-old-space-size=3072' next build`. The heap flag is a prod-OOM fix (PR #76) — never remove it. |
| 4 | PR + merge | push branch, open PR via `gh`, merge once gate-green | Merge is autonomous under the 2026-07-03 ruling when gates 1–3 were re-run green in THIS session (`er-seo-tools-change-control` rule 1). |
| 5 | Deploy + prod verification | deploy when needed, then verify on prod and **log it in the tracker** | Deploy = `git push`, then `ssh $PROD_SSH "~/deploy.sh"` (autonomous when gate-green; verification immediately after is mandatory). Verification evidence goes into a dated status-log line in `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`. |

**"Gate-green"** (the term used in tracker status logs, e.g. "gate green (tsc / vitest /
build)") means gates 1–3 all pass locally: clean `tsc --noEmit`, full suite green, clean
production build. Gate-green does NOT mean merged, deployed, or prod-verified — the
tracker distinguishes these explicitly ("Branch not yet merged / deployed — prod
verification pending").

A prod-verification log entry names what was actually exercised on prod. Exemplar
(B5 — grid↔Teamwork closure — tracker status log 2026-06-11): deploy + migration clean, specific routes returning
200/409 as designed, a regression *caught during prod-verify* (push routes missing from
the middleware allowlist) and its fix commit. That is the bar — clicked-through
surfaces and observed responses, not "deployed fine".

### The big test trap: DATABASE_URL

DB-backed tests share **one real SQLite dev DB**. Without `DATABASE_URL` in the shell
they fail with `Error code 14: Unable to open the database file` — vitest never loads
`.env.local`, so the value must be passed inline (full who-reads-which-env-file
mechanism: er-seo-tools-build-and-env). The working invocation:

```bash
DATABASE_URL="file:./local-dev.db" npm test
# single file:
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/queue.test.ts
```

Pure/mocked tests (e.g. `middleware.test.ts`) pass without the prefix, but just always
use it. The same prefix convention applies to `npx tsx scripts/findings-rebuild.ts` /
`scripts/findings-parity.ts` and to `npx prisma migrate deploy` locally (see their
file headers and the active plan's Global Constraints).

## Test conventions (vitest.config.mts, verified 2026-07-02)

| Setting | Value | Consequence |
|---|---|---|
| `environment` | `'node'` | React component tests MUST start with a first-line `// @vitest-environment jsdom` pragma (26 files do) or DOM APIs are undefined. |
| `globals` | `false` | Always `import { describe, it, expect, vi } from 'vitest'`. In jsdom tests also `afterEach(cleanup)` — no auto-cleanup without globals. |
| `fileParallelism` | `false` | Test files run **serially** because they share the real dev DB; the `AuditBatch` partial unique index (`audit_batches_one_open`, a singleton invariant) collides across parallel files. Never re-enable parallelism without per-file DBs. |
| alias `@` | repo root | Same as tsconfig paths. |
| alias `server-only` | `test/stubs/server-only.ts` | Empty stub so server-module imports don't throw under vitest. |
| coverage | v8 over `lib/**/*.ts` | Excludes `lib/db.ts` and `lib/ada-audit/runner.ts` (the puppeteer runner is untested directly — browser behavior is mocked at the pool level). `npm run test:coverage`. |
| `include` | `**/*.test.ts(x)` | The `.db.test.ts` suffix (e.g. `lib/ada-audit/recents-query.db.test.ts`, `app/api/seo-parser/[sessionId]/pages/route.db.test.ts`) is a human flag for "deliberately DB-backed twin of a mocked test" — vitest treats it identically. |

No `setupFiles`. No real Chrome needed: `lib/ada-audit/browser-pool.test.ts` mocks
puppeteer entirely ("Pool semantics only — puppeteer is mocked").

### Three test styles coexist — pick deliberately

1. **Pure function (preferred whenever possible).** Plain input/output assertions, no
   DB, no mocks. Exemplar: `lib/findings/live-seo-score.test.ts`. The repo's style is
   pure-function-first: logic is extracted into pure modules (`scoreLiveSeo`,
   `diffInstances`, `harvestLinks`, the HTML report builders) precisely so tests need no
   scaffolding.
2. **DB-backed against the real shared SQLite DB.** Import the real
   `import { prisma } from '@/lib/db'`; create **prefix-scoped** rows (e.g. `PREFIX =
   'c3sal-'` or a unique fake domain like `c6blv.example.com`); clean by prefix in
   `beforeAll`/`beforeEach` AND `afterAll`; **delete `CrawlRun` rows BEFORE origin rows**
   (the findings subtree cascades from `CrawlRun`; origin FKs are `SetNull`). Exemplar:
   `app/api/site-audit/route.test.ts`. Prefixes must be unique per file — files run
   serially but leftover rows from a crashed run must not collide.
3. **Prisma-mocked.** `vi.mock('@/lib/db', () => ({ prisma: { model: { method:
   vi.fn()... } } }))` declared **BEFORE the route import** in the file (hoisting —
   all 25 mocked route-test files do this; mixing the mock and the real `@/lib/db` in
   one file silently tests the wrong thing). Exemplar:
   `app/api/keyword-memo/[id]/route.test.ts`.

API route tests never spin up a server: they import `GET`/`POST` directly from
`./route` and call them with `new NextRequest('http://localhost/...')`.

### How to add a test, per layer

| Layer | Exemplar to copy | Key pattern |
|---|---|---|
| Pure lib function | `lib/findings/live-seo-score.test.ts` | Factory helper for a "perfect" input + per-test overrides; assert exact numbers and null cases. |
| CSV parser | `lib/parsers/seoElements/pageTitles.parser.test.ts` | Inline CSV strings via a local `makeCsv(rows)` helper (no CSV fixture files exist); test `filenamePattern`/`matchesFile`, empty CSV, header-only CSV, then parse semantics. New parsers must also satisfy the `parser-key.test.ts` guard (static `parserKey`). |
| API route (mocked) | `app/api/keyword-memo/[id]/route.test.ts` | `vi.mock('@/lib/db')` before importing `GET`; drive with `new NextRequest(...)`; snapshot/restore `process.env` when the route reads secrets. |
| API route (real DB) | `app/api/site-audit/route.test.ts` | Prefix-scoped rows, CrawlRun-first cleanup, call the imported handler. |
| Job handler | `lib/jobs/handlers/broken-link-verify.test.ts` | Real DB rows + **injected deps** (`VerifyDeps`: `checkUrl`, `now`, `sleep`) so no network is touched; assert on the rows the handler writes and the transient rows it deletes. |
| React component | `components/quarter-grid/Chip.test.tsx` | First line `// @vitest-environment jsdom`; `@testing-library/react` `render`/`screen`/`fireEvent`; explicit `afterEach(cleanup)`; `vi.fn()` handler bundles. |

**Never let a test hit the network or a third-party site.** Broken-link and audit
handlers take injectable transports for exactly this reason. Real crawls (even in dev)
are restricted to client sites already in the system or domains you control.

## Guard tests — the institution

The rule: **every production incident and every load-bearing invariant gets a permanent
guard test** that fails if the invariant is re-broken, with a comment naming the
incident. When you fix a prod bug or land an invariant, add one. Existing exemplars:

| Guard test | Invariant / incident it guards |
|---|---|
| `lib/parsers/parser-key.test.ts` | Every registered parser declares its OWN static `parserKey` string literal, equal to the canonical key, unique across the registry. Incident: prod SWC minification mangled `ParserClass.name` to single letters, so aggregator lookups (`parsedData.internal` etc.) missed and reports came out empty — invisible in dev. |
| `middleware.test.ts` (repo root) | `isPublicPath` allowlist: token-authed handoff routes (`pat_`/`srt_`/`krt_`/`qct_`) bypass the cookie gate; dashboard-triggered mint/poll routes stay gated. Incident: shipped routes missing from the allowlist returned `auth_required` before the token verifier ran — this class of bug "bit us three times". **Any new token-authed or public route requires a `middleware.ts` `isPublicPath` entry AND a `middleware.test.ts` case, both gated and exempt directions.** |
| `lib/findings/live-seo-score.test.ts` ("live score excludes crawl depth (v1 guard)") | `scoreLiveSeo` ignores crawl depth by construction — a `@ts-expect-error` extra `crawlDepth` property must not change the score. Guards the deliberate v1 scoring scope. |

Other guard-shaped suites worth knowing: `lib/parsers/expected-exports.test.ts`
(expected SF export inventory) and `lib/parsers/index.routing.test.ts` (filename →
parser routing).

## Golden / certified inventory

- **Binary fixtures:** `lib/ada-audit/__fixtures__/` — exactly three PDFs
  (`untagged.pdf`, `titled.pdf`, `image-only.pdf`), consumed only by
  `lib/ada-audit/pdf-runner.test.ts` via a `path.join(__dirname, '__fixtures__', name)`
  helper. This is the only fixture directory in the repo.
- **CSV samples:** none on disk. Parser tests build CSV strings inline
  (`makeCsv`-style helpers). Keep it that way — small, self-documenting inputs.
- **`SEO_Report_1st_Draft.pdf`** (repo root, **untracked**, ~145 KB, dated 2026-06-22):
  the eyeball parity baseline for C10 SEO Performance Reports. Kevin's pending prod
  verification compares a generated report's metrics against this PDF. Do not commit it,
  do not delete it, do not treat its absence on another machine as a bug.
- **Known pre-existing failures: none.** As of 2026-07-02 on
  `feat/autonomous-live-seo-source` the FULL suite passes: 290 files / 2871 tests /
  ~51 s (verified by running it). A previously-rumored failure in
  `lib/ada-audit/site-audit-helpers.test.ts` does not exist on this branch — verified by
  running that file (15/15 pass). If you see a failure, it is YOUR regression until
  proven otherwise; prove "pre-existing" by stashing your changes and re-running the
  exact failing file.

## Evidence bar for claiming "done"

Before saying a change is complete/fixed/passing, ALL of:

- [ ] `npm run lint` output shown (clean).
- [ ] `DATABASE_URL="file:./local-dev.db" npm test` output shown — the summary lines
      ("Test Files … passed", "Tests … passed"). For a quick loop, run the touched files
      first, but the full suite before declaring gate-green.
- [ ] `npm run build` output shown (clean) for anything that could affect the build —
      new files, new deps, config, server/client component boundaries.
- [ ] New behavior has a test; fixed bug has a guard test naming the bug.
- [ ] For deploy-affecting changes: prod-verification steps written out (what to click,
      what response/log line proves it) — an autonomous deploy without them is a
      rule-1 violation, not a convenience.
- [ ] Tracker status-log line drafted if the change advances a tracker item (see
      `er-seo-tools-docs-and-writing` for the full handoff ritual — checkbox + dated
      log + handoff rewrite in the same commit).

"Tests pass" without pasted output is not evidence. "Should work" is not evidence.

## Acceptance-threshold discipline

No eyeball-passing for anything numeric. For scoring changes (`computeHealthScore`,
`scoreLiveSeo`, `computeScore`, diff classifiers), the acceptance criterion is
**numbers before/after on the same inputs**: pick representative real inputs, record the
score under the old code, state the predicted new score and why, then show the actual
new score. Tests should pin exact values (`toBe(100)`, `toBe(42)`), not just
`toBeLessThan(100)`, wherever the spec fixes a number. For the full method (choosing
inputs, parity scripts like `scripts/findings-parity.ts`, prod data sampling) see
`er-seo-tools-proof-and-analysis-toolkit`.

The one sanctioned eyeball check is the C10 report-vs-`SEO_Report_1st_Draft.pdf` visual
parity pass — and even that is a Kevin-owned prod-verification step, not an AI
acceptance gate.

## Common mistakes

- Running `npm test` bare → `Error code 14` on every DB-backed file. Always prefix
  `DATABASE_URL="file:./local-dev.db"`.
- Trusting `npm run lint` to cover tests — tsconfig excludes `*.test.ts(x)`; a broken
  test file only surfaces when vitest runs it.
- Forgetting `// @vitest-environment jsdom` on a component test (global env is node) or
  forgetting `afterEach(cleanup)` (globals:false → no auto-cleanup).
- Putting `vi.mock('@/lib/db', ...)` after the route import — the mock silently doesn't
  apply.
- DB-test cleanup deleting origin rows before `CrawlRun` rows, or reusing another file's
  prefix — leaves orphans / cross-file collisions.
- Re-enabling `fileParallelism` "for speed" — the shared dev DB + the
  `audit_batches_one_open` unique index make parallel files collide by design.
- Adding a token-authed route without the `isPublicPath` entry + `middleware.test.ts`
  case (the three-time historical regression).
- Using local `prisma migrate dev` in a non-interactive session — it prompts and hangs.
  Author migration SQL by hand and apply with
  `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy` (per the active plan's
  Global Constraints).
- Claiming gate-green from a partial run, or conflating gate-green with
  merged/deployed/prod-verified.
- Writing a test that fetches a real external site.

## Provenance and maintenance

Written 2026-07-02 against branch `feat/autonomous-live-seo-source` (23 commits ahead of
main, gate-green, unmerged). Everything above was verified on that branch; the gate
commands and test conventions are identical on main, but suite counts and the guard-test
inventory drift with every merge.

Re-verification one-liners:

| Fact | Re-verify with |
|---|---|
| Gate commands (`lint`=tsc, `test`=vitest run, build heap flag) | `grep -A3 '"scripts"' package.json` or read `package.json` scripts block |
| Test file count (290) and split (68 app / 196 lib / 25 components / 1 root) | `find . -path ./node_modules -prune -o \( -name '*.test.ts' -o -name '*.test.tsx' \) -print \| grep -v node_modules \| grep -v '\.claude' \| wc -l` |
| Full suite green + test count (2871) + duration (~51 s) | `DATABASE_URL="file:./local-dev.db" npm test` |
| `site-audit-helpers` test passing (15/15) | `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/site-audit-helpers.test.ts` |
| vitest config (node env, globals:false, fileParallelism:false, aliases, coverage excludes) | `cat vitest.config.mts` |
| tsconfig excludes test files from lint | `grep exclude tsconfig.json` |
| jsdom-pragma count (26) / `vi.mock('@/lib/db')` count (25) | `grep -rl '@vitest-environment jsdom' --include='*.test.*' app lib components middleware.test.ts \| wc -l` and same for `"vi.mock('@/lib/db'"` |
| No test/build CI (only security-audit) | `ls .github/workflows/` |
| Fixture inventory | `ls lib/ada-audit/__fixtures__/` |
| Untracked parity PDF still present | `git status --short \| grep SEO_Report` |
| Guard tests still present | `ls lib/parsers/parser-key.test.ts middleware.test.ts && grep -n 'crawl depth' lib/findings/live-seo-score.test.ts` |
| Tracker "gate green" usage / prod-verify log exemplars | `grep -n 'gate green\|prod-verif\|prod verif' docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` |
