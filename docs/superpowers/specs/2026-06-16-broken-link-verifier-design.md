# C6 Phase 1 — Out-of-band Broken-Link / Resource Verifier (Design)

**Date:** 2026-06-16
**Status:** Spec (active). Track C item C6, first increment.
**Roadmap source:** `docs/superpowers/nyi/2026-06-04-screaming-frog-retirement-roadmap.md` §2 Phase 1 (⭐ highest priority) + §4 decision gates.
**Depends on:** C5 (source-agnostic ingestion contract — `FindingsBundle`, `source: 'live-scan'` reserved, both prune flags active). Lands the named C6 migration the C5 close-out specified.

---

## 1. Goal & non-goals

**Goal.** Find broken internal links and broken images on a client site and surface
them as normalized findings, by harvesting `<a href>` / `<img src>` targets from the
rendered DOM during the existing ADA site audit, then verifying the deduped target set
**out of band** (after the crawl) with a throttled, SSRF-guarded, capped checker. Results
land as a **live-scan `CrawlRun`** (`source: 'live-scan'`, `tool: 'seo-parser'`) sharing
the audit's `SiteAudit` origin — exercising, and requiring, the named C6 migration.

This unlocks the top-weighted roadmap categories that the live audit cannot yet produce:
`broken_internal_links` (priority weight 90) and `broken_images` (85) — the #2 / #3 weights
in `priority.service.ts`. (`broken_pages` (100) is already derivable from audited-page HTTP
statuses; see §3.)

**Non-goals (explicitly deferred to later C6 PRs):**
- Full on-page SEO extraction (titles/meta/H1/canonical/schema/word-count → live SEO score).
  The old `nyi/plans/2026-06-02-live-seo-on-ada.md` extraction layer (`parseSeoFromDocument`)
  is the right harvest code for that follow-up; this PR does not touch it.
- External-link verification, CSS/JS resource checks, redirect-chain analysis, canonical/
  hreflang target validation. Harvested external links are recorded but **not checked** in v1
  (WAF-ban + false-positive risk, per the SF doc).
- Hybrid discovery / BFS crawl (SF-retirement Phase 2) — discovery stays sitemap-first.

**Why harvest-first (vs sitemap-only).** The ADA scan already loads every discovered page and
records its HTTP status (children settle `complete` / `redirected` / `error`). A verifier that
only re-checks sitemap-discovered URLs is therefore redundant. The differentiated value lives in
the link/image *targets* harvested from the rendered DOM, which may point at URLs not in the
audited set at all. Phase 1 must harvest.

---

## 2. The named C6 migration (ships in THIS PR, before any live-scan write)

C5 documented this in `lib/findings/types.ts` and the adapter-readiness test: the writer's
delete-and-recreate keys on the origin FK, and `CrawlRun.siteAuditId` is `@unique`, so a second
run (live-scan) on the same `SiteAudit` would **clobber** the ada-audit run. The migration:

- **Schema:** remove `@unique` from `CrawlRun.siteAuditId`; add `@@unique([siteAuditId, tool])`.
  (`sessionId` and `adaAuditId` stay `@unique` — only `siteAuditId` ever carries two tools.)
  Hand-written migration SQL (drop the old unique index, create the compound one) applied with
  `prisma migrate deploy` (CLAUDE.md: `migrate dev` is interactive-only locally).
- **Writer** (`lib/findings/writer.ts`): the `siteAuditId` branch of the delete `where` becomes
  `{ siteAuditId_tool: { siteAuditId: run.siteAuditId, tool: run.tool } }`. The single-origin
  guard is unchanged. (The `sessionId` / `adaAuditId` branches are untouched.)
- **Readers** — re-key all six `findUnique({ where: { siteAuditId } })` call sites to the
  compound key with the tool they mean. All six want the **ada-audit** run:
  `lib/ada-audit/findings-fallback.ts:114`, `app/api/site-audit/[id]/vpat/route.ts:19`,
  `…/report/route.ts:27`, `…/csv/route.ts:58`, `app/ada-audit/site/share/[token]/page.tsx:30`,
  `app/ada-audit/site/[id]/page.tsx:142`. Each becomes
  `findUnique({ where: { siteAuditId_tool: { siteAuditId: id, tool: 'ada-audit' } } })`.
  (Grep-gate before the PR closes: zero remaining `where: { siteAuditId:` `findUnique` calls on
  `crawlRun`.)
- **Adapter-readiness test** (`lib/findings/adapter-readiness.test.ts`): the "DOCUMENTED
  LIMITATION" case flips from "second run clobbers the first → 1 row" to **"ada-audit and
  seo-parser runs coexist on the same SiteAudit → 2 rows, correct tools"**. The comment is
  rewritten to mark the limitation lifted.

This migration ships **first within the PR** so no live-scan write can clobber an ADA run at any
intermediate commit.

---

## 3. Data model

### 3.1 `HarvestedLink` — transient harvest scaffolding (new table)

Harvested targets must be persisted between the per-page scan (where they're discovered) and the
out-of-band verifier (which runs after the whole crawl). They are **scaffolding, not a permanent
store**: deleted by the verifier once findings are written; a retention sweep backstops audits
whose verify never completed.

```prisma
model HarvestedLink {
  id            String    @id @default(cuid())
  siteAuditId   String
  siteAudit     SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  sourcePageUrl String    // normalized URL of the page the target was found on
  targetUrl     String    // normalized absolute URL of the link/image target
  kind          String    // 'internal-link' | 'image' | 'external-link'
  createdAt     DateTime  @default(now())

  @@index([siteAuditId])
  @@index([siteAuditId, targetUrl])
}
```

Add `harvestedLinks HarvestedLink[]` back-relation to `SiteAudit`. `onDelete: Cascade` so a
deleted audit drops its harvest rows (matches `AdaAudit` children).

**Write path:** plain `createMany` inside the page-settle transaction (no upsert → no write
contention under `SITE_AUDIT_CONCURRENCY`). Per-page cap of 300 targets (links + images combined)
matches the old plan's `INTERNAL_OUTLINK_CAP`; truncation is recorded only as a per-run confidence
signal (see §5.4), not per row.

**Growth control (SF-doc named risk):** rows are deleted in bulk by the verifier after it writes
findings (`deleteMany({ where: { siteAuditId } })`), and a `pruneHarvestedLinks()` sweep in
`runCleanup()` deletes rows older than 7 days (covers audits whose verifier never ran — crash,
exhaustion). Steady-state `HarvestedLink` row count is therefore ~0 between audits.

### 3.2 The live-scan `CrawlRun` (existing tables, via the C5 contract)

The verifier produces a `FindingsBundle` and persists it through the existing `writeFindingsRun()`
— **no new write path**:

- `CrawlRun`: `tool: 'seo-parser'`, `source: 'live-scan'`, `siteAuditId` = the audit, `domain`/
  `clientId` copied from the `SiteAudit`, `status: 'complete'` (or `'partial'` if the cap or a
  fetch-error rate tripped — §5.4), `score: null` (Phase 1 emits no SEO score — that's the
  deferred MVP), `wcagLevel: null`, `pagesTotal` = count of source pages that had ≥1 harvested
  target, `startedAt`/`completedAt` = verifier window.
- `CrawlPage`: one row per **source page** that referenced ≥1 broken target (URL only; SEO
  scalars stay null — this run is broken-links-only). Needed so page-scope findings can FK a page.
- `Finding` (run scope): one per broken type with a non-zero count —
  `broken_internal_links`, `broken_images` — `severity: 'critical'`, `detail` = JSON
  `{ description }`, `dedupKey = runFindingKey(type)`, `affectedComplete` per §5.4,
  `affectedSource: 'live-scan-verify'`.
- `Finding` (page scope): one per (broken target, source page) pair —
  `type` = the broken category, `url` = the **broken target URL**, `pageId` = the source page,
  `dedupKey = pageFindingKey(type, targetUrl)`, `count: 1`. (A broken target referenced by N
  pages yields N page-scope findings, all sharing the target URL but distinct source pages — the
  same shape SEO findings already use for "affected URLs".)
- `Violation`: none (axe-only concept).

A run is **always written**, even with zero broken targets (empty findings) — so the migration's
two-runs-coexist path is exercised on every audit and the results UI can distinguish "verified,
none broken" from "not yet verified".

New finding types are SEO-domain strings already weighted in `priority.service.ts`
(`broken_internal_links`, `broken_images`). No priority-weight changes.

---

## 4. Harvest layer (during the ADA scan)

### 4.1 `lib/ada-audit/link-harvest.ts` (new, pure — mirrors `pdf-discovery.ts`)

```ts
export type HarvestedTargetKind = 'internal-link' | 'image' | 'external-link'
export interface HarvestedTarget { targetUrl: string; kind: HarvestedTargetKind }

// One page.evaluate reads every <a href> and <img src>; classify same-domain
// (internal-link / image) vs cross-domain (external-link) after normalization.
export async function harvestLinks(page: Page, auditedHost: string): Promise<HarvestedTarget[]>
```

- Normalizer: a `normalizeLinkTarget(raw, base)` that resolves relative URLs against the page URL,
  strips fragment, lowercases host, drops `mailto:` / `javascript:` / `tel:` / `data:` / bare-`#`.
  **Keep the query string** (unlike `normalizePdfUrl`) — `/p?id=7` and `/p?id=8` are different
  pages. Dedup within a page by `(kind, targetUrl)`.
- Same-domain classification compares the registrable host with `www.` stripped (reuse the
  pdf-discovery approach). Cross-domain → `external-link` (harvested, recorded, **not verified** in
  v1).
- Combined cap of 300 targets/page; returns a `truncated` flag alongside the list
  (`{ targets, truncated }`) so the caller can record it.

### 4.2 Wire into `runAxeAudit` (`lib/ada-audit/runner.ts`)

Add harvest next to the existing PDF harvest (Phase 3, after axe). Extend the `audited` variant of
`RunAxeResult`:

```ts
| { kind: 'audited'; axe; lighthouseSummary; lighthouseError;
    harvestedPdfUrls: string[];
    harvestedLinks: HarvestedTarget[]; harvestedLinksTruncated: boolean }
```

Harvest failure is non-fatal (try/catch → empty list + `console.warn`), identical to the PDF
harvest's contract. The `redirected` variant carries nothing (a redirected page has no audited DOM
to harvest). Standalone single-page audits also receive `harvestedLinks` but ignore it (no
`HarvestedLink` persistence outside site audits — v1 is site-audit only).

### 4.3 Persist in the page-settle transaction (`lib/jobs/handlers/site-audit-page.ts`)

In `runSiteAuditPageJob`, after computing `runResult.kind === 'audited'`, add a
`prisma.harvestedLink.createMany({ data: … })` to the **same** array-form `$transaction` that
settles the page (next to the counter bump). Map each `HarvestedTarget` to a row with
`siteAuditId`, `sourcePageUrl: job.url` (normalized), `targetUrl`, `kind`. Empty list → skip the
createMany (don't emit a no-op statement). This keeps harvest atomic with the page settle — a page
that settles has its links recorded or neither.

The per-page cap (300) keeps each createMany well under SQLite's bound-variable limit (300 × 4
cols = 1200 — chunk at 50 like the findings writer if needed; 300/50 = 6 statements).

---

## 5. The verifier job

### 5.1 Job type & lifecycle

New durable job type `broken-link-verify` (`lib/jobs/handlers/broken-link-verify.ts`):
- `concurrency: 1` (one verifier at a time across the box — this is throttle-sensitive network
  work; per-host throttling lives inside the handler).
- `maxAttempts: 2`, `backoffBaseMs: 60_000`.
- `timeoutMs: 600_000` (10 min — a large audit's deduped target set, throttled, can take minutes).
- `groupKey: site-audit:<siteAuditId>` — recovery already treats this group as audit liveness;
  the verifier is part of the audit's job family. `dedupKey: broken-link-verify:<siteAuditId>`.
- `payload: { siteAuditId, domain }`.
- `onExhausted`: **log only.** No partial run is written on exhaustion — the handler is restart-
  safe and idempotent (a retry re-reads `HarvestedLink` and redoes the work), so the queue's own
  retries are the recovery mechanism. After final exhaustion the `HarvestedLink` rows are left for
  the retention sweep and no live-scan run exists — absence means "not verified," which the UI
  shows as the not-yet-verified state (§6.1).

### 5.2 Enqueue point

Enqueued **fire-and-forget from `finalizeSiteAudit`**, at the `complete` transition only,
**after** the existing findings hook (which stays LAST among the *legacy/ADA* side effects — the
verifier enqueue is a new trailing step that does no DB writes itself, only an `enqueueJob`). It
must not block or fail the ADA terminal status. A thin `enqueueBrokenLinkVerify(siteAuditId,
domain)` facade mirrors `enqueuePsiJob` (dynamic import of `enqueueJob`, `.catch` logs — a failed
enqueue just means no live-scan run, same as a pre-A2 audit).

Guard: only enqueue when `LIGHTHOUSE_PROVIDER`-independent — verification is unconditional. Skip
the enqueue when `pagesError === pagesTotal` (nothing was scanned, no harvest exists) is a nice-to-
have, not required (an empty `HarvestedLink` set just yields an empty run).

### 5.3 Handler algorithm

1. Load `HarvestedLink` rows for the audit. If none → write an empty live-scan run (zero findings),
   delete nothing, return. (Distinguishes "verified, clean" from "never ran".)
2. **Dedupe** to a unique set of `(targetUrl, kind)` for verifiable kinds (`internal-link`,
   `image` only — `external-link` rows are loaded for completeness but **not checked** in v1),
   keeping a **sample of up to 25 source pages** per target (matches the C5 `URLS_PER_FINDING`
   convention for affected-URL lists).
3. **Cap** the unique target set at `BROKEN_LINK_MAX_CHECKS` (default 2000). If exceeded, verify
   the first 2000 (stable order) and mark the run `status: 'partial'` + `affectedComplete: false`;
   log the dropped count (no silent truncation — SF-doc / handoff rule).
4. **Check each target** with `safeFetch` (SSRF guard built in), HEAD first, GET fallback on 405 /
   501 / network-level HEAD rejection:
   - per-host throttle: a minimum delay (`BROKEN_LINK_HOST_DELAY_MS`, default 250 ms) between
     requests to the same host, enforced via a per-host last-request timestamp map; overall
     in-flight concurrency capped low (e.g. 4) and same-domain-first (the audited host dominates
     anyway since externals aren't checked).
   - timeout per request (`AbortSignal.timeout`, ~10 s).
   - **Classification:** final status `>= 400` → **broken** (the only thing counted as broken in
     v1). `safeFetch` throwing `SafeUrlError` (blocked/SSRF/too-many-redirects), network error, or
     timeout → **unconfirmed** — recorded/logged but **excluded from the broken counts** (§5.4
     trades recall for precision). 2xx/3xx-resolved → ok.
5. **Build the bundle:** broken `internal-link` targets → `broken_internal_links`; broken `image`
   targets → `broken_images`. Run-scope counts + page-scope findings per (broken target, sampled
   source page). Write via `writeFindingsRun`.
6. **Delete** `HarvestedLink` rows for the audit (`deleteMany({ where: { siteAuditId } })`).

Idempotency: a retry re-reads `HarvestedLink` (step 6 only runs on success), re-verifies, and
`writeFindingsRun`'s delete-and-recreate on `{ siteAuditId, tool: 'seo-parser' }` replaces any
partial prior run. Safe under crash-after-write-before-delete (rows linger → retention sweep) and
crash-before-write (rows linger → retry redoes it).

### 5.4 Confidence & honesty

The live-scan run records confidence signals so the UI never overclaims:
- `affectedComplete: false` (run-scope findings) when the per-run target set was **capped** or any
  source page's harvest was **truncated** (300/page); `true` otherwise.
- `status: 'partial'` when capped; `'complete'` otherwise.
- Network-error/timeout targets are surfaced **separately** from confirmed 4xx/5xx — v1 keeps it
  simple by **excluding timeout/network-error targets from the broken counts** (only confirmed
  `>= 400` statuses count as broken), logging the unconfirmed set. This trades recall for
  precision, matching the SF doc's "false positives erode trust" priority. (Revisit in a later
  phase with a confidence-labeled "possibly broken" tier.)

### 5.5 Config (env, all with defaults — no required new env)

`BROKEN_LINK_MAX_CHECKS` (2000), `BROKEN_LINK_HOST_DELAY_MS` (250), `BROKEN_LINK_CONCURRENCY` (4),
`BROKEN_LINK_REQUEST_TIMEOUT_MS` (10000). Parsed via the existing `parsePositiveInt`.

---

## 6. Surfacing

1. **Site-audit results page** (`app/ada-audit/site/[id]`): a "Broken links & images" section that
   reads the live-scan `CrawlRun` for the audit
   (`{ siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } }`) and lists broken targets grouped
   by type, with affected source-page samples and the confidence/partial banner. Renders a
   "not yet verified" state when no live-scan run exists, and a "verified — none broken" state when
   the run exists with zero findings.
2. **Dashboard / fleet (B2) — free.** The B2 findings panel and fleet "Issues" column read
   `Finding` rows by `CrawlRun` and are **source-agnostic** (C5 design). Broken-link findings from
   the live-scan run appear there automatically. **One verification needed:** confirm
   `findings-shared.ts` run-selection picks up `source: 'live-scan'` runs (the handoff names
   "findings-shared run-selection source-awareness" as a parked concern — for v1 the live-scan
   `seo-parser` run and the SF-upload `seo-parser` run won't coexist on the same domain via the
   same origin, so existing per-tool selection is correct; document the assumption).
3. **Priority / roadmap:** the new findings carry existing weighted types — no `priority.service`
   change. The srt_ roadmap memo export will include them once they're `Finding` rows (no export
   change needed).

---

## 7. Retention

- `pruneHarvestedLinks(now)` in `lib/findings/retention.ts` (or a sibling) deletes `HarvestedLink`
  rows with `createdAt < now − 7 d`; registered in `runCleanup()`'s `Promise.allSettled` list.
- The live-scan `CrawlRun` is covered by the **existing** 90-d findings retention
  (`pruneArchivedBlobs` — `PRUNE_ACTIVATED['seo-parser']` already active). It has no origin blob to
  null (the SiteAudit's `summary` blob belongs to the ada-audit run), so the live-scan run simply
  ages out with the audit; no new prune branch needed. Confirm the prune logic keys on the origin
  blob and doesn't trip on a blob-less seo-parser run sharing a SiteAudit (it filters on non-null
  origin FK + `tool`-specific blob — verify during implementation).

---

## 8. Testing

- **Migration / writer / readers:** adapter-readiness test flips to coexistence (2 runs). A new
  writer test: ada-audit run + seo-parser live-scan run on the same `siteAuditId` coexist; a second
  seo-parser write replaces only the seo-parser run. Reader smoke: the six re-keyed readers still
  fetch the ada-audit run.
- **`link-harvest.ts` (pure, jsdom):** internal vs external classification, image vs link, query
  preserved, fragment/mailto/js dropped, per-page dedup, cap + truncated flag.
- **Verifier handler (DB-backed, transport-injected):** `safeFetch` transport stubbed to return
  scripted statuses. Asserts: broken internal link → `broken_internal_links` count + page-scope
  finding with the target URL; broken image → `broken_images`; 2xx → no finding; SafeUrlError →
  skipped (not broken); cap → `partial` + `affectedComplete: false` + dropped-count log;
  `HarvestedLink` rows deleted on success; idempotent re-run replaces the run; empty harvest →
  empty run written. Use a unique domain prefix + tracked-id cleanup (test gotchas in the handoff).
- **Page-settle integration:** harvested links land in the same transaction as the counter bump;
  redirected/error pages persist no links.
- **Throttle:** per-host delay enforced (inject a clock or assert spacing via the transport mock's
  call timestamps — avoid real sleeps; pass an injectable `now`/delay).
- **Retention:** `pruneHarvestedLinks` deletes >7 d, keeps recent.
- Full suite + `tsc --noEmit` + `npm run build` green before PR.

## 9. Production verification (post-deploy)

On the weekly canary (`proway.erstaging.site`, client 31): trigger a site audit, confirm (a) the
ada-audit CrawlRun and a live-scan seo-parser CrawlRun **coexist** on the SiteAudit; (b) the
verifier job ran (`broken-link-verify` complete, attempts 1); (c) `HarvestedLink` rows for the
audit are gone post-verify; (d) the results page renders the broken-links section; (e) if the
canary has a known broken link, it's reported. Restart drill: `pm2 restart` mid-verify → the job
resumes (group liveness) and completes idempotently.

---

## 10. Decision gates honored (SF-retirement doc §4)

This PR satisfies the gate item **"Phase 1 broken-link verification is shipped and validated
against SF on representative clients"** — *shipped*; the *validate-against-SF* half is an analyst
parallel-run task, not code. The **daily-cadence gate** (C3) is untouched: this PR adds no
supersede-trimming, so `daily@` stays gated in `/api/clients/[id]/schedules`. SQLite-growth risk is
mitigated per §3.1 / §7. WAF-ban and false-positive risks are mitigated per §5.3 / §5.4.
