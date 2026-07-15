# D4 — Client-Attached Robots/Sitemap Checks + History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Check a client's domain" runs server-side over `lib/seo-fetch`, stores a `RobotsCheck` snapshot (content hash, parsed issues, sitemap inventory + child-level change evidence), and surfaces latest state + history on the client page.

**Architecture:** Pure-ish runner (`lib/robots-check/runner.ts`, DI fetchers) → service (`service.ts`: single-flight persist, read-time `changed` computation, one `{summary, detail}` shape) → thin `withRoute` routes under `/api/clients/[id]/robots-checks` → `RobotsCheckCard` on the client page. Retention keeps `LIMIT+1` per (client, domain). NO scheduling, NO Finding rows, NO score impact (D5's job).

**Tech Stack:** Next.js 15 App Router, Prisma + SQLite, vitest, `lib/seo-fetch` primitives (frozen), `node:crypto` sha256.

**Spec:** `docs/superpowers/specs/2026-07-12-d4-client-robots-checks-design.md` (Codex-reviewed, fixes #1–#8 applied — task steps cite them).

**Plan Codex review:** ACCEPT WITH NAMED FIXES ×6, all applied in place — marked "plan-Codex #N" below (1: per-domain predecessor fallback + per-domain card preload + exact total-order predicate; 2: structural detail guard + JSON.stringify evidence; 3: convention recognition = `parsed.valid` only; 4: strict `^[1-9][0-9]*$` ids + GET domain membership + body-as-unknown null safety; 5: card AbortController deadline + full reconciliation + domain-switch generation token + surfaced GET errors + UTC formatDate; 6: test strengthening incl. `vi.unstubAllGlobals()`).

## Global Constraints

- Branch: `feat/d4-robots-checks` off current `main`. Never `git add -A` (untracked `pentest-results/` etc.) — stage explicit paths. No backticks in `-m` commit messages.
- Array-form `$transaction([...])` only; raw SQL via tagged `$executeRaw` only (never `$executeRawUnsafe`).
- All network I/O stays inside `lib/seo-fetch` (which wraps `safeFetch`) — the runner adds ZERO new fetch paths. Never weaken `lib/security/safe-url.ts`.
- `lib/seo-fetch/fetch.ts` is FROZEN (D3 characterization gate) — consume it, never modify it.
- Routes live under `/api/clients/` (cookie-gated) — NO `middleware.ts` change.
- UI: Tailwind `dark:` variants on every element; no `Date`-dependent render branches that differ server/client.
- Tests: DB-backed tests self-provision per-worker SQLite; component tests need `// @vitest-environment jsdom` + `afterEach(cleanup)`, no jest-dom.
- Gates before PR: `npm run lint` + `DATABASE_URL="file:./local-dev.db" npm test` + `npm run build`. (No `npm run smoke` needed — auth/SF-upload/ADA-pipeline untouched; confirm no smoke-walked page component changed beyond the client page card add.)
- Absence ≠ zero everywhere: `sitemapUrlTotal: null` when no sitemap observed; `changed: null` never rendered as "unchanged".

---

### Task 1: Schema migration + client-safe types

**Files:**
- Modify: `prisma/schema.prisma` (add `RobotsCheck` model + `Client.robotsChecks` back-relation)
- Create: `prisma/migrations/20260713100000_robots_check/migration.sql`
- Create: `lib/robots-check/types.ts`
- Test: compile-time only for types; migration applied to local dev DB

**Interfaces:**
- Produces (Task 2+ consume): everything exported from `lib/robots-check/types.ts` below, and the `prisma.robotsCheck` model delegate.

- [ ] **Step 1: Add the Prisma model**

In `prisma/schema.prisma`, add to `model Client` relations (after `keywordStrategySessions`):

```prisma
  robotsChecks          RobotsCheck[]
```

Add the model (near `GscSnapshot`):

```prisma
// D4: client-attached robots/sitemap check snapshots. One row per run.
// Raw robots body stored (small, fetch-capped 500KB, retention-capped rows)
// for D5 diff rendering; sitemap XML is NEVER stored (hash+counts only).
model RobotsCheck {
  id                Int      @id @default(autoincrement())
  clientId          Int
  client            Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  domain            String   // normalized bare domain the check ran against
  source            String   @default("manual") // 'manual' | 'scheduled' (D5)
  robotsStatus      String   // 'ok' | 'missing' | 'unreachable'
  robotsContentHash String?  // sha256 hex, null unless robots ok
  robotsContent     String?  // raw robots.txt body, null unless robots ok
  sitemapUrlTotal   Int?     // null = no sitemap observed (absence != 0)
  errorCount        Int
  warningCount      Int
  detailJson        String   // {v:1,...} RobotsCheckDetail
  createdAt         DateTime @default(now())

  @@index([clientId, domain, createdAt])
}
```

- [ ] **Step 2: Hand-author the migration**

Create `prisma/migrations/20260713100000_robots_check/migration.sql`:

```sql
-- D4: client-attached robots/sitemap check snapshots (additive table).
CREATE TABLE "RobotsCheck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "robotsStatus" TEXT NOT NULL,
    "robotsContentHash" TEXT,
    "robotsContent" TEXT,
    "sitemapUrlTotal" INTEGER,
    "errorCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "detailJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RobotsCheck_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RobotsCheck_clientId_domain_createdAt_idx" ON "RobotsCheck"("clientId", "domain", "createdAt");
```

- [ ] **Step 3: Apply migration + regenerate client**

Run:
```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && DATABASE_URL="file:./local-dev.db" npx prisma generate
```
Expected: `20260713100000_robots_check` applied; client regenerated.

- [ ] **Step 4: Create `lib/robots-check/types.ts`**

Client-safe (no node imports, no prisma). Verbatim:

```ts
// lib/robots-check/types.ts
//
// D4 client-safe types + constants for client-attached robots/sitemap
// checks. Imported by the card component AND the server layer — must never
// import server-only modules. Issue types come from the client-safe D3
// parse modules.

import type { RobotsIssue } from '@/lib/seo-fetch/robots-parse'
import type { SitemapIssue } from '@/lib/seo-fetch/sitemap-parse'

export const ROBOTS_CHECK_DETAIL_VERSION = 1
/** Declared sitemaps fetched per check; overflow -> sitemapsSkipped. */
export const ROBOTS_CHECK_MAX_SITEMAPS = 5
/** Index children expanded per sitemap; overflow -> childrenSkipped. */
export const ROBOTS_CHECK_MAX_CHILDREN = 20
/** List/display cap. Retention keeps LIMIT+1 per (client, domain): one
 *  hidden predecessor so the oldest VISIBLE row's `changed` flag never
 *  flips to null when retention prunes its comparison target (Codex #3). */
export const ROBOTS_CHECK_HISTORY_LIMIT = 20
/** Soft deadline checked before every fetch. Worst case overshoot is one
 *  in-flight batch's 15s fetch timeout: hard bound ~= budget + 15s. */
export const ROBOTS_CHECK_TIME_BUDGET_MS = 60_000
/** Crawler-convention fallback probe order (matches sitemap-crawler). */
export const CONVENTION_SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/wp-sitemap.xml',
] as const

export type RobotsFetchStatus = 'ok' | 'missing' | 'unreachable'
export type RobotsCheckSource = 'manual' | 'scheduled'

export interface SitemapChildObservation {
  url: string
  /** sha256 hex of the child XML actually fetched; null = fetch failed. */
  contentHash: string | null
}

export interface SitemapCheckEntry {
  url: string
  /** Declared in robots.txt vs convention-path fallback probe. */
  source: 'robots' | 'convention'
  ok: boolean
  httpStatus: number | null
  /** SeoFetchFailure when the fetch failed, or the runner-level
   *  'unrecognized' when a convention probe fetched ok but parseSitemapXml
   *  did not recognize a sitemap document (Codex #4). Null when ok. */
  failure: string | null
  isIndex: boolean
  /** Total page locs (one-level index expansion); null when !ok. */
  urlCount: number | null
  /** ELIGIBLE children (the frozen collector host-filters BEFORE counting). */
  childrenTotal: number
  /** Child declarations dropped by the parent-host filter (Codex #6). */
  childrenExcluded: number
  /** Real fetch failures among expanded children (skips subtracted, clamped). */
  childrenFailed: number
  /** Children not attempted: beyond ROBOTS_CHECK_MAX_CHILDREN or time budget. */
  childrenSkipped: number
  /** sha256 hex of the fetched XML text; null when !ok. */
  contentHash: string | null
  /** (url, hash) per child actually fetched, in call order — child-level
   *  change evidence for indexes whose own XML is byte-identical (Codex #2). */
  children: SitemapChildObservation[]
  /** sha256 over the ordered children observations; null when none. */
  childrenHash: string | null
  /** parseSitemapXml issues for the top-level document only. */
  issues: SitemapIssue[]
}

export interface RobotsCheckDetail {
  v: 1
  domain: string
  robots: {
    status: RobotsFetchStatus
    httpStatus: number | null
    failure: string | null
    contentHash: string | null
    issues: RobotsIssue[]
    blockedBots: string[]
    sitemapUrls: string[]
  }
  sitemaps: SitemapCheckEntry[]
  /** Declared sitemaps not fetched (cap overflow or time budget). */
  sitemapsSkipped: number
  timeBudgetExhausted: boolean
  totals: {
    /** Sum of urlCount over ok entries; null when NO entry is ok. */
    sitemapUrlTotal: number | null
    errors: number
    warnings: number
  }
}

export interface RobotsCheckSummary {
  id: number
  domain: string
  source: string
  robotsStatus: RobotsFetchStatus
  sitemapUrlTotal: number | null
  errorCount: number
  warningCount: number
  /** vs previous row same (client,domain); null = first check or
   *  corrupt/unreadable comparison target. Render null as em dash, never
   *  as "unchanged". */
  changed: boolean | null
  createdAt: string
}
```

- [ ] **Step 5: Verify compile + commit**

Run: `npm run lint`
Expected: clean (types compile, schema valid).

```bash
git add prisma/schema.prisma prisma/migrations/20260713100000_robots_check/migration.sql lib/robots-check/types.ts
git commit -m "feat(d4): RobotsCheck schema + client-safe robots-check types"
```

---

### Task 2: The runner — `runRobotsCheck`

**Files:**
- Create: `lib/robots-check/runner.ts`
- Test: `lib/robots-check/runner.test.ts`

**Interfaces:**
- Consumes: `fetchRobotsTxt`, `fetchSitemapXml`, `collectSitemapPageUrls`, `SeoFetchResult` from `@/lib/seo-fetch/fetch`; `parseRobotsTxt` from `@/lib/seo-fetch/robots-parse`; `parseSitemapXml`, `isSitemapIndex`, `extractChildSitemapLocs` from `@/lib/seo-fetch/sitemap-parse`; Task 1 types.
- Produces (Task 3 consumes):
  - `interface RunnerDeps { fetchRobotsTxt(baseUrl: string): Promise<SeoFetchResult>; fetchSitemapXml(url: string): Promise<SeoFetchResult>; now(): number }`
  - `interface RobotsCheckRunResult { detail: RobotsCheckDetail; robotsContent: string | null }`
  - `async function runRobotsCheck(domain: string, deps?: RunnerDeps): Promise<RobotsCheckRunResult>` (default deps = real fetchers + `Date.now`)

- [ ] **Step 1: Write the failing tests**

Create `lib/robots-check/runner.test.ts`. Test helpers build `SeoFetchResult` values and a deps factory; the fake clock advances a fixed amount per `now()` call when configured. Full file:

```ts
// lib/robots-check/runner.test.ts
//
// D4 runner tests — all I/O via injected deps; zero network.
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { runRobotsCheck, type RunnerDeps } from './runner'
import type { SeoFetchResult } from '@/lib/seo-fetch/fetch'
import {
  ROBOTS_CHECK_MAX_CHILDREN,
  ROBOTS_CHECK_MAX_SITEMAPS,
  ROBOTS_CHECK_TIME_BUDGET_MS,
} from './types'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

function okResult(text: string, finalUrl: string): SeoFetchResult {
  return { ok: true, status: 200, text, finalUrl, failure: null, truncated: false }
}
function failResult(failure: SeoFetchResult['failure'] & string, status: number | null = null): SeoFetchResult {
  return { ok: false, status, text: null, finalUrl: null, failure, truncated: false }
}
function httpError(status: number): SeoFetchResult {
  return { ok: false, status, text: null, finalUrl: `ignored`, failure: 'http-error', truncated: false }
}

const URLSET = (n: number) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
  Array.from({ length: n }, (_, i) => `<url><loc>https://example.com/p${i}</loc></url>`).join('') +
  `</urlset>`

const INDEX_OF = (childUrls: string[]) =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
  childUrls.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join('') +
  `</sitemapindex>`

/** deps whose sitemap fetcher answers from a url->result map. */
function makeDeps(opts: {
  robots: SeoFetchResult
  sitemaps?: Record<string, SeoFetchResult>
  msPerNowCall?: number
}): RunnerDeps & { calls: string[] } {
  let t = 0
  const calls: string[] = []
  return {
    calls,
    fetchRobotsTxt: async () => opts.robots,
    fetchSitemapXml: async (url: string) => {
      calls.push(url)
      return opts.sitemaps?.[url] ?? failResult('network')
    },
    now: () => {
      t += opts.msPerNowCall ?? 0
      return t
    },
  }
}

describe('runRobotsCheck — robots phase', () => {
  it('ok robots: parses issues/blocked bots, hashes body, returns raw content beside detail', async () => {
    const body = 'User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nDisallow: /\n'
    const deps = makeDeps({ robots: okResult(body, 'https://example.com/robots.txt') })
    const { detail, robotsContent } = await runRobotsCheck('example.com', deps)
    expect(detail.v).toBe(1)
    expect(detail.robots.status).toBe('ok')
    expect(detail.robots.contentHash).toBe(sha(body))
    expect(robotsContent).toBe(body)
    expect(detail.robots.blockedBots).toContain('GPTBot')
  })

  it('404 -> missing (one warning, no error), 410 -> missing', async () => {
    for (const status of [404, 410]) {
      const deps = makeDeps({ robots: httpError(status) })
      const { detail, robotsContent } = await runRobotsCheck('example.com', deps)
      expect(detail.robots.status).toBe('missing')
      expect(detail.robots.httpStatus).toBe(status)
      expect(robotsContent).toBeNull()
      expect(detail.robots.contentHash).toBeNull()
    }
  })

  it('dns failure -> unreachable with taxonomy verbatim, one synthetic error', async () => {
    const deps = makeDeps({ robots: failResult('dns') })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.robots.status).toBe('unreachable')
    expect(detail.robots.failure).toBe('dns')
    expect(detail.totals.errors).toBeGreaterThanOrEqual(1)
  })

  it('500 -> unreachable (only 404/410 are missing)', async () => {
    const deps = makeDeps({ robots: httpError(500) })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.robots.status).toBe('unreachable')
  })
})

describe('runRobotsCheck — declared sitemaps', () => {
  it('fetches declared sitemaps in order, caps at MAX_SITEMAPS with sitemapsSkipped', async () => {
    const declared = Array.from({ length: 7 }, (_, i) => `https://example.com/sm${i}.xml`)
    const robots = 'User-agent: *\nAllow: /\n' + declared.map((u) => `Sitemap: ${u}`).join('\n')
    const sitemaps = Object.fromEntries(declared.map((u) => [u, okResult(URLSET(3), u)]))
    const deps = makeDeps({ robots: okResult(robots, 'https://example.com/robots.txt'), sitemaps })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps).toHaveLength(ROBOTS_CHECK_MAX_SITEMAPS)
    expect(detail.sitemapsSkipped).toBe(7 - ROBOTS_CHECK_MAX_SITEMAPS)
    expect(detail.sitemaps.every((s) => s.source === 'robots')).toBe(true)
    expect(detail.totals.sitemapUrlTotal).toBe(3 * ROBOTS_CHECK_MAX_SITEMAPS)
  })

  it('failed declared sitemap entry: !ok, failure recorded, urlCount null, counts one error', async () => {
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/sm.xml'
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: { 'https://example.com/sm.xml': failResult('timeout') },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps[0].ok).toBe(false)
    expect(detail.sitemaps[0].failure).toBe('timeout')
    expect(detail.sitemaps[0].urlCount).toBeNull()
    expect(detail.totals.sitemapUrlTotal).toBeNull() // no ok entry
    expect(detail.totals.errors).toBeGreaterThanOrEqual(1)
  })
})

describe('runRobotsCheck — index expansion', () => {
  it('expands one level, records child observations + childrenHash deterministically', async () => {
    const kids = ['https://example.com/a.xml', 'https://example.com/b.xml']
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/idx.xml'
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: {
        'https://example.com/idx.xml': okResult(INDEX_OF(kids), 'https://example.com/idx.xml'),
        [kids[0]]: okResult(URLSET(2), kids[0]),
        [kids[1]]: okResult(URLSET(5), kids[1]),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    const entry = detail.sitemaps[0]
    expect(entry.isIndex).toBe(true)
    expect(entry.urlCount).toBe(7)
    expect(entry.childrenTotal).toBe(2)
    expect(entry.childrenFailed).toBe(0)
    expect(entry.children).toEqual([
      { url: kids[0], contentHash: sha(URLSET(2)) },
      { url: kids[1], contentHash: sha(URLSET(5)) },
    ])
    const expectedAgg = sha(
      `${kids[0]}\n${sha(URLSET(2))}\n${kids[1]}\n${sha(URLSET(5))}`,
    )
    expect(entry.childrenHash).toBe(expectedAgg)
    // Same inputs -> same hash (determinism)
    const again = await runRobotsCheck('example.com', deps)
    expect(again.detail.sitemaps[0].childrenHash).toBe(expectedAgg)
  })

  it('caps children at MAX_CHILDREN: skipped counted, childrenFailed clamped to real failures', async () => {
    const kids = Array.from({ length: ROBOTS_CHECK_MAX_CHILDREN + 5 }, (_, i) => `https://example.com/k${i}.xml`)
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/idx.xml'
    const sitemaps: Record<string, SeoFetchResult> = {
      'https://example.com/idx.xml': okResult(INDEX_OF(kids), 'https://example.com/idx.xml'),
    }
    for (const k of kids) sitemaps[k] = okResult(URLSET(1), k)
    // one real failure among the attempted
    sitemaps[kids[0]] = failResult('http-error', 500)
    const deps = makeDeps({ robots: okResult(robots, 'https://example.com/robots.txt'), sitemaps })
    const { detail } = await runRobotsCheck('example.com', deps)
    const entry = detail.sitemaps[0]
    expect(entry.childrenSkipped).toBe(5)
    expect(entry.childrenFailed).toBe(1)
    expect(entry.children).toHaveLength(ROBOTS_CHECK_MAX_CHILDREN)
  })

  it('cross-host children are excluded by the parent-host filter and counted', async () => {
    const kids = ['https://example.com/a.xml', 'https://cdn.other.com/b.xml']
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/idx.xml'
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: {
        'https://example.com/idx.xml': okResult(INDEX_OF(kids), 'https://example.com/idx.xml'),
        [kids[0]]: okResult(URLSET(2), kids[0]),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    const entry = detail.sitemaps[0]
    expect(entry.childrenTotal).toBe(1) // eligible only
    expect(entry.childrenExcluded).toBe(1)
    expect(entry.urlCount).toBe(2)
  })

  it('www-insensitive parent-host match keeps www children of a bare-host sitemap', async () => {
    const kids = ['https://www.example.com/a.xml']
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/idx.xml'
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: {
        'https://example.com/idx.xml': okResult(INDEX_OF(kids), 'https://example.com/idx.xml'),
        [kids[0]]: okResult(URLSET(4), kids[0]),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps[0].childrenTotal).toBe(1)
    expect(detail.sitemaps[0].urlCount).toBe(4)
  })
})

describe('runRobotsCheck — convention fallback', () => {
  it('robots missing: probes convention paths in order, recognized winner recorded as convention', async () => {
    const deps = makeDeps({
      robots: httpError(404),
      sitemaps: {
        // /sitemap.xml 404s, /sitemap_index.xml wins
        'https://example.com/sitemap.xml': httpError(404),
        'https://example.com/sitemap_index.xml': okResult(URLSET(9), 'https://example.com/sitemap_index.xml'),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps).toHaveLength(1)
    expect(detail.sitemaps[0].source).toBe('convention')
    expect(detail.sitemaps[0].url).toBe('https://example.com/sitemap_index.xml')
    expect(detail.sitemaps[0].urlCount).toBe(9)
    // probing stopped at the winner
    expect(deps.calls).not.toContain('https://example.com/wp-sitemap.xml')
  })

  it('200 text/plain garbage does NOT win; recorded as unrecognized with parse issues when nothing qualifies', async () => {
    const garbage = 'this is not xml at all'
    const deps = makeDeps({
      robots: httpError(404),
      sitemaps: {
        'https://example.com/sitemap.xml': okResult(garbage, 'https://example.com/sitemap.xml'),
        'https://example.com/sitemap_index.xml': httpError(404),
        'https://example.com/wp-sitemap.xml': httpError(404),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps).toHaveLength(1)
    const entry = detail.sitemaps[0]
    expect(entry.ok).toBe(false)
    expect(entry.failure).toBe('unrecognized')
    expect(entry.contentHash).toBe(sha(garbage)) // change evidence retained
    expect(entry.issues.length).toBeGreaterThan(0)
    expect(detail.totals.sitemapUrlTotal).toBeNull()
  })

  it('malformed XML with a usable loc does NOT win; a later valid path does (plan-Codex #3)', async () => {
    // Mismatched root tag but contains a <loc> — parseSitemapXml must report
    // it invalid, so the probe loop continues to the next convention path.
    const malformed = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/p1</loc></url></wrongclose>`
    const deps = makeDeps({
      robots: httpError(404),
      sitemaps: {
        'https://example.com/sitemap.xml': okResult(malformed, 'https://example.com/sitemap.xml'),
        'https://example.com/sitemap_index.xml': okResult(URLSET(3), 'https://example.com/sitemap_index.xml'),
      },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps).toHaveLength(1)
    expect(detail.sitemaps[0].url).toBe('https://example.com/sitemap_index.xml')
    expect(detail.sitemaps[0].urlCount).toBe(3)
    // NOTE for implementer: if parseSitemapXml judges this exact fixture
    // valid, pick any fixture parseSitemapXml reports invalid (check its 13
    // rules) — the pinned behavior is "invalid parse does not win", not this
    // particular XML string.
  })

  it('all probes fail: last probe failure recorded as the single honest entry', async () => {
    const deps = makeDeps({ robots: httpError(404) }) // every sitemap fetch -> network fail
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps).toHaveLength(1)
    expect(detail.sitemaps[0].ok).toBe(false)
    expect(detail.sitemaps[0].url).toBe('https://example.com/wp-sitemap.xml')
  })

  it('robots ok but zero declared sitemaps also falls back to convention probing', async () => {
    const deps = makeDeps({
      robots: okResult('User-agent: *\nAllow: /\n', 'https://example.com/robots.txt'),
      sitemaps: { 'https://example.com/sitemap.xml': okResult(URLSET(2), 'https://example.com/sitemap.xml') },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.sitemaps[0].source).toBe('convention')
    expect(detail.sitemaps[0].urlCount).toBe(2)
  })
})

describe('runRobotsCheck — time budget', () => {
  it('exhausted budget skips remaining sitemaps and sets the flag', async () => {
    const declared = ['https://example.com/sm0.xml', 'https://example.com/sm1.xml']
    const robots = 'User-agent: *\nAllow: /\n' + declared.map((u) => `Sitemap: ${u}`).join('\n')
    // Each now() call advances far past the budget: the first pre-fetch
    // deadline check already sees it exhausted.
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: Object.fromEntries(declared.map((u) => [u, okResult(URLSET(1), u)])),
      msPerNowCall: ROBOTS_CHECK_TIME_BUDGET_MS,
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.timeBudgetExhausted).toBe(true)
    expect(detail.sitemaps.length).toBeLessThan(declared.length)
    expect(detail.sitemapsSkipped).toBeGreaterThan(0)
  })
})

describe('runRobotsCheck — totals', () => {
  it('missing robots adds one warning; unreachable adds one error; failed sitemap adds one error', async () => {
    const missing = await runRobotsCheck('example.com', makeDeps({ robots: httpError(404) }))
    expect(missing.detail.totals.warnings).toBeGreaterThanOrEqual(1)

    const unreachable = await runRobotsCheck('example.com', makeDeps({ robots: failResult('timeout') }))
    expect(unreachable.detail.totals.errors).toBeGreaterThanOrEqual(1)
  })

  it('sitemapUrlTotal is 0 (not null) when an ok sitemap has zero locs', async () => {
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/empty.xml'
    const empty = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`
    const deps = makeDeps({
      robots: okResult(robots, 'https://example.com/robots.txt'),
      sitemaps: { 'https://example.com/empty.xml': okResult(empty, 'https://example.com/empty.xml') },
    })
    const { detail } = await runRobotsCheck('example.com', deps)
    expect(detail.totals.sitemapUrlTotal).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/robots-check/runner.test.ts`
Expected: FAIL — `./runner` module not found.

- [ ] **Step 3: Implement the runner**

Create `lib/robots-check/runner.ts`:

```ts
// lib/robots-check/runner.ts
//
// D4 server-side check runner. Pure-ish: ALL I/O rides injected deps
// (default = the real lib/seo-fetch primitives, which wrap safeFetch —
// this module adds ZERO new fetch paths). Never touches the DB.
//
// Honest-flags contract: every cap or budget skip is counted and surfaced
// (sitemapsSkipped / childrenSkipped / childrenExcluded /
// timeBudgetExhausted) — no silent truncation.

import { createHash } from 'node:crypto'
import {
  fetchRobotsTxt,
  fetchSitemapXml,
  collectSitemapPageUrls,
  type SeoFetchResult,
} from '@/lib/seo-fetch/fetch'
import { parseRobotsTxt } from '@/lib/seo-fetch/robots-parse'
import {
  parseSitemapXml,
  isSitemapIndex,
  extractChildSitemapLocs,
} from '@/lib/seo-fetch/sitemap-parse'
import {
  CONVENTION_SITEMAP_PATHS,
  ROBOTS_CHECK_MAX_CHILDREN,
  ROBOTS_CHECK_MAX_SITEMAPS,
  ROBOTS_CHECK_TIME_BUDGET_MS,
  type RobotsCheckDetail,
  type SitemapCheckEntry,
  type SitemapChildObservation,
} from './types'

export interface RunnerDeps {
  fetchRobotsTxt: (baseUrl: string) => Promise<SeoFetchResult>
  fetchSitemapXml: (url: string) => Promise<SeoFetchResult>
  now: () => number
}

export interface RobotsCheckRunResult {
  detail: RobotsCheckDetail
  /** Raw robots body for the robotsContent column — server-only, never in detailJson (Codex #1). */
  robotsContent: string | null
}

const realDeps: RunnerDeps = { fetchRobotsTxt, fetchSitemapXml, now: Date.now }

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** www-insensitive host normalization for the child filter (Codex #6). */
function normHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export async function runRobotsCheck(
  domain: string,
  deps: RunnerDeps = realDeps,
): Promise<RobotsCheckRunResult> {
  const startedAt = deps.now()
  const budgetLeft = () => deps.now() - startedAt < ROBOTS_CHECK_TIME_BUDGET_MS
  let timeBudgetExhausted = false

  // ── Robots phase ─────────────────────────────────────────────────────────
  const robotsRes = await deps.fetchRobotsTxt(`https://${domain}`)
  let robotsContent: string | null = null
  let robots: RobotsCheckDetail['robots']
  if (robotsRes.ok) {
    const parsed = parseRobotsTxt(robotsRes.text)
    robotsContent = robotsRes.text
    robots = {
      status: 'ok',
      httpStatus: robotsRes.status,
      failure: null,
      contentHash: sha256Hex(robotsRes.text),
      issues: parsed.issues,
      blockedBots: parsed.blockedBots,
      sitemapUrls: parsed.sitemapUrls,
    }
  } else {
    const missing = robotsRes.failure === 'http-error' && (robotsRes.status === 404 || robotsRes.status === 410)
    robots = {
      status: missing ? 'missing' : 'unreachable',
      httpStatus: robotsRes.status,
      failure: robotsRes.failure,
      contentHash: null,
      issues: [],
      blockedBots: [],
      sitemapUrls: [],
    }
  }

  // ── One sitemap entry from an already-fetched result ─────────────────────
  async function buildEntry(
    url: string,
    source: 'robots' | 'convention',
    res: SeoFetchResult,
  ): Promise<SitemapCheckEntry> {
    if (!res.ok) {
      return {
        url, source, ok: false, httpStatus: res.status, failure: res.failure,
        isIndex: false, urlCount: null, childrenTotal: 0, childrenExcluded: 0,
        childrenFailed: 0, childrenSkipped: 0, contentHash: null,
        children: [], childrenHash: null, issues: [],
      }
    }
    const xml = res.text
    const parsed = parseSitemapXml(xml)
    const index = isSitemapIndex(xml)
    const parentHost = hostOf(res.finalUrl) ?? domain
    const parentNorm = normHost(parentHost)
    const isSameDomain = (u: string) => {
      const h = hostOf(u)
      return h !== null && normHost(h) === parentNorm
    }

    // Budget-capped child fetcher over the FROZEN collector: a skipped child
    // registers as null (= failed) inside collectSitemapPageUrls, so real
    // failures are derived by subtraction, clamped (Codex spec review).
    // The synchronous prelude (cap check, observation slot) runs in call
    // order even though the collector fires batches of 5 concurrently.
    let attempted = 0
    let skipped = 0
    const observations: SitemapChildObservation[] = []
    const cappedFetch = async (u: string): Promise<string | null> => {
      if (attempted >= ROBOTS_CHECK_MAX_CHILDREN || !budgetLeft()) {
        if (!budgetLeft()) timeBudgetExhausted = true
        skipped++
        return null
      }
      attempted++
      const slot = observations.length
      observations.push({ url: u, contentHash: null })
      const childRes = await deps.fetchSitemapXml(u)
      if (!childRes.ok) return null
      observations[slot] = { url: u, contentHash: sha256Hex(childRes.text) }
      return childRes.text
    }

    const collected = await collectSitemapPageUrls(xml, isSameDomain, cappedFetch)
    const childrenExcluded = index
      ? Math.max(0, extractChildSitemapLocs(xml).length - collected.childrenTotal)
      : 0
    const childrenHash = observations.length
      ? sha256Hex(observations.map((o) => `${o.url}\n${o.contentHash ?? 'failed'}`).join('\n'))
      : null

    return {
      url,
      source,
      ok: true,
      httpStatus: res.status,
      failure: null,
      isIndex: index,
      urlCount: collected.urls.length,
      childrenTotal: collected.childrenTotal,
      childrenExcluded,
      childrenFailed: Math.max(0, collected.childrenFailed - skipped),
      childrenSkipped: skipped,
      contentHash: sha256Hex(xml),
      children: observations,
      childrenHash,
      issues: parsed.issues,
    }
  }

  // ── Sitemap target selection ─────────────────────────────────────────────
  const sitemaps: SitemapCheckEntry[] = []
  let sitemapsSkipped = 0

  if (robots.sitemapUrls.length > 0) {
    const targets = robots.sitemapUrls.slice(0, ROBOTS_CHECK_MAX_SITEMAPS)
    sitemapsSkipped = robots.sitemapUrls.length - targets.length
    for (const url of targets) {
      if (!budgetLeft()) {
        timeBudgetExhausted = true
        sitemapsSkipped += targets.length - sitemaps.length
        break
      }
      sitemaps.push(await buildEntry(url, 'robots', await deps.fetchSitemapXml(url)))
    }
  } else {
    // Convention probing (Codex #4): a probe wins only when the fetch is ok
    // AND parseSitemapXml recognizes a sitemap document. Otherwise record
    // the most informative single outcome so the check is honest about
    // having looked.
    let lastOkUnrecognized: { url: string; res: SeoFetchResult & { ok: true } } | null = null
    let lastFailed: { url: string; res: SeoFetchResult & { ok: false } } | null = null
    for (const path of CONVENTION_SITEMAP_PATHS) {
      if (!budgetLeft()) {
        timeBudgetExhausted = true
        break
      }
      const url = `https://${domain}${path}`
      const res = await deps.fetchSitemapXml(url)
      if (!res.ok) {
        lastFailed = { url, res }
        continue
      }
      const parsed = parseSitemapXml(res.text)
      // Recognition = parsed.valid ONLY (plan-Codex #3): malformed XML that
      // happens to contain a usable <loc> must NOT win a convention probe.
      // Valid empty sitemap documents remain valid and DO win.
      const recognized = parsed.valid
      if (recognized) {
        sitemaps.push(await buildEntry(url, 'convention', res))
        lastOkUnrecognized = null
        lastFailed = null
        break
      }
      lastOkUnrecognized = { url, res }
    }
    if (sitemaps.length === 0 && lastOkUnrecognized) {
      const { url, res } = lastOkUnrecognized
      sitemaps.push({
        url, source: 'convention', ok: false, httpStatus: res.status,
        failure: 'unrecognized', isIndex: false, urlCount: null,
        childrenTotal: 0, childrenExcluded: 0, childrenFailed: 0,
        childrenSkipped: 0, contentHash: sha256Hex(res.text),
        children: [], childrenHash: null, issues: parseSitemapXml(res.text).issues,
      })
    } else if (sitemaps.length === 0 && lastFailed) {
      sitemaps.push(await buildEntry(lastFailed.url, 'convention', lastFailed.res))
    }
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  const issueCounts = (sev: 'error' | 'warning') =>
    robots.issues.filter((i) => i.severity === sev).length +
    sitemaps.reduce((n, s) => n + s.issues.filter((i) => i.severity === sev).length, 0)
  const failedEntries = sitemaps.filter((s) => !s.ok).length
  const errors = issueCounts('error') + (robots.status === 'unreachable' ? 1 : 0) + failedEntries
  const warnings = issueCounts('warning') + (robots.status === 'missing' ? 1 : 0)
  const okCounts = sitemaps.filter((s): s is SitemapCheckEntry & { urlCount: number } => s.ok && s.urlCount !== null)
  const sitemapUrlTotal = okCounts.length > 0 ? okCounts.reduce((n, s) => n + s.urlCount, 0) : null

  return {
    detail: {
      v: 1,
      domain,
      robots,
      sitemaps,
      sitemapsSkipped,
      timeBudgetExhausted,
      totals: { sitemapUrlTotal, errors, warnings },
    },
    robotsContent,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/robots-check/runner.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/robots-check/runner.ts lib/robots-check/runner.test.ts
git commit -m "feat(d4): robots-check runner over lib/seo-fetch (DI, honest caps, child change evidence)"
```

---

### Task 3: Service + retention

**Files:**
- Create: `lib/robots-check/service.ts`
- Create: `lib/robots-check/retention.ts`
- Modify: `lib/cleanup.ts` (add `pruneRobotsChecks()` to `runCleanup`)
- Test: `lib/robots-check/service.test.ts`, `lib/robots-check/retention.test.ts`

**Interfaces:**
- Consumes: Task 2 `runRobotsCheck(domain, deps?)` → `{ detail, robotsContent }`; Task 1 types; `prisma.robotsCheck`.
- Produces (Task 4/6 consume):
  - `interface StoredRobotsCheck { summary: RobotsCheckSummary; detail: RobotsCheckDetail }`
  - `function runAndStoreRobotsCheck(clientId: number, domain: string, opts: { source: RobotsCheckSource }): Promise<StoredRobotsCheck>` — single-flight per `clientId:domain`; throws `Error('invalid_source')` on a bad source.
  - `async function listRobotsChecks(clientId: number, domain?: string): Promise<RobotsCheckSummary[]>` — `(createdAt DESC, id DESC)`, max `ROBOTS_CHECK_HISTORY_LIMIT`, `changed` computed vs predecessor.
  - `async function getRobotsCheck(clientId: number, checkId: number): Promise<StoredRobotsCheck | null>` — null on not-found/wrong-client/corrupt detail.
  - `async function pruneRobotsChecks(): Promise<void>` (retention.ts).
  - Internal test seam: `runAndStoreRobotsCheck` accepts an optional 4th test-only param? NO — instead the service imports the runner and tests mock it with `vi.mock('./runner', ...)`.

- [ ] **Step 1: Write the failing service tests**

Create `lib/robots-check/service.test.ts`. Mock the runner module; DB-backed with PREFIX-scoped clients (house convention — `lib/keywords/retention.test.ts`):

```ts
// lib/robots-check/service.test.ts
//
// D4 service tests. Runner is mocked (unit seam); DB is the per-worker
// SQLite test DB. PREFIX-scoped clients, cascade delete cleans RobotsCheck.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import type { RobotsCheckDetail } from './types'

vi.mock('./runner', () => ({
  runRobotsCheck: vi.fn(),
}))
import { runRobotsCheck } from './runner'
import { runAndStoreRobotsCheck, listRobotsChecks, getRobotsCheck } from './service'

const mockRun = vi.mocked(runRobotsCheck)
const PREFIX = 'd4svc-'
let counter = 0

async function makeClient() {
  return prisma.client.create({ data: { name: `${PREFIX}${Date.now()}-${counter++}` } })
}

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

function detailFixture(overrides: {
  robotsHash?: string | null
  robotsStatus?: 'ok' | 'missing' | 'unreachable'
  sitemaps?: Array<{ url: string; contentHash: string | null; childrenHash: string | null }>
} = {}): RobotsCheckDetail {
  const sitemaps = (overrides.sitemaps ?? [{ url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: null }]).map(
    (s) => ({
      url: s.url, source: 'robots' as const, ok: s.contentHash !== null,
      httpStatus: 200, failure: null, isIndex: s.childrenHash !== null,
      urlCount: 3, childrenTotal: 0, childrenExcluded: 0, childrenFailed: 0,
      childrenSkipped: 0, contentHash: s.contentHash, children: [],
      childrenHash: s.childrenHash, issues: [],
    }),
  )
  return {
    v: 1, domain: 'x.com',
    robots: {
      status: overrides.robotsStatus ?? 'ok', httpStatus: 200, failure: null,
      contentHash: overrides.robotsHash === undefined ? 'rh1' : overrides.robotsHash,
      issues: [], blockedBots: [], sitemapUrls: [],
    },
    sitemaps, sitemapsSkipped: 0, timeBudgetExhausted: false,
    totals: { sitemapUrlTotal: 3, errors: 0, warnings: 1 },
  }
}

function arm(detail: RobotsCheckDetail, robotsContent: string | null = 'User-agent: *\n') {
  mockRun.mockResolvedValueOnce({ detail, robotsContent })
}

beforeEach(() => {
  mockRun.mockReset()
})

describe('runAndStoreRobotsCheck', () => {
  it('persists scalars incl. robotsContent and returns summary+detail; first check changed=null', async () => {
    const client = await makeClient()
    arm(detailFixture(), 'User-agent: *\nDisallow: /x\n')
    const { summary, detail } = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(summary.robotsStatus).toBe('ok')
    expect(summary.changed).toBeNull()
    expect(summary.source).toBe('manual')
    expect(detail.v).toBe(1)
    const row = await prisma.robotsCheck.findUnique({ where: { id: summary.id } })
    expect(row?.robotsContent).toBe('User-agent: *\nDisallow: /x\n')
    expect(row?.robotsContentHash).toBe('rh1')
    expect(row?.sitemapUrlTotal).toBe(3)
    expect(row?.warningCount).toBe(1)
  })

  it('rejects an invalid source', async () => {
    const client = await makeClient()
    await expect(
      // @ts-expect-error runtime validation test
      runAndStoreRobotsCheck(client.id, 'x.com', { source: 'cron' }),
    ).rejects.toThrow('invalid_source')
  })

  it('single-flight: two concurrent calls -> one runner invocation, one row, same result', async () => {
    const client = await makeClient()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    mockRun.mockImplementationOnce(async () => {
      await gate
      return { detail: detailFixture(), robotsContent: null }
    })
    const p1 = runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    const p2 = runAndStoreRobotsCheck(client.id, 'x.com', { source: 'scheduled' })
    release()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(r1.summary.id).toBe(r2.summary.id)
    expect(r1.summary.source).toBe('manual') // first caller's source stored
    expect(await prisma.robotsCheck.count({ where: { clientId: client.id } })).toBe(1)
  })

  it('a rejected run clears the in-flight slot (next call runs fresh) and does not write a row', async () => {
    const client = await makeClient()
    mockRun.mockRejectedValueOnce(new Error('boom'))
    await expect(runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })).rejects.toThrow('boom')
    expect(await prisma.robotsCheck.count({ where: { clientId: client.id } })).toBe(0)
    arm(detailFixture())
    const ok = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(ok.summary.robotsStatus).toBe('ok')
  })
})

describe('changed flag', () => {
  it('robots hash change / status change / sitemap-set change / childrenHash-only change all flip changed', async () => {
    const client = await makeClient()
    arm(detailFixture({ robotsHash: 'rh1' }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })

    arm(detailFixture({ robotsHash: 'rh2' }))
    const b = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(b.summary.changed).toBe(true)

    arm(detailFixture({ robotsHash: 'rh2' }))
    const c = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(c.summary.changed).toBe(false)

    // childrenHash-only change (index byte-identical, child churn) — Codex #2
    arm(detailFixture({ robotsHash: 'rh2', sitemaps: [{ url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: 'agg1' }] }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: 'rh2', sitemaps: [{ url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: 'agg2' }] }))
    const e = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(e.summary.changed).toBe(true)
  })

  it('robotsStatus change flips changed even with identical hashes (plan-Codex #6)', async () => {
    const client = await makeClient()
    arm(detailFixture({ robotsHash: null, robotsStatus: 'missing' }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: null, robotsStatus: 'unreachable' }))
    const b = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(b.summary.changed).toBe(true)
  })

  it('sitemap-set change (url added) flips changed (plan-Codex #6)', async () => {
    const client = await makeClient()
    arm(detailFixture({ sitemaps: [{ url: 'https://x.com/a.xml', contentHash: 'h1', childrenHash: null }] }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({
      sitemaps: [
        { url: 'https://x.com/a.xml', contentHash: 'h1', childrenHash: null },
        { url: 'https://x.com/b.xml', contentHash: 'h2', childrenHash: null },
      ],
    }))
    const b = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(b.summary.changed).toBe(true)
  })

  it('corrupt predecessor detailJson -> changed null, never a throw (both syntactic and structural corruption)', async () => {
    const client = await makeClient()
    arm(detailFixture())
    const first = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    await prisma.robotsCheck.update({ where: { id: first.summary.id }, data: { detailJson: '{not json' } })
    arm(detailFixture())
    const second = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(second.summary.changed).toBeNull()
    // Structural corruption: valid JSON, malformed shape (plan-Codex #2)
    await prisma.robotsCheck.update({ where: { id: second.summary.id }, data: { detailJson: '{"v":1,"sitemaps":[null]}' } })
    arm(detailFixture())
    const third = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(third.summary.changed).toBeNull()
  })

  it('changed is per (client,domain): another domain does not become the predecessor', async () => {
    const client = await makeClient()
    arm(detailFixture({ robotsHash: 'other' }))
    await runAndStoreRobotsCheck(client.id, 'other.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: 'rh1' }))
    const first = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(first.summary.changed).toBeNull()
  })
})

describe('listRobotsChecks / getRobotsCheck', () => {
  it('lists newest-first capped at the history limit with pairwise changed', async () => {
    const client = await makeClient()
    arm(detailFixture({ robotsHash: 'a' }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: 'b' }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    arm(detailFixture({ robotsHash: 'b' }))
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'scheduled' })
    const list = await listRobotsChecks(client.id, 'x.com')
    expect(list).toHaveLength(3)
    expect(list[0].changed).toBe(false)
    expect(list[1].changed).toBe(true)
    expect(list[2].changed).toBeNull()
    expect(list[0].source).toBe('scheduled')
  })

  it('interleaved domains: predecessor outside the fetched window is still found (plan-Codex #1)', async () => {
    const client = await makeClient()
    // Domain y.com gets ONE old check, then x.com fills the whole window.
    arm(detailFixture({ robotsHash: 'y-old' }))
    await runAndStoreRobotsCheck(client.id, 'y.com', { source: 'manual' })
    const { ROBOTS_CHECK_HISTORY_LIMIT } = await import('./types')
    for (let i = 0; i < ROBOTS_CHECK_HISTORY_LIMIT; i++) {
      arm(detailFixture({ robotsHash: 'x' }))
      await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    }
    arm(detailFixture({ robotsHash: 'y-new' }))
    await runAndStoreRobotsCheck(client.id, 'y.com', { source: 'manual' })
    // Unfiltered list: newest row is y.com; its y.com predecessor sits beyond
    // the LIMIT+1 window behind the x.com rows — must still resolve changed.
    const list = await listRobotsChecks(client.id)
    expect(list[0].domain).toBe('y.com')
    expect(list[0].changed).toBe(true) // y-old vs y-new — NOT null
  })

  it('getRobotsCheck enforces ownership and returns null on corrupt detail', async () => {
    const clientA = await makeClient()
    const clientB = await makeClient()
    arm(detailFixture())
    const { summary } = await runAndStoreRobotsCheck(clientA.id, 'x.com', { source: 'manual' })
    expect(await getRobotsCheck(clientB.id, summary.id)).toBeNull()
    const got = await getRobotsCheck(clientA.id, summary.id)
    expect(got?.detail.v).toBe(1)
    await prisma.robotsCheck.update({ where: { id: summary.id }, data: { detailJson: 'nope' } })
    expect(await getRobotsCheck(clientA.id, summary.id)).toBeNull()
  })
})
```

- [ ] **Step 2: Write the failing retention test**

Create `lib/robots-check/retention.test.ts`:

```ts
// lib/robots-check/retention.test.ts
//
// D4 retention: keep newest HISTORY_LIMIT+1 per (client, domain) by
// (createdAt DESC, id DESC) — the +1 hidden predecessor keeps the oldest
// VISIBLE row's changed flag stable across pruning (Codex #3).
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { pruneRobotsChecks } from './retention'
import { listRobotsChecks } from './service'
import { ROBOTS_CHECK_HISTORY_LIMIT } from './types'

const PREFIX = 'd4ret-'
let counter = 0

async function makeClient() {
  return prisma.client.create({ data: { name: `${PREFIX}${Date.now()}-${counter++}` } })
}

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

/** Structurally valid minimal detail (passes the service's parseDetail guard). */
function validDetailJson(hash: string): string {
  return JSON.stringify({
    v: 1, domain: 'x.com',
    robots: { status: 'ok', httpStatus: 200, failure: null, contentHash: hash, issues: [], blockedBots: [], sitemapUrls: [] },
    sitemaps: [], sitemapsSkipped: 0, timeBudgetExhausted: false,
    totals: { sitemapUrlTotal: null, errors: 0, warnings: 0 },
  })
}

function makeCheck(clientId: number, domain: string, createdAt: Date, hash = 'h') {
  return prisma.robotsCheck.create({
    data: {
      clientId, domain, source: 'manual', robotsStatus: 'ok',
      robotsContentHash: hash, robotsContent: 'User-agent: *\n',
      sitemapUrlTotal: 1, errorCount: 0, warningCount: 0,
      detailJson: validDetailJson(hash), createdAt,
    },
  })
}

describe('pruneRobotsChecks', () => {
  it('keeps LIMIT+1 newest per (client, domain); other domains and clients untouched', async () => {
    const clientA = await makeClient()
    const clientB = await makeClient()
    const base = Date.now() - 10_000_000
    const n = ROBOTS_CHECK_HISTORY_LIMIT + 5
    for (let i = 0; i < n; i++) {
      await makeCheck(clientA.id, 'x.com', new Date(base + i * 1000))
    }
    await makeCheck(clientA.id, 'y.com', new Date(base))
    await makeCheck(clientB.id, 'x.com', new Date(base))

    await pruneRobotsChecks()

    const aX = await prisma.robotsCheck.findMany({
      where: { clientId: clientA.id, domain: 'x.com' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    expect(aX).toHaveLength(ROBOTS_CHECK_HISTORY_LIMIT + 1)
    // newest survived, oldest pruned
    expect(aX[0].createdAt.getTime()).toBe(base + (n - 1) * 1000)
    expect(await prisma.robotsCheck.count({ where: { clientId: clientA.id, domain: 'y.com' } })).toBe(1)
    expect(await prisma.robotsCheck.count({ where: { clientId: clientB.id } })).toBe(1)
  })

  it('oldest VISIBLE row keeps a non-null changed after pruning (the +1 hidden predecessor — Codex #3, plan-Codex #6)', async () => {
    const client = await makeClient()
    const base = Date.now() - 10_000_000
    // LIMIT+3 rows, alternating hashes so every pair is changed:true
    for (let i = 0; i < ROBOTS_CHECK_HISTORY_LIMIT + 3; i++) {
      await makeCheck(client.id, 'x.com', new Date(base + i * 1000), i % 2 === 0 ? 'ha' : 'hb')
    }
    await pruneRobotsChecks()
    const list = await listRobotsChecks(client.id, 'x.com')
    expect(list).toHaveLength(ROBOTS_CHECK_HISTORY_LIMIT)
    const oldestVisible = list[list.length - 1]
    expect(oldestVisible.changed).toBe(true) // predecessor survived as the hidden +1 row
  })
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/robots-check/service.test.ts lib/robots-check/retention.test.ts`
Expected: FAIL — `./service` / `./retention` not found.

- [ ] **Step 4: Implement the service**

Create `lib/robots-check/service.ts`:

```ts
// lib/robots-check/service.ts
//
// D4 persist/read layer. Single-flight per clientId:domain follows
// lib/keywords/gsc-snapshot.ts, INCLUDING the crash lesson: the .finally()
// cleanup chain is a DERIVED promise that re-rejects — it carries its own
// no-op .catch, or a rejected run becomes an unhandledRejection and crashes
// the process.
//
// `changed` is computed at READ time (never persisted) so D5 can refine the
// comparison semantics without a backfill. Comparison evidence: robotsStatus,
// robots contentHash, and the ordered (url, contentHash, childrenHash)
// triples — childrenHash catches child-sitemap churn under a byte-identical
// index (Codex #2).

import { prisma } from '@/lib/db'
import type { RobotsCheck } from '@prisma/client'
import { runRobotsCheck } from './runner'
import {
  ROBOTS_CHECK_HISTORY_LIMIT,
  type RobotsCheckDetail,
  type RobotsCheckSource,
  type RobotsCheckSummary,
  type RobotsFetchStatus,
} from './types'

export interface StoredRobotsCheck {
  summary: RobotsCheckSummary
  detail: RobotsCheckDetail
}

/** Structural guard for the fields the service and card actually read
 *  (plan-Codex #2): syntactically valid but malformed JSON (e.g.
 *  {"v":1,"sitemaps":[null]}) must decode to null, never throw downstream. */
function parseDetail(json: string): RobotsCheckDetail | null {
  try {
    const parsed = JSON.parse(json) as RobotsCheckDetail
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) return null
    const r = parsed.robots
    if (!r || typeof r !== 'object' || typeof r.status !== 'string') return null
    if (!Array.isArray(r.issues) || !Array.isArray(r.blockedBots) || !Array.isArray(r.sitemapUrls)) return null
    if (!Array.isArray(parsed.sitemaps)) return null
    for (const s of parsed.sitemaps) {
      if (!s || typeof s !== 'object' || typeof s.url !== 'string' || typeof s.ok !== 'boolean') return null
      if (s.contentHash !== null && typeof s.contentHash !== 'string') return null
      if (s.childrenHash !== null && typeof s.childrenHash !== 'string') return null
      if (!Array.isArray(s.issues)) return null
    }
    if (!parsed.totals || typeof parsed.totals !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/** Comparison evidence; JSON.stringify avoids delimiter ambiguity in URLs
 *  (plan-Codex #2). Null when the detail is unreadable. */
function evidenceOf(row: Pick<RobotsCheck, 'robotsStatus' | 'robotsContentHash' | 'detailJson'>): string | null {
  const detail = parseDetail(row.detailJson)
  if (!detail) return null
  return JSON.stringify([
    row.robotsStatus,
    row.robotsContentHash,
    detail.sitemaps.map((s) => [s.url, s.contentHash, s.childrenHash]),
  ])
}

function changedVs(prev: RobotsCheck | null | undefined, row: RobotsCheck): boolean | null {
  if (!prev) return null
  const a = evidenceOf(prev)
  const b = evidenceOf(row)
  if (a === null || b === null) return null
  return a !== b
}

function toSummary(row: RobotsCheck, changed: boolean | null): RobotsCheckSummary {
  return {
    id: row.id,
    domain: row.domain,
    source: row.source,
    robotsStatus: row.robotsStatus as RobotsFetchStatus,
    sitemapUrlTotal: row.sitemapUrlTotal,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    changed,
    createdAt: row.createdAt.toISOString(),
  }
}

// ── Single-flight ───────────────────────────────────────────────────────────
// Entry installed synchronously (no await between lookup and set), so two
// concurrent calls for the same key always observe one in-flight promise.
const inFlight = new Map<string, Promise<StoredRobotsCheck>>()

export function runAndStoreRobotsCheck(
  clientId: number,
  domain: string,
  opts: { source: RobotsCheckSource },
): Promise<StoredRobotsCheck> {
  if (opts.source !== 'manual' && opts.source !== 'scheduled') {
    return Promise.reject(new Error('invalid_source'))
  }
  const key = `${clientId}:${domain}`
  const existing = inFlight.get(key)
  // A joiner gets the same row; the FIRST caller's source is what is stored
  // (documented in the spec — both callers observe identical data).
  if (existing) return existing

  const promise = (async (): Promise<StoredRobotsCheck> => {
    const { detail, robotsContent } = await runRobotsCheck(domain)
    const row = await prisma.robotsCheck.create({
      data: {
        clientId,
        domain,
        source: opts.source,
        robotsStatus: detail.robots.status,
        robotsContentHash: detail.robots.contentHash,
        robotsContent,
        sitemapUrlTotal: detail.totals.sitemapUrlTotal,
        errorCount: detail.totals.errors,
        warningCount: detail.totals.warnings,
        detailJson: JSON.stringify(detail),
      },
    })
    const prev = await prisma.robotsCheck.findFirst({
      // Exact total-order predecessor predicate — identical to
      // getRobotsCheck's (plan-Codex #1).
      where: {
        clientId,
        domain,
        OR: [
          { createdAt: { lt: row.createdAt } },
          { createdAt: row.createdAt, id: { lt: row.id } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return { summary: toSummary(row, changedVs(prev, row)), detail }
  })()

  inFlight.set(key, promise)
  const cleanup = promise.finally(() => {
    inFlight.delete(key)
  })
  cleanup.catch(() => { /* rejection already surfaces via the returned promise */ })
  return promise
}

/** Newest-first summaries, capped at the history limit, pairwise changed
 *  within the SAME domain. When a row's predecessor is not inside the
 *  fetched window (interleaved multi-domain lists), it is fetched with a
 *  targeted exact total-order query — at most one extra query per domain
 *  present in the window (plan-Codex #1). Retention retains +1 per
 *  (client, domain) so the true oldest row's predecessor exists in the DB. */
export async function listRobotsChecks(clientId: number, domain?: string): Promise<RobotsCheckSummary[]> {
  const rows = await prisma.robotsCheck.findMany({
    where: { clientId, ...(domain ? { domain } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: ROBOTS_CHECK_HISTORY_LIMIT + 1,
  })
  const visible = rows.slice(0, ROBOTS_CHECK_HISTORY_LIMIT)
  const summaries: RobotsCheckSummary[] = []
  for (let i = 0; i < visible.length; i++) {
    const row = visible[i]
    let prev: RobotsCheck | null = rows.slice(i + 1).find((r) => r.domain === row.domain) ?? null
    if (!prev) {
      prev = await prisma.robotsCheck.findFirst({
        where: {
          clientId,
          domain: row.domain,
          OR: [
            { createdAt: { lt: row.createdAt } },
            { createdAt: row.createdAt, id: { lt: row.id } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    }
    summaries.push(toSummary(row, changedVs(prev, row)))
  }
  return summaries
}

export async function getRobotsCheck(clientId: number, checkId: number): Promise<StoredRobotsCheck | null> {
  const row = await prisma.robotsCheck.findFirst({ where: { id: checkId, clientId } })
  if (!row) return null
  const detail = parseDetail(row.detailJson)
  if (!detail) return null
  const prev = await prisma.robotsCheck.findFirst({
    where: {
      clientId,
      domain: row.domain,
      id: { not: row.id },
      OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  return { summary: toSummary(row, changedVs(prev, row)), detail }
}
```

- [ ] **Step 5: Implement retention + wire into cleanup**

Create `lib/robots-check/retention.ts`:

```ts
// lib/robots-check/retention.ts
//
// D4: keep the newest ROBOTS_CHECK_HISTORY_LIMIT + 1 RobotsCheck rows per
// (clientId, domain) — the +1 hidden predecessor keeps the oldest VISIBLE
// row's read-time `changed` flag stable when its comparison target would
// otherwise be pruned (Codex #3). Tagged $executeRaw with quoted
// identifiers only (KS-1 retention precedent); ordering matches the
// service's (createdAt DESC, id DESC) everywhere.

import { prisma } from '@/lib/db'
import { ROBOTS_CHECK_HISTORY_LIMIT } from './types'

const KEEP = ROBOTS_CHECK_HISTORY_LIMIT + 1

export async function pruneRobotsChecks(): Promise<void> {
  const count = await prisma.$executeRaw`
    DELETE FROM "RobotsCheck" WHERE "id" NOT IN (
      SELECT "id" FROM "RobotsCheck" AS "keep"
      WHERE "keep"."clientId" = "RobotsCheck"."clientId"
        AND "keep"."domain" = "RobotsCheck"."domain"
      ORDER BY "keep"."createdAt" DESC, "keep"."id" DESC
      LIMIT ${KEEP}
    )
  `
  if (count > 0) console.log(`[robots-check] pruned ${count} stale RobotsCheck row(s)`)
}
```

In `lib/cleanup.ts`: add the import and the call:

```ts
import { pruneRobotsChecks } from '@/lib/robots-check/retention';
```

and inside `runCleanup()`'s `Promise.allSettled([...])`, after `sweepStaleReservations(new Date()),`:

```ts
    pruneRobotsChecks(),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/robots-check/service.test.ts lib/robots-check/retention.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/robots-check/service.ts lib/robots-check/retention.ts lib/robots-check/service.test.ts lib/robots-check/retention.test.ts lib/cleanup.ts
git commit -m "feat(d4): robots-check service (single-flight, read-time changed) + keep-LIMIT+1 retention in runCleanup"
```

---

### Task 4: API routes

**Files:**
- Create: `app/api/clients/[id]/robots-checks/route.ts` (GET list + POST run)
- Create: `app/api/clients/[id]/robots-checks/[checkId]/route.ts` (GET detail)
- Test: `app/api/clients/[id]/robots-checks/route.test.ts`

**Interfaces:**
- Consumes: Task 3 service functions; `withRoute` from `@/lib/api/with-route`; `parseJsonBody` from `@/lib/api/body`; `normalizeClientDomain`, `InvalidDomainError` from `@/lib/security/domain-validation`.
- Produces: `POST /api/clients/[id]/robots-checks` `{domain}` → 200 `{ summary, detail }`; `GET …/robots-checks?domain=` → 200 `{ checks }`; `GET …/robots-checks/[checkId]` → 200 `{ summary, detail }`. Cookie-gated by location — NO middleware change.

- [ ] **Step 1: Write the failing route tests**

Create `app/api/clients/[id]/robots-checks/route.test.ts`:

```ts
// app/api/clients/[id]/robots-checks/route.test.ts
//
// D4 route tests. Service is mocked for POST behavior; validation paths are
// exercised against the real DB (PREFIX clients). Auth is middleware-level
// (cookie gate), NOT tested here — the route lives under /api/clients/.
import { describe, it, expect, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

vi.mock('@/lib/robots-check/service', () => ({
  runAndStoreRobotsCheck: vi.fn(),
  listRobotsChecks: vi.fn().mockResolvedValue([]),
  getRobotsCheck: vi.fn(),
}))
import { runAndStoreRobotsCheck, getRobotsCheck } from '@/lib/robots-check/service'
import { GET, POST } from './route'
import { GET as GET_DETAIL } from './[checkId]/route'

const mockRun = vi.mocked(runAndStoreRobotsCheck)
const mockGet = vi.mocked(getRobotsCheck)
const PREFIX = 'd4route-'
let counter = 0

async function makeClient(domains: string[] = ['example.com'], archivedAt: Date | null = null) {
  return prisma.client.create({
    data: { name: `${PREFIX}${Date.now()}-${counter++}`, domains: JSON.stringify(domains), archivedAt },
  })
}

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/clients/1/robots-checks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const detailParams = (id: string, checkId: string) => ({ params: Promise.resolve({ id, checkId }) })

describe('POST /api/clients/[id]/robots-checks', () => {
  it('400 invalid id (strict: abc, 01, 1.0, +1, 1e2) / 404 unknown client / 409 archived', async () => {
    for (const bad of ['abc', '01', '1.0', '+1', '1e2', '0', '-1']) {
      expect((await POST(postReq({ domain: 'example.com' }), params(bad))).status).toBe(400)
    }
    expect((await POST(postReq({ domain: 'example.com' }), params('999999'))).status).toBe(404)
    const archived = await makeClient(['example.com'], new Date())
    const res = await POST(postReq({ domain: 'example.com' }), params(String(archived.id)))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('client_archived')
  })

  it('JSON null body -> 400 invalid_domain, never a 500 (plan-Codex #4)', async () => {
    const client = await makeClient(['example.com'])
    const res = await POST(postReq(null), params(String(client.id)))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_domain')
  })

  it('400 invalid_domain and 400 domain_not_listed', async () => {
    const client = await makeClient(['example.com'])
    const bad = await POST(postReq({ domain: 'http://ex ample' }), params(String(client.id)))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_domain')
    const notListed = await POST(postReq({ domain: 'other.com' }), params(String(client.id)))
    expect(notListed.status).toBe(400)
    expect((await notListed.json()).error).toBe('domain_not_listed')
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('runs the check with source manual and returns summary+detail', async () => {
    const client = await makeClient(['example.com'])
    mockRun.mockResolvedValueOnce({
      summary: { id: 1, domain: 'example.com', source: 'manual', robotsStatus: 'ok', sitemapUrlTotal: 2, errorCount: 0, warningCount: 0, changed: null, createdAt: new Date().toISOString() },
      detail: { v: 1 } as never,
    })
    const res = await POST(postReq({ domain: 'example.com' }), params(String(client.id)))
    expect(res.status).toBe(200)
    expect(mockRun).toHaveBeenCalledWith(client.id, 'example.com', { source: 'manual' })
    const body = await res.json()
    expect(body.summary.robotsStatus).toBe('ok')
  })

  it('malformed JSON body -> 400', async () => {
    const client = await makeClient(['example.com'])
    const req = new NextRequest('http://localhost/x', { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } })
    const res = await POST(req, params(String(client.id)))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/clients/[id]/robots-checks', () => {
  it('400 invalid id / 404 unknown / 200 list; domain filter: syntax AND membership validated (plan-Codex #4)', async () => {
    expect((await GET(new NextRequest('http://localhost/x'), params('0'))).status).toBe(400)
    expect((await GET(new NextRequest('http://localhost/x'), params('999999'))).status).toBe(404)
    const client = await makeClient(['example.com'])
    const ok = await GET(new NextRequest('http://localhost/x'), params(String(client.id)))
    expect(ok.status).toBe(200)
    expect((await ok.json()).checks).toEqual([])
    const badDomain = await GET(new NextRequest('http://localhost/x?domain=..bad..'), params(String(client.id)))
    expect(badDomain.status).toBe(400)
    expect((await badDomain.json()).error).toBe('invalid_domain')
    const notListed = await GET(new NextRequest('http://localhost/x?domain=other.com'), params(String(client.id)))
    expect(notListed.status).toBe(400)
    expect((await notListed.json()).error).toBe('domain_not_listed')
  })
})

describe('GET /api/clients/[id]/robots-checks/[checkId]', () => {
  it('404 on not-found/unowned/corrupt (service null); 200 with summary+detail', async () => {
    const client = await makeClient(['example.com'])
    mockGet.mockResolvedValueOnce(null)
    expect((await GET_DETAIL(new NextRequest('http://localhost/x'), detailParams(String(client.id), '123'))).status).toBe(404)
    mockGet.mockResolvedValueOnce({ summary: { id: 5 } as never, detail: { v: 1 } as never })
    const ok = await GET_DETAIL(new NextRequest('http://localhost/x'), detailParams(String(client.id), '5'))
    expect(ok.status).toBe(200)
    expect((await ok.json()).summary.id).toBe(5)
    expect((await GET_DETAIL(new NextRequest('http://localhost/x'), detailParams(String(client.id), 'NaN'))).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/clients/[id]/robots-checks/route.test.ts"`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement the routes**

Create `app/api/clients/[id]/robots-checks/route.ts`:

```ts
// GET  /api/clients/[id]/robots-checks       — history summaries (optional ?domain=)
// POST /api/clients/[id]/robots-checks       — run a check now (body {domain})
//
// Internal UI-facing routes: cookie-gated by the middleware (NOT in
// isPublicPath) — no middleware change. Domain is re-validated server-side
// against the client's registered domains (schedules-route pattern): only
// client-registered domains ever get RobotsCheck rows.
//
// A POST is synchronous (checks are seconds; hard bound ~= 60s budget +
// one 15s in-flight fetch window). Fetch failures are NOT HTTP errors —
// an unreachable domain is a successfully-recorded observation.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { parseJsonBody } from '@/lib/api/body'
import { normalizeClientDomain, InvalidDomainError } from '@/lib/security/domain-validation'
import { listRobotsChecks, runAndStoreRobotsCheck } from '@/lib/robots-check/service'

type Params = { params: Promise<{ id: string }> }

// Strict id parser (plan-Codex #4): '01', '1.0', '+1', '1e2' all rejected.
function parseClientId(raw: string): number | null {
  return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null
}

function parseClientDomains(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : []
  } catch {
    return []
  }
}

/** Normalize + membership-check a submitted domain against the client's
 *  registered domains. Returns the normalized domain or an error Response —
 *  GET and POST validate identically (plan-Codex #4). */
function resolveListedDomain(rawDomain: unknown, clientDomains: string): string | NextResponse {
  let domain: string
  try {
    domain = normalizeClientDomain(rawDomain)
  } catch (err) {
    if (err instanceof InvalidDomainError) {
      return NextResponse.json({ error: 'invalid_domain' }, { status: 400 })
    }
    throw err
  }
  if (!parseClientDomains(clientDomains).includes(domain)) {
    return NextResponse.json({ error: 'domain_not_listed' }, { status: 400 })
  }
  return domain
}

export const GET = withRoute(async (request: NextRequest, { params }: Params) => {
  const clientId = parseClientId((await params).id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client' }, { status: 400 })
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { domains: true } })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const rawDomain = request.nextUrl.searchParams.get('domain')
  let domain: string | undefined
  if (rawDomain !== null) {
    const resolved = resolveListedDomain(rawDomain, client.domains)
    if (resolved instanceof NextResponse) return resolved
    domain = resolved
  }
  return NextResponse.json({ checks: await listRobotsChecks(clientId, domain) })
})

export const POST = withRoute(async (request: NextRequest, { params }: Params) => {
  const clientId = parseClientId((await params).id)
  if (clientId === null) return NextResponse.json({ error: 'invalid_client' }, { status: 400 })

  // unknown, not Record: a JSON `null` body must fall through to
  // invalid_domain, not throw into a 500 (plan-Codex #4).
  const body = await parseJsonBody<unknown>(request)
  const rawDomain = body && typeof body === 'object' ? (body as Record<string, unknown>).domain : undefined

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { archivedAt: true, domains: true },
  })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (client.archivedAt) return NextResponse.json({ error: 'client_archived' }, { status: 409 })

  const resolved = resolveListedDomain(rawDomain, client.domains)
  if (resolved instanceof NextResponse) return resolved

  const stored = await runAndStoreRobotsCheck(clientId, resolved, { source: 'manual' })
  return NextResponse.json(stored)
})
```

Create `app/api/clients/[id]/robots-checks/[checkId]/route.ts`:

```ts
// GET /api/clients/[id]/robots-checks/[checkId] — one check's summary+detail.
// Cookie-gated by the middleware; ownership enforced in the service
// (checkId AND clientId must match). 404 covers not-found, unowned, and
// corrupt-detail alike — no information leak about other clients' rows.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withRoute } from '@/lib/api/with-route'
import { getRobotsCheck } from '@/lib/robots-check/service'

type Params = { params: Promise<{ id: string; checkId: string }> }

// Strict id parser (plan-Codex #4) — same contract as the list route.
function parsePositiveInt(raw: string): number | null {
  return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null
}

export const GET = withRoute(async (_request: NextRequest, { params }: Params) => {
  const { id, checkId: rawCheckId } = await params
  const clientId = parsePositiveInt(id)
  const checkId = parsePositiveInt(rawCheckId)
  if (clientId === null || checkId === null) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })
  if (!client) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const stored = await getRobotsCheck(clientId, checkId)
  if (!stored) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(stored)
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run "app/api/clients/[id]/robots-checks/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/clients/[id]/robots-checks/route.ts" "app/api/clients/[id]/robots-checks/[checkId]/route.ts" "app/api/clients/[id]/robots-checks/route.test.ts"
git commit -m "feat(d4): robots-checks routes (run/list/detail) under the cookie gate"
```

---

### Task 5: `RobotsCheckCard` component

**Files:**
- Create: `components/clients/RobotsCheckCard.tsx`
- Test: `components/clients/RobotsCheckCard.test.tsx`

**Interfaces:**
- Consumes: Task 1 types (`RobotsCheckSummary`, `RobotsCheckDetail`, `RobotsFetchStatus`); routes from Task 4 via `fetch`.
- Produces (Task 6 consumes):
  ```ts
  interface Props {
    clientId: number
    domains: string[]                       // client's registered domains (may be empty)
    archived: boolean
    initial: {
      checks: RobotsCheckSummary[]          // listRobotsChecks(clientId, firstDomain) — PER-DOMAIN (plan-Codex #1)
      latest: { summary: RobotsCheckSummary; detail: RobotsCheckDetail } | null // first domain's latest
    }
  }
  export function RobotsCheckCard(props: Props): JSX.Element
  ```

- [ ] **Step 1: Write the failing component tests**

Create `components/clients/RobotsCheckCard.test.tsx`:

```tsx
// @vitest-environment jsdom
// components/clients/RobotsCheckCard.test.tsx
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { RobotsCheckCard } from './RobotsCheckCard'
import type { RobotsCheckDetail, RobotsCheckSummary } from '@/lib/robots-check/types'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals() // fetch-stub cleanup convention (plan-Codex #6)
})

function summaryFixture(over: Partial<RobotsCheckSummary> = {}): RobotsCheckSummary {
  return {
    id: 1, domain: 'example.com', source: 'manual', robotsStatus: 'ok',
    sitemapUrlTotal: 42, errorCount: 0, warningCount: 1, changed: null,
    createdAt: '2026-07-12T00:00:00.000Z', ...over,
  }
}

function detailFixture(over: Partial<RobotsCheckDetail> = {}): RobotsCheckDetail {
  return {
    v: 1, domain: 'example.com',
    robots: { status: 'ok', httpStatus: 200, failure: null, contentHash: 'h', issues: [], blockedBots: ['GPTBot'], sitemapUrls: ['https://example.com/s.xml'] },
    sitemaps: [{
      url: 'https://example.com/s.xml', source: 'robots', ok: true, httpStatus: 200,
      failure: null, isIndex: false, urlCount: 42, childrenTotal: 0, childrenExcluded: 0,
      childrenFailed: 0, childrenSkipped: 0, contentHash: 'sh', children: [], childrenHash: null, issues: [],
    }],
    sitemapsSkipped: 0, timeBudgetExhausted: false,
    totals: { sitemapUrlTotal: 42, errors: 0, warnings: 1 }, ...over,
  }
}

describe('RobotsCheckCard', () => {
  it('empty-domains state shows the add-domain hint and no Run button', () => {
    render(<RobotsCheckCard clientId={1} domains={[]} archived={false} initial={{ checks: [], latest: null }} />)
    expect(screen.getByText(/add a domain/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /run check/i })).toBeNull()
  })

  it('renders latest state: status badge, counts, blocked bots, sitemap total', () => {
    render(
      <RobotsCheckCard
        clientId={1} domains={['example.com']} archived={false}
        initial={{ checks: [summaryFixture()], latest: { summary: summaryFixture(), detail: detailFixture() } }}
      />,
    )
    expect(screen.getByText(/robots ok/i)).toBeTruthy()
    expect(screen.getByText('42 sitemap URLs')).toBeTruthy() // exact (plan-Codex #6)
    expect(screen.getByText(/1 AI bot blocked/i)).toBeTruthy()
  })

  it('run check success: POSTs, renders the new latest, prepends history', async () => {
    const newLatest = {
      summary: summaryFixture({ id: 7, changed: true }),
      detail: detailFixture(),
    }
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => newLatest })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <RobotsCheckCard clientId={1} domains={['example.com']} archived={false} initial={{ checks: [], latest: null }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /run check/i }))
    await waitFor(() => expect(screen.getByText(/robots ok/i)).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/clients/1/robots-checks')
  })

  it('domain switch fetches the new domain history + latest detail lazily', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checks: [summaryFixture({ id: 3, domain: 'two.com' })] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ summary: summaryFixture({ id: 3, domain: 'two.com' }), detail: detailFixture() }) })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <RobotsCheckCard clientId={1} domains={['one.com', 'two.com']} archived={false} initial={{ checks: [], latest: null }} />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'two.com' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/clients/1/robots-checks?domain=two.com')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/clients/1/robots-checks/3')
  })

  it('expanding a history row lazily fetches its detail; fetch failure surfaces inline error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <RobotsCheckCard
        clientId={1} domains={['example.com']} archived={false}
        initial={{ checks: [summaryFixture({ id: 11 })], latest: null }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Jul/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/clients/1/robots-checks/11'))
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeTruthy())
  })

  it('changed null renders an em dash, never "unchanged"', () => {
    render(
      <RobotsCheckCard
        clientId={1} domains={['example.com']} archived={false}
        initial={{ checks: [summaryFixture({ changed: null })], latest: null }}
      />,
    )
    expect(screen.queryByText(/unchanged/i)).toBeNull()
  })

  it('POST failure reconciles: refetches history AND the newest detail, updates latest (plan-Codex #5)', async () => {
    const fetchMock = vi.fn()
      // POST fails (also covers the AbortController-timeout path — both land
      // in the same catch/!ok reconciliation)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'internal_error' }) })
      // reconciliation: history GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ checks: [summaryFixture({ id: 9 })] }) })
      // reconciliation: newest detail GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ summary: summaryFixture({ id: 9 }), detail: detailFixture() }) })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <RobotsCheckCard clientId={1} domains={['example.com']} archived={false} initial={{ checks: [], latest: null }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /run check/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/clients/1/robots-checks')
    expect(fetchMock.mock.calls[1][0]).toContain('/api/clients/1/robots-checks?domain=')
    expect(fetchMock.mock.calls[2][0]).toBe('/api/clients/1/robots-checks/9')
    // latest was reconciled from the server, not left stale
    await waitFor(() => expect(screen.getByText(/robots ok/i)).toBeTruthy())
  })

  it('honest truncation line when flags set', () => {
    render(
      <RobotsCheckCard
        clientId={1} domains={['example.com']} archived={false}
        initial={{
          checks: [summaryFixture()],
          latest: { summary: summaryFixture(), detail: detailFixture({ timeBudgetExhausted: true }) },
        }}
      />,
    )
    expect(screen.getByText(/possibly incomplete/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/RobotsCheckCard.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the card**

Create `components/clients/RobotsCheckCard.tsx`. Follow `GscKeywordCard` conventions (card chrome, refresh button, ephemeral error state) exactly; key behaviors:

```tsx
'use client'

// D4 — client-page card for robots/sitemap checks + history.
// Server preloads the FIRST domain's summaries + latest detail; switching
// domains or expanding history fetches lazily.
// POST failure OR client-side timeout reconciles: refetch history AND the
// newest row's detail — the row may still have committed server-side
// (Codex #5 / plan-Codex #5). A generation token guards domain switches so
// a slow response never overwrites the newly selected domain.
// changed:null renders an em dash, never "unchanged" (absence != sameness).

import { useRef, useState } from 'react'
import type { RobotsCheckDetail, RobotsCheckSummary } from '@/lib/robots-check/types'

interface Latest {
  summary: RobotsCheckSummary
  detail: RobotsCheckDetail
}

interface Props {
  clientId: number
  domains: string[]
  archived: boolean
  initial: { checks: RobotsCheckSummary[]; latest: Latest | null }
}

// Client deadline sits ABOVE the documented server hard bound (~75s =
// 60s budget + one 15s in-flight fetch window) so the server finishes first.
const POST_DEADLINE_MS = 90_000

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ok: { label: 'Robots OK', cls: 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/30' },
  missing: { label: 'Robots missing', cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30' },
  unreachable: { label: 'Unreachable', cls: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30' },
}

// UTC-pinned: server-rendered initial data must format identically in the
// browser or hydration mismatches appear (plan-Codex #5).
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function ChangedBadge({ changed }: { changed: boolean | null }) {
  if (changed === null) return <span className="text-xs text-gray-400 dark:text-white/40">&mdash;</span>
  return changed ? (
    <span className="text-xs font-semibold text-orange">changed</span>
  ) : (
    <span className="text-xs text-gray-500 dark:text-white/50">no change</span>
  )
}

export function RobotsCheckCard({ clientId, domains, archived, initial }: Props) {
  const [domain, setDomain] = useState(domains[0] ?? '')
  const [checks, setChecks] = useState<RobotsCheckSummary[]>(initial.checks)
  const [latest, setLatest] = useState<Latest | null>(initial.latest)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expandedDetail, setExpandedDetail] = useState<RobotsCheckDetail | null>(null)
  // Generation token: bumped on every domain switch; stale async flows
  // check it before every setState (plan-Codex #5).
  const genRef = useRef(0)

  /** Refetch history + newest detail for `forDomain`; applies state only if
   *  the generation still matches. Failures surface inline. */
  const reconcile = async (forDomain: string, gen: number) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/robots-checks?domain=${encodeURIComponent(forDomain)}`)
      if (!res.ok) {
        if (genRef.current === gen) setError('Could not load check history.')
        return
      }
      const body = await res.json()
      const list = body.checks as RobotsCheckSummary[]
      if (genRef.current !== gen) return
      setChecks(list)
      if (list.length > 0) {
        const dRes = await fetch(`/api/clients/${clientId}/robots-checks/${list[0].id}`)
        if (genRef.current !== gen) return
        if (dRes.ok) {
          setLatest((await dRes.json()) as Latest)
        } else {
          setError('Could not load the latest check detail.')
        }
      } else {
        setLatest(null)
      }
    } catch {
      if (genRef.current === gen) setError('Could not load check history.')
    }
  }

  const runCheck = async () => {
    const gen = genRef.current
    setRunning(true)
    setError(null)
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), POST_DEADLINE_MS)
    try {
      const res = await fetch(`/api/clients/${clientId}/robots-checks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain }),
        signal: controller.signal,
      })
      if (!res.ok) {
        if (genRef.current === gen) setError('Check failed. The result may still have been recorded; refreshing history.')
        await reconcile(domain, gen)
        return
      }
      const body = (await res.json()) as Latest
      if (genRef.current !== gen) return
      setLatest(body)
      setChecks((prev) => [body.summary, ...prev])
    } catch {
      // Includes the AbortController deadline: the server may still commit
      // the row after our timeout — reconcile instead of trusting local state.
      if (genRef.current === gen) setError('Check failed. The result may still have been recorded; refreshing history.')
      await reconcile(domain, gen)
    } finally {
      clearTimeout(deadline)
      if (genRef.current === gen) setRunning(false)
    }
  }

  const switchDomain = async (next: string) => {
    genRef.current += 1
    const gen = genRef.current
    setDomain(next)
    setLatest(null)
    setExpandedId(null)
    setError(null)
    await reconcile(next, gen)
  }

  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    const gen = genRef.current
    setExpandedId(id)
    setExpandedDetail(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/robots-checks/${id}`)
      if (genRef.current !== gen) return
      if (res.ok) {
        setExpandedDetail(((await res.json()) as Latest).detail)
      } else {
        setError('Could not load that check.')
      }
    } catch {
      if (genRef.current === gen) setError('Could not load that check.')
    }
  }

  if (domains.length === 0) {
    return (
      <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80 mb-2">Robots &amp; Sitemap Checks</h2>
        <p className="text-sm text-gray-500 dark:text-white/50">Add a domain to this client to run checks.</p>
      </div>
    )
  }

  const detail = latest?.detail ?? null
  const truncated = detail !== null && (
    detail.timeBudgetExhausted ||
    detail.sitemapsSkipped > 0 ||
    detail.sitemaps.some((s) => s.childrenSkipped > 0)
  )

  return (
    <div className="bg-white dark:bg-navy-card rounded-xl border border-gray-200 dark:border-navy-border p-5 mb-6">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-white/80">Robots &amp; Sitemap Checks</h2>
        <div className="flex items-center gap-2">
          {domains.length > 1 && (
            <select
              value={domain}
              onChange={(e) => void switchDomain(e.target.value)}
              className="text-xs border border-gray-200 dark:border-navy-border rounded-md px-2 py-1 bg-white dark:bg-navy-deep text-gray-700 dark:text-white/80"
            >
              {domains.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {!archived && (
            <button
              type="button"
              onClick={() => void runCheck()}
              disabled={running}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
              {running ? 'Checking…' : 'Run Check'}
            </button>
          )}
          <a
            href={`/robots-validator?url=${encodeURIComponent(`https://${domain}`)}`}
            className="text-xs text-gray-500 dark:text-white/50 hover:underline"
          >
            Open in Validator
          </a>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-3">{error}</p>}

      {detail && latest && (
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded border ${STATUS_BADGE[detail.robots.status].cls}`}>
              {STATUS_BADGE[detail.robots.status].label}
            </span>
            <span className="text-xs text-gray-600 dark:text-white/60 tabular-nums">
              {latest.summary.errorCount} errors · {latest.summary.warningCount} warnings
            </span>
            {detail.robots.blockedBots.length > 0 && (
              <details className="text-xs text-gray-600 dark:text-white/60">
                <summary className="cursor-pointer">{detail.robots.blockedBots.length} AI bot{detail.robots.blockedBots.length === 1 ? '' : 's'} blocked</summary>
                <span className="font-mono">{detail.robots.blockedBots.join(', ')}</span>
              </details>
            )}
            {latest.summary.sitemapUrlTotal !== null ? (
              <span className="text-xs text-gray-600 dark:text-white/60 tabular-nums">{latest.summary.sitemapUrlTotal} sitemap URLs</span>
            ) : (
              <span className="text-xs text-gray-400 dark:text-white/40">no sitemap observed</span>
            )}
          </div>
          <ul className="space-y-1">
            {detail.sitemaps.map((s) => (
              <li key={s.url} className="text-xs text-gray-600 dark:text-white/60 flex flex-wrap gap-2">
                <span className="font-mono truncate max-w-[60%]">{s.url}</span>
                {s.ok ? (
                  <span className="tabular-nums">{s.urlCount} URLs{s.isIndex ? ` · ${s.childrenTotal} children (${s.childrenFailed} failed)` : ''}</span>
                ) : (
                  <span className="text-red-600 dark:text-red-400">{s.failure}</span>
                )}
              </li>
            ))}
          </ul>
          {truncated && (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
              Results possibly incomplete (check hit a size or time cap).
            </p>
          )}
        </div>
      )}

      {checks.length > 0 && (
        <div className="border-t border-gray-100 dark:border-navy-border pt-3">
          <h3 className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-white/40 mb-2">History</h3>
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => void toggleExpand(c.id)}
                  className="w-full flex items-center gap-3 text-left text-xs text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-navy-light/50 rounded px-1 py-1"
                >
                  <span className="tabular-nums">{formatDate(c.createdAt)}</span>
                  <ChangedBadge changed={c.changed} />
                  <span className="tabular-nums">{c.errorCount}E / {c.warningCount}W</span>
                  {c.source === 'scheduled' && <span className="text-gray-400 dark:text-white/40">scheduled</span>}
                </button>
                {expandedId === c.id && expandedDetail && (
                  <div className="pl-4 py-1 text-[11px] text-gray-500 dark:text-white/50">
                    {expandedDetail.robots.issues.length + expandedDetail.sitemaps.reduce((n, s) => n + s.issues.length, 0)} issue(s) recorded ·{' '}
                    {expandedDetail.robots.blockedBots.length} AI bot(s) blocked
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {checks.length === 0 && !detail && (
        <p className="text-sm text-gray-500 dark:text-white/50">No checks yet. Run one to record the current robots.txt and sitemap state.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/RobotsCheckCard.test.tsx`
Expected: PASS. Adjust test queries only if a rendering detail differs — behavior stays as specified.

- [ ] **Step 5: Commit**

```bash
git add components/clients/RobotsCheckCard.tsx components/clients/RobotsCheckCard.test.tsx
git commit -m "feat(d4): RobotsCheckCard (run check, latest state, history with changed badges)"
```

---

### Task 6: Client-page integration + docs + gates

**Files:**
- Modify: `app/(app)/clients/[id]/page.tsx` (preload + render card after `ScheduledScansCard`)
- Modify: `CLAUDE.md` (key-files entry for `lib/robots-check/`)
- Test: full gate run

**Interfaces:**
- Consumes: Task 3 `listRobotsChecks`/`getRobotsCheck`, Task 5 `RobotsCheckCard`.

- [ ] **Step 1: Preload data in the server page**

In `app/(app)/clients/[id]/page.tsx`, add imports:

```ts
import { listRobotsChecks, getRobotsCheck } from '@/lib/robots-check/service'
import { RobotsCheckCard } from '@/components/clients/RobotsCheckCard'
```

Where the page loads its data (alongside the other service calls), add:

```ts
  // Per-domain preload (plan-Codex #1): the card's history is ALWAYS scoped
  // to its selected domain, so the initial load uses the same filtered path
  // the domain switcher uses — never the unfiltered interleaved list.
  const firstDomain: string | undefined = dash.client.domains[0]
  const robotsChecks = firstDomain ? await listRobotsChecks(clientId, firstDomain) : []
  const robotsLatest = robotsChecks.length > 0
    ? await getRobotsCheck(clientId, robotsChecks[0].id)
    : null
```

(Confirm `dash.client.domains` is already a `string[]` — `ClientHeader` receives it; if it is a JSON string in this page, parse it the way `ScheduledScansCard`'s `domains` prop is built and reuse that value.)

Render after `<ScheduledScansCard …/>`:

```tsx
        <RobotsCheckCard
          clientId={clientId}
          domains={dash.client.domains}
          archived={dash.client.archivedAt !== null}
          initial={{ checks: robotsChecks, latest: robotsLatest }}
        />
```

- [ ] **Step 2: CLAUDE.md key-files entry**

Add to the CLAUDE.md key-files list (near `lib/seo-fetch/`):

```markdown
- `lib/robots-check/` — D4 client-attached robots/sitemap checks: `runner.ts` (server-side check over `lib/seo-fetch` — DI fetchers, honest caps `sitemapsSkipped`/`childrenSkipped`/`childrenExcluded`/`timeBudgetExhausted`, per-child hash observations + `childrenHash` for index-churn change evidence, convention-probe recognition gate, 60s soft budget + one 15s overshoot window), `service.ts` (single-flight per client:domain persist — gsc-snapshot crash-lesson pattern; read-time `changed` vs predecessor by robotsStatus+robots hash+ordered sitemap (url,hash,childrenHash) triples — NEVER persisted, D5 refines without backfill; `getRobotsCheck` = the ONE summary+detail shape), `retention.ts` (keep LIMIT+1 per (client,domain) — hidden predecessor keeps the oldest visible `changed` stable; in `runCleanup`), `types.ts` (client-safe). Routes `GET/POST /api/clients/[id]/robots-checks` + `GET …/[checkId]` (cookie-gated, NO middleware change); UI `components/clients/RobotsCheckCard.tsx`. Raw robots body stored on `RobotsCheck.robotsContent` (D5 diffs); sitemap XML NEVER stored (hash+counts only). Only client-registered domains get rows; anonymous validator-page runs never persist. Migration `20260713100000`. Spec: `docs/superpowers/specs/2026-07-12-d4-client-robots-checks-design.md`
```

- [ ] **Step 3: Full gates**

Run, in order:
```bash
npm run lint
DATABASE_URL="file:./local-dev.db" npm test
npm run build
```
Expected: all green. The client page is NOT on the smoke walk in a way this touches (card addition only), and auth/SF-upload/ADA-pipeline are untouched → no `npm run smoke` required; state this in the PR description.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/clients/[id]/page.tsx" CLAUDE.md
git commit -m "feat(d4): RobotsCheckCard on the client page + CLAUDE.md key-files entry"
```

---

## Post-plan (session-level, not task-level)

1. Push branch, open PR (`gh pr create`), re-run gates, merge when green (change-control rule 1).
2. Deploy (`ssh $PROD_SSH "~/deploy.sh"`) — migration `20260713100000_robots_check` applies automatically; verify post-deploy: health ok, run one real check against a CLIENT domain already in the system (never a third-party site), confirm the row + card render.
3. Docs ritual in the same commit: tracker D4 `[x]` + dated status-log line + handoff rewrite; move spec+plan to `docs/superpowers/archive/`.
4. Kevin-verify carryover: NGINX/RunCloud proxy timeout vs the ~75 s worst case (flag in the PR description).
