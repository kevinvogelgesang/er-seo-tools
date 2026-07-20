# Sweep Error Triage — design

**Status:** spec — Codex-reviewed (accept-with-fixes, 9 named fixes applied 2026-07-17)
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
- No *loosening* of coverage classification. One deliberate *tightening* is in
  scope (Codex fix #1): `pagesError>0` becomes a new conservative `partial`
  cause, so both tool pairs of an audit with page errors go `partial`. Partial
  pairs still never yield `fewer`/`resolved` (downward/absence) claims.
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
  | 'infrastructure'  // Chrome/pool/protocol ONLY — durable-queue-retryable (Bucket 3)
  | 'http-status'     // non-2xx the runner rejected; carries `status`
  | 'non-html'        // 2xx but not HTML (e.g. rss+xml) — CORRECT, not dead
  | 'ssrf'            // SafeUrlError.reason === 'policy' — never retry, never a finding
  | 'timeout'         // navigation timeout — handled by the in-nav retry, NOT queue-propagated
  | 'other'
export interface ClassifiedRunnerError { kind: RunnerErrorKind; status?: number }
export function classifyRunnerError(err: unknown): ClassifiedRunnerError
```

- **`infrastructure` is a NARROW set (Codex fix #3):** ONLY Chrome/pool/protocol
  failures — `Target.createTarget`, `Target closed`, frame-detach, pool-acquire
  errors — the ones that warrant durable-queue propagation (Bucket 3). This is
  DISTINCT from `runner-retry.ts`'s `isTransientRunnerError`, whose broader
  in-navigation fresh-page retry set (navigation timeout, frame-detach,
  `net::ERR_CERT_VERIFIER_CHANGED`) is UNCHANGED and stays local to
  `attemptNavigation`. Do NOT unify the two lists or promote all retry patterns
  to `infrastructure`; a navigation timeout is `timeout`, not `infrastructure`.
- `classifyRunnerError` parses `HTTP <n>` (already the runner's thrown format)
  into `http-status` + `status`. **SSRF (Codex fix #8):** map ONLY
  `SafeUrlError.reason === 'policy'` to `ssrf`; a `SafeUrlError` with reason
  `'dns'` / `'redirect'` / `'invalid-response'` is an operational failure →
  `other` (non-retryable, non-dead-page), never mislabeled as a policy block.

This classifier is the single home the domain-vs-infrastructure discipline
(architecture-contract §"Domain vs infrastructure errors") now points at.

**Provider-navigation-ownership dependency (Codex fix #4 — must resolve in the
plan).** The runner's explicit HTTP-status / 3xx inspection (`runner.ts:306-331`)
only runs when the runner owns `page.goto` — `LIGHTHOUSE_PROVIDER=pagespeed`
(prod), `off`, and render-only (seoOnly). Under `LIGHTHOUSE_PROVIDER=local`
Lighthouse may own navigation, with no equivalent status inspection, so Buckets
1 and 4 would not fire there. **Prod is `pagespeed` so the sweep is covered**,
but the plan MUST (a) verify the exact navigation-ownership branch in
`runner.ts` for site-audit pages (the axe pass may always own its own `goto`
independent of the Lighthouse portion — verify, don't assume), and then either
extend the status observation to a provider-independent main-document contract
OR explicitly scope Buckets 1/4 to runner-owned-navigation modes and document
the `local`-mode limitation. Tests must cover 404 + non-empty-chain 3xx under
BOTH navigation-ownership modes.

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

Two layers, both narrow (Codex ruling #2 + fix #2):

- **Runner acquire seam (in-runner, one retry).** Extract a single acquire
  helper covering BOTH the initial acquire (`runner.ts:134`) and the in-nav
  re-acquire (`:373`): if the acquire throws an `infrastructure`-classified
  error, wait a **750 ms** fixed delay and re-acquire **once**. If the retry
  also fails, rethrow. One retry only (evidence: `runner-retry.ts` — "one retry
  usually succeeds"; a generic retry layer is explicitly forbidden).
- **Handler propagation (`site-audit-page.ts:300`, Codex fix #2).** The catch
  around `runAxeAudit` must now branch on `classifyRunnerError(err).kind`:
  `'infrastructure'` → **rethrow** (so the durable queue's `maxAttempts:3` +
  backoff retry the whole page job on a fresh worker tick); **every other kind**
  keeps the current settle-as-domain-result behavior (child `error`,
  `pagesError++`, job completes). `onSiteAuditPageExhausted` already fences and
  settles a terminal child correctly when the queue attempts run out — no change
  there. This is the seam that today swallows `Target.createTarget` as a domain
  error.
- Tests: a running-child infrastructure retry (rethrow → re-run), a
  non-infrastructure error (settle, no rethrow), and terminal queue exhaustion
  (`onSiteAuditPageExhausted` settles `error`, no infinite loop).

### 3.3 Bucket 4 — 301 "puppeteer did not auto-follow"

Single seam: `runner.ts:309-329`. Today a 3xx is classified `redirected`
(good, non-error) only when `location` present AND `redirectChain().length === 0`;
a Location-bearing 3xx with a *non-empty* chain is thrown as
`HTTP 3xx — … puppeteer did not auto-follow`. That asymmetry is the bug.

Fix (Codex fix #7): **relax the chain-length gate** so a Location-bearing 3xx is
classified `redirected` regardless of chain length, resolving `location` against
`finalUrl` (`response.url()`) — not only the originally-requested URL — so the
mid-chain http/https flip resolves correctly. Retain the **error** path,
precisely, for: (a) no Location header, (b) malformed Location, and (c) a
**no-progress loop** — the normalized resolved target equal to the current
normalized final URL (a redirect pointing at itself). Optional full-cycle
detection may inspect the normalized `redirectChain()` URLs for a repeat and is
tested if added. `detectRedirect` / `normalizeForRedirect` is the successful-2xx
redirect detector and is **not** invoked on this terminal-3xx branch (Codex
ruling #4) — it stays unchanged. The reused normalization for the no-progress
comparison should match `normalizeForRedirect`'s protocol-insensitive rule.

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
  id          String    @id @default(cuid())
  siteAuditId String
  siteAudit   SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  url         String    // normalizeFindingUrl-normalized requested audited URL
  statusCode  Int       // 404 | 410
  createdAt   DateTime  @default(now())
  @@unique([siteAuditId, url])   // dup insert from a retry is harmless (Codex fix #5)
  @@index([siteAuditId])
}
```

(`SiteAudit` gains the `harvestedPageErrors HarvestedPageError[]` back-relation.
The `@@unique` makes a re-attempt's re-insert a no-op — P2002-guarded individual
create, never `createMany`+`skipDuplicates`.)

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

- Finding `type: 'dead_page'`, `severity: 'warning'`, unit `pages`. Page-scope
  finding `detail` carries `{ statusCode }`.
- **Do NOT populate `CrawlPage.statusCode` for dead-page rows (Codex fix #6):**
  the results-page "observed / analyzed" coverage math treats any non-null
  `CrawlPage.statusCode` as a successfully-analyzed page. `ensurePage(url)` for a
  dead URL must leave `statusCode` null so a 404 never inflates observed
  coverage or the live SEO score's denominator. The 404's status lives only in
  the finding `detail`.
- The builder deletes `HarvestedPageError` after `writeFindingsRun` (same
  post-write deletion as `HarvestedLink`); empty set → no finding (no zero
  rows).
- Backstop `pruneHarvestedPageErrors()` (7-d) added to `runCleanup`, mirroring
  `pruneHarvestedLinks`.
- `recoverBrokenLinkVerifies` stranded-detection OR-set gains
  `HarvestedPageError`, gated by the SAME `crawlRuns:{none:{tool:'seo-parser'}}`
  DB fence already used for retained `HarvestedPageSeo` (Codex fix #5) — so once
  the live-scan run commits, a surviving error row does NOT trigger repeated
  re-scans (Kevin verify item). A dead-only audit still gets its verifier
  re-enqueued in the crash window.

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

**Reason vocabulary + `pagesError` as a partial cause (label fix — Codex fix #1,
CORRECTED).** This is NOT a label-only change. Today a pair is `partial` only
when the run status is `'partial'` (or capped / not-attribution-complete); an
otherwise-complete run whose audit had `pagesError>0` would classify
`comparable`/`first-baseline` and `reasonFor` would return `null` — so
`pages-errored` could never appear. `pagesError>0` must therefore become an
independent, deliberately-conservative **partial cause**:

- `classify.ts` `PairObservation` gains `pagesError: number` (a `SiteAudit`
  scalar, cheap; shared by both tool pairs of the audit).
- `classify.ts` `classifyCoverage` adds `pagesError > 0` to the **partial
  predicate** (precedence 2, alongside `discoveryCapped` / `runStatus==='partial'`
  / `!attributionComplete`), BEFORE first-baseline/comparable. Effect: when an
  audit had page errors, BOTH its tool pairs go `partial` (no downward/absence
  claims), even if the SEO live-scan run itself completed. This slightly widens
  partial coverage — intentional and honest (errored pages mean neither tool's
  coverage is complete).
- `snapshot.ts` `loadAuditForSnapshot` selects `SiteAudit.pagesError` and
  populates the observation for both tool pairs.
- `snapshot.ts` `reasonFor` precedence:

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
  renderer has no hardcoded `timed-out` string — grep). **Non-goal amendment:**
  the earlier "classification unchanged, only the label changes" wording is
  superseded — a new conservative partial cause is in scope; what stays
  unchanged is that partial pairs still never yield `fewer`/`resolved` claims.

### 3.6 UI surface (SEO tab)

The results-page SEO tab renders sections by finding-type-set. Add a **separate
`DeadPagesSection`** (Codex ruling #6 — NOT folded into `BrokenLinksSection`;
frontier-404s are a distinct signal from link-target breakage), states:
not-scanned / none / list of dead URLs with their `statusCode` from finding
`detail`. **Dark-mode variants on every element + the `mounted`-guard hydration
pattern.** Wire the section into BOTH the authenticated results stack AND the
share-page stack (read-only, token-validated, server-loaded), consistent with
the other SEO sections. Digest/`/issues` rendering is automatic via the
run-scope count (no bespoke UI beyond the snapshot already surfacing group
rows).

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
- **`broken-link-verify.characterization.test.ts` stays FROZEN (Codex fix #9).**
  Its baseline has zero `HarvestedPageError` rows, so the builder's happy-path
  output is **byte-identical** — do NOT re-pin it. Cover the new behavior with a
  SEPARATE fixture/test that seeds 404/410 rows and asserts the page/run
  `dead_page` findings + post-write deletion.

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
- `broken-link-verify` — reads + deletes `HarvestedPageError`. Keep the existing
  characterization fixture FROZEN/byte-identical (empty table); add a SEPARATE
  fixture seeding 404/410 → asserts page/run `dead_page` findings + deletion.
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

## 8. Forks — RESOLVED by Codex review (2026-07-17, verdict: accept-with-fixes)

1. **Capture home** → new `HarvestedPageError` table (keeps the builder the sole
   findings owner; avoids polluting all `AdaAudit` children).
2. **Bucket 3 retry seam** → runner acquire helper (covers initial + re-acquire),
   **750 ms** fixed delay, one retry; PLUS `site-audit-page.ts` rethrows only
   `kind==='infrastructure'`.
3. **Finding naming/severity** → `dead_page`, `warning`; no 5xx finding (5xx is
   often transient → noisy churn).
4. **Bucket 4** → relax the chain-length gate with explicit no-progress/cycle
   handling; do NOT call `detectRedirect` on this terminal-3xx branch; recording
   is SSRF-safe (no follow-up fetch).
5. **`findingUnit` home** → `finding-type-sets.ts` (the client-safe declared
   registry; prevents the exact drift bucket 5 is about).
6. **Scope** → one PR, but **implementation order: B2 → B3 → B4 → the
   provider-status contract FIRST, then enable B1 capture** (so B1 never emits
   findings for noise B2/B3/B4 haven't yet filtered).

## 9. Kevin verification items (from Codex)

- A **local-Lighthouse** audit (not just prod PageSpeed) emits a 404/410
  `dead_page` — the provider-navigation-ownership resolution (§3.0) must hold in
  both modes.
- A `partial` pair with `pagesError>0` never produces `resolved`/`fewer` claims,
  while its positive `dead_page` observation still shows.
- Flapping-404 week-to-week `new`/`resolved` churn is acceptable, with the
  coverage badge making the evidence limit visible.
- Post-deploy: recovery does NOT repeatedly re-scan an audit after its live-scan
  run commits, even if an error row survived a crash (the
  `crawlRuns:{none:{tool:'seo-parser'}}` fence).
