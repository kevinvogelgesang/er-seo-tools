// lib/report/report-file.ts — one PDF per site audit under REPORTS_DIR.
import { promises as fs } from 'fs'
import path from 'path'

export function reportsDir(): string {
  return process.env.REPORTS_DIR || path.join(process.cwd(), 'data', 'reports')
}

/** ids are cuids; reject anything path-unsafe defensively. */
function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`unsafe report id: ${id}`)
}

export function reportPath(siteAuditId: string): string {
  assertSafeId(siteAuditId)
  return path.join(reportsDir(), `${siteAuditId}.pdf`)
}

export async function writeReportFile(siteAuditId: string, buf: Buffer): Promise<void> {
  const dest = reportPath(siteAuditId)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp`
  await fs.writeFile(tmp, buf)
  await fs.rename(tmp, dest)
}

export async function deleteReportFile(siteAuditId: string): Promise<void> {
  await fs.unlink(reportPath(siteAuditId)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err
  })
}

export async function reportFileExists(siteAuditId: string): Promise<boolean> {
  return fs.access(reportPath(siteAuditId)).then(() => true, () => false)
}
