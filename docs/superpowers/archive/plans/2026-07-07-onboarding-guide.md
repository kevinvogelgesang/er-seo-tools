# Onboarding & Ownership Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the ten-file onboarding doc set under `docs/onboarding/` specified in `docs/superpowers/specs/2026-07-07-onboarding-guide-design.md`, plus a small anchor-check script, and land it on main via PR.

**Architecture:** Pure documentation — no app code changes. One task per document. Every task reads the spec section for its file plus the listed repo sources, writes the doc, runs the shared checker script, and commits. A final task does the cross-link/validation pass and opens the PR.

**Tech Stack:** Markdown, bash (checker script only).

## Global Constraints

Copied from the spec — every task must obey all of these:

- **No time commitments in the junior path** (files `00`–`02`, `05`, `06`, and `README`): no "week 1", no hour/day estimates, no pacing durations. Durations describing *the app's behavior* (e.g. "polls every 5s", "90-day retention") are fine anywhere.
- **Capability gates, never time:** every stage/unit ends with "you're ready when…" criteria Kevin can verify with a concrete action.
- **Anchor everything:** abstract concepts get a real repo pointer in backticks (`lib/db.ts`, `middleware.ts`, …). Every backtick path must exist — the checker script (Task 1) enforces this.
- **SEO knowledge is the bridge:** explain new technical concepts via SEO concepts the junior already knows, wherever possible.
- **Resumable:** every doc opens with 2–3 sentences of re-orientation ("You are here… you should already be able to… this doc gives you…").
- **Don't duplicate living sources:** where CLAUDE.md or a `.claude/skills/er-seo-tools-*` skill is the authoritative current list (key files, env vars, debugging recipes), point at it and explain how to read it. Never copy content that will rot.
- **Exercise safety rails, stated verbatim in every exercise section:** exercises run against the local dev environment first; scans/audits only target the designated test-domain list (placeholder: *"ask Kevin for the test-domain list"* until he supplies it); **no client scans without Kevin's explicit go-ahead**; **no production queue operations of any kind before Stage 4**.
- **Honest register in `07-senior-brief.md`:** real incidents with dates, real debt, real "revisit if…" triggers. No marketing voice.
- **Audience register:** junior-path docs assume zero programming knowledge at the point in the path where they're read; reference docs (`03`, `04`, `08`) carry reading-depth labels (**First pass** / **Deep dive later** / **Senior: read now**) on every section.
- **Writer's source of truth:** the spec (`docs/superpowers/specs/2026-07-07-onboarding-guide-design.md`) section for your file wins over this plan if they ever disagree. Read it first, every task.
- Commit messages end with the standard Claude co-author trailer used in this repo.

## Open inputs from Kevin (do not block on these)

Write around them with an explicit callout box `> **Kevin fills in:** …` at the point of use:
1. The designated test-domain list for exercises.
2. The junior's machine (docs ship Mac-first + short WSL2 note regardless).
3. Prod auth posture for `07` (break-glass password enabled in prod, or Google-only) — writer should describe what the code supports (`lib/auth.ts`, `middleware.ts`) and flag the deployment posture as Kevin-confirms.

---

### Task 1: Scaffold, checker script, and README index

**Files:**
- Create: `docs/onboarding/README.md`
- Create: `scripts/check-onboarding-docs.sh`

**Interfaces:**
- Produces: `bash scripts/check-onboarding-docs.sh` — exits 0 when all backtick repo-path anchors in `docs/onboarding/*.md` exist; exits 1 listing `MISSING: <doc> -> <path>` otherwise; always prints (non-fatal) `DURATION?` lines for time-words in junior-path docs for manual review. Every later task runs this.
- Produces: the canonical doc-set table (filenames + one-liners) that all other docs' cross-links must match.

- [ ] **Step 0: Create the working branch** (Codex plan-review fix 5)

```bash
git checkout -b feat/onboarding-guide
```

- [ ] **Step 1: Create the checker script**

```bash
mkdir -p docs/onboarding
cat > scripts/check-onboarding-docs.sh <<'SCRIPT_EOF'
#!/usr/bin/env bash
# Validates docs/onboarding/: (1) every backtick repo path exists,
# (2) flags duration language in junior-path docs for manual review.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
tmp="$(mktemp)"

grep -RnoE --include='*.md' \
  '`(app|components|lib|prisma|scripts|test|docs|\.claude)/[^` ]+`|`(middleware\.ts|instrumentation\.ts|package\.json|ecosystem\.config\.js|CLAUDE\.md|tailwind\.config\.ts|README\.md|SECURITY\.md|\.env\.example|vitest\.config\.mts|next\.config\.ts|tsconfig\.json|audit-ci\.jsonc)`' \
  docs/onboarding > "$tmp" || true

while IFS= read -r line; do
  # grep -Rno output is file:line:match — the match itself may contain colons
  # (e.g. `lib/foo.ts:symbol`), so peel exactly two fields off the front.
  file="${line%%:*}"
  rest="${line#*:}"
  match="${rest#*:}"
  path="${match//\`/}"
  path="${path%%:*}"   # strip :line / :symbol suffix
  if [ ! -e "$path" ]; then
    echo "MISSING: $file -> $path"
    fail=1
  fi
done < "$tmp"
rm -f "$tmp"

# Junior-path docs must not contain pacing durations (manual-review list, not a hard fail).
for f in docs/onboarding/README.md docs/onboarding/0[0-2]-*.md docs/onboarding/05-*.md docs/onboarding/06-*.md; do
  [ -e "$f" ] || continue
  grep -niE '\b(minute|hour|day|week|month)s?\b' "$f" | sed "s|^|DURATION? $f:|" || true
done

if [ "$fail" -eq 1 ]; then
  echo "FAIL: missing anchors above"
  exit 1
fi
echo "OK: all anchors exist (review any DURATION? lines above)"
SCRIPT_EOF
chmod +x scripts/check-onboarding-docs.sh
```

- [ ] **Step 2: Run it against the empty folder**

Run: `bash scripts/check-onboarding-docs.sh`
Expected: `OK: all anchors exist` (no docs yet, nothing to fail).

- [ ] **Step 3: Write `docs/onboarding/README.md`**

Content requirements (see spec "README" section):
- Title + 2–3 sentence purpose: this folder takes a new developer from zero to owning er-seo-tools; also contains a standalone brief for an experienced outside reviewer.
- **Two entry points, prominent:** "Junior developer: start at `00-orientation.md` and go in order." / "Senior developer advising or reviewing: read `07-senior-brief.md`, then skim `03-codebase-tour.md` and `04-how-it-runs.md` (follow the *Senior: read now* labels)."
- The doc-set table — exactly these files and one-line purposes. **In the README, write the file column as full repo paths in backticks (`docs/onboarding/00-orientation.md`, …) so the checker validates them** (Codex plan-review fix 2); shown short here for readability:

| File | What it is |
|---|---|
| `00-orientation.md` | What this app is, in SEO language first — tools, vocabulary, how work happens here |
| `01-fundamentals-path.md` | The ordered external curriculum (JS → TS → Node → HTTP → React → Next.js → SQL) with repo anchors |
| `02-local-setup.md` | Get it running on your machine, plus secrets/env safety rules |
| `03-codebase-tour.md` | Reference map of the repo: layout, request flow, layers, data model, UI conventions |
| `04-how-it-runs.md` | Reference for the machinery: job queue, audit lifecycle, recovery, retention, prod topology |
| `05-milestones.md` | The staged path to ownership — Stage 0 (run it) through Stage 4 (operate prod), with capability gates |
| `06-working-with-ai.md` | The house AI-assisted workflow: Claude Code, skills, specs/plans, Codex review, the trust model |
| `07-senior-brief.md` | For the outside senior: the big decisions, their real rationale, known debt, how to supervise |
| `08-operations-runbook.md` | Running production: deploy, logs, health, common diagnoses, retention, backups |

- "How to use this guide": path vs. reference reading modes; capability gates instead of deadlines; "it's fine to be at a stage a long time; the guide is built to be resumed after gaps."
- **Maintenance note:** these docs are versioned with the code — if a PR changes architecture described here, the same PR updates the doc. `bash scripts/check-onboarding-docs.sh` must pass before committing doc changes.

- [ ] **Step 4: Run the checker**

Run: `bash scripts/check-onboarding-docs.sh`
Expected for this task only: `MISSING:` lines for exactly the nine not-yet-written `docs/onboarding/0*.md` files referenced (as full paths) in the README table — they're forward references and prove the checker sees them. Any OTHER missing path is a typo; fix it. Task 11 re-runs the checker expecting a fully clean pass.

- [ ] **Step 5: Commit**

```bash
git add docs/onboarding/README.md scripts/check-onboarding-docs.sh
git commit -m "docs(onboarding): scaffold doc set — README index + anchor checker"
```

---

### Task 2: `00-orientation.md`

**Files:**
- Create: `docs/onboarding/00-orientation.md`
- Read first: spec section "00-orientation.md"; `CLAUDE.md` (top section + "Tools in the app" table); `.claude/skills/er-seo-tools-domain-reference/SKILL.md`

**Interfaces:**
- Consumes: README's doc table (cross-link names must match).
- Produces: the vocabulary table (SEO term → app term) that `01`/`03` reference by saying "see the vocabulary table in 00".

- [ ] **Step 1: Write the doc** with these sections:

1. **Re-orientation opener** (2–3 sentences): who this guide is for, what this doc gives (the lay of the land before any code).
2. **What er-seo-tools is** — internal SEO toolkit for Enrollment Resources; built and run by Kevin; you (the junior) will grow into owning it. Written in SEO-practitioner language FIRST: "it does the things you already do manually — crawls, ADA audits, Screaming Frog analysis, client reporting — as a web app."
3. **The tools** — walk the `/seo-parser`, `/ada-audit`, `/robots-validator`, `/quarter-grid`, `/rankmath-redirects`, `/clients`, `/reports`, `/settings` routes (source: CLAUDE.md "Tools in the app" table). For each: one paragraph, SEO framing first ("this replaces the spreadsheet you'd build from a Screaming Frog export"), then one sentence of dev framing ("a Next.js page that reads uploaded CSVs and stores results in a database").
4. **Vocabulary table** — at minimum these rows (SEO term you know → term in this app → where you'll meet it): crawl → `CrawlRun`; a page in a crawl → `CrawlPage`; an issue/finding → `Finding`; an accessibility violation → `Violation`; a Screaming Frog export → a parser *Session*; a full-site accessibility scan → `SiteAudit`; a single-page scan → `AdaAudit`; PageSpeed/Core Web Vitals check → *PSI / Lighthouse job*; scheduled recurring scan → `Schedule`.
5. **How work happens on this repo** — git + GitHub PRs; Kevin reviews and deploys (at first); design docs live in `docs/superpowers/` (specs → plans → archive when shipped); Claude Code is the daily development tool (pointer to `06-working-with-ai.md`); the repo's `CLAUDE.md` is the living contract — "you will read it many times; it is the single most information-dense file in the repo."
6. **How to use this guide** — path vs. reference; capability gates; explicit "no deadlines exist in this guide by design"; pointer to `05-milestones.md` as the spine.

- [ ] **Step 2: Run the checker**

Run: `bash scripts/check-onboarding-docs.sh`
Expected: no `MISSING:` lines for `00-orientation.md`; review `DURATION?` lines — none may be pacing language.

- [ ] **Step 3: Self-check against spec** — the spec's 00 section names: tool inventory in practitioner language, vocabulary table, how work happens, how to use the guide. All four present?

- [ ] **Step 4: Commit**

```bash
git add docs/onboarding/00-orientation.md
git commit -m "docs(onboarding): 00-orientation — tools, vocabulary, how work happens"
```

---

### Task 3: `01-fundamentals-path.md`

**Files:**
- Create: `docs/onboarding/01-fundamentals-path.md`
- Read first: spec section "01-fundamentals-path.md" (the nine-unit list is normative, including Codex fixes 1–2); `package.json` (scripts table); `lib/ada-audit/types.ts`; `components/ThemeToggle.tsx`; `middleware.ts`; `lib/api/with-route.ts`; `prisma/schema.prisma` (skim for anchor accuracy)

**Interfaces:**
- Consumes: vocabulary table in `00-orientation.md`.
- Produces: unit numbering (Units 1–9) that `05-milestones.md` cites as stage prerequisites ("Stage 2 requires Units 1–7").

- [ ] **Step 1: Write the doc.** Structure: re-orientation opener, then a short "how to study" preamble (do units in order; each ends with a capability check; it's expected and fine to interleave units with Stages 0–1 of `05-milestones.md`), then the nine units. **Each unit gets:** (a) what it is and why you need it *for this repo specifically*, (b) the curated external resource(s) — pick the canonical free ones (MDN Learn JS / MDN HTTP, the official TypeScript Handbook, Node.js official getting-started, official React docs (react.dev), Next.js Learn course, SQLite + Prisma official docs, GitHub's PR docs), with real URLs, (c) the **repo anchor exercise** ("now open X and find Y"), (d) the **capability check** ("you're done when you can …" — checkable by Kevin in conversation or by an artifact).

The nine units (order is normative, from the spec):
1. **Command line + git basics** — terminal navigation, running `npm` scripts, clone/status/add/commit/log. Anchor: run `git log --oneline -20` on this repo and read the commit style.
2. **Practical git/PR workflow** — branches, staging hunks, reading `git diff`, commit hygiene, writing a PR description, responding to review comments, resolving a trivial conflict, and a "before you ask for review" self-checklist (diff read end-to-end? `npm run lint` clean? tests run?). Anchors: this repo's recent merged PRs on GitHub; branch naming visible in `git log`.
3. **JavaScript (MDN)** — variables → functions → objects/arrays → async/promises. Anchor after async unit: `lib/findings/normalize-url.ts` (or any small pure util — writer verifies the file exists and is genuinely small; substitute a better example if found).
4. **TypeScript (Handbook)** — types as labels on the JS just learned. Anchor: `lib/ada-audit/types.ts` — connect the interfaces to JSON they've seen in SEO tools.
5. **Node.js basics** — what a server process is, npm, `package.json` scripts. Anchor: the `package.json` scripts table; explain what `npm run dev`, `npm run lint` (note: it's `tsc --noEmit`, not eslint), `npm test`, `npm run build` each do.
6. **HTTP, APIs, JSON, and browser DevTools** — request/response, status codes, JSON, cookies, forms, the Network tab. Anchors: `middleware.ts` (the cookie gate — why every request passes through it), `lib/api/with-route.ts` (the uniform error envelope), one simple route under `app/api/` traced with the Network tab open (writer picks a real simple one, e.g. the health endpoint).
7. **React fundamentals** — components, props, state, effects. Anchor: `components/ThemeToggle.tsx` (small, real, and demonstrates the `mounted` hydration guard — explain in one sentence why that guard exists).
8. **Next.js App Router (Next.js Learn)** — pages, layouts, route handlers, server vs. client components. Anchor: trace one tool's page from `app/` folder to rendered screen.
9. **SQL + Prisma basics** — tables, relations, migrations. Anchor: read `prisma/schema.prisma` top to bottom with `03-codebase-tour.md`'s data-model section open.

- [ ] **Step 2: Verify anchors + checker**

Run: `bash scripts/check-onboarding-docs.sh`
Expected: no `MISSING:` for this doc. Also manually verify each external URL is the canonical current one.

- [ ] **Step 3: Commit**

```bash
git add docs/onboarding/01-fundamentals-path.md
git commit -m "docs(onboarding): 01-fundamentals — nine-unit curriculum with repo anchors"
```

---

### Task 4: `02-local-setup.md`

**Files:**
- Create: `docs/onboarding/02-local-setup.md`
- Read first: spec section "02-local-setup.md"; `.claude/skills/er-seo-tools-build-and-env/SKILL.md` (the authoritative env/setup knowledge — this doc SUMMARIZES and POINTS, doesn't duplicate); `.env.example`; `package.json`; `CLAUDE.md` (stack constraints)

**Interfaces:**
- Produces: the working local environment that every Stage 0 exercise in `05-milestones.md` assumes.

- [ ] **Step 1: Write the doc** with these sections:

1. Re-orientation opener (prereq: Units 1–2 of `01`; outcome: the app running on your machine).
2. **Prerequisites** — Node 22, git, Google Chrome. Mac-first instructions.
3. **Setup walkthrough** — clone; `npm install`; copy `.env.example` → `.env` and what each var you must touch means (point at `.claude/skills/er-seo-tools-config-and-flags/SKILL.md` as the full env-var reference); Prisma client generation/migrations for a fresh DB; `npm run dev`; log in (how dev auth works — writer reads the build-and-env skill for the dev login story and states it accurately); run the test suite (`npm test`).
4. **ADA audits locally** — Chrome requirement, `CHROME_EXECUTABLE` on macOS, run one single-page audit against a **local or designated test target only** (safety rails verbatim, per Global Constraints).
5. **Troubleshooting table** — seeded from the build-and-env skill's known failure modes: SQLite "Error code 14: Unable to open the database file" (test DB path), unexpected login wall in dev, `prisma migrate` targeting the wrong SQLite file, `next build` memory (note the `NODE_OPTIONS=--max-old-space-size=3072` already in the build script), npm install hangs. Each row: symptom → cause → fix → "full detail: build-and-env skill".
6. **Secrets and env safety** (Codex fix 3, normative): never commit `.env` (it's gitignored — verify, don't fight it); recognize secret shapes (API keys, the auth cookie secret, Google service-account JSON) and never paste values into docs, chats, commits, or screenshots; local vs. prod env (prod env lives in PM2's `ecosystem.config.js` ON THE SERVER — the repo copy is the shape, not the live values); what `DATABASE_URL` points at in each environment; where `lib/auth.ts` gets its secrets.
7. **Windows/WSL2 note** — short: develop inside WSL2 (Ubuntu), everything above applies as-is inside the WSL shell; native Windows paths/PM2/SQLite file-URL conventions will fight you.
8. **Capability gate:** dev server runs; one local ADA audit completes; `npm test` runs; you can state the secrets rules unprompted.

- [ ] **Step 2: Run the checker + verify every command**

Run: `bash scripts/check-onboarding-docs.sh` — expect no `MISSING:` for this doc.
Also run each setup command listed in the doc (or confirm from the build-and-env skill verbatim) so no command in the doc is guessed.

- [ ] **Step 3: Commit**

```bash
git add docs/onboarding/02-local-setup.md
git commit -m "docs(onboarding): 02-local-setup — Mac-first walkthrough, troubleshooting, secrets safety"
```

---

### Task 5: `03-codebase-tour.md`

**Files:**
- Create: `docs/onboarding/03-codebase-tour.md`
- Read first: spec section "03-codebase-tour.md"; `CLAUDE.md` ("Key files" + "Architecture patterns" for cross-checking, "Dark mode" bullet); repo tree (`app/`, `components/`, `lib/`, `prisma/`, `scripts/`, `test/`); `prisma/schema.prisma`; `middleware.ts`; `lib/api/with-route.ts`

**Interfaces:**
- Consumes: vocabulary table (00), unit numbering (01).
- Produces: section names that `05` scavenger hunts and `07` cross-references cite ("Request flow", "Data model", "lib/ inventory").

- [ ] **Step 1: Write the doc.** Reference register; **every section opens with a reading-depth label** (**First pass** / **Deep dive later** / **Senior: read now**). Sections:

1. Re-orientation opener + how to read this doc (junior: only *First pass* paragraphs on the first visit).
2. **Repo layout** [First pass] — one line per top-level dir: `app/` (pages + API routes), `components/`, `lib/` (all real logic), `prisma/` (schema + migrations), `scripts/` (operational tools), `test/` + colocated `*.test.ts`, `docs/`.
3. **Request flow** [First pass] — browser → `middleware.ts` (cookie auth gate; public-path exceptions for share pages) → App Router route → `withRoute` error envelope (`lib/api/with-route.ts`) → Prisma (`lib/db.ts`) → JSON response; where 1s/5s/8s polling fits (pointer to 04 for why polling).
4. **`lib/` inventory** [Deep dive later; Senior: read now] — one paragraph per layer: `lib/db.ts`, `lib/api/`, `lib/log/`, `lib/jobs/`, `lib/ada-audit/`, `lib/findings/`, `lib/report/`, `lib/services/`, `lib/parsers/`, `lib/analytics/`, `lib/security/`, `lib/ops/`. Each paragraph: what it owns, its one or two most important files, and **point at CLAUDE.md's "Key files" list as the always-current index** rather than duplicating per-file detail.
5. **Data model** [Deep dive later; Senior: read now] — origin models (`Session`, `AdaAudit`, `SiteAudit`) vs. the normalized findings subtree (`CrawlRun` → `CrawlPage`/`Finding`/`Violation`); blobs vs. tables and why both exist (one honest paragraph + forward pointer to `07-senior-brief.md` decision 5); `Job`/`Schedule`; cascade-vs-SetNull in one sentence.
6. **UI conventions** [Deep dive later] — Tailwind class-based dark mode (`darkMode: 'class'` in `tailwind.config.ts`, anti-FOUC script, `ThemeProvider`), the `dark:` variant mapping table copied from CLAUDE.md's dark-mode bullet (small and stable enough to inline), Recharts via `next/dynamic`.

- [ ] **Step 2: Run the checker**

Run: `bash scripts/check-onboarding-docs.sh` — no `MISSING:` for this doc (this one is anchor-dense; expect to fix typos).

- [ ] **Step 3: Commit**

```bash
git add docs/onboarding/03-codebase-tour.md
git commit -m "docs(onboarding): 03-codebase-tour — layout, request flow, layers, data model, UI conventions"
```

---

### Task 6: `04-how-it-runs.md`

**Files:**
- Create: `docs/onboarding/04-how-it-runs.md`
- Read first: spec section "04-how-it-runs.md"; `CLAUDE.md` "Architecture patterns" (all bullets); `.claude/skills/er-seo-tools-architecture-contract/SKILL.md`; `.claude/skills/er-seo-tools-run-and-operate/SKILL.md` (prod topology facts); `lib/jobs/` (skim `worker` + `scheduler` file names for anchor accuracy); `instrumentation.ts`

**Interfaces:**
- Consumes: 03's section names for cross-links.
- Produces: the "what happens when…" narratives that `05` Stage 1 traces follow and `08` diagnoses reference.

- [ ] **Step 1: Write the doc.** Same reading-depth labels as 03. **Written as "what happens when…" narratives, not component lists** (spec requirement). Sections:

1. Re-orientation opener.
2. **What happens when you click "Start Audit"** [First pass] — the full site-audit story in plain language: row created `queued` → promoter → `site-audit-discover` claims it (`queued→running`, DB-level single-runner guarantee) → page discovery (sitemaps → fallback crawl, 1000-page cap) → fan-out of `site-audit-page` jobs → each runs axe, dispatches PDFs, settles counters → PSI → `finalizeSiteAudit` decides `pdfs-running`/`lighthouse-running`/`complete` → post-terminal live-scan builder (broken links + on-page SEO). Keep it one level above the CLAUDE.md phase-model bullet and point there for the full invariants.
3. **The job queue** [Deep dive later; Senior: read now] — `Job`/`Schedule` tables, single in-process worker, conditional-update claim ("first writer wins — explained without the word 'fencing' first, then named"), per-type concurrency, backoff, `onExhausted`, the 60s schedule tick, system schedules seeded at boot.
4. **What happens when the server restarts mid-audit** [First pass] — SIGTERM → `closeBrowser()`; on boot `recoverQueue()`; heartbeat staleness (`updatedAt`) → `resetStaleAudits()` every 10 min; resume vs. finalize vs. fail decision; "a failed job count never destroys a parent."
5. **Scheduled scans + retention** [Deep dive later] — client `Schedule` rows, cadences, what retention deletes and when (terminal Job rows 7/30 d; scheduled site audits per-cadence; 90-day blob pruning with read-time fallbacks — one paragraph each, pointing at CLAUDE.md for exact windows).
6. **Production topology** [First pass; Senior: read now] — RunCloud VPS + PM2 + nginx; app at `$APP_HOME`; DB/uploads/reports under `$DATA_HOME/`; logs at `$LOG_HOME/`; deploys = push to GitHub then `~/deploy.sh` (server pulls); Chrome installed on the box; pointer to `08-operations-runbook.md`.

- [ ] **Step 2: Run the checker**

Run: `bash scripts/check-onboarding-docs.sh` — no `MISSING:` for this doc.

- [ ] **Step 3: Commit**

```bash
git add docs/onboarding/04-how-it-runs.md
git commit -m "docs(onboarding): 04-how-it-runs — queue, audit lifecycle, recovery, retention, prod topology"
```

---

### Task 7: `05-milestones.md`

**Files:**
- Create: `docs/onboarding/05-milestones.md`
- Read first: spec section "05-milestones.md" (five stages are normative, including Codex fix 4 safety rails); `.claude/skills/er-seo-tools-change-control/SKILL.md` (the house change workflow Stage 3 must teach); `.claude/skills/er-seo-tools-validation-and-qa/SKILL.md` (what "tested" means here)

**Interfaces:**
- Consumes: Units 1–9 (01) as prerequisites; 03/04 section names for trace exercises; safety rails from Global Constraints.
- Produces: stage numbering (Stage 0–4) cited by README, 06, and 08.

- [ ] **Step 1: Write the doc.** Opener: this is the spine of the guide; stages are gated by capability, never time; each stage lists goal / prerequisites / exercises (optional but recommended) / gate. The five stages:

- **Stage 0 — Run it.** Prereq: Units 1–2 + `02-local-setup.md` complete. Exercises: click through every tool with `00` open; run one of each audit type **locally against designated test targets only** (safety rails verbatim). Gate: can demo the app running locally and describe each tool's purpose in one sentence.
- **Stage 1 — Read it.** Prereq: Units 3–6. Exercises: three read-only traces, each written up in their own words and checked by Kevin: (a) a single-page ADA audit end to end (route → job → runner → score → poller), (b) a Screaming Frog CSV upload through `lib/parsers/` to the results page, (c) a site audit through the queue (follow 04's narrative against real code). Plus scavenger hunts: "find where the audit score is computed", "find the line that blocks a second concurrent site audit", "find where dark-mode class gets set before hydration". Gate: write-ups accepted; can answer "where would you look for X" for three cold questions.
- **Stage 2 — Change the surface.** Prereq: Units 1–8; Stage 1 gate. UI-scoped changes, each a real PR through the real flow (branch → PR description → review → Kevin deploys): a dark-mode fix (component missing `dark:` variants), a copy change, a new column in an existing results table, one small component cloned from an existing pattern. Gate: two UI PRs merged with at most one review round each; PR descriptions follow Unit 2's checklist.
- **Stage 3 — Ship features and fixes.** Prereq: all Units; Stage 2 gate. Full house workflow (per the change-control skill): spec/brainstorm for non-trivial work, tests (what counts as tested per the validation-and-qa skill), `npm run lint` + `npm test` + `npm run build` gates, Codex/AI-assisted review norms (pointer to `06`). Exercises: one real backlog bugfix; one small feature touching an API route + a component; first Prisma schema migration under supervision (walk CLAUDE.md's schema-change steps). Kevin still deploys. Gate: a feature PR merged where Kevin's review found no correctness issues; migration shipped without incident.
- **Stage 4 — Operate it.** Prereq: Stage 3 gate; prod access granted. Work through `08-operations-runbook.md`: supervised deploy; supervised diagnosis of a stuck/failed audit using `/admin/ops` + logs; then one unsupervised deploy and one unsupervised diagnosis. Learn the "check evidence before restarting" discipline. Gate: the two unsupervised drills done and narrated afterward; can answer "what would you check first" for the runbook's common symptoms. **Until this gate: no production queue operations, no server SSH mutations.**

- [ ] **Step 2: Run the checker; review `DURATION?` output extra carefully** (this doc is the highest risk for pacing language).

Run: `bash scripts/check-onboarding-docs.sh`

- [ ] **Step 3: Self-check against spec** — five stages present; every stage has goal/prereq/exercises/gate; gates all Kevin-verifiable by concrete action; safety rails verbatim in Stage 0 and restated in Stage 4.

- [ ] **Step 4: Commit**

```bash
git add docs/onboarding/05-milestones.md
git commit -m "docs(onboarding): 05-milestones — five capability-gated stages to ownership"
```

---

### Task 8: `06-working-with-ai.md`

**Files:**
- Create: `docs/onboarding/06-working-with-ai.md`
- Read first: spec section "06-working-with-ai.md"; `CLAUDE.md` (as the artifact being explained); `docs/superpowers/README.md` (the taxonomy); `.claude/skills/er-seo-tools-docs-and-writing/SKILL.md`; `.claude/skills/er-seo-tools-change-control/SKILL.md`; the list of `.claude/skills/er-seo-tools-*` skill names

**Interfaces:**
- Consumes: stage numbering (05) for the "when you may let AI touch what" ladder.
- Produces: the trust-model rules `05` Stage 3 points at.

- [ ] **Step 1: Write the doc** with these sections:

1. Re-orientation opener: this repo is developed with AI assistance as the default; this doc is how to do that *well*, and it matters from Stage 0 onward.
2. **The artifacts** — `CLAUDE.md` (the living contract: what it contains, that instructions in it are binding on AI sessions, "when CLAUDE.md and the code disagree, the code is the truth and the doc gets fixed"); the `.claude/skills/er-seo-tools-*` skills (16 domain playbooks — list a handful by name with one-liners and explain they auto-trigger); `docs/superpowers/` taxonomy (specs → plans → archive on ship; nyi; todos) and how to use archived specs as archaeology.
3. **The lifecycle** — brainstorm → spec → Codex review → plan → implementation → verification gates → tracker/handoff. Where the junior fits at each stage of their own ramp.
4. **The trust model, bluntly** (spec's normative list): AI output is a draft; the gates (`npm run lint`, `npm test`, `npm run build`, human review) are the authority; "the model said so" is never a justification; verify against the running app; keep changes small enough that YOU can read the whole diff — if you can't explain a line, don't ship it; AI never touches prod on your behalf before Stage 4 (and after Stage 4, only with you watching every command).
5. **Practical patterns for a junior** — using Claude Code to *explain* unfamiliar code (their main learning accelerator — concrete example prompts against real repo files); asking "why" not just "do"; using it to write the first draft of tests they then read line-by-line; what to do when the AI's answer contradicts CLAUDE.md or a skill (stop, ask Kevin, don't pick a side silently).

- [ ] **Step 2: Run the checker**

Run: `bash scripts/check-onboarding-docs.sh` — no `MISSING:`; review `DURATION?`.

- [ ] **Step 3: Commit**

```bash
git add docs/onboarding/06-working-with-ai.md
git commit -m "docs(onboarding): 06-working-with-ai — house AI workflow and trust model"
```

---

### Task 9: `07-senior-brief.md`

**Files:**
- Create: `docs/onboarding/07-senior-brief.md`
- Read first: spec section "07-senior-brief.md" (the nine-decision inventory + debt list + supervision section are normative, including Codex fixes 6–10); `CLAUDE.md` (whole file — especially "Do not", stack constraints, architecture patterns); `middleware.ts`; `lib/auth.ts`; `ecosystem.config.js`; `lib/security/safe-url.ts`; `.claude/skills/er-seo-tools-architecture-contract/SKILL.md`; `.claude/skills/er-seo-tools-failure-archaeology/SKILL.md`

**Interfaces:**
- Consumes: 03/04 for "skim next" pointers.
- Produces: the standalone senior document — must not require reading any other onboarding doc first.

- [ ] **Step 1: Write the doc.** Register: peer-to-peer, honest, no marketing. Standalone (assume zero repo context; re-introduce the app in two sentences). Structure:

1. **What this is** — two-sentence app intro; "after this doc plus a skim of `03`/`04` you can answer: what is this, why is it shaped this way, what must the junior never merge unreviewed."
2. **Context that explains everything else** — internal tool; one primary developer + heavy AI assistance; small VPS; a handful of internal users; SEO-agency domain. **State explicitly:** most decisions below would be wrong at a different scale, and each entry says what would make us revisit it.
3. **The nine decisions**, each as *Decision / Why / Consequences / Revisit if*. Content per the spec's inventory — the writer must ground every claim in the sources listed above, not paraphrase from memory:
   1. SQLite + Prisma, no Postgres — include the 2026-06-10 "Operations timed out" incident (interactive transaction held SQLite's write lock across event-loop starvation from concurrent pdfjs parsing) and the resulting hard rule: **array-form `$transaction([...])` only**, conditional logic in SQL (`EXISTS`), manual `updatedAt` in raw statements.
   2. RunCloud VPS + PM2, not serverless — headless Chrome, minutes-long jobs, persistent disk; serverless was never viable, not merely unchosen.
   3. Hand-built DB-backed durable job queue, no Redis/BullMQ — conditional-update claims, attempt fencing, per-type concurrency; trade-off: single process, no horizontal scale, event-loop discipline.
   4. Polling, no websockets — survives PM2/nginx restarts trivially; fine at internal scale.
   5. Findings dual-write + 90-day blob pruning — honest history (blobs first, normalization retrofitted in A2), never backfill, reads tolerate both shapes, `scripts/findings-rebuild.ts` is the repair tool.
   6. Auth (Codex fix 6) — signed cookie sessions; Google OAuth primary + break-glass password path (`lib/auth.ts`); `middleware.ts` owns the gate globally, per-route code never re-checks; public-path exceptions (share pages) and token-authed handoff routes; "new route 401s" is the recurring footgun. Include the `> **Kevin fills in:**` callout on prod posture (break-glass enabled or not).
   7. Browser pool with recycling + hard caps — Chrome memory vs. VPS; why `BROWSER_POOL_SIZE` ≤ 4 is a rule (~150–200 MB per page).
   8. Lighthouse provider selection (Codex fix 9) — code supports `pagespeed`/`local`/`off`; prod currently `pagespeed` (`ecosystem.config.js`) to offload CPU; score variance accepted; local/off are supported modes, not dead code.
   9. AI-heavy development process — what `docs/superpowers/` is, specs as archaeology, and the review implication: volume is high, so the gates and review discipline are the control, not line-by-line authorship memory.
4. **Known debt and sharp edges** — `AdaAudit` has no `updatedAt` (job-group state is the liveness source); prod-minification bug class (SWC helper injection breaking string-injected in-page code — the `typeof` rule in `lib/ada-audit/seo/parse-seo-dom.ts`; minified class names breaking key lookups — the parser `parserKey` fix); SSRF discipline (Codex fix 8): never raw-fetch user-provided URLs, everything goes through the safe-URL helpers in `lib/security/safe-url.ts` (mention the 999-status hang class); legacy `SessionPage` read fallback pending model drop; single-process constraint; memory ceilings. Add anything else the writer finds in the failure-archaeology skill worth a senior's attention — with dates where known.
5. **Supervising the junior** — (a) the review-focus checklist (Codex fix 7 included): transactions array-form only; new routes use `withRoute`/`parseJsonBody` **but auth never goes in `withRoute` — middleware owns it**; fenced writes in job code; user-provided URLs via safe-URL helpers only; `dark:` variants on new UI; tests exist and run against the right DB. (b) Danger zones needing senior review longest: `lib/jobs/`, `lib/findings/`, `prisma/schema.prisma`, recovery paths, `middleware.ts`/auth, `lib/security/`. (c) Where authority lives: `CLAUDE.md`, this folder, `docs/superpowers/archive/specs/`, the `.claude/skills/er-seo-tools-*` skills.

- [ ] **Step 2: Run the checker**

Run: `bash scripts/check-onboarding-docs.sh` — no `MISSING:` for this doc. (07 is exempt from the duration lint by design — the script doesn't scan it.)

- [ ] **Step 3: Accuracy pass** — for each of the nine decisions, confirm at least one concrete grounding fact was verified in the listed source files this session (not paraphrased from this plan). Fix anything the code contradicts.

- [ ] **Step 4: Commit**

```bash
git add docs/onboarding/07-senior-brief.md
git commit -m "docs(onboarding): 07-senior-brief — decisions, rationale, debt, supervision guide"
```

---

### Task 10: `08-operations-runbook.md`

**Files:**
- Create: `docs/onboarding/08-operations-runbook.md`
- Read first: spec section "08-operations-runbook.md"; `.claude/skills/er-seo-tools-run-and-operate/SKILL.md`; `.claude/skills/er-seo-tools-debugging-playbook/SKILL.md`; `.claude/skills/er-seo-tools-diagnostics-and-tooling/SKILL.md`; `CLAUDE.md` "Deploy" section; **current A4 ops code (Codex plan-review fix 4 — the run-and-operate skill predates A4 and contains stale statements like "no /api/health endpoint"; the code wins):** `app/api/health/route.ts`, `app/(app)/admin/ops/page.tsx`, `lib/ops/health-summary.ts`, `lib/ops/ops-snapshot.ts`, `lib/jobs/introspection.ts`, `lib/log/index.ts`

**Interfaces:**
- Consumes: Stage 4 gate definition (05); 04's prod-topology section.
- Produces: the drills Stage 4 runs.

- [ ] **Step 1: Write the doc.** Register: a runbook — imperative, symptom-first, safe-by-default. Sections:

1. Re-orientation opener + the prime directive: **look before you touch** — check evidence (logs, `/admin/ops`, queue state) before any restart/delete/config change; a familiar-looking symptom can have a different cause.
2. **Deploy** — always `git push` first (server pulls from GitHub); `ssh $PROD_SSH "~/deploy.sh"`; what deploy.sh does described by **documented/observable effects only** (pull, install, `prisma migrate deploy`, build, PM2 restart) — the script body lives on the server, so do NOT invent internals; per the run-and-operate skill, state effects and mark exact steps as server-verified-only (Codex plan-review fix 6); how to verify a deploy landed (health endpoint, log tail, version/behavior check).
3. **Server layout** — app `$APP_HOME`; DB `$DATA_HOME/db.sqlite` (+ `-wal`/`-shm`); uploads + reports under `$DATA_HOME/`; logs `$LOG_HOME/`.
4. **Health + observability** — `/api/health`, `/admin/ops` panels, the structured pino logs on stderr (PM2 error log), the `subsystem` field, how to grep by tag.
5. **Common diagnoses** — symptom-first table sourced from the debugging-playbook + diagnostics skills (point at them for full recipes): audit stuck in `queued`/`running` (heartbeat age → stale-reset behavior → when to wait vs. act); 502 Bad Gateway; PM2 restart loop (including the invalid-`LOG_LEVEL`-can't-crash-boot guard and startup "Refusing to start" class); OOM (Chrome memory); "[findings] dual-write failed" → `npx tsx scripts/findings-rebuild.ts <id>`; share link 404 (token TTL).
6. **What retention deletes** — one-paragraph summary + pointer (job rows, scheduled-audit pruning, 90-day blob pruning and what "archived" banners mean).
7. **Backups** — what exists today per the run-and-operate skill (writer states reality, including gaps, honestly — this doc must not imply a backup story that isn't there).
8. **Stage 4 drills** (mirrors 05's gate): supervised deploy; supervised stuck-audit diagnosis; then the unsupervised repeats.

- [ ] **Step 2: Run the checker**

Run: `bash scripts/check-onboarding-docs.sh` — no `MISSING:` for this doc.

- [ ] **Step 3: Commit**

```bash
git add docs/onboarding/08-operations-runbook.md
git commit -m "docs(onboarding): 08-operations-runbook — deploy, health, diagnoses, drills"
```

---

### Task 11: Validation pass, cross-links, PR

**Files:**
- Modify: any `docs/onboarding/*.md` needing fixes
- Modify: `README.md` (repo root — add one line pointing to `docs/onboarding/`)

**Interfaces:**
- Consumes: everything above.
- Produces: the merged doc set.

- [ ] **Step 1: Full checker run — must be clean**

Run: `bash scripts/check-onboarding-docs.sh`
Expected: `OK: all anchors exist`, zero `MISSING:` lines. Review every `DURATION?` line: each must describe app behavior, not pacing. Fix violations.

- [ ] **Step 2: Cross-link audit** — every `see XX-doc.md` reference resolves to a real file and real section name; README table matches actual filenames; 05's unit prerequisites match 01's final unit numbering; 07 stands alone (read it start to finish pretending you've never seen the repo — flag any unexplained jargon and fix by defining inline, not by adding dependencies on other docs).

- [ ] **Step 3: Spec acceptance sweep** — walk the spec's "Testing / acceptance" section: every capability gate Kevin-checkable by concrete action; the senior dry-run question answerable from 07+03/04; no time commitments in the junior path; `> **Kevin fills in:**` callouts present for the three open questions.

- [ ] **Step 4: Add the repo-root README pointer**

Add one line to the root `README.md` (wherever docs are mentioned, or a "New developer?" line near the top): `New to this codebase? Start at docs/onboarding/README.md.`

- [ ] **Step 5: Commit, push, open PR**

```bash
git add -A docs/onboarding README.md
git commit -m "docs(onboarding): validation pass, cross-links, root README pointer"
git push -u origin feat/onboarding-guide
gh pr create --title "docs: junior onboarding + senior brief doc set" --body "..."
```

(The whole plan executes on a `feat/onboarding-guide` branch created before Task 1 — executor: create it at start.)

---

## Self-Review Notes

- **Spec coverage:** README ✅ T1; 00 ✅ T2; 01 (incl. Codex fixes 1–2) ✅ T3; 02 (incl. fix 3) ✅ T4; 03 (incl. fix 5) ✅ T5; 04 ✅ T6; 05 (incl. fix 4) ✅ T7; 06 ✅ T8; 07 (incl. fixes 6–10) ✅ T9; 08 ✅ T10; acceptance criteria (anchor validation, no-time lint, dry runs, cross-links) ✅ T1 + T11; open questions → callout convention in header ✅.
- **Out-of-scope guard:** only `docs/onboarding/`, `scripts/check-onboarding-docs.sh`, and one root-README line are touched. No app code.
- **Type consistency:** n/a (docs); filename/stage/unit numbering consistency enforced in T11 Step 2.
