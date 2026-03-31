# ER SEO Tools — Claude Context

Internal SEO toolkit for Enrollment Resources. Next.js 15 App Router, TypeScript, Tailwind CSS, Prisma + SQLite. Deployed on RunCloud (not Vercel/serverless).

## Stack constraints
- **Node 18** on production — keep all deps Node 18 compatible (e.g. jsdom ≤ v25)
- **SQLite only** — no Postgres/MySQL
- **No serverless** — RunCloud + `nohup npm start`, process killed with `fuser -k 3000/tcp`
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
- `lib/ada-audit/types.ts` — shared types for axe-core results (`StoredAxeResults`, `AxeViolation`, etc.)
- `lib/ada-audit/runner.ts` — axe-core runner (jsdom + axe, outside-only scripts, SSRF protection)
- `lib/ada-audit/scoring.ts` — `computeScore(violations, wcagLevel)` → `{ score: 0–100, compliant: boolean }`
- `lib/ada-audit/sitemap-crawler.ts` — `discoverPages(domain)` with sitemap + shallow crawl fallback
- `lib/services/scoring.service.ts` — `computeHealthScore()` for SEO parser crawls
- `lib/parsers/` — CSV parsers extending `BaseParser` with O(1) `headerMap` column lookup

## Architecture patterns
- **ADA audit polling:** POST creates record → background runner updates status → client polls `/api/ada-audit/[id]`
- **Recharts** lazy-loaded via `next/dynamic` to avoid SSR issues
- **File I/O** uses `fs/promises` (async) everywhere
- **JSON.parse** always wrapped in try-catch in API routes
- **Share URLs** use `NEXT_PUBLIC_APP_URL` env var (not request origin)
- **Parallel agent pattern for large features:** schema changes first → agents own exclusive file sets in parallel → integration pass → `tsc --noEmit` → build → commit → deploy

## Tools in the app
| Route | Description |
|-------|-------------|
| `/seo-parser` | Upload Screaming Frog CSVs → prioritized SEO report with health score |
| `/ada-audit` | Single-page and site-wide WCAG 2.1/2.2 AA audit via axe-core |
| `/robots-validator` | robots.txt + sitemap.xml validation |
| `/quarter-grid` | Drag-and-drop quarterly planning for ~30 clients (v1/v2/v3) |
| `/rankmath-redirects` | WordPress redirect migration guide |
| `/clients` | Client management with domain matching |

## ADA Audit specifics
- axe-core runs inside jsdom with `runOnly` tag filter, `reporter: 'no-passes'`, `iframes: false`
- `wcagLevel`: `wcag21aa` (default, "Required") or `wcag22aa` ("Recommended")
- Score formula: weighted penalty per impact level ÷ log10(totalElements), floor 0
- `shareToken` on `AdaAudit` enables public read-only view at `/ada-audit/share/[token]`
- Site audits discover pages via sitemap → fallback shallow crawl (regex `<a href>`, cap 50)

## Do not
- Add Claude AI analysis features — requires separate Anthropic API billing not currently set up
- Use `npm ci` on production (RunCloud uses `npm install`)
- Trust request origin headers for share URLs — use `NEXT_PUBLIC_APP_URL`
