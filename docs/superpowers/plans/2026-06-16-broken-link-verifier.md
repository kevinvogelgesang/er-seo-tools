# C6 Phase 1 — Broken-Link Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harvest `<a href>`/`<img src>` targets during the ADA site audit, verify the deduped set out-of-band on the durable job queue, and persist broken links/images as a `source:'live-scan'` `tool:'seo-parser'` `CrawlRun` sharing the audit's `SiteAudit` origin.

**Architecture:** A new transient `HarvestedLink` table captures per-page link/image targets inside the existing page-settle transaction. A new durable `broken-link-verify` job (enqueued after the audit reaches `complete`) dedupes targets, checks each via `safeFetch` (HEAD→GET, throttled, capped), writes a live-scan `FindingsBundle` through the existing `writeFindingsRun()`, and deletes the harvest rows. The named C6 migration (`@@unique([siteAuditId, tool])`) lands FIRST so the live-scan run coexists with the ADA run instead of clobbering it.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma + SQLite, puppeteer-core, the durable job queue (`lib/jobs/`), Vitest. Node 22.

**Spec:** `docs/superpowers/specs/2026-06-16-broken-link-verifier-design.md`

**Local-dev quirks (CLAUDE.md / handoff):**
- Prefix every Prisma CLI + vitest with `DATABASE_URL="file:./local-dev.db"`.
- `prisma migrate dev` is interactive-only — **write migration SQL by hand**, apply with `prisma migrate deploy`.
- DB-backed tests: unique domain/id prefix per file, scope cleanup to tracked ids, clean `CrawlRun` by domain BEFORE origin rows, never broad `deleteMany` on shared tables.

---

## File Structure

**Create:**
- `prisma/migrations/20260616000000_c6_unique_siteaudit_tool/migration.sql` — drop single-field unique, add compound unique, add `HarvestedLink` table.
- `lib/ada-audit/link-harvest.ts` — pure DOM harvest (`harvestLinks`, `normalizeLinkTarget`).
- `lib/ada-audit/link-harvest.test.ts`
- `lib/findings/broken-link-mapper.ts` — pure: verifier results → `FindingsBundle`.
- `lib/findings/broken-link-mapper.test.ts`
- `lib/ada-audit/broken-link-check.ts` — pure-ish: single-URL check (HEAD→GET) + per-host throttle scheduler, transport-injectable.
- `lib/ada-audit/broken-link-check.test.ts`
- `lib/jobs/handlers/broken-link-verify.ts` — the durable handler + `enqueueBrokenLinkVerify` facade + recovery sweep helper.
- `lib/jobs/handlers/broken-link-verify.test.ts`
- `components/site-audit/BrokenLinksSection.tsx` — results-page UI block.

**Modify:**
- `prisma/schema.prisma` — `CrawlRun.siteAuditId` unique→compound; **`SiteAudit.crawlRun?`→`crawlRuns[]`** (one-to-one→list, forced by dropping the unique); `HarvestedLink` model (+`harvestTruncated`) + `SiteAudit.harvestedLinks` back-relation.
- `lib/findings/writer.ts` — re-key the `siteAuditId` delete branch to the compound key.
- `lib/findings/parity.ts`, `lib/report/report-data.ts`, `lib/services/site-audit-diff.ts`, `lib/ada-audit/findings-fallback.ts`, `scripts/findings-rebuild.ts`, `app/api/site-audit/[id]/{vpat,report,csv}/route.ts`, `app/ada-audit/site/[id]/page.tsx`, `app/ada-audit/site/share/[token]/page.tsx` — re-key the 10 `findUnique({where:{siteAuditId}})` readers.
- `app/api/site-audit/route.ts`, `app/api/clients/audit-summary/route.ts`, `app/api/audit-batches/[id]/route.ts`, `lib/ada-audit/recents-query.ts`, `lib/services/client-schedules.ts` — re-key the 5 `crawlRun` (singular) relation-includes to `crawlRuns: { where: { tool: 'ada-audit' } }` + `[0]`.
- `lib/services/client-dashboard.ts`, `lib/services/client-fleet.ts` — exclude `source:'live-scan'` from the B1 SEO score series.
- `lib/findings/adapter-readiness.test.ts` — flip the limitation case to coexistence.
- `lib/ada-audit/runner.ts` — capture `harvestedLinks` on the `audited` result.
- `lib/jobs/handlers/site-audit-page.ts` — persist `HarvestedLink` rows in the settle txn (chunked).
- `lib/ada-audit/site-audit-finalizer.ts` — enqueue the verifier after `complete`.
- `lib/jobs/handlers/register.ts` — register the new handler.
- `lib/findings/retention.ts` — `pruneHarvestedLinks` + make `pruneArchivedBlobs` tool-origin-aware.
- `lib/ada-audit/queue-manager.ts` (`recoverQueue`) + `lib/jobs/handlers/stale-audit-reset.ts` (or `lib/ada-audit/standalone-recovery.ts` sweep site) — verifier enqueue-recovery sweep.
- `lib/services/findings-shared.ts` — source-aware SEO selection (exclude live-scan from score, add `liveScan`).
- `lib/services/client-findings.ts` — additively surface live-scan broken-link findings.
- `lib/types.ts` — add `'live-scan-verify'` to `Issue.affectedUrlSource` union.
- `app/ada-audit/site/[id]/page.tsx` — render `BrokenLinksSection`.
- `lib/jobs/config.ts` is reused for `parsePositiveInt` (no change).

---

## Phase 1 — The named migration (ships FIRST)

### Task 1: Schema — compound unique + HarvestedLink model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Change `CrawlRun.siteAuditId` from `@unique` to a compound unique**

In `model CrawlRun`, remove `@unique` from the `siteAuditId` line and add a block-level compound unique alongside the existing `@@index` lines:

```prisma
  siteAuditId     String?
  siteAudit       SiteAudit? @relation(fields: [siteAuditId], references: [id], onDelete: SetNull)
```
```prisma
  @@unique([siteAuditId, tool])
  @@index([clientId, tool, createdAt])
  @@index([domain, createdAt])
  @@index([createdAt])
```

(Leave `sessionId @unique` and `adaAuditId @unique` exactly as they are.)

**Also change `model SiteAudit`'s back-relation from one-to-one to a list** (REQUIRED — Codex review). `SiteAudit.crawlRun CrawlRun?` (`prisma/schema.prisma:152`) is one-to-one and *requires* the `@unique` we are removing, so `prisma validate` fails unless it becomes a list:

```prisma
  crawlRuns        CrawlRun[]
```

(Do NOT confuse this with `Client.crawlRuns CrawlRun[]` at line 29 — different model. `Session`/`AdaAudit` keep their singular `crawlRun CrawlRun?`.)

- [ ] **Step 2: Add the `HarvestedLink` model** (end of file, near other findings models)

```prisma
model HarvestedLink {
  id            String    @id @default(cuid())
  siteAuditId   String
  siteAudit     SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  sourcePageUrl String
  targetUrl     String
  kind          String    // 'internal-link' | 'image' | 'external-link'
  harvestTruncated Boolean @default(false)
  createdAt     DateTime  @default(now())

  @@index([siteAuditId])
  @@index([siteAuditId, targetUrl])
}
```

- [ ] **Step 3: Add the back-relation to `SiteAudit`**

In `model SiteAudit`, next to `crawlRuns CrawlRun[]`, add:

```prisma
  harvestedLinks        HarvestedLink[]
```

- [ ] **Step 4: Format + validate (no migration yet)**

Run: `DATABASE_URL="file:./local-dev.db" npx prisma validate`
Expected: "The schema is valid."

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(c6): schema — CrawlRun @@unique([siteAuditId, tool]) + HarvestedLink"
```

---

### Task 2: Hand-written migration SQL

**Files:**
- Create: `prisma/migrations/20260616000000_c6_unique_siteaudit_tool/migration.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Drop the old single-field unique index on CrawlRun.siteAuditId.
DROP INDEX "CrawlRun_siteAuditId_key";

-- Compound unique: one CrawlRun per (siteAuditId, tool). NULL siteAuditId rows
-- (session/standalone origins) are unconstrained — SQLite allows many NULLs.
CREATE UNIQUE INDEX "CrawlRun_siteAuditId_tool_key" ON "CrawlRun"("siteAuditId", "tool");

-- Transient harvested link/image targets (deleted post-verify; 7-day retention backstop).
CREATE TABLE "HarvestedLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteAuditId" TEXT NOT NULL,
    "sourcePageUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "harvestTruncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HarvestedLink_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "HarvestedLink_siteAuditId_idx" ON "HarvestedLink"("siteAuditId");
CREATE INDEX "HarvestedLink_siteAuditId_targetUrl_idx" ON "HarvestedLink"("siteAuditId", "targetUrl");
```

- [ ] **Step 2: Apply + regenerate the client**

Run: `DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate`
Expected: migration applied, client regenerated. (`prisma.harvestedLink` accessor now exists; `crawlRun.findUnique({where:{siteAuditId_tool:...}})` is the new key.)

- [ ] **Step 3: Typecheck (expected to FAIL — proves the reader re-key is enforced)**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit 2>&1 | grep -c "siteAuditId"`
Expected: non-zero — the 10 `findUnique({where:{siteAuditId}})` sites are now type errors (single-field unique gone). Task 3 fixes them.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations
git commit -m "feat(c6): migration — compound unique + HarvestedLink table"
```

---

### Task 3: Re-key the writer + 10 readers to the compound key

**Files:**
- Modify: `lib/findings/writer.ts:30-34`
- Modify (readers): `lib/ada-audit/findings-fallback.ts:114`, `app/api/site-audit/[id]/vpat/route.ts:19`, `app/api/site-audit/[id]/report/route.ts:27`, `app/api/site-audit/[id]/csv/route.ts:58`, `app/ada-audit/site/share/[token]/page.tsx:30`, `app/ada-audit/site/[id]/page.tsx:142`, `lib/findings/parity.ts:218`, `lib/report/report-data.ts:146`, `lib/services/site-audit-diff.ts:39`, `scripts/findings-rebuild.ts:16`

- [ ] **Step 1: Re-key the writer's delete branch**

In `lib/findings/writer.ts`, change the `where` derivation:

```ts
  const where = run.sessionId
    ? { sessionId: run.sessionId }
    : run.siteAuditId
      ? { siteAuditId_tool: { siteAuditId: run.siteAuditId, tool: run.tool } }
      : { adaAuditId: run.adaAuditId! }
```

- [ ] **Step 2: Re-key the 9 ADA-run readers**

For each of these, change `where: { siteAuditId: <id> }` → `where: { siteAuditId_tool: { siteAuditId: <id>, tool: 'ada-audit' } }` (keeping each call's existing `select`/`include`):
- `lib/ada-audit/findings-fallback.ts:114`
- `app/api/site-audit/[id]/vpat/route.ts:19`
- `app/api/site-audit/[id]/report/route.ts:27`
- `app/api/site-audit/[id]/csv/route.ts:58`
- `app/ada-audit/site/share/[token]/page.tsx:30`
- `app/ada-audit/site/[id]/page.tsx:142`
- `lib/findings/parity.ts:218` (the `compareAdaParity` site path — `where: { siteAuditId }`)
- `lib/report/report-data.ts:146`
- `lib/services/site-audit-diff.ts:39`

Example (findings-fallback.ts:114):
```ts
  const run = await prisma.crawlRun.findUnique({
    where: { siteAuditId_tool: { siteAuditId, tool: 'ada-audit' } },
    select: { id: true },
  })
```

- [ ] **Step 3: Re-key the rebuild script (tool-aware)**

In `scripts/findings-rebuild.ts`, the `where` is auto-detected from the id-type arg. For a SiteAudit id, build the compound key defaulting to `ada-audit` and accept an optional 2nd arg for tool:

```ts
// after detecting the arg is a siteAuditId:
const tool = (process.argv[3] as 'ada-audit' | 'seo-parser') ?? 'ada-audit'
where = { siteAuditId_tool: { siteAuditId: id, tool } }
```
(Leave the `sessionId` / `adaAuditId` branches unchanged.)

- [ ] **Step 3b: Re-key the 5 relation-include readers (Codex fix #2)**

`SiteAudit.crawlRun?`→`crawlRuns[]` breaks every `prisma.siteAudit` query that includes `crawlRun` singular. Re-key each to filter the ADA run and read `[0]`:

```ts
// before:  crawlRun: { select: { score: true } }   → row.crawlRun?.score
// after:   crawlRuns: { where: { tool: 'ada-audit' }, select: { score: true } }
//          → row.crawlRuns[0]?.score ?? null
```
Apply at: `app/api/site-audit/route.ts:83`, `app/api/clients/audit-summary/route.ts:40`, `app/api/audit-batches/[id]/route.ts` (nested under `siteAudits`), `lib/ada-audit/recents-query.ts` (the `prisma.siteAudit.findMany` branch — NOT the `prisma.adaAudit` branch above it), `lib/services/client-schedules.ts:48` (also selects `id` — keep it: `crawlRuns: { where: { tool: 'ada-audit' }, select: { id: true, score: true } }`). Update each consumer's read site to index `[0]`. (Leave `prisma.adaAudit`/`prisma.session` `crawlRun` includes singular.)

- [ ] **Step 4: Typecheck — now clean**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`
Expected: PASS (zero errors — both the `findUnique` re-key and the relation-include re-key resolve the type errors the migration introduced).

- [ ] **Step 5: Close-gate grep (both shapes)**

Run: `rg -n "crawlRun\b" app lib scripts | rg "siteAudit"` then manually confirm no `prisma.siteAudit` query still includes `crawlRun` singular or `findUnique({where:{siteAuditId}})`.
Expected: no stray singular `crawlRun` on a SiteAudit query.

- [ ] **Step 6: Commit**

```bash
git add lib app scripts
git commit -m "feat(c6): re-key writer + 10 readers to { siteAuditId, tool }"
```

---

### Task 4: Flip the adapter-readiness test to coexistence

**Files:**
- Modify: `lib/findings/adapter-readiness.test.ts:59-66`

- [ ] **Step 1: Rewrite the limitation case as coexistence**

Replace the second `it(...)` block:

```ts
  it('a live-scan seo-parser run and an ada-audit run COEXIST on one SiteAudit (C6 migration lifted the limitation)', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: SITE_AUDIT_DOMAIN, status: 'complete' } })
    await writeFindingsRun(liveScanBundle('c5ar-run-2', { siteAuditId: sa.id }, 'ada-audit'))
    await writeFindingsRun(liveScanBundle('c5ar-run-3', { siteAuditId: sa.id }, 'seo-parser'))
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId: sa.id }, orderBy: { tool: 'asc' } })
    expect(runs).toHaveLength(2)
    expect(runs.map((r) => r.tool)).toEqual(['ada-audit', 'seo-parser'])

    // A second seo-parser write replaces ONLY the seo-parser run, leaving ada-audit intact.
    await writeFindingsRun(liveScanBundle('c5ar-run-4', { siteAuditId: sa.id }, 'seo-parser'))
    const after = await prisma.crawlRun.findMany({ where: { siteAuditId: sa.id }, orderBy: { tool: 'asc' } })
    expect(after).toHaveLength(2)
    expect(after.find((r) => r.tool === 'ada-audit')!.id).toBe('c5ar-run-2')
    expect(after.find((r) => r.tool === 'seo-parser')!.id).toBe('c5ar-run-4')
  })
```

Update the `describe` comment header to note the limitation is lifted.

- [ ] **Step 2: Run the test**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/adapter-readiness.test.ts`
Expected: PASS (2 tests — the first, unchanged session-origin test still passes).

- [ ] **Step 3: Commit**

```bash
git add lib/findings/adapter-readiness.test.ts
git commit -m "test(c6): adapter-readiness flips to run coexistence"
```

---

## Phase 2 — Harvest layer (pure)

### Task 5: `link-harvest.ts`

**Files:**
- Create: `lib/ada-audit/link-harvest.ts`
- Test: `lib/ada-audit/link-harvest.test.ts`

- [ ] **Step 1: Write the failing test** (pure `classifyTargets` over raw hrefs; the `page.evaluate` wrapper is integration-covered)

```ts
import { describe, it, expect } from 'vitest'
import { classifyTargets, normalizeLinkTarget } from './link-harvest'

const base = 'https://www.example.com/dir/page'

describe('normalizeLinkTarget', () => {
  it('resolves relative, strips fragment, lowercases host, keeps query', () => {
    expect(normalizeLinkTarget('../a?id=7#x', base)).toBe('https://www.example.com/a?id=7')
  })
  it('returns null for non-navigational schemes and bare fragments', () => {
    for (const r of ['#top', 'mailto:a@b.com', 'javascript:void(0)', 'tel:+1', 'data:x'])
      expect(normalizeLinkTarget(r, base)).toBeNull()
  })
})

describe('classifyTargets', () => {
  it('classifies internal-link vs external-link vs image, www-insensitive, deduped, capped', () => {
    const links = ['/a', '/a', 'https://other.com/x', 'https://example.com/b']
    const images = ['/img/logo.png', 'https://cdn.other.com/p.jpg']
    const { targets, truncated } = classifyTargets(links, images, 'example.com', base, 300)
    expect(targets).toContainEqual({ targetUrl: 'https://www.example.com/a', kind: 'internal-link' })
    expect(targets).toContainEqual({ targetUrl: 'https://example.com/b', kind: 'internal-link' })
    expect(targets).toContainEqual({ targetUrl: 'https://other.com/x', kind: 'external-link' })
    expect(targets).toContainEqual({ targetUrl: 'https://www.example.com/img/logo.png', kind: 'image' })
    expect(targets).toContainEqual({ targetUrl: 'https://cdn.other.com/p.jpg', kind: 'external-link' })
    // '/a' appears twice → deduped to one row
    expect(targets.filter((t) => t.targetUrl === 'https://www.example.com/a')).toHaveLength(1)
    expect(truncated).toBe(false)
  })
  it('caps total targets and sets truncated', () => {
    const links = Array.from({ length: 400 }, (_, i) => `/p/${i}`)
    const { targets, truncated } = classifyTargets(links, [], 'example.com', base, 300)
    expect(targets).toHaveLength(300)
    expect(truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/link-harvest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ada-audit/link-harvest.ts
import type { Page } from 'puppeteer-core'

export type HarvestedTargetKind = 'internal-link' | 'image' | 'external-link'
export interface HarvestedTarget { targetUrl: string; kind: HarvestedTargetKind }

const sameRegistrable = (host: string, audited: string) =>
  host.replace(/^www\./, '') === audited.replace(/^www\./, '')

/** Resolve + normalize a raw href/src. Returns null for non-navigational refs. */
export function normalizeLinkTarget(raw: string, base: string): string | null {
  if (!raw) return null
  const t = raw.trim()
  if (!t || t.startsWith('#')) return null
  if (/^(mailto:|javascript:|tel:|data:|blob:|about:)/i.test(t)) return null
  let u: URL
  try { u = new URL(t, base) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  return u.toString()
}

/**
 * Classify raw link + image hrefs into deduped, capped HarvestedTargets.
 * Same-domain links/images keep their internal-link/image kind; cross-domain
 * become external-link (recorded, not verified in v1). Dedup by (kind,url).
 */
export function classifyTargets(
  linkHrefs: string[],
  imageSrcs: string[],
  auditedHost: string,
  base: string,
  cap: number,
): { targets: HarvestedTarget[]; truncated: boolean } {
  const seen = new Set<string>()
  const all: HarvestedTarget[] = []
  const consider = (raw: string, internalKind: HarvestedTargetKind) => {
    const url = normalizeLinkTarget(raw, base)
    if (!url) return
    let host: string
    try { host = new URL(url).hostname.toLowerCase() } catch { return }
    const kind: HarvestedTargetKind = sameRegistrable(host, auditedHost.toLowerCase())
      ? internalKind : 'external-link'
    const key = `${kind} ${url}`
    if (seen.has(key)) return
    seen.add(key)
    all.push({ targetUrl: url, kind })
  }
  for (const h of linkHrefs) consider(h, 'internal-link')
  for (const s of imageSrcs) consider(s, 'image')
  const truncated = all.length > cap
  return { targets: truncated ? all.slice(0, cap) : all, truncated }
}

const HARVEST_CAP = 300

/** Read every <a href> and <img src> from the loaded page, then classify. */
export async function harvestLinks(
  page: Page,
  auditedHost: string,
): Promise<{ targets: HarvestedTarget[]; truncated: boolean }> {
  const { links, images } = await page.evaluate(() => ({
    links: Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).getAttribute('href') || ''),
    images: Array.from(document.querySelectorAll('img[src]')).map((i) => (i as HTMLImageElement).getAttribute('src') || ''),
  }))
  return classifyTargets(links, images, auditedHost, page.url(), HARVEST_CAP)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/link-harvest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/link-harvest.ts lib/ada-audit/link-harvest.test.ts
git commit -m "feat(c6): rendered-DOM link/image harvest (pure)"
```

---

## Phase 3 — Runner + page-settle wiring

### Task 6: Capture `harvestedLinks` in `runAxeAudit`

**Files:**
- Modify: `lib/ada-audit/runner.ts`

- [ ] **Step 1: Extend the `audited` variant of `RunAxeResult`**

```ts
  | {
      kind: 'audited'
      axe: StoredAxeResults
      lighthouseSummary: LighthouseSummary | null
      lighthouseError: string | null
      harvestedPdfUrls: string[]
      harvestedLinks: import('./link-harvest').HarvestedTarget[]
      harvestedLinksTruncated: boolean
    }
```

- [ ] **Step 2: Harvest next to the PDF harvest (Phase 3 block, ~L358-368)**

Add the import at top: `import { harvestLinks } from './link-harvest'`. After the PDF harvest try/catch and before the `return`:

```ts
    let harvestedLinks: import('./link-harvest').HarvestedTarget[] = []
    let harvestedLinksTruncated = false
    try {
      const h = await harvestLinks(page, parsed.hostname.toLowerCase())
      harvestedLinks = h.targets
      harvestedLinksTruncated = h.truncated
    } catch (e) {
      console.warn('[ada-audit] link harvest failed:', (e as Error).message)
    }

    return { kind: 'audited', axe, lighthouseSummary, lighthouseError, harvestedPdfUrls, harvestedLinks, harvestedLinksTruncated }
```

- [ ] **Step 3: Typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`
Expected: PASS. (Standalone callers destructure `audited` and ignore the new fields — fine.)

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/runner.ts
git commit -m "feat(c6): capture harvested links in runAxeAudit"
```

---

### Task 7: Persist `HarvestedLink` rows in the page-settle transaction

**Files:**
- Modify: `lib/jobs/handlers/site-audit-page.ts`

- [ ] **Step 1: Add a chunk helper + row builder near the top**

`harvestTruncated` (fix #4) is denormalized onto every row for that page, so the verifier can recover the per-run confidence signal.

```ts
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
import type { HarvestedTarget } from '@/lib/ada-audit/link-harvest'

const HARVEST_CHUNK = 50

function harvestRows(siteAuditId: string, sourceUrl: string, targets: HarvestedTarget[], truncated: boolean) {
  const src = normalizeFindingUrl(sourceUrl)
  return targets.map((t) => ({ siteAuditId, sourcePageUrl: src, targetUrl: t.targetUrl, kind: t.kind, harvestTruncated: truncated }))
}
function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n))
  return out
}
```

- [ ] **Step 2: Persist harvest AFTER a successful settle (fenced, fix #3)**

Do NOT splice the harvest `createMany` blindly into the settle `$transaction` — a zombie attempt that loses the conditional child flip would still insert harvest rows for a page it didn't settle. Instead persist **only when `settlePage()` returned `true`** (this attempt won the flip). In BOTH audited branches (`detachPsi` axe-complete and the non-detach `complete`), after the existing `const settled = await settlePage(...); if (!settled) return` guard, add:

```ts
  // Best-effort harvest persistence, fenced to a successful settle (this attempt
  // owned the flip). Not in the settle txn: harvest is scaffolding, a lost row
  // just means that link isn't checked. createMany chunked at 50 (fix #8).
  const rows = harvestRows(job.siteAuditId, job.url, runResult.harvestedLinks, runResult.harvestedLinksTruncated)
  try {
    for (const data of chunk(rows, HARVEST_CHUNK)) await prisma.harvestedLink.createMany({ data })
  } catch (e) {
    console.warn('[c6] harvest persist failed for', job.adaAuditId, ':', (e as Error).message)
  }
```

Place this BEFORE `enqueuePsiJob(job)` in the detach branch and before the final `finalizeWarn(...)`. Redirected/error settles persist no harvest (no audited DOM). (The `detachPsi` branch settles to `axe-complete` then returns early after `enqueuePsiJob` — keep the harvest insert before that return.)

- [ ] **Step 3: Typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: DB-backed test — harvest lands on audited settle; redirect/error persist none; zombie inserts none**

Add to `lib/jobs/handlers/site-audit-page.test.ts` (mock `runAxeAudit` to return `harvestedLinks`): after an audited settle assert `prisma.harvestedLink.count({where:{siteAuditId}})` matches the harvested count; after a redirected/error settle assert 0; **and a zombie case** — pre-settle the child to a terminal status so `settlePage` returns false, run the job, assert 0 harvest rows (fix #3). Follow the file's existing mock style + tracked-id cleanup.

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/site-audit-page.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/site-audit-page.ts lib/jobs/handlers/site-audit-page.test.ts
git commit -m "feat(c6): persist HarvestedLink rows in the page-settle txn (chunked)"
```

---

## Phase 4 — The verifier

### Task 8: `broken-link-check.ts` — single-URL check + throttled scheduler

**Files:**
- Create: `lib/ada-audit/broken-link-check.ts`
- Test: `lib/ada-audit/broken-link-check.test.ts`

- [ ] **Step 1: Write the failing test** (transport-injected, fake clock for throttle)

```ts
import { describe, it, expect, vi } from 'vitest'
import { checkUrl, type CheckDeps } from './broken-link-check'

const resp = (status: number) => new Response(null, { status })
function depsWith(map: Record<string, number[]>): CheckDeps {
  // map: url -> [headStatus, getStatus?]
  const calls: Record<string, number> = {}
  return {
    fetchStatus: async (url, method) => {
      const seq = map[url] ?? [200]
      const status = method === 'HEAD' ? seq[0] : (seq[1] ?? seq[0])
      calls[`${method} ${url}`] = (calls[`${method} ${url}`] ?? 0) + 1
      return resp(status).status
    },
    now: () => 0,
    sleep: async () => {},
  }
}

describe('checkUrl', () => {
  it('200 → ok (no GET)', async () => {
    expect(await checkUrl('https://x.com/a', depsWith({ 'https://x.com/a': [200] }))).toBe('ok')
  })
  it('HEAD 404 confirmed by GET 404 → broken', async () => {
    expect(await checkUrl('https://x.com/a', depsWith({ 'https://x.com/a': [404, 404] }))).toBe('broken')
  })
  it('HEAD 405 but GET 200 → ok (HEAD false positive avoided)', async () => {
    expect(await checkUrl('https://x.com/a', depsWith({ 'https://x.com/a': [405, 200] }))).toBe('ok')
  })
  it('network error → unconfirmed (not broken)', async () => {
    const deps: CheckDeps = { fetchStatus: async () => { throw new Error('ECONNRESET') }, now: () => 0, sleep: async () => {} }
    expect(await checkUrl('https://x.com/a', deps)).toBe('unconfirmed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ada-audit/broken-link-check.ts
import { safeFetch, SafeUrlError } from '@/lib/security/safe-url'

export type CheckResult = 'ok' | 'broken' | 'unconfirmed'

export interface CheckDeps {
  /** Returns the final HTTP status for the URL+method, or throws on network/SSRF error. */
  fetchStatus: (url: string, method: 'HEAD' | 'GET', timeoutMs: number) => Promise<number>
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const DEFAULT_TIMEOUT = Number(process.env.BROKEN_LINK_REQUEST_TIMEOUT_MS) || 10_000

/** Production transport: safeFetch (SSRF-guarded), body drained to avoid socket leaks. */
export const realDeps: CheckDeps = {
  fetchStatus: async (url, method, timeoutMs) => {
    const { response } = await safeFetch(url, { method, signal: AbortSignal.timeout(timeoutMs) })
    try { await response.body?.cancel() } catch { /* ignore */ }
    return response.status
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

/**
 * Classify one URL. HEAD first; ANY HEAD >= 400 (or HEAD throw) is confirmed
 * with GET before declaring broken (servers mishandle HEAD — precision posture).
 * SafeUrlError / network error / timeout → 'unconfirmed' (excluded from broken).
 */
export async function checkUrl(
  url: string,
  deps: CheckDeps = realDeps,
  timeoutMs: number = DEFAULT_TIMEOUT,
): Promise<CheckResult> {
  let headStatus: number | null = null
  try {
    headStatus = await deps.fetchStatus(url, 'HEAD', timeoutMs)
    if (headStatus < 400) return 'ok'
  } catch (err) {
    if (err instanceof SafeUrlError) return 'unconfirmed'
    // fall through to GET — HEAD network failures are often HEAD-specific
  }
  try {
    const getStatus = await deps.fetchStatus(url, 'GET', timeoutMs)
    return getStatus >= 400 ? 'broken' : 'ok'
  } catch (err) {
    if (err instanceof SafeUrlError) return 'unconfirmed'
    return 'unconfirmed'
  }
}

/** Per-host minimum spacing. Call before each request to a host. */
export class HostThrottle {
  private last = new Map<string, number>()
  constructor(private delayMs: number, private deps: Pick<CheckDeps, 'now' | 'sleep'>) {}
  async wait(host: string): Promise<void> {
    // First request to a host never waits (fix #9 — don't sleep at t0).
    if (!this.last.has(host)) { this.last.set(host, this.deps.now()); return }
    const wait = this.last.get(host)! + this.delayMs - this.deps.now()
    if (wait > 0) await this.deps.sleep(wait)
    this.last.set(host, this.deps.now())
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-check.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/broken-link-check.ts lib/ada-audit/broken-link-check.test.ts
git commit -m "feat(c6): single-URL broken-link check (HEAD->GET, throttle)"
```

---

### Task 9: `broken-link-mapper.ts` — verifier results → FindingsBundle

**Files:**
- Create: `lib/findings/broken-link-mapper.ts`
- Test: `lib/findings/broken-link-mapper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mapBrokenLinks, type BrokenTarget, type BrokenLinkMapContext } from './broken-link-mapper'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'

const ctx: BrokenLinkMapContext = {
  siteAuditId: 'sa1', domain: 'example.com', clientId: 7,
  startedAt: new Date(0), completedAt: new Date(1000),
  confidence: { checked: 3, broken: 2, unconfirmed: 0, capped: false, harvestTruncated: false },
}

describe('mapBrokenLinks', () => {
  it('one source-keyed page finding per (type, source page); run count = distinct targets', () => {
    const broken: BrokenTarget[] = [
      { targetUrl: 'https://example.com/dead', kind: 'internal-link',
        sourcePageUrls: ['https://example.com/a', 'https://example.com/b'] },
      { targetUrl: 'https://example.com/x.png', kind: 'image',
        sourcePageUrls: ['https://example.com/a'] },
    ]
    const b = mapBrokenLinks(broken, ctx)
    expect(b.run.source).toBe('live-scan')
    expect(b.run.tool).toBe('seo-parser')
    expect(b.run.score).toBeNull()
    // run-scope: broken_internal_links count=1 (one distinct target), broken_images count=1
    const runFindings = b.findings.filter((f) => f.scope === 'run')
    const links = runFindings.find((f) => f.type === 'broken_internal_links')!
    expect(links.count).toBe(1)
    expect(links.dedupKey).toBe(runFindingKey('broken_internal_links'))
    expect(JSON.parse(links.detail!).checked).toBe(3)
    // page-scope: keyed by source page → /a has both types, /b has links only
    const pageKeys = b.findings.filter((f) => f.scope === 'page').map((f) => f.dedupKey)
    expect(new Set(pageKeys).size).toBe(pageKeys.length) // no collisions
    expect(pageKeys).toContain(pageFindingKey('broken_internal_links', normalizeFindingUrl('https://example.com/a')))
  })
  it('zero broken targets → empty findings, run still complete', () => {
    const b = mapBrokenLinks([], ctx)
    expect(b.findings).toHaveLength(0)
    expect(b.run.status).toBe('complete')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/broken-link-mapper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/findings/broken-link-mapper.ts
import { randomUUID } from 'crypto'
import { runFindingKey, pageFindingKey, normalizeFindingUrl } from './keys'
import type { CrawlPageInput, FindingInput, FindingsBundle } from './types'

export interface BrokenTarget {
  targetUrl: string
  kind: 'internal-link' | 'image' | 'external-link'
  sourcePageUrls: string[] // sample, already normalized + <=25
}
export interface BrokenLinkMapContext {
  siteAuditId: string
  domain: string | null
  clientId: number | null
  startedAt: Date | null
  completedAt: Date | null
  confidence: { checked: number; broken: number; unconfirmed: number; capped: boolean; harvestTruncated: boolean }
}

const TYPE_OF: Record<BrokenTarget['kind'], string | null> = {
  'internal-link': 'broken_internal_links',
  image: 'broken_images',
  'external-link': null, // not verified in v1
}

const DESC: Record<string, string> = {
  broken_internal_links: 'Internal links that resolve to a 4xx/5xx response.',
  broken_images: 'Image resources that resolve to a 4xx/5xx response.',
}

export function mapBrokenLinks(broken: BrokenTarget[], ctx: BrokenLinkMapContext): FindingsBundle {
  const runId = randomUUID()
  const affectedComplete = !ctx.confidence.capped && !ctx.confidence.harvestTruncated

  // Group by type → distinct target count; and by (type, source page) → page findings.
  const byType = new Map<string, BrokenTarget[]>()
  for (const t of broken) {
    const type = TYPE_OF[t.kind]
    if (!type) continue
    ;(byType.get(type) ?? byType.set(type, []).get(type)!).push(t)
  }

  const findings: FindingInput[] = []
  const pages: CrawlPageInput[] = []
  const pageByUrl = new Map<string, CrawlPageInput>()
  const ensurePage = (url: string): CrawlPageInput => {
    const u = normalizeFindingUrl(url)
    let p = pageByUrl.get(u)
    if (!p) {
      p = { id: randomUUID(), runId, url: u, status: null, error: null, finalUrl: null,
            statusCode: null, title: null, h1: null, metaDescription: null, wordCount: null,
            crawlDepth: null, indexable: null, score: null, passCount: null, incompleteCount: null, adaAuditId: null }
      pages.push(p); pageByUrl.set(u, p)
    }
    return p
  }

  for (const [type, targets] of byType) {
    // run-scope: count = distinct broken target URLs of this type
    const distinctTargets = new Set(targets.map((t) => t.targetUrl)).size
    findings.push({
      id: randomUUID(), runId, pageId: null, scope: 'run', type, severity: 'critical',
      url: null, count: distinctTargets, affectedComplete, affectedSource: 'live-scan-verify',
      detail: JSON.stringify({ description: DESC[type] ?? type, ...ctx.confidence }),
      dedupKey: runFindingKey(type),
    })

    // page-scope: keyed by SOURCE PAGE (one per (type, source page)).
    const bySource = new Map<string, string[]>() // sourceUrl -> brokenTargetUrls
    for (const t of targets)
      for (const src of t.sourcePageUrls) {
        const s = normalizeFindingUrl(src)
        ;(bySource.get(s) ?? bySource.set(s, []).get(s)!).push(t.targetUrl)
      }
    for (const [src, targetUrls] of bySource) {
      const page = ensurePage(src)
      findings.push({
        id: randomUUID(), runId, pageId: page.id, scope: 'page', type, severity: 'critical',
        url: src, count: targetUrls.length, affectedComplete, affectedSource: 'live-scan-verify',
        detail: JSON.stringify({ brokenTargetUrls: targetUrls.slice(0, 25) }),
        dedupKey: pageFindingKey(type, src),
      })
    }
  }

  return {
    run: {
      id: runId, tool: 'seo-parser', source: 'live-scan', domain: ctx.domain, clientId: ctx.clientId,
      sessionId: null, siteAuditId: ctx.siteAuditId, adaAuditId: null,
      status: ctx.confidence.capped || ctx.confidence.harvestTruncated ? 'partial' : 'complete',
      score: null, wcagLevel: null, pagesTotal: pages.length,
      startedAt: ctx.startedAt, completedAt: ctx.completedAt,
    },
    pages, findings, violations: [],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/broken-link-mapper.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/findings/broken-link-mapper.ts lib/findings/broken-link-mapper.test.ts
git commit -m "feat(c6): broken-link results -> FindingsBundle mapper"
```

---

### Task 10: Add `'live-scan-verify'` to the `affectedUrlSource` union

**Files:**
- Modify: `lib/types/index.ts` (the `Issue` interface — TWO occurrences at ~L61 and ~L242; update BOTH)

- [ ] **Step 1: Find + extend the union**

Run: `rg -n "affectedUrlSource" lib/types/index.ts`
Both occurrences read `'derived-page-index' | 'parser-complete' | 'parser-sample'`. Add the new label to **both**:

```ts
  affectedUrlSource?: 'derived-page-index' | 'parser-complete' | 'parser-sample' | 'live-scan-verify';
```

- [ ] **Step 2: Typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/types/index.ts
git commit -m "feat(c6): allow 'live-scan-verify' affectedUrlSource"
```

---

### Task 11: The `broken-link-verify` job handler + enqueue facade

**Files:**
- Create: `lib/jobs/handlers/broken-link-verify.ts`
- Test: `lib/jobs/handlers/broken-link-verify.test.ts`

- [ ] **Step 1: Write the failing test** (DB-backed, deps-injected)

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { runBrokenLinkVerify } from './broken-link-verify'

const DOMAIN = 'c6blv.example.com'
async function clean() {
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(clean); afterAll(clean)

async function seed(targets: { targetUrl: string; kind: string; sourcePageUrl: string }[]) {
  const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete', clientId: null } })
  if (targets.length)
    await prisma.harvestedLink.createMany({ data: targets.map((t) => ({ ...t, siteAuditId: sa.id })) })
  return sa.id
}
// deps: every targetUrl in `brokenSet` returns 'broken', else 'ok'
const depsFor = (brokenSet: Set<string>) => ({
  checkUrl: async (url: string) => (brokenSet.has(url) ? 'broken' : 'ok') as const,
  now: () => 0, sleep: async () => {},
})

describe('runBrokenLinkVerify', () => {
  it('writes a live-scan run with broken findings and deletes harvest rows', async () => {
    const id = await seed([
      { targetUrl: 'https://c6blv.example.com/dead', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' },
      { targetUrl: 'https://c6blv.example.com/ok', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' },
    ])
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, depsFor(new Set(['https://c6blv.example.com/dead'])))
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } }, include: { findings: true } })
    expect(run?.source).toBe('live-scan')
    const runFinding = run!.findings.find((f) => f.scope === 'run' && f.type === 'broken_internal_links')
    expect(runFinding?.count).toBe(1)
    expect(await prisma.harvestedLink.count({ where: { siteAuditId: id } })).toBe(0)
  })
  it('empty harvest → empty run, no delete error', async () => {
    const id = await seed([])
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, depsFor(new Set()))
    const run = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId: id, tool: 'seo-parser' } } })
    expect(run).not.toBeNull()
  })
  it('idempotent re-run replaces the run', async () => {
    const id = await seed([{ targetUrl: 'https://c6blv.example.com/dead', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' }])
    const deps = depsFor(new Set(['https://c6blv.example.com/dead']))
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    // re-seed (rows were deleted) and re-run — must not throw on the unique key
    await prisma.harvestedLink.create({ data: { siteAuditId: id, targetUrl: 'https://c6blv.example.com/dead', kind: 'internal-link', sourcePageUrl: 'https://c6blv.example.com/a' } })
    await runBrokenLinkVerify({ siteAuditId: id, domain: DOMAIN }, deps)
    const runs = await prisma.crawlRun.findMany({ where: { siteAuditId: id, tool: 'seo-parser' } })
    expect(runs).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/jobs/handlers/broken-link-verify.ts
//
// Out-of-band broken-link/resource verifier (C6 Phase 1). Enqueued AFTER a
// SiteAudit reaches terminal 'complete' (see finalizeSiteAudit) — that
// post-terminal invariant is what makes reusing the site-audit:<id> group
// safe (finalize early-returns on complete, so a pending verifier can never
// trip liveness recovery). Idempotent: re-reads HarvestedLink, the writer's
// delete-and-recreate on { siteAuditId, tool:'seo-parser' } replaces any
// prior run, harvest rows are deleted only after the run is written.
import { prisma } from '@/lib/db'
import { writeFindingsRun } from '@/lib/findings/writer'
import { normalizeFindingUrl } from '@/lib/findings/normalize-url'
import { mapBrokenLinks, type BrokenTarget } from '@/lib/findings/broken-link-mapper'
import { checkUrl, HostThrottle, realDeps, type CheckResult } from '@/lib/ada-audit/broken-link-check'
import { parsePositiveInt } from '../config'
import { registerJobHandler } from '../registry'
import { enqueueJob } from '../queue'
import type { JobExhaustedContext } from '../types'

export const BROKEN_LINK_VERIFY_JOB_TYPE = 'broken-link-verify'
const MAX_CHECKS = () => parsePositiveInt(process.env.BROKEN_LINK_MAX_CHECKS, 2000)
const HOST_DELAY = () => parsePositiveInt(process.env.BROKEN_LINK_HOST_DELAY_MS, 250)
const CONCURRENCY = () => parsePositiveInt(process.env.BROKEN_LINK_CONCURRENCY, 4)
const URLS_PER_FINDING = 25

export interface BrokenLinkVerifyJob { siteAuditId: string; domain: string | null }

export interface VerifyDeps {
  checkUrl: (url: string) => Promise<CheckResult>
  now: () => number
  sleep: (ms: number) => Promise<void>
}
const productionDeps: VerifyDeps = {
  checkUrl: (url) => checkUrl(url, realDeps),
  now: realDeps.now,
  sleep: realDeps.sleep,
}

function assertPayload(p: unknown): BrokenLinkVerifyJob {
  const j = p as Partial<BrokenLinkVerifyJob> | null
  if (!j || typeof j.siteAuditId !== 'string') throw new Error('Invalid broken-link-verify payload')
  return { siteAuditId: j.siteAuditId, domain: typeof j.domain === 'string' ? j.domain : null }
}

export async function runBrokenLinkVerify(payload: unknown, deps: VerifyDeps = productionDeps): Promise<void> {
  const job = assertPayload(payload)
  const site = await prisma.siteAudit.findUnique({
    where: { id: job.siteAuditId }, select: { id: true, domain: true, clientId: true },
  })
  if (!site) return // deleted audit → no-op

  const rows = await prisma.harvestedLink.findMany({
    where: { siteAuditId: job.siteAuditId, kind: { in: ['internal-link', 'image'] } },
    // Deterministic order so the cap (below) selects a STABLE subset across retries (fix #7).
    orderBy: [{ targetUrl: 'asc' }, { kind: 'asc' }, { sourcePageUrl: 'asc' }],
    select: { targetUrl: true, kind: true, sourcePageUrl: true, harvestTruncated: true },
  })
  const harvestTruncated = rows.some((r) => r.harvestTruncated) // fix #4

  // Dedupe to unique (targetUrl, kind); collect a source-page sample per target.
  const startedAt = new Date(deps.now())
  const byTarget = new Map<string, { kind: 'internal-link' | 'image'; sources: Set<string> }>()
  for (const r of rows) {
    const key = `${r.kind} ${r.targetUrl}`
    let e = byTarget.get(key)
    if (!e) { e = { kind: r.kind as 'internal-link' | 'image', sources: new Set() }; byTarget.set(key, e) }
    if (e.sources.size < URLS_PER_FINDING) e.sources.add(normalizeFindingUrl(r.sourcePageUrl))
  }
  const unique = [...byTarget.entries()].map(([key, v]) => ({ targetUrl: key.slice(key.indexOf(' ') + 1), ...v }))

  const cap = MAX_CHECKS()
  const capped = unique.length > cap
  if (capped) console.warn(`[broken-link-verify] ${job.siteAuditId}: capping ${unique.length} -> ${cap} checks`)
  const toCheck = capped ? unique.slice(0, cap) : unique

  // Bounded concurrency (fix #8): CONCURRENCY workers pull from a shared cursor,
  // each respecting the shared per-host throttle. Single-threaded JS makes the
  // shared cursor/counter mutations safe between awaits.
  const throttle = new HostThrottle(HOST_DELAY(), deps)
  let checked = 0, unconfirmed = 0, cursor = 0
  const broken: BrokenTarget[] = []
  const worker = async (): Promise<void> => {
    while (cursor < toCheck.length) {
      const t = toCheck[cursor++]
      let host = ''
      try { host = new URL(t.targetUrl).hostname } catch { unconfirmed++; continue }
      await throttle.wait(host)
      const res = await deps.checkUrl(t.targetUrl)
      checked++
      if (res === 'broken') broken.push({ targetUrl: t.targetUrl, kind: t.kind, sourcePageUrls: [...t.sources] })
      else if (res === 'unconfirmed') unconfirmed++
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY(), toCheck.length || 1) }, () => worker()))

  const bundle = mapBrokenLinks(broken, {
    siteAuditId: site.id, domain: site.domain ?? job.domain, clientId: site.clientId,
    startedAt, completedAt: new Date(deps.now()),
    confidence: { checked, broken: broken.length, unconfirmed, capped, harvestTruncated },
  })
  await writeFindingsRun(bundle)
  await prisma.harvestedLink.deleteMany({ where: { siteAuditId: job.siteAuditId } })
  console.log(`[broken-link-verify] ${job.siteAuditId}: checked ${checked}, broken ${broken.length}, unconfirmed ${unconfirmed}`)
}

/** Fire-and-forget enqueue, mirrors enqueuePsiJob. */
export function enqueueBrokenLinkVerify(siteAuditId: string, domain: string | null): void {
  void enqueueJob({
    type: BROKEN_LINK_VERIFY_JOB_TYPE,
    payload: { siteAuditId, domain },
    dedupKey: `${BROKEN_LINK_VERIFY_JOB_TYPE}:${siteAuditId}`,
    groupKey: `site-audit:${siteAuditId}`,
  }).catch((err) => {
    console.error('[broken-link-verify] enqueue failed for', siteAuditId, ':', (err as Error).message)
  })
}

export async function onBrokenLinkVerifyExhausted(_p: unknown, ctx: JobExhaustedContext): Promise<void> {
  console.warn(`[broken-link-verify] exhausted after ${ctx.attempts} attempts: ${ctx.lastError}`)
}

export function registerBrokenLinkVerifyHandler(): void {
  registerJobHandler({
    type: BROKEN_LINK_VERIFY_JOB_TYPE,
    concurrency: 1, // one verifier across the box; per-URL parallelism is internal (CONCURRENCY workers)
    maxAttempts: 2,
    backoffBaseMs: 60_000,
    timeoutMs: 900_000, // 15 min ceiling (fix #8 — bounded concurrency keeps real runs well under this)
    handler: (payload) => runBrokenLinkVerify(payload),
    onExhausted: onBrokenLinkVerifyExhausted,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/broken-link-verify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the handler**

In `lib/jobs/handlers/register.ts`, import `registerBrokenLinkVerifyHandler` and call it inside `registerBuiltInJobHandlers()`.

- [ ] **Step 6: Typecheck + commit**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`
```bash
git add lib/jobs/handlers/broken-link-verify.ts lib/jobs/handlers/broken-link-verify.test.ts lib/jobs/handlers/register.ts
git commit -m "feat(c6): broken-link-verify durable job + enqueue facade"
```

---

## Phase 5 — Enqueue point + recovery

### Task 12: Enqueue the verifier on `complete`

**Files:**
- Modify: `lib/ada-audit/site-audit-finalizer.ts`

- [ ] **Step 1: Enqueue after the findings hook (last)**

At the very end of `finalizeSiteAudit` (after the `mapAdaChildren`/`writeFindingsRun` block — the findings hook stays the last DB-writing side effect; the enqueue does no DB writes), add:

```ts
import { enqueueBrokenLinkVerify } from '@/lib/jobs/handlers/broken-link-verify'
// ...after the findings dual-write try/catch:
// C6: verify harvested links out-of-band. Post-terminal (status is now
// 'complete') so reusing the site-audit:<id> group is liveness-safe.
enqueueBrokenLinkVerify(id, audit.domain)
```

- [ ] **Step 2: Typecheck**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/site-audit-finalizer.ts
git commit -m "feat(c6): enqueue broken-link-verify on site-audit complete"
```

---

### Task 13: Enqueue-recovery sweep

**Files:**
- Create: `lib/ada-audit/broken-link-recovery.ts`
- Test: `lib/ada-audit/broken-link-recovery.test.ts`
- Modify: `lib/ada-audit/queue-manager.ts` (`recoverQueue`) + `lib/jobs/handlers/stale-audit-reset.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { recoverBrokenLinkVerifies } from './broken-link-recovery'

const DOMAIN = 'c6blr.example.com'
async function clean() {
  // Scope job cleanup to THIS test's site audits (fix #11 — never blanket-delete
  // every broken-link-verify job; a parallel file's jobs would be collateral).
  const sas = await prisma.siteAudit.findMany({ where: { domain: DOMAIN }, select: { id: true } })
  const groups = sas.map((s) => `site-audit:${s.id}`)
  if (groups.length) await prisma.job.deleteMany({ where: { type: 'broken-link-verify', groupKey: { in: groups } } })
  await prisma.crawlRun.deleteMany({ where: { domain: DOMAIN } })
  await prisma.harvestedLink.deleteMany({ where: { siteAudit: { domain: DOMAIN } } })
  await prisma.siteAudit.deleteMany({ where: { domain: DOMAIN } })
}
beforeEach(clean); afterAll(clean)

describe('recoverBrokenLinkVerifies', () => {
  it('re-enqueues for a complete audit with harvest rows + no verify job + no live-scan run', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedLink.create({ data: { siteAuditId: sa.id, targetUrl: 'https://c6blr.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blr.example.com/a' } })
    const n = await recoverBrokenLinkVerifies()
    expect(n).toBeGreaterThanOrEqual(1)
    const job = await prisma.job.findFirst({ where: { type: 'broken-link-verify', groupKey: `site-audit:${sa.id}` } })
    expect(job).not.toBeNull()
  })
  it('skips audits that already have a live-scan run', async () => {
    const sa = await prisma.siteAudit.create({ data: { domain: DOMAIN, status: 'complete' } })
    await prisma.harvestedLink.create({ data: { siteAuditId: sa.id, targetUrl: 'https://c6blr.example.com/x', kind: 'internal-link', sourcePageUrl: 'https://c6blr.example.com/a' } })
    await prisma.crawlRun.create({ data: { id: 'c6blr-run', tool: 'seo-parser', source: 'live-scan', domain: DOMAIN, status: 'complete', siteAuditId: sa.id, pagesTotal: 0 } })
    const before = await prisma.job.count({ where: { type: 'broken-link-verify' } })
    await recoverBrokenLinkVerifies()
    expect(await prisma.job.count({ where: { type: 'broken-link-verify' } })).toBe(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-recovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// lib/ada-audit/broken-link-recovery.ts
//
// Closes the fire-and-forget enqueue crash window (spec §5.2 fix #7): a
// 'complete' SiteAudit with HarvestedLink rows but no verify job and no
// live-scan run never self-heals (finalizeSiteAudit early-returns on complete).
import { prisma } from '@/lib/db'
import { BROKEN_LINK_VERIFY_JOB_TYPE } from '@/lib/jobs/handlers/broken-link-verify'
import { enqueueJob } from '@/lib/jobs/queue'
import { JOB_ACTIVE_STATUSES } from '@/lib/jobs/types'

export async function recoverBrokenLinkVerifies(): Promise<number> {
  // Distinct siteAuditIds that still have harvest rows (verifier never deleted them).
  const pending = await prisma.harvestedLink.findMany({ distinct: ['siteAuditId'], select: { siteAuditId: true } })
  let enqueued = 0
  for (const { siteAuditId } of pending) {
    const site = await prisma.siteAudit.findUnique({ where: { id: siteAuditId }, select: { status: true, domain: true } })
    if (!site || site.status !== 'complete') continue
    const liveRun = await prisma.crawlRun.findUnique({ where: { siteAuditId_tool: { siteAuditId, tool: 'seo-parser' } }, select: { id: true } })
    if (liveRun) continue
    const activeJob = await prisma.job.findFirst({
      where: { type: BROKEN_LINK_VERIFY_JOB_TYPE, groupKey: `site-audit:${siteAuditId}`, status: { in: [...JOB_ACTIVE_STATUSES] } },
      select: { id: true },
    })
    if (activeJob) continue
    // AWAIT the enqueue (fix #10) — this sweep closes the fire-and-forget window,
    // so it must confirm the job is durably queued before counting it. dedupKey
    // makes it idempotent against a racing enqueue.
    await enqueueJob({
      type: BROKEN_LINK_VERIFY_JOB_TYPE,
      payload: { siteAuditId, domain: site.domain },
      dedupKey: `${BROKEN_LINK_VERIFY_JOB_TYPE}:${siteAuditId}`,
      groupKey: `site-audit:${siteAuditId}`,
    })
    enqueued++
  }
  if (enqueued > 0) console.log(`[broken-link-verify] recovery re-enqueued ${enqueued} verifier(s)`)
  return enqueued
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ada-audit/broken-link-recovery.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into boot + the 10-min sweep**

- In `lib/ada-audit/queue-manager.ts` `recoverQueue()`, after its existing recovery work, add a guarded call:
  ```ts
  await import('./broken-link-recovery').then((m) => m.recoverBrokenLinkVerifies()).catch((e) =>
    console.warn('[queue] broken-link verify recovery failed:', (e as Error).message))
  ```
- In `lib/jobs/handlers/stale-audit-reset.ts`'s handler, add the same guarded call so it runs every 10 min.

- [ ] **Step 6: Typecheck + commit**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`
```bash
git add lib/ada-audit/broken-link-recovery.ts lib/ada-audit/broken-link-recovery.test.ts lib/ada-audit/queue-manager.ts lib/jobs/handlers/stale-audit-reset.ts
git commit -m "feat(c6): enqueue-recovery sweep for broken-link verifier"
```

---

## Phase 6 — Retention

### Task 14: `pruneHarvestedLinks` + tool-origin-aware `pruneArchivedBlobs`

**Files:**
- Modify: `lib/findings/retention.ts`
- Modify: `lib/findings/retention.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `lib/findings/retention.test.ts`:
```ts
it('pruneHarvestedLinks deletes rows older than 7 days, keeps recent', async () => {
  // seed a siteAudit + two HarvestedLink rows, one createdAt 8d ago, one now
  // (set createdAt via raw update since @default(now)); assert only old deleted
})
it('pruneArchivedBlobs leaves a seo-parser live-scan run and the shared SiteAudit summary untouched', async () => {
  // seed SiteAudit with summary='X'; an ada-audit CrawlRun (not aged) + an aged
  // seo-parser live-scan CrawlRun, both siteAuditId=sa.id, completedAt 100d ago for seo-parser
  // run pruneArchivedBlobs({'seo-parser':true,'ada-audit':false})
  // assert: SiteAudit.summary still 'X'; the live-scan run NOT archivePrunedAt-stamped
})
```
(Flesh these out using the file's existing seed/cleanup helpers and tracked-id discipline.)

- [ ] **Step 2: Implement `pruneHarvestedLinks`**

```ts
const HARVEST_RETENTION_MS = 7 * DAY_MS
export async function pruneHarvestedLinks(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - HARVEST_RETENTION_MS)
  const { count } = await prisma.harvestedLink.deleteMany({ where: { createdAt: { lt: cutoff } } })
  if (count > 0) console.log(`[findings] pruned ${count} stale HarvestedLink row(s)`)
}
```

- [ ] **Step 3: Make `pruneArchivedBlobs` tool-origin-aware**

In the per-tool loop, scope the selection + the blob-null statements so a `seo-parser` run never touches `SiteAudit.summary`:
- For `tool === 'seo-parser'`, add `sessionId: { not: null }` to the `where` (so siteAudit-origin live-scan runs are NOT selected — they have no blob and stay unpruned).
- Keep the `siteAudit.updateMany({ data: { summary: null } })` + child-blob statements **only** in the `ada-audit` branch. Simplest: compute `siteAuditIds`/`adaAuditIds` only when `tool === 'ada-audit'`, and `sessionIds` only when `tool === 'seo-parser'`.

Concretely, replace the `where` build:
```ts
      where: {
        tool,
        completedAt: { lt: cutoff },
        archivePrunedAt: null,
        ...(tool === 'seo-parser'
          ? { sessionId: { not: null } }
          : { OR: [{ siteAuditId: { not: null } }, { adaAuditId: { not: null } }] }),
      },
```
and guard the `siteAudit`/`adaAudit` updateMany statements behind `tool === 'ada-audit'` (the `session.updateMany` behind `tool === 'seo-parser'`).

- [ ] **Step 4: Register `pruneHarvestedLinks` in `runCleanup()`**

`runCleanup()` lives in **`lib/cleanup.ts`** (fix #12 — NOT `lib/jobs/handlers/cleanup.ts`, which only invokes it). Add `pruneHarvestedLinks()` to the `Promise.allSettled([...])` list there that already calls `pruneArchivedBlobs()` (import it from `@/lib/findings/retention`).

- [ ] **Step 5: Run tests**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/findings/retention.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/findings/retention.ts lib/findings/retention.test.ts lib/cleanup.ts
git commit -m "feat(c6): HarvestedLink retention + tool-origin-aware blob prune"
```

---

## Phase 7 — Source-aware selection + surfacing

### Task 15: Source-aware SEO run selection

**Files:**
- Modify: `lib/services/findings-shared.ts`
- Modify: `lib/services/findings-shared.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/services/findings-shared.test.ts`:
```ts
it('a newer live-scan run does NOT displace the sf-upload run for score; exposes liveScan', () => {
  const mk = (id: string, source: string, t: number): RunRef => ({
    id, tool: 'seo-parser', source, domain: 'd.com', completedAt: new Date(t), createdAt: new Date(t),
    sessionId: source === 'sf-upload' ? `s-${id}` : null, siteAuditId: source === 'live-scan' ? `sa-${id}` : null, adaAuditId: null,
  })
  const runs = [mk('up', 'sf-upload', 1000), mk('live', 'live-scan', 2000)]
  const sel = selectRuns(runs, new Set())
  expect(sel.seo.current?.id).toBe('up')      // sf-upload, not the newer live-scan
  expect(sel.seo.liveScan?.id).toBe('live')   // surfaced additively
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/findings-shared.test.ts`
Expected: FAIL — `liveScan` undefined / current is the live-scan run.

- [ ] **Step 3: Implement source-aware selection**

In `selectRuns`, split seo candidates by source:
```ts
  const seoAll = runs.filter((r) => r.tool === 'seo-parser' && !(r.sessionId && keywordSessionIds.has(r.sessionId)))
  const seoScoreCandidates = sortRunsDesc(seoAll.filter((r) => r.source !== 'live-scan'))
  const liveScanCandidates = sortRunsDesc(seoAll.filter((r) => r.source === 'live-scan'))
  const seoCurrent = seoScoreCandidates[0] ?? null
```
and extend the returned `seo` object:
```ts
    seo: {
      current: seoCurrent,
      previous: seoCurrent ? domainMatchedPrevious(seoScoreCandidates, seoCurrent) : null,
      liveScan: liveScanCandidates[0] ?? null,
    },
```
Add `liveScan: RunRef | null` to `SelectedRuns['seo']`.

- [ ] **Step 4: Run test + full findings-shared suite**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/findings-shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Also exclude live-scan from the B1 score SERIES (fix #13)**

`selectRuns` only governs the B2 panel. The B1 dashboard/fleet score series build directly from filtered `crawlRuns` and would still let a `score:null` live-scan run into SEO score history. Add `&& r.source !== 'live-scan'` to both `buildSeoSeries(...)` filters:
- `lib/services/client-dashboard.ts:114` — `crawlRuns.filter((r) => r.tool === 'seo-parser' && r.source !== 'live-scan' && !(r.sessionId && keywordSessionIds.has(r.sessionId)))`
- `lib/services/client-fleet.ts:127` — `myRuns.filter((r) => r.tool === 'seo-parser' && r.source !== 'live-scan' && !(r.sessionId && keywordSessionIds.has(r.sessionId)))`

(Both `select` the `source` column already — client-dashboard.ts:102, client-fleet.ts:50.)

- [ ] **Step 6: Typecheck (catches consumers of `SelectedRuns`)**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`
Expected: PASS (the new field is optional-additive; existing consumers compile).

- [ ] **Step 7: Commit**

```bash
git add lib/services/findings-shared.ts lib/services/findings-shared.test.ts lib/services/client-dashboard.ts lib/services/client-fleet.ts
git commit -m "feat(c6): source-aware SEO selection (live-scan never displaces sf-upload score)"
```

---

### Task 16: Surface live-scan broken-link findings in the client findings panel

**Files:**
- Modify: `lib/services/client-findings.ts`
- Modify: `lib/services/client-findings.test.ts`

- [ ] **Step 1: Write the failing test**

Extend `lib/services/client-findings.test.ts`: with an sf-upload run AND a live-scan run for the same client, the returned findings include the live-scan `broken_internal_links` rows (additive), and the sf-upload score/findings are still present. (Use the file's existing DB seed helpers + tracked ids.)

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-findings.test.ts`
Expected: FAIL — broken-link rows absent.

- [ ] **Step 3: Implement additive pull**

In `client-findings.ts:123`, the panel currently builds:
```ts
const currentIds = [sel.seo.current?.id, sel.ada.current?.id].filter((x): x is string => !!x)
```
Change it to also include the live-scan run (fix #14):
```ts
const currentIds = [sel.seo.current?.id, sel.seo.liveScan?.id, sel.ada.current?.id].filter((x): x is string => !!x)
```
The findings `where: { runId: { in: currentIds } }` query then pulls the live-scan `broken_internal_links`/`broken_images` rows into the open-findings list additively (they already carry types + severities). Do NOT touch the SEO meta/score/diff block (`if (sel.seo.current)` at L164) — it reads `sel.seo.current` only, so the score/trend stays SF-upload-sourced. (The previous-run diff at L134 also stays keyed on `sel.seo.previous`.)

- [ ] **Step 4: Run test + commit**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/services/client-findings.test.ts`
Expected: PASS.
```bash
git add lib/services/client-findings.ts lib/services/client-findings.test.ts
git commit -m "feat(c6): surface live-scan broken-link findings in the client panel"
```

---

### Task 17: Broken-links section on the site-audit results page

**Files:**
- Create: `components/site-audit/BrokenLinksSection.tsx`
- Modify: `app/ada-audit/site/[id]/page.tsx`

- [ ] **Step 1: Build the section component**

`BrokenLinksSection` (server-friendly props) takes the live-scan run's findings (or `null`) and renders:
- `null` run → "Broken links not yet verified" muted state.
- run with zero findings → "Verified — no broken links or images found".
- run with findings → grouped lists (`broken_internal_links`, `broken_images`) with each run-finding's `count`, the confidence block from `detail` (checked / unconfirmed / capped / `affectedComplete`), and per-source-page affected lists (from page-scope findings' `detail.brokenTargetUrls`). Reuse existing card/badge styling from the results view (dark-mode variants).

- [ ] **Step 2: Load + render in the page**

In `app/ada-audit/site/[id]/page.tsx`, after the existing ADA-run load, fetch the live-scan run:
```ts
const liveScanRun = await prisma.crawlRun.findUnique({
  where: { siteAuditId_tool: { siteAuditId: audit.id, tool: 'seo-parser' } },
  include: { findings: true },
})
```
Pass to `<BrokenLinksSection run={liveScanRun} />`.

- [ ] **Step 3: Manual verify**

Run: `DATABASE_URL="file:./local-dev.db" npx next dev` (auth-free locally), seed a completed site audit + a live-scan run with broken findings, open `/ada-audit/site/<id>`, confirm the section renders all three states.

- [ ] **Step 4: Typecheck + commit**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit`
```bash
git add components/site-audit/BrokenLinksSection.tsx app/ada-audit/site/[id]/page.tsx
git commit -m "feat(c6): broken-links section on the site-audit results page"
```

---

## Phase 8 — Verification & ship

### Task 18: Full verification

- [ ] **Step 1: Full suite + typecheck + build**

Run: `DATABASE_URL="file:./local-dev.db" npx tsc --noEmit && DATABASE_URL="file:./local-dev.db" npm test && npm run build`
Expected: all green, no regressions.

- [ ] **Step 2: Close-gate grep (no stray single-field siteAuditId readers)**

Run: `rg -n "crawlRun\.findUnique\(\{\s*where:\s*\{\s*siteAuditId\b" lib app scripts`
Expected: zero matches.

- [ ] **Step 3: Local end-to-end smoke (real dev server, small domain)**

Run a real site audit against a tiny local target (or a seeded fixture domain) through the durable queue; confirm: harvest rows appear during the run; `broken-link-verify` job runs after `complete`; a live-scan `CrawlRun` is written; harvest rows are gone post-verify; the results page renders the section. Record numbers in the PR description.

- [ ] **Step 4: Commit any fixups, push, open PR**

```bash
git push -u origin feat/c6-broken-link-verifier
gh pr create --title "C6 Phase 1: out-of-band broken-link verifier" --body "<summary + spec link + smoke numbers>"
```

### Task 19: Deploy + production-verify

- [ ] **Step 1: Merge, then deploy**

```bash
git push
ssh seo@144.126.213.242 "~/deploy.sh"
```
(`prisma migrate deploy` runs automatically in the deploy command — the C6 migration applies in prod.)

- [ ] **Step 2: Production verification on the canary** (`proway.erstaging.site`, client 31)

Per spec §9: trigger a site audit; verify (a) ada-audit + live-scan CrawlRuns coexist on the SiteAudit; (b) `broken-link-verify` job complete (attempts 1); (c) `HarvestedLink` rows for the audit gone post-verify; (d) results page renders the section; (e) any known broken link reported. Restart drill: `pm2 restart` mid-verify → interrupted job re-queued (attempt 2) and completes idempotently; then leave harvest rows with no job and confirm the recovery sweep re-enqueues.

- [ ] **Step 3: Record results + close out**

Update the tracker (C6 checkbox + status-log line), rewrite the handoff doc, commit together, and end with the paste-in prompt (improvement-roadmap handoff protocol).

---

## Self-Review notes (done)

- **Spec coverage:** migration §2 → T1–T4; HarvestedLink §3.1 → T1/T7/T14; live-scan run §3.2 → T9; harvest §4 → T5–T7; verifier §5 → T8/T11/T12; recovery §5.2/§7 → T13; surfacing §6 → T15–T17; retention §7 → T14; dashboard source-awareness §6.2 → T15/T16; testing §8 → embedded per task + T18; prod-verify §9 → T19.
- **Plan-review Codex fixes (×15) all applied:** #1 relation `crawlRun?`→`crawlRuns[]` (T1 — I'd had this wrong; corrected) · #2 +5 relation-include readers (T3 Step 3b) · #3 fenced post-settle harvest insert (T7) · #4 `harvestTruncated` persisted (T1/T2/T7/T9/T11) · #5 mapper `partial` on truncation (T9) · #6 `lib/types/index.ts` path ×2 (T10) · #7 stable cap `orderBy` (T11) · #8 bounded concurrency + 15-min timeout (T11) · #9 HostThrottle first-request guard (T8) · #10 recovery awaits real enqueue (T13) · #11 scoped job cleanup (T13) · #12 `lib/cleanup.ts` wiring (T14) · #13 B1 score-series live-scan filter (T15) · #14 explicit `currentIds` (T16) · #15 same-domain exact-host+www documented (T5/spec §4.1).
- **Type consistency:** `HarvestedTarget` (T5) → `RunAxeResult.harvestedLinks` (T6) → `harvestRows` (T7) → read by the verifier (T11) → `BrokenTarget` (T9 mapper) → `FindingsBundle` via `writeFindingsRun`. `CheckResult`/`CheckDeps` (T8) consumed by `VerifyDeps` (T11). `SelectedRuns.seo.liveScan` (T15) consumed by client-findings (T16).
- **No placeholders:** pure units (T5/T8/T9) + the handler (T11) + recovery (T13) carry complete code; UI (T17) and a few DB-test bodies (T7/T14/T16) describe exact data + assertions in prose because they extend existing mock/seed-heavy files in their established style (handoff test-gotchas).
- **Open (decide in-task):** `BROKEN_LINK_CONCURRENCY` parallelism is left serial-with-throttle in T11 for v1 simplicity (the env knob exists in the spec for a later pass); the results-page section styling follows the existing results view.
