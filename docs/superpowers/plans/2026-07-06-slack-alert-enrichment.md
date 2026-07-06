# Slack Alert Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The D0 Slack health alert carries the actual error message and a clickable link to each failed scan, instead of bare counts.

**Architecture:** `collectHealthSignals` (lib/ops/health-check.ts) fetches capped detail rows alongside the existing counts; the pure `evaluateHealth` renders Slack-mrkdwn lines from them. Counts remain the source of alert *presence* (protects the `/api/health` degraded flag); details only enrich. `sendAlert` payload stays `{ text }`.

**Tech Stack:** Next.js 15 / TypeScript / Prisma + SQLite / vitest. No new dependencies, no schema change.

**Spec:** `docs/superpowers/specs/2026-07-06-slack-alert-enrichment-design.md` (Codex-reviewed, fixes applied).

## Global Constraints

- Work on branch `feat/slack-alert-enrichment` (create before Task 1; use superpowers:using-git-worktrees if isolating).
- No interactive `prisma.$transaction(async tx => ...)` — not needed here; the new queries join the existing array-form `Promise.all`.
- Link base is `NEXT_PUBLIC_APP_URL` only — never request origin.
- `AdaAudit` has NO `updatedAt`; its error paths set `completedAt`. Detail windowing/ordering must use the same field each count filters on: `SiteAudit.updatedAt`, `AdaAudit.completedAt`, `Job.updatedAt`.
- Error-text hygiene order is fixed: collapse whitespace → truncate 140 → backticks → `'` → mrkdwn-escape (`&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`).
- Tests share the dev SQLite DB (`DATABASE_URL="file:./local-dev.db"`), run serially (`fileParallelism: false`), and must clean up rows they create via a distinctive prefix.
- Gates before PR: `npx tsc --noEmit`, `DATABASE_URL="file:./local-dev.db" npx vitest run`, `npm run build`.

---

### Task 1: Pure rendering — types, helpers, `evaluateHealth`, fixture updates

**Files:**
- Modify: `lib/ops/health-check.ts`
- Test: `lib/ops/health-check.test.ts`
- Modify: `lib/jobs/handlers/health-alert.test.ts` (fixture only — CLEAN gains the new arrays; without this the suite crashes at runtime on `undefined.length`)

**Interfaces:**
- Consumes: existing `evaluateHealth(signals, state, now, opts)` / `AlertState` (`lib/ops/alert-state.ts`).
- Produces (Task 2 and the handler rely on these exact shapes):

```ts
export interface ErroredSiteAuditDetail { id: string; domain: string; error: string | null }
export interface ErroredAdaAuditDetail { id: string; url: string; error: string | null; siteAuditId: string | null }
export interface ExhaustedJobDetail { id: string; type: string; lastError: string | null; groupKey: string | null }
// HealthSignals gains: erroredSiteAuditDetails / erroredAdaAuditDetails / exhaustedJobDetails (the arrays above)
// EvalOpts gains: appUrl: string | null
export function normalizeAppUrl(raw: string | undefined): string | null
```

- [ ] **Step 1: Write the failing tests**

Replace `lib/ops/health-check.test.ts` with:

```ts
// lib/ops/health-check.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateHealth, normalizeAppUrl, type HealthSignals } from './health-check'
import type { AlertState } from './alert-state'

const now = new Date('2026-07-02T12:00:00Z')
const OPTS = {
  lookbackMs: 15 * 60_000, cooldownMs: 360 * 60_000, backupStaleHours: 26,
  appUrl: 'https://seo.example.com',
}
const clean: HealthSignals = {
  newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0,
  erroredSiteAuditDetails: [], erroredAdaAuditDetails: [], exhaustedJobDetails: [],
  stalledAudit: null, newestBackupAgeHours: 1,
}
const st: AlertState = { lastCheckAt: now.getTime() - OPTS.lookbackMs, cooldowns: {} }

describe('evaluateHealth', () => {
  it('all clean → no alerts, advances lastCheckAt', () => {
    const r = evaluateHealth(clean, st, now, OPTS)
    expect(r.alerts).toEqual([])
    expect(r.nextState.lastCheckAt).toBe(now.getTime())
  })

  it('site-audit detail line has domain, error in code span, and a View scan link', () => {
    const r = evaluateHealth({
      ...clean, newErroredSiteAudits: 1,
      erroredSiteAuditDetails: [{ id: 'sa1', domain: 'acme.edu', error: 'Navigation timeout of 30000 ms exceeded' }],
    }, st, now, OPTS)
    expect(r.alerts).toEqual([
      '• Site audit *acme.edu* errored: `Navigation timeout of 30000 ms exceeded` — <https://seo.example.com/ada-audit/site/sa1|View scan>',
    ])
  })

  it('count > 0 with EMPTY detail array still alerts (aggregate fallback)', () => {
    const r = evaluateHealth({ ...clean, newErroredSiteAudits: 2 }, st, now, OPTS)
    expect(r.alerts).toEqual(['• 2 site audit(s) errored since last check'])
  })

  it('overflow appends "…and N more" from count - details.length', () => {
    const details = Array.from({ length: 5 }, (_, i) => ({ id: `sa${i}`, domain: `d${i}.edu`, error: 'x' }))
    const r = evaluateHealth({ ...clean, newErroredSiteAudits: 7, erroredSiteAuditDetails: details }, st, now, OPTS)
    expect(r.alerts).toHaveLength(6)
    expect(r.alerts[5]).toBe('  …and 2 more errored site audit(s)')
  })

  it('ADA child links to parent site audit; standalone links to its own page', () => {
    const r = evaluateHealth({
      ...clean, newErroredAdaAudits: 2,
      erroredAdaAuditDetails: [
        { id: 'a1', url: 'https://acme.edu/apply', error: 'boom', siteAuditId: 'sa9' },
        { id: 'a2', url: 'https://foo.edu/', error: 'boom', siteAuditId: null },
      ],
    }, st, now, OPTS)
    expect(r.alerts[0]).toContain('<https://seo.example.com/ada-audit/site/sa9|View scan>')
    expect(r.alerts[1]).toContain('<https://seo.example.com/ada-audit/a2|View scan>')
  })

  it('exhausted job links via groupKey when it names a scan; others unlinked', () => {
    const r = evaluateHealth({
      ...clean, newExhaustedJobs: 3,
      exhaustedJobDetails: [
        { id: 'j1', type: 'site-audit-page', lastError: 'timeout', groupKey: 'site-audit:sa5' },
        { id: 'j2', type: 'ada-audit', lastError: 'timeout', groupKey: 'ada-audit:a7' },
        { id: 'j3', type: 'cleanup', lastError: 'disk full', groupKey: null },
      ],
    }, st, now, OPTS)
    expect(r.alerts[0]).toContain('Job `site-audit-page` exhausted retries: `timeout`')
    expect(r.alerts[0]).toContain('<https://seo.example.com/ada-audit/site/sa5|View scan>')
    expect(r.alerts[1]).toContain('<https://seo.example.com/ada-audit/a7|View scan>')
    expect(r.alerts[2]).toBe('• Job `cleanup` exhausted retries: `disk full`')
  })

  it('error text: collapse newlines → truncate 140 → backticks neutralized → mrkdwn escaped', () => {
    const r = evaluateHealth({
      ...clean, newErroredSiteAudits: 1,
      erroredSiteAuditDetails: [{ id: 's', domain: 'a.edu', error: 'Bad <tag> & `code`\nline2' }],
    }, st, now, OPTS)
    expect(r.alerts[0]).toContain("`Bad &lt;tag&gt; &amp; 'code' line2`")

    const long = 'e'.repeat(150)
    const r2 = evaluateHealth({
      ...clean, newErroredSiteAudits: 1,
      erroredSiteAuditDetails: [{ id: 's', domain: 'a.edu', error: long }],
    }, st, now, OPTS)
    expect(r2.alerts[0]).toContain('`' + 'e'.repeat(139) + '…`')
  })

  it('null error renders placeholder; long display labels truncate at 60', () => {
    const longUrl = 'https://acme.edu/' + 'p'.repeat(80)
    const r = evaluateHealth({
      ...clean, newErroredAdaAudits: 1,
      erroredAdaAuditDetails: [{ id: 'a1', url: longUrl, error: null, siteAuditId: null }],
    }, st, now, OPTS)
    expect(r.alerts[0]).toContain('`(no error message)`')
    expect(r.alerts[0]).toContain(`*${longUrl.slice(0, 59)}…*`)
    // Link TARGET is never truncated.
    expect(r.alerts[0]).toContain('<https://seo.example.com/ada-audit/a1|View scan>')
  })

  it('appUrl null → no link syntax anywhere', () => {
    const r = evaluateHealth({
      ...clean, newErroredSiteAudits: 1,
      erroredSiteAuditDetails: [{ id: 's1', domain: 'a.edu', error: 'x' }],
      stalledAudit: { id: 'sa2', minutesStuck: 74 },
    }, st, now, { ...OPTS, appUrl: null })
    for (const line of r.alerts) expect(line).not.toContain('|View scan>')
  })

  it('queue-stalled fires once with a link then is suppressed by cooldown', () => {
    const sig = { ...clean, stalledAudit: { id: 'a1', minutesStuck: 74 } }
    const r1 = evaluateHealth(sig, st, now, OPTS)
    const stallLine = r1.alerts.find((a) => /stall/i.test(a))
    expect(stallLine).toContain('<https://seo.example.com/ada-audit/site/a1|View scan>')
    const r2 = evaluateHealth(sig, r1.nextState, new Date(now.getTime() + 60_000), OPTS)
    expect(r2.alerts.some((a) => /stall/i.test(a))).toBe(false)
  })

  it('backup-stale fires when age exceeds threshold or no backup exists', () => {
    expect(evaluateHealth({ ...clean, newestBackupAgeHours: 31 }, st, now, OPTS).alerts.some((a) => /backup/i.test(a))).toBe(true)
    expect(evaluateHealth({ ...clean, newestBackupAgeHours: null }, st, now, OPTS).alerts.some((a) => /backup/i.test(a))).toBe(true)
  })
})

describe('normalizeAppUrl', () => {
  it('accepts absolute http(s), strips trailing slash', () => {
    expect(normalizeAppUrl('https://seo.example.com/')).toBe('https://seo.example.com')
    expect(normalizeAppUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })
  it('rejects unset, relative, and non-http values', () => {
    expect(normalizeAppUrl(undefined)).toBeNull()
    expect(normalizeAppUrl('')).toBeNull()
    expect(normalizeAppUrl('seo.example.com')).toBeNull()
    expect(normalizeAppUrl('ftp://x')).toBeNull()
  })
})
```

In `lib/jobs/handlers/health-alert.test.ts`, update the `CLEAN` fixture (the mocked `collectHealthSignals` feeds the REAL `evaluateHealth`, which now reads the arrays):

```ts
const CLEAN = {
  newErroredSiteAudits: 0, newErroredAdaAudits: 0, newExhaustedJobs: 0,
  erroredSiteAuditDetails: [], erroredAdaAuditDetails: [], exhaustedJobDetails: [],
  stalledAudit: null, newestBackupAgeHours: 1,
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-check.test.ts`
Expected: FAIL — `normalizeAppUrl` is not exported; detail-line assertions fail against the old count-only lines.

- [ ] **Step 3: Implement in `lib/ops/health-check.ts`**

Add the detail types, extend `HealthSignals` and `EvalOpts`, add the private helpers + exported `normalizeAppUrl`, and rewrite the three count blocks in `evaluateHealth`. Full new shape of the changed regions:

```ts
export interface ErroredSiteAuditDetail { id: string; domain: string; error: string | null }
export interface ErroredAdaAuditDetail { id: string; url: string; error: string | null; siteAuditId: string | null }
export interface ExhaustedJobDetail { id: string; type: string; lastError: string | null; groupKey: string | null }

export interface HealthSignals {
  newErroredSiteAudits: number
  newErroredAdaAudits: number
  newExhaustedJobs: number
  erroredSiteAuditDetails: ErroredSiteAuditDetail[]
  erroredAdaAuditDetails: ErroredAdaAuditDetail[]
  exhaustedJobDetails: ExhaustedJobDetail[]
  stalledAudit: { id: string; minutesStuck: number } | null
  newestBackupAgeHours: number | null // null = no backup exists
}

export interface EvalOpts {
  lookbackMs: number
  cooldownMs: number
  backupStaleHours: number
  appUrl: string | null // validated absolute http(s) origin for scan links; null = render no links
}

// & first so already-produced entities aren't double-escaped.
function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Order is load-bearing: collapse → truncate → neutralize backticks → escape.
// Truncating before escaping means an entity is never cut mid-way; neutralizing
// backticks keeps error text from breaking out of the Slack code span.
function sanitizeErrorText(err: string | null): string {
  const collapsed = (err ?? '').replace(/\s+/g, ' ').trim()
  if (!collapsed) return '(no error message)'
  const truncated = collapsed.length > 140 ? `${collapsed.slice(0, 139)}…` : collapsed
  return escapeMrkdwn(truncated.replace(/`/g, "'"))
}

// Display labels (domains/URLs) cap at 60 chars; link targets never truncate.
function label(s: string): string {
  return escapeMrkdwn(s.length > 60 ? `${s.slice(0, 59)}…` : s)
}

function scanLink(appUrl: string | null, path: string): string {
  if (!appUrl) return ''
  return ` — <${new URL(path, appUrl).toString()}|View scan>`
}

export function normalizeAppUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

// 'site-audit:<id>' / 'ada-audit:<id>' group keys name a scan we can link to.
function scanPathFromGroupKey(groupKey: string | null): string | null {
  if (!groupKey) return null
  const [prefix, id] = [groupKey.slice(0, groupKey.indexOf(':')), groupKey.slice(groupKey.indexOf(':') + 1)]
  if (!id) return null
  if (prefix === 'site-audit') return `/ada-audit/site/${id}`
  if (prefix === 'ada-audit') return `/ada-audit/${id}`
  return null
}
```

Inside `evaluateHealth`, replace the two count lines with (cooldown/backup blocks unchanged; counts drive alert PRESENCE — the `/api/health` degraded flag — details only enrich, and an empty detail array falls back to the aggregate line):

```ts
  if (signals.newErroredSiteAudits > 0) {
    const details = signals.erroredSiteAuditDetails
    if (details.length === 0) {
      alerts.push(`• ${signals.newErroredSiteAudits} site audit(s) errored since last check`)
    } else {
      for (const d of details) {
        alerts.push(`• Site audit *${label(d.domain)}* errored: \`${sanitizeErrorText(d.error)}\`${scanLink(opts.appUrl, `/ada-audit/site/${d.id}`)}`)
      }
      const more = signals.newErroredSiteAudits - details.length
      if (more > 0) alerts.push(`  …and ${more} more errored site audit(s)`)
    }
  }

  if (signals.newErroredAdaAudits > 0) {
    const details = signals.erroredAdaAuditDetails
    if (details.length === 0) {
      alerts.push(`• ${signals.newErroredAdaAudits} ADA audit(s) errored since last check`)
    } else {
      for (const d of details) {
        const path = d.siteAuditId ? `/ada-audit/site/${d.siteAuditId}` : `/ada-audit/${d.id}`
        alerts.push(`• ADA audit *${label(d.url)}* errored: \`${sanitizeErrorText(d.error)}\`${scanLink(opts.appUrl, path)}`)
      }
      const more = signals.newErroredAdaAudits - details.length
      if (more > 0) alerts.push(`  …and ${more} more errored ADA audit(s)`)
    }
  }

  if (signals.newExhaustedJobs > 0) {
    const details = signals.exhaustedJobDetails
    if (details.length === 0) {
      alerts.push(`• ${signals.newExhaustedJobs} durable job(s) exhausted retries`)
    } else {
      for (const d of details) {
        const path = scanPathFromGroupKey(d.groupKey)
        alerts.push(`• Job \`${d.type}\` exhausted retries: \`${sanitizeErrorText(d.lastError)}\`${path ? scanLink(opts.appUrl, path) : ''}`)
      }
      const more = signals.newExhaustedJobs - details.length
      if (more > 0) alerts.push(`  …and ${more} more exhausted job(s)`)
    }
  }
```

The stalled line becomes:

```ts
    alerts.push(`• queue stalled: audit ${signals.stalledAudit.id} transient for ${signals.stalledAudit.minutesStuck}m${scanLink(opts.appUrl, `/ada-audit/site/${signals.stalledAudit.id}`)}`)
```

`healthEvalOpts()` gains:

```ts
    appUrl: normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL),
```

**Stub** `collectHealthSignals` so the file typechecks before Task 2 wires the real queries — add to its return object:

```ts
    erroredSiteAuditDetails: [],
    erroredAdaAuditDetails: [],
    exhaustedJobDetails: [],
```

(Behavior is unchanged by the stub: empty details → aggregate fallback lines, same as today.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-check.test.ts lib/jobs/handlers/health-alert.test.ts lib/ops/health-check.collect.test.ts`
Expected: PASS (collect suite still passes — stub arrays are additive).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add lib/ops/health-check.ts lib/ops/health-check.test.ts lib/jobs/handlers/health-alert.test.ts
git commit -m "feat(alerts): render per-scan error detail + links in evaluateHealth"
```

---

### Task 2: `collectHealthSignals` detail queries

**Files:**
- Modify: `lib/ops/health-check.ts` (replace the Task 1 stub arrays with real queries)
- Test: `lib/ops/health-check.collect.test.ts`

**Interfaces:**
- Consumes: Task 1's `ErroredSiteAuditDetail` / `ErroredAdaAuditDetail` / `ExhaustedJobDetail` shapes.
- Produces: `collectHealthSignals(now, since)` returns populated detail arrays — `take: 5`, ordered desc by the SAME field each count filters on (`SiteAudit.updatedAt` / `AdaAudit.completedAt` / `Job.updatedAt`).

- [ ] **Step 1: Write the failing test**

Append to the `describe('collectHealthSignals')` block in `lib/ops/health-check.collect.test.ts`, and extend the `afterEach` cleanup:

```ts
// afterEach additions (after the siteAudit deleteMany):
await prisma.adaAudit.deleteMany({ where: { url: { startsWith: PFX } } })
await prisma.job.deleteMany({ where: { type: { startsWith: PFX } } })
```

```ts
  it('detail arrays respect the since window, cap at 5, and carry error fields', async () => {
    const now = new Date()
    const since = now.getTime() - 15 * 60_000

    // Errored site audit — updatedAt auto-set to now on create (in window).
    const sa = await prisma.siteAudit.create({
      data: { domain: `${PFX}detail`, wcagLevel: 'wcag21aa', status: 'error', error: 'discover blew up', requestedBy: 'manual' },
    })

    // Six errored ADA audits in window (completedAt is settable directly — no
    // raw SQL needed) + one OUTSIDE the window. Windowing uses completedAt
    // because AdaAudit has no updatedAt.
    for (let i = 0; i < 6; i++) {
      await prisma.adaAudit.create({
        data: {
          url: `${PFX}in-${i}`, status: 'error', error: `boom ${i}`, wcagLevel: 'wcag21aa',
          completedAt: new Date(now.getTime() - i * 1000),
        },
      })
    }
    const old = await prisma.adaAudit.create({
      data: {
        url: `${PFX}old`, status: 'error', error: 'ancient', wcagLevel: 'wcag21aa',
        completedAt: new Date(since - 60_000),
      },
    })

    // Exhausted job with a scan-shaped groupKey (updatedAt auto = now).
    await prisma.job.create({
      data: { type: `${PFX}job`, status: 'error', lastError: 'exhausted', groupKey: `site-audit:${sa.id}` },
    })

    const sig = await collectHealthSignals(now, since)

    // Site-audit detail carries the error text (shared dev DB — assert membership, not exact length).
    const saDetail = sig.erroredSiteAuditDetails.find((d) => d.id === sa.id)
    expect(saDetail).toMatchObject({ domain: `${PFX}detail`, error: 'discover blew up' })

    // Cap at 5, newest-first by completedAt, out-of-window row excluded.
    expect(sig.erroredAdaAuditDetails).toHaveLength(5)
    expect(sig.erroredAdaAuditDetails.map((d) => d.url)).toEqual(
      [0, 1, 2, 3, 4].map((i) => `${PFX}in-${i}`),
    )
    expect(sig.erroredAdaAuditDetails.some((d) => d.id === old.id)).toBe(false)

    // Job detail carries lastError + groupKey for link routing.
    const jobDetail = sig.exhaustedJobDetails.find((d) => d.type === `${PFX}job`)
    expect(jobDetail).toMatchObject({ lastError: 'exhausted', groupKey: `site-audit:${sa.id}` })
  })
```

Note: the 5-length / ordering assertions on `erroredAdaAuditDetails` are safe in the shared dev DB because our six rows have `completedAt` = now — any stray errored rows are older and sort after ours (and out-of-window rows are filtered entirely).

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-check.collect.test.ts`
Expected: FAIL — detail arrays are the Task 1 stubs (`[]`), so `saDetail` is undefined.

- [ ] **Step 3: Implement the real queries**

In `collectHealthSignals`, extend the existing `Promise.all` destructuring:

```ts
  const [
    newErroredSiteAudits, newErroredAdaAudits, newExhaustedJobs, stalled, backupMtime,
    erroredSiteAuditDetails, erroredAdaAuditDetails, exhaustedJobDetails,
  ] = await Promise.all([
    prisma.siteAudit.count({ where: { status: 'error', updatedAt: { gt: sinceDate } } }),
    // AdaAudit has NO updatedAt — its error paths set completedAt.
    prisma.adaAudit.count({ where: { status: 'error', completedAt: { gt: sinceDate } } }),
    prisma.job.count({ where: { status: 'error', updatedAt: { gt: sinceDate } } }),
    prisma.siteAudit.findFirst({
      where: { status: { in: TRANSIENT_STATUSES }, updatedAt: { lt: stallBefore } },
      orderBy: { updatedAt: 'asc' },
      select: { id: true, updatedAt: true },
    }),
    newestBackupMtimeMs(),
    // Detail rows: same window fields as the counts, newest-first, capped.
    prisma.siteAudit.findMany({
      where: { status: 'error', updatedAt: { gt: sinceDate } },
      orderBy: { updatedAt: 'desc' }, take: 5,
      select: { id: true, domain: true, error: true },
    }),
    prisma.adaAudit.findMany({
      where: { status: 'error', completedAt: { gt: sinceDate } },
      orderBy: { completedAt: 'desc' }, take: 5,
      select: { id: true, url: true, error: true, siteAuditId: true },
    }),
    prisma.job.findMany({
      where: { status: 'error', updatedAt: { gt: sinceDate } },
      orderBy: { updatedAt: 'desc' }, take: 5,
      select: { id: true, type: true, lastError: true, groupKey: true },
    }),
  ])
```

And in the return object, replace the stub arrays with the fetched ones:

```ts
    erroredSiteAuditDetails,
    erroredAdaAuditDetails,
    exhaustedJobDetails,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./local-dev.db" npx vitest run lib/ops/health-check.collect.test.ts lib/ops/health-check.test.ts lib/jobs/handlers/health-alert.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ops/health-check.ts lib/ops/health-check.collect.test.ts
git commit -m "feat(alerts): fetch capped error-detail rows in collectHealthSignals"
```

---

### Task 3: Gates, PR, prod verification

**Files:**
- No new code. Full-suite verification + ship.

**Interfaces:**
- Consumes: Tasks 1–2 complete on `feat/slack-alert-enrichment`.
- Produces: green gates, a PR, and (post-merge/deploy) a real Slack rendering check.

- [ ] **Step 1: Run the full gates**

```bash
npx tsc --noEmit
DATABASE_URL="file:./local-dev.db" npx vitest run
npm run build
```

Expected: all clean/green. (If an unrelated test fails, check git history to confirm it pre-exists before proceeding — do not fix drive-by.)

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/slack-alert-enrichment
gh pr create --title "feat(alerts): per-scan error detail + links in the Slack health alert" --body "..."
```

PR body: link the spec (`docs/superpowers/specs/2026-07-06-slack-alert-enrichment-design.md`), summarize the count-driven-presence invariant, note zero schema/env changes.

- [ ] **Step 3: After merge + deploy — real Slack rendering test**

Deploy per CLAUDE.md (`git push` on main happens via merge, then `ssh seo@144.126.213.242 "~/deploy.sh"`). Then send one synthetic alert through the REAL webhook from the server, with hostile characters:

```bash
ssh seo@144.126.213.242 'cd ~/webapps/seo-tools && npx tsx -e "
import { sendAlert } from \"./lib/ops/alert-webhook\";
sendAlert(\":rotating_light: er-seo-tools alert TEST\n• Site audit *acme.edu* errored: \`Bad &lt;tag&gt; &amp; '"'"'code'"'"' line2\` — <https://example.com/ada-audit/site/test|View scan>\").then(r => console.log(r));
"'
```

Verify in Slack: the link is clickable, the code span is intact, `<`, `>`, `&` render as literals, and no raw entities leak outside the code span. Then confirm `NEXT_PUBLIC_APP_URL` on the server is the canonical origin with no path suffix (`grep NEXT_PUBLIC_APP_URL ~/webapps/seo-tools/.env* / ecosystem config`).

- [ ] **Step 4: Docs lifecycle**

After ship: `git mv` the spec and this plan to `docs/superpowers/archive/{specs,plans}/`, and check whether the improvement-roadmap tracker (`docs/superpowers/todos/2026-06-10-improvement-roadmap-tracker.md`) has a D0/observability line this advances — if so, follow the handoff protocol (tracker line + HANDOFF rewrite + paste-prompt).
