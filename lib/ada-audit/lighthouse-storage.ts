// lib/ada-audit/lighthouse-storage.ts
import { promises as fs } from 'fs'
import path from 'path'
import zlib from 'zlib'
import { promisify } from 'util'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

export const LIGHTHOUSE_REPORTS_DIR =
  process.env.LIGHTHOUSE_REPORTS_DIR
  ?? path.join(process.cwd(), 'lighthouse-reports')

function reportPath(auditId: string): string {
  return path.join(LIGHTHOUSE_REPORTS_DIR, `${auditId}.json.gz`)
}

/** Write a Lighthouse report as gzipped JSON. Creates the directory if needed. */
export async function writeLighthouseReport(
  auditId: string,
  report: unknown,
): Promise<void> {
  await fs.mkdir(LIGHTHOUSE_REPORTS_DIR, { recursive: true })
  const compressed = await gzip(Buffer.from(JSON.stringify(report)))
  await fs.writeFile(reportPath(auditId), compressed)
}

/** Read and gunzip a stored Lighthouse report. Returns null if not present. */
export async function readLighthouseReport(auditId: string): Promise<unknown | null> {
  try {
    const buf = await fs.readFile(reportPath(auditId))
    const json = await gunzip(buf)
    return JSON.parse(json.toString('utf-8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

/** Delete the stored gzipped report for an audit. No-op if absent. */
export async function deleteLighthouseReport(auditId: string): Promise<void> {
  await fs.rm(reportPath(auditId), { force: true }).catch(() => {})
}
