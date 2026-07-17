# Sweep Error Triage — design

**Status:** spec (Codex review pending)
**Author:** Claude (roadmap session 2026-07-17)
**Branch/lane:** `feat/sweep-error-triage` (worktree `.claude/worktrees/sweep-error-triage`)
**Source of truth for the problem:** `docs/superpowers/todos/2026-07-16-first-sweep-report.md`

---

## 1. Context & problem

The first weekly-sweep test run (29/29 audits complete, 2026-07-16) surfaced
~116 page-level errors across 21 domains and one systemic mislabel. Zero audits
failed — these are individual pages that errored *inside* otherwise-complete
audits (each audit's `pagesError`). The report groups them into five buckets
plus a coverage-label defect. Kevin's rulings (2026-07-17):

- **Bucket 1 IS in scope** — surface recurring dead audited URLs as first-class
  `/issues` findings (not just audit-level errors).
- **Reason labels: distinguish causes** — the digest's `timed-out` label is
  wrong for 23/29 domains (the real cause was `pagesError > 0`).

The buckets are **interdependent**, which is why they ship as one spec:

```
Bucket 2 (filter cdn-cgi noise) ┐
Bucket 3 (retry infra errors)   ├─→ leave only genuine content errors ──→ Bucket 1 (surface 404/410 as findings)
Bucket 4 (reclassify 3xx)       ┘
Bucket 5 + label fix ────────────────────────────────────────────────→ honest sweep vocabulary
```

If buckets 2/3/4 did not run first, bucket 1 would emit false "dead page"
findings for our own noise (Cloudflare pseudo-URLs), transient Chrome hiccups,
and misclassified redirects.

## 2. Goals / non-goals

**Goals**

1. Stop Cloudflare `/cdn-cgi/` pseudo-URLs from entering the audited page set.
2. Give transient Chrome `Target.createTarget` / `Target closed` failures one
   retry before settling a page as `error`.
3. Stop settling Location-bearing 3xx pages as `error` when puppeteer already
   followed part of a chain (the "did not auto-follow" quirk).
4. Surface provably-dead audited URLs (HTTP 404/410) as a new page-scoped
   finding on the live-scan run, flowing through `/issues` + the digest.
5. Make the sweep's coverage-reason vocabulary honest (retire the blanket
   `timed-out`), and complete the snapshot unit map for all validation finding
   types (retiring the `sweep_unmapped_issue_unit` logError fallback for known
   types).

**Non-goals**

- **Bucket 1 does NOT rewrite client sitemaps or auto-remove URLs.** It only
  reports. Sitemap hygiene remediation stays a support workflow.
- No change to the conservative coverage *classification* — a `partial` pair
  stays `partial` (only its reason label changes). No new downward/absence
  claims from partial pairs.
- No change to `lib/seo-fetch` (frozen — consume, never modify).
- No weakening of `lib/security/safe-url.ts` / SSRF guards.
- 5xx / network-timeout / auth-wall (401/403) pages are NOT surfaced as
  dead-page findings (ambiguous or protected, not provably dead). They still
  count toward `pagesError` and thus the `pages-errored` coverage reason.
- Proway staging in the cohort (Kevin question a), MethodExplainer copy
  (question b) are out of scope — flagged separately.

## 3. Design

### 3.0 The spine — a structured runner-error taxonomy

Today `runAxeAudit` throws free-text `Error`s (`HTTP 404 — …`, `Protocol error
(Target.createTarget)`, …) and `site-audit-page.ts` settles every throw as
`error` with the raw message. Buckets 1 and 3 both need to *classify* those
throws, so the first change is a single classifier.

**New module `lib/ada-audit/runner-errors.ts`** (pure Node, no injection):

```ts
export type RunnerErrorKind =
  | 'infrastructure'  // Chrome/pool/protocol — retryable (Bucket 3)
  | 'http-status'     // non-2xx the runner rejected; carries `status`
  | 'non-html'        // 2xx but not HTML (e.g. rss+xml) — CORRECT, not dead
  | 'ssrf'            // SafeUrlError — never retry, never a finding
  | 'timeout'         // navigation timeout
  | 'other'
export interface ClassifiedRunnerError { kind: RunnerErrorKind; status?: number }
export function classifyRunnerError(err: unknown): ClassifiedRunnerError
```

- `classifyRunnerError` recognizes `Target.createTarget` / `Target closed`
  (and the existing transient patterns) as `infrastructure`; parses `HTTP <n>`
  (already the runner's thrown format) into `http-status` + `status`;
  `SafeUrlError` → `ssrf`; navigation-timeout patterns → `timeout`.
- **`runner-retry.ts` keeps its own narrow role** (in-navigation transient
  retry) but its `isTransientRunnerError` and this classifier share one
  `INFRASTRUCTURE_PATTERNS` list so the two never drift. `SafeUrlError` stays
  excluded from retry in both.

This classifier is the single home the domain-vs-infrastructure discipline
(architecture-contract §"Domain vs infrastructure errors") now points at.

### 3.1 Bucket 2 — exclude `/cdn-cgi/` paths (discovery + harvest)

`/cdn-cgi/` appears nowhere in the repo today; there is no shared URL-exclusion
helper. Add one tiny **client-safe pure predicate**:

**New `lib/ada-audit/crawl-exclude.ts`** (or a small exported fn in
`link-harvest.ts` — Codex to pick the home):

```ts
// Paths that are infrastructure artifacts, never real client pages.
const EXCLUDED_PATH_RE = /(^|\/)cdn-cgi\//i
export function isExcludedCrawlPath(url: string): boolean
```

Applied at **both** producers (they filter independently):

1. `sitemap-crawler.ts` — `resolveSeedsReal` step 5 filter (line ~254) AND the
   `shallowCrawl` inline filter (line ~171).
2. `link-harvest.ts` — inside `normalizeLinkTarget` (the single funnel every
   `<a href>`/`<img src>` passes through via `consider()`), returning `null`
   for excluded paths.

Provenance note: the report says cdn-cgi arrive "one per affected domain" —
consistent with harvested links (obfuscated emails render as
`/cdn-cgi/l/email-protection` anchors), so `normalizeLinkTarget` is the primary
seam; the sitemap-side filter is defense in depth. **SWC constraint:** the
predicate lives in pure Node functions, NEVER inside the injected
`page.evaluate` IIFE. Same-origin, so no SSRF interaction.

### 3.2 Bucket 3 — one retry for transient Chrome errors

`Target.createTarget` / `Target closed` throw from `acquirePage()` at
`runner.ts:134` (before the try) and the re-acquire at `:373`; they are caught
at `site-audit-page.ts:300` and settled `error` — miscategorized as a domain
result. Fix, minimal and contract-respecting:

- Wrap the initial page acquire (`runner.ts:134`) so that if the acquire throws
  an `infrastructure`-classified error, it releases nothing (no page yet),
  waits a short bounded backoff, and re-acquires **once**. If the retry also
  fails, rethrow (the job's `maxAttempts:3` queue retry then applies, since an
  infrastructure error is now allowed to propagate as a *throw*, not a settle).
- **Decision (Codex fork):** retry at the runner acquire seam (preferred — one
  place, both the initial and re-acquire covered) vs a wrapper in
  `site-audit-page.ts` gated on `classifyRunnerError(err).kind === 'infrastructure'`.
  Either way: **only `infrastructure` retries; `http-status`/`non-html`/`ssrf`
  never do.** One retry only (evidence: `runner-retry.ts` — "one retry usually
  succeeds"; a generic retry layer is explicitly forbidden).
- Bound: reuse the existing browser-pool waiter; a small fixed delay
  (e.g. 500ms–1s) before re-acquire to let Chrome recover.

### 3.3 Bucket 4 — 301 "puppeteer did not auto-follow"

Single seam: `runner.ts:309-329`. Today a 3xx is classified `redirected`
(good, non-error) only when `location` present AND `redirectChain().length === 0`;
a Location-bearing 3xx with a *non-empty* chain is thrown as
`HTTP 3xx — … puppeteer did not auto-follow`. That asymmetry is the bug.

Fix: **relax the gate** so any Location-bearing 3xx is classified `redirected`
regardless of chain length, resolving `location` against `finalUrl`
(`response.url()`) rather than only the originally-requested URL (handles the
mid-chain http/https flip). Keep throwing only when there is **no** Location
header or the Location is malformed (a genuinely broken redirect). The 2xx
redirect-detection path (`detectRedirect` / `normalizeForRedirect`, already
protocol-flip-insensitive) is unchanged.

SSRF: the redirected target is **recorded, not re-fetched** by the runner
(child settles `redirected`, `pagesRedirected++`), so no `assertSafeHttpUrl`
re-check is required for recording. (Documented explicitly so a future "follow
the redirect" change knows to add the check.)

### 3.4 Bucket 1 — surface dead audited URLs as findings

**Capture (at page settle).** When `site-audit-page.ts` catches a `runAxeAudit`
throw, classify it. If `kind === 'http-status' && (status === 404 || status === 410)`,
write a durable row to a **new transient table `HarvestedPageError`**
(mirrors `HarvestedLink`), in the same post-settle fence that already gates
`HarvestedLink`/`HarvestedPageSeo` (a zombie attempt that lost the flip writes
none; chunked). The child still settles `error` and `pagesError++` as today —
this is *additive* capture, not a status change.

```prisma
model HarvestedPageError {
  id          String   @id @default(cuid())
  siteAuditId String
  url         String
  statusCode  Int      // 404 | 410
  createdAt   DateTime @default(now())
  @@index([siteAuditId])
}
```

**Emit (in the live-scan builder).** `broken-link-verify.ts` (the single
findings-run builder) reads `HarvestedPageError` alongside the other transient
tables, and a new pure mapper emits findings against the builder's shared
`runId` + `ensurePage`:

**New `lib/findings/dead-page-mapper.ts`:**

```ts
// One page-scope finding per dead URL (dedupKey pageFindingKey('dead_page', url));
// one run-scope finding count = distinct dead URLs. affectedSource:'live-scan-frontier'.
export function mapDeadPageFindings(
  rows: { url: string; statusCode: number }[],
  deps: { runId: string; ensurePage: EnsurePage; affectedComplete: boolean },
): FindingInput[]
```

- Finding `type: 'dead_page'`, `severity: 'warning'`, unit `pages`.
- The builder deletes `HarvestedPageError` after `writeFindingsRun` (same
  post-write deletion as `HarvestedLink`); empty set → no finding (no zero
  rows).
- Backstop `pruneHarvestedPageErrors()` (7-d) added to `runCleanup`, mirroring
  `pruneHarvestedLinks`.
- `recoverBrokenLinkVerifies` stranded-detection OR-set gains
  `HarvestedPageError` (so a dead-only audit still gets its verifier
  re-enqueued in the crash window).

**Register the type.** `finding-type-sets.ts` gains a `dead_page` entry + label
("Dead pages (404/410)"). Because the sweep's `loadSeoTool` already reads ALL
run-scope findings from the live-scan run, the run-scope `dead_page` count flows
into `/issues` + the digest automatically once the unit map (§3.5) knows it.

**Naming/severity are a Codex/Kevin fork** — `dead_page` vs `unreachable_page`
vs `sitemap_dead_url`; warning vs critical. Recommendation: `dead_page` /
warning (a 404 wastes crawl budget + hurts UX but is less severe than a broken
internal link that blocks a user mid-journey).

**Capture-home fork for Codex:** new `HarvestedPageError` table (preferred —
consistent with the C6 transient-table pattern, keeps the builder the single
findings owner, structured `statusCode` not free-text) vs a nullable
`errorKind`/`errorStatus` column on the existing child `AdaAudit` rows (smaller
migration, but couples the builder to child-row reads and mixes standalone
single-page audits into the same column).

### 3.5 Bucket 5 + the coverage-reason label fix (`lib/sweep`)

**Unit map (bucket 5).** `snapshot.ts` `unitForType` currently maps only
on-page + broken types; every validation type falls to the `groups` +
`logError` fallback. The validation mapper produces **11** types. Complete the
map (all run-scope counts are per §validation-mapper semantics):

| type | run-scope count meaning | unit |
|---|---|---|
| `canonical_broken`, `canonical_redirect` | distinct affected pages | `pages` |
| `redirect_chain`, `redirect_loop` | distinct affected pages | `pages` |
| `hreflang_broken`, `hreflang_no_return`, `hreflang_missing_self`, `hreflang_missing_x_default`, `hreflang_invalid_code` | distinct affected pages | `pages` |
| `canonical_external_unverified`, `hreflang_external_unverified` | distinct external targets | `targets` |
| `dead_page` (Bucket 1) | distinct dead URLs | `pages` |

**DRY the unit map.** Move the type→unit knowledge into a single client-safe
`findingUnit(tool, type): IssueUnit | null` in `finding-type-sets.ts` (the
declared "ONE home" of finding-type lists), and have `snapshot.ts`'s
`unitForType` delegate: ADA → `pages`; else `findingUnit(...) ?? (logError,
'groups')`. This prevents the next drift (the exact class of bug bucket 5 is).

**Reason vocabulary (label fix).** Thread `pagesError` into the classifier
input:

- `classify.ts` `PairObservation` gains `pagesError: number` (a `SiteAudit`
  scalar, cheap; shared by both tool pairs of an audit). Classification logic in
  `classifyCoverage` is unchanged (partial stays partial).
- `snapshot.ts` `loadAuditForSnapshot` selects `SiteAudit.pagesError` and
  populates the observation for both tool pairs.
- `snapshot.ts` `reasonFor` (the only change to the mapping):

  ```
  partial + discoveryCapped        → 'crawl-capped'
  partial + pagesError > 0         → 'pages-errored'      (was the false 'timed-out')
  partial + !attributionComplete   → 'attribution-incomplete'
  partial + (verifier-capped only) → 'coverage-capped'    (runStatus 'partial', no pagesError)
  ```

  `'timed-out'` is retired from run-status inference (a job that truly times out
  errors/exhausts; it does not produce a `partial` run). `PairCoverage.reason`
  is a free-form string in the type contract, so no parser/enum change is
  needed; the `/issues` + digest renderers display it verbatim (verify the
  renderer has no hardcoded `timed-out` string — grep).

### 3.6 UI surface (SEO tab)

The results-page SEO tab renders sections by finding-type-set. Add a small
`dead_page` surface: either a new `DeadPagesSection` (states: not-scanned /
none / list of dead URLs) or fold into the existing `BrokenLinksSection` as a
distinct tier. **Dark-mode variants on every element + the `mounted`-guard
hydration pattern.** Share view: include (read-only, token-validated,
server-loaded) consistent with the other SEO sections. Digest/`/issues`
rendering is automatic via the run-scope count (no bespoke UI beyond the
snapshot already surfacing group rows).

## 4. Data model / migration

- New table `HarvestedPageError` (§3.4) — hand-authored migration
  (`prisma migrate dev` is interactive-only here): create the table + index,
  `prisma generate`. Additive, no column-nullability change, no `createMany`
  concerns.
- No other schema change (the `errorKind`-column alternative would instead add
  one nullable column to `AdaAudit` — Codex fork).

## 5. Edge cases & failure modes

- **cdn-cgi in a real sitemap** (rare): still excluded — these are never real
  content pages.
- **A 404 that is transient** (server flapping): captured as a `dead_page`
  finding for that sweep; next week it self-resolves via the normal
  new→resolved change-state machinery. Conservative and self-correcting.
- **410 vs 404**: both surfaced (410 Gone is *more* definitively dead).
- **Bucket 3 retry exhausts**: infrastructure error propagates as a throw →
  queue `maxAttempts` retry → if still failing, `onSiteAuditPageExhausted`
  settles `error` (existing path). No infinite loop (one in-runner retry + the
  bounded queue attempts).
- **Bucket 4 malformed Location**: still thrown as error (genuine broken
  redirect) → counts toward `pagesError` → `pages-errored` label, but NOT a
  `dead_page` finding (not a 404/410).
- **seoOnly audits**: render-only path still settles pages error/redirected;
  capture + the live-scan builder run identically (seoOnly's only output is the
  live-scan run, so `dead_page` findings appear there too).
- **Builder crash between settle and build**: `HarvestedPageError` rows stranded
  → `recoverBrokenLinkVerifies` re-enqueues (OR-set includes the new table);
  7-d prune backstops truly orphaned rows.
- **`broken-link-verify.characterization.test.ts` is a FROZEN byte-identical
  gate** — reading a new transient table + emitting `dead_page` findings changes
  the happy-path output, so the characterization fixture must be **deliberately
  re-pinned** in the plan (not silently).

## 6. Testing strategy (TDD, per-task failing-test-first)

- `runner-errors.test.ts` — classifier over each kind (Target errors → infra;
  `HTTP 404` → http-status/404; SafeUrlError → ssrf; timeout patterns).
- `crawl-exclude.test.ts` — `/cdn-cgi/`, `/CDN-CGI/`, mid-path, query-only,
  false-positives (a real `/cdn-cginfo` path must NOT match).
- `sitemap-crawler.test.ts` / `link-harvest.test.ts` — cdn-cgi excluded from
  both producers.
- `runner.test.ts` — bucket 3 acquire retry (infra retried once, http-status
  not); bucket 4 non-empty-chain 3xx classified `redirected` not thrown.
- `site-audit-page.test.ts` — 404/410 → `HarvestedPageError` row written +
  child still `error`; infra error path; redirected path unchanged.
- `dead-page-mapper.test.ts` — page + run-scope findings, dedupKey, empty→none.
- `broken-link-verify` — reads + deletes `HarvestedPageError`; **re-pin the
  characterization fixture** with the new happy-path output.
- `snapshot.test.ts` — unit map covers all 11 validation types + `dead_page`
  (no `sweep_unmapped_issue_unit` for known types); `reasonFor` →
  `pages-errored` when `pagesError>0`, `crawl-capped`/`attribution-incomplete`
  precedence preserved.
- `finding-type-sets.test.ts` — `dead_page` label + `findingUnit` exhaustiveness.
- Gates: `npm run lint` + `npm test` + `npm run build`. `npm run smoke` (ADA
  pipeline touched — runner + site-audit-page). Prod verify after deploy:
  trigger a scan of a client with known sitemap 404s, confirm a `dead_page`
  finding + `pages-errored` label on the next `/issues`.

## 7. Rollout & verification

Standard pipeline. No new required-in-prod env var (the migration is additive
and applies via `prisma migrate deploy` in the deploy script). Post-deploy: one
client site-audit with known dead sitemap URLs → verify (a) no `/cdn-cgi/` in
the audited set, (b) a `dead_page` finding appears on the live-scan run, (c) the
results-page section renders, (d) — on the next weekly sweep or a manual snapshot
recompute — the coverage reason reads `pages-errored`, and the unit-map logError
is silent for validation types.

## 8. Open questions for Codex review

1. **Capture home:** new `HarvestedPageError` table (recommended) vs nullable
   `errorKind`/`errorStatus` column on child `AdaAudit`.
2. **Bucket 3 retry seam:** runner acquire (recommended) vs `site-audit-page`
   wrapper — and the backoff value.
3. **Finding naming/severity:** `dead_page` / warning (recommended) vs
   alternatives; whether 5xx should get its own low-severity finding later
   (leaning no).
4. **Bucket 4:** is relaxing the chain-length gate fully safe, or should a
   redirect-loop (Location pointing back into a cycle) still be an error? Does
   `detectRedirect` need to run on the reported `finalUrl` for the non-empty
   chain case?
5. **`findingUnit` home:** extending `finding-type-sets.ts` with a unit lookup
   (recommended) vs keeping the map local to `snapshot.ts`.
6. **Scope check:** is combining all five buckets + label fix into one PR the
   right granularity, or should bucket 1 (schema + UI) split into its own PR
   behind buckets 2–5?
