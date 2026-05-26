import path from 'path'
import { promises as fs } from 'fs'
import type { ElementHandle, Page } from 'puppeteer-core'
import type { AxeViolation } from './types'

/** Where violation screenshots are stored. One subdirectory per audit ID. */
export const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || path.join(process.cwd(), 'screenshots')

/** Max screenshots to capture per page to bound execution time */
export const MAX_SCREENSHOTS_PER_PAGE = 50

/** How long (ms) to retain screenshot files before the sweeper deletes them */
export const SCREENSHOT_RETENTION_MS =
  (Number(process.env.SCREENSHOT_RETENTION_HOURS) || 24) * 60 * 60 * 1000

/**
 * Capture a PNG screenshot of each failing node for every violation.
 * Mutates each node's `screenshotPath` in-place. Silently skips failures.
 * Capped at MAX_SCREENSHOTS_PER_PAGE total across all violations.
 */
export async function captureViolationScreenshots(
  page: Page,
  violations: AxeViolation[],
  dir: string,
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
          // Walk up to parent for context; fall back to element itself if no parent
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

/** Delete the screenshot directory for a given audit ID. No-op if it doesn't exist. */
export async function deleteScreenshots(auditId: string): Promise<void> {
  await fs.rm(path.join(SCREENSHOTS_DIR, auditId), { recursive: true, force: true })
}

function logCleanupFailures(context: string, results: PromiseSettledResult<void>[]): void {
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`${context}:`, result.reason)
    }
  }
}

/**
 * Delete every on-disk artifact associated with an AdaAudit.
 * Keep this all-settled so future artifact types can fail independently.
 */
export async function deleteAuditArtifacts(auditId: string): Promise<PromiseSettledResult<void>[]> {
  const results = await Promise.allSettled([
    deleteScreenshots(auditId),
  ])
  logCleanupFailures(`[ada-audit/artifacts] Failed to clean artifacts for audit ${auditId}`, results)
  return results
}
