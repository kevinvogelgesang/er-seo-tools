# Audit Actionability Roadmap (2026-07-22) — NYI

**Status:** PARKED / NYI. Captured during the Onboarding Viewbook brainstorm (Kevin: "store this as an NYI roadmap that will have more added to it"). More items will be appended before this becomes active. Do NOT start building from this doc without a Kevin go.

## Goal

The SEO audit results page should work like the ADA results page: an actionable surface where a user can resolve every issue (triage toggle and all that comes with it), instead of a display-only page whose sole verb is the srt_ handoff to Claude. Plus per-page rescanning to speed up fix-verify loops.

## Current-state asymmetry (verified 2026-07-22)

- **ADA has a full triage system:** server-persisted checks (`SiteAuditCheck`/`AdaAuditCheck`, sha256 content-hash keys via `lib/ada-audit/checks-keys.ts`), scopes `page`/`page-violation`/`node`, triage toggle (`useTriageMode`, localStorage), optimistic check hook (`useChecks`), **carry-forward** across same-domain audits (`lib/ada-audit/carry-forward-checks.ts` — resolved items stay resolved next scan), operator attribution. Routes: `app/api/site-audit/[id]/checks`, `app/api/ada-audit/[id]/checks` (+ read-only share variant).
- **SEO has none of it:** `Finding` has no resolution/status field; no checks model, no triage hook; `ResultsView.tsx` findings are display-only. Only workflow verb = Generate Roadmap (srt_ mint → er-handoff-memo skill).
- **Rescan:** ADA single-page rescan exists but creates a NEW audit (`ReScanButton` POSTs `/api/ada-audit`, routes to the new record `?from=<oldId>`). Site-audit results have no rescan control. SEO has no per-page rescan at all — but all building blocks exist: `parse-seo-dom.ts` (single rendered-DOM extraction), rendered/hybrid crawl paths, the `site-audit-page` durable job, the broken-link-verify builder, and the seoOnly render-only execution mode.

## Pinned decisions (Kevin, 2026-07-22)

1. **SEO resolution model mirrors ADA:** triage toggle, per-finding + per-page checkboxes keyed on the finding's stable `dedupKey` (already content-hashed type+URL), carry-forward to the next scan of the same domain. srt_ handoff stays available.
2. **"Generate Roadmap" gets a visibility toggle in the webapp settings** — a physical lever in the app to hide/show the handoff card.
3. **Per-page rescan updates the run IN PLACE** — rescan a single URL (re-render, re-extract on-page SEO, re-verify its links) and update that page's findings within the existing run, with a per-page rescan timestamp shown. A run stops being an immutable snapshot; the page shows "this page is now clean" without a full site scan.
4. **ADA converts to in-place rescan too.** Kevin expected in-place to be the existing ADA behavior; the current new-audit-with-`?from=` flow should be replaced with in-place per-page update on the site-audit results page as part of this roadmap.

## Sketch (to be developed when activated)

- `SeoAuditCheck`-style model (or a generalized `FindingCheck` on `CrawlRun`/`Finding.dedupKey`) + checks routes + carry-forward hook in the live-scan builder seam.
- Triage UI in `components/seo-parser/` (IssueTabs/IssueList/PagesTable) mirroring `useTriageMode`/`useChecks`.
- Per-page rescan job: single-URL render via the seoOnly path → replace that page's `CrawlPage` scalars + page-scope findings inside the existing live-scan run (run-scope counts re-derived); same in-place model applied to ADA child audits. Careful with: run-scope finding counts, score recompute semantics, archived/pruned runs, and the frozen characterization test on the verifier happy path.
- Settings toggle for the roadmap card visibility.

## Open questions for activation

- Where does in-place rescan leave `SiteAudit`-level scores/diffs (C3 instance diffing keys off runs)?
- Does SEO carry-forward hook into `carryForwardSiteAuditChecks` or a findings-layer sibling?
- Sweep/`/issues` interplay: resolved-state should probably surface in the weekly sweep snapshot eventually.

*(Append future audit-page items below this line as they come up.)*
