# FUTURE — D3 robots-validator "URLs" glance count is misleading for sitemap indexes

**Status:** logged, not scheduled. Small self-contained UI/labeling fix, independent of any active lane.
**Written:** 2026-07-20, at Kevin's request ("log it, fix later" — the "D3 page-count glance" open question).
**Owner:** none yet. Not gated on anything; pick up any time.

---

## The problem

On the **robots-validator page** (`app/(app)/robots-validator/page.tsx:~681`) the big stat tile
renders `result.urlCount` under the bare label **"URLs"**. But `parseSitemapXml`
(`lib/seo-fetch/sitemap-parse.ts:86-87`) computes `urlCount` as **every `<loc>` in the
document**. For a **sitemap *index* file**, those `<loc>`s are **child sitemaps, not pages** —
so a 40,000-page site behind a 12-child index displays **"12 URLs"** next to a Type tile that
correctly says "Index." The clarification exists only as a buried info issue
(`sitemap-parse.ts:~153`, "pointing to N child sitemap(s)"), not in the glance number.

### Secondary: the same word means two different things across D3/D4

The client-side monitor card (`components/clients/RobotsCheckCard.tsx`) shows a "sitemap URLs"
glance that is **pages after one-level index expansion** (`collectSitemapPageUrls` →
`extractPageLocs`, `lib/seo-fetch/fetch.ts`), whereas the validator's "URLs" is
**raw `<loc>` count** (= child sitemaps for an index). So "Open in Validator" from the card
can show a different "URLs" number than the card for the same domain. Expected given the two
code paths, but a real source of "the page count looks wrong."

### Tertiary: un-flagged undercounts on the card

`RobotsCheckCard`'s `truncated` caveat (`:~248`) fires only on
`timeBudgetExhausted || sitemapsSkipped>0 || childrenSkipped>0`. It does **not** fire for:
- `childrenExcluded > 0` (cross-host children dropped), or
- the **nested-index-yields-zero** case (a child that is itself an index contributes 0 pages —
  one-level expansion only, `fetch.ts:~178`).

Those undercounts render with no warning.

## Suggested fix (when picked up)

1. **Validator tile (highest value):** when `isSitemapIndex(result)`, label the tile
   **"Child sitemaps"** (or show both "N child sitemaps → M pages" if we expand), instead of
   "URLs". Purely presentational — no parser change needed for the primary fix.
2. **Card caveat:** widen the `truncated` condition to also cover `childrenExcluded > 0` and
   surface the one-level-expansion limitation when a child index is detected.
3. Consider a shared helper so the validator and the card describe the same domain's counts
   consistently (or at minimum a tooltip explaining why they differ).

## Scope / risk

- Frontend + label copy; no schema change, no migration, no job change.
- `parseSitemapXml` / `collectSitemapPageUrls` semantics are load-bearing elsewhere — prefer
  fixing the **presentation** (labels, caveat conditions) over redefining `urlCount`.
- Standard gate set applies (tsc + vitest + build). No prod-data dependency to reproduce —
  point the validator at any sitemap-index URL.

## Provenance

Reconstructed 2026-07-20 from an Explore pass over `lib/seo-fetch/` + `components/clients/RobotsCheckCard.tsx`
+ `app/(app)/robots-validator/page.tsx`. See D3 layer notes in `CLAUDE.md` (`lib/seo-fetch/`).
