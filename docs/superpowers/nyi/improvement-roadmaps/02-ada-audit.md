# ADA Audit — Improvement Roadmap

**Date:** 2026-06-10 · **Status:** NYI strategy doc
**Scope:** `app/ada-audit/**`, `app/api/ada-audit/**`, `app/api/site-audit/**`, `lib/ada-audit/**` (~8.7k LOC), `components/ada-audit/**` (38 files; SiteAuditForm 570 LOC, SiteAuditResultsView 517 LOC)

---

## Current state (verified)

This is the most engineered section of the app and the closest to
production-grade: browser pool with recycling, SSRF-guarded navigation,
idempotent finalizer (`pagesDone && pdfsDone && lighthouseDone`), conditional
status updates to prevent recovery races, per-violation screenshots, manual
triage checks, batches.

The structural weaknesses are all about durability, history, and output:

- **Volatile orchestration.** The PSI queue (`lighthouse-queue.ts`) is an
  in-memory array; the site-audit queue is a `processing` boolean; PDF scans
  are fire-and-forget promises. A deploy mid-audit loses all in-flight work
  and relies on `resetStaleAudits()` (5-min threshold, 10-min sweep) +
  `recoverQueue()` + two orphan-cascade helpers to clean up. That recovery
  machinery is some of the most complex code in the repo — it exists to
  compensate for not having a durable queue.
- **Blob results.** `AdaAudit.result` is full axe JSON (500 KB+/page);
  `SiteAudit.summary` aggregates it again. A 500-page audit can persist
  50–250 MB. No queries, no trending, no cleanup of old audit rows.
- **No memory of time.** Audits of the same domain pile up as unrelated rows.
  No comparison, no regression detection, no "did last month's fixes work."
- **No scheduling.** Everything is human-triggered. The Live-SEO plan
  (`plans/2026-06-02-live-seo-on-ada.md`) assumes a *nightly fleet scan* —
  the substrate for that doesn't exist yet.
- **Weak deliverable.** Output is a webapp view plus single-page share links
  (no site-audit shares). No PDF report, no CSV export, no VPAT, no
  remediation tracking. For a client-services business the *report* is the
  product, and right now the report is "log into our internal tool."
- **Polling everywhere.** Multiple bespoke pollers re-render full tables every
  few seconds; counter increments hammer SQLite on big audits.
- **Score formula is blunt.** Impact-weighted penalty ÷ log10(DOM size) means
  small SPAs score high and large content sites score low for identical
  issues; WCAG level selection doesn't influence scoring; pass/incomplete are
  invisible.

## Recommendation

### Phase 1 — Move orchestration onto the durable job queue (2–3 wks)

When the platform job table lands (`06-platform.md`), re-base this section on
it: site-audit pages, PSI jobs, and PDF scans become job rows with attempts +
heartbeats; the worker loop replaces the in-memory pump, the boolean mutex,
and most of `resetStaleAudits` / `recoverQueue` / orphan-cascade code. Deploys
pause work instead of destroying it. This deletes more risk than any feature
adds — and it's a precondition for scheduled scans.

Don't underestimate this migration: it touches browser runs, PSI, PDF work,
the finalizer, and all three recovery paths, and each must be moved without
breaking the in-flight-audit semantics the current code carefully guards
(conditional status updates, drain predicate). Budget 2–3 weeks, migrate one
job type at a time, and keep the old path behind a flag until parity is
proven.

### Phase 2 — Scheduled recurring audits + history (1.5–2 wks)

- `ScanSchedule` table: client → cadence (nightly/weekly/monthly), WCAG level,
  scope. A cron tick enqueues jobs; results attach to the client timeline.
- **Scope honestly: this phase is run scheduling + score-level deltas only.**
  Real run-over-run diffing (new / resolved / unchanged violations) requires
  relational violations and lands with Phase 3 — don't promise regression
  analysis off blob comparisons.
- Regression surfacing: client dashboard badge + (later) notification when a
  previously-clean rule reappears. Carry triage checks (`AdaAuditCheck`)
  forward across runs by dedup key so analysts don't re-dismiss the same
  finding monthly.

This phase is also exactly the nightly substrate the Live SEO MVP rides on —
build it once, both audits use it.

### Phase 3 — Relational violations, blob becomes archive (1–1.5 wks)

`Violation` rows (run, page, ruleId, impact, wcagTags, nodeCount, dedupKey) +
capped node-detail JSON per violation. `SiteAudit.summary` becomes a cheap
aggregate query; common-issues analysis (`common-issues.ts`, 354 LOC) becomes
mostly SQL; DB growth becomes manageable with an archive-pruning policy
(e.g. raw axe JSON deleted after 90 days, violations kept forever for trends).

### Phase 4 — Reporting layer (1.5–2 wks)

- **Branded PDF report** for site audits (executive summary, score trend,
  top issues with screenshots, remediation priorities). Chrome is already on
  the server — render an HTML report route to PDF via the existing pool.
- Site-audit share links (single-page audits have them; site audits don't).
- CSV export of violations.
- Optional: VPAT/ACR scaffold generation from the violation set — big
  differentiator for client conversations, moderate effort once data is
  relational.

### Phase 5 — Scoring v2 + frontend consolidation (1–1.5 wks)

- Score v2: rule-level weights, WCAG-level-aware, pass/incomplete visibility,
  page-type normalization instead of raw `log10(elements)`. Keep v1 alongside
  for continuity; label which formula produced each historical score.
- One `useAuditPoller` hook (or SSE — see platform doc) replacing the
  duplicated poller components; split `SiteAuditForm` (570) and
  `SiteAuditResultsView` (517) into composable pieces shared with the share
  view; memoize grouped-violation derivations.

## What I would not do

- Don't adopt an external queue/worker service — the job table on SQLite is
  sufficient at this fleet size and respects the stack constraints.
- Don't raise concurrency to make big audits faster; memory is the binding
  constraint (Chrome pages ~150–200 MB each, 2.4 GB PM2 cap). Scheduling
  spreads load at night instead.
- Don't chase axe-core completeness with manual-check authoring tools yet;
  triage checks already cover the analyst-judgment layer.

## Effort summary

| Phase | Effort | Depends on |
|---|---|---|
| 1. Durable orchestration | 2–3 wks | Platform job queue |
| 2. Scheduling + score deltas | 1.5–2 wks | Phase 1 |
| 3. Relational violations (unlocks real diffing) | 1–1.5 wks | Platform schema work |
| 4. Reporting (PDF/share/CSV/VPAT) | 1.5–2 wks | Phase 3 (best after) |
| 5. Scoring v2 + UI consolidation | 1–1.5 wks | — |

Total ≈ 7–10 weeks. If forced to pick two: Phases 1–2 — durability plus
scheduling converts this from a tool an analyst *runs* into a service the
company *operates*.
