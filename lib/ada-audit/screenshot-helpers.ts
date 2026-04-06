import path from 'path'
import { promises as fs } from 'fs'
import type { ElementHandle, Page } from 'puppeteer-core'
import type { AxeViolation } from './types'

/** Where violation screenshots are stored. One subdirectory per audit ID. */
export const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || path.join(process.cwd(), 'screenshots')

/** Max screenshots to capture per audit to bound execution time */
const MAX_SCREENSHOTS = 15

/**
 * Capture a PNG screenshot of the first findable failing element for each violation.
 * Mutates each violation's `screenshotPath` in-place. Silently skips failures.
 */
export async function captureViolationScreenshots(
  page: Page,
  violations: AxeViolation[],
  dir: string,
): Promise<void> {
  if (violations.length === 0) return

  await fs.mkdir(dir, { recursive: true })

  let captured = 0
  for (const violation of violations) {
    if (captured >= MAX_SCREENSHOTS) {
      console.warn(`[ada-audit/screenshots] Reached cap of ${MAX_SCREENSHOTS} screenshots, skipping remaining violations`)
      break
    }

    const node = violation.nodes[0]
    if (!node?.target?.length) {
      console.warn(`[ada-audit/screenshots] No target selector for violation "${violation.id}", skipping`)
      continue
    }

    // Use the last (most specific) CSS selector from axe's target path
    const selector = node.target[node.target.length - 1]

    try {
      const handle = await page.$(selector)
      if (!handle) {
        console.warn(`[ada-audit/screenshots] Element not found for violation "${violation.id}" (selector: ${selector}), skipping`)
        continue
      }

      try {
        const filename = `${violation.id}.png`

        // Walk up to parent for context; fall back to element itself if no parent
        const screenshotTarget = await page.evaluateHandle(
          (el) => el.parentElement ?? el,
          handle
        )

        try {
          await (screenshotTarget as ElementHandle).screenshot({ path: path.join(dir, filename), type: 'png' })
          violation.screenshotPath = filename
          captured++
        } finally {
          await screenshotTarget.dispose()
        }
      } catch (err) {
        console.warn(`[ada-audit/screenshots] Failed to capture screenshot for violation "${violation.id}":`, err)
      } finally {
        await handle.dispose()
      }
    } catch (err) {
      console.warn(`[ada-audit/screenshots] Failed to find element for violation "${violation.id}":`, err)
    }
  }
}

/** Delete the screenshot directory for a given audit ID. No-op if it doesn't exist. */
export async function deleteScreenshots(auditId: string): Promise<void> {
  await fs.rm(path.join(SCREENSHOTS_DIR, auditId), { recursive: true, force: true }).catch(() => {})
}
