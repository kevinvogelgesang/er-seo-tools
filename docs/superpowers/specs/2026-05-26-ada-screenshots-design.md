# ADA Audit Screenshots Overhaul — Design

**Date:** 2026-05-26
**Scope:** Item 6 of the ADA Updates batch — capture a screenshot for every axe node (not just one per violation), apply a 50-screenshot-per-page cap, retain artifacts for 24 hours after audit completion, sweep in the background. Always-on for both page and site audits.

## Goals

1. Replace "one screenshot per violation, max 15" with "one screenshot per node, max 50 per page".
2. Make capture always-on for both single-page and site audits. The opt-in checkbox is removed.
3. Auto-delete screenshots 24 hours after the audit's `completedAt`.
4. UI silently hides expired screenshots — no broken images, no banner.

## Non-goals

- No CDN, no S3, no off-box storage. Screenshots stay on local disk.
- No retention configurability per-user. One global setting.
- No retroactive re-capture for past audits.
- No screenshot-only re-run endpoint.
- No new permission gating — the existing `showDev` reveal still controls visibility in the issue card.

## Capture changes

### Constants and config

In `lib/ada-audit/screenshot-helpers.ts`:

```ts
export const MAX_SCREENSHOTS_PER_PAGE = 50  // was 15
export const SCREENSHOT_RETENTION_MS =
  Number(process.env.SCREENSHOT_RETENTION_HOURS ?? 24) * 60 * 60 * 1000
```

The per-page cap stays page-local — it does not span an entire site audit, because each page's audit row owns its own directory.

### Per-node capture

Today `captureViolationScreenshots()` walks violations and captures the first node of each. Change it to walk every node of every violation, stopping when the page-local counter reaches `MAX_SCREENSHOTS_PER_PAGE`:

```ts
for (const violation of violations) {
  for (let i = 0; i < violation.nodes.length; i++) {
    if (captured >= MAX_SCREENSHOTS_PER_PAGE) break outer
    const node = violation.nodes[i]
    if (!node?.target?.length) continue
    const selector = node.target[node.target.length - 1]
    // ...existing element-handle + parent-walk logic...
    const filename = `${violation.id}-${i}.png`
    // ...screenshot...
    node.screenshotPath = filename
    captured++
  }
}
```

Iteration order matches axe's: violation order is impact-ranked by axe, and node order within a violation is DOM order, so the cap deterministically drops nodes from the lowest-priority tail.

### Type changes

In `lib/ada-audit/types.ts`:

- Add `screenshotPath?: string` to `AxeNode`.
- Keep `screenshotPath?: string` on `AxeViolation` (deprecated but readable for back-compat — old audits in the DB still have it). Mark with a JSDoc note: "Deprecated as of 2026-05-26; new audits set it on AxeNode instead."

No DB schema migration — screenshot paths live inside the existing JSON `result` blob on `AdaAudit`.

### Runner glue

`lib/ada-audit/runner.ts` already accepts `captureScreenshots: boolean` and `screenshotDir: string`, but **capture only fires when BOTH are truthy** (`runner.ts:344`). "Just omitting the flag" would capture nothing. So always-on requires real default logic in the runner, not just API edits (Codex fix):

```ts
// runner.ts, replacing the line-344 guard
const shouldCapture = options?.captureScreenshots !== false  // default ON
const screenshotDir = options?.screenshotDir ?? path.join(SCREENSHOTS_DIR, options.auditId)
if (shouldCapture) {
  await progress(93, 'Capturing element screenshots…')
  try {
    await captureViolationScreenshots(page, axe.violations, screenshotDir)
  } catch (err) {
    console.warn('[ada-audit/screenshots] capture phase failed, continuing:', err)
  }
  axe.captureScreenshots = axe.violations.some(
    v => v.nodes.some(n => n.screenshotPath != null) || v.screenshotPath != null
  )
}
```

Three fixes baked in here:
1. **Default ON** (`!== false`) so both page and site audits capture without a flag.
2. **`screenshotDir` defaulted** from `auditId` so callers don't have to pass it.
3. **Boundary try/catch** around the whole capture phase — see "disk-full handling" below. Today `captureViolationScreenshots` is `await`ed at `runner.ts:346` with no boundary catch, and its internal `fs.mkdir` (`screenshot-helpers.ts:23`) is *outside* the per-element try, so an mkdir failure (disk full / unwritable) would currently bubble up and fail the whole audit.
4. **Flag calc updated** to check `node.screenshotPath` (paths now live on nodes), keeping the legacy `violation.screenshotPath` check for old audits.

Callers:
- The single-page API route (`app/api/ada-audit/route.ts`) stops reading `captureScreenshots` from the request body entirely. It passes only `{ auditId, ... }`; the runner default does the rest. Any leftover field from an old client is ignored.
- The site audit code path (`lib/ada-audit/queue-manager.ts:81`) needs **no change** once the runner defaults are in place — it already passes `{ auditId: child.id, siteAudit: detachPsi }`, and capture now defaults on with a derived dir. (Optionally pass `screenshotDir` explicitly for clarity; not required.)

### Form change

In `components/ada-audit/AuditForm.tsx`, delete the "Capture element screenshots" checkbox and its `useState`. The form still submits `wcagLevel` etc., just not the capture flag. The API route ignores any leftover `captureScreenshots` field if posted by an old client.

## Retention sweeper

### New file: `lib/ada-audit/screenshot-sweeper.ts`

```ts
import { promises as fs } from 'fs'
import path from 'path'
import { prisma } from '@/lib/db'
import { SCREENSHOTS_DIR, SCREENSHOT_RETENTION_MS, deleteScreenshots } from './screenshot-helpers'

const SWEEP_INTERVAL_MS = 30 * 60 * 1000  // 30 min

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

  for (const dir of entries) {
    const auditId = dir  // directories are named by AdaAudit.id
    const audit = await prisma.adaAudit.findUnique({
      where: { id: auditId },
      select: { completedAt: true, status: true, createdAt: true },
    })

    // Delete if:
    //  - audit row is missing (orphaned dir), OR
    //  - audit has completedAt and it's older than the cutoff, OR
    //  - audit errored more than retention ago (use createdAt fallback)
    const shouldDelete = (() => {
      if (!audit) return true  // orphan dir — audit row gone
      if (audit.completedAt && audit.completedAt.getTime() < cutoff) return true
      // Fallback (Codex fix): terminal row that somehow never got completedAt
      // (old/malformed row, or a future lifecycle bug) — fall back to createdAt
      // so its screenshots can't leak forever.
      const terminal = audit.status === 'complete' || audit.status === 'error' || audit.status === 'redirected'
      if (terminal && !audit.completedAt && audit.createdAt.getTime() < cutoff) return true
      return false
    })()

    if (shouldDelete) {
      try {
        await deleteScreenshots(auditId)
        deleted++
      } catch (err) {
        console.warn(`[screenshot-sweeper] failed to delete ${auditId}:`, err)
      }
    }
  }

  return { checked: entries.length, deleted }
}

export function startScreenshotSweeper(): void {
  if (intervalHandle) return
  // Run once at startup, then on an interval.
  void sweepExpiredScreenshots().catch(err =>
    console.warn('[screenshot-sweeper] startup sweep failed:', err)
  )
  intervalHandle = setInterval(() => {
    void sweepExpiredScreenshots().catch(err =>
      console.warn('[screenshot-sweeper] interval sweep failed:', err)
    )
  }, SWEEP_INTERVAL_MS)
  intervalHandle.unref?.()  // don't block process exit
}

export function stopScreenshotSweeper(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
```

### Wiring in `instrumentation.ts`

`instrumentation.ts` already starts queue recovery and the stale-audit watchdog. Add:

```ts
import { startScreenshotSweeper, stopScreenshotSweeper } from '@/lib/ada-audit/screenshot-sweeper'
// ...in the existing register() body for the Node runtime:
startScreenshotSweeper()
// ...in the existing SIGTERM handler, before closeBrowser():
stopScreenshotSweeper()
```

This pattern matches `resetStaleAudits` setup already there.

## UI changes

### `components/ada-audit/AuditIssueCard.tsx`

Replace the single violation-level screenshot block with a per-node grid:

```tsx
{showDev && auditId && (
  <div className="grid grid-cols-2 gap-2 mt-2 md:grid-cols-3">
    {violation.nodes.map((node, i) => {
      const path = node.screenshotPath ?? (i === 0 ? violation.screenshotPath : undefined)
      if (!path) return null
      return (
        <img
          key={`${violation.id}-${i}`}
          src={`/api/ada-audit/screenshots/${auditId}/${path}`}
          alt={`Element ${i + 1} for ${violation.help}`}
          className="rounded border border-gray-200 dark:border-navy-border max-w-full h-auto"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )
    })}
  </div>
)}
```

The `(i === 0 ? violation.screenshotPath : undefined)` fallback keeps legacy audits (which only have `violation.screenshotPath`) rendering one thumbnail under the new component. After 24h retention sweeps complete on old data, this fallback is effectively dead code but cheap to keep.

`onError` is the silent-hide path for expired files.

### Screenshot route cache header (critical — Codex finding)

`app/api/ada-audit/screenshots/[auditId]/[filename]/route.ts:27` currently sends `Cache-Control: public, max-age=31536000, immutable`. Once a browser caches a screenshot it serves the cached copy for a year — so after the sweeper deletes the file, the request never reaches the server, the 404 never happens, `onError` never fires, and the "silently hide expired" behavior **breaks** (the user keeps seeing a stale image, or a broken one that doesn't trigger `onError`).

Change to `Cache-Control: private, max-age=3600` (1 hour). Short enough that, well within the 24h retention window, an expired file yields a real 404 → `onError` → hidden. `private` because these are internal audit artifacts, not public assets. The route still returns 404 when the file is missing — no other change.

## Storage math (reproduced for record)

- Element screenshot avg ~80 KB (PNG of a typical card-sized DOM block, parent of the failing node).
- Page worst case: 50 × 80 KB = **4 MB**.
- Site audit worst case (1000-page cap): 1000 × 4 MB = **4 GB**.
- Typical site audit (200 pages, ~30 captures per page): 200 × 2.4 MB = **480 MB**.
- Server: 65 GB free, 3.8 GB RAM, 2 cores.
- Day with 4 site audits, mixed sizes, 24h retention: ~3–8 GB peak. Well within budget.

## Failure modes

- **Disk full mid-audit:** screenshot write throws, `captureViolationScreenshots` catches and warns; axe results still complete and persist. Acceptable: the audit doesn't fail, the screenshots just stop. Future enhancement (out of scope): emit a per-audit warning flag.
- **Sweeper crash:** the `try/catch` per directory means one bad delete doesn't halt the sweep. The next tick retries.
- **Sweeper races with active audit:** the screenshot dir for a running audit has no `completedAt`, so `shouldDelete` returns false. Safe.
- **`completedAt` null on terminal audit:** handled by the `shouldDelete` fallback (terminal status + `createdAt` older than cutoff). No leak.
- **Detached PageSpeed children (verified against code):** in the `pagespeed` provider path, a site-audit child row is left at `status: 'axe-complete'` with **no `completedAt`** (`queue-manager.ts:134`) while the detached PSI job drains. `lib/ada-audit/lighthouse-queue.ts:80` later flips it to `complete` and sets `completedAt`; startup/stale recovery also marks orphan `axe-complete` rows terminal with `completedAt`. So screenshots for these children are retained until 24h after PSI settles — correct, not leaked. The sweeper's fallback rule does **not** match `axe-complete` (it's not in the terminal set), so an in-flight PSI child is never swept early.
- **Orphan directories** (e.g., audit row deleted but dir remains): swept on first tick. The `!audit` branch handles them.
- **Coexistence with existing cleanup:** `lib/cleanup.ts:150` already deletes audit artifacts on a 180-day horizon. The new 24h sweeper is stricter and runs independently; both use `fs.rm(..., { force: true })` so double-deletes are safe no-ops. No conflict.

## Testing

- **Unit:** `sweepExpiredScreenshots` against a temp directory and a mocked Prisma client — exercises (a) recent completed audit kept, (b) old completed audit deleted, (c) orphan dir deleted, (d) errored audit kept, (e) ENOENT root dir returns `{ 0, 0 }`.
- **Unit:** `captureViolationScreenshots` with synthetic violations — verifies (a) cap at 50, (b) one file per node, (c) skips nodes without targets, (d) writes paths onto `node.screenshotPath`.
- **Manual:** run a page audit; confirm `screenshots/<id>/<violationId>-0.png`, `…-1.png`, etc. Open the issue card; verify the grid renders. Wait or fake `completedAt` to past cutoff; trigger the sweeper; confirm files gone and UI hides silently — **including for an already-viewed (cached) screenshot**, which validates the cache-header fix.
- **Manual (perf):** run a representative heavy site page and benchmark wall-clock for 50 sequential `ElementHandle.screenshot()` calls (Codex flagged CPU/latency, not memory, as the concern). If it adds material time to already-slow site audits, consider lowering the per-page cap. Peak memory is per-shot, not cumulative, so the 3.8GB box is not the bottleneck.
- **Manual (PSI path):** with `LIGHTHOUSE_PROVIDER=pagespeed`, run a site audit; confirm a child sits at `axe-complete` with screenshots present, then flips to `complete` with `completedAt` after PSI, and is swept only 24h after that.

## Risks and trade-offs

- **Per-page cap of 50** can drop low-impact node shots on extremely violation-heavy pages. We accept it; the 50th element is already deep in the tail.
- **JSDOM legacy audits** (`runnerType: 'jsdom'`) never capture — unchanged. Browser runner is the only path that calls `captureViolationScreenshots`.
- **No size-based eviction.** A single 4 GB site audit holding for 24 h is allowed. If we ever push concurrent large audits, we may need a size-aware policy. Documented but not built.
- **Sweeper runs even when no audits exist** — `fs.readdir` on an empty dir is microseconds; acceptable.

## Spec self-review

- Placeholders: none.
- Internal consistency: capture path, type changes, UI consumption, and sweep logic all reference the same filename pattern `${violationId}-${nodeIndex}.png` and the same `SCREENSHOTS_DIR / <auditId> /` layout.
- Scope: no DB schema change, no API contract change beyond removing one ignored request field.
- Ambiguity: "every element" → axe nodes after the existing 20-per-violation truncation, capped at 50 per page. Stated explicitly.
