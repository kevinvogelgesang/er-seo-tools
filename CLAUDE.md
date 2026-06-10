# ER SEO Tools — Claude Context

Internal SEO toolkit for Enrollment Resources. Next.js 15 App Router, TypeScript, Tailwind CSS (class-based dark mode), Prisma + SQLite. Deployed on RunCloud (not Vercel/serverless).

## Stack constraints
- **Node 22** on production
- **SQLite only** — no Postgres/MySQL
- **No serverless** — RunCloud + PM2
- **Google Chrome** must be installed on the server (`/usr/bin/google-chrome`) for ADA audits
- **Do not change the core stack** unless explicitly asked

## Deploy
Always `git push` before SSHing — the server pulls from GitHub.

```bash
ssh seo@144.126.213.242 "~/deploy.sh"
```

- **App path:** `/home/seo/webapps/seo-tools`
- **DB:** `/home/seo/data/seo-tools/db.sqlite`
- **Uploads:** `/home/seo/data/seo-tools/uploads`
- **Logs:** `/home/seo/logs/`

## Improvement-roadmap handoff protocol

Triggered when a session completes (or meaningfully advances) an item in
`docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`, **or**
whenever Kevin asks for "the handoff prompt" / "handoff". Do all three, in order:

1. Update the tracker: checkbox status + a dated status-log line.
2. Rewrite `docs/superpowers/todos/HANDOFF-improvement-roadmap.md` — current
   state, the single next item with key context, gotchas. Commit it together
   with the tracker change.
3. **End your final reply with the handoff doc's "Paste this into a new chat"
   prompt in a code block**, so Kevin can copy it straight into the next chat.

## Schema changes
1. Edit `prisma/schema.prisma`
2. `npx prisma migrate dev --name <name>` — creates migration + regenerates client locally
3. Production migration runs automatically via `prisma migrate deploy` in the deploy command

## Key files
- `components/ThemeProvider.tsx` — React context for dark/light mode; reads `localStorage('er-theme')` + `prefers-color-scheme`; toggles `.dark` class on `<html>`
- `components/ThemeToggle.tsx` — Sun/Moon toggle button rendered in Nav; waits for `mounted` to avoid hydration mismatch
- `lib/db.ts` — Prisma client singleton (import as `import { prisma } from '@/lib/db'`)
- `lib/ada-audit/types.ts` — shared types for axe-core results (`StoredAxeResults`, `AxeViolation`, `AuditDetail`, etc.)
- `lib/ada-audit/browser-pool.ts` — singleton headless Chrome + page pool (size 2); `acquirePage()` / `releasePage()` / `closeBrowser()`
- `lib/ada-audit/runner.ts` — axe-core runner via puppeteer-core; SSRF protection, progress callbacks, `wcagTags` expansion
- `lib/ada-audit/scoring.ts` — `computeScore(violations, wcagLevel)` → `{ score: 0–100, compliant: boolean }`
- `lib/ada-audit/sitemap-crawler.ts` — `discoverPages(domain)` with robots.txt, wp-sitemap, gzip support, 1000-page hard cap
- `lib/ada-audit/queue-manager.ts` — global FIFO queue: `enqueueAudit()` / `processNext()` / `resetStaleAudits()` / `recoverQueue()`
- `lib/ada-audit/site-audit-helpers.ts` — `buildSiteAuditSummary()`, `addScorecards()`, `ZERO_SCORECARD`
- `lib/services/scoring.service.ts` — `computeHealthScore()` for SEO parser crawls
- `lib/parsers/` — CSV parsers extending `BaseParser` with O(1) `headerMap` column lookup

## Architecture patterns
- **ADA audit polling:** POST creates record → background runner updates `progress`/`progressMessage` as it runs → client polls `/api/ada-audit/[id]` every second → `AuditPoller` renders live progress bar with elapsed + estimated time
- **Site audit queue:** Only one site audit runs at a time. `enqueueAudit()` creates record in `queued` status → `processNext()` picks oldest queued audit when nothing is running → chains to next on completion. `SiteAuditPoller` shows queue position + active audit progress. `SiteAuditForm` polls `/api/site-audit/queue` every 5s to show a live banner. `SiteAuditHistory` smart-polls every 8s when active audits exist.
- **Site-audit phase model:** `queued → running → (pdfs-running | lighthouse-running, in that priority) → complete`. The page loop bumps `pagesComplete` after each axe finishes (and sets each child `AdaAudit` to `axe-complete` while the PSI worker drains in parallel via `lib/ada-audit/lighthouse-queue.ts`). `finalizeSiteAudit` is the single decision point: it requires `pagesDone && pdfsDone && lighthouseDone` to flip to `complete`, otherwise picks `pdfs-running` (priority) or `lighthouse-running` as the transient status. PSI worker pool size is controlled by `PSI_CONCURRENCY` (default 6).
- **Stale audit recovery:** `updatedAt` field auto-updates on every Prisma write (heartbeat). `resetStaleAudits()` runs every 10 min during runtime — audits stuck in `running` / `pdfs-running` / `lighthouse-running` for 5+ min get errored. `recoverQueue()` runs once at startup and immediately fails any `running` / `pdfs-running` / `lighthouse-running` parent (a fresh Node process cannot resume in-memory page work or the in-process PSI queue). Both paths cascade-fail orphan `AdaAudit` rows (via `failOrphanAdaAudits`, which also catches `axe-complete` rows whose PSI never ran) and `PdfAudit` rows (via `failOrphanPdfAudits`) so per-page pollers and PDF scanners stop spinning.
- **Browser pool:** `acquirePage()` blocks when both slots are in use; `releasePage()` closes the page and wakes the next waiter. Never hold a page across awaits you don't control.
- **SIGTERM handler** in `instrumentation.ts` calls `closeBrowser()` so Chrome doesn't orphan on deploy restarts
- **Recharts** lazy-loaded via `next/dynamic` to avoid SSR issues
- **File I/O** uses `fs/promises` (async) everywhere
- **JSON.parse** always wrapped in try-catch in API routes
- **Share URLs** use `NEXT_PUBLIC_APP_URL` env var (not request origin)
- **Dark mode:** Tailwind `darkMode: 'class'`; anti-FOUC `<script>` in layout sets `.dark` before React hydrates; `ThemeProvider` context exposes `theme`/`toggle`/`mounted`; every component uses `dark:` variants mapping `bg-white` → `dark:bg-navy-card`, `text-gray-*` → `dark:text-white/*`, `border-gray-*` → `dark:border-navy-border`, semantic status colors → `dark:bg-{color}-500/{opacity}`
- **Parallel agent pattern for large features:** schema changes first → agents own exclusive file sets in parallel → integration pass → `tsc --noEmit` → build → commit → deploy

## Tools in the app
| Route | Description |
|-------|-------------|
| `/seo-parser` | Upload Screaming Frog CSVs → prioritized SEO report with health score |
| `/ada-audit` | Single-page and site-wide WCAG accessibility audit via headless Chrome + axe-core |
| `/robots-validator` | robots.txt + sitemap.xml validation |
| `/quarter-grid` | Drag-and-drop quarterly planning for ~30 clients (v1/v2/v3) |
| `/rankmath-redirects` | WordPress redirect migration guide |
| `/clients` | Client management with domain matching |

## ADA Audit specifics
- axe-core runs inside headless Chrome (puppeteer-core). Navigation uses `waitUntil: 'domcontentloaded'` (30 s budget) followed by a best-effort `waitForNetworkIdle({ idleTime: 500, timeout: 5_000 })` settle via `postLoadSettle` in `lib/ada-audit/page-load.ts`. The settle is non-fatal — analytics/chat poll traffic on real client sites would otherwise prevent network-idle from ever firing. CSS and fonts that block first-paint are already in the DOM at DCL; color-contrast checks still work.
- `wcagLevel`: `wcag21aa` (default, "Required") runs `['wcag2a','wcag2aa','wcag21a','wcag21aa']`; `wcag22aa` ("Aspirational") adds `['wcag22aa','best-practice']`
- Progress written to DB at each phase (5→10→20→75→82→95→100%); client polls every second and shows live bar + estimated time
- `runnerType` column on `AdaAudit`/`SiteAudit`: `'browser'` for new audits, `'jsdom'` for legacy
- `domElementCount` stored in result JSON — values < 50 trigger an "unreliable result" warning (JS-rendered SPA)
- Score formula: weighted penalty per impact level ÷ log10(totalElements), floor 0
- `shareToken` on `AdaAudit` enables public read-only view at `/ada-audit/share/[token]`
- Site audits discover pages via robots.txt `Sitemap:` directives → `/sitemap.xml` → `/sitemap_index.xml` → `/wp-sitemap.xml` → `.xml.gz` → shallow crawl fallback; hard cap 1000 pages; per-site concurrency = 2 (configurable via `SITE_AUDIT_CONCURRENCY`), browser pool size = 4 (configurable via `BROWSER_POOL_SIZE`), Chrome recycles every 15 pages within a site audit
- **Queue:** site audits enter `queued` status (FIFO), only one runs at a time; `discoveredUrls` stored as JSON on the SiteAudit row so queued audits don't re-crawl
- **Results views:** sort/filter toolbar (impact pills, sort dropdown), table vs sitemap tree toggle, paginated at 50 rows, clean pages in separate collapsible section
- Chrome executable path: `/usr/bin/google-chrome` (override with `CHROME_EXECUTABLE` env var)
- **Lighthouse provider:** controlled by `LIGHTHOUSE_PROVIDER` (`pagespeed` | `local` | `off`). Default is `local` in code, `pagespeed` in the deployed `ecosystem.config.js`. PSI uses Google's infrastructure; expect score variance versus historical local-LH numbers. Per-page PSI failures fail the Lighthouse portion only — axe + PDFs still run.

## Do not
- Add Claude AI analysis features — requires separate Anthropic API billing not currently set up
- Use `npm ci` on production (RunCloud uses `npm install`)
- Trust request origin headers for share URLs — use `NEXT_PUBLIC_APP_URL`
- Increase `BROWSER_POOL_SIZE` above 4 without first checking VPS memory headroom — each Chrome page is ~150-200 MB resident
