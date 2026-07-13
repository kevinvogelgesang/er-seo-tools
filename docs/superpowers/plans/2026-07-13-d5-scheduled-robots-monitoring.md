# D5 Scheduled Robots/Sitemap Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly system job re-checks every registered client domain's robots.txt + sitemaps and emails ONE change-only alert per detected state change (byte-identical fetch = silence; re-observed known issue = silence), with a "what changed" section in the client card.

**Architecture:** One `system-robots-monitor` Schedule row (weekly:1@06:30) fires a `robots-monitor-sweep` job that fans out one durable `robots-monitor` job per (active client, normalized registered domain). Each domain job re-validates, runs (or job-scope-reuses) a `source:'scheduled'` D4 RobotsCheck, resolves it through `getRobotsCheck` (which now also returns a pure `RobotsChangeSummary` vs the exact predecessor), and when `changed === true` sends a Mailgun email fenced by a new `RobotsCheck.alertSentAt` marker. The same summary renders in `RobotsCheckCard`.

**Tech Stack:** Next.js 15 / TypeScript / Prisma + SQLite / vitest / existing `lib/jobs` durable queue / existing `lib/notify` Mailgun layer.

**Spec:** `docs/superpowers/specs/2026-07-13-d5-scheduled-robots-monitoring-design.md` (Codex-reviewed, fixes #1–#8 applied — annotations below reference them).

## Global Constraints

- Branch: `feat/d5-robots-monitoring` off `main`. Never `git add -A` (untracked `pentest-results/` exists); stage explicit paths. No backticks in `-m` commit messages.
- Array-form `$transaction([...])` ONLY (no interactive transactions). `RobotsCheck` has NO `updatedAt` column — plain updates are fine, no manual heartbeat needed.
- `lib/seo-fetch/` and the D4 runner (`lib/robots-check/runner.ts`) are FROZEN — no edits.
- `lib/robots-check/types.ts` and the new `lib/robots-check/change-summary.ts` are CLIENT-SAFE: no server-only imports (no `@/lib/db`, no `fs`).
- No new routes, no `middleware.ts` change (all new surfaces are job handlers + an existing cookie-gated GET growing a field).
- No new env vars. Notify dark gate = `isNotifyEnabled()` (`MAILGUN_API_KEY && MAILGUN_DOMAIN`).
- Tests: vitest, per-worker self-provisioned SQLite DBs, PREFIX-scoped rows cleaned in `afterAll`. Component tests: `// @vitest-environment jsdom`, `afterEach(cleanup)`, no jest-dom.
- Local test runs: `DATABASE_URL="file:./local-dev.db" npx vitest run <file>` (or `npm test` for the whole suite).
- UI: `dark:` variants on every element; dates pinned `timeZone: 'UTC'`.
- Gate commands before PR/merge: `npm run lint` + `npm test` + `npm run build`.

---

### Task 1: Schema — `RobotsCheck.alertSentAt` marker column

**Files:**
- Modify: `prisma/schema.prisma` (RobotsCheck model, ~line 737)
- Create: `prisma/migrations/20260713120000_robots_alert_marker/migration.sql`

**Interfaces:**
- Produces: nullable `alertSentAt DateTime?` on `RobotsCheck` — the email-sent idempotency marker read/stamped by Task 6.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/d5-robots-monitoring
```

- [ ] **Step 2: Edit the model**

In `prisma/schema.prisma`, inside `model RobotsCheck`, after the `detailJson` line add:

```prisma
  alertSentAt       DateTime? // D5: change-alert email sent for this row (idempotency marker)
```

- [ ] **Step 3: Author the migration by hand** (`migrate dev` is interactive-only here)

```sql
-- D5: change-alert email idempotency marker (additive nullable column).
ALTER TABLE "RobotsCheck" ADD COLUMN "alertSentAt" DATETIME;
```

Save as `prisma/migrations/20260713120000_robots_alert_marker/migration.sql`.

- [ ] **Step 4: Apply + regenerate**

```bash
DATABASE_URL="file:./local-dev.db" npx prisma migrate deploy && \
DATABASE_URL="file:./local-dev.db" npx prisma generate
```

Expected: `1 migration applied`, client regenerated.

- [ ] **Step 5: Type-check**

```bash
npm run lint
```

Expected: PASS (no code references the column yet).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260713120000_robots_alert_marker/migration.sql
git commit -m "feat(d5): RobotsCheck.alertSentAt idempotency marker (additive migration)"
```

---

### Task 2: Pure change-summary module

**Files:**
- Modify: `lib/robots-check/types.ts` (add one constant)
- Create: `lib/robots-check/change-summary.ts`
- Test: `lib/robots-check/change-summary.test.ts`

**Interfaces:**
- Consumes: `RobotsCheckDetail`, `RobotsFetchStatus` from `./types`.
- Produces: `ROBOTS_DIFF_MAX_LINES = 50` (in types.ts); `RobotsChangeSide { detail: RobotsCheckDetail; robotsContent: string | null }`; `RobotsChangeSummary` (shape below); `buildChangeSummary(prev: RobotsChangeSide, curr: RobotsChangeSide): RobotsChangeSummary`. Tasks 3, 4, 7 import these.

- [ ] **Step 1: Add the constant to `lib/robots-check/types.ts`** (after `ROBOTS_CHECK_HISTORY_LIMIT`)

```ts
/** Cap per side of the robots.txt line diff in change summaries (D5). */
export const ROBOTS_DIFF_MAX_LINES = 50
/** Per-line character cap in the diff — one robots line can approach the
 *  fetch cap; the diff must stay bounded for the API, card, and email
 *  (plan-Codex #5). Overlong lines are sliced and flag truncated. */
export const ROBOTS_DIFF_MAX_LINE_CHARS = 200
```

- [ ] **Step 2: Write the failing tests** — `lib/robots-check/change-summary.test.ts`

```ts
// lib/robots-check/change-summary.test.ts
//
// D5 pure change-summary tests. The completeness invariant (Codex #4) is the
// load-bearing suite: whenever D4 alert evidence differs, at least one
// summary field explains it.
import { describe, it, expect } from 'vitest'
import type { RobotsCheckDetail } from './types'
import { ROBOTS_DIFF_MAX_LINES, ROBOTS_DIFF_MAX_LINE_CHARS } from './types'
import { buildChangeSummary, type RobotsChangeSide } from './change-summary'

function detailFixture(overrides: {
  robotsStatus?: 'ok' | 'missing' | 'unreachable'
  robotsHash?: string | null
  blockedBots?: string[]
  sitemaps?: Array<{ url: string; contentHash: string | null; childrenHash: string | null; urlCount?: number | null }>
  sitemapUrlTotal?: number | null
  errors?: number
  warnings?: number
} = {}): RobotsCheckDetail {
  const sitemaps = (overrides.sitemaps ?? [{ url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: null }]).map((s) => ({
    url: s.url, source: 'robots' as const, ok: s.contentHash !== null,
    httpStatus: 200, failure: null, isIndex: s.childrenHash !== null,
    urlCount: s.urlCount === undefined ? 3 : s.urlCount, childrenTotal: 0, childrenExcluded: 0,
    childrenFailed: 0, childrenSkipped: 0, contentHash: s.contentHash,
    children: [], childrenHash: s.childrenHash, issues: [],
  }))
  return {
    v: 1, domain: 'x.com',
    robots: {
      status: overrides.robotsStatus ?? 'ok', httpStatus: 200, failure: null,
      contentHash: overrides.robotsHash === undefined ? 'rh1' : overrides.robotsHash,
      issues: [], blockedBots: overrides.blockedBots ?? [], sitemapUrls: [],
    },
    sitemaps, sitemapsSkipped: 0, timeBudgetExhausted: false,
    totals: {
      sitemapUrlTotal: overrides.sitemapUrlTotal === undefined ? 3 : overrides.sitemapUrlTotal,
      errors: overrides.errors ?? 0, warnings: overrides.warnings ?? 0,
    },
  }
}

function side(detail: RobotsCheckDetail, robotsContent: string | null = null): RobotsChangeSide {
  return { detail, robotsContent }
}

/** D4 evidence string — mirrors service.ts evidenceOf (order-sensitive). */
function evidence(s: RobotsChangeSide): string {
  return JSON.stringify([
    s.detail.robots.status,
    s.detail.robots.contentHash,
    s.detail.sitemaps.map((m) => [m.url, m.contentHash, m.childrenHash]),
  ])
}

function hasExplanation(sum: ReturnType<typeof buildChangeSummary>): boolean {
  return (
    sum.robotsStatus !== null || sum.robotsContentChanged ||
    sum.robotsDiff !== null || sum.blockedBots !== null || sum.sitemaps !== null
  )
}

describe('buildChangeSummary', () => {
  it('identical sides -> everything null/false', () => {
    const d = detailFixture()
    const sum = buildChangeSummary(side(d, 'User-agent: *'), side(detailFixture(), 'User-agent: *'))
    expect(sum.robotsStatus).toBeNull()
    expect(sum.robotsContentChanged).toBe(false)
    expect(sum.robotsDiff).toBeNull()
    expect(sum.blockedBots).toBeNull()
    expect(sum.sitemaps).toBeNull()
    expect(sum.sitemapUrlTotal).toBeNull()
    expect(sum.counts).toBeNull()
  })

  it('robots line add/remove shows in the diff', () => {
    const prev = side(detailFixture({ robotsHash: 'a' }), 'User-agent: *\nAllow: /')
    const curr = side(detailFixture({ robotsHash: 'b' }), 'User-agent: *\nDisallow: /admin')
    const sum = buildChangeSummary(prev, curr)
    expect(sum.robotsContentChanged).toBe(true)
    expect(sum.robotsDiff!.added).toEqual(['Disallow: /admin'])
    expect(sum.robotsDiff!.removed).toEqual(['Allow: /'])
    expect(sum.robotsDiff!.truncated).toBe(false)
  })

  it('reorder-only robots change -> robotsContentChanged true with empty diff (Codex #4)', () => {
    const prev = side(detailFixture({ robotsHash: 'a' }), 'A: 1\nB: 2')
    const curr = side(detailFixture({ robotsHash: 'b' }), 'B: 2\nA: 1')
    const sum = buildChangeSummary(prev, curr)
    expect(sum.robotsContentChanged).toBe(true)
    expect(sum.robotsDiff!.added).toEqual([])
    expect(sum.robotsDiff!.removed).toEqual([])
  })

  it('caps the diff and flags truncation', () => {
    const prevBody = Array.from({ length: 10 }, (_, i) => `Old: ${i}`).join('\n')
    const currBody = Array.from({ length: ROBOTS_DIFF_MAX_LINES + 10 }, (_, i) => `New: ${i}`).join('\n')
    const sum = buildChangeSummary(
      side(detailFixture({ robotsHash: 'a' }), prevBody),
      side(detailFixture({ robotsHash: 'b' }), currBody),
    )
    expect(sum.robotsDiff!.added).toHaveLength(ROBOTS_DIFF_MAX_LINES)
    expect(sum.robotsDiff!.truncated).toBe(true)
  })

  it('caps overlong lines by characters and flags truncation (plan-Codex #5)', () => {
    const long = `Disallow: /${'a'.repeat(1000)}`
    const sum = buildChangeSummary(
      side(detailFixture({ robotsHash: 'a' }), 'User-agent: *'),
      side(detailFixture({ robotsHash: 'b' }), `User-agent: *\n${long}`),
    )
    expect(sum.robotsDiff!.added[0]).toHaveLength(ROBOTS_DIFF_MAX_LINE_CHARS)
    expect(sum.robotsDiff!.truncated).toBe(true)
  })

  it('null body on either side -> no diff, but the flag still fires', () => {
    const sum = buildChangeSummary(
      side(detailFixture({ robotsHash: 'a' }), null),
      side(detailFixture({ robotsHash: 'b' }), 'User-agent: *'),
    )
    expect(sum.robotsContentChanged).toBe(true)
    expect(sum.robotsDiff).toBeNull()
  })

  it('sitemap add/remove/changed distinguishes content vs children hashes', () => {
    const prev = side(detailFixture({ sitemaps: [
      { url: 'https://x.com/a.xml', contentHash: 'h1', childrenHash: null },
      { url: 'https://x.com/gone.xml', contentHash: 'h2', childrenHash: null },
      { url: 'https://x.com/idx.xml', contentHash: 'same', childrenHash: 'kids1' },
    ] }))
    const curr = side(detailFixture({ sitemaps: [
      { url: 'https://x.com/a.xml', contentHash: 'h1-new', childrenHash: null, urlCount: 9 },
      { url: 'https://x.com/new.xml', contentHash: 'h3', childrenHash: null },
      { url: 'https://x.com/idx.xml', contentHash: 'same', childrenHash: 'kids2' },
    ] }))
    const sum = buildChangeSummary(prev, curr)
    expect(sum.sitemaps!.added).toEqual(['https://x.com/new.xml'])
    expect(sum.sitemaps!.removed).toEqual(['https://x.com/gone.xml'])
    expect(sum.sitemaps!.changed).toEqual([
      { url: 'https://x.com/a.xml', urlCountPrev: 3, urlCountCurr: 9, childrenChanged: false },
      { url: 'https://x.com/idx.xml', urlCountPrev: 3, urlCountCurr: 3, childrenChanged: true },
    ])
    expect(sum.sitemaps!.orderChanged).toBe(false)
  })

  it('sitemap reorder-only -> orderChanged true, nothing else (Codex #4)', () => {
    const a = { url: 'https://x.com/a.xml', contentHash: 'h1', childrenHash: null }
    const b = { url: 'https://x.com/b.xml', contentHash: 'h2', childrenHash: null }
    const sum = buildChangeSummary(
      side(detailFixture({ sitemaps: [a, b] })),
      side(detailFixture({ sitemaps: [b, a] })),
    )
    expect(sum.sitemaps).toEqual({ added: [], removed: [], changed: [], orderChanged: true })
  })

  it('duplicate sitemap URLs pair by ordinal, never collapse (Codex #4)', () => {
    const sum = buildChangeSummary(
      side(detailFixture({ sitemaps: [
        { url: 'https://x.com/d.xml', contentHash: 'h1', childrenHash: null },
        { url: 'https://x.com/d.xml', contentHash: 'h2', childrenHash: null },
      ] })),
      side(detailFixture({ sitemaps: [
        { url: 'https://x.com/d.xml', contentHash: 'h1', childrenHash: null },
        { url: 'https://x.com/d.xml', contentHash: 'h2-new', childrenHash: null },
      ] })),
    )
    expect(sum.sitemaps!.changed).toHaveLength(1)
    expect(sum.sitemaps!.added).toEqual([])
  })

  it('blockedBots and counts deltas', () => {
    const sum = buildChangeSummary(
      side(detailFixture({ blockedBots: ['GPTBot'], errors: 1, warnings: 0, sitemapUrlTotal: 10 })),
      side(detailFixture({ blockedBots: ['ClaudeBot'], errors: 3, warnings: 1, sitemapUrlTotal: 4 })),
    )
    expect(sum.blockedBots).toEqual({ added: ['ClaudeBot'], removed: ['GPTBot'] })
    expect(sum.counts).toEqual({ errorsPrev: 1, errorsCurr: 3, warningsPrev: 0, warningsCurr: 1 })
    expect(sum.sitemapUrlTotal).toEqual({ prev: 10, curr: 4 })
  })

  it('completeness invariant: evidence differs => at least one explanatory field (Codex #4)', () => {
    const base = side(detailFixture(), 'U: *')
    const variants: RobotsChangeSide[] = [
      side(detailFixture({ robotsStatus: 'unreachable', robotsHash: null }), null),
      side(detailFixture({ robotsHash: 'other' }), 'U: *\nX: 1'),
      side(detailFixture({ sitemaps: [{ url: 'https://x.com/s.xml', contentHash: 'h9', childrenHash: null }] }), 'U: *'),
      side(detailFixture({ sitemaps: [
        { url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: null },
        { url: 'https://x.com/t.xml', contentHash: 'h1', childrenHash: null },
      ] }), 'U: *'),
      side(detailFixture({ sitemaps: [{ url: 'https://x.com/s.xml', contentHash: 'h1', childrenHash: 'kids' }] }), 'U: *'),
    ]
    for (const v of variants) {
      expect(evidence(base)).not.toBe(evidence(v))
      expect(hasExplanation(buildChangeSummary(base, v)), JSON.stringify(v.detail.robots)).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Run to verify failure**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/robots-check/change-summary.test.ts
```

Expected: FAIL — `Cannot find module './change-summary'`.

- [ ] **Step 4: Implement** — `lib/robots-check/change-summary.ts`

```ts
// lib/robots-check/change-summary.ts
//
// D5 pure, CLIENT-SAFE change summary between two RobotsCheck snapshots.
// Shared by the alert email builder (server) and the card's "changed vs
// previous" section (client) — must never import server-only modules.
//
// Completeness invariant (spec Codex #4): whenever D4's alert evidence
// differs (robotsStatus + robots contentHash + ordered
// (url,contentHash,childrenHash) triples), at least one field here is
// non-null/non-empty. The line diff is a MULTISET (order-insensitive) by
// design, so robotsContentChanged and sitemaps.orderChanged carry the
// reorder/formatting-only cases the diff can't show.

import type { RobotsCheckDetail, RobotsFetchStatus } from './types'
import { ROBOTS_DIFF_MAX_LINES, ROBOTS_DIFF_MAX_LINE_CHARS } from './types'

export interface RobotsChangeSide {
  detail: RobotsCheckDetail
  robotsContent: string | null
}

export interface RobotsChangeSummary {
  robotsStatus: { prev: RobotsFetchStatus; curr: RobotsFetchStatus } | null
  /** Robots content hashes differ — fires even when the line diff is empty
   *  (reorder / whitespace-only edits). */
  robotsContentChanged: boolean
  robotsDiff: { added: string[]; removed: string[]; truncated: boolean } | null
  blockedBots: { added: string[]; removed: string[] } | null
  sitemaps: {
    added: string[]
    removed: string[]
    changed: Array<{ url: string; urlCountPrev: number | null; urlCountCurr: number | null; childrenChanged: boolean }>
    orderChanged: boolean
  } | null
  sitemapUrlTotal: { prev: number | null; curr: number | null } | null
  counts: { errorsPrev: number; errorsCurr: number; warningsPrev: number; warningsCurr: number } | null
}

function lineCounts(body: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    map.set(line, (map.get(line) ?? 0) + 1)
  }
  return map
}

function multisetDiff(prev: string, curr: string): { added: string[]; removed: string[]; truncated: boolean } {
  const a = lineCounts(prev)
  const b = lineCounts(curr)
  const added: string[] = []
  const removed: string[] = []
  let truncated = false
  const capped = (line: string): string => {
    if (line.length <= ROBOTS_DIFF_MAX_LINE_CHARS) return line
    truncated = true // plan-Codex #5: bounded by bytes, not only line count
    return line.slice(0, ROBOTS_DIFF_MAX_LINE_CHARS)
  }
  for (const [line, n] of b) {
    let surplus = n - (a.get(line) ?? 0)
    while (surplus-- > 0) {
      if (added.length >= ROBOTS_DIFF_MAX_LINES) { truncated = true; break }
      added.push(capped(line))
    }
  }
  for (const [line, n] of a) {
    let surplus = n - (b.get(line) ?? 0)
    while (surplus-- > 0) {
      if (removed.length >= ROBOTS_DIFF_MAX_LINES) { truncated = true; break }
      removed.push(capped(line))
    }
  }
  return { added, removed, truncated }
}

function setDiff(prev: string[], curr: string[]): { added: string[]; removed: string[] } {
  const a = new Set(prev)
  const b = new Set(curr)
  return { added: [...b].filter((x) => !a.has(x)), removed: [...a].filter((x) => !b.has(x)) }
}

interface SitemapObs { url: string; contentHash: string | null; childrenHash: string | null; urlCount: number | null }

/** (url, ordinal) identity: the Nth occurrence of a URL pairs with the Nth
 *  occurrence on the other side — duplicate URLs never collapse (Codex #4). */
function keyedSitemaps(detail: RobotsCheckDetail): Map<string, SitemapObs> {
  const seen = new Map<string, number>()
  const out = new Map<string, SitemapObs>()
  for (const s of detail.sitemaps) {
    const ordinal = seen.get(s.url) ?? 0
    seen.set(s.url, ordinal + 1)
    out.set(`${ordinal}\n${s.url}`, { url: s.url, contentHash: s.contentHash, childrenHash: s.childrenHash, urlCount: s.urlCount })
  }
  return out
}

export function buildChangeSummary(prev: RobotsChangeSide, curr: RobotsChangeSide): RobotsChangeSummary {
  const pr = prev.detail.robots
  const cr = curr.detail.robots

  const robotsStatus = pr.status === cr.status ? null : { prev: pr.status, curr: cr.status }
  const robotsContentChanged = pr.contentHash !== cr.contentHash
  const robotsDiff =
    robotsContentChanged && prev.robotsContent !== null && curr.robotsContent !== null
      ? multisetDiff(prev.robotsContent, curr.robotsContent)
      : null

  const bots = setDiff(pr.blockedBots, cr.blockedBots)
  const blockedBots = bots.added.length || bots.removed.length ? bots : null

  const pk = keyedSitemaps(prev.detail)
  const ck = keyedSitemaps(curr.detail)
  const added: string[] = []
  const removed: string[] = []
  const changed: Array<{ url: string; urlCountPrev: number | null; urlCountCurr: number | null; childrenChanged: boolean }> = []
  for (const [key, c] of ck) {
    const p = pk.get(key)
    if (!p) { added.push(c.url); continue }
    if (p.contentHash !== c.contentHash || p.childrenHash !== c.childrenHash) {
      changed.push({ url: c.url, urlCountPrev: p.urlCount, urlCountCurr: c.urlCount, childrenChanged: p.childrenHash !== c.childrenHash })
    }
  }
  for (const [key, p] of pk) {
    if (!ck.has(key)) removed.push(p.url)
  }
  const orderChanged =
    added.length === 0 && removed.length === 0 &&
    prev.detail.sitemaps.map((s) => s.url).join('\n') !== curr.detail.sitemaps.map((s) => s.url).join('\n')
  const sitemaps =
    added.length || removed.length || changed.length || orderChanged
      ? { added, removed, changed, orderChanged }
      : null

  const pt = prev.detail.totals
  const ct = curr.detail.totals
  const sitemapUrlTotal =
    pt.sitemapUrlTotal === ct.sitemapUrlTotal ? null : { prev: pt.sitemapUrlTotal, curr: ct.sitemapUrlTotal }
  const counts =
    pt.errors === ct.errors && pt.warnings === ct.warnings
      ? null
      : { errorsPrev: pt.errors, errorsCurr: ct.errors, warningsPrev: pt.warnings, warningsCurr: ct.warnings }

  return { robotsStatus, robotsContentChanged, robotsDiff, blockedBots, sitemaps, sitemapUrlTotal, counts }
}
```

- [ ] **Step 5: Run tests**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/robots-check/change-summary.test.ts
```

Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add lib/robots-check/types.ts lib/robots-check/change-summary.ts lib/robots-check/change-summary.test.ts
git commit -m "feat(d5): pure client-safe RobotsChangeSummary builder (multiset diff + order/dup-safe sitemap pairing + completeness invariant)"
```

---

### Task 3: Service returns `changeSummary`

**Files:**
- Modify: `lib/robots-check/service.ts`
- Test: `lib/robots-check/service.test.ts` (append describe block)

**Interfaces:**
- Consumes: `buildChangeSummary`, `RobotsChangeSide`, `RobotsChangeSummary` from `./change-summary` (Task 2).
- Produces: `StoredRobotsCheck` grows `changeSummary: RobotsChangeSummary | null` — non-null whenever a predecessor exists and both details parse (computed on BOTH `runAndStoreRobotsCheck` and `getRobotsCheck` paths so the POST and GET responses share one shape). Task 6's handler and Task 7's card consume it.

- [ ] **Step 1: Write the failing tests** — append to `lib/robots-check/service.test.ts` (reuse the file's existing `detailFixture`, `makeClient`, `mockRun` helpers; keep its PREFIX conventions):

```ts
describe('changeSummary (D5)', () => {
  it('first check ever -> changeSummary null', async () => {
    const client = await makeClient()
    mockRun.mockResolvedValueOnce({ detail: detailFixture(), robotsContent: 'User-agent: *' })
    const stored = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(stored.changeSummary).toBeNull()
  })

  it('second check computes the summary against the exact predecessor, on both paths', async () => {
    const client = await makeClient()
    mockRun.mockResolvedValueOnce({ detail: detailFixture({ robotsHash: 'a' }), robotsContent: 'Allow: /' })
    await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    mockRun.mockResolvedValueOnce({ detail: detailFixture({ robotsHash: 'b' }), robotsContent: 'Disallow: /x' })
    const second = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })

    expect(second.summary.changed).toBe(true)
    expect(second.changeSummary).not.toBeNull()
    expect(second.changeSummary!.robotsContentChanged).toBe(true)
    expect(second.changeSummary!.robotsDiff!.added).toEqual(['Disallow: /x'])
    expect(second.changeSummary!.robotsDiff!.removed).toEqual(['Allow: /'])

    // GET path returns the identical summary shape.
    const got = await getRobotsCheck(client.id, second.summary.id)
    expect(got!.changeSummary).toEqual(second.changeSummary)
  })

  it('corrupt predecessor detail -> changeSummary null (matches changed:null)', async () => {
    const client = await makeClient()
    mockRun.mockResolvedValueOnce({ detail: detailFixture(), robotsContent: null })
    const first = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    await prisma.robotsCheck.update({ where: { id: first.summary.id }, data: { detailJson: '{"v":2}' } })
    mockRun.mockResolvedValueOnce({ detail: detailFixture({ robotsHash: 'zz' }), robotsContent: null })
    const second = await runAndStoreRobotsCheck(client.id, 'x.com', { source: 'manual' })
    expect(second.summary.changed).toBeNull()
    expect(second.changeSummary).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/robots-check/service.test.ts
```

Expected: FAIL — `changeSummary` does not exist on `StoredRobotsCheck`.

- [ ] **Step 3: Implement in `lib/robots-check/service.ts`**

Add imports:

```ts
import { buildChangeSummary, type RobotsChangeSide, type RobotsChangeSummary } from './change-summary'
```

Extend the interface:

```ts
export interface StoredRobotsCheck {
  summary: RobotsCheckSummary
  detail: RobotsCheckDetail
  /** D5: diff vs the exact total-order predecessor; null on first check or
   *  when the predecessor's detail is unreadable (mirrors changed:null). */
  changeSummary: RobotsChangeSummary | null
}
```

Add a private helper (near `changedVs`):

```ts
function changeSummaryVs(prev: RobotsCheck | null, curr: RobotsChangeSide): RobotsChangeSummary | null {
  if (!prev) return null
  const prevDetail = parseDetail(prev.detailJson)
  if (!prevDetail) return null
  return buildChangeSummary({ detail: prevDetail, robotsContent: prev.robotsContent }, curr)
}
```

In `runAndStoreRobotsCheck`, change the return statement to:

```ts
    return {
      summary: toSummary(row, changedVs(prev, row)),
      detail,
      changeSummary: changeSummaryVs(prev, { detail, robotsContent }),
    }
```

In `getRobotsCheck`, change the return statement to:

```ts
  return {
    summary: toSummary(row, changedVs(prev, row)),
    detail,
    changeSummary: changeSummaryVs(prev, { detail, robotsContent: row.robotsContent }),
  }
```

(No route changes needed — both routes already return the service object verbatim, so `changeSummary` flows through `POST /robots-checks` and `GET /robots-checks/[checkId]` automatically.)

- [ ] **Step 4: Run tests**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/robots-check/service.test.ts
```

Expected: PASS (new + all pre-existing D4 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/robots-check/service.ts lib/robots-check/service.test.ts
git commit -m "feat(d5): StoredRobotsCheck.changeSummary computed against the exact predecessor on both service paths"
```

---

### Task 4: Alert email builder

**Files:**
- Create: `lib/notify/robots-change-content.ts`
- Test: `lib/notify/robots-change-content.test.ts`

**Interfaces:**
- Consumes: `RobotsChangeSummary` (Task 2); `EmailContent` from `./content` (existing: `{ subject: string; html: string; text: string }`).
- Produces: `buildRobotsChangeEmail(input: RobotsChangeEmailInput): EmailContent` where `RobotsChangeEmailInput = { clientName: string; clientId: number; domain: string; summary: RobotsChangeSummary; currFailure: string | null; appUrl: string | null }`. Task 6 consumes it.

- [ ] **Step 1: Write the failing tests** — `lib/notify/robots-change-content.test.ts`

```ts
// lib/notify/robots-change-content.test.ts
import { describe, it, expect } from 'vitest'
import type { RobotsChangeSummary } from '@/lib/robots-check/change-summary'
import { buildRobotsChangeEmail } from './robots-change-content'

function emptySummary(overrides: Partial<RobotsChangeSummary> = {}): RobotsChangeSummary {
  return {
    robotsStatus: null, robotsContentChanged: false, robotsDiff: null,
    blockedBots: null, sitemaps: null, sitemapUrlTotal: null, counts: null,
    ...overrides,
  }
}

const base = { clientName: 'Acme College', clientId: 7, domain: 'acme.edu', currFailure: null as string | null, appUrl: 'https://seo.example.com' as string | null }

describe('buildRobotsChangeEmail', () => {
  it('subject names the domain', () => {
    const { subject } = buildRobotsChangeEmail({ ...base, summary: emptySummary({ robotsContentChanged: true }) })
    expect(subject).toBe('Robots/sitemap change: acme.edu')
  })

  it('escapes hostile robots lines in the html body', () => {
    const summary = emptySummary({
      robotsContentChanged: true,
      robotsDiff: { added: ['<script>alert(1)</script>'], removed: [], truncated: false },
    })
    const { html, text } = buildRobotsChangeEmail({ ...base, summary })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(text).toContain('<script>alert(1)</script>') // text body is plain
  })

  it('transport-honest unreachable wording (Codex #7): observation, not a site claim', () => {
    const summary = emptySummary({ robotsStatus: { prev: 'ok', curr: 'unreachable' } })
    const { text } = buildRobotsChangeEmail({ ...base, summary, currFailure: 'timeout' })
    expect(text).toContain('could not be fetched (timeout)')
    expect(text.toLowerCase()).not.toContain('removed')
  })

  it('reorder-only change (non-null EMPTY diff) gets the formatting-only notice', () => {
    const summary = emptySummary({
      robotsContentChanged: true,
      robotsDiff: { added: [], removed: [], truncated: false },
    })
    const { text } = buildRobotsChangeEmail({ ...base, summary })
    expect(text).toContain('reordering or formatting only')
  })

  it('null diff with changed content -> "line diff unavailable", never formatting-only (plan-Codex #3)', () => {
    const summary = emptySummary({ robotsContentChanged: true, robotsDiff: null })
    const { text } = buildRobotsChangeEmail({ ...base, summary })
    expect(text).toContain('line diff unavailable')
    expect(text).not.toContain('formatting only')
  })

  it('link present only when appUrl is set', () => {
    const summary = emptySummary({ robotsContentChanged: true })
    expect(buildRobotsChangeEmail({ ...base, summary }).html).toContain('https://seo.example.com/clients/7')
    expect(buildRobotsChangeEmail({ ...base, summary, appUrl: null }).html).not.toContain('/clients/7')
  })

  it('renders sitemap deltas and count movement', () => {
    const summary = emptySummary({
      sitemaps: { added: ['https://acme.edu/new.xml'], removed: [], changed: [{ url: 'https://acme.edu/s.xml', urlCountPrev: 100, urlCountCurr: 60, childrenChanged: false }], orderChanged: false },
      sitemapUrlTotal: { prev: 100, curr: 60 },
      counts: { errorsPrev: 0, errorsCurr: 2, warningsPrev: 1, warningsCurr: 1 },
    })
    const { text } = buildRobotsChangeEmail({ ...base, summary })
    expect(text).toContain('https://acme.edu/new.xml')
    expect(text).toContain('100')
    expect(text).toContain('60')
    expect(text).toContain('errors 0')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/notify/robots-change-content.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `lib/notify/robots-change-content.ts`

```ts
// lib/notify/robots-change-content.ts
//
// D5 pure change-alert email builder. Every dynamic string HTML-escaped in
// the html body; the text body is plain. Transport-honest wording (spec
// Codex #7): status transitions are phrased as monitor OBSERVATIONS
// ("robots.txt could not be fetched (timeout)"), never as site-configuration
// claims ("robots.txt was removed").

import type { RobotsChangeSummary } from '@/lib/robots-check/change-summary'
import type { EmailContent } from './content'

export interface RobotsChangeEmailInput {
  clientName: string
  clientId: number
  domain: string
  summary: RobotsChangeSummary
  /** detail.robots.failure of the CURRENT check — taxonomy for the wording. */
  currFailure: string | null
  appUrl: string | null
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function statusPhrase(status: string, failure: string | null): string {
  if (status === 'ok') return 'robots.txt is reachable'
  if (status === 'missing') return 'robots.txt responded 404/410 (missing)'
  return `robots.txt could not be fetched${failure ? ` (${failure})` : ''}`
}

export function buildRobotsChangeEmail(input: RobotsChangeEmailInput): EmailContent {
  const { summary: s } = input
  // Parallel text/html section lists; html entries are pre-escaped.
  const text: string[] = []
  const html: string[] = []
  const push = (t: string, h?: string) => { text.push(t); html.push(h ?? `<p>${esc(t)}</p>`) }

  push(`Robots/sitemap state changed for ${input.clientName} (${input.domain}).`)

  if (s.robotsStatus) {
    push(`Status: was "${statusPhrase(s.robotsStatus.prev, null)}", now "${statusPhrase(s.robotsStatus.curr, input.currFailure)}".`)
  }

  if (s.robotsDiff && (s.robotsDiff.added.length || s.robotsDiff.removed.length)) {
    const addedT = s.robotsDiff.added.map((l) => `+ ${l}`).join('\n')
    const removedT = s.robotsDiff.removed.map((l) => `- ${l}`).join('\n')
    const both = [removedT, addedT].filter(Boolean).join('\n')
    const trunc = s.robotsDiff.truncated ? '\n(diff truncated)' : ''
    text.push(`robots.txt line changes:\n${both}${trunc}`)
    const addedH = s.robotsDiff.added.map((l) => `<div style="color:#166534">+ ${esc(l)}</div>`).join('')
    const removedH = s.robotsDiff.removed.map((l) => `<div style="color:#991b1b">- ${esc(l)}</div>`).join('')
    html.push(`<p>robots.txt line changes:</p><div style="font-family:monospace;font-size:12px">${removedH}${addedH}</div>${s.robotsDiff.truncated ? '<p>(diff truncated)</p>' : ''}`)
  } else if (s.robotsContentChanged && s.robotsDiff) {
    // Non-null but EMPTY diff = both bodies were available and multiset-equal.
    push('robots.txt content changed (reordering or formatting only — no lines added or removed).')
  } else if (s.robotsContentChanged) {
    // Null diff = a raw body was unavailable (e.g. ok -> unreachable). Never
    // claim formatting-only without evidence (plan-Codex #3).
    push('robots.txt content changed; line diff unavailable.')
  }

  if (s.blockedBots) {
    if (s.blockedBots.added.length) push(`AI bots newly blocked: ${s.blockedBots.added.join(', ')}`)
    if (s.blockedBots.removed.length) push(`AI bots no longer blocked: ${s.blockedBots.removed.join(', ')}`)
  }

  if (s.sitemaps) {
    for (const url of s.sitemaps.added) push(`Sitemap added: ${url}`)
    for (const url of s.sitemaps.removed) push(`Sitemap no longer listed: ${url}`)
    for (const c of s.sitemaps.changed) {
      const countPart = c.urlCountPrev !== c.urlCountCurr ? ` (URLs ${c.urlCountPrev ?? '?'} -> ${c.urlCountCurr ?? '?'})` : ''
      const childPart = c.childrenChanged ? ' (child sitemaps changed)' : ''
      push(`Sitemap content changed: ${c.url}${countPart}${childPart}`)
    }
    if (s.sitemaps.orderChanged) push('Sitemap declaration order changed (same set).')
  }

  if (s.sitemapUrlTotal) {
    push(`Total sitemap URLs: ${s.sitemapUrlTotal.prev ?? 'none observed'} -> ${s.sitemapUrlTotal.curr ?? 'none observed'}.`)
  }
  if (s.counts) {
    push(`Validation counts: errors ${s.counts.errorsPrev} -> ${s.counts.errorsCurr}, warnings ${s.counts.warningsPrev} -> ${s.counts.warningsCurr}.`)
  }

  if (input.appUrl) {
    const link = `${input.appUrl}/clients/${input.clientId}`
    text.push(`Full history: ${link}`)
    html.push(`<p><a href="${esc(link)}">Open the client's check history</a></p>`)
  }

  return {
    subject: `Robots/sitemap change: ${input.domain}`,
    text: text.join('\n\n'),
    html: `<div style="font-family:sans-serif;max-width:640px">${html.join('')}</div>`,
  }
}
```

- [ ] **Step 4: Run tests**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/notify/robots-change-content.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/notify/robots-change-content.ts lib/notify/robots-change-content.test.ts
git commit -m "feat(d5): transport-honest robots change-alert email builder (escaped, bounded, link optional)"
```

---

### Task 5: `robots-monitor-sweep` fan-out handler

**Files:**
- Create: `lib/jobs/handlers/robots-monitor-sweep.ts`
- Test: `lib/jobs/handlers/robots-monitor-sweep.test.ts`

**Interfaces:**
- Consumes: `enqueueJob` from `../queue`; `normalizeClientDomain`/`InvalidDomainError` from `@/lib/security/domain-validation`; the string literal `'robots-monitor'` as the fan-out job type (Task 6 defines `ROBOTS_MONITOR_JOB_TYPE` with that exact value — the sweep imports the constant from `./robots-monitor`, so **Task 6's file must exist first if executing out of order; in-order execution: write this task with a local re-declared `const ROBOTS_MONITOR_JOB_TYPE = 'robots-monitor'` is FORBIDDEN — instead, do Task 6 Step 3's constant-only stub as this task's Step 3a below**).
- Produces: `ROBOTS_MONITOR_SWEEP_JOB_TYPE = 'robots-monitor-sweep'`, `runRobotsMonitorSweep(slotStartedAt: Date)`, `registerRobotsMonitorSweepHandler()` (Task 7 registers it; the system schedule fires it). Child payload shape: `{clientId: number, domain: string, slotStartedAt: number}` (epoch ms of the SWEEP job row's createdAt — Task 6's reuse boundary; plan-Codex #1).

- [ ] **Step 1: Create the constant-only stub for the domain job type** — `lib/jobs/handlers/robots-monitor.ts` (Task 6 fills in the rest; the constant lands now so the sweep can import it):

```ts
// lib/jobs/handlers/robots-monitor.ts
// D5 per-domain scheduled robots/sitemap monitor. (Handler body: Task 6.)

export const ROBOTS_MONITOR_JOB_TYPE = 'robots-monitor'
```

- [ ] **Step 2: Write the failing tests** — `lib/jobs/handlers/robots-monitor-sweep.test.ts`

```ts
// lib/jobs/handlers/robots-monitor-sweep.test.ts
//
// D5 sweep: fan-out one robots-monitor job per (active client, normalized
// registered domain). Codex #5: normalize, skip malformed, dedupe.
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { runRobotsMonitorSweep } from './robots-monitor-sweep'
import { ROBOTS_MONITOR_JOB_TYPE } from './robots-monitor'

const PREFIX = 'd5sweep-'
let counter = 0
const clientIds: number[] = []
const SLOT = new Date(Date.now() - 3_600_000) // one hour ago; fixed per suite

async function makeClient(domains: unknown, archivedAt: Date | null = null) {
  const client = await prisma.client.create({
    data: {
      name: `${PREFIX}${Date.now()}-${counter++}`,
      domains: typeof domains === 'string' ? domains : JSON.stringify(domains),
      archivedAt,
    },
  })
  clientIds.push(client.id)
  return client
}

async function jobsFor(clientId: number) {
  // dedupKey embeds the clientId — payload-owned identifier, never a
  // type-wide scan (plan-Codex #6 cleanup rule applies to reads too).
  return prisma.job.findMany({
    where: { type: ROBOTS_MONITOR_JOB_TYPE, dedupKey: { startsWith: `robots-monitor:${clientId}:` } },
  })
}

afterAll(async () => {
  // Delete ONLY this suite's jobs (by owned clientIds), never every job of
  // the type — parallel suites share nothing but must not be clobbered.
  for (const id of clientIds) {
    await prisma.job.deleteMany({
      where: { type: ROBOTS_MONITOR_JOB_TYPE, dedupKey: { startsWith: `robots-monitor:${id}:` } },
    })
  }
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('runRobotsMonitorSweep', () => {
  it('enqueues one job per normalized domain with the dedupKey shape and the slot boundary in the payload', async () => {
    const client = await makeClient(['acme-a.example', 'acme-b.example'])
    await runRobotsMonitorSweep(SLOT)
    const jobs = await jobsFor(client.id)
    expect(jobs).toHaveLength(2)
    const keys = jobs.map((j) => j.dedupKey).sort()
    expect(keys).toEqual([
      `robots-monitor:${client.id}:acme-a.example`,
      `robots-monitor:${client.id}:acme-b.example`,
    ])
    for (const j of jobs) {
      expect((JSON.parse(j.payload) as { slotStartedAt: number }).slotStartedAt).toBe(SLOT.getTime())
    }
  })

  it('skips archived clients entirely', async () => {
    const client = await makeClient(['archived.example'], new Date())
    await runRobotsMonitorSweep(SLOT)
    expect(await jobsFor(client.id)).toHaveLength(0)
  })

  it('normalizes, skips malformed entries, dedupes (Codex #5)', async () => {
    const client = await makeClient(['Dupe.example', 'dupe.example', 'not a domain!!', 42 as unknown as string])
    await runRobotsMonitorSweep(SLOT)
    const jobs = await jobsFor(client.id)
    expect(jobs).toHaveLength(1)
    expect((JSON.parse(jobs[0].payload) as { domain: string }).domain).toBe('dupe.example')
  })

  it('tolerates malformed domains JSON (treated as no domains)', async () => {
    const client = await makeClient('{{{not json')
    await runRobotsMonitorSweep(SLOT)
    expect(await jobsFor(client.id)).toHaveLength(0)
  })

  it('partial retry re-enqueues only missing jobs (dedup no-ops live ones; Codex #8)', async () => {
    const client = await makeClient(['retry.example'])
    await runRobotsMonitorSweep(SLOT)
    await runRobotsMonitorSweep(SLOT) // second pass = the retry
    expect(await jobsFor(client.id)).toHaveLength(1)
  })

  it('retry after a child went terminal re-enqueues with the SAME slot boundary (plan-Codex #1)', async () => {
    const client = await makeClient(['term.example'])
    await runRobotsMonitorSweep(SLOT)
    const [first] = await jobsFor(client.id)
    await prisma.job.update({ where: { id: first.id }, data: { status: 'complete' } })
    await runRobotsMonitorSweep(SLOT) // dedup is active-window only -> new child
    const jobs = await jobsFor(client.id)
    expect(jobs).toHaveLength(2)
    for (const j of jobs) {
      // Same boundary on BOTH children: the monitor's reuse predicate will
      // find the first child's check row instead of refetching.
      expect((JSON.parse(j.payload) as { slotStartedAt: number }).slotStartedAt).toBe(SLOT.getTime())
    }
  })
})
```

NOTE: the dedupe test assumes `normalizeClientDomain('Dupe.example')` lowercases to `'dupe.example'` — read `lib/security/domain-validation.ts:32` to confirm before finalizing; if it doesn't lowercase, pick any two inputs the helper DOES canonicalize to the same output.

- [ ] **Step 3: Run to verify failure**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/robots-monitor-sweep.test.ts
```

Expected: FAIL — `./robots-monitor-sweep` not found.

- [ ] **Step 4: Implement** — `lib/jobs/handlers/robots-monitor-sweep.ts`

```ts
// lib/jobs/handlers/robots-monitor-sweep.ts
//
// D5 weekly fan-out: one robots-monitor job per (active client, normalized
// registered domain). Fired by the system-robots-monitor schedule. Enqueue-
// only — a partial failure retried is safe because the per-domain dedupKey
// no-ops jobs that are still active (Codex #5/#8).

import { prisma } from '@/lib/db'
import { normalizeClientDomain, InvalidDomainError } from '@/lib/security/domain-validation'
import { registerJobHandler } from '../registry'
import { enqueueJob } from '../queue'
import { ROBOTS_MONITOR_JOB_TYPE } from './robots-monitor'

export const ROBOTS_MONITOR_SWEEP_JOB_TYPE = 'robots-monitor-sweep'

/** `slotStartedAt` (the SWEEP job row's createdAt) is the durable slot
 *  boundary carried to every child (plan-Codex #1): a sweep retry re-attempts
 *  the SAME job row, so a child re-enqueued after an early sibling went
 *  terminal carries the SAME boundary — the monitor's reuse predicate still
 *  finds the first run's check row. A child job's own createdAt could not
 *  promise that. */
export async function runRobotsMonitorSweep(slotStartedAt: Date): Promise<void> {
  const clients = await prisma.client.findMany({
    where: { archivedAt: null },
    select: { id: true, domains: true },
  })
  for (const client of clients) {
    const domains = new Set<string>()
    let raw: unknown = []
    try { raw = JSON.parse(client.domains) } catch { /* malformed -> no domains */ }
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (typeof entry !== 'string') continue
        try {
          domains.add(normalizeClientDomain(entry))
        } catch (err) {
          if (err instanceof InvalidDomainError) continue // malformed legacy value (Codex #5)
          throw err
        }
      }
    }
    for (const domain of domains) {
      await enqueueJob({
        type: ROBOTS_MONITOR_JOB_TYPE,
        payload: { clientId: client.id, domain, slotStartedAt: slotStartedAt.getTime() },
        dedupKey: `robots-monitor:${client.id}:${domain}`,
      })
    }
  }
}

export function registerRobotsMonitorSweepHandler(): void {
  registerJobHandler({
    type: ROBOTS_MONITOR_SWEEP_JOB_TYPE,
    concurrency: 1,
    maxAttempts: 3, // enqueue-only; per-domain dedup makes retries idempotent
    timeoutMs: 30_000,
    handler: async (_payload, ctx) => {
      const job = await prisma.job.findUnique({ where: { id: ctx.jobId }, select: { createdAt: true } })
      await runRobotsMonitorSweep(job?.createdAt ?? new Date())
    },
  })
}
```

- [ ] **Step 5: Run tests**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/robots-monitor-sweep.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/jobs/handlers/robots-monitor.ts lib/jobs/handlers/robots-monitor-sweep.ts lib/jobs/handlers/robots-monitor-sweep.test.ts
git commit -m "feat(d5): robots-monitor-sweep fan-out handler (normalize/skip/dedupe domains, per-domain dedupKey)"
```

---

### Task 6: `robots-monitor` per-domain handler

**Files:**
- Modify: `lib/jobs/handlers/robots-monitor.ts` (fill in the Task 5 stub)
- Test: `lib/jobs/handlers/robots-monitor.test.ts`

**Interfaces:**
- Consumes: `runAndStoreRobotsCheck`, `getRobotsCheck`, `StoredRobotsCheck` (Task 3); `buildRobotsChangeEmail` (Task 4); `sendEmail` from `@/lib/notify/transport`; `isNotifyEnabled`, `notifyAdminEmail` from `@/lib/notify/config`; `normalizeClientDomain` / `InvalidDomainError`; `registerJobHandler`; `RobotsCheck.alertSentAt` (Task 1).
- Produces: `ROBOTS_MONITOR_JOB_TYPE = 'robots-monitor'` (already), `RobotsMonitorDeps`, `realRobotsMonitorDeps`, `runRobotsMonitor(payload, ctx, deps?)`, `registerRobotsMonitorHandler()`. Payload contract (from Task 5): `{clientId, domain, slotStartedAt}` — `slotStartedAt` (epoch ms, the sweep job's createdAt) is the reuse boundary; when absent (hand-enqueued job) the handler falls back to its own Job row's createdAt.

- [ ] **Step 1: Write the failing tests** — `lib/jobs/handlers/robots-monitor.test.ts`

```ts
// lib/jobs/handlers/robots-monitor.test.ts
//
// D5 per-domain monitor. Injectable deps seam (spec Codex #3) — fully
// transport-free; runAndStore/getCheck are stubs backed by real DB rows so
// marker fencing and slot-scoped reuse run against the real schema.
import { describe, it, expect, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import type { RobotsCheckDetail } from '@/lib/robots-check/types'
import type { StoredRobotsCheck } from '@/lib/robots-check/service'
import { runRobotsMonitor, ROBOTS_MONITOR_JOB_TYPE, type RobotsMonitorDeps } from './robots-monitor'

const PREFIX = 'd5mon-'
let counter = 0
const createdJobIds: string[] = []
// The slot boundary every test payload carries (one hour ago — rows created
// during the test are inside the slot; rows explicitly backdated are not).
const SLOT = Date.now() - 3_600_000

function pay(clientId: number, over: Record<string, unknown> = {}) {
  return { clientId, domain: 'mon.example', slotStartedAt: SLOT, ...over }
}

function detailFixture(robotsHash: string): RobotsCheckDetail {
  return {
    v: 1, domain: 'mon.example',
    robots: { status: 'ok', httpStatus: 200, failure: null, contentHash: robotsHash, issues: [], blockedBots: [], sitemapUrls: [] },
    sitemaps: [], sitemapsSkipped: 0, timeBudgetExhausted: false,
    totals: { sitemapUrlTotal: null, errors: 0, warnings: 0 },
  }
}

async function makeClient(domains: string[] = ['mon.example'], archivedAt: Date | null = null) {
  return prisma.client.create({
    data: { name: `${PREFIX}${Date.now()}-${counter++}`, domains: JSON.stringify(domains), archivedAt },
  })
}

/** Insert a real RobotsCheck row and return a StoredRobotsCheck-shaped view. */
async function makeCheckRow(clientId: number, opts: {
  source?: string; robotsHash?: string; createdAt?: Date; changed?: boolean | null
} = {}): Promise<StoredRobotsCheck> {
  const detail = detailFixture(opts.robotsHash ?? 'h1')
  const row = await prisma.robotsCheck.create({
    data: {
      clientId, domain: 'mon.example', source: opts.source ?? 'scheduled',
      robotsStatus: 'ok', robotsContentHash: detail.robots.contentHash,
      robotsContent: 'User-agent: *', sitemapUrlTotal: null, errorCount: 0, warningCount: 0,
      detailJson: JSON.stringify(detail),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  })
  return {
    summary: {
      id: row.id, domain: row.domain, source: row.source, robotsStatus: 'ok',
      sitemapUrlTotal: null, errorCount: 0, warningCount: 0,
      changed: opts.changed === undefined ? true : opts.changed,
      createdAt: row.createdAt.toISOString(),
    },
    detail,
    changeSummary: {
      robotsStatus: null, robotsContentChanged: true,
      robotsDiff: { added: ['Disallow: /x'], removed: [], truncated: false },
      blockedBots: null, sitemaps: null, sitemapUrlTotal: null, counts: null,
    },
  }
}

/** Only the payload-boundary FALLBACK test needs a real Job row. */
async function makeJob(createdAt: Date) {
  const job = await prisma.job.create({
    data: { type: ROBOTS_MONITOR_JOB_TYPE, payload: '{}', status: 'running', createdAt },
  })
  createdJobIds.push(job.id)
  return job
}

function makeDeps(overrides: Partial<RobotsMonitorDeps> = {}): {
  deps: RobotsMonitorDeps
  sent: Array<{ to: string; subject: string }>
  runAndStore: ReturnType<typeof vi.fn>
  getCheck: ReturnType<typeof vi.fn>
} {
  const sent: Array<{ to: string; subject: string }> = []
  const runAndStore = vi.fn()
  const getCheck = vi.fn()
  const deps: RobotsMonitorDeps = {
    runAndStore, getCheck,
    send: vi.fn(async (args: { to: string; content: { subject: string } }) => { sent.push({ to: args.to, subject: args.content.subject }) }) as unknown as RobotsMonitorDeps['send'],
    notifyEnabled: () => true,
    adminEmail: () => 'admin@example.com',
    now: () => new Date(),
    ...overrides,
  }
  return { deps, sent, runAndStore, getCheck }
}

afterAll(async () => {
  // Delete ONLY rows this suite created (recorded ids / PREFIX-scoped
  // clients; RobotsCheck rows cascade from Client) — plan-Codex #6.
  if (createdJobIds.length) await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: PREFIX } } })
})

describe('runRobotsMonitor', () => {
  it('changed:false -> no email (row inside the slot is reused, no refetch)', async () => {
    const client = await makeClient()
    const stored = await makeCheckRow(client.id, { changed: false })
    const { deps, sent, runAndStore, getCheck } = makeDeps()
    getCheck.mockResolvedValue(stored)
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(runAndStore).not.toHaveBeenCalled() // reuse hit
    expect(getCheck).toHaveBeenCalledWith(client.id, stored.summary.id)
    expect(sent).toHaveLength(0)
  })

  it('changed:null (first check / corrupt predecessor) -> silent (Codex #8)', async () => {
    const client = await makeClient()
    const stored = await makeCheckRow(client.id, { changed: null })
    const { deps, sent, getCheck } = makeDeps()
    getCheck.mockResolvedValue(stored)
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(sent).toHaveLength(0)
  })

  it('changed:true -> one email, marker stamped, second run sends nothing', async () => {
    const client = await makeClient()
    const stored = await makeCheckRow(client.id)
    const { deps, sent, runAndStore, getCheck } = makeDeps()
    getCheck.mockResolvedValue(stored)

    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('admin@example.com')
    expect(runAndStore).not.toHaveBeenCalled() // slot-scoped reuse found the row

    const row = await prisma.robotsCheck.findUnique({ where: { id: stored.summary.id } })
    expect(row!.alertSentAt).not.toBeNull()

    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(sent).toHaveLength(1) // marker fence held
  })

  it('a PRIOR slot row (createdAt < slotStartedAt) is never reused (Codex #1)', async () => {
    const client = await makeClient()
    await makeCheckRow(client.id, { createdAt: new Date(SLOT - 86_400_000) }) // last week's row
    const { deps, runAndStore, getCheck } = makeDeps()
    // The fresh run creates its row INSIDE the mock, after the reuse miss.
    runAndStore.mockImplementation(async () => makeCheckRow(client.id, { changed: false }))
    getCheck.mockImplementation(async (_cid: number, id: number) => {
      const view = await makeCheckRow(client.id, { changed: false })
      return { ...view, summary: { ...view.summary, id } }
    })
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(runAndStore).toHaveBeenCalledTimes(1) // old row failed the >= boundary
  })

  it('missing slotStartedAt falls back to this job row own createdAt', async () => {
    const client = await makeClient()
    const job = await makeJob(new Date(SLOT))
    const stored = await makeCheckRow(client.id, { changed: false }) // created now, >= job.createdAt
    const { deps, runAndStore, getCheck } = makeDeps()
    getCheck.mockResolvedValue(stored)
    await runRobotsMonitor({ clientId: client.id, domain: 'mon.example' }, { jobId: job.id }, deps)
    expect(runAndStore).not.toHaveBeenCalled() // fallback boundary reused the row
  })

  it('archived client -> no fetch, no reuse, no email (revalidation first; Codex #1)', async () => {
    const client = await makeClient(['mon.example'], new Date())
    await makeCheckRow(client.id)
    const { deps, sent, runAndStore, getCheck } = makeDeps()
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(runAndStore).not.toHaveBeenCalled()
    expect(getCheck).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('delisted domain -> no-op', async () => {
    const client = await makeClient(['other.example'])
    const { deps, sent, runAndStore } = makeDeps()
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(runAndStore).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('stored domains are normalized before membership (case-variant list; plan-Codex #2)', async () => {
    const client = await makeClient(['Mon.Example']) // legacy casing in the stored list
    const stored = await makeCheckRow(client.id, { changed: false })
    const { deps, runAndStore, getCheck } = makeDeps()
    getCheck.mockResolvedValue(stored)
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(getCheck).toHaveBeenCalled() // revalidation passed via normalization
    expect(runAndStore).not.toHaveBeenCalled()
  })

  it('manual single-flight winner -> silent complete (Codex #2)', async () => {
    const client = await makeClient()
    const { deps, sent, runAndStore, getCheck } = makeDeps()
    // No scheduled row inside the slot -> fresh run; the joiner got a MANUAL row.
    runAndStore.mockImplementation(async () => makeCheckRow(client.id, { source: 'manual' }))
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(runAndStore).toHaveBeenCalledTimes(1)
    expect(getCheck).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('dark notify env -> permanent suppression: no stamp now, no back-send next week (Codex #6/#8)', async () => {
    const client = await makeClient()
    const stored = await makeCheckRow(client.id)
    const { deps, sent, getCheck } = makeDeps({ notifyEnabled: () => false })
    getCheck.mockResolvedValue(stored)
    await runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)
    expect(sent).toHaveLength(0)
    const row = await prisma.robotsCheck.findUnique({ where: { id: stored.summary.id } })
    expect(row!.alertSentAt).toBeNull()

    // Next weekly slot, notify now LIT: the new row compares against the
    // changed row and reads unchanged -> still no email (no catch-up).
    const nextSlot = Date.now() - 1_000
    const nextStored = await makeCheckRow(client.id, { changed: false })
    const lit = makeDeps({ notifyEnabled: () => true })
    lit.getCheck.mockResolvedValue(nextStored)
    await runRobotsMonitor(pay(client.id, { slotStartedAt: nextSlot }), { jobId: 'job-x' }, lit.deps)
    expect(lit.sent).toHaveLength(0)
  })

  it('send failure -> throws (worker retry), marker not stamped', async () => {
    const client = await makeClient()
    const stored = await makeCheckRow(client.id)
    const { deps, getCheck } = makeDeps({
      send: vi.fn(async () => { throw new Error('mailgun 500') }) as unknown as RobotsMonitorDeps['send'],
    })
    getCheck.mockResolvedValue(stored)
    await expect(runRobotsMonitor(pay(client.id), { jobId: 'job-x' }, deps)).rejects.toThrow('mailgun 500')
    const row = await prisma.robotsCheck.findUnique({ where: { id: stored.summary.id } })
    expect(row!.alertSentAt).toBeNull()
  })

  it('malformed payload -> silent no-op', async () => {
    const { deps, sent, runAndStore } = makeDeps()
    await runRobotsMonitor({ nope: true }, { jobId: 'job-x' }, deps)
    expect(runAndStore).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })
})
```

NOTE: the reuse-hit tests assume the handler's reuse query targets the newest `source:'scheduled'` row with `createdAt >= slotStartedAt` and passes ITS id to `deps.getCheck` — the `getCheck.mockResolvedValue(stored)` stubs return the matching view. Verify the `Job` model's required create fields before finalizing `makeJob` (check `prisma/schema.prisma` `model Job`) — supply any non-null columns (e.g. `runAfter`, `maxAttempts`) with sensible literals if the create fails.

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/robots-monitor.test.ts
```

Expected: FAIL — `runRobotsMonitor` not exported.

- [ ] **Step 3: Implement** — replace the Task 5 stub content of `lib/jobs/handlers/robots-monitor.ts` with:

```ts
// lib/jobs/handlers/robots-monitor.ts
//
// D5 per-domain scheduled robots/sitemap monitor, fired by the weekly
// robots-monitor-sweep fan-out. Runs (or job-scope-reuses) a scheduled D4
// RobotsCheck and, when the stored row CHANGED vs its exact predecessor,
// sends ONE change-alert email (dark-gated, marker-fenced, at-least-once).
//
// Ordering rules (spec Codex #1/#2/#3/#6 + plan-Codex #1/#2):
// - revalidation (with NORMALIZED stored-domain membership) runs BEFORE
//   reuse and alerting, on every path
// - reuse boundary = the sweep slot's createdAt carried in the payload
//   (durable across child re-enqueues; never wall clock); fallback = this
//   job row's own createdAt
// - only source:'scheduled' rows ever alert (a manual single-flight winner
//   absorbs the change silently)
// - dark notify env = PERMANENT suppression for that change (no stamp)

import { prisma } from '@/lib/db'
import { normalizeClientDomain, InvalidDomainError } from '@/lib/security/domain-validation'
import { isNotifyEnabled, notifyAdminEmail } from '@/lib/notify/config'
import { buildRobotsChangeEmail } from '@/lib/notify/robots-change-content'
import { sendEmail } from '@/lib/notify/transport'
import { runAndStoreRobotsCheck, getRobotsCheck, type StoredRobotsCheck } from '@/lib/robots-check/service'
import { registerJobHandler } from '../registry'

export const ROBOTS_MONITOR_JOB_TYPE = 'robots-monitor'

export interface RobotsMonitorDeps {
  runAndStore: (clientId: number, domain: string, opts: { source: 'scheduled' }) => Promise<StoredRobotsCheck>
  getCheck: (clientId: number, checkId: number) => Promise<StoredRobotsCheck | null>
  send: typeof sendEmail
  notifyEnabled: () => boolean
  adminEmail: () => string
  now: () => Date
}

export const realRobotsMonitorDeps: RobotsMonitorDeps = {
  runAndStore: (clientId, domain, opts) => runAndStoreRobotsCheck(clientId, domain, opts),
  getCheck: (clientId, checkId) => getRobotsCheck(clientId, checkId),
  send: sendEmail,
  notifyEnabled: isNotifyEnabled,
  adminEmail: notifyAdminEmail,
  now: () => new Date(),
}

interface Payload { clientId: number; domain: string; slotStartedAt: number | null }

function parsePayload(payload: unknown): Payload | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  if (typeof p.clientId !== 'number' || !Number.isInteger(p.clientId) || p.clientId < 1) return null
  if (typeof p.domain !== 'string' || p.domain.length === 0) return null
  const slotStartedAt =
    typeof p.slotStartedAt === 'number' && Number.isInteger(p.slotStartedAt) && p.slotStartedAt > 0
      ? p.slotStartedAt
      : null
  return { clientId: p.clientId, domain: p.domain, slotStartedAt }
}

function parseClientDomains(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : []
  } catch {
    return []
  }
}

export async function runRobotsMonitor(
  payload: unknown,
  ctx: { jobId: string },
  deps: RobotsMonitorDeps = realRobotsMonitorDeps,
): Promise<void> {
  const p = parsePayload(payload)
  if (!p) {
    console.warn('[robots-monitor] malformed payload; skipping')
    return
  }

  // 1. Revalidate FIRST, on every path (Codex #1): archived clients and
  //    delisted domains never get fetched, reused, or emailed.
  let domain: string
  try {
    domain = normalizeClientDomain(p.domain)
  } catch (err) {
    if (err instanceof InvalidDomainError) {
      console.warn('[robots-monitor] invalid payload domain; skipping')
      return
    }
    throw err
  }
  const client = await prisma.client.findUnique({
    where: { id: p.clientId },
    select: { name: true, archivedAt: true, domains: true },
  })
  if (!client || client.archivedAt) {
    console.warn(`[robots-monitor] client ${p.clientId} missing/archived; skipping`)
    return
  }
  // Membership over the NORMALIZED stored list (plan-Codex #2): a legacy
  // 'Dupe.example' entry was enqueued as 'dupe.example' — comparing raw
  // stored values would wrongly reject it as delisted.
  const listed = new Set<string>()
  for (const entry of parseClientDomains(client.domains)) {
    try {
      listed.add(normalizeClientDomain(entry))
    } catch (err) {
      if (!(err instanceof InvalidDomainError)) throw err // malformed legacy entry -> skip
    }
  }
  if (!listed.has(domain)) {
    console.warn(`[robots-monitor] ${domain} no longer listed for client ${p.clientId}; skipping`)
    return
  }

  // 2. Slot-scoped reuse (Codex #1 + plan-Codex #1): the SWEEP job's
  //    createdAt, carried in the payload, is the durable slot boundary — it
  //    survives child-job re-enqueues after an early child went terminal (a
  //    child's own createdAt would not). Fallback for hand-enqueued jobs
  //    without the field: this job row's createdAt.
  let boundary: Date | null = p.slotStartedAt !== null ? new Date(p.slotStartedAt) : null
  if (!boundary) {
    const job = await prisma.job.findUnique({ where: { id: ctx.jobId }, select: { createdAt: true } })
    boundary = job?.createdAt ?? null
  }
  const reusable = boundary
    ? await prisma.robotsCheck.findFirst({
        where: { clientId: p.clientId, domain, source: 'scheduled', createdAt: { gte: boundary } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
    : null

  let checkId: number
  if (reusable) {
    checkId = reusable.id
  } else {
    const fresh = await deps.runAndStore(p.clientId, domain, { source: 'scheduled' })
    // Source fence (Codex #2): a concurrent manual POST that won the D4
    // single-flight hands us ITS row — manual absorption means silence.
    if (fresh.summary.source !== 'scheduled') {
      console.log(`[robots-monitor] manual check absorbed the slot for ${domain}; no alert`)
      return
    }
    checkId = fresh.summary.id
  }

  // 3. Stored-row resolution (Codex #3): the service seam owns the exact
  //    predecessor + changeSummary. Never re-derive evidence here.
  const stored = await deps.getCheck(p.clientId, checkId)
  if (!stored) {
    console.warn(`[robots-monitor] check ${checkId} unreadable post-store; no alert`)
    return
  }
  if (stored.summary.changed !== true || stored.summary.source !== 'scheduled') return
  if (!stored.changeSummary) return // changed:true implies a summary; defensive

  // 4. Alert: read marker -> dark gate -> send -> conditional stamp (D7
  //    at-least-once contract, narrow dup window).
  const row = await prisma.robotsCheck.findUnique({ where: { id: checkId }, select: { alertSentAt: true } })
  if (!row || row.alertSentAt) return
  if (!deps.notifyEnabled()) {
    // Permanent suppression by design (Codex #6): next week compares against
    // this row and reads unchanged — dark means this email never existed.
    console.log(`[robots-monitor] change detected for ${domain} but notify env dark; suppressed`)
    return
  }
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '') || null
  const content = buildRobotsChangeEmail({
    clientName: client.name,
    clientId: p.clientId,
    domain,
    summary: stored.changeSummary,
    currFailure: stored.detail.robots.failure,
    appUrl,
  })
  await deps.send({ to: deps.adminEmail(), content })
  await prisma.robotsCheck.updateMany({
    where: { id: checkId, alertSentAt: null },
    data: { alertSentAt: deps.now() },
  })
}

export function registerRobotsMonitorHandler(): void {
  registerJobHandler({
    type: ROBOTS_MONITOR_JOB_TYPE,
    concurrency: 1, // politeness: one client site fetched at a time
    maxAttempts: 2,
    timeoutMs: 120_000, // worst-case check ~75s + DB + one 10s email send
    onExhausted: async (_payload, ctx) => {
      // The in-app changed badge still shows the change; next weekly slot
      // will NOT re-alert it (its predecessor becomes the changed row).
      console.warn(`[robots-monitor] job ${ctx.jobId} exhausted after ${ctx.attempts} attempts: ${ctx.lastError}`)
    },
    handler: async (payload, ctx) => {
      await runRobotsMonitor(payload, ctx)
    },
  })
}
```

Verify the `registerJobHandler` config shape against `lib/jobs/registry.ts` (`onExhausted` signature: `(payload, ctx: JobExhaustedContext)`).

- [ ] **Step 4: Run tests**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/robots-monitor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/robots-monitor.ts lib/jobs/handlers/robots-monitor.test.ts
git commit -m "feat(d5): robots-monitor handler - revalidate-first, job-scoped reuse, source fence, marker-fenced dark-gated alert email"
```

---

### Task 7: Registration + system schedule

**Files:**
- Modify: `lib/jobs/handlers/register.ts`
- Modify: `lib/jobs/system-schedules.ts`
- Test: `lib/jobs/handlers/register.test.ts` (extend list), `lib/jobs/system-schedules.test.ts` (new case)

**Interfaces:**
- Consumes: `registerRobotsMonitorHandler` (Task 6), `registerRobotsMonitorSweepHandler` + `ROBOTS_MONITOR_SWEEP_JOB_TYPE` (Task 5).
- Produces: both types resolvable via `getJobHandler`; a seeded `system-robots-monitor` Schedule row (`weekly:1@06:30`, `immediate: false`).

- [ ] **Step 1: Write the failing tests**

In `lib/jobs/handlers/register.test.ts`, add to the type list inside the existing loop:

```ts
      'robots-monitor', 'robots-monitor-sweep',
```

In `lib/jobs/system-schedules.test.ts`, add (inside the main describe, following the `system-health-alert` case's pattern at ~line 45):

```ts
  it('seeds system-robots-monitor weekly, not immediate (D5)', async () => {
    await seedSystemSchedules()
    const rows = await prisma.schedule.findMany({ where: { name: { startsWith: 'system-' } } })
    const monitor = rows.find((r) => r.name === 'system-robots-monitor')!
    expect(monitor).toBeDefined()
    expect(monitor.jobType).toBe('robots-monitor-sweep')
    expect(monitor.cadence).toBe('weekly:1@06:30')
    expect(monitor.enabled).toBe(true)
    // immediate:false -> nextRunAt is a FUTURE weekly:1@06:30 slot, never now
    expect(monitor.nextRunAt.getTime()).toBeGreaterThan(Date.now())
    expect(monitor.nextRunAt.getDay()).toBe(1) // Monday, server-local
  })
```

(Deterministic form, plan-Codex #6: if `seedSystemSchedules` accepts an injected `now` — check its signature in `lib/jobs/system-schedules.ts` — pass a fixed date and assert `monitor.nextRunAt` equals `nextRun('weekly:1@06:30', fixedNow)` from `lib/jobs/scheduler`; otherwise the future-Monday assertions above are the fallback. Mirror the `system-health-alert` test's structure for seeding.)

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/register.test.ts lib/jobs/system-schedules.test.ts
```

Expected: FAIL — unregistered types / missing schedule row.

- [ ] **Step 3: Implement**

`lib/jobs/handlers/register.ts` — add imports + calls:

```ts
import { registerRobotsMonitorHandler } from './robots-monitor'
import { registerRobotsMonitorSweepHandler } from './robots-monitor-sweep'
```

and inside `registerBuiltInJobHandlers()`:

```ts
  registerRobotsMonitorHandler()
  registerRobotsMonitorSweepHandler()
```

`lib/jobs/system-schedules.ts` — add import:

```ts
import { ROBOTS_MONITOR_SWEEP_JOB_TYPE } from './handlers/robots-monitor-sweep'
```

and append to `SYSTEM_SCHEDULES`:

```ts
  // D5: weekly robots/sitemap monitoring sweep — Monday 06:30 server-local
  // (prod host runs UTC), clear of db-backup 08:00 and cleanup 09:00.
  { name: 'system-robots-monitor', jobType: ROBOTS_MONITOR_SWEEP_JOB_TYPE, cadence: 'weekly:1@06:30', immediate: false },
```

CHECK first: if every other `SYSTEM_SCHEDULES` entry imports its job-type constant from the handler module and that pattern creates no import cycle, follow it; if `system-schedules.ts` uses string literals or local constants for any entry, follow THAT pattern instead (a `handlers/robots-monitor-sweep` import from `system-schedules.ts` must not create a cycle — `robots-monitor-sweep.ts` imports `../queue` and `../registry`, not `../system-schedules`, so it is safe).

- [ ] **Step 4: Run tests**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run lib/jobs/handlers/register.test.ts lib/jobs/system-schedules.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/jobs/handlers/register.ts lib/jobs/system-schedules.ts lib/jobs/handlers/register.test.ts lib/jobs/system-schedules.test.ts
git commit -m "feat(d5): register robots-monitor handlers + seed system-robots-monitor weekly schedule"
```

---

### Task 8: Card — "Changed vs previous" section + childrenExcluded line

**Files:**
- Modify: `components/clients/RobotsCheckCard.tsx`
- Test: `components/clients/RobotsCheckCard.test.tsx` (append cases)

**Interfaces:**
- Consumes: `RobotsChangeSummary` from `@/lib/robots-check/change-summary` (client-safe, Task 2); the detail GET already returns `{ summary, detail, changeSummary }` (Task 3).
- Produces: UI only.

- [ ] **Step 1: Write the failing tests** — append to `components/clients/RobotsCheckCard.test.tsx`, following the file's existing conventions (`// @vitest-environment jsdom` header, `afterEach(cleanup)`, fetch stubbing via `vi.stubGlobal`, `vi.unstubAllGlobals()`). Read the existing file first and reuse its fixture builders. New cases:

The file's existing conventions apply verbatim (`// @vitest-environment jsdom` header, `afterEach(cleanup + vi.unstubAllGlobals())`, the `summaryFixture`/`detailFixture` helpers). Add one import and one fixture at top level:

```ts
import type { RobotsChangeSummary } from '@/lib/robots-check/change-summary'

function changeSummaryFixture(over: Partial<RobotsChangeSummary> = {}): RobotsChangeSummary {
  return {
    robotsStatus: null, robotsContentChanged: false, robotsDiff: null,
    blockedBots: null, sitemaps: null, sitemapUrlTotal: null, counts: null, ...over,
  }
}

/** Render one changed history row and stub its detail GET. */
function renderExpandable(changeSummary: RobotsChangeSummary | null, changed: boolean | null = true) {
  const stored = {
    summary: summaryFixture({ id: 11, changed }),
    detail: detailFixture(),
    changeSummary,
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => stored }))
  render(
    <RobotsCheckCard
      clientId={1} domains={['example.com']} archived={false}
      initial={{ checks: [summaryFixture({ id: 11, changed })], latest: null }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Jul/ }))
}
```

New describe blocks:

```tsx
describe('changed-vs-previous section (D5)', () => {
  it('renders added/removed robots lines when the expanded row changed', async () => {
    renderExpandable(changeSummaryFixture({
      robotsContentChanged: true,
      robotsDiff: { added: ['Disallow: /x'], removed: ['Allow: /'], truncated: false },
    }))
    await waitFor(() => expect(screen.getByText('Changed vs previous')).toBeTruthy())
    expect(screen.getByText('+ Disallow: /x')).toBeTruthy()
    expect(screen.getByText('- Allow: /')).toBeTruthy()
  })

  it('reorder-only (non-null EMPTY diff) renders the formatting-only notice', async () => {
    renderExpandable(changeSummaryFixture({
      robotsContentChanged: true,
      robotsDiff: { added: [], removed: [], truncated: false },
    }))
    await waitFor(() => expect(screen.getByText(/reordering or formatting only/)).toBeTruthy())
  })

  it('null diff with changed content renders line-diff-unavailable, never formatting-only (plan-Codex #3)', async () => {
    renderExpandable(changeSummaryFixture({ robotsContentChanged: true, robotsDiff: null }))
    await waitFor(() => expect(screen.getByText(/line diff unavailable/)).toBeTruthy())
    expect(screen.queryByText(/formatting only/)).toBeNull()
  })

  it('renders error/warning count movement (plan-Codex #4)', async () => {
    renderExpandable(changeSummaryFixture({
      robotsContentChanged: true,
      robotsDiff: { added: [], removed: [], truncated: false },
      counts: { errorsPrev: 0, errorsCurr: 2, warningsPrev: 1, warningsCurr: 1 },
    }))
    await waitFor(() => expect(screen.getByText(/Errors 0 → 2/)).toBeTruthy())
  })

  it('no section when the row did not change', async () => {
    renderExpandable(changeSummaryFixture({ robotsContentChanged: true }), false)
    await waitFor(() => expect(screen.getByText(/issue\(s\) recorded/)).toBeTruthy())
    expect(screen.queryByText('Changed vs previous')).toBeNull()
  })
})

describe('childrenExcluded line (D4 follow-up #2)', () => {
  it('renders the excluded count for index sitemaps that filtered children', () => {
    const detail = detailFixture()
    detail.sitemaps[0] = { ...detail.sitemaps[0], isIndex: true, childrenTotal: 5, childrenExcluded: 3 }
    render(
      <RobotsCheckCard
        clientId={1} domains={['example.com']} archived={false}
        initial={{ checks: [summaryFixture()], latest: { summary: summaryFixture(), detail } }}
      />,
    )
    expect(screen.getByText(/3 excluded/)).toBeTruthy()
  })
})
```

(The D4 `Latest` fixture objects in older tests lack `changeSummary` — the field is optional on the interface, so they stay untouched.)

- [ ] **Step 2: Run to verify failure**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/RobotsCheckCard.test.tsx
```

Expected: FAIL — section not rendered.

- [ ] **Step 3: Implement in `components/clients/RobotsCheckCard.tsx`**

1. Import the summary type:

```ts
import type { RobotsChangeSummary } from '@/lib/robots-check/change-summary'
```

2. Extend the `Latest` interface:

```ts
interface Latest {
  summary: RobotsCheckSummary
  detail: RobotsCheckDetail
  changeSummary?: RobotsChangeSummary | null
}
```

3. Change `expandedDetail` state to hold the whole payload — replace `useState<RobotsCheckDetail | null>` with `useState<Latest | null>` (rename to `expandedStored`), and in `toggleExpand` store the full parsed object instead of `.detail` (update the two `setExpandedDetail(...)` call sites and the render guard `expandedId === c.id && expandedStored`).

4. Add a pure section component in the same file (React escapes all strings by default — the D4 "MUST be HTML-escaped" rule is satisfied by never using `dangerouslySetInnerHTML`):

```tsx
function ChangeSummarySection({ summary }: { summary: RobotsChangeSummary }) {
  const diff = summary.robotsDiff
  // plan-Codex #3: non-null EMPTY diff = reorder/formatting-only evidence;
  // NULL diff with a changed hash = a raw body was unavailable — say so.
  const reorderOnly = summary.robotsContentChanged && diff !== null && diff.added.length === 0 && diff.removed.length === 0
  const diffUnavailable = summary.robotsContentChanged && diff === null
  return (
    <div className="mt-1 border-l-2 border-orange/40 pl-2">
      <p className="text-[11px] font-semibold text-gray-600 dark:text-white/60">Changed vs previous</p>
      {summary.robotsStatus && (
        <p className="text-[11px] text-gray-500 dark:text-white/50">
          Robots status: {summary.robotsStatus.prev} &rarr; {summary.robotsStatus.curr}
        </p>
      )}
      {diff && diff.removed.map((l, i) => (
        <p key={`r${i}`} className="font-mono text-[11px] text-red-600 dark:text-red-400">- {l}</p>
      ))}
      {diff && diff.added.map((l, i) => (
        <p key={`a${i}`} className="font-mono text-[11px] text-green-700 dark:text-green-400">+ {l}</p>
      ))}
      {diff?.truncated && <p className="text-[11px] text-gray-400 dark:text-white/40">(diff truncated)</p>}
      {reorderOnly && (
        <p className="text-[11px] text-gray-500 dark:text-white/50">robots.txt changed (reordering or formatting only)</p>
      )}
      {diffUnavailable && (
        <p className="text-[11px] text-gray-500 dark:text-white/50">robots.txt content changed (line diff unavailable)</p>
      )}
      {summary.blockedBots?.added.length ? (
        <p className="text-[11px] text-red-600 dark:text-red-400">AI bots newly blocked: {summary.blockedBots.added.join(', ')}</p>
      ) : null}
      {summary.blockedBots?.removed.length ? (
        <p className="text-[11px] text-gray-500 dark:text-white/50">AI bots unblocked: {summary.blockedBots.removed.join(', ')}</p>
      ) : null}
      {summary.sitemaps && (
        <>
          {/* index-based keys: duplicate URLs are deliberately preserved
              upstream via (url, ordinal) pairing — URL-only keys collide
              (plan-Codex #4) */}
          {summary.sitemaps.added.map((u, i) => <p key={`sa${i}`} className="text-[11px] text-gray-500 dark:text-white/50">Sitemap added: <span className="font-mono">{u}</span></p>)}
          {summary.sitemaps.removed.map((u, i) => <p key={`sr${i}`} className="text-[11px] text-gray-500 dark:text-white/50">Sitemap removed: <span className="font-mono">{u}</span></p>)}
          {summary.sitemaps.changed.map((c, i) => (
            <p key={`sc${i}`} className="text-[11px] text-gray-500 dark:text-white/50">
              Sitemap changed: <span className="font-mono">{c.url}</span>
              {c.urlCountPrev !== c.urlCountCurr ? ` (URLs ${c.urlCountPrev ?? '?'} → ${c.urlCountCurr ?? '?'})` : ''}
              {c.childrenChanged ? ' (children changed)' : ''}
            </p>
          ))}
          {summary.sitemaps.orderChanged && <p className="text-[11px] text-gray-500 dark:text-white/50">Sitemap order changed (same set)</p>}
        </>
      )}
      {summary.sitemapUrlTotal && (
        <p className="text-[11px] text-gray-500 dark:text-white/50 tabular-nums">
          Total sitemap URLs: {summary.sitemapUrlTotal.prev ?? '—'} &rarr; {summary.sitemapUrlTotal.curr ?? '—'}
        </p>
      )}
      {summary.counts && (
        <p className="text-[11px] text-gray-500 dark:text-white/50 tabular-nums">
          Errors {summary.counts.errorsPrev} &rarr; {summary.counts.errorsCurr} · warnings {summary.counts.warningsPrev} &rarr; {summary.counts.warningsCurr}
        </p>
      )}
    </div>
  )
}
```

5. Render it inside the expanded row block, after the existing issue-count line:

```tsx
{expandedId === c.id && expandedStored && (
  <div className="pl-4 py-1 text-[11px] text-gray-500 dark:text-white/50">
    {expandedStored.detail.robots.issues.length + expandedStored.detail.sitemaps.reduce((n, s) => n + s.issues.length, 0)} issue(s) recorded ·{' '}
    {expandedStored.detail.robots.blockedBots.length} AI bot(s) blocked
    {expandedStored.summary.changed === true && expandedStored.changeSummary && (
      <ChangeSummarySection summary={expandedStored.changeSummary} />
    )}
  </div>
)}
```

6. childrenExcluded — in the latest-detail sitemap list `<li>`, extend the ok-branch span:

```tsx
<span className="tabular-nums">
  {s.urlCount} URLs{s.isIndex ? ` · ${s.childrenTotal} children (${s.childrenFailed} failed${s.childrenExcluded > 0 ? `, ${s.childrenExcluded} excluded` : ''})` : ''}
</span>
```

- [ ] **Step 4: Run tests**

```bash
DATABASE_URL="file:./local-dev.db" npx vitest run components/clients/RobotsCheckCard.test.tsx
```

Expected: PASS (new + all pre-existing D4 cases).

- [ ] **Step 5: Commit**

```bash
git add components/clients/RobotsCheckCard.tsx components/clients/RobotsCheckCard.test.tsx
git commit -m "feat(d5): changed-vs-previous section + childrenExcluded line in RobotsCheckCard"
```

---

### Task 9: Gates, docs, PR

**Files:**
- Modify: `CLAUDE.md` (key-files `lib/robots-check/` entry)

- [ ] **Step 1: Full gates**

```bash
npm run lint && DATABASE_URL="file:./local-dev.db" npm test && npm run build
```

Expected: all PASS. (No smoke run needed: no auth / SF-upload / ADA-pipeline surface touched; `/clients/[id]` is not on the smoke walk — confirm in the smoke spec if unsure.)

- [ ] **Step 2: Update `CLAUDE.md`** — extend the `lib/robots-check/` key-files entry: append a sentence noting D5: `monitor.ts`-less design (handlers live in `lib/jobs/handlers/robots-monitor{,-sweep}.ts`), weekly `system-robots-monitor` schedule (weekly:1@06:30), change-only alert email via D7 notify (dark-gated, `RobotsCheck.alertSentAt` marker), `changeSummary` on both service paths from the client-safe `change-summary.ts`, migration `20260713120000`, spec path.

- [ ] **Step 3: Commit docs + open the PR**

```bash
git add CLAUDE.md
git commit -m "docs(d5): CLAUDE.md key-files update for scheduled robots monitoring"
git push -u origin feat/d5-robots-monitoring
gh pr create --title "feat(d5): scheduled robots/sitemap monitoring with change-only alerts" --body "$(cat <<'EOF'
Weekly system-robots-monitor schedule -> robots-monitor-sweep fan-out -> per-domain robots-monitor jobs: revalidate-first, job-scoped reuse, source-fenced change-only alert emails (dark-gated D7 Mailgun, RobotsCheck.alertSentAt marker), RobotsChangeSummary on both service paths, changed-vs-previous card section + childrenExcluded line.

Spec: docs/superpowers/specs/2026-07-13-d5-scheduled-robots-monitoring-design.md (Codex fixes #1-#8 applied)
Migration: 20260713120000_robots_alert_marker (additive nullable column)

No new env vars; notify stays dark-gated. No middleware change. lib/seo-fetch and the D4 runner untouched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_0166sVCTWUMeNuetJKqZzRCD
EOF
)"
```

- [ ] **Step 4: After merge + deploy** (merging session): tracker checkbox + dated status-log line + handoff rewrite in the SAME commit; move spec+plan to `docs/superpowers/archive/`; post-deploy verification = `/api/health` ok, `Schedule` table has `system-robots-monitor`, and one manually-enqueued `robots-monitor` job for a real client domain completes and (if changed) stamps/skips correctly.

---

## Self-review notes

- Spec coverage: decisions 1–4 → Tasks 5–7 (channel/enablement), Task 2 (issue-set non-alerting is inherent — evidence-based summary only), Task 8 (quirk #2 childrenExcluded). Codex #1/#2/#3 → Task 6; #4 → Task 2; #5 → Tasks 5/6; #6/#7 → Tasks 4/6; #8 → spread across all test steps.
- Type consistency: `StoredRobotsCheck.changeSummary` (Task 3) matches Task 6 (`stored.changeSummary`) and Task 8 (`Latest.changeSummary`); `RobotsChangeSide`/`RobotsChangeSummary` names consistent across Tasks 2/3/4/8; `ROBOTS_MONITOR_JOB_TYPE` defined once (Task 5 stub, Task 6 body).
- Known judgment points left to the implementer (explicitly marked): `makeJob` required fields, `normalizeClientDomain` URL-input behavior, deterministic rewrite of the prior-slot reuse test, system-schedules test-file conventions.
