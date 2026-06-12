// lib/report/report-file.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  reportsDir, reportPath, writeReportFile, deleteReportFile, reportFileExists,
} from './report-file'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'er-reports-'))
  vi.stubEnv('REPORTS_DIR', tmpDir)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('reportsDir', () => {
  it('reads REPORTS_DIR at call time', () => {
    expect(reportsDir()).toBe(tmpDir)
    vi.stubEnv('REPORTS_DIR', '/elsewhere')
    expect(reportsDir()).toBe('/elsewhere')
  })
  it('defaults to ./data/reports under cwd when unset', () => {
    vi.unstubAllEnvs()
    delete process.env.REPORTS_DIR
    expect(reportsDir()).toBe(path.join(process.cwd(), 'data', 'reports'))
  })
})

describe('reportPath', () => {
  it('rejects path-unsafe ids', () => {
    expect(() => reportPath('../escape')).toThrow('unsafe report id')
    expect(() => reportPath('a/b')).toThrow('unsafe report id')
    expect(() => reportPath('')).toThrow('unsafe report id')
    expect(() => reportPath('a b')).toThrow('unsafe report id')
  })
  it('accepts cuid-shaped ids', () => {
    expect(reportPath('clx_123-abc')).toBe(path.join(tmpDir, 'clx_123-abc.pdf'))
  })
})

describe('write / exists / delete', () => {
  it('writes atomically, reads back, leaves no .tmp behind', async () => {
    const buf = Buffer.from('%PDF-fake-content')
    await writeReportFile('audit1', buf)
    expect(await reportFileExists('audit1')).toBe(true)
    expect(await fs.readFile(path.join(tmpDir, 'audit1.pdf'))).toEqual(buf)
    const leftovers = (await fs.readdir(tmpDir)).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('overwrites on regeneration', async () => {
    await writeReportFile('audit2', Buffer.from('v1'))
    await writeReportFile('audit2', Buffer.from('v2'))
    expect((await fs.readFile(path.join(tmpDir, 'audit2.pdf'))).toString()).toBe('v2')
  })

  it('reportFileExists is false for missing files', async () => {
    expect(await reportFileExists('never-written')).toBe(false)
  })

  it('delete is idempotent (ENOENT swallowed, other errors propagate)', async () => {
    await writeReportFile('audit3', Buffer.from('x'))
    await deleteReportFile('audit3')
    expect(await reportFileExists('audit3')).toBe(false)
    await expect(deleteReportFile('audit3')).resolves.toBeUndefined()
  })

  it('write rejects unsafe ids before touching disk', async () => {
    await expect(writeReportFile('../x', Buffer.from('x'))).rejects.toThrow('unsafe report id')
    await expect(deleteReportFile('../x')).rejects.toThrow('unsafe report id')
  })
})
