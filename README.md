# ER SEO Tools

A unified Next.js webapp housing all SEO tools for the Enrollment Resources team.

## Tools

| Tool | Status | Route |
|---|---|---|
| SEO Parser | 🚧 Migrating | `/seo-parser` |
| Quarter Grid (V1) | 🚧 Migrating | `/quarter-grid/v1` |
| Quarter Grid (V2) | 🚧 Migrating | `/quarter-grid/v2` |
| Quarter Grid (V3) | 🚧 Migrating | `/quarter-grid/v3` |
| RankMath Redirects | 🚧 Migrating | `/rankmath-redirects` |

## Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v3
- **Database:** Prisma + SQLite
- **Fonts:** Barlow (display) + Source Sans 3 (body)
- **Hosting:** RunCloud (Node.js app)

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Set up database
npm run db:push

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deployment (RunCloud)

1. Create a **Node.js app** in RunCloud, pointed at this git repo
2. Set RunCloud app commands:
   - **Install:** `npm install`
   - **Build:** `npm run build`
   - **Start:** `npm start`
3. Set environment variables in RunCloud panel:
   - `DATABASE_URL=file:/var/lib/er-seo-tools/prod.db` (or your preferred persistent path)
4. Make sure the DB file path exists and is writable by the RunCloud app user

## Migration Progress

### SEO Parser
Source: `tools/seo-claude-upgrades/seo-parser/seo-parser-web/`

- [ ] Copy `lib/parsers/` from `backend/src/parsers/`
- [ ] Copy `lib/services/` from `backend/src/services/`
- [ ] Copy `components/seo-parser/` from `frontend/src/components/`
- [ ] Convert Express `upload.routes.ts` → `app/api/upload/route.ts`
- [ ] Convert Express `parse.routes.ts` → `app/api/parse/[sessionId]/route.ts`
- [ ] Convert Express `export.routes.ts` → `app/api/export/[sessionId]/route.ts`
- [ ] Migrate `HomePage.tsx` → `app/seo-parser/page.tsx`
- [ ] Migrate `ResultsPage.tsx` → `app/seo-parser/results/[sessionId]/page.tsx`

### Quarter Grid
Source: `tools/seo-tools-app/standalone-app-files/seo-quarter-planner/`

- [ ] Extract V1 from `seo-quarter-planner_1.html` → `app/quarter-grid/v1/page.tsx`
- [ ] Extract V2 from `seo-quarter-planner_2.html` → `app/quarter-grid/v2/page.tsx`
- [ ] Extract V3 from `seo-quarter-planner.html` → `app/quarter-grid/v3/page.tsx`

### RankMath Redirects
Source: `tools/seo-tools-app/standalone-app-files/rankmath-redirect-instructions/`

- [ ] Port `rankmath-redirects-cheatsheet_2.html` → `app/rankmath-redirects/page.tsx`
- [ ] Preserve copy-to-clipboard JS
- [ ] Add Workflow A / Workflow B anchor nav
