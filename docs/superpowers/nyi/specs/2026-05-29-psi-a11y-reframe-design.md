# PSI Accessibility Reframe — Design

**Date:** 2026-05-29
**Status:** Reviewed by Codex (ACCEPT WITH NAMED FIXES) — fixes applied 2026-05-29; ready for planning
**Related:** `2026-05-15-lighthouse-pagespeed-provider-design.md`, `2026-05-20-detached-psi-pipeline-design.md`, `2026-05-29-independent-a11y-check-design.md` (sibling feature)

## Goal

Stop presenting the Google PageSpeed Insights (PSI) accessibility section as if it were a co-equal, competing accessibility result alongside our primary axe-core scan. Instead:

1. **Hide PSI a11y findings that duplicate** a violation our primary axe scan already reported (exact rule-ID match).
2. **Loudly surface PSI a11y findings that axe did *not* report** ("PSI-only" findings), each carrying a disclaimer that it may be an artifact of a different rendered DOM and must be verified.
3. **Completely hide the Lighthouse "Best practices" accessibility group** (`a11y-best-practices`) from the PSI accessibility section — those are not WCAG A/AA conformance failures.

The compliance score is unaffected: it already derives solely from axe violations (`lib/ada-audit/scoring.ts`).

## Why now — verified evidence

A real audit (`cmpr6n2v00118gknzo22ny1ug`, `https://www.molloy.edu/certificates/program/online-marketing-certified-associate-omca-test-prep/`) exhibited the problem and was investigated to root cause:

- **axe (primary):** 0 violations, `domElementCount = 826` — a fully rendered, clean page.
- **PSI (stored):** accessibility score 50, three "failures" — `document-title` (no `<title>`), `html-has-lang` (no `[lang]`), `landmark-one-main` (no `<main>`) — **every failing element snippet was a bare `<html>`**, and performance scored a suspicious 100.
- **PSI (fresh, keyed, from the server):** accessibility **0.98**; `document-title` and `html-has-lang` now **PASS**; main document **200 OK, 137 requests, 112 KB**. Only `landmark-one-main` still flags — and that audit lives in the `a11y-best-practices` group and is an axe **best-practice** rule (not WCAG), which is exactly why our WCAG-scoped axe run never reported it.

Conclusion: the stored PSI failures were **PSI evaluating a near-empty/blocked document on that fetch** (a transient, different DOM than the page real users — and our own Chrome — see). axe was correct; PSI was wrong. This is not an isolated incident: PSI runs from Google's data-center IPs against a cold profile, and education-sector sites (our client base, facing WCAG 2.1 AA enforcement under the DOJ Title II rule) frequently sit behind WAF/CDN bot mitigation that intermittently serves Google a challenge or empty shell.

The deeper structural fact: **Lighthouse's accessibility category is itself powered by axe-core.** PSI a11y is therefore *the same engine family* as our primary tool, run against a less-representative DOM. (Softened per Codex: PSI/Lighthouse may run a different axe **version/config** than our bundled axe-core, so an exact rule-ID match means "same rule family," not guaranteed identical evidence. The honest claim is: **PSI a11y is not independent evidence — treat any divergence as a render/version artifact until verified**, rather than asserting it can *never* surface a true finding.) So it must not be presented as an independent corroborating or competing check. (A genuinely independent engine is the sibling feature, `2026-05-29-independent-a11y-check-design.md`.)

## Key enabler: PSI a11y audit IDs *are* axe rule IDs

Because Lighthouse wraps axe rules 1:1 for its accessibility category, each PSI a11y audit `id` (`color-contrast`, `image-alt`, `link-name`, `aria-valid-attr-value`, `document-title`, `html-has-lang`, …) is **identical** to the corresponding axe violation `id` we already store. Deduplication is therefore an **exact set-membership test**, not a fuzzy heuristic:

```
psiOnly   = psiA11yAudits.filter(a => !axeViolationIds.has(a.id))
duplicate = psiA11yAudits.filter(a =>  axeViolationIds.has(a.id))
```

## Architecture & data flow

**One shared pure helper, three call sites.** (Revised per Codex — the original two-layer split couldn't serve the sibling spec's server-side auto-trigger, and filtering only at extraction left old stored summaries unfiltered.)

### The shared helper

```ts
// lib/ada-audit/psi-a11y-split.ts  (pure, no prisma, no React)
export function splitPsiAccessibility(
  summary: LighthouseSummary | null,
  axeViolationIds: Set<string>,
): {
  psiOnly: LighthouseA11yAudit[]      // surfaced with disclaimer
  duplicates: LighthouseA11yAudit[]   // hidden (already covered by primary axe scan)
  hiddenBestPractice: LighthouseA11yAudit[] // dropped: a11y-best-practices group
}
```

It normalizes the summary (drops the best-practices group), then partitions remaining a11y audits by exact rule-ID membership in `axeViolationIds`. Pure and trivially unit-testable. Used by all three call sites below, so the "what counts as PSI-only" logic exists exactly once:

1. **Render — single-page & site-audit result views.** `components/ada-audit/LighthouseSection.tsx` / `AuditResultsView.tsx` compute `axeViolationIds = new Set(results.violations.map(v => v.id))` and call the helper. **This is the path that fixes old stored summaries** — the filter/split runs at render regardless of when the summary was stored, so no backfill/migration is needed. Render stays side-effect-free.
2. **Extraction (optional optimization).** `extractAccessibility()` may still drop the best-practices group when building new summaries, but it is no longer the *only* place filtering happens — the render path is authoritative for old rows.
3. **Server-side auto-trigger (sibling spec).** The PSI worker, after writing a summary, reads the row's stored axe result, calls the **same helper**, and enqueues an independent check only if `psiOnly` is non-empty. (Detail lives in `2026-05-29-independent-a11y-check-design.md`; the shared helper is what makes render and server agree on "PSI-only" by construction.)

### Best-practices filtering: blocklist, not allowlist

Per Codex: filter by **group-id blocklist** (`a11y-best-practices`), *not* a WCAG-group allowlist. Blocklisting one known non-conformance group is safer than an allowlist that would silently drop a future WCAG group Lighthouse introduces. (Confirm the exact group id against a live LHR during planning — Lighthouse has historically used `a11y-best-practices`.) Note the existing `extractAccessibility` already silently skips groups missing from `categoryGroups`; do not compound that with a broad allowlist.

### The PSI accessibility score card

Codex flagged a contradiction: even with findings deduped/hidden, the Lighthouse **score grid still shows an `Accessibility` score** (e.g. 50 in the Molloy case) as a peer number — which re-introduces exactly the "competing result" impression this spec removes. Worse, that raw score reflects audits we now hide, so it won't match the visible findings. Resolution (planning to pick the exact UI):

- **Remove or demote** the PSI `Accessibility` score card from the Lighthouse score grid, OR
- **Relabel** it explicitly as "PSI a11y signal — not a compliance score" with a tooltip pointing to the primary axe result.

Leaning **remove from the primary grid** (keep performance + best-practices perf score, which are PSI's legitimate contribution). Decision recorded for the plan.

### Disclaimer copy (draft)

> ⚠️ **Flagged by Google PageSpeed Insights, not by our primary scan.** PSI renders the page from Google's own servers (different region, fresh session, desktop viewport) and is occasionally served a different or incompletely-loaded page. This may not reflect what your visitors experience — **verify on the live page before reporting.**

One disclaimer is sufficient (per Codex) now that the best-practices group is hidden — no need to distinguish transient-DOM vs scope cases in copy.

### Wire shape

No new DB columns. The split is computed from data already on the row (`lighthouseSummary.accessibility` + `result.violations`). `useMemo` the `Set` for cleanliness only — no meaningful render-time perf cost.

### Tests (required by review)

Unit-test the helper and render for: duplicate hiding, PSI-only surfacing, best-practices filtering on an **old stored summary**, empty-section collapse (all audits deduped/filtered), and the both-sides-missing guards below.

## Non-goals (out of scope)

- **Changing the compliance score / `compliant` flag.** Already axe-only; untouched.
- **Removing PSI performance / CWV.** Out of scope here.
- **Switching PSI from lab CWV to CrUX field data** (`loadingExperience` / `originLoadingExperience`). This is a worthwhile, genuinely-additive follow-on (PSI returns it free and we currently ignore it), but it is a separate concern from the a11y reframe. Tracked as a future spec, not built here.
- **Removing PSI entirely.** Not now; the perf/CWV "handy reference" use justifies keeping the integration.
- **Cache-busting PSI requests.** The Molloy case showed the bad fetch was transient and a fresh fetch recovered; a cache-bust is a possible separate reliability tweak, not part of this UX reframe.

## Edge cases

- **PSI a11y audit with no matching axe rule.** A small number of Lighthouse a11y audits are Lighthouse-specific, not axe rules. After best-practices filtering, any such audit lands in "PSI-only" and is surfaced with the disclaimer — acceptable (it's exactly the "verify this" bucket).
- **Manual / N/A audits.** Already dropped in `extractAccessibility` (score null) — unchanged.
- **Empty PSI-only set.** Render nothing / collapse the PSI a11y section entirely (common case once duplicates and best-practices are removed).
- **Either side missing — guard both independently** (Codex: do *not* assume "no axe result ⇒ no PSI summary"). A row can have a PSI summary but no parsed axe result (or vice versa). If axe result is missing, treat `axeViolationIds` as empty (everything PSI flags becomes "PSI-only" with the disclaimer — acceptable). If `lighthouseSummary.accessibility` is absent (old rows; the field is already optional), render nothing.

## Resolved by Codex review (2026-05-29)

1. **Blocklist `a11y-best-practices`** — not a WCAG-group allowlist (avoids silently dropping a future WCAG group).
2. **Hide duplicates from the main UI.** Optionally show a small diagnostic count ("N PSI audits suppressed as already covered by primary scan"), but avoid "also found by Lighthouse" language (it's the same engine — not corroboration).
3. **One disclaimer is enough** once best-practices is hidden.
4. **No meaningful render-time perf risk** from the `Set`; `useMemo` for cleanliness only.

Additional named fixes applied above: shared `splitPsiAccessibility` helper across render + server-trigger; old stored summaries normalized at render; remove/demote the PSI accessibility score card; both-sides-missing guards; required tests; softened the "same engine" absolute claim.
