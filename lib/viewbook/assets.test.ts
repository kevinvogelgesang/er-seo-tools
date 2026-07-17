import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import sharp from 'sharp'
import {
  saveViewbookAsset,
  readViewbookAsset,
  deleteViewbookAssets,
  saveViewbookDoc,
  sniffPdfType,
  sniffImageType,
  validateAssetScope,
  MAX_ASSET_BYTES,
  MAX_IMAGE_DIM,
} from './assets'
import { HttpError } from '@/lib/api/errors'

// Real tiny PNG (sharp will correctly reject the old "PNG magic + zero bytes"
// fakes now that saveViewbookAsset decodes every upload).
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])

let realPng: Buffer
let pngAlpha: Buffer, jpg: Buffer, webp: Buffer, corrupt: Buffer, huge: Buffer

beforeAll(async () => {
  realPng = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toBuffer()
  pngAlpha = await sharp({
    create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 128, b: 200, alpha: 0.5 } },
  })
    .png()
    .toBuffer()
  jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 50, b: 50 } } })
    .jpeg()
    .toBuffer()
  webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 200, b: 10 } } })
    .webp()
    .toBuffer()
  corrupt = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('garbage'.repeat(8)),
  ]) // PNG magic, undecodable body
  huge = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: { r: 5, g: 5, b: 5 } } })
    .png()
    .toBuffer()
})

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

  it('save → read roundtrip re-encodes to webp with a server-generated filename', async () => {
    const { filename, mime } = await saveViewbookAsset('7', realPng)
    expect(filename).toMatch(/^[a-z0-9-]+\.webp$/)
    expect(mime).toBe('image/webp')
    const back = await readViewbookAsset('7', filename)
    expect(back?.mime).toBe('image/webp')
    expect(sniffImageType(back!.buf)).toBe('webp')
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
    await expect(saveViewbookAsset('7', Buffer.alloc(MAX_ASSET_BYTES + 1))).rejects.toBeInstanceOf(HttpError)
    await expect(saveViewbookAsset('7', Buffer.from('hello world plain text'))).rejects.toBeInstanceOf(HttpError)
    await expect(saveViewbookAsset('../evil', realPng)).rejects.toBeInstanceOf(HttpError)
  })

  it('read tolerates ENOENT and rejects traversal-shaped names without touching fs', async () => {
    expect(await readViewbookAsset('7', 'missing.webp')).toBeNull()
    expect(await readViewbookAsset('7', '..%2fescape.webp')).toBeNull()
    expect(await readViewbookAsset('7', '../escape.webp')).toBeNull()
    expect(await readViewbookAsset('bad scope', 'a.webp')).toBeNull()
  })

  it('read rethrows non-ENOENT fs errors via injected deps', async () => {
    const eacces = Object.assign(new Error('denied'), { code: 'EACCES' })
    await expect(
      readViewbookAsset('7', 'ok-name.webp', { readFile: async () => { throw eacces } }),
    ).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('delete is best-effort: ENOENT silent, other errors swallowed, bad names skipped', async () => {
    const { filename } = await saveViewbookAsset('7', realPng)
    await expect(deleteViewbookAssets('7', ['missing.webp', '../escape.webp', filename])).resolves.toBeUndefined()
    expect(await readViewbookAsset('7', filename)).toBeNull()
  })
})

describe('saveViewbookAsset webp pipeline', () => {
  it('re-encodes png+alpha → {filename:.webp, mime:image/webp} with alpha preserved', async () => {
    const { filename, mime } = await saveViewbookAsset('global', pngAlpha)
    expect(filename.endsWith('.webp')).toBe(true)
    expect(mime).toBe('image/webp')
    const stored = await readFile(path.join(dir, 'global', filename))
    expect(sniffImageType(stored)).toBe('webp')
    expect((await sharp(stored).metadata()).hasAlpha).toBe(true)
  })

  it('jpg and webp inputs both produce .webp', async () => {
    expect((await saveViewbookAsset('global', jpg)).filename.endsWith('.webp')).toBe(true)
    expect((await saveViewbookAsset('global', webp)).filename.endsWith('.webp')).toBe(true)
  })

  it('strips EXIF metadata', async () => {
    const withExif = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .withExif({ IFD0: { Copyright: 'SECRET' } })
      .jpeg()
      .toBuffer()
    const { filename } = await saveViewbookAsset('global', withExif)
    expect((await sharp(await readFile(path.join(dir, 'global', filename))).metadata()).exif).toBeUndefined()
  })

  it('clamps oversized dimensions to MAX_IMAGE_DIM (fit inside)', async () => {
    const { filename } = await saveViewbookAsset('global', huge)
    const meta = await sharp(await readFile(path.join(dir, 'global', filename))).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(MAX_IMAGE_DIM)
  })

  it('rejects a corrupt image with 400 invalid_image', async () => {
    await expect(saveViewbookAsset('global', corrupt)).rejects.toMatchObject({ status: 400, code: 'invalid_image' })
  })

  it('rejects an oversize buffer with 400 invalid_image before decoding', async () => {
    await expect(saveViewbookAsset('global', Buffer.alloc(MAX_ASSET_BYTES + 1, 0))).rejects.toMatchObject({
      status: 400,
      code: 'invalid_image',
    })
  })

  it('rejects a bad scope with 400 invalid_scope (unchanged)', async () => {
    await expect(saveViewbookAsset('../evil', pngAlpha)).rejects.toMatchObject({ status: 400, code: 'invalid_scope' })
  })

  it('MAX_ASSET_BYTES is 10 MB', () => {
    expect(MAX_ASSET_BYTES).toBe(10 * 1024 * 1024)
  })
})
