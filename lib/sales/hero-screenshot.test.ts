// lib/sales/hero-screenshot.test.ts — path building, atomic write, tolerant delete.
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  deleteHeroScreenshot,
  heroScreenshotFilename,
  heroScreenshotPath,
  heroScreenshotsDir,
  writeHeroScreenshot,
} from './hero-screenshot'

let dir: string
const prevEnv = process.env.HERO_SCREENSHOTS_DIR

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-shot-'))
  process.env.HERO_SCREENSHOTS_DIR = dir
})
afterAll(async () => {
  if (prevEnv === undefined) delete process.env.HERO_SCREENSHOTS_DIR
  else process.env.HERO_SCREENSHOTS_DIR = prevEnv
  await fs.rm(dir, { recursive: true, force: true })
})

describe('hero-screenshot', () => {
  it('builds paths under HERO_SCREENSHOTS_DIR from the audit id', () => {
    expect(heroScreenshotsDir()).toBe(dir)
    expect(heroScreenshotFilename('abc123')).toBe('abc123.png')
    expect(heroScreenshotPath('abc123')).toBe(path.join(dir, 'abc123.png'))
  })

  it('rejects path-unsafe ids', () => {
    expect(() => heroScreenshotPath('../etc')).toThrow(/unsafe/)
    expect(() => heroScreenshotPath('a/b')).toThrow(/unsafe/)
  })

  it('writes atomically (final file exists, no .tmp left behind)', async () => {
    await writeHeroScreenshot('cuid1', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const buf = await fs.readFile(heroScreenshotPath('cuid1'))
    expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    const entries = await fs.readdir(dir)
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
  })

  it('delete removes the file and tolerates a missing file', async () => {
    await writeHeroScreenshot('cuid2', new Uint8Array([1]))
    await deleteHeroScreenshot('cuid2')
    await expect(fs.access(heroScreenshotPath('cuid2'))).rejects.toThrow()
    await expect(deleteHeroScreenshot('cuid2')).resolves.toBeUndefined() // ENOENT swallowed
  })

  it('concurrent writes to the same id do not collide (unique temp names)', async () => {
    await Promise.all([
      writeHeroScreenshot('cuid3', new Uint8Array([1])),
      writeHeroScreenshot('cuid3', new Uint8Array([2])),
    ])
    const buf = await fs.readFile(heroScreenshotPath('cuid3'))
    expect([1, 2]).toContain(buf[0]) // one of the two writes won, atomically
    const entries = await fs.readdir(dir)
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
  })
})
