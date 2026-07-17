import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import {
  saveViewbookAsset,
  readViewbookAsset,
  deleteViewbookAssets,
  saveViewbookDoc,
  sniffPdfType,
  sniffImageType,
  validateAssetScope,
} from './assets'
import { HttpError } from '@/lib/api/errors'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vb-assets-'))
  process.env.VIEWBOOK_ASSETS_DIR = dir
})
afterEach(async () => {
  delete process.env.VIEWBOOK_ASSETS_DIR
  await rm(dir, { recursive: true, force: true })
})

describe('viewbook asset store', () => {
  it('sniffs png/jpeg/webp and rejects svg/unknown', () => {
    expect(sniffImageType(PNG)).toBe('png')
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffImageType(Buffer.from('RIFF0000WEBPVP8 '))).toBe('webp')
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
    expect(sniffImageType(Buffer.alloc(2))).toBeNull()
  })

  it('strictly sniffs PDF magic bytes', () => {
    expect(sniffPdfType(Buffer.from('%PDF-1.7\nbody'))).toBe('pdf')
    expect(sniffPdfType(Buffer.from(' %PDF-1.7'))).toBeNull()
    expect(sniffPdfType(Buffer.from('%PDF'))).toBeNull()
    expect(sniffPdfType(PNG)).toBeNull()
  })

  it('validates scopes as global or positive int strings', () => {
    expect(validateAssetScope('global')).toBe(true)
    expect(validateAssetScope('12')).toBe(true)
    expect(validateAssetScope('0')).toBe(false)
    expect(validateAssetScope('')).toBe(false)
    expect(validateAssetScope('../x')).toBe(false)
    expect(validateAssetScope('12/13')).toBe(false)
  })

  it('save → read roundtrip with server-generated filename', async () => {
    const { filename, mime } = await saveViewbookAsset('7', PNG)
    expect(filename).toMatch(/^[a-z0-9-]+\.png$/)
    expect(mime).toBe('image/png')
    const back = await readViewbookAsset('7', filename)
    expect(back?.buf.equals(PNG)).toBe(true)
    expect(back?.mime).toBe('image/png')
  })

  it('saves, reads, and deletes server-generated PDF documents', async () => {
    const pdf = Buffer.from('%PDF-1.7\ntest document')
    const { filename, mime } = await saveViewbookDoc('global', pdf)
    expect(filename).toMatch(/^[a-z0-9-]+\.pdf$/)
    expect(mime).toBe('application/pdf')
    const back = await readViewbookAsset('global', filename)
    expect(back?.buf.equals(pdf)).toBe(true)
    expect(back?.mime).toBe('application/pdf')
    await deleteViewbookAssets('global', [filename])
    expect(await readViewbookAsset('global', filename)).toBeNull()
  })

  it('rejects oversize, non-image, and bad scopes', async () => {
    await expect(saveViewbookAsset('7', Buffer.alloc(2_097_153))).rejects.toBeInstanceOf(HttpError)
    await expect(saveViewbookAsset('7', Buffer.from('hello world plain text'))).rejects.toBeInstanceOf(HttpError)
    await expect(saveViewbookAsset('../evil', PNG)).rejects.toBeInstanceOf(HttpError)
  })

  it('read tolerates ENOENT and rejects traversal-shaped names without touching fs', async () => {
    expect(await readViewbookAsset('7', 'missing.png')).toBeNull()
    expect(await readViewbookAsset('7', '..%2fescape.png')).toBeNull()
    expect(await readViewbookAsset('7', '../escape.png')).toBeNull()
    expect(await readViewbookAsset('bad scope', 'a.png')).toBeNull()
  })

  it('read rethrows non-ENOENT fs errors via injected deps', async () => {
    const eacces = Object.assign(new Error('denied'), { code: 'EACCES' })
    await expect(
      readViewbookAsset('7', 'ok-name.png', { readFile: async () => { throw eacces } }),
    ).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('delete is best-effort: ENOENT silent, other errors swallowed, bad names skipped', async () => {
    const { filename } = await saveViewbookAsset('7', PNG)
    await expect(deleteViewbookAssets('7', ['missing.png', '../escape.png', filename])).resolves.toBeUndefined()
    expect(await readViewbookAsset('7', filename)).toBeNull()
  })
})
