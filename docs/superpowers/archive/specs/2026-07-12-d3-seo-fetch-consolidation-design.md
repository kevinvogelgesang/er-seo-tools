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
- **`SafeUrlError` is a single untyped class** thrown for very different causes
  (verified against `safe-url.ts`): SSRF policy rejections (private hosts,
  credentials, non-http schemes), DNS resolution failure (`Could not resolve
  hostname`), redirect problems (missing Location, too many redirects), and
  invalid responses (missing/unsupported status). A naive
  `SafeUrlError → 'unsafe-url'` mapping would report a DNS outage as an
  SSRF block (Codex #1).
- **`collectFromSitemap` expands ONE sitemap-index level only** — a child that
  is itself an index yields no pages. This is current, frozen behavior, not
  recursion (Codex #5).
- `sitemap-crawler.test.ts` contains **local copies** of `extractLocs` /
  `isSitemapIndex` (plus copies of helpers that are not moving) with their own
  describe blocks — the copies must be replaced by imports of the shared
  functions or the "frozen gate" can pass while production drifts (Codex #6).
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
  `lib/seo-fetch/fetch.ts` functions return a **discriminated union** (Codex
  #2) instead of `''`/`null`-on-failure, because D4's checks must distinguish
  "robots.txt is 404" from "fetch timed out" from "SSRF-blocked" (different
  findings). `sitemap-crawler.ts` adapts at its call sites (e.g.
  `r.ok ? r.text : ''`) so discovery behavior is byte-identical. To make the
  taxonomy truthful, **`SafeUrlError` gains an optional typed `reason` field**
  (Codex #1) — a small additive change to `lib/security/safe-url.ts` (§4.5)
  that changes no thrown-or-not behavior and no messages.
- **D5 — Puppeteer stays out of `lib/seo-fetch/`.** The browser fallback
  (`fetchSitemapViaBrowser`) remains in `lib/ada-audit/`; the shared sitemap
  collection takes an **injected fetcher** so the crawler composes
  direct-then-browser. `lib/seo-fetch/` never imports puppeteer — D4/D5
  scheduled checks get the cheap direct path by default.
- **D6 — One named micro-delta: `Sitemap:` extraction strips comments.** The
  shared extractor uses the validator's comment-stripping field parse; the
  crawler's current regex would keep a trailing ` # comment` in the URL (a
  latent bug — such a URL 404s). This is the only intended behavior change in
  the whole refactor. Treat it as **observable, not "can only improve"**
  (Codex #8): a rare sitemap URL with an unescaped `#` would change. It lands
  in **its own commit** with an end-to-end crawler test proving
  `Sitemap: https://x/sitemap.xml # note` requests `/sitemap.xml`, plus
  adjacent-`#` (no space), CRLF line endings, duplicate directives, and `%23`
  (percent-encoded `#` must survive) cases.
- **D7 — Sitemap-index expansion stays ONE level; child failures become
  visible.** `collectSitemapPageUrls` freezes the current one-level expansion
  (nested indexes yield no pages — Codex #5, characterization-tested) and
  returns bounded child diagnostics (`childrenTotal`/`childrenFailed`, Codex
  #4) so a partially failed index can't look healthy to D4. The crawler
  ignores the diagnostics.

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
  | 'http-error'        // response arrived, response.ok false
  | 'not-xml'           // sitemap fetch got HTML content-type (login redirect / soft 404)
  | 'too-large'         // byte cap exceeded (truncated body is never returned)
  | 'unsafe-url'        // SafeUrlError reason 'policy' — SSRF guard rejected
  | 'dns'               // SafeUrlError reason 'dns' — hostname did not resolve
  | 'redirect'          // SafeUrlError reason 'redirect' — missing Location / too many hops
  | 'invalid-response'  // SafeUrlError reason 'invalid-response' — bad/unsupported status shape
  | 'timeout'           // AbortSignal.timeout fired (TimeoutError/AbortError)
  | 'network'           // anything else thrown (TCP reset, TLS, etc.)

// Discriminated union — impossible states are unrepresentable (Codex #2):
export type SeoFetchResult =
  | { ok: true;  status: number;        text: string; finalUrl: string;
      failure: null;            truncated: false }
  | { ok: false; status: number | null; text: null;   finalUrl: string | null;
      failure: SeoFetchFailure; truncated: boolean }   // truncated:true only for 'too-large'

/** GET robots.txt via safeFetch: new URL('/robots.txt', baseUrl) — accepts an
 *  origin with or without trailing slash; any path on baseUrl is replaced,
 *  never appended (Codex #7). 15 s timeout, 500 KB cap. */
export function fetchRobotsTxt(baseUrl: string): Promise<SeoFetchResult>

/** GET one sitemap document via safeFetch. Handles .gz (gunzip, capped),
 *  rejects HTML content-types, 5 MB cap. */
export function fetchSitemapXml(url: string): Promise<SeoFetchResult>

export interface CollectSitemapResult {
  urls: string[]
  childrenTotal: number    // same-domain children found in a sitemapindex (0 for plain urlset)
  childrenFailed: number   // children whose fetch returned null (Codex #4)
}

/** Given fetched sitemap XML: plain urlset → page locs; sitemapindex →
 *  fetch same-domain children via the injected fetcher (batches of 5) and
 *  collect their page locs. ONE level of index expansion only — a child that
 *  is itself an index contributes no pages (frozen current behavior, Codex
 *  #5; do not introduce recursion). The injection point is where the ADA
 *  crawler plugs in its direct→browser-fallback fetcher (D5). */
export function collectSitemapPageUrls(
  xml: string,
  isSameDomain: (url: string) => boolean,
  fetchXml: (url: string) => Promise<string | null>,
): Promise<CollectSitemapResult>
```

Behavior is lifted from the crawler's `fetchRobotsRaw`/`fetchXml`/
`collectFromSitemap` with the failure taxonomy added. Timeouts and caps keep
the current values. `collectSitemapPageUrls` takes a same-domain predicate
rather than a domain string so the crawler keeps its exact `isSameDomain`
(www-insensitive) semantics.

Failure-branch hygiene (Codex #3, #9):

- **Early-return branches cancel the unread body** (`http-error`, `not-xml`)
  via `response.body?.cancel()` before returning — the current crawler code
  leaks the stream, which is tolerable in one-shot discovery but not in a
  primitive D5 will call repeatedly on a schedule.
- **Per-branch metadata is pinned:** branches where a response arrived
  (`http-error`, `not-xml`, `too-large`) carry `status` + `finalUrl`; branches
  where none did (`dns`, `timeout`, `unsafe-url`, `network`) carry
  `status: null, finalUrl: null`.

### 4.5 `lib/security/safe-url.ts` — additive typed `reason` on `SafeUrlError`

To classify failures without message-sniffing, `SafeUrlError` gains:

```ts
export type SafeUrlErrorReason = 'policy' | 'dns' | 'redirect' | 'invalid-response'
export class SafeUrlError extends Error {
  readonly reason: SafeUrlErrorReason
  constructor(message: string, reason: SafeUrlErrorReason = 'policy') { … }
}
```

Construction sites are tagged: the two `Could not resolve hostname` throws →
`'dns'`; `Redirect response missing Location` + both `Too many redirects` →
`'redirect'`; `Response missing status code` + `Unsupported response status`
(and the response-construction failure) → `'invalid-response'`; everything
else keeps the `'policy'` default (no call-site change needed). **This is
strictly additive**: no throw becomes a non-throw, no message changes, no
guard weakens — existing `instanceof SafeUrlError` handling everywhere is
unaffected. Characterization: existing `safe-url` tests untouched and green;
new tests assert the reason tags only.

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
- **Unread bodies are cancelled** on every early-return failure branch
  (Codex #3) — no socket retention under D5's repeated scheduled checks.
- **Sitemap-index expansion is one level, frozen** (Codex #5) — nested indexes
  contribute no pages, exactly as today.
- **`SafeUrlError` change is additive-only** (§4.5) — the SSRF guard's
  throw/no-throw behavior and messages are byte-identical.
- **No behavior change in discovery** except D6 (comment-stripping `Sitemap:`
  extraction), which is test-pinned and lands in its own commit.

## 7. Testing

- `lib/seo-fetch/robots-parse.test.ts`, `sitemap-parse.test.ts` — the moved
  validator suites, `git mv`'d, passing **unmodified** except the import line
  (characterization). New cases: `extractSitemapUrls` — the full D6 matrix
  (trailing ` # comment`, adjacent `#` with no space, CRLF endings, duplicate
  directives, `%23` percent-encoded hash survives) and agreement with
  `parseRobotsTxt().sitemapUrls` (Codex #8).
- `lib/seo-fetch/robots-match.test.ts` — moved `robots-rules.test.ts`,
  unmodified except import line.
- `lib/seo-fetch/sitemap-parse.test.ts` additions: `isSitemapIndex`,
  `extractPageLocs` (CDATA, whitespace), `extractChildSitemapLocs`.
- `lib/seo-fetch/fetch.test.ts` — new: mocks `safeFetch` (same pattern as
  `sitemap-crawler.test.ts`); one test per failure branch asserting the FULL
  result shape — `status`, `finalUrl`, `text`, `failure`, `truncated` — not
  just the label (Codex #9): ok / 404 / HTML-content-type / gzip / oversize /
  SafeUrlError×{policy,dns,redirect,invalid-response} / timeout / network.
  Body-cancellation spy test for the `http-error` and `not-xml` early returns
  (Codex #3). `fetchRobotsTxt` input contract: trailing slash, path, port,
  http vs https (Codex #7). `collectSitemapPageUrls`: plain urlset vs index
  vs cross-domain child filtering vs failed child (diagnostics counted) vs
  **nested index child yields no pages** (Codex #5).
- `lib/security/safe-url.test.ts` — existing tests untouched; additive cases
  asserting `reason` tags per construction-site class (§4.5).
- **`lib/ada-audit/sitemap-crawler.test.ts` (657 lines) is the frozen gate**
  proving discovery behavior is preserved: the `discoverPages`/
  `discoverPagesWithDeps` behavioral blocks pass with **zero edits** (the
  `vi.mock` of `../security/safe-url` keeps working because the crawler's
  delegation to `lib/seo-fetch/fetch.ts` still bottoms out in `safeFetch` —
  the mock seam is unchanged). The file's **local copies** of `extractLocs`/
  `isSitemapIndex` (test-file duplication, verified at lines 31–44) are
  replaced by imports of `extractPageLocs`/`extractChildSitemapLocs`/
  `isSitemapIndex` from `lib/seo-fetch/sitemap-parse` — call shape adapts to
  the split functions, **expected values stay frozen** — so the gate actually
  exercises the moved production helpers (Codex #6). One new end-to-end
  discovery test pins D6: a robots.txt fixture with
  `Sitemap: https://x/sitemap.xml # note` must fetch `/sitemap.xml`.
- `lib/ada-audit/seo/hybrid-crawl.test.ts` — import path only.
- Gates: `npm run lint` + `npm test` + `npm run build`. `npm run smoke` is
  required pre-merge (this touches the ADA audit pipeline's discovery path).

## 8. Acceptance criteria

1. `lib/validators/` and `lib/ada-audit/seo/robots-rules.ts` no longer exist;
   `git log --follow` shows history through the moves.
2. `rg "parseRobotsTxt|parseSitemapXml|parseRobots\b|isAllowed"` resolves every
   consumer to `lib/seo-fetch/*`.
3. `sitemap-crawler.test.ts` green — behavioral blocks untouched; helper-copy
   blocks import the shared functions with frozen expected values (§7).
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
