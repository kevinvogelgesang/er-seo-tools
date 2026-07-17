# Sweep Error Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triage the ~116 page-level audit errors + coverage-label defect the first weekly sweep surfaced — filter tool noise (cdn-cgi), retry transient Chrome failures, reclassify mishandled 3xx, surface provably-dead (404/410) audited URLs as findings, complete the sweep unit map, and make the coverage-reason vocabulary honest.

**Architecture:** A structured runner-error classifier is the spine. Buckets 2 (filter) / 3 (retry) / 4 (redirect) run FIRST so the remaining page errors are genuine content errors; bucket 1 then captures 404/410 at page-settle into a new transient `HarvestedPageError` table, and the live-scan builder (`broken-link-verify.ts`) emits a `dead_page` finding. Sweep-side, the unit map is completed and `pagesError>0` becomes a conservative `partial` cause with an honest reason label.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, puppeteer-core, vitest. Findings flow: `CrawlRun` → `CrawlPage`/`Finding`; the live-scan run is `tool:'seo-parser', source:'live-scan'`.

**Spec:** `docs/superpowers/specs/2026-07-17-sweep-error-triage-design.md` (Codex-reviewed, accept-with-fixes).

## Global Constraints

- **Gate-green before merge:** `npm run lint` (`tsc --noEmit`) + `npm test` (`DATABASE_URL="file:./local-dev.db" npm test`) + `npm run build`. PLUS `npm run smoke` (ADA pipeline is touched) — macOS: `export CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` first.
- **Array-form `$transaction([...])` only** — never interactive. Raw SQL sets `updatedAt` manually (`Date.now()`, integer ms).
- **SWC-injection contract:** anything reachable from a `page.evaluate(\`...${fn.toString()}...\`)` string must reference NO module scope and emit no SWC helper (no `typeof`). Buckets 2/3/4/1 all live in pure Node — keep new predicates OUT of the injected IIFE in `link-harvest.ts` / `parse-seo-dom.ts`.
- **Never weaken `lib/security/safe-url.ts` / SSRF guards.** `lib/seo-fetch` is FROZEN — consume, never modify.
- **Migrations are hand-authored** (`migrate dev` is interactive-only here): `prisma/migrations/<timestamp>_<name>/migration.sql` then `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && … prisma generate`. SQLite: no `ALTER COLUMN`, no `createMany`+`skipDuplicates` (P2002-guarded creates).
- **New finding type is measurement-first:** `dead_page` = warning; NO score change; page-scope `detail` carries `{statusCode}` but `CrawlPage.statusCode` is left NULL for dead rows (or "observed/analyzed" coverage inflates).
- **UI:** dark-mode `dark:` variants on every element + the `mounted`-guard hydration pattern; share view = zero cookie-gated fetches.
- **Implementation order (Codex ruling #6):** Tasks run in the numbered order — B2 → spine → B3 → B4 → provider-verify → B1 (schema→capture→mapper→builder→UI) → B5 → label. B1 capture (Task 7) must not land before B2/B3/B4 (Tasks 1,3,4) so it never records noise.
- **Frozen gate:** `lib/jobs/handlers/broken-link-verify.characterization.test.ts` stays byte-identical (its baseline has zero `HarvestedPageError` rows) — do NOT re-pin it; add a separate dead-page test.

---

### Task 1: Bucket 2 — exclude `/cdn-cgi/` paths from discovery + harvest

**Files:**
- Create: `lib/ada-audit/crawl-exclude.ts`
- Create: `lib/ada-audit/crawl-exclude.test.ts`
- Modify: `lib/ada-audit/link-harvest.ts` (`normalizeLinkTarget`, ~line 20)
- Modify: `lib/ada-audit/sitemap-crawler.ts` (`resolveSeedsReal` same-domain filter + `shallowCrawl` inline filter)
- Test: `lib/ada-audit/link-harvest.test.ts`, `lib/ada-audit/sitemap-crawler.test.ts`

**Interfaces:**
- Produces: `isExcludedCrawlPath(url: string): boolean` — true for infrastructure-artifact paths (`/cdn-cgi/…`), used by both producers.

- [ ] **Step 1: Write the failing test** — `lib/ada-audit/crawl-exclude.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { isExcludedCrawlPath } from './crawl-exclude'

describe('isExcludedCrawlPath', () => {
  it('excludes cdn-cgi paths (any position, case-insensitive)', () => {
    expect(isExcludedCrawlPath('https://x.edu/cdn-cgi/l/email-protection')).toBe(true)
    expect(isExcludedCrawlPath('https://x.edu/CDN-CGI/l/email-protection')).toBe(true)
    expect(isExcludedCrawlPath('https://x.edu/a/cdn-cgi/b')).toBe(true)
  })
  it('does NOT exclude look-alike real paths', () => {
    expect(isExcludedCrawlPath('https://x.edu/cdn-cginfo')).toBe(false)
    expect(isExcludedCrawlPath('https://x.edu/programs/cdn')).toBe(false)
    expect(isExcludedCrawlPath('https://x.edu/')).toBe(false)
  })
  it('is safe on unparseable input', () => {
    expect(isExcludedCrawlPath('not a url')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/crawl-exclude.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `lib/ada-audit/crawl-exclude.ts`

```ts
// lib/ada-audit/crawl-exclude.ts
// Client-safe pure predicate for URL paths that are infrastructure artifacts,
// never real client pages (Cloudflare email-obfuscation etc). Applied at BOTH
// discovery (sitemap-crawler) and harvest (link-harvest) so such URLs never
// enter the audited set (and thus never become false dead_page findings).
// Match on the PATH segment only — a query/host containing "cdn-cgi" must not trip.
const EXCLUDED_PATH_RE = /(^|\/)cdn-cgi(\/|$)/i

export function isExcludedCrawlPath(url: string): boolean {
  try {
    return EXCLUDED_PATH_RE.test(new URL(url).pathname)
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS.

- [ ] **Step 5: Apply in `link-harvest.ts`** — in `normalizeLinkTarget`, after the URL is built + before returning `u.toString()` (currently line ~34). Add the import at top (`import { isExcludedCrawlPath } from './crawl-exclude'`) and the guard:

```ts
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  const out = u.toString()
  if (isExcludedCrawlPath(out)) return null   // Bucket 2: never harvest cdn-cgi
  return out
```

- [ ] **Step 6: Apply in `sitemap-crawler.ts`** — import `isExcludedCrawlPath`; in `resolveSeedsReal` step 5 extend the filter predicate and in `shallowCrawl`'s same-domain gate. Extend the existing `.filter(u => isSameDomain(u, normDomain))` to `.filter(u => isSameDomain(u, normDomain) && !isExcludedCrawlPath(u))`; in `shallowCrawl` add `if (isExcludedCrawlPath(abs)) continue` next to the existing scheme/fragment skips.

- [ ] **Step 7: Add producer tests** — in `link-harvest.test.ts`: a `classifyTargets` case where a `/cdn-cgi/l/email-protection` href is dropped (not in `targets`). In `sitemap-crawler.test.ts`: a discovered-URL set containing a cdn-cgi URL that is filtered out of the returned `urls`. Run both files → PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/ada-audit/crawl-exclude.ts lib/ada-audit/crawl-exclude.test.ts lib/ada-audit/link-harvest.ts lib/ada-audit/link-harvest.test.ts lib/ada-audit/sitemap-crawler.ts lib/ada-audit/sitemap-crawler.test.ts
git commit -m "feat(sweep): B2 — exclude /cdn-cgi/ paths from discovery + harvest"
```

---

### Task 2: Spine — structured runner-error classifier

**Files:**
- Create: `lib/ada-audit/runner-errors.ts`
- Create: `lib/ada-audit/runner-errors.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RunnerErrorKind = 'infrastructure' | 'http-status' | 'non-html' | 'ssrf' | 'timeout' | 'other'
  export interface ClassifiedRunnerError { kind: RunnerErrorKind; status?: number }
  export function classifyRunnerError(err: unknown): ClassifiedRunnerError
  ```
- Consumes: `SafeUrlError` from `lib/security/safe-url` (read its `reason` field; do NOT modify that module).

**Notes:** `infrastructure` is NARROW — Chrome/pool/protocol only (`Target.createTarget`, `Target closed`, pool errors). Navigation timeout is `timeout` (NOT infrastructure — it is handled by the in-nav retry in `runner-retry.ts`, unchanged). `SafeUrlError` maps to `ssrf` ONLY when `reason === 'policy'`; other reasons → `other`. The runner throws HTTP errors as `HTTP <n> — …` (see `runner.ts:307-330`), so parse the leading `HTTP <digits>`.

- [ ] **Step 1: Write the failing test** — `lib/ada-audit/runner-errors.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { classifyRunnerError } from './runner-errors'
import { SafeUrlError } from '@/lib/security/safe-url'

describe('classifyRunnerError', () => {
  it('classifies Chrome/pool/protocol as infrastructure', () => {
    expect(classifyRunnerError(new Error('Protocol error (Target.createTarget): ...')).kind).toBe('infrastructure')
    expect(classifyRunnerError(new Error('Target closed')).kind).toBe('infrastructure')
  })
  it('parses HTTP status errors', () => {
    expect(classifyRunnerError(new Error('HTTP 404 — Redirected to ...'))).toEqual({ kind: 'http-status', status: 404 })
    expect(classifyRunnerError(new Error('HTTP 410 — ...'))).toEqual({ kind: 'http-status', status: 410 })
    expect(classifyRunnerError(new Error('HTTP 500 — Internal Server Error'))).toEqual({ kind: 'http-status', status: 500 })
  })
  it('classifies non-HTML and timeout distinctly', () => {
    expect(classifyRunnerError(new Error('Response is not HTML (Content-Type: application/rss+xml)')).kind).toBe('non-html')
    expect(classifyRunnerError(new Error('Navigation timeout of 30000 ms exceeded')).kind).toBe('timeout')
  })
  it('maps only policy SafeUrlError to ssrf', () => {
    expect(classifyRunnerError(new SafeUrlError('blocked', 'policy')).kind).toBe('ssrf')
    expect(classifyRunnerError(new SafeUrlError('dns fail', 'dns')).kind).toBe('other')
  })
  it('defaults unknown to other', () => {
    expect(classifyRunnerError(new Error('something else')).kind).toBe('other')
    expect(classifyRunnerError('a string').kind).toBe('other')
  })
})
```

- [ ] **Step 2: Run → FAIL** (module not found). First verify the real `SafeUrlError` constructor signature: `grep -n "class SafeUrlError" -A6 lib/security/safe-url.ts` and adjust the test's `new SafeUrlError(...)` calls + the classifier's `instanceof`/`.reason` access to match the actual shape.

- [ ] **Step 3: Implement** — `lib/ada-audit/runner-errors.ts`

```ts
// lib/ada-audit/runner-errors.ts
// Structured classifier for runAxeAudit throws. The single home of the
// domain-vs-infrastructure split (architecture-contract). Pure Node.
import { SafeUrlError } from '@/lib/security/safe-url'

export type RunnerErrorKind = 'infrastructure' | 'http-status' | 'non-html' | 'ssrf' | 'timeout' | 'other'
export interface ClassifiedRunnerError { kind: RunnerErrorKind; status?: number }

// NARROW: only Chrome/pool/protocol failures warrant durable-queue retry.
// Do NOT add navigation-timeout here (that is the in-nav retry's job).
const INFRA_RE = /Target\.createTarget|Target closed|Session closed|Connection closed|Protocol error \(Target\./i
const TIMEOUT_RE = /Navigation timeout of \d+ ms exceeded/i
const NON_HTML_RE = /Response is not HTML/i
const HTTP_RE = /^HTTP (\d{3})\b/

export function classifyRunnerError(err: unknown): ClassifiedRunnerError {
  if (err instanceof SafeUrlError) {
    return { kind: err.reason === 'policy' ? 'ssrf' : 'other' }
  }
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const http = HTTP_RE.exec(msg)
  if (http) return { kind: 'http-status', status: Number(http[1]) }
  if (INFRA_RE.test(msg)) return { kind: 'infrastructure' }
  if (TIMEOUT_RE.test(msg)) return { kind: 'timeout' }
  if (NON_HTML_RE.test(msg)) return { kind: 'non-html' }
  return { kind: 'other' }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add lib/ada-audit/runner-errors.ts lib/ada-audit/runner-errors.test.ts && git commit -m "feat(sweep): spine — classifyRunnerError taxonomy"`

---

### Task 3: Bucket 3 — retry transient Chrome errors (acquire helper + handler rethrow)

**Files:**
- Modify: `lib/ada-audit/runner.ts` (acquire at `:134`, in-nav re-acquire at `:373`)
- Modify: `lib/jobs/handlers/site-audit-page.ts` (catch at `:300-312`)
- Test: `lib/ada-audit/runner.test.ts`, `lib/jobs/handlers/site-audit-page.test.ts`

**Interfaces:**
- Consumes: `classifyRunnerError` (Task 2), `acquirePage`/`releasePage` (browser-pool).
- Produces (internal to runner.ts): `acquirePageWithRetry(): Promise<Page>` — one 750ms-delayed retry on an infrastructure-classified acquire throw.

- [ ] **Step 1: Write the failing test (site-audit-page rethrow)** — in `site-audit-page.test.ts`, mock `runAxeAudit` to throw `new Error('Protocol error (Target.createTarget): ...')`; assert the handler **rethrows** (job does not settle the child `error`). A second case: `runAxeAudit` throws `new Error('HTTP 404 — ...')`; assert the child settles `error` + `pagesError` bump (current behavior preserved, no rethrow). Follow the existing mock style in that test file.

- [ ] **Step 2: Run → FAIL** (handler currently settles all throws).

- [ ] **Step 3: Implement the acquire helper in `runner.ts`.** Add `import { classifyRunnerError } from './runner-errors'`. Add a helper near the top of the module:

```ts
// Bucket 3: one 750ms-delayed retry when the pool/Chrome refuses a page
// (Target.createTarget/Target closed under load). Infrastructure ONLY.
async function acquirePageWithRetry(): Promise<Page> {
  try {
    return await acquirePage()
  } catch (err) {
    if (classifyRunnerError(err).kind !== 'infrastructure') throw err
    await new Promise((r) => setTimeout(r, 750))
    return await acquirePage()
  }
}
```

Replace the initial `let page = await acquirePage()` (line 134) with `let page = await acquirePageWithRetry()`, and the in-nav re-acquire `page = await acquirePage()` (line 373) with `page = await acquirePageWithRetry()`. (Leave the `isTransientRunnerError` in-nav retry logic at 363-395 otherwise unchanged — it handles timeout/frame-detach/cert, a separate concern.)

- [ ] **Step 4: Implement the handler rethrow in `site-audit-page.ts`.** Add `import { classifyRunnerError } from '@/lib/ada-audit/runner-errors'`. Change the catch (300-312):

```ts
  } catch (err) {
    // Bucket 3: an infrastructure failure (Chrome/pool/protocol) is NOT a
    // domain result — rethrow so the durable queue (maxAttempts:3) retries the
    // whole page job on a fresh tick. Every other kind keeps settle-as-domain.
    if (classifyRunnerError(err).kind === 'infrastructure') throw err
    const msg = err instanceof Error ? err.message : 'Audit failed'
    const settled = await settlePage(
      job, ['pagesError'],
      { status: 'error', error: msg, completedAt: new Date() }, ['running'],
    )
    if (settled) await finalizeWarn(job.siteAuditId, 'axe-error settle')
    return
  }
```

- [ ] **Step 5: Add a runner test** — in `runner.test.ts`, a unit test of `acquirePageWithRetry` behavior via the existing browser-pool mock: first `acquirePage` rejects with a Target error, second resolves → returns the page (one retry); first rejects with `HTTP 404` → rethrows immediately (no retry). If `acquirePageWithRetry` is not exported, test it through `runAxeAudit` with a mocked pool, or export it for testing.

- [ ] **Step 6: Run both test files → PASS.**
- [ ] **Step 7: Commit** — `git add lib/ada-audit/runner.ts lib/ada-audit/runner.test.ts lib/jobs/handlers/site-audit-page.ts lib/jobs/handlers/site-audit-page.test.ts && git commit -m "feat(sweep): B3 — one retry for transient Chrome acquire; handler rethrows infrastructure only"`

---

### Task 4: Bucket 4 — reclassify Location-bearing 3xx as redirected

**Files:**
- Modify: `lib/ada-audit/runner.ts` (3xx block `:309-329`)
- Test: `lib/ada-audit/runner.test.ts`

**Interfaces:** none new. Uses `response.url()`, `response.headers()['location']`, `response.request().redirectChain()`.

**Current gate (runner.ts:316):** classifies `redirected` only when `location && chain.length === 0`; a non-empty chain throws "did not auto-follow". Relax so ANY Location-bearing 3xx is `redirected`, resolving Location against `response.url()`; retain error only for no/malformed Location or a no-progress loop.

- [ ] **Step 1: Write the failing test** — in `runner.test.ts`, drive `runAxeAudit` (existing puppeteer mock harness) with a response returning `status()=301`, `headers().location='https://site.edu/final/'`, `url()='http://site.edu/'`, `redirectChain()=[{...}]` (non-empty). Assert the result is `{ kind: 'redirected', finalUrl: 'https://site.edu/final/' }` (NOT a thrown error). Add a second case: 301 with a Location equal (normalized) to the current final URL → still throws (no-progress loop). And a case: 301 with no Location header → still throws.

- [ ] **Step 2: Run → FAIL** (non-empty chain currently throws).

- [ ] **Step 3: Implement** — replace the 3xx block (309-329) with:

```ts
          if (status >= 300 && status < 400) {
            const finalUrl = response.url()
            const location = response.headers()['location'] ?? null
            if (location) {
              try {
                // Resolve against the FINAL response URL (handles mid-chain
                // http/https flips), not just the originally requested URL.
                const resolved = new URL(location, finalUrl).toString()
                // No-progress loop guard: a redirect pointing at its own final
                // URL (protocol-insensitive) is a genuine broken redirect.
                const norm = (u: string) => u.replace(/^https?:/, 'norm:').replace(/\/$/, '')
                if (norm(resolved) !== norm(finalUrl)) {
                  redirectedHolder.value = { finalUrl: resolved, rendered: false }
                  return
                }
              } catch { /* malformed Location — fall through to error */ }
            }
            const detail = location
              ? `Redirected to ${location} (final URL was ${finalUrl}); no forward progress`
              : `Server returned ${status} with no Location header (final URL: ${finalUrl})`
            throw new Error(`HTTP ${status} — ${detail}`)
          }
```

(Note: keep the `norm()` rule consistent with `normalizeForRedirect` in `redirect-detect.ts` — if that helper is exportable and pure, prefer importing it over the inline `norm`. Verify at implementation time; do NOT call `detectRedirect` here — this is the terminal-3xx branch, not the 2xx detector.)

- [ ] **Step 4: Run → PASS.** Also run the existing `redirect-detect.test.ts` to confirm no regression (the 2xx path is untouched).
- [ ] **Step 5: Commit** — `git add lib/ada-audit/runner.ts lib/ada-audit/runner.test.ts && git commit -m "feat(sweep): B4 — Location-bearing 3xx classified redirected, not error"`

---

### Task 5: Provider-navigation-ownership verification (Codex fix #4)

**Files:**
- Test: `lib/ada-audit/runner.test.ts` (both-mode cases)
- Modify (only if the verification finds a gap): `lib/ada-audit/runner.ts`

**Context:** `attemptNavigation` (with the HTTP-status/3xx inspection) runs at `runner.ts:351` BEFORE the provider branch at `:397`, so the axe pass appears to own its own `page.goto` in BOTH `LIGHTHOUSE_PROVIDER=local` and `pagespeed`. This task PROVES it (or fixes it).

- [ ] **Step 1: Verify the branch.** Read `runner.ts` fully around 397-500 and any `provider === 'local'` branch. Confirm whether a 404/3xx is observed by `attemptNavigation` regardless of `getLighthouseProvider()`. Write findings as a comment in the test file.

- [ ] **Step 2: Write both-mode tests** — in `runner.test.ts`, run the 404 (→ throws `HTTP 404`) and the non-empty-chain 3xx (→ `redirected`, from Task 4) cases with the Lighthouse provider mocked to `'local'` AND to `'pagespeed'`. Assert identical status-observation behavior in both.

- [ ] **Step 3: Run → PASS.** If (and only if) local mode does NOT observe status, implement a provider-independent main-document status check before handing navigation to Lighthouse, and re-run. Otherwise this is a test-only task documenting the invariant.

- [ ] **Step 4: Commit** — `git add lib/ada-audit/runner.ts lib/ada-audit/runner.test.ts && git commit -m "test(sweep): prove 404/3xx observation is provider-independent (local + pagespeed)"`

---

### Task 6: Bucket 1a — `HarvestedPageError` schema + migration + prune + recovery

**Files:**
- Modify: `prisma/schema.prisma` (new model + `SiteAudit.harvestedPageErrors` back-relation)
- Create: `prisma/migrations/<timestamp>_harvested_page_error/migration.sql`
- Modify: `lib/findings/retention.ts` (add `pruneHarvestedPageErrors`, call in `runCleanup` — mirror `pruneHarvestedLinks`)
- Modify: `lib/ada-audit/broken-link-recovery.ts` (add `HarvestedPageError` to the transient OR-set with the `crawlRuns:{none:{tool:'seo-parser'}}` fence)
- Test: `lib/findings/retention.test.ts` (or the existing prune test file), `lib/ada-audit/broken-link-recovery.test.ts`

**Interfaces:**
- Produces: `HarvestedPageError` model `{ id, siteAuditId, siteAudit, url, statusCode, createdAt }`, `@@unique([siteAuditId, url])`, `@@index([siteAuditId])`, `onDelete: Cascade`; `pruneHarvestedPageErrors(now?: Date): Promise<number>`.

- [ ] **Step 1: Edit `prisma/schema.prisma`** — add:

```prisma
model HarvestedPageError {
  id          String    @id @default(cuid())
  siteAuditId String
  siteAudit   SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  url         String
  statusCode  Int
  createdAt   DateTime  @default(now())
  @@unique([siteAuditId, url])
  @@index([siteAuditId])
}
```
and add `harvestedPageErrors HarvestedPageError[]` to the `SiteAudit` model.

- [ ] **Step 2: Author the migration SQL by hand** — `prisma/migrations/<timestamp>_harvested_page_error/migration.sql`:

```sql
CREATE TABLE "HarvestedPageError" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "siteAuditId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HarvestedPageError_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "HarvestedPageError_siteAuditId_url_key" ON "HarvestedPageError"("siteAuditId", "url");
CREATE INDEX "HarvestedPageError_siteAuditId_idx" ON "HarvestedPageError"("siteAuditId");
```
Use the real `<timestamp>` in `YYYYMMDDHHMMSS` form, later than the newest existing migration dir.

- [ ] **Step 3: Apply + regenerate** — `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`. Confirm `HarvestedPageError` is on the generated client (`npx tsc --noEmit`).

- [ ] **Step 4: Write the failing prune test** — mirror `pruneHarvestedLinks`'s test: seed a `HarvestedPageError` row with `createdAt` 8 days ago + one 1 day ago; `pruneHarvestedPageErrors(now)` deletes only the old one. Run → FAIL.

- [ ] **Step 5: Implement `pruneHarvestedPageErrors`** in `lib/findings/retention.ts`, copying the `pruneHarvestedLinks` shape (7-day window, `Date.now()`-based cutoff), and call it in `runCleanup` next to `pruneHarvestedLinks`. Run → PASS.

- [ ] **Step 6: Extend recovery** — in `broken-link-recovery.ts`, add a third `prisma.harvestedPageError.findMany({ where: { siteAudit: { crawlRuns: { none: { tool: 'seo-parser' } } } }, distinct: ['siteAuditId'], select: { siteAuditId: true } })` to the `Promise.all`, and union its ids into `pending`. Add a recovery test: a complete audit with only a `HarvestedPageError` row (no live-scan run, no verify job) gets a verifier re-enqueued; the same audit WITH a live-scan run does NOT. Run → PASS.

- [ ] **Step 7: Commit** — `git add prisma/schema.prisma prisma/migrations lib/findings/retention.ts lib/findings/retention.test.ts lib/ada-audit/broken-link-recovery.ts lib/ada-audit/broken-link-recovery.test.ts && git commit -m "feat(sweep): B1a — HarvestedPageError table + prune + recovery"`

---

### Task 7: Bucket 1b — capture 404/410 at page settle

**Files:**
- Modify: `lib/jobs/handlers/site-audit-page.ts` (the catch, after Task 3's rethrow branch)
- Test: `lib/jobs/handlers/site-audit-page.test.ts`

**Interfaces:**
- Consumes: `classifyRunnerError` (Task 2), `normalizeFindingUrl` (already imported at `site-audit-page.ts:39`), `HarvestedPageError` model (Task 6).

**Rule:** capture ONLY when the child settle WON (fenced, like `persistHarvest`) AND `classifyRunnerError(err)` is `{ kind: 'http-status', status: 404|410 }`. Normalize the URL. Duplicate insert (a retry) is harmless via `@@unique` — use a P2002-guarded create.

- [ ] **Step 1: Write the failing test** — mock `runAxeAudit` to throw `new Error('HTTP 404 — Redirected to ...')`; assert (a) child settles `error`, and (b) a `HarvestedPageError` row exists for the job URL with `statusCode: 404`. A `500` throw settles `error` but writes NO row. Run → FAIL.

- [ ] **Step 2: Implement** — add a helper + call it in the catch's settle branch (only after `settled === true`):

```ts
async function captureDeadPage(siteAuditId: string, url: string, err: unknown): Promise<void> {
  const c = classifyRunnerError(err)
  if (c.kind !== 'http-status' || (c.status !== 404 && c.status !== 410)) return
  try {
    await prisma.harvestedPageError.create({
      data: { siteAuditId, url: normalizeFindingUrl(url), statusCode: c.status },
    })
  } catch (e) {
    // P2002 (a retry re-inserting the same (siteAuditId,url)) is harmless.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) {
      console.error('[dead-page] capture failed', siteAuditId, url, e)
    }
  }
}
```
In the catch, after `if (settled) { await finalizeWarn(...) }`, insert `if (settled) await captureDeadPage(job.siteAuditId, job.url, err)` BEFORE the `return` (capture fenced to the winning settle, so a zombie attempt writes nothing). `Prisma` is already imported (`site-audit-page.ts:29`).

- [ ] **Step 3: Run → PASS.**
- [ ] **Step 4: Commit** — `git add lib/jobs/handlers/site-audit-page.ts lib/jobs/handlers/site-audit-page.test.ts && git commit -m "feat(sweep): B1b — capture 404/410 dead pages at settle"`

---

### Task 8: Bucket 1c — dead-page mapper + finding-type registration

**Files:**
- Create: `lib/findings/dead-page-mapper.ts`
- Create: `lib/findings/dead-page-mapper.test.ts`
- Modify: `lib/findings/finding-type-sets.ts` (add `dead_page` type + label)
- Test: `lib/findings/finding-type-sets.test.ts`

**Interfaces:**
- Produces: `mapDeadPageFindings(rows: { url: string; statusCode: number }[], deps: { runId: string; ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput; affectedComplete: boolean }): FindingInput[]`; and `DEAD_PAGE_FINDING_TYPE = 'dead_page'` + label in finding-type-sets.
- Consumes: `runFindingKey`, `pageFindingKey`, `normalizeFindingUrl` from `lib/findings/keys`; `FindingInput`/`CrawlPageInput` from `lib/findings/types`.

- [ ] **Step 1: Write the failing test** — `dead-page-mapper.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { mapDeadPageFindings } from './dead-page-mapper'
import type { CrawlPageInput } from './types'

function fakeEnsurePage() {
  const pages: CrawlPageInput[] = []
  const ensurePage = (url: string) => {
    let p = pages.find((x) => x.url === url)
    if (!p) { p = { id: `p-${pages.length}`, runId: 'r1', url } as CrawlPageInput; pages.push(p) }
    return p
  }
  return { ensurePage, pages }
}

describe('mapDeadPageFindings', () => {
  it('emits one page finding per dead url + one run finding (count = distinct urls)', () => {
    const { ensurePage } = fakeEnsurePage()
    const out = mapDeadPageFindings(
      [{ url: 'https://x.edu/a', statusCode: 404 }, { url: 'https://x.edu/b', statusCode: 410 }],
      { runId: 'r1', ensurePage, affectedComplete: true },
    )
    const run = out.filter((f) => f.scope === 'run')
    const page = out.filter((f) => f.scope === 'page')
    expect(run).toHaveLength(1)
    expect(run[0]).toMatchObject({ type: 'dead_page', scope: 'run', count: 2, severity: 'warning' })
    expect(page).toHaveLength(2)
    expect(JSON.parse(page[0].detail!)).toMatchObject({ statusCode: 404 })
  })
  it('leaves CrawlPage.statusCode null (does not inflate observed coverage)', () => {
    const { ensurePage, pages } = fakeEnsurePage()
    mapDeadPageFindings([{ url: 'https://x.edu/a', statusCode: 404 }], { runId: 'r1', ensurePage, affectedComplete: true })
    expect(pages[0].statusCode ?? null).toBeNull()
  })
  it('empty rows → no findings', () => {
    const { ensurePage } = fakeEnsurePage()
    expect(mapDeadPageFindings([], { runId: 'r1', ensurePage, affectedComplete: true })).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `lib/findings/dead-page-mapper.ts`

```ts
// lib/findings/dead-page-mapper.ts
// C21 sweep-triage (Bucket 1): dead audited URLs (HTTP 404/410 in the crawl
// frontier) -> dead_page findings on the live-scan run. One page-scope finding
// per dead url (detail carries statusCode), one run-scope count = distinct urls.
// ensurePage is called WITHOUT statusCode so a dead page never counts as
// "observed/analyzed" in coverage/score math.
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import { DEAD_PAGE_FINDING_TYPE } from './finding-type-sets'
import type { CrawlPageInput, FindingInput } from './types'

export interface DeadPageRow { url: string; statusCode: number }
export interface DeadPageMapDeps {
  runId: string
  ensurePage: (url: string, scalars?: Partial<CrawlPageInput>) => CrawlPageInput
  affectedComplete: boolean
}

export function mapDeadPageFindings(rows: DeadPageRow[], deps: DeadPageMapDeps): FindingInput[] {
  const { runId, ensurePage, affectedComplete } = deps
  if (rows.length === 0) return []
  // Distinct by normalized url; first statusCode wins.
  const byUrl = new Map<string, number>()
  for (const r of rows) {
    const u = normalizeFindingUrl(r.url)
    if (!byUrl.has(u)) byUrl.set(u, r.statusCode)
  }
  const findings: FindingInput[] = [{
    id: randomUUID(), runId, pageId: null, scope: 'run', type: DEAD_PAGE_FINDING_TYPE,
    severity: 'warning', url: null, count: byUrl.size, affectedComplete,
    affectedSource: 'live-scan-frontier',
    detail: JSON.stringify({ description: 'Audited URLs that return HTTP 404/410 (advertised by the sitemap/crawl but gone).' }),
    dedupKey: runFindingKey(DEAD_PAGE_FINDING_TYPE),
  }]
  for (const [url, statusCode] of byUrl) {
    const p = ensurePage(url) // NO statusCode scalar — must stay null
    findings.push({
      id: randomUUID(), runId, pageId: p.id, scope: 'page', type: DEAD_PAGE_FINDING_TYPE,
      severity: 'warning', url, count: 1, affectedComplete, affectedSource: 'live-scan-frontier',
      detail: JSON.stringify({ statusCode }), dedupKey: pageFindingKey(DEAD_PAGE_FINDING_TYPE, url),
    })
  }
  return findings
}
```

- [ ] **Step 4: Register the type** in `finding-type-sets.ts` — add:

```ts
export const DEAD_PAGE_FINDING_TYPE = 'dead_page' as const
export const DEAD_PAGE_FINDING_LABEL = 'Dead pages (404/410)'
```
Extend `finding-type-sets.test.ts` with an assertion that the label exists. (Verify `FindingInput` allows the `affectedSource` string used above and required fields match — check `lib/findings/types.ts`.)

- [ ] **Step 5: Run both test files → PASS.**
- [ ] **Step 6: Commit** — `git add lib/findings/dead-page-mapper.ts lib/findings/dead-page-mapper.test.ts lib/findings/finding-type-sets.ts lib/findings/finding-type-sets.test.ts && git commit -m "feat(sweep): B1c — dead_page mapper + type registration"`

---

### Task 9: Bucket 1d — builder reads HarvestedPageError, emits + deletes

**Files:**
- Modify: `lib/jobs/handlers/broken-link-verify.ts` (read near the other transient reads; map near `:624-643`; delete near `:915`)
- Create: `lib/jobs/handlers/broken-link-verify.dead-page.test.ts`
- **Do NOT modify** `broken-link-verify.characterization.test.ts` (must stay byte-identical)

**Interfaces:** Consumes `mapDeadPageFindings` (Task 8), the builder's existing `runId` + `ensurePage` (`:592`).

- [ ] **Step 1: Write the failing test** — `broken-link-verify.dead-page.test.ts`: seed a completed SiteAudit with two `HarvestedPageError` rows (404 + 410) and no HarvestedLink/HarvestedPageSeo; run `runBrokenLinkVerify` (follow the harness in the existing characterization test for deps injection); assert (a) the live-scan `CrawlRun` has a run-scope `dead_page` finding count 2 + two page findings, (b) the `HarvestedPageError` rows are deleted after the run commits, (c) `CrawlPage.statusCode` is null for the dead pages. Run → FAIL.

- [ ] **Step 2: Implement the read** — near the other transient reads (after `seoRows` at `:324`), add:

```ts
  const deadPageRows = await prisma.harvestedPageError.findMany({
    where: { siteAuditId: job.siteAuditId }, select: { url: true, statusCode: true },
  })
```

- [ ] **Step 3: Implement the map** — after `validationFindings` (`:642`), add:

```ts
  const deadPageFindings = mapDeadPageFindings(deadPageRows, {
    runId, ensurePage, affectedComplete: true,
  })
```
and extend the findings array (`:643`): `const findings: FindingInput[] = [...onPageFindings, ...brokenFindings, ...externalFindings, ...validationFindings, ...deadPageFindings]`. Add the import: `import { mapDeadPageFindings } from '@/lib/findings/dead-page-mapper'`.

- [ ] **Step 4: Implement the delete** — after `writeFindingsRun(bundle)` and next to `await prisma.harvestedLink.deleteMany(...)` (`:915`):

```ts
  await prisma.harvestedPageError.deleteMany({ where: { siteAuditId: job.siteAuditId } })
```

- [ ] **Step 5: Run the new test → PASS. Run the frozen characterization test → still PASS byte-identical** (its fixtures seed no `HarvestedPageError`, so the happy-path output is unchanged). `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.characterization.test.ts lib/jobs/handlers/broken-link-verify.dead-page.test.ts`.
- [ ] **Step 6: Commit** — `git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.dead-page.test.ts && git commit -m "feat(sweep): B1d — builder emits dead_page findings + deletes transient rows"`

---

### Task 10: Bucket 1e — DeadPagesSection UI (results + share)

**Files:**
- Create: `components/site-audit/DeadPagesSection.tsx`
- Modify: `components/ada-audit/SiteAuditResultsShell.tsx` (or the SEO-tab section stack file — locate where `BrokenLinksSection`/`OnPageSeoSection` are rendered; grep `BrokenLinksSection`)
- Test: `components/site-audit/DeadPagesSection.test.tsx`

**Interfaces:** Consumes the live-scan run's `dead_page` findings (page-scope rows with `detail.statusCode`), filtered by `DEAD_PAGE_FINDING_TYPE`. Mirror `BrokenLinksSection`'s data-loading/prop shape.

- [ ] **Step 1: Locate the pattern** — read `components/site-audit/BrokenLinksSection.tsx` + how it's wired into the shell + share page. Match its props (findings list, `shareMode`, states not-scanned / none / findings).

- [ ] **Step 2: Write the failing test** — `DeadPagesSection.test.tsx`: given `dead_page` findings, renders the URL list + status codes; given none, renders the clean/none state; dark-mode classes present. Run → FAIL.

- [ ] **Step 3: Implement `DeadPagesSection.tsx`** — a server component mirroring `BrokenLinksSection` scoped to `DEAD_PAGE_FINDING_TYPE`; dark-mode `dark:` variants on every element; render each dead URL with its `detail.statusCode`. States: not-scanned (no live-scan run) / none (run but no dead_page findings) / list.

- [ ] **Step 4: Wire into BOTH the authenticated SEO-tab stack AND the share-page stack** (share = server-loaded, token-validated, read-only — no cookie-gated fetch). Run the component test + a share-page render check → PASS.

- [ ] **Step 5: Commit** — `git add components/site-audit/DeadPagesSection.tsx components/site-audit/DeadPagesSection.test.tsx components/ada-audit/SiteAuditResultsShell.tsx && git commit -m "feat(sweep): B1e — DeadPagesSection on results + share SEO tab"`

---

### Task 11: Bucket 5 — complete the sweep unit map (via `findingUnit`)

**Files:**
- Modify: `lib/findings/finding-type-sets.ts` (add `findingUnit`)
- Modify: `lib/sweep/snapshot.ts` (`unitForType` delegates to `findingUnit`)
- Test: `lib/findings/finding-type-sets.test.ts`, `lib/sweep/snapshot.test.ts`

**Interfaces:**
- Produces: `findingUnit(tool: 'ada-audit' | 'seo-parser', type: string): 'pages' | 'targets' | 'groups' | null` — returns the unit for known types, `null` for unknown (caller logs + falls back).

**Unit assignments (from `validation-mapper.ts` run-scope count semantics):** page-derived validation types (`canonical_broken`, `canonical_redirect`, `redirect_chain`, `redirect_loop`, `hreflang_broken`, `hreflang_no_return`, `hreflang_missing_self`, `hreflang_missing_x_default`, `hreflang_invalid_code`) → `pages` (run count = distinct pages); external-unverified notices (`canonical_external_unverified`, `hreflang_external_unverified`) → `targets`; `dead_page` → `pages`. On-page/broken/duplicate types keep their current mapping.

- [ ] **Step 1: Write the failing test** — in `finding-type-sets.test.ts`, assert `findingUnit('seo-parser','redirect_chain')==='pages'`, `findingUnit('seo-parser','canonical_external_unverified')==='targets'`, `findingUnit('seo-parser','dead_page')==='pages'`, `findingUnit('ada-audit','image-alt')==='pages'`, `findingUnit('seo-parser','totally_unknown')===null`, and each existing on-page/broken type maps as before. Run → FAIL.

- [ ] **Step 2: Implement `findingUnit`** in `finding-type-sets.ts` — a single client-safe lookup: ADA tool → `'pages'`; broken types → `'targets'`; duplicate types → `'groups'`; on-page missing/thin → `'pages'`; the validation page-derived set → `'pages'`; external-unverified set → `'targets'`; `dead_page` → `'pages'`; else `null`. Reuse the existing `*_FINDING_TYPE_SET` constants; add a `VALIDATION_FINDING_UNITS` map for the 11 validation types.

- [ ] **Step 3: Delegate in `snapshot.ts`** — replace the body of `unitForType` (`:105-116`):

```ts
function unitForType(tool: SweepTool, type: string): IssueUnit {
  const u = findingUnit(tool, type)
  if (u) return u
  logError({ event: 'sweep_unmapped_issue_unit', tool, type }, new Error('[sweep] unmapped issue unit'))
  return 'groups'
}
```
Add `import { findingUnit } from '@/lib/findings/finding-type-sets'`. Remove the now-dead local `TARGET_TYPES`/`GROUP_TYPES`/`PAGE_ONPAGE_TYPES` sets if `findingUnit` fully subsumes them.

- [ ] **Step 4: Add a `snapshot.test.ts` case** — a run with `redirect_chain` + `canonical_external_unverified` + `dead_page` findings produces groups with units `pages`/`targets`/`pages` and NO `sweep_unmapped_issue_unit` logError (spy on `logError`). Run both files → PASS.

- [ ] **Step 5: Commit** — `git add lib/findings/finding-type-sets.ts lib/findings/finding-type-sets.test.ts lib/sweep/snapshot.ts lib/sweep/snapshot.test.ts && git commit -m "feat(sweep): B5 — complete unit map via findingUnit (validation + dead_page)"`

---

### Task 12: Coverage-reason label fix — `pagesError` as a partial cause

**Files:**
- Modify: `lib/sweep/classify.ts` (`PairObservation` + `classifyCoverage`)
- Modify: `lib/sweep/snapshot.ts` (`loadAuditForSnapshot` selects `pagesError`; populate observation; `reasonFor`)
- Test: `lib/sweep/classify.test.ts`, `lib/sweep/snapshot.test.ts`

**Interfaces:**
- `PairObservation` gains `pagesError: number`.
- `classifyCoverage` precedence-2 partial predicate gains `pagesError > 0`.
- `reasonFor` precedence: `crawl-capped → pages-errored → attribution-incomplete → coverage-capped`.

- [ ] **Step 1: Write the failing classify test** — in `classify.test.ts`: an observation `{ runPresent:true, runStatus:'complete', discoveryCapped:false, attributionComplete:true, pagesError:3 }` with `baselineAvailable:true` classifies `partial` (was `comparable`). With `pagesError:0` it stays `comparable`. Run → FAIL.

- [ ] **Step 2: Implement in `classify.ts`** — add `pagesError: number` to `PairObservation`; in `classifyCoverage` precedence 2:

```ts
  else if (
    current.discoveryCapped || current.runStatus === 'partial' ||
    current.pagesError > 0 || !current.attributionComplete
  ) {
    state = 'partial'
  }
```

- [ ] **Step 3: Write the failing snapshot test** — in `snapshot.test.ts`: a member whose loaded audit has `pagesError > 0` and an otherwise-complete run yields coverage `state:'partial'`, `reason:'pages-errored'` for both tools; a run with `runStatus:'partial'` and `pagesError:0` yields `reason:'coverage-capped'`; `discoveryCapped` still wins as `crawl-capped`. Run → FAIL.

- [ ] **Step 4: Implement in `snapshot.ts`** — (a) `loadAuditForSnapshot`: add `pagesError: true` to the `siteAudit.findUnique` select, and return it on `AuditLoad` (add `pagesError: number` to that interface, default 0); (b) in `computeSweepSnapshot`, populate `obs.pagesError = load.pagesError` for both tool pairs; (c) rewrite `reasonFor`:

```ts
function reasonFor(state: CoverageState, obs: PairObservation): string | null {
  if (state === 'failed') return 'run-missing'
  if (state === 'partial') {
    if (obs.discoveryCapped) return 'crawl-capped'
    if (obs.pagesError > 0) return 'pages-errored'
    if (!obs.attributionComplete) return 'attribution-incomplete'
    return 'coverage-capped'   // runStatus 'partial' with no pagesError (verifier-capped)
  }
  return null
}
```
Also update the audit-less `reasonForNoAudit` callers only if needed (they don't observe `pagesError` — unchanged). The empty-observation branch (`classifyCoverage(null, …)`) must still construct a `PairObservation` with `pagesError: 0` where one is built — audit-less members already pass `null`, so no change there; the WITH-audit `obs` literal (`snapshot.ts:308`) gains `pagesError: load.pagesError`.

- [ ] **Step 5: Grep the renderers for a hardcoded label** — `grep -rn "timed-out\|timed out" app components lib/notify` — confirm `/issues` + digest render `PairCoverage.reason` verbatim (no hardcoded `timed-out` string that needs updating). Fix any found.

- [ ] **Step 6: Run both test files → PASS.**
- [ ] **Step 7: Commit** — `git add lib/sweep/classify.ts lib/sweep/classify.test.ts lib/sweep/snapshot.ts lib/sweep/snapshot.test.ts && git commit -m "feat(sweep): label fix — pagesError as conservative partial cause + honest reason"`

---

## Final gates (before PR)

- [ ] `npm run lint` → 0 errors
- [ ] `DATABASE_URL="file:./local-dev.db" npm test` → all green (incl. the FROZEN characterization test, byte-identical)
- [ ] `npm run build` → succeeds
- [ ] `npm run smoke` (ADA pipeline touched) → green (macOS: `export CHROME_EXECUTABLE=...` first)
- [ ] Open PR; merge when gate-green (change-control rule 1).

## Post-deploy prod verification (change-control step 8)

Deploy (`ssh $PROD_SSH "~/deploy.sh"` — migration applies automatically), then trigger ONE client site-audit of a domain with known sitemap 404s (e.g. healthcarecareercollege.edu had 35). Confirm:
- [ ] No `/cdn-cgi/` URL in the audited page set (check the audit's page rows).
- [ ] A `dead_page` finding appears on the live-scan run; `DeadPagesSection` renders it (results + share).
- [ ] `CrawlPage.statusCode` is null for the dead URLs (observed coverage not inflated).
- [ ] On a manual snapshot recompute (or the next Monday sweep), the coverage reason reads `pages-errored`, and no `sweep_unmapped_issue_unit` logError fires for validation types.
- [ ] Recovery does not repeatedly re-scan a completed audit whose live-scan run committed (grep `[broken-link-verify] recovery` in logs across two stale-audit-reset ticks).

## Tracker + handoff ritual (change-control hard gate 2)

On ship: tracker checkbox + dated status-log line + rewritten `HANDOFF-improvement-roadmap.md` in the same commit; move this spec + plan to `docs/superpowers/archive/`.
