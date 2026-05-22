import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { scanPdfBuffer, scanPdfUrl } from './pdf-runner'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FIX = (name: string) => path.join(__dirname, '__fixtures__', name)
const load = async (name: string) => fs.readFile(FIX(name))

describe('scanPdfBuffer', () => {
  it('flags an untagged PDF as not-tagged', async () => {
    const r = await scanPdfBuffer(await load('untagged.pdf'), 'https://x/u.pdf')
    expect(r.issues.map((i) => i.code)).toContain('not-tagged')
  })

  it('flags missing title metadata', async () => {
    const r = await scanPdfBuffer(await load('untagged.pdf'), 'https://x/u.pdf')
    expect(r.issues.map((i) => i.code)).toContain('no-title')
  })

  it('does not flag no-title when title is present', async () => {
    const r = await scanPdfBuffer(await load('titled.pdf'), 'https://x/t.pdf')
    expect(r.issues.map((i) => i.code)).not.toContain('no-title')
  })

  it('flags image-only when page has no extractable text', async () => {
    const r = await scanPdfBuffer(await load('image-only.pdf'), 'https://x/i.pdf')
    expect(r.issues.map((i) => i.code)).toContain('image-only')
  })

  it('reports pageCount', async () => {
    const r = await scanPdfBuffer(await load('untagged.pdf'), 'https://x/u.pdf')
    expect(r.pageCount).toBe(1)
  })
})

describe('scanPdfUrl — oversize handling', () => {
  it('returns skipReason="oversize" instead of scanError when the PDF exceeds the cap', async () => {
    vi.mock('@/lib/security/safe-url', () => ({
      safeFetch: vi.fn(async () => ({
        response: new Response('', { status: 200 }),
        url: 'https://x/big.pdf',
        redirects: [],
      })),
      readResponseBytesWithLimit: vi.fn(async () => ({
        bytes: new Uint8Array(0),
        truncated: true,
      })),
    }))

    const { scanPdfUrl: scanPdfUrlFresh } = await import('./pdf-runner?t=oversize')
    const r = await scanPdfUrlFresh('https://x/big.pdf')
    expect(r.skipReason).toBe('oversize')
    expect(r.scanError).toBeUndefined()
    expect(r.fileSize).toBeNull()
    expect(r.pageCount).toBeNull()
    expect(r.issues).toEqual([])

    vi.restoreAllMocks()
  })
})
