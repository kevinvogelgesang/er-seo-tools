---
name: er-seo-tools-config-and-flags
description: "Use when working with er-seo-tools env vars, flags, or runtime tuning — looking up an env var's default vs prod value, adding a new env var, changing job concurrency/timeouts/attempts, writing schedule cadence strings (weekly:/monthly:/daily@/every:), retention windows, page/link/check caps, or diagnosing '[startup] ... Refusing to start' crash-loops, PM2 stale env after deploy, cadence_not_allowed errors, LIGHTHOUSE_PROVIDER modes, or a code default disagreeing with deployed behavior."
---

# Config and flags catalog

## Overview

Every configuration axis of er-seo-tools: env vars (code default vs prod value), boot-time guards, the 13-job-type config table, schedule cadence grammar, retention windows, and hard caps. Core principle: **the code default is almost never the prod value** — `ecosystem.config.js` (git-tracked) overrides tuning knobs, the server `.env` (not in git) holds secrets. When a doc and `ecosystem.config.js` disagree, `ecosystem.config.js` wins.

All facts verified against the repo on 2026-07-02, on branch `feat/autonomous-live-seo-source` (not merged to main, not deployed). Branch-only vars are labeled.

## When to use

- Looking up any env var: default, prod value, read site, guard behavior.
- Adding a new env var or config flag (checklist below).
- Tuning job concurrency, timeouts, retries; writing cadence strings.
- Diagnosing `[startup] ... Refusing to start` / post-deploy crash-loops.

## When NOT to use

- Getting a dev environment running from scratch, test env traps → `er-seo-tools-build-and-env`.
- Deploying, PM2 commands, prod log locations, restart semantics → `er-seo-tools-run-and-operate`.
- Adding a whole new job type / route / parser end-to-end (config is one step of that) → `er-seo-tools-extension-recipes`.
- WHY an invariant exists (pool cap, fork mode ×1, SQLite rules) → `er-seo-tools-architecture-contract`; the incidents behind limits → `er-seo-tools-failure-archaeology`.

## The three config layers

| Layer | In git? | Holds | Notes |
|---|---|---|---|
| Code defaults | yes | fallback for every knob | `parsePositiveInt(process.env.X, default)` pattern |
| `ecosystem.config.js` (PM2) | yes | prod tuning: pool sizes, concurrency, provider, retention days, data paths | Deliberately NOT in `.env` so `pm2 env <id>` proves what the worker uses (comment at `ecosystem.config.js:24-25`). Changing it requires `pm2 delete seo-tools && pm2 start ecosystem.config.js` — plain `pm2 restart` keeps stale env |
| Server `.env` at `/home/seo/webapps/seo-tools/.env` | no (gitignored) | secrets + instance identity: `APP_AUTH_SECRET`, token secrets, OAuth creds, `NEXT_PUBLIC_APP_URL`, `PAGESPEED_API_KEY`, `GOOGLE_SA_KEY_FILE` | Values unverifiable from the repo; only SSH (Kevin) can confirm |

The README's env table has drifted (old pool size, old paths) — do not trust it.

## Env-var catalog

Prod column: `eco` = set in `ecosystem.config.js` (value shown), `.env` = server secrets file (value unknown from repo), `—` = prod uses the code default.

### Paths and core

| Var | Purpose | Code default | Prod | Read site |
|---|---|---|---|---|
| `DATABASE_URL` | Prisma SQLite path | none (required) | eco: `file:${DATA_HOME}/db.sqlite` | `prisma/schema.prisma` datasource |
| `PORT` | Next listen port | Next default 3000 | eco: 3000 | framework |
| `NEXT_PUBLIC_APP_URL` | Share links, same-site CSRF guard, skill-handoff webapp URLs. Build-time inlined into client components | falls back to `request.url` / `http://localhost:3000` / `window.location.origin` depending on site | `.env` | `lib/auth.ts:251`, `lib/security/same-site-request.ts:19`, share routes, handoff buttons |
| `UPLOADS_DIR` | SF CSV upload storage | `./uploads` (cwd) | eco: `${DATA_HOME}/uploads` | `lib/upload-helpers.ts:5` |
| `SCREENSHOTS_DIR` | ADA violation screenshots | `./screenshots` | eco: `${DATA_HOME}/screenshots` | `lib/ada-audit/screenshot-helpers.ts:7` |
| `REPORTS_DIR` | Rendered PDF store | `./data/reports` | eco: `${DATA_HOME}/reports` | `lib/report/report-file.ts:6`, `lib/report/seo/seo-report-file.ts:8` |
| `APP_HOME` / `DATA_HOME` / `LOG_HOME` | Path roots, **read only by `ecosystem.config.js`** | `/home/seo/webapps/seo-tools`, `/home/seo/data/seo-tools`, `/home/seo/logs` | (self) | `ecosystem.config.js:3-5` |

### Auth (all `.env` in prod)

| Var | Purpose | Guard behavior |
|---|---|---|
| `APP_AUTH_SECRET` | HMAC key for the `er_auth` session cookie + OAuth handshake tokens | **Boot-refuse** in prod if unset (`requireAuthConfig`, `lib/auth.ts:62`). Dev falls back to `APP_AUTH_PASSWORD` or `'dev-auth-secret'`; prod explicitly refuses the password fallback (`lib/auth.ts:82-90`) |
| `APP_AUTH_PASSWORD` | Break-glass shared password | **Dev-gate trap:** dev auth bypass is active only when `NODE_ENV !== 'production'` AND this is UNSET (`lib/auth.ts:36,54-56`). Setting it locally silently turns the login wall ON in dev |
| `ALLOW_PASSWORD_LOGIN` | Literal `'false'` disables password login at runtime | Fail-at-route (`app/api/auth/login/route.ts:25`; hides the form, `app/login/page.tsx:27`) |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_ALLOWED_HD` | Google OAuth login + hosted-domain allowlist | Prod boot requires the full trio OR `APP_AUTH_PASSWORD` — at least one login path (`lib/auth.ts:69-79`) |

### Skill-handoff token secrets (all `.env` in prod)

| Var | Guard behavior |
|---|---|
| `PILLAR_TOKEN_SECRET` | **Boot-refuse** in prod (`instrumentation.ts:19`) AND throws at use (`lib/pillar-token.ts:28-35`). Dev: warns once, deterministic fallback |
| `SEO_ROADMAP_TOKEN_SECRET` | Fail-at-route only: throws at mint/verify in prod (`lib/seo-roadmap-token.ts`); dev fallback constant + warning |
| `KEYWORD_MEMO_TOKEN_SECRET` | Same pattern (`lib/keyword-memo-token.ts:26-41`) |
| `QUARTER_PUSH_TOKEN_SECRET` | Same pattern (`lib/quarter-push-token.ts:28`) |

Only `PILLAR_TOKEN_SECRET` is checked at boot; the other three break their feature at request time, not the deploy.

### Chrome / ADA audits

| Var | Purpose | Code default | Prod | Read site |
|---|---|---|---|---|
| `CHROME_EXECUTABLE` | Chrome binary path | `/usr/bin/google-chrome` | — | `lib/ada-audit/browser-pool.ts:5` |
| `BROWSER_POOL_SIZE` | Headless page pool | 2 | eco: 4 | `browser-pool.ts:6`. **Never raise above 4** without checking VPS memory — each Chrome page is ~150-200 MB on a 3.82 GB box (CLAUDE.md Do-not) |
| `CHROME_MAX_OLD_SPACE` | Per-page V8 heap MB (`--js-flags`) | 512 | — | `browser-pool.ts:7,24` |
| `SITE_AUDIT_BROWSER_RECYCLE_PAGES` | Recycle Chrome every N pages served | 25 | eco: 15 | `browser-pool.ts:81` |
| `CHROME_PROXY_SERVER` | Enforcing egress proxy for Chromium (SSRF defense) | unset | `.env` (one of guard pair) | `lib/ada-audit/browser-egress.ts:13` |
| `CHROME_PROXY_BYPASS_LIST` | `--proxy-bypass-list` value | unset | `.env` | `browser-egress.ts:14,19-20` |
| `CHROMIUM_NETWORK_ISOLATED` | `true` = firewall attestation instead of proxy | unset | `.env` (guard pair) | `browser-egress.ts:27-31` |

**Boot-refuse:** prod requires `CHROME_PROXY_SERVER` OR `CHROMIUM_NETWORK_ISOLATED=true` (`requireBrowserEgressGuardConfig`, `browser-egress.ts:34-42`; called `instrumentation.ts:48-56`). Which option prod uses is a server-`.env` fact.

### Lighthouse / PageSpeed

| Var | Purpose | Code default | Prod | Read site |
|---|---|---|---|---|
| `LIGHTHOUSE_PROVIDER` | `pagespeed` \| `local` \| `off`; unknown values fall back to `local` | `local` | eco: `pagespeed` | `lib/ada-audit/lighthouse-provider.ts:15-18`. Keep `pagespeed` in prod: local LH strains the 2-vCPU box and pulls the `ws@7` dependency path the S2 (pentest dependency-upgrade phase) security override targets |
| `LIGHTHOUSE_ENABLED` | `'false'` → `off` regardless of provider (kill switch) | `true` | — | `lighthouse-provider.ts:14` |
| `LIGHTHOUSE_TIMEOUT_MS` | Local-LH run timeout | 60000 | — | `lib/ada-audit/lighthouse-runner.ts:8` |
| `PAGESPEED_API_KEY` | Optional; raises PSI quota | unset | `.env` (presence unverified) | `lib/ada-audit/lighthouse-pagespeed.ts:23` |
| `PAGESPEED_TIMEOUT_MS` | PSI request timeout | 90000 | eco: 150000 | `lighthouse-pagespeed.ts:78` |
| `PSI_BACKOFF_BASE_MS` | PSI retry backoff base | 10000 | — | `lighthouse-pagespeed.ts:71` |
| `PSI_CONCURRENCY` | psi job slots | 6 | eco: 15 | `lib/jobs/handlers/psi.ts:130` (CLAUDE.md still describes 6 as prod-ish default — the config wins) |

### Job queue knobs

| Var | Purpose | Code default | Prod | Read site |
|---|---|---|---|---|
| `SITE_AUDIT_CONCURRENCY` | site-audit-page job slots | 1 | eco: 2 | `lib/jobs/handlers/site-audit-page.ts:331` |
| `PDF_POOL_SIZE` | pdf-scan job slots | 4 | — | `lib/jobs/handlers/pdf-scan.ts:186` |
| `ADA_AUDIT_CONCURRENCY` | standalone ada-audit job slots | 2 | — | `lib/jobs/handlers/ada-audit.ts:154` |
| `JOB_POLL_MS` | worker claim-poll interval | 5000 | — | `lib/jobs/config.ts:16` |
| `JOB_STALE_SWEEP_MS` | stale-job sweep interval | 60000 | — | `lib/jobs/config.ts:20` |

Schedule tick is hardcoded 60 s (`lib/jobs/worker.ts:244`), not env-configurable.

### SEO parser concurrency

| Var | Purpose | Code default | Prod | Read site |
|---|---|---|---|---|
| `PARSE_CONCURRENCY` | max concurrent CSV parses in `POST /api/parse/[sessionId]` | 2 | — | `lib/parsers/parse-limit.ts` |

- Clamped to ≥ 1 (bad/zero/negative/NaN → 2, via `parseConcurrencyFromEnv`); never required-in-prod (safe default → no `instrumentation.ts` fail-fast, no pre-deploy `.env` step).
- **Process-wide**, not per-request: a single shared `Semaphore` module singleton caps total concurrent parses across all simultaneous uploads. Sound only under the single-PM2-process model (one Node process = one semaphore).
- Not a job-queue knob — parsing runs inline in the route request/response (the C7 "keep-synchronous" decision). Concurrency lives in `mapWithConcurrency`, a per-call worker pool over the shared semaphore.
- Sizing: ~751 MB peak per big-file stream (C7 pt3 harness); `2 × 751 ≈ 1.5 GB` vs the 2400M PM2 ceiling shared with site-audit/Lighthouse leaves ~900 MB headroom — a conservative default, NOT a hard proof. **Drop to 1** on a box under heavy co-scheduled site-audit load; raising it multiplies peak parse memory.

### Broken-link verifier (C6)

| Var | Code default | Read site |
|---|---|---|
| `BROKEN_LINK_MAX_CHECKS` | 2000 | `lib/jobs/handlers/broken-link-verify.ts:65` |
| `BROKEN_LINK_HOST_DELAY_MS` | 250 | `broken-link-verify.ts:66` |
| `BROKEN_LINK_CONCURRENCY` | 4 (internal workers inside the single job) | `broken-link-verify.ts:67` |
| `BROKEN_LINK_REQUEST_TIMEOUT_MS` | 10000 | `lib/ada-audit/broken-link-check.ts:20` |
| `BROKEN_LINK_EXTERNAL_MAX_CHECKS` | 300 | Max distinct external targets verified per live-scan run. **0 disables external verification entirely** (no-deploy kill switch; parsed via parseNonNegativeInt). |
| `BROKEN_LINK_EXTERNAL_TIMEOUT_MS` | 8000 | Per-request HEAD timeout for external checks (shorter than the 10s internal default). |
| `BROKEN_LINK_EXTERNAL_TIME_BUDGET_MS` | 300000 | Soft wall-clock cap on the external pass; further clamped by remaining job time (JOB_TIMEOUT_MS − elapsed − 60s reserve). Overflow → run status 'partial'. |

### Hybrid discovery crawler (C6, seoIntent site audits only)

| Var | Code default | Read site |
|---|---|---|
| `HYBRID_CRAWL_MAX_DEPTH` | 3 | `lib/ada-audit/sitemap-crawler.ts:28`. BFS hop limit from the seed set. |
| `HYBRID_CRAWL_MAX_ADDED` | 300 | `sitemap-crawler.ts:29`. Max linked pages discovered beyond the seed set. |
| `HYBRID_CRAWL_MAX_FETCHES` | 400 | `sitemap-crawler.ts:30`. Max total page fetches performed during the crawl. |
| `HYBRID_CRAWL_TIME_BUDGET_MS` | 120000 | `sitemap-crawler.ts:31`. Crawl wall-clock budget ceiling; further clamped by remaining time in the `site-audit-discover` job. |
| `HYBRID_CRAWL_CONCURRENCY` | 6 | `sitemap-crawler.ts:32`. Concurrent frontier fetches. |
| `HYBRID_CRAWL_MAX_QUERY_VARIANTS_PER_PATH` | 5 | `sitemap-crawler.ts:33`. Faceted-nav trap guard — caps distinct query-string variants crawled per path. |
| `HYBRID_CRAWL_MAX_PATH_SEGMENTS` | 12 | `sitemap-crawler.ts:34`. Calendar/deep-path trap guard — caps URL path-segment depth followed. |

Applies only to `seoIntent` site audits (hybrid discovery: sitemap-seeded crawl that follows same-domain links); non-seoIntent audits are unaffected.

### Retention / upload / analytics

| Var | Purpose | Code default | Prod | Read site |
|---|---|---|---|---|
| `SCREENSHOT_RETENTION_HOURS` | screenshot sweep window | 24 | — | `lib/ada-audit/screenshot-helpers.ts:14` |
| `SEO_REPORT_RETENTION_SCHEDULED_DAYS` | scheduled SEO-report snapshots | 730 | eco: 730 | `lib/jobs/handlers/seo-report-render.ts:274` |
| `SEO_REPORT_RETENTION_ADHOC_DAYS` | ad-hoc SEO-report snapshots | 90 | eco: 90 | `seo-report-render.ts:275` |
| `UPLOAD_MAX_BODY_BYTES` | per-request upload cap | 104857600 (100 MB) | — | `app/api/upload/route.ts:32` |
| `GOOGLE_SA_KEY_FILE` | path to Google service-account JSON (C10 reports) | unset | `.env` | `lib/analytics/google/auth.ts:20`. **No boot guard** — missing/unreadable file returns null and report routes degrade at request time |
| `CRM_API_BASE` | enables CRM prospects adapter | unset (falls back to `ProspectsEntry` manual rows) | `.env` (presence unknown; adapter is a stub) | `lib/analytics/prospects/prospects-provider.ts:29` |

### Branch-only (as of 2026-07-02 — NOT on main, NOT in prod)

| Var | Purpose | Code default | Read site |
|---|---|---|---|
| `SEO_SF_CANONICAL_WINDOW_DAYS` | SF-upload freshness window before a seoIntent live run can become the canonical SEO run | 30 | `lib/services/seo-canonical.ts:17-19` — file exists only on `feat/autonomous-live-seo-source` (verify: `git cat-file -e main:lib/services/seo-canonical.ts` fails) |

## Boot-time guards — what refuses startup vs fails at route

Prod startup (`instrumentation.ts`) calls `process.exit(1)` on exactly three misconfigurations, in this order:

1. `PILLAR_TOKEN_SECRET` unset (`instrumentation.ts:19-25`)
2. Auth unconfigured: `APP_AUTH_SECRET` missing, or neither the OAuth trio nor `APP_AUTH_PASSWORD` present (`instrumentation.ts:30-39` → `lib/auth.ts:58-79`)
3. Chromium egress guard missing: neither `CHROME_PROXY_SERVER` nor `CHROMIUM_NETWORK_ISOLATED=true` (`instrumentation.ts:48-56`)

A build can succeed and the deploy still crash-loop PM2 purely from these env omissions. **Everything else fails at route/use time**: the three non-pillar token secrets, `GOOGLE_SA_KEY_FILE`, `ALLOW_PASSWORD_LOGIN`, `CRM_API_BASE`. In dev (`NODE_ENV !== 'production'`) all three guards are skipped.

## Job-type configuration table (13 handlers)

`lib/jobs/handlers/register.ts` is the **single truthful registry** — the schema comment on `Job.type` in `prisma/schema.prisma` is stale; never trust it. Defaults when a field is omitted (`lib/jobs/config.ts`): maxAttempts 3, backoffBaseMs 30 s (cap 15 min), timeoutMs 300 s. Heartbeat 15 s, stale-heartbeat threshold 2 min.

| Job type | Concurrency (env, default) | maxAttempts | timeoutMs | Registered at |
|---|---|---|---|---|
| `psi` | `PSI_CONCURRENCY`, 6 (prod 15) | 3 | 120 000 | `psi.ts:128-134` |
| `pdf-scan` | `PDF_POOL_SIZE`, 4 | 3 | 120 000 | `pdf-scan.ts:184-191` |
| `site-audit-page` | `SITE_AUDIT_CONCURRENCY`, 1 (prod 2) | 3 | 300 000 | `site-audit-page.ts:329-337` |
| `site-audit-discover` | 1 | 3 | 300 000 | `site-audit-discover.ts:226-231` |
| `ada-audit` | `ADA_AUDIT_CONCURRENCY`, 2 | 3 | 300 000 | `ada-audit.ts:152-160` |
| `cleanup` | 1 | 1 | 600 000 | `cleanup.ts:16-21` |
| `screenshot-sweep` | 1 | 1 | 600 000 | `screenshot-sweep.ts:14-19` |
| `stale-audit-reset` | 1 | 1 | (default 300 000) | `stale-audit-reset.ts:13-16` |
| `scheduled-site-audit` | 1 | 3 | 30 000 (only enqueues) | `scheduled-site-audit.ts:56-60` |
| `report-render` | 1 | 2 | 120 000 | `report-render.ts:84-89` |
| `broken-link-verify` | 1 (internal workers via `BROKEN_LINK_CONCURRENCY`) | 2 | 900 000 | `broken-link-verify.ts:280-288` |
| `seo-report-render` | 1 | 2 | 600 000 | `seo-report-render.ts:350-355` |
| `seo-report-monthly-run` | 1 | 3 | 60 000 | `seo-report-monthly-run.ts:36-40` |

All handler files live under `lib/jobs/handlers/`.

## Schedule cadence grammar

Parsed by `parseCadence` in `lib/jobs/scheduler.ts:24-55`. Server runs UTC; daily/weekly/monthly use server-local time.

| Form | Example | Meaning |
|---|---|---|
| `every:<n>(m\|h\|d)` | `every:30m` | fixed interval, n > 0 |
| `daily@HH:MM` | `daily@09:00` | once a day |
| `weekly:<0-6>@HH:MM` | `weekly:1@06:00` | day-of-week, 0 = Sunday |
| `monthly:<1-28>@HH:MM` | `monthly:1@06:00` | day-of-month capped at 28 (every month has one) |

`cadenceClass()` (`scheduler.ts:99-106`) buckets for retention: monthly→monthly, weekly→weekly, `every:` ≥ 7 d→weekly, everything else→daily.

**Where each form is allowed:**
- **Client scan schedules** (`POST /api/clients/[id]/schedules`): literal `weekly:`/`monthly:` ONLY — `daily@`/`every:` get 400 `cadence_not_allowed` (`app/api/clients/[id]/schedules/route.ts:77-85`). On this branch the POST also accepts `seoIntent: true` for live-SEO-source schedules (branch-only; best-effort one schedule per client+domain+seoIntent).
- **System schedules**: any form; code-owned in `lib/jobs/system-schedules.ts:29-37` — `system-cleanup` `daily@09:00` (not immediate; the inline boot `runCleanup()` covers post-deploy), `system-screenshot-sweep` `every:30m`, `system-stale-audit-reset` `every:10m` (both immediate). `system-` is a **reserved namespace**: the seed is source of truth, re-asserted at every boot — a manual DB disable of a `system-*` row reverts at next restart. An operator kill switch, if ever needed, is an env flag, not DB mutation.

## Retention windows and hard caps (all values = code, 2026-07-02)

| Thing | Window / cap | Where |
|---|---|---|
| Sessions + their screenshot dirs | 180 d | `lib/cleanup.ts:12` |
| Orphaned (never-parsed) uploads | 24 h | `lib/cleanup.ts:15` |
| Origin blobs (Session.result, SiteAudit.summary, AdaAudit.result) | 90 d archive | `lib/findings/retention.ts:30` |
| HarvestedLink / HarvestedPageSeo stranded rows | 7 d | `lib/findings/retention.ts:124` |
| Terminal Job rows | 7 d complete/cancelled, 30 d error | `lib/jobs/retention.ts:17-19` |
| Schedule-originated site audits | daily 14 d / weekly 90 d / monthly 365 d; keep latest 2 completed per schedule | `lib/ada-audit/scheduled-retention.ts:25-33` |
| SEO report snapshots | 730 d scheduled / 90 d ad-hoc (env-overridable) | `seo-report-render.ts:274-275` |
| Standalone screenshots sweep | 24 h (`SCREENSHOT_RETENTION_HOURS`) | `screenshot-helpers.ts:14` |
| Share tokens | 30 d | `app/api/ada-audit/[id]/share/route.ts:6` |
| Site-audit page discovery | 1000 pages hard cap; 1 MB per crawled HTML page body, 5 MB per fetched sitemap (incl. gunzipped `.xml.gz` output) | `lib/ada-audit/sitemap-crawler.ts:9-12` |
| Link/image harvest | 300 targets per page | `lib/ada-audit/link-harvest.ts:75` |
| Broken-link verification | 2000 checks per audit | `broken-link-verify.ts:65` |
| Upload body | 100 MB per request (`UPLOAD_MAX_BODY_BYTES`); 500 MB/h/IP in-memory quota (resets on every restart) | `app/api/upload/route.ts:20-36` |
| Server actions body | 50 mb | `next.config.ts:46` |
| NGINX `client_max_body_size` | 50m (server-side, per `docs/SERVER_SETUP.md:247`) — can bite before the app's 100 MB cap | not in app code |

## Production-active vs experimental (as of 2026-07-02)

- **Active in prod config**: everything in an `eco` column above, plus the `.env` secrets the boot guards prove exist (if prod is running, `PILLAR_TOKEN_SECRET`, `APP_AUTH_SECRET`, a login path, and an egress guard are set).
- **Default-only knobs** (exist for tuning, no prod override known): `CHROME_MAX_OLD_SPACE`, `LIGHTHOUSE_ENABLED`, `LIGHTHOUSE_TIMEOUT_MS`, `PSI_BACKOFF_BASE_MS`, `JOB_POLL_MS`, `JOB_STALE_SWEEP_MS`, all `BROKEN_LINK_*`, `SCREENSHOT_RETENTION_HOURS`, `UPLOAD_MAX_BODY_BYTES`.
- **Unknown-from-repo** (server `.env` only): `PAGESPEED_API_KEY` presence, `ALLOW_PASSWORD_LOGIN` state, `GOOGLE_ALLOWED_HD` value, which egress-guard option prod uses, `CRM_API_BASE` presence (likely unset — the adapter is a stub).
- **Branch-only / not deployed**: `SEO_SF_CANONICAL_WINDOW_DAYS` and the `seoIntent` schedule payload field.

## Checklist: adding a new env var

1. **Read it in exactly one place** with an explicit code default: `parsePositiveInt(process.env.MY_VAR, <default>)` for numbers (helper in `lib/jobs/config.ts:3-6`), or a module-level constant. The default must make dev work with the var unset.
2. **Decide the prod home**:
   - Non-secret tuning knob that affects audit safety or worker behavior → `ecosystem.config.js` env block, so `pm2 env <id>` can prove the live value (trade-off documented at `ecosystem.config.js:24-25`).
   - Secret, credential, or instance identity → server `.env`. It cannot be verified from the repo, so also document it in `docs/SERVER_SETUP.md`.
3. **Decide the guard**: if the feature is broken-and-silent without it in prod, add a fail-fast to `instrumentation.ts` (pattern: lines 19-25). If you do, **the server `.env` must be updated BEFORE the next deploy** — a missing required-in-prod var crash-loops PM2. Coordinate with Kevin; AI sessions never SSH-mutate the server. If the feature can degrade gracefully, prefer a fail-at-route null-return (pattern: `lib/analytics/google/auth.ts:20-28`).
4. **Never expose it client-side** unless it is genuinely public: `NEXT_PUBLIC_*` values are inlined into the public JS bundle at build time (the 2026-06-29 pentest's top finding was ops strings shipped in the bundle). No ops/infra strings in client components, ever.
5. **Dev setup**: add it to `.env.local` if dev needs a non-default. Remember Vitest does NOT load `.env.local` — DB-backed tests need `DATABASE_URL="file:./local-dev.db" npm test`, and any test reading your var needs it inline the same way.
6. **Docs**: update this skill's table, `docs/SERVER_SETUP.md` if prod-set, and CLAUDE.md only if the var is load-bearing (a Do-not, or a default-vs-prod divergence sessions will trip on).
7. **PM2 gotcha**: if the var lands in `ecosystem.config.js`, the deploy shipping it needs `pm2 delete seo-tools && pm2 start ecosystem.config.js`, not a plain restart (Kevin runs this).

## Common mistakes

- **Assuming code defaults are prod values.** Pool size is 2 in code / 4 in prod; PSI concurrency 6 / 15; site-audit concurrency 1 / 2; recycle pages 25 / 15; lighthouse `local` / `pagespeed`. Always check the `ecosystem.config.js` env block.
- **Setting `APP_AUTH_PASSWORD` in `.env.local`** — silently turns the login gate ON in dev (bypass requires it UNSET).
- **Adding a required-in-prod env without updating the server `.env` first** — the build succeeds, then PM2 crash-loops with `[startup] ... Refusing to start`.
- **Editing `ecosystem.config.js` and doing plain `pm2 restart`** — env changes are only picked up by `pm2 delete` + `pm2 start`.
- **Trusting the README env table or the `Job.type` schema comment** — both are stale. `ecosystem.config.js` and `lib/jobs/handlers/register.ts` are the registries.
- **Raising `BROWSER_POOL_SIZE` above 4** — CLAUDE.md Do-not; ~150-200 MB per Chrome page on a 3.82 GB box.
- **Quoting `SEO_SF_CANONICAL_WINDOW_DAYS` or `seoIntent` schedules as prod behavior** — branch-only until `feat/autonomous-live-seo-source` merges and deploys.
- **Writing `monthly:29@...` or `weekly:7@...`** — dom is 1-28, dow is 0-6; `parseCadence` throws `Unrecognized cadence` / range errors, and the client-schedule API 400s non-weekly/monthly forms anyway.

## Provenance and maintenance

Date stamp: **2026-07-02**, verified on branch `feat/autonomous-live-seo-source` (23 commits ahead of main, not merged, not deployed). Everything here except the two branch-only items also holds on main as of that date, but re-verify after any merge. Prod server-`.env` contents are inherently unverifiable from the repo.

Re-verification one-liners (run from repo root):

- Full env-var sweep: `grep -rn 'process\.env' --include='*.ts' --include='*.tsx' --include='*.js' lib app scripts components instrumentation.ts middleware.ts next.config.ts ecosystem.config.js | grep -v '\.test\.'`
- Prod tuning values: `cat ecosystem.config.js`
- Boot guards: `sed -n '15,62p' instrumentation.ts` and `sed -n '55,95p' lib/auth.ts` and `sed -n '25,45p' lib/ada-audit/browser-egress.ts`
- Job-type table: `cat lib/jobs/handlers/register.ts` then `grep -n 'concurrency\|maxAttempts\|timeoutMs\|backoff' lib/jobs/handlers/*.ts | grep -v test`
- Queue defaults + tick: `cat lib/jobs/config.ts` and `grep -n 'scheduleTimer' lib/jobs/worker.ts`
- Cadence grammar: `sed -n '24,60p' lib/jobs/scheduler.ts`; client-schedule restriction: `grep -n 'cadence_not_allowed' 'app/api/clients/[id]/schedules/route.ts'`
- System schedules: `sed -n '29,37p' lib/jobs/system-schedules.ts`
- Retention: `sed -n '11,16p' lib/cleanup.ts; grep -n 'ARCHIVE_WINDOW_MS\|HARVEST_RETENTION_MS' lib/findings/retention.ts; grep -n 'RETENTION' lib/jobs/retention.ts lib/ada-audit/scheduled-retention.ts`
- Caps: `grep -n 'HARD_CAP' lib/ada-audit/sitemap-crawler.ts; grep -n 'HARVEST_CAP' lib/ada-audit/link-harvest.ts; sed -n '20,36p' app/api/upload/route.ts; grep -n 'bodySizeLimit' next.config.ts`
- Branch-only status: `git cat-file -e main:lib/services/seo-canonical.ts && echo on-main || echo branch-only`
- Lighthouse provider modes: `sed -n '13,18p' lib/ada-audit/lighthouse-provider.ts`
- Token-secret guard pattern: `grep -n 'NODE_ENV' lib/pillar-token.ts lib/seo-roadmap-token.ts lib/keyword-memo-token.ts lib/quarter-push-token.ts`
- Retention env overrides: `sed -n '270,280p' lib/jobs/handlers/seo-report-render.ts`
