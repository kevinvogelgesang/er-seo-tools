# HANDOFF — Sales-audit overhaul (3-PR series)

**Last updated:** 2026-07-15 — **PR 1 + PR 2 SHIPPED + DEPLOYED + PROD-VERIFIED.** PR 3 remains.
**Scope:** a Kevin-commissioned 3-PR series, SEPARATE from the improvement-roadmap (that roadmap's standing direction stays the SF-parity campaign — see `HANDOFF-improvement-roadmap.md`). Do not conflate the two threads.

---

## Series status

| PR | Title | Depends on | State |
|----|-------|-----------|-------|
| 1 | Explainer inline disclosure component + app-wide adoption | — | **SHIPPED** (PR #168, main `e330da1`) |
| 2 | Sales report urgency redesign | PR 1 | **SHIPPED** (PR #169, main `99cd885`, deployed + prod-verified 2026-07-15) |
| 3 | Prospect scans dashboard UX | independent | NOT STARTED — plan ready |

**Recommended next: PR 3** (independent of PR 1/2).

## PR 2 — what shipped (reference for PR 3)

The public token-gated `/sales/[token]` prospect report, rebuilt for urgency:
- **Hero capture pipeline:** additive `SiteAudit.homepageScreenshot` column (migration `20260715000000`) + `HERO_SCREENSHOTS_DIR` file store (atomic write, ENOENT-tolerant delete, outlives the 24h screenshot sweep). Prospect-only root-URL injection in discovery guarantees the homepage is audited; the ADA runner captures a viewport PNG (audited path + rendered same-domain-root redirects) published **fenced to the winning settle** with a prospect-guarded stamp + delete-on-orphan; deletion wired at all 3 seams. Public `GET /api/sales/[token]/hero/[siteAuditId]` (indistinguishable-404 / non-oracle-500, ownership-equality scoping, anchored single-segment matcher).
- **Loader v2:** `overallScore` (avg of available headline values, nulls excluded), `heroScreenshot`, `standardTested`, per-issue `affectedPages`/`affectedComplete`, `performance:{rollup,homepage}`.
- **Rebuilt view:** sticky branded header + Book-a-review CTA, hero row (screenshot + animated gauge), `affectedPages`-driven SEO urgency bars with "why this hurts you" copy, counts-only accessibility, evidence-bounded structured-data grid, score-methodology `Explainer`s, inquiry form. Consumed PR-1's `Explainer` (+ added its focus-visible ring follow-up).
- Full CLAUDE.md `lib/sales/` + `components/sales/` + hero-pipeline entries updated.

**Governing rules honored (keep them in PR 3):** only *static methodology prose* behind `Explainer`s; all operational truth (status/coverage/freshness/archived-banner/honesty-qualifier) stays visible. Honest labeling (C14): no "WCAG compliant"/"Core Web Vitals pass" about the prospect; `ER_ADA_CTA` is the ONE sanctioned ER-product ADA claim; performance is Lighthouse LAB data.

**Deferred from PR 2 (candidates for PR 3 / follow-up):**
- **Orphaned curated-screenshot surface** (flagged by both Codex P2 + opus): the counts-only report no longer renders any `/api/sales/[token]/screenshot/...` URL, but that public route + `curatedScreenshotSet`/`topPatternIssues`/`loadRepresentativeExamples` remain. NOT a safety regression (ownership+curated-set gated, non-guessable, same-prospect, and pre-PR reports already rendered+authorized them). Candidate to retire/tighten.
- Hero-route `AUDIT_ID_RE` (`/^[a-z0-9]+$/i`) is stricter than `assertSafeId` (`/^[A-Za-z0-9_-]+$/`) — inert for cuids, latent divergence.
- InquiryForm is a mailto placeholder — the card shell is structured so a future embedded Jotform swaps behind it.

## PR 3 — prospect scans dashboard UX (next, independent)

- **Spec:** `docs/superpowers/specs/2026-07-14-prospect-scans-dashboard-ux-design.md`
- **Plan:** `docs/superpowers/plans/2026-07-14-prospect-scans-dashboard-ux.md` (Codex-reviewed, fixes applied)
- Touches the cookie-gated `/sales` intake (`components/sales/intake/ProspectDashboard.tsx`).

## Process notes (how PR 1 + PR 2 were built — repeat for PR 3)

- `superpowers:subagent-driven-development`: fresh implementer + task-scoped (spec+quality) reviewer per task (opus reviews on the riskiest tasks — runner, security route, loader, atomic-swap keystone), then an opus whole-branch review. Ledger: `.superpowers/sdd/progress.md`.
- Gates (the ONLY type-check gate — in-build checks disabled): `npx tsc --noEmit` + `npx vitest run`, both green before merge; `npm run build` for anything file-count-heavy. PR 2: tsc clean / 571 files 5310 tests / build OK.
- Pre-merge `/codex-review` (P1). EPERM `listen 127.0.0.1` "failures" in `lib/security/safe-url.test.ts` are sandbox artifacts — trust the in-session local run.
- On ship: `git mv` PR spec+plan to `docs/superpowers/archive/`, merge, `ssh seo@144.126.213.242 "~/deploy.sh"`, verify health/SHA/error-log. **Deploy trap:** `~/deploy.sh` uses `pm2 restart`, which does NOT pick up new `ecosystem.config.js` env vars — after deploying a PR that adds one (PR 2 added `HERO_SCREENSHOTS_DIR`), run `pm2 delete seo-tools && pm2 start ecosystem.config.js && pm2 save` to activate it (done for PR 2). If PR 3 adds no env var, a plain deploy suffices.

---

## Paste this into a new chat to continue

```
Continue the sales-audit overhaul (Kevin-commissioned 3-PR series; SEPARATE from
the improvement roadmap). STATE (2026-07-15): PR 1 + PR 2 are SHIPPED + DEPLOYED +
PROD-VERIFIED (PR #168 e330da1; PR #169 main 99cd885). Only PR 3 remains — see
docs/superpowers/todos/HANDOFF-sales-overhaul.md.

NEXT: implement PR 3 — prospect scans dashboard UX (independent, no dependency on
PR 1/2). Touches the cookie-gated /sales intake (components/sales/intake/
ProspectDashboard.tsx).
  Plan: docs/superpowers/plans/2026-07-14-prospect-scans-dashboard-ux.md
  Spec: docs/superpowers/specs/2026-07-14-prospect-scans-dashboard-ux-design.md
Both Codex-reviewed, fixes applied. Build subagent-driven per the plan header.
Gates: npx tsc --noEmit + npx vitest run green before any merge.

HARD RULES:
- Operational truth NEVER moves behind an Explainer (status/error/freshness/
  coverage/truncation/honesty-qualifier/archived-banner/action-guidance copy
  stays visible). Only static methodology prose goes behind the disclosure.
- Honest sales labeling (C14): no "WCAG compliant"/"Core Web Vitals pass";
  performance is Lighthouse LAB data.
- Consider folding in the PR-2 follow-ups if they touch your surface: retire or
  tighten the now-orphaned curated-screenshot route (public, still authorized but
  no longer rendered).
- Pre-merge: /codex-review (P1). EPERM in lib/security/safe-url.test.ts are
  sandbox artifacts, not regressions; trust the in-session local run.
- On ship: git mv PR3 spec+plan to docs/superpowers/archive/, merge, push main,
  ssh seo@144.126.213.242 "~/deploy.sh", verify health/SHA/error-log, then
  update this handoff. (PR 3 adds no env var expected → a plain deploy suffices;
  if it does add one, remember pm2 delete+start to activate it.)

FIRST STEP: load skill er-seo-tools-change-control, confirm main clean + prod
healthy, then read the PR 3 plan and start.
```
