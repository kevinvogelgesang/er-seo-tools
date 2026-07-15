---
name: er-seo-tools-change-control
description: "Use when deciding how to land ANY change in er-seo-tools — bugfix, feature, schema migration, UI tweak, deploy/config edit, or security-sensitive change — or when tempted to merge to main, run ~/deploy.sh, SSH-mutate the server, scan an external website, skip Codex review, or skip the tracker/handoff ritual. Also use when asked \"can I just...\", when a gate fails (tsc/vitest/build), or when proposing an exception to a CLAUDE.md 'Do not' rule."
---

# er-seo-tools Change Control

## Overview

Every change here is classified into a class, and each class has non-skippable gates.
The gates exist because this repo's worst bugs were **prod-only and invisible to dev
and tests** (minification, PM2 memory kills, reverse proxy, build OOM) — so the
pipeline ends with prod verification, not a green test run. Merge and deploy are
autonomous when gates are green (owner ruling 2026-07-03 — rule 1 below);
destructive server operations remain Kevin-gated.

**Jargon, defined once:**
- **Codex review** — routing a spec/plan/decision through the `consulting-codex`
  skill (Codex CLI as adversarial peer reviewer). Every spec and plan gets this
  before implementation. Plans record findings as "Codex #N" fix annotations.
- **Tracker** — `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`,
  the master checkbox + append-only status log for the improvement roadmap.
- **Handoff doc** — `docs/superpowers/todos/HANDOFF-improvement-roadmap.md`, the
  living chat-to-chat pickup doc; rewritten in the same commit as any tracker change.
- **Gate-green** — `npm run lint` (= `tsc --noEmit`) + `npm test` (= `vitest run`)
  + `npm run build` all pass.

## When to use / When NOT to use

**Use when:** starting any change, classifying it, checking what its gates are,
handling a "can we skip X just this once" impulse, or proposing an exception.

**Use a sibling skill instead when you need:**
- Full incident narratives with evidence trails → `er-seo-tools-failure-archaeology`
- Mechanics of the test/build gates, test conventions, what counts as evidence → `er-seo-tools-validation-and-qa`
- Deploy protocol details, PM2, prod paths, migrations on the server → `er-seo-tools-run-and-operate`
- docs/superpowers taxonomy, handoff house style, spec/plan templates → `er-seo-tools-docs-and-writing`
- Step-by-step checklists for adding a route/job/parser/migration → `er-seo-tools-extension-recipes`

## The hard gates (owner rulings — 2026-07-02, amended 2026-07-03)

These are absolute. No urgency, incident, or "it's obviously fine" overrides them.

| # | Rule | What it means in practice |
|---|------|---------------------------|
| 1 | **Merge + deploy are autonomous when gate-green; destructive server ops stay Kevin-gated** (2026-07-03 ruling, supersedes the 2026-07-02 blanket Kevin gate) | **Merge:** a pasted "Continue the er-seo-tools improvement roadmap" prompt is standing authorization to merge, at session start, any pending PR produced by the roadmap pipeline — after re-running the gates (lint / test / build) on that branch in THIS session. PRs created mid-session by the full pipeline may likewise be merged once gate-green. **Deploy:** run `ssh $PROD_SSH "~/deploy.sh"` autonomously whenever needed to advance the work (post-merge, migrations), ALWAYS followed immediately by post-deploy verification; report the outcome either way. Operational recovery (`pm2 restart`, failed-migration `migrate resolve`) and benign single-row prod writes required by a documented verification runbook (e.g. the pillar smoke via `runForCanonical`) are included. **Still Kevin-gated, current conversation only:** destructive/irreversible ops — deleting prod data, `rm -rf`, editing the server `.env`/secrets, DB restore, force-push — and anything not covered by a documented runbook. |
| 2 | **Docs rituals are never skipped** | Completing or meaningfully advancing a tracker item requires, in the SAME commit: tracker checkbox + dated status-log line + rewritten handoff doc; and the final chat reply must end with the handoff's paste-in prompt in a code block. Specs/plans route through Codex review before implementation. Time pressure is not an exemption. |
| 3 | **Never scan third-party sites casually** | ADA audits, site audits, live scans, and broken-link verification fetch real external websites. Only scan client sites or sites you have permission to scan. Dev test crawls use client sites already in the system or example domains you control. |
| 4 | **Brainstorm → spec → plan runs ungated** (2026-07-03 ruling) | Once brainstorming concludes, proceed straight through spec authoring → Codex review → plan authoring → Codex review WITHOUT waiting for Kevin. Notify him with one line + file path as each artifact lands; he reviews after spec AND plan are complete and stops the flow himself if he wants to redirect. Exceptions that DO stop the flow: Codex verdicts of "send back for rewrite" (vs "accept with named fixes"), or Codex feedback contradicting an earlier Kevin decision. |

## Change classes and their gates

All classes share one landing path: work on a feature branch → push → PR →
**merge once gate-green** (rule 1) → **deploy when needed** → prod verification →
tracker/handoff ritual (if the change touches a tracker item). Classes differ in
what comes before the PR.

| Class | Examples | Required before PR |
|-------|----------|--------------------|
| **Docs-only** | tracker updates, spec/plan authoring, README fixes | No code gates. Tracker + handoff in the same commit if advancing a tracker item. New specs/plans go through Codex review before anything is built from them. |
| **Small bugfix** | one-file fix with a clear repro | Failing test first (TDD), then fix, then gate-green. No spec needed for genuinely small fixes — but if the fix reveals a design problem, stop and write a spec. |
| **Feature / multi-step code** | new tool surface, new job type, refactor | Full pipeline: spec (`-design.md`) → Codex review → plan → Codex review → TDD build (per-task failing-test-first) → gate-green → PR. Plans live in `docs/superpowers/plans/`, dated `YYYY-MM-DD-<name>`. |
| **UI change** | components, pages | Same as its size class above, PLUS dark-mode variants on every element (Tailwind `dark:` — the whole app maps `bg-white`→`dark:bg-navy-card` etc.) and no hydration-mismatch patterns (see `ThemeToggle.tsx`'s `mounted` guard). |
| **Schema migration** | `prisma/schema.prisma` edits | Feature-class pipeline + the migration procedure below. Migrations apply to prod **automatically** during deploy (`prisma migrate deploy` runs inside the deploy script), so a bad migration IS a prod incident. |
| **Security-sensitive** | middleware, auth, SSRF guards (`lib/security/`), upload handling, share tokens, anything fetching URLs | Feature-class pipeline + `middleware.test.ts` coverage for any route-gating change + never weaken `lib/security/safe-url.ts` / domain validation / the Chromium egress guard + the audit-ci CI gate (`.github/workflows/security-audit.yml` → `npm run audit:ci`) must stay green. Never commit `pentest-results/` (untracked, contains real weaknesses). |
| **Deploy/config** | `ecosystem.config.js`, prod `.env`, `package.json` scripts | Server `.env`/secrets edits are Kevin's (rule 1 destructive-ops carve-out); everything else follows the normal pipeline. Two traps: (a) `ecosystem.config.js` env changes are NOT picked up by `pm2 restart` — need `pm2 delete seo-tools && pm2 start ecosystem.config.js`; (b) a new required-in-prod env var bricks the boot (`instrumentation.ts` calls `process.exit(1)` on missing `PILLAR_TOKEN_SECRET`, auth config, or the Chromium egress guard) — the server `.env` must be updated (by Kevin) BEFORE deploy. |

### Gate commands (run all three, verbatim)

```bash
npm run lint    # tsc --noEmit
npm test        # vitest run  (recent plans prefix: DATABASE_URL="file:./local-dev.db" npm test)
npm run build   # NODE_OPTIONS='--max-old-space-size=3072' next build
```

Green gates are necessary, not sufficient: every major incident in this repo's
history passed local tests. Prod verification after deploy is part of the change,
and the tracker logs it explicitly per PR.

**Additional local pre-merge gate — `npm run smoke` (auth / SF upload-parse / ADA
audit changes):** for PRs touching auth, the SF upload/parse flow, or the ADA
audit pipeline, also run `npm run smoke` before merging. It runs a Playwright
happy-path E2E (login → SF upload → parse → report → single-page ADA audit →
complete) against a local loopback fixture. This is a LOCAL gate only — it is
NOT wired into `~/deploy.sh` (the prod box is OOM-sensitive) and it is NOT a CI
job. On macOS, set `CHROME_EXECUTABLE` to your local Chrome path first (e.g.
`export CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`),
because the app's ADA audit drives system Chrome and the config default is the
Linux path. The script requires the smoke-mode env the Playwright config sets
(`SMOKE_MODE` + a loopback `NEXT_PUBLIC_APP_URL` + `SMOKE_LOOPBACK_TARGET`),
which the default-off SSRF allowlist honors — these must NEVER be set in a real
deployment.

### Schema-change procedure

1. Edit `prisma/schema.prisma`.
2. CLAUDE.md documents `npx prisma migrate dev --name <name>`; recent plans
   (2026-06-30) note `migrate dev` is interactive-only in this environment — when
   it can't run, author the migration SQL by hand in
   `prisma/migrations/<timestamp>_<name>/migration.sql` and apply with:
   ```bash
   DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
   DATABASE_URL="file:./local-dev.db" npx prisma generate
   ```
3. SQLite constraints to respect: no `ALTER COLUMN` nullability change (use the
   PRAGMA table-rebuild pattern); no `createMany` + `skipDuplicates` (use
   P2002-guarded individual creates).
4. Production migration runs automatically via `prisma migrate deploy` inside the
   deploy script — you never run it against prod yourself.

## Non-negotiables — each rule with its incident

These are CLAUDE.md "Do not" rules plus repo-level lessons. Each earned its place
through a real failure. Full stories: `er-seo-tools-failure-archaeology`.

| Rule | The incident behind it | Evidence |
|------|------------------------|----------|
| **Array-form `$transaction([...])` only** — never interactive `$transaction(async tx => ...)`. Express conditionals as SQL `EXISTS` predicates. Raw SQL must set `updatedAt` manually (`Date.now()`, integer ms) because raw SQL bypasses `@updatedAt` and `updatedAt` is the stale-recovery heartbeat. | 2026-06-10 production incident: interactive transactions held SQLite's single write lock across event-loop round-trips while 4 concurrent pdfjs parses starved the loop; every writer hit "Operations timed out"; the first PDF-bearing audit failed 15/23 pages — AFTER local tests and deploy had passed. | Fix: PR #52, commit `f246b7b`. Story: tracker line 266. Rule: CLAUDE.md "Do not". |
| **Never rely on `Class.name` (or any identifier name) at runtime.** Use explicit static keys. | 2026-06-02: aggregator keys derived from `ParserClass.name`; SWC minifies class names in prod builds (`InternalParser` → `af`), so all parsed-data lookups silently missed → every prod SEO report was hollow while dev + 800+ tests stayed green. Prod-only, silent. | Fix: PR #45, commit `480a637` (explicit static `parserKey`). |
| **Code injected into audited pages must be SWC-helper-free.** `parseSeoFromDocument` is `.toString()`-injected into the target page — it must reference NO module scope. Avoid `typeof` (SWC compiles it to a module-scope `_type_of` helper → in-page `ReferenceError`). Verify at es2017 that no helper escapes. | 2026-06-16: same compilation-artifact bug class as the parser-key incident, one month later — `typeof o !== 'object'` in the injected function emitted an escaping helper. | Fix: commit `cc8d1c1`. File: `lib/ada-audit/seo/parse-seo-dom.ts` (header comment documents the rule). |
| **Every new public or token-authed route needs a `middleware.ts` `isPublicPath` entry AND a `middleware.test.ts` case.** | The cookie auth gate 401'd new token-authed routes in prod **three times** (per the handoff doc, line 282): pillar-era, the PR #42 roadmap/keyword-memo routes, and the B5 (grid↔Teamwork closure) qct_ push routes. Two bites are directly evidenced in commits. | Fixes: `fd3bf67` (PR #42), `0b4b5e3` (B5). Rule: handoff doc gotchas. |
| **Share/redirect URLs use `NEXT_PUBLIC_APP_URL`, never request origin.** | May 2026: behind the RunCloud/NGINX reverse proxy, `request.url` is `localhost:3000` — auth redirects and share links pointed at localhost in prod. | Fix: commit `79979a5`. Rule: CLAUDE.md "Do not" ("Trust request origin headers"). |
| **Never `npm ci` on production.** | RunCloud environments have lockfile drift; `npm ci` fails there. `npm install` only. | `docs/SERVER_SETUP.md:299`; CLAUDE.md "Do not". |
| **No Claude/Anthropic API analysis features.** | Not an incident — a billing gate: separate Anthropic API billing is not set up. Building it anyway would ship a dead feature. | CLAUDE.md "Do not" (line 126). Listed as a gated decision in the tracker. |
| **`BROWSER_POOL_SIZE` stays ≤ 4** unless VPS memory headroom is verified first. Each Chrome page is ~150–200 MB resident on a 3.82 GB box. | 2026-05-14 fei.edu incident established how tight prod memory is: PM2's `max_memory_restart: 1200M` SIGKILL'd Node mid-Lighthouse ("Audit timed out (server may have restarted)", no crash log). Ceiling is now 2400M — do not "tidy" it down, and do not add memory pressure. | Fix: PR #15 (`72e5abc` et al.). Config: `ecosystem.config.js`. Rule: CLAUDE.md "Do not". |
| **Build heap flag stays in the build script.** `NODE_OPTIONS='--max-old-space-size=3072'` is baked into `npm run build`. | 2026-06-22: C10's (SEO performance reports) ~40 new files tipped `next build` past the server's ~2 GB default heap — deploy-time OOM. Runtime and build-time memory are two separate ceilings; each caused its own incident. | Fix: PR #76, commit `9208496` (`package.json`). |
| **Core stack is frozen:** SQLite only (no Postgres/MySQL), no serverless (RunCloud + PM2), Node 22, Chrome at `/usr/bin/google-chrome`. | Not one incident — an architecture premise. The durable job queue, singleton browser pool, in-memory upload quota, and one-audit-at-a-time invariant all assume a single long-lived fork-mode process with a local SQLite file. Changing any leg silently breaks the others. | CLAUDE.md "Stack constraints" + "Do not change the core stack unless explicitly asked". |
| **No ops/infra strings in client components.** No IPs, SSH commands, deploy commands, service-account emails in anything that ships in the JS bundle. | 2026-06-29 pentest finding #1 was self-inflicted: the footer revealed the deploy SSH command + origin IP on hover — a deliberate early feature (`0370fd2`) that shipped real recon to every visitor. | Removed in S1 (pentest quick wins), commit `0222187`. Sweep: `rg "144\.126|ssh seo|deploy\.sh" app components lib`. |
| **Never scan third-party sites** (owner ruling 3, above). | Preventive, not reactive: the audit/live-scan machinery makes real HTTP requests and drives real Chrome against real sites. SSRF guards (`lib/security/safe-url.ts`) protect *us*; permission protects *them*. | Owner ruling 2026-07-02 (unchanged by the 2026-07-03 merge/deploy amendment). |

## The standard pipeline, end to end

For a feature-class change (scale down per the class table):

1. **Spec** — `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md`. Notify Kevin
   (one line, file path), then immediately route to Codex review — Kevin is NOT
   a gate here (rule 4); only a Codex "rewrite" verdict or a contradiction with
   a prior Kevin decision pauses the flow.
2. **Plan** — `docs/superpowers/plans/YYYY-MM-DD-<name>.md`, per-task TDD steps
   with exact commands. Codex review again. Apply named fixes in place. Kevin
   reviews after spec + plan are both complete; he stops the flow himself if he
   wants to — do not wait.
3. **Build** — TDD per task on a feature branch. Plan checkboxes are historically
   NOT ticked during work; completion truth lives in `git log` + tracker status
   lines, not plan checkboxes.
4. **Gates** — lint, test, build (commands above). All green.
5. **PR** — push the branch, open the PR with `gh`.
6. **Merge** (rule 1): gate-green PRs from this pipeline merge without waiting —
   re-run the gates in the merging session if the PR was built by a prior one.
   Merged ≠ deployed.
7. **Deploy** (rule 1): `git push` is already done; run
   `ssh $PROD_SSH "~/deploy.sh"` when the work needs it. The server
   pulls from GitHub — local unpushed commits never deploy. The script body is
   server-only; do not guess its contents. If the change adds a required-in-prod
   env var, STOP — the server `.env` is Kevin's; he must set it before deploy.
8. **Prod verification** — exercise the changed path on production and record the
   result. This step has caught an incident after every gate was green (the
   2026-06-10 write-lock bug surfaced during exactly this step).
9. **Tracker + handoff ritual** (hard gate 2) — checkbox, dated status-log line,
   rewritten handoff doc, same commit; paste-in prompt closes the chat reply.
   On ship, move the spec/plan from active folders to `docs/superpowers/archive/`.

## Proposing an exception

Any deviation from a "Do not" rule, a hard gate, or a class requirement:

1. **Evidence first.** A reproduction, measurement, or incident reference showing
   why the rule doesn't apply to this case — not a plausibility argument. (Example
   of the bar: `cc8d1c1`'s commit message includes an empirical SWC-compilation
   check proving no helper escapes.)
2. **Kevin decides.** Present the evidence in the conversation; Kevin's explicit
   approval in the current conversation is the only authorization. Codex review is
   advisory input, not an approval channel.
3. **Record the ruling.** If granted, the new boundary goes into CLAUDE.md (or the
   tracker) in the same PR, so the next session inherits it instead of re-arguing it.

## Common mistakes

- **Treating a green build as done.** The repo's dominant failure mode is
  dev/prod divergence: minification, PM2 memory limits, reverse proxy, WAF
  behavior, build heap. Prod verification is part of the change.
- **Merging or deploying with gates unverified.** Autonomous merge/deploy (rule 1)
  is conditional on gates re-run green in the merging session — "it was green
  when the PR was opened" doesn't count. And destructive server ops still need
  Kevin's go in the current conversation; a past approval in a doc never counts.
- **Skipping the handoff rewrite** because the tracker line "says enough". Same
  commit, both files, plus the paste-in prompt — the next session bootstraps
  from the handoff, not from your memory.
- **Trusting doc claims over code.** Tracker/handoff Phase-4 summaries (as of
  2026-07-02) describe three unbuilt features (self-healing seoIntent schedules,
  a `lib/seo/providers/` layer, live srt_/krt_ memos) — plan + code are ground
  truth; see er-seo-tools-failure-archaeology entry 16.
- **Quoting CLAUDE.md invariants without checking merge state.** Canonical-run
  selection is merge-state-sensitive (branch vs main) — see
  er-seo-tools-architecture-contract §6; verify: `git branch --show-current &&
  grep -n pickCanonicalSeo lib/services/findings-shared.ts`. Say which merge
  state you mean.
- **`git add -A` at repo root.** `pentest-results/` (real vulnerability notes),
  `googlefc472dc61896519a.html`, and `SEO_Report_1st_Draft.pdf` are untracked
  and not gitignored — a blanket add commits them.
- **Fixing a prod bug by editing the server.** The server pulls from GitHub;
  SSH edits are both forbidden (hard gate 1) and overwritten by the next deploy.
- **Adding a required-in-prod env var without flagging it.** `instrumentation.ts`
  fail-fast exits brick the app post-deploy if the server `.env` wasn't updated
  first. Call it out in the PR description as a Kevin pre-deploy step.

## Provenance and maintenance

Authored 2026-07-02 against branch `feat/autonomous-live-seo-source` (since
merged — PR #85). **Amended 2026-07-03 (Kevin):** merge + deploy made autonomous
when gate-green (rule 1); brainstorm→spec→plan ungated (rule 4). This skill is
the canonical home for the gate policy — other skills cross-reference it.
Facts below drift — re-verify:

| Volatile fact | Re-verify with |
|---|---|
| Gate commands (lint/test/build definitions) | `grep -A3 '"scripts"' package.json` |
| Branch merged yet? Canonical-selection invariant flipped? | `git log origin/main..feat/autonomous-live-seo-source --oneline \| wc -l` (0 = merged); `ls lib/services/seo-canonical.ts` on main |
| CLAUDE.md "Do not" list current wording | `sed -n '/## Do not/,$p' CLAUDE.md` |
| Deploy command + prod paths | `grep -n 'deploy.sh' CLAUDE.md docs/SERVER_SETUP.md` |
| Incident commits still resolve | `git show --oneline --stat f246b7b 480a637 cc8d1c1 9208496 0222187 \| head -40` |
| Prod tuning values (memory ceiling, pool sizes, concurrency) | `grep -nE 'max_memory_restart\|BROWSER_POOL_SIZE\|CONCURRENCY' ecosystem.config.js` |
| Middleware allowlist + its tests exist | `grep -n isPublicPath middleware.ts middleware.test.ts \| head` |
| Tracker/handoff next item + ritual wording | `head -30 docs/superpowers/todos/HANDOFF-improvement-roadmap.md`; `grep -n 'handoff' CLAUDE.md` |
| Schema-migration local quirk still documented | `grep -n 'migrate dev' docs/superpowers/plans/*.md CLAUDE.md` |
| audit-ci security gate active | `cat .github/workflows/security-audit.yml audit-ci.jsonc` |
| Untracked sensitive files still present | `git status --short` |
