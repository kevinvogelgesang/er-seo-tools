# ER SEO Tools — Agent Context (slim)

Internal SEO toolkit for Enrollment Resources. Next.js 15 App Router, TypeScript, Tailwind (class-based dark mode), Prisma + SQLite, deployed on RunCloud + PM2 (NOT serverless, NOT Vercel). Node 22 in production.

This file is intentionally slim to keep per-session context cost low. **`CLAUDE.md` in this directory is the canonical, exhaustive project context** — architecture patterns, key-file map, job-queue semantics, findings layer, retention rules.

**Claude and Codex are peers here** with the same context and discipline. Everything an agent needs beyond this file lives in `CLAUDE.md` (deep reference) and the `er-seo-tools-*` skills (both harnesses share the same skill files). Read this whole file every session; read the rest on demand per the rules below.

## Start here (read before acting)

1. **Before any non-trivial work**, open **`er-seo-tools-workflow`** — the engineering loop (brainstorm→spec→plan→TDD→verify) and the full skills index telling you which `er-seo-tools-*` skill governs your situation. (Claude gets this loop from the superpowers plugin; Codex gets it from that skill. Same discipline either way.)
2. **Before landing ANY change**, open **`er-seo-tools-change-control`** — the non-skippable gate policy and merge/deploy authority.
3. **If another agent may be on the repo** (Claude + Codex in tandem), run the pre-flight in **`er-seo-tools-multi-agent-coordination`** FIRST — `git worktree list` is the branch-independent source of truth for who's in which lane. Never edit files another live lane is changing.
4. **Before touching `lib/jobs`, `lib/findings`, `prisma/schema.prisma`, auth, or recovery**, read the relevant `CLAUDE.md` section (or open `er-seo-tools-architecture-contract`). These subsystems have non-obvious invariants that green tests will not catch.

Do not reconstruct a skill's content from memory — the skills carry incident-specific detail. Open the file.

## Hard invariants (violations are review findings)

- **Array-form `$transaction([...])` ONLY** — interactive `prisma.$transaction(async tx => ...)` is banned. It holds SQLite's write lock across event-loop round-trips and caused a production incident (2026-06-10, "Operations timed out"). Express conditional logic in SQL (`EXISTS` predicates). Raw SQL must set `updatedAt` manually (`Date.now()`, integer ms).
- **SQLite only** — no Postgres/MySQL. No serverless assumptions anywhere. Core stack (SQLite, RunCloud+PM2, Node 22, Chrome at `/usr/bin/google-chrome`) is frozen — do not change a leg without explicit instruction.
- **No AI/LLM API calls in the app** (decided 2026-07-08) — all AI stays in the external skill-handoff clipboard flow (pat_/srt_/krt_/kst_/cat_/qct_ tokens).
- **Share/redirect URLs use `NEXT_PUBLIC_APP_URL`**, never request origin headers (reverse proxy makes `request.url` localhost in prod).
- **Never rely on `Class.name` or any identifier name at runtime** — SWC minifies them in prod builds. Use explicit static keys. Code `.toString()`-injected into audited pages must be SWC-helper-free (no `typeof`).
- `updatedAt` is the staleness heartbeat for transient site audits; `AdaAudit` has NO `updatedAt` (job state is its liveness source).
- New API routes wrap handlers in `withRoute` (`lib/api/with-route.ts`) and parse bodies with `parseJsonBody`. Auth lives in middleware, not in `withRoute`. Every new public/token-authed route needs a `middleware.ts` `isPublicPath` entry AND a `middleware.test.ts` case (this 401'd new routes in prod three times).
- Findings dual-write hooks are fire-and-forget AFTER the legacy commit — a findings failure must never fail the legacy path.
- A live-scan `CrawlRun` must NEVER displace the `sf-upload` canonical SEO score (`findings-shared.selectRuns`).
- `BROWSER_POOL_SIZE` stays ≤ 4 (each Chrome page ≈ 150–200 MB resident on a 3.8 GB box). Never hold a pooled page across awaits you don't control. Don't add memory pressure — runtime (PM2 `max_memory_restart`) and build heap (`NODE_OPTIONS=--max-old-space-size=3072` in `npm run build`) are two separate ceilings, each with its own past OOM incident.
- Durable-job group `site-audit:<id>` means audit liveness to recovery — never reuse it for unrelated jobs (reports use `report:<id>`; notify jobs use no group).
- **Never scan third-party sites** without permission — audits/live-scans make real HTTP requests against real sites. Scan only client sites or domains you control.

## Gates & landing (authority: `er-seo-tools-change-control`)

- **Gate-green** = `npm run lint` (`tsc --noEmit`) + `npm test` (`vitest run`) + `npm run build` all pass. Green is necessary, not sufficient — this repo's worst bugs were prod-only and passed every local test. Prod verification after deploy is part of the change.
- **Merge + deploy are autonomous when gate-green** (owner ruling 2026-07-03), re-running gates in the current session; report the outcome. **`git push` before deploying** — the server pulls from GitHub, so unpushed commits never ship. Deploy: `ssh $PROD_SSH "~/deploy.sh"` (migrations run automatically via `prisma migrate deploy` inside it).
- **Kevin-gated, current conversation only:** destructive/irreversible server ops — deleting prod data, `rm -rf`, editing the server `.env`/secrets, DB restore, force-push. A new required-in-prod env var bricks boot (`instrumentation.ts` fail-fast) — flag it as a Kevin pre-deploy step.
- **Docs ritual (never skipped):** advancing a tracker item requires, in the same commit, the tracker checkbox + dated status-log line + rewritten `HANDOFF-*.md`; specs/plans route through Codex review before implementation. Details: `er-seo-tools-docs-and-writing`.

## Orientation

- Durable job queue: `lib/jobs/` (conditional-update claim, attempt-fenced settle, `onExhausted` hooks).
- Site-audit phase model: `queued → running → (pdfs-running | lighthouse-running) → complete`; `finalizeSiteAudit` is the single decision point.
- Normalized findings layer: `lib/findings/` (blob → `CrawlRun`/`CrawlPage`/`Finding`/`Violation`; 90-day blob pruning with read-time fallbacks).
- ADA audits: axe-core in headless Chrome via `lib/ada-audit/` (browser pool, SSRF-guarded runner).
- Full route map, env vars, deploy protocol, key-file map: `CLAUDE.md`.
