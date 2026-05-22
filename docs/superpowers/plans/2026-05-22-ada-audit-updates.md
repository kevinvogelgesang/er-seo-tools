# ADA Audit Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six related ADA Audit improvements per the design at `docs/superpowers/specs/2026-05-22-ada-audit-updates-design.md`: opt-in checkbox triage, redirect handling, time-taken column, operator-filtered recents page, shared-element identification, and external link in the violations view.

**Architecture:** Single Prisma migration up front adds `startedAt`/`completedAt`/`finalUrl`/`redirected`/`pagesRedirected` columns plus two new check tables (`AdaAuditCheck`, `SiteAuditCheck`). Each feature ships as an independent PR per the spec's build order. Runner returns a `RunAxeResult` discriminated union with `kind: 'audited' | 'redirected'`; callers (`app/api/ada-audit/route.ts`, `lib/ada-audit/queue-manager.ts`) own all DB writes. Checkboxes use leaf-only persistence with parent state derived; keys are sha256 of canonical JSON.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript, Prisma 5 + SQLite, Tailwind CSS (class-based dark mode), puppeteer-core + axe-core. Vitest for unit tests, Prisma's test client patterns for DB integration.

---

# PR 1 — Schema migration + duration plumbing

Adds every new column and table needed by later PRs, stamps `startedAt`/`completedAt` everywhere, and adds the Duration column UI. After this PR, history pages gain a working Duration column; everything else is dormant scaffolding.

### Task 1.1: Add schema columns and check tables

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add fields to AdaAudit**

Open `prisma/schema.prisma`. In the `AdaAudit` model, add these fields (anywhere before the `@@index` lines is fine — group with related fields):

```prisma
  startedAt        DateTime?
  completedAt      DateTime?
  finalUrl         String?
  redirected       Boolean    @default(false)
  checks           AdaAuditCheck[]
```

And add to the `@@index` list:

```prisma
  @@index([requestedBy, createdAt])
```

- [ ] **Step 2: Add fields to SiteAudit**

In the `SiteAudit` model, add:

```prisma
  startedAt        DateTime?
  completedAt      DateTime?
  pagesRedirected  Int       @default(0)
  checks           SiteAuditCheck[]
```

And in the `@@index` list:

```prisma
  @@index([requestedBy, createdAt])
```

- [ ] **Step 3: Add the two check models**

Append to `prisma/schema.prisma`:

```prisma
model AdaAuditCheck {
  id          String   @id @default(cuid())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  adaAuditId  String
  adaAudit    AdaAudit @relation(fields: [adaAuditId], references: [id], onDelete: Cascade)
  scope       String   // 'node' (rule-level state is derived, never persisted)
  key         String   // sha256 of canonical JSON — see lib/ada-audit/checks-keys.ts
  checkedBy   String?  // er-operator-name at time of check

  @@unique([adaAuditId, scope, key])
  @@index([adaAuditId])
}

model SiteAuditCheck {
  id          String   @id @default(cuid())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  siteAuditId String
  siteAudit   SiteAudit @relation(fields: [siteAuditId], references: [id], onDelete: Cascade)
  scope       String   // 'page' | 'page-violation'
  key         String
  checkedBy   String?

  @@unique([siteAuditId, scope, key])
  @@index([siteAuditId])
}
```

- [ ] **Step 4: Generate the migration**

Run: `npx prisma migrate dev --name add-ada-checks-redirects-durations`
Expected: migration created in `prisma/migrations/<timestamp>_add-ada-checks-redirects-durations/`, Prisma client regenerated.

- [ ] **Step 5: Sanity-check the generated SQL**

Run: `cat prisma/migrations/*add-ada-checks-redirects-durations*/migration.sql`
Expected: contains `ALTER TABLE "AdaAudit" ADD COLUMN "startedAt" DATETIME`, ..., `CREATE TABLE "AdaAuditCheck"`, ..., new indexes including `requestedBy, createdAt`.

- [ ] **Step 6: Run tsc to confirm Prisma client regenerated cleanly**

Run: `npx tsc --noEmit`
Expected: PASS (any errors must come from later tasks, not from the migration).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(ada-audit): schema for checks, redirects, and durations"
```

---

### Task 1.2: Build the duration formatter (TDD)

**Files:**
- Create: `lib/ada-audit/duration.ts`
- Create: `lib/ada-audit/duration.test.ts`

- [ ] **Step 1: Write the test file**

Create `lib/ada-audit/duration.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatDuration, formatDurationHover } from './duration'

describe('formatDuration', () => {
  it('returns null when startedAt is null', () => {
    expect(formatDuration(null, new Date())).toBeNull()
  })

  it('returns null when completedAt is null', () => {
    expect(formatDuration(new Date(), null)).toBeNull()
  })

  it('formats sub-minute as Ns', () => {
    const a = new Date('2026-05-22T14:14:03Z')
    const b = new Date('2026-05-22T14:14:48Z')
    expect(formatDuration(a, b)).toBe('45s')
  })

  it('formats sub-hour as Xm Ys', () => {
    const a = new Date('2026-05-22T14:14:03Z')
    const b = new Date('2026-05-22T14:18:47Z')
    expect(formatDuration(a, b)).toBe('4m 44s')
  })

  it('formats over-hour as Hh Mm', () => {
    const a = new Date('2026-05-22T14:00:00Z')
    const b = new Date('2026-05-22T15:30:00Z')
    expect(formatDuration(a, b)).toBe('1h 30m')
  })

  it('rounds down sub-second to 0s', () => {
    const a = new Date('2026-05-22T14:14:03.000Z')
    const b = new Date('2026-05-22T14:14:03.500Z')
    expect(formatDuration(a, b)).toBe('0s')
  })
})

describe('formatDurationHover', () => {
  it('returns null when either timestamp missing', () => {
    expect(formatDurationHover(null, new Date())).toBeNull()
    expect(formatDurationHover(new Date(), null)).toBeNull()
  })

  it('shows start and end times', () => {
    const a = new Date('2026-05-22T14:14:03Z')
    const b = new Date('2026-05-22T14:18:47Z')
    const hover = formatDurationHover(a, b)!
    expect(hover).toMatch(/Started .* → Ended .*/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ada-audit/duration.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the formatter**

Create `lib/ada-audit/duration.ts`:

```ts
export function formatDuration(startedAt: Date | null, completedAt: Date | null): string | null {
  if (!startedAt || !completedAt) return null
  const ms = completedAt.getTime() - startedAt.getTime()
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remSec = seconds % 60
  if (minutes < 60) return `${minutes}m ${remSec}s`
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  return `${hours}h ${remMin}m`
}

export function formatDurationHover(startedAt: Date | null, completedAt: Date | null): string | null {
  if (!startedAt || !completedAt) return null
  return `Started ${startedAt.toLocaleTimeString()} → Ended ${completedAt.toLocaleTimeString()}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ada-audit/duration.test.ts`
Expected: PASS, 7 assertions green.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/duration.ts lib/ada-audit/duration.test.ts
git commit -m "feat(ada-audit): formatDuration + formatDurationHover utilities"
```

---

### Task 1.3: Stamp startedAt/completedAt in the standalone audit route

**Files:**
- Modify: `app/api/ada-audit/route.ts` (around lines 22-65)

- [ ] **Step 1: Add startedAt when transitioning to running**

Open `app/api/ada-audit/route.ts`. Find the `runAuditInBackground` function. Replace the first status update (currently `data: { status: 'running', progress: 0, progressMessage: 'Starting…' }`) with:

```ts
    await prisma.adaAudit.update({
      where: { id },
      data: {
        status: 'running',
        progress: 0,
        progressMessage: 'Starting…',
        startedAt: new Date(),
      },
    })
```

- [ ] **Step 2: Stamp completedAt on success**

In the same function, find the `data: { status: 'complete', result: JSON.stringify(axe), ... }` block. Add `completedAt: new Date(),` to that object.

- [ ] **Step 3: Stamp completedAt on error**

Find the catch block at the end (currently `data: { status: 'error', error: message }`). Replace with:

```ts
    await prisma.adaAudit.update({
      where: { id },
      data: { status: 'error', error: message, completedAt: new Date() },
    }).catch(() => {})
```

- [ ] **Step 4: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ada-audit/route.ts
git commit -m "feat(ada-audit): stamp startedAt/completedAt on standalone audits"
```

---

### Task 1.4: Stamp timestamps in queue-manager and site-audit-finalizer

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts`
- Modify: `lib/ada-audit/site-audit-finalizer.ts`
- Modify: `lib/ada-audit/lighthouse-queue.ts`

- [ ] **Step 1: SiteAudit startedAt on queued → running**

Open `lib/ada-audit/queue-manager.ts`. Find the line that flips `SiteAudit` status to `running` (around line 56):

```ts
      data: { status: 'running' },
```

Replace with:

```ts
      data: { status: 'running', startedAt: new Date() },
```

- [ ] **Step 2: Child AdaAudit startedAt on child running**

In the same file (around line 71), find:

```ts
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'running' } })
```

Replace with:

```ts
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'running', startedAt: new Date() } })
```

- [ ] **Step 3: Child AdaAudit completedAt — local/off provider inline complete**

Around line 134, find the data block:

```ts
                data: {
                  status: 'complete',
                  result: JSON.stringify(axe),
                  lighthouseSummary: lighthouseSummary ? JSON.stringify(lighthouseSummary) : null,
                  lighthouseError,
                  runnerType: 'browser',
                },
```

Add `completedAt: new Date(),` to that object.

- [ ] **Step 4: Child AdaAudit completedAt — page-loop error**

Around line 149, find:

```ts
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'error', error: msg } })
```

Replace with:

```ts
          await prisma.adaAudit.update({ where: { id: child.id }, data: { status: 'error', error: msg, completedAt: new Date() } })
```

- [ ] **Step 5: SiteAudit completedAt — processNext error path**

Around line 178 in `queue-manager.ts`:

```ts
      data: { status: 'error', error: message },
```

Replace with:

```ts
      data: { status: 'error', error: message, completedAt: new Date() },
```

- [ ] **Step 6: Stale-recovery and startup-recovery terminal writes**

Around line 449 (`resetStaleAudits`):

```ts
      data: { status: 'error', error: 'Audit timed out (server may have restarted)' },
```

Replace with:

```ts
      data: { status: 'error', error: 'Audit timed out (server may have restarted)', completedAt: new Date() },
```

Around line 484 (`recoverQueue`):

```ts
      data: { status: 'error', error: 'Audit interrupted (server restarted)' },
```

Replace with:

```ts
      data: { status: 'error', error: 'Audit interrupted (server restarted)', completedAt: new Date() },
```

- [ ] **Step 7: failOrphanAdaAudits — child completedAt**

In `queue-manager.ts`, locate `failOrphanAdaAudits` (around line 382). For both `updateMany` calls in that function, add `completedAt: new Date()` to the `data` object alongside the existing fields.

- [ ] **Step 8: site-audit-finalizer.ts — stamp completedAt on terminal**

Open `lib/ada-audit/site-audit-finalizer.ts`. Find the block that flips to `complete`:

```ts
  await prisma.siteAudit.update({
    where: { id },
    data: {
      status: 'complete',
      summary: JSON.stringify(summary),
    },
  })
```

Replace with:

```ts
  await prisma.siteAudit.update({
    where: { id },
    data: {
      status: 'complete',
      summary: JSON.stringify(summary),
      completedAt: new Date(),
    },
  })
```

- [ ] **Step 9: Child AdaAudit completedAt — detached-PSI completion**

Open `lib/ada-audit/lighthouse-queue.ts`. Find the `updateMany` that flips `axe-complete → complete` (around line 80):

```ts
    const result = await prisma.adaAudit.updateMany({
      where: { id: job.adaAuditId, status: 'axe-complete' },
      data: {
        status: 'complete',
        lighthouseSummary,
        lighthouseError,
      },
    })
```

Replace the `data:` object with:

```ts
      data: {
        status: 'complete',
        lighthouseSummary,
        lighthouseError,
        completedAt: new Date(),
      },
```

- [ ] **Step 10: Update done-math to include pagesRedirected**

Open `lib/ada-audit/site-audit-finalizer.ts`. Find:

```ts
  const pagesDone      = audit.pagesComplete + audit.pagesError >= audit.pagesTotal
```

Replace with:

```ts
  const pagesDone      = audit.pagesComplete + audit.pagesError + audit.pagesRedirected >= audit.pagesTotal
```

Note: `pagesRedirected` is always 0 after PR 1; PR 2 introduces increments. Done-math is wired now so PR 2 only adds detection.

- [ ] **Step 11: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add lib/ada-audit/queue-manager.ts lib/ada-audit/site-audit-finalizer.ts lib/ada-audit/lighthouse-queue.ts
git commit -m "feat(ada-audit): stamp startedAt/completedAt across site audit lifecycle"
```

---

### Task 1.5: Existing finalizer tests — confirm pagesRedirected default works

**Files:**
- Modify: `lib/ada-audit/site-audit-finalizer.test.ts` (if test fixtures hand-build SiteAudit rows that omit the new field)

- [ ] **Step 1: Run existing tests**

Run: `npx vitest run lib/ada-audit/site-audit-finalizer.test.ts`
Expected: PASS — Prisma defaults make `pagesRedirected` 0 automatically. If any test mocks SiteAudit shape without going through Prisma, it may need the field added.

- [ ] **Step 2: If failures, add `pagesRedirected: 0` to test fixtures**

For any mock `audit` object that doesn't go through Prisma's `create`, add `pagesRedirected: 0,` next to `pagesComplete`, `pagesError`, etc.

- [ ] **Step 3: Re-run and commit if any fixtures changed**

```bash
git add lib/ada-audit/site-audit-finalizer.test.ts
git commit -m "test(ada-audit): include pagesRedirected in finalizer fixtures"
```

---

### Task 1.6: Add Duration column to AuditHistory

**Files:**
- Modify: `components/ada-audit/AuditHistory.tsx`
- Modify: `app/api/ada-audit/route.ts` (GET — include startedAt/completedAt in list response)
- Modify: `lib/ada-audit/types.ts` (AuditListItem)

- [ ] **Step 1: Add timestamps to AuditListItem**

Open `lib/ada-audit/types.ts`. Find:

```ts
export interface AuditListItem {
  id: string
  createdAt: string
  url: string
  status: string
  error: string | null
  clientId: number | null
  clientName: string | null
  scorecard: AuditScorecard | null
  requestedBy: string | null
}
```

Add two fields:

```ts
  startedAt: string | null
  completedAt: string | null
```

- [ ] **Step 2: Return new fields from list API**

Open `app/api/ada-audit/route.ts`. In the GET handler's `items.map` block (around line 170), append to the returned object:

```ts
      startedAt: a.startedAt?.toISOString() ?? null,
      completedAt: a.completedAt?.toISOString() ?? null,
```

- [ ] **Step 3: Add Duration column header**

Open `components/ada-audit/AuditHistory.tsx`. After the `<th>...Date</th>` line (~137), insert:

```tsx
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Duration</th>
```

Increase any colspan in empty-state rows by 1 if present.

- [ ] **Step 4: Render Duration cell**

In the row-rendering loop (after the Date `<td>`, before Actions `<td>`), insert:

```tsx
                <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap" title={(() => {
                  const start = a.startedAt ? new Date(a.startedAt) : null
                  const end = a.completedAt ? new Date(a.completedAt) : null
                  return formatDurationHover(start, end) ?? ''
                })()}>
                  {(() => {
                    const start = a.startedAt ? new Date(a.startedAt) : null
                    const end = a.completedAt ? new Date(a.completedAt) : null
                    return formatDuration(start, end) ?? '—'
                  })()}
                </td>
```

Add the import at the top of the file:

```tsx
import { formatDuration, formatDurationHover } from '@/lib/ada-audit/duration'
```

- [ ] **Step 5: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/ada-audit/AuditHistory.tsx lib/ada-audit/types.ts app/api/ada-audit/route.ts
git commit -m "feat(ada-audit): duration column on standalone audit history"
```

---

### Task 1.7: Add Duration to SiteAuditHistory, QueueActiveView, QueueHistoryView

**Files:**
- Modify: `components/ada-audit/SiteAuditHistory.tsx`
- Modify: `components/ada-audit/QueueActiveView.tsx`
- Modify: `components/ada-audit/QueueHistoryView.tsx`
- Modify: `app/api/site-audit/route.ts` (or wherever site audits are listed)
- Modify: `lib/ada-audit/types.ts` (`SiteAuditListItem` or equivalent)

- [ ] **Step 1: Find the site audit list type and API**

Run: `grep -n "SiteAuditListItem\|SiteAuditHistory" lib/ada-audit/types.ts app/api/site-audit/`
Expected: locate the list-item type used by SiteAuditHistory and the queue views.

- [ ] **Step 2: Add startedAt/completedAt fields to that type**

Open the type file identified above. Add the two nullable string fields to the site audit list item type, mirroring Task 1.6 step 1.

- [ ] **Step 3: Include them in the API response**

In the relevant `route.ts` GET handler, add to the returned shape:

```ts
      startedAt: s.startedAt?.toISOString() ?? null,
      completedAt: s.completedAt?.toISOString() ?? null,
```

- [ ] **Step 4: Add Duration column to SiteAuditHistory**

Open `components/ada-audit/SiteAuditHistory.tsx`. Find the `<th>...Date</th>` header. After it, before any Actions column header, insert:

```tsx
              <th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Duration</th>
```

In the row-rendering loop, after the Date `<td>` and before any Actions `<td>`, insert:

```tsx
                <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap" title={(() => {
                  const start = s.startedAt ? new Date(s.startedAt) : null
                  const end = s.completedAt ? new Date(s.completedAt) : null
                  return formatDurationHover(start, end) ?? ''
                })()}>
                  {(() => {
                    const start = s.startedAt ? new Date(s.startedAt) : null
                    const end = s.completedAt ? new Date(s.completedAt) : null
                    return formatDuration(start, end) ?? '—'
                  })()}
                </td>
```

(Adjust the loop variable name `s` to whatever the existing map uses.) Add the same import:

```tsx
import { formatDuration, formatDurationHover } from '@/lib/ada-audit/duration'
```

- [ ] **Step 5: Add Duration column to QueueActiveView**

Open `components/ada-audit/QueueActiveView.tsx`. Inspect the existing table layout. After the last current `<th>` in the header (the rightmost column before any actions), insert:

```tsx
<th className="pb-2 pr-4 text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Duration</th>
```

In each row, after the equivalent rightmost `<td>`, insert:

```tsx
<td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap" title={(() => {
  const start = row.startedAt ? new Date(row.startedAt) : null
  const end = row.completedAt ? new Date(row.completedAt) : null
  return formatDurationHover(start, end) ?? ''
})()}>
  {(() => {
    const start = row.startedAt ? new Date(row.startedAt) : null
    const end = row.completedAt ? new Date(row.completedAt) : null
    return formatDuration(start, end) ?? '—'
  })()}
</td>
```

Replace `row` with the loop variable name. Active rows will have `completedAt === null` → cell renders `—`.

Add the import:

```tsx
import { formatDuration, formatDurationHover } from '@/lib/ada-audit/duration'
```

- [ ] **Step 6: Add Duration column to QueueHistoryView**

Open `components/ada-audit/QueueHistoryView.tsx`. Apply the same pattern as Step 5: add the `<th>Duration</th>` header and the matching `<td>` in each row (history rows generally have a populated `completedAt`).

- [ ] **Step 7: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Manual smoke test**

Start the dev server: `npm run dev`
Navigate to `/ada-audit`. Confirm the new Duration column appears on the existing history tables. Older audits should show `—`. Run a fresh audit and confirm Duration populates correctly after completion.

- [ ] **Step 9: Commit**

```bash
git add components/ada-audit/SiteAuditHistory.tsx components/ada-audit/QueueActiveView.tsx components/ada-audit/QueueHistoryView.tsx lib/ada-audit/types.ts app/api/site-audit/
git commit -m "feat(ada-audit): duration column on site audit history and queue views"
```

PR 1 is now complete. Open PR but do not push/deploy until user review.

---

# PR 2 — Redirect handling

Adds `lib/ada-audit/redirect-detect.ts`, threads the runner's return through a discriminated union, integrates standalone + child callers, and surfaces the Redirects section in the UI.

### Task 2.1: Build redirect-detect (TDD)

**Files:**
- Create: `lib/ada-audit/redirect-detect.ts`
- Create: `lib/ada-audit/redirect-detect.test.ts`

- [ ] **Step 1: Write the test file**

Create `lib/ada-audit/redirect-detect.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectRedirect, normalizeForRedirect } from './redirect-detect'

describe('normalizeForRedirect', () => {
  it('lowercases host', () => {
    expect(normalizeForRedirect('https://EXAMPLE.com/foo')).toBe(normalizeForRedirect('https://example.com/foo'))
  })

  it('strips default ports', () => {
    expect(normalizeForRedirect('https://example.com:443/foo')).toBe(normalizeForRedirect('https://example.com/foo'))
    expect(normalizeForRedirect('http://example.com:80/foo')).toBe(normalizeForRedirect('http://example.com/foo'))
  })

  it('treats http and https as equivalent', () => {
    expect(normalizeForRedirect('http://example.com/foo')).toBe(normalizeForRedirect('https://example.com/foo'))
  })

  it('strips trailing slash', () => {
    expect(normalizeForRedirect('https://example.com/foo/')).toBe(normalizeForRedirect('https://example.com/foo'))
  })

  it('strips fragment', () => {
    expect(normalizeForRedirect('https://example.com/foo#bar')).toBe(normalizeForRedirect('https://example.com/foo'))
  })

  it('preserves query string', () => {
    expect(normalizeForRedirect('https://example.com/?a=1')).not.toBe(normalizeForRedirect('https://example.com/'))
  })

  it('does NOT strip www', () => {
    expect(normalizeForRedirect('https://www.example.com/')).not.toBe(normalizeForRedirect('https://example.com/'))
  })
})

describe('detectRedirect', () => {
  it('returns audited when no chain', () => {
    expect(detectRedirect('https://x.com/a', [], 'https://x.com/a')).toEqual({ kind: 'audited' })
  })

  it('returns audited for http→https-only with chain (treated as noise)', () => {
    const r = detectRedirect('http://x.com/a', [{} as any], 'https://x.com/a')
    expect(r).toEqual({ kind: 'audited' })
  })

  it('returns audited for trailing-slash-only with chain (treated as noise)', () => {
    const r = detectRedirect('https://x.com/a', [{} as any], 'https://x.com/a/')
    expect(r).toEqual({ kind: 'audited' })
  })

  it('returns redirected for cross-path redirect', () => {
    const r = detectRedirect('https://x.com/old', [{} as any], 'https://x.com/new')
    expect(r).toEqual({ kind: 'redirected', finalUrl: 'https://x.com/new' })
  })

  it('returns redirected for www → non-www', () => {
    const r = detectRedirect('https://www.x.com/', [{} as any], 'https://x.com/')
    expect(r).toEqual({ kind: 'redirected', finalUrl: 'https://x.com/' })
  })

  it('returns redirected for cross-origin redirect', () => {
    const r = detectRedirect('https://x.com/a', [{} as any], 'https://y.com/a')
    expect(r).toEqual({ kind: 'redirected', finalUrl: 'https://y.com/a' })
  })

  it('preserves the raw finalUrl (not normalized) in result', () => {
    const r = detectRedirect('https://x.com/a', [{} as any], 'https://X.COM/new/?q=1#frag')
    expect(r).toEqual({ kind: 'redirected', finalUrl: 'https://X.COM/new/?q=1#frag' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/ada-audit/redirect-detect.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement redirect-detect**

Create `lib/ada-audit/redirect-detect.ts`:

```ts
export type RedirectDetectResult =
  | { kind: 'audited' }
  | { kind: 'redirected'; finalUrl: string }

// Normalize a URL for redirect-comparison purposes.
// Protocol is ignored (treat http/https as equivalent), default ports
// stripped, trailing slash stripped, fragment stripped, host lowercased,
// www preserved (treat www.x.com vs x.com as different), query preserved.
export function normalizeForRedirect(input: string): string {
  let u: URL
  try { u = new URL(input) } catch { return input }
  const host = u.hostname.toLowerCase()
  const isDefaultPort = (u.port === '' || u.port === '80' || u.port === '443')
  const port = isDefaultPort ? '' : `:${u.port}`
  let pathname = u.pathname
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
  // Strip both protocols by collapsing to a synthetic scheme.
  return `norm://${host}${port}${pathname}${u.search}`
}

// chain: response.request().redirectChain() from puppeteer — we only need
// to know whether it's empty or not. Element shape is opaque.
export function detectRedirect(
  requestedUrl: string,
  redirectChain: unknown[],
  finalUrlRaw: string,
): RedirectDetectResult {
  if (redirectChain.length === 0) return { kind: 'audited' }
  const a = normalizeForRedirect(requestedUrl)
  const b = normalizeForRedirect(finalUrlRaw)
  if (a === b) return { kind: 'audited' }
  return { kind: 'redirected', finalUrl: finalUrlRaw }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ada-audit/redirect-detect.test.ts`
Expected: PASS, all assertions green.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/redirect-detect.ts lib/ada-audit/redirect-detect.test.ts
git commit -m "feat(ada-audit): redirect-detect pure module with normalization"
```

---

### Task 2.2: Widen RunAxeResult into a discriminated union

**Files:**
- Modify: `lib/ada-audit/runner.ts`

- [ ] **Step 1: Update the result type**

Open `lib/ada-audit/runner.ts`. Replace the `RunAxeResult` interface (around line 43) with a discriminated union:

```ts
export type RunAxeResult =
  | {
      kind: 'audited'
      axe: StoredAxeResults
      lighthouseSummary: LighthouseSummary | null
      lighthouseError: string | null
      harvestedPdfUrls: string[]
    }
  | {
      kind: 'redirected'
      finalUrl: string
    }
```

- [ ] **Step 2: Wrap the existing success return**

Find the existing `return { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls }` at the bottom of `runAxeAudit`. Replace with:

```ts
    return { kind: 'audited', axe, lighthouseSummary, lighthouseError, harvestedPdfUrls }
```

- [ ] **Step 3: Add redirect detection after successful navigation (pagespeed/off path only)**

Locate the block after `if (!response.ok()) { ... }` and the content-type check — i.e. just after the navigation has succeeded and before any axe work. The pagespeed/off branch is the only one where we own navigation; the local-LH branch does not get redirect detection (see spec §3.3).

Add an import at the top of the file:

```ts
import { detectRedirect } from './redirect-detect'
```

In the `pagespeed`/`off` branch (the `else` block after `if (provider === 'local')`), immediately after the `if (!contentType.includes('html'))` line but before whatever runs next, add:

```ts
        // Server-side redirect detection. Use puppeteer's chain data — page.url()
        // after settle can change due to meta refresh / JS navigation, which we
        // do NOT want to flag as redirects.
        const chain = response.request().redirectChain()
        const detected = detectRedirect(parsed.toString(), chain, response.url())
        if (detected.kind === 'redirected') {
          // Bail out early — caller handles status writes.
          return { kind: 'redirected', finalUrl: detected.finalUrl }
        }
```

Note: this early-return short-circuits the rest of `runAxeAudit`. The page slot is still released by the existing finally/teardown, since we're returning from inside `try`. Verify with a quick read that `page.close()` / `releasePage(page)` happens in `finally`.

- [ ] **Step 4: Verify page cleanup in finally**

Run: `grep -n "finally\|releasePage\|closePage" lib/ada-audit/runner.ts`
Expected: confirm the page is released in a `finally` block that wraps the entire navigation+axe section. If not, the early `return` would leak the page. Adjust if needed.

- [ ] **Step 5: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS — but: callers of `runAxeAudit` will now fail TypeScript because they destructure `{ axe, lighthouseSummary, ... }` expecting the old flat shape. We'll fix them in 2.3 and 2.4. So expect tsc to fail on those caller sites only.

If tsc fails on call sites in `app/api/ada-audit/route.ts` and `lib/ada-audit/queue-manager.ts` — that's expected. Leave them broken until 2.3 / 2.4. If tsc fails elsewhere, that's a real problem.

- [ ] **Step 6: Commit (broken-tsc state — we'll fix in next task)**

```bash
git add lib/ada-audit/runner.ts
git commit -m "feat(ada-audit): runAxeAudit returns RunAxeResult discriminated union"
```

---

### Task 2.3: Integrate redirected outcome in standalone audit route

**Files:**
- Modify: `app/api/ada-audit/route.ts`

- [ ] **Step 1: Switch on result.kind in runAuditInBackground**

Open `app/api/ada-audit/route.ts`. Replace the lines that destructure `runAxeAudit`'s result and the subsequent `complete` update with a kind-switch:

```ts
    const result = await runAxeAudit(
      url,
      wcagLevel,
      onProgress,
      {
        auditId: id,
        ...(captureScreenshots ? {
          captureScreenshots: true,
          screenshotDir: path.join(SCREENSHOTS_DIR, id),
        } : {}),
      },
    )

    if (result.kind === 'redirected') {
      await prisma.adaAudit.update({
        where: { id },
        data: {
          status: 'redirected',
          finalUrl: result.finalUrl,
          redirected: true,
          progress: 100,
          progressMessage: 'Redirected',
          completedAt: new Date(),
        },
      })
      return
    }

    // result.kind === 'audited'
    const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls } = result
    await prisma.adaAudit.update({
      where: { id },
      data: {
        status: 'complete',
        result: JSON.stringify(axe),
        lighthouseSummary: lighthouseSummary ? JSON.stringify(lighthouseSummary) : null,
        lighthouseError,
        progress: 100,
        progressMessage: 'Complete',
        runnerType: 'browser',
        completedAt: new Date(),
      },
    })

    const { dispatchPdfScans } = await import('@/lib/ada-audit/pdf-orchestrator')
    void dispatchPdfScans({
      urls: harvestedPdfUrls,
      adaAuditId: id,
      sourcePageUrl: url,
    })
```

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS for this file; queue-manager will still error (fixed in next task).

- [ ] **Step 3: Commit**

```bash
git add app/api/ada-audit/route.ts
git commit -m "feat(ada-audit): handle redirected outcome in standalone audit route"
```

---

### Task 2.4: Integrate redirected outcome in queue-manager child page loop

**Files:**
- Modify: `lib/ada-audit/queue-manager.ts`

- [ ] **Step 1: Locate the child runAxeAudit call**

Open `lib/ada-audit/queue-manager.ts`. Find the call to `runAxeAudit` inside the page-loop's per-child handler (around lines 100-145). It currently destructures `axe, lighthouseSummary, ...` directly.

- [ ] **Step 2: Switch on result.kind**

Replace the call + downstream blocks. Pattern:

```ts
        try {
          const result = await runAxeAudit(url, wcagLevel, undefined, { auditId: child.id, siteAudit: true })

          if (result.kind === 'redirected') {
            await prisma.$transaction([
              prisma.adaAudit.update({
                where: { id: child.id },
                data: {
                  status: 'redirected',
                  finalUrl: result.finalUrl,
                  redirected: true,
                  completedAt: new Date(),
                  runnerType: 'browser',
                },
              }),
              prisma.siteAudit.update({
                where: { id },
                data: { pagesRedirected: { increment: 1 } },
              }),
            ])
            continue  // skip PDF dispatch + PSI enqueue for redirected pages
          }

          // result.kind === 'audited'
          const { axe, lighthouseSummary, lighthouseError, harvestedPdfUrls } = result

          // ... existing PDF-dispatch code stays here unchanged ...
          // ... existing detached-PSI vs inline-LH branches stay here unchanged ...
        } catch (err) {
          // ... existing catch ...
        }
```

Inspect the surrounding for-loop structure to confirm `continue` is the right control-flow word (vs returning from a wrapper). If the runner call is inside `Promise.all(batch.map(...))`, the loop body is a function and you need `return` instead.

- [ ] **Step 3: Confirm finalizer is kicked after redirected child**

After the transaction in Step 2, the child contributes to `pagesRedirected`. Done-math in `site-audit-finalizer.ts` now includes that counter (PR 1 step 1.4.10). The page loop's existing post-batch finalize call covers this — verify by grepping `finalizeSiteAudit` calls in `queue-manager.ts`. If finalize is only called after all pages drain, redirected pages will still trigger eventual finalize correctly.

Run: `grep -n "finalizeSiteAudit" lib/ada-audit/queue-manager.ts`
Expected: at least one call after the page loop completes per site audit.

- [ ] **Step 4: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Run existing tests**

Run: `npx vitest run lib/ada-audit/`
Expected: PASS, including finalizer tests with new pagesRedirected math.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/queue-manager.ts
git commit -m "feat(ada-audit): handle redirected child pages in site-audit page loop"
```

---

### Task 2.5: Surface redirected in AuditDetail + GET API + poller

**Files:**
- Modify: `lib/ada-audit/types.ts`
- Modify: `app/api/ada-audit/[id]/route.ts`
- Modify: `components/ada-audit/AuditPoller.tsx`

- [ ] **Step 1: Add fields to AuditDetail**

Open `lib/ada-audit/types.ts`. In `AuditDetail`, add:

```ts
  finalUrl?: string | null
  redirected?: boolean
```

- [ ] **Step 2: Serialize from GET /api/ada-audit/[id]**

Open `app/api/ada-audit/[id]/route.ts`. In the final `NextResponse.json({...})` (around line 90-110), add:

```ts
    finalUrl: audit.finalUrl ?? null,
    redirected: audit.redirected,
```

Do the same for the malformed-result fallback `NextResponse.json` earlier in the file.

- [ ] **Step 3: Recognize 'redirected' as terminal in AuditPoller**

Open `components/ada-audit/AuditPoller.tsx`. Find where polling stops on `complete` or `error`. Widen that condition to include `redirected`:

```ts
if (data.status === 'complete' || data.status === 'error' || data.status === 'redirected') {
  // stop polling
}
```

- [ ] **Step 4: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/types.ts app/api/ada-audit/[id]/route.ts components/ada-audit/AuditPoller.tsx
git commit -m "feat(ada-audit): surface redirected status through API and poller"
```

---

### Task 2.6: Render redirected state on standalone audit page

**Files:**
- Modify: `app/ada-audit/[id]/page.tsx`
- Maybe: `components/ada-audit/AuditResultsView.tsx` (gate on redirected)

- [ ] **Step 1: Locate where AuditResultsView is rendered**

Open `app/ada-audit/[id]/page.tsx`. Find the conditional that decides whether to show results, an error banner, or a still-running state.

- [ ] **Step 2: Add a redirected branch**

Add a check before the existing results render:

```tsx
if (audit.redirected && audit.finalUrl) {
  return (
    <div className="rounded-2xl border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 p-6">
      <h2 className="font-display font-bold text-[17px] text-navy dark:text-white mb-2">
        Page redirected
      </h2>
      <p className="text-[13px] font-body text-navy/70 dark:text-white/70">
        {audit.url} redirects to{' '}
        <a
          href={audit.finalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange hover:underline"
        >
          {audit.finalUrl}
        </a>
        . No accessibility scan was run — re-submit the final URL above to audit the destination.
      </p>
    </div>
  )
}
```

(Adapt the JSX to match this codebase's existing banner styles. Use the same color palette as the error banner if there is one — search for an existing "border-blue-200" or analogous component to copy the styling pattern.)

- [ ] **Step 3: Manual smoke**

Start dev server. Manually create a redirected audit by setting an AdaAudit row to `status='redirected'` in the DB via `sqlite3 prisma/local-dev.db` (or by triggering an audit against a real redirect like `bidwelltraining.edu/academic-support-servives/`). Visit `/ada-audit/<id>` — confirm the redirected banner shows with a working link to finalUrl.

- [ ] **Step 4: Commit**

```bash
git add app/ada-audit/[id]/page.tsx
git commit -m "feat(ada-audit): render redirected state on standalone audit detail"
```

---

### Task 2.7: Add Redirects section to SiteAuditResultsView

**Files:**
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`
- Maybe: `lib/ada-audit/types.ts` (`SitePageResult` may need a `redirected` flag)
- Maybe: `lib/ada-audit/site-audit-helpers.ts` (filter out redirected from common-issues; populate redirect rows in summary)

- [ ] **Step 1: Add redirected flag to per-page summary**

Open `lib/ada-audit/site-audit-helpers.ts`. Find `buildSiteAuditSummary`. In the per-page row construction, add `redirected: page.status === 'redirected'` and `finalUrl: page.finalUrl ?? null` to each row. Update `SitePageResult` in `types.ts` accordingly:

```ts
  redirected?: boolean
  finalUrl?: string | null
```

- [ ] **Step 2: Exclude redirected pages from common-issue aggregation**

In `buildSiteAuditSummary`, where it iterates page violations for common-issue analysis, skip any page where `page.status === 'redirected'` (no `result` to mine).

- [ ] **Step 3: Render Redirects section**

Open `components/ada-audit/SiteAuditResultsView.tsx`. Identify where "Pages with Issues" ends and "Clean Pages" begins. Between them, insert a new section:

```tsx
{redirectedPages.length > 0 && (
  <section className="rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-6">
    <details>
      <summary className="cursor-pointer font-display font-bold text-[17px] text-navy dark:text-white">
        Redirects <span className="text-navy/40 dark:text-white/40 font-normal text-[14px] ml-2">{redirectedPages.length}</span>
      </summary>
      <div className="mt-4 space-y-2">
        {redirectedPages.map((p) => (
          <div key={p.url} className="flex items-center gap-2 text-[13px] font-body">
            <span className="text-navy/60 dark:text-white/60 truncate">{p.url}</span>
            <span className="text-navy/30 dark:text-white/30">→</span>
            <a
              href={p.finalUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange hover:underline truncate"
            >
              {p.finalUrl}
            </a>
          </div>
        ))}
      </div>
    </details>
  </section>
)}
```

Compute `redirectedPages` at the top of the component:

```tsx
const redirectedPages = pages.filter((p) => p.redirected)
```

Also exclude redirected pages from the existing `issuePages` and `cleanPages` derivations.

- [ ] **Step 4: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke**

Run a site audit against `bidwelltraining.edu` (which has the `/academic-support-servives/` redirect). After completion, confirm the Redirects section appears with that URL listed and links to the homepage.

- [ ] **Step 6: Commit**

```bash
git add components/ada-audit/SiteAuditResultsView.tsx lib/ada-audit/types.ts lib/ada-audit/site-audit-helpers.ts
git commit -m "feat(ada-audit): redirects section in site audit results"
```

PR 2 complete.

---

# PR 3 — External link in violations view

Single-file change. Tiny PR.

### Task 3.1: Add external-link icon to "Pages with Issues" rows

**Files:**
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`

- [ ] **Step 1: Locate the violations PageRow**

Open `components/ada-audit/SiteAuditResultsView.tsx`. Find the `PageRow` component used inside the "Pages with Issues" table (or search for where each issue page's URL is rendered inside that table's `<tbody>`).

- [ ] **Step 2: Find the existing external-link pattern in the Pages view**

Run: `grep -n "target=\"_blank\"" components/ada-audit/SiteAuditResultsView.tsx components/ada-audit/SitemapTreeView.tsx`
Expected: locate the existing icon + anchor pattern used elsewhere on this same page (Pages view or sitemap view).

- [ ] **Step 3: Add the same external-link anchor next to each issue-row URL**

In the `PageRow` (or equivalent) inside "Pages with Issues", add an `<a target="_blank" rel="noopener noreferrer" href={page.url}>` wrapping a small external-link SVG, placed inline next to the URL text. Mirror the exact JSX + styling from the existing pattern found in Step 2.

- [ ] **Step 4: Manual smoke**

Run a site audit, open results, hover the external-link icon next to each URL in Pages with Issues. Click it and confirm it opens the page in a new tab.

- [ ] **Step 5: Commit**

```bash
git add components/ada-audit/SiteAuditResultsView.tsx
git commit -m "feat(ada-audit): external-link icon on Pages with Issues rows"
```

PR 3 complete.

---

# PR 4 — Shared element identification

### Task 4.1: Compute canonical selector during summary build

**Files:**
- Modify: `lib/ada-audit/site-audit-helpers.ts`
- Modify: `lib/ada-audit/types.ts`

- [ ] **Step 1: Extend the CommonIssue type**

Open `lib/ada-audit/types.ts`. Find the `CommonIssue` interface (around line 154-178). Add:

```ts
  canonicalSelector?: string | null
  selectorConfidence?: number
  examplePageUrl?: string | null
```

- [ ] **Step 2: Find the common-issue analysis function**

Open `lib/ada-audit/site-audit-helpers.ts`. Locate the function that builds common issues from page violations.

- [ ] **Step 3: Add page-based selector voting**

In the common-issue analysis, after determining the affected pages for a rule, compute:

```ts
function computeCanonicalSelector(
  affectedPages: { url: string; nodes: { target: string[] }[] }[],
): { canonicalSelector: string | null; selectorConfidence: number; examplePageUrl: string | null } {
  if (affectedPages.length === 0) {
    return { canonicalSelector: null, selectorConfidence: 0, examplePageUrl: null }
  }
  // One vote per page: the most-frequent target string within that page.
  const votes: { selector: string; pageUrl: string }[] = []
  for (const page of affectedPages) {
    if (page.nodes.length === 0) continue
    const counts = new Map<string, number>()
    for (const n of page.nodes) {
      const key = n.target.join(' ')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let topSelector: string | null = null
    let topCount = -1
    for (const [s, c] of counts) {
      if (c > topCount) { topSelector = s; topCount = c }
    }
    if (topSelector) votes.push({ selector: topSelector, pageUrl: page.url })
  }
  if (votes.length === 0) {
    return { canonicalSelector: null, selectorConfidence: 0, examplePageUrl: null }
  }
  // Mode of page votes.
  const tally = new Map<string, number>()
  for (const v of votes) tally.set(v.selector, (tally.get(v.selector) ?? 0) + 1)
  let canonical: string | null = null
  let canonicalCount = 0
  for (const [s, c] of tally) {
    if (c > canonicalCount) { canonical = s; canonicalCount = c }
  }
  // Require strict majority — half or less = no canonical.
  if (canonical === null || canonicalCount * 2 <= votes.length) {
    return { canonicalSelector: null, selectorConfidence: 0, examplePageUrl: null }
  }
  const examplePage = votes.find((v) => v.selector === canonical)?.pageUrl ?? null
  return {
    canonicalSelector: canonical,
    selectorConfidence: canonicalCount / affectedPages.length,
    examplePageUrl: examplePage,
  }
}
```

- [ ] **Step 4: Wire it into the common-issue construction**

Where each common-issue object is built for the summary, only for rows whose tier is `'template'` or `'common'` (i.e. ratio ≥0.5), call `computeCanonicalSelector` with the rule's affected-page data and merge its result into the issue object.

- [ ] **Step 5: Add a unit test**

Create or extend `lib/ada-audit/site-audit-helpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeCanonicalSelector } from './site-audit-helpers'  // export the helper for testability

describe('computeCanonicalSelector', () => {
  it('returns null when no pages', () => {
    expect(computeCanonicalSelector([])).toEqual({
      canonicalSelector: null, selectorConfidence: 0, examplePageUrl: null,
    })
  })

  it('picks the per-page mode then the cross-page mode', () => {
    const result = computeCanonicalSelector([
      { url: '/a', nodes: [{ target: ['nav.x'] }, { target: ['nav.x'] }, { target: ['p'] }] },
      { url: '/b', nodes: [{ target: ['nav.x'] }] },
      { url: '/c', nodes: [{ target: ['footer'] }] },
    ])
    expect(result.canonicalSelector).toBe('nav.x')
    expect(result.examplePageUrl).toBe('/a')
    expect(result.selectorConfidence).toBeCloseTo(2 / 3)
  })

  it('returns null when no strict majority', () => {
    const result = computeCanonicalSelector([
      { url: '/a', nodes: [{ target: ['x'] }] },
      { url: '/b', nodes: [{ target: ['y'] }] },
    ])
    expect(result.canonicalSelector).toBeNull()
  })
})
```

Export `computeCanonicalSelector` from `site-audit-helpers.ts` (or move it to its own file if you prefer; the test imports from wherever it lives).

- [ ] **Step 6: Run tests**

Run: `npx vitest run lib/ada-audit/site-audit-helpers.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ada-audit/site-audit-helpers.ts lib/ada-audit/site-audit-helpers.test.ts lib/ada-audit/types.ts
git commit -m "feat(ada-audit): page-based canonical-selector voting for common issues"
```

---

### Task 4.2: Render selector + example page link in CommonIssueCallout

**Files:**
- Modify: `components/ada-audit/CommonIssueCallout.tsx`

- [ ] **Step 1: Add selector line to the callout**

Open `components/ada-audit/CommonIssueCallout.tsx`. In the per-issue rendering, after the existing summary text, conditionally render:

```tsx
{issue.canonicalSelector && issue.examplePageUrl && (
  <div className="mt-2 text-[12px] font-body text-navy/60 dark:text-white/60">
    CSS selector: <code className="text-orange">{issue.canonicalSelector}</code>
    {' · '}
    <a
      href={issue.examplePageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-orange hover:underline"
    >
      View on {issue.examplePageUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
    </a>
  </div>
)}
```

If `issue.canonicalSelector` is missing or null, the existing copy renders unchanged.

- [ ] **Step 2: Manual smoke**

Run a fresh site audit against a real client domain that has at least one rule firing on ≥50% of pages. Confirm the callout shows the selector + "View on …" link, and clicking it opens the example page.

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/CommonIssueCallout.tsx
git commit -m "feat(ada-audit): show CSS selector + example page in common-issue callout"
```

PR 4 complete.

---

# PR 5 — Recents page + dashboard "My recents" card

### Task 5.1: Build the recents server component + query

**Files:**
- Create: `app/ada-audit/recents/page.tsx`
- Create: `lib/ada-audit/recents-query.ts`

- [ ] **Step 1: Build the unified-recents query helper**

Create `lib/ada-audit/recents-query.ts`:

```ts
import { prisma } from '@/lib/db'

export type RecentItem =
  | { type: 'page'; id: string; createdAt: Date; url: string; status: string; score: number | null; startedAt: Date | null; completedAt: Date | null; clientName: string | null; requestedBy: string | null }
  | { type: 'site'; id: string; createdAt: Date; domain: string; status: string; score: number | null; startedAt: Date | null; completedAt: Date | null; clientName: string | null; requestedBy: string | null }

export async function fetchRecentsForOperator(operator: string, limit: number = 100): Promise<RecentItem[]> {
  const [pages, sites] = await Promise.all([
    prisma.adaAudit.findMany({
      where: { requestedBy: operator, siteAuditId: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { client: { select: { name: true } } },
    }),
    prisma.siteAudit.findMany({
      where: { requestedBy: operator },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { client: { select: { name: true } } },
    }),
  ])

  const items: RecentItem[] = [
    ...pages.map((p): RecentItem => ({
      type: 'page',
      id: p.id,
      createdAt: p.createdAt,
      url: p.url,
      status: p.status,
      score: p.score,
      startedAt: p.startedAt,
      completedAt: p.completedAt,
      clientName: p.client?.name ?? null,
      requestedBy: p.requestedBy,
    })),
    ...sites.map((s): RecentItem => ({
      type: 'site',
      id: s.id,
      createdAt: s.createdAt,
      domain: s.domain,
      status: s.status,
      score: s.score,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      clientName: s.client?.name ?? null,
      requestedBy: s.requestedBy,
    })),
  ]
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return items.slice(0, limit)
}
```

- [ ] **Step 2: Build the recents page**

Create `app/ada-audit/recents/page.tsx`:

```tsx
import Link from 'next/link'
import { cookies } from 'next/headers'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'
import { fetchRecentsForOperator } from '@/lib/ada-audit/recents-query'
import { formatDuration, formatDurationHover } from '@/lib/ada-audit/duration'

export const dynamic = 'force-dynamic'

export default async function RecentsPage() {
  const operator = sanitizeOperatorName((await cookies()).get(OPERATOR_NAME_COOKIE_NAME)?.value)

  if (!operator) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="font-display font-bold text-[24px] text-navy dark:text-white mb-4">My recents</h1>
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60">
          Set your operator name on the <Link href="/ada-audit" className="text-orange hover:underline">audit dashboard</Link> to see your recent audits.
        </p>
      </main>
    )
  }

  const items = await fetchRecentsForOperator(operator)

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="font-display font-bold text-[24px] text-navy dark:text-white mb-6">My recents</h1>
      {items.length === 0 ? (
        <p className="text-[13px] font-body text-navy/60 dark:text-white/60">No recents yet.</p>
      ) : (
        <table className="w-full text-[13px] font-body">
          <thead>
            <tr className="border-b border-gray-200 dark:border-navy-border">
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Type</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">URL / Domain</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Client</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Status</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Score</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Duration</th>
              <th className="pb-2 pr-4 text-left text-[11px] font-semibold uppercase tracking-wider text-navy/50 dark:text-white/50">Date</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const href = it.type === 'page' ? `/ada-audit/${it.id}` : `/ada-audit/site/${it.id}`
              const label = it.type === 'page' ? it.url : it.domain
              return (
                <tr key={`${it.type}-${it.id}`} className="border-b border-gray-100 dark:border-navy-border">
                  <td className="py-2.5 pr-4">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${it.type === 'page' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'}`}>
                      {it.type === 'page' ? 'Page' : 'Site'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 max-w-[280px] truncate">
                    <Link href={href} className="text-orange hover:underline">{label}</Link>
                  </td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.clientName ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.status}</td>
                  <td className="py-2.5 pr-4 text-navy/60 dark:text-white/60">{it.score ?? '—'}</td>
                  <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap" title={formatDurationHover(it.startedAt, it.completedAt) ?? ''}>
                    {formatDuration(it.startedAt, it.completedAt) ?? '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-navy/40 dark:text-white/40 whitespace-nowrap">
                    {it.createdAt.toLocaleDateString()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual smoke**

Start dev server. Set your operator name cookie via the existing UI on `/ada-audit`. Navigate to `/ada-audit/recents`. Confirm the table shows your recent page + site audits mixed, with type chips and durations.

- [ ] **Step 5: Commit**

```bash
git add app/ada-audit/recents lib/ada-audit/recents-query.ts
git commit -m "feat(ada-audit): /ada-audit/recents page filtered by operator cookie"
```

---

### Task 5.2: Add MyRecentsCard to the dashboard and remove old history sections

**Files:**
- Create: `components/ada-audit/MyRecentsCard.tsx`
- Modify: `app/ada-audit/page.tsx`

- [ ] **Step 1: Build the compact MyRecentsCard**

Create `components/ada-audit/MyRecentsCard.tsx`:

```tsx
import Link from 'next/link'
import type { RecentItem } from '@/lib/ada-audit/recents-query'
import { formatDuration } from '@/lib/ada-audit/duration'

interface Props {
  items: RecentItem[]
  operator: string | null
}

export default function MyRecentsCard({ items, operator }: Props) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-navy-border bg-white dark:bg-navy-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-bold text-[14px] text-navy dark:text-white">
          My recents
        </h2>
        <Link href="/ada-audit/recents" className="text-[12px] font-body text-orange hover:underline">
          View all →
        </Link>
      </div>
      {!operator ? (
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">Set your name above to see your recents.</p>
      ) : items.length === 0 ? (
        <p className="text-[12px] font-body text-navy/50 dark:text-white/50">No recents yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const href = it.type === 'page' ? `/ada-audit/${it.id}` : `/ada-audit/site/${it.id}`
            const label = it.type === 'page' ? it.url : it.domain
            return (
              <li key={`${it.type}-${it.id}`} className="flex items-center gap-2 text-[12px] font-body">
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase shrink-0 ${it.type === 'page' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300'}`}>
                  {it.type === 'page' ? 'Page' : 'Site'}
                </span>
                <Link href={href} className="text-navy dark:text-white hover:text-orange truncate flex-1">{label}</Link>
                <span className="text-navy/40 dark:text-white/40 shrink-0">{formatDuration(it.startedAt, it.completedAt) ?? '—'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Mount it on the dashboard**

Open `app/ada-audit/page.tsx`. Add cookie + recents fetch at the top:

```tsx
import { cookies } from 'next/headers'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'
import { fetchRecentsForOperator } from '@/lib/ada-audit/recents-query'
import MyRecentsCard from '@/components/ada-audit/MyRecentsCard'
```

In the page function:

```tsx
  const operator = sanitizeOperatorName((await cookies()).get(OPERATOR_NAME_COOKIE_NAME)?.value)
  const recentItems = operator ? await fetchRecentsForOperator(operator, 5) : []
```

- [ ] **Step 3: Replace AuditHistory + SiteAuditHistory with MyRecentsCard**

Locate the JSX in `app/ada-audit/page.tsx` that mounts `<AuditHistory />` and `<SiteAuditHistory />`. Replace both with:

```tsx
<MyRecentsCard items={recentItems} operator={operator} />
```

Adjust grid columns if those components occupied wider lanes. Keep all other dashboard cards (forms, queue status, etc.) unchanged.

- [ ] **Step 4: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke**

Open `/ada-audit`. Confirm the dashboard now shows a single "My recents" card with 5 rows (mixed page + site), and the "View all →" link goes to `/ada-audit/recents`. Confirm the full history pages are no longer on the dashboard.

- [ ] **Step 6: Commit**

```bash
git add components/ada-audit/MyRecentsCard.tsx app/ada-audit/page.tsx
git commit -m "feat(ada-audit): replace dashboard history sections with My recents card"
```

PR 5 complete.

---

# PR 6 — Checkboxes (largest)

Builds keys/storage modules, two API endpoints, share-endpoint read, Triage Mode toggle, and integrates checkboxes into single-page + site results views.

### Task 6.1: Build checks-keys with hashed canonical JSON (TDD)

**Files:**
- Create: `lib/ada-audit/checks-keys.ts`
- Create: `lib/ada-audit/checks-keys.test.ts`

- [ ] **Step 1: Write the test file**

Create `lib/ada-audit/checks-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { keyForNode, keyForPage, keyForPageViolation, canonicalJson } from './checks-keys'

describe('canonicalJson', () => {
  it('sorts object keys alphabetically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('handles nested objects', () => {
    expect(canonicalJson({ outer: { b: 1, a: 2 }, first: 'x' })).toBe('{"first":"x","outer":{"a":2,"b":1}}')
  })

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })
})

describe('keyForNode', () => {
  it('is deterministic for the same inputs', () => {
    const a = keyForNode({ ruleId: 'color-contrast', target: ['nav', 'a.link'] })
    const b = keyForNode({ ruleId: 'color-contrast', target: ['nav', 'a.link'] })
    expect(a).toBe(b)
  })

  it('differs when ruleId differs', () => {
    const a = keyForNode({ ruleId: 'color-contrast', target: ['nav'] })
    const b = keyForNode({ ruleId: 'image-alt', target: ['nav'] })
    expect(a).not.toBe(b)
  })

  it('differs when target differs', () => {
    const a = keyForNode({ ruleId: 'color-contrast', target: ['nav'] })
    const b = keyForNode({ ruleId: 'color-contrast', target: ['footer'] })
    expect(a).not.toBe(b)
  })

  it('outputs 64-char hex', () => {
    const k = keyForNode({ ruleId: 'r', target: ['t'] })
    expect(k).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('keyForPage', () => {
  it('is deterministic', () => {
    expect(keyForPage({ pageUrl: 'https://x.com/a' })).toBe(keyForPage({ pageUrl: 'https://x.com/a' }))
  })
})

describe('keyForPageViolation', () => {
  it('is deterministic', () => {
    const a = keyForPageViolation({ pageUrl: 'https://x.com/a', ruleId: 'color-contrast' })
    const b = keyForPageViolation({ pageUrl: 'https://x.com/a', ruleId: 'color-contrast' })
    expect(a).toBe(b)
  })

  it('is delimiter-safe (contains pipe in URL)', () => {
    const a = keyForPageViolation({ pageUrl: 'https://x.com/a|b', ruleId: 'color-contrast' })
    const b = keyForPageViolation({ pageUrl: 'https://x.com/a', ruleId: 'b|color-contrast' })
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run lib/ada-audit/checks-keys.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement checks-keys**

Create `lib/ada-audit/checks-keys.ts`:

```ts
import { createHash } from 'crypto'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}'
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function keyForNode(input: { ruleId: string; target: string[] }): string {
  return sha256Hex(canonicalJson({ scope: 'node', ruleId: input.ruleId, target: input.target }))
}

export function keyForPage(input: { pageUrl: string }): string {
  return sha256Hex(canonicalJson({ scope: 'page', pageUrl: input.pageUrl }))
}

export function keyForPageViolation(input: { pageUrl: string; ruleId: string }): string {
  return sha256Hex(canonicalJson({ scope: 'page-violation', pageUrl: input.pageUrl, ruleId: input.ruleId }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/ada-audit/checks-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/checks-keys.ts lib/ada-audit/checks-keys.test.ts
git commit -m "feat(ada-audit): checks-keys with hashed canonical JSON"
```

---

### Task 6.2: Build a matching browser-side keys module

**Files:**
- Create: `lib/ada-audit/checks-keys-browser.ts`
- Create: `lib/ada-audit/checks-keys-browser.test.ts`

Server-side uses `crypto`; browser needs Web Crypto SubtleCrypto (async). To keep parity, expose the same three functions returning Promises in the browser.

- [ ] **Step 1: Implement**

Create `lib/ada-audit/checks-keys-browser.ts`:

```ts
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}'
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function keyForNode(input: { ruleId: string; target: string[] }): Promise<string> {
  return sha256Hex(canonicalJson({ scope: 'node', ruleId: input.ruleId, target: input.target }))
}

export async function keyForPage(input: { pageUrl: string }): Promise<string> {
  return sha256Hex(canonicalJson({ scope: 'page', pageUrl: input.pageUrl }))
}

export async function keyForPageViolation(input: { pageUrl: string; ruleId: string }): Promise<string> {
  return sha256Hex(canonicalJson({ scope: 'page-violation', pageUrl: input.pageUrl, ruleId: input.ruleId }))
}
```

- [ ] **Step 2: Cross-check parity test**

Create `lib/ada-audit/checks-keys-browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as server from './checks-keys'
import * as browser from './checks-keys-browser'

describe('browser/server key parity', () => {
  it('keyForNode matches', async () => {
    const s = server.keyForNode({ ruleId: 'r', target: ['t', 'u'] })
    const b = await browser.keyForNode({ ruleId: 'r', target: ['t', 'u'] })
    expect(s).toBe(b)
  })

  it('keyForPage matches', async () => {
    expect(server.keyForPage({ pageUrl: '/a' })).toBe(await browser.keyForPage({ pageUrl: '/a' }))
  })

  it('keyForPageViolation matches', async () => {
    expect(server.keyForPageViolation({ pageUrl: '/a', ruleId: 'r' })).toBe(await browser.keyForPageViolation({ pageUrl: '/a', ruleId: 'r' }))
  })
})
```

Note: Vitest needs `crypto.subtle` available. In Node 22 it is, but if the default test environment is `jsdom` you may need `// @vitest-environment node` at the top of the browser test file. Check `vitest.config.ts` for the default and add the comment if needed.

- [ ] **Step 3: Run tests**

Run: `npx vitest run lib/ada-audit/checks-keys`
Expected: PASS for both files.

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/checks-keys-browser.ts lib/ada-audit/checks-keys-browser.test.ts
git commit -m "feat(ada-audit): browser-side checks-keys matching server output"
```

---

### Task 6.3: Build checks-store with upsert/delete

**Files:**
- Create: `lib/ada-audit/checks-store.ts`

- [ ] **Step 1: Implement the store**

Create `lib/ada-audit/checks-store.ts`:

```ts
import { prisma } from '@/lib/db'

export async function getAdaAuditChecks(adaAuditId: string) {
  return prisma.adaAuditCheck.findMany({ where: { adaAuditId }, orderBy: { createdAt: 'asc' } })
}

export async function setAdaAuditCheck(input: {
  adaAuditId: string
  scope: 'node'
  key: string
  checked: boolean
  operator: string | null
}) {
  const { adaAuditId, scope, key, checked, operator } = input
  if (checked) {
    await prisma.adaAuditCheck.upsert({
      where: { adaAuditId_scope_key: { adaAuditId, scope, key } },
      create: { adaAuditId, scope, key, checkedBy: operator },
      update: { checkedBy: operator },
    })
  } else {
    await prisma.adaAuditCheck.deleteMany({ where: { adaAuditId, scope, key } })
  }
  return getAdaAuditChecks(adaAuditId)
}

export async function getSiteAuditChecks(siteAuditId: string) {
  return prisma.siteAuditCheck.findMany({ where: { siteAuditId }, orderBy: { createdAt: 'asc' } })
}

export async function setSiteAuditCheck(input: {
  siteAuditId: string
  scope: 'page' | 'page-violation'
  key: string
  checked: boolean
  operator: string | null
}) {
  const { siteAuditId, scope, key, checked, operator } = input
  if (checked) {
    await prisma.siteAuditCheck.upsert({
      where: { siteAuditId_scope_key: { siteAuditId, scope, key } },
      create: { siteAuditId, scope, key, checkedBy: operator },
      update: { checkedBy: operator },
    })
  } else {
    await prisma.siteAuditCheck.deleteMany({ where: { siteAuditId, scope, key } })
  }
  return getSiteAuditChecks(siteAuditId)
}
```

- [ ] **Step 2: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS. If Prisma's generated client doesn't expose `adaAuditCheck_scope_key` etc., adjust the where shape to match the generated input type (`@@unique([adaAuditId, scope, key])` translates to `adaAuditId_scope_key`; if Prisma names it differently, use the generated name).

- [ ] **Step 3: Commit**

```bash
git add lib/ada-audit/checks-store.ts
git commit -m "feat(ada-audit): checks-store CRUD for AdaAuditCheck and SiteAuditCheck"
```

---

### Task 6.4: Build API endpoints for checks

**Files:**
- Create: `app/api/ada-audit/[id]/checks/route.ts`
- Create: `app/api/site-audit/[id]/checks/route.ts`

- [ ] **Step 1: Single-page checks endpoint**

Create `app/api/ada-audit/[id]/checks/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'
import { getAdaAuditChecks, setAdaAuditCheck } from '@/lib/ada-audit/checks-store'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const audit = await prisma.adaAudit.findUnique({ where: { id }, select: { id: true } })
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  const checks = await getAdaAuditChecks(id)
  return NextResponse.json({ checks })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const audit = await prisma.adaAudit.findUnique({ where: { id }, select: { id: true } })
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const b = body as Record<string, unknown>
  const scope = b.scope
  const key = b.key
  const checked = b.checked
  if (scope !== 'node' || typeof key !== 'string' || typeof checked !== 'boolean') {
    return NextResponse.json({ error: 'scope must be "node", key must be string, checked must be boolean' }, { status: 400 })
  }

  const operator = sanitizeOperatorName(req.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value)
  const checks = await setAdaAuditCheck({ adaAuditId: id, scope: 'node', key, checked, operator })
  return NextResponse.json({ checks })
}
```

- [ ] **Step 2: Site audit checks endpoint**

Create `app/api/site-audit/[id]/checks/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { OPERATOR_NAME_COOKIE_NAME, sanitizeOperatorName } from '@/lib/auth'
import { getSiteAuditChecks, setSiteAuditCheck } from '@/lib/ada-audit/checks-store'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({ where: { id }, select: { id: true } })
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  const checks = await getSiteAuditChecks(id)
  return NextResponse.json({ checks })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const audit = await prisma.siteAudit.findUnique({ where: { id }, select: { id: true } })
  if (!audit) return NextResponse.json({ error: 'Audit not found' }, { status: 404 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const b = body as Record<string, unknown>
  const scope = b.scope
  const key = b.key
  const checked = b.checked
  if ((scope !== 'page' && scope !== 'page-violation') || typeof key !== 'string' || typeof checked !== 'boolean') {
    return NextResponse.json({ error: 'scope must be "page" or "page-violation", key must be string, checked must be boolean' }, { status: 400 })
  }

  const operator = sanitizeOperatorName(req.cookies.get(OPERATOR_NAME_COOKIE_NAME)?.value)
  const checks = await setSiteAuditCheck({ siteAuditId: id, scope, key, checked, operator })
  return NextResponse.json({ checks })
}
```

- [ ] **Step 3: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Smoke via curl**

Start dev server. Get a real audit ID from the DB. Run:

```bash
curl -X PUT http://localhost:3000/api/ada-audit/<id>/checks \
  -H 'Content-Type: application/json' \
  -d '{"scope":"node","key":"abcd...","checked":true}'
```

Expected: 200 with `{ checks: [...] }`. Then PUT again with `checked: false` and confirm the row disappears.

- [ ] **Step 5: Commit**

```bash
git add app/api/ada-audit/[id]/checks app/api/site-audit/[id]/checks
git commit -m "feat(ada-audit): PUT/GET checks API for single-page and site audits"
```

---

### Task 6.5: Share-view read endpoint for checks

**Files:**
- Create: `app/api/ada-audit/share/[token]/checks/route.ts`

- [ ] **Step 1: Find existing share endpoint pattern**

Run: `cat app/api/ada-audit/share/\[token\]/route.ts` (path may differ — adapt). Read the expiry-check pattern used by the existing share endpoint.

- [ ] **Step 2: Implement read-only checks endpoint**

Create `app/api/ada-audit/share/[token]/checks/route.ts` using the same expiry check:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAdaAuditChecks } from '@/lib/ada-audit/checks-store'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const audit = await prisma.adaAudit.findUnique({
    where: { shareToken: token },
    select: { id: true, shareExpiresAt: true },
  })
  if (!audit) return NextResponse.json({ error: 'Share link not found' }, { status: 404 })
  if (audit.shareExpiresAt && audit.shareExpiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Share link expired' }, { status: 410 })
  }
  const checks = await getAdaAuditChecks(audit.id)
  return NextResponse.json({ checks })
}
```

- [ ] **Step 3: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/ada-audit/share/[token]/checks
git commit -m "feat(ada-audit): read-only checks endpoint for share view"
```

---

### Task 6.6: Triage-mode toggle + checkboxes in AuditResultsView (single page)

**Files:**
- Modify: `components/ada-audit/AuditResultsView.tsx`
- Modify: `components/ada-audit/AuditIssueCard.tsx` (or wherever each rule + nodes render)
- Create: `components/ada-audit/useChecks.ts` (client hook)

- [ ] **Step 1: Build the useChecks hook**

Create `components/ada-audit/useChecks.ts`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

export interface CheckRow { scope: string; key: string }

interface UseChecksArgs {
  endpoint: string  // e.g. /api/ada-audit/<id>/checks
  enabled: boolean
  readOnly?: boolean
}

export function useChecks({ endpoint, enabled, readOnly = false }: UseChecksArgs) {
  const [checks, setChecks] = useState<CheckRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch(endpoint).then(async (r) => {
      if (!r.ok) throw new Error(`Failed to load checks: ${r.status}`)
      const j = await r.json()
      if (!cancelled) { setChecks(j.checks ?? []); setLoaded(true) }
    }).catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [enabled, endpoint])

  const has = useCallback((scope: string, key: string) =>
    checks.some((c) => c.scope === scope && c.key === key)
  , [checks])

  const setCheck = useCallback(async (scope: string, key: string, checked: boolean) => {
    if (readOnly) return
    const prev = checks
    setChecks(checked
      ? [...prev, { scope, key }]
      : prev.filter((c) => !(c.scope === scope && c.key === key))
    )
    try {
      const r = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, key, checked }),
      })
      if (!r.ok) throw new Error(`PUT failed: ${r.status}`)
      const j = await r.json()
      setChecks(j.checks ?? [])
    } catch (e) {
      setChecks(prev)  // rollback
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [checks, endpoint, readOnly])

  return { checks, loaded, error, has, setCheck }
}
```

- [ ] **Step 2: Add Triage Mode toggle to AuditResultsView toolbar**

Open `components/ada-audit/AuditResultsView.tsx`. At the top of the component, add Triage Mode state:

```tsx
'use client'
// (file may already be 'use client'; if not, mark it. If marking it breaks server-rendering callers,
// instead split the toolbar + checkbox layer into a child client component.)

import { useEffect, useState } from 'react'
import { useChecks } from './useChecks'
import { keyForNode } from '@/lib/ada-audit/checks-keys-browser'
```

```tsx
  const [triageMode, setTriageMode] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(`er-triage-mode:${auditId}`)
    if (stored === '1') setTriageMode(true)
  }, [auditId])

  const onToggleTriage = () => {
    setTriageMode((prev) => {
      const next = !prev
      localStorage.setItem(`er-triage-mode:${auditId}`, next ? '1' : '0')
      return next
    })
  }

  const checks = useChecks({
    endpoint: readOnly ? `/api/ada-audit/share/${shareToken}/checks` : `/api/ada-audit/${auditId}/checks`,
    enabled: triageMode || readOnly,
    readOnly,
  })
```

If `shareToken` isn't already a prop, thread it through from the page that mounts AuditResultsView in share mode.

Add a toolbar button (placed next to existing toolbar controls):

```tsx
{!readOnly && (
  <button
    type="button"
    onClick={onToggleTriage}
    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-body font-semibold border rounded-lg transition-colors ${triageMode ? 'bg-orange/10 border-orange text-orange' : 'border-gray-300 dark:border-navy-border text-navy/60 dark:text-white/60 hover:border-orange hover:text-orange'}`}
  >
    {triageMode ? 'Triage on' : 'Triage off'}
  </button>
)}
```

- [ ] **Step 3: Pass triageMode + checks down to AuditIssueCard**

Wherever AuditResultsView renders the list of violations / rule cards, pass these props down:

```tsx
<AuditIssueCard
  violation={v}
  triageMode={triageMode}
  readOnly={readOnly}
  checks={checks}
/>
```

- [ ] **Step 4: Render checkboxes in AuditIssueCard**

Open `components/ada-audit/AuditIssueCard.tsx`. Add the new props to its interface:

```tsx
interface Props {
  violation: AxeViolation
  triageMode?: boolean
  readOnly?: boolean
  checks?: ReturnType<typeof import('./useChecks').useChecks>
}
```

Per-node, compute the key on the fly with `keyForNode`. Because key computation is async (Web Crypto), prefer pre-computing keys once when the violation prop arrives:

```tsx
const [nodeKeys, setNodeKeys] = useState<string[]>([])
useEffect(() => {
  let cancelled = false
  Promise.all(violation.nodes.map((n) => keyForNode({ ruleId: violation.id, target: n.target })))
    .then((ks) => { if (!cancelled) setNodeKeys(ks) })
  return () => { cancelled = true }
}, [violation])
```

Per-rule "derived" struck state:

```tsx
const allNodesChecked = nodeKeys.length > 0 && nodeKeys.every((k) => checks?.has('node', k))
```

Render the rule-header checkbox (gated on `triageMode`):

```tsx
{triageMode && (
  <input
    type="checkbox"
    checked={allNodesChecked}
    disabled={readOnly || !checks?.loaded || nodeKeys.length === 0}
    onChange={(e) => {
      const target = e.currentTarget.checked
      // Fan out: PUT every node key to `target`.
      for (const k of nodeKeys) {
        checks?.setCheck('node', k, target)
      }
    }}
    aria-label={`Mark rule ${violation.id} as resolved`}
  />
)}
```

Apply strike-through styling on the rule header when `allNodesChecked`:

```tsx
<h3 className={allNodesChecked ? 'line-through text-navy/40 dark:text-white/30' : ''}>...</h3>
```

Per-node checkbox + strike-through (within each node row):

```tsx
{triageMode && (
  <input
    type="checkbox"
    checked={checks?.has('node', nodeKeys[i]) ?? false}
    disabled={readOnly || !checks?.loaded}
    onChange={(e) => checks?.setCheck('node', nodeKeys[i], e.currentTarget.checked)}
    aria-label={`Mark node as resolved`}
  />
)}
<div className={checks?.has('node', nodeKeys[i]) ? 'line-through text-navy/40 dark:text-white/30' : ''}>
  ...node row contents...
</div>
```

- [ ] **Step 5: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Manual smoke**

Run an audit, view results, toggle Triage on. Confirm:
- Checkboxes appear per rule and per node.
- Checking a node persists across page refresh.
- Checking the rule checkbox strikes every node.
- Unchecking the rule clears all nodes.

- [ ] **Step 7: Commit**

```bash
git add components/ada-audit/AuditResultsView.tsx components/ada-audit/AuditIssueCard.tsx components/ada-audit/useChecks.ts
git commit -m "feat(ada-audit): triage mode + per-node/rule checkboxes on single page audits"
```

---

### Task 6.7: Checkboxes on site audit "Pages with Issues"

**Files:**
- Modify: `components/ada-audit/SiteAuditResultsView.tsx`
- Modify: `components/ada-audit/GroupedViolationsView.tsx` (or whichever component renders each page's violations within Pages with Issues)

- [ ] **Step 1: Add Triage Mode toggle to SiteAuditResultsView**

Same pattern as AuditResultsView in Task 6.6 Step 2:

```tsx
import { useChecks } from './useChecks'
import { keyForPage, keyForPageViolation } from '@/lib/ada-audit/checks-keys-browser'
```

Add `triageMode` state + localStorage persistence (key `er-triage-mode:${siteAuditId}`) and a toolbar toggle button.

Wire the hook:

```tsx
const checks = useChecks({
  endpoint: `/api/site-audit/${siteAuditId}/checks`,
  enabled: triageMode,
})
```

- [ ] **Step 2: Per-page checkbox in the Pages with Issues table**

In the `PageRow` component, pre-compute `pageKey` (async):

```tsx
const [pageKey, setPageKey] = useState<string>('')
useEffect(() => {
  keyForPage({ pageUrl: page.url }).then(setPageKey)
}, [page.url])

const [violationKeys, setViolationKeys] = useState<Record<string, string>>({})
useEffect(() => {
  let cancelled = false
  Promise.all(page.violations.map((v) => keyForPageViolation({ pageUrl: page.url, ruleId: v.id }).then((k) => [v.id, k] as const)))
    .then((entries) => { if (!cancelled) setViolationKeys(Object.fromEntries(entries)) })
  return () => { cancelled = true }
}, [page.url, page.violations])

const allViolationsChecked = page.violations.length > 0 &&
  Object.values(violationKeys).length === page.violations.length &&
  Object.values(violationKeys).every((k) => checks?.has('page-violation', k))

const pageStruck = checks?.has('page', pageKey) || allViolationsChecked
```

Render the page-row checkbox:

```tsx
{triageMode && (
  <td className="py-2.5 pr-2">
    <input
      type="checkbox"
      checked={!!pageStruck}
      disabled={!checks?.loaded || !pageKey}
      onChange={(e) => checks?.setCheck('page', pageKey, e.currentTarget.checked)}
      aria-label={`Mark page ${page.url} as handled`}
    />
  </td>
)}
```

Apply strike to the URL cell when `pageStruck`.

- [ ] **Step 3: Per-violation checkboxes inside expanded page detail**

Inside whichever component renders the violations list for an expanded page row, add a checkbox per violation row:

```tsx
{triageMode && (
  <input
    type="checkbox"
    checked={checks?.has('page-violation', violationKeys[v.id] ?? '') ?? false}
    disabled={!checks?.loaded || !violationKeys[v.id]}
    onChange={(e) => checks?.setCheck('page-violation', violationKeys[v.id]!, e.currentTarget.checked)}
    aria-label={`Mark violation ${v.id} on ${page.url} as resolved`}
  />
)}
```

Apply strike when checked.

- [ ] **Step 4: Run tsc**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke**

Open a completed site audit. Toggle Triage on. Confirm:
- Page rows have checkboxes; checking a page strikes the row.
- Expanding a page reveals per-violation checkboxes; checking every violation strikes the page row.
- Refreshing preserves state.

- [ ] **Step 6: Commit**

```bash
git add components/ada-audit/SiteAuditResultsView.tsx components/ada-audit/GroupedViolationsView.tsx
git commit -m "feat(ada-audit): per-page and per-violation checkboxes on site audits"
```

---

### Task 6.8: Read-only checks on share view

**Files:**
- Modify: `app/ada-audit/share/[token]/page.tsx`
- Modify: `components/ada-audit/AuditResultsView.tsx` (already accepts `readOnly`)

- [ ] **Step 1: Pass shareToken to AuditResultsView**

In `app/ada-audit/share/[token]/page.tsx`, where it mounts `<AuditResultsView ... readOnly />`, also pass `shareToken={token}`. Add `shareToken?: string` to AuditResultsView's prop type.

- [ ] **Step 2: Confirm useChecks endpoint switches based on readOnly**

The hook call in Task 6.6 Step 2 already switches between `/api/ada-audit/${auditId}/checks` and `/api/ada-audit/share/${shareToken}/checks` based on `readOnly`. Confirm that branch is reached when `readOnly` is true.

- [ ] **Step 3: Confirm Triage toggle is hidden in readOnly**

The toggle button JSX from Task 6.6 Step 2 is gated on `!readOnly`. Confirm.

- [ ] **Step 4: Always-on display of strikes in readOnly**

In readOnly mode the toggle is hidden, but strikes should still display. Adjust so `triageMode || readOnly` triggers the strike-through rendering (and pulls checks from the share endpoint).

- [ ] **Step 5: Manual smoke**

Create a share link for an audit that has checks. Open it in an incognito window. Confirm checked rows are struck out and no checkboxes appear (or they are disabled).

- [ ] **Step 6: Commit**

```bash
git add app/ada-audit/share components/ada-audit/AuditResultsView.tsx
git commit -m "feat(ada-audit): show checks read-only on share view"
```

PR 6 complete.

---

# Final integration pass

After all six PRs are merged locally:

- [ ] Run full test suite: `npx vitest run`
- [ ] Run typecheck: `npx tsc --noEmit`
- [ ] Build: `npm run build`
- [ ] Manual smoke across `bidwelltraining.edu` (redirects), a client with site-wide patterns (shared selector callout), a real audit run (duration column, recents page), and a triage-mode session (checkboxes single-page + site).

Do not push or deploy until user has reviewed all six PRs.
