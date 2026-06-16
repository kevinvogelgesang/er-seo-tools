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
run (live-scan) on the same `SiteAudit` would **clobber** the ada-audit run.

**Relation shape — `SiteAudit.crawlRun?` must become `crawlRuns[]` (Codex review, corrected).**
`SiteAudit.crawlRun CrawlRun?` (`prisma/schema.prisma:152`) is a **one-to-one** relation, which
*requires* the `@unique` on `CrawlRun.siteAuditId`. Removing `@unique` therefore forces the back-
relation to a list — `crawlRuns CrawlRun[]` — or `prisma validate` fails. (`Client.crawlRuns
CrawlRun[]` at line 29 is a *different* model; do not confuse them. `Session`/`AdaAudit` keep their
`crawlRun CrawlRun?` one-to-one relations and `@unique` FKs — only `siteAuditId` ever carries two
tools.) Consequently every `prisma.siteAudit` query that `include`s `crawlRun` (singular) must be
re-keyed to `crawlRuns: { where: { tool: 'ada-audit' }, select: … }` and read `[0]` — see the
reader list below.

The migration:

- **Schema:** remove `@unique` from `CrawlRun.siteAuditId`; add `@@unique([siteAuditId, tool])`.
  Hand-written migration SQL (drop the old unique index, create the compound one) applied with
  `prisma migrate deploy` (CLAUDE.md: `migrate dev` is interactive-only locally). SQLite allows
  multiple rows with `siteAuditId IS NULL` under a compound unique index, so session-origin and
  standalone-origin runs (`siteAuditId = NULL`) stay unconstrained — confirmed sound by Codex.
- **Writer** (`lib/findings/writer.ts`): the `siteAuditId` branch of the delete `where` becomes
  `{ siteAuditId_tool: { siteAuditId: run.siteAuditId, tool: run.tool } }`. The single-origin
  guard is unchanged. (The `sessionId` / `adaAuditId` branches are untouched.)
- **Readers — re-key the COMPLETE `findUnique({ where: { siteAuditId } })` set (10 sites, not the
  6 first drafted; Codex caught four).** Each wants the **ada-audit** run; rewrite to
  `findUnique({ where: { siteAuditId_tool: { siteAuditId: id, tool: 'ada-audit' } } })`:
  1. `lib/ada-audit/findings-fallback.ts:114`
  2. `app/api/site-audit/[id]/vpat/route.ts:19`
  3. `app/api/site-audit/[id]/report/route.ts:27`
  4. `app/api/site-audit/[id]/csv/route.ts:58`
  5. `app/ada-audit/site/share/[token]/page.tsx:30`
  6. `app/ada-audit/site/[id]/page.tsx:142`
  7. `lib/findings/parity.ts:218` (the `compareAdaParity` site-audit path)
  8. `lib/report/report-data.ts:146`
  9. `lib/services/site-audit-diff.ts:39` (`getSiteAuditInstanceDiff` — reads `wcagLevel`, ADA run)
  10. `scripts/findings-rebuild.ts:16` — its auto-detected `where` for a `siteAuditId` arg becomes
      the compound key; tool is now ambiguous for a SiteAudit origin, so default `tool: 'ada-audit'`
      and accept an optional tool arg (rebuilding the live-scan run is a rare manual op).
  Unaffected: `{ sessionId }` / `{ adaAuditId }` `findUnique`s keep their `@unique` keys; relation
  `include: { crawlRun: ... }` sites all hang off `Session`/`AdaAudit` (singular) or already use
  `crawlRuns` (list).
- **Relation-include readers (Codex fix #2 — also break when `crawlRun?`→`crawlRuns[]`):** five
  `prisma.siteAudit` queries `include`/`select` `crawlRun` singular and read `.crawlRun?.score`.
  Re-key each to `crawlRuns: { where: { tool: 'ada-audit' }, select: { …, score: true } }` and read
  `crawlRuns[0]?.score`:
  `app/api/site-audit/route.ts:83`, `app/api/clients/audit-summary/route.ts:40`,
  `app/api/audit-batches/[id]/route.ts` (nested under `siteAudits`),
  `lib/ada-audit/recents-query.ts` (the `prisma.siteAudit.findMany` branch),
  `lib/services/client-schedules.ts:48`. (The `prisma.adaAudit`/`prisma.session` `crawlRun` includes
  — e.g. `ada-audit/[id]/page.tsx:43`, `parse/history` — stay singular, unaffected.)
- **Close gate:** a grep for `crawlRun` on `prisma.siteAudit` queries (both `findUnique({where:{
  siteAuditId}})` and relation `include: { crawlRun }`) returns zero hits, and `tsc` compiles —
  removing the single-field unique makes both old shapes type errors, so the compiler enforces
  completeness.
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
  harvestTruncated Boolean @default(false) // this page hit the 300-target cap (fix #4)
  createdAt     DateTime  @default(now())

  @@index([siteAuditId])
  @@index([siteAuditId, targetUrl])
}
```

Add `harvestedLinks HarvestedLink[]` back-relation to `SiteAudit`. `onDelete: Cascade` so a
deleted audit drops its harvest rows (matches `AdaAudit` children).

**Write path (fix #3 — fenced to the settle outcome, not blindly in the txn):** the page-settle
`$transaction` flips the child via a conditional `updateMany` (claimable status); a **zombie attempt
that loses that flip must not still insert harvest rows**. So persist harvest **only when the settle
flip succeeded** — either via raw `INSERT … SELECT … WHERE EXISTS(child claimable)` chunks inside
the array txn, or (acceptable, simpler) as a `createMany` issued **after** `settlePage()` returns
`true`, explicitly accepting a small crash window (harvest is best-effort scaffolding — a missing
row just means that link isn't checked). v1 takes the post-settle path; the "atomic with the page
settle" framing is dropped. Plain `createMany` (no upsert → no contention). Per-page cap 300
combined; the `harvestTruncated` flag is written onto that page's rows (§3.1) so the verifier can
recover the per-run confidence signal.

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
- `CrawlPage`: one row per **source page** that referenced >=1 broken target (URL only; SEO
  scalars stay null — this run is broken-links-only). Needed so page-scope findings FK a real page.
- `Finding` (run scope): one per broken type with a non-zero count —
  `broken_internal_links`, `broken_images` — `severity: 'critical'`, `dedupKey = runFindingKey(type)`,
  `count` = **number of distinct broken target URLs** of that type (the headline metric — Codex
  "things to verify" #5 resolved: count = distinct broken targets, NOT source-page occurrences),
  `affectedComplete` per §5.4. `detail` = JSON carrying the description **and the confidence block**
  (fix #11): `{ description, checked, broken, unconfirmed, capped, harvestTruncated }` so the UI can
  explain why `affectedComplete` is false / results may be incomplete without re-deriving anything.
- `Finding` (page scope) — **keyed by SOURCE PAGE, not by target** (fix #3, a real bug in the first
  draft): `Finding` has `@@unique([runId, dedupKey])`, so keying N source pages on the same
  `pageFindingKey(type, targetUrl)` would COLLIDE and the bundle would be rejected. Instead emit
  **one page-scope finding per (type, source page)**: `url` = the **source page URL**, `pageId` =
  that source page's `CrawlPage`, `dedupKey = pageFindingKey(type, sourcePageUrl)` (collision-free —
  each source page appears once per type), `count` = number of broken targets of that type on the
  page, `detail` = JSON `{ brokenTargetUrls: [<= 25 sample] }`. This matches the existing
  affected-URL UX exactly (the "affected pages" of a broken-link issue ARE the source pages), and
  the broken-target URLs ride in `detail`.
- `Violation`: none (axe-only concept).

`affectedSource` (fix #4): the DB column is a free string, but `AggregatedResult.Issue.affectedUrlSource`
is a closed union (`'derived-page-index' | 'parser-complete' | 'parser-sample'`). Since the
live-scan run flows through `seo-findings-fallback` -> `AggregatedResult`, add `'live-scan-verify'`
to that union (small type change) rather than emit an unchecked cast outside the declared contract.

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
- Same-domain classification is **exact host match, `www.`-insensitive** in v1 (e.g.
  `example.com` == `www.example.com`; `cdn.example.com` is treated as cross-domain → `external-link`).
  This is the documented v1 semantic (fix #15); a registrable-domain/subdomain match
  (`host === root || host.endsWith('.' + root)`, with an anti-`evil-example.com` guard) is a later
  refinement. Cross-domain → `external-link` (harvested, recorded, **not verified** in v1).
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

**Chunking is mandatory, not conditional (fix #8):** 300 rows × 4 cols = 1200 bindings exceeds
SQLite's classic 999-variable limit, so the `createMany` MUST be chunked at 50 (reuse the findings
writer's `chunk()` discipline — 300/50 = 6 statements, each spliced into the page-settle
`$transaction` array). A single un-chunked 300-row insert would fail at runtime.

---

## 5. The verifier job

### 5.1 Job type & lifecycle

New durable job type `broken-link-verify` (`lib/jobs/handlers/broken-link-verify.ts`):
- `concurrency: 1` (one verifier at a time across the box — this is throttle-sensitive network
  work; per-host throttling lives inside the handler).
- `maxAttempts: 2`, `backoffBaseMs: 60_000`.
- `timeoutMs: 900_000` (15 min). At `BROKEN_LINK_MAX_CHECKS=2000` with a 250 ms per-host delay,
  pure-sequential checking would approach/exceed 10 min, so the handler runs **bounded concurrency**
  (`BROKEN_LINK_CONCURRENCY` workers) that share one per-host throttle (fix #8 — the spec's
  concurrency claim is now actually implemented, not aspirational); 15 min is the safety ceiling.
- `groupKey: site-audit:<siteAuditId>` with `dedupKey: broken-link-verify:<siteAuditId>`.
  **Group-key safety invariant (fix #12, state it explicitly):** recovery treats the
  `site-audit:<id>` group as *audit liveness* — a transient (non-terminal) parent with outstanding
  jobs in that group is resumed, and a parent with zero is finalized/failed. Reusing this group for
  the verifier is safe **only because the verifier is enqueued strictly AFTER the parent reaches
  terminal `complete`** (§5.2), and `finalizeSiteAudit` early-returns on `complete` — so a pending
  verifier job can never cause recovery to re-finalize or fail an already-complete audit. (This is
  the opposite choice from `report-render`, which deliberately uses `report:<id>` precisely to stay
  out of the liveness group; the verifier *wants* the audit family for cancel-on-delete semantics
  and is only allowed in because it runs post-terminal.)
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

Guard: verification is unconditional (independent of `LIGHTHOUSE_PROVIDER`). Skipping the enqueue
when `pagesError === pagesTotal` is a nice-to-have, not required (an empty `HarvestedLink` set just
yields an empty run).

**Enqueue-recovery path (fix #7 — required, "durable verifier" is otherwise overstated).**
Fire-and-forget enqueue after a terminal transition has a crash window: the audit is `complete`,
`HarvestedLink` rows exist, but the box died between the terminal write and the `enqueueJob`. Because
`finalizeSiteAudit` early-returns on `complete`, this never self-heals. Add a reconciliation sweep
(in `recoverQueue()` at boot and in the 10-min `resetStaleAudits` pass): find `complete` `SiteAudit`s
that have `HarvestedLink` rows, **no** active `broken-link-verify` job in their group, **and** no
existing live-scan `CrawlRun` (`{ siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } }`), and
re-enqueue the verifier for each. The `dedupKey` makes re-enqueue idempotent if a job is already
queued. Bounded query (indexed on `HarvestedLink.siteAuditId`); skip on read error like the existing
recovery passes.

### 5.3 Handler algorithm

1. Load `HarvestedLink` rows for the audit. If none → write an empty live-scan run (zero findings),
   delete nothing, return. (Distinguishes "verified, clean" from "never ran".)
2. **Dedupe** to a unique set of `(targetUrl, kind)` for verifiable kinds (`internal-link`,
   `image` only — `external-link` rows are loaded for completeness but **not checked** in v1),
   keeping a **sample of up to 25 source pages** per target (matches the C5 `URLS_PER_FINDING`
   convention for affected-URL lists).
3. **Cap** the unique target set at `BROKEN_LINK_MAX_CHECKS` (default 2000) in a **deterministic
   order** (fix #7 — the `HarvestedLink.findMany` carries an explicit `orderBy` on
   `[targetUrl, kind, sourcePageUrl]` so the capped subset is stable across retries). If exceeded,
   verify the first 2000 and mark the run `status: 'partial'` + `affectedComplete: false`; log the
   dropped count (no silent truncation — SF-doc / handoff rule).
4. **Check each target** with `safeFetch` (SSRF guard built in), HEAD first:
   - per-host throttle: a minimum delay (`BROKEN_LINK_HOST_DELAY_MS`, default 250 ms) between
     requests to the same host, enforced via a per-host last-request timestamp map; overall
     in-flight concurrency capped low (e.g. 4) and same-domain-first (the audited host dominates
     anyway since externals aren't checked).
   - timeout per request (`AbortSignal.timeout`, ~10 s).
   - **HEAD→GET to avoid HEAD false positives (fix #10):** many servers mishandle HEAD. So do NOT
     declare broken on a HEAD `>= 400` alone — **confirm EVERY HEAD `>= 400` (and any network-level
     HEAD rejection / 405 / 501) with a follow-up GET**, and classify on the GET result. This is the
     v1 precision posture (recall is a later concern).
   - **Always drain/cancel response bodies** (`response.body?.cancel()` or read-and-discard) so the
     verifier doesn't leak sockets over thousands of checks — reuse `safeFetch`'s body handling.
   - **Classification:** final (post-GET) status `>= 400` → **broken** (the only thing counted as
     broken in v1). `safeFetch` throwing `SafeUrlError` (blocked/SSRF/too-many-redirects), network
     error, or timeout → **unconfirmed** — counted in the confidence block but **excluded from the
     broken counts** (§5.4 trades recall for precision). 2xx/3xx-resolved → ok.
5. **Build the bundle:** broken `internal-link` targets → `broken_internal_links`; broken `image`
   targets → `broken_images`. Run-scope counts (distinct broken targets) + confidence block in
   `detail`; page-scope findings keyed by source page (§3.2). Write via `writeFindingsRun`.
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
- **Confidence is PERSISTED, not just logged (fix #11):** each run-scope finding's `detail` carries
  `{ description, checked, broken, unconfirmed, capped, harvestTruncated }` (see §3.2). The UI reads
  these to explain *why* `affectedComplete` is false or results may be incomplete — without this the
  banner can't justify itself.
- Network-error/timeout/`SafeUrlError` targets are **excluded from the broken counts** (only
  confirmed post-GET `>= 400` count as broken) but tallied in `unconfirmed`. This trades recall for
  precision, matching the SF doc's "false positives erode trust" priority. (A confidence-labeled
  "possibly broken" tier is a later phase.)

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
2. **Dashboard / fleet (B2) — source-aware selection REQUIRED, NOT "free" (fix #5, a real
   regression risk).** B1/B2 run-selection in `findings-shared.ts` currently picks the latest
   `seo-parser` run *by tool, ignoring source*. A live-scan broken-link run has `score: null` and
   carries only broken-link findings — if it becomes the "current SEO run" for a client/domain it
   would **hide the latest SF-upload findings and health score**. So before shipping:
   - Keep the latest **`sf-upload`** `seo-parser` run as the canonical SEO **health/score** run
     (the dashboard score + the full SEO findings set continue to come from it).
   - Surface the latest **`live-scan`** run's broken-link findings **additively** (either merge the
     two runs' findings deliberately for the panel, or render broken-links as a distinct auxiliary
     block). Never let a `live-scan` run displace an `sf-upload` run in score/selection.
   - This makes `findings-shared.ts` run-selection **source-aware** — the "parked concern" the
     handoff named is now in-scope and must land in this PR with tests covering an `sf-upload` run
     and a newer `live-scan` run coexisting for the same client.
3. **Priority:** the new findings carry existing weighted types (`broken_internal_links: 90`,
   `broken_images: 85`) — no `priority.service` change.
   **Roadmap (fix #6 — claim corrected):** the srt_/seo-roadmap memo export is **session-bound**
   (built from `Session.result` / the technical-audit export), NOT from site-audit-origin live-scan
   findings, so it does **not** automatically include these. Roadmap integration is explicitly
   **later work**; this PR surfaces broken links via the results page (§6.1) and the B2/client
   findings panel (§6.2) only.

---

## 7. Retention

- `pruneHarvestedLinks(now)` in `lib/findings/retention.ts` (or a sibling) deletes `HarvestedLink`
  rows with `createdAt < now − 7 d`; registered in `runCleanup()`'s `Promise.allSettled` list.
- **`pruneArchivedBlobs` MUST be made tool-origin-aware (fix #9 — a latent bug C6 introduces, not
  a "verify later").** Today it selects runs for a tool where *any* origin FK is non-null, then nulls
  `Session.result` + `SiteAudit.summary` + `AdaAudit.result` in one txn — correct only under the
  pre-C6 invariant that a `seo-parser` run *only ever* has `sessionId`. C6 breaks that: a `seo-parser`
  **live-scan run carries `siteAuditId`**, so the seo-parser prune would feed that id into the
  `SiteAudit.updateMany({ data: { summary: null } })` statement and **wipe the ADA run's `summary`
  blob** (`lib/findings/retention.ts:70,87`). Required change: for `tool: 'seo-parser'`, restrict
  selection to **session-origin runs** (`sessionId: { not: null }`) and never put `siteAuditId`s into
  the `summary`-null statement. The live-scan run has **no origin blob of its own** (its data lives
  entirely in findings tables, which are never pruned), so it is simply **not pruned** — no
  `archivePrunedAt` stamp, no blob touched; its broken-link findings persist like all findings.
  `SiteAudit.summary` is nulled **only** under the `ada-audit` branch (unchanged). Regression test:
  an aged seo-parser live-scan run sharing a SiteAudit with an un-aged ada-audit run is left
  untouched and the ADA `summary` survives.
- `pruneHarvestedLinks` (§3.1) covers the transient scaffolding; no other new retention is needed.

---

## 8. Testing

- **Migration / writer / readers:** adapter-readiness test flips to **coexistence** — ada-audit
  run + seo-parser live-scan run on the same `siteAuditId` yield **2 rows with correct tools**
  (was: 1 row, clobbered). New writer test: a second seo-parser write replaces only the seo-parser
  run, leaving the ada-audit run intact. Reader smoke: the re-keyed readers (all 10) still fetch the
  ada-audit run via the compound key. SQLite check: two `siteAuditId IS NULL` seo-parser runs
  (distinct sessions) still coexist under the compound index.
- **Finding dedup (fix #3):** a broken target referenced by N source pages produces N page-scope
  findings keyed by **source page** (no `@@unique([runId, dedupKey])` collision); run-scope count =
  distinct broken targets. Assert the bundle writes without a unique-constraint error.
- **Source-aware selection (fix #5):** with an `sf-upload` seo-parser run AND a newer `live-scan`
  seo-parser run for the same client/domain, B1/B2 selection keeps the `sf-upload` run as the
  score/health source and surfaces live-scan broken-link findings additively — the live-scan run
  never displaces the sf-upload score.
- **`link-harvest.ts` (pure, jsdom):** internal vs external classification, image vs link, query
  preserved, fragment/mailto/js dropped, per-page dedup, cap + truncated flag.
- **Verifier handler (DB-backed, transport-injected):** `safeFetch` transport stubbed to return
  scripted statuses. Asserts: broken internal link → `broken_internal_links` count + page-scope
  finding on the **source page**; broken image → `broken_images`; **HEAD 4xx confirmed by GET 4xx →
  broken, but HEAD 4xx with GET 2xx → NOT broken (fix #10)**; 2xx → no finding; SafeUrlError /
  timeout → unconfirmed (not broken) and tallied in the `detail` confidence block (fix #11); cap →
  `partial` + `affectedComplete: false` + dropped-count log; `HarvestedLink` rows deleted on
  success; idempotent re-run replaces the run; empty harvest → empty run written. Unique domain
  prefix + tracked-id cleanup (test gotchas in the handoff).
- **Enqueue-recovery (fix #7):** a `complete` SiteAudit with `HarvestedLink` rows, no active verify
  job, and no live-scan run gets the verifier re-enqueued by the reconciliation sweep; idempotent
  if already queued.
- **Page-settle integration:** harvested links land in the same transaction as the counter bump
  (chunked at 50, fix #8); redirected/error pages persist no links.
- **Throttle:** per-host delay enforced (inject a clock or assert spacing via the transport mock's
  call timestamps — avoid real sleeps; pass an injectable `now`/delay).
- **Retention:** `pruneHarvestedLinks` deletes >7 d, keeps recent; **`pruneArchivedBlobs` leaves an
  aged seo-parser live-scan run (and the shared SiteAudit's ADA `summary`) untouched (fix #9).**
- Full suite + `tsc --noEmit` + `npm run build` green before PR.

## 9. Production verification (post-deploy)

On the weekly canary (`proway.erstaging.site`, client 31): trigger a site audit, confirm (a) the
ada-audit CrawlRun and a live-scan seo-parser CrawlRun **coexist** on the SiteAudit; (b) the
verifier job ran (`broken-link-verify` complete, attempts 1); (c) `HarvestedLink` rows for the
audit are gone post-verify; (d) the results page renders the broken-links section; (e) if the
canary has a known broken link, it's reported. Restart drill: `pm2 restart` mid-verify → the
interrupted `broken-link-verify` job is re-queued by standard job-interruption recovery (attempt 2,
"interrupted by restart") and completes idempotently (re-reads `HarvestedLink`, re-writes the run).
Also verify the enqueue-recovery sweep (fix #7): leave `HarvestedLink` rows with no verify job and
confirm boot/`resetStaleAudits` re-enqueues one.

---

## 10. Decision gates honored (SF-retirement doc §4)

This PR satisfies the gate item **"Phase 1 broken-link verification is shipped and validated
against SF on representative clients"** — *shipped*; the *validate-against-SF* half is an analyst
parallel-run task, not code. The **daily-cadence gate** (C3) is untouched: this PR adds no
supersede-trimming, so `daily@` stays gated in `/api/clients/[id]/schedules`. SQLite-growth risk is
mitigated per §3.1 / §7. WAF-ban and false-positive risks are mitigated per §5.3 / §5.4.
