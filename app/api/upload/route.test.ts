import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sessionFindUniqueMock = vi.fn()
const sessionCreateMock = vi.fn()
const sessionUpdateMock = vi.fn()
const mkdirMock = vi.fn()
const writeFileMock = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    session: {
      findUnique: (...args: unknown[]) => sessionFindUniqueMock(...args),
      create: (...args: unknown[]) => sessionCreateMock(...args),
      update: (...args: unknown[]) => sessionUpdateMock(...args),
    },
  },
}))

vi.mock('fs/promises', () => ({
  default: {
    mkdir: (...args: unknown[]) => mkdirMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
  },
}))

import { POST } from './route'
import { getClientIp } from '@/lib/upload-helpers'

const ORIG_ENV = { ...process.env }

function uploadRequest(formData: FormData, contentLength: number): NextRequest {
  return new NextRequest('http://localhost:3000/api/upload', {
    method: 'POST',
    headers: {
      'content-length': String(contentLength),
      'x-forwarded-for': '203.0.113.10',
    },
    body: formData,
  })
}

describe('POST /api/upload', () => {
  beforeEach(() => {
    process.env = {
      ...ORIG_ENV,
      UPLOAD_MAX_BODY_BYTES: '1024',
    }
    sessionFindUniqueMock.mockReset().mockResolvedValue(null)
    sessionCreateMock.mockReset().mockResolvedValue({})
    sessionUpdateMock.mockReset().mockResolvedValue({})
    mkdirMock.mockReset().mockResolvedValue(undefined)
    writeFileMock.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.env = { ...ORIG_ENV }
    vi.restoreAllMocks()
  })

  it('rejects uploads over the configured request body cap before parsing multipart data', async () => {
    const form = new FormData()
    form.append('file', new Blob(['id\n1']), 'internal_all.csv')

    const res = await POST(uploadRequest(form, 2048))
    const body = await res.json()

    expect(res.status).toBe(413)
    expect(body.error).toMatch(/too large/i)
    expect(sessionCreateMock).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('accepts uploads within the configured request body cap', async () => {
    const form = new FormData()
    form.append('file', new Blob(['id\n1']), 'internal_all.csv')

    const res = await POST(uploadRequest(form, 512))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.files).toEqual(['internal_all.csv'])
    expect(sessionCreateMock).toHaveBeenCalled()
    expect(writeFileMock).toHaveBeenCalled()
  })

  it('rejects CSV-named archives before writing files', async () => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]), 'internal_all.csv')

    const res = await POST(uploadRequest(form, 512))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid file content/i)
    expect(sessionCreateMock).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })
})

describe('getClientIp — quota keying source', () => {
  const ipReq = (headers: Record<string, string>) =>
    new NextRequest('http://localhost/api/upload', { method: 'POST', headers })

  it('prefers CF-Connecting-IP over X-Forwarded-For (XFF is client-spoofable)', () => {
    expect(
      getClientIp(ipReq({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })),
    ).toBe('198.51.100.7')
  })

  it('falls back to x-real-ip, then the first X-Forwarded-For value, then "unknown"', () => {
    expect(getClientIp(ipReq({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
    expect(getClientIp(ipReq({ 'x-forwarded-for': '203.0.113.10, 9.9.9.9' }))).toBe('203.0.113.10')
    expect(getClientIp(ipReq({}))).toBe('unknown')
  })
})
