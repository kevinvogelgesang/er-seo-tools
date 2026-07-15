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
