// lib/report/seo/seo-report-file.ts — SEO performance report PDF storage.
// Mirrors lib/report/report-file.ts; uses a distinct filename prefix
// (`seo-report-<id>.pdf`) so SEO report ids never collide with ADA report ids.
import { promises as fs } from 'fs'
import path from 'path'

function reportsDir(): string {
  return process.env.REPORTS_DIR || path.join(process.cwd(), 'data', 'reports')
}

/** Validates id against ^[A-Za-z0-9_-]+$ to prevent path traversal. */
function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`unsafe seo report id: ${id}`)
}

export function seoReportPath(id: string): string {
  assertSafeId(id)
  return path.join(reportsDir(), `seo-report-${id}.pdf`)
}

export async function writeSeoReportFile(id: string, buf: Buffer): Promise<void> {
  const dest = seoReportPath(id)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp`
  await fs.writeFile(tmp, buf)
  await fs.rename(tmp, dest)
}

export async function deleteSeoReportFile(id: string): Promise<void> {
  await fs.unlink(seoReportPath(id)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err
  })
}

export async function seoReportFileExists(id: string): Promise<boolean> {
  return fs.access(seoReportPath(id)).then(() => true, () => false)
}
