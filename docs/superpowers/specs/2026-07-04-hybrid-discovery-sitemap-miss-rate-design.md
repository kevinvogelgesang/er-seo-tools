# Hybrid Discovery — Increment 1: Sitemap Miss-Rate Measurement

**Date:** 2026-07-04
**Status:** Spec (active). Codex-reviewed 2026-07-04 (accept-with-fixes ×7, all applied).
**Campaign:** Screaming-Frog retirement, roadmap Phase 2 ("Hybrid discovery: sitemap + capped BFS").
**Roadmap doc:** `docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md` §2 Phase 2, §5 (the gate).
**Tracker item:** C6.

---

## 1. Why this exists (the gate)

The SF-retirement roadmap sequences hybrid discovery **last** and gates it on a
number that has never been measured. §5, verbatim:

> **Build the crawler only if measurement shows our clients' sitemaps routinely
> miss important pages.** Until then, deferring Phase 2 explicitly means: **do
> not retire SF for discovery.**

The gate criterion (§4) is: *"Sitemap/discovery coverage exceeds a defined
threshold (e.g. 90–95% of known pages) … surfaced per run."* We cannot decide
whether to build a full BFS crawler until we know, per client, how many
reachable same-domain pages the sitemap omits.

This increment produces that number — **measurement-first** — without building
the crawler and without changing which pages get audited. If the measured
miss-rate is low across clients, Phase 2 is correctly *deferred* (SF stays the
discovery instrument, as the roadmap prefers). If it is high, that evidence
justifies building the full multi-hop crawler as **Increment 2**.

## 2. The key insight — the signal is already harvested

During an ADA site audit, `runAxeAudit` harvests **every `<a href>`** from every
audited page (`lib/ada-audit/link-harvest.ts:79`, called at
`lib/ada-audit/runner.ts:380`) into the transient `HarvestedLink` table after a
successful page settle (`lib/jobs/handlers/site-audit-page.ts:300`). Same-domain
targets are classified `kind: 'internal-link'` (`link-harvest.ts:61-63`;
same-domain = exact host, www-insensitive; subdomains are external by design).

The post-terminal builder (`lib/jobs/handlers/broken-link-verify.ts`) already
loads these rows (`:114-119`) and computes a link graph, but
`computeLinkGraph` **discards every link whose target is not in the audited
set** (`lib/ada-audit/seo/link-graph.ts:20` — `if (!audited.has(t)) continue`).

**Those discarded internal-link targets are candidate off-baseline
same-domain URLs — observed one hop out from the audited set.** They are linked
by an internal `<a href>` from a page we did audit, yet absent from the
discovered/sitemap baseline. The miss-rate signal is sitting in data we already
pay to collect and today throw away. Extracting it costs **zero new fetches**.

**Honesty caveat (Codex fix #1, #5).** Two precise statements to keep the number
defensible:
- The graph's discard at `link-graph.ts:20` keys off the **audited SEO-row set**
  (pages that produced a `HarvestedPageSeo` row), not the `discoveredUrls`
  baseline. A discovered URL that failed/redirected and produced no SEO row is
  also dropped by the graph — so the graph's discard is *not* identical to our
  metric. Our metric computes `L \ B` against **`discoveredUrls` directly**
  (§4), independent of the graph; the graph is only the *motivation*, not the
  source of the number.
- `internal-link` is every same-domain `<a href>` (`link-harvest.ts`), so `L`
  can include PDFs, downloads, faceted/search/logout URLs, and broken targets —
  not guaranteed *pages*. The honest headline label is therefore **"same-domain
  linked URLs absent from the sitemap,"** not "reachable pages." §4 excludes
  obvious non-page file extensions to approximate pages; anything finer (e.g.
  reusing verifier broken/redirect outcomes) is deferred to Increment 2 and
  called out in the UI copy.

**Scope boundary (decision, locked in brainstorming):** this increment measures
**depth-1** only — targets linked *from* audited pages. Pages two or more hops
off the sitemap are out of scope; catching them requires the full BFS crawler
(Increment 2). Rationale: if depth-1 already shows clean sitemaps, that is a
strong signal; if depth-1 shows large gaps, that alone justifies the crawler.

## 3. Where it lives

Extend the existing post-terminal builder
`lib/jobs/handlers/broken-link-verify.ts` — the **single writer** of the
live-scan `CrawlRun` (do not add a second job or a second writer; the builder
owns delete-and-recreate on `{siteAuditId, tool}`). It already:

- runs post-terminal (enqueued last in `finalizeSiteAudit`,
  `lib/ada-audit/site-audit-finalizer.ts:136`),
- loads `HarvestedLink` internal rows (`:114-119`),
- owns one `runId` and writes the run via `writeFindingsRun` (`:404`),
- deletes the transient tables afterward (`:405-406`).

The only new read it needs is the `SiteAudit.discoveredUrls` JSON array
(`prisma/schema.prisma:141`) — the discovered/sitemap page set — which it does
not read today.

This placement respects the crash-safety landmine the code map flagged:
discovery fixes `pagesTotal` **before** any page is fetched, and the finalizer's
drain predicate keys off it (`site-audit-finalizer.ts:48-52`). Anything that
*grew* the audited set would break that invariant. This increment reads
post-terminal and changes **nothing** about the audited set — it is pure
measurement.

## 4. Computation (pure function)

New pure function, unit-testable in isolation (proposed
`lib/ada-audit/seo/discovery-coverage.ts`). Per Codex fix #4 it takes **link
rows, not bare target strings**, so it can build source-attributed samples and
dedupe deterministically:

```
computeDiscoveryCoverage({
  discoveredUrls: string[],                          // SiteAudit.discoveredUrls (parsed)
  internalLinks: { sourcePageUrl, targetUrl }[],     // HarvestedLink rows where kind='internal-link'
  discoveryMode: DiscoveryMode,                      // see §6
  discoveryCapped: boolean,                          // sitemap hit the 1000 HARD_CAP — see §6
}): DiscoveryCoverage
```

Algorithm:

1. **Coverage normalizer (Codex fix #2).** `normalizeFindingUrl`
   (`lib/findings/normalize-url.ts`) only drops the fragment and strips the
   trailing slash on a *bare root* — it does **not** strip tracking params or
   normalize non-root trailing slashes/case. Meanwhile `discoverPages` dedupes
   with UTM params removed but **returns the original URL** (UTM intact,
   `sitemap-crawler.ts:146`). So a sitemap URL carrying `?utm_*` and a clean
   harvested link to the same page would fail to match under `normalizeFindingUrl`
   alone → false "missed" entries. Introduce a **coverage-specific normalizer**
   (built on `normalizeFindingUrl`, additionally: strip the five UTM params
   `discoverPages` strips, and strip a trailing slash on non-root paths) applied
   **identically to both `B` and `L`**. This parity is the single biggest
   correctness risk; it gets its own unit tests (§10). Do not silently reuse
   `normalizeFindingUrl` for this — it is insufficient here.
2. `B` = set of coverage-normalized `discoveredUrls`.
3. `L` = set of coverage-normalized `internalLinks[].targetUrl`. Only
   `kind='internal-link'` rows are passed in (images excluded — an `<img src>`
   is not a page). Additionally **exclude obvious non-page file extensions**
   (`.pdf`, `.zip`, `.jpg`, `.png`, `.gif`, `.svg`, `.doc(x)`, `.xls(x)`,
   `.mp4`, `.css`, `.js`, … — a small documented deny-list) so `L` approximates
   pages, not assets (Codex fix #5).
4. `O = L \ B` — same-domain linked URLs absent from the discovered baseline.
5. Metrics:
   - `discoveredCount = |B|`
   - `linkedInternalCount = |L|`
   - `offBaselineCount = |O|`
   - `missRate = |O| / (|B| + |O|)` — "of all same-domain URLs we know about
     (baseline ∪ off-baseline-linked), the fraction absent from the baseline."
     Bounded [0,1], intuitive. *(Codex confirmed this over `|O|/|B|`, which can
     exceed 1.)*
   - `sample` = up to `SAMPLE_CAP` (proposed 50) entries from `O`,
     deterministically ordered (sorted by target), each `{ targetUrl,
     sourcePageUrls }` where `sourcePageUrls` is a small per-target cap (proposed
     ≤5) of the audited pages that linked to it (Codex fix #4/#5 — free from
     `HarvestedLink.sourcePageUrl`, distinguishes real missed pages from
     footer/nav artifacts).

The function is total: empty `discoveredUrls` or empty harvest yields
well-defined zero/empty output, never a throw.

## 5. Persistence — NOT a Finding

**This must not be emitted as a `Finding`.** A `Finding` flows into
`priority.service.calculatePriorityScore`, which scores by type-weight ×
count-scale where the **count-0 scale defaults to 1.0** — so even a zero-count
finding is non-inert and inflates the roadmap/open-issue surfaces. This is the
exact landmine that killed the zero-count `broken_external_links` finding
(2026-07-04). A discovery-coverage measurement is *not* an analyst action item;
it must never touch priority scoring.

Instead, store it as run metadata on the live-scan `CrawlRun`:

- **Recommended:** one new nullable column `discoveryCoverageJson String?` on
  `CrawlRun`, holding the full `DiscoveryCoverage` object (mode, counts,
  missRate, capped sample). This mirrors the established
  `CrawlRun.scoreBreakdown String?` JSON-detail pattern
  (`prisma/schema.prisma:364`). Additive, SQLite-safe (no `ALTER COLUMN`
  nullability change), one migration. The cross-run aggregation the gate needs
  (~5 clients × 2–3 cycles ≈ 15 runs) is trivial to compute in JS after loading
  the JSON.
- *(Codex confirmed JSON column over scalar columns: the sample + metadata are
  JSON-shaped regardless and the aggregation volume is tiny.)*

**Writer plumbing (Codex fix #6).** The column is written through the existing
findings writer, not a side write. Add an optional field to `CrawlRunInput` in
`lib/findings/types.ts` (e.g. `discoveryCoverageJson?: string`) so
`lib/findings/writer.ts` spreads it into the `crawlRun.create` call in the same
array-form transaction that writes the run. The builder serializes the
`DiscoveryCoverage` object and passes it on the `CrawlRunInput` for the
live-scan bundle only; `sf-upload` and `ada-audit` runs leave it null.

## 6. Discovery mode — making the number trustworthy

`discoveredUrls` conflates three origins and today records no provenance
(`discoverPages` returns a bare `string[]`, `sitemap-crawler.ts:236`):

1. **sitemap** — a real sitemap (robots `Sitemap:` / `/sitemap.xml` / index /
   `.gz`) yielded the pages.
2. **shallow-crawl** — no sitemap found; `discoverPages` fell back to a
   homepage link crawl (`sitemap-crawler.ts:281-289`).
3. **pre-discovered** — URLs stored at audit-creation time; `discoverPages`
   never ran (`site-audit-discover.ts:106-107`).

A "sitemap miss-rate" is only meaningful in mode 1. In mode 2 the baseline `B`
*is itself* a link crawl, so `O` would be near-empty or meaningless; in mode 3
we don't know the origin. Reporting an undifferentiated miss-rate would mislead.

**Recommended (Codex confirmed):** thread discovery provenance through so the
measurement can be gated/labeled. An untrusted number (fallback-mode audits
showing a fake "miss rate") defeats the entire measurement-first purpose.

- Change `discoverPages` to return `{ urls: string[]; mode: 'sitemap' |
  'shallow-crawl'; capped: boolean }` (it already knows internally which branch
  produced the list — `sitemap-crawler.ts:274` vs `:288` — and whether the
  1000-page `HARD_CAP` `.slice` bit at `:294`).
- **`capped` provenance (Codex fix #3).** If the sitemap exceeded the 1000
  `HARD_CAP`, links to page 1001+ would look "missed" even though the sitemap
  *did* list them. Persist `capped` so the measurement is marked
  **low-confidence / partial** and the UI suppresses the headline miss-rate when
  the baseline was truncated. Without this, large-sitemap clients produce
  systematically inflated miss-rates — a decision-biasing bug.
- `site-audit-discover.ts` persists `mode` + `capped` onto new nullable
  `SiteAudit` columns (`discoveryMode String?`, `discoveryCapped Boolean?`).
- **Cover ALL discovery entry paths (Codex fix #7).** `discoverPages` runs only
  on the job-handler path. Pre-discovered audits skip it — URLs supplied via
  `enqueueAudit(opts.preDiscoveredUrls)` and the `/api/site-audit/discover`
  route. Those must record `discoveryMode: 'pre-discovered'` (and
  `capped: false`/unknown) at creation time so the builder never mistakes a
  pre-seeded baseline for a sitemap one. The plan must enumerate every writer of
  `discoveredUrls` and set mode at each.
- The builder reads `SiteAudit.discoveryMode` + `discoveryCapped`, stores them
  in the coverage JSON. The UI computes a headline miss-rate **only for mode
  `sitemap` ∧ `capped === false`**; other modes still store raw counts but
  render "coverage measurement not applicable (no sitemap / baseline
  truncated)".

## 7. Surfacing

A new **sibling** component `components/site-audit/DiscoveryCoverageSection.tsx`
beside `OnPageSeoSection`, fed by the same live-scan-run query (Codex fix #4 —
this is *not* an on-page SEO finding; keeping it separate avoids bloating
`OnPageSeoSection` and matches how `BrokenLinksSection` is its own block).

States:

- **Measured (mode `sitemap` ∧ not `capped`):** *"Sitemap listed X same-domain
  URLs. N additional same-domain URLs were linked from audited pages but absent
  from the sitemap (Y% off-sitemap)."* Expandable sample list of the (capped)
  missed URLs, each showing a few source pages that linked to it. Copy says
  "URLs," not "pages" (§2 honesty caveat).
- **Not applicable (mode `shallow-crawl` / `pre-discovered`, or `capped`):**
  *"Discovery coverage not measured (no sitemap was used, or the sitemap
  exceeded the 1000-URL cap)."*
- **Clean (mode `sitemap`, `offBaselineCount === 0`):** *"No off-sitemap URLs
  found — every internally-linked URL was in the sitemap."*
- **Absent (runs predating this increment / null column):** render nothing.

Dark-mode variants required on every element (Tailwind `dark:` per the
app-wide mapping). No hydration-mismatch patterns.

## 8. Explicit non-goals

- **No change to the audited page set.** Measurement only; the crash-safety
  `pagesTotal`-before-fetch invariant is untouched.
- **No new fetches.** Everything derives from already-harvested `HarvestedLink`
  rows. No BFS, no target verification, no robots fetch.
- **No multi-hop BFS** (depth-2+ off-sitemap) — that is Increment 2.
- **No robots `Disallow` enforcement** — not built today; not needed for a
  read-time diff of already-collected data.
- **No per-URL source tagging in the audited set / no feeding discovered pages
  into audits** — Increment 2, gated on this measurement.
- **No `Finding` emission** — measurement, not action item (§5).
- **No subdomain widening** — `internal-link` stays exact-host www-insensitive
  (campaign fence).

## 9. Correctness risks (must be nailed in the plan)

| Risk | Mitigation |
|---|---|
| **Normalization mismatch** between `B` and `L` (UTM params, non-root trailing slash) inflates `O` with false variants | Dedicated **coverage normalizer** (§4 step 1) applied identically to both sets — strips UTM + non-root trailing slash beyond what `normalizeFindingUrl` does; own unit tests |
| Sitemap >1000 pages: page 1001+ links look "missed" | `discoveryCapped` provenance (§6); headline suppressed when `capped` |
| `internal-link` includes PDFs/assets/faceted/logout URLs — not pages | Non-page file-extension deny-list in `L` (§4 step 3); label "URLs" not "pages" |
| Broken same-domain links counted as "missed pages" | v1 counts them as off-baseline URLs (honest label); reusing verifier broken/redirect outcomes to exclude them is an explicit Increment-2 follow-up (noted in UI copy) |
| Shallow-crawl / pre-discovered audits report a misleading miss-rate | `discoveryMode` gating across **all** `discoveredUrls` writers (§6); UI "not applicable" |
| Canary (proway.erstaging.site) is noindex with few links → near-empty measurement | Expected/correct; not a bug. Measurement is inert until a real client audit |
| Builder 15-min timeout | No added fetches → negligible CPU; a set-diff over ≤ a few thousand strings is microseconds |
| `partial` run status semantics | This measurement never sets `partial`; it is orthogonal to the existing internal/external verify caps |
| Second-writer clobber of the live-scan run | The measurement rides *inside* the existing single builder; no new job |

## 10. Testing

- **Pure function** `computeDiscoveryCoverage`: empty inputs; **coverage-
  normalizer parity** (UTM params, non-root trailing slash, case, fragment all
  collapse to no-miss — the highest-value tests); non-page extension exclusion;
  image exclusion; `missRate` math; source-attributed sample cap + per-target
  source cap + deterministic ordering; mode + capped gating.
- **Builder integration** (DB-backed): a SiteAudit + `HarvestedLink` rows with
  some off-baseline targets → live-scan run's `discoveryCoverageJson` populated
  with expected counts + source-attributed sample; `sf-upload`/`ada-audit` runs
  untouched; no `Finding` of any new type created.
- **Migration**: additive nullable columns apply cleanly; existing rows read
  null.
- **UI render** (jsdom): measured / not-applicable (no-sitemap + capped) / clean
  / absent states; source pages shown in sample; dark-mode classes present.
- **`discoverPages` return shape**: sitemap path → `mode:'sitemap'`; fallback →
  `mode:'shallow-crawl'`; >1000 sitemap → `capped:true`; all existing callers
  updated for the new `{ urls, mode, capped }` shape.
- **Mode at every writer**: job-handler discovery, `enqueueAudit`
  pre-discovered, and `/api/site-audit/discover` each set the correct
  `discoveryMode`.

## 11. Migration

Additive only. New nullable columns: `CrawlRun.discoveryCoverageJson String?`,
`SiteAudit.discoveryMode String?`, `SiteAudit.discoveryCapped Boolean?`. No
`ALTER COLUMN` nullability change, no data backfill (historical runs stay null —
never backfill blobs/findings per the house rule). `migrate dev` is
interactive-only in this environment; author the migration SQL by hand and apply
with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … generate`.
Prod applies it automatically during `~/deploy.sh`. Also add the optional
`discoveryCoverageJson?` field to `CrawlRunInput` (`lib/findings/types.ts`) and
spread it in `lib/findings/writer.ts` (Codex fix #6).

## 12. Design questions — resolved (Codex review 2026-07-04)

All five resolved; fixes folded into the sections above.

1. **`missRate` denominator** → `|O|/(|B|+|O|)` (bounded, intuitive). `|O|/|B|`
   rejected (can exceed 100%).
2. **Storage** → single `CrawlRun.discoveryCoverageJson` column; plus
   `CrawlRunInput`/`writer.ts` plumbing (fix #6).
3. **`discoveryMode`** → record it, via `discoverPages` returning
   `{ urls, mode, capped }` + `SiteAudit.discoveryMode`/`discoveryCapped`
   columns, set at **every** `discoveredUrls` writer (fixes #3, #7).
4. **UI** → new sibling `DiscoveryCoverageSection`, not folded into
   `OnPageSeoSection` (fix #4).
5. **Source pages in sample** → yes; sample entries are
   `{ targetUrl, sourcePageUrls }` (fixes #4, #5).

Additional Codex fixes folded in: honest "linked URLs" (not "pages") labeling +
graph-discard-vs-baseline clarification (§2, fixes #1/#5); coverage-specific
normalizer for UTM + non-root trailing slash (§4, fix #2); non-page
file-extension exclusion (§4, fix #5); sitemap-cap low-confidence provenance
(§6, fix #3).
