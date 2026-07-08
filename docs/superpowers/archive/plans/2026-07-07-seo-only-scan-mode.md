# SEO-Only Scan Mode + URL Scan Form (C11 PR 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a render-only `seoOnly` site-audit mode (navigate + settle + harvest links/on-page SEO; skip axe, screenshots, PDF dispatch, PSI) plus a URL scan form on `/seo-parser` that triggers it, ~4× cheaper than the paired ADA pipeline.

**Architecture:** A new `SiteAudit.seoOnly` boolean rides the existing enqueue → discover → page-job → finalizer → broken-link-verify pipeline. The page job reads `seoOnly` off the **parent row** (authoritative) and takes a render-only runner path; the finalizer skips all ADA output (summary, carry-forward, ada-audit dual-write) but still enqueues `broken-link-verify`, which builds the SEO "live-scan" `CrawlRun` exactly as today. ADA-facing surfaces are guarded so a seoOnly row is never presented as an accessibility audit.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, Vitest, Tailwind (class-based dark mode), the durable in-process job queue.

**Spec:** `docs/superpowers/specs/2026-07-07-seo-only-scan-mode-design.md` (Codex-reviewed).

**Plan review:** Codex reviewed this plan "ACCEPT WITH NAMED FIXES" (2026-07-07) — all 9 fixes applied (test-harness realities: mocked `enqueueAudit` in queue-request, no existing `runner.test.ts`, `renderOnly` must gate both LH paths, finalizer ordering preserved, `route.fallback.test.ts` for DB-backed GET, `StatusPill` tones + jsdom + no jest-dom + sessionStorage-on-mount, `audit-batches` route paths, existing quick-widget 409 test, recovery re-enqueue bound).

## Global Constraints

- **SQLite migration = additive only.** New column `seoOnly BOOLEAN NOT NULL DEFAULT false`; no `ALTER COLUMN` nullability, no `createMany`+`skipDuplicates`, P2002-guarded individual creates.
- **`seoOnly ⇒ seoIntent`** enforced at enqueue (`queueSiteAuditRequest`). Never collapse the two meanings; no `scanMode` enum.
- **Parent row is authoritative** for the page job's mode — payload is a hint at most.
- **A seoOnly audit must NEVER produce a `tool:'ada-audit'` `CrawlRun`, ADA summary, or carry-forward.** ADA exports (report/csv/vpat) gate on the ada run's existence — an empty one would look valid.
- **Array-form `$transaction([...])` only**; raw SQL sets `updatedAt` manually (`Date.now()`, integer ms).
- **UI:** `dark:` variant on every element; no hydration-mismatch patterns; any new Tailwind class must be reachable by the content globs.
- **Gate-green before PR:** `npm run lint` (tsc) + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`.
- **Every new/changed route needs middleware coverage** (`middleware.test.ts` case) per repo invariant.
- **Migration local quirk:** `prisma migrate dev` is interactive-only here — author `migration.sql` by hand and apply with `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma generate`.

---

### Task 1: Schema + enqueue plumbing (`seoOnly` column, force `seoIntent`)

**Files:**
- Modify: `prisma/schema.prisma` (model `SiteAudit`, beside `seoIntent` at ~L151)
- Create: `prisma/migrations/<timestamp>_seo_only/migration.sql`
- Modify: `lib/ada-audit/queue-manager.ts` (`EnqueueAuditOptions` ~L72, `create` block ~L108-122)
- Modify: `lib/ada-audit/queue-request.ts` (`QueueRequestInput` ~L23, enforce+pass ~L75-81)
- Modify: `app/api/site-audit/route.ts` (parse `seoOnly` ~L36, pass ~L42-49)
- Test: `lib/ada-audit/queue-request.test.ts` (extend existing) + `app/api/site-audit/route.test.ts` (extend if present, else create)

**Interfaces:**
- Produces: `SiteAudit.seoOnly: boolean`; `EnqueueAuditOptions.seoOnly?: boolean`; `QueueRequestInput.seoOnly?: boolean`; `POST /api/site-audit` accepts `seoOnly?: boolean`.
- Consumes: nothing (foundational task).

- [ ] **Step 1: Write the failing tests** — `queue-request.test.ts` **mocks `enqueueAudit`**, so assert on the mock's args (do NOT query Prisma by returned id there). Put the actual DB-write coverage in the `queue-manager` suite (which creates rows).

```ts
// lib/ada-audit/queue-request.test.ts  (add to the existing suite; enqueueAudit is already vi.mock'd)
it('C11: seoOnly forces seoIntent in the enqueueAudit call', async () => {
  const domain = `${PREFIX}seoonly.example.edu`
  await queueSiteAuditRequest({ domain, clientId: null, wcagLevel: 'wcag21aa', seoOnly: true })
  expect(enqueueAuditMock).toHaveBeenLastCalledWith(
    domain, null, 'wcag21aa',
    expect.objectContaining({ seoOnly: true, seoIntent: true }),
  )
})
```
```ts
// lib/ada-audit/queue-manager.test.ts (or the DB-backed enqueue suite): verify the column persists
it('C11: enqueueAudit writes seoOnly + seoIntent to the row', async () => {
  const { id } = await enqueueAudit(`${PREFIX}seoonly2.example.edu`, null, 'wcag21aa', { seoOnly: true, seoIntent: true })
  const row = await prisma.siteAudit.findUnique({ where: { id }, select: { seoOnly: true, seoIntent: true } })
  expect(row).toEqual({ seoOnly: true, seoIntent: true })
})
```
Also update any EXISTING queue-request assertion that snapshots the `enqueueAudit` opts object to include `seoOnly: false` (or switch it to `expect.objectContaining`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-request.test.ts lib/ada-audit/queue-manager.test.ts -t "C11"`
Expected: FAIL — `seoOnly` not forwarded / column does not exist.

- [ ] **Step 3a: Add the schema field** — in `prisma/schema.prisma`, model `SiteAudit`, directly below `seoIntent Boolean @default(false)`:

```prisma
  seoOnly       Boolean  @default(false)
```

- [ ] **Step 3b: Author the migration SQL** — `prisma/migrations/<timestamp>_seo_only/migration.sql` (use a UTC timestamp folder name like `20260707140000_seo_only`):

```sql
-- AddSeoOnly
ALTER TABLE "SiteAudit" ADD COLUMN "seoOnly" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3c: Apply the migration + regenerate the client**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: migration applied; client regenerated.

- [ ] **Step 3d: Thread through `EnqueueAuditOptions` + the create block** — `lib/ada-audit/queue-manager.ts`:

```ts
// EnqueueAuditOptions
  /** C11: render-only SEO scan (skips axe/screenshots/PDF/PSI). Implies seoIntent. */
  seoOnly?: boolean
```
```ts
// inside enqueueAudit: destructure
  const { requestedBy, scheduleId, seoIntent, seoOnly } = opts
```
```ts
// in prisma.siteAudit.create data, beside seoIntent:
      seoIntent: seoIntent ?? false,
      seoOnly: seoOnly ?? false,
```

- [ ] **Step 3e: Enforce `seoOnly ⇒ seoIntent` in `queueSiteAuditRequest`** — `lib/ada-audit/queue-request.ts`:

```ts
// QueueRequestInput
  /** C11: render-only SEO scan mode. Forces seoIntent. */
  seoOnly?: boolean
```
```ts
// where enqueueAudit is called (~L76), replace the opts object:
  const seoOnly = input.seoOnly === true
  const { id } = await enqueueAudit(domain, input.clientId, wcagLevel, {
    preDiscoveredUrls: normalisedUrls,
    requestedBy: input.requestedBy ?? null,
    scheduleId: input.scheduleId ?? null,
    seoIntent: (input.seoIntent ?? false) || seoOnly,
    seoOnly,
  })
```

- [ ] **Step 3f: Parse `seoOnly` in the route** — `app/api/site-audit/route.ts`, after the `seoIntent` line:

```ts
  const seoOnly = raw?.seoOnly === true
```
```ts
// add to the queueSiteAuditRequest({...}) call:
    seoIntent,
    seoOnly,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/queue-request.test.ts -t "seoOnly forces"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/ada-audit/queue-manager.ts lib/ada-audit/queue-request.ts lib/ada-audit/queue-request.test.ts app/api/site-audit/route.ts
git commit -m "feat(c11): SiteAudit.seoOnly column + enqueue plumbing (forces seoIntent)"
```

---

### Task 2: Render-only runner path (`renderOnly` → `kind:'rendered'`)

**Files:**
- Modify: `lib/ada-audit/runner.ts` (`RunAxeOptions` L34, `RunAxeResult` L47-67, the audit body — skip axe L312-347 + screenshots L350-362 **and BOTH Lighthouse paths** when `renderOnly`, keep harvest L374-388)
- Test: **create** `lib/ada-audit/runner.test.ts` (no runner test exists today; mock the browser-pool/page + harvest the way other pool consumers are mocked)

> **Codex note (Task 2):** `renderOnly` must skip **both** Lighthouse code paths — local-LH runs *before* the normal nav/settle branch and PageSpeed inline/queue logic runs *before* axe — gate each with `!renderOnly`. Scope the guard carefully so non-render behavior (incl. PDF harvest) is byte-for-byte unchanged. The `runAxeAudit` call in tests MUST pass `auditId` (it's required) or it throws before reaching render-only logic.

**Interfaces:**
- Consumes: nothing new.
- Produces: `RunAxeOptions.renderOnly?: boolean`; new `RunAxeResult` variant `{ kind: 'rendered'; finalUrl?: string; redirected?: boolean; harvestedLinks: HarvestedTarget[]; harvestedLinksTruncated: boolean; harvestedPageSeo: RawPageSeo | null }` (no `axe`, no `lighthouseSummary`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/ada-audit/runner.test.ts (new file)
it('C11: renderOnly returns kind:rendered with harvest and no axe', async () => {
  // Arrange: mock browser-pool acquirePage + the injected harvest so nav/settle/harvest resolve.
  const res = await runAxeAudit('https://example.edu/', 'wcag21aa', undefined, { auditId: 'a1', renderOnly: true })
  expect(res.kind).toBe('rendered')
  if (res.kind === 'rendered') {
    expect(res).not.toHaveProperty('axe')
    expect(Array.isArray(res.harvestedLinks)).toBe(true)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/runner.test.ts -t "renderOnly"`
Expected: FAIL — `renderOnly` not honored; `kind` is `'audited'`.

- [ ] **Step 3a: Extend the option + result types** — `lib/ada-audit/runner.ts`:

```ts
// RunAxeOptions
  /** C11: render-only SEO scan — skip axe + screenshots, keep nav/settle/harvest. */
  renderOnly?: boolean
```
```ts
// RunAxeResult union — add a third variant:
  | {
      kind: 'rendered'
      finalUrl?: string
      redirected?: boolean
      harvestedLinks: HarvestedTarget[]
      harvestedLinksTruncated: boolean
      harvestedPageSeo: RawPageSeo | null
    }
```

- [ ] **Step 3b: Branch the body** — after redirect handling and after the harvest block computes `harvestedLinks`/`harvestedLinksTruncated`/`harvestedPageSeo` (L374-388), but BEFORE the axe run when `renderOnly` is set, return early. Concretely: guard the axe-run + screenshot blocks (L312-362) behind `if (!options?.renderOnly) { … }`, then return the right shape:

```ts
  if (options?.renderOnly) {
    return {
      kind: 'rendered',
      harvestedLinks,
      harvestedLinksTruncated,
      harvestedPageSeo,
    }
  }
  return { kind: 'audited', axe, lighthouseSummary, lighthouseError, harvestedPdfUrls, harvestedLinks, harvestedLinksTruncated, harvestedPageSeo }
```
Ensure the harvest computation (L374-388) runs for both paths — move it above the `renderOnly` early return if needed. On the renderOnly path skip **all** of: the local-Lighthouse block (which runs before the normal nav/settle branch), the PageSpeed inline/queue logic (before axe), `axe.run`, and `captureViolationScreenshots` — gate each with `!options?.renderOnly`. Verify by diffing the non-render path stays identical (PDF harvest included). (The `.toString()`-injected on-page functions are untouched — SWC-helper invariant preserved.)

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/runner.test.ts -t "renderOnly"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/runner.ts lib/ada-audit/runner.test.ts
git commit -m "feat(c11): renderOnly runner path returns kind:rendered (no axe/screenshots)"
```

---

### Task 3: seoOnly page-job path (parent read + render-only settle + guards)

**Files:**
- Modify: `lib/jobs/handlers/site-audit-page.ts` (read parent `seoOnly` after the claim ~L207; guard claim-0 PSI re-enqueue L216-217; render-only branch before/around L262-304)
- Test: `lib/jobs/handlers/site-audit-page.test.ts` (extend)

**Interfaces:**
- Consumes: `SiteAudit.seoOnly` (Task 1); `RunAxeOptions.renderOnly` + `kind:'rendered'` (Task 2).
- Produces: a seoOnly child settles to `status:'complete'`, `result:null`, bumping only `pagesComplete`; no `dispatchPdfScans`, no `lighthouseTotal` bump, no `enqueuePsiJob`.

- [ ] **Step 1: Write the failing test** — a seoOnly page job settles complete without PDF/PSI.

```ts
// lib/jobs/handlers/site-audit-page.test.ts
it('C11: seoOnly page settles complete with pagesComplete++ and no PDF/PSI', async () => {
  // Arrange: parent SiteAudit with seoOnly:true + a pending child AdaAudit.
  // Mock runAxeAudit to resolve kind:'rendered' with a couple harvested links.
  await runSiteAuditPageJob({ adaAuditId: child.id, siteAuditId: parent.id, url: 'https://x.example.edu/', wcagLevel: 'wcag21aa' })
  const [row, refreshedParent] = await Promise.all([
    prisma.adaAudit.findUnique({ where: { id: child.id }, select: { status: true, result: true } }),
    prisma.siteAudit.findUnique({ where: { id: parent.id }, select: { pagesComplete: true, pdfsTotal: true, lighthouseTotal: true } }),
  ])
  expect(row).toEqual({ status: 'complete', result: null })
  expect(refreshedParent).toEqual({ pagesComplete: 1, pdfsTotal: 0, lighthouseTotal: 0 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-page.test.ts -t "seoOnly page settles"`
Expected: FAIL — currently runs axe path, bumps lighthouseTotal / dispatches PDFs.

- [ ] **Step 3a: Read the parent mode before the claim-0 branch** — in `runSiteAuditPageJob`, right after the `claimed` `updateMany` (before the `if (claimed.count !== 1)` block ~L207):

```ts
  const parent = await prisma.siteAudit.findUnique({
    where: { id: job.siteAuditId },
    select: { seoOnly: true },
  })
  const seoOnly = parent?.seoOnly === true
```

- [ ] **Step 3b: Guard the claim-0 PSI re-enqueue** — L216-217:

```ts
    if (child?.status === 'axe-complete' && !seoOnly) {
      enqueuePsiJob(job)
    }
```

- [ ] **Step 3c: Pass `renderOnly` + add the render-only branch** — change the `runAxeAudit` call:

```ts
    runResult = await runAxeAudit(job.url, job.wcagLevel, undefined, {
      auditId: job.adaAuditId,
      siteAudit: detachPsi,
      renderOnly: seoOnly,
    })
```
Then, after the `redirected` handling and before the `dispatchPdfScans` block (i.e. handle the new result kind):

```ts
  if (runResult.kind === 'rendered') {
    const settled = await settlePage(
      job,
      ['pagesComplete'],
      { status: 'complete', result: null, runnerType: 'browser', completedAt: new Date() },
      ['running'],
    )
    if (!settled) return
    await persistHarvest(job.siteAuditId, job.url, runResult.harvestedLinks, runResult.harvestedLinksTruncated)
    await persistPageSeo(job.siteAuditId, job.url, runResult.harvestedPageSeo)
    await finalizeWarn(job.siteAuditId, 'seo-only page settle')
    return
  }
```
(The existing `kind:'audited'` destructure + PDF/PSI path stays unchanged below for non-seoOnly audits.)

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-page.test.ts -t "seoOnly page settles"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/site-audit-page.ts lib/jobs/handlers/site-audit-page.test.ts
git commit -m "feat(c11): render-only page-job path (parent-authoritative, no PDF/PSI)"
```

---

### Task 4: Finalizer seoOnly guard (skip ADA output, keep broken-link-verify)

**Files:**
- Modify: `lib/ada-audit/site-audit-finalizer.ts` (load `seoOnly`; guard summary build L79-88, carry-forward L105, ADA dual-write L112-130; keep `enqueueBrokenLinkVerify` L136)
- Test: `lib/ada-audit/site-audit-finalizer.test.ts` (extend)

**Interfaces:**
- Consumes: `SiteAudit.seoOnly` (Task 1); seoOnly children settled `complete` with `result:null` (Task 3).
- Produces: a completed seoOnly audit has `summary:null`, **no `tool:'ada-audit'` `CrawlRun`**, no carry-forward; `broken-link-verify` still enqueued.

- [ ] **Step 1: Write the failing test**

```ts
// lib/ada-audit/site-audit-finalizer.test.ts
it('C11: seoOnly completion writes null summary, no ada-audit run, still enqueues verify', async () => {
  // Arrange: seoOnly parent whose pages are all settled complete; pdfsTotal=0, lighthouseTotal=0.
  await finalizeSiteAudit(parent.id)
  const audit = await prisma.siteAudit.findUnique({ where: { id: parent.id }, select: { status: true, summary: true } })
  expect(audit).toEqual({ status: 'complete', summary: null })
  const adaRun = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: parent.id, tool: 'ada-audit' } }, select: { id: true } })
  expect(adaRun).toBeNull()
  // enqueueBrokenLinkVerify is void fire-and-forget — poll, or (cleaner) mock it and assert the spy.
  await vi.waitFor(async () => {
    const verifyJob = await prisma.job.findFirst({ where: { type: 'broken-link-verify', groupKey: `site-audit:${parent.id}` }, select: { id: true } })
    expect(verifyJob).not.toBeNull()
  })
})
```
> **Codex note (Task 4 test):** the ADA dual-write is also `void`-fire-and-forget — asserting "no ada-audit run" is safe (it's never written for seoOnly), but if you assert the *presence* of an ada run in a control (non-seoOnly) test, wrap it in `vi.waitFor`. Prefer mocking `enqueueBrokenLinkVerify`/`writeFindingsRun` and asserting call/no-call to avoid timing flake. Scope cleanup by domain/group.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/site-audit-finalizer.test.ts -t "seoOnly completion"`
Expected: FAIL — summary gets written; an ada-audit run is dual-written.

- [ ] **Step 3a: Load `seoOnly` in the finalizer's audit read** — add `seoOnly: true` to the `select` of the scalar audit read near the top of `finalizeSiteAudit`.

- [ ] **Step 3b: Guard the completion block** — replace the completion section (L74-136) preserving the **exact non-seoOnly order**: `update` → `closeBatchIfDrained` → `processNext` → (ADA-only) `carryForwardSiteAuditChecks` → ADA dual-write → `enqueueBrokenLinkVerify` (LAST, both modes). Only the summary build + carry-forward + dual-write are gated off for seoOnly:

```ts
  const completedAt = new Date()

  // Full audits load children + build the ADA summary; seoOnly writes a bare complete.
  let pageAudits: Awaited<ReturnType<typeof prisma.adaAudit.findMany>> | null = null
  if (audit.seoOnly) {
    await prisma.siteAudit.update({ where: { id }, data: { status: 'complete', summary: null, completedAt } })
  } else {
    pageAudits = await prisma.adaAudit.findMany({
      where: { siteAuditId: id },
      include: { pdfAudits: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const summary = buildSiteAuditSummary(pageAudits)
    await prisma.siteAudit.update({ where: { id }, data: { status: 'complete', summary: JSON.stringify(summary), completedAt } })
  }

  // Order below is IDENTICAL to today for full audits: closeBatch → processNext →
  // carryForward → ADA dual-write → enqueueBrokenLinkVerify (LAST).
  await closeBatchIfDrained(audit.batchId).catch((e) => {
    console.warn('[site-audit-finalizer] closeBatchIfDrained failed for batch', audit.batchId, ':', (e as Error).message)
  })
  try {
    const { processNext } = await import('./queue-manager')
    void processNext()
  } catch (e) {
    console.warn('[site-audit-finalizer] processNext kick failed:', (e as Error).message)
  }

  if (!audit.seoOnly && pageAudits) {
    void carryForwardSiteAuditChecks(id).catch((e) => { console.error('[checks] carry-forward failed for site audit', id, e) })
    try {
      const bundle = mapAdaChildren({ id, domain: audit.domain, clientId: audit.clientId, wcagLevel: audit.wcagLevel, pagesError: audit.pagesError, startedAt: audit.startedAt, completedAt }, pageAudits)
      void writeFindingsRun(bundle).catch((e) => { console.error('[findings] ADA dual-write failed for site audit', id, e) })
    } catch (e) {
      console.error('[findings] ADA bundle mapping failed for site audit', id, e)
    }
  }

  // Live-scan builder — runs for BOTH modes; for seoOnly it is the only output. LAST.
  void enqueueBrokenLinkVerify(id, audit.domain)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/site-audit-finalizer.test.ts -t "seoOnly completion"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/site-audit-finalizer.ts lib/ada-audit/site-audit-finalizer.test.ts
git commit -m "feat(c11): finalizer skips ADA output for seoOnly, keeps live-scan builder"
```

---

### Task 5: Detail route `liveScanRunId` + `seoOnly` (and list `seoOnly`)

**Files:**
- Modify: `lib/ada-audit/types.ts` (`SiteAuditDetail` L223 — add `seoOnly: boolean`; the detail response adds `liveScanRunId`)
- Modify: `app/api/site-audit/[id]/route.ts` (GET — select the live-scan run + `seoOnly`, add to response L101-128)
- Modify: `app/api/site-audit/route.ts` (GET list — add `seoOnly` to each item L111-132; `include` the live-scan run is NOT needed for the list)
- Test: **`app/api/site-audit/[id]/route.fallback.test.ts`** (the DB-backed GET suite — extend this; `route.test.ts` is a mocked DELETE-focused file, not for DB-backed GET)

**Interfaces:**
- Consumes: `SiteAudit.seoOnly` (Task 1); the live-scan `CrawlRun` (`tool:'seo-parser'`) built by verify (Task 4 path).
- Produces: `GET /api/site-audit/[id]` returns `seoOnly: boolean` + `liveScanRunId: string | null`. `GET /api/site-audit` list items carry `seoOnly`.

- [ ] **Step 1: Write the failing test**

```ts
// app/api/site-audit/[id]/route.fallback.test.ts
it('C11: detail returns seoOnly + liveScanRunId (null before, id after)', async () => {
  // Arrange: complete seoOnly SiteAudit, no live run yet.
  let res = await GET(new NextRequest('http://x/api/site-audit/' + id), { params: Promise.resolve({ id }) })
  let body = await res.json()
  expect(body.seoOnly).toBe(true)
  expect(body.liveScanRunId).toBeNull()
  // Add a live-scan run, re-fetch.
  const run = await prisma.crawlRun.create({ data: { siteAuditId: id, tool: 'seo-parser', source: 'live-scan', /* …required fields… */ } })
  res = await GET(new NextRequest('http://x/api/site-audit/' + id), { params: Promise.resolve({ id }) })
  body = await res.json()
  expect(body.liveScanRunId).toBe(run.id)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/site-audit/[id]/route.fallback.test.ts" -t "liveScanRunId"`
Expected: FAIL — `seoOnly`/`liveScanRunId` undefined in the response.

- [ ] **Step 3a: Extend the type** — `lib/ada-audit/types.ts`, `SiteAuditDetail`: add `seoOnly: boolean`. (Add `liveScanRunId` to the intersection type used in the detail route's `satisfies`, or to `SiteAuditDetail` itself if that keeps the list happy — prefer the route-local intersection so the list type stays minimal.)

- [ ] **Step 3b: Select + return in the detail route** — `app/api/site-audit/[id]/route.ts`:

```ts
// add to the findUnique include:
      crawlRuns: { where: { tool: 'seo-parser' }, select: { id: true } },
```
```ts
// in the response object:
    seoOnly: audit.seoOnly,
    liveScanRunId: audit.crawlRuns[0]?.id ?? null,
```
Update the `satisfies` type accordingly.

- [ ] **Step 3c: Add `seoOnly` to the list route** — `app/api/site-audit/route.ts` GET, in the mapped item (L111-132):

```ts
      seoOnly: a.seoOnly,
```
(Add `seoOnly: boolean` to `SiteAuditDetail` covers both.)

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/site-audit/[id]/route.fallback.test.ts" -t "liveScanRunId"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/types.ts app/api/site-audit/[id]/route.ts app/api/site-audit/route.ts app/api/site-audit/[id]/route.test.ts
git commit -m "feat(c11): expose seoOnly + liveScanRunId on site-audit reads"
```

---

### Task 6: Share-route guard + quick-widget 409 mode info

**Files:**
- Modify: `app/api/site-audit/[id]/share/route.ts` (reject `seoOnly` — after the `status !== 'complete'` check ~L31)
- Modify: `app/api/site-audit/route.ts` (POST — include `seoOnly` in the 409 duplicate body ~L61-67)
- Modify: `components/widgets/QuickSiteAuditWidget.tsx` (don't deep-link a seoOnly 409 to `/ada-audit/site/[id]` — L26-27)
- Test: `app/api/site-audit/[id]/share/route.test.ts` (extend or create)

**Interfaces:**
- Consumes: `SiteAudit.seoOnly` (Task 1); the 409 duplicate path in `queueSiteAuditRequest` (returns `existingId`).
- Produces: share POST → 400 `seo_only_not_shareable` for seoOnly; POST 409 body carries `seoOnly: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// app/api/site-audit/[id]/share/route.test.ts
it('C11: share rejects a seoOnly audit', async () => {
  // Arrange: complete seoOnly SiteAudit `id`.
  const res = await POST(new NextRequest('http://x', { method: 'POST' }), { params: Promise.resolve({ id }) })
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatch(/seo/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/[id]/share/route.test.ts -t "share rejects"`
Expected: FAIL — currently mints a token (200).

- [ ] **Step 3a: Guard the share route** — `app/api/site-audit/[id]/share/route.ts`: add `seoOnly: true` to the `select` (L24) and after the `status` check:

```ts
  if (audit.seoOnly) {
    return NextResponse.json({ error: 'SEO-only scans are not shareable as accessibility reports' }, { status: 400 })
  }
```

- [ ] **Step 3b: Add `seoOnly` to the POST 409 body** — `app/api/site-audit/route.ts`, the duplicate branch: extend the `findUnique` select to include `seoOnly` and add it to the JSON body:

```ts
    const existing = await prisma.siteAudit.findUnique({ where: { id: result.existingId }, select: { domain: true, seoOnly: true } })
    return NextResponse.json({ error: `A site audit for ${existing?.domain ?? 'this domain'} is already queued or running`, id: result.existingId, seoOnly: existing?.seoOnly ?? false }, { status: 409 })
```

- [ ] **Step 3c: Fix quick-widget routing** — `components/widgets/QuickSiteAuditWidget.tsx` L26-29:

```ts
      if ((res.status === 202 || res.status === 409) && data.id) {
        router.push(data.seoOnly ? '/seo-parser' : `/ada-audit/site/${data.id}`)
        return
      }
```

- [ ] **Step 3d: Update the EXISTING quick-widget test** — the current `components/widgets/QuickSiteAuditWidget.test.tsx` asserts a `409` duplicate navigates to `/ada-audit/site/dup`. That assertion still holds for a non-seoOnly duplicate (the widget never sends `seoOnly`, and a same-domain ADA duplicate returns `seoOnly:false`). Add a NEW case: a `409 { id, seoOnly:true }` navigates to `/seo-parser`, not the ADA page. Do this in THIS task, not a later sweep.

```tsx
it('C11: routes a seoOnly 409 duplicate to /seo-parser', async () => {
  const push = vi.fn()
  // mock useRouter().push = push; mock fetch → { status: 409, json: async () => ({ id: 'dup', seoOnly: true }) }
  // render + submit, then:
  await waitFor(() => expect(push).toHaveBeenCalledWith('/seo-parser'))
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run app/api/site-audit/[id]/share/route.test.ts -t "share rejects"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/site-audit/[id]/share/route.ts app/api/site-audit/route.ts components/widgets/QuickSiteAuditWidget.tsx app/api/site-audit/[id]/share/route.test.ts
git commit -m "feat(c11): guard share route + quick-widget 409 for seoOnly"
```

---

### Task 7: `/ada-audit/site/[id]` redirect for seoOnly rows

**Files:**
- Modify: the site-audit results page — `app/(app)/ada-audit/site/[id]/page.tsx` (redirect to `/seo-parser` when the audit is `seoOnly`)
- Test: prefer a server-component test if the suite has a pattern; otherwise cover via the detail-route `seoOnly` flag (Task 5) + a manual verify note. If no page test pattern exists, add a small unit around the redirect decision helper.

**Interfaces:**
- Consumes: `SiteAudit.seoOnly` (Task 1).
- Produces: navigating to `/ada-audit/site/[id]` for a seoOnly audit redirects to `/seo-parser` (never renders the ADA "Result data unavailable" page).

- [ ] **Step 1: Write the failing test** — extract the decision to a pure helper so it's testable:

```ts
// app/(app)/ada-audit/site/[id]/seo-only-redirect.test.ts
import { seoOnlyRedirectTarget } from './seo-only-redirect'
it('C11: seoOnly audit redirects to /seo-parser', () => {
  expect(seoOnlyRedirectTarget({ seoOnly: true })).toBe('/seo-parser')
  expect(seoOnlyRedirectTarget({ seoOnly: false })).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/(app)/ada-audit/site/[id]/seo-only-redirect.test.ts"`
Expected: FAIL — helper does not exist.

- [ ] **Step 3a: Add the helper** — `app/(app)/ada-audit/site/[id]/seo-only-redirect.ts`:

```ts
export function seoOnlyRedirectTarget(audit: { seoOnly: boolean }): string | null {
  return audit.seoOnly ? '/seo-parser' : null
}
```

- [ ] **Step 3b: Use it in the page** — in the server component after the audit is loaded, before rendering the ADA view:

```ts
import { redirect } from 'next/navigation'
import { seoOnlyRedirectTarget } from './seo-only-redirect'
// …after fetching the audit row (ensure the query selects seoOnly):
const target = seoOnlyRedirectTarget(audit)
if (target) redirect(target)
```
(If the page fetches via `/api/site-audit/[id]`, `seoOnly` is now on that payload from Task 5.)

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/(app)/ada-audit/site/[id]/seo-only-redirect.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/ada-audit/site/[id]/seo-only-redirect.ts" "app/(app)/ada-audit/site/[id]/seo-only-redirect.test.ts" "app/(app)/ada-audit/site/[id]/page.tsx"
git commit -m "feat(c11): redirect seoOnly audits away from the ADA results page"
```

---

### Task 8: `recoverBrokenLinkVerifies` zero-harvest seoOnly pass

**Files:**
- Modify: `lib/ada-audit/broken-link-recovery.ts` (add a pass for complete `seoOnly:true` audits with no `seo-parser` run and no active verifier — even with zero transient rows)
- Test: `lib/ada-audit/broken-link-recovery.test.ts` (extend or create)

**Interfaces:**
- Consumes: `SiteAudit.seoOnly` (Task 1).
- Produces: a completed zero-harvest seoOnly audit with no live-scan run gets a `broken-link-verify` re-enqueued.

- [ ] **Step 1: Write the failing test**

```ts
// lib/ada-audit/broken-link-recovery.test.ts
it('C11: recovery re-enqueues a complete zero-harvest seoOnly audit', async () => {
  // Arrange: complete seoOnly SiteAudit, NO HarvestedLink/HarvestedPageSeo rows, NO seo-parser CrawlRun, NO active verify job.
  const n = await recoverBrokenLinkVerifies()
  expect(n).toBeGreaterThanOrEqual(1)
  const job = await prisma.job.findFirst({ where: { type: 'broken-link-verify', groupKey: `site-audit:${id}` }, select: { id: true } })
  expect(job).not.toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-recovery.test.ts -t "zero-harvest seoOnly"`
Expected: FAIL — the current scan is keyed on transient-table rows only.

- [ ] **Step 3: Add the seoOnly pass** — in `recoverBrokenLinkVerifies`, after building `pending` from the transient tables, union in complete seoOnly audits:

```ts
  const seoOnlyComplete = await prisma.siteAudit.findMany({
    where: { seoOnly: true, status: 'complete' },
    select: { id: true },
  })
  const candidateIds = new Set<string>([
    ...pending.map((p) => p.siteAuditId),
    ...seoOnlyComplete.map((s) => s.id),
  ])
```
Then iterate `candidateIds` instead of `pending` (the existing per-id body already skips when a `seo-parser` run exists or an active verify job exists, and re-reads the row for `status`/`domain` — so a seoOnly row already covered by transient rows is de-duped by the Set, and one with no live run + no active job is enqueued). Keep the existing `status !== 'complete'` guard.

> **Codex note (Task 8 — re-enqueue bound):** the active-job check (`JOB_ACTIVE_STATUSES`) skips queued/running verifiers, and `dedupKey` makes the enqueue idempotent — but a **permanently errored** verify job is not "active", so a seoOnly audit whose verifier keeps failing would be re-enqueued every sweep. This mirrors existing recovery behavior for the transient-table path (bounded by the job's own `maxAttempts`/backoff, and it stops once a `seo-parser` run finally lands). Document this as intended; do NOT add unbounded retries. If it proves noisy in prod, a follow-up can add a "last attempt errored recently" skip — out of scope for PR1.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-recovery.test.ts -t "zero-harvest seoOnly"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/broken-link-recovery.ts lib/ada-audit/broken-link-recovery.test.ts
git commit -m "feat(c11): recovery covers zero-harvest seoOnly audits"
```

---

### Task 9: URL scan form + pending-status card on `/seo-parser`

**Files:**
- Create: `components/seo-parser/SeoScanForm.tsx` (client component)
- Create: `components/seo-parser/SeoScanForm.test.tsx`
- Modify: `app/(app)/seo-parser/page.tsx` (render the form card alongside the CSV upload)
- Reuse: `components/ui/StatusPill.tsx` for state chips; existing deck card styling from the seo-parser page (token classes navy/orange, `dark:` variants)

**Interfaces:**
- Consumes: `POST /api/site-audit` (accepts `seoOnly`, Task 1); `GET /api/site-audit/[id]` (`status` + `liveScanRunId`, Task 5).
- Produces: a self-contained form + status card; no new public API.

- [ ] **Step 1: Write the failing test** — the card advances queued → building → ready.

```tsx
// @vitest-environment jsdom
// components/seo-parser/SeoScanForm.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SeoScanForm } from './SeoScanForm'
// NOTE: this repo has NO jest-dom matchers — assert on element.getAttribute(...), not toHaveAttribute.
it('C11: submits seoOnly and advances to a ready link when liveScanRunId arrives', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ status: 202, json: async () => ({ id: 'sa1', status: 'queued' }) })       // POST
    .mockResolvedValue({ ok: true, json: async () => ({ status: 'complete', liveScanRunId: 'run9' }) }) // subsequent polls: ready
  vi.stubGlobal('fetch', fetchMock)
  render(<SeoScanForm />)
  fireEvent.change(screen.getByPlaceholderText(/example\.com/i), { target: { value: 'example.edu' } })
  fireEvent.click(screen.getByRole('button', { name: /scan/i }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/site-audit', expect.objectContaining({ method: 'POST' })))
  const postBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
  expect(postBody.seoOnly).toBe(true)
  await waitFor(() => {
    const link = screen.getByRole('link', { name: /view|result/i }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/seo-parser/results/run/run9')
  })
})
```
> **Codex note (Task 9 test):** needs `@vitest-environment jsdom`; NO jest-dom (use `getAttribute`). The poll runs on a 2s `setInterval` — either (a) fire an **immediate** poll right after setting `auditId` (recommended: call the poll fn once, then start the interval) so `waitFor` resolves without advancing timers, or (b) use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(2000)`. Option (a) also makes the UX snappier.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/SeoScanForm.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3a: Build the component** — `components/seo-parser/SeoScanForm.tsx`. Requirements: `'use client'`; domain input + submit; POST `{ domain, seoOnly: true }`; on 202 store `id` (state + `sessionStorage`); **read `sessionStorage` on mount** so a pending card survives a soft refresh; poll `GET /api/site-audit/[id]` with an **immediate first poll** then a 2s `setInterval`; render `StatusPill` states — **running** (queued/running), **building SEO report** (`status==='complete' && liveScanRunId===null`), **ready** (link to `/seo-parser/results/run/${liveScanRunId}`); on 409 show existing-domain message (never route to `/ada-audit/site`); on 400 inline error; stop polling on ready/unmount. Every element has a `dark:` variant. **`StatusPill` tones are `neutral | running | success | error | warning` — there is NO `info` tone.**

```tsx
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StatusPill } from '@/components/ui/StatusPill'

type Phase = 'idle' | 'submitting' | 'running' | 'building' | 'ready' | 'error'
const STORAGE_KEY = 'seo-scan-id'

export function SeoScanForm() {
  const [domain, setDomain] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [auditId, setAuditId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Survive a soft refresh: resume polling a still-pending scan.
  useEffect(() => {
    try { const saved = sessionStorage.getItem(STORAGE_KEY); if (saved) { setAuditId(saved); setPhase('running') } } catch {}
  }, [])

  const poll = useCallback(async (id: string) => {
    const res = await fetch(`/api/site-audit/${id}`)
    if (!res.ok) return
    const d = await res.json()
    if (d.status === 'complete' && d.liveScanRunId) {
      setRunId(d.liveScanRunId); setPhase('ready')
      try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
    } else if (d.status === 'complete') setPhase('building')
    else setPhase('running')
  }, [])

  useEffect(() => {
    if (!auditId || phase === 'ready') return
    void poll(auditId) // immediate first poll (snappy + test-friendly)
    timer.current = setInterval(() => { void poll(auditId) }, 2000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [auditId, phase, poll])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = domain.trim()
    if (!value) return
    setPhase('submitting'); setError(null)
    const res = await fetch('/api/site-audit', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: value, seoOnly: true }),
    })
    const d = await res.json().catch(() => ({}))
    if (res.status === 202 && d.id) { setAuditId(d.id); setPhase('running'); try { sessionStorage.setItem(STORAGE_KEY, d.id) } catch {} return }
    if (res.status === 409) { setError(d.error || 'A scan for this domain is already running.'); setPhase('error'); return }
    setError(d.error || 'Could not start the scan.'); setPhase('error')
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-navy-border dark:bg-navy-card">
      <h2 className="font-display text-[15px] font-bold text-navy dark:text-white">Scan a URL for SEO</h2>
      <div className="mt-3 flex gap-2">
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-[14px] text-navy dark:border-navy-border dark:bg-navy-deep dark:text-white" />
        <button type="submit" disabled={phase === 'submitting' || !domain.trim()}
          className="rounded-lg bg-orange px-4 py-2 text-[14px] font-display font-bold text-navy hover:bg-orange-light disabled:opacity-50">
          {phase === 'submitting' ? 'Starting…' : 'Scan'}
        </button>
      </div>
      {phase === 'running' && <p className="mt-3"><StatusPill tone="running" label="SEO scan running…" /></p>}
      {phase === 'building' && <p className="mt-3"><StatusPill tone="running" label="Building SEO report…" /></p>}
      {phase === 'ready' && runId && (
        <p className="mt-3 text-[14px]"><a href={`/seo-parser/results/run/${runId}`} className="font-bold text-orange hover:underline dark:text-orange">View SEO results →</a></p>
      )}
      {error && <p className="mt-3 text-[13px] text-red-600 dark:text-red-400">{error}</p>}
    </form>
  )
}
```
(Verify `StatusPill`'s exact prop names against `components/ui/StatusPill.tsx` — match `tone`/`label` to its real API.)

- [ ] **Step 3b: Render it on the page** — `app/(app)/seo-parser/page.tsx`: import and place `<SeoScanForm />` as a card alongside the existing CSV upload block (no route rename, no tabs — that's PR3).

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/seo-parser/SeoScanForm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/seo-parser/SeoScanForm.tsx components/seo-parser/SeoScanForm.test.tsx "app/(app)/seo-parser/page.tsx"
git commit -m "feat(c11): URL scan form + pending-status card on /seo-parser"
```

---

### Task 10: ADA-list surface audit + minimal seoOnly guards

**Files (audit each; modify only where a seoOnly row would be shown/routed as ADA):**
- `app/api/site-audit/queue/route.ts` + its `getQueueStatus` producer
- `components/widgets/LiveNowWidget.tsx`, `components/*/DashboardQueueStatus*`, `components/*/QueueMemberRow*`
- audit **batch** routes — `app/api/audit-batches/route.ts` + `app/api/audit-batches/[id]/route.ts` (NOT `site-audit/batch*`) + any batch pages (these count/select `siteAudits`)
- `lib/ada-audit/recents-query.ts`
- `app/api/clients/audit-summary/route.ts`, `lib/services/client-dashboard.ts`, `lib/services/client-fleet.ts`
- Test: extend whichever of these has a test; add one asserting seoOnly rows are excluded/labeled.

**Interfaces:**
- Consumes: `SiteAudit.seoOnly` (Task 1).
- Produces: no ADA surface presents a seoOnly row as an accessibility audit or deep-links it to `/ada-audit/site/[id]`.

- [ ] **Step 1: Audit pass (no code yet)** — for each file above, determine whether it (a) surfaces a `SiteAudit` row to an ADA UI, and (b) would deep-link to `/ada-audit/site/[id]` or show a null ADA score. Record the disposition (guard vs safe) in the PR description. The cheapest correct guard for list queries is a `where: { seoOnly: false }` filter (ADA lists); for the shared queue/live-now widgets that legitimately show all in-flight audits, add a `seoOnly` field + a small "SEO" label and route seoOnly items to `/seo-parser`.

- [ ] **Step 2: Write the failing test** — pick the highest-traffic ADA list (e.g. `recents-query.ts`) and assert exclusion:

```ts
// lib/ada-audit/recents-query.test.ts
it('C11: ADA recents excludes seoOnly audits', async () => {
  // Arrange: one normal complete audit + one complete seoOnly audit, same client.
  const rows = await getRecentAdaAudits(/* args */)
  expect(rows.map((r) => r.id)).not.toContain(seoOnlyId)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/recents-query.test.ts -t "excludes seoOnly"`
Expected: FAIL — seoOnly row appears.

- [ ] **Step 4: Apply the minimal guards** — add `where: { seoOnly: false }` (or the equivalent post-filter) to the ADA-only list queries identified in Step 1; for shared queue/live widgets, thread `seoOnly` + label + route-target. Re-run the test → PASS. Then run the full suite:

Run: `DATABASE_URL="file:./local-dev.db" npm test`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(c11): guard ADA list/queue/dashboard surfaces from seoOnly rows"
```

---

### Task 11: Gate + middleware coverage + full-suite green

**Files:**
- Verify: `middleware.test.ts` still green (no new path added — `/api/site-audit*` already allowed; confirm and, if a case is thin, add one asserting `/api/site-audit` POST is reachable).
- No new code unless a gate fails.

- [ ] **Step 1: Run the full gate**

```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all three green. Fix any failures at their source (do not weaken tests).

- [ ] **Step 2: Confirm the seoOnly invariant end-to-end (manual/integration)** — either an integration test or a scripted check: enqueue a seoOnly audit against a **client** domain (never a third-party site), let it drain, assert (a) no `tool:'ada-audit'` `CrawlRun`, (b) a `tool:'seo-parser'` live-scan run exists, (c) `report/csv/vpat` routes 409 `no_findings_run`.

- [ ] **Step 3: Commit any gate fixes**

```bash
git add -A
git commit -m "test(c11): middleware coverage + gate-green for seoOnly scan mode"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- §4.1 schema+plumbing → Task 1. §4.2 runner `renderOnly` → Task 2. §4.3 page-job → Task 3. §4.4 finalizer guard → Task 4. §4.5 form + readiness signal → Tasks 5 (liveScanRunId) + 9 (form). §4.6 matrix → Tasks 5 (detail/list `seoOnly`), 6 (share + quick-widget), 7 (`/ada-audit/site/[id]` redirect), 10 (lists/dashboards). §6 zero-harvest recovery → Task 8. §7 testing → per-task tests + Task 11. §8 acceptance → covered across tasks; end-to-end invariant in Task 11 Step 2.
- Codex fixes 1-8 all landed: #1→T5/T9, #2→T3 (parent read before claim-0), #3→T10 matrix, #4→T6, #5→T6, #6→T5 (null summary ⇒ null score) + spec §2 note, #7→T8, #8→T7.

**Placeholder scan** — no "TBD/handle appropriately". The only intentionally deferred detail is the exact `StatusPill` prop names (Task 9 notes "match its real API") and the Task 10 audit-then-guard shape (the audit pass is itself the deliverable, with a concrete default guard `where:{seoOnly:false}`).

**Type consistency** — `seoOnly: boolean` on `SiteAudit`/`SiteAuditDetail`; `renderOnly?: boolean` + `kind:'rendered'` result used identically in Tasks 2→3; `liveScanRunId: string | null` defined in Task 5 and consumed in Task 9; `EnqueueAuditOptions.seoOnly`/`QueueRequestInput.seoOnly` consistent across Task 1.
