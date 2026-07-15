# HANDOFF — Sales-audit overhaul (3-PR series)

**Last updated:** 2026-07-15 — **PR 1 (Explainer disclosure component) SHIPPED + DEPLOYED + PROD-VERIFIED.** Two PRs remain.
**Scope:** a Kevin-commissioned 3-PR series, SEPARATE from the improvement-roadmap (that roadmap's standing direction stays the SF-parity campaign — see `HANDOFF-improvement-roadmap.md`). Do not conflate the two threads.

---

## Series status

| PR | Title | Depends on | State |
|----|-------|-----------|-------|
| 1 | Explainer inline disclosure component + app-wide adoption | — | **SHIPPED** (PR #168, main `e330da1`, deployed + prod-verified 2026-07-15) |
| 2 | Sales report urgency redesign | **PR 1** (consumes `Explainer` for score-methodology) | NOT STARTED — plan ready |
| 3 | Prospect scans dashboard UX | independent | NOT STARTED — plan ready |

**Recommended next: PR 2** (its dependency, PR 1, is now merged). PR 3 can be done any time (independent).

## PR 1 — what shipped (reference for PR 2)

`components/ui/Explainer.tsx` — reusable inline disclosure primitive + 4 presentational subcomponents (`ExplainerSummary`, `ExplainerTags`, `ExplainerColumns`, `ExplainerNote`). Pure `'use client'`, no state beyond `useState(open)`, no fetches/context/portals → safe on the public token-gated share/sales pages and inside RSC trees. A11y: `aria-expanded` trigger, `aria-controls` via `useId()`, collapsed panel is `aria-hidden` + `inert` + `invisible` (Safari-14 focus fallback); `grid-template-rows: 0fr→1fr` motion-safe animation; `variant` = `'card'` (bordered) | `'plain'` (borderless, default).

**Governing rule adopted everywhere (do NOT break it in PR 2):** only *static methodology prose* goes behind the disclosure. *Operational truth* — status/error/freshness/coverage/truncation/honesty-qualifier/archived-banner/action-guidance copy — stays visible at all times.

Adopted by: `ScoreExplanation` + `AdaScoreExplanation` (label "How this score is calculated"); 7 site-audit SEO sections; 5 client dashboard cards; robots-validator + /reports intros. **`ExplainerTags`/`ExplainerColumns`/`ExplainerNote` are built + tested but first CONSUMED by PR 2** (sales-report score-methodology explainers — the "Social Style" mock's tag chips / do-don't columns / flag note).

**Recorded follow-up for PR 2:** the Explainer trigger has no `focus-visible:` ring (consistent with sibling controls, but the opus review flagged adding one before heavier sales-page use). Good candidate to fold into PR 2.

## PR 2 — sales report urgency redesign (next)

- **Spec:** `docs/superpowers/specs/2026-07-14-sales-report-urgency-redesign-design.md`
- **Plan:** `docs/superpowers/plans/2026-07-14-sales-report-urgency-redesign.md` (Codex-reviewed, fixes applied)
- Consumes `Explainer` (now on `main`) for score-methodology explanations. Touches the public `/sales/[token]` report view (`components/sales/`, `lib/sales/`). Honest-labeling rules from C14 still bind: no "WCAG compliant" / "Core Web Vitals pass" claims; performance is Lighthouse LAB data.

## PR 3 — prospect scans dashboard UX (independent)

- **Spec:** `docs/superpowers/specs/2026-07-14-prospect-scans-dashboard-ux-design.md`
- **Plan:** `docs/superpowers/plans/2026-07-14-prospect-scans-dashboard-ux.md` (Codex-reviewed, fixes applied)
- Touches the cookie-gated `/sales` intake (`components/sales/intake/ProspectDashboard.tsx`).

## Process notes (how PR 1 was built — repeat for PR 2/3)

- Executed via `superpowers:subagent-driven-development`: fresh implementer + task-scoped (spec+quality) reviewer per task, then a final opus whole-branch review. Ledger at `.superpowers/sdd/progress.md` (section "Sales-overhaul PR1").
- Gates (the ONLY type-check gate — in-build checks disabled): `npx tsc --noEmit` + `npx vitest run`, both green before merge. PR 1: tsc clean / 562 files 5252 tests.
- Pre-merge `/codex-review` (P1 gate): PR 1 came back clean, no actionable findings (the 4 "failures" it reported were `EPERM listen 127.0.0.1` sandbox artifacts in `lib/security/safe-url.test.ts`, a file this branch doesn't touch — my full local run passed all 5252).
- On ship: `git mv` the PR's spec + plan to `docs/superpowers/archive/`, push `main`, `ssh seo@144.126.213.242 "~/deploy.sh"`, verify health + SHA + error log.

---

## Paste this into a new chat to continue

```
Continue the sales-audit overhaul (Kevin-commissioned 3-PR series; SEPARATE from
the improvement roadmap). STATE (2026-07-15): PR 1 (Explainer disclosure
component) is SHIPPED + DEPLOYED + PROD-VERIFIED (PR #168, main e330da1). Two PRs
remain — see docs/superpowers/todos/HANDOFF-sales-overhaul.md.

NEXT: implement PR 2 — sales report urgency redesign. Its dependency (PR 1's
Explainer component) is now on main. It consumes components/ui/Explainer.tsx
(incl. the so-far-unused ExplainerTags/ExplainerColumns/ExplainerNote
subcomponents) for score-methodology explanations on the public /sales/[token]
report.
  Plan: docs/superpowers/plans/2026-07-14-sales-report-urgency-redesign.md
  Spec: docs/superpowers/specs/2026-07-14-sales-report-urgency-redesign-design.md
Both Codex-reviewed, fixes applied. Build subagent-driven or inline per the plan
header. Gates: npx tsc --noEmit + npx vitest run green before any merge.

HARD RULES:
- Operational truth NEVER moves behind an Explainer (status/error/freshness/
  coverage/truncation/honesty-qualifier/archived-banner/action-guidance copy
  stays visible). Only static methodology prose goes behind the disclosure.
- Honest sales labeling (C14): no "WCAG compliant"/"Core Web Vitals pass";
  performance is Lighthouse LAB data.
- Consider folding in the PR-1 follow-up: add a focus-visible: ring to the
  Explainer trigger before heavier sales-page use.
- Pre-merge: /codex-review (P1). Codex runs its own suite in a sandbox that
  blocks loopback sockets — EPERM "failures" in lib/security/safe-url.test.ts
  are sandbox artifacts, not regressions; trust the in-session local run.
- On ship: git mv PR2 spec+plan to docs/superpowers/archive/, push main,
  ssh seo@144.126.213.242 "~/deploy.sh", verify health/SHA/error-log, then
  update this handoff.

FIRST STEP: load skill er-seo-tools-change-control, confirm main clean + prod
healthy, then read the PR 2 plan and start. PR 3 (prospect scans dashboard UX,
independent) can follow or be done separately.
```
