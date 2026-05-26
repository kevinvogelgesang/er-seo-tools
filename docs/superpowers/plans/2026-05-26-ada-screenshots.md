# ADA Audit Screenshots Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture one screenshot per axe node (capped 50/page), always-on for both page and site audits, retain artifacts for 24h after `completedAt`, sweep them in the background, and hide expired screenshots silently in the UI.

**Architecture:** The runner defaults screenshot capture ON and derives the output dir from the audit id, wrapped in a boundary try/catch so capture never fails an audit. Capture iterates nodes (not violations), writing `${violationId}-${nodeIndex}.png`. A new background sweeper (started in `instrumentation.ts`) deletes screenshot dirs older than 24h. The serving route's cache header drops to 1h so swept files actually 404 and the UI `onError`-hides them.

**Tech Stack:** Next.js 15, TypeScript, puppeteer-core, Prisma + SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-26-ada-screenshots-design.md`

---

## File Structure

- `lib/ada-audit/types.ts` — **modify.** Add `screenshotPath?` to `AxeNode`; deprecate (keep) on `AxeViolation`.
- `lib/ada-audit/screenshot-helpers.ts` — **modify.** Per-node capture, `MAX_SCREENSHOTS_PER_PAGE = 50`, `SCREENSHOT_RETENTION_MS`, mkdir inside try.
- `lib/ada-audit/runner.ts` — **modify.** Default-on capture, derived dir, boundary try/catch, node-based flag calc.
- `app/api/ada-audit/route.ts` — **modify.** Stop reading `captureScreenshots` from the body.
- `components/ada-audit/AuditForm.tsx` — **modify.** Remove the capture checkbox.
- `lib/ada-audit/screenshot-sweeper.ts` — **create.** `sweepExpiredScreenshots()`, `startScreenshotSweeper()`, `stopScreenshotSweeper()`.
- `instrumentation.ts` — **modify.** Start/stop the sweeper alongside existing intervals.
- `app/api/ada-audit/screenshots/[auditId]/[filename]/route.ts` — **modify.** Cache header → `private, max-age=3600`.
- `components/ada-audit/AuditIssueCard.tsx` — **modify.** Per-node thumbnail grid with `onError` hide.

---

## Task 1: Per-node capture + new constants

**Files:**
- Modify: `lib/ada-audit/types.ts`
- Modify: `lib/ada-audit/screenshot-helpers.ts`
- Test: `lib/ada-audit/screenshot-helpers.test.ts`

- [ ] **Step 1: Add `screenshotPath` to `AxeNode`**

In `lib/ada-audit/types.ts`, add to the `AxeNode` interface:

```ts
/** Filename of this node's element screenshot (e.g. "color-contrast-0.png"). */
screenshotPath?: string
```

Keep `screenshotPath?: string` on `AxeViolation` but add a JSDoc note: `/** @deprecated 2026-05-26 — new audits set screenshotPath on each AxeNode. Kept for legacy audits. */`.

- [ ] **Step 2: Write the failing test**

```ts
// lib/ada-audit/screenshot-helpers.test.ts
import { describe, it, expect, vi } from 'vitest'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { captureViolationScreenshots, MAX_SCREENSHOTS_PER_PAGE } from './screenshot-helpers'
import type { AxeViolation } from './types'

function fakePage() {
  // Each $ returns a handle; screenshot writes a small file; evaluateHandle returns the same handle.
  return {
    $: vi.fn(async () => ({
      screenshot: vi.fn(async ({ path: p }: { path: string }) => { await fs.writeFile(p, 'x') }),
      dispose: vi.fn(async () => {}),
    })),
    evaluateHandle: vi.fn(async (_fn: unknown, handle: unknown) => handle),
  } as never
}

function violation(id: string, nodeCount: number): AxeViolation {
  return {
    id, impact: 'serious', help: id, description: '', helpUrl: '', tags: [],
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      html: `<i>${i}</i>`, target: [`#${id}-${i}`], failureSummary: '',
    })),
  } as never
}

describe('captureViolationScreenshots (per-node)', () => {
  it('writes one file per node and sets node.screenshotPath', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ss-'))
    const v = violation('color-contrast', 3)
    await captureViolationScreenshots(fakePage(), [v], dir)
    expect(v.nodes[0].screenshotPath).toBe('color-contrast-0.png')
    expect(v.nodes[2].screenshotPath).toBe('color-contrast-2.png')
    const files = await fs.readdir(dir)
    expect(files.sort()).toEqual(['color-contrast-0.png', 'color-contrast-1.png', 'color-contrast-2.png'])
  })

  it('caps at MAX_SCREENSHOTS_PER_PAGE across violations', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ss-'))
    const many = Array.from({ length: 10 }, (_, k) => violation(`v${k}`, 10)) // 100 nodes
    await captureViolationScreenshots(fakePage(), many, dir)
    const files = await fs.readdir(dir)
    expect(files.length).toBe(MAX_SCREENSHOTS_PER_PAGE)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/screenshot-helpers.test.ts`
Expected: FAIL — `MAX_SCREENSHOTS_PER_PAGE` not exported / still per-violation.

- [ ] **Step 4: Rewrite capture for per-node + add constants**

In `lib/ada-audit/screenshot-helpers.ts`:

```ts
export const MAX_SCREENSHOTS_PER_PAGE = 50
export const SCREENSHOT_RETENTION_MS =
  Number(process.env.SCREENSHOT_RETENTION_HOURS ?? 24) * 60 * 60 * 1000
```

Rewrite the body so the `fs.mkdir` is inside a try, and the loop walks nodes:

```ts
export async function captureViolationScreenshots(
  page: Page, violations: AxeViolation[], dir: string,
): Promise<void> {
  if (violations.length === 0) return
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch (err) {
    console.warn('[ada-audit/screenshots] mkdir failed, skipping capture:', err)
    return
  }

  let captured = 0
  outer:
  for (const violation of violations) {
    for (let i = 0; i < violation.nodes.length; i++) {
      if (captured >= MAX_SCREENSHOTS_PER_PAGE) {
        console.warn(`[ada-audit/screenshots] Reached cap of ${MAX_SCREENSHOTS_PER_PAGE}, skipping rest`)
        break outer
      }
      const node = violation.nodes[i]
      if (!node?.target?.length) continue
      const selector = node.target[node.target.length - 1]
      try {
        const handle = await page.$(selector)
        if (!handle) continue
        try {
          const filename = `${violation.id}-${i}.png`
          const screenshotTarget = await page.evaluateHandle((el) => el.parentElement ?? el, handle)
          try {
            await (screenshotTarget as ElementHandle).screenshot({ path: path.join(dir, filename), type: 'png' })
            node.screenshotPath = filename
            captured++
          } finally {
            await screenshotTarget.dispose()
          }
        } catch (err) {
          console.warn(`[ada-audit/screenshots] capture failed for "${violation.id}" node ${i}:`, err)
        } finally {
          await handle.dispose()
        }
      } catch (err) {
        console.warn(`[ada-audit/screenshots] selector failed for "${violation.id}" node ${i}:`, err)
      }
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/ada-audit/screenshot-helpers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ada-audit/types.ts lib/ada-audit/screenshot-helpers.ts lib/ada-audit/screenshot-helpers.test.ts
git commit -m "feat(ada): capture one screenshot per axe node, cap 50/page"
```

---

## Task 2: Runner default-on capture + boundary catch + node flag

**Files:**
- Modify: `lib/ada-audit/runner.ts`

- [ ] **Step 1: Replace the line-344 capture block**

Add `import path from 'path'` and `import { SCREENSHOTS_DIR } from './screenshot-helpers'` (if not present). Replace the block:

```ts
    const shouldCapture = options?.captureScreenshots !== false  // default ON
    if (shouldCapture && options?.auditId) {
      const screenshotDir = options.screenshotDir ?? path.join(SCREENSHOTS_DIR, options.auditId)
      await progress(93, 'Capturing element screenshots…')
      try {
        await captureViolationScreenshots(page, axe.violations, screenshotDir)
      } catch (err) {
        console.warn('[ada-audit/screenshots] capture phase failed, continuing:', err)
      }
      axe.captureScreenshots = axe.violations.some(
        (v) => v.nodes.some((n) => n.screenshotPath != null) || v.screenshotPath != null,
      )
    }
```

(`options.auditId` is already required by `runAxeAudit` per the guard at `runner.ts:67`, so the dir is always derivable.)

- [ ] **Step 2: Verify the RunOptions type still fits**

`captureScreenshots?: boolean` and `screenshotDir?: string` already exist on the options type (`runner.ts:32-33`). No type change needed. Run `npx tsc --noEmit`.

- [ ] **Step 3: Manual smoke (page audit)**

Run `npm run dev`, run a single-page audit on a page with known contrast issues. Confirm `screenshots/<auditId>/<violationId>-0.png` etc. exist on disk and the audit completes (no checkbox needed).

- [ ] **Step 4: Commit**

```bash
git add lib/ada-audit/runner.ts
git commit -m "feat(ada): default screenshot capture on, derive dir, boundary catch"
```

---

## Task 3: Remove the capture checkbox + body field

**Files:**
- Modify: `app/api/ada-audit/route.ts`
- Modify: `components/ada-audit/AuditForm.tsx`

- [ ] **Step 1: API route — stop reading the flag**

In `app/api/ada-audit/route.ts`: delete `const captureScreenshots = raw?.captureScreenshots === true` (~line 107) and the conditional spread that passes `captureScreenshots`/`screenshotDir` into the run options (~lines 37-38). The runner now defaults capture on and derives the dir, so the route just calls `runAuditInBackground(audit.id, audit.url, wcagLevel)` — update that function's signature to drop the `captureScreenshots` param and its options spread.

- [ ] **Step 2: AuditForm — remove the checkbox**

In `components/ada-audit/AuditForm.tsx`: remove the `captureScreenshots` `useState` (~line 44), the checkbox JSX (~lines 170-185), and the `captureScreenshots` field in the POST body (~line 78).

- [ ] **Step 3: tsc + manual**

Run `npx tsc --noEmit`. Then `npm run dev`: the single-page form no longer shows the checkbox; running an audit still produces screenshots.

- [ ] **Step 4: Commit**

```bash
git add app/api/ada-audit/route.ts components/ada-audit/AuditForm.tsx
git commit -m "feat(ada): always-on screenshots, remove capture checkbox"
```

---

## Task 4: Retention sweeper

**Files:**
- Create: `lib/ada-audit/screenshot-sweeper.ts`
- Test: `lib/ada-audit/screenshot-sweeper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/ada-audit/screenshot-sweeper.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'

const findUnique = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { adaAudit: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))

let tmpRoot: string
vi.mock('./screenshot-helpers', async () => {
  const realPath = await import('path'); const realFs = (await import('fs')).promises
  return {
    get SCREENSHOTS_DIR() { return tmpRoot },
    SCREENSHOT_RETENTION_MS: 24 * 60 * 60 * 1000,
    deleteScreenshots: async (id: string) => { await realFs.rm(realPath.join(tmpRoot, id), { recursive: true, force: true }) },
  }
})

const { sweepExpiredScreenshots } = await import('./screenshot-sweeper')

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-'))
  findUnique.mockReset()
})

async function makeDir(id: string) { await fs.mkdir(path.join(tmpRoot, id)); await fs.writeFile(path.join(tmpRoot, id, 'a.png'), 'x') }
const old = new Date(Date.now() - 48 * 3600_000)
const recent = new Date(Date.now() - 1 * 3600_000)

describe('sweepExpiredScreenshots', () => {
  it('keeps recent completed, deletes old completed, deletes orphan, keeps in-flight', async () => {
    await makeDir('recent'); await makeDir('oldc'); await makeDir('orphan'); await makeDir('running')
    findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) => {
      if (id === 'recent') return Promise.resolve({ completedAt: recent, status: 'complete', createdAt: recent })
      if (id === 'oldc') return Promise.resolve({ completedAt: old, status: 'complete', createdAt: old })
      if (id === 'orphan') return Promise.resolve(null)
      if (id === 'running') return Promise.resolve({ completedAt: null, status: 'running', createdAt: recent })
      return Promise.resolve(null)
    })
    const res = await sweepExpiredScreenshots()
    const left = (await fs.readdir(tmpRoot)).sort()
    expect(left).toEqual(['recent', 'running'])
    expect(res.deleted).toBe(2)
  })

  it('deletes terminal row with null completedAt older than cutoff (fallback)', async () => {
    await makeDir('zombie')
    findUnique.mockResolvedValue({ completedAt: null, status: 'error', createdAt: old })
    await sweepExpiredScreenshots()
    expect(await fs.readdir(tmpRoot)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ada-audit/screenshot-sweeper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sweeper**

```ts
// lib/ada-audit/screenshot-sweeper.ts
import { promises as fs } from 'fs'
import { prisma } from '@/lib/db'
import { SCREENSHOTS_DIR, SCREENSHOT_RETENTION_MS, deleteScreenshots } from './screenshot-helpers'

const SWEEP_INTERVAL_MS = 30 * 60 * 1000
let intervalHandle: NodeJS.Timeout | null = null

export async function sweepExpiredScreenshots(): Promise<{ checked: number; deleted: number }> {
  let entries: string[]
  try {
    entries = await fs.readdir(SCREENSHOTS_DIR)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { checked: 0, deleted: 0 }
    throw err
  }

  const cutoff = Date.now() - SCREENSHOT_RETENTION_MS
  let deleted = 0
  for (const auditId of entries) {
    const audit = await prisma.adaAudit.findUnique({
      where: { id: auditId },
      select: { completedAt: true, status: true, createdAt: true },
    })
    const shouldDelete = (() => {
      if (!audit) return true
      if (audit.completedAt && audit.completedAt.getTime() < cutoff) return true
      const terminal = audit.status === 'complete' || audit.status === 'error' || audit.status === 'redirected'
      if (terminal && !audit.completedAt && audit.createdAt.getTime() < cutoff) return true
      return false
    })()
    if (shouldDelete) {
      try { await deleteScreenshots(auditId); deleted++ }
      catch (err) { console.warn(`[screenshot-sweeper] failed to delete ${auditId}:`, err) }
    }
  }
  return { checked: entries.length, deleted }
}

export function startScreenshotSweeper(): void {
  if (intervalHandle) return
  void sweepExpiredScreenshots().catch((err) => console.warn('[screenshot-sweeper] startup sweep failed:', err))
  intervalHandle = setInterval(() => {
    void sweepExpiredScreenshots().catch((err) => console.warn('[screenshot-sweeper] interval sweep failed:', err))
  }, SWEEP_INTERVAL_MS)
  intervalHandle.unref?.()
}

export function stopScreenshotSweeper(): void {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ada-audit/screenshot-sweeper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ada-audit/screenshot-sweeper.ts lib/ada-audit/screenshot-sweeper.test.ts
git commit -m "feat(ada): add 24h screenshot retention sweeper"
```

---

## Task 5: Wire the sweeper into instrumentation.ts

**Files:**
- Modify: `instrumentation.ts`

- [ ] **Step 1: Start the sweeper after the stale-check interval**

After line 84 (`const staleCheckInterval = setInterval(...)`):

```ts
    // Delete screenshot dirs older than 24h after their audit completed.
    const { startScreenshotSweeper, stopScreenshotSweeper } = await import('@/lib/ada-audit/screenshot-sweeper')
    startScreenshotSweeper()
```

- [ ] **Step 2: Stop it on shutdown**

Inside `shutdown()`, before `await closeBrowser()`:

```ts
      stopScreenshotSweeper()
```

(`stopScreenshotSweeper` is in scope because the dynamic import is in the same `register()` body.)

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add instrumentation.ts
git commit -m "feat(ada): start/stop screenshot sweeper in instrumentation"
```

---

## Task 6: Screenshot route cache header

**Files:**
- Modify: `app/api/ada-audit/screenshots/[auditId]/[filename]/route.ts`

- [ ] **Step 1: Lower the cache TTL**

Change line 27 from:

```ts
'Cache-Control': 'public, max-age=31536000, immutable',
```

to:

```ts
'Cache-Control': 'private, max-age=3600',
```

- [ ] **Step 2: Manual check**

Run `npm run dev`. Load an audit issue card with screenshots (response header now `private, max-age=3600`). Delete the screenshot dir on disk, reload — the `<img>` now 404s (rather than serving a year-cached copy), which lets `onError` hide it. Confirm in Network tab.

- [ ] **Step 3: Commit**

```bash
git add "app/api/ada-audit/screenshots/[auditId]/[filename]/route.ts"
git commit -m "fix(ada): shorten screenshot cache TTL so 24h expiry is observable"
```

---

## Task 7: Per-node thumbnail grid in AuditIssueCard

**Files:**
- Modify: `components/ada-audit/AuditIssueCard.tsx`

- [ ] **Step 1: Replace the single-screenshot block with a node grid**

Find the existing block (~lines 180-195, gated on `showDev && violation.screenshotPath && auditId`). Replace with:

```tsx
{showDev && auditId && (
  <div className="grid grid-cols-2 gap-2 mt-2 md:grid-cols-3">
    {violation.nodes.map((node, i) => {
      const file = node.screenshotPath ?? (i === 0 ? violation.screenshotPath : undefined)
      if (!file) return null
      return (
        <img
          key={`${violation.id}-${i}`}
          src={`/api/ada-audit/screenshots/${auditId}/${file}`}
          alt={`Element ${i + 1} for ${violation.help}`}
          className="rounded border border-gray-200 dark:border-navy-border max-w-full h-auto"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )
    })}
  </div>
)}
```

- [ ] **Step 2: tsc + manual**

Run `npx tsc --noEmit`. Then `npm run dev`: open an audit with multiple failing nodes per violation and `showDev` enabled — confirm multiple thumbnails render in a grid. Legacy audit (only `violation.screenshotPath`) still shows one thumbnail. An expired/missing file hides silently (no broken-image icon).

- [ ] **Step 3: Commit**

```bash
git add components/ada-audit/AuditIssueCard.tsx
git commit -m "feat(ada): render per-node screenshot grid with silent expiry hide"
```

---

## Task 8: Site-audit capture verification + full build

**Files:** none new (verification task).

- [ ] **Step 1: Confirm site audits capture without code change**

The site-audit call at `lib/ada-audit/queue-manager.ts:81` passes `{ auditId: child.id, siteAudit: detachPsi }`. With the runner default-on (Task 2), capture now fires and the dir derives from `child.id`. Run a small site audit (`npm run dev`, 2-3 page domain) and confirm `screenshots/<childId>/...png` appear for multiple child pages.

- [ ] **Step 2: PSI detached path (optional, if pagespeed configured)**

With `LIGHTHOUSE_PROVIDER=pagespeed`, run a site audit. Confirm a child sits at `axe-complete` with screenshots present, then flips to `complete` with `completedAt` after PSI. Confirm the sweeper does NOT delete its dir while `axe-complete` (not in the terminal set).

- [ ] **Step 3: Disk-full / unwritable simulation**

Temporarily point `SCREENSHOTS_DIR` at an unwritable path (env var) and run a page audit. Confirm the audit still completes with results (capture phase logs a warning, doesn't throw).

- [ ] **Step 4: Perf sanity**

Run an audit on a violation-heavy page and note wall-clock for the capture phase (progress message "Capturing element screenshots…"). If it adds material time to site audits, note it for Kevin — the per-page cap (50) is the tuning knob.

- [ ] **Step 5: Full suite + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all pass / build succeeds.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "chore(ada): verify site-audit screenshot capture + build"
```

---

## Self-Review Notes

- **Spec coverage:** per-node capture + 50 cap (T1), always-on + default-on runner + boundary catch + node flag (T2), checkbox removal (T3), sweeper with terminal-null fallback (T4), instrumentation wiring incl. SIGTERM stop (T5), cache-header fix (T6), per-node UI grid + silent hide (T7), site-audit capture + PSI path + disk-full + perf verification (T8).
- **Type consistency:** `AxeNode.screenshotPath` defined T1, consumed in runner flag calc (T2) and UI (T7). `MAX_SCREENSHOTS_PER_PAGE` / `SCREENSHOT_RETENTION_MS` defined T1, used T4. `deleteScreenshots` / `SCREENSHOTS_DIR` reused from existing helper.
- **Placeholder scan:** none.
- **No DB migration:** screenshot paths live in the existing `result` JSON blob; no schema change.
