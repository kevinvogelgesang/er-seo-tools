# ER SEO Tools

A unified Next.js webapp housing all SEO tools for the Enrollment Resources team.

## Tools

| Tool | Status | Route |
|---|---|---|
| SEO Parser | ✅ Live | `/seo-parser` |
| Quarter Grid (V1) | ✅ Live | `/quarter-grid/v1` |
| Quarter Grid (V2) | ✅ Live | `/quarter-grid/v2` |
| Quarter Grid (V3) | ✅ Live | `/quarter-grid/v3` |
| RankMath Redirects | ✅ Live | `/rankmath-redirects` |

## Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v3
- **Database:** Prisma + SQLite
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
```

### First Deploy (SSH)
```bash
mkdir -p /home/seotools/data/er-seo-tools/uploads
cd /home/seotools/webapps/er-seo-tools
npm install
npm run build
npx prisma generate
npx prisma db push
```
