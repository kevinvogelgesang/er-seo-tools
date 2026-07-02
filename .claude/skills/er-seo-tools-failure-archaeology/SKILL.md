---
name: er-seo-tools-failure-archaeology
description: "Use when a bug, error string, or proposed change in er-seo-tools may have happened before — e.g. \"Operations timed out\", \"Audit timed out (server may have restarted)\", prod-only breakage after green tests, 401s on new routes, empty parser output, false PSI a11y failures, ReferenceError inside audited pages, unmerged-looking branches, deploy blocked by package-lock, or docs contradicting code. Also use before proposing a fix that may re-fight a settled battle or a deliberate skip."
---

# er-seo-tools Failure Archaeology

## Overview

The chronicle of every major incident, dead end, revert, and deliberate skip in this repo, with commit-level evidence. Core principle: **the dominant failure mode here is dev/prod divergence** — every major incident passed local tests — and every incident hardened into a standing rule. Check this file before re-diagnosing a familiar symptom or re-proposing something that was already rejected.

Each entry: Symptom → Root cause → Evidence → Resolution/Status → Standing rule.

## When to use

- A symptom matches an error string or pattern below.
- You are about to propose a fix, feature, or cleanup and want to know if it was already tried, reverted, or deliberately skipped.
- You found something that "looks broken" (unmerged branches, unticked plan checkboxes, stale tracker headers) and want to know if it is actually broken.

## When NOT to use

- Live triage of a new failure → `er-seo-tools-debugging-playbook` (symptom→triage table, log conventions).
- What rules gate a change and why → `er-seo-tools-change-control`.
- The design decisions and invariants themselves → `er-seo-tools-architecture-contract`.
- How to run/deploy/inspect prod → `er-seo-tools-run-and-operate`.

---

## The chronicle

### 1. fei.edu audit death — PM2 memory SIGKILL (2026-05-14)

- **Symptom:** Site audit died at page 8/34 with `Audit timed out (server may have restarted)`. No crash log; Chrome and Node vanished simultaneously.
- **Root cause:** PM2's `max_memory_restart: 1200M` SIGKILL'd Node during a *legitimate* Lighthouse trace-processing memory peak (dmesg showed no kernel OOM). The incident also exposed two recovery flaws: startup recovery waited 5 minutes before failing rows a fresh process could never resume, and force-erroring a parent leaked child AdaAudit/PdfAudit rows that polled forever.
- **Evidence:** PR #15 (merge `1e985e4`); commits `72e5abc` (ceiling 1200M→2400M, Node heap 2048, recycle every 15 pages), `070390a` + `78f194c` (cascade-fail orphan children, immediate startup orphan-fail). Post-mortem: `docs/superpowers/archive/plans/2026-05-14-audit-stability.md`.
- **Resolution/Status:** Shipped. Seeded the recovery architecture that later became the durable job queue; the "wall-clock grace period" idea was superseded again by job-row liveness (Job rows, not elapsed time, are the source of truth; AdaAudit has no `updatedAt`).
- **Standing rules:** (a) On process startup, ANY `running` row is orphaned by definition. (b) There are TWO separate memory ceilings — runtime (PM2) and build-time (entry 4) — each caused its own incident. (c) Never raise `BROWSER_POOL_SIZE` above 4 without checking VPS headroom (CLAUDE.md "Do not").

### 2. Parser-key minification — prod-only silent data loss (2026-06-02)

- **Symptom:** Every PROD SEO audit produced empty per-URL/page indexes, blank keyword/duplicate joins, "hollow" roadmaps. Dev and 800+ tests were green.
- **Root cause:** Aggregator keys were derived from `ParserClass.name`; SWC minifies class names in the prod build only (`InternalParser` → `af`), so all hardcoded `parsedData` lookups missed.
- **Evidence:** `480a637` (PR #45, merge `88db890`, branch `fix/parser-key-minification`).
- **Resolution/Status:** Fixed with an explicit static `parserKey` field. Guard test: `lib/parsers/parser-key.test.ts`.
- **Standing rule:** Never derive runtime identifiers from `Function.name`/class names. This is the archetype of the prod-only bug class — always verify in prod after deploy. Recurred as entry 10 one month later (same compiler-artifact class).

### 3. SQLite interactive-transaction write-lock starvation (2026-06-10) — the canonical incident

- **Symptom:** First real PDF-bearing site audit wedged with `Operations timed out`; 15/23 pages failed. Happened AFTER durable-queue Phase 2 was "done" and deployed.
- **Root cause:** Interactive `prisma.$transaction(async tx => ...)` holds SQLite's single write lock across event-loop round-trips. Four concurrent pdfjs parses starved the event loop; the lock outlived `busy_timeout` for every other writer.
- **Evidence:** `f246b7b` (PR #52, merge `16b0eab`, branch `fix/sqlite-itx-write-lock`). Full story + prod re-verification (identical audit, 59s, 0 timeouts, two restart-recovery tests): `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` line 266.
- **Resolution/Status:** All three interactive transactions converted to array-form `$transaction([...])` with conditional logic in SQL `EXISTS` predicates and manual `updatedAt = Date.now()` in raw statements (raw SQL bypasses `@updatedAt`, and `updatedAt` is the stale-recovery heartbeat).
- **Standing rule:** Hardcoded in CLAUDE.md "Do not" and cross-referenced by every later spec. Array-form transactions ONLY. Non-negotiable.

### 4. Build-heap OOM on deploy (2026-06-22)

- **Symptom:** Prod deploy failed — `next build` exhausted Node's ~2 GB default heap after C10 (SEO performance reports) added ~40 new files. Build passed locally.
- **Root cause:** Codebase growth tipped the build past the server's default heap. Distinct from entry 1's PM2 runtime ceiling.
- **Evidence:** `9208496` (PR #76, merge `54f305d`, branch `fix/build-heap-memory`).
- **Resolution/Status:** `NODE_OPTIONS='--max-old-space-size=3072'` baked into the `build` script (`package.json`).
- **Standing rule:** Large PRs may hit this again — raise the flag in the build script, not ad hoc. Two memory knobs, two incidents (see entry 1).

### 5. PSI reliability grind + false a11y on WAF-protected sites (2026-05-19 onward)

- **Symptom:** Serial PSI (PageSpeed Insights) flakiness — timeouts, 5xx, 429s. Deeper: PSI reported accessibility failures that axe (run from our own Chrome) did not.
- **Root cause:** PSI runs from Google data-center IPs with a cold profile; education-sector client sites behind WAF/CDN bot mitigation intermittently serve Google a challenge page or empty shell — PSI scores the shell. axe was correct; PSI was wrong.
- **Evidence:** `24fc924` (#17: 150s timeout + retry-once on 5xx), PR #18 (merge `14b5244`, `69ac0e7`: detached PSI into the `lighthouse-running` phase, off the per-page Chrome slot); analysis spec `docs/superpowers/nyi/specs/2026-05-29-psi-a11y-reframe-design.md` (NYI — written, not built).
- **Resolution/Status:** Prod runs `LIGHTHOUSE_PROVIDER=pagespeed`; per-page PSI failures fail only the Lighthouse portion by design. The a11y-reframe spec remains unbuilt.
- **Standing rule:** axe is the accessibility authority. Never treat PSI a11y numbers as ground truth for this client base.

### 6. The one true revert — pillar presence semantics (2026-04-29)

- **Symptom:** Sites with zero informational pages rendered a real-looking "Moderate" pillar score.
- **Root cause:** `637ffed` made subscore "presence" key off any-record availability, but the score functions run on the informational subset — so presence was true while the score was the empty-input fallback (5), rendered as real data.
- **Evidence:** `7a162cd` on branch `feature/pillar-analysis-phase-1` — the only revert commit in the repo. It reached main squash-merged inside `1035b0b` (PR #2), so it does NOT appear in `git log main` (`git log main --grep=revert` finds nothing); `git show 7a162cd` still works. This is entry 14's squash-merge effect in action.
- **Resolution/Status:** Presence reverted to informational-scoped.
- **Standing rule:** Never render an empty-input fallback score as real data; gate "presence" on the same data subset the score is computed from.

### 7. Middleware auth-allowlist misses — three times

- **Symptom:** A newly added token-authed or public route returns 401 in prod (the cookie auth gate in `middleware.ts` blocks it).
- **Occurrences:** (1) pillar-era handoff route (documented as the first bite in `docs/superpowers/todos/HANDOFF-improvement-roadmap.md` line 282's "bit us THREE times"; no single fix commit located — take the doc's word); (2) `fd3bf67` (PR #42, seo-roadmap + keyword-memo handoff routes); (3) `0b4b5e3` (B5 — grid↔Teamwork closure — qct_ push export/receipt routes).
- **Resolution/Status:** Each fixed by adding to `isPublicPath`.
- **Standing rule:** Every new public/token-authed route requires BOTH an `isPublicPath` entry in `middleware.ts` AND a `middleware.test.ts` case. No exceptions.

### 8. Parser filename-registry collisions — three times

- **Symptom:** A Screaming Frog CSV silently routes to the wrong parser (substring-based filename matching in the registry).
- **Occurrences:** `605054d` (2026-04-08: `PageSpeedOpportunitiesParser` had to move BEFORE `PageSpeedParser` — substring collision); `d791f79` (2026-06-04: `SecurityParser` stole `security_form_url_insecure.csv` from `InsecureContentParser`); `194f967` (2026-06-04: redirect manifest entries didn't match real SF export filenames — latent parsers never fired).
- **Resolution/Status:** All fixed by registry reordering / manifest correction.
- **Standing rule:** Any new parser must be checked against registry ORDER and filename OVERLAP with existing entries — more-specific filenames go first.

### 9. Early prod-hotfix cluster — six dev/prod divergences (2026-03 → 2026-05)

All local-green, prod-broken. PR attribution before #42 is approximate (some early merges lack PR merge commits); commit hashes are exact.

| Commit | Divergence | Fix |
|---|---|---|
| `0dcf4f2` | SQLite PRAGMAs return rows | Use `$queryRawUnsafe`, not `$executeRawUnsafe` |
| `79979a5` | `request.url` is localhost behind the reverse proxy | Build URLs from `NEXT_PUBLIC_APP_URL` (now a CLAUDE.md rule) |
| `4b9fb33` | `node:net` `all`-mode lookup callback signature differed | SSRF guard supports both signatures |
| `3a8a6ed` | Client-site WAFs blocked our PDF/sitemap fetches | Browser-shaped headers + retry |
| `182376b` | Nginx 413 on large folder uploads | Batch into ≤40 MB chunks |
| `085c1f6`, `4857177` | Prod was Node 18 (newer jsdom incompatible; no `File` global) | jsdom downgraded to v25 + `File` polyfill (server has since moved to Node 22) |

- **Standing rule:** Prod's environment (proxy, WAF-facing egress, Nginx limits, Node version, minification) is a different machine from dev. Budget a prod verification pass for anything touching fetch, URLs, uploads, or raw SQL.

### 10. SWC injected-helper ReferenceError (2026-06-16)

- **Symptom:** C6 (broken-link verifier) Phase 2's page-injected SEO parser threw a `ReferenceError` inside the audited page.
- **Root cause:** Using `typeof` in a function injected via `.toString()` makes SWC emit an escaping `_type_of` helper that exists in module scope but not inside the page.
- **Evidence:** `cc8d1c1` "fix(c6): avoid SWC _type_of helper in injected parseSeoFromDocument".
- **Resolution/Status:** Fixed; constraint documented on `lib/ada-audit/seo/parse-seo-dom.ts` in CLAUDE.md.
- **Standing rule:** Code that leaves the module context (string-injected into a page) must be fully self-contained: no module-scope references, no constructs that emit SWC helpers (avoid `typeof`). Same compiler-artifact bug class as entry 2.

### 11. OAuth hd-hint account-chooser regression (2026-06-29)

- **Symptom:** Immediately after Google OAuth shipped (PR #83, same day), multi-account Google users couldn't sign in — Google skipped the account chooser.
- **Root cause:** The `hd` (hosted-domain) hint in the auth URL made Google auto-select an account instead of showing the chooser.
- **Evidence:** PR #84 (merge `6679993`, branch `fix/oauth-drop-hd-hint`) — the current main tip as of 2026-07-02.
- **Resolution/Status:** `hd` hint dropped; the company-domain gate is enforced server-side only.
- **Standing rule:** Never rely on Google's `hd` parameter for either UX or security; domain enforcement lives server-side.

### 12. affectedSetHash empty-set collision + sticky processing polls (2026-06-02 Codex review)

- **Symptom (found by review, not in prod):** (a) `affectedSetHash` for grouped duplicate-issue types hashed an empty set, so distinct issues collided — breaking Teamwork task dedupe. (b) A minted handoff token that was never redeemed left its row in `processing` forever, so every future page load auto-started a fresh 15-minute polling cycle.
- **Evidence:** `docs/superpowers/todos/2026-06-02-seo-audit-codex-review-findings.md` (finding P38 = affectedSetHash, T2 = sticky processing). Fixes on main: `bcea72c` (set-based hash, fold group URLs), `a1c628f` + `cffc441` (poll window anchored to token mint time, change-detection before lifetime expiry), `9c7490e` (normalized URL join key for optimization_gaps).
- **Resolution/Status:** All fixed.
- **Standing rules:** (a) Hash the actual member set, never a wrapper that can be empty across distinct groups. (b) Any client-side poll must anchor its window to a server-side timestamp (mint time), not page-load time. (c) Adversarial Codex review of every spec/plan is institutional — it catches this class before prod does.

### 13. Pentest → S1–S4 same-day remediation (2026-06-29)

- **Symptom:** An authenticated pentest found: the footer's hover-reveal exposed the deploy command + origin IP in public JS (a deliberate early feature); vulnerable Next 15.3.x; no server-side client-domain validation (SSRF surface); no CSRF guard.
- **Evidence:** `docs/superpowers/todos/2026-06-29-pentest-remediation-tracker.md`; commits `0222187` (S1), `aa15912` (S2: Next 15.5.19 + audit-ci gate), `e786b2d` (S3: domain validation rejecting IP literals/metadata endpoints), `251526d` (S4: central same-site CSRF guard). All merged via PR #82 (merge `d4d5126`). Source findings live in untracked `pentest-results/`.
- **Resolution/Status:** All four code phases shipped and merged, despite the tracker's stale "not started" header and "not pushed" notes. **P3 (login throttling) was deliberately REMOVED** — superseded by Google OAuth (tracker lines 41–43). Remaining items are Kevin-side: flip CSP report-only → enforcing, HSTS at Cloudflare, clean prod client 34's malformed test domains.
- **Standing rules:** (a) Tracker headers/status notes can be stale snapshots — verify shipped-state against `git log main`, not tracker prose. (b) Do not re-propose login throttling (see Deliberate skips).

### 14. Squash-merge illusion — "unmerged" branches that shipped

- **Symptom:** `git branch -r --no-merged main` lists 5 branches, suggesting stalled work.
- **Root cause:** Squash merges orphan branch heads — the content is in main, the commits are not.
- **Evidence (verified 2026-07-02):** Shipped-but-orphaned: `feat/findings-layer-phase4` (its `pruneArchivedBlobs` etc. exist in main's `lib/findings/retention.ts`), `feat/quarter-grid-split` (main has `components/quarter-grid/*`, `usePoolKeyboard.ts`), `feature/pillar-analysis-phase-1`, `docs/seo-audit-overhaul-review`. The ONE real orphan: `docs/google-oauth-design` — a 240-line NYI OAuth design doc (`docs/superpowers/nyi/specs/2026-06-29-google-oauth-login-design.md`, incl. `ca1dec4` external-consent-app pivot) exists ONLY on that branch; the implementation shipped the same day via PR #83 without merging the doc.
- **Standing rule:** Never treat `--no-merged` as evidence of stalled work; verify whether the branch's FILES exist in main before "finishing" or deleting anything. Don't build on the orphaned branch heads.

### 15. Server package-lock drift blocking deploys

- **Symptom:** The deploy script's initial `git pull` on the server refuses to proceed — `package-lock.json` has local modifications (npm install during deploy adds ~3 lines each time).
- **Evidence:** `docs/pillar-analysis-handoff.md` line 158.
- **Resolution/Status:** Known workaround only (root cause never investigated): on the server, `git checkout -- package-lock.json` in the app dir, then re-run deploy. **Per the deploy ruling, AI sessions never SSH-mutate the server — if a deploy is blocked this way, tell Kevin the workaround; do not run it yourself.**
- **Standing rule:** A blocked deploy pull is usually this, not your branch. Root-causing it is an open (low-priority) item, not a settled battle.

### 16. Phase-4 handoff-doc fabrications (docs dated 2026-06-30; ruled 2026-07-02)

- **Symptom:** The tracker and handoff docs describe C6 Phase 4 features that do not exist in the code.
- **The three fabrications vs code truth:**
  | Doc claim (handoff lines 37/43–44/184/198/346; tracker 186/191) | Ground truth (plan + code) |
  |---|---|
  | seoIntent schedules are created autonomously, "self-healing", weekly | Schedules are OPERATOR-created via `POST /api/clients/[id]/schedules` with a `seoIntent` flag (`app/api/clients/[id]/schedules/route.ts:89-113`); no auto-creation code exists |
  | A provider layer at `lib/seo/providers/` | Directory does not exist; the provider is `lib/services/canonical-page-facts.ts` |
  | Live srt_/krt_ memos no longer need SF | Plan decision D3 keeps srt_/krt_ session-bound/SF-only in v1; only the pat_ pillar memo went live |
- **Evidence:** Owner ruling 2026-07-02: doc error — treat PLAN (`docs/superpowers/plans/2026-06-30-autonomous-live-seo-source.md`) + CODE as ground truth over handoff/tracker prose.
- **Standing rules:** (a) When handoff/tracker summaries and code disagree, code + plan win. (b) Related trap: plan checkboxes are NEVER ticked in this repo (the Phase 4 plan shows 0/76 checked with 14/15 tasks done) — completion is tracked in git log + tracker status-log lines, not plan checkboxes.

---

## Deliberate skips — do NOT re-propose as oversights

| Skip | Where recorded | Why |
|---|---|---|
| **Phase 4 Task 13** (retention carve-out preserving the SiteAudit results-view for live SEO) | Plan `2026-06-30-autonomous-live-seo-source.md` Task 13 (marked OPTIONAL); tracker line 193: "intentionally skipped — redundant" | Judged redundant at build time. If retention behavior around live-SEO runs looks "missing", check this before filing it as a gap. |
| **P3 login throttling** (pentest remediation) | Pentest tracker lines 41–43, 90, 112–115 | Superseded by full Google OAuth (PRs #83/#84) — per-user identity is the natural place for rate limiting. Owned by the OAuth track, not a forgotten security hole. |

## Common mistakes

- **Re-diagnosing a prod-only bug from local evidence.** If dev is green and prod is broken, start from the divergence catalog (entries 2, 4, 9, 10), not from your local reproduction.
- **Trusting docs over code for Phase 4.** Entry 16 — the handoff's "C6 Phase 4 invariants" section is partly wrong.
- **"Finishing" a --no-merged branch.** Entry 14 — four of five shipped; check file presence in main first.
- **Reading unticked plan checkboxes as unfinished work.** Completion lives in git log + tracker status logs.
- **Proposing login throttling or the Task-13 retention carve-out** as new ideas. Both are recorded skips.
- **Fixing the canary's nulls.** Prod client 31 "ER Staging Canary" (proway.erstaging.site, weekly) is noindex by design: broken-link findings only, no on-page findings, null live score. Those nulls are correct.
- **SSHing to the server to clear a blocked deploy.** Entry 15 — report the workaround to Kevin; never SSH-mutate.

## Provenance and maintenance

Written 2026-07-02. Describes **main** at tip `6679993` (PR #84, 2026-06-29, 823 commits) plus the unmerged branch `feat/autonomous-live-seo-source` (C6 Phase 4, 23 commits ahead, gate-green, not deployed). Entry 16's "not built" claims describe that branch's state; if Phase 4+ work has since merged, re-verify before citing.

Re-verification one-liners:

| Fact | Command |
|---|---|
| Any cited commit exists/says what's claimed | `git show --no-patch --format='%h %ad %s' <hash>` |
| PR ↔ branch mapping | `git log main --oneline --merges --grep='pull request'` |
| Unmerged-branch list (entry 14) | `git branch -r --no-merged main` |
| Branch-only commits for an "unmerged" branch | `git log origin/<branch> --oneline --not main` |
| Phase 4 still unmerged | `git log main..feat/autonomous-live-seo-source --oneline \| wc -l` (23 as of 2026-07-02; 0 or error = merged/deleted) |
| Build-heap flag still in place | `grep -n 'max-old-space-size' package.json` |
| Handoff fabrications still present (entry 16) | `grep -n 'self-healing\|lib/seo/providers' docs/superpowers/todos/HANDOFF-improvement-roadmap.md` |
| seoIntent schedules still operator-created | `grep -rn 'seoIntent' 'app/api/clients/[id]/schedules/route.ts'` and confirm no auto-create code: `grep -rn 'ensureSeoSchedule\|self-healing' lib/ app/` |
| Task 13 skip still recorded | `grep -n 'Task 13' docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` |
| P3 skip still recorded | `grep -n 'P3' docs/superpowers/todos/2026-06-29-pentest-remediation-tracker.md` |
| Middleware guard test exists | `ls middleware.test.ts && grep -c isPublicPath middleware.ts` |
| Parser-key guard test exists | `ls lib/parsers/parser-key.test.ts` |
| package-lock workaround doc | `grep -n 'package-lock' docs/pillar-analysis-handoff.md` |
| SQLite incident full story | `sed -n '266p' docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md` |

Maintenance: append new entries in the same 5-field format when an incident closes (after the tracker status-log line is written, so the entry can cite it). Line-number citations into `todos/*.md` are the most fragile facts here — re-grep rather than trusting them after those files are rewritten (the handoff is rewritten every cycle by protocol).
