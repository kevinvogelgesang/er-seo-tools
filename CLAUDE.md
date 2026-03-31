# ER SEO Tools — Claude Context

Internal SEO toolkit for Enrollment Resources. Next.js 15 App Router, TypeScript, Tailwind CSS, Prisma + SQLite. Deployed on RunCloud (not Vercel/serverless).

## Stack constraints
- **Node 18** on production — keep all deps Node 18 compatible
- **SQLite only** — no Postgres/MySQL
- **No serverless** — RunCloud + `nohup npm start`, process killed with `fuser -k 3000/tcp`
- **Google Chrome** must be installed on the server (`/usr/bin/google-chrome`) for ADA audits
- **Do not change the core stack** unless explicitly asked

## Deploy
Always `git push` before SSHing — the server pulls from GitHub.

```bash
ssh seotools@161.35.235.157 "cd /home/seotools/webapps/er-seo-tools && git pull && npm install && DATABASE_URL='file:/home/seotools/data/er-seo-tools/db.sqlite' npx prisma generate && npm run build && DATABASE_URL='file:/home/seotools/data/er-seo-tools/db.sqlite' npx prisma migrate deploy && fuser -k 3000/tcp; nohup npm start > /home/seotools/er-seo-tools.log 2>&1 &"
```

- **App path:** `/home/seotools/webapps/er-seo-tools`
- **DB:** `/home/seotools/data/er-seo-tools/db.sqlite`
- **Uploads:** `/home/seotools/data/er-seo-tools/uploads`
- **Log:** `/home/seotools/er-seo-tools.log`

## Schema changes
1. Edit `prisma/schema.prisma`
2. `npx prisma migrate dev --name <name>` — creates migration + regenerates client locally
3. Production migration runs automatically via `prisma migrate deploy` in the deploy command

## Key files
- `lib/db.ts` — Prisma client singleton (import as `import { prisma } from '@/lib/db'`)
- `lib/ada-audit/types.ts` — shared types for axe-core results (`StoredAxeResults`, `AxeViolation`, `AuditDetail`, etc.)
- `lib/ada-audit/browser-pool.ts` — singleton headless Chrome + page pool (size 2); `acquirePage()` / `releasePage()` / `closeBrowser()`
- `lib/ada-audit/runner.ts` — axe-core runner via puppeteer-core; SSRF protection, progress callbacks, `wcagTags` expansion
- `lib/ada-audit/scoring.ts` — `computeScore(violations, wcagLevel)` → `{ score: 0–100, compliant: boolean }`
- `lib/ada-audit/sitemap-crawler.ts` — `discoverPages(domain)` with sitemap + shallow crawl fallback
- `lib/services/scoring.service.ts` — `computeHealthScore()` for SEO parser crawls
- `lib/parsers/` — CSV parsers extending `BaseParser` with O(1) `headerMap` column lookup

## Architecture patterns
- **ADA audit polling:** POST creates record → background runner updates `progress`/`progressMessage` as it runs → client polls `/api/ada-audit/[id]` every second → `AuditPoller` renders live progress bar with elapsed + estimated time
- **Browser pool:** `acquirePage()` blocks when both slots are in use; `releasePage()` closes the page and wakes the next waiter. Never hold a page across awaits you don't control.
- **SIGTERM handler** in `instrumentation.ts` calls `closeBrowser()` so Chrome doesn't orphan on deploy restarts
- **Recharts** lazy-loaded via `next/dynamic` to avoid SSR issues
- **File I/O** uses `fs/promises` (async) everywhere
- **JSON.parse** always wrapped in try-catch in API routes
- **Share URLs** use `NEXT_PUBLIC_APP_URL` env var (not request origin)
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
- axe-core runs inside headless Chrome (puppeteer-core) with `waitUntil: 'networkidle2'` so CSS and fonts load — color-contrast checks work
- `wcagLevel`: `wcag21aa` (default, "Required") runs `['wcag2a','wcag2aa','wcag21a','wcag21aa']`; `wcag22aa` ("Aspirational") adds `['wcag22aa','best-practice']`
- Progress written to DB at each phase (5→10→20→75→82→95→100%); client polls every second and shows live bar + estimated time
- `runnerType` column on `AdaAudit`/`SiteAudit`: `'browser'` for new audits, `'jsdom'` for legacy
- `domElementCount` stored in result JSON — values < 50 trigger an "unreliable result" warning (JS-rendered SPA)
- Score formula: weighted penalty per impact level ÷ log10(totalElements), floor 0
- `shareToken` on `AdaAudit` enables public read-only view at `/ada-audit/share/[token]`
- Site audits discover pages via sitemap → fallback shallow crawl (regex `<a href>`, cap 50); concurrency = 2 (matches browser pool size)
- Chrome executable path: `/usr/bin/google-chrome` (override with `CHROME_EXECUTABLE` env var)

## Do not
- Add Claude AI analysis features — requires separate Anthropic API billing not currently set up
- Use `npm ci` on production (RunCloud uses `npm install`)
- Trust request origin headers for share URLs — use `NEXT_PUBLIC_APP_URL`
- Increase browser pool size (`BROWSER_POOL_SIZE`) without checking VPS memory — each page ~150MB resident
