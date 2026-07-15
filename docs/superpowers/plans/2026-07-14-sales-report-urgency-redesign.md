# Sales Report Urgency Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the C14 public sales report (`/sales/[token]`) around urgency and personalization: a sticky branded header with a Book-a-review CTA, an above-the-fold hero (homepage screenshot captured at scan time + animated overall-score gauge), urgency-bar visuals per SEO issue, per-section "why this hurts you" copy, score-methodology explainers, counts-only accessibility, and an inquiry form replacing the mailto footer — per `docs/superpowers/specs/2026-07-14-sales-report-urgency-redesign-design.md` (all inline Codex fixes included).

**Architecture:** One additive migration (`SiteAudit.homepageScreenshot String?`). A new `REPORTS_DIR`-style file store (`lib/sales/hero-screenshot.ts`) outlives the 24 h screenshot sweep. Prospect-only root-URL injection in the discover job guarantees the homepage is audited; the runner captures viewport PNG **bytes** and returns them; the page job publishes file + column stamp **only after its settle transaction wins**. A new public route `GET /api/sales/[token]/hero/[siteAuditId]` streams it behind an anchored middleware matcher with an indistinguishable-404 contract. The loader gains `overallScore`, `heroScreenshot`, `standardTested`, deterministic homepage-CWV, `affectedPages`/`affectedComplete`, `worstPages` 5, and drops accessibility patterns from the payload. The view is reassembled from new client components (`SalesReportHeader`, `ScoreGauge`, `UrgencyBar`, `InquiryForm`) + rebuilt server sections consuming PR 1's `Explainer`. Three deletion seams keep "audit row gone ⇒ hero file gone" true everywhere.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind (class-based dark mode), Prisma + SQLite, vitest (+ jsdom/@testing-library for components), puppeteer-core 24, existing durable job queue.

## Global Constraints

- **Depends on PR 1 (Explainer):** branch from main **after** the Explainer PR (`docs/superpowers/specs/2026-07-14-explainer-disclosure-component-design.md`) is merged. Consume it as `<Explainer label="…" variant="card|plain">{children}</Explainer>` with `ExplainerSummary`/`ExplainerTags`/`ExplainerColumns`/`ExplainerNote` from `@/components/ui/Explainer`. If it is not on main yet, STOP and flag.
- **Local gates are the only gates:** `npx tsc --noEmit` + `npx vitest run` (in-build type-check/lint are disabled — never merge without local gates).
- **Array-form `$transaction` only** — never interactive transactions (2026-06-10 incident). This plan adds no new transactions; do not introduce any.
- **Migration** via `npx prisma migrate dev --name add_homepage_screenshot` (Task 1).
- **No raw `fetch`** — `safeFetch`/`assertSafeHttpUrl` only for server fetches. The hero capture uses the **already-held puppeteer page** (`page.screenshot()`) — zero new network fetches.
- **Anchored middleware matchers only** — the new hero matcher is a full-anchored single-segment regex; NEVER an `/api/sales/` prefix.
- **Honest copy:** no compliance claims about the *prospect's* site ("WCAG compliant", "CWV pass" stay banned). The ER-product ADA claim (`ER_ADA_CTA`) is the ONE sanctioned exception (Kevin-approved). Performance copy keeps "Lighthouse-measured (lab)".
- **Share URLs / asset URLs** never derive from request origin; the hero `<img>` uses a relative `/api/sales/…` path (same-origin by construction).
- **Branch:** `feat/sales-report-redesign` (`git checkout main && git pull && git checkout -b feat/sales-report-redesign`).
- **Tests are DB-backed** against the dev SQLite DB (house convention — see existing `lib/sales/*.test.ts`); use unique `PREFIX`ed domains and clean up in `beforeAll`/`afterAll`.

**Known planning-time notes (deviations flagged):**
1. Hero dir default is `path.join(process.cwd(), 'data', 'sales-hero')` — the spec's prose said bare `sales-hero/`, but the explicitly-cited `REPORTS_DIR` precedent uses `data/reports` and `data/` is already gitignored. Prod stays `${DATA_HOME}/sales-hero` exactly as specced.
2. The capture point is "after Phase-1 navigation completes, before Phase 2 (axe)" — for site audits (provider `pagespeed`, `siteAudit: true`) this is immediately after `postLoadSettle`, exactly as specced; it also covers the `local` provider branch, which has no separate settle call.
3. `curl https://enrollmentresources.com` returns a Cloudflare "Just a moment…" challenge (verified 2026-07-14) — the logo step includes a browser fallback.
4. `schemaTypesJson` carries no explicit "observation capped" flag; the structured-data "coverage may be partial" qualifier keys off `observedPages < pagesTotal`.
5. **Every task's commit is tsc-green** (plan Codex review fix 5): Task 6 ships the new payload fields alongside a deprecated `patterns: []` + a one-line old-view compat patch; Task 11 (InquiryForm) lands before Task 12 because the new view imports it; Task 12 is the ONE atomic swap commit (sections + view + tests + deprecated-field removal + ExampleCard deletion).
6. Root→www redirects are the COMMON prospect case (redirect-detect deliberately classifies www changes as redirects): the hero capture also runs on the redirected path when the final URL is a rendered same-domain root variant, and the page job publishes after the winning redirect settle (plan Codex review fix 1).

---

## Task 1: Migration + `lib/sales/hero-screenshot.ts`

**Files:**
- Modify: `prisma/schema.prisma` (SiteAudit model, insert after line 189 `reportGeneratedAt …`)
- Create: `prisma/migrations/<timestamp>_add_homepage_screenshot/` (generated)
- Create: `lib/sales/hero-screenshot.ts`
- Create: `lib/sales/hero-screenshot.test.ts`

**Interfaces:**
```ts
export function heroScreenshotsDir(): string                       // env HERO_SCREENSHOTS_DIR || <cwd>/data/sales-hero
export function heroScreenshotFilename(siteAuditId: string): string // `${siteAuditId}.png` (the column value)
export function heroScreenshotPath(siteAuditId: string): string
export async function writeHeroScreenshot(siteAuditId: string, bytes: Uint8Array): Promise<void> // atomic UNIQUE-temp+rename (concurrent-publish safe); tmp cleaned on throw
export async function deleteHeroScreenshot(siteAuditId: string): Promise<void>                   // ENOENT-tolerant
```

**Steps:**

- [ ] Create the branch:
  ```bash
  git checkout main && git pull && git checkout -b feat/sales-report-redesign
  ```
  Verify `components/ui/Explainer.tsx` exists (PR 1 merged): `ls components/ui/Explainer.tsx`. If missing, STOP.

- [ ] Edit `prisma/schema.prisma` — in `model SiteAudit`, directly below the existing line:
  ```prisma
  reportGeneratedAt DateTime? // C4: last successful report-render stamp (file under REPORTS_DIR)
  ```
  add:
  ```prisma
  homepageScreenshot String?  // C14 hero: filename under HERO_SCREENSHOTS_DIR, stamped ONLY after a successful file write (prospect audits only)
  ```

- [ ] Run the migration:
  ```bash
  npx prisma migrate dev --name add_homepage_screenshot
  ```
  Expected output (names vary):
  ```
  Applying migration `20260714…_add_homepage_screenshot`
  The following migration(s) have been created and applied from new schema changes:
  …
  ✔ Generated Prisma Client
  ```
  The generated SQL must be exactly one `ALTER TABLE "SiteAudit" ADD COLUMN "homepageScreenshot" TEXT;`.

- [ ] Write the failing test `lib/sales/hero-screenshot.test.ts`:
  ```ts
  // lib/sales/hero-screenshot.test.ts — path building, atomic write, tolerant delete.
  import fs from 'fs/promises'
  import os from 'os'
  import path from 'path'
  import { afterAll, beforeAll, describe, expect, it } from 'vitest'
  import {
    deleteHeroScreenshot,
    heroScreenshotFilename,
    heroScreenshotPath,
    heroScreenshotsDir,
    writeHeroScreenshot,
  } from './hero-screenshot'

  let dir: string
  const prevEnv = process.env.HERO_SCREENSHOTS_DIR

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-shot-'))
    process.env.HERO_SCREENSHOTS_DIR = dir
  })
  afterAll(async () => {
    if (prevEnv === undefined) delete process.env.HERO_SCREENSHOTS_DIR
    else process.env.HERO_SCREENSHOTS_DIR = prevEnv
    await fs.rm(dir, { recursive: true, force: true })
  })

  describe('hero-screenshot', () => {
    it('builds paths under HERO_SCREENSHOTS_DIR from the audit id', () => {
      expect(heroScreenshotsDir()).toBe(dir)
      expect(heroScreenshotFilename('abc123')).toBe('abc123.png')
      expect(heroScreenshotPath('abc123')).toBe(path.join(dir, 'abc123.png'))
    })

    it('rejects path-unsafe ids', () => {
      expect(() => heroScreenshotPath('../etc')).toThrow(/unsafe/)
      expect(() => heroScreenshotPath('a/b')).toThrow(/unsafe/)
    })

    it('writes atomically (final file exists, no .tmp left behind)', async () => {
      await writeHeroScreenshot('cuid1', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
      const buf = await fs.readFile(heroScreenshotPath('cuid1'))
      expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
      const entries = await fs.readdir(dir)
      expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
    })

    it('delete removes the file and tolerates a missing file', async () => {
      await writeHeroScreenshot('cuid2', new Uint8Array([1]))
      await deleteHeroScreenshot('cuid2')
      await expect(fs.access(heroScreenshotPath('cuid2'))).rejects.toThrow()
      await expect(deleteHeroScreenshot('cuid2')).resolves.toBeUndefined() // ENOENT swallowed
    })

    it('concurrent writes to the same id do not collide (unique temp names)', async () => {
      await Promise.all([
        writeHeroScreenshot('cuid3', new Uint8Array([1])),
        writeHeroScreenshot('cuid3', new Uint8Array([2])),
      ])
      const buf = await fs.readFile(heroScreenshotPath('cuid3'))
      expect([1, 2]).toContain(buf[0]) // one of the two writes won, atomically
      const entries = await fs.readdir(dir)
      expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
    })
  })
  ```

- [ ] Run it — expect FAIL (module missing):
  ```bash
  npx vitest run lib/sales/hero-screenshot.test.ts
  ```
  Expected: `Error: Failed to load … ./hero-screenshot` (or "Cannot find module").

- [ ] Create `lib/sales/hero-screenshot.ts` (mirrors `lib/report/report-file.ts`):
  ```ts
  // lib/sales/hero-screenshot.ts — C14 hero: one homepage PNG per prospect site
  // audit under HERO_SCREENSHOTS_DIR. Deliberately NOT under SCREENSHOTS_DIR:
  // the screenshot sweeper deletes per-child dirs ~24 h after completion, but a
  // hero image must survive the 30-day sales token. Mirrors the REPORTS_DIR
  // precedent (lib/report/report-file.ts): atomic write, ENOENT-tolerant delete.
  //
  // Ops note (spec Codex verify item): in prod set HERO_SCREENSHOTS_DIR to
  // `${DATA_HOME}/sales-hero` (ecosystem.config.js) — persistent across
  // deploys, PM2-writable, and inside the DATA_HOME backup expectations.
  import { randomUUID } from 'crypto'
  import { promises as fs } from 'fs'
  import path from 'path'

  export function heroScreenshotsDir(): string {
    return process.env.HERO_SCREENSHOTS_DIR || path.join(process.cwd(), 'data', 'sales-hero')
  }

  /** ids are cuids; reject anything path-unsafe defensively. */
  function assertSafeId(id: string): void {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`unsafe hero screenshot id: ${id}`)
  }

  /** The value stored on SiteAudit.homepageScreenshot. */
  export function heroScreenshotFilename(siteAuditId: string): string {
    assertSafeId(siteAuditId)
    return `${siteAuditId}.png`
  }

  export function heroScreenshotPath(siteAuditId: string): string {
    return path.join(heroScreenshotsDir(), heroScreenshotFilename(siteAuditId))
  }

  /**
   * Atomic temp+rename; the temp file is cleaned up on throw. The temp name is
   * UNIQUE per call (plan Codex fix 2): two concurrent root-variant publishes
   * for the same audit must not collide on a shared `<dest>.tmp` — each write
   * gets its own temp file and the last rename wins atomically.
   */
  export async function writeHeroScreenshot(siteAuditId: string, bytes: Uint8Array): Promise<void> {
    const dest = heroScreenshotPath(siteAuditId)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    const tmp = `${dest}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(tmp, bytes)
      await fs.rename(tmp, dest)
    } catch (err) {
      await fs.unlink(tmp).catch(() => {})
      throw err
    }
  }

  export async function deleteHeroScreenshot(siteAuditId: string): Promise<void> {
    await fs.unlink(heroScreenshotPath(siteAuditId)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
  }
  ```

- [ ] Run — expect PASS:
  ```bash
  npx vitest run lib/sales/hero-screenshot.test.ts
  ```
  Expected: `5 passed`.

- [ ] Commit:
  ```bash
  git add prisma lib/sales/hero-screenshot.ts lib/sales/hero-screenshot.test.ts
  git commit -m "feat(sales): homepageScreenshot column + hero-screenshot file store (atomic write, tolerant delete)"
  ```

---

## Task 2: Root-URL matcher + prospect root-injection in discovery

**Files:**
- Create: `lib/sales/root-url.ts` (pure, client-safe — no fs/prisma)
- Create: `lib/sales/root-url.test.ts`
- Modify: `lib/ada-audit/sitemap-crawler.ts` line 19 (`const HARD_CAP = 1000` → export)
- Modify: `lib/jobs/handlers/site-audit-discover.ts` (select at lines 97–108; injection point directly after line 240 `urls = [...new Set(urls)]`)
- Modify: `lib/jobs/handlers/site-audit-discover.test.ts` (new describe)

**Interfaces:**
```ts
export function canonicalRootUrl(domain: string): string          // `https://${domain}/`
export function isRootUrl(url: string, domain: string): boolean   // scheme-insensitive, www-insensitive host, path '/'|'' , no query
export function injectProspectRoot(urls: string[], domain: string, cap: number): { urls: string[]; displaced: boolean }
// pure; prepend root when no variant present; at cap the root displaces the last
// URL and `displaced: true` tells the caller to persist discoveryCapped (plan
// Codex fix 3 — deliberate truncation must not look like complete coverage)
```

**Steps:**

- [ ] Write the failing test `lib/sales/root-url.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest'
  import { canonicalRootUrl, injectProspectRoot, isRootUrl } from './root-url'

  describe('isRootUrl', () => {
    it('matches scheme/www/trailing-slash variants of the domain root', () => {
      expect(isRootUrl('https://acme.test/', 'acme.test')).toBe(true)
      expect(isRootUrl('http://acme.test/', 'acme.test')).toBe(true)
      expect(isRootUrl('https://www.acme.test/', 'acme.test')).toBe(true)
      expect(isRootUrl('https://acme.test', 'acme.test')).toBe(true) // empty path serializes to '/'
      expect(isRootUrl('https://acme.test/', 'www.acme.test')).toBe(true) // www-insensitive both ways
    })
    it('rejects non-root paths, queries, other hosts, and junk', () => {
      expect(isRootUrl('https://acme.test/about', 'acme.test')).toBe(false)
      expect(isRootUrl('https://acme.test/?utm=1', 'acme.test')).toBe(false)
      expect(isRootUrl('https://blog.acme.test/', 'acme.test')).toBe(false)
      expect(isRootUrl('https://other.test/', 'acme.test')).toBe(false)
      expect(isRootUrl('not a url', 'acme.test')).toBe(false)
      expect(isRootUrl('ftp://acme.test/', 'acme.test')).toBe(false)
    })
  })

  describe('injectProspectRoot', () => {
    it('no-ops when a root variant is already present', () => {
      const urls = ['https://www.acme.test/', 'https://acme.test/a']
      const out = injectProspectRoot(urls, 'acme.test', 1000)
      expect(out.urls).toBe(urls) // same reference — untouched
      expect(out.displaced).toBe(false)
    })
    it('prepends the canonical root when absent (no displacement below cap)', () => {
      const out = injectProspectRoot(['https://acme.test/a'], 'acme.test', 1000)
      expect(out.urls).toEqual(['https://acme.test/', 'https://acme.test/a'])
      expect(out.displaced).toBe(false)
    })
    it('displaces the last URL when at cap and reports displaced: true', () => {
      const urls = Array.from({ length: 1000 }, (_, i) => `https://acme.test/p${i}`)
      const out = injectProspectRoot(urls, 'acme.test', 1000)
      expect(out.urls).toHaveLength(1000)
      expect(out.urls[0]).toBe(canonicalRootUrl('acme.test'))
      expect(out.urls).not.toContain('https://acme.test/p999')
      expect(out.urls).toContain('https://acme.test/p998')
      expect(out.displaced).toBe(true)
    })
  })
  ```

- [ ] `npx vitest run lib/sales/root-url.test.ts` — expect FAIL (module missing).

- [ ] Create `lib/sales/root-url.ts`:
  ```ts
  // lib/sales/root-url.ts — C14 hero: pure root-URL matching + the prospect-only
  // discovery injection. Client-safe (no fs/prisma). Spec Codex fix 1: discovery
  // does NOT guarantee the site root is in the audited set; for prospect-owned
  // audits ONLY, the discover job guarantees it via injectProspectRoot — a
  // documented, at-most-one-page measurement adjustment (Kevin sign-off).

  function bareHost(host: string): string {
    return host.toLowerCase().replace(/^www\./, '')
  }

  /** Canonical root for a stored SiteAudit.domain ("example.edu" — no scheme). */
  export function canonicalRootUrl(domain: string): string {
    return `https://${bareHost(domain.trim())}/`
  }

  /**
   * True when `url` is the site root: http(s) scheme (either), host equal to
   * `domain` up to a `www.` prefix on either side, path '/' or empty, no query.
   */
  export function isRootUrl(url: string, domain: string): boolean {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return false
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (bareHost(u.hostname) !== bareHost(domain.trim())) return false
    if (u.search !== '') return false
    return u.pathname === '/' || u.pathname === ''
  }

  /**
   * Prospect-only discovery adjustment: guarantee a root variant in the set.
   * Returns the INPUT ARRAY (same reference) with `displaced: false` when a
   * variant is present — callers may rely on that for a cheap no-op check.
   * At `cap`, the root displaces the LAST url so the 1000-page hard cap is
   * respected — and `displaced: true` tells the caller to persist
   * `discoveryCapped: true` (plan Codex fix 3: deliberate truncation must not
   * read as complete coverage in the miss-rate measurement).
   * Pure + deterministic: every discover attempt over the same stored set
   * produces the same output.
   */
  export function injectProspectRoot(
    urls: string[],
    domain: string,
    cap: number,
  ): { urls: string[]; displaced: boolean } {
    if (urls.some((u) => isRootUrl(u, domain))) return { urls, displaced: false }
    const withRoot = [canonicalRootUrl(domain), ...urls]
    if (withRoot.length > cap) return { urls: withRoot.slice(0, cap), displaced: true }
    return { urls: withRoot, displaced: false }
  }
  ```

- [ ] `npx vitest run lib/sales/root-url.test.ts` — expect PASS (`6 passed`).

- [ ] Export the cap from `lib/ada-audit/sitemap-crawler.ts` — line 19, change:
  ```ts
  const HARD_CAP = 1000
  ```
  to:
  ```ts
  export const HARD_CAP = 1000
  ```

- [ ] Add the failing discover test — append to `lib/jobs/handlers/site-audit-discover.test.ts`:
  ```ts
  describe('C14 hero: prospect root injection', () => {
    async function seedProspect(name: string) {
      return prisma.prospect.create({ data: { name: `P-${name}`, domain: `${PREFIX}${name}` } })
    }

    it('prepends the canonical root for a prospect audit whose discovery omitted it', async () => {
      const p = await seedProspect('rootless')
      const site = await seedQueued('rootless', { prospectId: p.id })
      vi.mocked(discoverPages).mockResolvedValue({
        urls: [`https://${PREFIX}rootless/a`], mode: 'sitemap', capped: false,
      })
      await runSiteAuditDiscoverJob({ siteAuditId: site.id })
      const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
      const urls = JSON.parse(s!.discoveredUrls!) as string[]
      expect(urls[0]).toBe(`https://${PREFIX}rootless/`)
      expect(s?.pagesTotal).toBe(2)
      const children = await prisma.adaAudit.findMany({ where: { siteAuditId: site.id } })
      expect(children.map((c) => c.url)).toContain(`https://${PREFIX}rootless/`)
      await prisma.prospect.delete({ where: { id: p.id } })
    })

    it('does NOT inject for a non-prospect audit', async () => {
      const site = await seedQueued('noprospect')
      vi.mocked(discoverPages).mockResolvedValue({
        urls: [`https://${PREFIX}noprospect/a`], mode: 'sitemap', capped: false,
      })
      await runSiteAuditDiscoverJob({ siteAuditId: site.id })
      const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
      expect(JSON.parse(s!.discoveredUrls!)).toEqual([`https://${PREFIX}noprospect/a`])
      expect(s?.pagesTotal).toBe(1)
    })

    it('no-ops when a www root variant is already present', async () => {
      const p = await seedProspect('hasroot')
      const site = await seedQueued('hasroot', { prospectId: p.id })
      vi.mocked(discoverPages).mockResolvedValue({
        urls: [`https://www.${PREFIX}hasroot/`, `https://${PREFIX}hasroot/a`], mode: 'sitemap', capped: false,
      })
      await runSiteAuditDiscoverJob({ siteAuditId: site.id })
      const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
      expect(s?.pagesTotal).toBe(2)
      expect(JSON.parse(s!.discoveredUrls!)[0]).toBe(`https://www.${PREFIX}hasroot/`)
      await prisma.prospect.delete({ where: { id: p.id } })
    })

    it('at-cap displacement persists discoveryCapped: true (plan Codex fix 3)', async () => {
      // HEAVY test (~1000 child rows + jobs) — the displacement branch only
      // fires at the real HARD_CAP; clearTestState() sweeps it all by PREFIX.
      const { HARD_CAP } = await import('@/lib/ada-audit/sitemap-crawler')
      const p = await seedProspect('atcap')
      const site = await seedQueued('atcap', { prospectId: p.id })
      const urls = Array.from({ length: HARD_CAP }, (_, i) => `https://${PREFIX}atcap/p${i}`)
      vi.mocked(discoverPages).mockResolvedValue({ urls, mode: 'sitemap', capped: false })
      await runSiteAuditDiscoverJob({ siteAuditId: site.id })
      const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
      const stored = JSON.parse(s!.discoveredUrls!) as string[]
      expect(stored).toHaveLength(HARD_CAP)
      expect(stored[0]).toBe(`https://${PREFIX}atcap/`)
      expect(stored).not.toContain(`https://${PREFIX}atcap/p${HARD_CAP - 1}`)
      expect(s?.pagesTotal).toBe(HARD_CAP)
      expect(s?.discoveryCapped).toBe(true) // deliberate truncation is honest
      await prisma.prospect.delete({ where: { id: p.id } })
    }, 60_000)
  })
  ```
  Also extend `clearTestState()` in that file to clean prospects:
  ```ts
  await prisma.prospect.deleteMany({ where: { domain: { startsWith: PREFIX } } })
  ```
  (add after the siteAudit deleteMany).

- [ ] `npx vitest run lib/jobs/handlers/site-audit-discover.test.ts` — expect the prepend test AND the at-cap test to FAIL (root missing / pagesTotal 1 / discoveryCapped not set); the www no-op test passes trivially pre-wiring.

- [ ] Wire the injection into `lib/jobs/handlers/site-audit-discover.ts`:
  1. Add imports (top, with the other `@/lib` imports):
     ```ts
     import { injectProspectRoot } from '@/lib/sales/root-url'
     import { HARD_CAP } from '@/lib/ada-audit/sitemap-crawler'
     ```
  2. In the audit select (currently lines 97–108), add `prospectId: true`:
     ```ts
     select: {
       status: true,
       domain: true,
       clientId: true,
       wcagLevel: true,
       discoveredUrls: true,
       seoIntent: true,
       discoverySourcesJson: true,
       prospectId: true,
     },
     ```
  3. Directly after the existing dedupe line (line 240):
     ```ts
     urls = [...new Set(urls)]
     ```
     insert:
     ```ts
     // C14 hero (spec Codex fix 1): prospect-owned audits are GUARANTEED to
     // include the site root — the hero screenshot is captured on that page.
     // Prospect-only, at-most-one-page, deterministic across attempts (pure
     // function of the stored set + domain, and the ensure-write below persists
     // the injected list so later attempts see the root already present). The
     // 1000-page cap is respected: at cap the root displaces the last URL, and
     // that displacement is deliberate truncation — discoveryCapped must flip
     // true so the miss-rate measurement doesn't read as complete coverage
     // (plan Codex fix 3).
     let rootDisplaced = false
     if (audit.prospectId !== null) {
       const injected = injectProspectRoot(urls, audit.domain, HARD_CAP)
       urls = injected.urls
       rootDisplaced = injected.displaced
     }
     ```
  4. Fold the displacement flag into the `ensured` updateMany directly below (currently lines 241–244) — change:
     ```ts
     const ensured = await prisma.siteAudit.updateMany({
       where: { id: siteAuditId, status: 'running' },
       data: { discoveredUrls: JSON.stringify(urls), pagesTotal: urls.length },
     })
     ```
     to:
     ```ts
     const ensured = await prisma.siteAudit.updateMany({
       where: { id: siteAuditId, status: 'running' },
       data: {
         discoveredUrls: JSON.stringify(urls),
         pagesTotal: urls.length,
         // Root injection at cap = deliberate truncation (plan Codex fix 3).
         // Never flips true→false: only set when displacement happened.
         ...(rootDisplaced ? { discoveryCapped: true } : {}),
       },
     })
     ```

- [ ] `npx vitest run lib/jobs/handlers/site-audit-discover.test.ts lib/sales/root-url.test.ts` — expect ALL PASS.

- [ ] Commit:
  ```bash
  git add lib/sales/root-url.ts lib/sales/root-url.test.ts lib/ada-audit/sitemap-crawler.ts lib/jobs/handlers/site-audit-discover.ts lib/jobs/handlers/site-audit-discover.test.ts
  git commit -m "feat(sales): prospect-only root-URL injection in discovery (hero capture prerequisite)"
  ```

---

## Task 3: Runner `captureHeroScreenshot` (returns bytes) + fenced publication in the page job

**Files:**
- Modify: `lib/ada-audit/runner.ts` (`RunAxeOptions` lines 35–49; `RunAxeResult` 'audited' + 'redirected' variants lines 51–81; redirect holder line 186 + both redirect returns lines 273–275/297–299; capture block inserted before the `// ── Phase 2` comment at line 326; audited return at line 422)
- Modify: `lib/jobs/handlers/site-audit-page.ts` (parent select lines 221–226; `runAxeAudit` call lines 249–255; redirected settle lines 270–285; post-fence block lines 345–350; new `publishHeroScreenshot` helper)
- Modify: `lib/jobs/handlers/site-audit-page.test.ts` (new describe)

**Interfaces:**
```ts
// runner.ts
interface RunAxeOptions { …; captureHeroScreenshot?: boolean }
// BOTH the 'audited' AND the 'redirected' result variants gain:
//   heroScreenshotPng: Uint8Array | null
// (plan Codex fix 1: redirect-detect deliberately classifies root→www changes
// as redirects — most prospect roots redirect to www, so the redirected path
// must also carry capture bytes when the FINAL url is still a same-domain
// root variant and the page actually rendered)
// site-audit-page.ts (exported for tests)
export async function publishHeroScreenshot(siteAuditId: string, png: Uint8Array | null): Promise<void>
// stamp is guarded `where: { id, prospectId: { not: null } }`; count 0 or a
// thrown stamp ⇒ the just-written file is deleted (plan Codex fix 2)
```

**Steps:**

- [ ] Write the failing tests — append to `lib/jobs/handlers/site-audit-page.test.ts` (after the existing describes; it already has `prisma`, `runAxeAudit` mock, `seed`, `AXE_OK`):
  ```ts
  import fs from 'fs/promises'
  import os from 'os'
  import path from 'path'

  describe('C14 hero: capture request + fenced publication', () => {
    let heroDir: string
    const prevHeroEnv = process.env.HERO_SCREENSHOTS_DIR
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

    beforeAll(async () => {
      heroDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-pub-'))
      process.env.HERO_SCREENSHOTS_DIR = heroDir
    })
    afterAll(async () => {
      if (prevHeroEnv === undefined) delete process.env.HERO_SCREENSHOTS_DIR
      else process.env.HERO_SCREENSHOTS_DIR = prevHeroEnv
      await fs.rm(heroDir, { recursive: true, force: true })
      await prisma.prospect.deleteMany({ where: { domain: { startsWith: PREFIX } } })
    })

    async function seedProspectRoot(name: string) {
      const prospect = await prisma.prospect.create({ data: { name, domain: `${PREFIX}${name}` } })
      const site = await prisma.siteAudit.create({
        data: {
          domain: `${PREFIX}${name}`, status: 'running', wcagLevel: 'wcag21aa',
          prospectId: prospect.id,
          discoveredUrls: JSON.stringify([`https://${PREFIX}${name}/`]), pagesTotal: 1,
        },
      })
      const child = await prisma.adaAudit.create({
        data: { url: `https://${PREFIX}${name}/`, status: 'pending', siteAuditId: site.id, wcagLevel: 'wcag21aa' },
      })
      return { site, child, payload: { adaAuditId: child.id, siteAuditId: site.id, url: child.url, wcagLevel: 'wcag21aa' } }
    }

    it('requests capture on the prospect root page and publishes file + stamp after a winning settle', async () => {
      vi.mocked(runAxeAudit).mockResolvedValue({ ...AXE_OK, heroScreenshotPng: PNG } as never)
      const { site, payload } = await seedProspectRoot('hero-ok')
      await runSiteAuditPageJob(payload)
      // capture was requested
      const opts = vi.mocked(runAxeAudit).mock.calls[0][3]
      expect(opts?.captureHeroScreenshot).toBe(true)
      // file + stamp published
      const buf = await fs.readFile(path.join(heroDir, `${site.id}.png`))
      expect([...buf]).toEqual([...PNG])
      const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
      expect(s?.homepageScreenshot).toBe(`${site.id}.png`)
    })

    it('does NOT request capture for a non-prospect audit or a non-root page', async () => {
      vi.mocked(runAxeAudit).mockResolvedValue({ ...AXE_OK, heroScreenshotPng: null } as never)
      const { payload } = await seed('hero-nonprospect') // existing helper: no prospectId
      await runSiteAuditPageJob(payload)
      expect(vi.mocked(runAxeAudit).mock.calls[0][3]?.captureHeroScreenshot).toBeFalsy()
    })

    it('a LOST settle publishes no file and no stamp (zombie attempt)', async () => {
      const { site, child, payload } = await seedProspectRoot('hero-lost')
      // Zombie simulation: the "runner" flips the child terminal mid-run, so
      // this attempt's settle (claimable: ['running']) matches 0 rows.
      vi.mocked(runAxeAudit).mockImplementation(async () => {
        await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'complete' } })
        return { ...AXE_OK, heroScreenshotPng: PNG } as never
      })
      await runSiteAuditPageJob(payload)
      await expect(fs.access(path.join(heroDir, `${site.id}.png`))).rejects.toThrow()
      const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
      expect(s?.homepageScreenshot).toBeNull()
    })

    it('root→www redirect: bytes on the redirected result are published after the winning redirect settle (plan Codex fix 1)', async () => {
      const { site, child, payload } = await seedProspectRoot('hero-redir')
      // The runner captured the rendered www root BEFORE returning redirected
      // (redirect-detect classifies www changes as redirects by design).
      vi.mocked(runAxeAudit).mockResolvedValue({
        kind: 'redirected', finalUrl: `https://www.${PREFIX}hero-redir/`, heroScreenshotPng: PNG,
      } as never)
      await runSiteAuditPageJob(payload)
      const c = await prisma.adaAudit.findUnique({ where: { id: child.id } })
      expect(c?.status).toBe('redirected') // redirect classification unchanged
      const buf = await fs.readFile(path.join(heroDir, `${site.id}.png`))
      expect([...buf]).toEqual([...PNG])
      const s = await prisma.siteAudit.findUnique({ where: { id: site.id } })
      expect(s?.homepageScreenshot).toBe(`${site.id}.png`)
    })

    it('off-domain / cross-path redirect: runner returned null bytes — nothing published', async () => {
      // The same-domain-root gate lives in the RUNNER (isRootUrl against the
      // original host — unit-covered in root-url.test.ts); the handler just
      // publishes whatever bytes it was handed. Null bytes ⇒ no file, no stamp.
      vi.mocked(runAxeAudit).mockResolvedValue({
        kind: 'redirected', finalUrl: 'https://elsewhere.example/landing', heroScreenshotPng: null,
      } as never)
      const { site, payload } = await seedProspectRoot('hero-offsite')
      await runSiteAuditPageJob(payload)
      await expect(fs.access(path.join(heroDir, `${site.id}.png`))).rejects.toThrow()
      expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.homepageScreenshot).toBeNull()
    })

    it('publish guard (plan Codex fix 2): audit no longer prospect-owned ⇒ no stamp AND the just-written file is removed', async () => {
      // Simulates a prospect DELETE racing the publish: SetNull already ran.
      const site = await prisma.siteAudit.create({
        data: { domain: `${PREFIX}hero-orphan`, status: 'running', wcagLevel: 'wcag21aa', prospectId: null },
      })
      await publishHeroScreenshot(site.id, PNG)
      expect((await prisma.siteAudit.findUnique({ where: { id: site.id } }))?.homepageScreenshot).toBeNull()
      await expect(fs.access(path.join(heroDir, `${site.id}.png`))).rejects.toThrow() // orphan file cleaned up
    })
  })
  ```
  (Add `beforeAll, afterAll` to the vitest import at the top of the file if not present, and extend the module import line to `const { runSiteAuditPageJob, onSiteAuditPageExhausted, persistPageSeo, publishHeroScreenshot } = await import('./site-audit-page')`.)

- [ ] `npx vitest run lib/jobs/handlers/site-audit-page.test.ts` — expect the new describe FAILS (`captureHeroScreenshot` undefined, no file written).

- [ ] Modify `lib/ada-audit/runner.ts`:
  1. In `RunAxeOptions` (lines 35–49), after the `renderOnly?: boolean` member, add:
     ```ts
     // C14 hero: capture a viewport PNG of the loaded page (prospect root page
     // only — the caller decides). Bytes are RETURNED on the result — 'audited'
     // always; 'redirected' when the final URL is a RENDERED same-domain root
     // variant (root→www is the common prospect case, plan Codex fix 1). The
     // runner never writes the final file (publication is fenced to the
     // winning settle in site-audit-page.ts). Capture failure logs + never
     // fails the page.
     captureHeroScreenshot?: boolean
     ```
  2. Add the bytes member to BOTH result variants of `RunAxeResult` (lines 51–81). In the `'audited'` variant, after `harvestedPageSeo: RawPageSeo | null`:
     ```ts
     // C14 hero: viewport PNG bytes when captureHeroScreenshot was set and the
     // capture succeeded; null otherwise.
     heroScreenshotPng: Uint8Array | null
     ```
     and in the `'redirected'` variant (currently `{ kind: 'redirected'; finalUrl: string }`):
     ```ts
     | {
         kind: 'redirected'
         finalUrl: string
         // C14 hero (plan Codex fix 1): redirect-detect deliberately classifies
         // root→www changes as redirects, so most prospect roots land here. When
         // the redirect was auto-followed (page RENDERED at finalUrl) and finalUrl
         // is still a same-domain root variant, the capture bytes ride along.
         heroScreenshotPng: Uint8Array | null
       }
     ```
  3. Add the runner-side import (top, with the other `@/lib` imports):
     ```ts
     import { isRootUrl } from '@/lib/sales/root-url'
     ```
     and a capture helper inside `runAxeAudit`'s `try` block (above the Phase-1 navigation section, after `handleRequest` is wired) so both the redirect path and the audited path share it:
     ```ts
     // C14 hero: shared capture helper. Never fails the page job.
     const captureHeroIfRequested = async (): Promise<Uint8Array | null> => {
       if (!options?.captureHeroScreenshot || options?.renderOnly) return null
       try {
         return await page.screenshot({ type: 'png', fullPage: false })
       } catch (err) {
         console.warn('[c14/hero] homepage screenshot capture failed:', (err as Error).message)
         return null
       }
     }
     ```
  4. Distinguish RENDERED redirects from unrendered ones. Change the holder declaration (line 186) from:
     ```ts
     const redirectedHolder: { value: { finalUrl: string } | null } = { value: null }
     ```
     to:
     ```ts
     // `rendered`: true when puppeteer auto-followed and the final page is
     // actually loaded in the tab (detectRedirect path); false on the
     // 3xx-with-Location no-autofollow path, where the target never rendered
     // and a screenshot would capture nothing meaningful.
     const redirectedHolder: { value: { finalUrl: string; rendered: boolean } | null } = { value: null }
     ```
     At the Location-header site (line ~240, `redirectedHolder.value = { finalUrl: resolved }`) set `rendered: false`; at the detectRedirect site (line ~263, `redirectedHolder.value = { finalUrl: detected.finalUrl }`) set `rendered: true`.
  5. Capture on BOTH redirect returns (lines 273–275 and 297–299). Replace each:
     ```ts
     if (redirectedHolder.value) {
       return { kind: 'redirected', finalUrl: redirectedHolder.value.finalUrl }
     }
     ```
     with:
     ```ts
     if (redirectedHolder.value) {
       const { finalUrl, rendered } = redirectedHolder.value
       // C14 hero (plan Codex fix 1): a root→www (or scheme) redirect is still
       // the prospect's homepage — capture the RENDERED final page when its URL
       // is a same-domain root variant of the originally requested host.
       // Off-domain or cross-path redirects capture nothing. parsed.hostname is
       // the original target's host; isRootUrl is www/scheme-insensitive.
       const heroScreenshotPng =
         rendered && isRootUrl(finalUrl, parsed.hostname) ? await captureHeroIfRequested() : null
       return { kind: 'redirected', finalUrl, heroScreenshotPng }
     }
     ```
  6. Insert the audited-path capture immediately BEFORE the line:
     ```ts
     // ── Phase 2: axe on the already-loaded page ──────────────────────────
     ```
     insert:
     ```ts
     // ── C14 hero capture (non-redirect path) ─────────────────────────────
     // Viewport PNG of the loaded page, after Phase-1 navigation + settle and
     // BEFORE axe mutates focus/scroll state. Site audits skip inline PSI
     // (options.siteAudit), so for the prospect path this runs directly after
     // postLoadSettle. The redirect paths above capture separately (rendered
     // same-domain root variants only).
     const heroScreenshotPng: Uint8Array | null = await captureHeroIfRequested()
     ```
  7. Change the audited return (line 422) from:
     ```ts
     return { kind: 'audited', axe: axe as StoredAxeResults, lighthouseSummary, lighthouseError, harvestedPdfUrls, harvestedLinks, harvestedLinksTruncated, harvestedPageSeo }
     ```
     to:
     ```ts
     return { kind: 'audited', axe: axe as StoredAxeResults, lighthouseSummary, lighthouseError, harvestedPdfUrls, harvestedLinks, harvestedLinksTruncated, harvestedPageSeo, heroScreenshotPng }
     ```
  Notes: puppeteer-core 24's `page.screenshot()` returns `Promise<Uint8Array>` — no cast needed; if tsc complains (`Buffer` overload), wrap in `new Uint8Array(...)`. The `local`-provider branch never returns `redirected`, so only the two sites above construct that variant. Grep for other constructors/consumers before compiling: `grep -rn "kind: 'redirected'" lib app --include='*.ts' | grep -v test | grep -v worktrees` — only the runner constructs it; consumers (`site-audit-page.ts` redirect branch, standalone `ada-audit.ts` handler) read `finalUrl` and ignore the extra member.

- [ ] Modify `lib/jobs/handlers/site-audit-page.ts`:
  1. Add imports:
     ```ts
     import { isRootUrl } from '@/lib/sales/root-url'
     import { deleteHeroScreenshot, heroScreenshotFilename, writeHeroScreenshot } from '@/lib/sales/hero-screenshot'
     ```
  2. Extend the parent select (lines 221–226) from:
     ```ts
     const parent = await prisma.siteAudit.findUnique({
       where: { id: job.siteAuditId },
       select: { seoOnly: true },
     })
     ```
     to:
     ```ts
     const parent = await prisma.siteAudit.findUnique({
       where: { id: job.siteAuditId },
       select: { seoOnly: true, prospectId: true, domain: true },
     })
     ```
  3. Below `const detachPsi = …` (line 247), add:
     ```ts
     // C14 hero: capture only for prospect-owned audits on the site-root page
     // (scheme/www-insensitive match against the parent's stored domain).
     const wantHero = parent != null && parent.prospectId !== null && !seoOnly && isRootUrl(job.url, parent.domain)
     ```
  4. Thread it into the `runAxeAudit` call (lines 251–255):
     ```ts
     runResult = await runAxeAudit(job.url, job.wcagLevel, undefined, {
       auditId: job.adaAuditId,
       siteAudit: detachPsi,
       renderOnly: seoOnly,
       captureHeroScreenshot: wantHero,
     })
     ```
  5. Add the publication helper (module scope, near `persistPageSeo`; exported for tests):
     ```ts
     /**
      * C14 hero publication — fenced to a WINNING settle (spec Codex fix 2):
      * callers invoke this only after settlePage() returned true, on the same
      * code path as persistHarvest/persistPageSeo. Writes the final file
      * atomically (UNIQUE temp+rename; temp cleaned on throw inside the
      * writer), then stamps homepageScreenshot — guarded on the audit STILL
      * being prospect-owned (plan Codex fix 2: a prospect DELETE between the
      * file write and the stamp SetNulls prospectId; an unguarded stamp-by-id
      * would strand the file as a permanent orphan). Stamp count 0 or a thrown
      * stamp ⇒ the just-written file is deleted. Best-effort throughout: a
      * failure logs and never fails the page job; the column stays null → the
      * report hides the hero slot.
      */
     export async function publishHeroScreenshot(siteAuditId: string, png: Uint8Array | null): Promise<void> {
       if (!png || png.length === 0) return
       try {
         await writeHeroScreenshot(siteAuditId, png)
       } catch (e) {
         console.warn('[c14/hero] file write failed for', siteAuditId, ':', (e as Error).message)
         return
       }
       try {
         const stamped = await prisma.siteAudit.updateMany({
           where: { id: siteAuditId, prospectId: { not: null } },
           data: { homepageScreenshot: heroScreenshotFilename(siteAuditId) },
         })
         if (stamped.count === 0) {
           // Row gone or no longer prospect-owned (a prospect DELETE won the
           // race) — never leave an unstamped orphan on disk.
           await deleteHeroScreenshot(siteAuditId)
         }
       } catch (e) {
         console.warn('[c14/hero] stamp failed for', siteAuditId, ':', (e as Error).message)
         await deleteHeroScreenshot(siteAuditId).catch(() => {})
       }
     }
     ```
  6. Publish on BOTH winning settle paths (plan Codex fix 1):
     **(a) redirected branch** (lines 270–285) — the redirected settle currently ends with:
     ```ts
     if (settled) await finalizeWarn(job.siteAuditId, 'redirect settle')
     return
     ```
     change to:
     ```ts
     if (!settled) return
     // C14 hero: a root→www redirect carries the rendered homepage bytes
     // (runner-gated to RENDERED same-domain root variants); publish exactly
     // like the audited path, fenced to the winning redirect settle.
     await publishHeroScreenshot(job.siteAuditId, runResult.heroScreenshotPng ?? null)
     await finalizeWarn(job.siteAuditId, 'redirect settle')
     return
     ```
     **(b) audited post-fence block** (lines 345–350) — currently:
     ```ts
     // Reached only when this attempt won the settle (both branches return on
     // !settled) — fence the harvest persistence to that (fix #3).
     await persistHarvest(job.siteAuditId, job.url, harvestedLinks, harvestedLinksTruncated)
     await persistPageSeo(job.siteAuditId, job.url, harvestedPageSeo)

     await finalizeWarn(job.siteAuditId, 'page settle')
     ```
     add the publish between `persistPageSeo` and `finalizeWarn`:
     ```ts
     await publishHeroScreenshot(job.siteAuditId, runResult.heroScreenshotPng ?? null)
     ```
     Keep the destructure at line 306 unchanged and reference `runResult.heroScreenshotPng` (TS has narrowed the variant on each path; the `?? null` also tolerates legacy mocked results in existing tests that omit the member).

- [ ] `npx vitest run lib/jobs/handlers/site-audit-page.test.ts` — expect ALL PASS (existing + 6 new).

- [ ] `npx tsc --noEmit` — expect clean (the new result member is required on BOTH producing variants; the only producer is the runner, updated above).

- [ ] Commit:
  ```bash
  git add lib/ada-audit/runner.ts lib/jobs/handlers/site-audit-page.ts lib/jobs/handlers/site-audit-page.test.ts
  git commit -m "feat(sales): hero capture in runner (audited + rendered same-domain-root redirects) + guarded publication fenced to winning settles"
  ```

---

## Task 4: Deletion seams (SiteAudit DELETE · prospect DELETE snapshot · scheduled retention)

**Files:**
- Modify: `app/api/site-audit/[id]/route.ts` (DELETE handler, reportCleanup block lines 187–194)
- Modify: `app/api/sales/prospects/[id]/route.ts` (whole DELETE, lines 12–22)
- Modify: `lib/ada-audit/scheduled-retention.ts` (chunk loop lines 70–81)
- Modify: `app/api/sales/prospects/routes.test.ts` (extend DELETE describe)
- Modify: `lib/ada-audit/scheduled-retention.test.ts` if it exists (check `ls lib/ada-audit/scheduled-retention.test.ts`); otherwise the retention hook is covered by the code change + tsc (flag in PR notes)

**Steps:**

- [ ] Write the failing test — extend the `DELETE /api/sales/prospects/[id]` describe in `app/api/sales/prospects/routes.test.ts`:
  ```ts
  it('C14 hero: snapshots audit ids, deletes hero files, and nulls homepageScreenshot', async () => {
    const fs = await import('fs/promises')
    const os = await import('os')
    const path = await import('path')
    const heroDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-del-'))
    const prevEnv = process.env.HERO_SCREENSHOTS_DIR
    process.env.HERO_SCREENSHOTS_DIR = heroDir
    try {
      const p = await prisma.prospect.create({ data: { name: 'HeroDel', domain: `${PREFIX}herodel.test` } })
      const a = await prisma.siteAudit.create({
        data: { domain: `${PREFIX}herodel.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: p.id },
      })
      await prisma.siteAudit.update({ where: { id: a.id }, data: { homepageScreenshot: `${a.id}.png` } })
      await fs.writeFile(path.join(heroDir, `${a.id}.png`), Buffer.from([1]))

      // Interleaving case (plan Codex fix 2): a second audit whose publish
      // wrote the FILE but has not stamped the column yet (column still null).
      // The snapshot must cover ALL linked audits — not just stamped rows —
      // so this file must be gone after the delete too.
      const b = await prisma.siteAudit.create({
        data: { domain: `${PREFIX}herodel.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: p.id },
      })
      await fs.writeFile(path.join(heroDir, `${b.id}.png`), Buffer.from([2]))

      const r = await prospectDelete(req(`/api/sales/prospects/${p.id}`, 'DELETE'), params(p.id))
      expect(r.status).toBe(200)
      const row = await prisma.siteAudit.findUnique({ where: { id: a.id } })
      expect(row?.prospectId).toBeNull()          // SetNull unchanged
      expect(row?.homepageScreenshot).toBeNull()  // column nulled
      await expect(fs.access(path.join(heroDir, `${a.id}.png`))).rejects.toThrow() // stamped file gone
      await expect(fs.access(path.join(heroDir, `${b.id}.png`))).rejects.toThrow() // UNSTAMPED file gone too
      await prisma.siteAudit.deleteMany({ where: { id: { in: [a.id, b.id] } } })
    } finally {
      if (prevEnv === undefined) delete process.env.HERO_SCREENSHOTS_DIR
      else process.env.HERO_SCREENSHOTS_DIR = prevEnv
      await fs.rm(heroDir, { recursive: true, force: true })
    }
  })
  ```

- [ ] `npx vitest run app/api/sales/prospects/routes.test.ts` — expect the new test FAILS (column not nulled, file survives).

- [ ] Rewrite the prospect DELETE in `app/api/sales/prospects/[id]/route.ts` (replacing lines 12–22):
  ```ts
  import { deleteHeroScreenshot } from '@/lib/sales/hero-screenshot'
  ```
  ```ts
  export const DELETE = withRoute(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const id = parseId((await params).id)
    if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
    const existing = await prisma.prospect.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

    // C14 hero (spec Codex fix 3b + plan Codex fix 2): prospect DELETE SetNulls
    // its audits rather than deleting them — without this snapshot the hero
    // files would be permanent orphans. Snapshot ALL linked audit ids, NOT just
    // rows with a stamped homepageScreenshot: a concurrent publish may have
    // written the file but not stamped the column yet (the hero path is the
    // deterministic `<id>.png`, so deleting by id is always safe and
    // ENOENT-tolerant). Snapshot BEFORE the delete, then null the columns and
    // remove the files (best-effort) after.
    const linkedAudits = await prisma.siteAudit.findMany({
      where: { prospectId: id },
      select: { id: true },
    })

    await prisma.prospect.delete({ where: { id } }) // SiteAudit.prospectId SetNulls via relation

    if (linkedAudits.length > 0) {
      const ids = linkedAudits.map((a) => a.id)
      await prisma.siteAudit.updateMany({ where: { id: { in: ids } }, data: { homepageScreenshot: null } })
      const cleanup = await Promise.allSettled(ids.map((aid) => deleteHeroScreenshot(aid)))
      for (const r of cleanup) {
        if (r.status === 'rejected') console.warn('[sales] hero cleanup failed on prospect delete:', r.reason)
      }
    }

    // A5 Task 19: a row disappeared from the /sales dashboard list. Emit AFTER
    // the delete resolved (unreached on the 404 above — nothing changed there).
    publishInvalidation(prospectListTopic())
    return NextResponse.json({ ok: true })
  })
  ```

- [ ] Add hero cleanup to the SiteAudit DELETE — in `app/api/site-audit/[id]/route.ts`, import:
  ```ts
  import { deleteHeroScreenshot } from '@/lib/sales/hero-screenshot'
  ```
  and change the reportCleanup block (lines 187–189) from:
  ```ts
  const reportCleanup = await Promise.allSettled([
    deleteReportFile(id),
  ])
  ```
  to:
  ```ts
  const reportCleanup = await Promise.allSettled([
    deleteReportFile(id),
    deleteHeroScreenshot(id), // C14 hero (spec Codex fix 3a): audit row gone ⇒ hero file gone
  ])
  ```

- [ ] Add the retention hook — in `lib/ada-audit/scheduled-retention.ts`, import:
  ```ts
  import { deleteHeroScreenshot } from '@/lib/sales/hero-screenshot'
  ```
  and change the chunk-loop file cleanup (lines 76–80) from:
  ```ts
  const fileCleanup = await Promise.allSettled(ids.map((rid) => deleteReportFile(rid)))
  ```
  to:
  ```ts
  // C14 hero (spec Codex fix 3c): prospect audits are manual-class and never
  // pruned here, but the artifact hook keeps "audit row gone ⇒ hero file gone"
  // true everywhere.
  const fileCleanup = await Promise.allSettled(
    ids.flatMap((rid) => [deleteReportFile(rid), deleteHeroScreenshot(rid)]),
  )
  ```

- [ ] Run:
  ```bash
  npx vitest run app/api/sales/prospects/routes.test.ts lib/ada-audit/scheduled-retention.test.ts
  ```
  Expect PASS (if `scheduled-retention.test.ts` doesn't exist, run the prospects file alone).

- [ ] Commit:
  ```bash
  git add app/api/site-audit/[id]/route.ts app/api/sales/prospects/[id]/route.ts lib/ada-audit/scheduled-retention.ts app/api/sales/prospects/routes.test.ts
  git commit -m "feat(sales): hero file deletion at all three seams (audit DELETE, prospect DELETE snapshot, retention sweep)"
  ```

---

## Task 5: Public hero route + middleware matcher

**Files:**
- Create: `app/api/sales/[token]/hero/[siteAuditId]/route.ts`
- Create: `app/api/sales/[token]/hero/hero-route.test.ts`
- Modify: `middleware.ts` (add one matcher after line 69)
- Modify: `middleware.test.ts` (extend the C14 describe, lines 85–93)

**Steps:**

- [ ] Extend `middleware.test.ts` — inside `describe('isPublicPath — C14 sales public matchers', …)` add to the existing `it`:
  ```ts
  // C14 hero route: public, anchored, single-segment only
  expect(isPublicPath('/api/sales/tok/hero/aud1')).toBe(true);
  // deeper paths + the bare prefix stay gated (negative anchoring proof)
  expect(isPublicPath('/api/sales/tok/hero/aud1/extra')).toBe(false);
  expect(isPublicPath('/api/sales/tok/hero')).toBe(false);
  ```

- [ ] `npx vitest run middleware.test.ts` — expect FAIL (`/api/sales/tok/hero/aud1` currently `false`).

- [ ] Modify `middleware.ts` — after line 69:
  ```ts
  if (/^\/api\/sales\/[^/]+\/screenshot\/[^/]+\/[^/]+$/.test(pathname)) return true
  ```
  add:
  ```ts
  if (/^\/api\/sales\/[^/]+\/hero\/[^/]+$/.test(pathname)) return true
  ```
  (keep the existing NEVER-a-prefix comment above the block; it covers this matcher too).

- [ ] `npx vitest run middleware.test.ts` — expect PASS.

- [ ] Write the failing route test `app/api/sales/[token]/hero/hero-route.test.ts` (mirrors `screenshot-route.test.ts`):
  ```ts
  // app/api/sales/[token]/hero/hero-route.test.ts
  // DB-backed + temp hero file on disk. Failure contract (spec Codex fix 7):
  // every auth/lookup failure is an indistinguishable 404.
  import fs from 'fs/promises'
  import os from 'os'
  import path from 'path'
  import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
  import { NextRequest } from 'next/server'
  import { prisma } from '@/lib/db'

  const PREFIX = 'c14-hero-rt-'
  let heroDir: string
  const prevEnv = process.env.HERO_SCREENSHOTS_DIR
  let token: string
  let auditId: string
  let strangerAuditId: string
  let nullColumnAuditId: string
  let GET: (req: NextRequest, ctx: { params: Promise<{ token: string; siteAuditId: string }> }) => Promise<Response>

  async function cleanup() {
    const prospects = await prisma.prospect.findMany({ where: { domain: { startsWith: PREFIX } }, select: { id: true } })
    await prisma.siteAudit.deleteMany({ where: { domain: { startsWith: PREFIX } } })
    await prisma.prospect.deleteMany({ where: { id: { in: prospects.map((p) => p.id) } } })
  }

  beforeAll(async () => {
    heroDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-rt-'))
    process.env.HERO_SCREENSHOTS_DIR = heroDir
    ;({ GET } = await import('./[siteAuditId]/route'))
    await cleanup()
    token = crypto.randomUUID()
    const prospect = await prisma.prospect.create({
      data: { name: 'Hero', domain: `${PREFIX}x.test`, salesToken: token, salesTokenExpiresAt: new Date(Date.now() + 86_400_000) },
    })
    const audit = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}x.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id },
    })
    auditId = audit.id
    await prisma.siteAudit.update({ where: { id: auditId }, data: { homepageScreenshot: `${auditId}.png` } })
    await fs.writeFile(path.join(heroDir, `${auditId}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const stranger = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}other.test`, wcagLevel: 'wcag21aa', status: 'complete', homepageScreenshot: 'x.png' },
    })
    strangerAuditId = stranger.id
    const nullCol = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}x.test`, wcagLevel: 'wcag21aa', status: 'complete', prospectId: prospect.id },
    })
    nullColumnAuditId = nullCol.id
  })
  afterAll(async () => {
    if (prevEnv === undefined) delete process.env.HERO_SCREENSHOTS_DIR
    else process.env.HERO_SCREENSHOTS_DIR = prevEnv
    await fs.rm(heroDir, { recursive: true, force: true })
    await cleanup()
  })

  const call = (tok: string, aid: string) =>
    GET(new NextRequest(`http://localhost:3000/api/sales/${tok}/hero/${aid}`), {
      params: Promise.resolve({ token: tok, siteAuditId: aid }),
    })

  describe('GET /api/sales/[token]/hero/[siteAuditId]', () => {
    it('streams the hero PNG for an owned audit with a stamped column', async () => {
      const res = await call(token, auditId)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/png')
      expect(res.headers.get('cache-control')).toBe('private, max-age=3600')
    })
    it('404 — invalid token', async () => {
      expect((await call('bad-token', auditId)).status).toBe(404)
    })
    it("404 — another prospect's / unowned audit", async () => {
      expect((await call(token, strangerAuditId)).status).toBe(404)
    })
    it('404 — malformed audit id', async () => {
      expect((await call(token, '../etc')).status).toBe(404)
    })
    it('404 — owned audit but null homepageScreenshot column', async () => {
      expect((await call(token, nullColumnAuditId)).status).toBe(404)
    })
    it('404 — stamped column but file missing on disk (ENOENT)', async () => {
      await fs.unlink(path.join(heroDir, `${auditId}.png`))
      expect((await call(token, auditId)).status).toBe(404)
      await fs.writeFile(path.join(heroDir, `${auditId}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    })
    it('500 — a non-ENOENT fs failure (EACCES) surfaces via withRoute, not as a 404 oracle (plan Codex fix 4)', async () => {
      const spy = vi
        .spyOn(fs, 'readFile')
        .mockRejectedValueOnce(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))
      try {
        const res = await call(token, auditId)
        expect(res.status).toBe(500)
        expect((await res.json()).error).toBe('internal_error') // withRoute envelope, no message leak
      } finally {
        spy.mockRestore()
      }
    })
  })
  ```
  (If `vi.spyOn` on the `fs/promises` namespace is rejected in this vitest config, switch the test file to `vi.mock('fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof import('fs/promises')>()) }))` at the top — that makes the namespace spy-able without changing behavior.)

- [ ] `npx vitest run "app/api/sales/[token]/hero/hero-route.test.ts"` — expect FAIL (route module missing).

- [ ] Create `app/api/sales/[token]/hero/[siteAuditId]/route.ts`:
  ```ts
  // C14 hero: token-validated homepage-screenshot streaming. Authorization =
  // token → prospect, then the PINNED siteAuditId must belong to that prospect
  // AND carry a stamped homepageScreenshot (stamped only after a successful
  // file write). Failure contract (spec Codex fix 7 + plan Codex fix 4): the
  // authorization/lookup failures — bad token, wrong prospect's audit,
  // malformed id, null column — AND a missing file (ENOENT) return an
  // indistinguishable 404. Any OTHER fs failure (EACCES, EIO, …) rethrows into
  // withRoute as a 500 — that's operational breakage that must stay visible,
  // and a 500 is not an authorization oracle.
  import fs from 'fs/promises'
  import { NextRequest, NextResponse } from 'next/server'
  import { withRoute } from '@/lib/api/with-route'
  import { prisma } from '@/lib/db'
  import { heroScreenshotPath } from '@/lib/sales/hero-screenshot'
  import { validateSalesToken } from '@/lib/sales/sales-report-data'

  const AUDIT_ID_RE = /^[a-z0-9]+$/i

  export const GET = withRoute(
    async (_request: NextRequest, { params }: { params: Promise<{ token: string; siteAuditId: string }> }) => {
      const { token, siteAuditId } = await params
      const notFoundRes = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

      if (!AUDIT_ID_RE.test(siteAuditId)) return notFoundRes()
      const prospect = await validateSalesToken(token)
      if (!prospect) return notFoundRes()

      const audit = await prisma.siteAudit.findUnique({
        where: { id: siteAuditId },
        select: { prospectId: true, homepageScreenshot: true },
      })
      if (!audit || audit.prospectId !== prospect.id || !audit.homepageScreenshot) return notFoundRes()

      let buffer: Buffer
      try {
        buffer = await fs.readFile(heroScreenshotPath(siteAuditId))
      } catch (err) {
        // Only a genuinely-absent file joins the indistinguishable-404 set.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return notFoundRes()
        throw err // withRoute → 500 internal_error (operational visibility)
      }
      return new Response(new Uint8Array(buffer), {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' },
      })
    },
  )
  ```

- [ ] `npx vitest run "app/api/sales/[token]/hero/hero-route.test.ts" middleware.test.ts` — expect ALL PASS.

- [ ] Commit:
  ```bash
  git add "app/api/sales/[token]/hero" middleware.ts middleware.test.ts
  git commit -m "feat(sales): public hero screenshot route (indistinguishable 404s) + anchored middleware matcher"
  ```

---

## Task 6: Loader changes (`sales-report-data.ts` + `cwv-aggregate.ts`)

**Files:**
- Modify: `lib/sales/cwv-aggregate.ts` (worstPages cap line 15 comment + line 52 slice; new `HomepageCwv` + `pickHomepageCwv`)
- Modify: `lib/sales/cwv-aggregate.test.ts` (cap-5 expectation + pickHomepageCwv tests)
- Modify: `lib/sales/sales-report-data.ts` (interfaces lines 16–66; audit select lines 133–146; patterns loop lines 167–175 removed; issueGroups lines 177–191; children query lines 202–209; return lines 220–254)
- Modify: `lib/sales/sales-report-data.test.ts`
- Modify: `components/sales/sections.tsx` (ONE-line transition compat in `PerformanceSalesSection` — plan Codex fix 5: every commit stays tsc-green)
- Modify: `components/sales/SalesReportView.test.tsx` (fixture updated to the transitional payload shape so the OLD view's suite keeps passing until the final swap)

**Transition rule (plan Codex fix 5 — no knowingly-red `tsc` across tasks):** this task adds the new fields ALONGSIDE the old contract. `patterns` STAYS in the payload (typed `SalesPattern[]`, `/** @deprecated */`, loader returns `[]`); `SalesPattern` and `ExampleCard.tsx` are NOT deleted here. The only breaking shape change (`performance` → `{ rollup, homepage }`) is absorbed by a one-line compat edit inside the old `PerformanceSalesSection`. The final swap task (Task 12) removes the deprecated field, deletes `ExampleCard`, and rewrites the view tests.

**Interfaces (the new payload contract — the view tasks build against this):**
```ts
export interface SeoIssueGroup {
  type: string
  label: string
  count: number            // issue-specific unit (targets / groups / pages) — label copy only, NEVER the bar
  affectedPages: number    // distinct page-scope finding URLs — drives UrgencyBar (spec Codex fix 4)
  affectedComplete: boolean // false ⇒ render "at least N pages"
  examplePages: string[]
}
export interface HomepageCwv {
  performance: number; lcpMs: number; cls: number; tbtMs: number
  lcpStatus: CwvStatus; clsStatus: CwvStatus; tbtStatus: CwvStatus
}
export interface SalesReportData {
  prospect: { id: number; name: string; domain: string }
  auditId: string
  completedAt: string | null
  pagesTotal: number | null
  preparedBy: string | null
  archived: boolean
  overallScore: number | null          // rounded avg of available headline values
  heroScreenshot: boolean              // view builds /api/sales/[token]/hero/[auditId]
  standardTested: string               // "WCAG 2.1 AA" | "WCAG 2.2 AA + best practices"
  headline: { accessibilityScore: number | null; seoScore: number | null; performanceScore: number | null; schemaCoveragePct: number | null }
  accessibility: {
    score: number | null
    counts: { critical: number; serious: number; moderate: number; minor: number; total: number }
    /** @deprecated transition-only (plan Codex fix 5): loader returns []; the old view still type-checks. REMOVED in Task 12. */
    patterns: SalesPattern[]
  }
  seo: { score: number | null; issueGroups: SeoIssueGroup[]; duplicateContentGroups: number | null; sitemapMissRatePct: number | null }
  performance: { rollup: PerformanceRollup | null; homepage: HomepageCwv | null } // homepage independent of the rollup's <3-pages null
  geo: { … unchanged … }
}
```

**Steps:**

- [ ] Write failing cwv tests — in `lib/sales/cwv-aggregate.test.ts`, update the worst-pages expectation and add a describe. Change the existing `expect(out.worstPages).toEqual([...3 entries...])` test to seed 7 rows and assert 5 (spec: cap 5):
  ```ts
  it('caps worstPages at 5 (sales view is the only consumer)', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      url: `https://x.test/${i}`, summary: summary(10 + i, 2000, false),
    }))
    const out = aggregatePerformance(rows)!
    expect(out.worstPages).toHaveLength(5)
    expect(out.worstPages[0].performance).toBe(10)
  })

  describe('pickHomepageCwv', () => {
    const row = (url: string, id: string, perf = 50) => ({ url, id, summary: summary(perf, 2000, true) })
    it('prefers the exact canonical root over other variants', () => {
      const out = pickHomepageCwv([
        row('https://www.x.test/', 'b'),
        row('https://x.test/', 'a', 33),
        row('https://x.test/about', 'c'),
      ], 'x.test')
      expect(out?.performance).toBe(33)
    })
    it('falls back deterministically by (url, id) among non-canonical root variants', () => {
      const out1 = pickHomepageCwv([row('https://www.x.test/', 'b', 70), row('http://x.test/', 'a', 60)], 'x.test')
      const out2 = pickHomepageCwv([row('http://x.test/', 'a', 60), row('https://www.x.test/', 'b', 70)], 'x.test')
      expect(out1?.performance).toBe(60) // 'http://x.test/' sorts before 'https://www.x.test/'
      expect(out2?.performance).toBe(60) // input order irrelevant
    })
    it('null when no root variant was measured', () => {
      expect(pickHomepageCwv([row('https://x.test/about', 'a')], 'x.test')).toBeNull()
    })
    it('is independent of aggregatePerformance (works with a single row)', () => {
      expect(pickHomepageCwv([row('https://x.test/', 'a', 44)], 'x.test')?.performance).toBe(44)
    })
  })
  ```
  (add `pickHomepageCwv` to the import).

- [ ] `npx vitest run lib/sales/cwv-aggregate.test.ts` — expect FAIL.

- [ ] Modify `lib/sales/cwv-aggregate.ts`:
  1. Line 15 comment + line 52: `worstPages: { url: string; performance: number }[] // up to 5, ascending score` and `.slice(0, 5)`.
  2. Append:
     ```ts
     import { isRootUrl, canonicalRootUrl } from '@/lib/sales/root-url'
     import type { CwvStatus } from '@/lib/ada-audit/lighthouse-types'

     export interface HomepageCwv {
       performance: number
       lcpMs: number
       cls: number
       tbtMs: number
       lcpStatus: CwvStatus
       clsStatus: CwvStatus
       tbtStatus: CwvStatus
     }

     /**
      * C14 redesign: the homepage's own Lighthouse numbers, resolved from the
      * raw child rows INDEPENDENT of aggregatePerformance (which nulls under 3
      * measured pages — the homepage card must not vanish with it). Deterministic
      * selection (spec Codex fix 6): among root-URL variants prefer the exact
      * canonical root `https://<domain>/`, then fall back by stable (url, id)
      * ordering.
      */
     export function pickHomepageCwv(
       rows: { url: string; id: string; summary: LighthouseSummary }[],
       domain: string,
     ): HomepageCwv | null {
       const roots = rows.filter((r) => isRootUrl(r.url, domain))
       if (roots.length === 0) return null
       const canonical = canonicalRootUrl(domain)
       const chosen =
         roots.find((r) => r.url === canonical) ??
         [...roots].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : a.id < b.id ? -1 : 1))[0]
       const { scores, cwv } = chosen.summary
       return {
         performance: scores.performance,
         lcpMs: cwv.lcp,
         cls: cwv.cls,
         tbtMs: cwv.tbt,
         lcpStatus: cwv.lcpStatus,
         clsStatus: cwv.clsStatus,
         tbtStatus: cwv.tbtStatus,
       }
     }
     ```
  (imports go at the top of the file with the existing type import.)

- [ ] `npx vitest run lib/sales/cwv-aggregate.test.ts` — expect PASS.

- [ ] Write failing loader tests — update `lib/sales/sales-report-data.test.ts`. In `seedReady()`: give the LH children real root/non-root URLs and stamp the hero column + wcagLevel:
  ```ts
  // replace the child-creation loop with:
  const childUrls = [`https://${domain}/`, `https://${domain}/a`, `https://${domain}/b`]
  for (const url of childUrls) {
    await prisma.adaAudit.create({
      data: { url, status: 'complete', siteAuditId: audit.id, lighthouseSummary: url.endsWith('/') ? lhHome : lhSummary },
    })
  }
  await prisma.siteAudit.update({ where: { id: audit.id }, data: { homepageScreenshot: `${audit.id}.png` } })
  ```
  with a distinct homepage summary above the helpers:
  ```ts
  const lhHome = JSON.stringify({
    scores: { performance: 55, accessibility: 90, bestPractices: 90 },
    cwv: { lcp: 3100, cls: 0.12, tbt: 350, lcpStatus: 'needs-improvement', clsStatus: 'needs-improvement', tbtStatus: 'needs-improvement' },
    topFailures: [],
  })
  ```
  and a second page-scope broken-link finding in the seo run's `findings.create` (so `affectedPages` is exercised):
  ```ts
  { scope: 'page', type: 'broken_internal_links', severity: 'critical', count: 2, url: `https://${domain}/1`, dedupKey: `${PREFIX}f4`, affectedComplete: true },
  ```
  and add `affectedComplete: true` to the existing run-scope broken finding. Then replace the assertions block of `'assembles the full report…'` with:
  ```ts
  const d = out.data
  expect(d.auditId).toBe(audit.id)
  expect(d.preparedBy).toBe('Kevin')
  expect(d.standardTested).toBe('WCAG 2.1 AA')
  expect(d.heroScreenshot).toBe(true)
  expect(d.headline).toEqual({ accessibilityScore: 62, seoScore: 71, performanceScore: 40, schemaCoveragePct: 40 })
  // overall = round((62 + 71 + 40 + 40) / 4) = 53
  expect(d.overallScore).toBe(53)
  expect(d.accessibility.counts.critical).toBe(4)
  expect(d.accessibility.patterns).toEqual([]) // deprecated transition field — always empty; removed in Task 12
  const broken = d.seo.issueGroups.find((g) => g.type === 'broken_internal_links')
  expect(broken?.count).toBe(7)               // issue-specific unit (distinct targets)
  expect(broken?.affectedPages).toBe(2)       // distinct page-scope URLs
  expect(broken?.affectedComplete).toBe(true)
  expect(d.performance.rollup?.measuredPages).toBe(3)
  // homepage CWV resolved from the root child, independent of the rollup
  expect(d.performance.homepage).toEqual({
    performance: 55, lcpMs: 3100, cls: 0.12, tbtMs: 350,
    lcpStatus: 'needs-improvement', clsStatus: 'needs-improvement', tbtStatus: 'needs-improvement',
  })
  expect(d.geo.missingHighValueTypes).toContain('Course')
  ```
  Add two focused tests:
  ```ts
  it('overallScore averages only available metrics; null when none exist', async () => {
    const p = await prisma.prospect.create({
      data: { name: 'Avg U', domain: `${PREFIX}avg.test`, salesToken: crypto.randomUUID(), salesTokenExpiresAt: future() },
    })
    const audit = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}avg.test`, wcagLevel: 'wcag22aa', status: 'complete', completedAt: new Date(), prospectId: p.id },
    })
    // seo run only, no schema json, no ada run, no LH children → seoScore is the only metric
    await prisma.crawlRun.create({
      data: {
        id: `${PREFIX}avg-seo`, tool: 'seo-parser', source: 'live-scan', domain: `${PREFIX}avg.test`,
        siteAuditId: audit.id, status: 'complete', score: 80, pagesTotal: 1, startedAt: new Date(), completedAt: new Date(),
      },
    })
    const out = await loadSalesReportData(p.salesToken!)
    expect(out.kind).toBe('ready')
    if (out.kind !== 'ready') return
    expect(out.data.overallScore).toBe(80)              // 80/1, nulls excluded from the denominator
    expect(out.data.standardTested).toBe('WCAG 2.2 AA + best practices')
    expect(out.data.heroScreenshot).toBe(false)          // column null → slot hidden
    expect(out.data.performance.rollup).toBeNull()
    expect(out.data.performance.homepage).toBeNull()
  })

  it('affectedComplete=false surfaces from a capped run-scope finding', async () => {
    const p = await prisma.prospect.create({
      data: { name: 'Cap U', domain: `${PREFIX}cap.test`, salesToken: crypto.randomUUID(), salesTokenExpiresAt: future() },
    })
    const audit = await prisma.siteAudit.create({
      data: { domain: `${PREFIX}cap.test`, wcagLevel: 'wcag21aa', status: 'complete', completedAt: new Date(), prospectId: p.id },
    })
    await prisma.crawlRun.create({
      data: {
        id: `${PREFIX}cap-seo`, tool: 'seo-parser', source: 'live-scan', domain: `${PREFIX}cap.test`,
        siteAuditId: audit.id, status: 'complete', score: 50, pagesTotal: 3, startedAt: new Date(), completedAt: new Date(),
        findings: {
          create: [
            { scope: 'run', type: 'thin_content', severity: 'warning', count: 9, dedupKey: `${PREFIX}c1`, affectedComplete: false },
            { scope: 'page', type: 'thin_content', severity: 'warning', count: 1, url: `https://${PREFIX}cap.test/a`, dedupKey: `${PREFIX}c2` },
          ],
        },
      },
    })
    const out = await loadSalesReportData(p.salesToken!)
    if (out.kind !== 'ready') throw new Error('expected ready')
    const g = out.data.seo.issueGroups.find((x) => x.type === 'thin_content')
    expect(g?.affectedPages).toBe(1)
    expect(g?.affectedComplete).toBe(false)
  })
  ```
  (Extend `cleanup()`'s prospect/audit sweep to cover the new domains — the `PREFIX` startsWith already does.)

- [ ] `npx vitest run lib/sales/sales-report-data.test.ts` — expect FAIL (new fields missing).

- [ ] Modify `lib/sales/sales-report-data.ts`:
  1. **Imports** — replace lines 7–9:
     ```ts
     import { aggregatePerformance, pickHomepageCwv, type HomepageCwv, type PerformanceRollup } from './cwv-aggregate'
     import { loadRepresentativeExamples } from './representative-examples'
     import { HIGH_VALUE_SCHEMA_TYPES, ISSUE_LABELS, standardLabel } from './copy'
     ```
     (`standardLabel` is implemented in THIS task — step 11 below adds it to `copy.ts` so this commit compiles standalone; Task 7 adds the remaining copy constants.)
  2. **Keep** the `SalesPattern` interface (lines 16–24) and its `CuratedExample` import — mark the interface `/** @deprecated transition-only; removed in Task 12 */`. Keep `MAX_PATTERNS`, `IMPACT_RANK`, `topPatternIssues`, and `loadRepresentativeExamples` — `curatedScreenshotSet` (lines 93–109) still uses all of them permanently (the screenshot route + allowlist stay, spec non-goal). Keep `MAX_EXAMPLE_PAGES` for `examplePages`.
  3. **`SeoIssueGroup`** (lines 26–31) — add:
     ```ts
     affectedPages: number
     affectedComplete: boolean
     ```
  4. **`SalesReportData`** (lines 33–66) — apply the interface shown above (add `overallScore`, `heroScreenshot`, `standardTested`; keep `patterns` on `accessibility` with the `@deprecated` marker; change `performance` to `{ rollup: PerformanceRollup | null; homepage: HomepageCwv | null }`).
  5. **Audit select** (lines 133–146) — add `domain: true, homepageScreenshot: true` to the top-level select and `affectedComplete: true` to the findings select.
  6. **Delete the patterns loop** (lines 167–175, `const topIssues…` through the closing brace) — `topPatternIssues` stays (used by `curatedScreenshotSet`); the `topIssues`/`patterns` locals go. The payload's deprecated `patterns` field is a literal `[]` from here on (no `loadRepresentativeExamples` calls remain in the loader).
  7. **issueGroups loop** (lines 177–191) — replace the push with:
     ```ts
     const pageRows = seoRun.findings.filter((f) => f.scope === 'page' && f.type === type && f.url)
     issueGroups.push({
       type,
       label: ISSUE_LABELS[type],
       count: runFinding.count,
       // Spec Codex fix 4: count semantics are heterogeneous (targets/groups) —
       // only affectedPages (distinct page-scope URLs) may drive an urgency bar.
       affectedPages: new Set(pageRows.map((f) => f.url as string)).size,
       affectedComplete: runFinding.affectedComplete !== false, // null (unset) treated complete; live-scan mappers always set it
       examplePages: pageRows.slice(0, MAX_EXAMPLE_PAGES).map((f) => f.url as string),
     })
     ```
  8. **Children query** (lines 202–205) — add `id: true` to the select; carry it through `lhRows`:
     ```ts
     const lhRows = children
       .map((c) => ({ url: c.url, id: c.id, summary: parseJson<LighthouseSummary>(c.lighthouseSummary) }))
       .filter((r): r is { url: string; id: string; summary: LighthouseSummary } => r.summary !== null)
     const rollup = aggregatePerformance(lhRows)
     const homepage = pickHomepageCwv(lhRows, audit.domain)
     ```
  9. **Overall score** — after `coveragePct` is computed:
     ```ts
     // Kevin decision: simple average of the available headline scores; null
     // metrics excluded from the denominator (never counted as zero).
     const headlineValues = [
       adaRun?.score ?? null,
       seoRun.score,
       rollup?.medianPerformance ?? null,
       coveragePct,
     ].filter((v): v is number => v !== null)
     const overallScore = headlineValues.length
       ? Math.round(headlineValues.reduce((a, b) => a + b, 0) / headlineValues.length)
       : null
     ```
  10. **Return object** (lines 220–254) — updated data block:
      ```ts
      data: {
        prospect: { id: prospect.id, name: prospect.name, domain: prospect.domain },
        auditId: audit.id,
        completedAt: audit.completedAt?.toISOString() ?? null,
        pagesTotal: audit.pagesTotal,
        preparedBy: prospect.createdBy,
        archived,
        overallScore,
        heroScreenshot: audit.homepageScreenshot !== null,
        standardTested: standardLabel(audit.wcagLevel),
        headline: {
          accessibilityScore: adaRun?.score ?? null,
          seoScore: seoRun.score,
          performanceScore: rollup?.medianPerformance ?? null,
          schemaCoveragePct: coveragePct,
        },
        accessibility: { score: adaRun?.score ?? null, counts, patterns: [] }, // deprecated field, transition-only
        seo: { …unchanged… },
        performance: { rollup, homepage },
        geo: { …unchanged… },
      }
      ```
  11. In `copy.ts`, add the helper this task needs (Task 7 adds the rest):
      ```ts
      /** Human label for the wcagLevel a site audit ran against. */
      export function standardLabel(wcagLevel: string): string {
        return wcagLevel === 'wcag22aa' ? 'WCAG 2.2 AA + best practices' : 'WCAG 2.1 AA'
      }
      ```

- [ ] Transition compat in the OLD view (plan Codex fix 5 — keeps this commit tsc-green):
  1. `components/sales/sections.tsx`, `PerformanceSalesSection` (currently line 89 `export function PerformanceSalesSection(props: { data: SalesReportData['performance'] })` followed by line 90 `const d = props.data`): change ONLY the body's first line to
     ```tsx
     const d = props.data.rollup
     ```
     The prop type stays `SalesReportData['performance']`, so the section tracks the new `{ rollup, homepage }` shape; every other reference in the function already reads off `d`. (`AccessibilitySalesSection` keeps compiling because the deprecated `patterns` field still exists; `SeoSalesSection` ignores the two new `SeoIssueGroup` members.)
  2. `components/sales/SalesReportView.test.tsx` — update the fixture to the transitional payload so the OLD view suite keeps passing: add `overallScore: 53, heroScreenshot: true, standardTested: 'WCAG 2.1 AA'` after `archived: false`; add `affectedPages: 4, affectedComplete: true` to the `broken_internal_links` issue group; wrap the performance object as `performance: { rollup: { …existing object… }, homepage: null }`; and change the second test's override to `performance: { rollup: null, homepage: null }`. Assertions stay untouched (the old view still renders patterns from the fixture).

- [ ] Run the gates — GREEN at this commit (plan Codex fix 5):
  ```bash
  npx tsc --noEmit
  npx vitest run lib/sales/sales-report-data.test.ts lib/sales/cwv-aggregate.test.ts components/sales/SalesReportView.test.tsx
  ```
  Expected: tsc clean; all three suites PASS.

- [ ] Commit:
  ```bash
  git add lib/sales/cwv-aggregate.ts lib/sales/cwv-aggregate.test.ts lib/sales/sales-report-data.ts lib/sales/sales-report-data.test.ts lib/sales/copy.ts components/sales/sections.tsx components/sales/SalesReportView.test.tsx
  git commit -m "feat(sales): loader v2 — overallScore, heroScreenshot, standardTested, homepage CWV, affectedPages, worstPages 5 (patterns deprecated to []; old view kept compiling)"
  ```

---

## Task 7: Copy additions (`lib/sales/copy.ts`)

**Files:**
- Modify: `lib/sales/copy.ts` (append; `standardLabel` already added in Task 6)
- Create: `lib/sales/copy.test.ts`

**Steps:**

- [ ] Write the failing test `lib/sales/copy.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest'
  import {
    ER_ADA_CTA, HIGH_VALUE_SCHEMA_TYPES, ISSUE_LABELS, ISSUE_WHY,
    SCHEMA_IMPLICATIONS, SCORE_METHOD, standardLabel, WCAG_MEANING,
  } from './copy'

  describe('sales copy', () => {
    it('every labelled issue type has a "why this hurts you" line', () => {
      expect(Object.keys(ISSUE_WHY).sort()).toEqual(Object.keys(ISSUE_LABELS).sort())
    })
    it('every high-value schema type has an implication line', () => {
      expect(Object.keys(SCHEMA_IMPLICATIONS).sort()).toEqual([...HIGH_VALUE_SCHEMA_TYPES].sort())
    })
    it('score methodology copy exists for all five areas', () => {
      expect(Object.keys(SCORE_METHOD).sort()).toEqual(['accessibility', 'geo', 'overall', 'performance', 'seo'])
    })
    it('honesty rules: no prospect-site compliance claims anywhere', () => {
      const all = [
        ...Object.values(ISSUE_WHY), ...Object.values(SCHEMA_IMPLICATIONS),
        ...Object.values(SCORE_METHOD).flatMap((m) => [m.summary, m.note]),
        WCAG_MEANING,
      ].join(' ')
      expect(all).not.toMatch(/wcag compliant/i)
      expect(all).not.toMatch(/core web vitals pass/i)
      // schema copy never claims markup is REQUIRED for AI quotation (Codex fix 5)
      expect(Object.values(SCHEMA_IMPLICATIONS).join(' ')).not.toMatch(/required|invisible|can't recommend|cannot recommend/i)
    })
    it('the sanctioned exception: ER_ADA_CTA claims ADA compliance about ER product sites only', () => {
      expect(ER_ADA_CTA).toMatch(/Enrollment Resources builds/i)
      expect(ER_ADA_CTA).toMatch(/ADA-compliant/)
    })
    it('standardLabel maps both levels', () => {
      expect(standardLabel('wcag21aa')).toBe('WCAG 2.1 AA')
      expect(standardLabel('wcag22aa')).toBe('WCAG 2.2 AA + best practices')
    })
  })
  ```

- [ ] `npx vitest run lib/sales/copy.test.ts` — expect FAIL (exports missing).

- [ ] Append to `lib/sales/copy.ts` (and extend the header comment):
  ```ts
  // ── C14 redesign additions ───────────────────────────────────────────────
  // Honesty rules (extended): compliance claims about the PROSPECT'S site stay
  // banned ("WCAG compliant", "Core Web Vitals pass"). The ONE sanctioned
  // exception is ER_ADA_CTA below — an ADA-compliance claim about Enrollment
  // Resources' OWN product sites (Kevin-approved marketing copy, spec §Non-goals).
  // Structured-data copy is evidence-bounded (Codex fix 5): absence = "not
  // observed on the pages we scanned", implications describe reduced
  // machine-readability — never that markup is *required* for AI quotation.

  /** One line per SEO issue group: why this hurts you. Keys = ISSUE_LABELS keys. */
  export const ISSUE_WHY: Record<string, string> = {
    broken_internal_links:
      'Dead ends for both students and search crawlers — trust and link equity leak away every time someone hits one.',
    broken_images:
      'Broken images make pages look abandoned to visitors, and the content they carried is invisible to search engines.',
    broken_external_links:
      'Outbound links that hit error pages erode credibility and send prospective students somewhere that no longer exists.',
    missing_title:
      'The page title is the headline Google shows. Pages without one get a generic, unclickable search listing.',
    duplicate_title:
      'Pages sharing one title compete with each other in search — Google struggles to rank any of them for the query they should own.',
    missing_meta_description:
      'Without a description, search engines improvise the snippet under your listing — you lose control of your own pitch.',
    duplicate_meta_description:
      'Repeated descriptions make every search result read the same, cutting click-through on all of them.',
    missing_h1:
      'The main heading tells readers and search engines what a page is about — pages without one read as unstructured.',
    duplicate_h1:
      'Identical main headings blur which page answers which search, so ranking signals get split between them.',
    thin_content:
      'Pages this light rarely rank: there is too little text for search engines to know what the page is for.',
  }

  /**
   * One line per high-value schema type: what its ABSENCE means. Evidence-
   * bounded — reduced machine-readability, never "required for AI".
   */
  export const SCHEMA_IMPLICATIONS: Record<string, string> = {
    Organization:
      'Search and AI tools must infer basics like your name, logo, and contact details instead of reading them directly.',
    Course:
      'Your programs read as plain text to machines — course-rich search features have nothing structured to build from.',
    FAQPage:
      'Search and AI tools have to guess at your answers instead of reading them directly.',
    BreadcrumbList:
      'Search engines have to infer how your site is organized, and results may show raw URLs instead of a clean page trail.',
  }

  /** Plain-English "How this score is calculated" copy, one per section + overall. */
  export const SCORE_METHOD: Record<
    'overall' | 'accessibility' | 'seo' | 'performance' | 'geo',
    { summary: string; note: string }
  > = {
    overall: {
      summary:
        'A simple average of the four area scores below — accessibility, SEO, performance, and structured-data coverage. Areas we could not measure are left out of the average rather than counted as zero.',
      note: 'This is our summary yardstick for this scan, not an official rating or certification of any kind.',
    },
    accessibility: {
      summary:
        'Based on an automated axe-core scan of every page we audited, weighted by how severe each barrier is and how dense the barriers are relative to page size. A high score means the automated scan found few barriers.',
      note: 'Automated scanning finds many but not all accessibility issues — a strong score here does not certify legal compliance.',
    },
    seo: {
      summary:
        'Weighted technical factors measured on the pages we scanned: whether pages are indexable, page errors, missing titles, descriptions and headings, thin content, and structured data. If we observed too few pages to be fair, we do not score at all.',
      note: 'Measured from your live pages during this scan — a snapshot, not a rank tracker.',
    },
    performance: {
      summary:
        'The median Google Lighthouse performance score across the pages we measured, plus 75th-percentile timings for paint, layout shift, and blocking time.',
      note: 'Lighthouse-measured lab data from a controlled environment — real-visitor timings can differ.',
    },
    geo: {
      summary:
        'The share of scanned pages carrying any structured data (Schema.org markup), plus whether four high-value types appear at least once anywhere on the site.',
      note: 'Based only on the pages we scanned — coverage may be partial on larger sites.',
    },
  }

  /** What being tested against WCAG means — accessibility section context line. */
  export const WCAG_MEANING =
    'WCAG (the Web Content Accessibility Guidelines) is the standard courts and regulators reference in ADA website cases. Every issue counted here is an automated finding from your live pages — a barrier some visitors will actually hit.'

  /** The sanctioned exception: an ADA claim about ER's OWN product sites. */
  export const ER_ADA_CTA =
    'Every website Enrollment Resources builds is ADA-compliant as standard — not as an add-on. Barriers like the ones counted above are exactly what we design out from day one. This is fixable, and we do it every day.'
  ```

- [ ] `npx vitest run lib/sales/copy.test.ts` — expect PASS (`6 passed`).

- [ ] Commit:
  ```bash
  git add lib/sales/copy.ts lib/sales/copy.test.ts
  git commit -m "feat(sales): urgency copy — ISSUE_WHY, SCHEMA_IMPLICATIONS, SCORE_METHOD, ER_ADA_CTA, WCAG_MEANING"
  ```

---

## Task 8: Logo asset + `SalesReportHeader`

**Files:**
- Create: `public/er-logo.svg` (or `public/er-logo.png` fallback)
- Create: `components/sales/SalesReportHeader.tsx`
- Create: `components/sales/SalesReportHeader.test.tsx`

**Steps:**

- [ ] Fetch the ER logo. **Known issue (verified at planning time):** `curl https://enrollmentresources.com` returns a Cloudflare challenge. Try in order:
  ```bash
  # 1) direct guesses at common WP asset paths (any 200 with image content wins):
  for u in \
    https://www.enrollmentresources.com/wp-content/uploads/er-logo.svg \
    https://www.enrollmentresources.com/wp-content/themes/enrollmentresources/images/logo.svg ; do
    curl -sfL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" "$u" -o public/er-logo.svg && file public/er-logo.svg && break
  done
  ```
  ```
  # 2) if that fails, use the Playwright MCP browser: navigate to
  #    https://www.enrollmentresources.com (passes the challenge), snapshot the
  #    header, read the logo <img src>, then curl THAT exact URL. If it's a PNG,
  #    save as public/er-logo.png and use that filename in the header component.
  ```
  **MANUAL VERIFY (blocking before merge):** Kevin eyeballs the logo in BOTH light and dark mode on the rendered report. If the mark is dark-on-transparent, the header ships the `dark:brightness-0 dark:invert` treatment below; if that looks wrong, swap in a second asset (`public/er-logo-dark.svg`) and a `<picture>`/dual-`img` treatment.
  ```bash
  git add public/er-logo.svg   # or public/er-logo.png
  ```

- [ ] Write the failing test `components/sales/SalesReportHeader.test.tsx`:
  ```tsx
  // @vitest-environment jsdom
  import { afterEach, describe, expect, it, vi } from 'vitest'
  import { cleanup, fireEvent, render, screen } from '@testing-library/react'
  import { SalesReportHeader } from './SalesReportHeader'

  afterEach(cleanup)

  function stubMatchMedia(reduce: boolean) {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) as never
  }

  describe('SalesReportHeader', () => {
    it('renders logo, title, prepared-for line, and the Book a review CTA', () => {
      stubMatchMedia(false)
      render(<SalesReportHeader prospectName="Acme College" domain="acme.test" preparedBy="Kevin" />)
      expect(screen.getByAltText(/enrollment resources/i)).toBeTruthy()
      expect(screen.getByText('Website Audit Report')).toBeTruthy()
      expect(screen.getByText(/prepared for acme college/i)).toBeTruthy()
      expect(screen.getByText(/by kevin @ enrollment resources/i)).toBeTruthy()
      expect(screen.getByRole('button', { name: /book a review/i })).toBeTruthy()
    })

    it('null preparedBy → just "By Enrollment Resources"', () => {
      stubMatchMedia(false)
      render(<SalesReportHeader prospectName="Acme" domain="acme.test" preparedBy={null} />)
      expect(screen.getByText(/by enrollment resources/i)).toBeTruthy()
      expect(screen.queryByText(/@ enrollment resources/i)).toBeNull()
    })

    it('CTA scrolls to #inquiry, honoring prefers-reduced-motion via matchMedia', () => {
      stubMatchMedia(true)
      const target = document.createElement('div')
      target.id = 'inquiry'
      target.scrollIntoView = vi.fn()
      document.body.appendChild(target)
      render(<SalesReportHeader prospectName="A" domain="a.test" preparedBy={null} />)
      fireEvent.click(screen.getByRole('button', { name: /book a review/i }))
      expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
      target.remove()
    })
  })
  ```

- [ ] `npx vitest run components/sales/SalesReportHeader.test.tsx` — expect FAIL (module missing).

- [ ] Create `components/sales/SalesReportHeader.tsx`:
  ```tsx
  'use client'
  // C14 redesign: sticky branded header. Shrinks smoothly past ~80px of scroll
  // (CSS transitions on a `scrolled` state class; passive listener, removed on
  // unmount). Book a review smooth-scrolls to #inquiry — behavior chosen via
  // matchMedia('(prefers-reduced-motion: reduce)') (spec Codex fix 7, not a
  // CSS-only guess). Print: static + unshrunk (print: variants).
  import { useEffect, useState } from 'react'

  const SCROLL_THRESHOLD_PX = 80

  export function SalesReportHeader(props: {
    prospectName: string
    domain: string
    preparedBy: string | null
  }) {
    const [scrolled, setScrolled] = useState(false)

    useEffect(() => {
      const onScroll = () => setScrolled(window.scrollY > SCROLL_THRESHOLD_PX)
      onScroll()
      window.addEventListener('scroll', onScroll, { passive: true })
      return () => window.removeEventListener('scroll', onScroll)
    }, [])

    const bookReview = () => {
      const target = document.getElementById('inquiry')
      if (!target) return
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    }

    return (
      <header
        className={`sticky top-0 z-40 print:static bg-white/95 dark:bg-navy-card/95 backdrop-blur border-b border-gray-200 dark:border-navy-border transition-all duration-300 ${
          scrolled ? 'py-2' : 'py-4'
        } print:py-4`}
      >
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            {/* If the fetched asset is a PNG, change the src to /er-logo.png.
                dark:brightness-0 dark:invert = the CSS-safe recolor for a
                dark-on-transparent mark; Kevin verifies both modes pre-merge. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/er-logo.svg"
              alt="Enrollment Resources"
              className={`w-auto transition-all duration-300 dark:brightness-0 dark:invert print:h-10 ${
                scrolled ? 'h-7' : 'h-10'
              }`}
            />
            <div className="min-w-0">
              <p
                className={`font-heading font-bold text-navy dark:text-white transition-all duration-300 ${
                  scrolled ? 'text-sm' : 'text-lg'
                } print:text-lg`}
              >
                Website Audit Report
              </p>
              <p className="text-[12px] font-body text-navy/50 dark:text-white/50 truncate">
                Prepared for {props.prospectName} · {props.domain} ·{' '}
                {props.preparedBy ? `By ${props.preparedBy} @ Enrollment Resources` : 'By Enrollment Resources'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={bookReview}
            className="shrink-0 rounded-full bg-blue-700 hover:bg-blue-800 text-white font-heading font-semibold text-[13px] px-4 py-2 print:hidden"
          >
            Book a review
          </button>
        </div>
      </header>
    )
  }
  ```

- [ ] `npx vitest run components/sales/SalesReportHeader.test.tsx` — expect PASS (`3 passed`).

- [ ] Commit:
  ```bash
  git add public/er-logo.* components/sales/SalesReportHeader.tsx components/sales/SalesReportHeader.test.tsx
  git commit -m "feat(sales): sticky shrinking branded header + ER logo asset (Kevin to eyeball light/dark)"
  ```

---

## Task 9: `ScoreGauge` + `UrgencyBar`

**Files:**
- Create: `components/sales/ScoreGauge.tsx`
- Create: `components/sales/ScoreGauge.test.tsx`
- Create: `components/sales/UrgencyBar.tsx`
- Create: `components/sales/UrgencyBar.test.tsx`

**Steps:**

- [ ] Write the failing gauge test `components/sales/ScoreGauge.test.tsx`:
  ```tsx
  // @vitest-environment jsdom
  import { afterEach, describe, expect, it, vi } from 'vitest'
  import { cleanup, render, screen } from '@testing-library/react'
  import { ScoreGauge } from './ScoreGauge'

  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  function stubMatchMedia(reduce: boolean) {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) as never
  }

  describe('ScoreGauge', () => {
    it('reduced motion: renders the final value immediately, no rAF loop', () => {
      stubMatchMedia(true)
      const raf = vi.spyOn(window, 'requestAnimationFrame')
      render(<ScoreGauge score={72} />)
      expect(screen.getByText('72')).toBeTruthy()
      expect(raf).not.toHaveBeenCalled()
    })

    it('clamps out-of-range and non-finite scores', () => {
      stubMatchMedia(true)
      render(<ScoreGauge score={187} />)
      expect(screen.getByText('100')).toBeTruthy()
      cleanup()
      render(<ScoreGauge score={-5} />)
      expect(screen.getByText('0')).toBeTruthy()
      cleanup()
      render(<ScoreGauge score={Number.NaN} />)
      expect(screen.getByText('—')).toBeTruthy()
    })

    it('null score renders the em-dash state with no animation', () => {
      stubMatchMedia(false)
      const raf = vi.spyOn(window, 'requestAnimationFrame')
      render(<ScoreGauge score={null} />)
      expect(screen.getByText('—')).toBeTruthy()
      expect(raf).not.toHaveBeenCalled()
    })

    it('cancels the rAF loop on unmount', () => {
      stubMatchMedia(false)
      let scheduled = 0
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => { scheduled += 1; return scheduled })
      const cancel = vi.spyOn(window, 'cancelAnimationFrame')
      const { unmount } = render(<ScoreGauge score={50} />)
      expect(scheduled).toBeGreaterThan(0) // motion path scheduled a frame
      unmount()
      expect(cancel).toHaveBeenCalled()
    })
  })
  ```

- [ ] `npx vitest run components/sales/ScoreGauge.test.tsx` — expect FAIL (module missing).

- [ ] Create `components/sales/ScoreGauge.tsx` (FULL implementation):
  ```tsx
  'use client'
  // C14 redesign: large SVG arc gauge (~240° sweep) with the "engine rev"
  // timeline on mount — rev 0→100 (ease-in, ~0.9s) → hold (~0.2s) → fall back
  // to the real score with an overshoot/bounce settle (~0.8s). One rAF-driven
  // timeline (no animation library); the readout ticks in sync; the loop is
  // cancelled on unmount and the score input is clamped to finite 0–100 (spec
  // Codex fix 7). prefers-reduced-motion (via matchMedia): final state
  // immediately. Arc color tracks the CURRENT needle value through the house
  // grade thresholds (red < 60, amber 60–89, green ≥ 90 — gradeForScore).
  import { useEffect, useRef, useState } from 'react'

  const SWEEP_DEG = 240
  const START_DEG = 150 // 150° → 390°: opening faces down
  const REV_MS = 900
  const HOLD_MS = 200
  const FALL_MS = 800

  const CX = 120
  const CY = 120
  const R = 96
  const STROKE = 16

  function clampScore(v: number | null): number | null {
    if (v === null || !Number.isFinite(v)) return null
    return Math.min(100, Math.max(0, v))
  }

  // Grade thresholds shared with SectionCard.gradeForScore (kept as literals —
  // this is a client leaf; do not import server modules here).
  function gaugeColor(v: number): string {
    if (v >= 90) return '#16a34a' // green-600
    if (v >= 60) return '#d97706' // amber-600
    return '#dc2626' // red-600
  }

  function easeInCubic(p: number): number {
    return p * p * p
  }
  function easeOutBack(p: number): number {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
  }

  function polar(deg: number, r: number): { x: number; y: number } {
    const rad = (deg * Math.PI) / 180
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
  }

  function arcPath(fromDeg: number, toDeg: number): string {
    const from = polar(fromDeg, R)
    const to = polar(toDeg, R)
    const large = toDeg - fromDeg > 180 ? 1 : 0
    return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
  }

  export function ScoreGauge(props: { score: number | null }) {
    const target = clampScore(props.score)
    // SSR/no-JS/print render the FINAL value (honest static state); the mount
    // effect restarts from 0 only when motion is allowed.
    const [display, setDisplay] = useState<number | null>(target)
    const rafRef = useRef(0)

    useEffect(() => {
      if (target === null) {
        setDisplay(null)
        return
      }
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) {
        setDisplay(target)
        return
      }
      const startedAt = performance.now()
      const tick = (now: number) => {
        const t = now - startedAt
        let v: number
        if (t < REV_MS) {
          v = 100 * easeInCubic(t / REV_MS)
        } else if (t < REV_MS + HOLD_MS) {
          v = 100
        } else if (t < REV_MS + HOLD_MS + FALL_MS) {
          const p = (t - REV_MS - HOLD_MS) / FALL_MS
          v = 100 + (target - 100) * easeOutBack(p) // easeOutBack > 1 ⇒ slight overshoot past the target, then settle
        } else {
          setDisplay(target)
          return // timeline done — stop scheduling
        }
        setDisplay(Math.min(100, Math.max(0, v)))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(rafRef.current)
    }, [target])

    const value = display
    const angle = START_DEG + (SWEEP_DEG * (value ?? 0)) / 100
    const color = value === null ? '#9ca3af' : gaugeColor(value)
    const needleTip = polar(angle, R - STROKE / 2 - 10)
    const needleBase = polar(angle, 26)

    return (
      <div className="flex flex-col items-center" role="img" aria-label={value === null ? 'Overall score not available' : `Overall score ${Math.round(value)} out of 100`}>
        <svg viewBox="0 0 240 210" className="w-56 sm:w-64">
          {/* track */}
          <path d={arcPath(START_DEG, START_DEG + SWEEP_DEG)} fill="none" stroke="currentColor" className="text-gray-200 dark:text-white/10" strokeWidth={STROKE} strokeLinecap="round" />
          {/* value arc */}
          {value !== null && value > 0 && (
            <path d={arcPath(START_DEG, angle)} fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
          )}
          {/* needle */}
          {value !== null && (
            <>
              <line x1={needleBase.x} y1={needleBase.y} x2={needleTip.x} y2={needleTip.y} stroke={color} strokeWidth={4} strokeLinecap="round" />
              <circle cx={CX} cy={CY} r={7} fill={color} />
            </>
          )}
          {/* readout */}
          <text x={CX} y={CY + 52} textAnchor="middle" className="font-heading fill-current text-navy dark:text-white" fontSize="44" fontWeight="700">
            {value === null ? '—' : Math.round(value)}
          </text>
          {value !== null && (
            <text x={CX} y={CY + 72} textAnchor="middle" className="font-body fill-current text-navy/50 dark:text-white/50" fontSize="12">
              out of 100
            </text>
          )}
        </svg>
        <p className="mt-1 text-[12px] font-body text-navy/50 dark:text-white/50 text-center">
          Overall score — average of the four audit areas below.
        </p>
      </div>
    )
  }
  ```

- [ ] `npx vitest run components/sales/ScoreGauge.test.tsx` — expect PASS (`4 passed`).

- [ ] Write the failing bar test `components/sales/UrgencyBar.test.tsx`:
  ```tsx
  // @vitest-environment jsdom
  import { afterEach, describe, expect, it, vi } from 'vitest'
  import { cleanup, render, screen } from '@testing-library/react'
  import { UrgencyBar } from './UrgencyBar'

  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  function stubMatchMedia(reduce: boolean) {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) as never
  }

  describe('UrgencyBar', () => {
    it('reduced motion: fill width set immediately to the clamped percentage', () => {
      stubMatchMedia(true)
      render(<UrgencyBar value={3} max={10} ariaLabel="3 of 10 pages" />)
      const bar = screen.getByRole('img', { name: '3 of 10 pages' })
      const fill = bar.firstElementChild as HTMLElement
      expect(fill.style.width).toBe('30%')
    })
    it('clamps: value > max renders 100%, max 0 renders 0%', () => {
      stubMatchMedia(true)
      render(<UrgencyBar value={15} max={10} ariaLabel="a" />)
      expect((screen.getByRole('img', { name: 'a' }).firstElementChild as HTMLElement).style.width).toBe('100%')
      render(<UrgencyBar value={5} max={0} ariaLabel="b" />)
      expect((screen.getByRole('img', { name: 'b' }).firstElementChild as HTMLElement).style.width).toBe('0%')
    })
    it('motion path: starts at 0 and schedules a frame to grow', () => {
      stubMatchMedia(false)
      const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
      render(<UrgencyBar value={3} max={10} ariaLabel="c" />)
      expect((screen.getByRole('img', { name: 'c' }).firstElementChild as HTMLElement).style.width).toBe('0%')
      expect(raf).toHaveBeenCalled()
    })
  })
  ```

- [ ] `npx vitest run components/sales/UrgencyBar.test.tsx` — expect FAIL.

- [ ] Create `components/sales/UrgencyBar.tsx`:
  ```tsx
  'use client'
  // C14 redesign: horizontal urgency bar. Fill animates 0 → pct on mount via a
  // CSS width transition triggered one frame after commit; reduced-motion (via
  // matchMedia) sets the final width immediately. Fraction is clamped 0–1.
  import { useEffect, useState } from 'react'

  export function UrgencyBar(props: {
    value: number
    max: number
    ariaLabel: string
    /** Tailwind classes for the fill; defaults to the red urgency treatment. */
    colorClass?: string
  }) {
    const pct = props.max > 0 ? Math.min(100, Math.max(0, (props.value / props.max) * 100)) : 0
    const [width, setWidth] = useState(0)

    useEffect(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setWidth(pct)
        return
      }
      const raf = requestAnimationFrame(() => setWidth(pct))
      return () => cancelAnimationFrame(raf)
    }, [pct])

    return (
      <div
        role="img"
        aria-label={props.ariaLabel}
        className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${props.colorClass ?? 'bg-red-600 dark:bg-red-500'}`}
          style={{ width: `${width}%` }}
        />
      </div>
    )
  }
  ```

- [ ] `npx vitest run components/sales/UrgencyBar.test.tsx components/sales/ScoreGauge.test.tsx` — expect ALL PASS.

- [ ] Commit:
  ```bash
  git add components/sales/ScoreGauge.tsx components/sales/ScoreGauge.test.tsx components/sales/UrgencyBar.tsx components/sales/UrgencyBar.test.tsx
  git commit -m "feat(sales): ScoreGauge (rev/fall-back rAF timeline, clamped, reduced-motion safe) + UrgencyBar"
  ```

---

## Task 10: Hero row + restyled `HeroTiles`

**Files:**
- Create: `components/sales/HeroRow.tsx` (server component)
- Modify: `components/sales/HeroTiles.tsx` (full rewrite shown)
- Create: `components/sales/HeroRow.test.tsx`

**Steps:**

- [ ] Write the failing test `components/sales/HeroRow.test.tsx`:
  ```tsx
  // @vitest-environment jsdom
  import { afterEach, describe, expect, it, vi } from 'vitest'
  import { cleanup, render, screen } from '@testing-library/react'
  import { HeroRow } from './HeroRow'

  afterEach(cleanup)
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never

  describe('HeroRow', () => {
    it('renders the screenshot card with the token-scoped hero URL when heroScreenshot=true', () => {
      render(<HeroRow token="tok1" auditId="aud1" domain="acme.test" overallScore={53} heroScreenshot={true} />)
      const img = screen.getByRole('img', { name: /homepage of acme.test/i }) as HTMLImageElement
      expect(img.src).toContain('/api/sales/tok1/hero/aud1')
      expect(screen.getByText('53')).toBeTruthy()
    })
    it('hides the slot (no placeholder) when heroScreenshot=false', () => {
      render(<HeroRow token="tok1" auditId="aud1" domain="acme.test" overallScore={53} heroScreenshot={false} />)
      expect(screen.queryByRole('img', { name: /homepage of/i })).toBeNull()
      expect(screen.getByText('53')).toBeTruthy() // gauge still renders, full width
    })
  })
  ```

- [ ] `npx vitest run components/sales/HeroRow.test.tsx` — expect FAIL.

- [ ] Create `components/sales/HeroRow.tsx`:
  ```tsx
  // C14 redesign hero row: homepage screenshot in faux-browser chrome (left)
  // + the animated overall-score gauge (right). Older scans without a captured
  // hero hide the slot entirely — the gauge takes the full width (Kevin
  // decision: no placeholder card). Server component; the gauge and the
  // Explainer are client leaves.
  import { Explainer, ExplainerNote, ExplainerSummary } from '@/components/ui/Explainer'
  import { SCORE_METHOD } from '@/lib/sales/copy'
  import { ScoreGauge } from './ScoreGauge'

  export function HeroRow(props: {
    token: string
    auditId: string
    domain: string
    overallScore: number | null
    heroScreenshot: boolean
  }) {
    return (
      <div className={`grid gap-6 ${props.heroScreenshot ? 'md:grid-cols-[2fr_3fr]' : ''}`}>
        {props.heroScreenshot && (
          <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card shadow-sm">
            {/* faux browser chrome */}
            <div className="flex items-center gap-2 border-b border-gray-200 dark:border-navy-border bg-gray-50 dark:bg-white/5 px-4 py-2.5">
              <span className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
              </span>
              <span className="ml-2 flex-1 truncate rounded-md bg-white dark:bg-white/10 px-3 py-1 text-[11px] font-body text-navy/60 dark:text-white/60">
                {props.domain}
              </span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/sales/${props.token}/hero/${props.auditId}`}
              alt={`Homepage of ${props.domain}`}
              className="h-full min-h-[220px] w-full object-cover object-top"
            />
          </div>
        )}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-6 shadow-sm">
          <ScoreGauge score={props.overallScore} />
          <div className="mt-2 w-full max-w-sm">
            <Explainer label="How this score is calculated" variant="plain">
              <ExplainerSummary>{SCORE_METHOD.overall.summary}</ExplainerSummary>
              <ExplainerNote>{SCORE_METHOD.overall.note}</ExplainerNote>
            </Explainer>
          </div>
        </div>
      </div>
    )
  }
  ```

- [ ] Rewrite `components/sales/HeroTiles.tsx` (mini urgency bars tie the tiles to the gauge):
  ```tsx
  import { gradeForScore, type Grade } from './SectionCard'
  import { UrgencyBar } from './UrgencyBar'

  const TILE_GRADE: Record<Grade, string> = {
    good: 'text-green-700 dark:text-green-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-red-600 dark:text-red-400',
    none: 'text-navy/40 dark:text-white/40',
  }
  const BAR_GRADE: Record<Grade, string> = {
    good: 'bg-green-600 dark:bg-green-500',
    warn: 'bg-amber-500 dark:bg-amber-400',
    bad: 'bg-red-600 dark:bg-red-500',
    none: 'bg-gray-300 dark:bg-white/20',
  }

  function Tile(props: { label: string; value: string; grade: Grade; pct: number | null }) {
    return (
      <div className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-5 text-center">
        <div className={`text-3xl font-heading font-bold ${TILE_GRADE[props.grade]}`}>{props.value}</div>
        <div className="mt-1 text-[12px] font-body text-navy/50 dark:text-white/50">{props.label}</div>
        {props.pct !== null && (
          <div className="mt-3">
            <UrgencyBar value={props.pct} max={100} colorClass={BAR_GRADE[props.grade]} ariaLabel={`${props.label}: ${props.pct} out of 100`} />
          </div>
        )}
      </div>
    )
  }

  export function HeroTiles(props: {
    accessibilityScore: number | null
    seoScore: number | null
    performanceScore: number | null
    schemaCoveragePct: number | null
  }) {
    const fmt = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`)
    const schemaGrade: Grade =
      props.schemaCoveragePct === null ? 'none' : props.schemaCoveragePct >= 60 ? 'good' : props.schemaCoveragePct >= 30 ? 'warn' : 'bad'
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 print:grid-cols-4">
        <Tile label="Accessibility score" value={fmt(props.accessibilityScore)} grade={gradeForScore(props.accessibilityScore)} pct={props.accessibilityScore} />
        <Tile label="SEO score" value={fmt(props.seoScore)} grade={gradeForScore(props.seoScore)} pct={props.seoScore} />
        <Tile label="Performance (Lighthouse)" value={fmt(props.performanceScore)} grade={gradeForScore(props.performanceScore)} pct={props.performanceScore} />
        <Tile label="Structured data coverage" value={fmt(props.schemaCoveragePct, '%')} grade={schemaGrade} pct={props.schemaCoveragePct} />
      </div>
    )
  }
  ```

- [ ] `npx vitest run components/sales/HeroRow.test.tsx` — expect PASS.

- [ ] Commit:
  ```bash
  git add components/sales/HeroRow.tsx components/sales/HeroRow.test.tsx components/sales/HeroTiles.tsx
  git commit -m "feat(sales): hero row (screenshot card + gauge, hidden slot when absent) + tiles with mini urgency bars"
  ```

---

## Task 11: `InquiryForm` (mailto placeholder)

> Ordering note (plan Codex fix 5): the inquiry form lands BEFORE the sections/view swap because the new `SalesReportView` imports it — this keeps the atomic swap task (Task 12) self-contained and every commit tsc-green.

**Files:**
- Create: `components/sales/InquiryForm.tsx`
- Create: `components/sales/InquiryForm.test.tsx`

**Steps:**

- [ ] Write the failing test `components/sales/InquiryForm.test.tsx`:
  ```tsx
  // @vitest-environment jsdom
  import { afterEach, describe, expect, it } from 'vitest'
  import { cleanup, render, screen } from '@testing-library/react'
  import { InquiryForm } from './InquiryForm'

  afterEach(cleanup)

  describe('InquiryForm', () => {
    it('renders the anchor target, all four fields, submit, and the fallback mailto link', () => {
      const { container } = render(
        <InquiryForm contactEmail="kevin@enrollmentresources.com" prospectName="Acme" domain="acme.test" />,
      )
      expect(container.querySelector('#inquiry')).toBeTruthy()
      expect(screen.getByLabelText(/name/i)).toBeTruthy()
      expect(screen.getByLabelText(/email/i)).toBeTruthy()
      expect(screen.getByLabelText(/phone/i)).toBeTruthy()
      expect(screen.getByLabelText(/message/i)).toBeTruthy()
      expect(screen.getByRole('button', { name: /send/i })).toBeTruthy()
      const mail = screen.getByRole('link', { name: /kevin@enrollmentresources.com/i }) as HTMLAnchorElement
      expect(mail.href).toContain('mailto:kevin@enrollmentresources.com')
    })
  })
  ```

- [ ] `npx vitest run components/sales/InquiryForm.test.tsx` — expect FAIL.

- [ ] Create `components/sales/InquiryForm.tsx`:
  ```tsx
  'use client'
  // C14 redesign: inquiry form — the Book-a-review scroll target (#inquiry).
  // PLACEHOLDER behavior (Kevin decision): submit composes a mailto: to
  // SALES_CONTACT_EMAIL with the fields prefilled — works today, zero backend.
  // The section shell is structured so a future embedded Jotform swaps in
  // behind the same card. A plain mailto link remains for no-JS/print.
  import { useState, type FormEvent } from 'react'

  export function InquiryForm(props: { contactEmail: string; prospectName: string; domain: string }) {
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [phone, setPhone] = useState('')
    const [message, setMessage] = useState('')

    const onSubmit = (e: FormEvent) => {
      e.preventDefault()
      const subject = `Website audit review — ${props.domain}`
      const body = [
        `Prospect: ${props.prospectName} (${props.domain})`,
        `Name: ${name}`,
        `Email: ${email}`,
        `Phone: ${phone}`,
        '',
        message,
      ].join('\n')
      window.location.href = `mailto:${props.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    }

    const inputCls =
      'w-full rounded-lg border border-gray-300 dark:border-navy-border bg-white dark:bg-white/5 px-3 py-2 text-[13px] font-body text-navy dark:text-white placeholder:text-navy/30 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500'

    return (
      <section
        id="inquiry"
        className="scroll-mt-24 bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm p-6 space-y-4"
      >
        <div>
          <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white">Book a review</h2>
          <p className="mt-1 text-[13px] font-body text-navy/60 dark:text-white/60">
            Ask us what we would fix first on {props.domain} — and what it would be worth.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="inq-name" className="block text-[12px] font-body text-navy/50 dark:text-white/50 mb-1">Name</label>
              <input id="inq-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="inq-email" className="block text-[12px] font-body text-navy/50 dark:text-white/50 mb-1">Email</label>
              <input id="inq-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="inq-phone" className="block text-[12px] font-body text-navy/50 dark:text-white/50 mb-1">Phone</label>
              <input id="inq-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label htmlFor="inq-message" className="block text-[12px] font-body text-navy/50 dark:text-white/50 mb-1">Message</label>
            <textarea id="inq-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} />
          </div>
          <button
            type="submit"
            className="rounded-full bg-blue-700 hover:bg-blue-800 text-white font-heading font-semibold text-[13px] px-5 py-2"
          >
            Send inquiry
          </button>
        </form>
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
          Prefer email?{' '}
          <a href={`mailto:${props.contactEmail}`} className="font-heading font-semibold text-blue-700 dark:text-blue-400">
            {props.contactEmail}
          </a>
        </p>
      </section>
    )
  }
  ```

- [ ] `npx vitest run components/sales/InquiryForm.test.tsx` — expect PASS.

- [ ] Commit:
  ```bash
  git add components/sales/InquiryForm.tsx components/sales/InquiryForm.test.tsx
  git commit -m "feat(sales): inquiry form placeholder (mailto compose) as the Book-a-review target"
  ```

---

## Task 12: Atomic swap — sections rebuilt + view assembly + final payload cleanup

> **ONE COMMIT for this whole task** (plan Codex fix 5): the sections rewrite changes prop contracts the old `SalesReportView` consumes, so sections + view + tests + deprecated-payload removal must land together to keep `tsc` green. Everything through this task's single commit step below is that commit.

**Files:**
- Modify: `components/sales/SectionCard.tsx` (add `defaultOpen`)
- Modify: `components/sales/sections.tsx` (FULL rewrite below — replaces the Task 6 transition compat)
- Modify: `components/sales/SalesReportView.tsx` (FULL rewrite below)
- Modify: `components/sales/SalesReportView.test.tsx` (FULL rewrite below)
- Modify: `lib/sales/sales-report-data.ts` (remove the deprecated `patterns` field + `SalesPattern` interface — the Task 6 transition ends here)
- Modify: `lib/sales/sales-report-data.test.ts` (drop the deprecated-`patterns` assertion)
- Delete: `components/sales/ExampleCard.tsx` (its only consumer was the dropped pattern cards; `CuratedExample` still lives in `representative-examples.ts` for the screenshot allowlist)
- Tests: the sections are exercised through the assembled view's `SalesReportView.test.tsx` (the existing house pattern).

**Steps:**

- [ ] In `components/sales/SectionCard.tsx`, change the component signature and `<details>`:
  ```tsx
  export function SectionCard(props: {
    title: string
    grade: Grade
    gradeLabel: string
    headline: string
    /** C14 redesign: urgency sections render open by default (leave-behind). */
    defaultOpen?: boolean
    children: ReactNode
  }) {
    return (
      <section className="bg-white dark:bg-navy-card border border-gray-200 dark:border-navy-border rounded-2xl shadow-sm">
        <details open={props.defaultOpen}>
          <summary className="cursor-pointer list-none p-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-heading font-semibold text-navy dark:text-white mb-1">{props.title}</h2>
              <p className="text-[13px] font-body text-navy/50 dark:text-white/50">{props.headline}</p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-heading font-semibold ${GRADE_CLASSES[props.grade]}`}>
              {props.gradeLabel}
            </span>
          </summary>
          <div className="px-6 pb-6 space-y-4">{props.children}</div>
        </details>
      </section>
    )
  }
  ```
  Note the `intro` prop is REMOVED — intros move into per-section `Explainer`s or urgency copy. (Grep for other `SectionCard` consumers first: `grep -rn "SectionCard" components app --include='*.tsx' | grep -v test` — as of planning, `sections.tsx` is the only consumer.)

- [ ] Delete `components/sales/ExampleCard.tsx`:
  ```bash
  git rm components/sales/ExampleCard.tsx
  ```

- [ ] Rewrite `components/sales/sections.tsx` in full:
  ```tsx
  // The four report sections, rebuilt for urgency (C14 redesign). Server
  // components; evidence is pre-curated by the loader — these only render what
  // they are given. Open by default (leave-behind); progressive disclosure
  // remains for methodology explainers and long lists.
  import { Explainer, ExplainerNote, ExplainerSummary } from '@/components/ui/Explainer'
  import type { CwvStatus } from '@/lib/ada-audit/lighthouse-types'
  import {
    ER_ADA_CTA, ISSUE_WHY, SCHEMA_IMPLICATIONS, SCORE_METHOD, SECTION_INTROS, WCAG_MEANING,
  } from '@/lib/sales/copy'
  import type { SalesReportData } from '@/lib/sales/sales-report-data'
  import { SectionCard, gradeForScore } from './SectionCard'
  import { UrgencyBar } from './UrgencyBar'

  function MethodExplainer(props: { area: keyof typeof SCORE_METHOD }) {
    const m = SCORE_METHOD[props.area]
    return (
      <Explainer label="How this score is calculated" variant="plain">
        <ExplainerSummary>{m.summary}</ExplainerSummary>
        <ExplainerNote>{m.note}</ExplainerNote>
      </Explainer>
    )
  }

  // ── Accessibility: counts only — no itemized rules ─────────────────────────

  const SEVERITY_TILES = [
    { key: 'critical' as const, label: 'Critical', cls: 'text-red-600 dark:text-red-400' },
    { key: 'serious' as const, label: 'Serious', cls: 'text-red-500 dark:text-red-400/90' },
    { key: 'moderate' as const, label: 'Moderate', cls: 'text-amber-600 dark:text-amber-400' },
    { key: 'minor' as const, label: 'Minor', cls: 'text-amber-500 dark:text-amber-300' },
  ]

  export function AccessibilitySalesSection(props: {
    data: SalesReportData['accessibility']
    standardTested: string
    archived: boolean
  }) {
    const { counts } = props.data
    return (
      <SectionCard
        title="Accessibility"
        grade={gradeForScore(props.data.score)}
        gradeLabel={props.data.score === null ? 'Not scored' : `${props.data.score}/100`}
        headline={`${counts.total} accessibility issues found across the scanned pages`}
        defaultOpen
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SEVERITY_TILES.map((t) => (
            <div key={t.key} className="rounded-xl border border-gray-200 dark:border-navy-border p-4 text-center">
              <div className={`text-3xl font-heading font-bold ${t.cls}`}>{counts[t.key]}</div>
              <div className="mt-1 text-[12px] font-body text-navy/50 dark:text-white/50">{t.label}</div>
            </div>
          ))}
        </div>
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60">
          Tested against {props.standardTested}. {WCAG_MEANING}
        </p>
        {props.archived && (
          <p className="text-[12px] font-body text-amber-600 dark:text-amber-400">
            Detailed evidence for this scan has been archived — counts above come from the retained findings. Re-scan for fresh evidence.
          </p>
        )}
        <div className="rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 p-4">
          <p className="text-[13px] font-body text-navy/80 dark:text-white/80">{ER_ADA_CTA}</p>
        </div>
        <MethodExplainer area="accessibility" />
      </SectionCard>
    )
  }

  // ── SEO: urgency rows ───────────────────────────────────────────────────────

  export function SeoSalesSection(props: { data: SalesReportData['seo']; pagesScanned: number }) {
    const d = props.data
    const pages = Math.max(1, props.pagesScanned)
    const headline = d.issueGroups.length
      ? d.issueGroups.slice(0, 2).map((g) => `${g.count} ${g.label.toLowerCase()}`).join(' · ')
      : 'No blocking SEO issues found on scanned pages'
    return (
      <SectionCard
        title="SEO"
        grade={gradeForScore(d.score)}
        gradeLabel={d.score === null ? 'Not scored' : `${d.score}/100`}
        headline={headline}
        defaultOpen
      >
        {d.issueGroups.length === 0 && (
          <p className="text-[13px] font-body text-green-700 dark:text-green-400">
            The scanned pages came back clean on links, titles, and content depth.
          </p>
        )}
        {d.issueGroups.map((g) => (
          <div key={g.type} className="rounded-xl border border-gray-200 dark:border-navy-border p-4 space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-heading font-semibold text-navy dark:text-white">{g.label}</span>
              <span className="text-[13px] font-heading font-bold text-red-600 dark:text-red-400">{g.count}</span>
            </div>
            <UrgencyBar
              value={g.affectedPages}
              max={pages}
              ariaLabel={`${g.label}: ${g.affectedComplete ? '' : 'at least '}${g.affectedPages} of ${props.pagesScanned} pages affected`}
            />
            <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
              {g.affectedComplete ? `${g.affectedPages}` : `At least ${g.affectedPages}`} of {props.pagesScanned} pages affected
            </p>
            <p className="text-[12px] font-body text-navy/60 dark:text-white/60">{ISSUE_WHY[g.type]}</p>
          </div>
        ))}
        {((d.duplicateContentGroups ?? 0) > 0 || (d.sitemapMissRatePct ?? 0) > 0) && (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-4 space-y-1">
            {d.duplicateContentGroups !== null && d.duplicateContentGroups > 0 && (
              <p className="text-[13px] font-body text-navy/70 dark:text-white/70">
                {d.duplicateContentGroups} groups of pages share near-identical content — they compete with each other in search.
              </p>
            )}
            {d.sitemapMissRatePct !== null && d.sitemapMissRatePct > 0 && (
              <p className="text-[13px] font-body text-navy/70 dark:text-white/70">
                {d.sitemapMissRatePct}% of reachable pages are missing from the sitemap — search engines may never find them.
              </p>
            )}
          </div>
        )}
        <MethodExplainer area="seo" />
      </SectionCard>
    )
  }

  // ── Performance: homepage card + slowest pages + roll-up ───────────────────

  const STATUS_CLS: Record<CwvStatus, string> = {
    pass: 'text-green-700 dark:text-green-400',
    'needs-improvement': 'text-amber-600 dark:text-amber-400',
    fail: 'text-red-600 dark:text-red-400',
  }
  // Lighthouse lab thresholds (spec): LCP ≤2.5s good />4s poor; CLS ≤0.1/>0.25; TBT ≤200ms/>600ms.
  const lcpCls = (ms: number) => (ms <= 2500 ? STATUS_CLS.pass : ms > 4000 ? STATUS_CLS.fail : STATUS_CLS['needs-improvement'])
  const clsCls = (v: number) => (v <= 0.1 ? STATUS_CLS.pass : v > 0.25 ? STATUS_CLS.fail : STATUS_CLS['needs-improvement'])
  const tbtCls = (ms: number) => (ms <= 200 ? STATUS_CLS.pass : ms > 600 ? STATUS_CLS.fail : STATUS_CLS['needs-improvement'])
  const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`

  export function PerformanceSalesSection(props: { data: SalesReportData['performance'] }) {
    const { rollup, homepage } = props.data
    const grade = rollup ? gradeForScore(rollup.medianPerformance) : homepage ? gradeForScore(homepage.performance) : 'none'
    const gradeLabel = rollup ? `${rollup.medianPerformance}/100` : homepage ? `${homepage.performance}/100 (homepage)` : 'Not measured'
    const headline = rollup
      ? `Slowest pages take ${sec(rollup.p75LcpMs)} to show their main content (Lighthouse-measured, ${rollup.measuredPages} pages)`
      : 'Not enough pages were measured for a reliable site-wide roll-up'
    return (
      <SectionCard title="Performance" grade={grade} gradeLabel={gradeLabel} headline={headline} defaultOpen>
        {/* (a) Homepage CWV card — independent of the roll-up (spec Codex fix 6) */}
        {homepage ? (
          <div className="rounded-xl border border-gray-200 dark:border-navy-border p-4">
            <h3 className="text-[13px] font-heading font-semibold text-navy dark:text-white mb-2">Your homepage</h3>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Lighthouse score</dt><dd className={`text-[15px] font-heading font-semibold ${gradeForScore(homepage.performance) === 'good' ? STATUS_CLS.pass : gradeForScore(homepage.performance) === 'warn' ? STATUS_CLS['needs-improvement'] : STATUS_CLS.fail}`}>{homepage.performance}/100</dd></div>
              <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Largest paint</dt><dd className={`text-[15px] font-heading font-semibold ${STATUS_CLS[homepage.lcpStatus]}`}>{sec(homepage.lcpMs)}</dd></div>
              <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Layout shift</dt><dd className={`text-[15px] font-heading font-semibold ${STATUS_CLS[homepage.clsStatus]}`}>{homepage.cls}</dd></div>
              <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Blocking time (lab proxy)</dt><dd className={`text-[15px] font-heading font-semibold ${STATUS_CLS[homepage.tbtStatus]}`}>{Math.round(homepage.tbtMs)}ms</dd></div>
            </dl>
          </div>
        ) : (
          <p className="text-[12px] font-body text-navy/45 dark:text-white/45">
            Not measured on the homepage — see site-wide numbers below.
          </p>
        )}
        {/* (b) 5 slowest pages */}
        {rollup && rollup.worstPages.length > 0 && (
          <div>
            <h3 className="text-[13px] font-heading font-semibold text-navy dark:text-white mb-2">Slowest pages</h3>
            <ul className="space-y-2">
              {rollup.worstPages.map((p) => (
                <li key={p.url} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] font-body text-navy/60 dark:text-white/60 break-all">{p.url}</span>
                    <span className="shrink-0 text-[12px] font-heading font-semibold text-red-600 dark:text-red-400">{p.performance}/100</span>
                  </div>
                  <UrgencyBar value={100 - p.performance} max={100} ariaLabel={`${p.url}: Lighthouse score ${p.performance} out of 100`} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* (c) averaged roll-up */}
        {rollup ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Largest paint (p75)</dt><dd className={`text-[15px] font-heading font-semibold ${lcpCls(rollup.p75LcpMs)}`}>{sec(rollup.p75LcpMs)}</dd></div>
            <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Layout shift (p75)</dt><dd className={`text-[15px] font-heading font-semibold ${clsCls(rollup.p75Cls)}`}>{rollup.p75Cls}</dd></div>
            <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Blocking time (p75, lab proxy)</dt><dd className={`text-[15px] font-heading font-semibold ${tbtCls(rollup.p75TbtMs)}`}>{Math.round(rollup.p75TbtMs)}ms</dd></div>
            <div><dt className="text-[12px] font-body text-navy/50 dark:text-white/50">Pages passing all checks</dt><dd className="text-[15px] font-heading font-semibold text-navy dark:text-white">{rollup.pctPassing}%</dd></div>
          </dl>
        ) : (
          <p className="text-[12px] font-body text-navy/45 dark:text-white/45">Re-scan to collect site-wide Lighthouse measurements.</p>
        )}
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">{SECTION_INTROS.performance}</p>
        <MethodExplainer area="performance" />
      </SectionCard>
    )
  }

  // ── Structured data: 2×2 high-value grid, evidence-bounded ─────────────────

  export function GeoSalesSection(props: { data: SalesReportData['geo']; pagesTotal: number | null }) {
    const d = props.data
    const grade = d.coveragePct === null ? 'none' : d.coveragePct >= 60 ? 'good' : d.coveragePct >= 30 ? 'warn' : 'bad'
    const present = new Set(d.types.map((t) => t.type))
    const highValue = [...present].filter((t) => !d.missingHighValueTypes.includes(t))
    const cards = [...highValue, ...d.missingHighValueTypes]
      .filter((t, i, a) => a.indexOf(t) === i)
      .filter((t) => t in SCHEMA_IMPLICATIONS)
    const observationPartial = d.observedPages !== null && props.pagesTotal !== null && d.observedPages < props.pagesTotal
    const otherTypes = d.types.filter((t) => !(t.type in SCHEMA_IMPLICATIONS))
    return (
      <SectionCard
        title="Structured data & AI readiness"
        grade={grade}
        gradeLabel={d.coveragePct === null ? 'Not measured' : `${d.coveragePct}% coverage`}
        headline={
          d.missingHighValueTypes.length
            ? `${d.missingHighValueTypes.slice(0, 2).join(' and ')} structured data not observed on the pages we scanned`
            : 'High-value structured data types are present'
        }
        defaultOpen
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map((type) => {
            const found = present.has(type)
            return (
              <div key={type} className="rounded-xl border border-gray-200 dark:border-navy-border p-4 space-y-1">
                <div className="flex items-center gap-2">
                  <span aria-hidden className={`text-lg font-bold ${found ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {found ? '✓' : '✗'}
                  </span>
                  <span className="text-[13px] font-heading font-semibold text-navy dark:text-white">{type}</span>
                </div>
                <p className="text-[12px] font-body text-navy/60 dark:text-white/60">
                  {found
                    ? `Present on at least one scanned page.`
                    : `Not observed on the ${d.observedPages ?? 0} pages we scanned${observationPartial ? ' (coverage may be partial)' : ''}. ${SCHEMA_IMPLICATIONS[type]}`}
                </p>
              </div>
            )
          })}
        </div>
        {d.observedPages !== null && (
          <p className="text-[13px] font-body text-navy/60 dark:text-white/60">
            {d.pagesWithSchema} of {d.observedPages} scanned pages carry structured data.
          </p>
        )}
        {otherTypes.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {otherTypes.map((t) => (
              <li key={t.type} className="rounded-full bg-gray-100 dark:bg-white/10 px-3 py-1 text-[12px] font-body text-navy/70 dark:text-white/70">
                {t.type} · {t.pages}
              </li>
            ))}
          </ul>
        )}
        {d.hreflangIssueCount > 0 && (
          <p className="text-[12px] font-body text-navy/50 dark:text-white/50">{d.hreflangIssueCount} language-annotation issues found.</p>
        )}
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">{SECTION_INTROS.geo}</p>
        <MethodExplainer area="geo" />
      </SectionCard>
    )
  }
  ```
  Note: `SECTION_INTROS.accessibility`/`.seo` are superseded by `WCAG_MEANING`/`ISSUE_WHY`; the performance and geo intros stay as visible honesty lines. Do not delete `SECTION_INTROS` (kept keys still referenced).

- [ ] Remove the deprecated transition fields (the Task 6 compat ends in THIS commit — plan Codex fix 5):
  1. `lib/sales/sales-report-data.ts`: delete the `@deprecated` `SalesPattern` interface, remove `patterns: SalesPattern[]` from `SalesReportData['accessibility']`, remove the `patterns: []` literal from the return object, and drop the now-unused `CuratedExample` type import if nothing else references it (`loadRepresentativeExamples` + `topPatternIssues` + `MAX_PATTERNS` stay — `curatedScreenshotSet` uses them permanently).
  2. `lib/sales/sales-report-data.test.ts`: delete the `expect(d.accessibility.patterns).toEqual([])` assertion.

- [ ] Do NOT commit yet — continue straight into the view assembly below (same atomic commit; `SalesReportView.tsx` still references the pieces just changed).

- [ ] Rewrite the test first — `components/sales/SalesReportView.test.tsx`:
  ```tsx
  // @vitest-environment jsdom
  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
  import { cleanup, render, screen } from '@testing-library/react'
  import { SalesReportView } from './SalesReportView'
  import type { SalesReportData } from '@/lib/sales/sales-report-data'

  afterEach(cleanup)
  beforeEach(() => {
    // jsdom has no matchMedia; reduced-motion=true keeps gauge/bars static.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) as never
  })

  const data: SalesReportData = {
    prospect: { id: 1, name: 'Acme College', domain: 'acme.test' },
    auditId: 'aud1', completedAt: '2026-07-14T00:00:00.000Z', pagesTotal: 10,
    preparedBy: 'Kevin', archived: false,
    overallScore: 53, heroScreenshot: true, standardTested: 'WCAG 2.1 AA',
    headline: { accessibilityScore: 62, seoScore: 71, performanceScore: 40, schemaCoveragePct: 40 },
    accessibility: { score: 62, counts: { critical: 4, serious: 10, moderate: 2, minor: 1, total: 17 } },
    seo: {
      score: 71,
      issueGroups: [
        { type: 'broken_internal_links', label: 'Broken links on your site', count: 7, affectedPages: 4, affectedComplete: true, examplePages: ['https://acme.test/0'] },
        { type: 'thin_content', label: 'Thin-content pages', count: 9, affectedPages: 3, affectedComplete: false, examplePages: [] },
      ],
      duplicateContentGroups: 2, sitemapMissRatePct: 12,
    },
    performance: {
      rollup: {
        measuredPages: 3, medianPerformance: 40, p75LcpMs: 4200, p75Cls: 0.3, p75TbtMs: 700,
        pctPassing: 0, scoreBuckets: { good: 0, fair: 1, poor: 2 },
        worstPages: [{ url: 'https://acme.test/slow', performance: 22 }],
      },
      homepage: {
        performance: 55, lcpMs: 3100, cls: 0.12, tbtMs: 350,
        lcpStatus: 'needs-improvement', clsStatus: 'needs-improvement', tbtStatus: 'needs-improvement',
      },
    },
    geo: {
      coveragePct: 40, pagesWithSchema: 2, observedPages: 5,
      types: [{ type: 'Organization', pages: 2 }],
      missingHighValueTypes: ['Course', 'FAQPage', 'BreadcrumbList'], hreflangIssueCount: 0,
    },
  }

  describe('SalesReportView (C14 urgency redesign)', () => {
    it('renders header, hero row, tiles, four sections, and the inquiry form', () => {
      render(<SalesReportView data={data} token="tok1" contactEmail="kevin@enrollmentresources.com" />)
      expect(screen.getByText('Website Audit Report')).toBeTruthy()
      expect(screen.getByRole('button', { name: /book a review/i })).toBeTruthy()
      // hero: token-scoped screenshot URL + gauge value
      const hero = screen.getByRole('img', { name: /homepage of acme.test/i }) as HTMLImageElement
      expect(hero.src).toContain('/api/sales/tok1/hero/aud1')
      expect(screen.getByText('53')).toBeTruthy()
      // sections
      expect(screen.getByText('Accessibility')).toBeTruthy()
      expect(screen.getByText('SEO')).toBeTruthy()
      expect(screen.getByText('Performance')).toBeTruthy()
      expect(screen.getAllByText(/structured data/i).length).toBeGreaterThan(0)
      // inquiry form replaced the mailto footer
      expect(document.querySelector('#inquiry')).toBeTruthy()
      expect(screen.getByRole('button', { name: /send/i })).toBeTruthy()
    })

    it('accessibility renders counts only — no itemized rules or element screenshots', () => {
      render(<SalesReportView data={data} token="tok1" contactEmail="x@y.z" />)
      expect(screen.getByText('4')).toBeTruthy() // critical tile
      expect(screen.getByText(/tested against wcag 2.1 aa/i)).toBeTruthy()
      expect(screen.queryByText(/color contrast/i)).toBeNull()
      expect(document.querySelector('img[src*="/screenshot/"]')).toBeNull()
      // sanctioned ER-product ADA claim present
      expect(screen.getByText(/enrollment resources builds is ada-compliant/i)).toBeTruthy()
    })

    it('SEO urgency rows: bar driven by affectedPages; "at least" phrasing on incomplete evidence', () => {
      render(<SalesReportView data={data} token="tok1" contactEmail="x@y.z" />)
      expect(screen.getByText('4 of 10 pages affected')).toBeTruthy()
      expect(screen.getByText('At least 3 of 10 pages affected')).toBeTruthy()
      // urgency bar widths come from affectedPages/pagesScanned (reduced motion = immediate)
      const bar = screen.getByRole('img', { name: /broken links on your site: 4 of 10 pages affected/i })
      expect((bar.firstElementChild as HTMLElement).style.width).toBe('40%')
    })

    it('schema grid: ✓/✗ per high-value type with evidence-bounded absence copy', () => {
      render(<SalesReportView data={data} token="tok1" contactEmail="x@y.z" />)
      expect(screen.getAllByText(/not observed on the 5 pages we scanned/i).length).toBe(3)
      expect(screen.getAllByText(/coverage may be partial/i).length).toBeGreaterThan(0) // observedPages 5 < pagesTotal 10
    })

    it('homepage CWV card renders even when the rollup is null; hero slot hidden when absent', () => {
      render(
        <SalesReportView
          data={{ ...data, heroScreenshot: false, performance: { rollup: null, homepage: data.performance.homepage } }}
          token="t" contactEmail="x@y.z"
        />,
      )
      expect(screen.queryByRole('img', { name: /homepage of/i })).toBeNull()
      expect(screen.getByText('Your homepage')).toBeTruthy()
      expect(screen.getByText('3.1s')).toBeTruthy()
    })

    it('honest labeling: no prospect compliance claims; lab framing kept', () => {
      render(<SalesReportView data={data} token="tok1" contactEmail="x@y.z" />)
      expect(screen.queryByText(/wcag compliant/i)).toBeNull()
      expect(screen.getAllByText(/lighthouse-measured/i).length).toBeGreaterThan(0)
    })
  })
  ```

- [ ] `npx vitest run components/sales/SalesReportView.test.tsx` — expect FAIL (old view).

- [ ] Rewrite `components/sales/SalesReportView.tsx`:
  ```tsx
  import type { SalesReportData } from '@/lib/sales/sales-report-data'
  import { HeroRow } from './HeroRow'
  import { HeroTiles } from './HeroTiles'
  import { InquiryForm } from './InquiryForm'
  import { SalesReportHeader } from './SalesReportHeader'
  import { AccessibilitySalesSection, GeoSalesSection, PerformanceSalesSection, SeoSalesSection } from './sections'

  export function SalesReportView(props: { data: SalesReportData; token: string; contactEmail: string }) {
    const { data } = props
    const scanned = data.completedAt
      ? new Date(data.completedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })
      : null
    return (
      <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep">
        <SalesReportHeader prospectName={data.prospect.name} domain={data.prospect.domain} preparedBy={data.preparedBy} />
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
          <p className="text-[12px] font-body text-navy/50 dark:text-white/50">
            {scanned ? `Scanned ${scanned}` : 'Scan date unavailable'}
            {data.pagesTotal ? ` · ${data.pagesTotal} pages` : ''}
          </p>
          <HeroRow
            token={props.token}
            auditId={data.auditId}
            domain={data.prospect.domain}
            overallScore={data.overallScore}
            heroScreenshot={data.heroScreenshot}
          />
          <HeroTiles {...data.headline} />
          <AccessibilitySalesSection data={data.accessibility} standardTested={data.standardTested} archived={data.archived} />
          <SeoSalesSection data={data.seo} pagesScanned={data.pagesTotal ?? 0} />
          <PerformanceSalesSection data={data.performance} />
          <GeoSalesSection data={data.geo} pagesTotal={data.pagesTotal} />
          <InquiryForm contactEmail={props.contactEmail} prospectName={data.prospect.name} domain={data.prospect.domain} />
        </div>
      </div>
    )
  }
  ```
  (`CTA_CLOSING` is no longer imported here — its message lives in the inquiry card intro. Leave the constant in `copy.ts`.)

- [ ] Gate the atomic swap — GREEN before committing:
  ```bash
  npx tsc --noEmit
  ```
  Expected: no output (clean). Fix any residual references to the removed payload shape (`patterns`, direct `performance.medianPerformance` access) — grep first: `grep -rn "\.patterns" components app lib --include='*.ts*' | grep -v test | grep -v worktrees`.
  ```bash
  npx vitest run components/sales lib/sales
  ```
  Expected: all sales suites pass.

- [ ] Commit (the ONE atomic swap commit):
  ```bash
  git add lib/sales/sales-report-data.ts lib/sales/sales-report-data.test.ts components/sales/SectionCard.tsx components/sales/sections.tsx components/sales/SalesReportView.tsx components/sales/SalesReportView.test.tsx
  git rm components/sales/ExampleCard.tsx 2>/dev/null; git add -A components/sales
  git commit -m "feat(sales): atomic swap — urgency sections + redesigned view assembly + deprecated patterns payload removed"
  ```

---

## Task 13: Full gates, ops env, manual verification, PR

**Files:**
- Modify: `ecosystem.config.js` (add `HERO_SCREENSHOTS_DIR`)
- No change needed to `app/(public)/sales/[token]/page.tsx` (it passes `data`/`token`/`contactEmail` through — verified).

**Steps:**

- [ ] Add the prod env to `ecosystem.config.js` — beside the existing line:
  ```js
  REPORTS_DIR: `${DATA_HOME}/reports`,
  ```
  add:
  ```js
  HERO_SCREENSHOTS_DIR: `${DATA_HOME}/sales-hero`, // C14 hero: outlives the 24h screenshot sweep; 30-day sales tokens
  ```

- [ ] Full gates:
  ```bash
  npx tsc --noEmit
  ```
  Expected: no output (clean).
  ```bash
  npx vitest run
  ```
  Expected: all suites pass (any pre-existing unrelated failure must match main — verify with `git stash && npx vitest run <file> && git stash pop` before blaming this branch).

- [ ] Commit:
  ```bash
  git add ecosystem.config.js
  git commit -m "feat(sales): prod HERO_SCREENSHOTS_DIR under DATA_HOME"
  ```

- [ ] **Manual verification pass (before PR):**
  1. `npm run dev`, create a prospect at `/sales` against a small real-ish domain (or reuse an existing prospect), run a scan, wait for complete.
  2. Open the share link: hero screenshot renders (or slot hidden for pre-redesign scans), gauge animates rev→fall, tiles show mini bars, sections open by default, Book a review scrolls to the form, inquiry submit opens a mail compose.
  3. Toggle dark mode + print preview (header static, nothing broken).
  4. **Kevin eyeballs the logo in both modes** (Task 8 note) — blocking.

- [ ] Open the PR (do NOT merge or deploy without Kevin's go; deploy notes for the PR body):
  - Prod needs `mkdir -p $DATA_HOME/sales-hero` (PM2-writable) — the writer `mkdir -p`s defensively, but confirm ownership.
  - `prisma migrate deploy` runs automatically in the deploy command.
  - Reports from scans made BEFORE this deploy hide the hero slot until re-scanned (by design).

---

## Post-ship checklist (per repo docs conventions)

- [ ] Move the spec + this plan to `docs/superpowers/archive/{specs,plans}/` (git mv) once merged/deployed.
- [ ] Tracker checkbox + dated status-log line in `docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`; rewrite `HANDOFF-improvement-roadmap.md` (handoff protocol).
- [ ] CLAUDE.md key-files: extend the `lib/sales/` entry (hero-screenshot store, root-url injection, hero route + matcher, redesigned view components).
