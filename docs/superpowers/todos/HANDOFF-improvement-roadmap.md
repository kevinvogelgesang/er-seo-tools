# HANDOFF — Improvement Roadmap (living doc)

**Last updated:** 2026-07-08 (**GATED DECISION RESOLVED: NO AI API** — Kevin ruled there are no plans to use any AI API (Anthropic or otherwise) at the moment. Tracker Gated-decisions entry checked off with verdict; C12 data-correctness half OFF (zero-AI Tier-0 only); 03 Phase 3 direct memo generation off the roadmap (skill-handoff clipboard flow stays); CLAUDE.md "Do not" rule strengthened. SEMRush ingestion (a data API, not an AI API) stays a separate open question. Earlier same day: **A8 PR 5 — ada-audit visual polish SHIPPED + DEPLOYED + PROD-VERIFIED** (PR #130, main `ccd98b3`). **Next action = unchanged: decide WITH Kevin — another A8 per-tool polish pass (PR 6 — clients / reports / robots-validator / quarter-grid) OR call the A8 per-tool arc done and mark A8 `[x]`.**) · **Updated by:** the gate-decision recording session.
**Rule:** whoever completes (or meaningfully advances) a tracker item updates
this file *and* the tracker in the same commit. This doc always reflects the
single next action.

---

## Paste this into a new chat to continue

```
Continue the er-seo-tools improvement roadmap. A8 PR 5 — ada-audit visual polish is SHIPPED +
DEPLOYED + PROD-VERIFIED (PR #130, main ccd98b3). A8 PRs 1–3.5 (shell/dashboard/widget-editor/
aggregate-widgets) + PR 4 (seo-parser polish, #120) + PR 5 (ada-audit polish, #130) are all
shipped. C11 (SEO Audits v1) is fully complete (#122/#124/#126/#128).

STANDING GATE (decided 2026-07-08): NO AI API — Kevin ruled there are no plans to use any AI
API (Anthropic or any LLM provider). Never propose or build AI-API features: direct memo
generation (03 Phase 3), C12's data-correctness half, and any AI slice of SF-retirement Phase 6
are OFF. All AI stays the pat_/srt_/krt_/qct_ skill-handoff clipboard flow. Only Kevin reopens
this (tracker → Gated decisions). SEMRush ingestion is a data API, not an AI API — separate,
still-open question.

*** FIRST STEP: A8 PR 4+ (per-tool visual polish) is OPEN-ENDED by design (spec §8). seo-parser
and ada-audit — the two tools Kevin pre-picked back-to-back — are both done. So there is NO
pre-decided next tool. ASK KEVIN: (a) do another per-tool polish pass (candidate tools that still
hand-roll status/score chrome or carry their own page wrappers: /clients, /reports, /robots-validator,
/quarter-grid — scope the tightest slice WITH him, like PR 4/PR 5 did), or (b) call the A8 per-tool
arc DONE → mark A8 [x] in the tracker and pick the next roadmap item. Do NOT assume a tool. ***

If Kevin picks a tool: brainstorm→spec→plan for THAT tool's surface only, small + independently
shippable. VISUAL/primitive-adoption ONLY — no behavior/data/API/scoring change; existing tests
stay green. Reuse the PR 5 recipe below.

PR-5-proven recipe (reuse it):
(a) Adopt the EXISTING components/ui/ primitives — ScoreRing (score:number|null, size; bands
    ≥80 green/≥50 amber/else red; null→dashed em-dash ring) and StatusPill (label, tone:
    neutral|running|success|error|warning). Do NOT modify StatusPill's tone set (shared with the
    Home widgets — a tone change ripples cross-tool). If a helper needs its tone type, it is now
    EXPORTED: `import type { Tone } from '@/components/ui/StatusPill'`.
(b) For lifecycle/status pills, map BY COLOR not by word so operational surfaces stay pixel-stable.
    ada-audit's reusable helper is `components/ada-audit/status-tone.ts` `auditStatusTone(status)`
    (complete→success, error→error, running/pdfs-running/lighthouse-running→warning[amber],
    redirected→running[blue], else→neutral). Copy the pattern per tool; don't force a global helper
    across tools with different status vocabularies.
(c) EXCLUDE things StatusPill/ScoreRing don't model: impact/severity 4-level palettes with dots/
    borders, INTERACTIVE toggle chips/buttons (converting them = a behavior change → forbidden),
    and score displays whose bands differ from ScoreRing's ≥80/≥50 (e.g. Lighthouse uses ≥90 — do
    NOT swap those). Document each exclusion in the spec; these are future `SeverityBadge` work.
(d) hex→Tailwind-token swap is pixel-safe where it applies — navy=#1c2d4a, orange=#f5a623,
    navy-deep=#0f1d30, orange-dark=#d4881a; opacity uses bg-navy/[0.08] (NOT /8 — invalid step).
    NOTE: ada-audit needed NEITHER hex swap NOR wrapper reconciliation (already clean) — check
    each tool; don't assume it needs the same work seo-parser did.
(e) The shell <main> (components/shell/AppShell.tsx) supplies bg-[#f4f6f9] dark:bg-navy-deep, so
    in-shell page roots should DROP their own min-h-screen bg-* (keep py/px + max-w/mx-auto);
    centered fallbacks → min-h-[60vh]. WATCH shared authed+public-share components: a component
    rendered OUTSIDE the shell (public /share views) canNOT have its wrapper stripped. Do the
    ownership check (grep importers) before touching any wrapper.
(f) This repo has NO jest-dom — component tests use .getAttribute()/.toBeTruthy()/
    queryByText(...)===null / container.querySelector(...), never toBeInTheDocument/toHaveAttribute;
    jsdom tests start with `// @vitest-environment jsdom`.

1. Load skill er-seo-tools-change-control first. Gate policy (rules 1 & 4): THIS PASTED PROMPT is
   standing authorization to merge gate-green roadmap PRs at session start (re-run lint/test/build
   on the branch this session first) and to deploy when needed, ALWAYS followed by post-deploy
   verify. FOR UI PRs, post-deploy verify SHOULD drive the real authed tool page via Playwright and
   MEASURE layout (getComputedStyle / widths) — server-side health is NOT enough (A8 PR 2 shipped a
   purged-CSS size bug caught only by a real-browser width measure). Prod URL:
   https://seo.erstaging.site (authed — but login is Google OAuth ONLY, NOT headlessly automatable;
   the Playwright MCP session may NOT be authed, in which case authed-UI checks fall to Kevin —
   verify redirects/HTTP + public surfaces + the prod CSS bundle for your new classes yourself, flag
   the authed visual spot-check for Kevin). Destructive server ops stay Kevin-gated; docs rituals
   mandatory; NEVER scan non-client sites (dev-test scans ONLY against a client domain in the system
   or an *.erstaging.site domain you control). Brainstorm→spec→plan runs ungated (route each artifact
   to Codex, notify Kevin one line + path, don't wait).
2. Trust ranking when docs disagree: code > plan/spec > tracker/handoff.
3. Fresh worktree off origin/main. WORKTREE ENV NOTE (no node_modules): run `npm install`
   (~15s cache-warm), write a root `.env` (`DATABASE_URL=file:./local-dev.db`,
   `UPLOADS_DIR=./local-uploads`, `NEXT_PUBLIC_APP_URL=http://localhost:3000`,
   `CHROME_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`), then
   `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma generate` before
   trusting tsc. A per-tool polish PR is almost certainly migration-free (visual only).
4. Gates before PR: npx tsc --noEmit + DATABASE_URL="file:./local-dev.db" npm test + npm run build.
   UI class: dark: on every element; no hydration mismatch; existing tests stay green; any NEW
   Tailwind class must be reachable by the content globs (incl. ./lib/**). Then PR → merge
   (gate-green) → ~/deploy.sh → post-deploy verify.
5. Docs ritual: tracker status-log + rewrite this handoff in the same commit as the ship. On ship,
   move spec + plan to docs/superpowers/archive/. A8 stays [~] while per-tool passes continue; mark
   A8 [x] the moment Kevin says the per-tool arc is done, then pick the next roadmap item.
```

## Current state (2026-07-08)

- **GATED DECISION RESOLVED (2026-07-08): NO AI API.** Kevin ruled there are no plans to use
  any AI API at the moment (Anthropic or otherwise). Recorded in: tracker Gated-decisions
  (checked, verdict inline), C12 entry (data-correctness half OFF; zero-AI Tier-0 increments
  are the only C12 candidates), C6 entry (Phase 6's AI slice off; SEMRush data-API ingestion
  stays a separate open billing question), CLAUDE.md "Do not" rule, and
  `nyi/FUTURE-content-auditing.md` header. 03 Phase 3 (direct memo generation) is off the
  roadmap; D1/D2 (handoff engine + SSE arrival) are unaffected — they polish the zero-AI
  transport. Reopening the gate = Kevin only.

- **A8 (active, [~]) — homepage/shell COMPLETE through PR 3.5; per-tool polish (PR 4+) in
  progress. NEXT = a Kevin decision (another pass vs. done).**
  - PR 1 (shell): #112, main `f48c98d`. PR 2 (dashboard): #113, `acbf96e` (+ purge fix #116/#117).
    PR 3 (widget editor): #115, `229e901`. PR 3.5 (aggregate widgets): #118, `0c13cb6`.
  - **PR 4 (seo-parser polish): #120** — ScoreRing on results health-score, hex→token,
    wrapper reconciliation, deck card language.
  - **PR 5 (ada-audit polish): #130, main `ccd98b3` — SHIPPED + DEPLOYED + PROD-VERIFIED.**
    VISUAL-ONLY, pure primitive adoption (ada-audit was already shell-clean + token-based → NO
    wrapper/hex work). `ScoreRing` on `AuditScorecard` headline (size 72) + `ClientsAuditSummary`
    score badge (size 32). `StatusPill` on every hand-rolled lifecycle/severity/compliance pill
    (`AuditScorecard` compliant, `ScoreVersionBadge`, `SiteAuditDiffPanel` severity + count chips,
    `QueueMemberRow`, `LiveAuditTable` [local dupe deleted], `ClientsAuditSummary` ChipForStatus)
    via NEW `components/ada-audit/status-tone.ts` `auditStatusTone()` (color-preserving). `StatusPill`
    got a type-only `Tone` export. **Excluded (documented):** impact-severity tiles/chips/badges
    (interactive + 4-level palette → future `SeverityBadge`), `LighthouseSection` (bands ≥90 ≠
    ScoreRing ≥80), plain-text/dense columns. Gates: tsc · 3732 tests / 427 files · build.
    **Prod verify:** health ok, auth gate intact, no global purge, ALL new ScoreRing/StatusPill tone
    classes confirmed in the shipped prod CSS bundle (purge ruled out). **Authed visual eyeball of
    the ada-audit scorecard/queue/clients/diff is the one residual check — flagged for Kevin (MCP
    Playwright isn't authed; Google-OAuth-only).** Spec + plan → `archive/`.
  - **The decision for the next session:** A8 PR 4+ is open-ended. The two pre-picked tools
    (seo-parser, ada-audit) are done. ASK Kevin whether to do PR 6 on another tool (candidates that
    still hand-roll chrome or own wrappers: `/clients`, `/reports`, `/robots-validator`,
    `/quarter-grid`) or call A8 done and mark it `[x]`.

- **C11 — SEO Audits v1: COMPLETE ✅ ([x]).** All 3 PRs shipped + deployed + prod-verified
  (#122 `11fcaf6`, #124 `2d18ac9`, #126 `c457eb1`, #128 `b679038`). `/seo-parser`→`/seo-audits`
  rename with 308 redirects; persisted `tool:'seo-parser'` discriminator + `/api/parse|seo-parser`
  routes + `@/…/seo-parser` module paths deliberately KEPT.

- **Everything else** (Tracks A–D, C6 SF-retirement, C10 reports, C12/C13/C14): unchanged — see the
  tracker (`2026-06-10-improvement-roadmap-tracker.md`) for authoritative per-item status and the
  full status log.
