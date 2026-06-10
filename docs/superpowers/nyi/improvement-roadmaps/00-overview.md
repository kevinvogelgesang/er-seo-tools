# ER SEO Tools — Improvement Roadmap Overview

**Date:** 2026-06-10
**Status:** Strategy docs (NYI). Big-picture, multi-week recommendations per section.
**Scope:** ~60k lines of TypeScript, 13 Prisma models, 45 API routes, 8 tool sections, single VPS (RunCloud + PM2 + SQLite).

This folder contains one roadmap per section of the webapp. This overview is the
thesis and the sequencing; the numbered docs hold the detail.

| Doc | Section |
|---|---|
| `01-seo-parser.md` | SEO Parser (Screaming Frog CSV pipeline) |
| `02-ada-audit.md` | ADA Audit (single-page + site-wide + PDFs + PSI) |
| `03-ai-memo-tools.md` | Pillar Analysis, Keyword Research, handoff-token system |
| `04-clients-and-quarter-grid.md` | Clients + Quarter Grid |
| `05-small-tools.md` | Robots Validator + RankMath Redirects |
| `06-platform.md` | Cross-cutting: data model, job queue, auth, observability, testing |

---

## The honest diagnosis

The app is healthy at the code level — strong typing, 146 test files, real SSRF
protection, careful race handling in the audit queue. The problems are
**architectural**, and they're all the same three problems wearing different
hats:

1. **It's a box of tools, not a platform.** Every tool is an island: its own
   upload flow, its own poller, its own history list, its own share/token
   system. The unit the business cares about — *the client* — is a foreign key
   nobody aggregates. There are ~30 clients and seven tools, and no screen that
   answers "how is Client X doing?"

2. **Everything is a one-shot manual run.** Audits, parses, validations — all
   triggered by a human, all snapshots, none scheduled, none compared over
   time. The data for trending exists (timestamped audits of the same domains)
   but is unreachable because of problem 3.

3. **Results are opaque JSON blobs.** `Session.result`, `AdaAudit.result`,
   `SiteAudit.summary`, `PillarAnalysis.*` — the entire value of every run is a
   serialized string. No querying, no indexing, no cross-run diffs, no
   client-level rollups, unbounded DB growth (a large site audit stores
   50–250 MB of JSON). This single decision blocks nearly every feature the
   business would want next.

There's a fourth, quieter problem: **all background work is in-process and
volatile.** The PSI queue is an in-memory array; the site-audit queue is a
boolean mutex; recovery is a 5-minute stale-detector. Every deploy kills
in-flight work. This is tolerable today and fatal to any "scheduled nightly
monitoring" future.

## The target architecture

**A client-centric, continuously-monitoring SEO platform** rather than a
drawer of one-shot utilities:

- **One findings data model.** A normalized `CrawlRun` / `CrawlPage` /
  `Finding` layer
  that SEO parses, ADA audits, PDF scans, and (later) live crawls all write
  into, keyed by client + run. JSON blobs remain only as raw-archive columns.
- **One durable job system.** A SQLite-backed job table (status, payload,
  attempts, heartbeat) with a single worker loop, replacing the in-memory PSI
  queue, the site-audit mutex, and fire-and-forget PDF dispatch. Survives
  deploys; enables cron-style scheduled runs.
- **One client command center.** `/clients/[id]` becomes the home page of the
  app: latest scores across all tools, trends, open findings, scheduled scans,
  memos, quarter-grid status.
- **Scheduled recurring scans** (nightly/weekly per client) feeding trend lines
  and regression alerts — this is also the delivery vehicle for the already-
  planned Live SEO / Screaming-Frog-demotion work
  (`nyi/2026-06-04-screaming-frog-retirement-roadmap.md`).

This is not a rewrite. Next.js + SQLite + single VPS stays. It's a re-plumbing:
the tools keep their UIs and runners; what changes is where results land, how
work is queued, and what the top-level navigation is organized around.

## Sequencing — critical path ≈ 12–16 weeks; full scope ≈ 25–35 engineer-weeks

Honest accounting (per Codex review): the four tracks below are the
**critical-path spine** at 12–16 weeks. Everything described across all seven
docs sums to roughly 25–35 engineer-weeks — the difference is the optional
phases each doc marks as droppable. Treat the spine as the commitment and the
rest as a backlog to pull from.

Dependencies run downward; tracks B–D can interleave once A lands.

**Track A — Platform foundations (4–5.5 wks)** → `06-platform.md`
1. Durable job queue + worker loop; migrate PSI queue, site-audit queue, PDF
   dispatch onto it.
2. Normalized findings/pages schema + dual-write from existing runners.
3. Shared API-route kit (auth guard, error envelope, validation) + structured
   logging + `/api/health`.

**Track B — Client command center (2–3 wks for the MVP)** → `04-clients-and-quarter-grid.md`
4. Client dashboard **MVP from existing scalar data** (scores, counts,
   timestamps already on Session/SiteAudit/AdaAudit rows) — does *not* wait
   for the findings layer. Enriched findings/action views land later, once
   Track A item 2 ships.
5. Quarter Grid state moves localStorage → DB; monolith split; grid surfaces
   on the client dashboard.

**Track C — Continuous monitoring (4–6 wks)** → `02-ada-audit.md`, `01-seo-parser.md`
6. Scheduled scans (cron table on the job queue) + run-over-run diffing +
   regression alerts.
7. Live SEO phases from the existing SF-retirement roadmap (broken-link
   verifier first), writing into the findings model from day one.
8. Reporting layer: branded PDF export, site-audit share links, trend charts.

**Track D — Workflow polish (2–3 wks)** → `03-ai-memo-tools.md`, `05-small-tools.md`
9. Unify the three token systems + the three pollers into one shared
   status/poller abstraction; SSE is an optional notification layer added
   afterwards (DB state stays the source of truth).
10. Robots validator → scheduled robots/sitemap monitoring on the job queue.
11. RankMath guide → actual redirect generator with dry-run validation.

## What I deliberately did NOT recommend

- **Postgres / Redis / external queue services.** SQLite + WAL on one VPS
  handles this fleet (~32 domains, ~5k pages); a DB-backed job table gives 90%
  of a real queue's value with zero new infrastructure. CLAUDE.md's stack
  constraints stand.
- **Microservices or serverless.** The browser pool and job worker want to be
  one long-lived process.
- **A full in-house crawler immediately.** The SF-retirement doc already made
  the right call: demote, don't replace; build discovery (its Phase 2) only if
  measurement proves sitemaps are routinely missing pages.
- **Direct Anthropic API for memos** as a hard commitment — named as the end
  state in `03-ai-memo-tools.md` but explicitly gated on the billing decision
  CLAUDE.md flags.
