# ER SEO Tools — Agent Context (slim)

Internal SEO toolkit for Enrollment Resources. Next.js 15 App Router, TypeScript, Tailwind (class-based dark mode), Prisma + SQLite, deployed on RunCloud + PM2 (NOT serverless, NOT Vercel). Node 22 in production.

This file is intentionally slim to keep per-session context cost low. **`CLAUDE.md` in this directory is the canonical, exhaustive project context** — architecture patterns, key-file map, job-queue semantics, findings layer, retention rules. Read it (or the relevant section) before answering anything non-trivial about architecture, jobs, findings, or scoring.

## Hard invariants (violations are review findings)

- **Array-form `$transaction([...])` ONLY** — interactive `prisma.$transaction(async tx => ...)` is banned. It holds SQLite's write lock across event-loop round-trips and caused a production incident (2026-06-10, "Operations timed out"). Express conditional logic in SQL (`EXISTS` predicates). Raw SQL must set `updatedAt` manually (`Date.now()`, integer ms).
- **SQLite only** — no Postgres/MySQL. No serverless assumptions anywhere.
- **No AI/LLM API calls in the app** (decided 2026-07-08) — all AI stays in the external skill-handoff clipboard flow (pat_/srt_/krt_/qct_ tokens).
- **Share URLs use `NEXT_PUBLIC_APP_URL`**, never request origin headers.
- `updatedAt` is the staleness heartbeat for transient site audits; `AdaAudit` has NO `updatedAt` (job state is its liveness source).
- New API routes wrap handlers in `withRoute` (`lib/api/with-route.ts`) and parse bodies with `parseJsonBody`. Auth lives in middleware, not in `withRoute`.
- Findings dual-write hooks are fire-and-forget AFTER the legacy commit — a findings failure must never fail the legacy path.
- A live-scan `CrawlRun` must NEVER displace the `sf-upload` canonical SEO score (`findings-shared.selectRuns`).
- `BROWSER_POOL_SIZE` stays ≤ 4 (each Chrome page ≈ 150–200 MB resident). Never hold a pooled page across awaits you don't control.
- Durable-job group `site-audit:<id>` means audit liveness to recovery — never reuse it for unrelated jobs (reports use `report:<id>`; notify jobs use no group).

## Orientation

- Durable job queue: `lib/jobs/` (conditional-update claim, attempt-fenced settle, `onExhausted` hooks).
- Site-audit phase model: `queued → running → (pdfs-running | lighthouse-running) → complete`; `finalizeSiteAudit` is the single decision point.
- Normalized findings layer: `lib/findings/` (blob → `CrawlRun`/`CrawlPage`/`Finding`/`Violation`; 90-day blob pruning with read-time fallbacks).
- ADA audits: axe-core in headless Chrome via `lib/ada-audit/` (browser pool size 2 for standalone, SSRF-guarded runner).
- Full route map, env vars, and deploy protocol: see `CLAUDE.md`.
