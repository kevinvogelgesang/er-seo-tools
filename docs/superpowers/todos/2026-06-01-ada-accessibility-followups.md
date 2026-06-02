# TODO — ADA Accessibility Follow-ups (PSI reframe + Independent second check)

**Created:** 2026-06-01
**Status:** Specs + plans written, Codex-reviewed, fixes applied. **No implementation started.**
**Owner:** Kevin

This tracks the work that came out of investigating a PSI accessibility false positive on a Molloy University audit. Reference doc for picking the work back up.

---

## Background (the verified finding)

A site audit page showed PSI/Lighthouse accessibility "failures" that our primary axe scan did not find, that local Lighthouse did not find, and that were not in page source.

**Root cause (verified, not theorized):** PSI's accessibility category is itself axe-core, run against a *different, less-representative DOM* — Google fetches from its own data-center IP with a fresh profile. On the Molloy audit (`cmpr6n2v00118gknzo22ny1ug`, `www.molloy.edu/.../omca-test-prep/`), PSI had **transiently evaluated a near-empty/blocked document**: stored a11y score 50 with `document-title`, `html-has-lang`, `landmark-one-main` all on a bare `<html>` (and a tell-tale perf=100). A fresh keyed PSI call from the server returned a11y **0.98** with title+lang **passing** and only `landmark-one-main` (a best-practice, non-WCAG rule) remaining. **axe was correct; PSI was wrong.** Our compliance score is unaffected — it derives only from axe (`lib/ada-audit/scoring.ts`).

Context that matters: clients are **educational institutions** subject to **WCAG 2.1 AA** enforcement (DOJ Title II) within ~a year, so defensible, reproducible findings matter more than opaque third-party scores.

---

## Item 1 — Evidence / root-cause ✅ DONE

- Pulled the audit row from the staging DB (same VPS, `144.126.213.242`) and ran a fresh keyed PSI call server-side.
- Confirmed transient false positive (see Background). No code change; this was diagnosis only.

## Item 2 — PSI accessibility UI reframe ⬜ NOT STARTED (ready to build)

Stop presenting PSI a11y as a competing result: hide PSI findings already caught by axe (exact rule-ID match — Lighthouse a11y IDs *are* axe rule IDs), loudly surface PSI-only findings with a "verify — may be a different/transient DOM" disclaimer, hide the Lighthouse "Best practices" a11y group, and remove the PSI accessibility score card from the grid.

- **Spec:** `docs/superpowers/nyi/specs/2026-05-29-psi-a11y-reframe-design.md`
- **Plan:** `docs/superpowers/nyi/plans/2026-05-29-psi-a11y-reframe.md` (complete TDD, no external unknowns)
- **Depends on:** nothing. Safe to start anytime.
- **Key artifact:** shared pure helper `splitPsiAccessibility(summary, axeViolationIds)` → `{ psiOnly, duplicates, hiddenBestPractice }`, reused by render *and* Item 3's server-side trigger.

## Item 3 — Independent accessibility second-check (IBM Equal Access / ACE) ⬜ NOT STARTED (smoke-gated)

Add a genuinely independent (non-axe) engine as an **on-demand** tie-breaker. PSI can't be a second check (same engine). Use `accessibility-checker-engine` (ACE, Apache-2.0) injected like axe; surface in a separate "Independent Review" block that **never** feeds the compliance score. Auto-trigger when Item 2 finds PSI-only findings.

- **Spec:** `docs/superpowers/nyi/specs/2026-05-29-independent-a11y-check-design.md`
- **Plan:** `docs/superpowers/nyi/plans/2026-05-29-independent-a11y-check.md`
- **Depends on:** Item 2's `splitPsiAccessibility` helper (for the auto-trigger).
- **⚠️ HARD GATE — Phase 0 smoke test first.** Confirm the ACE policy string, result shape (`results` vs `report.results`), per-scan cost, no runtime network, and no DOM mutation before any wiring. If ACE is slow/noisy/networked, stop and revisit.

---

## Recommended order when resuming

1. **Item 2 in full** — no external unknowns, immediately useful, and produces the `splitPsiAccessibility` helper Item 3 needs.
2. **Item 3 Phase 0 (spike)** — cheap, de-risks the whole feature.
3. **Item 3 implementation** — only if Phase 0 passes the gate.

Execution modes (from writing-plans): subagent-driven (recommended) or inline with checkpoints.

## Out of scope / future (noted, not planned)

- Switching PSI from **lab CWV** to **CrUX field data** (`loadingExperience`) — genuinely additive, free in the same PSI response, currently ignored. Separate future spec.
- PSI request cache-busting (the bad fetch was transient; possible reliability tweak, not part of the reframe).

## Decision log

- PSI a11y is **not** an independent check (same engine) → demote to "informational, verify," never scored. (Codex-confirmed.)
- ACE is **on-demand, not always-on** (no per-page in 1000-page site audits). (Codex-confirmed.)
- Engine-only ACE, **not** the `accessibility-checker` wrapper (wrapper pulls full puppeteer + chromedriver binaries, telemetry, CDN). (Codex-confirmed.)
