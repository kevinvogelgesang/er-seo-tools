# Onboarding & Ownership Guide — Design

**Date:** 2026-07-07
**Status:** Spec
**Deliverable:** A multi-document learning guide in `docs/onboarding/` that takes a junior developer from zero (first dev job, no JS/TS/Node) to full ownership of er-seo-tools, plus a standalone brief for an outside senior developer who may supervise or advise.

## Purpose

Two audiences, one doc set:

1. **The junior developer** — first dev job; WordPress/site-work background; strong SEO domain knowledge; comfortable with HTML/CSS basics; effectively zero JavaScript, TypeScript, Node, React, or database experience. They will learn the stack *and* this codebase, and eventually own everything: features, schema migrations, deploys, production operations.
2. **An outside senior developer** — experienced generalist (TS/Next.js or equivalent), zero context on this repo. Brought in occasionally to advise the junior or review work. Needs the high-level decisions, their real rationale (including the incidents behind the rules), and a map of where authority lives.

## Decisions from brainstorming (constraints on the design)

- **Structure:** Option A — a capability-staged learning *path* plus standalone *reference* docs that cross-link. The path serves the junior; the references serve both audiences.
- **No time commitments anywhere.** Pacing is by capability gates ("you're ready to move on when you can…"), never days/weeks. The junior ramps up whenever time allows; the guide must survive long gaps (each stage re-orients the reader).
- **Fundamentals:** curated external resources (MDN, TS handbook, Next.js Learn, etc.) in a deliberate order — the guide does not reteach JavaScript — but every concept is anchored back into real files in this repo ("now find this pattern in `lib/db.ts`").
- **AI-assisted development is first-class.** The repo is built with Claude Code (skills, specs/plans taxonomy, Codex review, handoff protocol). The guide teaches that workflow from day one, including when *not* to trust output.
- **Senior brief is warts-and-all.** Real trade-offs, the production incidents that created house rules, known debt, fragile areas.
- **Nothing excluded.** Repo is private; server details, incident history, and client examples may all appear. (Exercises still only scan sites we are authorized to scan — that is an authorization rule, not a privacy one.)
- **Setup is Mac-first** with a short Windows/WSL2 note (junior's machine unknown).
- **Location:** `docs/onboarding/` with a README index, PR'd to main.

## Doc set

Ten files: a README index plus nine numbered docs. Numbered files are the junior's path order; the README explains the two reading modes (path vs. reference).

### `docs/onboarding/README.md` — index
Table of the doc set with one-line purposes. Two entry points called out explicitly: "Junior: start at 00 and go in order" / "Senior: read 07, skim 03–04." A short note on maintenance: these docs are versioned with the code; whoever changes an architecture described here updates the doc in the same PR.

### `00-orientation.md` — what this thing is
- What er-seo-tools is for (internal SEO toolkit for Enrollment Resources), who uses it, and the tool inventory (the `/seo-parser`, `/ada-audit`, `/clients`, `/reports`, etc. table) described in SEO-practitioner language first, developer language second — this is where the junior's existing expertise is the bridge.
- A vocabulary table mapping SEO domain terms the junior already knows to the app's terms (crawl → `CrawlRun`, audit finding → `Finding`, Screaming Frog export → parser session, etc.).
- How work happens on this repo: git + PRs, specs and plans in `docs/superpowers/`, Claude Code as the daily tool, Kevin as reviewer/deployer initially.
- How to use this guide: path vs. reference, capability gates, "it's fine to be here a long time."

### `01-fundamentals-path.md` — the outside-in curriculum
Ordered external curriculum with repo anchors and capability checks per unit:
1. Command line + git basics (they'll need both before anything runs).
2. JavaScript via MDN's curriculum (variables → functions → objects/arrays → async/promises). Anchor: read a small real file after each unit (e.g. a simple util in `lib/`).
3. TypeScript handbook (types as labels on the JS they just learned). Anchor: read `lib/ada-audit/types.ts` and connect interfaces to JSON they've seen in SEO tools.
4. Node.js basics (what a server process is, npm, `package.json` scripts). Anchor: `package.json` scripts table.
5. React fundamentals (components, props, state, effects). Anchor: a small real component, e.g. `components/ThemeToggle.tsx`.
6. Next.js App Router via Next.js Learn (pages, layouts, route handlers, server vs. client components). Anchor: one app route traced end to end.
7. SQL + Prisma basics (tables, relations, migrations). Anchor: read `prisma/schema.prisma` top to bottom with the data-model section of the tour open.
Each unit ends with a concrete capability check ("you can explain X / you found Y in the repo"). Explicit permission to interleave with Stage 0–1 of the milestones.

### `02-local-setup.md` — run it on your machine
Mac-first walkthrough: prerequisites (Node 22, git, Chrome), clone, `npm install`, Prisma setup, env file, dev server, test suite, and the ADA-audit Chrome requirement (`CHROME_EXECUTABLE` on macOS). A troubleshooting table seeded from the known failure modes (SQLite "Error code 14", unexpected login wall in dev, migrate targeting the wrong DB file, build memory). Short Windows/WSL2 section. Capability gate: dev server runs, one ADA audit of a test page completes locally, test suite runs.

### `03-codebase-tour.md` — the map (reference)
The static structure, written to be skimmable by the senior and readable slowly by the junior:
- Repo layout (`app/`, `components/`, `lib/`, `prisma/`, `scripts/`, `test/`, `docs/`).
- How a request flows: browser → middleware (auth) → App Router route → `withRoute` envelope → Prisma → response; where polling fits.
- `lib/` layer-by-layer inventory (db, api kit, log, jobs, ada-audit, findings, report, services, parsers, analytics) — one paragraph each, pointing at the CLAUDE.md key-files list as the always-current index rather than duplicating it.
- Data model overview: the origin models (Session, AdaAudit, SiteAudit) vs. the normalized findings subtree (CrawlRun → CrawlPage/Finding/Violation), blob-vs-tables, why both exist (forward-reference to the senior brief for full rationale).
- UI conventions: Tailwind + class-based dark mode, the `dark:` variant mapping table, ThemeProvider, Recharts lazy-loading.

### `04-how-it-runs.md` — the machinery (reference)
The dynamic behavior, subsystem by subsystem:
- The durable job queue: Job/Schedule tables, claim/fencing model in plain language, per-type concurrency, what "the worker" is.
- Site-audit lifecycle: `queued → running → pdfs-running/lighthouse-running → complete`, discovery, fan-out, finalizer, the C6 live-scan builder.
- Recovery: heartbeats, stale resets, what happens on deploy/restart.
- Scheduled scans, retention/pruning (what gets deleted when, and the read-time fallbacks).
- Production topology: RunCloud VPS, PM2, nginx, where the DB/uploads/logs/reports live, what `deploy.sh` does.
Written as "what happens when…" narratives (what happens when you click Start Audit; what happens when the server restarts mid-audit) rather than component lists.

### `05-milestones.md` — the staged path
Five stages mapping to the ownership progression. Each stage: goal, prerequisites (which fundamentals units), guided exercises (optional but recommended), and a capability gate. No dates.
- **Stage 0 — Run it:** local setup complete; click through every tool with the orientation doc open; run one of each audit type against an authorized site.
- **Stage 1 — Read it:** trace three flows read-only (an ADA single-page audit end to end; a Screaming Frog CSV upload through parsing to the results page; a site-audit through the queue) and write up each trace; Kevin checks the write-ups. Exercises include "find where X happens" scavenger hunts.
- **Stage 2 — Change the surface:** UI-scoped changes. Exercises: a dark-mode fix, a copy change, a new column in a results table, a small component following an existing pattern. First real PRs; Kevin reviews and deploys.
- **Stage 3 — Ship features and fixes:** full feature work with tests, following the house workflow (brainstorm/spec for non-trivial work, Codex review, `tsc`/vitest/build gates). Exercises: a real bugfix from the backlog, a small feature touching an API route + component, first schema migration under supervision. Kevin still deploys.
- **Stage 4 — Operate it:** prod access. Deploys via `deploy.sh`, reading PM2 logs, `/admin/ops`, unsticking queues, retention/rebuild scripts, backup awareness, incident habits (look before restarting). Gate: performs a supervised deploy + a supervised diagnosis of a stuck audit, then an unsupervised one of each.
Each stage ends with "you own this stage when…" criteria Kevin can verify.

### `06-working-with-ai.md` — the house AI workflow
- Claude Code as the daily driver: what CLAUDE.md is (the living contract), the project skills and when they trigger, the specs → plans → implementation lifecycle, the Codex review loop, the tracker/handoff protocol.
- The trust model, stated bluntly for a junior: AI output is a draft, the gates (`tsc --noEmit`, vitest, build, review) are the authority; "the model said so" is never a justification; verify against the running app; when CLAUDE.md and the code disagree, the code is the truth and the doc gets fixed.
- Practical patterns: asking for explanations of unfamiliar code (their main learning accelerator), keeping changes small enough to review themselves, never letting the tool touch prod on their behalf before Stage 4.

### `07-senior-brief.md` — decisions and rationale (reference, warts and all)
Standalone: readable with zero repo context, in an hour. Sections:
- **Context:** internal tool, one primary developer + AI assistance, small VPS, handful of internal users. Every decision below is downstream of that context — most would be wrong at a different scale, and the doc says so.
- **The big decisions, each as *decision / why / consequences / what would make us revisit*:**
  1. SQLite + Prisma (no Postgres): ops simplicity on one box; the single-writer lock is the tax — including the 2026-06-10 "Operations timed out" incident where an interactive transaction held the write lock across event-loop starvation, which produced the house rule *array-form `$transaction` only*.
  2. RunCloud VPS + PM2, no serverless: audits need headless Chrome, minutes-long jobs, and persistent disk (SQLite, uploads, PDFs) — serverless was never viable, not merely unchosen.
  3. Hand-built DB-backed durable job queue (no Redis/BullMQ): single-node reality; SQLite as the coordination layer; conditional-update claims + attempt fencing; the trade-off is single-process, no horizontal scale, and discipline around the event loop.
  4. Polling everywhere, no websockets: 1–8s polls are fine at internal scale and survive PM2/nginx restarts trivially.
  5. Findings dual-write (legacy blobs + normalized tables) and 90-day blob pruning with read-time fallbacks: the honest history (blobs came first; normalization was retrofitted in A2), why we never backfill, and why reads must tolerate both shapes.
  6. Cookie-gated middleware auth (no per-route auth, no user accounts) + public share tokens: right-sized for a small internal team.
  7. Browser pool with recycling and hard size caps: Chrome memory vs. a small VPS; why `BROWSER_POOL_SIZE` has a "do not raise" warning.
  8. PSI over local Lighthouse: offload CPU; accepted score variance.
  9. AI-heavy development process: what `docs/superpowers/` is, why specs/plans exist for most features, how to use them as an archaeology layer, and what that implies for code review (volume is high; the gates and review discipline are the control, not line-by-line authorship memory).
- **Known debt and sharp edges:** `AdaAudit` has no `updatedAt` (job state is the liveness source); the prod-minification bug class (SWC-injected helpers breaking string-injected in-page code; minified class names breaking key lookups); the legacy `SessionPage` fallback pending removal; single-process constraint; memory ceilings; anything else surfaced during writing.
- **Supervising the junior:** review focus checklist (transactions are array-form; new routes use `withRoute`/`parseJsonBody`; fenced writes in job code; `dark:` variants on new UI; tests exist and run against the right DB), the danger zones where they should require your review longest (lib/jobs, lib/findings, schema, recovery, auth), and where the authoritative docs live (CLAUDE.md, this folder, `docs/superpowers/archive/specs/`).

### `08-operations-runbook.md` — running production (reference)
The Stage 4 companion, also useful to the senior: deploy procedure (push first, then `~/deploy.sh`), server layout (app path, DB, uploads, logs), PM2 basics, reading the structured logs, `/admin/ops` and `/api/health`, common diagnoses (stuck queued/running audits, 502s, restart loops, OOM), what retention deletes and when, backup story, and the "check evidence before restarting" discipline. Points at the debugging/diagnostics knowledge already encoded in project skills rather than duplicating every recipe.

## Design principles (apply to every doc)

- **Capability gates, never time.** No "week 1", no hour estimates.
- **Anchor everything.** Every abstract concept gets a `path/to/file.ts:symbol` pointer into the real repo.
- **SEO knowledge is the bridge.** Explain new technical concepts via the SEO concepts the junior already has whenever possible.
- **Resumable.** Each doc/stage opens with 2–3 sentences of re-orientation so returning after a gap works.
- **Don't duplicate living sources.** Where CLAUDE.md or a project skill is the authoritative current list (key files, env vars, debugging recipes), the guide points at it and explains how to read it, instead of copying content that will rot.
- **Exercises are optional and safe.** Scans/audits in exercises only target sites we're authorized to scan (own properties or designated client sites per Kevin).
- **Honest register.** Especially in 07: real incidents with dates, real debt, real "we'd revisit this if…" triggers.

## Out of scope

- No changes to app code, CLAUDE.md, or existing docs (except adding the `docs/onboarding/` folder and its README linkage if we choose to reference it from the repo README).
- No LMS/quiz tooling, no rendered site — markdown in the repo only.
- No hiring/HR content (expectations, performance) — capability gates only.
- Fundamentals content itself (the guide curates and anchors; it does not teach JavaScript).

## Testing / acceptance

- **Junior-path dry run:** every capability gate is checkable by Kevin with a concrete action ("show me X", "explain Y", "PR Z merged").
- **Senior dry run:** 07 + skim of 03/04 must let a repo-naive senior answer: what is this, why is it shaped this way, what must I never let the junior merge unreviewed.
- **Anchor validation:** every file/symbol reference in the docs is verified to exist at time of writing (scripted grep pass before commit).
- **No-time-commitment lint:** final pass confirms no durations anywhere in the junior path.
