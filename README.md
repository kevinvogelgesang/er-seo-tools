# ER SEO Tools

A unified Next.js webapp housing all SEO tools for the Enrollment Resources team.

> New to this codebase? Start at [docs/onboarding/README.md](docs/onboarding/README.md).

## Tools

| Tool | Route | Description |
|---|---|---|
| SEO Parser | `/seo-parser` | Upload Screaming Frog CSVs, get prioritized issue reports, health score, and recommendations |
| SEO Parser — Crawl Diff | `/seo-parser/diff` | Compare two crawl sessions to track improvement over time |
| SEO Parser — Shared Reports | `/share/[token]` | Read-only shareable links for completed audits (30-day expiry) |
| ADA Audit | `/ada-audit` | Single-page WCAG accessibility audit via headless Chrome + axe-core |
| ADA Audit — Site-wide | `/ada-audit` (Site tab) | Crawl an entire domain via sitemap and audit all pages (queued, one at a time) |
| ADA Audit — Shared Reports | `/ada-audit/share/[token]` | Read-only shareable links for audit results |
| Quarter Grid (V1) | `/quarter-grid/v1` | Basic quarterly planning grid |
| Quarter Grid (V2) | `/quarter-grid/v2` | Enhanced quarterly planning |
| Quarter Grid (V3) | `/quarter-grid/v3` | Full-featured: drag-and-drop, per-client notes, Gantt view, 5 statuses, CSV import |
| RankMath Redirects | `/rankmath-redirects` | WordPress redirect migration guide |
| Robots Validator | `/robots-validator` | Validate robots.txt + sitemap.xml; AI bot coverage analysis, URL tester |
| Clients | `/clients` | Client management with domain-based auto-matching for audits |

## Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v3 (class-based dark mode with system preference detection)
- **Database:** Prisma + SQLite
- **Accessibility auditing:** puppeteer-core + axe-core (headless Google Chrome)
- **CSV Parsing:** PapaParse
- **Charts:** Recharts (lazy-loaded)
- **Fonts:** Barlow (display) + Source Sans 3 (body)
- **Theming:** Dark/light mode toggle with `localStorage` persistence; anti-FOUC inline script
- **Hosting:** RunCloud (DigitalOcean VPS, Ubuntu 20.04)

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Set up database
npx prisma migrate dev

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** ADA audits require Google Chrome. On macOS, set `CHROME_EXECUTABLE` in `.env` to the path of your Chrome installation (e.g. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`). On the production server it's installed at `/usr/bin/google-chrome`.

## SEO Parser Features

- **Multi-file upload** — drop any combination of Screaming Frog CSV exports
- **30+ parsers** — internal pages, images, JS, CSS, redirects, hreflang, structured data, analytics, Search Console, PageSpeed, and more
- **SEO Health Score** (0–100) — weighted composite score across indexability, error rate, SEO elements, crawl depth, thin content, and schema coverage
- **Issue prioritization** — critical / warning / notice tiers with per-page drill-down
- **Crawl Diff** — compare any two sessions; surfaces new, resolved, worsened, and improved issues with delta metrics
- **Per-page detail modal** — click any URL in an issue list to see all issues affecting that page
- **Export** — JSON (full data), plain-text summary, or Markdown report
- **Shareable reports** — generate a read-only link valid for 30 days; access count tracked
- **Session history** — last 20 analyses shown on the upload page with site name and health score badge

## ADA Audit Features

- **Full-render auditing** — headless Chrome loads the page with real CSS and fonts, so color-contrast and focus-indicator checks actually run
- **WCAG 2.1 AA** (Required) — runs all WCAG 2.0 A/AA + 2.1 A/AA axe-core rules
- **+ Best Practices** (Aspirational) — adds axe best-practice rules (landmark structure, heading order, label quality) and WCAG 2.2 AA rules on top
- **Live progress bar** — per-phase progress (verifying URL → loading page → running checks) with elapsed time and estimated completion
- **Scored results** — 0–100 score with weighted penalty per impact level; compliant/non-compliant badge
- **Site-wide audits** — discovers all pages via sitemap (robots.txt directives, `/sitemap.xml`, `/wp-sitemap.xml`, gzip support, 1000-page hard cap); two-step flow: discover pages → confirm count → start audit
- **Global audit queue** — only one site audit runs at a time (FIFO); queued audits show position and active audit's live progress; queue status visible on the form page, poller page, and history table
- **Stale audit recovery** — heartbeat via `updatedAt`; audits stuck for 5+ minutes auto-recover on a 10-minute interval and on server startup
- **Sort, filter, and sitemap view** — results toolbar with impact filter pills, sort dropdown, and table/sitemap tree toggle; clean pages (0 violations) in a separate collapsible section; paginated at 50 rows
- **Shareable links** — one-click share button generates a public read-only URL
- **JS-rendered SPA detection** — warns when the page has fewer than 50 DOM elements (static HTML shell, results unreliable)
- **Client association** — link audits to a client record for filtered history views

## Robots Validator Features

- Paste or fetch any `robots.txt` — full directive parsing with line-level issue reporting
- **AI bot coverage panel** — shows which AI crawlers (GPTBot, ClaudeBot, Googlebot-Extended, etc.) are allowed or blocked
- **URL tester** — test any path against any user-agent to see the matching rule
- Sitemap URL extraction and validation

## Deployment

The app runs on a DigitalOcean VPS managed by RunCloud, with NGINX as a reverse proxy and the Next.js process kept alive via `nohup`.

### Prerequisites (one-time server setup)

```bash
# Install Google Chrome (required for ADA audits)
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install ./google-chrome-stable_current_amd64.deb
```

### Standard Deploy

```bash
git push
ssh seo@144.126.213.242 "~/deploy.sh"
```

### NGINX Config
Type: `location.root` — Predefined: **NGINX Reverse Proxy**

```nginx
proxy_pass http://127.0.0.1:3000;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-Host $host;
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### Environment Variables
```
DATABASE_URL=file:/home/seotools/data/er-seo-tools/db.sqlite
UPLOADS_DIR=/home/seotools/data/er-seo-tools/uploads
UPLOAD_MAX_BODY_BYTES=104857600             # optional, default 100MB per request
PORT=3000
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://your-domain.com
APP_AUTH_PASSWORD=replace-with-a-strong-shared-password
CHROME_EXECUTABLE=/usr/bin/google-chrome   # optional, this is the default
BROWSER_POOL_SIZE=2                        # optional, max concurrent Chrome pages
SITE_AUDIT_CONCURRENCY=1                   # optional, concurrent pages within one site audit
SITE_AUDIT_BROWSER_RECYCLE_PAGES=15        # optional, restart Chrome during long site audits
CHROME_PROXY_SERVER=http://127.0.0.1:3128  # recommended: proxy blocks private/reserved IPs
# or, only after host/network firewall rules isolate Chromium from private, link-local, and reserved networks:
CHROMIUM_NETWORK_ISOLATED=true
```

> `NEXT_PUBLIC_APP_URL` is used to generate correct absolute URLs for shareable report links. Set it to the public hostname of the app.
> `APP_AUTH_PASSWORD` is required in production. In local dev/test only, leaving it unset disables the auth gate.
> `UPLOAD_MAX_BODY_BYTES` is checked before multipart parsing; keep your reverse proxy body-size limit at or below the same value.
> Chromium uses its own resolver/network stack. In production, configure `CHROME_PROXY_SERVER` to an enforcing outbound proxy or set `CHROMIUM_NETWORK_ISOLATED=true` only after deploying host/network firewall rules that block private, link-local, and reserved networks from Chromium.

### Server Paths
- **App:** `/home/seotools/webapps/er-seo-tools`
- **DB:** `/home/seotools/data/er-seo-tools/db.sqlite`
- **Uploads:** `/home/seotools/data/er-seo-tools/uploads`
- **Log:** `/home/seotools/er-seo-tools.log`
