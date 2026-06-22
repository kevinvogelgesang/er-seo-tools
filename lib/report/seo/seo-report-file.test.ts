// lib/report/seo/seo-report-file.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  seoReportPath,
  writeSeoReportFile,
  deleteSeoReportFile,
  seoReportFileExists,
} from './seo-report-file'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'er-seo-reports-'))
  vi.stubEnv('REPORTS_DIR', tmpDir)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('seoReportPath', () => {
  it('rejects empty id', () => {
    expect(() => seoReportPath('')).toThrow('unsafe seo report id')
  })
  it('rejects path-traversal ids', () => {
    expect(() => seoReportPath('../../etc')).toThrow('unsafe seo report id')
    expect(() => seoReportPath('..')).toThrow('unsafe seo report id')
    expect(() => seoReportPath('a/b')).toThrow('unsafe seo report id')
    expect(() => seoReportPath('a b')).toThrow('unsafe seo report id')
  })
  it('accepts cuid-shaped ids and produces seo-report-<id>.pdf', () => {
    const result = seoReportPath('clx_123-abc')
    expect(result).toBe(path.join(tmpDir, 'seo-report-clx_123-abc.pdf'))
  })
  it('uses distinct filename prefix from C4 reports', () => {
    // must start with seo-report-, not just <id>.pdf
    expect(path.basename(seoReportPath('abc123'))).toBe('seo-report-abc123.pdf')
  })
})

describe('write / exists / delete round trip', () => {
  it('writes atomically, exists returns true, delete removes, exists returns false', async () => {
    const buf = Buffer.from('%PDF-fake-seo-content')
    await writeSeoReportFile('seoaudit1', buf)
    expect(await seoReportFileExists('seoaudit1')).toBe(true)
    const written = await fs.readFile(path.join(tmpDir, 'seo-report-seoaudit1.pdf'))
    expect(written).toEqual(buf)
    // no .tmp files left
    const leftovers = (await fs.readdir(tmpDir)).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
    // delete
    await deleteSeoReportFile('seoaudit1')
    expect(await seoReportFileExists('seoaudit1')).toBe(false)
  })

  it('overwrites on regeneration', async () => {
    await writeSeoReportFile('seoaudit2', Buffer.from('v1'))
    await writeSeoReportFile('seoaudit2', Buffer.from('v2'))
    const content = (await fs.readFile(path.join(tmpDir, 'seo-report-seoaudit2.pdf'))).toString()
    expect(content).toBe('v2')
  })

  it('seoReportFileExists is false for missing files', async () => {
    expect(await seoReportFileExists('never-written')).toBe(false)
  })

  it('delete is ENOENT-tolerant (idempotent)', async () => {
    await writeSeoReportFile('seoaudit3', Buffer.from('x'))
    await deleteSeoReportFile('seoaudit3')
    // second delete must not throw
    await expect(deleteSeoReportFile('seoaudit3')).resolves.toBeUndefined()
  })

  it('write and delete reject unsafe ids before touching disk', async () => {
    await expect(writeSeoReportFile('../x', Buffer.from('x'))).rejects.toThrow('unsafe seo report id')
    await expect(deleteSeoReportFile('../x')).rejects.toThrow('unsafe seo report id')
  })

  it('malicious ids cannot escape tmpDir', () => {
    const malicious = ['../../etc', '..', 'a/b', 'foo/../bar', '']
    for (const id of malicious) {
      expect(() => seoReportPath(id)).toThrow('unsafe seo report id')
    }
  })
})
