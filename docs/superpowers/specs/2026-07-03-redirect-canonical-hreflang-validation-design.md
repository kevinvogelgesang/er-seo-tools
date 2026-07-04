# C6 Phase 4 — Redirect / Canonical / Hreflang Validation (design)

**Date:** 2026-07-03 · **Status:** Spec (active) · **Track:** C6 (live SEO / SF-retirement), roadmap Phase 4
**Related:** `nyi/2026-06-04-screaming-frog-retirement-roadmap.md` §2 Phase 4, §5 ·
`archive/specs/2026-06-16-broken-link-verifier-design.md` (Phase 1) ·
`archive/specs/2026-06-16-live-seo-onpage-extraction-design.md` (Phase 2) ·
`archive/specs/2026-06-17-live-seo-score-design.md` (Phase 3)

---

## 1. Goal & scope

Add **technical-SEO validation** to the live scan: for every audited page, validate its
declared canonical URL, resolve its internal-link redirect behavior, and validate its
hreflang alternates (target reachability + return-link reciprocity + code hygiene). This
is the roadmap's "one shared URL-resolver service used by canonical, hreflang,
redirect-chain checks" (Phase 4), and it advances SF retirement by covering
technical-SEO parity beyond tag extraction.

**In scope (Full Phase 4):**
- A shared `resolveUrl()` service that exposes the **final URL + full redirect chain +
  final status** that `safeFetch` already computes but `checkUrl` discards.
- Canonical target validation (broken / redirected).
- Internal-link redirect-chain + redirect-loop findings.
- Hreflang **target** validation — requires harvesting hreflang **hrefs** (not just lang
  codes) via a change to the `.toString()`-injected `parseSeoFromDocument`.
- Hreflang reciprocity (in-set), self-reference, x-default, and lang-code hygiene.
- A new `TechnicalSeoSection` results-page component.

**Out of scope (explicit):**
- **Cross-domain *initial* targets are not fetched.** A canonical/hreflang/link target whose
  **initial host** is a different registrable domain (www-insensitive) is recorded and surfaced
  as "not verified (external)" but never fetched (change-control rule 3 + WAF-ban safety;
  matches Phase 1's same-domain-only selection). The multi-ccTLD hreflang target-status case
  stays a documented gap.
  - **IMPORTANT nuance (Codex fix #2):** `safeFetch` follows redirects *across hosts*
    (SSRF-checked per hop, but not same-domain-enforced). So a **same-domain** target that
    `301`s to an external host **is followed off-site** — this is **existing Phase 1
    behavior** (`checkUrl` already does it), not something this increment adds. We do not add
    an allowed-host redirect policy (that would no longer be a thin wrapper over `safeFetch`
    and would change broken-link behavior). Documented here + in §12 rather than "fixed."
- **External HTML parsing** for cross-domain reciprocity. Reciprocity is checked **only
  when both pages are in the harvested set** (in-memory, cheap).
- `canonical_missing` / `canonical_non_self` findings (too noisy for MVP; considered and cut).
- Sitemap-hygiene checks (a later Phase-4 sub-item; not this increment).
- Any schema migration — see §9.

## 2. Grounding facts (verified in code, 2026-07-03)

- `lib/security/safe-url.ts` `safeFetch()` follows redirects **manually** (`redirect:
  'manual'`, `MAX_REDIRECTS=5`) and returns `{ response, url /* final */, redirects:
  string[] }`. It throws `SafeUrlError('Too many redirects')` on overflow. It is
  SSRF-guarded and works cross-domain (no same-domain restriction of its own).
- `lib/ada-audit/broken-link-check.ts` `checkUrl()` calls `safeFetch` HEAD→GET but returns
  only `'ok'|'broken'|'unconfirmed'` — it **discards** `url` and `redirects`. `HostThrottle`
  provides per-host spacing.
- `HarvestedPageSeo` (transient, `prisma/schema.prisma:403`) already persists
  `canonicalUrl String?` and `detailsJson String?` documented as
  `{ schemaTypes: string[], hreflang: string[] }`. The current `broken-link-verify` select
  reads **neither** `canonicalUrl` nor `detailsJson` — hreflang is persisted but unused.
- `lib/ada-audit/seo/parse-seo-dom.ts` `parseSeoFromDocument` extracts hreflang as **lang
  codes only** (`.map(l => l.getAttribute('hreflang'))`), not hrefs. It is injected into the
  audited page via `.toString()` and **must be SWC-helper-free** (2026-06-16 `typeof`→
  `_type_of` in-page `ReferenceError`, fix `cc8d1c1`).
- `lib/jobs/handlers/broken-link-verify.ts` is the single live-scan run builder: reads both
  transient tables, owns one `runId` + shared `ensurePage`, emits on-page + broken-link
  findings into one `CrawlRun` (`source:'live-scan'`, `tool:'seo-parser'`), then deletes both
  transient tables. Recovery (`recoverBrokenLinkVerifies`) re-enqueues on `HarvestedLink` OR
  `HarvestedPageSeo` presence — unchanged by this work.
- `HarvestedLink` records `external-link` rows (`classifyTargets`) but the verifier only reads
  `kind: { in: ['internal-link','image'] }`. Same-domain = exact-host, www-insensitive
  (`link-harvest.ts` `sameDomain`).
- `FindingInput` (`lib/findings/types.ts`): `scope: 'run'|'page'`, `severity:
  critical|warning|notice`, `type`/`affectedSource` are free strings (no schema change to add
  new values). `CrawlPageInput.finalUrl` exists and is currently always `null` on live-scan.

## 3. Architecture & data flow

Extends the existing `broken-link-verify` builder. No new job, no new durable surface, no
migration.

```
finalizeSiteAudit reaches terminal 'complete'
  → enqueueBrokenLinkVerify (unchanged, fired LAST)
  → runBrokenLinkVerify:
      1. Read HarvestedLink (link/image targets)  — existing
         Read HarvestedPageSeo — ADD canonicalUrl + detailsJson to the select
      2. Parse detailsJson → { schemaTypes, hreflang: {lang,href}[] } (tolerate legacy shape)
      3. Build ONE dedup'd SAME-DOMAIN resolution set, ORDERED legacy-first (§8):
           [1] internal-link/image targets  (existing broken-link set, current sort)
           [2] then canonical/hreflang-ONLY targets not already in [1]
         Canonical/hreflang hrefs are resolved relative to their declaring page URL
         (normalizeLinkTarget) BEFORE same-domain classification (§7).
         Cross-domain (initial-host) targets: excluded from resolution, counted for the
         *_external_unverified run-scope notices (§6).
      4. resolveUrl() each unique same-domain URL ONCE, shared HostThrottle + CONCURRENCY
         workers + shared MAX_CHECKS cap (deterministic order → stable cap).
           → cache: Map<normUrl, ResolveResult>
      5. Derive findings from the cache (pure mappers):
           broken_internal_links / broken_images  (existing — now read cache)
           canonical_*    (validation-mapper)
           redirect_*     (validation-mapper)
           hreflang_*     (validation-mapper)
      6. One live-scan CrawlRun written via writeFindingsRun (as today);
         scoreLiveSeo path unchanged (validation findings do NOT enter the score in MVP).
      7. Delete both transient tables (as today).
```

**Why fold in (not a new job):** the verifier already resolves the internal-link set;
canonical/hreflang targets heavily overlap it; a shared dedup'd cache resolves each unique
URL once (no double-fetch), shares the throttle/cap/concurrency, and keeps all findings in
one `CrawlRun` — consistent with the Phase 2/3 "single live-scan run builder" invariant and
its recovery.

## 4. The shared resolver — `lib/ada-audit/url-resolver.ts`

```ts
export interface ResolveResult {
  result: 'ok' | 'broken' | 'unconfirmed'
  finalUrl: string | null      // safeFetch's final url; null when unconfirmed
  status: number | null        // final HTTP status; null when unconfirmed
  hops: number                 // redirects.length (0 = no redirect)
  chain: string[]              // safeFetch redirects[] VERBATIM — already ends at the final URL
  tooManyRedirects: boolean    // safeFetch threw SafeUrlError('Too many redirects')
}
export async function resolveUrl(url, deps = realResolveDeps, timeoutMs?): Promise<ResolveResult>
```

**Precision posture — preserve `checkUrl` EXACTLY (Codex fix #1):**
- HEAD first via `safeFetch`.
  - HEAD final `< 400` → `ok`.
  - HEAD final `>= 400` → confirm with GET.
  - HEAD throws `SafeUrlError` (SSRF / DNS / **`Too many redirects`**) → `unconfirmed`
    **immediately, NO GET** (this is current `checkUrl` behavior, `broken-link-check.ts:47`).
    If the message is exactly `'Too many redirects'`, also set `tooManyRedirects:true`.
  - HEAD throws non-`SafeUrlError` (network/timeout) → fall through to GET.
- GET: final `>= 400` → `broken`; `< 400` → `ok`; `SafeUrlError` or any error → `unconfirmed`.
- **Body cancellation:** like `realDeps.fetchStatus`, `response.body?.cancel()` after reading
  status (avoid socket leaks). The realResolveDeps transport keeps this.

**Chain shape (Codex fix #4):** `safeFetch` pushes each redirected URL as it follows, so for
`A→B→C` it returns `redirects=[B, C]` and `url=C`. `chain = redirects` **verbatim** — it
already ends at the final URL; do NOT append `finalUrl` (that would duplicate `C`). `hops =
redirects.length`. `finalUrl = response.url` (the safeFetch `url`).

- `hops`/`chain`/`finalUrl` come from whichever call (HEAD or GET) returned the response.
- Transport injectable (mirror `broken-link-check.CheckDeps`) for tests.
- **`checkUrl` is refactored to delegate to `resolveUrl`** and return `result` only — its
  external contract and broken-link behavior stay byte-identical. Existing broken-link tests +
  a new `SafeUrlError`-on-HEAD-no-GET regression are the guard.

## 5. Harvest change — hreflang hrefs (`parse-seo-dom.ts`) — LANDMINE

Change hreflang extraction from codes to `{lang, href}` pairs:

```ts
// RawPageSeo
hreflang: { lang: string; href: string }[]   // was: string[]
// body (SWC-helper-free — object literal, no typeof, no spread-of-unknown)
const hreflang = []
const seenLang = {}
for (const l of Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]'))) {
  const lang = l.getAttribute('hreflang') || ''
  if (!lang || seenLang[lang]) continue          // dedupe by lang, keep-first
  seenLang[lang] = 1
  hreflang.push({ lang: lang, href: l.getAttribute('href') || '' })
  if (hreflang.length >= 50) break               // cap 50 (unchanged bound)
}
```

- **Dedupe by `lang` explicitly (Codex fix #6):** `Array.from(new Set(objs))` does NOT dedupe
  object literals (identity, not value) — use the seen-lang guard above. `href` kept RAW
  (resolved relative to the page URL later, in the mapper — §7).
- **Mandatory SWC verification (per `cc8d1c1`):** compile `parse-seo-dom.ts` alone to es2017 and
  grep the output for escaping helpers (`_type_of`, `_define_property`, `_to_consumable_array`,
  etc.). Zero helper references required before merge. This is a plan gate, not optional.
- **Persist:** `site-audit-page.ts` `persistPageSeo` writes
  `detailsJson: JSON.stringify({ schemaTypes: seo.schemaTypes, hreflang: seo.hreflang })`
  (hreflang now the pair array).
- **Backward-compat read:** the builder parses `detailsJson` defensively — accepts both the
  legacy `hreflang: string[]` (codes; treated as code-only, no href → no target/reciprocity
  finding for those, code hygiene still runs) and the new `hreflang: {lang,href}[]`. Rows are
  transient and deleted per run, so only in-flight-during-deploy rows hit the legacy branch.

## 6. Finding types

All follow the existing pattern: one run-scope finding per type (count + detail JSON
`{description}`) plus page-scope rows per affected URL (`affectedComplete`, `affectedSource`).
Keys from `keys.ts` (`runFindingKey`/`pageFindingKey`) — never hand-rolled.

| Type | Scope→page keyed by | Severity | affectedSource | Condition |
|---|---|---|---|---|
| `canonical_broken` | affected page | warning | `live-scan-canonical` | same-domain canonical target resolves `broken` |
| `canonical_redirect` | affected page | warning | `live-scan-canonical` | same-domain canonical target `hops >= 1` (should point at the final URL) |
| `redirect_chain` | source page | notice | `live-scan-redirect` | internal-link target resolves `ok` with `hops >= 1` (detail: hop count) |
| `redirect_loop` | source page | warning | `live-scan-redirect` | internal-link target `tooManyRedirects` |
| `hreflang_broken` | declaring page | warning | `live-scan-hreflang` | same-domain hreflang alternate resolves `broken` |
| `hreflang_no_return` | declaring page | warning | `live-scan-hreflang` | in-set reciprocity fail: A→B (both harvested, same-domain) but B has no hreflang href → A |
| `hreflang_missing_self` | declaring page | notice | `live-scan-hreflang` | page with a cluster (≥2 alternates) has no hreflang href normalizing to its own URL |
| `hreflang_missing_x_default` | declaring page | notice | `live-scan-hreflang` | cluster (≥2 alternates) has no `x-default` entry |
| `hreflang_invalid_code` | declaring page | notice | `live-scan-hreflang` | a `lang` fails a BCP-47-ish check (`/^([a-z]{2,3}(-[A-Za-z0-9]{2,8})*|x-default)$/i`) |
| `canonical_external_unverified` | **run only** | notice | `live-scan-canonical` | count of distinct cross-domain canonical targets recorded-but-not-fetched (emitted only when count>0) |
| `hreflang_external_unverified` | **run only** | notice | `live-scan-hreflang` | count of distinct cross-domain hreflang targets recorded-but-not-fetched (emitted only when count>0) |

**No double-count:** a redirect chain that ends in a 4xx/5xx is already surfaced as
`broken_internal_links` (checkUrl/resolveUrl returns `broken` on final `>= 400`). `redirect_chain`
fires **only when the final result is `ok`**. Documented in the mapper.

**Page-scope aggregation (Codex fix #5):** page-scope findings are keyed by `(type, declaring/
source page)`. When one page has **multiple** affected targets of the same type (e.g. two broken
hreflang alternates), they aggregate into **ONE** page finding whose `count` = number of affected
targets and whose `detail` carries the target-URL list (capped, mirroring
`broken-link-mapper`'s per-source aggregation). Emitting one row per target would collide on
`@@unique([runId, dedupKey])`.

**Cross-domain (Codex fix, Kevin-verify item):** canonical/hreflang targets whose **initial
host** is a different registrable domain are not resolved. Rather than relying on a
same-family finding existing to carry the note, they surface as their own **run-scope `notice`
findings** (`canonical_external_unverified` / `hreflang_external_unverified`, count-only, no
page rows), emitted only when the count is >0 — this gives `TechnicalSeoSection` a data source
even when a page has *only* external targets and no other issue.

**Scoring:** validation findings do **not** enter `scoreLiveSeo` in MVP (the forked scorer's
factor set is frozen at Phase 3; adding factors is a separate scored-signal decision). `CrawlRun.score`
computation is unchanged.

## 7. Pure mapper — `lib/findings/validation-mapper.ts`

```ts
export interface ResolveLookup { get(normUrl: string): ResolveResult | undefined }
export interface ValidationInput {
  seoRows: { url: string; canonicalUrl: string | null; hreflang: {lang,href}[]; ... }[]
  links: { sourcePageUrl: string; targetUrl: string; kind: string }[]  // internal-link only
  resolve: ResolveLookup
  auditedHost: string
  harvestedSet: Set<string>   // normalized audited page URLs (for in-set reciprocity)
}
export function mapValidationFindings(input, { runId, ensurePage }): FindingInput[]
```

- Pure; no I/O. Takes the pre-resolved cache. Fully unit-testable off a fake `ResolveLookup`.
- **Relative-URL resolution (Codex fix #7):** canonical/hreflang hrefs are RAW attributes.
  Resolve each against its **declaring page URL** with the same `normalizeLinkTarget(raw, base)`
  logic `link-harvest.ts` uses, BEFORE same-domain classification and cache lookup. (The
  resolution set built in the builder — §3 step 3 — likewise resolves raw canonical/hreflang
  hrefs relative to their page before adding them.)
- Same-domain classification reuses `link-harvest`'s www-insensitive `sameDomain` semantics
  (extract a shared helper if needed; do not fork the rule).
- Emits run-scope + page-scope findings per §6. Page-scope rows keyed by `(type, declaring/
  source page)` and **aggregated** (§6 aggregation note) — the way `broken-link-mapper` keys +
  aggregates by source page.

## 8. Cap / budget

One shared resolver/cache, but the cap must **not** reduce existing broken-link coverage
(Codex fix #3). Order the dedup'd **same-domain** resolution set as **legacy link/image
targets FIRST** (deterministic sort: `targetUrl` asc, then kind — matching the current Phase 1
order), **then** canonical/hreflang-*only* targets (those not already in the link set) if
budget remains, also deterministically sorted. Apply `BROKEN_LINK_MAX_CHECKS` (default 2000)
after this ordering. This guarantees validation-only URLs can never push a broken-link target
out of the checked subset — Phase 1's checked set is exactly preserved when validation adds no
new uniques, and only *extends* it otherwise. `capped` → run `status:'partial'` (existing
behavior); truncation is `console.warn`-logged. On well-built sites self-canonical +
same-domain hreflang mostly dedupe into the existing internal-link set, so marginal growth is
small. No separate per-family budget in MVP.

## 9. Schema — no migration

- `canonicalUrl`: existing column.
- hreflang hrefs: existing `detailsJson` string column, **shape change only** (JSON contents),
  which is not a schema migration.
- New Finding `type`/`affectedSource` values: free strings, no schema change.
- `CrawlPage.finalUrl` (existing, currently null): MAY be populated from a page's own resolve
  where useful; not required for any finding. No new column.

**Result: this is feature-class, not schema-migration-class.**

## 10. UI — `components/site-audit/TechnicalSeoSection.tsx`

Third disjoint section on the site-audit results page, reading the same live-scan run,
scoped to `canonical_*`/`redirect_*`/`hreflang_*` (disjoint from BrokenLinks/OnPage type-sets —
no cross-leak). States mirror the existing two:
- **not-analyzed** — no live-scan run / pre-Phase-4 run (probe: run has no validation-family
  finding AND no evidence a Phase-4 build ran — reuse the OnPage `analyzed` probe = a `CrawlPage`
  with `statusCode != null`, since Phase 4 ships with Phase 2/3 harvest).
- **clean** — analyzed, no validation findings among audited pages.
- **findings** — grouped by family (canonical / redirect / hreflang), each finding with its
  affected-page list (paginated like the others).
Dark-mode `dark:` variants on every element; `mounted`-safe if any client-only state is used.
Share-mode: read-only, no cookie-gated fetches (consistent with the site share page).

## 11. Testing

- **`resolveUrl`** (unit, injected transport): ok / broken (HEAD 4xx→GET confirm) / unconfirmed
  (SSRF, network) / redirect chain hops+chain (assert chain is `redirects` verbatim, final NOT
  duplicated) / `tooManyRedirects`. **`SafeUrlError`-on-HEAD → `unconfirmed` with NO GET call**
  (Codex fix #1 regression, incl. `Too many redirects`). Body-cancellation invoked. Plus a
  `checkUrl`-delegates regression proving broken-link behavior byte-identical.
- **`parse-seo-dom` hreflang**: golden/characterization on a fixture with mixed hreflang
  (valid, x-default, cross-domain, malformed, **duplicate lang**, **empty href**, **relative
  href**) asserting dedupe-by-lang keep-first + cap 50 + raw hrefs + **es2017 helper-free
  verification** (compile + grep; a plan gate).
- **`validation-mapper`** (pure unit): every finding type; no-double-count with broken; cross-
  domain recorded-not-resolved + the `*_external_unverified` run-scope notices; **relative
  canonical/hreflang href resolved against the declaring page**; **multiple failures on one page
  aggregate into one finding** (no dedupKey collision); in-set reciprocity (positive + negative
  + B-not-harvested skip); cluster/x-default/self/code-hygiene edge cases.
- **cap ordering** (unit): legacy link/image targets are never displaced by validation-only
  URLs when the combined set exceeds the cap.
- **verify-builder integration** (DB-backed): seed HarvestedLink + HarvestedPageSeo (canonical +
  hreflang), run `runBrokenLinkVerify` with a fake resolver, assert the live-scan run carries the
  expected merged findings and transient tables are deleted.
- **`TechnicalSeoSection`** render (jsdom, `afterEach(cleanup)`): not-analyzed / clean / findings,
  light + dark.
- **Gate-green:** `npm run lint` + `npm test` + `npm run build`.

## 12. Risks & mitigations

- **Injected-function landmine** (highest): SWC helper escaping. Mitigation: object-literal-only
  change + mandatory es2017 compile-and-grep gate in the plan.
- **WAF bans / rule 3**: mitigated by same-domain-only *initial-target* selection (§1) — no new
  external-host exposure beyond what Phase 1 already does. **Caveat (Codex fix #2):** a
  same-domain target that redirects off-site IS followed by `safeFetch` (SSRF-checked per hop) —
  this is pre-existing Phase 1 behavior, not new here. We accept it rather than add an
  allowed-host redirect policy (which would fork `safeFetch` and change broken-link behavior).
- **Cap starvation** (canonical/hreflang crowding out link checks): low, because dedup collapses
  overlap; if observed, a follow-up can prioritize link targets. Logged.
- **Reciprocity false positives** (B same-domain but not in the audited set → we lack B's
  hreflang): mitigated by skipping reciprocity unless B is in `harvestedSet`.
- **Deploy in-flight legacy detailsJson**: mitigated by the defensive dual-shape parse (§5).

## 13. Acceptance criteria

- Live-scan run on a real client audit (canary / manhattanschool.edu) carries
  canonical/redirect/hreflang findings alongside the existing broken-link + on-page findings, in
  one `CrawlRun`, with transient tables cleaned.
- `checkUrl`/broken-link findings unchanged (regression tests green).
- `parse-seo-dom.ts` compiles helper-free at es2017 (verified in prod bundle post-deploy, like the
  Phase 2 minification-survival check).
- Cross-domain targets are recorded-unverified, never fetched (test-proven).
- `TechnicalSeoSection` renders all states in light + dark.
- No schema migration; deploy is plain `~/deploy.sh` (code-only).
- Gate-green + prod-verified.
