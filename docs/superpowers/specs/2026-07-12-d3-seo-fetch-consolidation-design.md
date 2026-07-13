# D3 — Shared `lib/seo-fetch/` (robots/sitemap parsing + fetching through safeFetch) — Design

**Date:** 2026-07-12 · **Tracker item:** D3 (improvement roadmap, Track D) ·
**Origin:** `docs/superpowers/nyi/improvement-roadmaps/05-small-tools.md` §"Consolidate parsing first"
**Class:** security-sensitive refactor (safeFetch adjacency; site-audit discovery critical path)

## 1. Goal

One home — `lib/seo-fetch/` — for robots.txt and sitemap parsing **and** the
server-side fetch helpers that retrieve them, all through the existing
`safeFetch` / SSRF guard. Consumed by the Robots Validator UI, the ADA sitemap
crawler, and (later) the D4 client-attached checks and D5 scheduled monitoring.
This is a **behavior-preserving consolidation**: no DB models, no new routes,
no UI feature changes. Its deliverable is the end of parser drift plus fetch
primitives shaped so D4 can build `RobotsCheck` snapshots without re-plumbing.

## 2. Background — verified code facts this builds on

Today there are **three robots parsers and two sitemap parsers**, zero sharing:

| Module | LOC | What it does | Consumers |
|---|---|---|---|
| `lib/validators/robots.validator.ts` | 320 | Rich parser: `parseRobotsTxt` → issues (23 types), groups, `sitemapUrls`, crawl-delay, AI-bot blocked/allowed (`KNOWN_AI_BOTS`, 10 bots); `testUrlAgainstRobots` (longest-match, ties→Allow, lowercased compare, `*` wildcard, **no `$` support**) | `app/(app)/robots-validator/page.tsx` (client component — parses in the browser) |
| `lib/ada-audit/seo/robots-rules.ts` | 67 | Minimal pure matcher for the hybrid-crawl frontier: `parseRobots` (**`User-agent: *` group only**), `isAllowed` (longest-match, **`$` supported**, Allow ties win) | `sitemap-crawler.ts`, `seo/hybrid-crawl.ts` |
| `lib/ada-audit/sitemap-crawler.ts` (private helpers) | ~180 of 486 | `extractSitemapUrls` (`Sitemap:` line regex — **does not strip `#` comments**), `extractLocs`/`isSitemapIndex` (regex `<loc>` extraction, CDATA strip), `collectFromSitemap` (index recursion, child batches of 5), `fetchRobotsRaw` (flattens every failure to `''`), `fetchXml` (gzip via `node:zlib`, byte caps, HTML-content-type reject), `fetchSitemapXml` (direct → Puppeteer browser fallback), browser-shaped `USER_AGENT` (WAF-403 avoidance) | site-audit discovery (`discoverPages`) — the critical path of every site audit |
| `lib/validators/sitemap.validator.ts` | 168 | `parseSitemapXml` validation: urlset/sitemapindex detection, 50k limit, spaces, duplicates, http://, mismatched `<url>` tags, metadata flags, 10 sample URLs | robots-validator page (client) |
| `app/api/fetch-url/route.ts` | 47 | Generic safeFetch proxy (1 MB text cap) the validator page uses to fetch robots.txt/sitemaps before parsing client-side; UA `ER-SEO-Tools/1.0 robots-validator` | robots-validator page |

Other verified facts:

- **All network fetches already go through `safeFetch`** (`lib/security/safe-url.ts`);
  the roadmap's "must go through safeFetch" requirement is already satisfied.
  D3 must not regress it: no new raw fetch paths.
- `discoverPages` runs `assertSafeHttpUrl(base)` **before** the robots.txt fetch
  (check-then-fetch; comment in `sitemap-crawler.ts:286-289` forbids re-checking
  downstream). This ordering is load-bearing and must survive the refactor.
- The two URL matchers have **intentionally different semantics** (the crawl
  matcher was Codex-reviewed with `$` support and `*`-group-only scope; the
  validator matcher is UA-aware, case-folding, `$`-less). No consumer needs them
  unified.
- `lib/ada-audit/sitemap-crawler.test.ts` (657 lines) mocks `safeFetch` and pins
  discovery behavior end-to-end — it is the natural characterization gate.
- `lib/validators/*.test.ts` (343 + 256 lines) pin the parsers' behavior.
- Repo precedent for server-only modules: `import 'server-only'`
  (`lib/handoff/token.ts`, `lib/analytics/google/*`).
- The silent 1000-URL cap the roadmap wanted surfaced is **already surfaced**
  since the C6 discovery-coverage increment (`DiscoverResult.mode`/`capped`,
  `SiteAudit.discoveryMode`/`discoveryCapped`). Nothing more to do in D3.

## 3. Scope decisions (locked)

Recorded per the 2026-07-03 ruling (brainstorm→spec→plan runs ungated; these are
session calls consistent with the roadmap doc; Kevin can override on review).
Spec-local decision codes — not tracker items.

- **D1 — Consolidation only.** No schema, no routes, no UI features. The D4
  snapshot service and D5 scheduling build **on top of** this module later.
  The robots-validator page keeps its exact current UX (fetch via
  `/api/fetch-url`, parse client-side).
- **D2 — Matching semantics frozen; two matchers remain.** Both matchers move
  into `lib/seo-fetch/` but keep their distinct semantics, each documented with
  a header comment explaining why the other exists. Unifying them would change
  behavior on the hybrid-crawl frontier or in the validator UI for zero
  consumer benefit.
- **D3 — `lib/validators/` is deleted, not facaded.** Its only consumer is one
  page plus its own tests. Files move with `git mv` (history preserved); the
  page's imports update; the test suites move alongside and must pass
  **unmodified** (characterization). The D1-handoff facade pattern is for wide
  frozen wire surfaces — not warranted here.
- **D4 — Fetch primitives return structured outcomes, crawler adapts.**
  `lib/seo-fetch/fetch.ts` functions return `{ ok, status, failure, text,
  truncated, finalUrl }`-shaped results instead of `''`/`null`-on-failure,
  because D4's checks must distinguish "robots.txt is 404" from "fetch timed
  out" from "SSRF-blocked" (different findings). `sitemap-crawler.ts` adapts at
  its call sites (e.g. `!r.ok ? '' : r.text`) so discovery behavior is
  byte-identical.
- **D5 — Puppeteer stays out of `lib/seo-fetch/`.** The browser fallback
  (`fetchSitemapViaBrowser`) remains in `lib/ada-audit/`; the shared sitemap
  collection takes an **injected fetcher** so the crawler composes
  direct-then-browser. `lib/seo-fetch/` never imports puppeteer — D4/D5
  scheduled checks get the cheap direct path by default.
- **D6 — One named micro-delta: `Sitemap:` extraction strips comments.** The
  shared extractor uses the validator's comment-stripping field parse; the
  crawler's current regex would keep a trailing ` # comment` in the URL (a
  latent bug — such a URL 404s). This is the only intended behavior change in
  the whole refactor, it can only *improve* discovery, and it gets an explicit
  test.

## 4. Architecture

```
lib/seo-fetch/
  robots-parse.ts    (client-safe, pure)  ← git mv lib/validators/robots.validator.ts
  robots-match.ts    (client-safe, pure)  ← git mv lib/ada-audit/seo/robots-rules.ts
  sitemap-parse.ts   (client-safe, pure)  ← git mv lib/validators/sitemap.validator.ts + crawler XML helpers
  fetch.ts           (server-only)        ← extracted from sitemap-crawler.ts privates
```

No barrel `index.ts` — direct module imports, matching `lib/findings/` style.

### 4.1 `robots-parse.ts` (client-safe)

Everything from `robots.validator.ts` unchanged: `parseRobotsTxt`,
`testUrlAgainstRobots`, `KNOWN_AI_BOTS`, `RobotsIssue`/`RobotsGroup`/
`RobotsParseResult`. **Adds** the shared extractor:

```ts
/** Pure `Sitemap:` line scan. Strips #-comments (D6). */
export function extractSitemapUrls(robotsText: string): string[]
```

Implementation reuses the same comment-strip + field-parse the full parser
uses, so `parseRobotsTxt(text).sitemapUrls` and `extractSitemapUrls(text)`
can never disagree. The crawler calls the cheap extractor (it does not need
issues/groups on the discovery path).

### 4.2 `robots-match.ts` (client-safe)

`robots-rules.ts` moved verbatim: `RobotsRules`, `parseRobots`, `isAllowed`.
Header comment keeps the v1 `*`-group-only rationale and adds one line pointing
at `robots-parse.ts` for the UA-aware validator matcher (and vice versa).

### 4.3 `sitemap-parse.ts` (client-safe)

`sitemap.validator.ts` moved verbatim (`parseSitemapXml`, types) **plus** the
crawler's pure XML helpers, exported:

```ts
export function isSitemapIndex(xml: string): boolean
export function extractPageLocs(xml: string): string[]     // <url>…<loc> pairs, CDATA-stripped
export function extractChildSitemapLocs(xml: string): string[] // <sitemap>…<loc> pairs
```

These are the crawler's `extractLocs(xml, pattern)` split into two named
functions (the regex pattern was the only variance). `parseSitemapXml` keeps
its own `extractTagValues` internals untouched — its validation counts *all*
`<loc>` tags by design (it reports on the document, not on a crawl frontier);
a header note documents that intentional difference.

### 4.4 `fetch.ts` (server-only)

`import 'server-only'` at top (repo precedent). Exports:

```ts
export const SEO_FETCH_USER_AGENT: string   // browser-shaped UA, moved with its WAF-403 comment
export const MAX_ROBOTS_BYTES = 500_000
export const MAX_SITEMAP_XML_BYTES = 5_000_000

export type SeoFetchFailure =
  | 'http-error'      // response.ok false (status carried alongside)
  | 'not-xml'         // sitemap fetch got HTML content-type (login redirect / soft 404)
  | 'too-large'       // byte cap exceeded (truncated body is never returned)
  | 'unsafe-url'      // SafeUrlError — SSRF guard rejected
  | 'network'         // DNS/TCP/timeout/abort — anything else thrown

export interface SeoFetchResult {
  ok: boolean
  status: number | null       // null when nothing came back
  text: string | null         // body when ok
  failure: SeoFetchFailure | null
  finalUrl: string | null     // post-redirect URL when a response arrived
}

/** GET <base>/robots.txt via safeFetch. 15 s timeout, 500 KB cap. */
export function fetchRobotsTxt(baseUrl: string): Promise<SeoFetchResult>

/** GET one sitemap document via safeFetch. Handles .gz (gunzip, capped),
 *  rejects HTML content-types, 5 MB cap. */
export function fetchSitemapXml(url: string): Promise<SeoFetchResult>

/** Given fetched sitemap XML: plain urlset → page locs; sitemapindex →
 *  fetch same-domain children via the injected fetcher (batches of 5) and
 *  collect their page locs. The injection point is where the ADA crawler
 *  plugs in its direct→browser-fallback fetcher (D5). */
export function collectSitemapPageUrls(
  xml: string,
  isSameDomain: (url: string) => boolean,
  fetchXml: (url: string) => Promise<string | null>,
): Promise<string[]>
```

Behavior is lifted from the crawler's `fetchRobotsRaw`/`fetchXml`/
`collectFromSitemap` with the failure taxonomy added. Timeouts and caps keep
the current values. `collectSitemapPageUrls` takes a same-domain predicate
rather than a domain string so the crawler keeps its exact `isSameDomain`
(www-insensitive) semantics.

### 4.5 Consumer rewiring

- **`lib/ada-audit/sitemap-crawler.ts`** keeps: discovery orchestration
  (`discoverPages`/`discoverPagesWithDeps`), seed resolution, `shallowCrawl`,
  `fetchHtml`, `fetchPageLinks`, `dedupeUrls`, `normaliseDomain`/`isSameDomain`,
  HARD_CAP + hybrid bounds, browser-fallback composition. Delegates to
  `lib/seo-fetch/`: robots fetch (adapting `SeoFetchResult` → `''`-on-failure),
  `extractSitemapUrls`, sitemap fetch (adapting → `null`-on-failure, then
  browser fallback), `isSitemapIndex` + loc extraction via
  `collectSitemapPageUrls`. The `assertSafeHttpUrl` check-then-fetch ordering
  in `discoverPages` is untouched.
- **`lib/ada-audit/seo/hybrid-crawl.ts`** — import path update only
  (`./robots-rules` → `@/lib/seo-fetch/robots-match`).
- **`app/(app)/robots-validator/page.tsx`** — import path updates only
  (`@/lib/validators/*` → `@/lib/seo-fetch/*`). Client-safety holds because
  the parse modules stay pure.
- **`app/api/fetch-url/route.ts`** — unchanged. Its transparent
  `ER-SEO-Tools/1.0 robots-validator` UA is a deliberate one-shot-tool choice;
  only the crawler/monitoring paths need the browser-shaped UA.

## 5. Data flow (after)

```
Robots Validator UI (client) ── /api/fetch-url (safeFetch proxy) ──▶ raw text
        │ parses client-side with
        ▼
lib/seo-fetch/robots-parse.ts · sitemap-parse.ts        (pure, client-safe)
        ▲                                                        ▲
        │ extractSitemapUrls / loc extraction                    │
site-audit discovery (lib/ada-audit/sitemap-crawler.ts) ─────────┤
        │ fetches via                                            │
        ▼                                                        │
lib/seo-fetch/fetch.ts ──▶ safeFetch (SSRF guard) ──▶ network    │
        ▲                                                        │
future D4 RobotsCheck service / D5 scheduled checks ─────────────┘
```

## 6. Error handling & invariants

- **No new raw fetch paths** — every fetch in `lib/seo-fetch/fetch.ts` goes
  through `safeFetch`; `SafeUrlError` maps to `failure: 'unsafe-url'`, never
  rethrown as success. `lib/security/safe-url.ts` itself is untouched.
- **Check-then-fetch preserved:** `discoverPages` still runs
  `assertSafeHttpUrl(base)` before any network call; `lib/seo-fetch` functions
  do not re-check (safeFetch already validates per-request, including
  redirects).
- **Truncated bodies are never returned as content** (`too-large`), matching
  current crawler behavior (truncated → treated as fetch failure).
- **Byte caps and timeouts keep current values** (500 KB robots / 5 MB XML /
  15 s) — they move as named exported constants.
- **Client/server split is structural:** parse modules import nothing but
  types; `fetch.ts` carries `import 'server-only'` and the `node:zlib` usage.
- **No behavior change in discovery** except D6 (comment-stripping `Sitemap:`
  extraction), which is test-pinned.

## 7. Testing

- `lib/seo-fetch/robots-parse.test.ts`, `sitemap-parse.test.ts` — the moved
  validator suites, `git mv`'d, passing **unmodified** except the import line
  (characterization). New cases: `extractSitemapUrls` (incl. the D6
  trailing-comment case and agreement with `parseRobotsTxt().sitemapUrls`).
- `lib/seo-fetch/robots-match.test.ts` — moved `robots-rules.test.ts`,
  unmodified except import line.
- `lib/seo-fetch/sitemap-parse.test.ts` additions: `isSitemapIndex`,
  `extractPageLocs` (CDATA, whitespace), `extractChildSitemapLocs`.
- `lib/seo-fetch/fetch.test.ts` — new: mocks `safeFetch` (same pattern as
  `sitemap-crawler.test.ts`); covers ok/404/HTML-content-type/gzip/oversize/
  SafeUrlError/timeout → the full failure taxonomy; `collectSitemapPageUrls`
  plain vs index vs cross-domain child filtering vs failed child.
- **`lib/ada-audit/sitemap-crawler.test.ts` (657 lines) must pass with zero
  assertion changes** — the frozen gate proving discovery behavior is
  preserved. (Its `vi.mock` of `../security/safe-url` keeps working because
  the crawler's delegation to `lib/seo-fetch/fetch.ts` still bottoms out in
  `safeFetch` — the mock seam is unchanged. If the D6 delta surfaces in any
  fixture, the fixture's robots.txt is comment-free, so it should not.)
- `lib/ada-audit/seo/hybrid-crawl.test.ts` — import path only.
- Gates: `npm run lint` + `npm test` + `npm run build`. `npm run smoke` is
  required pre-merge (this touches the ADA audit pipeline's discovery path).

## 8. Acceptance criteria

1. `lib/validators/` and `lib/ada-audit/seo/robots-rules.ts` no longer exist;
   `git log --follow` shows history through the moves.
2. `rg "parseRobotsTxt|parseSitemapXml|parseRobots\b|isAllowed"` resolves every
   consumer to `lib/seo-fetch/*`.
3. `sitemap-crawler.test.ts` green with no assertion edits.
4. Robots Validator page works identically (manual prod check post-deploy:
   fetch a real robots.txt + sitemap, confirm identical issue output).
5. All three gates + smoke green; audit-ci green.
6. One shared `Sitemap:`/`<loc>` implementation each — drift class closed.

## 9. Out of scope (breadcrumbed for D4/D5)

- `RobotsCheck`/snapshot models, content hashing, diffing, history UI — **D4**
  (`05-small-tools.md` step 2). `fetch.ts`'s structured failure taxonomy is the
  hook D4 builds on.
- Scheduled monitoring, change-only alerts — **D5** (needs A1, which is done).
- Matcher unification (single spec-compliant robots engine) — rejected (D2),
  revisit only if a consumer ever needs UA-aware matching on the crawl path.
- `fetch-url` proxy hardening/UA change — deliberately untouched.
