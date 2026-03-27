# ER SEO Tools

A unified Next.js webapp housing all SEO tools for the Enrollment Resources team.

## Tools

| Tool | Status | Route | Description |
|---|---|---|---|
| SEO Parser | ✅ Live | `/seo-parser` | Upload Screaming Frog CSVs, get prioritized issue reports, health score, and recommendations |
| SEO Parser — Crawl Diff | ✅ Live | `/seo-parser/diff` | Compare two crawl sessions to track improvement over time |
| SEO Parser — Shared Reports | ✅ Live | `/share/[token]` | Read-only shareable links for completed audits (30-day expiry) |
| Quarter Grid (V1) | ✅ Live | `/quarter-grid/v1` | Basic quarterly planning grid |
| Quarter Grid (V2) | ✅ Live | `/quarter-grid/v2` | Enhanced quarterly planning |
| Quarter Grid (V3) | ✅ Live | `/quarter-grid/v3` | Full-featured: drag-and-drop, per-client notes, Gantt view, 5 statuses, CSV import |
| RankMath Redirects | ✅ Live | `/rankmath-redirects` | WordPress redirect migration guide |
| Robots Validator | ✅ Live | `/robots-validator` | Validate robots.txt + sitemap.xml; AI bot coverage analysis, URL tester |

## Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v3
- **Database:** Prisma + SQLite
- **CSV Parsing:** PapaParse
- **Charts:** Recharts (lazy-loaded)
- **Fonts:** Barlow (display) + Source Sans 3 (body)
- **Hosting:** RunCloud (Native NGINX + Custom Config → Supervisor)

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Set up database
npx prisma db push

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## SEO Parser Features

- **Multi-file upload** — drop any combination of Screaming Frog CSV exports
- **30+ parsers** — internal pages, images, JS, CSS, redirects, hreflang, structured data, analytics, Search Console, PageSpeed, and more
- **SEO Health Score** (0–100) — weighted composite score across indexability, error rate, SEO elements, crawl depth, thin content, and schema coverage
- **Issue prioritization** — critical / warning / notice tiers with per-page drill-down
- **Crawl Diff** — compare any two sessions; surfaces new, resolved, worsened, and improved issues with delta metrics
- **Per-page detail modal** — click any URL in an issue list to see all issues affecting that page
- **Export** — JSON (full data), plain-text summary, or Markdown report (downloaded directly, no blank-tab)
- **Shareable reports** — generate a read-only link valid for 30 days; access count tracked
- **Session history** — last 20 analyses shown on the upload page with site name and health score badge

## Robots Validator Features

- Paste or fetch any `robots.txt` — full directive parsing with line-level issue reporting
- **AI bot coverage panel** — shows which AI crawlers (GPTBot, ClaudeBot, Googlebot-Extended, etc.) are allowed or blocked
- **URL tester** — test any path against any user-agent to see the matching rule
- Sitemap URL extraction and validation

## Deployment (RunCloud)

The app runs on RunCloud using **Native NGINX + Custom Config** as a reverse proxy to a Node.js process managed by **Supervisor**.

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

### Supervisor Job
- **Command:** `/usr/bin/npm start`
- **Directory:** `/home/seotools/webapps/er-seo-tools`
- **User:** `seotools`
- **Auto Start / Auto Restart:** enabled

### Environment Variables
```
DATABASE_URL=file:/home/seotools/data/er-seo-tools/db.sqlite
UPLOADS_DIR=/home/seotools/data/er-seo-tools/uploads
PORT=3000
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

> `NEXT_PUBLIC_APP_URL` is used to generate correct absolute URLs for shareable report links. Set it to the public hostname of the app.

### First Deploy (SSH)
```bash
mkdir -p /home/seotools/data/er-seo-tools/uploads
cd /home/seotools/webapps/er-seo-tools
npm install
npm run build
npx prisma generate
DATABASE_URL="file:/home/seotools/data/er-seo-tools/db.sqlite" npx prisma migrate deploy
```

### Subsequent Deploys
```bash
cd /home/seotools/webapps/er-seo-tools
git pull
npm install
npm run build
# Only if schema changed:
DATABASE_URL="file:/home/seotools/data/er-seo-tools/db.sqlite" npx prisma migrate deploy
supervisorctl restart er-seo-tools
```
