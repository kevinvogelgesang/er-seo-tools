// Viewbook asset store (spec §6): magic-byte-sniffed png/jpg/webp only,
// server-generated filenames, atomic unique-temp+rename writes, resolved-path
// containment on reads, ENOENT-only tolerance (other fs errors rethrow on
// read; on the best-effort delete path they are logged and swallowed).
// Server-only.

import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import { HttpError } from '@/lib/api/errors'
import { logError } from '@/lib/log'
import { ASSET_FILENAME_RE } from './theme'

export const MAX_ASSET_BYTES = 10 * 1024 * 1024 // 10 MB (PR7 §9)
export const MAX_IMAGE_DIM = 4000 // dimension ceiling alongside limitInputPixels
export const MAX_DOC_BYTES = 20 * 1024 * 1024
export const DOC_FILENAME_RE = /^[a-z0-9-]+\.pdf$/

const MIME_BY_TYPE = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const

export interface AssetReadDeps {
  readFile: (p: string) => Promise<Buffer>
}

const realReadDeps: AssetReadDeps = { readFile: (p) => readFile(p) }

export function viewbookAssetsDir(): string {
  return process.env.VIEWBOOK_ASSETS_DIR || path.join(process.cwd(), 'data', 'viewbook-assets')
}

// Scope is exactly 'global' or a positive integer viewbook id string.
export function validateAssetScope(scope: string): boolean {
  return scope === 'global' || /^[1-9][0-9]*$/.test(scope)
}

export function sniffImageType(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp'
  }
  return null
}

export function sniffPdfType(buf: Buffer): 'pdf' | null {
  return buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-' ? 'pdf' : null
}

export function mimeForFilename(filename: string): string | null {
  if (DOC_FILENAME_RE.test(filename)) return 'application/pdf'
  if (filename.endsWith('.png')) return MIME_BY_TYPE.png
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return MIME_BY_TYPE.jpeg
  if (filename.endsWith('.webp')) return MIME_BY_TYPE.webp
  return null
}

// Resolve a scoped asset path with containment: filename must match the
// server-filename regex AND the resolved path must stay inside the store.
function containedPath(scope: string, filename: string): string | null {
  if (!validateAssetScope(scope) || (!ASSET_FILENAME_RE.test(filename) && !DOC_FILENAME_RE.test(filename))) return null
  const base = path.resolve(viewbookAssetsDir())
  const resolved = path.resolve(base, scope, filename)
  if (!resolved.startsWith(base + path.sep)) return null
  return resolved
}

export async function saveViewbookDoc(
  scope: string,
  buf: Buffer,
): Promise<{ filename: string; mime: string }> {
  if (!validateAssetScope(scope)) throw new HttpError(400, 'invalid_scope')
  if (buf.length > MAX_DOC_BYTES || !sniffPdfType(buf)) throw new HttpError(400, 'invalid_pdf')

  const filename = `${crypto.randomUUID()}.pdf`
  const dest = containedPath(scope, filename)
  if (!dest) throw new HttpError(400, 'invalid_scope')

  await mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp-${crypto.randomUUID()}`
  await writeFile(tmp, buf)
  await rename(tmp, dest)
  return { filename, mime: 'application/pdf' }
}

// Serialize decode→re-encode across the process: two concurrent uploads must
// never hold two decoded bitmaps in RAM at once. Correctly ordered + self-healing
// after a rejection (a rejected run does not poison the chain).
let encodeChain: Promise<unknown> = Promise.resolve()
function serializeEncode<T>(fn: () => Promise<T>): Promise<T> {
  const run = encodeChain.then(fn, fn)
  encodeChain = run.then(() => undefined, () => undefined)
  return run
}

async function reencodeToWebp(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { limitInputPixels: 40_000_000 })
    .rotate() // honor EXIF orientation before stripping metadata
    .resize(MAX_IMAGE_DIM, MAX_IMAGE_DIM, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer()
}

export async function saveViewbookAsset(
  scope: string,
  buf: Buffer,
): Promise<{ filename: string; mime: string }> {
  if (!validateAssetScope(scope)) throw new HttpError(400, 'invalid_scope')
  if (buf.length > MAX_ASSET_BYTES) throw new HttpError(400, 'invalid_image')
  if (!sniffImageType(buf)) throw new HttpError(400, 'invalid_image')

  let webp: Buffer
  try {
    webp = await serializeEncode(() => reencodeToWebp(buf))
  } catch {
    throw new HttpError(400, 'invalid_image')
  }

  const filename = `${crypto.randomUUID()}.webp`
  const dest = containedPath(scope, filename)
  if (!dest) throw new HttpError(400, 'invalid_scope')

  await mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp-${crypto.randomUUID()}`
  await writeFile(tmp, webp)
  await rename(tmp, dest)
  return { filename, mime: 'image/webp' }
}

export async function readViewbookAsset(
  scope: string,
  filename: string,
  deps: AssetReadDeps = realReadDeps,
): Promise<{ buf: Buffer; mime: string } | null> {
  const resolved = containedPath(scope, filename)
  if (!resolved) return null
  const mime = mimeForFilename(filename)
  if (!mime) return null
  try {
    const buf = await deps.readFile(resolved)
    return { buf, mime }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

// Best-effort: never throws into callers (delete seams must not fail their
// parent flows). Bad scope/filename entries are skipped; ENOENT is silent;
// any other fs error is logged and swallowed.
export async function deleteViewbookAssets(scope: string, filenames: string[]): Promise<void> {
  for (const filename of filenames) {
    const resolved = containedPath(scope, filename)
    if (!resolved) continue
    try {
      await unlink(resolved)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logError({ subsystem: 'viewbook', op: 'asset-delete', scope, filename }, err)
      }
    }
  }
}
